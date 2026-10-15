// ============================================================================
// GeoServer CQL (Common Query Language) Helper Utilities
//
// In GIS, CQL is like the "WHERE" clause of a SQL query, but specifically
// designed for maps and spatial data. GeoServer accepts CQL filters in WMS and
// WFS requests to display or return only the features that match criteria.
//
// Example: "population > 50000 AND INTERSECTS(geom, POLYGON(...))"
//
// This file helps build those CQL strings by:
// 1. Converting GeoJSON shapes drawn by the user into WKT (Well-Known Text)
// 2. Formatting attribute filters (=, >, <, LIKE, IN, BETWEEN)
// 3. Formatting spatial filters (INTERSECTS, WITHIN, DWITHIN buffer distance)
// 4. Combining multiple filters into one final CQL query string
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LayerActiveFilters } from './types';

// Converts a standard GeoJSON geometry object into WKT (Well-Known Text) string format.
// GeoServer requires WKT (e.g. "POLYGON((lon lat, ...))") when filtering by spatial shapes.
export function geoJsonToWkt(geom: any): string {
  if (!geom || !geom.type) return '';
  const type = geom.type.toUpperCase();

  const formatPolygon = (coords: any): string => {
    return coords
      .map((ring: any) => `(${ring.map((c: any) => `${c[0]} ${c[1]}`).join(', ')})`)
      .join(', ');
  };

  switch (type) {
    case 'POINT':
      return `POINT(${geom.coordinates[0]} ${geom.coordinates[1]})`;
    case 'LINESTRING':
      return `LINESTRING(${geom.coordinates.map((c: any) => `${c[0]} ${c[1]}`).join(', ')})`;
    case 'POLYGON':
      return `POLYGON(${formatPolygon(geom.coordinates)})`;
    case 'MULTIPOINT':
      return `MULTIPOINT(${geom.coordinates.map((c: any) => `(${c[0]} ${c[1]})`).join(', ')})`;
    case 'MULTILINESTRING':
      return `MULTILINESTRING(${geom.coordinates.map((line: any) => `(${line.map((c: any) => `${c[0]} ${c[1]}`).join(', ')})`).join(', ')})`;
    case 'MULTIPOLYGON':
      return `MULTIPOLYGON(${geom.coordinates.map((poly: any) => `(${formatPolygon(poly)})`).join(', ')})`;
    default:
      return '';
  }
}

// Converts user-defined attribute filter rows (e.g. "status = 'Active'") into GeoServer CQL.
export function buildAttributeCql(
  rows: any[],
  schema: Record<string, string>,
  filterCondition: 'AND' | 'OR' | 'NONE'
): string | null {
  if (rows.length === 0 || rows.every(r => !r.field)) return null;
  const parts: string[] = [];

  for (const r of rows.filter(r => r.field)) {
    const field = r.field;
    const op = r.operator;
    const value = r.value;
    const fieldType = schema[field] || 'string';
    const isNumeric = ['integer', 'int', 'float', 'double', 'number', 'long', 'short', 'decimal'].includes(
      fieldType.toLowerCase()
    );

    const formatValue = (v: any) => {
      if (v === undefined || v === null || v === '') return '';
      if (isNumeric) return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    };

    let part = '';
    switch (op) {
      case 'equals':
        part = `"${field}" = ${formatValue(value)}`;
        break;
      case 'not_equals':
        part = `"${field}" <> ${formatValue(value)}`;
        break;
      case 'greater_than':
        part = `"${field}" > ${formatValue(value)}`;
        break;
      case 'greater_than_equal':
        part = `"${field}" >= ${formatValue(value)}`;
        break;
      case 'less_than':
        part = `"${field}" < ${formatValue(value)}`;
        break;
      case 'less_than_equal':
        part = `"${field}" <= ${formatValue(value)}`;
        break;
      case 'contains':
        part = `"${field}" ILIKE '%${String(value).replace(/'/g, "''")}%'`;
        break;
      case 'starts_with':
        part = `"${field}" ILIKE '${String(value).replace(/'/g, "''")}%'`;
        break;
      case 'ends_with':
        part = `"${field}" ILIKE '%${String(value).replace(/'/g, "''")}'`;
        break;
      case 'in': {
        const vals = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        const listStr = vals.map(formatValue).filter(Boolean).join(', ');
        if (listStr) part = `"${field}" IN (${listStr})`;
        break;
      }
      case 'not_in': {
        const vals = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        const listStr = vals.map(formatValue).filter(Boolean).join(', ');
        if (listStr) part = `"${field}" NOT IN (${listStr})`;
        break;
      }
      case 'between': {
        const vals = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
        if (vals.length >= 2 && vals[0] !== '' && vals[1] !== '') {
          part = `"${field}" BETWEEN ${formatValue(vals[0])} AND ${formatValue(vals[1])}`;
        }
        break;
      }
      case 'is_null':
        part = `"${field}" IS NULL`;
        break;
      case 'is_not_null':
        part = `"${field}" IS NOT NULL`;
        break;
    }
    if (part) {
      parts.push(part);
    }
  }

  if (parts.length === 0) return null;
  if (filterCondition === 'NONE') {
    return `NOT (${parts.join(' OR ')})`;
  }
  const condition = filterCondition === 'OR' ? ' OR ' : ' AND ';
  return `(${parts.join(condition)})`;
}

