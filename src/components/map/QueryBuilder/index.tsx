// ============================================================================
// QueryBuilder Component
//
// A visual filter builder that lets users query map features by:
// 1. Attributes (e.g. status = 'Active', area > 500)
// 2. Buffer distances (features within X meters of a point, line, or drawn shape)
// 3. Spatial relationships (features intersecting, within, or touching another layer)
//
// Generates GeoServer CQL queries and filters the layer directly on the map.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Select, Button, notification, Tooltip } from 'antd';
import { RotateCcw, Play, X } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import AttributeSection, { type AttributeSectionHandle } from './AttributeSection';
import BufferSection, { type BufferSectionHandle } from './BufferSection';
import SpatialSection, { type SpatialSectionHandle } from './SpatialSection';
import type { LayerState, LayerActiveFilters } from './types';
import { compileSlotsToCql, findOpenLayersMap } from './cqlHelper';

interface QueryBuilderProps {
  mode: 'attribute' | 'buffer' | 'spatial';
  layers: LayerState[];
  allDatasets: any[];
  onStartDraw: (type: string, owner: 'buffer' | 'spatial') => void;
  bufferDrawnGeometry: any | null;
  spatialDrawnGeometry: any | null;
  onClearBufferDraw: () => void;
  onClearSpatialDraw: () => void;
  onQueryResult: (layerId: string, layerName: string, featureIds: string[], cqlFilter?: string) => void;
  onUpdateMapFilter: (layerId: string, featureIds: string[], cqlFilter?: string) => void;
  onResetLayer: (layerId: string) => void;
  onShowGeometryOnMap?: (geometry: any, owner: 'buffer' | 'spatial') => void;
  activeFilters?: Record<string, LayerActiveFilters>;
  onActiveFiltersChange?: React.Dispatch<React.SetStateAction<Record<string, LayerActiveFilters>>>;
}

