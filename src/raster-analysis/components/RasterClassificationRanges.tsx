// ============================================================================
// Raster Reclassification Ranges Component
//
// Form editor for raster reclassification (ras:RangeLookup):
// - Lets users define numeric range bins (min, max) -> mapped output value
// - Example: Elevation 0-500m -> Class 1, 500-1000m -> Class 2
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Button, InputNumber, Tooltip } from 'antd';
import { Plus, Trash2, Info } from 'lucide-react';

export interface ClassificationRange {
  min: number | null;
  max: number | null;
  output: number;
}

interface RasterClassificationRangesProps {
  value: ClassificationRange[];
  onChange: (ranges: ClassificationRange[]) => void;
  disabled?: boolean;
}

export default function RasterClassificationRanges({
  value,
  onChange,
  disabled = false
}: RasterClassificationRangesProps) {

  const handleAdd = () => {
    const last = value[value.length - 1];
    const newMin = last?.max ?? 0;
    onChange([
      ...value,
      { min: newMin, max: (newMin ?? 0) + 100, output: value.length + 1 }
    ]);
  };

  const handleRemove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  const handleChange = (idx: number, field: keyof ClassificationRange, val: any) => {
    const updated = [...value];
    updated[idx] = { ...updated[idx], [field]: val };
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 font-medium">Value ranges → output class:</span>
        <Tooltip title="Each row maps a range of pixel values to an output integer class.">
          <Info size={12} className="text-gray-400 cursor-help shrink-0" />
        </Tooltip>
      </div>

      {/* Table */}
      <div className="flex flex-col gap-0 border border-gray-200 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1fr_48px_28px] bg-gray-100 px-2 py-1.5 gap-1">
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider truncate">Min</span>
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider truncate">Max</span>
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider text-center truncate">Out</span>
          <span />
        </div>

        {/* Rows */}
        <div className="flex flex-col divide-y divide-gray-100">
          {value.map((range, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_1fr_48px_28px] items-center gap-1 px-2 py-1.5"
            >
              <InputNumber
                value={range.min ?? undefined}
                onChange={(v) => handleChange(idx, 'min', v)}
                placeholder="−∞"
                size="small"
                disabled={disabled}
                className="w-full text-xs min-w-0"
                controls={false}
              />
              <InputNumber
                value={range.max ?? undefined}
                onChange={(v) => handleChange(idx, 'max', v)}
                placeholder="+∞"
                size="small"
                disabled={disabled}
                className="w-full text-xs min-w-0"
                controls={false}
              />
              <InputNumber
                value={range.output}
                onChange={(v) => handleChange(idx, 'output', v ?? idx + 1)}
                min={0}
                size="small"
                disabled={disabled}
                className="w-full text-xs min-w-0"
                controls={false}
              />
              <Button
                type="text"
                size="small"
                icon={<Trash2 size={11} className="text-red-400" />}
                onClick={() => handleRemove(idx)}
                disabled={disabled || value.length <= 1}
                className="h-6 w-6 flex items-center justify-center hover:bg-red-50 rounded p-0 shrink-0"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Add button */}
      <Button
        type="dashed"
        icon={<Plus size={12} />}
        onClick={handleAdd}
        disabled={disabled}
        size="small"
        className="w-full rounded-lg text-xs"
      >
        Add Range
      </Button>

      {/* Preview */}
      {value.length > 0 && (
        <div className="text-[10px] text-gray-400 bg-gray-50 rounded-lg px-2 py-1.5 leading-relaxed break-words">
          {value.map((r, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1 text-gray-300">|</span>}
              <span className="font-mono whitespace-nowrap">
                [{r.min ?? '−∞'}, {r.max ?? '+∞'}]→{r.output}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Serializes the classification ranges array to the XML format
 * expected by GeoServer ras:RangeLookup's classificationRanges input.
 */
export function serializeClassificationRanges(ranges: ClassificationRange[]): string {
  const rangeXml = ranges.map(r => {
    const minVal = r.min !== null && r.min !== undefined ? r.min : '-Infinity';
    const maxVal = r.max !== null && r.max !== undefined ? r.max : 'Infinity';
    return `    <RangeData>
      <min>${minVal}</min>
      <max>${maxVal}</max>
      <value>${r.output}</value>
    </RangeData>`;
  }).join('\n');

  return `<RangeLookupTable>\n  <lookupRanges>\n${rangeXml}\n  </lookupRanges>\n</RangeLookupTable>`;
}
