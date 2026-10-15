// ============================================================================
// GeoServer WPS (Web Processing Service) Helper
//
// Sends raster processing jobs to GeoServer (like cropping, contouring,
// reclassifying, zonal statistics), decodes GeoTIFF results using geotiff.js,
// and parses vector GML/GeoJSON results to show on the map.
// ============================================================================


/* eslint-disable @typescript-eslint/no-explicit-any */
import { RasterMetadata, RasterProcessInput, RasterExecutionResult, RasterProcessOutput } from '../types/rasterAnalysis';
import { transformGeoJSONGeometry, geoJsonToWKT, detectGeometryCRS, extractRawGeometry, getGeoJSONBBox, parseGMLToGeoJSON, parseXmlStatsToGeoJSON } from './rasterGeometry';
import { validateCropIntersection, formatRasterErrorMessage } from './rasterValidation';
import { serializeClassificationRanges } from '../components/RasterClassificationRanges';
import { transformBBox } from './rasterCRS';
import { fromArrayBuffer } from 'geotiff';
import { booleanIntersects } from '@turf/boolean-intersects';

export interface RasterWpsExecuteParams {
  processId: string;
  inputs: Record<string, any>;
  inputSchema: RasterProcessInput[];
  rasterMetadata: RasterMetadata;
  outputIdentifier?: string;
  outputMimeType?: string;
  processOutput?: RasterProcessOutput;
  geoserverUrl: string;
  authHeader?: string;
  resultLayerName?: string;
  addedLayers?: import('../types/rasterAnalysis').LayerState[];
}

/**
 * Converts a TIFF ArrayBuffer into a PNG Blob and URL using geotiff.js.

 * Handles single-band (DEM/grayscale/nodata), palette/colormap, and multi-band (RGB/RGBA) with full contrast stretching.
 */
