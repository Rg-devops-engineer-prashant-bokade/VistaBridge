// ============================================================================
// BufferSection Component
//
// In GIS, a "Buffer" creates an expanded zone or radius around a shape.
// Example: "Find all hospitals within 500 meters of this pipeline".
//
// This component lets the user:
// 1. Draw a Point, Line, or Polygon on the map
// 2. Specify a buffer radius distance in meters
// 3. Uses Turf.js (`@turf/buffer`) in the browser to compute the expanded buffer zone
// 4. Filters the target layer features that intersect this buffer zone
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Button, InputNumber, Tag, Tooltip, notification, Popover } from 'antd';
import { Crosshair, Trash2, Circle, Minus, Square, RectangleHorizontal, Pentagon } from 'lucide-react';
import type { QueryBuilderPayload } from './types';
import { buffer as turfBuffer } from '@turf/buffer';

export interface BufferSectionHandle {
  buildPayload: () => QueryBuilderPayload | null;
  validate: () => boolean;
  fill: (payload: QueryBuilderPayload, drawnGeom?: any) => void;
  reset: () => void;
  getDrawnGeometry: () => any;
}

interface Props {
  enabled: boolean;
  layerId: string;
  onStartDraw: (type: string, owner: 'buffer') => void;
  drawnGeometry: any | null;
  onClearDrawn: () => void;
  onShowGeometryOnMap?: (geometry: any, owner: 'buffer') => void;
}

