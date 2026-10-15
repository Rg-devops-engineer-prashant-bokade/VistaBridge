// ============================================================================
// PrintComponent (Map Layout & High-Resolution Export)
//
// In GIS, generating a printable map requires cartographic layout elements:
// - Title, subtitle, author notes, and date
// - North Arrow and dynamic Scale Bar (graphic & text)
// - Legend showing active layer symbols
// - Coordinate graticule (lat/long grid lines along the margins)
// - Paper size templates (A4, A3, Letter) in Portrait or Landscape at 150/300 DPI
//
// This component renders a print preview canvas and exports high-res PDF or PNG files.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */
import 'ol/ol.css';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Modal, Button, Input, Select, Checkbox, Radio, Tooltip, App } from 'antd';
import { Printer, Download, Map as MapIcon } from 'lucide-react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorTileLayer from 'ol/layer/VectorTile';
import Graticule from 'ol/layer/Graticule';
import { Stroke, Fill, Text as OlText } from 'ol/style';
import XYZ from 'ol/source/XYZ';
import OSM from 'ol/source/OSM';
import { useAuthStore } from '@/store/useAuthStore';
import { toLonLat, fromLonLat } from 'ol/proj';
import { DndContext, useDraggable } from '@dnd-kit/core';

// Helper to parse any color string to RGB
const parseColorToRgb = (colorStr: string, defaultColor = { r: 255, g: 255, b: 255, a: 1 }): { r: number, g: number, b: number, a: number } => {
  if (!colorStr) return defaultColor;
  if (colorStr === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const cleanColor = colorStr.trim();

  if (cleanColor.startsWith('#')) {
    const hex = cleanColor.substring(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    } else if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return { r, g, b, a: 1 };
    }
  }

  if (cleanColor.startsWith('rgb')) {
    const match = cleanColor.match(/\d+(\.\d+)?/g);
    if (match && match.length >= 3) {
      return {
        r: parseInt(match[0], 10),
        g: parseInt(match[1], 10),
        b: parseInt(match[2], 10),
        a: match[3] ? parseFloat(match[3]) : 1
      };
    }
  }

  return defaultColor;
};

// Helper to extract style colors from a layer/feature
const getLayerColors = (layer: any, feature: any = null): { strokeColor: string, fillColor: string } => {
  let strokeColor = '#1890ff';
  let fillColor = 'rgba(24, 144, 255, 0.15)';

  try {
    let style = feature && typeof feature.getStyle === 'function' ? feature.getStyle() : null;
    if (!style && layer && typeof layer.getStyle === 'function') {
      style = layer.getStyle();
    }

    if (typeof style === 'function') {
      try {
        let feat = feature;
        if (!feat && layer && typeof layer.getSource === 'function') {
          const source = layer.getSource();
          if (source && typeof source.getFeatures === 'function') {
            const features = source.getFeatures();
            if (features && features.length > 0) {
              feat = features[0];
            }
          }
        }
        const mockFeature = {
          get: (_key: string) => null,
          getId: () => undefined,
          getGeometry: () => ({
            getType: () => 'Polygon',
            getCoordinates: () => []
          }),
          getProperties: () => ({}),
          getStyle: () => null
        };
        style = style(feat || mockFeature);
      } catch (e) {
        console.warn('Error evaluating style function:', e);
      }
    }

    if (Array.isArray(style) && style.length > 0) {
      style = style[0];
    }

    if (style) {
      // Stroke
      if (typeof style.getStroke === 'function') {
        const stroke = style.getStroke();
        if (stroke) {
          const col = stroke.getColor();
          if (col) {
            strokeColor = formatColor(col);
          }
        }
      }
      // Fill
      if (typeof style.getFill === 'function') {
        const fill = style.getFill();
        if (fill) {
          const col = fill.getColor();
          if (col) {
            fillColor = formatColor(col, 0.15);
          }
        }
      }
    }
  } catch (err) {
    console.log('Error extracting colors:', err);
  }

  return { strokeColor, fillColor };
};

const formatColor = (color: any, defaultAlpha: number = 1.0): string => {
  if (Array.isArray(color)) {
    if (color.length === 3) {
      return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${defaultAlpha})`;
    }
    if (color.length === 4) {
      return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;
    }
  }
  if (typeof color === 'string') {
    return color;
  }
  return '#1890ff';
};

const applyPdfColors = (pdf: any, strokeColor: string, fillColor: string) => {
  const parseColor = (colorStr: string): { r: number, g: number, b: number, a: number } => {
    const defaultVal = { r: 24, g: 144, b: 255, a: 1 };
    if (!colorStr) return defaultVal;

    if (colorStr.startsWith('#')) {
      const hex = colorStr.substring(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b, a: 1 };
      } else if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return { r, g, b, a: 1 };
      }
    }

    if (colorStr.startsWith('rgb')) {
      const match = colorStr.match(/\d+(\.\d+)?/g);
      if (match && match.length >= 3) {
        return {
          r: parseInt(match[0], 10),
          g: parseInt(match[1], 10),
          b: parseInt(match[2], 10),
          a: match[3] ? parseFloat(match[3]) : 1
        };
      }
    }

    return defaultVal;
  };

  const blendWithWhite = (color: { r: number, g: number, b: number, a: number }): { r: number, g: number, b: number } => {
    const alpha = color.a;
    return {
      r: Math.round(color.r * alpha + 255 * (1 - alpha)),
      g: Math.round(color.g * alpha + 255 * (1 - alpha)),
      b: Math.round(color.b * alpha + 255 * (1 - alpha))
    };
  };

  const sColor = parseColor(strokeColor);
  pdf.setDrawColor(sColor.r, sColor.g, sColor.b);

  const rawFill = parseColor(fillColor);
  const blendedFill = blendWithWhite(rawFill);
  pdf.setFillColor(blendedFill.r, blendedFill.g, blendedFill.b);
};

const extentsIntersect = (ext1: number[], ext2: number[]): boolean => {
  return ext1[0] <= ext2[2] && ext1[2] >= ext2[0] &&
    ext1[1] <= ext2[3] && ext1[3] >= ext2[1];
};

// Detect whether the active basemap is dark (satellite / dark-matter)
// by inspecting the first tile layer source URL in the map instance.
const isDarkBasemap = (mapInst: Map): boolean => {
  const darkPatterns = [
    'dark_all',           // CartoDB Dark Matter
    'World_Imagery',      // ESRI World Imagery (satellite)
    'lyrs=y',             // Google Hybrid (satellite + roads)
    'lyrs=s',             // Google Satellite
  ];
  let foundDark = false;
  mapInst.getLayers().forEach((layer: any) => {
    if (foundDark) return;
    if (layer instanceof TileLayer) {
      const source = layer.getSource?.();
      if (source) {
        const urls: string[] =
          source.getUrls?.() ||
          (source.getUrl?.() ? [source.getUrl()] : []);
        for (const url of urls) {
          if (darkPatterns.some(p => url.includes(p))) {
            foundDark = true;
            break;
          }
        }
      }
    }
  });
  return foundDark;
};

// Simple map capture function to get exact preview view with slight zoom out
const captureMapAsCanvas = (mapInstance: Map, scale: number, includeNorthArrow: boolean = true): HTMLCanvasElement => {
  const mapElement = mapInstance.getTargetElement() as HTMLElement;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });

  if (!context || !mapElement) {
    throw new Error('Unable to create canvas context');
  }

  const mapSize = mapInstance.getSize();
  if (!mapSize) {
    throw new Error('Unable to get map size');
  }

  canvas.width = mapSize[0];
  canvas.height = mapSize[1];

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Draw all map canvases
  const canvases = mapElement.querySelectorAll('canvas');
  canvases.forEach((mapCanvas) => {
    if (mapCanvas.width > 0 && mapCanvas.height > 0) {
      try {
        context.drawImage(mapCanvas, 0, 0, mapSize[0], mapSize[1]);
      } catch (e) {
        console.warn('Could not draw canvas (CORS issue):', e);
      }
    }
  });

  if (includeNorthArrow) {
    // Add north arrow matching the live preview badge
    const badgeSize = 36 * scale;
    const margin = 10 * scale;
    const badgeX = canvas.width - margin - badgeSize;
    const badgeY = margin;
    const radius = 6 * scale;

    context.save();
    // 1. Draw rounded translucent white badge
    context.beginPath();
    context.moveTo(badgeX + radius, badgeY);
    context.lineTo(badgeX + badgeSize - radius, badgeY);
    context.quadraticCurveTo(badgeX + badgeSize, badgeY, badgeX + badgeSize, badgeY + radius);
    context.lineTo(badgeX + badgeSize, badgeY + badgeSize - radius);
    context.quadraticCurveTo(badgeX + badgeSize, badgeY + badgeSize, badgeX + badgeSize - radius, badgeY + badgeSize);
    context.lineTo(badgeX + radius, badgeY + badgeSize);
    context.quadraticCurveTo(badgeX, badgeY + badgeSize, badgeX, badgeY + badgeSize - radius);
    context.lineTo(badgeX, badgeY + radius);
    context.quadraticCurveTo(badgeX, badgeY, badgeX + radius, badgeY);
    context.closePath();

    context.fillStyle = 'rgba(255, 255, 255, 0.88)';
    context.fill();
    context.strokeStyle = '#d1d5db';
    context.lineWidth = 1 * scale;
    context.stroke();

    // 2. Draw 'N' text
    const centerX = badgeX + badgeSize / 2;
    context.fillStyle = '#1f2937';
    context.font = `bold ${Math.round(8 * scale)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText('N', centerX, badgeY + 4 * scale);

    // 3. Draw chevron polygon arrow matching live preview SVG (points="12,2 17,22 12,17 7,22")
    const arrowTopY = badgeY + 14 * scale;
    const arrowH = 16 * scale;
    const halfW = 4 * scale;
    const notchY = arrowTopY + 12 * scale;

    context.fillStyle = '#1f2937';
    context.strokeStyle = '#1f2937';
    context.lineWidth = 0.8 * scale;
    context.beginPath();
    context.moveTo(centerX, arrowTopY);
    context.lineTo(centerX + halfW, arrowTopY + arrowH);
    context.lineTo(centerX, notchY);
    context.lineTo(centerX - halfW, arrowTopY + arrowH);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  return canvas;
};

interface GeoServerLayerState {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  styles?: Array<{ name: string; title: string; legendUrl: string }>;
  activeStyle?: string;
}

interface PrintComponentProps {
  mapInstance: Map | null;
  addedLayers?: GeoServerLayerState[];
}

interface PrintSettings {
  title: string;
  filename: string;
  pageSize: 'A4' | 'A3' | 'Letter';
  dpi: number;
  includeGraticule: boolean;
  layout: 'portrait' | 'landscape';
  format: 'pdf' | 'jpeg';
  template: 'template1' | 'template2' | 'template3' | 'template4' | 'custom';
  includeLegend: boolean;
  includeNorthArrow: boolean;
  includeOfficeUse: boolean;
  includeScale: boolean;
  scaleType: 'auto' | 'custom';
  customScaleValue: number;
}

const pageSizes = {
  'A4': { width: 210, height: 297, pxWidth: 794, pxHeight: 1123 },
  'A3': { width: 297, height: 420, pxWidth: 1123, pxHeight: 1587 },
  'Letter': { width: 216, height: 279, pxWidth: 816, pxHeight: 1054 }
};

const dpiOptions = [
  { label: '72 DPI (Web)', value: 72 },
  { label: '150 DPI (Draft)', value: 150 },
  { label: '300 DPI (Print)', value: 300 },
  { label: '600 DPI (High)', value: 600 }
];

const landscapeTemplates = [
  { value: 'template1', label: 'Details on Right' },
  { value: 'template3', label: 'Details on Left' },
  { value: 'custom', label: 'Add New Template (Custom)' }
];

const portraitTemplates = [
  { value: 'template2', label: 'Details Below Map' },
  { value: 'template4', label: 'Details Above Map' },
  { value: 'custom', label: 'Add New Template (Custom)' }
];

const scaleOptions = [
  { label: 'Auto (Fit View)', value: 'auto' },
  { label: '1:2,500', value: '2500' },
  { label: '1:25,000', value: '25000' },
  { label: '1:250,000', value: '250000' },
  { label: '1:500,000 (Regional)', value: '500000' }
];

interface DraggableElementProps {
  id: string;
  label: string;
  isSelected: boolean;
  pos: { left: number; top: number; width: number; height: number };
  onSelect: (id: string) => void;
  onResizeStart: (e: React.MouseEvent, id: string) => void;
  children: React.ReactNode;
  customStyle?: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    fontSize: number;
    textColor: string;
    fontWeight: 'normal' | 'bold';
    fontStyle: 'normal' | 'italic';
    backgroundOpacity?: number;
  };
  zIndex?: number;
  canResize?: boolean;
}

// Helper to convert hex and opacity to rgba
const getRgbaColor = (hex: string, opacity: number = 100) => {
  if (!hex) return 'transparent';
  if (hex === 'transparent') return 'transparent';
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
  }
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
};