async function tiffToImageBlob(arrayBuffer: ArrayBuffer): Promise<{
  blob: Blob;
  url: string;
  nativeBbox?: [number, number, number, number];
  detectedCRS?: string;
}> {
  try {
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const rasters = await image.readRasters();

    // Try reading embedded bounding box from GeoTIFF tags
    let nativeBbox: [number, number, number, number] | undefined;
    try {
      const gBbox = image.getBoundingBox();
      if (gBbox && Array.isArray(gBbox) && gBbox.length === 4 && gBbox.every(n => typeof n === 'number' && !isNaN(n) && isFinite(n))) {
        nativeBbox = [gBbox[0], gBbox[1], gBbox[2], gBbox[3]];
      }
    } catch {
      // ignore
    }

    // Try reading embedded CRS from GeoKeys
    let detectedCRS: string | undefined;
    try {
      const geoKeys = image.getGeoKeys();
      if (geoKeys?.ProjectedCSTypeGeoKey) {
        detectedCRS = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
      } else if (geoKeys?.GeographicTypeGeoKey) {
        detectedCRS = `EPSG:${geoKeys.GeographicTypeGeoKey}`;
      }
    } catch {
      // ignore
    }

    if (typeof document === 'undefined') {
      const fallbackBlob = new Blob([arrayBuffer], { type: 'image/tiff' });
      return { blob: fallbackBlob, url: '', nativeBbox, detectedCRS };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallbackBlob = new Blob([arrayBuffer], { type: 'image/tiff' });
      return { blob: fallbackBlob, url: URL.createObjectURL(fallbackBlob), nativeBbox };
    }

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Check for indexed color map (Palette)
    let colorMap: any = null;
    try {
      colorMap = typeof (image as any).getColorMap === 'function' ? (image as any).getColorMap() : (image as any).fileDirectory?.ColorMap;
    } catch {
      // ignore
    }

    if (colorMap && Array.isArray(colorMap) && colorMap.length > 0 && rasters.length >= 1) {
      const band = rasters[0] as any;
      const numColors = colorMap.length / 3;
      const is16BitColorMap = colorMap.some((c: number) => c > 255);
      const shift = is16BitColorMap ? 8 : 0;

      for (let i = 0; i < band.length; i++) {
        const val = band[i];
        const pixelIdx = i * 4;
        if (isNaN(val) || val < 0 || val >= numColors) {
          data[pixelIdx] = 0;
          data[pixelIdx + 1] = 0;
          data[pixelIdx + 2] = 0;
          data[pixelIdx + 3] = 0;
        } else {
          const cIdx = Math.floor(val);
          data[pixelIdx] = colorMap[cIdx] >> shift;
          data[pixelIdx + 1] = colorMap[cIdx + numColors] >> shift;
          data[pixelIdx + 2] = colorMap[cIdx + 2 * numColors] >> shift;
          data[pixelIdx + 3] = 255;
        }
      }
    } else if (rasters.length === 1) {
      // Single-band: DEM elevation, single-index, grayscale, or float mask
      const band = rasters[0] as any;
      let min = Infinity;
      let max = -Infinity;

      const isNodata = (v: number) =>
        isNaN(v) ||
        !isFinite(v) ||
        v <= -9999 ||
        v >= 3.4e38 ||
        v === -32768 ||
        v === 65535;

      for (let i = 0; i < band.length; i++) {
        const val = band[i];
        if (!isNodata(val)) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }

      if (!isFinite(min) || min === Infinity) {
        min = 0;
        max = 255;
      }
      const range = max > min ? max - min : 1;

      for (let i = 0; i < band.length; i++) {
        const val = band[i];
        const pixelIdx = i * 4;
        if (isNodata(val)) {
          data[pixelIdx] = 0;
          data[pixelIdx + 1] = 0;
          data[pixelIdx + 2] = 0;
          data[pixelIdx + 3] = 0; // transparent
        } else {
          const norm = Math.max(0, Math.min(255, Math.round(((val - min) / range) * 255)));
          data[pixelIdx] = norm;
          data[pixelIdx + 1] = norm;
          data[pixelIdx + 2] = norm;
          data[pixelIdx + 3] = 255;
        }
      }
    } else if (rasters.length >= 3) {
      // Multi-band RGB / RGBA
      const rBand = rasters[0] as any;
      const gBand = rasters[1] as any;
      const bBand = rasters[2] as any;
      const aBand = rasters[3] as any;

      let maxRgb = -Infinity;
      for (let i = 0; i < Math.min(rBand.length, 10000); i++) {
        if (rBand[i] > maxRgb && isFinite(rBand[i])) maxRgb = rBand[i];
        if (gBand[i] > maxRgb && isFinite(gBand[i])) maxRgb = gBand[i];
        if (bBand[i] > maxRgb && isFinite(bBand[i])) maxRgb = bBand[i];
      }

      const scale = maxRgb > 255 ? (255 / maxRgb) : (maxRgb <= 1.0 && maxRgb > 0 ? 255 : 1);

      for (let i = 0; i < rBand.length; i++) {
        const pixelIdx = i * 4;
        const r = isNaN(rBand[i]) ? 0 : Math.max(0, Math.min(255, Math.round(rBand[i] * scale)));
        const g = isNaN(gBand[i]) ? 0 : Math.max(0, Math.min(255, Math.round(gBand[i] * scale)));
        const b = isNaN(bBand[i]) ? 0 : Math.max(0, Math.min(255, Math.round(bBand[i] * scale)));
        const a = aBand ? (isNaN(aBand[i]) ? 255 : (aBand[i] > 1 ? aBand[i] : aBand[i] * 255)) : 255;

        data[pixelIdx] = r;
        data[pixelIdx + 1] = g;
        data[pixelIdx + 2] = b;
        data[pixelIdx + 3] = a;
      }
    } else if (rasters.length === 2) {
      const gBand = rasters[0] as any;
      const aBand = rasters[1] as any;
      for (let i = 0; i < gBand.length; i++) {
        const pixelIdx = i * 4;
        const g = isNaN(gBand[i]) ? 0 : Math.max(0, Math.min(255, Math.round(gBand[i])));
        const a = isNaN(aBand[i]) ? 255 : Math.max(0, Math.min(255, Math.round(aBand[i])));
        data[pixelIdx] = g;
        data[pixelIdx + 1] = g;
        data[pixelIdx + 2] = g;
        data[pixelIdx + 3] = a;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          resolve({ blob, url, nativeBbox });
        } else {
          const fallbackBlob = new Blob([arrayBuffer], { type: 'image/tiff' });
          resolve({ blob: fallbackBlob, url: URL.createObjectURL(fallbackBlob), nativeBbox });
        }
      }, 'image/png');
    });
  } catch (err) {
    console.warn('Could not decode TIFF with geotiff.js, falling back to direct Blob URL:', err);
    const fallbackBlob = new Blob([arrayBuffer], { type: 'image/tiff' });
    return { blob: fallbackBlob, url: URL.createObjectURL(fallbackBlob) };
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(buffer).toString('base64');
}

/**
 * Builds the complete WPS Execute XML document for a raster process.
 * Performs dynamic geometry transformation to the raster's native CRS,
 * validates bounding box intersection, and serializes the coverage reference in model space.
 */
export function determineOutputMimeType(
  processId: string,
  processOutput?: RasterProcessOutput,
  requestedMime?: string
): { mimeType: string; isVector: boolean } {
  if (requestedMime) {
    const isVec = requestedMime.includes('json') || requestedMime.includes('gml') || requestedMime.includes('wfs');
    return { mimeType: requestedMime, isVector: isVec };
  }

  const pid = processId.toLowerCase();
  const formats = processOutput?.supportedFormats?.map(f => f.toLowerCase()) || [];
  const defaultFormat = (processOutput?.mimeType || '').toLowerCase();

  const isKnownVectorProcess =
    pid.includes('contour') ||
    pid.includes('polygonextraction') ||
    pid.includes('pointcollection') ||
    pid.includes('rasteraspoint') ||
    pid.includes('vectorize') ||
    pid.includes('intersection') ||
    pid.includes('zonal') ||
    pid.includes('features');

  const supportsJson = formats.some(f => f.includes('json') || f.includes('geojson'));
  const supportsGmlOrWfs = formats.some(f => f.includes('gml') || f.includes('wfs'));
  const defaultIsJsonOrVector = defaultFormat.includes('json') || defaultFormat.includes('gml') || defaultFormat.includes('wfs');

  if (isKnownVectorProcess || supportsJson || supportsGmlOrWfs || defaultIsJsonOrVector) {
    return { mimeType: 'application/json', isVector: true };
  }

  const isStatsOrTable = pid.includes('stats') || pid.includes('histogram') || pid.includes('count') || pid.includes('unique');
  if (isStatsOrTable && formats.some(f => f.includes('text') || f.includes('csv') || f.includes('json') || f.includes('xml'))) {
    const tableMime = formats.find(f => f.includes('json')) || formats.find(f => f.includes('text/csv')) || formats.find(f => f.includes('text/plain')) || 'application/json';
    return { mimeType: tableMime, isVector: true };
  }

  return { mimeType: 'image/tiff', isVector: false };
}

