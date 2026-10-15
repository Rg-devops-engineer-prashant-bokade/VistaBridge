// ============================================================================
// Map Extent Filtering & Export Utilities (mapExtentExport.ts)
//
// In GIS, users often want to export "Only visible features on map":
// 1. Converts current OpenLayers viewport bounds (EPSG:3857) to a WGS84 Turf.js polygon
// 2. Checks spatial intersection (`booleanIntersects`) between the screen viewport
//    and each feature in the layer
// 3. Filters feature lists so the user only downloads features currently in view
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import { booleanIntersects } from '@turf/boolean-intersects';
import { polygon as turfPolygon } from '@turf/helpers';
import { transformExtent } from 'ol/proj';
import { GeoJSON } from 'ol/format';

export interface MapExtent {
  extent: number[]; // [minX, minY, maxX, maxY]
  crs: string; // e.g., 'EPSG:3857'
}

// Converts OpenLayers map viewport extent into a Turf.js WGS84 polygon
export const extentToTurfPolygon = (extent: number[], sourceCRS: string = 'EPSG:3857') => {
  // Transform to WGS84 (GeoJSON standard) if not already CRS:84 or EPSG:4326
  const isLonLatCRS = sourceCRS === 'CRS:84' || sourceCRS === 'CRS84' || sourceCRS === 'EPSG:4326' || sourceCRS === 'OGC:CRS84';
  let [minX, minY, maxX, maxY] = isLonLatCRS
    ? extent
    : transformExtent(extent, sourceCRS, 'EPSG:4326');

  // Strict WGS84 / CRS:84 bounds clamping (-180 <= lon <= 180, -90 <= lat <= 90)
  minX = Math.max(-180, Math.min(180, minX));
  maxX = Math.max(-180, Math.min(180, maxX));
  minY = Math.max(-90, Math.min(90, minY));
  maxY = Math.max(-90, Math.min(90, maxY));

  if (minX >= maxX) { minX = -180; maxX = 180; }
  if (minY >= maxY) { minY = -90; maxY = 90; }

  return turfPolygon([[
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY]
  ]]);
};

/**
 * Convert feature geometry to Turf.js format
 */
export const featureGeometryToTurf = (geometry: any): any | null => {
  if (!geometry) {
    console.log('No geometry provided');
    return null;
  }

  // If geometry is already GeoJSON format (from API with include_geometry=true)
  if (geometry.type && geometry.coordinates) {
    console.log('Geometry is already GeoJSON:', geometry.type);
    return geometry;
  }

  // If geometry is WKT string, parse it
  if (typeof geometry === 'string') {
    console.log('Parsing WKT geometry');
    try {
      const format = new GeoJSON();
      const olFeature = format.readFeature(geometry, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:4326'
      });
      const geom = Array.isArray(olFeature) ? olFeature[0]?.getGeometry() : olFeature.getGeometry();
      return geom ? format.writeGeometryObject(geom) : null;
    } catch (error) {
      console.warn('Failed to parse WKT geometry:', error);
      return null;
    }
  }

  console.warn('Unknown geometry format:', typeof geometry);
  return null;
};

/**
 * Check if a feature geometry intersects with bbox
 */
export const geometryIntersectsBbox = (geometry: any, bboxPolygon: any): boolean => {
  try {
    const turfGeom = featureGeometryToTurf(geometry);
    if (!turfGeom) {
      console.log('Failed to convert geometry to Turf format');
      return false;
    }

    const intersects = booleanIntersects(turfGeom, bboxPolygon);
    return intersects;
  } catch (error) {
    console.warn('Failed to check geometry intersection:', error);
    return false;
  }
};

/**
 * Filter features by spatial intersection with map extent
 */
export const filterFeaturesByExtent = (
  features: any[],
  extent: number[],
  crs: string = 'EPSG:3857'
): any[] => {
  const bboxPolygon = extentToTurfPolygon(extent, crs);
  console.log('BBox polygon:', bboxPolygon);

  let matchCount = 0;
  const filtered = features.filter((feature, idx) => {
    if (!feature.geometry) {
      if (idx === 0) console.log('Feature has no geometry:', feature);
      return false;
    }

    const intersects = geometryIntersectsBbox(feature.geometry, bboxPolygon);
    if (intersects) matchCount++;
    if (idx === 0) console.log('First feature intersects:', intersects);

    return intersects;
  });

  console.log(`Matched ${matchCount} of ${features.length} features`);
  return filtered;
};