/**
 * Builds standard GeoServer CQL spatial predicate from a query geometry.
 */
export function buildSpatialCql(
  operation: string,
  geometry: any,
  distance?: number,
  geomFieldName: string = 'geom',
  isGeographic: boolean = true
): string | null {
  if (!geometry) return null;
  const rawWkt = geoJsonToWkt(geometry);
  if (!rawWkt) return null;

  // Prefix with SRID=4326; so GeoServer parses the coordinates in longitude-latitude order.
  // This avoids axis order conflicts in WFS 1.1.0/2.0.0.
  const wkt = `SRID=4326;${rawWkt}`;

  const opUpper = operation.toUpperCase();
  if (opUpper === 'WITHIN_DISTANCE' && distance !== undefined) {
    // GeoServer DWITHIN expects degrees if the native coordinate system is geographic (like EPSG:4326).
    // We convert meters to degrees: 1 degree of latitude is approximately 111,320 meters.
    const actualDistance = isGeographic ? (distance / 111320) : distance;
    return `DWITHIN(${geomFieldName}, ${wkt}, ${actualDistance}, meters)`;
  }
  return `${opUpper}(${geomFieldName}, ${wkt})`;
}

/**
 * Builds standard GeoServer CQL layer subquery predicate.
 */
export function buildLayerCql(
  operation: string,
  refDatasetId: string,
  geomFieldName: string = 'geom',
  refGeomFieldName: string = 'geom',
  refFilterCql: string = 'INCLUDE'
): string | null {
  const opUpper = (operation || 'INTERSECTS').toUpperCase();
  return `${opUpper}(${geomFieldName}, collectGeometries(queryCollection('${refDatasetId}', '${refGeomFieldName}', '${refFilterCql}')))`;
}


function isOlMap(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  // Skip Promises and Next.js dynamic API Proxy objects (e.g. searchParams) before property access
  if (typeof obj.then === 'function' || obj instanceof Promise) return false;
  try {
    return typeof obj.getView === 'function' && typeof obj.getTarget === 'function';
  } catch {
    return false;
  }
}

/**
 * Traverses React fiber trees from DOM elements to auto-discover the active OpenLayers map instance.
 */
export function findOpenLayersMap(): any {
  if (typeof window === 'undefined') return null;
  if ((window as any).vismapMapInstance) {
    return (window as any).vismapMapInstance;
  }

  const allElements = document.getElementsByTagName('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i] as any;
    const fiberKey = Object.keys(el).find(
      key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
    );
    if (!fiberKey) continue;

    let fiber = el[fiberKey];
    while (fiber) {
      // Check ref on this fiber
      if (fiber.ref && isOlMap(fiber.ref.current)) {
        return fiber.ref.current;
      }

      // Check stateNode
      if (isOlMap(fiber.stateNode)) {
        return fiber.stateNode;
      }

      // Check memoizedState (hooks link list)
      let state = fiber.memoizedState;
      while (state) {
        if (isOlMap(state.memoizedState)) {
          return state.memoizedState;
        }
        if (state.memoizedState && isOlMap(state.memoizedState.current)) {
          return state.memoizedState.current;
        }
        state = state.next;
      }

      // Check memoizedProps
      if (fiber.memoizedProps) {
        if (isOlMap(fiber.memoizedProps)) {
          return fiber.memoizedProps;
        }
        for (const val of Object.values(fiber.memoizedProps)) {
          if (isOlMap(val)) {
            return val;
          }
        }
      }

      fiber = fiber.return;
    }
  }
  return null;
}

/**
 * Compiles all active query builder slots (filters) to a combined CQL filter string.
 */
export function compileSlotsToCql(
  slots: LayerActiveFilters,
  schema: Record<string, string>,
  geomFieldName: string = 'geom',
  refGeomFieldName: string = 'geom',
  isGeographic: boolean = true,
  refFilterCql: string = 'INCLUDE'
): string {
  const parts: string[] = [];

  if (slots.attribute?.attribute_filters?.length) {
    const rows = slots.attribute.attribute_filters.map((f, i) => ({
      id: String(i),
      field: f.field,
      operator: f.operator,
      value: f.value,
    }));
    const attrCql = buildAttributeCql(rows, schema, slots.attribute.filter_condition ?? 'AND');
    if (attrCql) parts.push(attrCql);
  }

  // buffer and spatial/layer filters can all be combined with attribute filters
  if (slots.buffer?.spatial_filter) {
    const sf = slots.buffer.spatial_filter;
    const cql = buildSpatialCql(sf.operation, sf.geometry, sf.distance, geomFieldName, isGeographic);
    if (cql) parts.push(cql);
  }
  if (slots.spatial?.spatial_filter) {
    const sf = slots.spatial.spatial_filter;
    const cql = buildSpatialCql(sf.operation, sf.geometry, sf.distance, geomFieldName, isGeographic);
    if (cql) parts.push(cql);
  }

  if (slots.layer?.layer_filter) {
    const lf = slots.layer.layer_filter;
    const cql = buildLayerCql(lf.operation, lf.dataset_id, geomFieldName, refGeomFieldName, refFilterCql);
    if (cql) parts.push(cql);
  }

  return parts.join(' AND ');
}
