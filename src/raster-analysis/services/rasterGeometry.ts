// ============================================================================
// Raster Geometry & ROI Utilities (rasterGeometry.ts)
//
// In raster analysis, users frequently clip imagery using a Region of Interest (ROI):
// - Extracts geometry coordinates from GeoJSON Features & FeatureCollections
// - Calculates spatial intersections between the drawn ROI and the raster's grid extent
// - Converts user shapes into WKT or GML for GeoServer WPS processes
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { transformCoordinate } from './rasterCRS';
import { RasterBoundingBox } from '../types/rasterAnalysis';

/**
 * Extracts a pure GeoJSON geometry object from Feature, FeatureCollection, or Geometry.
 */
export function extractRawGeometry(geom: any): any {
  if (!geom) return null;
  if (typeof geom === 'string') {
    const trimmed = geom.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return extractRawGeometry(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }
    return null;
  }
  if (geom.type === 'FeatureCollection') {
    return geom.features?.[0]?.geometry || null;
  }
  if (geom.type === 'Feature') {
    return geom.geometry || null;
  }
  return geom;
}

/**
 * Auto-detects the CRS of coordinates in a GeoJSON geometry.
 */
export function detectGeometryCRS(geom: any, defaultCRS: string = 'EPSG:4326'): string {
  if (!geom) return defaultCRS;
  let firstCoord: [number, number] | null = null;
  const findFirst = (coords: any) => {
    if (!Array.isArray(coords) || firstCoord) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      firstCoord = [coords[0], coords[1]];
      return;
    }
    coords.forEach(findFirst);
  };
  if (geom.type === 'Feature') {
    findFirst(geom.geometry?.coordinates);
  } else if (geom.type === 'FeatureCollection') {
    findFirst(geom.features?.[0]?.geometry?.coordinates);
  } else {
    findFirst(geom.coordinates);
  }
  if (firstCoord) {
    if (Math.abs(firstCoord[0]) > 180 || Math.abs(firstCoord[1]) > 90) {
      return 'EPSG:3857';
    }
    return 'EPSG:4326';
  }
  return defaultCRS;
}

/**
 * Recursively transforms all coordinates within a GeoJSON geometry from sourceCRS to targetCRS.
 */
export async function transformGeoJSONGeometry(
  geom: any,
  sourceCRS: string = 'EPSG:4326',
  targetCRS: string
): Promise<any> {
  if (!geom) return null;

  if (geom.type === 'Feature') {
    return {
      ...geom,
      geometry: await transformGeoJSONGeometry(geom.geometry, sourceCRS, targetCRS)
    };
  }

  if (geom.type === 'FeatureCollection') {
    return {
      ...geom,
      features: await Promise.all(
        (geom.features || []).map((f: any) => transformGeoJSONGeometry(f, sourceCRS, targetCRS))
      )
    };
  }

  if (geom.type === 'GeometryCollection') {
    return {
      ...geom,
      geometries: await Promise.all(
        (geom.geometries || []).map((g: any) => transformGeoJSONGeometry(g, sourceCRS, targetCRS))
      )
    };
  }

  const transformCoords = async (coords: any): Promise<any> => {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const [tx, ty] = await transformCoordinate([coords[0], coords[1]], sourceCRS, targetCRS);
      return [tx, ty];
    }
    return Promise.all(coords.map(transformCoords));
  };

  const newCoordinates = await transformCoords(geom.coordinates);

  return {
    ...geom,
    coordinates: newCoordinates
  };
}

/**
 * Calculates the bounding box of a GeoJSON geometry in its current coordinates.
 */