// Available query builder tabs
const SECTIONS = [
  { key: 'buffer', label: 'Buffer Query', dotColor: 'bg-violet-500' },
  { key: 'attribute', label: 'Query by Attributes', dotColor: 'bg-violet-500' },
  { key: 'spatial', label: 'Spatial Query', dotColor: 'bg-violet-500' },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

export default function QueryBuilder({
  mode,
  layers,
  allDatasets,
  onStartDraw,
  bufferDrawnGeometry,
  spatialDrawnGeometry,
  onClearBufferDraw,
  onClearSpatialDraw,
  onQueryResult,
  onUpdateMapFilter,
  onResetLayer,
  onShowGeometryOnMap,
  activeFilters: propActiveFilters,
  onActiveFiltersChange,
}: QueryBuilderProps) {
  // Only vector layers have attributes and geometries that can be queried
  const vectorLayers = layers.filter(l => l.type === 'VECTOR');

  // Currently selected layer to query
  const [targetLayerId, setTargetLayerId] = useState('');

  // Per-section enabled state only — no collapse
  const [sectionEnabled, setSectionEnabled] = useState<Record<SectionKey, boolean>>(() => ({
    buffer: mode === 'buffer',
    attribute: mode === 'attribute',
    spatial: mode === 'spatial',
  }));

  // Update sectionEnabled when mode changes
  useEffect(() => {
    queueMicrotask(() => {
      setSectionEnabled({
        buffer: mode === 'buffer',
        attribute: mode === 'attribute',
        spatial: mode === 'spatial',
      });
    });
  }, [mode]);

  // Running state
  const [running, setRunning] = useState(false);

  // Drawing state tracking
  const [isDrawing, setIsDrawing] = useState(false);
  const interceptedListenersRef = useRef<any[]>([]);

  // Whenever geometries update and are non-null, drawing is complete
  useEffect(() => {
    if (bufferDrawnGeometry || spatialDrawnGeometry) {
      queueMicrotask(() => {
        setIsDrawing(false);
      });
    }
  }, [bufferDrawnGeometry, spatialDrawnGeometry]);

  // Click handler interception
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let map: any = null;
    try {
      map = findOpenLayersMap();
    } catch (e) {
      console.warn('Failed to find map for click interception:', e);
    }

    if (!map) return;

    if (isDrawing) {
      if (interceptedListenersRef.current.length === 0) {
        const listeners = [...(map.getListeners('click') || [])];
        listeners.forEach((l: any) => {
          map.un('click', l);
        });
        interceptedListenersRef.current = listeners;
      }
    } else {
      // Delay restoring click handlers to prevent the drawend click event
      // from firing map feature queries and closing the Query Builder.
      const timer = setTimeout(() => {
        if (interceptedListenersRef.current.length > 0) {
          interceptedListenersRef.current.forEach((l: any) => {
            const current = map.getListeners('click') || [];
            if (!current.includes(l)) {
              map.on('click', l);
            }
          });
          interceptedListenersRef.current = [];
        }
      }, 300);
      return () => clearTimeout(timer);
    }

    return () => {
      if (map && interceptedListenersRef.current.length > 0) {
        interceptedListenersRef.current.forEach((l: any) => {
          const current = map.getListeners('click') || [];
          if (!current.includes(l)) {
            map.on('click', l);
          }
        });
        interceptedListenersRef.current = [];
      }
    };
  }, [isDrawing]);

  // Inject style mockups on target OpenLayers layer if it is a WMS layer
  useEffect(() => {
    if (!targetLayerId) return;
    if (typeof window === 'undefined') return;

    let map: any = null;
    try {
      map = findOpenLayersMap();
    } catch (e) {
      console.warn('Failed to find map for WMS style injection:', e);
    }
    if (!map) return;

    const layers = map.getLayers().getArray();
    const findLayer = (lyrs: any[]): any => {
      for (const l of lyrs) {
        if (l.get('id') === targetLayerId) return l;
        if (typeof l.getLayers === 'function') {
          const found = findLayer(l.getLayers().getArray());
          if (found) return found;
        }
      }
      return null;
    };

    const olLayer = findLayer(layers);
    if (olLayer && typeof olLayer.getStyleFunction !== 'function') {
      // Mock VectorLayer style methods to prevent crashes on WMS TileLayers
      olLayer.getStyleFunction = () => () => { };
      olLayer.setStyle = (_styleFn: any) => {
        const source = olLayer.getSource();
        if (source && typeof source.updateParams === 'function') {
          const filteredIds = olLayer.get('filtered_ids') || [];
          const cqlFilterStr = filteredIds.length > 0
            ? `IN (${filteredIds.map((id: any) => `'${id}'`).join(',')})`
            : 'INCLUDE';
          source.updateParams({ 'CQL_FILTER': cqlFilterStr });
          olLayer.changed();
        }
      };
    }
  }, [targetLayerId]);

  const handleStartDraw = (type: string, owner: 'buffer' | 'spatial') => {
    setIsDrawing(true);
    onStartDraw(type, owner);
  };




  // Active filter slots per layer — use prop if provided, fall back to local state
  const [localActiveFilters, setLocalActiveFilters] = useState<Record<string, LayerActiveFilters>>({});
  const activeFilters = propActiveFilters ?? localActiveFilters;
  const setActiveFilters = onActiveFiltersChange ?? setLocalActiveFilters;

  const activeFiltersRef = useRef(activeFilters);
  useEffect(() => { activeFiltersRef.current = activeFilters; }, [activeFilters]);

  // Section refs — expose buildPayload/validate/fill/reset
  const attrRef = useRef<AttributeSectionHandle>(null);
  const bufferRef = useRef<BufferSectionHandle>(null);
  const spatialRef = useRef<SpatialSectionHandle>(null);

  // When target layer changes, reset all sections
  const prevLayerRef = useRef('');
  useEffect(() => {
    if (targetLayerId === prevLayerRef.current) return;
    prevLayerRef.current = targetLayerId;
    attrRef.current?.reset();
    bufferRef.current?.reset();
    spatialRef.current?.reset();
  }, [targetLayerId]);

  // Auto-select layer if only one vector layer is on the map
  useEffect(() => {
    if (!targetLayerId && vectorLayers.length === 1) {
      queueMicrotask(() => {
        setTargetLayerId(vectorLayers[0].id);
      });
    }
    // If the selected layer was removed from the map, clear it
    if (targetLayerId && !vectorLayers.find(l => l.id === targetLayerId)) {
      queueMicrotask(() => {
        setTargetLayerId('');
      });
    }
  }, [vectorLayers, targetLayerId]);

  // Which slots are currently "active" (have a payload applied on the map) for the target layer
  const appliedSlots = targetLayerId ? (activeFilters[targetLayerId] || {}) : {};
  const activeSlotKeys = Object.keys(appliedSlots) as (keyof LayerActiveFilters)[];

  const fetchGeomFieldName = useCallback(async (layerId: string): Promise<string> => {
    try {
      const res = await apiRequest(`/datasets/${layerId}/`);
      if (res.ok) {
        const d = await res.json();
        if (d.metadata?.geom_field) {
          return d.metadata.geom_field;
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch geom field name for ${layerId}:`, e);
    }
    return 'geom';
  }, []);

  const runCombinedQuery = useCallback(async (
    layerId: string,
    slots: LayerActiveFilters,
  ): Promise<string[]> => {
    const hasAttrFilter = !!slots.attribute?.attribute_filters?.length;
    const hasLayerFilter = !!slots.layer?.layer_filter?.dataset_id;

    // Fetch attribute field-type schema only when needed
    const schema: Record<string, string> = {};
    if (hasAttrFilter) {
      try {
        const schemaRes = await apiRequest(`/datasets/${layerId}/`);
        if (schemaRes.ok) {
          const d = await schemaRes.json();
          const raw = d.metadata?.attributes_schema || {};
          for (const [k, v] of Object.entries(raw)) {
            const t = String(v).toLowerCase();
            schema[k] = t === 'real' ? 'float' : t;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch schema for CQL compilation:', err);
      }
    }

    // Geometry field names
    let geomFieldName = 'geom';
    if (slots.spatial?.spatial_filter || slots.buffer?.spatial_filter || slots.layer?.layer_filter) {
      geomFieldName = await fetchGeomFieldName(layerId);
    }

    let refGeomFieldName = 'geom';
    if (slots.layer?.layer_filter?.dataset_id) {
      refGeomFieldName = await fetchGeomFieldName(slots.layer.layer_filter.dataset_id);
    }

    const targetDataset = allDatasets.find(d => d.id === layerId);
    const bbox = targetDataset?.metadata?.bbox;
    const isGeographic = bbox
      ? (bbox[0] >= -180.1 && bbox[2] <= 180.1 && bbox[1] >= -90.1 && bbox[3] <= 90.1)
      : true;

    // Reference layer filter if any
    let refFilterCql = 'INCLUDE';
    if (slots.layer?.layer_filter?.dataset_id) {
      const refDatasetId = slots.layer.layer_filter.dataset_id;
      const refSlots = activeFiltersRef.current[refDatasetId];
      if (refSlots) {
        try {
          const refDataset = allDatasets.find(d => d.id === refDatasetId);
          const refBbox = refDataset?.metadata?.bbox;
          const refIsGeo = refBbox
            ? (refBbox[0] >= -180.1 && refBbox[2] <= 180.1 && refBbox[1] >= -90.1 && refBbox[3] <= 90.1)
            : true;
          refFilterCql = compileSlotsToCql(refSlots, {}, refGeomFieldName, 'geom', refIsGeo) || 'INCLUDE';
        } catch {}
      }
    }

    // ── When a layer filter is present, use the server-side spatial-query endpoint ──
    // This avoids GeoServer's queryCollection 1000-feature limit by fetching
    // reference geometries server-side and using WFS POST XML or Turf.js fallback.
    if (hasLayerFilter) {
      const lf = slots.layer!.layer_filter!;

      // Build non-layer CQL parts (attribute + buffer + drawn spatial) as attr_ecql
      const nonLayerSlots: LayerActiveFilters = {};
      if (slots.attribute) nonLayerSlots.attribute = slots.attribute;
      if (slots.buffer) nonLayerSlots.buffer = slots.buffer;
      if (slots.spatial) nonLayerSlots.spatial = slots.spatial;
      const attrEcql = Object.keys(nonLayerSlots).length > 0
        ? compileSlotsToCql(nonLayerSlots, schema, geomFieldName, refGeomFieldName, isGeographic, refFilterCql)
        : '';

      const sqParams = new URLSearchParams({
        ref_layer_id: lf.dataset_id,
        operation: (lf.operation || 'INTERSECTS').toUpperCase(),
        count: '5000',
      });
      if (attrEcql) sqParams.set('attr_ecql', attrEcql);
      if (refFilterCql && refFilterCql !== 'INCLUDE') sqParams.set('ref_cql_filter', refFilterCql);

      const res = await apiRequest(`/datasets/${layerId}/spatial-query/?${sqParams}`);
      if (!res.ok) {
        let errMsg = 'Spatial query failed';
        try { const e = await res.json(); errMsg = e.message || e.detail || errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      const data = await res.json();
      if (data.count > 5000) {
        notification.warning({
          message: `Query matched ${data.count} features — showing first 5000`,
          placement: 'topRight', duration: 4,
        });
      }
      // spatial-query returns { count, data: ['layerName.id', ...] }
      return (data.data || []).map((f: any) => String(f)).filter(Boolean);
    }

    // ── Non-layer queries: attribute, buffer, drawn geometry spatial ──
    const cqlFilter = compileSlotsToCql(slots, schema, geomFieldName, refGeomFieldName, isGeographic, refFilterCql);
    if (!cqlFilter) throw new Error('No valid filters configured');

    const params = new URLSearchParams({ query_builder: cqlFilter, page_size: '5000' });
    const res = await apiRequest(`/datasets/${layerId}/features/?${params}`);
    if (!res.ok) {
      let errMsg = 'Query failed';
      try { const e = await res.json(); errMsg = e.message || e.detail || errMsg; } catch { /* ignore */ }
      throw new Error(errMsg);
    }
    const data = await res.json();
    if (data.count > 5000) {
      notification.warning({
        message: `Query matched ${data.count} features — showing first 5000`,
        placement: 'topRight', duration: 4,
      });
    }
    return (data.data || []).map((f: any) => String(f.ogc_fid || f.fid || f.id)).filter(Boolean);
  }, [fetchGeomFieldName, allDatasets]);


  // Collect and validate payloads from enabled sections, returns null if validation fails
  const collectSlots = (): LayerActiveFilters | null => {
    const slots: LayerActiveFilters = {};
    if (sectionEnabled.attribute) {
      if (!attrRef.current?.validate()) return null;
      const p = attrRef.current?.buildPayload();
      if (p) slots.attribute = p;
    }
    if (sectionEnabled.buffer) {
      if (!bufferRef.current?.validate()) return null;
      const p = bufferRef.current?.buildPayload();
      if (p) slots.buffer = p;
    }
    if (sectionEnabled.spatial) {
      if (!spatialRef.current?.validate()) return null;
      const p = spatialRef.current?.buildPayload();
      if (p) {
        if (p.layer_filter) slots.layer = p;
        else slots.spatial = p;
      }
    }
    return slots;
  };

  const ensureLayerMock = useCallback((layerId: string) => {
    if (typeof window === 'undefined') return;

    let olLayer = null;
    if ((window as any).vismapLayers) {
      olLayer = (window as any).vismapLayers[layerId];
    }

    if (!olLayer) {
      let map: any = null;
      try {
        map = findOpenLayersMap();
      } catch (e) {
        console.warn('Failed to find map for WMS style injection:', e);
      }
      if (!map) return;

      const layers = map.getLayers().getArray();
      const findLayer = (lyrs: any[]): any => {
        for (const l of lyrs) {
          if (l.get('id') === layerId) return l;
          if (typeof l.getLayers === 'function') {
            const found = findLayer(l.getLayers().getArray());
            if (found) return found;
          }
        }
        return null;
      };
      olLayer = findLayer(layers);
    }

    if (olLayer && typeof olLayer.getStyleFunction !== 'function') {
      // Mock VectorLayer style methods to prevent crashes on WMS TileLayers
      olLayer.getStyleFunction = () => () => { };
      olLayer.setStyle = (_styleFn: any) => {
        const source = olLayer.getSource();
        if (source && typeof source.updateParams === 'function') {
          const filteredIds = olLayer.get('filtered_ids') || [];
          const cqlFilterStr = filteredIds.length > 0
            ? `IN (${filteredIds.map((id: any) => `'${id}'`).join(',')})`
            : 'INCLUDE';
          source.updateParams({ 'CQL_FILTER': cqlFilterStr });
          if (!olLayer._mockChanging) {
            olLayer._mockChanging = true;
            olLayer.changed();
            olLayer._mockChanging = false;
          }
        }
      };

      if (!olLayer._changedMocked) {
        olLayer._changedMocked = true;
        const originalChanged = olLayer.changed.bind(olLayer);
        olLayer.changed = () => {
          const source = olLayer.getSource();
          if (source && typeof source.updateParams === 'function') {
            const isFiltered = olLayer.get('filtered');
            const filteredIds = olLayer.get('filtered_ids');
            if (!isFiltered || !filteredIds) {
              source.updateParams({ 'CQL_FILTER': 'INCLUDE' });
            }
          }
          originalChanged();
        };
      }
    }
  }, []);

  const executeRun = async (slots: LayerActiveFilters) => {
    const layer = vectorLayers.find(l => l.id === targetLayerId);
    setRunning(true);
    try {
      const matchedIds = await runCombinedQuery(targetLayerId, slots);

      if (matchedIds.length === 0) {
        notification.warning({ message: 'No features matched the query', placement: 'topRight' });
      } else {
        setActiveFilters(prev => ({ ...prev, [targetLayerId]: slots }));
        activeFiltersRef.current = { ...activeFiltersRef.current, [targetLayerId]: slots };

        // Compile the CQL filter string
        let cqlFilterStr = '';
        try {
          const hasLayerFilter = !!slots.layer?.layer_filter?.dataset_id;
          if (hasLayerFilter) {
            cqlFilterStr = ''; // Filtered via WMS featureid parameter, not CQL_FILTER
          } else {
            const geomFieldName = await fetchGeomFieldName(targetLayerId);
            let refGeomFieldName = 'geom';
            if (slots.layer?.layer_filter?.dataset_id) {
              refGeomFieldName = await fetchGeomFieldName(slots.layer.layer_filter.dataset_id);
            }
            const targetDataset = allDatasets.find(d => d.id === targetLayerId);
            const bbox = targetDataset?.metadata?.bbox;
            const isGeographic = bbox
              ? (bbox[0] >= -180.1 && bbox[2] <= 180.1 && bbox[1] >= -90.1 && bbox[3] <= 90.1)
              : true;
            cqlFilterStr = compileSlotsToCql(slots, {}, geomFieldName, refGeomFieldName, isGeographic);
            console.log('[DEBUG CLIENT CQL]', cqlFilterStr);
          }
        } catch (cqlErr) {
          console.warn('Failed to compile slots to CQL:', cqlErr);
        }

        // Set properties on the OpenLayers layer to avoid large WMS IN queries
        let olLayer = null;
        if (typeof window !== 'undefined' && (window as any).vismapLayers) {
          olLayer = (window as any).vismapLayers[targetLayerId];
        }
        if (olLayer) {
          olLayer.set('cql_filter_string', cqlFilterStr);
        }

        ensureLayerMock(targetLayerId);
        onQueryResult(targetLayerId, layer?.name || '', matchedIds, cqlFilterStr);
        const slotCount = Object.keys(slots).length;
        const label = slotCount > 1 ? `Combined query (${slotCount} filters)` : 'Query';
        notification.success({
          message: `${label} returned ${matchedIds.length} features`,
          placement: 'topRight',
        });
      }
    } catch (e: any) {
      if (e.isPluginError) {
        notification.error({
          key: 'query_builder_error',
          message: e.notificationTitle || 'GeoServer QueryLayer Plugin Required',
          description: e.notificationDescription,
          placement: 'topRight',
          duration: 8,
        });
      } else {
        notification.error({
          key: 'query_builder_error',
          message: e.message || 'Query failed',
          placement: 'topRight',
        });
      }
    } finally {
      setRunning(false);
    }
  };

  const handleRun = async () => {
    if (!targetLayerId) {
      notification.warning({ message: 'Select a target layer first', placement: 'topRight' });
      return;
    }

    const slots = collectSlots();
    if (slots === null) return;

    if (Object.keys(slots).length === 0) {
      notification.warning({ message: 'Enable and configure at least one filter section', placement: 'topRight' });
      return;
    }

    // Merge the new slots into target layer's existing active filters
    const existingFilters = activeFilters[targetLayerId] || {};
    const mergedSlots: LayerActiveFilters = { ...existingFilters };

    // Merge all currently active section payloads into mergedSlots
    if (slots.attribute) mergedSlots.attribute = slots.attribute;
    else if (mode === 'attribute') delete mergedSlots.attribute;

    if (slots.buffer) mergedSlots.buffer = slots.buffer;
    else if (mode === 'buffer') delete mergedSlots.buffer;

    if (slots.spatial) {
      mergedSlots.spatial = slots.spatial;
      delete mergedSlots.layer;
    } else if (slots.layer) {
      mergedSlots.layer = slots.layer;
      delete mergedSlots.spatial;
    } else if (mode === 'spatial') {
      delete mergedSlots.spatial;
      delete mergedSlots.layer;
    }

    await executeRun(mergedSlots);
  };

  const handleReset = () => {
    attrRef.current?.reset();
    bufferRef.current?.reset();
    spatialRef.current?.reset();
    setSectionEnabled({
      buffer: mode === 'buffer',
      attribute: mode === 'attribute',
      spatial: mode === 'spatial',
    });
    setIsDrawing(false);

    if (targetLayerId) {
      ensureLayerMock(targetLayerId);
      onResetLayer(targetLayerId);
      setActiveFilters(prev => { const n = { ...prev }; delete n[targetLayerId]; return n; });
    }
  };

  const handleRemoveSlot = async (slot: keyof LayerActiveFilters) => {
    if (!targetLayerId) return;
    const current = activeFiltersRef.current[targetLayerId] || {};
    const updated = { ...current };
    delete updated[slot];

    setActiveFilters(prev => {
      const n = { ...prev };
      if (Object.keys(updated).length === 0) delete n[targetLayerId];
      else n[targetLayerId] = updated;
      return n;
    });

    if (Object.keys(updated).length === 0) {
      ensureLayerMock(targetLayerId);
      onResetLayer(targetLayerId);
    } else {
      try {
        const ids = await runCombinedQuery(targetLayerId, updated);

        if (ids.length === 0) {
          ensureLayerMock(targetLayerId);
          onResetLayer(targetLayerId);
          return;
        }

        // Compile the CQL filter string
        let cqlFilterStr = '';
        try {
          const hasLayerFilter = !!updated.layer?.layer_filter?.dataset_id;
          if (hasLayerFilter) {
            cqlFilterStr = ''; // Filtered via WMS featureid parameter, not CQL_FILTER
          } else {
            const geomFieldName = await fetchGeomFieldName(targetLayerId);
            let refGeomFieldName = 'geom';
            if (updated.layer?.layer_filter?.dataset_id) {
              refGeomFieldName = await fetchGeomFieldName(updated.layer.layer_filter.dataset_id);
            }
            const targetDataset = allDatasets.find(d => d.id === targetLayerId);
            const bbox = targetDataset?.metadata?.bbox;
            const isGeographic = bbox
              ? (bbox[0] >= -180.1 && bbox[2] <= 180.1 && bbox[1] >= -90.1 && bbox[3] <= 90.1)
              : true;
            cqlFilterStr = compileSlotsToCql(updated, {}, geomFieldName, refGeomFieldName, isGeographic);
          }
        } catch (cqlErr) {
          console.warn('Failed to compile slots to CQL:', cqlErr);
        }

        // Set properties on the OpenLayers layer to avoid large WMS IN queries
        let olLayer = null;
        if (typeof window !== 'undefined' && (window as any).vismapLayers) {
          olLayer = (window as any).vismapLayers[targetLayerId];
        }
        if (olLayer) {
          olLayer.set('cql_filter_string', cqlFilterStr);
        }

        ensureLayerMock(targetLayerId);
        onUpdateMapFilter(targetLayerId, ids, cqlFilterStr);
      } catch {
        ensureLayerMock(targetLayerId);
        onResetLayer(targetLayerId);
      }
    }
  };



  const _toggleEnabled = (key: SectionKey, val: boolean) =>
    setSectionEnabled(prev => ({ ...prev, [key]: val }));

  // Slot label map for active pills
  const SLOT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    attribute: { label: 'Attribute', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
    buffer: { label: 'Buffer', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
    spatial: { label: 'Spatial', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
    layer: { label: 'Layer', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
  };

  return (
    // Outer: full height flex column — scroll area + action bar stacked, no absolute positioning
    <div className="flex flex-col h-full">

      {/* ── Scrollable content ── */}
      <div className="flex-1 min-h-0 overflow-y-auto query-builder-scroll flex flex-col gap-3 px-1 py-1">

        {/* Target layer selector */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Target Layer</div>
          </div>
          {vectorLayers.length === 0 ? (
            <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg px-3 py-2">
              Add a vector layer to the map first.
            </div>
          ) : (
            <Select
              showSearch
              size="small"
              value={targetLayerId || undefined}
              onChange={v => setTargetLayerId(v)}
              className="w-full"
              placeholder="Select vector layer"
              options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              getPopupContainer={trigger => trigger.parentElement}
            />
          )}
        </div>

        {/* ── Section cards ── */}
        {SECTIONS.filter(s => s.key === mode).map(section => {
          const isEnabled = sectionEnabled[section.key];
          const _hasApplied = activeSlotKeys.some(k =>
            section.key === 'spatial' ? (k === 'spatial' || k === 'layer') : k === section.key
          );

          return (
            <div
              key={section.key}
              className="rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              {/* Header — switch only, no collapse */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
                    {section.label}
                  </span>
                </div>
              </div>

              {/* Body — always visible */}
              <div className="px-3 pb-3 pt-2.5 border-t border-gray-100">
                {section.key === 'attribute' && (
                  <AttributeSection ref={attrRef} layerId={targetLayerId} enabled={isEnabled} />
                )}
                {section.key === 'buffer' && (
                  <BufferSection
                    ref={bufferRef}
                    enabled={isEnabled}
                    layerId={targetLayerId}
                    onStartDraw={handleStartDraw}
                    drawnGeometry={bufferDrawnGeometry}
                    onClearDrawn={onClearBufferDraw}
                    onShowGeometryOnMap={onShowGeometryOnMap
                      ? (geom, owner) => onShowGeometryOnMap(geom, owner)
                      : undefined}
                  />
                )}
                {section.key === 'spatial' && (
                  <SpatialSection
                    ref={spatialRef}
                    enabled={isEnabled}
                    layerId={targetLayerId}
                    onStartDraw={handleStartDraw}
                    drawnGeometry={spatialDrawnGeometry}
                    onClearDrawn={onClearSpatialDraw}
                    activeFilters={activeFilters}
                    onShowGeometryOnMap={onShowGeometryOnMap
                      ? (geom, owner) => onShowGeometryOnMap(geom, owner)
                      : undefined}
                  />
                )}
              </div>
            </div>
          );
        })}

        {/* Bottom spacer so last card isn't hidden behind action bar */}
        <div className="h-2" />
      </div>

      {/* ── Action bar — part of normal flow, never overlaps content ── */}
      <div className="shrink-0 border-t border-gray-100 bg-white flex flex-col gap-2.5 py-3 ">
        {/* Active filter pills */}
        {activeSlotKeys.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Active on Map</div>
            <div className="flex flex-wrap gap-1">
              {activeSlotKeys.map(slot => {
                const cfg = SLOT_LABELS[slot];
                if (!cfg) return null;
                return (
                  <div
                    key={slot}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold transition-opacity duration-100 ${cfg.bg} ${cfg.color}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                    {cfg.label}
                    <button
                      onClick={() => handleRemoveSlot(slot)}
                      className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity duration-100"
                    >
                      <X size={9} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        <div className="flex gap-1.5 items-center">
          {/* Clear */}
          <Tooltip title="Clear all filters">
            <Button
              size="small"
              icon={<RotateCcw size={13} />}
              onClick={handleReset}
              disabled={!targetLayerId}
              className="h-8 w-8 flex items-center justify-center shrink-0"
            />
          </Tooltip>

          {/* Run */}
          <Button
            type="primary"
            size="small"
            icon={<Play size={13} />}
            loading={running}
            onClick={handleRun}
            disabled={!targetLayerId}
            className="flex-1 h-8 font-bold min-w-0"
          >
            Run Query
          </Button>
        </div>
      </div>
    </div>
  );
}
