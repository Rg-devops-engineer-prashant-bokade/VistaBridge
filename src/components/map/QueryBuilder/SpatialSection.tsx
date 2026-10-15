// ============================================================================
// SpatialSection Component
//
// Allows users to filter GIS layer features using spatial geometric relationships:
// 1. Layer-to-Layer: Find features in Target Layer that intersect, touch, or
//    are contained within a Reference Layer (e.g. Roads within City Boundary).
// 2. Custom Shape: Filter features by drawing a polygon directly on the map
//    or pasting a GeoJSON geometry.
//
// Supports spatial operations: INTERSECTS, WITHIN, CONTAINS, TOUCHES, DISJOINT.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Select, Button, Input, Tag, Tooltip, InputNumber, notification, Popover } from 'antd';
import { Crosshair, Trash2 } from 'lucide-react';
import { SPATIAL_OPERATORS } from './constants';
import type { QueryBuilderPayload, LayerActiveFilters } from './types';
import { apiRequest } from '@/lib/api';

export interface SpatialSectionHandle {
  buildPayload: () => QueryBuilderPayload | null;
  validate: () => boolean;
  fill: (payload: QueryBuilderPayload, drawnGeom?: any) => void;
  reset: () => void;
  getMode: () => 'geometry' | 'layer';
  getDrawnGeometry: () => any;
}

interface Props {
  enabled: boolean;
  layerId: string;
  onStartDraw: (type: string, owner: 'spatial') => void;
  drawnGeometry: any | null;
  onClearDrawn: () => void;
  activeFilters?: Record<string, LayerActiveFilters>;
  onShowGeometryOnMap?: (geometry: any, owner: 'spatial') => void;
}

// Extracts valid geometry from GeoJSON Feature or FeatureCollection
function extractGeometry(input: any): any | null {
  if (!input || typeof input !== 'object') return null;
  if (input.type === 'Feature') return input.geometry ?? null;
  if (input.type === 'FeatureCollection') return input.features?.[0] ? extractGeometry(input.features[0]) : null;
  const geomTypes = ['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'];
  return geomTypes.includes(input.type) ? input : null;
}

