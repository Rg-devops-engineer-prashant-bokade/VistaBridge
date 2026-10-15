// ============================================================================
// Query Builder Operators & Constants (constants.ts)
//
// Defines operator menus and data-type mappings:
// - Attribute operators: equals, contains, starts_with, between, is_null
// - OPERATORS_BY_TYPE: Contextual operator filtering per column data type
//   (e.g., number types allow < and >, strings allow text pattern matches)
// - Spatial operators: intersects, within, contains, touches, disjoint
// ============================================================================

export const ATTRIBUTE_OPERATORS = [
  { value: 'equals',             label: 'Equals',           needsValue: true,  valueType: 'single' as const },
  { value: 'not_equals',         label: 'Not Equals',       needsValue: true,  valueType: 'single' as const },
  { value: 'greater_than',       label: '>',                needsValue: true,  valueType: 'single' as const },
  { value: 'greater_than_equal', label: '>=',               needsValue: true,  valueType: 'single' as const },
  { value: 'less_than',          label: '<',                needsValue: true,  valueType: 'single' as const },
  { value: 'less_than_equal',    label: '<=',               needsValue: true,  valueType: 'single' as const },
  { value: 'contains',           label: 'Contains',         needsValue: true,  valueType: 'single' as const },
  { value: 'starts_with',        label: 'Starts With',      needsValue: true,  valueType: 'single' as const },
  { value: 'ends_with',          label: 'Ends With',        needsValue: true,  valueType: 'single' as const },
  { value: 'in',                 label: 'In (list)',        needsValue: true,  valueType: 'multi'  as const },
  { value: 'not_in',             label: 'Not In (list)',    needsValue: true,  valueType: 'multi'  as const },
  { value: 'between',            label: 'Between',          needsValue: true,  valueType: 'range'  as const },
  { value: 'is_null',            label: 'Is Null',          needsValue: false, valueType: 'none'   as const },
  { value: 'is_not_null',        label: 'Is Not Null',      needsValue: false, valueType: 'none'   as const },
];

// Operators valid per field type — keeps the operator dropdown contextual
export const OPERATORS_BY_TYPE: Record<string, string[]> = {
  string:  ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_null', 'is_not_null'],
  integer: ['equals', 'not_equals', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal', 'between', 'in', 'not_in', 'is_null', 'is_not_null'],
  float:   ['equals', 'not_equals', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal', 'between', 'is_null', 'is_not_null'],
  boolean: ['equals', 'not_equals', 'is_null', 'is_not_null'],
  date:    ['equals', 'not_equals', 'greater_than', 'greater_than_equal', 'less_than', 'less_than_equal', 'between', 'is_null', 'is_not_null'],
};

// Field types that should be hidden from the attribute filter field picker
export const SKIP_FIELD_TYPES = new Set([
  // PostGIS / database geometry types
  'json', 'jsonb', 'geometry', 'geography',
  // GeoServer JSON DescribeFeatureType localType values for geometries
  'point', 'linestring', 'polygon',
  'multipoint', 'multilinestring', 'multipolygon',
  'geometrycollection', 'curve', 'surface',
  'geometrypropertytype',
]);

// Default operator per field type — used when field changes to avoid invalid state
export const DEFAULT_OPERATOR_BY_TYPE: Record<string, string> = {
  string:  'contains',
  integer: 'equals',
  float:   'equals',
  boolean: 'equals',
  date:    'equals',
};

export const SPATIAL_OPERATORS = [
  { value: 'intersects',      label: 'Intersects',        supportsLayer: true,  needsDistance: false },
  { value: 'contains',        label: 'Contains',          supportsLayer: true,  needsDistance: false },
  { value: 'within',          label: 'Within',            supportsLayer: true,  needsDistance: false },
  { value: 'within_distance', label: 'Within Distance',   supportsLayer: false, needsDistance: true  },
  { value: 'overlaps',        label: 'Overlaps',          supportsLayer: true,  needsDistance: false },
  { value: 'touches',         label: 'Touches',           supportsLayer: true,  needsDistance: false },
  { value: 'crosses',         label: 'Crosses',           supportsLayer: true,  needsDistance: false },
  { value: 'disjoint',        label: 'Disjoint',          supportsLayer: true,  needsDistance: false },
  { value: 'equals',          label: 'Equals',            supportsLayer: true,  needsDistance: false },
];

export const BUFFER_DRAW_TYPES = [
  { value: 'Point',      label: 'Point',     icon: '●', olType: 'Point'      },
  { value: 'LineString', label: 'Line',      icon: '╱', olType: 'LineString' },
  { value: 'Polygon',    label: 'Polygon',   icon: '⬠', olType: 'Polygon'   },
  { value: 'Box',        label: 'Box',       icon: '▭', olType: 'Box'        },
  { value: 'Circle',     label: 'Circle',    icon: '○', olType: 'Circle'     },
];
