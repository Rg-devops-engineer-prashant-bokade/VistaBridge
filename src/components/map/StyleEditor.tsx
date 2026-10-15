// ============================================================================
// StyleEditor Component (Layer Styling & Symbology)
//
// In GIS, "Symbology" defines how data looks visually on the map:
// - Vector Layers: Point markers (circles/squares), line colors & widths,
//   polygon fill colors & opacity, and feature labels.
// - Raster Layers: Multi-band satellite imagery (mapping Red, Green, Blue bands),
//   or single-band elevation/DEM color ramps (grayscale, terrain, viridis).
//
// This component provides the UI controls for customizing these styles in real-time.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Select, Input, Divider } from 'antd';

interface StyleEditorProps {
  layer: {
    id: string;
    name: string;
    type: 'VECTOR' | 'RASTER';
  };
  schema: Record<string, string>;
  geometryType?: string | null;
  styleConfig: any;
  onChange: (newConfig: any) => void;
}

export default function StyleEditor({
  layer,
  schema = {},
  geometryType = null,
  styleConfig = {},
  onChange
}: StyleEditorProps) {
  const bandKeys = Object.keys(schema).filter(k => k.startsWith('band_'));
  const isMultiBand = bandKeys.length > 1;

  const getBandLabel = (bk: string) => {
    const val = schema[bk] as any;
    if (!val) return `Band ${bk.replace('band_', '')}`;
    if (typeof val === 'object') {
      const name = val.band_name || val.color_interp;
      if (name) {
        return `${name} (Band ${val.band_number ?? bk.replace('band_', '')})`;
      }
      return `Band ${val.band_number ?? bk.replace('band_', '')}`;
    }
    return String(val);
  };

  const handleUpdate = (updates: Partial<typeof styleConfig>) => {
    onChange({
      ...styleConfig,
      ...updates
    });
  };

  const _hexToRgba = (hex: string, opacity: number) => {
    let c = hex.substring(1);
    if (c.length === 3) {
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
        <div className="text-[10px] text-gray-400 uppercase font-bold mb-1">Active Layer</div>
        <div className="text-xs font-bold text-gray-700 truncate">{layer.name}</div>
      </div>

      {layer.type === 'RASTER' ? (
        <div className="flex flex-col gap-4">
          {isMultiBand ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Red Channel (R)</label>
                <Select
                  value={styleConfig.redBand || 'band_1'}
                  onChange={(val) => handleUpdate({ mode: 'multiband', redBand: val })}
                  options={bandKeys.map(bk => ({
                    value: bk,
                    label: getBandLabel(bk)
                  }))}
                  className="w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Green Channel (G)</label>
                <Select
                  value={styleConfig.greenBand || 'band_2'}
                  onChange={(val) => handleUpdate({ mode: 'multiband', greenBand: val })}
                  options={bandKeys.map(bk => ({
                    value: bk,
                    label: getBandLabel(bk)
                  }))}
                  className="w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Blue Channel (B)</label>
                <Select
                  value={styleConfig.blueBand || 'band_3'}
                  onChange={(val) => handleUpdate({ mode: 'multiband', blueBand: val })}
                  options={bandKeys.map(bk => ({
                    value: bk,
                    label: getBandLabel(bk)
                  }))}
                  className="w-full"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {bandKeys.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Select Band</label>
                  <Select
                    value={styleConfig.band || bandKeys[0] || 'band_1'}
                    onChange={(val) => handleUpdate({ mode: 'single_band', band: val })}
                    options={bandKeys.map(bk => ({
                      value: bk,
                      label: getBandLabel(bk)
                    }))}
                    className="w-full"
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Contrast Stretch (Rescale)</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400 font-bold">Min</span>
                    <input
                      type="number"
                      value={styleConfig.rescaleMin ?? 0}
                      onChange={(e) => handleUpdate({ mode: 'single_band', rescaleMin: parseFloat(e.target.value) || 0 })}
                      className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-primary font-mono bg-white"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400 font-bold">Max</span>
                    <input
                      type="number"
                      value={styleConfig.rescaleMax ?? 255}
                      onChange={(e) => handleUpdate({ mode: 'single_band', rescaleMax: parseFloat(e.target.value) || 0 })}
                      className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-primary font-mono bg-white"
                    />
                  </div>
                </div>
                {schema[styleConfig.band || 'band_1'] && (
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    Dataset Range: <span className="font-mono font-bold text-gray-500">{(schema[styleConfig.band || 'band_1'] as any).min ?? 0}</span> to <span className="font-mono font-bold text-gray-500">{(schema[styleConfig.band || 'band_1'] as any).max ?? 255}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Color Ramp</label>
                <Select
                  value={styleConfig.colormapName || 'gray'}
                  onChange={(val) => handleUpdate({ mode: 'single_band', colormapName: val })}
                  options={[
                    { value: 'gray', label: 'Grayscale' },
                    { value: 'terrain', label: 'Terrain' },
                    { value: 'viridis', label: 'Viridis' },
                    { value: 'rainbow', label: 'Rainbow' },
                    { value: 'plasma', label: 'Plasma' },
                    { value: 'magma', label: 'Magma' },
                    { value: 'inferno', label: 'Inferno' },
                    { value: 'cividis', label: 'Cividis' }
                  ]}
                  className="w-full"
                />
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Symbol Mode</label>
            <Select
              showSearch
              filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
              value={styleConfig.mode || 'single'}
              onChange={(val) => handleUpdate({ mode: val })}
              options={[
                { value: 'single', label: 'Single Symbol' },
                { value: 'categorized', label: 'Categorized' },
                { value: 'graduated', label: 'Graduated' }
              ]}
              className="w-full"
            />
          </div>

          <Divider className="my-1 bg-gray-100" />

          <div className="flex flex-col gap-4 bg-gray-50/50 border border-gray-100 rounded-xl p-3">
            <div className="text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-1">Stroke / Line Outline</div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Line Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={styleConfig.strokeColor || '#ff4d4f'}
                  onChange={(e) => handleUpdate({ strokeColor: e.target.value })}
                  className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
                />
                <Input
                  size="small"
                  value={styleConfig.strokeColor || '#ff4d4f'}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                      handleUpdate({ strokeColor: val });
                    }
                  }}
                  className="font-mono text-xs uppercase text-gray-700"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Line Width</label>
                <span className="text-[11px] font-mono text-gray-500 font-bold">{(styleConfig.strokeWidth ?? 1.5).toFixed(1)}px</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={styleConfig.strokeWidth ?? 1.5}
                onChange={(e) => handleUpdate({ strokeWidth: parseFloat(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Line Dash Type</label>
              <Select
                showSearch
                value={
                  ['', '5 5', '2 5', '5 3 2 3'].includes(styleConfig.lineDash || '')
                    ? (styleConfig.lineDash || '')
                    : 'custom'
                }
                onChange={(val) => {
                  const nextDash = val === 'custom' ? '5 3 4 1' : val;
                  handleUpdate({ lineDash: nextDash });
                }}
                options={[
                  { value: '', label: 'Solid' },
                  { value: '5 5', label: 'Dashed (5 5)' },
                  { value: '2 5', label: 'Dotted (2 5)' },
                  { value: '5 3 2 3', label: 'Dash-Dot (5 3 2 3)' },
                  { value: 'custom', label: 'Custom Pattern' }
                ]}
                className="w-full"
              />
              {!['', '5 5', '2 5', '5 3 2 3'].includes(styleConfig.lineDash || '') && (
                <div className="mt-1 flex flex-col gap-1">
                  <span className="text-[10px] text-gray-400">Enter space-separated numbers:</span>
                  <Input
                    size="small"
                    placeholder="e.g. 5 3 4 1"
                    value={styleConfig.lineDash || ''}
                    onChange={(e) => handleUpdate({ lineDash: e.target.value })}
                    className="font-mono text-xs text-gray-700"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-3">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Line Opacity (Stroke)</label>
                <span className="text-[11px] font-mono text-gray-500 font-bold">{Math.round((styleConfig.strokeOpacity ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={styleConfig.strokeOpacity ?? 1}
                onChange={(e) => handleUpdate({ strokeOpacity: parseFloat(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>

            <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-3">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Fill Opacity</label>
                <span className="text-[11px] font-mono text-gray-500 font-bold">{Math.round((styleConfig.fillOpacity ?? 0.1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={styleConfig.fillOpacity ?? 0.1}
                onChange={(e) => handleUpdate({ fillOpacity: parseFloat(e.target.value) })}
                className="w-full accent-primary"
              />
            </div>
          </div>

          {geometryType?.toLowerCase().includes('point') && (
            <div className="flex flex-col gap-4 bg-gray-50/50 border border-gray-100 rounded-xl p-3">
              <div className="text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-1">Point / Marker Settings</div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Point Shape / Icon</label>
                <Select
                  showSearch
                  value={styleConfig.pointIcon || 'circle'}
                  onChange={(val) => handleUpdate({ pointIcon: val })}
                  options={[
                    { value: 'circle', label: 'Circle Point' },
                    { value: 'marker', label: 'Pin Marker' },
                    { value: 'star', label: 'Star Icon' },
                    { value: 'square', label: 'Square Icon' },
                    { value: 'flag', label: 'Flag Icon' }
                  ]}
                  className="w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Point Size</label>
                  <span className="text-[11px] font-mono text-gray-500 font-bold">{styleConfig.pointSize ?? 8}px</span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="30"
                  step="1"
                  value={styleConfig.pointSize ?? 8}
                  onChange={(e) => handleUpdate({ pointSize: parseInt(e.target.value) })}
                  className="w-full accent-primary"
                />
              </div>
            </div>
          )}

          {styleConfig.mode === 'single' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Fill Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={styleConfig.fillColor || '#ff4d4f'}
                    onChange={(e) => handleUpdate({ fillColor: e.target.value })}
                    className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
                  />
                  <Input
                    size="small"
                    value={styleConfig.fillColor || '#ff4d4f'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                        handleUpdate({ fillColor: val });
                      }
                    }}
                    className="font-mono text-xs uppercase text-gray-700"
                  />
                </div>
              </div>
            </div>
          )}

          {styleConfig.mode === 'categorized' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Column (Attribute)</label>
                <Select
                  showSearch
                  filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                  value={styleConfig.categorizeField || Object.keys(schema)[0] || ''}
                  onChange={(val) => handleUpdate({ categorizeField: val })}
                  options={Object.keys(schema).map(field => ({
                    value: field,
                    label: `${field} (${schema[field] || 'Unknown'})`
                  }))}
                  className="w-full"
                />
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700 leading-relaxed flex flex-col gap-1">
                <span className="font-bold uppercase tracking-wider text-[9px] text-blue-800">Dynamic Classification</span>
                Features are categorized and styled with unique colors computed dynamically using stable string hashing of the selected column values.
              </div>
            </div>
          )}

          {styleConfig.mode === 'graduated' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Numeric Column</label>
                <Select
                  showSearch
                  filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                  value={styleConfig.graduatedField || ''}
                  onChange={(val) => handleUpdate({ graduatedField: val })}
                  options={Object.keys(schema).map(field => ({
                    value: field,
                    label: `${field} (${schema[field] || 'Unknown'})`
                  }))}
                  className="w-full"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex flex-col gap-1.5 w-1/2">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Min Value</label>
                  <Input
                    type="number"
                    size="small"
                    value={styleConfig.graduatedMinVal ?? 0}
                    onChange={(e) => handleUpdate({ graduatedMinVal: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="flex flex-col gap-1.5 w-1/2">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Max Value</label>
                  <Input
                    type="number"
                    size="small"
                    value={styleConfig.graduatedMaxVal ?? 100}
                    onChange={(e) => handleUpdate({ graduatedMaxVal: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Color Ramp Start</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={styleConfig.graduatedColorStart || '#fee8c8'}
                    onChange={(e) => handleUpdate({ graduatedColorStart: e.target.value })}
                    className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
                  />
                  <Input
                    size="small"
                    value={styleConfig.graduatedColorStart || '#fee8c8'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                        handleUpdate({ graduatedColorStart: val });
                      }
                    }}
                    className="font-mono text-xs uppercase text-gray-700"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Color Ramp End</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={styleConfig.graduatedColorEnd || '#e34a33'}
                    onChange={(e) => handleUpdate({ graduatedColorEnd: e.target.value })}
                    className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
                  />
                  <Input
                    size="small"
                    value={styleConfig.graduatedColorEnd || '#e34a33'}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                        handleUpdate({ graduatedColorEnd: val });
                      }
                    }}
                    className="font-mono text-xs uppercase text-gray-700"
                  />
                </div>
              </div>
            </div>
          )}

          <Divider className="my-1 bg-gray-100" />

          <div className="flex flex-col gap-4 bg-gray-50/50 border border-gray-100 rounded-xl p-3">
            <div className="text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-1">Feature Labeling</div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Label Column</label>
              <Select
                showSearch
                placeholder="Select Column"
                value={styleConfig.labelField || ''}
                onChange={(val) => handleUpdate({ labelField: val })}
                options={[
                  { value: '', label: 'No Label' },
                  ...Object.keys(schema).map(col => ({ value: col, label: col }))
                ]}
                className="w-full"
              />
            </div>

            {styleConfig.labelField && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Label Frequency</label>
                  <Select
                    value={styleConfig.labelRepeat || 'once'}
                    onChange={(val) => handleUpdate({ labelRepeat: val as any })}
                    options={[
                      { value: 'once', label: 'Show Once' },
                      { value: 'repeat', label: 'Show Multiple Times (Repeat)' }
                    ]}
                    className="w-full"
                  />
                </div>

                {styleConfig.labelRepeat === 'repeat' && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Repeat Interval</label>
                      <span className="text-[11px] font-mono text-gray-500 font-bold">{styleConfig.labelRepeatSpacing ?? 300}px</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="1000"
                      step="50"
                      value={styleConfig.labelRepeatSpacing ?? 300}
                      onChange={(e) => handleUpdate({ labelRepeatSpacing: parseInt(e.target.value) })}
                      className="w-full accent-primary"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Font Size</label>
                    <span className="text-[11px] font-mono text-gray-500 font-bold">{styleConfig.labelSize ?? 12}px</span>
                  </div>
                  <input
                    type="range"
                    min="8"
                    max="24"
                    step="1"
                    value={styleConfig.labelSize ?? 12}
                    onChange={(e) => handleUpdate({ labelSize: parseInt(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Text Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={styleConfig.labelColor || '#000000'}
                      onChange={(e) => handleUpdate({ labelColor: e.target.value })}
                      className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
                    />
                    <Input
                      size="small"
                      value={styleConfig.labelColor || '#000000'}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                          handleUpdate({ labelColor: val });
                        }
                      }}
                      className="font-mono text-xs uppercase text-gray-700"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">X Position</label>
                      <span className="text-[10px] font-mono text-gray-500 font-bold">{styleConfig.labelOffsetX ?? 0}px</span>
                    </div>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      step="1"
                      value={styleConfig.labelOffsetX ?? 0}
                      onChange={(e) => handleUpdate({ labelOffsetX: parseInt(e.target.value) })}
                      className="w-full accent-primary"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Y Position</label>
                      <span className="text-[10px] font-mono text-gray-500 font-bold">{styleConfig.labelOffsetY ?? 0}px</span>
                    </div>
                    <input
                      type="range"
                      min="-50"
                      max="50"
                      step="1"
                      value={styleConfig.labelOffsetY ?? 0}
                      onChange={(e) => handleUpdate({ labelOffsetY: parseInt(e.target.value) })}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">X Anchor</label>
                    <Select
                      value={styleConfig.labelAlign || 'center'}
                      onChange={(val) => handleUpdate({ labelAlign: val })}
                      options={[
                        { value: 'left', label: 'Left' },
                        { value: 'center', label: 'Center' },
                        { value: 'right', label: 'Right' }
                      ]}
                      size="small"
                      className="w-full"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Y Anchor</label>
                    <Select
                      value={styleConfig.labelBaseline || 'middle'}
                      onChange={(val) => handleUpdate({ labelBaseline: val })}
                      options={[
                        { value: 'top', label: 'Top' },
                        { value: 'middle', label: 'Middle' },
                        { value: 'bottom', label: 'Bottom' }
                      ]}
                      size="small"
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-3">
                  <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Outline Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={styleConfig.labelOutlineColor || '#ffffff'}
                      onChange={(e) => handleUpdate({ labelOutlineColor: e.target.value })}
                      className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0 bg-transparent"
                    />
                    <Input
                      size="small"
                      value={styleConfig.labelOutlineColor || '#ffffff'}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                          handleUpdate({ labelOutlineColor: val });
                        }
                      }}
                      className="font-mono text-xs uppercase text-gray-700"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">Outline Width</label>
                    <span className="text-[11px] font-mono text-gray-500 font-bold">{styleConfig.labelOutlineWidth ?? 2}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={styleConfig.labelOutlineWidth ?? 2}
                    onChange={(e) => handleUpdate({ labelOutlineWidth: parseFloat(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
