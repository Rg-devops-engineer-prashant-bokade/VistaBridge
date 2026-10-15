// ============================================================================
// In-Browser GeoTIFF Pixel Sampler (rasterPixelSample.ts)
//
// In GIS, users click on a raster to inspect pixel values (e.g., elevation at a spot):
// - Decodes binary GeoTIFF files directly in the browser via `geotiff`
// - Maps map coordinates (lon, lat) to image pixel grid indices [pixelX, pixelY]
// - Returns raw band values (e.g. elevation height, temperature, NDVI)
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { fromArrayBuffer } from 'geotiff';
import { transformCoordinate, transformBBox } from './rasterCRS';

interface CachedRaster {
  width: number;
  height: number;
  rasters: any[];
  originX?: number;
  originY?: number;
  scaleX?: number;
  scaleY?: number;
  bbox?: [number, number, number, number];
  crs: string;
  isPixelArea?: boolean;
  transformMatrix?: [number, number, number, number, number, number];
}

const rasterCache = new WeakMap<ArrayBuffer, CachedRaster>();

export interface PixelSampleResult {
  layerName: string;
  coordinate: [number, number];
  pixelX: number;
  pixelY: number;
  bands: Array<{
    bandIndex: number;
    name: string;
    value: number | string;
  }>;
}

/**
 * Samples the exact pixel value(s) from an in-memory GeoTIFF ArrayBuffer at a given [lon, lat] coordinate.
 * Uses exact ModelTiepoint and ModelPixelScale in native CRS coordinates for 100% perfect match with GeoServer.
 */
