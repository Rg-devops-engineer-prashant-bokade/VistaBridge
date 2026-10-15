// ============================================================================
// Query Builder Type Definitions (types.ts)
//
// TypeScript data interfaces for map layer filtering:
// - AttributeFilter: column name, comparison operator, and target value
// - SpatialFilter: spatial relationship (intersects, within), geometry, buffer distance
// - LayerFilter: layer-to-layer spatial relationships
// - QueryBuilderPayload: complete compiled filter payload
// ============================================================================

export type FilterCondition = 'AND' | 'OR' | 'NONE';

export interface AttributeFilter {
  field: string;
  operator: string;
  value?: unknown;
}

export interface SpatialFilter {
  operation: string;
  geometry: object;
  distance?: number;
}

export interface LayerFilter {
  dataset_id: string;
  operation: string;
}

export interface QueryBuilderPayload {
  filter_condition?: FilterCondition;
  attribute_filters?: AttributeFilter[];
  spatial_filter?: SpatialFilter;
  layer_filter?: LayerFilter;
}

// Each slot holds the payload fragment for that filter type.
// buffer  → spatial_filter built from turf-buffered geometry
// spatial → spatial_filter from drawn/pasted geometry or layer_filter
// attribute → attribute_filters + filter_condition
// All active slots are ANDed together by the backend.
export interface LayerActiveFilters {
  attribute?: QueryBuilderPayload;
  buffer?: QueryBuilderPayload;
  spatial?: QueryBuilderPayload;
  layer?: QueryBuilderPayload;
}

// Bookmark stores the full combination of whatever slots were active at save time.
export interface BookmarkContent {
  dataset_id: string;
  dataset_name: string;
  // slots replaces the old query_tab + payload — can hold any combination
  slots: Partial<LayerActiveFilters>;
  // drawn geometry stored separately so it can be re-rendered on map at execute time
  drawn_geometry?: unknown;
  complementary?: boolean;
  is_favourite: boolean;
}

export interface Bookmark {
  id: string;
  name: string;
  description?: string;
  content: BookmarkContent;
  created_at: string;
  updated_at: string;
}

export interface LayerState {
  id: string;
  name: string;
  // RASTER_TERRAIN is used in 3D page — include it here so the type is compatible
  type: 'VECTOR' | 'RASTER' | 'POINTCLOUD' | 'RASTER_TERRAIN' | 'GROUP';
  visible: boolean;
  opacity: number;
  labelsEnabled: boolean;
}