const SpatialSection = forwardRef<SpatialSectionHandle, Props>(({
  enabled, layerId, onStartDraw, drawnGeometry, onClearDrawn, activeFilters, onShowGeometryOnMap,
}, ref) => {
  const [mode, setMode] = useState<'geometry' | 'layer'>('layer');
  const [operation, setOperation] = useState('intersects');
  const [distance, setDistance] = useState<number>(100);
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [unit, setUnit] = useState<'m' | 'km'>('m');
  const [pastedGeojson, setPastedGeojson] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [refDatasetId, setRefDatasetId] = useState('');
  const [bookmarkGeometry, setBookmarkGeometry] = useState<any>(null);
  const [vectorDatasets, setVectorDatasets] = useState<any[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);

  // Refs for guard checks in fetchDatasets — avoids stale closure on datasetsLoading / vectorDatasets
  const datasetsLoadingRef = useRef(false);
  const datasetsLoadedRef = useRef(false);

  const fetchDatasets = useCallback(async () => {
    // Guard against concurrent fetches and redundant re-fetches
    if (datasetsLoadingRef.current || datasetsLoadedRef.current) return;
    datasetsLoadingRef.current = true;
    setDatasetsLoading(true);
    try {
      const res = await apiRequest('/datasets/');
      if (res.ok) {
        const data = await res.json();
        const vectorOnly = (data || []).filter(
          (d: any) => d.data_type === 'VECTOR' && d.status === 'READY'
        );
        setVectorDatasets(vectorOnly);
        datasetsLoadedRef.current = true;
      } else {
        throw new Error(`GeoServer returned status ${res.status}`);
      }
    } catch (e: any) {
      console.error('Failed to load reference datasets:', e);
      notification.error({
        message: 'Load Error',
        description: e.message || 'Failed to load reference datasets from GeoServer.',
        placement: 'topRight',
      });
    } finally {
      datasetsLoadingRef.current = false;
      setDatasetsLoading(false);
    }
  }, []);

  // Geometry saved locally when this section was the draw owner — survives owner switches
  const showGeomRef = useRef(onShowGeometryOnMap);
  useEffect(() => { showGeomRef.current = onShowGeometryOnMap; }, [onShowGeometryOnMap]);

  const effectiveGeometry = drawnGeometry ?? bookmarkGeometry;
  const selectedOp = SPATIAL_OPERATORS.find(o => o.value === operation);
  const opsForMode = mode === 'layer'
    ? SPATIAL_OPERATORS.filter(o => o.supportsLayer)
    : SPATIAL_OPERATORS;

  useEffect(() => { if (drawnGeometry) setBookmarkGeometry(null); }, [drawnGeometry]);

  const getGeometry = (): any | null => {
    if (effectiveGeometry) return effectiveGeometry;
    if (pastedGeojson.trim()) {
      try {
        const parsed = JSON.parse(pastedGeojson.trim());
        const geom = extractGeometry(parsed);
        if (!geom) { setPasteError('Could not extract geometry from pasted GeoJSON'); return null; }
        setPasteError('');
        return geom;
      } catch {
        setPasteError('Invalid JSON');
        return null;
      }
    }
    return null;
  };

  const validate = (): boolean => {
    if (mode === 'layer') {
      if (!refDatasetId) {
        notification.warning({ message: 'Select a reference dataset', placement: 'topRight' });
        return false;
      }
      if (refDatasetId === layerId) {
        notification.error({ message: 'Source and reference dataset cannot be the same', placement: 'topRight' });
        return false;
      }
      return true;
    }
    const geom = getGeometry();
    if (!geom) {
      notification.warning({ message: 'Draw or paste a geometry first', placement: 'topRight' });
      return false;
    }
    if (selectedOp?.needsDistance && distance <= 0) {
      notification.warning({ message: 'Distance must be greater than 0', placement: 'topRight' });
      return false;
    }
    return true;
  };

  const buildPayload = (): QueryBuilderPayload | null => {
    if (mode === 'layer') {
      if (!refDatasetId) return null;
      return { layer_filter: { dataset_id: refDatasetId, operation } };
    }
    const geom = getGeometry();
    if (!geom) return null;
    const sf: any = { operation, geometry: geom };
    if (selectedOp?.needsDistance) {
      sf.distance = unit === 'km' ? distance * 1000 : distance;
      sf._spatial_unit = unit;
    }
    return { spatial_filter: sf };
  };

  const fill = (payload: QueryBuilderPayload, drawnGeom?: any) => {
    if (payload.layer_filter) {
      setMode('layer');
      setRefDatasetId(payload.layer_filter.dataset_id);
      setOperation(payload.layer_filter.operation);
      fetchDatasets();
    } else if (payload.spatial_filter) {
      setMode('geometry');
      setOperation(payload.spatial_filter.operation);
      if (payload.spatial_filter.distance) {
        const savedUnit = (payload.spatial_filter as any)._spatial_unit || 'm';
        setUnit(savedUnit);
        setDistance(savedUnit === 'km' ? payload.spatial_filter.distance / 1000 : payload.spatial_filter.distance);
      }
      const geom = drawnGeom ?? payload.spatial_filter.geometry;
      if (geom) {
        setBookmarkGeometry(geom);
        setPastedGeojson(JSON.stringify(geom, null, 2));
        if (showGeomRef.current) showGeomRef.current(geom, 'spatial');
      }
    }
  };

  const reset = () => {
    setMode('layer');
    setOperation('intersects');
    setDistance(100);
    setUnit('m');
    setPastedGeojson('');
    setPasteError('');
    setRefDatasetId('');
    setBookmarkGeometry(null);
    setPopoverVisible(false);
    onClearDrawn();
  };

  const getMode = () => mode;
  const getDrawnGeometry = () => effectiveGeometry;

  useImperativeHandle(ref, () => ({ buildPayload, validate, fill, reset, getMode, getDrawnGeometry }));

  const handlePasteChange = (value: string) => {
    setPastedGeojson(value);
    setPasteError('');
    setBookmarkGeometry(null);
    if (drawnGeometry) onClearDrawn();
    if (value.trim()) {
      try {
        const parsed = JSON.parse(value.trim());
        const geom = extractGeometry(parsed);
        if (geom && showGeomRef.current) showGeomRef.current(geom, 'spatial');
      } catch { /* not valid yet */ }
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Mode toggle */}
      <div className="flex gap-1.5">
        {(['layer', 'geometry'] as const).map(m => (
          <button
            key={m}
            disabled={!enabled}
            onClick={() => { setMode(m); setOperation('intersects'); }}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all duration-100 ${
              mode === m
                ? 'bg-violet-600 border-violet-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:border-violet-300 hover:text-violet-600'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {m === 'layer' ? 'Use Another Layer' : 'Draw / Paste Geometry'}
          </button>
        ))}
      </div>

      {/* Operation */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Spatial Operation</div>
        <Select size="small" value={operation} onChange={v => setOperation(v)} className="w-full"
          options={opsForMode.map(o => ({ label: o.label, value: o.value }))}
          disabled={!enabled}
          getPopupContainer={trigger => trigger.parentElement}
        />
      </div>

      {/* Distance — only for within_distance in geometry mode */}
      {selectedOp?.needsDistance && mode === 'geometry' && (
        <div>
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Distance</div>
          <Popover
            open={popoverVisible}
            content={
              <div className="flex flex-col gap-1.5 p-1 text-xs max-w-[180px]">
                <div className="font-semibold text-gray-800">Max limit is 500 km.</div>
                <div className="text-gray-500 text-[11px]">Do you want to set it to max?</div>
                <div className="flex items-center justify-end mt-1">
                  <Button size="small" type="primary" onClick={() => { setDistance(unit === 'km' ? 500 : 500000); setPopoverVisible(false); }}>
                    Set to Max
                  </Button>
                </div>
              </div>
            }
            placement="top"
            trigger={[]}
          >
            <InputNumber size="small" min={0}
              value={distance}
              onChange={v => {
                setDistance(v ?? 100);
                const maxVal = unit === 'km' ? 500 : 500000;
                if (v !== null && v > maxVal) {
                  setPopoverVisible(true);
                } else {
                  setPopoverVisible(false);
                }
              }}
              onBlur={() => {
                const maxVal = unit === 'km' ? 500 : 500000;
                if (distance > maxVal) {
                  setDistance(maxVal);
                  setPopoverVisible(false);
                }
              }}
              addonAfter={
                <Select
                  value={unit}
                  onChange={v => {
                    setUnit(v);
                    const maxVal = v === 'km' ? 500 : 500000;
                    if (distance > maxVal) {
                      setDistance(maxVal);
                      setPopoverVisible(false);
                    }
                  }}
                  disabled={!enabled}
                  size="small"
                  options={[
                    { value: 'm', label: 'm' },
                    { value: 'km', label: 'km' }
                  ]}
                  dropdownStyle={{ minWidth: 60 }}
                  style={{ width: 60 }}
                  className="text-xs"
                />
              }
              className="w-full" disabled={!enabled}
              maxLength={8}
            />
          </Popover>
        </div>
      )}

      {/* Geometry mode */}
      {mode === 'geometry' && (
        <>
          <div className="flex items-center gap-2">
            <Button size="small" icon={<Crosshair size={13} />}
              onClick={() => onStartDraw('Polygon', 'spatial')}
              className="flex-1"
              type={effectiveGeometry ? 'default' : 'primary'}
              disabled={!enabled || !layerId}
            >
              {effectiveGeometry ? 'Redraw on Map' : 'Draw on Map'}
            </Button>
            {effectiveGeometry && (
              <Tooltip title="Clear geometry">
                <Button size="small" danger icon={<Trash2 size={13} />}
                  onClick={() => { onClearDrawn(); setBookmarkGeometry(null); setPastedGeojson(''); }}
                  disabled={!enabled}
                />
              </Tooltip>
            )}
          </div>
          {effectiveGeometry && <Tag color="purple" className="text-xs w-fit">✓ Geometry ready</Tag>}

          <div className="text-center text-[10px] text-gray-400">— or paste GeoJSON —</div>

          <div>
            <Input.TextArea rows={3} value={pastedGeojson} onChange={e => handlePasteChange(e.target.value)}
              placeholder={'{"type":"Polygon","coordinates":[...]} — EPSG:4326'}
              className="text-xs font-mono" disabled={!enabled}
            />
            {pasteError && <div className="text-[10px] text-red-500 mt-1">{pasteError}</div>}
            {pastedGeojson && !pasteError && !effectiveGeometry && (
              <Tag color="purple" className="text-xs w-fit mt-1">✓ GeoJSON pasted</Tag>
            )}
          </div>
        </>
      )}

      {/* Layer mode */}
      {mode === 'layer' && (
        <div>
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Reference Dataset</div>
          <Select showSearch size="small" value={refDatasetId || undefined} onChange={setRefDatasetId}
            className="w-full" placeholder="Select reference vector dataset"
            options={vectorDatasets
              .filter(d => d.id !== layerId) // prevent self-reference
              .map(d => ({ label: d.name, value: d.id }))}
            filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            notFoundContent={<span className="text-xs text-gray-400">No vector datasets available</span>}
            disabled={!enabled}
            loading={datasetsLoading}
            onOpenChange={(open) => {
              if (open) fetchDatasets();
            }}
            getPopupContainer={trigger => trigger.parentElement}
          />
          {refDatasetId && activeFilters?.[refDatasetId] && (
            <div className="mt-2 flex flex-col gap-1 bg-violet-50/50 border border-violet-100/80 rounded-lg p-2">
              <div className="text-[9px] font-bold text-violet-600 uppercase tracking-wider">
                Reference Layer Filters
              </div>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {Object.keys(activeFilters[refDatasetId]).map(slot => {
                  const SLOT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
                    attribute: { label: 'Attribute', color: 'text-violet-700 border-violet-200', bg: 'bg-violet-50' },
                    buffer: { label: 'Buffer', color: 'text-violet-700 border-violet-200', bg: 'bg-violet-50' },
                    spatial: { label: 'Spatial', color: 'text-violet-700 border-violet-200', bg: 'bg-violet-50' },
                    layer: { label: 'Layer', color: 'text-violet-700 border-violet-200', bg: 'bg-violet-50' },
                  };
                  const cfg = SLOT_LABELS[slot];
                  if (!cfg) return null;
                  return (
                    <span
                      key={slot}
                      className={`px-2 py-0.5 rounded-full border text-[9px] font-bold ${cfg.bg} ${cfg.color}`}
                    >
                      {cfg.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          <div className="text-[10px] text-gray-400 mt-1">
            Within distance not supported in layer mode.
          </div>
        </div>
      )}
    </div>
  );
});

SpatialSection.displayName = 'SpatialSection';
export default SpatialSection;