const DraggableElement: React.FC<DraggableElementProps> = ({
  id,
  label,
  isSelected,
  pos,
  onSelect,
  onResizeStart,
  children,
  customStyle,
  zIndex,
  canResize = true
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: id
  });

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${pos.left}%`,
    top: `${pos.top}%`,
    width: `${pos.width}%`,
    height: `${pos.height}%`,
    zIndex: zIndex !== undefined ? zIndex : (isSelected ? 20 : 10),
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    touchAction: 'none',
    backgroundColor: customStyle?.backgroundColor ? getRgbaColor(customStyle.backgroundColor, customStyle.backgroundOpacity ?? 100) : undefined,
    borderColor: customStyle?.borderColor,
    borderWidth: customStyle?.borderWidth !== undefined ? `${customStyle.borderWidth}px` : undefined,
    borderRadius: customStyle?.borderRadius !== undefined ? `${customStyle.borderRadius}px` : undefined,
    fontSize: customStyle?.fontSize !== undefined ? `${customStyle.fontSize}px` : undefined,
    color: customStyle?.textColor,
    fontWeight: customStyle?.fontWeight,
    fontStyle: customStyle?.fontStyle,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border select-none transition-shadow duration-150 ${isSelected
        ? 'ring-2 ring-primary/20 shadow-md'
        : 'hover:border-primary/40'
        } ${isDragging ? 'opacity-50' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
    >
      {/* Absolute Drag Tab Handle on Top-Left */}
      <div
        {...listeners}
        {...attributes}
        className="absolute -top-[14px] left-0 bg-primary text-white text-[7px] px-1.5 py-0.5 rounded-t select-none cursor-move opacity-90 hover:opacity-100 flex items-center gap-1 z-30 font-semibold"
      >
        <span className="flex flex-col gap-[1px] justify-center">
          <span className="w-1 h-[1px] bg-white/70 rounded-full"></span>
          <span className="w-1 h-[1px] bg-white/70 rounded-full"></span>
        </span>
        {label}
      </div>

      {children}

      {/* Custom resize handle at bottom-right */}
      {isSelected && canResize !== false && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize bg-primary rounded-tl flex items-end justify-end p-0.5 z-40"
          onMouseDown={(e) => onResizeStart(e, id)}
        >
          <svg width="5" height="5" viewBox="0 0 5 5" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 0V4H0" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
};

const GEOSERVER_BASE = (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');

function buildLegendUrl(layerName: string, styleName: string): string {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetLegendGraphic',
    format: 'image/png',
    layer: layerName,
    style: styleName,
    legend_options: 'fontAntiAliasing:true;fontSize:11;forceLabels:on;fontName:Arial;dpi:110',
    width: '16',
    height: '16',
  });
  return `${GEOSERVER_BASE}/wms?${params.toString()}`;
}

type LegendItem =
  | { type: 'wms'; id: string; name: string; legendUrl: string }
  | { type: 'vector'; label: string; geometry: string; strokeColor: string; fillColor: string };

interface LegendSplitResult {
  page1Wms: Array<{ id: string; name: string; legendUrl: string }>;
  page1Vector: Array<{ type: string; label: string; geometry: string; strokeColor: string; fillColor: string }>;
  overflowPages: Array<{
    col1: LegendItem[];
    col2: LegendItem[];
    col3: LegendItem[];
    cols: LegendItem[][];
  }>;
}

function calculateLegendSplit(
  wmsEntries: Array<{ id: string; name: string; legendUrl?: string; url?: string;[key: string]: any }>,
  vectorEntries: Array<{ type: string; label: string; geometry: string; strokeColor: string; fillColor: string }>,
  availableHeight: number, // in PDF points
  colWidth: number, // in PDF points
  fontSize: number, // in PDF points
  legendDimensions: Record<string, { width: number; height: number }>,
  pageWidthPt: number,
  pageHeightPt: number
): LegendSplitResult {
  const page1Wms: Array<{ id: string; name: string; legendUrl: string }> = [];
  const page1Vector: Array<{ type: string; label: string; geometry: string; strokeColor: string; fillColor: string }> = [];
  const overflowWms: Array<{ id: string; name: string; legendUrl: string }> = [];
  const overflowVector: Array<{ type: string; label: string; geometry: string; strokeColor: string; fillColor: string }> = [];

  const hasWms = wmsEntries.length > 0;

  // Standard 2-column legend box (used across all templates including custom)
  const innerColWidth = hasWms ? (colWidth - 30) / 2 : colWidth / 2;

  // 1. Process WMS Left Column on Page 1
  let yLeft = 0;
  wmsEntries.forEach((item) => {
    let imgH = 24;
    let imgW = 24;
    const maxWidth = innerColWidth - 10;
    const maxHeight = 120;
    if (legendDimensions[item.id]) {
      const dims = legendDimensions[item.id];
      imgW = dims.width;
      imgH = dims.height;
      if (imgW > maxWidth) {
        const aspect = dims.width / dims.height;
        imgW = maxWidth;
        imgH = imgW / aspect;
      }
      if (imgH > maxHeight) {
        const aspect = dims.width / dims.height;
        imgH = maxHeight;
        imgW = imgH * aspect;
      }
    }
    const itemH = (fontSize * 0.85) + imgH + 8;

    const wmsItem = {
      id: item.id,
      name: item.name,
      legendUrl: item.legendUrl || item.url || '',
    };

    if (yLeft + itemH <= availableHeight) {
      page1Wms.push(wmsItem);
      yLeft += itemH;
    } else {
      overflowWms.push(wmsItem);
    }
  });

  // 2. Process Vector Right Column on Page 1 (if WMS is present)
  if (hasWms) {
    let yRight = 0;
    const vectorItemH = fontSize * 1.5;
    vectorEntries.forEach((item) => {
      if (yRight + vectorItemH <= availableHeight) {
        page1Vector.push(item);
        yRight += vectorItemH;
      } else {
        overflowVector.push(item);
      }
    });
  } else {
    // If no WMS, split vector annotations across left and right columns
    let yLeftVec = 0;
    let yRightVec = 0;
    const vectorItemH = fontSize * 1.5;

    vectorEntries.forEach((item, idx) => {
      if (idx % 2 === 0) {
        if (yLeftVec + vectorItemH <= availableHeight) {
          page1Vector.push(item);
          yLeftVec += vectorItemH;
        } else {
          overflowVector.push(item);
        }
      } else {
        if (yRightVec + vectorItemH <= availableHeight) {
          page1Vector.push(item);
          yRightVec += vectorItemH;
        } else {
          overflowVector.push(item);
        }
      }
    });
  }

  // 3. Process Overflow Page(s)
  const remainingItems: LegendItem[] = [
    ...overflowWms.map(item => ({ type: 'wms' as const, id: item.id, name: item.name, legendUrl: item.legendUrl })),
    ...overflowVector.map(item => ({
      type: 'vector' as const,
      label: item.label,
      geometry: item.geometry,
      strokeColor: item.strokeColor,
      fillColor: item.fillColor,
    }))
  ];

  const overflowPages: Array<{
    col1: LegendItem[];
    col2: LegendItem[];
    col3: LegendItem[];
    cols: LegendItem[][];
  }> = [];

  const isPortrait = pageWidthPt < pageHeightPt;
  const numCols = isPortrait ? 2 : 3;

  // Usable vertical space between the header divider line (margin + 28pt) and footer line (pageHeightPt - margin - 15pt):
  // Header and content start at Y = margin + 40pt (~60pt).
  // Footer divider line is at pageHeightPt - margin - 15pt (~560pt in A4 landscape, ~807pt in portrait).
  // Full usable column height is pageHeightPt - 2 * margin - 75pt (~480pt in landscape, ~725pt in portrait).
  // Setting this allows Column 2 (middle column) and Column 1 to fully utilize available space down to the footer line.
  const margin = 20;
  const overflowPageHeight = isPortrait
    ? Math.max(500, pageHeightPt - (2 * margin) - 80)
    : Math.max(430, pageHeightPt - (2 * margin) - 110);
  const colGap = 15;
  const totalGaps = (numCols - 1) * colGap;
  const colWidthOverflow = (pageWidthPt - 70 - totalGaps) / numCols;
  const fontSizeOverflow = 8;

  const getItemHeight = (item: LegendItem): number => {
    if (item.type === 'wms') {
      let imgH = 60; // realistic default height for multi-item GeoServer graphic
      if (legendDimensions[item.id]) {
        const dims = legendDimensions[item.id];
        let imgW = dims.width;
        imgH = dims.height;
        const maxWidth = colWidthOverflow - 10;
        const maxImgHeight = isPortrait ? 280 : 200;
        if (imgW > maxWidth) {
          const aspect = dims.width / dims.height;
          imgW = maxWidth;
          imgH = imgW / aspect;
        }
        if (imgH > maxImgHeight) {
          const aspect = dims.width / dims.height;
          imgH = maxImgHeight;
          imgW = imgH * aspect;
        }
      }
      return (fontSizeOverflow * 0.9) + 8 + imgH + 16;
    } else {
      return fontSizeOverflow * 1.5 + 6;
    }
  };

  const currentItems = [...remainingItems];

  while (currentItems.length > 0) {
    const colLists: LegendItem[][] = Array.from({ length: numCols }, () => []);
    const colHeights: number[] = Array.from({ length: numCols }, () => 0);

    let currentCol = 0;

    // Fill each column completely before moving to the next column
    while (currentCol < numCols && currentItems.length > 0) {
      const nextItem = currentItems[0];
      const h = getItemHeight(nextItem);

      if (colHeights[currentCol] + h <= overflowPageHeight) {
        colLists[currentCol].push(nextItem);
        colHeights[currentCol] += h;
        currentItems.shift();
      } else {
        // If current column is empty but item exceeds height, place it to prevent stalling
        if (colLists[currentCol].length === 0) {
          colLists[currentCol].push(nextItem);
          colHeights[currentCol] += h;
          currentItems.shift();
        }
        // Move to the next column on the page
        currentCol++;
      }
    }

    // Guard: force at least one item per page if a single item exceeds page height
    const totalItemsPlaced = colLists.reduce((sum, col) => sum + col.length, 0);
    if (totalItemsPlaced === 0 && currentItems.length > 0) {
      colLists[0].push(currentItems.shift()!);
    }

    overflowPages.push({
      col1: colLists[0] || [],
      col2: colLists[1] || [],
      col3: colLists[2] || [],
      cols: colLists
    });
  }

  return { page1Wms, page1Vector, overflowPages };
}

export const PrintComponent: React.FC<PrintComponentProps> = ({ mapInstance, addedLayers = [] }) => {
  const { notification } = App.useApp();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      handleResize();
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  const [previewMapInstance, setPreviewMapInstance] = useState<Map | null>(null);
  const [graticuleLayer, setGraticuleLayer] = useState<Graticule | null>(null);
  const previewMapInstanceRef = useRef<Map | null>(null);
  const graticuleLayerRef = useRef<Graticule | null>(null);
  const [liveScale, setLiveScale] = useState('1:100,000');
  const [_liveCenter, setLiveCenter] = useState('0.000°N, 0.000°E');
  const [_liveZoom, setLiveZoom] = useState('0');
  const previewMapRef = useRef<HTMLDivElement>(null);
  const originalViewRef = useRef<{ center: number[]; resolution: number; zoom: number } | null>(null);
  const { user } = useAuthStore();
  const [loadedLegends, setLoadedLegends] = useState<Record<string, string>>({});
  const legendCacheRef = useRef<Record<string, { dataUrl: string; width: number; height: number }>>({});
  const [legendDimensions, setLegendDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [viewChangeTrigger, setViewChangeTrigger] = useState(0);

  useEffect(() => {
    if (!isModalOpen || !previewMapInstance) return;

    let active = true;

    const fetchAllLegends = async () => {
      const results: Record<string, string> = {};
      const resultsDims: Record<string, { width: number; height: number }> = {};
      const headers: HeadersInit = {};
      if (user?.geoserverAuth) {
        headers['Authorization'] = user.geoserverAuth;
      }

      // Collect WMS layer entries that are visible in current viewport
      const size = previewMapInstance.getSize();
      const view = previewMapInstance.getView();
      const viewportExtent = (size && size[0] > 0 && size[1] > 0)
        ? view.calculateExtent(size)
        : null;

      const visibleWmsLayers: Array<{ id: string; url: string }> = [];
      const seenLayers = new Set<string>();

      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        if (layerName) {
          // Viewport bounding box check
          const bbox = layer.get('bbox');
          if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
            const coords = bbox.coordinates[0];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coords.forEach((c: number[]) => {
              const lon = c[0];
              const lat = c[1];
              if (lon < minX) minX = lon;
              if (lon > maxX) maxX = lon;
              if (lat < minY) minY = lat;
              if (lat > maxY) maxY = lat;
            });
            const layerExtent = [
              ...fromLonLat([minX, minY]),
              ...fromLonLat([maxX, maxY])
            ];
            if (!extentsIntersect(layerExtent, viewportExtent)) {
              return;
            }
          }

          const key = `layer_${layerId || layerName}`;
          if (!seenLayers.has(key)) {
            seenLayers.add(key);

            const matchingLayer = addedLayers.find(l => l.name === layerName || l.id === layerId);
            const activeStyle = matchingLayer?.activeStyle || '';
            const activeStyleObj = matchingLayer?.styles?.find(s => s.name === activeStyle);

            const legendUrl = activeStyleObj?.legendUrl
              ? activeStyleObj.legendUrl
              : buildLegendUrl(layerName, activeStyle);

            visibleWmsLayers.push({ id: layerId || layerName, url: legendUrl });
          }
        }
      });

      await Promise.all(
        visibleWmsLayers.map(async (entry) => {
          const cached = legendCacheRef.current[entry.url];
          if (cached) {
            results[entry.id] = cached.dataUrl;
            resultsDims[entry.id] = { width: cached.width, height: cached.height };
            return;
          }

          try {
            const res = await fetch(entry.url, { headers });
            if (!res.ok) return;
            const blob = await res.blob();
            const dataUrl = await new Promise<string | null>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });

            if (dataUrl && active) {
              const dims = await new Promise<{ width: number; height: number } | null>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  resolve({
                    width: img.naturalWidth || img.width || 1,
                    height: img.naturalHeight || img.height || 1
                  });
                };
                img.onerror = () => resolve(null);
                img.src = dataUrl;
              });

              if (dims) {
                legendCacheRef.current[entry.url] = { dataUrl, width: dims.width, height: dims.height };
                results[entry.id] = dataUrl;
                resultsDims[entry.id] = dims;
              }
            }
          } catch (err) {
            console.error('Failed to load preview legend:', err);
          }
        })
      );

      if (active) {
        // Compare with current states to avoid unnecessary updates and re-renders
        setLoadedLegends(prev => {
          const hasLegendChanged = Object.keys(results).length !== Object.keys(prev).length ||
            Object.keys(results).some(k => results[k] !== prev[k]);
          return hasLegendChanged ? results : prev;
        });

        setLegendDimensions(prev => {
          const hasDimsChanged = Object.keys(resultsDims).length !== Object.keys(prev).length ||
            Object.keys(resultsDims).some(
              k => resultsDims[k].width !== prev[k]?.width || resultsDims[k].height !== prev[k]?.height
            );
          return hasDimsChanged ? resultsDims : prev;
        });
      }
    };

    fetchAllLegends();

    return () => {
      active = false;
    };
  }, [isModalOpen, addedLayers, previewMapInstance, user?.geoserverAuth, viewChangeTrigger]);

  const [titleError, setTitleError] = useState('');
  const [filenameError, setFilenameError] = useState('');

  // Custom DnD-Kit Templates support
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [zOrder, setZOrder] = useState<string[]>(['title', 'office', 'legend', 'scale', 'footer', 'northArrow']);

  const handleSelectElement = (id: string) => {
    setSelectedElementId(id);
    if (id !== 'map') {
      setZOrder(prev => {
        const filtered = prev.filter(item => item !== id);
        return [...filtered, id];
      });
    }
  };

  const [customPositions, setCustomPositions] = useState<{
    map: { left: number; top: number; width: number; height: number };
    title: { left: number; top: number; width: number; height: number };
    office: { left: number; top: number; width: number; height: number };
    legend: { left: number; top: number; width: number; height: number };
    scale: { left: number; top: number; width: number; height: number };
    footer: { left: number; top: number; width: number; height: number };
    northArrow: { left: number; top: number; width: number; height: number };
  }>({
    map: { left: 2, top: 2, width: 68, height: 96 },
    title: { left: 72, top: 2, width: 26, height: 10 },
    office: { left: 72, top: 14, width: 26, height: 20 },
    legend: { left: 72, top: 36, width: 26, height: 35 },
    scale: { left: 72, top: 73, width: 26, height: 18 },
    footer: { left: 72, top: 93, width: 26, height: 5 },
    northArrow: { left: 63, top: 4, width: 5, height: 7 }
  });

  const [customStyles, setCustomStyles] = useState<{
    [key: string]: {
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      borderRadius: number;
      fontSize: number;
      textColor: string;
      fontWeight: 'normal' | 'bold';
      fontStyle: 'normal' | 'italic';
      backgroundOpacity?: number;
    }
  }>({
    map: { backgroundColor: '#ffffff', borderColor: '#000000', borderWidth: 1.5, borderRadius: 0, fontSize: 8, textColor: '#000000', fontWeight: 'normal', fontStyle: 'normal', backgroundOpacity: 100 },
    title: { backgroundColor: '#ffffff', borderColor: '#000000', borderWidth: 1.5, borderRadius: 0, fontSize: 11, textColor: '#000000', fontWeight: 'bold', fontStyle: 'normal', backgroundOpacity: 100 },
    office: { backgroundColor: '#ffffff', borderColor: '#000000', borderWidth: 1.5, borderRadius: 0, fontSize: 8, textColor: '#000000', fontWeight: 'normal', fontStyle: 'normal', backgroundOpacity: 100 },
    legend: { backgroundColor: '#ffffff', borderColor: '#000000', borderWidth: 1.5, borderRadius: 0, fontSize: 8, textColor: '#000000', fontWeight: 'normal', fontStyle: 'normal', backgroundOpacity: 100 },
    scale: { backgroundColor: '#ffffff', borderColor: '#000000', borderWidth: 1.5, borderRadius: 0, fontSize: 7, textColor: '#000000', fontWeight: 'normal', fontStyle: 'normal', backgroundOpacity: 100 },
    footer: { backgroundColor: '#ffffff', borderColor: '#000000', borderWidth: 1.5, borderRadius: 0, fontSize: 8, textColor: '#000000', fontWeight: 'normal', fontStyle: 'normal', backgroundOpacity: 100 },
    northArrow: { backgroundColor: 'transparent', borderColor: 'transparent', borderWidth: 0, borderRadius: 0, fontSize: 8, textColor: '#000000', fontWeight: 'normal', fontStyle: 'normal', backgroundOpacity: 0 }
  });

  const updateStyle = (id: string, key: string, value: any) => {
    if (id === 'footer' && key === 'fontSize') {
      return; // Do not allow changing font size for footer
    }
    if (key === 'backgroundColor' && value && customStyles[id].textColor && value.toLowerCase() === customStyles[id].textColor.toLowerCase()) {
      notification.warning({
        message: 'Invalid Color Combination',
        description: 'Text color cannot be the same as the background color.',
        placement: 'topRight'
      });
      return;
    }
    if (key === 'textColor' && value && customStyles[id].backgroundColor && value.toLowerCase() === customStyles[id].backgroundColor.toLowerCase()) {
      notification.warning({
        message: 'Invalid Color Combination',
        description: 'Text color cannot be the same as the background color.',
        placement: 'topRight'
      });
      return;
    }
    setCustomStyles(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [key]: value
      }
    }));
  };

  const [settings, setSettings] = useState<PrintSettings>({
    title: 'VistaBridge Map Export',
    filename: 'vistabridge_map_export',
    pageSize: 'A4',
    dpi: 300,
    includeGraticule: false,
    layout: 'landscape',
    format: 'pdf',
    template: 'template1',
    includeLegend: true,
    includeNorthArrow: true,
    includeOfficeUse: true,
    includeScale: true,
    scaleType: 'auto',
    customScaleValue: 20000
  });

  const includeGraticuleRef = useRef(settings.includeGraticule);
  useEffect(() => {
    includeGraticuleRef.current = settings.includeGraticule;
  }, [settings.includeGraticule]);

  useEffect(() => {
    const handleOpenPrint = () => {
      if (mapInstance) {
        setIsModalOpen(true);
      }
    };
    window.addEventListener('open-print-legend', handleOpenPrint);
    return () => {
      window.removeEventListener('open-print-legend', handleOpenPrint);
    };
  }, [mapInstance]);

  // Reset custom elements layout based on orientation
  useEffect(() => {
    queueMicrotask(() => {
      if (settings.layout === 'landscape') {
        setCustomPositions({
          map: { left: 2, top: 2, width: 68, height: 96 },
          title: { left: 72, top: 2, width: 26, height: 10 },
          office: { left: 72, top: 14, width: 26, height: 20 },
          legend: { left: 72, top: 36, width: 26, height: 35 },
          scale: { left: 72, top: 73, width: 26, height: 18 },
          footer: { left: 72, top: 93, width: 26, height: 5 },
          northArrow: { left: 63, top: 4, width: 5, height: 7 }
        });
      } else {
        setCustomPositions({
          title: { left: 2, top: 2, width: 96, height: 8 },
          map: { left: 2, top: 12, width: 96, height: 55 },
          office: { left: 2, top: 69, width: 31, height: 25 },
          legend: { left: 35, top: 69, width: 31, height: 25 },
          scale: { left: 68, top: 69, width: 30, height: 25 },
          footer: { left: 2, top: 96, width: 96, height: 3 },
          northArrow: { left: 91, top: 14, width: 5, height: 7 }
        });
      }
      setSelectedElementId(null);
    });
  }, [settings.layout]);

  // Change template when layout changes (unless custom is selected)
  useEffect(() => {
    if (settings.template === 'custom') return;
    queueMicrotask(() => {
      if (settings.layout === 'portrait' && (settings.template === 'template1' || settings.template === 'template3')) {
        setSettings(prev => ({ ...prev, template: 'template2' }));
      } else if (settings.layout === 'landscape' && (settings.template === 'template2' || settings.template === 'template4')) {
        setSettings(prev => ({ ...prev, template: 'template1' }));
      }
    });
  }, [settings.layout, settings.template]);

  // Resize Handler
  const startResize = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = customPositions[id as keyof typeof customPositions].width;
    const startHeight = customPositions[id as keyof typeof customPositions].height;
    const startLeft = customPositions[id as keyof typeof customPositions].left;
    const startTop = customPositions[id as keyof typeof customPositions].top;

    const containerRect = pageContainerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const doResize = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      // Translate px delta to layout parent percentages
      const deltaWidthPercent = (deltaX / containerRect.width) * 100;
      const deltaHeightPercent = (deltaY / containerRect.height) * 100;

      const newWidth = Math.max(5, Math.min(100 - startLeft, startWidth + deltaWidthPercent));
      const newHeight = Math.max(5, Math.min(100 - startTop, startHeight + deltaHeightPercent));

      setCustomPositions((prev) => ({
        ...prev,
        [id]: {
          ...prev[id as keyof typeof prev],
          width: newWidth,
          height: newHeight
        }
      }));

      if (id === 'map' && previewMapInstance) {
        previewMapInstance.updateSize();
      }
    };

    const stopResize = () => {
      document.removeEventListener('mousemove', doResize);
      document.removeEventListener('mouseup', stopResize);
    };

    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
  };

  // Drag Start Handler for DndContext
  const handleDragStart = (event: any) => {
    const { active } = event;
    handleSelectElement(active.id);
  };

  // Drag End Handler for DndContext
  const handleDragEnd = (event: any) => {
    const { active, delta } = event;
    const id = active.id;

    if (delta && pageContainerRef.current) {
      const containerRect = pageContainerRef.current.getBoundingClientRect();

      setCustomPositions((prev) => {
        const element = prev[id as keyof typeof prev];
        // Convert current percentages to layout px coordinates
        const currentLeftPx = (element.left / 100) * containerRect.width;
        const currentTopPx = (element.top / 100) * containerRect.height;

        const newLeftPx = currentLeftPx + delta.x;
        const newTopPx = currentTopPx + delta.y;

        // Constraint within layout boundary box
        const leftPercent = Math.max(0, Math.min(100 - element.width, (newLeftPx / containerRect.width) * 100));
        const topPercent = Math.max(0, Math.min(100 - element.height, (newTopPx / containerRect.height) * 100));

        return {
          ...prev,
          [id]: {
            ...element,
            left: leftPercent,
            top: topPercent
          }
        };
      });

      if (id === 'map' && previewMapInstance) {
        // Force layout repaint
        setTimeout(() => {
          previewMapInstance.updateSize();
        }, 100);
      }
    }
  };

  const handlePrintClick = () => {
    if (!mapInstance) {
      notification.error({
        message: 'Map Not Ready',
        description: 'Map is not loaded. Please wait for the map to load completely.',
        placement: 'topRight'
      });
      return;
    }
    setIsModalOpen(true);
  };

  // Initialize preview map: wait for preview DOM element, then create map once
  useEffect(() => {
    if (!isModalOpen || !mapInstance) return;

    let isMounted = true;
    let createdMap: Map | null = null;
    let createdGraticule: Graticule | null = null;
    const timers: number[] = [];

    const waitForRefAndInit = async () => {
      // wait for ref to be attached to DOM (up to ~1s)
      for (let i = 0; i < 20 && isMounted; i++) {
        if (previewMapRef.current) break;
        // small delay
        await new Promise((r) => setTimeout(r, 50));
      }

      if (!isMounted || !previewMapRef.current) return;

      // Clean up any previous preview map synchronously
      try {
        if (previewMapInstanceRef.current) {
          try {
            previewMapInstanceRef.current.setTarget(undefined);
          } catch {
            // ignore
          }
          previewMapInstanceRef.current = null;
          setPreviewMapInstance(null);
        }
        if (graticuleLayerRef.current) {
          try { graticuleLayerRef.current.setMap(null); } catch { }
          graticuleLayerRef.current = null;
          setGraticuleLayer(null);
        }
      } catch {
        // ignore
      }

      try {
        const mainView = mapInstance.getView();
        const mainLayers = mapInstance.getLayers().getArray();

        const clonedLayers = mainLayers.map((layer: any) => {
          const source = layer.getSource?.();
          const visible = typeof layer.getVisible === 'function' ? layer.getVisible() : true;
          const opacity = typeof layer.getOpacity === 'function' ? layer.getOpacity() : 1;
          const zIndex = typeof layer.getZIndex === 'function' ? layer.getZIndex() : undefined;
          let clonedLayer: any;

          if (layer instanceof TileLayer) {
            let clonedSource = source;
            if (source && (source.constructor?.name === 'XYZ' || source instanceof XYZ)) {
              clonedSource = new XYZ({
                url: source.getUrls?.()?.[0] || source.getUrl?.(),
                attributions: source.getAttributions?.(),
                crossOrigin: 'anonymous',
                tileLoadFunction: source.getTileLoadFunction?.(),
              });
            } else if (source && source.constructor?.name === 'OSM') {
              clonedSource = new OSM({ crossOrigin: 'anonymous' });
            }

            clonedLayer = new TileLayer({
              source: clonedSource,
              visible,
              opacity,
              zIndex,
              preload: 4
            });
          } else if (layer instanceof VectorTileLayer) {
            clonedLayer = new VectorTileLayer({
              source: source,
              visible,
              opacity,
              zIndex,
              declutter: true,
              style: layer.getStyle?.(),
              preload: 4
            });
          } else if (layer instanceof VectorLayer) {
            clonedLayer = new VectorLayer({
              source: source,
              visible,
              opacity,
              zIndex,
              style: layer.getStyle?.()
            });
          } else {
            clonedLayer = layer;
          }

          if (clonedLayer && clonedLayer !== layer) {
            clonedLayer.set('name', layer.get('name'));
            clonedLayer.set('bbox', layer.get('bbox'));
            clonedLayer.set('id', layer.get('id'));
          }
          return clonedLayer;
        });

        const newMap = new Map({
          target: previewMapRef.current,
          layers: clonedLayers,
          view: new View({
            center: mainView.getCenter(),
            zoom: mainView.getZoom(),
            rotation: mainView.getRotation(),
            projection: mainView.getProjection()
          }),
          controls: []
        });

        createdMap = newMap;

        // Store initial view state when print modal opens
        const initialCenter = mainView.getCenter();
        const initialZoom = mainView.getZoom();
        const initialRes = mainView.getResolution();
        if (initialCenter && initialZoom !== undefined && initialRes !== undefined) {
          originalViewRef.current = {
            center: [...initialCenter],
            zoom: initialZoom,
            resolution: initialRes
          };
        }

        // Use white grid lines for dark basemaps (satellite / dark-matter)
        const darkMap = isDarkBasemap(mapInstance);
        const graticuleColor = darkMap ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.4)';
        const graticuleLabelColor = darkMap ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.8)';

        const graticule = new Graticule({
          strokeStyle: new Stroke({ color: graticuleColor, width: 1, lineDash: [4, 4] }),
          showLabels: true,
          lonLabelStyle: new OlText({
            font: '12px Calibri,sans-serif',
            textBaseline: 'bottom' as any,
            fill: new Fill({ color: graticuleLabelColor }),
            stroke: new Stroke({ color: darkMap ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)', width: 3 }),
          }),
          latLabelStyle: new OlText({
            font: '12px Calibri,sans-serif',
            textAlign: 'end' as any,
            fill: new Fill({ color: graticuleLabelColor }),
            stroke: new Stroke({ color: darkMap ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)', width: 3 }),
          }),
          wrapX: true,
          visible: includeGraticuleRef.current
        });

        createdGraticule = graticule;
        graticule.setMap(newMap);
        previewMapInstanceRef.current = newMap;
        graticuleLayerRef.current = graticule;
        setGraticuleLayer(graticule);
        setPreviewMapInstance(newMap);

        const updateMetadata = () => {
          const view = newMap.getView();
          const resolution = view.getResolution();
          const center = view.getCenter();
          const zoom = view.getZoom();

          if (resolution) {
            const dpi = 96;
            const inchesPerMeter = 39.37;
            const scale = Math.round(resolution * dpi * inchesPerMeter);
            setLiveScale(`1:${scale.toLocaleString()}`);
          }

          if (center) {
            const lonLat = toLonLat(center);
            setLiveCenter(`${lonLat[1].toFixed(4)}°N, ${lonLat[0].toFixed(4)}°E`);
          }

          if (zoom !== undefined) {
            setLiveZoom(zoom.toFixed(1));
          }
        };

        newMap.getView().on('change', updateMetadata);
        newMap.on('moveend', () => {
          setViewChangeTrigger(prev => prev + 1);
        });
        updateMetadata();

        const renderMap = () => {
          if (isMounted && newMap) {
            newMap.updateSize();
            newMap.render();
          }
        };

        requestAnimationFrame(() => renderMap());
        timers.push(window.setTimeout(() => renderMap(), 100));
        timers.push(window.setTimeout(() => renderMap(), 300));
        timers.push(window.setTimeout(() => renderMap(), 500));
        timers.push(window.setTimeout(() => renderMap(), 1000));
      } catch (error) {
        console.error('Error creating preview map:', error);
      }
    };

    waitForRefAndInit();

    return () => {
      isMounted = false;
      // clear scheduled timers
      timers.forEach((t) => clearTimeout(t));
      // cleanup created map/graticule
      try {
        if (createdGraticule) createdGraticule.setMap(null);
      } catch { }
      try {
        if (createdMap) createdMap.setTarget(undefined);
      } catch { }
      // ensure state cleaned
      setPreviewMapInstance((prev) => {
        if (prev && prev !== createdMap) {
          try { prev.setTarget(undefined); } catch { }
        }
        return null;
      });
      setGraticuleLayer((prev) => {
        if (prev && prev !== createdGraticule) {
          try { prev.setMap(null); } catch { }
        }
        return null;
      });
    };
  }, [isModalOpen, mapInstance]);

  useEffect(() => {
    if (graticuleLayer) {
      graticuleLayer.setVisible(settings.includeGraticule);
      if (previewMapInstance) {
        previewMapInstance.render();
      }
    }
  }, [settings.includeGraticule, graticuleLayer, previewMapInstance]);

  // Handle map container element changes when template, layout, or map instance updates
  useEffect(() => {
    if (previewMapInstance) {
      if (previewMapRef.current) {
        previewMapInstance.setTarget(previewMapRef.current);
        // Delay size updates slightly to allow layout and CSS rendering to complete
        const timer = setTimeout(() => {
          if (previewMapInstance) {
            previewMapInstance.updateSize();
            previewMapInstance.render();
          }
        }, 100);
        return () => clearTimeout(timer);
      } else {
        previewMapInstance.setTarget(undefined);
      }
    }
  }, [settings.template, settings.layout, previewMapInstance]);

  // Update map resolution when custom scale is selected
  useEffect(() => {
    if (previewMapInstance && settings.scaleType === 'custom') {
      const targetRes = settings.customScaleValue / (96 * 39.37);
      const view = previewMapInstance.getView();
      const currentRes = view.getResolution();
      if (currentRes !== undefined && Math.abs(currentRes - targetRes) > 0.001) {
        view.setResolution(targetRes);
        previewMapInstance.render();
      }
    }
  }, [settings.scaleType, settings.customScaleValue, previewMapInstance]);

  // If user zooms manually, switch scale type back to 'auto'
  useEffect(() => {
    if (!previewMapInstance) return;
    const view = previewMapInstance.getView();

    const handleResolutionChange = () => {
      if (settings.scaleType === 'custom') {
        const targetRes = settings.customScaleValue / (96 * 39.37);
        const currentRes = view.getResolution();
        if (currentRes !== undefined && Math.abs(currentRes - targetRes) > 0.05) {
          setSettings(prev => ({ ...prev, scaleType: 'auto' }));
        }
      }
    };

    view.on('change:resolution', handleResolutionChange);
    return () => {
      view.un('change:resolution', handleResolutionChange);
    };
  }, [previewMapInstance, settings.scaleType, settings.customScaleValue]);

  // Reset map view to initial state when "Auto (Fit View)" is selected
  useEffect(() => {
    if (previewMapInstance && settings.scaleType === 'auto' && originalViewRef.current) {
      const view = previewMapInstance.getView();
      const { center, zoom, resolution } = originalViewRef.current;
      if (center) {
        view.setCenter(center);
      }
      if (zoom !== undefined) {
        view.setZoom(zoom);
      }
      if (resolution !== undefined) {
        view.setResolution(resolution);
      }
      previewMapInstance.render();
    }
  }, [settings.scaleType, previewMapInstance]);



  const captureMapCanvas = useCallback(async (): Promise<HTMLCanvasElement> => {
    if (!previewMapInstance) {
      throw new Error('Preview map instance not available');
    }

    // Store original size and resolution
    const size = previewMapInstance.getSize();
    if (!size) {
      throw new Error('Unable to get map size');
    }

    const view = previewMapInstance.getView();
    const originalResolution = view.getResolution();

    // Scale factor based on selected DPI (standard screen is 72/96 DPI, jsPDF uses 72 pt/inch)
    const scale = settings.dpi / 72;

    const printSize = [Math.round(size[0] * scale), Math.round(size[1] * scale)];

    // Take a quick screen-res snapshot of the preview map to use as a visual placeholder
    let placeholderImg: HTMLImageElement | null = null;
    if (previewMapRef.current) {
      try {
        const placeholderCanvas = captureMapAsCanvas(previewMapInstance, 1, settings.includeNorthArrow && settings.template !== 'custom');
        placeholderImg = document.createElement('img');
        placeholderImg.src = placeholderCanvas.toDataURL('image/jpeg', 0.95);
        placeholderImg.style.position = 'absolute';
        placeholderImg.style.left = '0';
        placeholderImg.style.top = '0';
        placeholderImg.style.width = '100%';
        placeholderImg.style.height = '100%';
        placeholderImg.style.objectFit = 'contain';
        placeholderImg.style.zIndex = '9999';
        previewMapRef.current.style.position = 'relative';
        previewMapRef.current.appendChild(placeholderImg);
      } catch (e) {
        console.warn('Failed to create preview placeholder:', e);
      }
    }

    // Create a temporary off-screen container in the DOM
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-99999px';
    tempDiv.style.top = '-99999px';
    tempDiv.style.width = `${printSize[0]}px`;
    tempDiv.style.height = `${printSize[1]}px`;
    document.body.appendChild(tempDiv);

    try {
      // Direct map target to off-screen div to prevent layout disruption on screen
      previewMapInstance.setTarget(tempDiv);
      previewMapInstance.setSize(printSize);

      // Set exact print resolution based on current view resolution scaled by the high DPI factor
      if (originalResolution !== undefined) {
        view.setResolution(originalResolution / scale);
      }

      // Wait for tiles to load and rendering to complete at the high-res size
      await new Promise<void>((resolve) => {
        let isResolved = false;

        const onRenderComplete = () => {
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        };

        // Listen to rendercomplete from OpenLayers
        previewMapInstance.once('rendercomplete', onRenderComplete);

        // Fallback timeout in case rendercomplete doesn't fire
        setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        }, 4000);
      });

      // Capture the high resolution canvas
      const canvas = captureMapAsCanvas(previewMapInstance, scale, settings.includeNorthArrow && settings.template !== 'custom');
      return canvas;
    } finally {
      // Always restore original target, size and resolution
      previewMapInstance.setTarget(previewMapRef.current || undefined);
      previewMapInstance.setSize(size);
      if (originalResolution !== undefined) {
        view.setResolution(originalResolution);
      }

      // Remove placeholder image
      if (placeholderImg && placeholderImg.parentNode) {
        placeholderImg.parentNode.removeChild(placeholderImg);
      }

      // Clean up temporary DOM element
      if (tempDiv.parentNode) {
        tempDiv.parentNode.removeChild(tempDiv);
      }

      // Force rendering to update the preview map back to its original state
      previewMapInstance.renderSync();
    }
  }, [previewMapInstance, settings]);

  const getPage1LegendParams = useCallback(() => {
    const pageInfo = pageSizes[settings.pageSize];
    const isPortrait = settings.layout === 'portrait';
    const pageWidthPt = isPortrait ? pageInfo.width * 2.83465 : pageInfo.height * 2.83465;
    const pageHeightPt = isPortrait ? pageInfo.height * 2.83465 : pageInfo.width * 2.83465;

    let availableHeight = 150;
    let colWidth = 240;
    let fontSize = 8;

    if (settings.template === 'custom') {
      const legendHeight = (customPositions.legend.height / 100) * pageHeightPt;
      fontSize = customStyles.legend?.fontSize || 8;
      availableHeight = legendHeight - (fontSize * 3.0);
      colWidth = (customPositions.legend.width / 100) * pageWidthPt;
    } else if (settings.layout === 'landscape') {
      // Landscape templates (sidebar details on right or left)
      availableHeight = 142; // standard height available inside sidebar legend
      colWidth = 240; // sidebarWidth
      fontSize = 6.5;
    } else {
      // Portrait templates (details panel at bottom)
      availableHeight = 158;
      let columnsCount = 0;
      if (settings.includeOfficeUse) columnsCount++;
      if (settings.includeLegend) columnsCount++;
      if (settings.includeScale) columnsCount++;
      columnsCount = Math.max(1, columnsCount);

      const margin = 20;
      const padding = 10;
      const gap = 10;
      const contentWidth = pageWidthPt - (2 * margin) - (2 * padding);
      colWidth = (contentWidth - (columnsCount - 1) * gap) / columnsCount;
      fontSize = 5.5;
    }

    return { availableHeight, colWidth, fontSize, pageWidthPt, pageHeightPt };
  }, [settings, customPositions, customStyles]);

  const generatePDF = useCallback(async (canvas: HTMLCanvasElement): Promise<void> => {
    const { default: jsPDF } = await import('jspdf');

    const pageInfo = pageSizes[settings.pageSize];
    const isPortrait = settings.layout === 'portrait';

    // Page dimensions in points
    const pageWidthPt = isPortrait ? pageInfo.width * 2.83465 : pageInfo.height * 2.83465;
    const pageHeightPt = isPortrait ? pageInfo.height * 2.83465 : pageInfo.width * 2.83465;

    const pdf = new jsPDF({
      orientation: settings.layout,
      unit: 'pt',
      format: [pageWidthPt, pageHeightPt]
    });

    // Extract ALL vector layers and features from map for legend
    const mapAnnotations: Array<{ type: string, label: string, geometry: string, strokeColor: string, fillColor: string }> = [];
    const seenKeys = new Set<string>();

    const geoserverLegends: Array<{ id: string; name: string; url: string; base64: string | null; width?: number; height?: number }> = [];

    let viewportExtent: number[] | null = null;
    if (previewMapInstance) {
      const size = previewMapInstance.getSize();
      if (size && size[0] > 0 && size[1] > 0) {
        viewportExtent = previewMapInstance.getView().calculateExtent(size);
      }
    }

    if (previewMapInstance) {
      const legendUrlsToFetch: Array<{ id: string; name: string; url: string }> = [];
      const seenLayers = new Set<string>();

      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        if (layerName) {
          // Bounding box check to verify if visible in current viewport view
          const bbox = layer.get('bbox');
          if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
            const coords = bbox.coordinates[0];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coords.forEach((c: number[]) => {
              const lon = c[0];
              const lat = c[1];
              if (lon < minX) minX = lon;
              if (lon > maxX) maxX = lon;
              if (lat < minY) minY = lat;
              if (lat > maxY) maxY = lat;
            });
            const layerExtent = [
              ...fromLonLat([minX, minY]),
              ...fromLonLat([maxX, maxY])
            ];
            if (!extentsIntersect(layerExtent, viewportExtent)) {
              return; // Layer is not visible in current viewport
            }
          }

          const key = `layer_${layerId || layerName}`;
          if (!seenLayers.has(key)) {
            seenLayers.add(key);

            const matchingLayer = addedLayers.find(l => l.name === layerName || l.id === layerId);
            const activeStyle = matchingLayer?.activeStyle || '';
            const activeStyleObj = matchingLayer?.styles?.find(s => s.name === activeStyle);

            const legendUrl = activeStyleObj?.legendUrl
              ? activeStyleObj.legendUrl
              : buildLegendUrl(layerName, activeStyle);

            legendUrlsToFetch.push({ id: layerId || layerName, name: layerName, url: legendUrl });
          }
        }
      });

      legendUrlsToFetch.forEach((item) => {
        const base64 = loadedLegends[item.id] || null;
        const dims = legendDimensions[item.id] || null;
        geoserverLegends.push({
          id: item.id,
          name: item.name,
          url: item.url,
          base64: base64,
          width: dims ? dims.width : undefined,
          height: dims ? dims.height : undefined
        });
      });
    }

    if (previewMapInstance) {
      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        // Skip base tile layers and unnamed/unidentified vector layers (e.g. highlights)
        if (!layerName && layerId !== 'annotations' && layerId !== 'measurements') return;

        // Bounding box check for dataset layers
        const bbox = layer.get('bbox');
        if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
          const coords = bbox.coordinates[0];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          coords.forEach((c: number[]) => {
            const lon = c[0];
            const lat = c[1];
            if (lon < minX) minX = lon;
            if (lon > maxX) maxX = lon;
            if (lat < minY) minY = lat;
            if (lat > maxY) maxY = lat;
          });
          const layerExtent = [
            ...fromLonLat([minX, minY]),
            ...fromLonLat([maxX, maxY])
          ];
          if (!extentsIntersect(layerExtent, viewportExtent)) {
            return; // Layer is not visible in current viewport
          }
        }

        // If it is a dataset layer (has a name)
        if (layerName) {
          return;
        }

        // If it is measurements layer
        if (layerId === 'measurements') {
          const source = layer.getSource?.();
          if (source && typeof source.getFeatures === 'function') {
            try {
              const features = source.getFeatures();
              features.forEach((feature: any) => {
                if (feature.get('visible') === false) return;
                const geom = feature.getGeometry();
                if (!geom) return;

                if (viewportExtent && typeof geom.intersectsExtent === 'function') {
                  if (!geom.intersectsExtent(viewportExtent)) return;
                }

                const geomType = geom.getType();
                const displayVal = feature.get('displayVal') || '';
                const label = `${geomType === 'LineString' ? 'Line' : 'Area'} Measurement (${displayVal})`;
                const key = `measurement_${feature.getId() || label}`;

                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  const colors = getLayerColors(layer, feature);
                  mapAnnotations.push({
                    type: label,
                    label: label,
                    geometry: geomType,
                    strokeColor: colors.strokeColor,
                    fillColor: colors.fillColor
                  });
                }
              });
            } catch (e) {
              console.log('Error extracting measurement features:', e);
            }
          }
          return;
        }

        // If it is annotations layer
        if (layerId === 'annotations') {
          const source = layer.getSource?.();
          if (source && typeof source.getFeatures === 'function') {
            try {
              const features = source.getFeatures();
              features.forEach((feature: any) => {
                if (feature.get('visible') === false) return;
                const geom = feature.getGeometry();
                if (!geom) return;

                if (viewportExtent && typeof geom.intersectsExtent === 'function') {
                  if (!geom.intersectsExtent(viewportExtent)) return;
                }

                const geomType = geom.getType();
                const label = feature.get('label') || feature.get('name') || feature.get('type') || geomType;
                const key = `annotation_${feature.getId() || label}`;

                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  const colors = getLayerColors(layer, feature);
                  mapAnnotations.push({
                    type: label,
                    label: label,
                    geometry: geomType,
                    strokeColor: colors.strokeColor,
                    fillColor: colors.fillColor
                  });
                }
              });
            } catch (e) {
              console.log('Error extracting annotation features:', e);
            }
          }
          return;
        }
      });
    }

    const dimsRecord: Record<string, { width: number; height: number }> = {};
    geoserverLegends.forEach((lg) => {
      if (lg.width && lg.height) {
        dimsRecord[lg.id] = { width: lg.width, height: lg.height };
      }
    });

    const pageParams = getPage1LegendParams();
    const { page1Wms, page1Vector, overflowPages } = calculateLegendSplit(
      geoserverLegends,
      mapAnnotations,
      pageParams.availableHeight,
      pageParams.colWidth,
      pageParams.fontSize,
      dimsRecord,
      pageParams.pageWidthPt,
      pageParams.pageHeightPt
    );

    const margin = 20;
    const padding = 10;
    const gap = 10;
    const detailsPanelWidth = 240;
    const borderWidth = 1.0;

    const contentX = margin + padding;
    const contentY = margin + padding;
    const contentWidth = pageWidthPt - (2 * margin) - (2 * padding);
    const contentHeight = pageHeightPt - (2 * margin) - (2 * padding);

    let mapAreaX, mapAreaY, mapAreaWidth, mapAreaHeight;
    let detailsX, detailsY;

    // Template-based layout
    if (settings.template === 'template1') {
      // Map on left, details on right
      mapAreaX = contentX;
      mapAreaY = contentY;
      mapAreaWidth = contentWidth - gap - detailsPanelWidth;
      mapAreaHeight = contentHeight;
      detailsX = mapAreaX + mapAreaWidth + gap;
      detailsY = contentY;
    } else if (settings.template === 'template2') {
      const detailsPanelHeight = 200;
      const titleHeight = 40;
      mapAreaX = contentX;
      mapAreaY = contentY + titleHeight + gap;
      mapAreaWidth = contentWidth;
      mapAreaHeight = contentHeight - (2 * gap) - titleHeight - detailsPanelHeight;
      detailsX = contentX;
      detailsY = mapAreaY + mapAreaHeight + gap;
    } else if (settings.template === 'template3') {
      // Map on right, details on left
      mapAreaX = contentX + detailsPanelWidth + gap;
      mapAreaY = contentY;
      mapAreaWidth = contentWidth - gap - detailsPanelWidth;
      mapAreaHeight = contentHeight;
      detailsX = contentX;
      detailsY = contentY;
    } else {
      const detailsPanelHeight = 200;
      const titleHeight = 40;
      mapAreaX = contentX;
      mapAreaY = contentY + titleHeight + gap + detailsPanelHeight + gap;
      mapAreaWidth = contentWidth;
      mapAreaHeight = contentHeight - (3 * gap) - titleHeight - detailsPanelHeight;
      detailsX = contentX;
      detailsY = contentY + titleHeight + gap;
    }

    const truncatePdfText = (text: string, maxWidth: number): string => {
      if (pdf.getTextWidth(text) <= maxWidth) return text;
      let truncated = text;
      while (truncated.length > 0 && pdf.getTextWidth(truncated + '...') > maxWidth) {
        truncated = truncated.slice(0, -1);
      }
      return truncated + '...';
    };

    let mapWidth = mapAreaWidth;
    let mapHeight = mapAreaHeight;
    let mapX = mapAreaX;
    let mapY = mapAreaY;

    if (settings.template !== 'custom') {
      // Canvas maintains north orientation (not rotated)
      const canvasAspectRatio = canvas.width / canvas.height;
      const areaAspectRatio = mapAreaWidth / mapAreaHeight;

      if (canvasAspectRatio > areaAspectRatio) {
        mapHeight = mapWidth / canvasAspectRatio;
        mapY = mapAreaY + (mapAreaHeight - mapHeight) / 2;
      } else {
        mapWidth = mapHeight * canvasAspectRatio;
        mapX = mapAreaX + (mapAreaWidth - mapWidth) / 2;
      }
    }

    // Page border (uniform black, line weight 1.5) - Only for standard templates
    if (settings.template !== 'custom') {
      pdf.setLineWidth(borderWidth);
      pdf.setDrawColor(0, 0, 0);
      pdf.rect(margin, margin, pageWidthPt - (2 * margin), pageHeightPt - (2 * margin));
    }

    if (settings.template !== 'custom') {
      // Map image (high quality JPEG) - north arrow already embedded in canvas
      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      pdf.addImage(imgData, 'JPEG', mapX, mapY, mapWidth, mapHeight, undefined, 'FAST');
      pdf.setLineWidth(borderWidth);
      pdf.setDrawColor(0, 0, 0);
      pdf.rect(mapX, mapY, mapWidth, mapHeight);
    }

    const currentDate = new Date().toLocaleDateString('en-GB');

    // Draw details panel based on template (matching screenshot structure)
    if (settings.template === 'template1' || settings.template === 'template3') {
      // Vertical sidebar layout
      const sidebarWidth = detailsPanelWidth;
      pdf.setLineWidth(borderWidth);
      pdf.setDrawColor(0, 0, 0);

      // Title section
      let currentY = detailsY;
      pdf.rect(detailsX, currentY, sidebarWidth, 40);
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text(settings.title, detailsX + sidebarWidth / 2, currentY + 25, { align: 'center' });
      currentY += 40;

      // Subtitle section
      pdf.setLineWidth(borderWidth);
      pdf.setDrawColor(0, 0, 0);
      pdf.rect(detailsX, currentY, sidebarWidth, 30);
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Map Export', detailsX + 10, currentY + 18);
      currentY += 30;

      // For Office use section
      if (settings.includeOfficeUse) {
        pdf.setLineWidth(borderWidth);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(detailsX, currentY, sidebarWidth, 80);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text('For Office use :', detailsX + 10, currentY + 15);
        pdf.setFontSize(9);
        pdf.text('Created By:', detailsX + 10, currentY + 35);
        pdf.setLineWidth(0.5); // Thinner line for writing space
        pdf.line(detailsX + 70, currentY + 35, detailsX + sidebarWidth - 10, currentY + 35);
        pdf.setLineWidth(borderWidth); // Reset
        pdf.text('Authorised By:', detailsX + 10, currentY + 60);
        pdf.setLineWidth(0.5); // Thinner line for writing space
        pdf.line(detailsX + 70, currentY + 60, detailsX + sidebarWidth - 10, currentY + 60);
        pdf.setLineWidth(borderWidth); // Reset
        currentY += 80;
      }

      // Legend section - Fixed height to ensure layout consistency
      if (settings.includeLegend) {
        const legendHeight = 180;
        pdf.setLineWidth(borderWidth);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(detailsX, currentY, sidebarWidth, legendHeight);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Legend :', detailsX + 10, currentY + 15);
        pdf.setFont('helvetica', 'normal');
        const legendItemY = currentY + 28;
        const legendLimitY = currentY + legendHeight - 15;
        const hasWms = page1Wms.length > 0;
        const itemCount = page1Vector.length;
        const colWidth = (sidebarWidth - 30) / 2;

        if (hasWms) {
          // Left Column: WMS legends
          let leftY = legendItemY;
          page1Wms.forEach((lg) => {
            if (leftY > legendLimitY) return;

            pdf.setFontSize(7.5);
            pdf.setFont('helvetica', 'bold');
            pdf.text(lg.name, detailsX + 10, leftY);
            leftY += 8;

            const fullLg = geoserverLegends.find(l => l.id === lg.id);
            if (fullLg && fullLg.base64) {
              const maxWidth = colWidth - 10;
              const maxHeight = 120;
              let imgW = 24; // fallback
              let imgH = 24; // fallback

              if (fullLg.width && fullLg.height) {
                imgW = fullLg.width;
                imgH = fullLg.height;
                if (imgW > maxWidth) {
                  const aspect = fullLg.width / fullLg.height;
                  imgW = maxWidth;
                  imgH = imgW / aspect;
                }
                if (imgH > maxHeight) {
                  const aspect = fullLg.width / fullLg.height;
                  imgH = maxHeight;
                  imgW = imgH * aspect;
                }
              }

              if (leftY + imgH <= legendLimitY) {
                try {
                  pdf.addImage(fullLg.base64, 'PNG', detailsX + 10, leftY, imgW, imgH);
                  leftY += imgH + 4;
                } catch (err) {
                  console.warn('Failed to embed WMS legend in PDF:', err);
                  leftY += 4;
                }
              }
            } else {
              leftY += 4;
            }
          });

          // Right Column: Vector annotations
          let rightY = legendItemY;
          page1Vector.forEach((ann) => {
            if (rightY > legendLimitY) return;

            const iconX = detailsX + 15 + colWidth + 10;
            const iconY = rightY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(1.5);
              pdf.line(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(borderWidth);
              pdf.rect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              pdf.circle(iconX, iconY, 2.5, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(6.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, colWidth - 15);
            pdf.text(truncatedText, iconX + 8, iconY + 1.5);
            rightY += 10;
          });

        } else if (itemCount > 0) {
          // No WMS: Split vector annotations across both columns
          page1Vector.forEach((ann, idx) => {
            const itemsPerCol = Math.ceil(itemCount / 2);
            const colIdx = idx < itemsPerCol ? 0 : 1;
            const itemIdxInCol = idx < itemsPerCol ? idx : idx - itemsPerCol;

            const itemY = legendItemY + itemIdxInCol * 12;
            if (itemY > legendLimitY) return;

            const iconX = detailsX + 15 + colIdx * (colWidth + 10);
            const iconY = itemY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(1.5);
              pdf.line(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(borderWidth);
              pdf.rect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              pdf.circle(iconX, iconY, 2.5, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(6.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, colWidth - 15);
            pdf.text(truncatedText, iconX + 8, iconY + 1.5);
          });
        } else {
          pdf.setFontSize(8);
          pdf.setTextColor(128, 128, 128);
          pdf.text('No annotations on map', detailsX + 15, legendItemY);
        }

        if (overflowPages.length > 0) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(5.5);
          pdf.setTextColor(128, 128, 128);
          pdf.text('* Continued on Page 2...', detailsX + sidebarWidth - 75, currentY + legendHeight - 6);
        }

        currentY += legendHeight;
      }

      // Scale section
      if (settings.includeScale) {
        const scaleHeight = 80;
        pdf.setLineWidth(borderWidth);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(detailsX, currentY, sidebarWidth, scaleHeight);
        pdf.setFontSize(9);

        // Get actual projection from map
        let projectionCode = 'EPSG:3857';
        if (previewMapInstance) {
          const view = previewMapInstance.getView();
          const projection = view.getProjection();
          if (projection) {
            projectionCode = projection.getCode();
          }
        }

        pdf.text(`Scale: ${liveScale}`, detailsX + 10, currentY + 15);
        pdf.text(`Projection: ${projectionCode}`, detailsX + 10, currentY + 30);
        pdf.text(`Date: ${currentDate}`, detailsX + 10, currentY + 45);
        currentY += scaleHeight;
      }

      // Footer section - at the very bottom
      const remainingHeight = (pageHeightPt - margin - padding) - currentY;
      pdf.setLineWidth(borderWidth);
      pdf.setDrawColor(0, 0, 0);
      pdf.rect(detailsX, currentY, sidebarWidth, remainingHeight);

      // Position text at the bottom of this section
      const footerTextY = currentY + remainingHeight - 15;
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      pdf.text('Powered by RottenGrapes Pvt Ltd', detailsX + sidebarWidth / 2, footerTextY, { align: 'center' });
    } else if (settings.template === 'template2' || settings.template === 'template4') {
      // Portrait layout - title at top, then either details or map
      const titleHeight = 40;

      // Draw title at the very top (only bottom border line, matching preview)
      pdf.setLineWidth(borderWidth);
      pdf.setDrawColor(0, 0, 0);
      pdf.line(contentX, contentY + titleHeight, contentX + contentWidth, contentY + titleHeight);
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text(settings.title, pageWidthPt / 2, contentY + 25, { align: 'center' });

      const currentDetailsY = settings.template === 'template2' ? mapAreaY + mapAreaHeight + gap : detailsY;
      const detailsPanelHeight = 200;

      const nextY = currentDetailsY;

      // Dynamically calculate columns
      const activeColumns = [];
      if (settings.includeOfficeUse) activeColumns.push('office');
      if (settings.includeLegend) activeColumns.push('legend');
      if (settings.includeScale) activeColumns.push('scale');

      const numCols = activeColumns.length;
      const colWidth = numCols > 0 ? contentWidth / numCols : 0;

      let colIdx = 0;

      // Column: For Office use
      if (settings.includeOfficeUse) {
        const sectionX = contentX + colIdx * colWidth;
        pdf.setLineWidth(borderWidth);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(sectionX, nextY, colWidth, detailsPanelHeight);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text('For Office use :', sectionX + 10, nextY + 20);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.text('Created By:', sectionX + 10, nextY + 40);
        pdf.setLineWidth(0.5); // Thinner line for writing space
        pdf.line(sectionX + 10, nextY + 50, sectionX + colWidth - 10, nextY + 50);
        pdf.setLineWidth(borderWidth); // Reset
        pdf.text('Authorised By:', sectionX + 10, nextY + 70);
        pdf.setLineWidth(0.5); // Thinner line for writing space
        pdf.line(sectionX + 10, nextY + 80, sectionX + colWidth - 10, nextY + 80);
        pdf.setLineWidth(borderWidth); // Reset
        colIdx++;
      }

      // Column: Legend - Dynamic based on annotations
      if (settings.includeLegend) {
        const col2X = contentX + colIdx * colWidth;
        pdf.setLineWidth(borderWidth);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(col2X, nextY, colWidth, detailsPanelHeight);
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Legend :', col2X + 10, nextY + 20);
        pdf.setFont('helvetica', 'normal');

        const legendItemY = nextY + 32;
        const legendLimitY = nextY + detailsPanelHeight - 10;
        const hasWms = page1Wms.length > 0;
        const itemCount = page1Vector.length;
        const innerColWidth = (colWidth - 25) / 2;

        if (hasWms) {
          // Left Column: WMS legends
          let leftY = legendItemY;
          page1Wms.forEach((lg) => {
            if (leftY > legendLimitY) return;

            pdf.setFontSize(6.5);
            pdf.setFont('helvetica', 'bold');
            pdf.text(lg.name, col2X + 10, leftY);
            leftY += 7;

            const fullLg = geoserverLegends.find(l => l.id === lg.id);
            if (fullLg && fullLg.base64) {
              const maxWidth = innerColWidth - 5;
              const maxHeight = 120;
              let imgW = 24; // fallback
              let imgH = 24; // fallback

              if (fullLg.width && fullLg.height) {
                imgW = fullLg.width;
                imgH = fullLg.height;
                if (imgW > maxWidth) {
                  const aspect = fullLg.width / fullLg.height;
                  imgW = maxWidth;
                  imgH = imgW / aspect;
                }
                if (imgH > maxHeight) {
                  const aspect = fullLg.width / fullLg.height;
                  imgH = maxHeight;
                  imgW = imgH * aspect;
                }
              }

              if (leftY + imgH <= legendLimitY) {
                try {
                  pdf.addImage(fullLg.base64, 'PNG', col2X + 10, leftY, imgW, imgH);
                  leftY += imgH + 3;
                } catch (err) {
                  console.warn('Failed to embed WMS legend in PDF:', err);
                  leftY += 4;
                }
              }
            } else {
              leftY += 4;
            }
          });

          // Right Column: Vector annotations
          let rightY = legendItemY;
          page1Vector.forEach((ann) => {
            if (rightY > legendLimitY) return;

            const iconX = col2X + 10 + innerColWidth + 8;
            const iconY = rightY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, 2.5, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, 2.5, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(1);
              pdf.line(iconX - 4, iconY, iconX + 4, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(borderWidth);
              pdf.rect(iconX - 2.5, iconY - 2.5, 5, 5, 'FD');
            } else {
              pdf.circle(iconX, iconY, 1.5, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(5.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, innerColWidth - 10);
            pdf.text(truncatedText, iconX + 8, iconY + 1.5);
            rightY += 8;
          });
        } else if (itemCount > 0) {
          // Split vector annotations across both columns
          page1Vector.forEach((ann, idx) => {
            const itemsPerCol = Math.ceil(itemCount / 2);
            const colIdx = idx < itemsPerCol ? 0 : 1;
            const itemIdxInCol = idx < itemsPerCol ? idx : idx - itemsPerCol;

            const itemY = legendItemY + itemIdxInCol * 10;
            if (itemY > legendLimitY) return;

            const iconX = col2X + 10 + colIdx * (innerColWidth + 8);
            const iconY = itemY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, 2.5, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, 2.5, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(1);
              pdf.line(iconX - 4, iconY, iconX + 4, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(borderWidth);
              pdf.rect(iconX - 2.5, iconY - 2.5, 5, 5, 'FD');
            } else {
              pdf.circle(iconX, iconY, 1.5, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(0, 0, 0);
            pdf.setFontSize(5.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, innerColWidth - 10);
            pdf.text(truncatedText, iconX + 8, iconY + 1.5);
          });
        } else {
          pdf.setFontSize(7);
          pdf.setTextColor(128, 128, 128);
          pdf.text('No annotations', col2X + 15, legendItemY);
        }

        if (overflowPages.length > 0) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(5.5);
          pdf.setTextColor(128, 128, 128);
          pdf.text('* Continued on Page 2...', col2X + colWidth - 75, nextY + detailsPanelHeight - 6);
        }
        colIdx++;
      }

      // Column: Scale & Info
      if (settings.includeScale) {
        const col3X = contentX + colIdx * colWidth;
        pdf.setLineWidth(borderWidth);
        pdf.setDrawColor(0, 0, 0);
        pdf.rect(col3X, nextY, colWidth, detailsPanelHeight);
        pdf.setFontSize(9);

        // Get actual projection from map
        let projectionCode = 'EPSG:3857';
        if (previewMapInstance) {
          const view = previewMapInstance.getView();
          const projection = view.getProjection();
          if (projection) {
            projectionCode = projection.getCode();
          }
        }

        pdf.text(`Scale: ${liveScale}`, col3X + 10, nextY + 20);
        pdf.text(`Projection: ${projectionCode}`, col3X + 10, nextY + 35);
        pdf.text(`Date: ${currentDate}`, col3X + 10, nextY + 50);
      }

      // Footer
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0, 0, 0);
      const footerY = nextY + detailsPanelHeight - 15;
      pdf.text('Powered by RottenGrapes Pvt Ltd', pageWidthPt / 2, footerY, { align: 'center' });
    } else if (settings.template === 'custom') {
      const getPdfCoords = (rect: { left: number; top: number; width: number; height: number }) => {
        return {
          x: (rect.left / 100) * pageWidthPt,
          y: (rect.top / 100) * pageHeightPt,
          w: (rect.width / 100) * pageWidthPt,
          h: (rect.height / 100) * pageHeightPt
        };
      };

      const applyElementStyles = (coords: { x: number; y: number; w: number; h: number }, id: string) => {
        const styles = customStyles[id];
        if (!styles) return;

        // Draw background
        if (styles.backgroundColor && styles.backgroundColor !== 'transparent') {
          const opacity = (styles.backgroundOpacity ?? 100) / 100;
          if (opacity > 0) {
            const bgRgb = parseColorToRgb(styles.backgroundColor);

            const hasAlpha = opacity < 1;
            let gStateApplied = false;
            if (hasAlpha) {
              try {
                pdf.saveGraphicsState();
                pdf.setGState(new (pdf as any).GState({ opacity: opacity }));
                gStateApplied = true;
              } catch (e) {
                console.warn('GState not supported in jsPDF, falling back to solid background:', e);
              }
            }

            pdf.setFillColor(bgRgb.r, bgRgb.g, bgRgb.b);

            if (styles.borderRadius > 0) {
              pdf.roundedRect(coords.x, coords.y, coords.w, coords.h, styles.borderRadius, styles.borderRadius, 'F');
            } else {
              pdf.rect(coords.x, coords.y, coords.w, coords.h, 'F');
            }

            if (gStateApplied) {
              pdf.restoreGraphicsState();
            }
          }
        }

        // Draw border
        if (styles.borderWidth > 0 && styles.borderColor) {
          const borderRgb = parseColorToRgb(styles.borderColor, { r: 0, g: 0, b: 0, a: 1 });
          pdf.setDrawColor(borderRgb.r, borderRgb.g, borderRgb.b);
          pdf.setLineWidth(styles.borderWidth);

          if (styles.borderRadius > 0) {
            pdf.roundedRect(coords.x, coords.y, coords.w, coords.h, styles.borderRadius, styles.borderRadius, 'D');
          } else {
            pdf.rect(coords.x, coords.y, coords.w, coords.h, 'D');
          }
        }

        // Configure font & color for text
        pdf.setFontSize(styles.fontSize);
        const fontType = styles.fontWeight === 'bold'
          ? (styles.fontStyle === 'italic' ? 'bolditalic' : 'bold')
          : (styles.fontStyle === 'italic' ? 'italic' : 'normal');
        pdf.setFont('helvetica', fontType);

        if (styles.textColor) {
          const textRgb = parseColorToRgb(styles.textColor, { r: 0, g: 0, b: 0, a: 1 });
          pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b);
        }
      };

      // 1. Draw Map (Fill container completely, exactly matching preview)
      const mapCoords = getPdfCoords(customPositions.map);
      applyElementStyles(mapCoords, 'map');

      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      pdf.addImage(imgData, 'JPEG', mapCoords.x, mapCoords.y, mapCoords.w, mapCoords.h, undefined, 'FAST');

      const mapStyles = customStyles.map;
      if (mapStyles.borderWidth > 0 && mapStyles.borderColor) {
        const borderRgb = parseColorToRgb(mapStyles.borderColor, { r: 0, g: 0, b: 0, a: 1 });
        pdf.setDrawColor(borderRgb.r, borderRgb.g, borderRgb.b);
        pdf.setLineWidth(mapStyles.borderWidth);
        pdf.rect(mapCoords.x, mapCoords.y, mapCoords.w, mapCoords.h, 'D');
      }

      // 2. Draw Title
      const titleCoords = getPdfCoords(customPositions.title);
      applyElementStyles(titleCoords, 'title');
      pdf.text(settings.title, titleCoords.x + titleCoords.w / 2, titleCoords.y + titleCoords.h / 2 + customStyles.title.fontSize / 3, { align: 'center', maxWidth: titleCoords.w - 10 });

      // 3. Draw Office Use
      if (settings.includeOfficeUse) {
        const officeCoords = getPdfCoords(customPositions.office);
        applyElementStyles(officeCoords, 'office');
        const _oStyles = customStyles.office;
        const lineSpacing = officeCoords.h / 4;
        pdf.text('For Office use :', officeCoords.x + 8, officeCoords.y + lineSpacing);
        pdf.text('Created By: _______', officeCoords.x + 8, officeCoords.y + 2 * lineSpacing);
        pdf.text('Authorised By: _______', officeCoords.x + 8, officeCoords.y + 3 * lineSpacing);
      }

      // 4. Draw Legend
      if (settings.includeLegend) {
        const legendCoords = getPdfCoords(customPositions.legend);
        applyElementStyles(legendCoords, 'legend');
        const lStyles = customStyles.legend;
        const textRgb = parseColorToRgb(lStyles.textColor, { r: 0, g: 0, b: 0, a: 1 });

        const isBold = lStyles.fontWeight === 'bold';
        const isItalic = lStyles.fontStyle === 'italic';

        let fontStyleStr: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'normal';
        if (isBold && isItalic) {
          fontStyleStr = 'bolditalic';
        } else if (isBold) {
          fontStyleStr = 'bold';
        } else if (isItalic) {
          fontStyleStr = 'italic';
        }

        const headerFontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic' = isItalic ? (isBold ? 'bolditalic' : 'italic') : (isBold ? 'bold' : 'normal');
        pdf.setFont('helvetica', headerFontStyle);
        pdf.setFontSize(lStyles.fontSize);
        pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b);
        pdf.text('Legend :', legendCoords.x + 8, legendCoords.y + lStyles.fontSize * 1.5);

        pdf.setFont('helvetica', fontStyleStr);

        const legendItemY = legendCoords.y + lStyles.fontSize * 3.0;
        const legendLimitY = legendCoords.y + legendCoords.h - lStyles.fontSize;
        const hasWms = page1Wms.length > 0;
        const itemCount = page1Vector.length;
        const colWidth = (legendCoords.w - 30) / 2;

        if (hasWms) {
          // Left Column: WMS legends
          let leftY = legendItemY;
          page1Wms.forEach((lg) => {
            if (leftY > legendLimitY) return;

            pdf.setFontSize(lStyles.fontSize * 0.85);
            pdf.setFont('helvetica', fontStyleStr);
            pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b);
            pdf.text(lg.name, legendCoords.x + 10, leftY);
            leftY += lStyles.fontSize;

            const fullLg = geoserverLegends.find(l => l.id === lg.id);
            if (fullLg && fullLg.base64) {
              const maxWidth = colWidth - 10;
              const maxHeight = 120;
              let imgW = 24;
              let imgH = 24;

              if (fullLg.width && fullLg.height) {
                imgW = fullLg.width;
                imgH = fullLg.height;
                if (imgW > maxWidth) {
                  const aspect = fullLg.width / fullLg.height;
                  imgW = maxWidth;
                  imgH = imgW / aspect;
                }
                if (imgH > maxHeight) {
                  const aspect = fullLg.width / fullLg.height;
                  imgH = maxHeight;
                  imgW = imgH * aspect;
                }
              }

              if (leftY + imgH <= legendLimitY) {
                try {
                  pdf.addImage(fullLg.base64, 'PNG', legendCoords.x + 10, leftY, imgW, imgH);
                  leftY += imgH + 4;
                } catch (err) {
                  console.warn('Failed to embed WMS legend in PDF:', err);
                  leftY += 4;
                }
              }
            } else {
              leftY += 4;
            }
          });

          // Right Column: Vector annotations
          let rightY = legendItemY;
          page1Vector.forEach((ann) => {
            if (rightY > legendLimitY) return;

            const iconX = legendCoords.x + 15 + colWidth + 10;
            const iconY = rightY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(1.5);
              pdf.line(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(lStyles.borderWidth || 1.0);
              pdf.rect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              pdf.circle(iconX, iconY, 2.5, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b);
            pdf.setFont('helvetica', fontStyleStr);
            pdf.setFontSize(lStyles.fontSize * 0.85);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, colWidth - 15);
            pdf.text(truncatedText, iconX + 8, iconY + 1.5);
            rightY += lStyles.fontSize * 1.5;
          });
        } else if (itemCount > 0) {
          // No WMS: Split vector annotations across both columns
          page1Vector.forEach((ann, idx) => {
            const itemsPerCol = Math.ceil(itemCount / 2);
            const colIdx = idx < itemsPerCol ? 0 : 1;
            const itemIdxInCol = idx < itemsPerCol ? idx : idx - itemsPerCol;

            const itemY = legendItemY + itemIdxInCol * (lStyles.fontSize * 1.5);
            if (itemY > legendLimitY) return;

            const iconX = legendCoords.x + 10 + colIdx * (colWidth + 10);
            const iconY = itemY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(1.5);
              pdf.line(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(lStyles.borderWidth || 1.0);
              pdf.rect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              pdf.circle(iconX, iconY, 2.5, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b);
            pdf.setFont('helvetica', fontStyleStr);
            pdf.setFontSize(lStyles.fontSize * 0.85);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, colWidth - 15);
            pdf.text(truncatedText, iconX + 8, iconY + 1.5);
          });
        } else {
          pdf.setFont('helvetica', fontStyleStr);
          pdf.setFontSize(lStyles.fontSize * 0.85);
          pdf.setTextColor(textRgb.r, textRgb.g, textRgb.b);
          pdf.text('No annotations', legendCoords.x + 10, legendItemY);
        }

        if (overflowPages.length > 0) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(lStyles.fontSize * 0.75);
          pdf.setTextColor(128, 128, 128);
          pdf.text('* Continued on Page 2...', legendCoords.x + legendCoords.w - 75, legendCoords.y + legendCoords.h - 5);
        }
      }

      // 5. Draw Scale
      if (settings.includeScale) {
        const scaleCoords = getPdfCoords(customPositions.scale);
        applyElementStyles(scaleCoords, 'scale');
        let projectionCode = 'EPSG:3857';
        if (previewMapInstance) {
          const view = previewMapInstance.getView();
          const projection = view.getProjection();
          if (projection) {
            projectionCode = projection.getCode();
          }
        }

        const sStyles = customStyles.scale;
        const lineSpacing = sStyles.fontSize * 1.4;
        const totalTextHeight = 3 * lineSpacing;
        const startY = scaleCoords.y + (scaleCoords.h - totalTextHeight) / 2 + sStyles.fontSize;

        pdf.text(`Scale: ${liveScale}`, scaleCoords.x + 8, startY);
        pdf.text(`Projection: ${projectionCode}`, scaleCoords.x + 8, startY + lineSpacing);
        pdf.text(`Date: ${currentDate}`, scaleCoords.x + 8, startY + 2 * lineSpacing);
      }

      // 7. Draw North Arrow
      if (settings.includeNorthArrow) {
        const northCoords = getPdfCoords(customPositions.northArrow);
        applyElementStyles(northCoords, 'northArrow');

        const arrowStyles = customStyles.northArrow;
        const arrowRgb = parseColorToRgb(arrowStyles.textColor, { r: 0, g: 0, b: 0, a: 1 });
        const fontSizePt = Math.max(8, arrowStyles.fontSize || 8);
        const arrowIconSize = Math.min(22, fontSizePt * 1.8);
        const textHeight = fontSizePt * 1.2;
        const gap = 2;
        const totalHeight = textHeight + gap + arrowIconSize;

        const centerX = northCoords.x + northCoords.w / 2;
        const centerY = northCoords.y + northCoords.h / 2;
        const startY = centerY - totalHeight / 2;

        pdf.setTextColor(arrowRgb.r, arrowRgb.g, arrowRgb.b);
        pdf.setFontSize(fontSizePt * 1.2);
        pdf.setFont('helvetica', 'bold');

        // Draw 'N' text centered
        pdf.text('N', centerX, startY + textHeight * 0.85, { align: 'center' });

        // Draw chevron arrow matching live preview SVG
        pdf.setFillColor(arrowRgb.r, arrowRgb.g, arrowRgb.b);
        pdf.setDrawColor(arrowRgb.r, arrowRgb.g, arrowRgb.b);
        pdf.setLineWidth(0.5);

        const arrowTopY = startY + textHeight + gap;
        const arrowH = arrowIconSize;
        const halfW = arrowH * 0.25;

        pdf.lines([
          [halfW, arrowH],
          [-halfW, -(arrowH * 0.25)],
          [-halfW, arrowH * 0.25],
        ], centerX, arrowTopY, [1, 1], 'FD', true);
      }

      // 6. Draw Footer
      const footerCoords = getPdfCoords(customPositions.footer);
      applyElementStyles(footerCoords, 'footer');
      pdf.text('Powered by RottenGrapes Pvt Ltd', footerCoords.x + footerCoords.w / 2, footerCoords.y + footerCoords.h / 2 + customStyles.footer.fontSize / 3, { align: 'center' });
    }

    // Draw Overflow Pages (Page 2+) in the PDF
    overflowPages.forEach((page, pageIdx) => {
      pdf.addPage();

      // 1. Draw Page Border and Margins
      pdf.setDrawColor(0, 0, 0);
      pdf.setLineWidth(1);
      pdf.rect(margin, margin, pageWidthPt - 2 * margin, pageHeightPt - 2 * margin);

      // 2. Draw Page Header
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0);
      pdf.text(`${settings.title} - Legend (Page ${pageIdx + 2})`, margin + 15, margin + 20);
      pdf.line(margin, margin + 28, pageWidthPt - margin, margin + 28);

      // 3. Draw Page Footer
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.text('Powered by RottenGrapes Pvt Ltd', pageWidthPt / 2, pageHeightPt - margin - 8, { align: 'center' });
      pdf.line(margin, pageHeightPt - margin - 15, pageWidthPt - margin, pageHeightPt - margin - 15);

      // 4. Draw Columns (2 columns in Portrait, 3 columns in Landscape)
      const numCols = page.cols && page.cols.length > 0 ? page.cols.length : (isPortrait ? 2 : 3);
      const colGap = 15;
      const totalGaps = (numCols - 1) * colGap;
      const colWidthOverflow = (pageWidthPt - 2 * margin - 30 - totalGaps) / numCols;
      const startY = margin + 40;
      const fontSizeOverflow = 8;

      const drawColumn = (colItems: LegendItem[], colIndex: number) => {
        const colX = margin + 15 + colIndex * (colWidthOverflow + colGap);
        let itemY = startY;

        colItems.forEach((item) => {
          if (item.type === 'wms') {
            // Draw Title
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(fontSizeOverflow * 0.9);
            pdf.text(item.name, colX, itemY + 6);
            itemY += fontSizeOverflow * 0.9 + 8;

            // Draw WMS Image
            const fullLg = geoserverLegends.find(l => l.id === item.id);
            if (fullLg && fullLg.base64) {
              let imgH = 24; // fallback
              let imgW = 24; // fallback
              const dims = dimsRecord[item.id];
              if (dims && dims.width && dims.height) {
                imgW = dims.width;
                imgH = dims.height;
                if (imgW > colWidthOverflow - 10) {
                  const aspect = dims.width / dims.height;
                  imgW = colWidthOverflow - 10;
                  imgH = imgW / aspect;
                }
                const maxImgH = isPortrait ? 280 : 200;
                if (imgH > maxImgH) {
                  const aspect = dims.width / dims.height;
                  imgH = maxImgH;
                  imgW = imgH * aspect;
                }
              }
              try {
                pdf.addImage(fullLg.base64, 'PNG', colX, itemY, imgW, imgH);

                // Draw bottom border line
                pdf.setDrawColor(229, 231, 235);
                pdf.setLineWidth(0.5);
                pdf.line(colX, itemY + imgH + 4, colX + colWidthOverflow - 10, itemY + imgH + 4);

                itemY += imgH + 12;
              } catch (e) {
                console.warn('Failed to embed WMS legend on overflow page:', e);
                itemY += 6;
              }
            } else {
              itemY += 6;
            }
          } else {
            // Draw Vector item
            const iconX = colX + fontSizeOverflow * 0.35;
            const iconY = itemY - fontSizeOverflow * 0.35;
            const iconSize = fontSizeOverflow * 0.35;

            const geomType = item.geometry.toLowerCase();
            const labelText = (item.label || item.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyPdfColors(pdf, item.strokeColor || '#1890ff', item.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              pdf.circle(iconX, iconY, iconSize, 'F');
            } else if (isCircle) {
              pdf.circle(iconX, iconY, iconSize, 'FD');
            } else if (isLine) {
              pdf.setLineWidth(fontSizeOverflow * 0.15);
              pdf.line(iconX - iconSize, iconY, iconX + iconSize, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              pdf.setLineWidth(fontSizeOverflow * 0.1);
              pdf.rect(iconX - iconSize, iconY - iconSize, iconSize * 2, iconSize * 2, 'FD');
            } else {
              pdf.circle(iconX, iconY, iconSize, 'FD');
            }

            pdf.setDrawColor(0, 0, 0);
            pdf.setTextColor(0, 0, 0);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(fontSizeOverflow);
            const displayText = item.label || item.type.replace(/_/g, ' ');
            const truncatedText = truncatePdfText(displayText, colWidthOverflow - iconSize * 3 - 5);
            pdf.text(truncatedText, colX + iconSize * 3, itemY);
            itemY += fontSizeOverflow * 1.5 + 4;
          }
        });
      };

      if (page.cols && page.cols.length > 0) {
        page.cols.forEach((colItems, colIndex) => {
          drawColumn(colItems, colIndex);
        });
      } else {
        drawColumn(page.col1, 0);
        drawColumn(page.col2, 1);
        if (page.col3) drawColumn(page.col3, 2);
      }
    });

    const downloadName = settings.filename
      ? (settings.filename.endsWith('.pdf') ? settings.filename : `${settings.filename}.pdf`)
      : `${settings.title.replace(/[^a-zA-Z0-9]/g, '_')}_${currentDate.replace(/\//g, '-')}.pdf`;
    pdf.save(downloadName);
  }, [settings, liveScale, customPositions, customStyles, addedLayers, previewMapInstance, loadedLegends, legendDimensions, getPage1LegendParams]);

  const generateJPEG = useCallback(async (canvas: HTMLCanvasElement): Promise<void> => {
    const outputCanvas = document.createElement('canvas');
    const outputContext = outputCanvas.getContext('2d', { alpha: false });

    if (!outputContext) {
      throw new Error('Unable to create output canvas context');
    }

    const pageInfo = pageSizes[settings.pageSize];
    const isPortrait = settings.layout === 'portrait';

    // Page dimensions in points
    const pageWidthPt = isPortrait ? pageInfo.width * 2.83465 : pageInfo.height * 2.83465;
    const pageHeightPt = isPortrait ? pageInfo.height * 2.83465 : pageInfo.width * 2.83465;

    const scale = settings.dpi / 72;
    const outputWidth = pageWidthPt * scale;
    const outputHeight = pageHeightPt * scale;

    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;

    // Background fill
    outputContext.fillStyle = '#ffffff';
    outputContext.fillRect(0, 0, outputWidth, outputHeight);

    // Extract ALL vector layers and features from map for legend (matching generatePDF)
    const mapAnnotations: Array<{ type: string, label: string, geometry: string, strokeColor: string, fillColor: string }> = [];
    const seenKeys = new Set<string>();

    let viewportExtent: number[] | null = null;
    if (previewMapInstance) {
      const size = previewMapInstance.getSize();
      if (size && size[0] > 0 && size[1] > 0) {
        viewportExtent = previewMapInstance.getView().calculateExtent(size);
      }
    }

    const geoserverLegends: Array<{ id: string; name: string; url: string; base64: string | null; width?: number; height?: number; imgElement?: HTMLImageElement }> = [];

    // Fetch WMS legend base64 images and preload Image elements
    const legendUrlsToFetch: Array<{ id: string; name: string; url: string }> = [];
    const seenLayers = new Set<string>();

    if (previewMapInstance) {
      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        if (layerName) {
          // Bounding box check to verify if visible in current viewport view
          const bbox = layer.get('bbox');
          if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
            const coords = bbox.coordinates[0];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coords.forEach((c: number[]) => {
              const lon = c[0];
              const lat = c[1];
              if (lon < minX) minX = lon;
              if (lon > maxX) maxX = lon;
              if (lat < minY) minY = lat;
              if (lat > maxY) maxY = lat;
            });
            const layerExtent = [
              ...fromLonLat([minX, minY]),
              ...fromLonLat([maxX, maxY])
            ];
            if (!extentsIntersect(layerExtent, viewportExtent)) {
              return; // Layer is not visible in current viewport
            }
          }

          const key = `layer_${layerId || layerName}`;
          if (!seenLayers.has(key)) {
            seenLayers.add(key);

            const matchingLayer = addedLayers.find(l => l.name === layerName || l.id === layerId);
            const activeStyle = matchingLayer?.activeStyle || '';
            const activeStyleObj = matchingLayer?.styles?.find(s => s.name === activeStyle);

            const legendUrl = activeStyleObj?.legendUrl
              ? activeStyleObj.legendUrl
              : buildLegendUrl(layerName, activeStyle);

            legendUrlsToFetch.push({ id: layerId || layerName, name: layerName, url: legendUrl });
          }
        }
      });

      // Preload images in parallel preserving exact order
      const imgElements: Array<HTMLImageElement | undefined> = new Array(legendUrlsToFetch.length);
      const loadPromises = legendUrlsToFetch.map(async (item, index) => {
        const base64 = loadedLegends[item.id] || null;
        if (base64) {
          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = base64;
          });
          imgElements[index] = img;
        }
      });
      await Promise.all(loadPromises);

      // Populate geoserverLegends synchronously in correct order
      legendUrlsToFetch.forEach((item, index) => {
        const base64 = loadedLegends[item.id] || null;
        const dims = legendDimensions[item.id] || null;
        geoserverLegends.push({
          id: item.id,
          name: item.name,
          url: item.url,
          base64: base64,
          width: dims ? dims.width : undefined,
          height: dims ? dims.height : undefined,
          imgElement: imgElements[index]
        });
      });
    }

    if (previewMapInstance) {
      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        // Skip base tile layers and unnamed/unidentified vector layers (e.g. highlights)
        if (!layerName && layerId !== 'annotations' && layerId !== 'measurements') return;

        // Bounding box check for dataset layers
        const bbox = layer.get('bbox');
        if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
          const coords = bbox.coordinates[0];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          coords.forEach((c: number[]) => {
            const lon = c[0];
            const lat = c[1];
            if (lon < minX) minX = lon;
            if (lon > maxX) maxX = lon;
            if (lat < minY) minY = lat;
            if (lat > maxY) maxY = lat;
          });
          const layerExtent = [
            ...fromLonLat([minX, minY]),
            ...fromLonLat([maxX, maxY])
          ];
          if (!extentsIntersect(layerExtent, viewportExtent)) {
            return; // Layer is not visible in current viewport
          }
        }

        // If it is a dataset layer (has a name)
        if (layerName) {
          return;
        }

        // If it is measurements layer
        if (layerId === 'measurements') {
          const source = layer.getSource?.();
          if (source && typeof source.getFeatures === 'function') {
            try {
              const features = source.getFeatures();
              features.forEach((feature: any) => {
                if (feature.get('visible') === false) return;
                const geom = feature.getGeometry();
                if (!geom) return;

                if (viewportExtent && typeof geom.intersectsExtent === 'function') {
                  if (!geom.intersectsExtent(viewportExtent)) return;
                }

                const geomType = geom.getType();
                const displayVal = feature.get('displayVal') || '';
                const label = `${geomType === 'LineString' ? 'Line' : 'Area'} Measurement (${displayVal})`;
                const key = `measurement_${feature.getId() || label}`;

                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  const colors = getLayerColors(layer, feature);
                  mapAnnotations.push({
                    type: label,
                    label: label,
                    geometry: geomType,
                    strokeColor: colors.strokeColor,
                    fillColor: colors.fillColor
                  });
                }
              });
            } catch (e) {
              console.log('Error extracting measurement features:', e);
            }
          }
          return;
        }

        // If it is annotations layer
        if (layerId === 'annotations') {
          const source = layer.getSource?.();
          if (source && typeof source.getFeatures === 'function') {
            try {
              const features = source.getFeatures();
              features.forEach((feature: any) => {
                if (feature.get('visible') === false) return;
                const geom = feature.getGeometry();
                if (!geom) return;

                if (viewportExtent && typeof geom.intersectsExtent === 'function') {
                  if (!geom.intersectsExtent(viewportExtent)) return;
                }

                const geomType = geom.getType();
                const label = feature.get('label') || feature.get('name') || feature.get('type') || geomType;
                const key = `annotation_${feature.getId() || label}`;

                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  const colors = getLayerColors(layer, feature);
                  mapAnnotations.push({
                    type: label,
                    label: label,
                    geometry: geomType,
                    strokeColor: colors.strokeColor,
                    fillColor: colors.fillColor
                  });
                }
              });
            } catch (e) {
              console.log('Error extracting annotation features:', e);
            }
          }
          return;
        }
      });
    }

    const dimsRecord: Record<string, { width: number; height: number }> = {};
    geoserverLegends.forEach((lg) => {
      if (lg.width && lg.height) {
        dimsRecord[lg.id] = { width: lg.width, height: lg.height };
      }
    });

    const pageParams = getPage1LegendParams();
    const { page1Wms, page1Vector, overflowPages } = calculateLegendSplit(
      geoserverLegends,
      mapAnnotations,
      pageParams.availableHeight,
      pageParams.colWidth,
      pageParams.fontSize,
      dimsRecord,
      pageParams.pageWidthPt,
      pageParams.pageHeightPt
    );

    const margin = 20;
    const padding = 10;
    const gap = 10;
    const detailsPanelWidth = 240;
    const borderWidth = 1.0;

    const contentX = margin + padding;
    const contentY = margin + padding;
    const contentWidth = pageWidthPt - (2 * margin) - (2 * padding);
    const contentHeight = pageHeightPt - (2 * margin) - (2 * padding);

    let mapAreaX, mapAreaY, mapAreaWidth, mapAreaHeight;
    let detailsX, detailsY;

    // Template-based layout
    if (settings.template === 'template1') {
      // Map on left, details on right
      mapAreaX = contentX;
      mapAreaY = contentY;
      mapAreaWidth = contentWidth - gap - detailsPanelWidth;
      mapAreaHeight = contentHeight;
      detailsX = mapAreaX + mapAreaWidth + gap;
      detailsY = contentY;
    } else if (settings.template === 'template2') {
      const detailsPanelHeight = 200;
      const titleHeight = 40;
      mapAreaX = contentX;
      mapAreaY = contentY + titleHeight + gap;
      mapAreaWidth = contentWidth;
      mapAreaHeight = contentHeight - (2 * gap) - titleHeight - detailsPanelHeight;
      detailsX = contentX;
      detailsY = mapAreaY + mapAreaHeight + gap;
    } else if (settings.template === 'template3') {
      // Map on right, details on left
      mapAreaX = contentX + detailsPanelWidth + gap;
      mapAreaY = contentY;
      mapAreaWidth = contentWidth - gap - detailsPanelWidth;
      mapAreaHeight = contentHeight;
      detailsX = contentX;
      detailsY = contentY;
    } else {
      const detailsPanelHeight = 200;
      const titleHeight = 40;
      mapAreaX = contentX;
      mapAreaY = contentY + titleHeight + gap + detailsPanelHeight + gap;
      mapAreaWidth = contentWidth;
      mapAreaHeight = contentHeight - (3 * gap) - titleHeight - detailsPanelHeight;
      detailsX = contentX;
      detailsY = contentY + titleHeight + gap;
    }

    let mapWidth = mapAreaWidth;
    let mapHeight = mapAreaHeight;
    let mapX = mapAreaX;
    let mapY = mapAreaY;

    if (settings.template !== 'custom') {
      // Canvas maintains north orientation (not rotated)
      const canvasAspectRatio = canvas.width / canvas.height;
      const areaAspectRatio = mapAreaWidth / mapAreaHeight;

      if (canvasAspectRatio > areaAspectRatio) {
        mapHeight = mapWidth / canvasAspectRatio;
        mapY = mapAreaY + (mapAreaHeight - mapHeight) / 2;
      } else {
        mapWidth = mapHeight * canvasAspectRatio;
        mapX = mapAreaX + (mapAreaWidth - mapWidth) / 2;
      }
    }

    // Canvas drawing helper variables/states
    let currentFontSize = 10;
    let currentFontWeight = 'normal';
    let currentFontStyle = 'normal';
    let currentTextColor = 'rgb(0,0,0)';

    const truncateCanvasText = (text: string, maxWidth: number): string => {
      const weightPart = currentFontWeight === 'bold' ? 'bold' : '';
      const stylePart = currentFontStyle === 'italic' ? 'italic' : '';
      outputContext.font = `${stylePart} ${weightPart} ${currentFontSize * scale}px Helvetica, Arial, sans-serif`.trim();

      if (outputContext.measureText(text).width <= maxWidth * scale) return text;
      let truncated = text;
      while (truncated.length > 0 && outputContext.measureText(truncated + '...').width > maxWidth * scale) {
        truncated = truncated.slice(0, -1);
      }
      return truncated + '...';
    };

    const setFontSize = (size: number) => {
      currentFontSize = size;
    };
    const setFont = (family: string, weight?: string) => {
      const combined = `${family || ''} ${weight || ''}`.toLowerCase();
      currentFontWeight = combined.includes('bold') ? 'bold' : 'normal';
      currentFontStyle = combined.includes('italic') ? 'italic' : 'normal';
    };
    const _setFontStyle = (style: string) => {
      currentFontStyle = style;
    };
    const setTextColor = (colorOrR: string | number, g?: number, b?: number) => {
      if (typeof colorOrR === 'string') {
        currentTextColor = colorOrR;
      } else if (g === undefined && b === undefined) {
        currentTextColor = `rgb(${colorOrR},${colorOrR},${colorOrR})`;
      } else {
        currentTextColor = `rgb(${colorOrR},${g},${b})`;
      }
    };
    const setLineWidth = (w: number) => {
      outputContext.lineWidth = w * scale;
    };
    const setDrawColor = (colorOrR: string | number, g?: number, b?: number) => {
      if (typeof colorOrR === 'string') {
        outputContext.strokeStyle = colorOrR;
      } else if (g === undefined && b === undefined) {
        outputContext.strokeStyle = `rgb(${colorOrR},${colorOrR},${colorOrR})`;
      } else {
        outputContext.strokeStyle = `rgb(${colorOrR},${g},${b})`;
      }
    };
    const _setFillColor = (colorOrR: string | number, g?: number, b?: number) => {
      if (typeof colorOrR === 'string') {
        outputContext.fillStyle = colorOrR;
      } else if (g === undefined && b === undefined) {
        outputContext.fillStyle = `rgb(${colorOrR},${colorOrR},${colorOrR})`;
      } else {
        outputContext.fillStyle = `rgb(${colorOrR},${g},${b})`;
      }
    };
    const drawRect = (x: number, y: number, w: number, h: number, style?: 'F' | 'FD') => {
      outputContext.beginPath();
      outputContext.rect(x * scale, y * scale, w * scale, h * scale);
      if (style === 'F') {
        outputContext.fill();
      } else if (style === 'FD') {
        outputContext.fill();
        outputContext.stroke();
      } else {
        outputContext.stroke();
      }
    };
    const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
      outputContext.beginPath();
      outputContext.moveTo(x1 * scale, y1 * scale);
      outputContext.lineTo(x2 * scale, y2 * scale);
      outputContext.stroke();
    };
    const drawCircle = (x: number, y: number, r: number, style?: 'F' | 'FD') => {
      outputContext.beginPath();
      outputContext.arc(x * scale, y * scale, r * scale, 0, 2 * Math.PI);
      if (style === 'F') {
        outputContext.fill();
      } else if (style === 'FD') {
        outputContext.fill();
        outputContext.stroke();
      } else {
        outputContext.stroke();
      }
    };
    const drawText = (text: string, x: number, y: number, options?: { align?: 'center' | 'left' | 'right', baseline?: CanvasTextBaseline }) => {
      outputContext.fillStyle = currentTextColor;
      const weightPart = currentFontWeight === 'bold' ? 'bold' : '';
      const stylePart = currentFontStyle === 'italic' ? 'italic' : '';
      outputContext.font = `${stylePart} ${weightPart} ${currentFontSize * scale}px Helvetica, Arial, sans-serif`.trim();
      outputContext.textAlign = options?.align || 'left';
      outputContext.textBaseline = options?.baseline || 'alphabetic';
      outputContext.fillText(text, x * scale, y * scale);
    };
    const applyCanvasColors = (strokeColor: string, fillColor: string) => {
      outputContext.strokeStyle = strokeColor;
      outputContext.fillStyle = fillColor;
    };

    // Page border (uniform black, line weight 1.5) - Only for standard templates
    if (settings.template !== 'custom') {
      setLineWidth(borderWidth);
      setDrawColor(0, 0, 0);
      drawRect(margin, margin, pageWidthPt - (2 * margin), pageHeightPt - (2 * margin));
    }

    if (settings.template !== 'custom') {
      // Map image - drawn directly from map canvas
      outputContext.drawImage(canvas, mapX * scale, mapY * scale, mapWidth * scale, mapHeight * scale);
      setLineWidth(borderWidth);
      setDrawColor(0, 0, 0);
      drawRect(mapX, mapY, mapWidth, mapHeight);
    }

    const currentDate = new Date().toLocaleDateString('en-GB');

    // Draw details panel based on template
    if (settings.template === 'template1' || settings.template === 'template3') {
      // Vertical sidebar layout
      const sidebarWidth = detailsPanelWidth;
      setLineWidth(borderWidth);
      setDrawColor(0, 0, 0);

      // Title section
      let currentY = detailsY;
      drawRect(detailsX, currentY, sidebarWidth, 40);
      setFontSize(16);
      setFont('helvetica', 'bold');
      drawText(settings.title, detailsX + sidebarWidth / 2, currentY + 25, { align: 'center' });
      currentY += 40;

      // Subtitle section
      setLineWidth(borderWidth);
      setDrawColor(0, 0, 0);
      drawRect(detailsX, currentY, sidebarWidth, 30);
      setFontSize(10);
      setFont('helvetica', 'normal');
      drawText('Map Export', detailsX + 10, currentY + 18);
      currentY += 30;

      // For Office use section
      if (settings.includeOfficeUse) {
        setLineWidth(borderWidth);
        setDrawColor(0, 0, 0);
        drawRect(detailsX, currentY, sidebarWidth, 80);
        setFontSize(10);
        setFont('helvetica', 'normal');
        drawText('For Office use :', detailsX + 10, currentY + 15);
        setFontSize(9);
        drawText('Created By:', detailsX + 10, currentY + 35);
        setLineWidth(0.5); // Thinner line for writing space
        drawLine(detailsX + 70, currentY + 35, detailsX + sidebarWidth - 10, currentY + 35);
        setLineWidth(borderWidth); // Reset
        drawText('Authorised By:', detailsX + 10, currentY + 60);
        setLineWidth(0.5); // Thinner line for writing space
        drawLine(detailsX + 70, currentY + 60, detailsX + sidebarWidth - 10, currentY + 60);
        setLineWidth(borderWidth); // Reset
        currentY += 80;
      }      // Legend section
      if (settings.includeLegend) {
        const legendHeight = 180;
        setLineWidth(borderWidth);
        setDrawColor(0, 0, 0);
        drawRect(detailsX, currentY, sidebarWidth, legendHeight);
        setFontSize(10);
        setFont('helvetica', 'bold');
        drawText('Legend :', detailsX + 10, currentY + 15);
        setFont('helvetica', 'normal');

        const legendItemY = currentY + 28;
        const legendLimitY = currentY + legendHeight - 15;
        const hasWms = page1Wms.length > 0;
        const itemCount = page1Vector.length;
        const colWidth = (sidebarWidth - 30) / 2;

        if (hasWms) {
          // Left Column: WMS legends
          let leftY = legendItemY;
          page1Wms.forEach((lg) => {
            if (leftY > legendLimitY) return;

            setFontSize(7.5);
            setFont('helvetica', 'bold');
            drawText(lg.name, detailsX + 10, leftY);
            leftY += 8;

            const fullLg = geoserverLegends.find(l => l.id === lg.id);
            if (fullLg && fullLg.imgElement) {
              const maxWidth = colWidth - 10;
              const maxHeight = 120;
              let imgW = 24; // fallback
              let imgH = 24; // fallback

              if (fullLg.width && fullLg.height) {
                imgW = fullLg.width;
                imgH = fullLg.height;
                if (imgW > maxWidth) {
                  const aspect = fullLg.width / fullLg.height;
                  imgW = maxWidth;
                  imgH = imgW / aspect;
                }
                if (imgH > maxHeight) {
                  const aspect = fullLg.width / fullLg.height;
                  imgH = maxHeight;
                  imgW = imgH * aspect;
                }
              }

              if (leftY + imgH <= legendLimitY) {
                try {
                  outputContext.drawImage(fullLg.imgElement, (detailsX + 10) * scale, leftY * scale, imgW * scale, imgH * scale);
                  leftY += imgH + 4;
                } catch (err) {
                  console.warn('Failed to embed WMS legend in JPEG:', err);
                  leftY += 4;
                }
              }
            } else {
              leftY += 4;
            }
          });

          // Right Column: Vector annotations
          let rightY = legendItemY;
          page1Vector.forEach((ann) => {
            if (rightY > legendLimitY) return;

            const iconX = detailsX + 15 + colWidth + 10;
            const iconY = rightY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyCanvasColors(ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              drawCircle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              drawCircle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              setLineWidth(1.5);
              drawLine(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              setLineWidth(borderWidth);
              drawRect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              drawCircle(iconX, iconY, 2.5, 'FD');
            }

            setDrawColor(0, 0, 0);
            setTextColor(0, 0, 0);
            setFontSize(6.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncateCanvasText(displayText, colWidth - 15);
            drawText(truncatedText, iconX + 8, iconY + 1.5);
            rightY += 10;
          });

        } else if (itemCount > 0) {
          // No WMS: Split vector annotations across both columns
          page1Vector.forEach((ann, idx) => {
            const itemsPerCol = Math.ceil(itemCount / 2);
            const colIdx = idx < itemsPerCol ? 0 : 1;
            const itemIdxInCol = idx < itemsPerCol ? idx : idx - itemsPerCol;

            const itemY = legendItemY + itemIdxInCol * 12;
            if (itemY > legendLimitY) return;

            const iconX = detailsX + 15 + colIdx * (colWidth + 10);
            const iconY = itemY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyCanvasColors(ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              drawCircle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              drawCircle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              setLineWidth(1.5);
              drawLine(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              setLineWidth(borderWidth);
              drawRect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              drawCircle(iconX, iconY, 2.5, 'FD');
            }

            setDrawColor(0, 0, 0);
            setTextColor(0, 0, 0);
            setFontSize(6.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncateCanvasText(displayText, colWidth - 15);
            drawText(truncatedText, iconX + 8, iconY + 1.5);
          });
        } else {
          setFontSize(8);
          setTextColor(128, 128, 128);
          drawText('No annotations on map', detailsX + 15, legendItemY);
        }

        if (overflowPages.length > 0) {
          setFont('helvetica', 'italic');
          setFontSize(5.5);
          setTextColor(128, 128, 128);
          drawText('* Continued on Page 2...', detailsX + sidebarWidth - 75, currentY + legendHeight - 6);
        }
        currentY += legendHeight;
      }

      // Scale section
      if (settings.includeScale) {
        const scaleHeight = 80;
        setLineWidth(borderWidth);
        setDrawColor(0, 0, 0);
        drawRect(detailsX, currentY, sidebarWidth, scaleHeight);
        setFontSize(9);

        // Get actual projection from map
        let projectionCode = 'EPSG:3857';
        if (previewMapInstance) {
          const view = previewMapInstance.getView();
          const projection = view.getProjection();
          if (projection) {
            projectionCode = projection.getCode();
          }
        }

        drawText(`Scale: ${liveScale}`, detailsX + 10, currentY + 15);
        drawText(`Projection: ${projectionCode}`, detailsX + 10, currentY + 30);
        drawText(`Date: ${currentDate}`, detailsX + 10, currentY + 45);
        currentY += scaleHeight;
      }

      // Footer section
      const remainingHeight = (pageHeightPt - margin - padding) - currentY;
      setLineWidth(borderWidth);
      setDrawColor(0, 0, 0);
      drawRect(detailsX, currentY, sidebarWidth, remainingHeight);

      const footerTextY = currentY + remainingHeight - 15;
      setFontSize(9);
      setFont('helvetica', 'normal');
      setTextColor(0, 0, 0);
      drawText('Powered by RottenGrapes Pvt Ltd', detailsX + sidebarWidth / 2, footerTextY, { align: 'center' });
    } else if (settings.template === 'template2' || settings.template === 'template4') {
      // Portrait layout - title at top, then either details or map
      const titleHeight = 40;

      // Draw title at the very top (only bottom border line, matching preview)
      setLineWidth(borderWidth);
      setDrawColor(0, 0, 0);
      drawLine(contentX, contentY + titleHeight, contentX + contentWidth, contentY + titleHeight);
      setFontSize(16);
      setFont('helvetica', 'bold');
      drawText(settings.title, pageWidthPt / 2, contentY + 25, { align: 'center' });

      const currentDetailsY = settings.template === 'template2' ? mapAreaY + mapAreaHeight + gap : detailsY;
      const detailsPanelHeight = 200;

      const nextY = currentDetailsY;

      // Dynamically calculate columns
      const activeColumns = [];
      if (settings.includeOfficeUse) activeColumns.push('office');
      if (settings.includeLegend) activeColumns.push('legend');
      if (settings.includeScale) activeColumns.push('scale');

      const numCols = activeColumns.length;
      const colWidth = numCols > 0 ? contentWidth / numCols : 0;

      let colIdx = 0;

      // Column 1: For Office use
      if (settings.includeOfficeUse) {
        const sectionX = contentX + colIdx * colWidth;
        setLineWidth(borderWidth);
        setDrawColor(0, 0, 0);
        drawRect(sectionX, nextY, colWidth, detailsPanelHeight);
        setFontSize(10);
        setFont('helvetica', 'bold');
        drawText('For Office use :', sectionX + 10, nextY + 20);
        setFont('helvetica', 'normal');
        setFontSize(9);
        drawText('Created By:', sectionX + 10, nextY + 40);
        setLineWidth(0.5);
        drawLine(sectionX + 10, nextY + 50, sectionX + colWidth - 10, nextY + 50);
        setLineWidth(borderWidth);
        drawText('Authorised By:', sectionX + 10, nextY + 70);
        setLineWidth(0.5);
        drawLine(sectionX + 10, nextY + 80, sectionX + colWidth - 10, nextY + 80);
        setLineWidth(borderWidth);
        colIdx++;
      }

      // Column 2: Legend
      if (settings.includeLegend) {
        const col2X = contentX + colIdx * colWidth;
        setLineWidth(borderWidth);
        setDrawColor(0, 0, 0);
        drawRect(col2X, nextY, colWidth, detailsPanelHeight);
        setFontSize(10);
        setFont('helvetica', 'bold');
        drawText('Legend :', col2X + 10, nextY + 20);
        setFont('helvetica', 'normal');

        const legendItemY = nextY + 32;
        const legendLimitY = nextY + detailsPanelHeight - 10;
        const hasWms = page1Wms.length > 0;
        const itemCount = page1Vector.length;
        const innerColWidth = (colWidth - 25) / 2;

        if (hasWms) {
          // Left Column: WMS legends
          let leftY = legendItemY;
          page1Wms.forEach((lg) => {
            if (leftY > legendLimitY) return;

            setFontSize(6.5);
            setFont('helvetica', 'bold');
            drawText(lg.name, col2X + 10, leftY);
            leftY += 7;

            const fullLg = geoserverLegends.find(l => l.id === lg.id);
            if (fullLg && fullLg.imgElement) {
              const maxWidth = innerColWidth - 5;
              const maxHeight = 120;
              let imgW = 24; // fallback
              let imgH = 24; // fallback

              if (fullLg.width && fullLg.height) {
                imgW = fullLg.width;
                imgH = fullLg.height;
                if (imgW > maxWidth) {
                  const aspect = fullLg.width / fullLg.height;
                  imgW = maxWidth;
                  imgH = imgW / aspect;
                }
                if (imgH > maxHeight) {
                  const aspect = fullLg.width / fullLg.height;
                  imgH = maxHeight;
                  imgW = imgH * aspect;
                }
              }

              if (leftY + imgH <= legendLimitY) {
                try {
                  outputContext.drawImage(fullLg.imgElement, (col2X + 10) * scale, leftY * scale, imgW * scale, imgH * scale);
                  leftY += imgH + 3;
                } catch (err) {
                  console.warn('Failed to embed WMS legend in JPEG:', err);
                  leftY += 4;
                }
              }
            } else {
              leftY += 4;
            }
          });

          // Right Column: Vector annotations
          let rightY = legendItemY;
          page1Vector.forEach((ann) => {
            if (rightY > legendLimitY) return;

            const iconX = col2X + 10 + innerColWidth + 8;
            const iconY = rightY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyCanvasColors(ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              drawCircle(iconX, iconY, 2.5, 'F');
            } else if (isCircle) {
              drawCircle(iconX, iconY, 2.5, 'FD');
            } else if (isLine) {
              setLineWidth(1);
              drawLine(iconX - 4, iconY, iconX + 4, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              setLineWidth(borderWidth);
              drawRect(iconX - 2.5, iconY - 2.5, 5, 5, 'FD');
            } else {
              drawCircle(iconX, iconY, 1.5, 'FD');
            }

            setDrawColor(0, 0, 0);
            setTextColor(0, 0, 0);
            setFontSize(5.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncateCanvasText(displayText, innerColWidth - 10);
            drawText(truncatedText, iconX + 8, iconY + 1.5);
            rightY += 8;
          });

        } else if (itemCount > 0) {
          // Split vector annotations across both columns
          page1Vector.forEach((ann, idx) => {
            const itemsPerCol = Math.ceil(itemCount / 2);
            const colIdx = idx < itemsPerCol ? 0 : 1;
            const itemIdxInCol = idx < itemsPerCol ? idx : idx - itemsPerCol;

            const itemY = legendItemY + itemIdxInCol * 10;
            if (itemY > legendLimitY) return;

            const iconX = col2X + 10 + colIdx * (innerColWidth + 8);
            const iconY = itemY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyCanvasColors(ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              drawCircle(iconX, iconY, 2.5, 'F');
            } else if (isCircle) {
              drawCircle(iconX, iconY, 2.5, 'FD');
            } else if (isLine) {
              setLineWidth(1);
              drawLine(iconX - 4, iconY, iconX + 4, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              setLineWidth(borderWidth);
              drawRect(iconX - 2.5, iconY - 2.5, 5, 5, 'FD');
            } else {
              drawCircle(iconX, iconY, 1.5, 'FD');
            }

            setDrawColor(0, 0, 0);
            setTextColor(0, 0, 0);
            setFontSize(5.5);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncateCanvasText(displayText, innerColWidth - 10);
            drawText(truncatedText, iconX + 8, iconY + 1.5);
          });
        } else {
          setFontSize(7);
          setTextColor(128, 128, 128);
          drawText('No annotations', col2X + 15, legendItemY);
        }

        if (overflowPages.length > 0) {
          setFont('helvetica', 'italic');
          setFontSize(5.5);
          setTextColor(128, 128, 128);
          drawText('* Continued on Page 2...', col2X + colWidth - 75, nextY + detailsPanelHeight - 6);
        }
        colIdx++;
      }

      // Column 3: Scale & Info
      if (settings.includeScale) {
        const col3X = contentX + colIdx * colWidth;
        setLineWidth(1.5);
        setDrawColor(0, 0, 0);
        drawRect(col3X, nextY, colWidth, detailsPanelHeight);
        setFontSize(9);

        let projectionCode = 'EPSG:3857';
        if (previewMapInstance) {
          const view = previewMapInstance.getView();
          const projection = view.getProjection();
          if (projection) {
            projectionCode = projection.getCode();
          }
        }

        drawText(`Scale: ${liveScale}`, col3X + 10, nextY + 20);
        drawText(`Projection: ${projectionCode}`, col3X + 10, nextY + 35);
        drawText(`Date: ${currentDate}`, col3X + 10, nextY + 50);
      }

      // Footer
      setFontSize(9);
      setFont('helvetica', 'normal');
      setTextColor(0, 0, 0);
      const footerY = nextY + detailsPanelHeight - 15;
      drawText('Powered by RottenGrapes Pvt Ltd', pageWidthPt / 2, footerY, { align: 'center' });
    } else if (settings.template === 'custom') {
      const getCanvasCoords = (rect: { left: number; top: number; width: number; height: number }) => {
        return {
          x: (rect.left / 100) * pageWidthPt,
          y: (rect.top / 100) * pageHeightPt,
          w: (rect.width / 100) * pageWidthPt,
          h: (rect.height / 100) * pageHeightPt
        };
      };

      const applyElementStyles = (coords: { x: number; y: number; w: number; h: number }, id: string) => {
        const styles = customStyles[id];
        if (!styles) return;

        // Draw background
        if (styles.backgroundColor && styles.backgroundColor !== 'transparent') {
          const opacity = (styles.backgroundOpacity ?? 100) / 100;
          if (opacity > 0) {
            outputContext.save();
            outputContext.globalAlpha = opacity;
            outputContext.fillStyle = styles.backgroundColor;
            if (styles.borderRadius > 0) {
              outputContext.beginPath();
              const r = styles.borderRadius * scale;
              const x = coords.x * scale;
              const y = coords.y * scale;
              const w = coords.w * scale;
              const h = coords.h * scale;
              if (typeof outputContext.roundRect === 'function') {
                outputContext.roundRect(x, y, w, h, r);
              } else {
                outputContext.rect(x, y, w, h);
              }
              outputContext.fill();
            } else {
              outputContext.fillRect(coords.x * scale, coords.y * scale, coords.w * scale, coords.h * scale);
            }
            outputContext.restore();
          }
        }

        // Draw border
        if (styles.borderWidth > 0 && styles.borderColor) {
          setDrawColor(styles.borderColor);
          setLineWidth(styles.borderWidth);
          if (styles.borderRadius > 0) {
            outputContext.beginPath();
            const r = styles.borderRadius * scale;
            const x = coords.x * scale;
            const y = coords.y * scale;
            const w = coords.w * scale;
            const h = coords.h * scale;
            if (typeof outputContext.roundRect === 'function') {
              outputContext.roundRect(x, y, w, h, r);
            } else {
              outputContext.rect(x, y, w, h);
            }
            outputContext.stroke();
          } else {
            drawRect(coords.x, coords.y, coords.w, coords.h);
          }
        }

        // Configure font & color for text
        setFontSize(styles.fontSize);
        setFont(styles.fontStyle === 'italic' ? 'italic' : 'normal', styles.fontWeight === 'bold' ? 'bold' : 'normal');
        setTextColor(styles.textColor);
      };

      // 1. Draw Map (Fill container completely, exactly matching preview)
      const mapCoords = getCanvasCoords(customPositions.map);
      applyElementStyles(mapCoords, 'map');

      outputContext.drawImage(canvas, mapCoords.x * scale, mapCoords.y * scale, mapCoords.w * scale, mapCoords.h * scale);

      const mapStyles = customStyles.map;
      if (mapStyles.borderWidth > 0 && mapStyles.borderColor) {
        setDrawColor(mapStyles.borderColor);
        setLineWidth(mapStyles.borderWidth);
        drawRect(mapCoords.x, mapCoords.y, mapCoords.w, mapCoords.h);
      }

      // 2. Draw Title
      const titleCoords = getCanvasCoords(customPositions.title);
      applyElementStyles(titleCoords, 'title');
      drawText(settings.title, titleCoords.x + titleCoords.w / 2, titleCoords.y + titleCoords.h / 2, { align: 'center', baseline: 'middle' });

      // 3. Draw Office Use
      if (settings.includeOfficeUse) {
        const officeCoords = getCanvasCoords(customPositions.office);
        applyElementStyles(officeCoords, 'office');
        const _oStyles = customStyles.office;
        const lineSpacing = officeCoords.h / 4;
        drawText('For Office use :', officeCoords.x + 8, officeCoords.y + lineSpacing, { baseline: 'middle' });
        drawText('Created By: _______', officeCoords.x + 8, officeCoords.y + 2 * lineSpacing, { baseline: 'middle' });
        drawText('Authorised By: _______', officeCoords.x + 8, officeCoords.y + 3 * lineSpacing, { baseline: 'middle' });
      }

      // 4. Draw Legend
      if (settings.includeLegend) {
        const legendCoords = getCanvasCoords(customPositions.legend);
        applyElementStyles(legendCoords, 'legend');
        const lStyles = customStyles.legend;
        const isBold = lStyles.fontWeight === 'bold';
        const isItalic = lStyles.fontStyle === 'italic';

        const styleArg = isItalic ? 'italic' : 'normal';
        const weightArg = isBold ? 'bold' : 'normal';
        const headerStyle = isItalic ? 'italic' : 'normal';
        const headerWeight = isBold ? 'bold' : 'normal';

        setFont(headerStyle, headerWeight);
        setFontSize(lStyles.fontSize);
        setTextColor(lStyles.textColor);
        drawText('Legend :', legendCoords.x + 8, legendCoords.y + lStyles.fontSize * 1.5, { baseline: 'middle' });

        setFont(styleArg, weightArg);

        const legendItemY = legendCoords.y + lStyles.fontSize * 3.0;
        const legendLimitY = legendCoords.y + legendCoords.h - lStyles.fontSize;
        const hasWms = page1Wms.length > 0;
        const itemCount = page1Vector.length;
        const colWidth = (legendCoords.w - 30) / 2;

        if (hasWms) {
          // Left Column: WMS legends
          let leftY = legendItemY;
          page1Wms.forEach((lg) => {
            if (leftY > legendLimitY) return;

            setFont(styleArg, weightArg);
            setFontSize(lStyles.fontSize * 0.85);
            setTextColor(lStyles.textColor);
            drawText(lg.name, legendCoords.x + 10, leftY, { baseline: 'middle' });
            leftY += lStyles.fontSize * 1.1;

            const fullLg = geoserverLegends.find(l => l.id === lg.id);
            if (fullLg && fullLg.imgElement) {
              const maxWidth = colWidth - 10;
              const maxHeight = 120;
              let imgW = 24;
              let imgH = 24;

              if (fullLg.width && fullLg.height) {
                imgW = fullLg.width;
                imgH = fullLg.height;
                if (imgW > maxWidth) {
                  const aspect = fullLg.width / fullLg.height;
                  imgW = maxWidth;
                  imgH = imgW / aspect;
                }
                if (imgH > maxHeight) {
                  const aspect = fullLg.width / fullLg.height;
                  imgH = maxHeight;
                  imgW = imgH * aspect;
                }
              }

              if (leftY + imgH <= legendLimitY) {
                try {
                  outputContext.drawImage(fullLg.imgElement, (legendCoords.x + 10) * scale, leftY * scale, imgW * scale, imgH * scale);
                  leftY += imgH + 4;
                } catch (err) {
                  console.warn('Failed to embed custom template WMS legend in JPEG:', err);
                  leftY += 4;
                }
              }
            } else {
              leftY += 4;
            }
          });

          // Right Column: Vector annotations
          let rightY = legendItemY;
          page1Vector.forEach((ann) => {
            if (rightY > legendLimitY) return;

            const iconX = legendCoords.x + 15 + colWidth + 10;
            const iconY = rightY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyCanvasColors(ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              drawCircle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              drawCircle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              setLineWidth(1.5 / scale);
              drawLine(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              setLineWidth((lStyles.borderWidth || 1.0) / scale);
              drawRect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              drawCircle(iconX, iconY, 2.5, 'FD');
            }

            setFont(styleArg, weightArg);
            setFontSize(lStyles.fontSize * 0.85);
            setTextColor(lStyles.textColor);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncateCanvasText(displayText, colWidth - 15);
            drawText(truncatedText, iconX + 8, iconY, { baseline: 'middle' });
            rightY += lStyles.fontSize * 1.5;
          });
        } else if (itemCount > 0) {
          // No WMS: Split vector annotations across both columns
          page1Vector.forEach((ann, idx) => {
            const itemsPerCol = Math.ceil(itemCount / 2);
            const colIdx = idx < itemsPerCol ? 0 : 1;
            const itemIdxInCol = idx < itemsPerCol ? idx : idx - itemsPerCol;

            const itemY = legendItemY + itemIdxInCol * (lStyles.fontSize * 1.5);
            if (itemY > legendLimitY) return;

            const iconX = legendCoords.x + 10 + colIdx * (colWidth + 10);
            const iconY = itemY;

            const geomType = ann.geometry.toLowerCase();
            const labelText = (ann.label || ann.type || '').toLowerCase();
            const isCircle = geomType.includes('circle') || labelText.includes('circle');
            const isPoint = geomType.includes('point') || labelText.includes('point');
            const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

            applyCanvasColors(ann.strokeColor || '#1890ff', ann.fillColor || 'rgba(24, 144, 255, 0.15)');

            if (isPoint) {
              drawCircle(iconX, iconY, 3, 'F');
            } else if (isCircle) {
              drawCircle(iconX, iconY, 3, 'FD');
            } else if (isLine) {
              setLineWidth(1.5 / scale);
              drawLine(iconX - 5, iconY, iconX + 5, iconY);
            } else if (geomType.includes('polygon') || geomType.includes('raster')) {
              setLineWidth((lStyles.borderWidth || 1.0) / scale);
              drawRect(iconX - 3, iconY - 3, 6, 6, 'FD');
            } else {
              drawCircle(iconX, iconY, 2.5, 'FD');
            }

            setFont(styleArg, weightArg);
            setFontSize(lStyles.fontSize * 0.85);
            setTextColor(lStyles.textColor);
            const displayText = ann.label || ann.type.replace(/_/g, ' ');
            const truncatedText = truncateCanvasText(displayText, colWidth - 15);
            drawText(truncatedText, iconX + 8, iconY, { baseline: 'middle' });
          });
        } else {
          setFont(styleArg, weightArg);
          setFontSize(lStyles.fontSize * 0.85);
          setTextColor(lStyles.textColor);
          drawText('No annotations', legendCoords.x + 10, legendItemY, { baseline: 'middle' });
        }
      }

      // 5. Draw Scale
      if (settings.includeScale) {
        const scaleCoords = getCanvasCoords(customPositions.scale);
        applyElementStyles(scaleCoords, 'scale');
        let projectionCode = 'EPSG:3857';
        if (previewMapInstance) {
          const view = previewMapInstance.getView();
          const projection = view.getProjection();
          if (projection) {
            projectionCode = projection.getCode();
          }
        }

        const sStyles = customStyles.scale;
        const lineSpacing = sStyles.fontSize * 1.4;
        const totalTextHeight = 3 * lineSpacing;
        const startY = scaleCoords.y + (scaleCoords.h - totalTextHeight) / 2 + sStyles.fontSize;

        drawText(`Scale: ${liveScale}`, scaleCoords.x + 8, startY, { baseline: 'middle' });
        drawText(`Projection: ${projectionCode}`, scaleCoords.x + 8, startY + lineSpacing, { baseline: 'middle' });
        drawText(`Date: ${currentDate}`, scaleCoords.x + 8, startY + 2 * lineSpacing, { baseline: 'middle' });
      }

      // 7. Draw North Arrow
      if (settings.includeNorthArrow) {
        const northCoords = getCanvasCoords(customPositions.northArrow);
        applyElementStyles(northCoords, 'northArrow');

        const arrowStyles = customStyles.northArrow;
        const fontSizePt = Math.max(8, arrowStyles.fontSize || 8);
        const arrowIconSize = Math.min(22, fontSizePt * 1.8);
        const textHeight = fontSizePt * 1.2;
        const gap = 2;
        const totalHeight = textHeight + gap + arrowIconSize;

        const centerX = northCoords.x + northCoords.w / 2;
        const centerY = northCoords.y + northCoords.h / 2;
        const startY = centerY - totalHeight / 2;

        setFont('helvetica', 'bold');
        setFontSize(fontSizePt * 1.2);

        // Draw 'N' text centered
        drawText('N', centerX, startY + textHeight * 0.5, { align: 'center', baseline: 'middle' });

        // Draw chevron arrow matching live preview SVG
        const arrowTopY = startY + textHeight + gap;
        const arrowH = arrowIconSize;
        const halfW = arrowH * 0.25;
        const notchY = arrowTopY + arrowH * 0.75;

        outputContext.fillStyle = arrowStyles.textColor || '#1f2937';
        outputContext.strokeStyle = arrowStyles.textColor || '#1f2937';
        outputContext.lineWidth = 1 * scale;
        outputContext.beginPath();
        outputContext.moveTo(centerX * scale, arrowTopY * scale);
        outputContext.lineTo((centerX + halfW) * scale, (arrowTopY + arrowH) * scale);
        outputContext.lineTo(centerX * scale, notchY * scale);
        outputContext.lineTo((centerX - halfW) * scale, (arrowTopY + arrowH) * scale);
        outputContext.closePath();
        outputContext.fill();
        outputContext.stroke();
      }

      // 6. Draw Footer
      const footerCoords = getCanvasCoords(customPositions.footer);
      applyElementStyles(footerCoords, 'footer');
      drawText('Powered by RottenGrapes Pvt Ltd', footerCoords.x + footerCoords.w / 2, footerCoords.y + footerCoords.h / 2, { align: 'center', baseline: 'middle' });
    }

    // Download first page (Page 1)
    const downloadName1 = settings.filename
      ? (settings.filename.endsWith('.jpg') ? settings.filename.slice(0, -4) : settings.filename)
      : `${settings.title.replace(/[^a-zA-Z0-9]/g, '_')}_${currentDate.replace(/\//g, '-')}`;

    const link1 = document.createElement('a');
    link1.download = overflowPages.length > 0 ? `${downloadName1}_Page_1.jpg` : `${downloadName1}.jpg`;
    link1.href = outputCanvas.toDataURL('image/jpeg', 1.0);
    link1.click();

    // Now process and download each overflow page as a separate JPEG image
    if (overflowPages.length > 0) {
      for (let pageIdx = 0; pageIdx < overflowPages.length; pageIdx++) {
        const page = overflowPages[pageIdx];
        const overflowCanvas = document.createElement('canvas');
        const overflowContext = overflowCanvas.getContext('2d', { alpha: false });
        if (!overflowContext) continue;

        overflowCanvas.width = outputWidth;
        overflowCanvas.height = outputHeight;

        // Background fill
        overflowContext.fillStyle = '#ffffff';
        overflowContext.fillRect(0, 0, outputWidth, outputHeight);

        // Helper functions bound to overflowContext/overflowCanvas:
        const setOverflowDrawColor = (colorStr: string) => {
          overflowContext.strokeStyle = colorStr;
        };
        const setOverflowTextColor = (colorStr: string) => {
          overflowContext.fillStyle = colorStr;
        };
        const setOverflowLineWidth = (width: number) => {
          overflowContext.lineWidth = width * scale;
        };
        const setOverflowFont = (fontStr: string) => {
          overflowContext.font = fontStr;
        };
        const drawOverflowText = (text: string, x: number, y: number, options?: { align?: 'left' | 'center' | 'right'; baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic' }) => {
          overflowContext.save();
          overflowContext.textAlign = options?.align || 'left';
          overflowContext.textBaseline = options?.baseline || 'alphabetic';
          overflowContext.fillText(text, x * scale, y * scale);
          overflowContext.restore();
        };
        const drawOverflowRect = (x: number, y: number, w: number, h: number, style: 'F' | 'D' | 'FD' = 'D') => {
          overflowContext.save();
          if (style.includes('F')) {
            overflowContext.fillRect(x * scale, y * scale, w * scale, h * scale);
          }
          if (style.includes('D')) {
            overflowContext.strokeRect(x * scale, y * scale, w * scale, h * scale);
          }
          overflowContext.restore();
        };
        const drawOverflowCircle = (x: number, y: number, r: number, style: 'F' | 'D' | 'FD' = 'D') => {
          overflowContext.save();
          overflowContext.beginPath();
          overflowContext.arc(x * scale, y * scale, r * scale, 0, 2 * Math.PI);
          if (style.includes('F')) {
            overflowContext.fill();
          }
          if (style.includes('D')) {
            overflowContext.stroke();
          }
          overflowContext.restore();
        };
        const drawOverflowLine = (x1: number, y1: number, x2: number, y2: number) => {
          overflowContext.save();
          overflowContext.beginPath();
          overflowContext.moveTo(x1 * scale, y1 * scale);
          overflowContext.lineTo(x2 * scale, y2 * scale);
          overflowContext.stroke();
          overflowContext.restore();
        };

        // 1. Draw Page Border and Margins
        setOverflowDrawColor('#000000');
        setOverflowLineWidth(1);
        drawOverflowRect(margin, margin, pageWidthPt - 2 * margin, pageHeightPt - 2 * margin);

        // 2. Draw Page Header
        setOverflowFont(`bold ${Math.round(10 * scale)}px helvetica, sans-serif`);
        setOverflowTextColor('#000000');
        drawOverflowText(`${settings.title} - Legend (Page ${pageIdx + 2})`, margin + 15, margin + 20, { baseline: 'middle' });
        drawOverflowLine(margin, margin + 28, pageWidthPt - margin, margin + 28);

        // 3. Draw Page Footer
        setOverflowFont(`${Math.round(7 * scale)}px helvetica, sans-serif`);
        drawOverflowText('Powered by RottenGrapes Pvt Ltd', pageWidthPt / 2, pageHeightPt - margin - 8, { align: 'center', baseline: 'middle' });
        drawOverflowLine(margin, pageHeightPt - margin - 15, pageWidthPt - margin, pageHeightPt - margin - 15);

        // 4. Draw Columns (2 columns in Portrait, 3 columns in Landscape)
        const numCols = page.cols && page.cols.length > 0 ? page.cols.length : (isPortrait ? 2 : 3);
        const colGap = 15;
        const totalGaps = (numCols - 1) * colGap;
        const colWidthOverflow = (pageWidthPt - 2 * margin - 30 - totalGaps) / numCols;
        const startY = margin + 40;
        const fontSizeOverflow = 8;

        const drawOverflowColumn = (colItems: LegendItem[], colIndex: number) => {
          const colX = margin + 15 + colIndex * (colWidthOverflow + colGap);
          let itemY = startY;

          colItems.forEach((item) => {
            if (item.type === 'wms') {
              // Draw Title
              setOverflowFont(`bold ${Math.round(fontSizeOverflow * 0.9 * scale)}px helvetica, sans-serif`);
              setOverflowTextColor('#000000');
              drawOverflowText(item.name, colX, itemY + 6, { baseline: 'middle' });
              itemY += fontSizeOverflow * 0.9 + 8;

              // Draw WMS Image
              const fullLg = geoserverLegends.find(l => l.id === item.id);
              if (fullLg && fullLg.imgElement) {
                let imgH = 24; // fallback
                let imgW = 24; // fallback
                const dims = dimsRecord[item.id];
                if (dims && dims.width && dims.height) {
                  imgW = dims.width;
                  imgH = dims.height;
                  if (imgW > colWidthOverflow - 10) {
                    const aspect = dims.width / dims.height;
                    imgW = colWidthOverflow - 10;
                    imgH = imgW / aspect;
                  }
                  const maxImgH = isPortrait ? 280 : 200;
                  if (imgH > maxImgH) {
                    const aspect = dims.width / dims.height;
                    imgH = maxImgH;
                    imgW = imgH * aspect;
                  }
                }
                try {
                  overflowContext.drawImage(fullLg.imgElement, colX * scale, itemY * scale, imgW * scale, imgH * scale);

                  // Draw bottom border line
                  setOverflowDrawColor('#e5e7eb');
                  setOverflowLineWidth(0.5);
                  drawOverflowLine(colX, itemY + imgH + 4, colX + colWidthOverflow - 10, itemY + imgH + 4);

                  itemY += imgH + 12;
                } catch (e) {
                  console.warn('Failed to embed WMS legend on overflow page:', e);
                  itemY += 6;
                }
              } else {
                itemY += 6;
              }
            } else {
              // Draw Vector item
              const iconX = colX + fontSizeOverflow * 0.35;
              const iconY = itemY;
              const iconSize = fontSizeOverflow * 0.35;

              const geomType = item.geometry.toLowerCase();
              const labelText = (item.label || item.type || '').toLowerCase();
              const isCircle = geomType.includes('circle') || labelText.includes('circle');
              const isPoint = geomType.includes('point') || labelText.includes('point');
              const isLine = geomType.includes('line') || labelText.includes('line') || labelText.includes('measurement');

              // Setup fill and stroke colors
              const strokeColor = item.strokeColor || '#1890ff';
              const fillColor = item.fillColor || 'rgba(24, 144, 255, 0.15)';
              overflowContext.fillStyle = fillColor;
              overflowContext.strokeStyle = strokeColor;

              if (isPoint) {
                drawOverflowCircle(iconX, iconY, iconSize, 'F');
              } else if (isCircle) {
                drawOverflowCircle(iconX, iconY, iconSize, 'FD');
              } else if (isLine) {
                setOverflowLineWidth(fontSizeOverflow * 0.15);
                drawOverflowLine(iconX - iconSize, iconY, iconX + iconSize, iconY);
              } else if (geomType.includes('polygon') || geomType.includes('raster')) {
                setOverflowLineWidth(fontSizeOverflow * 0.1);
                drawOverflowRect(iconX - iconSize, iconY - iconSize, iconSize * 2, iconSize * 2, 'FD');
              } else {
                drawOverflowCircle(iconX, iconY, iconSize, 'FD');
              }

              setOverflowTextColor('#000000');
              setOverflowFont(`${Math.round(fontSizeOverflow * scale)}px helvetica, sans-serif`);
              const displayText = item.label || item.type.replace(/_/g, ' ');
              const truncatedText = truncateCanvasText(displayText, colWidthOverflow - iconSize * 3 - 5);
              drawOverflowText(truncatedText, colX + iconSize * 3, itemY, { baseline: 'middle' });
              itemY += fontSizeOverflow * 1.5 + 4;
            }
          });
        };

        if (page.cols && page.cols.length > 0) {
          page.cols.forEach((colItems, colIndex) => {
            drawOverflowColumn(colItems, colIndex);
          });
        } else {
          drawOverflowColumn(page.col1, 0);
          drawOverflowColumn(page.col2, 1);
          if (page.col3) drawOverflowColumn(page.col3, 2);
        }

        // Trigger download for overflow page
        const linkOverflow = document.createElement('a');
        linkOverflow.download = `${downloadName1}_Page_${pageIdx + 2}.jpg`;
        linkOverflow.href = overflowCanvas.toDataURL('image/jpeg', 1.0);
        linkOverflow.click();
      }
    }
  }, [settings, liveScale, customPositions, customStyles, addedLayers, previewMapInstance, loadedLegends, legendDimensions, getPage1LegendParams]);

  const handleExport = useCallback(async () => {
    if (!previewMapInstance) {
      notification.error({
        message: 'Export Failed',
        description: 'Map preview not available',
        placement: 'topRight'
      });
      return;
    }

    const titleVal = settings.title.trim();
    const filenameVal = settings.filename.trim();
    let hasError = false;

    if (!titleVal) {
      setTitleError('Map Title cannot be empty or contain only whitespaces');
      hasError = true;
    }
    if (!filenameVal) {
      setFilenameError('File Name cannot be empty or contain only whitespaces');
      hasError = true;
    }

    if (hasError) {
      return;
    }

    // Sanitize trailing spaces in settings
    setSettings(prev => ({
      ...prev,
      title: prev.title.slice(0, 32).trimEnd(),
      filename: prev.filename.slice(0, 32).trimEnd()
    }));

    setIsProcessing(true);

    try {
      const canvas = await captureMapCanvas();

      if (settings.format === 'pdf') {
        await generatePDF(canvas);
      } else {
        await generateJPEG(canvas);
      }

      notification.success({
        message: 'Export Successful',
        description: `Map exported as ${settings.format.toUpperCase()} successfully!`,
        placement: 'topRight'
      });

      setIsModalOpen(false);
    } catch (error) {
      console.error('Export error:', error);
      notification.error({
        message: 'Export Failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred during export',
        placement: 'topRight'
      });
    } finally {
      setIsProcessing(false);
    }
  }, [previewMapInstance, captureMapCanvas, generatePDF, generateJPEG, settings, notification]);

  // Render preview based on template
  const renderPreview = () => {
    const isLandscape = settings.layout === 'landscape';
    const aspectRatio = isLandscape ? 1.414 : 1 / 1.414;

    // Extract ALL vector layers from preview map for legend
    const previewAnnotations: Array<{ type: string, label: string, geometry: string, strokeColor: string, fillColor: string }> = [];
    const seenPreviewKeys = new Set<string>();

    let viewportExtent: number[] | null = null;
    if (previewMapInstance) {
      const size = previewMapInstance.getSize();
      if (size && size[0] > 0 && size[1] > 0) {
        viewportExtent = previewMapInstance.getView().calculateExtent(size);
      }
    }

    if (previewMapInstance) {
      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        // Skip base tile layers and unnamed/unidentified vector layers (e.g. highlights)
        if (!layerName && layerId !== 'annotations' && layerId !== 'measurements') return;

        // Bounding box check for dataset layers
        const bbox = layer.get('bbox');
        if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
          const coords = bbox.coordinates[0];
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          coords.forEach((c: number[]) => {
            const lon = c[0];
            const lat = c[1];
            if (lon < minX) minX = lon;
            if (lon > maxX) maxX = lon;
            if (lat < minY) minY = lat;
            if (lat > maxY) maxY = lat;
          });
          const layerExtent = [
            ...fromLonLat([minX, minY]),
            ...fromLonLat([maxX, maxY])
          ];
          if (!extentsIntersect(layerExtent, viewportExtent)) {
            return; // Layer is not visible in current viewport
          }
        }

        // If it is a dataset layer (has a name)
        if (layerName) {
          return;
        }

        // If it is measurements layer
        if (layerId === 'measurements') {
          const source = layer.getSource?.();
          if (source && typeof source.getFeatures === 'function') {
            try {
              const features = source.getFeatures();
              features.forEach((feature: any) => {
                if (feature.get('visible') === false) return;
                const geom = feature.getGeometry();
                if (!geom) return;

                if (viewportExtent && typeof geom.intersectsExtent === 'function') {
                  if (!geom.intersectsExtent(viewportExtent)) return;
                }

                const geomType = geom.getType();
                const displayVal = feature.get('displayVal') || '';
                const label = `${geomType === 'LineString' ? 'Line' : 'Area'} Measurement (${displayVal})`;
                const key = `measurement_${feature.getId() || label}`;

                if (!seenPreviewKeys.has(key)) {
                  seenPreviewKeys.add(key);
                  const colors = getLayerColors(layer, feature);
                  previewAnnotations.push({
                    type: label,
                    label: label,
                    geometry: geomType,
                    strokeColor: colors.strokeColor,
                    fillColor: colors.fillColor
                  });
                }
              });
            } catch (e) {
              console.log('Error extracting measurement features in preview:', e);
            }
          }
          return;
        }

        // If it is annotations layer
        if (layerId === 'annotations') {
          const source = layer.getSource?.();
          if (source && typeof source.getFeatures === 'function') {
            try {
              const features = source.getFeatures();
              features.forEach((feature: any) => {
                if (feature.get('visible') === false) return;
                const geom = feature.getGeometry();
                if (!geom) return;

                if (viewportExtent && typeof geom.intersectsExtent === 'function') {
                  if (!geom.intersectsExtent(viewportExtent)) return;
                }

                const geomType = geom.getType();
                const label = feature.get('label') || feature.get('name') || feature.get('type') || geomType;
                const key = `annotation_${feature.getId() || label}`;

                if (!seenPreviewKeys.has(key)) {
                  seenPreviewKeys.add(key);
                  const colors = getLayerColors(layer, feature);
                  previewAnnotations.push({
                    type: label,
                    label: label,
                    geometry: geomType,
                    strokeColor: colors.strokeColor,
                    fillColor: colors.fillColor
                  });
                }
              });
            } catch (e) {
              console.log('Error extracting annotation features in preview:', e);
            }
          }
          return;
        }
      });
    }

    let mapAreaClass = '';
    let detailsAreaClass = '';
    let pageClass = '';

    if (isLandscape) {
      pageClass = 'flex-row';
      if (settings.template === 'template1') {
        mapAreaClass = 'w-[70%] h-full';
        detailsAreaClass = 'w-[30%] h-full';
      } else {
        mapAreaClass = 'w-[70%] h-full';
        detailsAreaClass = 'w-[30%] h-full';
      }
    } else {
      pageClass = 'flex-col';
      if (settings.template === 'template2') {
        mapAreaClass = 'h-[60%] w-full';
        detailsAreaClass = 'h-[35%] w-full';
      } else {
        mapAreaClass = 'h-[60%] w-full';
        detailsAreaClass = 'h-[35%] w-full';
      }
    }

    const detailsPosition = settings.template === 'template1' ? 'order-2' :
      settings.template === 'template2' ? 'order-2' :
        settings.template === 'template3' ? 'order-1' : 'order-1';
    const mapPosition = settings.template === 'template1' ? 'order-1' :
      settings.template === 'template2' ? 'order-1' :
        settings.template === 'template3' ? 'order-2' : 'order-2';

    // Helper to render annotation icon with dynamic colors
    const renderAnnotationIcon = (geomType: string, label: string = '', strokeColor: string = '#1890ff', fillColor: string = 'rgba(24, 144, 255, 0.15)') => {
      const type = geomType.toLowerCase();
      const lbl = label.toLowerCase();
      const isCircle = type.includes('circle') || lbl.includes('circle');
      const isPoint = type.includes('point') || lbl.includes('point');
      const isLine = type.includes('line') || lbl.includes('line') || lbl.includes('measurement');

      if (isPoint) {
        return <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: strokeColor }}></div>;
      } else if (isCircle) {
        return <div className="w-3 h-3 border rounded-full shrink-0" style={{ borderColor: strokeColor, backgroundColor: fillColor }}></div>;
      } else if (isLine) {
        return <div className="w-4 h-0.5 shrink-0" style={{ backgroundColor: strokeColor }}></div>;
      } else if (type.includes('polygon') || type.includes('raster')) {
        return <div className="w-3 h-3 border shrink-0" style={{ borderColor: strokeColor, backgroundColor: fillColor }}></div>;
      }
      return <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: strokeColor }}></div>;
    };

    // Build GeoServer legend entries for visible layers that are actually inside the viewport
    const geoserverLegendEntries: Array<{ id: string; name: string; legendUrl: string }> = [];

    if (previewMapInstance) {
      previewMapInstance.getLayers().forEach((layer: any) => {
        if (!layer.getVisible()) return;

        const layerName = layer.get('name') || '';
        const layerId = layer.get('id') || '';

        // If it is a dataset layer (has a name)
        if (layerName) {
          // Bounding box check to verify if visible in map view
          const bbox = layer.get('bbox');
          if (bbox && bbox.coordinates && bbox.coordinates[0] && viewportExtent) {
            const coords = bbox.coordinates[0];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            coords.forEach((c: number[]) => {
              const lon = c[0];
              const lat = c[1];
              if (lon < minX) minX = lon;
              if (lon > maxX) maxX = lon;
              if (lat < minY) minY = lat;
              if (lat > maxY) maxY = lat;
            });
            const layerExtent = [
              ...fromLonLat([minX, minY]),
              ...fromLonLat([maxX, maxY])
            ];
            if (!extentsIntersect(layerExtent, viewportExtent)) {
              return; // Layer is not visible in current viewport
            }
          }

          // It's visible in viewport! Add to legends
          const matchingLayer = addedLayers.find(l => l.name === layerName || l.id === layerId);
          const activeStyle = matchingLayer?.activeStyle || '';
          const activeStyleObj = matchingLayer?.styles?.find(s => s.name === activeStyle);

          const legendUrl = activeStyleObj?.legendUrl
            ? activeStyleObj.legendUrl
            : buildLegendUrl(layerName, activeStyle);

          geoserverLegendEntries.push({
            id: layerId || layerName,
            name: layerName,
            legendUrl
          });
        }
      });
    }

    const pageParams = getPage1LegendParams();
    const { page1Wms, page1Vector, overflowPages } = calculateLegendSplit(
      geoserverLegendEntries,
      previewAnnotations,
      pageParams.availableHeight,
      pageParams.colWidth,
      pageParams.fontSize,
      legendDimensions,
      pageParams.pageWidthPt,
      pageParams.pageHeightPt
    );

    // Helper to render legends in balanced 2-column layout to fit without scrollbars
    const renderLegendPreviewColumns = (
      wmsEntries: typeof geoserverLegendEntries,
      vectorEntries: typeof previewAnnotations,
      maxHeightClass: string,
      textSize: string,
      _imageHeightClass: string
    ) => {
      const totalItems = wmsEntries.length + vectorEntries.length;
      if (totalItems === 0) {
        return <div className="text-gray-400 italic text-center py-2 text-[0.8em]">No annotations</div>;
      }

      const hasWms = wmsEntries.length > 0;
      let leftColItems: React.ReactNode[] = [];
      let rightColItems: React.ReactNode[] = [];

      const renderWmsItem = (item: typeof wmsEntries[0], index: number) => (
        <div key={`wms_${item.id}_${index}`} className="flex flex-col gap-0.5 mb-1.5 border-b border-gray-100 pb-1 w-full min-w-0">
          <div className="leading-tight truncate" style={{ fontWeight: customStyles.legend?.fontWeight || 'bold', fontStyle: customStyles.legend?.fontStyle || 'normal', color: customStyles.legend?.textColor || undefined }}>{item.name}</div>
          {loadedLegends[item.id] && (
            <img
              src={loadedLegends[item.id]}
              alt={item.name}
              className="max-h-[80px] w-auto max-w-full object-contain self-start block"
            />
          )}
        </div>
      );

      const renderVectorItem = (item: typeof vectorEntries[0], index: number) => (
        <div key={`vec_${item.label}_${index}`} className="flex items-center gap-1.5 w-full min-w-0 truncate mb-1">
          {renderAnnotationIcon(item.geometry, item.label || item.type, item.strokeColor, item.fillColor)}
          <span className="truncate leading-none" style={{ fontWeight: customStyles.legend?.fontWeight || 'normal', fontStyle: customStyles.legend?.fontStyle || 'normal', color: customStyles.legend?.textColor || undefined }}>{item.label || item.type.replace(/_/g, ' ')}</span>
        </div>
      );

      if (hasWms) {
        // Left Column contains GeoServer legends
        leftColItems = wmsEntries.map((item, idx) => renderWmsItem(item, idx));
        // Right Column contains vector annotations
        rightColItems = vectorEntries.map((item, idx) => renderVectorItem(item, idx));
      } else {
        // No GeoServer legends: Split vector annotations 50/50 across both columns
        vectorEntries.forEach((item, idx) => {
          if (idx % 2 === 0) {
            leftColItems.push(renderVectorItem(item, idx));
          } else {
            rightColItems.push(renderVectorItem(item, idx));
          }
        });
      }

      return (
        <div className="flex flex-col h-full w-full overflow-hidden">
          <div className={`flex gap-3 w-full flex-1 overflow-hidden ${maxHeightClass} ${textSize}`}>
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {leftColItems}
            </div>
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {rightColItems}
            </div>
          </div>
          {overflowPages.length > 0 && (
            <div className="text-[0.75em] text-gray-400 italic shrink-0 text-right mt-0.5">
              * Continued on Page 2...
            </div>
          )}
        </div>
      );
    };

    const renderOverflowPageItem = (item: LegendItem, index: number) => {
      if (item.type === 'wms') {
        return (
          <div key={`wms_ov_${item.id}_${index}`} className="flex flex-col gap-1 mb-3 border-b border-gray-100 pb-2 w-full min-w-0 shrink-0">
            <div className="font-semibold text-gray-700 leading-tight text-[10px] sm:text-[11px] truncate">{item.name}</div>
            {loadedLegends[item.id] && (
              <img
                src={loadedLegends[item.id]}
                alt={item.name}
                className="max-h-[200px] w-auto max-w-full object-contain self-start block my-0.5"
              />
            )}
          </div>
        );
      } else {
        return (
          <div key={`vec_ov_${item.label}_${index}`} className="flex items-center gap-2 w-full min-w-0 truncate mb-2 text-[9px] sm:text-[10px] shrink-0">
            {renderAnnotationIcon(item.geometry, item.label || item.type, item.strokeColor, item.fillColor)}
            <span className="truncate leading-none text-gray-800">{item.label || item.type.replace(/_/g, ' ')}</span>
          </div>
        );
      }
    };

    const renderOverflowPage = (page: typeof overflowPages[0], pageIdx: number) => {
      return (
        <div
          key={`overflow_page_${pageIdx}`}
          className="bg-white border-2 border-gray-400 shadow-lg mx-auto relative flex flex-col p-4 sm:p-5 overflow-hidden mt-4 shrink-0"
          style={{
            aspectRatio: aspectRatio.toString(),
            width: isLandscape ? '100%' : 'auto',
            height: isLandscape ? 'auto' : '450px',
            maxWidth: '100%',
            maxHeight: isLandscape ? '540px' : '580px'
          }}
        >
          {/* Header */}
          <div className="border-b-2 border-gray-300 pb-1.5 mb-2 flex justify-between items-center gap-2 shrink-0">
            <div className="font-bold text-[11px] sm:text-[12px] text-gray-800 truncate min-w-0" title={`${settings.title} - Legend`}>
              {settings.title} - Legend
            </div>
            <div className="text-[10px] text-gray-400 whitespace-nowrap shrink-0">
              Page {pageIdx + 2}
            </div>
          </div>

          {/* Grid Layout of columns (2 columns in portrait, 3 columns in landscape) */}
          <div className="flex-1 flex gap-4 overflow-hidden min-h-0 text-[9px] mb-1">
            {(page.cols || [page.col1, page.col2, page.col3].filter(Boolean)).map((col, colIdx) => (
              <div key={`col_${colIdx}`} className="flex-1 flex flex-col overflow-hidden min-w-0 justify-start">
                {col.map((item, idx) => renderOverflowPageItem(item, idx))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-300 pt-1 text-center text-[8px] text-gray-500 shrink-0">
            Powered by RottenGrapes Pvt Ltd
          </div>
        </div>
      );
    };

    if (settings.template === 'custom') {
      return (
        <>
          <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div
              ref={pageContainerRef}
              className="bg-white border-2 border-gray-400 shadow-lg mx-auto relative overflow-hidden shrink-0"
              style={{
                aspectRatio: aspectRatio.toString(),
                width: isLandscape ? '100%' : 'auto',
                height: isLandscape ? 'auto' : '450px',
                maxWidth: '100%',
                maxHeight: isLandscape ? '400px' : '450px'
              }}
              onClick={(e) => {
                if (e.target === pageContainerRef.current) {
                  setSelectedElementId(null);
                }
              }}
            >
              <DraggableElement
                id="map"
                label="Map View"
                isSelected={selectedElementId === 'map'}
                pos={customPositions.map}
                onSelect={handleSelectElement}
                onResizeStart={startResize}
                customStyle={customStyles.map}
                zIndex={selectedElementId === 'map' ? 2 : 1}
              >
                <div className="w-full h-full pointer-events-auto overflow-hidden rounded relative">
                  <div ref={previewMapRef} className="w-full h-full" />
                </div>
              </DraggableElement>

              <DraggableElement
                id="title"
                label="Map Title"
                isSelected={selectedElementId === 'title'}
                pos={customPositions.title}
                onSelect={handleSelectElement}
                onResizeStart={startResize}
                customStyle={customStyles.title}
                zIndex={(selectedElementId === 'title' ? 30 : 10) + zOrder.indexOf('title')}
              >
                <div className="w-full h-full p-2 flex items-center justify-center text-center truncate">
                  {settings.title}
                </div>
              </DraggableElement>

              {settings.includeOfficeUse && (
                <DraggableElement
                  id="office"
                  label="For Office Use"
                  isSelected={selectedElementId === 'office'}
                  pos={customPositions.office}
                  onSelect={handleSelectElement}
                  onResizeStart={startResize}
                  customStyle={customStyles.office}
                  zIndex={(selectedElementId === 'office' ? 30 : 10) + zOrder.indexOf('office')}
                >
                  <div className="w-full h-full p-2 flex flex-col justify-center overflow-hidden">
                    <div className="font-semibold mb-0.5">For Office use:</div>
                    <div className="text-[0.9em] opacity-90 space-y-0.5">
                      <div>Created By: _______</div>
                      <div>Authorised By: _______</div>
                    </div>
                  </div>
                </DraggableElement>
              )}            {settings.includeLegend && (
                <DraggableElement
                  id="legend"
                  label="Legend"
                  isSelected={selectedElementId === 'legend'}
                  pos={customPositions.legend}
                  onSelect={handleSelectElement}
                  onResizeStart={startResize}
                  customStyle={customStyles.legend}
                  zIndex={(selectedElementId === 'legend' ? 30 : 10) + zOrder.indexOf('legend')}
                >
                  <div
                    className="w-full h-full p-2 flex flex-col overflow-hidden"
                    style={{
                      fontStyle: customStyles.legend?.fontStyle || 'normal',
                      fontWeight: customStyles.legend?.fontWeight || 'normal',
                      color: customStyles.legend?.textColor || '#000000'
                    }}
                  >
                    <div className="mb-0.5" style={{ fontWeight: customStyles.legend?.fontWeight === 'normal' ? 'normal' : 'bold', fontStyle: 'inherit' }}>Legend:</div>
                    <div className="flex-1 overflow-hidden min-h-0 w-full mt-1">
                      {renderLegendPreviewColumns(
                        page1Wms,
                        page1Vector,
                        "max-h-[160px]",
                        "text-[0.8em]",
                        "max-h-20"
                      )}
                    </div>
                  </div>
                </DraggableElement>
              )}

              {settings.includeScale && (
                <DraggableElement
                  id="scale"
                  label="Scale & Metadata"
                  isSelected={selectedElementId === 'scale'}
                  pos={customPositions.scale}
                  onSelect={handleSelectElement}
                  onResizeStart={startResize}
                  customStyle={customStyles.scale}
                  zIndex={(selectedElementId === 'scale' ? 30 : 10) + zOrder.indexOf('scale')}
                >
                  <div className="w-full h-full p-2 flex flex-col justify-center space-y-0.5 overflow-hidden">
                    <div>Scale: {liveScale}</div>
                    <div>Projection: {previewMapInstance?.getView().getProjection().getCode() || 'EPSG:3857'}</div>
                    <div>Date: {new Date().toLocaleDateString()}</div>
                  </div>
                </DraggableElement>
              )}

              {settings.includeNorthArrow && (
                <DraggableElement
                  id="northArrow"
                  label="North Arrow"
                  isSelected={selectedElementId === 'northArrow'}
                  pos={customPositions.northArrow}
                  onSelect={handleSelectElement}
                  onResizeStart={startResize}
                  customStyle={customStyles.northArrow}
                  zIndex={(selectedElementId === 'northArrow' ? 30 : 10) + zOrder.indexOf('northArrow')}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center p-1 cursor-move pointer-events-none select-none overflow-hidden">
                    <span className="text-[1.2em] font-bold leading-none mb-0.5" style={{ color: customStyles.northArrow?.textColor || '#000000' }}>N</span>
                    <svg className="w-[1.8em] h-[1.8em]" style={{ fill: customStyles.northArrow?.textColor || '#000000', stroke: customStyles.northArrow?.textColor || '#000000' }} viewBox="0 0 24 24">
                      <polygon points="12,2 17,22 12,17 7,22" />
                    </svg>
                  </div>
                </DraggableElement>
              )}

              <DraggableElement
                id="footer"
                label="Footer"
                isSelected={selectedElementId === 'footer'}
                pos={customPositions.footer}
                onSelect={handleSelectElement}
                onResizeStart={startResize}
                customStyle={customStyles.footer}
                zIndex={(selectedElementId === 'footer' ? 30 : 10) + zOrder.indexOf('footer')}
                canResize={false}
              >
                <div className="w-full h-full p-1 text-center flex items-center justify-center overflow-hidden">
                  Powered by RottenGrapes Pvt Ltd
                </div>
              </DraggableElement>
            </div>
          </DndContext>
          {settings.includeLegend && overflowPages.map((page, pageIdx) => renderOverflowPage(page, pageIdx))}
        </>
      );
    }

    return (
      <>
        <div
          className="bg-white border-2 border-gray-400 shadow-lg mx-auto shrink-0"
          style={{
            aspectRatio: aspectRatio.toString(),
            width: isLandscape ? '100%' : 'auto',
            height: isLandscape ? 'auto' : '450px',
            maxWidth: '100%',
            maxHeight: isLandscape ? '400px' : '450px'
          }}
        >
          <div className="w-full h-full p-2 flex flex-col">
            {/* Title at top for portrait only */}
            {!isLandscape && (
              <div className="border-b-2 border-gray-300 p-2 text-center mb-2">
                <div className="font-bold text-[11px] truncate">{settings.title}</div>
              </div>
            )}

            {/* Content */}
            <div className={`flex-1 flex ${pageClass} gap-2 overflow-hidden`}>
              {/* Map Area */}
              <div className={`${mapAreaClass} ${mapPosition} border-2 border-gray-300 bg-gray-50 overflow-hidden relative`}>
                <div ref={previewMapRef} className="w-full h-full" />
                {settings.includeNorthArrow && (
                  <div className="absolute top-2 right-2 bg-white/85 backdrop-blur-xs p-1.5 rounded border border-gray-300 shadow-xs z-10 pointer-events-none flex flex-col items-center justify-center w-9 h-9">
                    <span className="text-[8px] font-bold leading-none mb-0.5 text-gray-800">N</span>
                    <svg className="w-4.5 h-4.5 fill-gray-800 stroke-gray-800" viewBox="0 0 24 24">
                      <polygon points="12,2 17,22 12,17 7,22" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Details Area */}
              <div className={`${detailsAreaClass} ${detailsPosition} border border-gray-300 bg-gray-50 overflow-hidden`}>
                {isLandscape ? (
                  // Landscape layout - vertical sidebar
                  <div className="h-full flex flex-col text-[8px]">
                    {/* Title */}
                    <div className="border-b p-2 text-center">
                      <div className="font-bold text-[10px] truncate">{settings.title}</div>
                    </div>
                    {/* Subtitle */}
                    <div className="border-b p-1.5 text-[7px]">Map Export</div>
                    {/* Office use */}
                    {settings.includeOfficeUse && (
                      <div className="border-b p-2">
                        <div className="font-semibold mb-1">For Office use:</div>
                        <div className="text-[7px] space-y-1">
                          <div>Created By: _______</div>
                          <div>Authorised By: _______</div>
                        </div>
                      </div>
                    )}
                    {settings.includeLegend && (
                      <div className="border-b p-2 flex-1 min-h-0 flex flex-col overflow-hidden">
                        <div className="font-semibold mb-1 shrink-0">Legend:</div>
                        <div className="flex-1 overflow-hidden min-h-0 mt-0.5">
                          {renderLegendPreviewColumns(
                            page1Wms,
                            page1Vector,
                            "max-h-32",
                            "text-[7px]",
                            "max-h-20"
                          )}
                        </div>
                      </div>
                    )}
                    {/* Scale */}
                    {settings.includeScale && (
                      <div className="border-b p-2">
                        <div className="space-y-0.5 text-[7px]">
                          <div>Scale: {liveScale}</div>
                          <div>Projection: {previewMapInstance?.getView().getProjection().getCode() || 'EPSG:3857'}</div>
                          <div>Date: {new Date().toLocaleDateString()}</div>
                        </div>
                      </div>
                    )}
                    {/* Footer */}
                    <div className="p-2 text-center text-[7px]">
                      <span className="text-gray-700">Powered by RottenGrapes Pvt Ltd</span>
                    </div>
                  </div>
                ) : (
                  // Portrait layout - horizontal sections (no title here, it's at page top)
                  <div className="h-full flex flex-col text-[8px]">
                    {/* Three columns only */}
                    <div className="flex-1 flex gap-1 p-1.5">
                      {/* Column 1: Office use */}
                      {settings.includeOfficeUse && (
                        <div className={`flex-1 ${settings.includeLegend || settings.includeScale ? 'border-r pr-1.5' : ''}`}>
                          <div className="font-semibold text-[7px] mb-1">For Office use:</div>
                          <div className="text-[6px] space-y-1">
                            <div>Created By:</div>
                            <div className="border-b"></div>
                            <div>Authorised By:</div>
                            <div className="border-b"></div>
                          </div>
                        </div>
                      )}
                      {settings.includeLegend && (
                        <div className={`flex-1 ${settings.includeScale ? 'border-r pr-1.5' : ''} min-h-0 flex flex-col overflow-hidden`}>
                          <div className="font-semibold text-[7px] mb-1 shrink-0">Legend:</div>
                          <div className="flex-1 overflow-hidden min-h-0 mt-0.5">
                            {renderLegendPreviewColumns(
                              page1Wms,
                              page1Vector,
                              "max-h-20",
                              "text-[6px]",
                              "max-h-12"
                            )}
                          </div>
                        </div>
                      )}
                      {/* Column 3: Scale */}
                      {settings.includeScale && (
                        <div className="flex-1">
                          <div className="space-y-0.5 text-[6px] mb-1">
                            <div>Scale: {liveScale}</div>
                            <div>Projection: {previewMapInstance?.getView().getProjection().getCode() || 'EPSG:3857'}</div>
                            <div>Date: {new Date().toLocaleDateString()}</div>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Footer */}
                    <div className="border-t p-1 text-center text-[6px]">
                      <span className="text-gray-700">Powered by RottenGrapes Pvt Ltd</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {settings.includeLegend && overflowPages.map((page, pageIdx) => renderOverflowPage(page, pageIdx))}
      </>
    );
  };

  return (
    <>
      <Tooltip title="Print Map" placement="bottom">
        <Button
          type="text"
          icon={<Printer size={18} className="text-gray-500 hover:text-primary transition-colors" />}
          onClick={handlePrintClick}
          className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
          style={{ width: 40, height: 40 }}
        />
      </Tooltip>

      <Modal
        title={
          <div className="flex items-center gap-2">
            <MapIcon size={20} className="text-primary" />
            <span className="font-bold">Print Map</span>
          </div>
        }
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        width={1200}
        style={{ top: 20 }}
        className="print-modal"
        footer={[
          <Button key="cancel" onClick={() => setIsModalOpen(false)} disabled={isProcessing}>
            Cancel
          </Button>,
          <Button
            key="export"
            type="primary"
            icon={<Download size={16} />}
            onClick={handleExport}
            loading={isProcessing}
            className="font-semibold"
          >
            {isProcessing ? 'Generating...' : `Export as ${settings.format.toUpperCase()}`}
          </Button>
        ]}
        styles={{
          body: { padding: '20px', maxHeight: 'calc(100vh - 120px)', overflow: 'hidden' }
        }}
      >
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 h-auto md:h-[calc(100vh-220px)] min-h-0 md:min-h-[480px] max-h-none md:max-h-[720px]">
          {/* Left Side - Settings (Scrollable) */}
          <div className="w-full md:w-80 space-y-4 flex-shrink-0 overflow-y-visible md:overflow-y-auto pr-0 md:pr-2 h-auto md:h-full md:border-r border-gray-100 pb-0">
            {/* Guide/Instruction Text at the top */}
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-500 space-y-1">
              {settings.template === 'custom' ? (
                <>
                  <div className="text-primary font-semibold">• Custom Template Creator:</div>
                  <div>• Click on components (Map, Title, Scale, etc.) to select them.</div>
                  <div>• Drag by the top-left label tab to reposition elements.</div>
                  <div>• Drag by the bottom-right handle to resize.</div>
                  <div>• Clicking empty page background deselects elements.</div>
                </>
              ) : (
                <>
                  <div className="text-primary font-semibold">• Map Print Guide:</div>
                  <div>• Pan and zoom the map in the preview</div>
                  <div>• Scale and center update live as you move</div>
                  {!isMobile && <div>• Export captures the exact view shown</div>}
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Map Title
              </label>
              <Input
                value={settings.title}
                maxLength={32}
                status={titleError ? 'error' : undefined}
                onChange={(e) => {
                  const val = e.target.value.slice(0, 32);
                  setSettings(prev => ({ ...prev, title: val }));
                  if (val.trim()) setTitleError('');
                }}
                onBlur={(e) => {
                  const trimmed = e.target.value.trimEnd();
                  setSettings(prev => ({ ...prev, title: trimmed }));
                  if (!trimmed.trim()) {
                    setTitleError('Map Title cannot be empty or contain only whitespaces');
                  } else {
                    setTitleError('');
                  }
                }}
                placeholder="Enter map title"
              />
              {titleError && (
                <div className="text-[10px] text-red-500 mt-0.5">{titleError}</div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                File Name
              </label>
              <Input
                value={settings.filename}
                maxLength={32}
                status={filenameError ? 'error' : undefined}
                onChange={(e) => {
                  const val = e.target.value.slice(0, 32);
                  setSettings(prev => ({ ...prev, filename: val }));
                  if (val.trim()) setFilenameError('');
                }}
                onBlur={(e) => {
                  const trimmed = e.target.value.trimEnd();
                  setSettings(prev => ({ ...prev, filename: trimmed }));
                  if (!trimmed.trim()) {
                    setFilenameError('File Name cannot be empty or contain only whitespaces');
                  } else {
                    setFilenameError('');
                  }
                }}
                placeholder="Enter file name (without extension)"
              />
              {filenameError && (
                <div className="text-[10px] text-red-500 mt-0.5">{filenameError}</div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Layout
              </label>
              <Radio.Group
                value={settings.layout}
                onChange={(e) => setSettings(prev => ({ ...prev, layout: e.target.value }))}
              >
                <Radio value="portrait">Portrait</Radio>
                <Radio value="landscape">Landscape</Radio>
              </Radio.Group>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Template
              </label>
              <Select
                value={settings.template}
                onChange={(value) => setSettings(prev => ({ ...prev, template: value }))}
                className="w-full"
                options={
                  (settings.layout === 'landscape' ? landscapeTemplates : portraitTemplates)
                    .filter(opt => !isMobile || opt.value !== 'custom')
                }
              />
            </div>

            {/* Page Elements Checkbox section - inserted between Template and Page Size */}
            <div className="space-y-2.5 border-t border-b py-4 my-2">
              <div className="font-semibold text-xs text-gray-800 flex items-center gap-1.5">
                <span>🎛️ Page Elements</span>
              </div>

              <div>
                <Checkbox
                  checked={settings.includeGraticule}
                  onChange={(e) => setSettings(prev => ({ ...prev, includeGraticule: e.target.checked }))}
                >
                  Include coordinate grid (graticule)
                </Checkbox>
                {settings.includeGraticule && (
                  <div className="text-xs text-gray-500 ml-6 mt-0.5">
                    Grid lines with lat/lon labels will be shown
                  </div>
                )}
              </div>

              <div>
                <Checkbox
                  checked={settings.includeLegend}
                  onChange={(e) => setSettings(prev => ({ ...prev, includeLegend: e.target.checked }))}
                >
                  Include Legend
                </Checkbox>
              </div>

              <div>
                <Checkbox
                  checked={settings.includeNorthArrow}
                  onChange={(e) => setSettings(prev => ({ ...prev, includeNorthArrow: e.target.checked }))}
                >
                  Include North Arrow
                </Checkbox>
              </div>

              <div>
                <Checkbox
                  checked={settings.includeOfficeUse}
                  onChange={(e) => setSettings(prev => ({ ...prev, includeOfficeUse: e.target.checked }))}
                >
                  Include Office Use section
                </Checkbox>
              </div>

              <div>
                <Checkbox
                  checked={settings.includeScale}
                  onChange={(e) => setSettings(prev => ({ ...prev, includeScale: e.target.checked }))}
                >
                  Include Scale & Metadata
                </Checkbox>
                {settings.includeScale && (
                  <div className="ml-6 mt-1.5 space-y-1">
                    <label className="block text-[10px] text-gray-500 font-medium">Scale Ratio</label>
                    <Select
                      value={settings.scaleType === 'auto' ? 'auto' : settings.customScaleValue.toString()}
                      onChange={(value) => {
                        if (value === 'auto') {
                          setSettings(prev => ({ ...prev, scaleType: 'auto' }));
                        } else {
                          setSettings(prev => ({
                            ...prev,
                            scaleType: 'custom',
                            customScaleValue: parseInt(value)
                          }));
                        }
                      }}
                      className="w-full"
                      size="small"
                      options={scaleOptions}
                      style={{ fontSize: '10px' }}
                    />
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Page Size
              </label>
              <Select
                value={settings.pageSize}
                onChange={(value) => setSettings(prev => ({ ...prev, pageSize: value }))}
                className="w-full"
                options={Object.keys(pageSizes).map(size => ({
                  label: size,
                  value: size
                }))}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Resolution (DPI)
              </label>
              <Select
                value={settings.dpi}
                onChange={(value) => setSettings(prev => ({ ...prev, dpi: value }))}
                className="w-full"
                options={dpiOptions}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Export Format
              </label>
              <Radio.Group
                value={settings.format}
                onChange={(e) => setSettings(prev => ({ ...prev, format: e.target.value }))}
              >
                <Radio value="pdf">PDF Document</Radio>
                <Radio value="jpeg">JPEG Image</Radio>
              </Radio.Group>
            </div>

            {settings.template === 'custom' && (
              <div className="border-t pt-4 mt-4 space-y-4">
                <div className="font-semibold text-xs text-gray-800 flex items-center gap-1.5">
                  <span>🎨 Element Styling</span>
                  {selectedElementId && (
                    <span className="text-[10px] text-gray-500 font-normal">
                      ({selectedElementId.toUpperCase()})
                    </span>
                  )}
                </div>

                {selectedElementId ? (
                  <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-100 text-xs">
                    {selectedElementId === 'footer' ? (
                      <div className="space-y-2">
                        <div className="text-[10px] text-gray-500 font-semibold mb-1">Footer Styling Options (Fixed Size: 8pt)</div>
                        <div className="flex gap-4 pt-1">
                          <Checkbox
                            checked={customStyles[selectedElementId].fontWeight === 'bold'}
                            onChange={(e) => updateStyle(selectedElementId, 'fontWeight', e.target.checked ? 'bold' : 'normal')}
                            style={{ fontSize: '10px' }}
                          >
                            Bold
                          </Checkbox>
                          <Checkbox
                            checked={customStyles[selectedElementId].fontStyle === 'italic'}
                            onChange={(e) => updateStyle(selectedElementId, 'fontStyle', e.target.checked ? 'italic' : 'normal')}
                            style={{ fontSize: '10px' }}
                          >
                            Italic
                          </Checkbox>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Background Color & Text Color */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-600 mb-0.5">Background</label>
                            <div className="flex gap-1 items-center">
                              <input
                                type="color"
                                value={customStyles[selectedElementId].backgroundColor}
                                onChange={(e) => updateStyle(selectedElementId, 'backgroundColor', e.target.value)}
                                className="w-5 h-5 p-0 border-0 rounded cursor-pointer"
                              />
                              <span className="text-[9px] text-gray-500 uppercase">{customStyles[selectedElementId].backgroundColor}</span>
                            </div>
                          </div>
                          <div>
                            {selectedElementId !== 'footer' ? (
                              <>
                                <label className="block text-[10px] text-gray-600 mb-0.5">Text Color</label>
                                <div className="flex gap-1 items-center">
                                  <input
                                    type="color"
                                    value={customStyles[selectedElementId].textColor}
                                    onChange={(e) => updateStyle(selectedElementId, 'textColor', e.target.value)}
                                    className="w-5 h-5 p-0 border-0 rounded cursor-pointer"
                                  />
                                  <span className="text-[9px] text-gray-500 uppercase">{customStyles[selectedElementId].textColor}</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <label className="block text-[10px] text-gray-400 mb-0.5">Text Color</label>
                                <div className="flex gap-1 items-center opacity-50 cursor-not-allowed">
                                  <input
                                    type="color"
                                    value={customStyles[selectedElementId].textColor}
                                    disabled
                                    className="w-5 h-5 p-0 border-0 rounded cursor-not-allowed"
                                  />
                                  <span className="text-[9px] text-gray-400 uppercase">{customStyles[selectedElementId].textColor}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Background Transparency Slider */}
                        <div>
                          <label className="block text-[10px] text-gray-600 mb-1 flex justify-between">
                            <span>Background Transparency</span>
                            <span className="font-semibold">{100 - (customStyles[selectedElementId].backgroundOpacity ?? 100)}%</span>
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={100 - (customStyles[selectedElementId].backgroundOpacity ?? 100)}
                            onChange={(e) => updateStyle(selectedElementId, 'backgroundOpacity', 100 - parseInt(e.target.value))}
                            className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>

                        {/* Border Style */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-600 mb-0.5">Border Color</label>
                            <div className="flex gap-1 items-center">
                              <input
                                type="color"
                                value={customStyles[selectedElementId].borderColor}
                                onChange={(e) => updateStyle(selectedElementId, 'borderColor', e.target.value)}
                                className="w-5 h-5 p-0 border-0 rounded cursor-pointer"
                              />
                              <span className="text-[9px] text-gray-500 uppercase">{customStyles[selectedElementId].borderColor}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-600 mb-0.5">Border Width (px)</label>
                            <Input
                              type="number"
                              size="small"
                              value={customStyles[selectedElementId].borderWidth}
                              onChange={(e) => updateStyle(selectedElementId, 'borderWidth', parseFloat(e.target.value) || 0)}
                              min={0}
                              max={10}
                              step={0.5}
                              style={{ fontSize: '10px' }}
                            />
                          </div>
                        </div>

                        {/* Corner Radius & Font Size */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-gray-600 mb-0.5">Corner Radius (px)</label>
                            <Input
                              type="number"
                              size="small"
                              value={customStyles[selectedElementId].borderRadius}
                              onChange={(e) => updateStyle(selectedElementId, 'borderRadius', parseInt(e.target.value) || 0)}
                              min={0}
                              max={24}
                              style={{ fontSize: '10px' }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-gray-600 mb-0.5">Font Size (pt)</label>
                            <Input
                              type="number"
                              size="small"
                              value={customStyles[selectedElementId].fontSize}
                              onChange={(e) => updateStyle(selectedElementId, 'fontSize', parseInt(e.target.value) || 0)}
                              min={6}
                              max={36}
                              style={{ fontSize: '10px' }}
                            />
                          </div>
                        </div>

                        {/* Font Weight & Font Style */}
                        <div className="flex gap-4 pt-1">
                          <Checkbox
                            checked={customStyles[selectedElementId].fontWeight === 'bold'}
                            onChange={(e) => updateStyle(selectedElementId, 'fontWeight', e.target.checked ? 'bold' : 'normal')}
                            style={{ fontSize: '10px' }}
                          >
                            Bold
                          </Checkbox>
                          <Checkbox
                            checked={customStyles[selectedElementId].fontStyle === 'italic'}
                            onChange={(e) => updateStyle(selectedElementId, 'fontStyle', e.target.checked ? 'italic' : 'normal')}
                            style={{ fontSize: '10px' }}
                          >
                            Italic
                          </Checkbox>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-gray-50 rounded-lg text-[10px] text-gray-500 italic text-center border border-dashed">
                    Select a page element to edit its custom styles.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side - Live Preview (Rendered off-screen on mobile to keep OpenLayers rendering/export active) */}
          <div
            className="flex flex-col md:flex-1 overflow-hidden h-full"
            style={isMobile ? {
              position: 'absolute',
              left: '-9999px',
              top: '-9999px',
              width: '800px',
              height: '600px'
            } : undefined}
          >
            <div className="text-sm font-semibold text-gray-700 mb-2 md:block hidden">
              Live Preview ({settings.pageSize} - {settings.layout}) - Pan & Zoom the Map
            </div>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50 flex-1 flex flex-col items-center justify-start overflow-y-auto min-h-0 max-h-full gap-4 w-full">
              {renderPreview()}
            </div>
          </div>
        </div>

        <style dangerouslySetInnerHTML={{
          __html: `
          @media (max-width: 767px) {
            .print-modal .ant-modal-body {
              max-height: calc(100dvh - 140px) !important;
              overflow-y: auto !important;
              padding: 12px 16px !important;
            }
            .print-modal {
              max-width: 100vw !important;
              margin: 0 !important;
              top: 0 !important;
              padding: 8px !important;
            }
            .print-modal .ant-modal-content {
              border-radius: 12px !important;
            }
          }
        ` }} />
      </Modal>
    </>
  );
};

export default PrintComponent;