export function getGeoJSONBBox(geom: any): RasterBoundingBox | null {
  if (!geom) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const inspect = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const x = coords[0];
      const y = coords[1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    coords.forEach(inspect);
  };

  if (geom.type === 'Feature') {
    inspect(geom.geometry?.coordinates);
  } else if (geom.type === 'FeatureCollection') {
    (geom.features || []).forEach((f: any) => inspect(f.geometry?.coordinates));
  } else {
    inspect(geom.coordinates);
  }

  if (minX === Infinity || minY === Infinity) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Formats a coordinate pair into WKT "X Y".
 * Rounds to 4 decimal places for projected coordinates / 7 for geographic to avoid scientific notation.
 */
function formatCoord(c: [number, number]): string {
  const x = Math.abs(c[0]) > 180 ? Number(c[0].toFixed(3)) : Number(c[0].toFixed(7));
  const y = Math.abs(c[1]) > 90 ? Number(c[1].toFixed(3)) : Number(c[1].toFixed(7));
  return `${x} ${y}`;
}

/**
 * Converts a GeoJSON geometry to standard OGC Well-Known Text (WKT).
 * Strictly used at the WPS boundary.
 */
export function geoJsonToWKT(geom: any): string {
  if (!geom) return '';

  // Unwrap FeatureCollection → first Feature
  if (geom.type === 'FeatureCollection') {
    const first = geom.features?.[0];
    if (!first) return '';
    return geoJsonToWKT(first);
  }

  const actualGeom = geom.type === 'Feature' ? geom.geometry : geom;
  if (!actualGeom || !actualGeom.coordinates) return '';

  switch (actualGeom.type) {
    case 'Point':
      return `POINT(${formatCoord(actualGeom.coordinates)})`;

    case 'MultiPoint':
      return `MULTIPOINT(${actualGeom.coordinates.map((c: any) => `(${formatCoord(c)})`).join(', ')})`;

    case 'LineString':
      return `LINESTRING(${actualGeom.coordinates.map(formatCoord).join(', ')})`;

    case 'MultiLineString':
      return `MULTILINESTRING(${actualGeom.coordinates
        .map((line: any) => `(${line.map(formatCoord).join(', ')})`)
        .join(', ')})`;

    case 'Polygon': {
      const rings = actualGeom.coordinates.map((ring: any[]) => {
        const closed = [...ring];
        // Ensure polygon ring is closed
        if (closed.length > 0) {
          const first = closed[0];
          const last = closed[closed.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            closed.push([first[0], first[1]]);
          }
        }
        return `(${closed.map(formatCoord).join(', ')})`;
      });
      return `POLYGON(${rings.join(', ')})`;
    }

    case 'MultiPolygon': {
      const polys = actualGeom.coordinates.map((poly: any[][]) => {
        const rings = poly.map((ring: any[]) => {
          const closed = [...ring];
          if (closed.length > 0) {
            const first = closed[0];
            const last = closed[closed.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              closed.push([first[0], first[1]]);
            }
          }
          return `(${closed.map(formatCoord).join(', ')})`;
        });
        return `(${rings.join(', ')})`;
      });
      return `MULTIPOLYGON(${polys.join(', ')})`;
    }

    default:
      throw new Error(`Unsupported geometry type for WKT conversion: ${actualGeom.type}`);
  }
}

/**
 * Parses GML (2.x / 3.x) or WFS FeatureCollection XML text into a standard GeoJSON FeatureCollection.
 */
export function parseGMLToGeoJSON(xmlText: string): any {
  if (!xmlText || typeof xmlText !== 'string') return null;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    if (doc.getElementsByTagName('parsererror').length > 0) {
      return null;
    }

    const features: any[] = [];
    let memberNodes = Array.from(doc.getElementsByTagNameNS('*', 'featureMember'));
    if (memberNodes.length === 0) {
      memberNodes = Array.from(doc.getElementsByTagNameNS('*', 'member'));
    }

    const rawFeatures = memberNodes.length > 0
      ? memberNodes.map(m => m.firstElementChild).filter(Boolean) as Element[]
      : Array.from(doc.documentElement.children).filter(el => !el.localName.toLowerCase().includes('boundedby'));

    let detectedSrs: string | undefined = doc.documentElement.getAttribute('srsName') || undefined;

    for (const featElem of rawFeatures) {
      if (!featElem) continue;

      let geometry: any = null;
      const properties: Record<string, any> = {};

      for (let i = 0; i < featElem.children.length; i++) {
        const child = featElem.children[i];
        const tagName = child.localName || child.nodeName.split(':').pop() || '';

        const pointNode = child.getElementsByTagNameNS('*', 'Point')[0] || (child.localName === 'Point' ? child : null);
        const lineNode = child.getElementsByTagNameNS('*', 'LineString')[0] || (child.localName === 'LineString' ? child : null);
        const polyNode = child.getElementsByTagNameNS('*', 'Polygon')[0] || (child.localName === 'Polygon' ? child : null);
        const multiPolyNode = child.getElementsByTagNameNS('*', 'MultiPolygon')[0] || child.getElementsByTagNameNS('*', 'MultiSurface')[0] || (child.localName === 'MultiPolygon' || child.localName === 'MultiSurface' ? child : null);
        const multiPointNode = child.getElementsByTagNameNS('*', 'MultiPoint')[0] || (child.localName === 'MultiPoint' ? child : null);

        if (!detectedSrs) {
          const srsAttr = child.getAttribute('srsName') ||
            pointNode?.getAttribute('srsName') ||
            lineNode?.getAttribute('srsName') ||
            polyNode?.getAttribute('srsName') ||
            multiPolyNode?.getAttribute('srsName');
          if (srsAttr) detectedSrs = srsAttr;
        }

        if (pointNode) {
          const coordText = pointNode.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ||
                            pointNode.getElementsByTagNameNS('*', 'pos')[0]?.textContent || '';
          const parts = coordText.trim().split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
          if (parts.length >= 2) {
            geometry = { type: 'Point', coordinates: [parts[0], parts[1]] };
          }
        } else if (lineNode) {
          const coordText = lineNode.getElementsByTagNameNS('*', 'posList')[0]?.textContent ||
                            lineNode.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent || '';
          const nums = coordText.trim().split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
          const coords: [number, number][] = [];
          for (let j = 0; j < nums.length - 1; j += 2) {
            coords.push([nums[j], nums[j + 1]]);
          }
          if (coords.length > 0) {
            geometry = { type: 'LineString', coordinates: coords };
          }
        } else if (polyNode) {
          const posListNodes = Array.from(polyNode.getElementsByTagNameNS('*', 'posList'));
          if (posListNodes.length === 0) {
            const coordNodes = Array.from(polyNode.getElementsByTagNameNS('*', 'coordinates'));
            if (coordNodes.length > 0) posListNodes.push(...coordNodes);
          }

          const rings: [number, number][][] = [];
          for (const pNode of posListNodes) {
            if (pNode.textContent) {
              const nums = pNode.textContent.trim().split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
              const ring: [number, number][] = [];
              for (let j = 0; j < nums.length - 1; j += 2) {
                ring.push([nums[j], nums[j + 1]]);
              }
              if (ring.length > 0) rings.push(ring);
            }
          }

          if (rings.length > 0) {
            geometry = { type: 'Polygon', coordinates: rings };
          }
        } else if (multiPolyNode) {
          const subPolyNodes = Array.from(multiPolyNode.getElementsByTagNameNS('*', 'Polygon'));
          const polys: [number, number][][][] = [];
          for (const spNode of subPolyNodes) {
            const pListNodes = Array.from(spNode.getElementsByTagNameNS('*', 'posList'));
            const rings: [number, number][][] = [];
            for (const plNode of pListNodes) {
              if (plNode.textContent) {
                const nums = plNode.textContent.trim().split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
                const ring: [number, number][] = [];
                for (let j = 0; j < nums.length - 1; j += 2) {
                  ring.push([nums[j], nums[j + 1]]);
                }
                if (ring.length > 0) rings.push(ring);
              }
            }
            if (rings.length > 0) polys.push(rings);
          }
          if (polys.length > 0) {
            geometry = { type: 'MultiPolygon', coordinates: polys };
          }
        } else if (multiPointNode) {
          const pointNodes = Array.from(multiPointNode.getElementsByTagNameNS('*', 'Point'));
          const coords: [number, number][] = [];
          for (const pNode of pointNodes) {
            const coordText = pNode.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ||
                              pNode.getElementsByTagNameNS('*', 'pos')[0]?.textContent || '';
            const parts = coordText.trim().split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
            if (parts.length >= 2) coords.push([parts[0], parts[1]]);
          }
          if (coords.length > 0) {
            geometry = { type: 'MultiPoint', coordinates: coords };
          }
        } else {
          const textVal = child.textContent?.trim();
          if (textVal !== undefined && textVal !== '') {
            const numVal = Number(textVal);
            properties[tagName] = !isNaN(numVal) && textVal !== '' ? numVal : textVal;
          }
        }
      }

      if (geometry || Object.keys(properties).length > 0) {
        features.push({
          type: 'Feature',
          geometry,
          properties
        });
      }
    }

    if (features.length > 0) {
      const resultFC: any = {
        type: 'FeatureCollection',
        features
      };
      if (detectedSrs) {
        resultFC.crs = {
          type: 'name',
          properties: {
            name: detectedSrs
          }
        };
      }
      return resultFC;
    }
  } catch (err) {
    console.warn('Could not parse GML as GeoJSON:', err);
  }
  return null;
}

