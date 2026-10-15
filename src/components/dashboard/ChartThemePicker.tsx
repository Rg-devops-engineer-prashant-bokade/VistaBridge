// ============================================================================
// ChartThemePicker Component (Chart Color Palette Selector)
//
// In dashboard design, consistent color palettes make charts easy to read:
// - Provides preset color palettes (Default, Ocean, Sunset, Forest, Neon, Warm)
// - Displays a clickable preview of palette color swatches
// - Emits selected theme ID and color tokens to the chart configuration
// ============================================================================

'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { CHART_THEMES, ChartTheme } from '@/config/chartThemes';

export interface ChartThemeValue {
  colorTheme?: string;
  customColors?: string[];
  primaryColor?: string;
  colorMode?: 'palette' | 'single';
  categoryColors?: Record<string, string>;
}

interface Props {
  value?: ChartThemeValue;
  onChange?: (val: ChartThemeValue) => void;
  chartType?: string;
  compact?: boolean;
}

export default function ChartThemePicker({ value = {}, onChange }: Props) {
  const currentThemeId = value.colorTheme || 'default';

  const handleSelectPreset = (theme: ChartTheme) => {
    if (onChange) {
      onChange({
        ...value,
        colorTheme: theme.id,
        customColors: undefined,
        primaryColor: theme.primary,
        colorMode: 'palette',
        categoryColors: undefined,
      });
    }
  };

  return (
    <div className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto pr-1">
      {CHART_THEMES.map((theme) => {
        const isSelected = currentThemeId === theme.id;
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => handleSelectPreset(theme)}
            className={`w-full flex items-center justify-between p-2 rounded-xl border text-left transition-all cursor-pointer ${
              isSelected
                ? 'border-indigo-500 bg-indigo-50/80 shadow-xs ring-1 ring-indigo-400/30'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/70'
            }`}
          >
            <div className="flex flex-col min-w-0 pr-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-800 truncate">{theme.name}</span>
                {isSelected && <Check size={12} className="text-indigo-600 shrink-0" />}
              </div>
              <span className="text-[10px] text-gray-400 truncate">{theme.description}</span>
            </div>

            {/* Multi-Color Palette Swatches */}
            <div className="flex items-center gap-1 shrink-0">
              {theme.palette.slice(0, 6).map((color, idx) => (
                <span
                  key={idx}
                  className="w-3.5 h-3.5 rounded-full border border-black/10 shadow-2xs shrink-0"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}