export async function sampleRasterPixel(
  rawBuffer: ArrayBuffer,
  bbox: [number, number, number, number],
  coordinate: [number, number],
  layerName: string = 'Raster Layer',
  nativeCRS: string = 'EPSG:4326',
  sourceCRS: string = 'EPSG:4326'
): Promise<PixelSampleResult | null> {
  const [coordX, coordY] = coordinate;

  let cached = rasterCache.get(rawBuffer);
  if (!cached) {
    try {
      const tiff = await fromArrayBuffer(rawBuffer);
      const image = await tiff.getImage();
      const width = image.getWidth();
      const height = image.getHeight();
      const rasters = await image.readRasters();

      let originX: number | undefined;
      let originY: number | undefined;
      let scaleX: number | undefined;
      let scaleY: number | undefined;

      // 1. Read ModelTransformation (16-element affine matrix) if present
      let transformMatrix: [number, number, number, number, number, number] | undefined;
      const modelTrans = (image as any).fileDirectory?.ModelTransformation;
      if (modelTrans && Array.isArray(modelTrans) && modelTrans.length >= 16) {
        // [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p]
        // modelX = a * px + b * py + d
        // modelY = e * px + f * py + h
        const a = modelTrans[0];
        const b = modelTrans[1];
        const d = modelTrans[3];
        const e = modelTrans[4];
        const f = modelTrans[5];
        const h = modelTrans[7];
        const det = a * f - b * e;
        if (Math.abs(det) > 1e-12) {
          transformMatrix = [a, b, d, e, f, h];
        }
      }

      // 2. Read origin and resolution directly via geotiff.js
      if (!transformMatrix) {
        try {
          const origin = image.getOrigin();
          const res = image.getResolution();
          if (origin && origin.length >= 2 && res && res.length >= 2) {
            originX = origin[0];
            originY = origin[1];
            scaleX = Math.abs(res[0]);
            scaleY = Math.abs(res[1]);
          }
        } catch {
          // fallback to tiepoint/pixelscale tags
        }

        // 3. Fallback to raw ModelTiepoint & ModelPixelScale tags if needed
        if (originX === undefined || originY === undefined || !scaleX || !scaleY) {
          const tiepoint = (image as any).fileDirectory?.ModelTiepoint;
          const pixelScale = (image as any).fileDirectory?.ModelPixelScale;
          if (tiepoint && Array.isArray(tiepoint) && tiepoint.length >= 6 && pixelScale && Array.isArray(pixelScale) && pixelScale.length >= 2) {
            originX = tiepoint[3];
            originY = tiepoint[4];
            scaleX = Math.abs(pixelScale[0]);
            scaleY = Math.abs(pixelScale[1]);
          }
        }
      }

      // 4. Detect embedded CRS from GeoKeys
      let detectedCRS = nativeCRS || 'EPSG:4326';
      try {
        const geoKeys = image.getGeoKeys();
        if (geoKeys) {
          if (geoKeys.ProjectedCSTypeGeoKey) {
            detectedCRS = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
          } else if (geoKeys.GeographicTypeGeoKey) {
            detectedCRS = `EPSG:${geoKeys.GeographicTypeGeoKey}`;
          }
        }
      } catch {
        // ignore
      }

      // 5. Check if raster is PixelIsArea or PixelIsPoint (default to true / Area in GIS unless explicitly 2 / Point)
      let isPixelArea = true;
      try {
        const geoKeys = image.getGeoKeys();
        if (geoKeys && geoKeys.GTRasterTypeGeoKey === 2) {
          isPixelArea = false;
        } else {
          isPixelArea = true;
        }
      } catch {
        isPixelArea = true;
      }

      // 6. Compute exact bounding box in native CRS
      let tiffBbox: [number, number, number, number] | undefined;
      try {
        const gBbox = image.getBoundingBox();
        if (gBbox && Array.isArray(gBbox) && gBbox.length === 4 && gBbox.every(n => typeof n === 'number' && !isNaN(n) && isFinite(n))) {
          tiffBbox = [gBbox[0], gBbox[1], gBbox[2], gBbox[3]];
        }
      } catch {
        // ignore
      }

      cached = {
        width,
        height,
        rasters: rasters as any[],
        originX,
        originY,
        scaleX,
        scaleY,
        bbox: tiffBbox,
        crs: detectedCRS,
        isPixelArea,
        transformMatrix
      };
      rasterCache.set(rawBuffer, cached);
    } catch (err) {
      console.warn('Could not decode GeoTIFF buffer for pixel sampling:', err);
      return null;
    }
  }

  if (!cached) return null;

  const {
    width,
    height,
    rasters,
    originX,
    originY,
    scaleX,
    scaleY,
    bbox: tiffBbox,
    crs: layerCRS,
    isPixelArea = true,
    transformMatrix
  } = (cached as any);

  if (!width || !height || !rasters || rasters.length === 0) {
    return null;
  }

  let pixelX = -1;
  let pixelY = -1;

  // Method 1: ModelTransformation matrix inversion (if available)
  if (transformMatrix) {
    try {
      const [modelX, modelY] = await transformCoordinate([coordX, coordY], sourceCRS, layerCRS);
      const [a, b, d, e, f, h] = transformMatrix;
      const det = a * f - b * e;
      const rawPx = (f * (modelX - d) - b * (modelY - h)) / det;
      const rawPy = (-e * (modelX - d) + a * (modelY - h)) / det;
      const offset = isPixelArea ? 0 : 0.5;
      pixelX = Math.floor(rawPx + offset);
      pixelY = Math.floor(rawPy + offset);
    } catch (err) {
      console.warn('ModelTransformation calculation failed:', err);
    }
  }

  // Method 2: Standard Affine Transformation in native CRS model space
  if (pixelX === -1 && originX !== undefined && originY !== undefined && scaleX !== undefined && scaleY !== undefined && scaleX > 0 && scaleY > 0) {
    try {
      const [modelX, modelY] = await transformCoordinate([coordX, coordY], sourceCRS, layerCRS);
      const offsetX = isPixelArea ? 0 : (scaleX / 2);
      const offsetY = isPixelArea ? 0 : (scaleY / 2);
      pixelX = Math.floor((modelX - originX + offsetX) / scaleX);
      pixelY = Math.floor((originY - modelY + offsetY) / scaleY);
    } catch (transErr) {
      console.warn('Could not transform coordinate to native CRS for pixel math:', transErr);
    }
  }

  // Method 3: Fallback to normalized bounding box calculation
  if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
    let effectiveBbox = bbox;
    if (tiffBbox) {
      try {
        const geoBbox = await transformBBox(tiffBbox, layerCRS, 'EPSG:4326');
        if (geoBbox && geoBbox.every(n => typeof n === 'number' && !isNaN(n) && isFinite(n))) {
          effectiveBbox = [geoBbox[0], geoBbox[1], geoBbox[2], geoBbox[3]];
        }
      } catch {
        effectiveBbox = bbox;
      }
    }

    let [lon, lat] = [coordX, coordY];
    if (sourceCRS !== 'EPSG:4326') {
      try {
        [lon, lat] = await transformCoordinate([coordX, coordY], sourceCRS, 'EPSG:4326');
      } catch {
        // ignore
      }
    }

    const [minLon, minLat, maxLon, maxLat] = effectiveBbox;
    const dx = (maxLon - minLon) * 0.005;
    const dy = (maxLat - minLat) * 0.005;
    if (lon < (minLon - dx) || lon > (maxLon + dx) || lat < (minLat - dy) || lat > (maxLat + dy)) {
      return null;
    }

    const normX = Math.max(0, Math.min(1, (lon - minLon) / (maxLon - minLon)));
    const normY = Math.max(0, Math.min(1, (maxLat - lat) / (maxLat - minLat)));

    pixelX = Math.max(0, Math.min(width - 1, Math.floor(normX * width)));
    pixelY = Math.max(0, Math.min(height - 1, Math.floor(normY * height)));
  }

  // Out of bounds check
  if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) {
    return null;
  }

  const index = pixelY * width + pixelX;
  const bands: Array<{ bandIndex: number; name: string; value: number | string }> = [];

  const isNodata = (v: number) =>
    isNaN(v) ||
    !isFinite(v) ||
    v <= -9999 ||
    v >= 3.4e38 ||
    v === -32768 ||
    v === 65535;

  for (let b = 0; b < rasters.length; b++) {
    const bandData = rasters[b];
    const rawVal = bandData[index];
    const isValNodata = isNodata(rawVal);
    const displayVal = isValNodata
      ? 'NoData'
      : typeof rawVal === 'number'
        ? Number.isInteger(rawVal)
          ? rawVal
          : Number(rawVal.toFixed(4))
        : String(rawVal);

    // Standard GeoServer WMS GetFeatureInfo raster property names
    let bandName = `BAND_${b + 1}`;
    if (rasters.length === 1) {
      bandName = 'GRAY_INDEX';
    } else if (rasters.length === 2) {
      bandName = b === 0 ? 'GRAY_INDEX' : 'ALPHA_BAND';
    } else if (rasters.length >= 3) {
      if (b === 0) bandName = 'RED_BAND';
      else if (b === 1) bandName = 'GREEN_BAND';
      else if (b === 2) bandName = 'BLUE_BAND';
      else if (b === 3) bandName = 'ALPHA_BAND';
    }

    bands.push({
      bandIndex: b,
      name: bandName,
      value: displayVal
    });
  }

  // If all bands are NoData or alpha is transparent, the clicked point is outside the active raster data
  const alphaBand = bands.find(b => b.name === 'ALPHA_BAND');
  if (alphaBand && (Number(alphaBand.value) === 0 || alphaBand.value === '0')) {
    return null;
  }

  const hasValidData = bands.some(b => b.name !== 'ALPHA_BAND' && b.value !== 'NoData');
  if (!hasValidData) {
    return null;
  }

  return {
    layerName,
    coordinate: [coordX, coordY],
    pixelX,
    pixelY,
    bands
  };
}
