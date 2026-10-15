// ============================================================================
// Raster Geometry Input Component
//
// Allows users to provide a spatial geometry (ROI / crop shape) for raster operations:
// 1. Draw directly on the map (Box, Polygon, Point, or Line)
// 2. Or pick an existing vector layer from the active map
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Button, Select } from 'antd';
import { Square, PenTool, CheckCircle2, RotateCcw, Trash2, Layers } from 'lucide-react';
import { LayerState } from '../types/rasterAnalysis';

interface RasterGeometryInputProps {
  value: any;
  onChange: (geom: any) => void;
  onStartDraw: (drawType: 'Box' | 'Polygon' | 'Point' | 'LineString', callback: (geojson: any) => void) => void;
  onStopDraw?: () => void;
  allowedTypes?: ('Box' | 'Polygon' | 'Point' | 'LineString')[];
  addedLayers?: LayerState[];
  disabled?: boolean;
}

export default function RasterGeometryInput({
  value,
  onChange,
  onStartDraw,
  onStopDraw,
  allowedTypes = ['Box', 'Polygon'],
  addedLayers = [],
  disabled = false
}: RasterGeometryInputProps) {

  const handleStart = (type: 'Box' | 'Polygon' | 'Point' | 'LineString') => {
    if (disabled) return;
    onStartDraw(type, (capturedGeoJson) => {
      onChange(capturedGeoJson);
    });
  };

  const handleClear = () => {
    onChange(null);
    onStopDraw?.();
  };

  const hasGeometry = Boolean(value);
  const isSelectedLayerString = typeof value === 'string';
  const vectorLayers = addedLayers.filter(l => l.type === 'VECTOR');

  return (
    <div className="flex flex-col gap-2 w-full">
      {hasGeometry ? (
        <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50/80 text-emerald-800 px-3 py-2 rounded-xl text-xs">
          <span className="flex items-center gap-1.5 font-medium truncate">
            <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
            {isSelectedLayerString
              ? `Selected Layer: ${addedLayers.find(l => l.id === value)?.name || value}`
              : 'Geometry Captured on Map'}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {!isSelectedLayerString && (
              <Button
                type="text"
                size="small"
                icon={<RotateCcw size={12} className="text-emerald-700" />}
                onClick={() => handleStart(allowedTypes[0] || 'Box')}
                disabled={disabled}
                className="h-6 hover:bg-emerald-100 flex items-center justify-center rounded text-[11px]"
              >
                Redraw
              </Button>
            )}
            <Button
              type="text"
              size="small"
              icon={<Trash2 size={12} className="text-red-500" />}
              onClick={handleClear}
              disabled={disabled}
              className="h-6 hover:bg-red-50 flex items-center justify-center rounded text-[11px]"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 w-full">
          {vectorLayers.length > 0 && (
            <div className="flex flex-col gap-1 w-full">
              <div className="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                <Layers size={12} className="text-blue-500" />
                Select existing vector layer as zones:
              </div>
              <Select
                placeholder="Choose vector zone layer..."
                value={isSelectedLayerString ? value : undefined}
                onChange={(layerId) => onChange(layerId)}
                allowClear
                disabled={disabled}
                className="w-full text-xs rounded-lg"
                options={vectorLayers.map(l => ({
                  value: l.id,
                  label: l.name
                }))}
              />
              <div className="text-[10px] text-gray-400 text-center py-0.5">— OR —</div>
            </div>
          )}

          <div className="flex flex-col gap-1.5 w-full">
            <div className="text-[11px] text-gray-500 font-medium">
              Draw zone boundary on the map:
            </div>
            <div className="flex flex-col gap-1.5 w-full">
              {allowedTypes.includes('Box') && (
                <Button
                  type="dashed"
                  icon={<Square size={13} className="text-gray-500 shrink-0" />}
                  onClick={() => handleStart('Box')}
                  disabled={disabled}
                  className="flex items-center justify-center gap-1.5 text-xs h-9 rounded-xl text-gray-700 hover:text-primary hover:border-primary font-medium w-full"
                >
                  Draw Rectangle
                </Button>
              )}
              {allowedTypes.includes('Polygon') && (
                <Button
                  type="dashed"
                  icon={<PenTool size={13} className="text-gray-500 shrink-0" />}
                  onClick={() => handleStart('Polygon')}
                  disabled={disabled}
                  className="flex items-center justify-center gap-1.5 text-xs h-9 rounded-xl text-gray-700 hover:text-primary hover:border-primary font-medium w-full"
                >
                  Draw Polygon
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
