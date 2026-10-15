// ============================================================================
// Chart Color Themes & Palettes Catalog (chartThemes.ts)
//
// Curated color themes designed for data readability and contrast:
// - Vibrant Multi-Spectrum, Modern Prism, Emerald Forest, Sunset Glow, Neon Night
// - Provides color resolution functions to map categorical series labels to distinct hex colors
// ============================================================================

export interface ChartTheme {
  id: string;
  name: string;
  description: string;
  primary: string;
  palette: string[];
}

export const CHART_THEMES: ChartTheme[] = [
  {
    id: 'default',
    name: 'Vibrant Multi-Spectrum',
    description: 'High-contrast full chromatic rainbow for any number of fields',
    primary: '#6818d2',
    palette: [
      '#6818d2', '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
      '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9a6324', '#800000', '#aaffc3',
      '#808000', '#ffd8b1', '#000075', '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
      '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#a855f7',
      '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#0891b2', '#16a34a', '#ca8a04', '#2563eb',
      '#7c3aed', '#db2777', '#0d9488', '#ea580c', '#65a30d', '#0284c7', '#9333ea', '#15803d',
      '#b45309', '#1d4ed8', '#6d28d9', '#be185d', '#0f766e', '#c2410c', '#4338ca', '#4d7c0f',
      '#0369a1', '#7e22ce', '#166534', '#92400e', '#1e40af', '#5b21b6', '#9d174d', '#134e4a',
    ],
  },
  {
    id: 'prism',
    name: 'Modern Prism (Analytics)',
    description: 'Mathematically spaced high-contrast palette for dense charts',
    primary: '#2563eb',
    palette: [
      '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#ca8a04',
      '#059669', '#4f46e5', '#ea580c', '#0284c7', '#7c3aed', '#65a30d', '#e11d48', '#0d9488',
      '#b45309', '#6366f1', '#c026d3', '#15803d', '#f43f5e', '#0284c7', '#8b5cf6', '#d946ef',
      '#047857', '#eab308', '#ec4899', '#3b82f6', '#10b981', '#f97316', '#a855f7', '#14b8a6',
      '#ef4444', '#84cc16', '#06b6d4', '#be185d', '#e6194b', '#3cb44b', '#ffe119', '#4363d8',
      '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff',
      '#9a6324', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#1e40af',
      '#166534', '#92400e', '#581c87', '#0369a1', '#9d174d', '#3f6212', '#991b1b', '#0e7490',
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean Reef & Marine',
    description: 'Crisp blues, cyans, coral pinks, gold, and tropical teals',
    primary: '#0284c7',
    palette: [
      '#0284c7', '#14b8a6', '#f43f5e', '#eab308', '#06b6d4', '#6366f1', '#10b981', '#f97316',
      '#3b82f6', '#0d9488', '#ec4899', '#ca8a04', '#0891b2', '#8b5cf6', '#22c55e', '#ef4444',
      '#2563eb', '#0f766e', '#d946ef', '#b45309', '#0e7490', '#7c3aed', '#16a34a', '#ea580c',
      '#1d4ed8', '#115e59', '#db2777', '#c2410c', '#0369a1', '#9333ea', '#15803d', '#dc2626',
      '#1e40af', '#134e4a', '#be185d', '#9a3412', '#075985', '#6d28d9', '#047857', '#e11d48',
      '#38bdf8', '#2dd4bf', '#fb7185', '#fde047', '#22d3ee', '#818cf8', '#34d399', '#fb923c',
      '#60a5fa', '#5eead4', '#f472b6', '#fef08a', '#67e8f9', '#a78bfa', '#4ade80', '#fdba74',
      '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#014f86', '#2a6f97', '#2c7da0',
    ],
  },
  {
    id: 'emerald',
    name: 'Emerald Botanic',
    description: 'Lush botanic greens, sunflower golds, poppy reds, and sky blues',
    primary: '#10b981',
    palette: [
      '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#ec4899', '#3b82f6',
      '#14b8a6', '#eab308', '#a855f7', '#f97316', '#0ea5e9', '#22c55e', '#d946ef', '#2563eb',
      '#059669', '#ca8a04', '#7c3aed', '#ea580c', '#0284c7', '#16a34a', '#db2777', '#4f46e5',
      '#047857', '#b45309', '#9333ea', '#c2410c', '#0369a1', '#15803d', '#be185d', '#6366f1',
      '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#a3e635', '#f472b6', '#60a5fa',
      '#2dd4bf', '#fde047', '#c084fc', '#fb923c', '#38bdf8', '#4ade80', '#e879f9', '#93c5fd',
      '#2d6a4f', '#40916c', '#52b788', '#74c69d', '#95d5b2', '#1b4332', '#38b000', '#70e000',
      '#004d40', '#00695c', '#00796b', '#00897b', '#009688', '#26a69a', '#4db6ac', '#80cbc4',
    ],
  },
  {
    id: 'sunset',
    name: 'Sunset Mirage',
    description: 'Fiery crimsons, amber golds, dusk purples, and desert turquoises',
    primary: '#f97316',
    palette: [
      '#f97316', '#6366f1', '#10b981', '#ef4444', '#06b6d4', '#eab308', '#d946ef', '#3b82f6',
      '#ea580c', '#8b5cf6', '#14b8a6', '#f43f5e', '#0ea5e9', '#ca8a04', '#ec4899', '#2563eb',
      '#c2410c', '#7c3aed', '#0d9488', '#e11d48', '#0284c7', '#b45309', '#db2777', '#4f46e5',
      '#9a3412', '#9333ea', '#0f766e', '#dc2626', '#0369a1', '#92400e', '#be185d', '#1d4ed8',
      '#fb923c', '#818cf8', '#34d399', '#f87171', '#22d3ee', '#fde047', '#e879f9', '#60a5fa',
      '#fdba74', '#a78bfa', '#2dd4bf', '#fb7185', '#38bdf8', '#fef08a', '#f472b6', '#93c5fd',
      '#ff4d4f', '#ff7a45', '#ffa940', '#ffc53d', '#ffec3d', '#fa541c', '#fa8c16', '#faad14',
      '#d4380d', '#d46b08', '#d48806', '#d4b106', '#ad2102', '#ad4e00', '#ad6800', '#ad8b00',
    ],
  },
  {
    id: 'pastel',
    name: 'Soft Modern Pastel',
    description: 'Delicate harmonious pastel rainbow with distinct contrast',
    primary: '#818cf8',
    palette: [
      '#818cf8', '#f472b6', '#6ee7b7', '#fde047', '#38bdf8', '#fb923c', '#a78bfa', '#f87171',
      '#2dd4bf', '#fbbf24', '#c084fc', '#60a5fa', '#a3e635', '#fb7185', '#22d3ee', '#e879f9',
      '#4ade80', '#fdba74', '#d8b4fe', '#93c5fd', '#bef264', '#fda4af', '#67e8f9', '#f0abfc',
      '#86efac', '#fed7aa', '#e9d5ff', '#bfdbfe', '#d9f99d', '#fecdd3', '#a5f3fc', '#f9a8d4',
      '#b5e2fa', '#f7a072', '#eddea4', '#83c5be', '#ffddd2', '#cdb4db', '#ffc8dd', '#a2d2ff',
      '#d8e2dc', '#ffcad4', '#f4acb7', '#bde0fe', '#e8dff5', '#fce1e4', '#fcf4dd', '#daeaf6',
      '#a5b4fc', '#f9a8d4', '#a7f3d0', '#fef08a', '#7dd3fc', '#fdba74', '#c4b5fd', '#fca5a5',
      '#5eead4', '#fde68a', '#d8b4fe', '#93c5fd', '#bef264', '#fecaca', '#67e8f9', '#f0abfc',
    ],
  },
];

export function getChartTheme(themeId?: string): ChartTheme {
  if (!themeId) return CHART_THEMES[0];
  const found = CHART_THEMES.find((t) => t.id === themeId);
  return found || CHART_THEMES[0];
}

export function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map((char) => char + char).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(104, 24, 210, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getColorForLabel(label: string, palette: string[]): string {
  if (!palette || palette.length === 0) return '#6818d2';
  if (!label) return palette[0];
  let hash = 0;
  const str = String(label);
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % palette.length;
  return palette[index];
}

export function resolveChartColors(config?: {
  colorTheme?: string;
  customColors?: string[];
  primaryColor?: string;
  colorMode?: 'palette' | 'single';
  categoryColors?: Record<string, string>;
}): {
  palette: string[];
  primary: string;
  isSingle: boolean;
  themeId: string;
  categoryColors: Record<string, string>;
  getColorForCategory: (label: string, index: number) => string;
} {
  const themeId = config?.colorTheme || 'default';
  const baseTheme = getChartTheme(themeId);
  
  let palette = [...baseTheme.palette];
  if (config?.customColors && config.customColors.length > 0) {
    palette = [...config.customColors];
  }

  const primary = config?.primaryColor || palette[0] || baseTheme.primary;
  const isSingle = config?.colorMode === 'single';
  const categoryColors = config?.categoryColors || {};

  const getColorForCategory = (label: string, index: number): string => {
    if (label && categoryColors[label]) {
      return categoryColors[label];
    }
    if (isSingle) {
      return primary;
    }
    if (palette.length === 0) return primary;
    return palette[index % palette.length];
  };

  return { palette, primary, isSingle, themeId, categoryColors, getColorForCategory };
}


