// ============================================================================
// Raster CRS (Coordinate Reference System) Helpers (rasterCRS.ts)
//
// In GIS, raster layers (imagery/grids) can come in hundreds of different coordinate
// projections (e.g. UTM zones, Web Mercator, WGS84).
//
// This file handles projection conversions:
// 1. Normalizes projection strings into canonical `EPSG:XXXX` format
// 2. Registers unknown projections into OpenLayers via `proj4` and `epsg.io`
// 3. Transforms bounding box coordinates between different coordinate systems
// ============================================================================

import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getOlProjection, transform, transformExtent } from 'ol/proj';

// In-memory cache for fetched proj4 definitions
const crsDefCache = new Map<string, boolean>();

/**
 * Normalizes any CRS string (e.g. "urn:ogc:def:crs:EPSG::32640", "EPSG:32640", "http://...#32640")
 * into canonical "EPSG:XXXX" format.
 */
export function normalizeCRS(crs: string): string {
  if (!crs) return 'EPSG:4326';
  const trimmed = crs.trim();
  if (trimmed.toUpperCase() === 'CRS:84' || trimmed.toUpperCase() === 'URN:OGC:DEF:CRS:OGC:1.3:CRS84') {
    return 'EPSG:4326';
  }
  const match = trimmed.match(/(?:EPSG[:\s#]+|::)(\d+)/i);
  if (match) {
    return `EPSG:${match[1]}`;
  }
  return trimmed;
}

/**
 * Ensures a projection is registered in OpenLayers.
 * If OpenLayers does not already recognize it, queries proj4 or dynamically fetches
 * the proj4 definition from epsg.io.
 */
export async function ensureProjection(crs: string): Promise<string> {
  const canonical = normalizeCRS(crs);

  // Check if OpenLayers natively recognizes it
  const olProj = getOlProjection(canonical);
  if (olProj) {
    return canonical;
  }

  // Check if proj4 already has a definition
  if ((proj4.defs as unknown as Record<string, unknown>)[canonical]) {
    register(proj4);
    if (getOlProjection(canonical)) {
      return canonical;
    }
  }

  // Extract numeric EPSG code
  const codeMatch = canonical.match(/EPSG:(\d+)/i);
  if (!codeMatch) {
    throw new Error(`The selected raster uses CRS ${canonical}, which is not currently supported for client-side transformation.`);
  }
  const epsgCode = parseInt(codeMatch[1], 10);

  // Instant built-in definitions for UTM North (32601-32660) and UTM South (32701-32760)
  if (epsgCode >= 32601 && epsgCode <= 32660) {
    const zone = epsgCode - 32600;
    proj4.defs(canonical, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`);
    register(proj4);
    return canonical;
  }
  if (epsgCode >= 32701 && epsgCode <= 32760) {
    const zone = epsgCode - 32700;
    proj4.defs(canonical, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`);
    register(proj4);
    return canonical;
  }
  // UTM NAD83 (26901-26923)
  if (epsgCode >= 26901 && epsgCode <= 26923) {
    const zone = epsgCode - 26900;
    proj4.defs(canonical, `+proj=utm +zone=${zone} +datum=NAD83 +units=m +no_defs`);
    register(proj4);
    return canonical;
  }
  // UTM NAD27 (26701-26723)
  if (epsgCode >= 26701 && epsgCode <= 26723) {
    const zone = epsgCode - 26700;
    proj4.defs(canonical, `+proj=utm +zone=${zone} +datum=NAD27 +units=m +no_defs`);
    register(proj4);
    return canonical;
  }

  // Check if we've already tried and failed
  if (crsDefCache.get(canonical) === false) {
    throw new Error(`The selected raster uses CRS ${canonical}, which is not currently supported for client-side transformation.`);
  }

  try {
    const res = await fetch(`https://epsg.io/${epsgCode}.proj4`);
    if (!res.ok) {
      crsDefCache.set(canonical, false);
      throw new Error(`The selected raster uses CRS ${canonical}, which is not currently supported for client-side transformation.`);
    }
    let def = (await res.text()).trim();
    if (!def || !def.startsWith('+proj')) {
      crsDefCache.set(canonical, false);
      throw new Error(`The selected raster uses CRS ${canonical}, which is not currently supported for client-side transformation.`);
    }

    // In browser proj4js, external grid files (.tif / .gsb) are not bundled.
    // Replace non-null nadgrids with @null or +datum to prevent [NaN, NaN] coordinate transformations.
    if (def.includes('+nadgrids=') && !def.includes('+nadgrids=@null')) {
      if (def.includes('clrk66') || canonical === 'EPSG:26713') {
        def = def.replace(/\+nadgrids=\S+/, '+datum=NAD27');
      } else {
        def = def.replace(/\+nadgrids=\S+/, '+nadgrids=@null');
      }
    }

    proj4.defs(canonical, def);
    register(proj4);

    const registered = getOlProjection(canonical);
    if (!registered) {
      crsDefCache.set(canonical, false);
      throw new Error(`The selected raster uses CRS ${canonical}, which is not currently supported for client-side transformation.`);
    }

    crsDefCache.set(canonical, true);
    return canonical;
  } catch (err: unknown) {
    crsDefCache.set(canonical, false);
    if (err instanceof Error && err.message.includes('not currently supported')) {
      throw err;
    }
    throw new Error(`The selected raster uses CRS ${canonical}, which is not currently supported for client-side transformation.`);
  }
}

/**
 * Transforms a single [x, y] coordinate from source CRS to target CRS.
 */
export async function transformCoordinate(
  coord: [number, number],
  sourceCRS: string = 'EPSG:3857',
  targetCRS: string
): Promise<[number, number]> {
  const normSource = normalizeCRS(sourceCRS);
  const normTarget = normalizeCRS(targetCRS);

  if (normSource === normTarget) {
    return [coord[0], coord[1]];
  }

  await ensureProjection(normSource);
  await ensureProjection(normTarget);

  const transformed = transform(coord, normSource, normTarget);
  return [transformed[0], transformed[1]];
}

/**
 * Transforms a bounding box [minX, minY, maxX, maxY] from source CRS to target CRS.
 */
export async function transformBBox(
  bbox: [number, number, number, number],
  sourceCRS: string = 'EPSG:3857',
  targetCRS: string
): Promise<[number, number, number, number]> {
  const normSource = normalizeCRS(sourceCRS);
  const normTarget = normalizeCRS(targetCRS);

  if (normSource === normTarget) {
    return [...bbox];
  }

  await ensureProjection(normSource);
  await ensureProjection(normTarget);

  const transformed = transformExtent(bbox, normSource, normTarget);
  return [transformed[0], transformed[1], transformed[2], transformed[3]];
}