const BufferSection = forwardRef<BufferSectionHandle, Props>(({
  enabled, layerId, onStartDraw, drawnGeometry, onClearDrawn, onShowGeometryOnMap,
}, ref) => {
  const [drawType, setDrawType] = useState('Point');
  const [radius, setRadius] = useState<number | null>(500);
  const [popoverVisible, setPopoverVisible] = useState(false);
  // Geometry restored from a bookmark — used when drawnGeometry prop is null
  const [bookmarkGeometry, setBookmarkGeometry] = useState<any>(null);
  // The turf-buffered result — what actually gets sent to the backend
  const [bufferedGeometry, setBufferedGeometry] = useState<any>(null);
  const [bufferError, setBufferError] = useState('');

  const effectiveRaw = drawnGeometry ?? bookmarkGeometry;
  const onShowGeometryOnMapRef = useRef(onShowGeometryOnMap);
  useEffect(() => { onShowGeometryOnMapRef.current = onShowGeometryOnMap; });

  useEffect(() => { if (drawnGeometry) setBookmarkGeometry(null); }, [drawnGeometry]);

  // Recompute buffer whenever raw geometry or radius changes
  useEffect(() => {
    if (!effectiveRaw) { setBufferedGeometry(null); setBufferError(''); return; }
    if (!turfBuffer) {
      // turf not loaded yet — use raw geometry as fallback
      setBufferedGeometry(effectiveRaw);
      return;
    }
    try {
      const feature: any = { type: 'Feature', geometry: effectiveRaw, properties: {} };
      const buffered: any = turfBuffer(feature, radius ?? 0, { units: 'meters' } as any);
      if (!buffered?.geometry) throw new Error('Buffer produced no geometry');
      setBufferedGeometry(buffered.geometry);
      setBufferError('');
      // Use ref to avoid this callback being a reactive dependency
      onShowGeometryOnMapRef.current?.(buffered.geometry, 'buffer');
    } catch {
      setBufferError('Buffer computation failed — check geometry');
      setBufferedGeometry(null);
    }
  }, [effectiveRaw, radius]);

  const validate = (): boolean => {
    if (!bufferedGeometry) {
      notification.warning({ message: 'Draw a geometry on the map first', placement: 'topRight' });
      return false;
    }
    if (!radius || radius <= 0) {
      notification.warning({ message: 'Buffer radius must be greater than 0', placement: 'topRight' });
      return false;
    }
    return true;
  };

  const buildPayload = (): QueryBuilderPayload | null => {
    if (!bufferedGeometry) return null;
    return {
      spatial_filter: {
        operation: 'intersects',
        geometry: bufferedGeometry,
        // Store radius + drawType so fill() can restore them exactly
        _buffer_radius: radius ?? 500,
        _buffer_draw_type: drawType,
      } as any,
    };
  };

  const fill = (payload: QueryBuilderPayload, drawnGeom?: any) => {
    const sf = payload.spatial_filter as any;
    if (!sf) return;

    // Restore radius — prefer explicit _buffer_radius, fall back to legacy within_distance
    const savedRadius = sf._buffer_radius ?? (sf.operation === 'within_distance' ? sf.distance : null) ?? 500;
    setRadius(savedRadius);

    // Restore draw type — prefer explicit _buffer_draw_type, fall back to geometry type inference
    const savedDrawType = sf._buffer_draw_type ?? (() => {
      const geomType = (sf.geometry as any)?.type ?? 'Point';
      return geomType === 'LineString' ? 'LineString' : geomType === 'Point' ? 'Point' : 'Polygon';
    })();
    setDrawType(savedDrawType);

    // Use the original raw drawn geometry for re-buffering.
    // Never fall back to sf.geometry (which is already-buffered) — that would double-buffer.
    if (drawnGeom) {
      setBookmarkGeometry(drawnGeom);
    }
    // If drawnGeom is absent (old bookmark), leave geometry empty — user must redraw
  };

  const reset = () => {
    setDrawType('Point');
    setRadius(500);
    setBookmarkGeometry(null);
    setBufferedGeometry(null);
    setBufferError('');
    onClearDrawn();
  };

  const getDrawnGeometry = () => effectiveRaw;

  useImperativeHandle(ref, () => ({ buildPayload, validate, fill, reset, getDrawnGeometry }));

  return (
    <div className="flex flex-col gap-3">
      {/* Geometry type icon buttons */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Geometry Type</div>
        <div className="flex gap-1.5">
          {([
            { value: 'Point',      label: 'Point Buffer',   Icon: Circle              },
            { value: 'LineString', label: 'Line Buffer',    Icon: Minus               },
            { value: 'Polygon',    label: 'Polygon Buffer', Icon: Pentagon             },
            { value: 'Box',        label: 'Box Buffer',     Icon: Square              },
            { value: 'Circle',     label: 'Circle Buffer',  Icon: RectangleHorizontal },
          ] as const).map(({ value, label, Icon }) => (
            <Tooltip key={value} title={label}>
              <button
                onClick={() => {
                  setDrawType(value);
                  onClearDrawn();
                  setBookmarkGeometry(null);
                  setBufferedGeometry(null);
                }}
                disabled={!enabled}
                className={`w-8 h-8 rounded-lg border transition-all duration-100 flex items-center justify-center ${
                  drawType === value
                    ? 'bg-violet-600 border-violet-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-400 hover:border-violet-300 hover:text-violet-600'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Icon size={14} />
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* Radius input — always shown, applies to all geometry types */}
      <div>
        <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
          Buffer Radius
        </div>
        <Popover
          open={popoverVisible}
          content={
            <div className="flex flex-col gap-1.5 p-1 text-xs max-w-[180px]">
              <div className="font-semibold text-gray-800">Max limit is 500 km.</div>
              <div className="text-gray-500 text-[11px]">Do you want to set it to max?</div>
              <div className="flex items-center justify-end mt-1">
                <Button size="small" type="primary" onClick={() => { setRadius(500000); setPopoverVisible(false); }}>
                  Set to Max
                </Button>
              </div>
            </div>
          }
          placement="top"
          trigger={[]}
        >
          <InputNumber
            size="small" min={1} value={radius}
            onChange={v => {
              setRadius(v);
              if (v !== null && v > 500000) {
                setPopoverVisible(true);
              } else {
                setPopoverVisible(false);
              }
            }}
            onBlur={() => {
              if (radius !== null && radius > 500000) {
                setRadius(500000);
                setPopoverVisible(false);
              }
            }}
            addonAfter="m" className="w-full"
            disabled={!enabled}
            maxLength={8}
          />
        </Popover>
        <div className="text-[10px] text-gray-400 mt-1">
          Max 500 km. Applies to all types.
        </div>
      </div>

      {/* Draw button */}
      <div className="flex items-center gap-2">
        <Button size="small" icon={<Crosshair size={13} />}
          onClick={() => onStartDraw(drawType, 'buffer')}
          className="flex-1"
          type={effectiveRaw ? 'default' : 'primary'}
          disabled={!enabled || !layerId}
        >
          {effectiveRaw ? 'Redraw on Map' : 'Draw on Map'}
        </Button>
        {effectiveRaw && (
          <Tooltip title="Clear geometry">
            <Button size="small" danger icon={<Trash2 size={13} />} onClick={reset} disabled={!enabled} />
          </Tooltip>
        )}
      </div>

      {/* Status */}
      {bufferError && <div className="text-[11px] text-red-500">{bufferError}</div>}
      {bufferedGeometry && !bufferError && (
        <Tag color="purple" className="text-xs w-full whitespace-normal h-auto py-1.5 flex items-center">
          ✓ Buffer ready — {radius !== null && radius >= 1000 ? `${radius / 1000}km` : `${radius ?? 0}m`} ({drawType.toLowerCase()})
        </Tag>
      )}
    </div>
  );
});

BufferSection.displayName = 'BufferSection';
export default BufferSection;