/**
 * Parses XML statistics response (e.g. from ras:RasterZonalStatistics or ras:ZonalStatistics)
 * and attaches properties to zone geometry to create a valid GeoJSON FeatureCollection.
 */
export function parseXmlStatsToGeoJSON(xmlText: string, inputGeom?: any, inputZones?: any): any {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const zoneEls = Array.from(doc.getElementsByTagNameNS('*', 'zone')).concat(
      Array.from(doc.getElementsByTagNameNS('*', 'statistic')),
      Array.from(doc.getElementsByTagNameNS('*', 'statistics')),
      Array.from(doc.getElementsByTagNameNS('*', 'Feature')),
      Array.from(doc.getElementsByTagNameNS('*', 'Row'))
    );

    if (zoneEls.length > 0) {
      const features = zoneEls.map((el, idx) => {
        const props: Record<string, any> = {};
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          const num = Number(attr.value);
          props[attr.name] = !isNaN(num) && attr.value !== '' ? num : attr.value;
        }
        for (let i = 0; i < el.children.length; i++) {
          const child = el.children[i];
          const text = child.textContent?.trim() || '';
          const num = Number(text);
          props[child.localName] = !isNaN(num) && text !== '' ? num : text;
        }
        return {
          type: 'Feature',
          id: `zone_${props.id ?? props.zone ?? props.zone_id ?? (idx + 1)}`,
          geometry: (inputZones?.type === 'FeatureCollection' ? inputZones.features?.[idx]?.geometry : inputGeom) || inputGeom,
          properties: props
        };
      });

      if (features.length > 0) {
        return {
          type: 'FeatureCollection',
          features
        };
      }
    }
  } catch (err) {
    console.warn('Could not parse XML stats as GeoJSON:', err);
  }
  return null;
}