/**
 * Builds the complete WPS Execute XML document for a raster process.
 * Performs dynamic geometry transformation to the raster's native CRS,
 * validates bounding box intersection, and serializes the coverage reference in model space.
 */
export async function buildRasterWPSExecuteRequest({
  processId,
  inputs,
  inputSchema,
  rasterMetadata,
  outputIdentifier = 'result',
  outputMimeType,
  processOutput,
  addedLayers,
}: {
  processId: string;
  inputs: Record<string, any>;
  inputSchema: RasterProcessInput[];
  rasterMetadata: RasterMetadata;
  outputIdentifier?: string;
  outputMimeType?: string;
  processOutput?: RasterProcessOutput;
  addedLayers?: import('../types/rasterAnalysis').LayerState[];
}): Promise<{ xmlPayload: string; outputMimeType: string }> {
  const { mimeType: effectiveOutputMimeType } = determineOutputMimeType(processId, processOutput, outputMimeType);

  let effectiveOutputId = outputIdentifier;
  if (!effectiveOutputId || effectiveOutputId === 'result') {
    if (processOutput?.identifier && processOutput.identifier !== 'result') {
      effectiveOutputId = processOutput.identifier;
    } else if (processId.toLowerCase().includes('zonal')) {
      effectiveOutputId = 'statistics';
    } else {
      effectiveOutputId = 'result';
    }
  }

  // 1. Resolve active raster layer's native CRS and bounding box upfront
  let activeRasterCrs = rasterMetadata?.nativeCRS || 'EPSG:4326';
  let _activeRasterBbox = rasterMetadata?.bbox || { minX: -180, minY: -90, maxX: 180, maxY: 90 };

  for (const input of inputSchema) {
    const idLower = input.identifier.toLowerCase();
    const isCoverage =
      idLower === 'coverage' ||
      idLower === 'coveragea' ||
      idLower === 'coverageb' ||
      idLower === 'coverages' ||
      idLower === 'data' ||
      idLower === 'input' ||
      idLower === 'inputcoverage' ||
      idLower === 'sourcecoverage' ||
      idLower === 'classification' ||
      (input.type === 'complex' && (input.dataType?.toLowerCase().includes('gridcoverage') || input.dataType?.toLowerCase().includes('coverage')));

    if (isCoverage && inputs[input.identifier]) {
      const covVal = inputs[input.identifier];
      if (typeof covVal === 'string' && addedLayers) {
        const match = addedLayers.find(l => l.id === covVal || l.name === covVal);
        if (match?.nativeCRS) {
          activeRasterCrs = match.nativeCRS;
        }
        if (match?.bbox) {
          _activeRasterBbox = {
            minX: match.bbox[0],
            minY: match.bbox[1],
            maxX: match.bbox[2],
            maxY: match.bbox[3],
          };
        }
      }
      break;
    }
  }

  let dataInputsXml = '';

  // Parameters that must be strictly positive — sending 0 causes GeoServer "Illegal argument" errors
  const MUST_BE_POSITIVE = new Set(['classes', 'numclasses', 'numlevels', 'interval', 'levels', 'scalex', 'scaley']);

  for (const input of inputSchema) {
    const rawVal = inputs[input.identifier];
    if (rawVal === undefined || rawVal === null || rawVal === '') continue;

    // Skip zero values for parameters that require a positive number
    const idLower = input.identifier.toLowerCase();
    if (MUST_BE_POSITIVE.has(idLower) && (rawVal === 0 || rawVal === '0' || Number(rawVal) <= 0)) continue;

    // Parse JSON strings if user provided a stringified payload
    let val = rawVal;
    if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();
      if (trimmed.startsWith('{') || (trimmed.startsWith('[') && !idLower.includes('script'))) {
        try {
          val = JSON.parse(trimmed);
        } catch {
          val = rawVal;
        }
      }
    }

    const isCoverageInput =
      idLower === 'coverage' ||
      idLower === 'coveragea' ||
      idLower === 'coverageb' ||
      idLower === 'coverages' ||
      idLower === 'data' ||
      idLower === 'input' ||
      idLower === 'inputcoverage' ||
      idLower === 'sourcecoverage' ||
      idLower === 'classification' ||
      (input.type === 'complex' && (input.dataType?.toLowerCase().includes('gridcoverage') || input.dataType?.toLowerCase().includes('coverage')));

    if (isCoverageInput) {
      let targetBuffer: ArrayBuffer | undefined = undefined;
      let targetBlob: Blob | undefined = undefined;
      const coverageLayerName = typeof val === 'string' ? val : rasterMetadata.layerName;

      let layerNativeCrs = rasterMetadata.nativeCRS || 'EPSG:4326';
      const layerBbox = rasterMetadata.bbox;

      if (typeof val === 'string' && addedLayers) {
        const match = addedLayers.find(l => l.id === val || l.name === val);
        if (match) {
          if (match.rawBuffer || match.imageBlob) {
            targetBuffer = match.rawBuffer;
            targetBlob = match.imageBlob;
          }
          if (match.nativeCRS) {
            layerNativeCrs = match.nativeCRS;
          }
        }
      }

      if (!targetBuffer && !targetBlob && (rasterMetadata.rawBuffer || rasterMetadata.imageBlob)) {
        if (rasterMetadata.layerName === val || !val || rasterMetadata.layerName.startsWith('raster_res_')) {
          targetBuffer = rasterMetadata.rawBuffer;
          targetBlob = rasterMetadata.imageBlob;
        }
      }

      let base64Tiff: string | null = null;
      if (targetBuffer) {
        base64Tiff = arrayBufferToBase64(targetBuffer);
      } else if (targetBlob) {
        const arrBuf = await targetBlob.arrayBuffer();
        base64Tiff = arrayBufferToBase64(arrBuf);
      }

      if (base64Tiff) {
        // Send inline binary GeoTIFF via base64 encoding (100% in-memory chained analysis, zero GeoServer publishing!)
        dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="image/tiff" encoding="base64">${base64Tiff}</wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
      } else {
        // Use WCS GetCoverage reference for standard published layers on GeoServer
        const crsCode = layerNativeCrs.replace(/[^0-9]/g, '');
        const is4326 = !crsCode || crsCode === '4326' || layerNativeCrs.toUpperCase().includes('CRS84');
        const crsUrn = is4326 ? 'urn:ogc:def:crs:OGC:1.3:CRS84' : `urn:ogc:def:crs:EPSG::${crsCode}`;
        let minX = is4326 ? (rasterMetadata?.latLonBbox?.minX ?? layerBbox?.minX ?? -180) : (layerBbox?.minX ?? -180);
        let minY = is4326 ? (rasterMetadata?.latLonBbox?.minY ?? layerBbox?.minY ?? -90) : (layerBbox?.minY ?? -90);
        let maxX = is4326 ? (rasterMetadata?.latLonBbox?.maxX ?? layerBbox?.maxX ?? 180) : (layerBbox?.maxX ?? 180);
        let maxY = is4326 ? (rasterMetadata?.latLonBbox?.maxY ?? layerBbox?.maxY ?? 90) : (layerBbox?.maxY ?? 90);

        // Dynamically crop WCS DomainSubset to ROI bounding box if ROI geometry is provided
        const roiGeomVal = inputs.cropShape || inputs.roi || inputs.geometry || inputs.shape || inputs.polygon || inputs.cropGeom || inputs.clipGeom || inputs.geom;
        if (roiGeomVal) {
          const rawGeom = extractRawGeometry(roiGeomVal) || roiGeomVal;
          if (rawGeom) {
            const srcCrs = detectGeometryCRS(rawGeom, 'EPSG:4326');
            const targetCrs = is4326 ? 'EPSG:4326' : layerNativeCrs;
            try {
              const transformedRoi = await transformGeoJSONGeometry(rawGeom, srcCrs, targetCrs);
              const roiBbox = getGeoJSONBBox(transformedRoi);
              if (roiBbox) {
                const effMinX = Math.max(minX, roiBbox.minX);
                const effMinY = Math.max(minY, roiBbox.minY);
                const effMaxX = Math.min(maxX, roiBbox.maxX);
                const effMaxY = Math.min(maxY, roiBbox.maxY);
                if (effMinX < effMaxX && effMinY < effMaxY) {
                  minX = effMinX;
                  minY = effMinY;
                  maxX = effMaxX;
                  maxY = effMaxY;
                }
              }
            } catch (err) {
              console.warn('Could not subset WCS DomainSubset to ROI bbox:', err);
            }
          }
        }

        const lowerCorner = `${minX} ${minY}`;
        const upperCorner = `${maxX} ${maxY}`;

        dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Reference mimeType="image/tiff" xlink:href="http://geoserver/wcs" method="POST">
        <wps:Body>
          <wcs:GetCoverage service="WCS" version="1.1.1">
            <ows:Identifier>${coverageLayerName}</ows:Identifier>
            <wcs:DomainSubset>
              <ows:BoundingBox crs="${crsUrn}">
                <ows:LowerCorner>${lowerCorner}</ows:LowerCorner>
                <ows:UpperCorner>${upperCorner}</ows:UpperCorner>
              </ows:BoundingBox>
            </wcs:DomainSubset>
            <wcs:Output format="image/tiff"/>
          </wcs:GetCoverage>
        </wps:Body>
      </wps:Reference>
    </wps:Input>`;
      }
    } else if (input.type === 'complex') {
      const isFeatureCollectionInput =
        idLower === 'zones' ||
        idLower === 'features' ||
        idLower === 'featurecollection' ||
        input.dataType?.toLowerCase().includes('featurecollection');

      const isGeomInput =
        idLower === 'cropshape' ||
        idLower === 'roi' ||
        idLower === 'geometry' ||
        idLower === 'cropgeom' ||
        idLower === 'clipgeom' ||
        idLower === 'geom' ||
        idLower === 'shape' ||
        idLower === 'polygon' ||
        idLower === 'bounds' ||
        idLower === 'mask' ||
        idLower === 'footprint' ||
        idLower === 'area' ||
        input.dataType?.toLowerCase().includes('geometry') ||
        input.dataType?.toLowerCase().includes('jts') ||
        (val && typeof val === 'object' && (val.type === 'FeatureCollection' || val.type === 'Feature' || val.type === 'Polygon' || val.type === 'MultiPolygon'));

      const isRangeArray =
        Array.isArray(val) &&
        val.length > 0 &&
        (val[0].min !== undefined || val[0].value !== undefined);

      if (isFeatureCollectionInput) {
        if (typeof val === 'object') {
          // Normalize val to a full FeatureCollection
          let fcToSend: any = val;
          if (val.type === 'Feature') {
            fcToSend = {
              type: 'FeatureCollection',
              features: [val]
            };
          } else if (val.type !== 'FeatureCollection') {
            fcToSend = {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  id: 'zone_1',
                  geometry: val,
                  properties: {
                    zone_id: 1,
                    zone_name: 'Zone 1'
                  }
                }
              ]
            };
          }

          const geomSourceCRS = val.crs || (val.features?.[0]?.geometry?.crs) || 'EPSG:4326';
          const targetCrs = activeRasterCrs || rasterMetadata?.nativeCRS || 'EPSG:4326';
          const transformedFC = await transformGeoJSONGeometry(fcToSend, geomSourceCRS, targetCrs);

          dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="application/json"><![CDATA[${JSON.stringify(transformedFC)}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
        } else if (typeof val === 'string') {
          // Check if string refers to an active vector layer in addedLayers
          const matched = addedLayers?.find(l => l.id === val || l.name === val);
          if (matched && (matched as any).geojson) {
            const targetCrs = activeRasterCrs || rasterMetadata?.nativeCRS || 'EPSG:4326';
            const transformedFC = await transformGeoJSONGeometry((matched as any).geojson, (matched as any).nativeCRS || 'EPSG:4326', targetCrs);
            dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="application/json"><![CDATA[${JSON.stringify(transformedFC)}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
          } else {
            // Send WFS reference for GeoServer published vector layer
            const targetCrs = activeRasterCrs || rasterMetadata?.nativeCRS || 'EPSG:4326';
            dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Reference mimeType="text/xml" xlink:href="http://geoserver/wfs" method="POST">
        <wps:Body>
          <wfs:GetFeature service="WFS" version="1.0.0" outputFormat="GML2" xmlns:wfs="http://www.opengis.net/wfs">
            <wfs:Query typeName="${val}" srsName="${targetCrs}"/>
          </wfs:GetFeature>
        </wps:Body>
      </wps:Reference>
    </wps:Input>`;
          }
        }
      } else if (isGeomInput && typeof val === 'object') {
        // Extract raw geometry (unwrap FeatureCollection / Feature)
        const rawGeom = extractRawGeometry(val) || val;
        const geomSourceCRS = detectGeometryCRS(rawGeom, val.crs || 'EPSG:4326');
        const targetCrs = activeRasterCrs || rasterMetadata?.nativeCRS || 'EPSG:4326';
        const transformedGeom = await transformGeoJSONGeometry(rawGeom, geomSourceCRS, targetCrs);

        // Pre-validate intersection with raster bounding box if metadata is present
        if (rasterMetadata && rasterMetadata.bbox) {
          const validation = validateCropIntersection(transformedGeom, rasterMetadata);
          if (!validation.valid) {
            throw new Error(validation.error);
          }
        }

        const wktString = geoJsonToWKT(transformedGeom);
        dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="application/wkt"><![CDATA[${wktString}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
      } else if (isRangeArray || idLower === 'ranges' || idLower === 'classificationranges') {
        // Serialize to RangeLookupTable XML for ras:RangeLookup
        const rangeXml = serializeClassificationRanges(val);
        dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="text/xml"><![CDATA[${rangeXml}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
      } else {
        // General complex data fallback
        const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
        dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="text/plain"><![CDATA[${strVal}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
      }
    } else if (input.type === 'bbox') {
      const parts = typeof val === 'string' ? val.split(/[,\s]+/).map(Number) : [];
      if (parts.length >= 4) {
        const crsCode = (activeRasterCrs || rasterMetadata?.nativeCRS || 'EPSG:4326').replace(/[^0-9]/g, '');
        const crsUrn = crsCode ? `urn:ogc:def:crs:EPSG::${crsCode}` : 'urn:ogc:def:crs:OGC:1.3:CRS84';
        dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <ows:BoundingBox crs="${crsUrn}">
          <ows:LowerCorner>${parts[0]} ${parts[1]}</ows:LowerCorner>
          <ows:UpperCorner>${parts[2]} ${parts[3]}</ows:UpperCorner>
        </ows:BoundingBox>
      </wps:Data>
    </wps:Input>`;
      }
    } else {
      // LiteralData
      dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:LiteralData>${String(val)}</wps:LiteralData>
      </wps:Data>
    </wps:Input>`;
    }
  }

  const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<wps:Execute version="1.0.0" service="WPS" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.opengis.net/wps/1.0.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:wps="http://www.opengis.net/wps/1.0.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" xmlns:wcs="http://www.opengis.net/wcs/1.1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:schemaLocation="http://www.opengis.net/wps/1.0.0 http://schemas.opengis.net/wps/1.0.0/wpsExecute_request.xsd">
  <ows:Identifier>${processId}</ows:Identifier>
  <wps:DataInputs>${dataInputsXml}
  </wps:DataInputs>
  <wps:ResponseForm>
    <wps:RawDataOutput mimeType="${effectiveOutputMimeType}">
      <ows:Identifier>${effectiveOutputId}</ows:Identifier>
    </wps:RawDataOutput>
  </wps:ResponseForm>
</wps:Execute>`;

  return { xmlPayload, outputMimeType: effectiveOutputMimeType };
}

/**
 * Checks if XML string is an OGC WPS/OWS Exception Report or ProcessFailed response.
 */
export function isXmlExceptionReport(xmlText: string): boolean {
  if (!xmlText || typeof xmlText !== 'string') return false;
  return /<([a-zA-Z0-9_-]+:)?(ExceptionReport|ServiceExceptionReport|Exception|ServiceException|ProcessFailed)\b/i.test(xmlText);
}

/**
 * Extracts the specific exception error message from an OGC XML exception document.
 */
export function extractExceptionText(xmlText: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const textNode =
      doc.getElementsByTagNameNS('*', 'ExceptionText')[0] ||
      doc.getElementsByTagName('ows:ExceptionText')[0] ||
      doc.getElementsByTagName('ExceptionText')[0];

    if (textNode?.textContent?.trim()) {
      return textNode.textContent.trim();
    }

    const failedNode =
      doc.getElementsByTagNameNS('*', 'ProcessFailed')[0] ||
      doc.getElementsByTagName('wps:ProcessFailed')[0];

    if (failedNode?.textContent?.trim()) {
      return failedNode.textContent.trim();
    }

    const exNode =
      doc.getElementsByTagNameNS('*', 'Exception')[0] ||
      doc.getElementsByTagName('ows:Exception')[0] ||
      doc.getElementsByTagName('ServiceException')[0] ||
      doc.getElementsByTagNameNS('*', 'ServiceException')[0];

    if (exNode?.textContent?.trim()) {
      return exNode.textContent.trim();
    }
  } catch {
    // ignore
  }
  return xmlText;
}

// Executes a WPS process on GeoServer and parses the output:
// - Builds the WPS XML request
// - Sends POST to GeoServer
// - If output is a GeoTIFF image, converts it into a viewable PNG canvas blob
// - If output is GeoJSON or GML vectors, parses features for map display
// - If output is XML stats, parses numerical statistics table
export async function executeRasterWPS(params: RasterWpsExecuteParams): Promise<RasterExecutionResult> {

  const {
    processId,
    inputs,
    inputSchema,
    rasterMetadata,
    outputIdentifier = 'result',
    outputMimeType,
    processOutput,
    geoserverUrl,
    authHeader,
    resultLayerName,
    addedLayers,
  } = params;

  const { xmlPayload, outputMimeType: reqMimeType } = await buildRasterWPSExecuteRequest({
    processId,
    inputs,
    inputSchema,
    rasterMetadata,
    outputIdentifier,
    outputMimeType,
    processOutput,
    addedLayers,
  });


  const isVectorExpected = reqMimeType === 'application/json';

  const headers: Record<string, string> = {
    'Content-Type': 'application/xml',
    'Accept': isVectorExpected ? 'application/json, text/xml, */*' : reqMimeType
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const endpoint = `${geoserverUrl.replace(/\/$/, '')}/wps`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: xmlPayload
  });

  if (!response.ok) {
    const errorText = await response.text();
    const friendlyErr = formatRasterErrorMessage(extractExceptionText(errorText));
    throw new Error(friendlyErr);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isJsonHeader = contentType.includes('application/json') || contentType.includes('text/json');

  if (isVectorExpected || isJsonHeader) {
    const text = await response.text();

    if (isXmlExceptionReport(text)) {
      const friendlyErr = formatRasterErrorMessage(extractExceptionText(text));
      throw new Error(friendlyErr);
    }

    const defaultVectorCRS = rasterMetadata?.nativeCRS || 'EPSG:4326';
    const inputGeom = extractRawGeometry(inputs.zones || inputs.shapes || inputs.features || inputs.geometry || inputs.shape || inputs.polygon);

    if (text.trim().startsWith('<')) {
      let parsedGeoJson = parseGMLToGeoJSON(text);
      if (!parsedGeoJson && text.includes('statistics')) {
        parsedGeoJson = parseXmlStatsToGeoJSON(text, inputGeom, inputs.zones);
      }
      if (parsedGeoJson) {
        if (inputGeom && Array.isArray(parsedGeoJson.features)) {
          parsedGeoJson.features.forEach((f: any, idx: number) => {
            if (!f.geometry || !f.geometry.type) {
              f.geometry = (inputs.zones?.type === 'FeatureCollection' ? inputs.zones.features?.[idx]?.geometry : inputGeom) || inputGeom;
            }
          });
        }
        return {
          type: 'VECTOR',
          geojson: parsedGeoJson,
          nativeCRS: defaultVectorCRS,
          layerName: resultLayerName || `${processId.split(':').pop()}_result`
        };
      }
    }

    try {
      const parsed = JSON.parse(text);
      let geojson: any = parsed;

      if (Array.isArray(parsed)) {
        geojson = {
          type: 'FeatureCollection',
          features: parsed.map((item, idx) => ({
            type: 'Feature',
            id: `zone_${item.zone ?? item.id ?? (idx + 1)}`,
            geometry: (inputs.zones?.type === 'FeatureCollection' ? inputs.zones.features?.[idx]?.geometry : inputGeom) || inputGeom,
            properties: typeof item === 'object' && item !== null ? item : { value: item }
          }))
        };
      } else if (parsed && typeof parsed === 'object' && parsed.type !== 'FeatureCollection') {
        geojson = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              id: 'zone_1',
              geometry: inputGeom,
              properties: parsed
            }
          ]
        };
      } else if (geojson && geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
        if (inputGeom) {
          geojson.features.forEach((f: any, idx: number) => {
            if (!f.geometry || !f.geometry.type) {
              f.geometry = (inputs.zones?.type === 'FeatureCollection' ? inputs.zones.features?.[idx]?.geometry : inputGeom) || inputGeom;
            }
          });
        }

        // If ROI was provided for a vector-generating process (e.g. ras:Contour), filter features to the ROI geometry
        const cropInputVal = inputs.roi || inputs.cropShape || inputs.geometry || inputs.shape || inputs.polygon || inputs.cropGeom || inputs.clipGeom || inputs.geom;
        if (cropInputVal && !processId.toLowerCase().includes('zonal')) {
          const rawCropGeom = extractRawGeometry(cropInputVal);
          if (rawCropGeom && (rawCropGeom.type === 'Polygon' || rawCropGeom.type === 'MultiPolygon')) {
            try {
              const geomSrcCRS = detectGeometryCRS(rawCropGeom, 'EPSG:4326');
              const targetCRS = defaultVectorCRS || 'EPSG:4326';
              const transformedCropGeom = await transformGeoJSONGeometry(rawCropGeom, geomSrcCRS, targetCRS);
              const originalFeatures = geojson.features;
              const filtered = originalFeatures.filter((f: any) => {
                if (!f.geometry) return false;
                try {
                  return booleanIntersects(f.geometry, transformedCropGeom);
                } catch {
                  return true;
                }
              });
              if (filtered.length > 0) {
                geojson.features = filtered;
              }
            } catch (filterErr) {
              console.warn('Could not filter vector features with ROI polygon:', filterErr);
            }
          }
        }
      }

      return {
        type: 'VECTOR',
        geojson,
        nativeCRS: defaultVectorCRS,
        layerName: resultLayerName || `${processId.split(':').pop()}_result`
      };
    } catch {
      let parsedGeoJson = parseGMLToGeoJSON(text);
      if (!parsedGeoJson && text.includes('statistics')) {
        parsedGeoJson = parseXmlStatsToGeoJSON(text, inputGeom, inputs.zones);
      }
      if (parsedGeoJson) {
        if (inputGeom && Array.isArray(parsedGeoJson.features)) {
          parsedGeoJson.features.forEach((f: any, idx: number) => {
            if (!f.geometry || !f.geometry.type) {
              f.geometry = (inputs.zones?.type === 'FeatureCollection' ? inputs.zones.features?.[idx]?.geometry : inputGeom) || inputGeom;
            }
          });
        }

        const cropInputVal = inputs.roi || inputs.cropShape || inputs.geometry || inputs.shape || inputs.polygon || inputs.cropGeom || inputs.clipGeom || inputs.geom;
        if (cropInputVal && !processId.toLowerCase().includes('zonal') && Array.isArray(parsedGeoJson.features)) {
          const rawCropGeom = extractRawGeometry(cropInputVal);
          if (rawCropGeom && (rawCropGeom.type === 'Polygon' || rawCropGeom.type === 'MultiPolygon')) {
            try {
              const geomSrcCRS = detectGeometryCRS(rawCropGeom, 'EPSG:4326');
              const targetCRS = defaultVectorCRS || 'EPSG:4326';
              const transformedCropGeom = await transformGeoJSONGeometry(rawCropGeom, geomSrcCRS, targetCRS);
              parsedGeoJson.features = parsedGeoJson.features.filter((f: any) => {
                if (!f.geometry) return false;
                try {
                  return booleanIntersects(f.geometry, transformedCropGeom);
                } catch {
                  return true;
                }
              });
            } catch (filterErr) {
              console.warn('Could not filter GML vector features with ROI polygon:', filterErr);
            }
          }
        }
        return {
          type: 'VECTOR',
          geojson: parsedGeoJson,
          nativeCRS: defaultVectorCRS,
          layerName: resultLayerName || `${processId.split(':').pop()}_result`
        };
      }
      throw new Error('Failed to parse vector output from GeoServer.');
    }
  } else {
    // Binary GeoTIFF result from GeoServer (or fallback XML)
    const buffer = await response.arrayBuffer();

    // Verify buffer is valid binary image and not an XML exception report or GML
    const snippet = new Uint8Array(buffer.slice(0, 1000));
    const decoded = new TextDecoder().decode(snippet).toLowerCase();
    if (decoded.includes('<?xml') || decoded.includes('<ows:exception') || decoded.includes('<exceptionreport') || decoded.includes('<serviceexception')) {
      const fullText = new TextDecoder().decode(new Uint8Array(buffer));
      if (isXmlExceptionReport(fullText)) {
        const friendlyErr = formatRasterErrorMessage(extractExceptionText(fullText));
        throw new Error(friendlyErr);
      }

      // Check if GeoServer returned GML vector features instead of GeoTIFF
      const parsedGeoJson = parseGMLToGeoJSON(fullText);
      if (parsedGeoJson) {
        return {
          type: 'VECTOR',
          geojson: parsedGeoJson,
          nativeCRS: rasterMetadata?.nativeCRS || 'EPSG:4326',
          layerName: resultLayerName || `${processId.split(':').pop()}_result`
        };
      }
    }

    // Convert TIFF to browser-renderable PNG Blob + URL using geotiff.js
    const { blob, url: imageUrl, nativeBbox, detectedCRS } = await tiffToImageBlob(buffer);
    const layerCRS = detectedCRS || rasterMetadata.nativeCRS || 'EPSG:4326';

    // Compute Lat/Lon Bounding Box for the raster extent
    let bbox: number[] = [-180, -90, 180, 90];

    // Priority 1: Native bounding box from GeoTIFF headers (the exact pixel extent)
    if (nativeBbox) {
      try {
        const transformedBbox = await transformBBox(
          nativeBbox,
          layerCRS,
          'EPSG:4326'
        );
        if (
          transformedBbox &&
          transformedBbox.every(n => typeof n === 'number' && !isNaN(n) && isFinite(n)) &&
          Math.abs(transformedBbox[0]) <= 180 &&
          Math.abs(transformedBbox[2]) <= 180 &&
          Math.abs(transformedBbox[1]) <= 90 &&
          Math.abs(transformedBbox[3]) <= 90
        ) {
          bbox = transformedBbox;
        }
      } catch (err) {
        console.warn('Could not transform native GeoTIFF bounding box to EPSG:4326:', err);
      }
    }

    // Priority 2: If user provided a crop geometry and nativeBbox wasn't available or out of range
    if (bbox[0] === -180 && bbox[2] === 180) {
      const cropInputVal = inputs.cropShape || inputs.roi || inputs.geometry || inputs.shape || inputs.polygon || inputs.cropGeom || inputs.clipGeom;
      if (cropInputVal) {
        const rawCropGeom = extractRawGeometry(cropInputVal);
        const cropBBox = rawCropGeom ? getGeoJSONBBox(rawCropGeom) : null;
        if (cropBBox) {
          const geomCRS = detectGeometryCRS(rawCropGeom, 'EPSG:4326');
          if (geomCRS !== 'EPSG:4326') {
            try {
              const transformedBbox = await transformBBox(
                [cropBBox.minX, cropBBox.minY, cropBBox.maxX, cropBBox.maxY],
                geomCRS,
                'EPSG:4326'
              );
              bbox = transformedBbox;
            } catch {
              bbox = [cropBBox.minX, cropBBox.minY, cropBBox.maxX, cropBBox.maxY];
            }
          } else {
            bbox = [cropBBox.minX, cropBBox.minY, cropBBox.maxX, cropBBox.maxY];
          }
        }
      }
    }

    // Priority 3: Layer latLonBbox or layer bbox from input metadata
    if (bbox[0] === -180 && bbox[2] === 180) {
      if (rasterMetadata.latLonBbox) {
        bbox = [
          rasterMetadata.latLonBbox.minX,
          rasterMetadata.latLonBbox.minY,
          rasterMetadata.latLonBbox.maxX,
          rasterMetadata.latLonBbox.maxY,
        ];
      } else if (rasterMetadata.bbox) {
        try {
          const transformed = await transformBBox(
            [rasterMetadata.bbox.minX, rasterMetadata.bbox.minY, rasterMetadata.bbox.maxX, rasterMetadata.bbox.maxY],
            layerCRS,
            'EPSG:4326'
          );
          if (
            transformed &&
            Math.abs(transformed[0]) <= 180 &&
            Math.abs(transformed[2]) <= 180 &&
            Math.abs(transformed[1]) <= 90 &&
            Math.abs(transformed[3]) <= 90
          ) {
            bbox = transformed;
          } else {
            bbox = [rasterMetadata.bbox.minX, rasterMetadata.bbox.minY, rasterMetadata.bbox.maxX, rasterMetadata.bbox.maxY];
          }
        } catch {
          bbox = [rasterMetadata.bbox.minX, rasterMetadata.bbox.minY, rasterMetadata.bbox.maxX, rasterMetadata.bbox.maxY];
        }
      }
    }

    return {
      type: 'RASTER',
      imageUrl,
      imageBlob: blob,
      rawBuffer: buffer,
      nativeCRS: layerCRS,
      layerName: resultLayerName || `${processId.split(':').pop()}_result`,
      bbox,
      outputFormat: 'image/png'
    };
  }
}

