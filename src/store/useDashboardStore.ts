// ============================================================================
// Dashboard State Store & Cross-Widget Event Bus
//
// In interactive GIS dashboards, multiple widgets are displayed side-by-side
// (e.g. an OpenLayers map widget, bar charts, pie charts, and KPI metric counters).
//
// When the user interacts with ONE widget, the OTHER widgets should respond:
// - Panning/zooming the map updates the bounding box (`bbox`), so charts only
//   summarize features visible inside that map extent.
// - Clicking a slice on a pie chart selects those features (`chart_filter`),
//   highlighting them on the map.
// - Clicking a building on the map (`feature_click`) filters the data table.
//
// This Zustand store manages that shared state and acts as a publisher/subscriber
// event bus so all widgets stay in sync seamlessly.
// ============================================================================

import { create } from 'zustand';

// ── Types ─────────────────────────────────────────────────────────────────────

// Events that can be broadcast across dashboard widgets
export type FilterEvent =
  | { type: 'bbox'; bbox: [number, number, number, number] } // Map moved/zoomed to a new extent
  | { type: 'feature_click'; featureIds: string[]; datasetId: string } // User clicked a feature on the map
  | { type: 'chart_filter'; featureIds: string[]; datasetId: string } // User clicked a bar/slice in a chart
  | { type: 'reset' } // User clicked "Reset Filters"
  | { type: 'zoom_map_widget'; widgetId: string };

type Listener = (event: FilterEvent) => void;

interface DashboardState {
  // Global spatial filter state (current visible bounding box [minX, minY, maxX, maxY])
  bbox: [number, number, number, number] | null;
  layerBboxes: Record<string, [number, number, number, number] | null>;
  selectedFeatureIds: string[];
  selectedDatasetId: string | null;
  extraFilters: Record<string, unknown>;
  chartFilterIds: string[];
  chartFilterDatasetId: string | null;
  activeMapDatasetIds: string[];
  mapLayersRegistry: Record<string, string[]>;
  isPdfLock: boolean;
  mapsSettled: boolean;

  // Event bus: keeps track of widget callback functions
  _listeners: Map<string, Set<Listener>>;

  // State update actions
  setBbox: (bbox: [number, number, number, number]) => void;
  setLayerBbox: (layerId: string, bbox: [number, number, number, number] | null) => void;
  setSelectedFeatures: (featureIds: string[], datasetId: string) => void;
  setChartFilter: (featureIds: string[], datasetId: string | null) => void;
  setExtraFilter: (key: string, value: unknown) => void;
  setActiveMapDatasetIds: (widgetId: string, ids: string[]) => void;
  setIsPdfLock: (locked: boolean) => void;
  setMapsSettled: (settled: boolean) => void;
  updateMapBboxes: (bbox: [number, number, number, number], layerBboxesUpdate: Record<string, [number, number, number, number] | null>) => void;
  resetFilters: () => void;

  // Event bus methods (subscribe to listen, publish to broadcast)
  subscribe: (widgetId: string, listener: Listener) => () => void;
  publish: (event: FilterEvent) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useDashboardStore = create<DashboardState>((set, get) => ({
  bbox: null,
  layerBboxes: {},
  selectedFeatureIds: [],
  selectedDatasetId: null,
  extraFilters: {},
  chartFilterIds: [],
  chartFilterDatasetId: null,
  activeMapDatasetIds: [],
  mapLayersRegistry: {},
  isPdfLock: false,
  mapsSettled: false,
  _listeners: new Map(),

  setMapsSettled: (mapsSettled) => {
    set({ mapsSettled });
  },

  setBbox: (bbox) => {
    set({ bbox });
    get().publish({ type: 'bbox', bbox });
  },

  setLayerBbox: (layerId, bbox) => {
    set((s) => ({
      layerBboxes: {
        ...s.layerBboxes,
        [layerId]: bbox,
      },
    }));
  },

  updateMapBboxes: (bbox, layerBboxesUpdate) => {
    set((s) => ({
      bbox,
      layerBboxes: {
        ...s.layerBboxes,
        ...layerBboxesUpdate,
      },
    }));
    get().publish({ type: 'bbox', bbox });
  },

  setSelectedFeatures: (featureIds, datasetId) => {
    set({ selectedFeatureIds: featureIds, selectedDatasetId: datasetId });
    get().publish({ type: 'feature_click', featureIds, datasetId });
  },

  setChartFilter: (featureIds, datasetId) => {
    set({ chartFilterIds: featureIds, chartFilterDatasetId: datasetId });
    get().publish({ type: 'chart_filter', featureIds, datasetId: datasetId ?? '' });
  },

  setExtraFilter: (key, value) => {
    set((s) => ({ extraFilters: { ...s.extraFilters, [key]: value } }));
  },

  setActiveMapDatasetIds: (widgetId, ids) => {
    set((s) => {
      const nextRegistry = {
        ...s.mapLayersRegistry,
        [widgetId]: ids,
      };
      const allIds = Array.from(new Set(Object.values(nextRegistry).flat()));
      return {
        mapLayersRegistry: nextRegistry,
        activeMapDatasetIds: allIds,
      };
    });
  },

  setIsPdfLock: (isPdfLock) => {
    set({ isPdfLock });
  },

  resetFilters: () => {
    set({ bbox: null, layerBboxes: {}, selectedFeatureIds: [], selectedDatasetId: null, extraFilters: {}, chartFilterIds: [], chartFilterDatasetId: null, activeMapDatasetIds: [], mapLayersRegistry: {}, isPdfLock: false, mapsSettled: false });
    get().publish({ type: 'reset' });
  },

  subscribe: (widgetId, listener) => {
    const { _listeners } = get();
    if (!_listeners.has(widgetId)) _listeners.set(widgetId, new Set());
    _listeners.get(widgetId)!.add(listener);
    // Return unsubscribe fn
    return () => {
      _listeners.get(widgetId)?.delete(listener);
    };
  },

  publish: (event) => {
    get()._listeners.forEach((listeners) => {
      listeners.forEach((fn) => fn(event));
    });
  },
}));
