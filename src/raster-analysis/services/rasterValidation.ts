// ============================================================================
// Raster Analysis Validation Rules (rasterValidation.ts)
//
// Prevents invalid WPS jobs from failing on GeoServer:
// - Validates that drawn cropping boundaries actually intersect the raster
// - Validates contour intervals (positive numbers > 0)
// - Validates reclassification ranges (no inverted min > max ranges)
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { RasterMetadata } from '../types/rasterAnalysis';
import { getGeoJSONBBox } from './rasterGeometry';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a geometry (already transformed to the raster's native CRS)
 * intersects the raster's native bounding box extent.
 */
export function validateCropIntersection(
  transformedGeometry: any,
  metadata: RasterMetadata
): ValidationResult {
  if (!transformedGeometry) {
    return {
      valid: false,
      error: 'Please provide or draw a crop geometry on the map.'
    };
  }

  const geomBBox = getGeoJSONBBox(transformedGeometry);
  if (!geomBBox) {
    return {
      valid: false,
      error: 'Invalid crop geometry coordinates.'
    };
  }

  const rBBox = metadata?.bbox;
  if (!rBBox || rBBox.minX === undefined || rBBox.maxX === undefined || rBBox.minY === undefined || rBBox.maxY === undefined) {
    return { valid: true };
  }

  // If raster is unbounded or default world extent, let it pass
  if ((rBBox.minX === -180 && rBBox.maxX === 180) || (rBBox.minX <= -20000000 && rBBox.maxX >= 20000000)) {
    return { valid: true };
  }

  // Normalize bounds so min is always <= max
  const gMinX = Math.min(geomBBox.minX, geomBBox.maxX);
  const gMaxX = Math.max(geomBBox.minX, geomBBox.maxX);
  const gMinY = Math.min(geomBBox.minY, geomBBox.maxY);
  const gMaxY = Math.max(geomBBox.minY, geomBBox.maxY);

  let rMinX = Math.min(rBBox.minX, rBBox.maxX);
  let rMaxX = Math.max(rBBox.minX, rBBox.maxX);
  let rMinY = Math.min(rBBox.minY, rBBox.maxY);
  let rMaxY = Math.max(rBBox.minY, rBBox.maxY);

  // Check if raster bbox has swapped Lat/Lon (e.g. minX is Latitude and minY is Longitude)
  if (Math.abs(rMinX) <= 90 && Math.abs(rMaxX) <= 90 && Math.abs(rMinY) > 90) {
    const tempMin = rMinX;
    const tempMax = rMaxX;
    rMinX = rMinY;
    rMaxX = rMaxY;
    rMinY = tempMin;
    rMaxY = tempMax;
  }

  // Check if coordinates are in different unit systems (e.g. degrees vs meters)
  const isGeomMeters = Math.abs(gMinX) > 180 || Math.abs(gMaxX) > 180 || Math.abs(gMinY) > 90 || Math.abs(gMaxY) > 90;
  const isRasterMeters = Math.abs(rMinX) > 180 || Math.abs(rMaxX) > 180 || Math.abs(rMinY) > 90 || Math.abs(rMaxY) > 90;

  // If one is in projected meters and the other is in geographic degrees, let GeoServer handle intersection
  if (isGeomMeters !== isRasterMeters) {
    return { valid: true };
  }

  // Check 2D bounding box intersection with a 5% buffer for drawing tolerances
  const dx = Math.max((rMaxX - rMinX) * 0.05, 0.0001);
  const dy = Math.max((rMaxY - rMinY) * 0.05, 0.0001);

  const noOverlap =
    gMaxX < (rMinX - dx) ||
    gMinX > (rMaxX + dx) ||
    gMaxY < (rMinY - dy) ||
    gMinY > (rMaxY + dy);

  if (noOverlap) {
    // For in-memory layers, don't block the user with false negatives; GeoServer handles exact geometric clipping
    if (metadata?.rawBuffer || metadata?.imageBlob || (metadata?.layerName && metadata.layerName.startsWith('raster_res_'))) {
      console.warn(`[validateCropIntersection] Geometry bbox [${gMinX}, ${gMinY}, ${gMaxX}, ${gMaxY}] outside [${rMinX}, ${rMinY}, ${rMaxX}, ${rMaxY}], delegating to GeoServer.`);
      return { valid: true };
    }

    return {
      valid: false,
      error: `The selected crop area does not intersect the raster extent. Please draw the crop area inside the selected raster layer "${metadata.title || metadata.layerName}".`
    };
  }

  return { valid: true };
}

/**
 * Validates that a geometry is an allowed type for the given process.
 * E.g. CropCoverage requires Polygon or MultiPolygon.
 */
export function validateGeometryType(
  geom: any,
  allowedTypes: string[] = ['Polygon', 'MultiPolygon']
): ValidationResult {
  if (!geom) {
    return { valid: false, error: 'Geometry is required.' };
  }

  let geomType = geom.type;
  if (geomType === 'Feature') {
    geomType = geom.geometry?.type;
  } else if (geomType === 'FeatureCollection') {
    geomType = geom.features?.[0]?.geometry?.type;
  }

  if (!geomType || !allowedTypes.includes(geomType)) {
    return {
      valid: false,
      error: `Geometry must be a ${allowedTypes.join(' or ')}. Received "${geomType || 'Unknown'}".`
    };
  }

  return { valid: true };
}

/**
 * Converts raw GeoServer/GeoTools exceptions into clear, actionable frontend messages.
 */
export function formatRasterErrorMessage(serverError: string): string {
  if (!serverError) return 'An unexpected error occurred during raster analysis.';

  const lower = serverError.toLowerCase();

  if (lower.includes('emptyintersectionexception') || lower.includes('does not intersect in model space')) {
    return 'GeoServer could not process the raster because the selected geometry does not intersect the raster extent. Please draw the geometry inside the selected raster.';
  }

  if (lower.includes('outofmemory') || lower.includes('heap space') || lower.includes('raster too large')) {
    return 'GeoServer ran out of memory while processing the raster. Please select a smaller area or increase the scale/cell size.';
  }

  if (lower.includes('unsupported crs') || lower.includes('nosuchauthoritycodeexception')) {
    return 'GeoServer could not recognize or project the raster Coordinate Reference System.';
  }

  if (lower.includes('coveragenotdefined') || lower.includes('coverage not found')) {
    return 'The requested raster coverage could not be found or loaded in GeoServer.';
  }

  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The raster analysis operation timed out on GeoServer. Please try a smaller area of interest.';
  }

  if (lower.includes('unsupportedoperationexception')) {
    return 'This raster process is not supported for the selected raster format or data type.';
  }

  if (lower.includes('same bands') || lower.includes('sourc and destination') || lower.includes('source and destination')) {
    return 'Band mismatch error: The selected style (e.g. single-band ColorMap) does not match the raster band structure (e.g. multi-band RGB raster). Please ensure your style targets a single band or matches the raster band count.';
  }

  if (lower.includes('out of bounds for length') || lower.includes('arrayindexoutofboundsexception')) {
    return 'Raster Boundary Overflow: The drawn geometry reaches or exceeds the outer boundary of the raster image grid. Please draw the rectangle or polygon slightly inside the visible raster area.';
  }

  // Strip repeating Java exception prefixes and XML tags
  let cleanText = serverError
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:org\.[a-zA-Z0-9_.]+(?:Exception|Error):\s*)+/gi, '')
    .replace(/(?:java\.[a-zA-Z0-9_.]+(?:Exception|Error):\s*)+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText || cleanText.toLowerCase().startsWith('process failed')) {
    const afterColon = serverError.split(':').pop()?.trim();
    if (afterColon && afterColon.length > 5) {
      cleanText = afterColon;
    }
  }

  if (lower.includes('coverageprocessingexception') && (!cleanText || cleanText.length < 10)) {
    return 'GeoServer encountered a coverage processing error. Please verify the layer extent and that the process parameters match the layer data type.';
  }

  return cleanText.length > 250 ? `${cleanText.slice(0, 250)}...` : (cleanText || 'An error occurred during raster execution.');
}
