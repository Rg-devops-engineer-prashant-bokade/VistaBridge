// ============================================================================
// Dashboard View & Editor Page (/dashboard/view)
//
// Interactive grid dashboard interface:
// 1. Renders draggable/resizable widget cards via `react-grid-layout`:
//    - Map widgets (interactive OpenLayers views)
//    - Chart widgets (Bar, Pie, Line, GeoChart)
//    - KPI counters & Rich text notes
// 2. Synchronizes spatial extent and feature selection across widgets
// 3. Allows authoring/editing: add new widgets, reorder layout, change themes,
//    and save changes to the SQLite database.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback, useMemo } from 'react';
import { Typography, Spin, Button, Divider, Tag, Tooltip, Modal, Input, App, Form, Select, Popover } from 'antd';
import {
  Plus, Minus, Maximize, ArrowLeft, Share2, Save, Edit2, FileText, Calendar,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Trash2,
  BarChart3, PieChart, LineChart, Table, Hash, Map, X, Paintbrush, Info, ImageIcon,
  Printer, Eye, Donut, ScatterChart, TrendingUp, Lock, Unlock, Palette,
  Globe, Layers, LayoutDashboard
} from 'lucide-react';
import ChartThemePicker from '@/components/dashboard/ChartThemePicker';
import { useRouter, useSearchParams } from 'next/navigation';
import GeoChartWidget, { type GeoChartConfig } from '@/components/dashboard/widgets/GeoChartWidget';
import MapWidget, { type MapLayer } from '@/components/dashboard/widgets/MapWidget';
import { useAuthStore } from '@/store/useAuthStore';
import { useDashboardStore } from '@/store/useDashboardStore';
import { apiRequest } from '@/lib/api';
import { siteConfig } from '@/config/site-config';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { Responsive } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { DndContext, useDraggable, DragEndEvent, useSensor, useSensors, PointerSensor, TouchSensor } from '@dnd-kit/core';

const { Text } = Typography;

interface CanvasWidget {
  id: string;
  type: 'map' | 'geochart' | 'text';
  geoChartConfig?: GeoChartConfig;
  title: string;
  layers?: any[];
  content?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  isTransparent?: boolean;
  /** map widgets only: when true, touch/drag is passed to OL map; when false, the card can be repositioned */
  locked?: boolean;
}

function CustomWidthProvider<P extends { width?: number }>(
  ComposedComponent: React.ComponentType<P>
): React.ComponentType<Omit<P, 'width'>> {
  return function WidthProviderWrapper(props: any) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(1000);
    useEffect(() => {
      if (!ref.current) return;
      const update = () => {
        if (typeof document !== 'undefined' && document.body.classList.contains('is-dragging-widget')) {
          return;
        }
        const newW = ref.current?.clientWidth;
        if (newW && Math.abs(newW - width) > 2) {
          setWidth(newW);
        }
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(ref.current);
      return () => ro.disconnect();
    }, [width]);
    return (
      <div ref={ref} className="w-full relative h-full">
        <ComposedComponent {...props} width={width} />
      </div>
    );
  };
}

const ResponsiveGridLayout = CustomWidthProvider(Responsive) as any;

interface DraggableWidgetProps {
  widget: CanvasWidget;
  isPdfLock: boolean;
  startResize: (e: React.MouseEvent | React.TouchEvent, widgetId: string) => void;
  children: React.ReactNode;
}

function DraggableWidget({ widget, isPdfLock, startResize, children }: DraggableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: widget.id,
    disabled: isPdfLock,
  });

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${(widget.x / 12) * 100}%`,
    top: `${widget.y}px`,
    width: `${(widget.w / 12) * 100}%`,
    height: `${widget.h}px`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 1000 : 10,
    opacity: isDragging ? 0.85 : undefined,
    touchAction: 'none',
  };

  const renderChildren = () => {
    return React.Children.map(children, (child) => {
      if (React.isValidElement(child)) {
        return React.cloneElement(child as React.ReactElement<any>, {
          dragHandleProps: { ...attributes, ...listeners },
          startResizeProps: startResize,
        });
      }
      return child;
    });
  };

  return (
    <div ref={setNodeRef} style={style} className="select-none">
      {renderChildren()}
    </div>
  );
}

const { Title } = Typography;

// ─── Rich Text Editor ───────────────────────────────────────────────────────
interface RichEditorProps {
  id: string;
  initialValue: string;
  onChange: (html: string) => void;
}

function RichEditor({ id, initialValue, onChange }: RichEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seededId = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [fontSize, setFontSize] = useState<string>('14');

  const FONT_SIZES = ['10', '11', '12', '13', '14', '16', '18', '20', '24', '28', '32'];

  // Seed content only when the widget id changes
  useEffect(() => {
    if (editorRef.current && seededId.current !== id) {
      editorRef.current.innerHTML = initialValue || '';
      seededId.current = id;
    }
  }, [id, initialValue]);

  const emit = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  // Save selection before toolbar interaction steals focus
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  // Restore saved selection
  const restoreSelection = () => {
    const sel = window.getSelection();
    if (sel && savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  // Detect the font-size at the current cursor / selection anchor and sync dropdown.
  // Walk up the DOM from the anchor node, checking inline styles.
  // Fall back to getComputedStyle if no inline style found.
  const detectFontSize = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    // Walk up to find an element with an explicit inline font-size
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const inlineSize = el.style?.fontSize;
        if (inlineSize && inlineSize.endsWith('px')) {
          const px = Math.round(parseFloat(inlineSize)).toString();
          // Snap to nearest available option
          const closest = FONT_SIZES.reduce((a, b) =>
            Math.abs(parseInt(b) - parseInt(px)) < Math.abs(parseInt(a) - parseInt(px)) ? b : a
          );
          setFontSize(closest);
          return;
        }
      }
      node = node.parentNode;
    }
    // Fall back to computed style of the editor container
    if (editorRef.current) {
      const computed = window.getComputedStyle(editorRef.current).fontSize;
      if (computed && computed.endsWith('px')) {
        const px = Math.round(parseFloat(computed)).toString();
        const closest = FONT_SIZES.reduce((a, b) =>
          Math.abs(parseInt(b) - parseInt(px)) < Math.abs(parseInt(a) - parseInt(px)) ? b : a
        );
        setFontSize(closest);
      }
    }
  };

  const execCmd = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    emit();
  };

  // Apply font size using the reliable execCommand marker technique.
  // Step 1: stamp the selection with execCommand('fontSize','7') to get a <font size="7"> node.
  // Step 2: replace every <font size="7"> inside the editor with <span style="font-size:Xpx">.
  // This works even when the selection spans multiple DOM nodes.
  const applyFontSize = (px: string) => {
    setFontSize(px);
    editorRef.current?.focus();
    restoreSelection();

    const sel = window.getSelection();
    const hasSelection = sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed;

    if (hasSelection) {
      // Stamp selected text with a recognisable marker font tag
      document.execCommand('fontSize', false, '7');
      // Now replace every marker <font size="7"> with a <span style="font-size:Xpx">
      editorRef.current?.querySelectorAll('font[size="7"]').forEach((node) => {
        const span = document.createElement('span');
        span.style.fontSize = `${px}px`;
        span.innerHTML = (node as HTMLElement).innerHTML;
        node.parentNode?.replaceChild(span, node);
      });
    } else {
      // No selection — apply to the whole editor div so all text changes size
      if (editorRef.current) {
        editorRef.current.style.fontSize = `${px}px`;
      }
    }
    emit();
  };

  const handleImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target?.result as string;
      editorRef.current?.focus();
      document.execCommand('insertImage', false, src);
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.querySelectorAll('img').forEach((img) => {
            img.style.maxWidth = '100%';
            img.style.borderRadius = '6px';
            img.style.marginTop = '4px';
            img.style.marginBottom = '4px';
          });
          emit();
        }
      }, 50);
    };
    reader.readAsDataURL(file);
  };

  const toolbarBtns = [
    { cmd: 'bold', icon: <Bold size={11} />, title: 'Bold' },
    { cmd: 'italic', icon: <Italic size={11} />, title: 'Italic' },
    { cmd: 'underline', icon: <Underline size={11} />, title: 'Underline' },
    { cmd: 'justifyLeft', icon: <AlignLeft size={11} />, title: 'Align Left' },
    { cmd: 'justifyCenter', icon: <AlignCenter size={11} />, title: 'Align Center' },
    { cmd: 'justifyRight', icon: <AlignRight size={11} />, title: 'Align Right' },
  ];

  return (
    <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden focus-within:border-primary transition-colors">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 bg-gray-50 border-b border-gray-200 px-1.5 py-1 flex-wrap shrink-0">

        {/* Font size selector — first in toolbar */}
        <select
          title="Font Size"
          value={fontSize}
          onMouseDown={saveSelection}
          onChange={(e) => applyFontSize(e.target.value)}
          className="h-6 text-[10px] font-semibold text-gray-600 bg-white border border-gray-200 rounded px-1 pr-4 cursor-pointer hover:border-primary transition-colors appearance-none"
          style={{ minWidth: 46 }}
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>

        {/* Divider */}
        <div className="w-px h-4 bg-gray-200 mx-0.5" />

        {toolbarBtns.map((btn) => (
          <button
            key={btn.cmd}
            type="button"
            title={btn.title}
            onMouseDown={(e) => { e.preventDefault(); execCmd(btn.cmd); }}
            className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-gray-800 transition-colors"
          >
            {btn.icon}
          </button>
        ))}

        {/* Divider */}
        <div className="w-px h-4 bg-gray-200 mx-0.5" />

        {/* Image upload button */}
        <button
          type="button"
          title="Insert Image"
          onMouseDown={(e) => { e.preventDefault(); fileInputRef.current?.click(); }}
          className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:bg-primary/10 hover:text-primary transition-colors"
        >
          <ImageIcon size={11} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="p-2.5 text-xs text-gray-700 bg-white outline-none break-words"
        style={{ minHeight: 80, maxHeight: 180, overflowY: 'auto' }}
        onInput={emit}
        onBlur={emit}
        onKeyUp={() => { saveSelection(); detectFontSize(); }}
        onMouseUp={() => { saveSelection(); detectFontSize(); }}
        onSelect={() => { saveSelection(); detectFontSize(); }}
        data-placeholder="Edit text here..."
      />

      <style>{`
        [data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
const PrintableWidgetInner = ({
  widget,
  isPdfLock,
  dragHandleProps,
  startResizeProps,
  publish,
  setWidgets,
}: {
  widget: CanvasWidget;
  isPdfLock: boolean;
  dragHandleProps?: any;
  startResizeProps?: (e: React.MouseEvent | React.TouchEvent, widgetId: string) => void;
  publish: any;
  setWidgets: React.Dispatch<React.SetStateAction<CanvasWidget[]>>;
}) => {
  return (
    <div
      className={`w-full h-full flex flex-col overflow-visible relative ${widget.type === 'text'
        ? 'drag-handle cursor-grab active:cursor-grabbing border border-gray-250 shadow-sm rounded-2xl'
        : 'bg-white border border-gray-200 shadow-sm rounded-2xl'
        }`}
      style={{
        backgroundColor: widget.type === 'text'
          ? (widget.isTransparent ? 'transparent' : (widget.bgColor || '#ffffff'))
          : '#ffffff',
        color: widget.type === 'text' ? (widget.textColor || '#1f2937') : 'inherit',
        border: widget.type === 'text'
          ? `${widget.borderWidth !== undefined ? widget.borderWidth : 1}px ${(widget.borderWidth !== undefined ? widget.borderWidth : 1) > 0 ? 'solid' : 'none'
          } ${widget.borderColor || '#e5e7eb'}`
          : undefined,
        borderRadius: widget.type === 'text'
          ? `${widget.borderRadius !== undefined ? widget.borderRadius : 16}px`
          : undefined,
        boxShadow: widget.type === 'text' && widget.isTransparent ? 'none' : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      }}
      {...(widget.type === 'text' ? dragHandleProps : {})}
    >
      {/* Floating Delete button for Text widgets (since they don't have a header) */}
      {widget.type === 'text' && !isPdfLock && (
        <button
          className="absolute top-2.5 right-2.5 w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors z-20 bg-white/95 backdrop-blur-sm border border-gray-150 shadow-sm pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
          }}
        >
          <Trash2 size={12} />
        </button>
      )}

      {/* Widget header (always editable except for text boxes) */}
      {widget.type !== 'text' && (
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-gray-100 rounded-t-2xl shrink-0 bg-white relative z-20"
        >
          <div
            className="flex items-center gap-2 min-w-0 flex-grow drag-handle cursor-grab active:cursor-grabbing"
            {...dragHandleProps}
          >
            {!isPdfLock && (
              <div className="flex flex-col gap-[3px] shrink-0">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-[3px]">
                    <div className="w-[3px] h-[3px] rounded-full bg-gray-300" />
                    <div className="w-[3px] h-[3px] rounded-full bg-gray-300" />
                  </div>
                ))}
              </div>
            )}
            <span
              className="text-[12px] font-bold text-gray-700 truncate"
              title={widget.title && widget.title.length > 32 ? widget.title : undefined}
            >
              {widget.title && widget.title.length > 32 ? widget.title.slice(0, 30) + '…' : widget.title}
            </span>
          </div>

          {!isPdfLock && (
            <div
              className="flex items-center gap-1 shrink-0 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {widget.type === 'map' && (
                <button
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    publish({ type: 'zoom_map_widget', widgetId: widget.id });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    publish({ type: 'zoom_map_widget', widgetId: widget.id });
                  }}
                  title="Zoom to fit all layers"
                >
                  <Eye size={14} className="pointer-events-none" />
                </button>
              )}
              {widget.type === 'geochart' && widget.geoChartConfig &&
                !['kpi', 'table'].includes(widget.geoChartConfig.chartType) && (
                  <Popover
                    trigger="click"
                    placement="bottomRight"
                    content={
                      <div className="w-80 p-1">
                        <div className="mb-2.5 font-bold text-xs text-gray-800 flex items-center gap-1.5 border-b border-gray-100 pb-1.5">
                          <Palette size={14} className="text-indigo-600" />
                          <span>Customize Chart Colors</span>
                        </div>
                        <ChartThemePicker
                          compact
                          chartType={widget.geoChartConfig.chartType}
                          value={{
                            colorTheme: widget.geoChartConfig.colorTheme,
                            customColors: widget.geoChartConfig.customColors,
                            primaryColor: widget.geoChartConfig.primaryColor,
                            colorMode: widget.geoChartConfig.colorMode,
                            categoryColors: widget.geoChartConfig.categoryColors,
                          }}
                          onChange={(newTheme) => {
                            setWidgets((prev) =>
                              prev.map((w) =>
                                w.id === widget.id
                                  ? {
                                    ...w,
                                    geoChartConfig: {
                                      ...w.geoChartConfig!,
                                      colorTheme: newTheme.colorTheme,
                                      customColors: newTheme.customColors,
                                      primaryColor: newTheme.primaryColor,
                                      colorMode: newTheme.colorMode,
                                      categoryColors: newTheme.categoryColors,
                                    },
                                  }
                                  : w
                              )
                            );
                          }}
                        />
                      </div>
                    }
                  >
                    <button
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                      title="Customize Chart Colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Palette size={14} className="pointer-events-none" />
                    </button>
                  </Popover>
                )}
              <button
                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
                }}
              >
                <Trash2 size={14} className="pointer-events-none" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Widget content */}
      {widget.type === 'text' ? (
        <div
          id={`text-measure-${widget.id}`}
          className="w-full overflow-hidden text-sm pl-4 pr-10 py-3 break-words rich-content"
          style={{ color: widget.textColor || '#1f2937' }}
          dangerouslySetInnerHTML={{ __html: widget.content || '' }}
        />
      ) : (
        <div className="flex-grow min-h-0 p-2 relative flex flex-col" style={{ overflow: 'hidden' }}>
          {widget.type === 'map' ? (
            <MapWidget widgetId={widget.id} title={widget.title} layers={widget.layers ?? []} />
          ) : widget.geoChartConfig ? (
            <GeoChartWidget widgetId={widget.id} config={widget.geoChartConfig} />
          ) : null}
        </div>
      )}

      {/* Custom Resize Handle */}
      {!isPdfLock && startResizeProps && (
        <div
          className="absolute bottom-1 right-1 w-4 h-4 cursor-se-resize flex items-end justify-end pointer-events-auto z-30 touch-none"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation();
            startResizeProps(e, widget.id);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            startResizeProps(e, widget.id);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-400 fill-current">
            <path d="M10,0 L0,10 L10,10 Z" />
          </svg>
        </div>
      )}
    </div>
  );
};

const adjustWidgetsForPageFooters = (currentWidgets: CanvasWidget[], pageHeight: number): CanvasWidget[] => {
  const footerSpace = 60;
  // Sort widgets by Y coordinate first to process top-to-bottom
  const sorted = [...currentWidgets].sort((a, b) => a.y - b.y);

  // We will keep track of shifted widgets
  const adjusted: CanvasWidget[] = [];

  for (const w of sorted) {
    let newY = w.y;

    // 1. Check footer overlap and push to next page top if needed
    const pageTop = Math.floor(newY / pageHeight);
    const pageBoundary = (pageTop + 1) * pageHeight;
    if (w.h <= pageHeight - footerSpace) {
      if (newY + w.h > pageBoundary - footerSpace) {
        newY = pageBoundary; // Push to start of next page
      }
    }

    // 2. Resolve overlaps with already processed widgets that are in the same grid columns
    // We check if this widget overlaps vertically with any adjusted widget that shares X coordinates
    let hasOverlap = true;
    let iterations = 0;
    while (hasOverlap && iterations < 100) {
      hasOverlap = false;
      iterations++;
      for (const other of adjusted) {
        // Check if they overlap horizontally
        const xOverlap = Math.max(0, Math.min(w.x + w.w, other.x + other.w) - Math.max(w.x, other.x)) > 0.01;
        if (xOverlap) {
          // Check if they overlap vertically at the current newY
          const yOverlap = newY < other.y + other.h && newY + w.h > other.y;
          if (yOverlap) {
            newY = other.y + other.h + 12; // Push below the other widget with a 12px gap
            hasOverlap = true;

            // Re-check footer boundary for the new pushed position
            const newPageTop = Math.floor(newY / pageHeight);
            const newPageBoundary = (newPageTop + 1) * pageHeight;
            if (w.h <= pageHeight - footerSpace) {
              if (newY + w.h > newPageBoundary - footerSpace) {
                newY = newPageBoundary;
              }
            }
          }
        }
      }
    }

    adjusted.push({ ...w, y: newY });
  }

  return adjusted;
};

// ────────────────────────────────────────────────────────────────────────────

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const clearChartHoverState = async (element: HTMLElement) => {
  document.documentElement.classList.add('dashboard-exporting');
  document.body.classList.add('dashboard-exporting');

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }

  element.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  element.querySelectorAll<HTMLElement>('*').forEach((node) => {
    node.dispatchEvent(new MouseEvent('mouseleave'));
    node.dispatchEvent(new MouseEvent('mouseout'));
  });

  try {
    const echarts = await import('echarts');
    element.querySelectorAll<HTMLDivElement>('div').forEach((node) => {
      const chart = echarts.getInstanceByDom?.(node);
      if (!chart) return;
      chart.dispatchAction({ type: 'hideTip' });
      chart.dispatchAction({ type: 'downplay' });
      chart.resize();
    });
  } catch {
    // Export should continue even if ECharts is not currently loaded.
  }

  await waitForPaint();
};

const clearDashboardExportMode = () => {
  document.documentElement.classList.remove('dashboard-exporting');
  document.body.classList.remove('dashboard-exporting');
};

function ViewDashboardContent() {
  const router = useRouter();
  const { notification } = App.useApp();
  const { token, hydrated } = useAuthStore();
  const searchParams = useSearchParams();
  const { customLogo, fetchAppearance, isLoaded: appearanceLoaded, primaryColor } = useAppearanceStore();
  const themePrimary = primaryColor || siteConfig.colors.primary || '#0284c7';
  const dashboardId = searchParams.get('id');

  useEffect(() => {
    if (!appearanceLoaded) {
      fetchAppearance();
    }
  }, [appearanceLoaded, fetchAppearance]);

  useEffect(() => {
    if (hydrated && !token) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  // Disable window scrolling to prevent double scrollbars on medium/large screens
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [isPdfLockState, setIsPdfLockState] = useState(false);
  const isPdfLock = isPdfLockState;
  const setIsPdfLock = (val: boolean) => {
    setIsPdfLockState(val);
    useDashboardStore.getState().setIsPdfLock(val);
  };
  const [pageSize, setPageSize] = useState<'A4' | 'A3' | 'LETTER'>('A4');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [pdfQuality, setPdfQuality] = useState<'standard' | 'high' | 'ultra'>('high');
  const [isEditingPrintLayout, setIsEditingPrintLayout] = useState(false);
  const [prePrintWidgetsBackup, setPrePrintWidgetsBackup] = useState<CanvasWidget[] | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pdfFileName, setPdfFileName] = useState('');
  const [dashboardName, setDashboardName] = useState('Dashboard');
  const [widgets, setWidgets] = useState<CanvasWidget[]>([]);
  const loadedDashboardIdRef = useRef<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [showDate, setShowDate] = useState(true);
  const isDraggingRef = useRef(false);

  // Safety listener: if user releases mouse anywhere on the window (or window blurs), guarantee drag flags are cleared
  useEffect(() => {
    const handleGlobalRelease = () => {
      if (isDraggingRef.current) {
        setTimeout(() => {
          isDraggingRef.current = false;
          if (typeof document !== 'undefined') {
            document.body.classList.remove('is-dragging-widget');
          }
        }, 50);
      }
    };

    window.addEventListener('mouseup', handleGlobalRelease);
    window.addEventListener('pointerup', handleGlobalRelease);
    window.addEventListener('touchend', handleGlobalRelease);
    window.addEventListener('blur', handleGlobalRelease);

    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('pointerup', handleGlobalRelease);
      window.removeEventListener('touchend', handleGlobalRelease);
      window.removeEventListener('blur', handleGlobalRelease);
    };
  }, []);

  // Mobile breakpoint detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  );

  // Mobile chart type picker visibility
  const [showMobileChartPicker, setShowMobileChartPicker] = useState(false);

  const isLandscape = orientation === 'landscape';
  const cWidth = isLandscape ? 1150 : 820;

  // Exact PDF page dimensions in points (matching jsPDF values)
  let pdfWidth = cWidth;
  let pdfHeight = 800;
  if (pageSize === 'A4') {
    pdfWidth = isLandscape ? 841.89 : 595.28;
    pdfHeight = isLandscape ? 595.28 : 841.89;
  } else if (pageSize === 'A3') {
    pdfWidth = isLandscape ? 1190.55 : 841.89;
    pdfHeight = isLandscape ? 841.89 : 1190.55;
  } else if (pageSize === 'LETTER') {
    pdfWidth = isLandscape ? 792 : 612;
    pdfHeight = isLandscape ? 612 : 792;
  }

  const printableWidth = pdfWidth;
  const printableHeight = pdfHeight;

  // Calculate singlePageHeight so it maps exactly to printableHeight in jsPDF
  const singlePageHeight = Math.round(printableHeight * (cWidth / printableWidth));

  const gapHeight = 0;

  const maxWidgetY = widgets.reduce((max, w) => Math.max(max, (w.y || 0) + (w.h || 0)), 0);
  const totalPagesNeeded = Math.max(1, Math.ceil((maxWidgetY + 20) / singlePageHeight));
  const totalCanvasHeightPx = (singlePageHeight * totalPagesNeeded) + (gapHeight * (totalPagesNeeded - 1));

  const handlePrintDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    const canvasWidthPx = orientation === 'landscape' ? 1150 : 820;

    setWidgets((prev) =>
      prev.map((w) => {
        if (w.id === active.id) {
          const deltaXGrid = (delta.x / canvasWidthPx) * 12;
          const newX = Math.max(0, Math.min(12 - w.w, w.x + deltaXGrid));

          let newY = Math.max(0, w.y + delta.y);

          // Snapping overlapping components:
          // If the widget height fits on a single page, but its bottom extends past the footer boundary
          // push it to start cleanly at the top of the next page.
          const footerReservedSpace = 60;
          if (w.h <= singlePageHeight - footerReservedSpace) {
            const pageTop = Math.floor(newY / singlePageHeight);
            const pageBoundary = (pageTop + 1) * singlePageHeight;
            if (newY + w.h > pageBoundary - footerReservedSpace) {
              newY = pageBoundary;
            }
          }

          return {
            ...w,
            x: Math.round(newX * 100) / 100,
            y: Math.round(newY),
          };
        }
        return w;
      })
    );
  };

  const startResize = (e: React.MouseEvent | React.TouchEvent, widgetId: string) => {
    if (e.cancelable) {
      e.preventDefault();
    }
    e.stopPropagation();

    const isTouch = 'touches' in e;
    const startX = isTouch ? e.touches[0].clientX : e.clientX;
    const startY = isTouch ? e.touches[0].clientY : e.clientY;
    const widget = widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    const startW = widget.w;
    const startH = widget.h;
    const canvasWidthPx = orientation === 'landscape' ? 1150 : 820;

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const isMoveTouch = 'touches' in moveEvent;
      const currentX = isMoveTouch ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const currentY = isMoveTouch ? moveEvent.touches[0].clientY : moveEvent.clientY;

      const deltaX = currentX - startX;
      const deltaY = currentY - startY;

      const deltaWGrid = (deltaX / canvasWidthPx) * 12;
      const newW = Math.max(1, Math.min(12 - widget.x, startW + deltaWGrid));
      const newH = Math.max(50, startH + deltaY);

      setWidgets((prev) =>
        prev.map((w) => {
          if (w.id === widgetId) {
            return {
              ...w,
              w: Math.round(newW * 100) / 100,
              h: Math.round(newH),
            };
          }
          return w;
        })
      );
    };

    const onEnd = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };

  // Keep track of resize timeouts to prevent jittering / "discodancing" of the widgets
  const resizeTimeouts = useRef<Record<string, any>>({});

  // Cleanup all resize timeouts on unmount
  useEffect(() => {
    const timeouts = resizeTimeouts.current;
    return () => {
      Object.values(timeouts).forEach(clearTimeout);
    };
  }, []);

  // Rename modal state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const handleRenameDashboard = async () => {
    const trimmed = newName.trim();
    if (!trimmed || !dashboardId) return;
    try {
      setDashboardName(trimmed);
      setRenameModalOpen(false);
      const res = await apiRequest(`/dashboards/${dashboardId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      notification.success({
        message: 'Dashboard Renamed',
        description: `Updated name to "${trimmed}".`,
        placement: 'topRight',
      });
    } catch (err: any) {
      notification.error({
        message: 'Rename Failed',
        description: err.message || 'Could not save new dashboard name.',
        placement: 'topRight',
      });
    }
  };

  // Right vertical bar and sliding panel states
  const [activePanel, setActivePanel] = useState<string | null>(null);

  // Dataset / layer and map workspace states
  const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [availableMaps, setAvailableMaps] = useState<any[]>([]);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [loadingMapLayers, setLoadingMapLayers] = useState(false);
  const [selectedMapOrLayer, setSelectedMapOrLayer] = useState<string | null>(null);

  // ── Saved charts (persisted via API) ────────────────────────────────────
  const [savedCharts, setSavedCharts] = useState<{ id: string; title: string; chartType: string; config: GeoChartConfig }[]>([]);

  useEffect(() => {
    if (!token) return;
    apiRequest('/dashboards/charts')
      .then(r => r.ok ? r.json() : [])
      .then((rows: any[]) => setSavedCharts(rows.map(r => ({
        id: String(r.id), title: r.title, chartType: r.chart_type, config: r.config,
      }))))
      .catch(() => { });
  }, [token]);

  const persistChartAdd = async (title: string, chartType: string, config: GeoChartConfig) => {
    try {
      const res = await apiRequest('/dashboards/charts', {
        method: 'POST',
        body: JSON.stringify({ title, chart_type: chartType, config }),
      });
      if (!res.ok) return;
      const row = await res.json();
      setSavedCharts(prev => [{ id: String(row.id), title: row.title, chartType: row.chart_type, config: row.config }, ...prev]);
    } catch { }
  };

  const persistChartDelete = async (id: string) => {
    const chart = savedCharts.find(c => c.id === id);
    setSavedCharts(prev => prev.filter(c => c.id !== id));
    if (chart) {
      setWidgets(prev => prev.filter(w =>
        !(w.type === 'geochart' &&
          w.geoChartConfig?.layerId === chart.config.layerId &&
          w.geoChartConfig?.chartType === chart.config.chartType &&
          w.geoChartConfig?.dimension === chart.config.dimension &&
          w.geoChartConfig?.metric === chart.config.metric &&
          w.geoChartConfig?.aggregation === chart.config.aggregation)
      ));
    }
    await apiRequest(`/dashboards/charts/${id}`, { method: 'DELETE' }).catch(() => { });
  };

  // ── GeoChart (GeoServer-native) panel state ──────────────────────────────
  const [geoChartLayerId, setGeoChartLayerId] = useState<string | null>(null);
  const [geoChartColumns, setGeoChartColumns] = useState<{ name: string; type: string }[]>([]);
  const [geoChartColsLoading, setGeoChartColsLoading] = useState(false);
  const [geoChartPresetType, setGeoChartPresetType] = useState<string | null>(null);
  const [geoChartForm] = Form.useForm();

  const GEO_CHART_TYPES = [
    { key: 'bar', label: 'Bar Chart' },
    { key: 'line', label: 'Line Chart' },
    { key: 'area', label: 'Area Chart' },
    { key: 'pie', label: 'Pie Chart' },
    { key: 'donut', label: 'Donut Chart' },
    { key: 'scatter', label: 'Scatter Plot' },
    { key: 'kpi', label: 'KPI / Big Number' },
    { key: 'table', label: 'Data Table' },
  ];

  const AGGREGATIONS = [
    { key: 'count', label: 'Count' },
    { key: 'sum', label: 'Sum' },
    { key: 'avg', label: 'Average' },
    { key: 'min', label: 'Min' },
    { key: 'max', label: 'Max' },
  ];

  const handleGeoChartLayerChange = async (layerId: string) => {
    setGeoChartLayerId(layerId);
    setGeoChartColumns([]);
    geoChartForm.resetFields(['dimension', 'metric', 'aggregation']);
    if (!geoChartPresetType) geoChartForm.resetFields(['chartType']);
    setGeoChartColsLoading(true);
    try {
      const res = await apiRequest(`/datasets/${layerId}/features/?page_size=1&page=1`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      const sample = json.data?.[0] ?? {};
      const cols = Object.keys(sample)
        .filter(k => k !== 'geometry_type')
        .map(k => ({ name: k, type: typeof sample[k] === 'number' ? 'number' : 'string' }));
      setGeoChartColumns(cols);
      if (geoChartPresetType) geoChartForm.setFieldValue('chartType', geoChartPresetType);
    } catch {
      notification.error({ message: 'Failed to load layer columns' });
    } finally {
      setGeoChartColsLoading(false);
    }
  };

  const handleAddGeoChart = (values: any) => {
    if (!geoChartLayerId) return;
    const chartType = geoChartPresetType ?? values.chartType;
    const ds = availableDatasets.find(d => d.id === geoChartLayerId);
    const layerName = ds?.name ?? geoChartLayerId;
    const chartLabel = GEO_CHART_TYPES.find(c => c.key === chartType)?.label ?? chartType;

    let title = values.title?.trim();
    if (!title) {
      if (chartType === 'kpi') {
        const metricName = values.metric && values.metric !== '__kpi__' && values.metric !== 'count' ? values.metric : '';
        if (metricName) {
          const fmt = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          title = fmt(metricName);
        } else {
          title = values.aggregation === 'count' ? 'Total Features' : 'KPI Widget';
        }
      } else {
        title = `${chartLabel} — ${layerName}`;
      }
    }
    const config: GeoChartConfig = {
      layerId: geoChartLayerId,
      chartType,
      dimension: values.dimension ?? '',
      metric: values.metric ?? '',
      aggregation: values.aggregation ?? 'count',
      tableColumns: chartType === 'table' ? (values.tableColumns ?? []) : undefined,
      colorTheme: values.themeSettings?.colorTheme,
      customColors: values.themeSettings?.customColors,
      primaryColor: values.themeSettings?.primaryColor,
      colorMode: values.themeSettings?.colorMode,
      categoryColors: values.themeSettings?.categoryColors,
    };
    const nextY = widgets.reduce((maxY, item) => Math.max(maxY, (item.y !== undefined && item.y !== Infinity && !isNaN(item.y) ? item.y : 0) + (item.h || 300) + 16), 0);
    const widget: CanvasWidget = {
      id: `gc_${Date.now()}`,
      type: 'geochart',
      geoChartConfig: config,
      title,
      x: 0,
      y: nextY,
      w: chartType === 'kpi' ? 3 : 6,
      h: chartType === 'kpi' ? 120 : 300,
    };
    setWidgets(prev => [...prev, widget]);
    persistChartAdd(title, chartType, config);
    notification.success({ message: `"${title}" added to canvas`, duration: 2 });
    setActivePanel(null);
    geoChartForm.resetFields();
    setGeoChartLayerId(null);
    setGeoChartColumns([]);
    setGeoChartPresetType(null);
  };

  // Map config states
  const [mapConfigLayers, setMapConfigLayers] = useState<any[]>([]);
  const [mapConfigTitle, setMapConfigTitle] = useState('Map');

  const { publish } = useDashboardStore();

  // Load dashboard
  useEffect(() => {
    if (!token || !dashboardId || dashboardId === 'undefined') return;
    if (loadedDashboardIdRef.current === dashboardId) return;

    setLoading(true);
    apiRequest(`/dashboards/${dashboardId}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          // 404 = dashboard doesn't belong to this user — redirect instead of staying on broken page
          if (r.status === 404 || r.status === 403) {
            notification.error({
              message: r.status === 403 ? 'Access Denied' : 'Dashboard Not Found',
              description: err.detail || 'This dashboard does not exist or you do not have access to it.',
              placement: 'topRight',
            });
            router.replace('/dashboard/manage');
            return null;
          }
          throw new Error(err.detail || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return; // redirected above
        setDashboardName(data.name || 'Dashboard');
        setNewName(data.name || 'Dashboard');
        setIsPublic(Boolean(data.is_public));
        const rawWidgets = data.content?.widgets || [];
        const needsMigration = rawWidgets.some((w: any) => w.h > 0 && w.h < 25);
        const migratedWidgets = rawWidgets.map((w: any) => {
          if (needsMigration) {
            return { ...w, y: w.y * 56, h: w.h > 0 ? (w.h * 56 - 12) : w.h };
          }
          return w;
        });
        const hasMap = migratedWidgets.some((w: any) => w.type === 'map');
        useDashboardStore.getState().setMapsSettled(!hasMap);
        setWidgets(migratedWidgets);
        loadedDashboardIdRef.current = dashboardId;
      })
      .catch((err) => {
        notification.error({ message: 'Failed to load dashboard', description: err.message, placement: 'topRight' });
        router.replace('/dashboard/manage');
      })
      .finally(() => setLoading(false));
  }, [dashboardId, token, notification, router]);

  // Load vector datasets
  const fetchAvailableDatasets = useCallback(() => {
    setDatasetsLoading(true);
    apiRequest('/datasets/')
      .then((r) => r.json())
      .then((data) => {
        const ready = (Array.isArray(data) ? data : data.results ?? [])
          .filter((d: any) => d.status === 'READY');
        setAvailableDatasets(ready);
      })
      .catch(() => { })
      .finally(() => setDatasetsLoading(false));
  }, []);

  // Load created map workspaces (from Manage Maps)
  const fetchAvailableMaps = useCallback(() => {
    setMapsLoading(true);
    apiRequest('/maps/')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        setAvailableMaps(list);
      })
      .catch(() => { })
      .finally(() => setMapsLoading(false));
  }, []);

  useEffect(() => {
    if (token) {
      queueMicrotask(() => {
        fetchAvailableDatasets();
        fetchAvailableMaps();
      });
    }
  }, [token, fetchAvailableDatasets, fetchAvailableMaps]);

  // Save changes
  const handleSaveDashboard = async () => {
    if (!dashboardId || dashboardId === 'undefined') {
      notification.error({ message: 'Cannot save: dashboard was not created yet. Please go back and create it first.', placement: 'topRight' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: dashboardName,
        is_public: isPublic,
        content: {
          widgets: widgets.map((w) => ({
            id: w.id,
            type: w.type,
            geoChartConfig: w.geoChartConfig,
            title: w.title,
            layers: w.layers,
            content: w.content,
            x: w.x,
            y: w.y,
            w: w.w,
            h: w.h,
            bgColor: w.bgColor,
            textColor: w.textColor,
            borderColor: w.borderColor,
            borderWidth: w.borderWidth,
            borderRadius: w.borderRadius,
            isTransparent: w.isTransparent,
          })),
        },
      };

      const res = await apiRequest(`/dashboards/${dashboardId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      notification.success({ message: 'Dashboard saved successfully', placement: 'topRight' });
    } catch (err: any) {
      notification.error({ message: 'Failed to save dashboard', description: err?.message, placement: 'topRight' });
    } finally {
      setSaving(false);
    }
  };



  const handleExportPDF = async () => {
    const element = document.getElementById('dashboard-canvas');
    if (!element) {
      notification.warning({ message: 'Dashboard canvas container not found.' });
      return;
    }

    setExportingPdf(true);
    setIsPdfLock(true); // Lock editing & hide buttons before capturing
    const originalScale = zoomScale;
    try {
      const [
        { default: jsPDF },
        { default: html2canvas }
      ] = await Promise.all([
        import('jspdf'),
        import('html2canvas-pro')
      ]);

      let captureScale = 2; // high
      if (pdfQuality === 'standard') captureScale = 1;
      if (pdfQuality === 'ultra') captureScale = 3;

      setZoomScale(1);

      // Wait for layout updates (react rendering cycles to hide edit artifacts and let ECharts finish resizing)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await clearChartHoverState(element);

      const captureWidth = cWidth;
      const captureHeight = totalCanvasHeightPx;

      const canvas = await html2canvas(element, {
        useCORS: true,
        scale: captureScale,
        logging: false,
        backgroundColor: '#ffffff', // Pure white background
        width: captureWidth,
        height: captureHeight,
        windowWidth: captureWidth + 100,
        windowHeight: captureHeight + 100,
        onclone: (clonedDoc: any, clonedElement: any) => {
          try {
            const doc = clonedDoc as Document;
            if (doc && typeof doc.querySelectorAll === 'function') {
              doc.querySelectorAll('.echarts-tooltip, .ant-tooltip').forEach((node) => node.remove());
            }
            const el = (doc?.getElementById ? doc.getElementById('dashboard-canvas') : clonedElement) as HTMLElement | null;
            if (el && el.style) {
              el.style.width = `${captureWidth}px`;
              el.style.minWidth = `${captureWidth}px`;
              el.style.maxWidth = `${captureWidth}px`;
              el.style.height = `${captureHeight}px`;
              el.style.minHeight = `${captureHeight}px`;
              el.style.maxHeight = `${captureHeight}px`;
              el.style.border = 'none';
              el.style.boxShadow = 'none';
              el.style.margin = '0';
              el.style.padding = '0';
              el.style.transform = 'none';
            }
          } catch { }
        },
      });

      let pdfWidth = orientation === 'landscape' ? 841.89 : 595.28;
      let pdfHeight = orientation === 'landscape' ? 595.28 : 841.89;
      let formatSetting: any = 'a4';

      if (pageSize === 'A4') {
        formatSetting = 'a4';
        pdfWidth = orientation === 'landscape' ? 841.89 : 595.28;
        pdfHeight = orientation === 'landscape' ? 595.28 : 841.89;
      } else if (pageSize === 'A3') {
        formatSetting = 'a3';
        pdfWidth = orientation === 'landscape' ? 1190.55 : 841.89;
        pdfHeight = orientation === 'landscape' ? 841.89 : 1190.55;
      } else if (pageSize === 'LETTER') {
        formatSetting = 'letter';
        pdfWidth = orientation === 'landscape' ? 792 : 612;
        pdfHeight = orientation === 'landscape' ? 612 : 792;
      }

      const pdf = new jsPDF({
        orientation,
        unit: 'pt',
        format: formatSetting,
      });

      const printableWidth = pdfWidth;
      const printableHeight = pdfHeight;
      const pageSliceHeightPx = Math.round(singlePageHeight * captureScale);
      const pageSliceWidthPx = Math.round(captureWidth * captureScale);

      // Slice canvas page by page directly so output matches visual page breaks with 100% precision
      for (let pageIdx = 0; pageIdx < totalPagesNeeded; pageIdx++) {
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = pageSliceWidthPx;
        pageCanvas.height = pageSliceHeightPx;
        const pageCtx = pageCanvas.getContext('2d');
        if (pageCtx) {
          pageCtx.fillStyle = '#ffffff';
          pageCtx.fillRect(0, 0, pageSliceWidthPx, pageSliceHeightPx);
          pageCtx.drawImage(
            canvas,
            0,
            pageIdx * pageSliceHeightPx,
            pageSliceWidthPx,
            pageSliceHeightPx,
            0,
            0,
            pageSliceWidthPx,
            pageSliceHeightPx
          );
        }

        const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95);
        if (pageIdx > 0) {
          pdf.addPage();
        }
        pdf.addImage(pageImgData, 'JPEG', 0, 0, printableWidth, printableHeight);
      }

      const rawName = pdfFileName.trim() ? pdfFileName.trim() : dashboardName.trim();
      const finalFileName = rawName.toLowerCase().endsWith('.pdf') ? rawName : `${rawName}.pdf`;
      pdf.save(finalFileName.replace(/\s+/g, '_'));
      notification.success({ message: 'Dashboard exported to PDF successfully!', placement: 'topRight' });
    } catch (error) {
      console.error('PDF export failed:', error);
      notification.error({ message: 'Failed to export dashboard to PDF', placement: 'topRight' });
    } finally {
      setZoomScale(originalScale);
      clearDashboardExportMode();
      setIsPdfLock(false); // Restore edits after capturing
      setExportingPdf(false);
    }
  };

  const handleLayoutChange = useCallback((layout: any) => {
    // CRITICAL: Do NOT update widget state during active drag or resize!
    if (isDraggingRef.current) return;
    setWidgets((prev) =>
      prev.map((w) => {
        const item = layout.find((l: any) => l.i === w.id);
        if (item) {
          const newX = item.x / 100;
          const newY = item.y;
          const newW = item.w / 100;
          const newH = item.h;
          if (w.x === newX && w.y === newY && w.w === newW && w.h === newH) return w;
          return { ...w, x: newX, y: newY, w: newW, h: newH };
        }
        return w;
      })
    );
  }, []);

  const handleDragStop = useCallback((layout: any) => {
    isDraggingRef.current = false;
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-dragging-widget');
    }
    if (layout && Array.isArray(layout)) {
      setWidgets((prev) =>
        prev.map((w) => {
          const item = layout.find((l: any) => l.i === w.id);
          if (item) {
            return { ...w, x: item.x / 100, y: item.y, w: item.w / 100, h: item.h };
          }
          return w;
        })
      );
    }
  }, []);

  const handleResizeStop = useCallback((layout: any) => {
    isDraggingRef.current = false;
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-dragging-widget');
    }
    if (layout && Array.isArray(layout)) {
      setWidgets((prev) =>
        prev.map((w) => {
          const item = layout.find((l: any) => l.i === w.id);
          if (item) {
            return { ...w, x: item.x / 100, y: item.y, w: item.w / 100, h: item.h };
          }
          return w;
        })
      );
    }
  }, []);

  const rglLayout = useMemo(() => {
    return widgets.map((w, idx) => {
      const rawX = Math.round((w.x || 0) * 100);
      const rawW = Math.round((w.w || 6) * 100);
      const clampedX = Math.max(0, Math.min(1199, rawX));
      const clampedW = Math.max(100, Math.min(1200 - clampedX, rawW));
      const safeY = (w.y === undefined || w.y === null || w.y === Infinity || isNaN(w.y))
        ? widgets.slice(0, idx).reduce((maxY, prevW) => Math.max(maxY, (prevW.y === Infinity || isNaN(prevW.y) ? 0 : (prevW.y || 0)) + (prevW.h || 300) + 16), 0)
        : w.y;
      return {
        i: w.id,
        x: clampedX,
        y: safeY,
        w: clampedW,
        h: w.h || 300,
        static: w.type === 'text' ? false : w.locked !== false,
      };
    });
  }, [widgets]);

  const rglLayouts = useMemo(() => ({
    lg: rglLayout,
    md: rglLayout,
    sm: rglLayout,
    xs: rglLayout,
    xxs: rglLayout,
  }), [rglLayout]);

  // Add text box
  const handleAddTextWidget = () => {
    const id = `text_${Date.now()}`;
    const textWidgetCount = widgets.filter(w => w.type === 'text').length + 1;
    const nextY = widgets.reduce((maxY, item) => Math.max(maxY, (item.y !== undefined && item.y !== Infinity && !isNaN(item.y) ? item.y : 0) + (item.h || 212) + 16), 0);
    const newWidget: CanvasWidget = {
      id,
      type: 'text',
      title: `Text Box ${textWidgetCount}`,
      content: '',
      x: (widgets.length * 4) % 12,
      y: nextY,
      w: 4,
      h: 212,
      locked: false,
    };
    setWidgets((prev) => [...prev, newWidget]);
    notification.success({ message: 'Added text box to screen', duration: 2 });
  };

  // Map workspace / layer addition
  const handleSelectMapWorkspace = async (mapId: string) => {
    setLoadingMapLayers(true);
    try {
      const res = await apiRequest(`/maps/${mapId}/`);
      if (!res.ok) throw new Error('Failed to fetch map details');
      const mapData = await res.json();

      if (mapData.name && (!mapConfigTitle || mapConfigTitle === 'Map')) {
        setMapConfigTitle(mapData.name.slice(0, 32));
      }

      const rawLayers = Array.isArray(mapData.layers) ? mapData.layers : [];
      if (rawLayers.length === 0) {
        notification.info({
          message: 'No layers in map',
          description: `"${mapData.name}" does not have any saved layers yet.`,
        });
        setMapConfigLayers([]);
        return;
      }

      const loadedLayers: MapLayer[] = rawLayers.map((l: any) => {
        const datasetId = l.layer_id || l.dataset_id || l.id;
        const name = l.name || datasetId;
        const isRaster = l.type === 'RASTER' || l.isRaster;
        const opacity = typeof l.opacity === 'number' ? l.opacity : (l.style_json?.opacity ?? 0.8);
        const visible = l.visible !== false;
        let color = '#3b82f6';
        if (l.style_json?.styles?.[0]?.config?.fillColor) {
          color = l.style_json.styles[0].config.fillColor;
        } else if (l.style_json?.fillColor) {
          color = l.style_json.fillColor;
        }

        return {
          datasetId,
          name,
          type: l.type || (isRaster ? 'RASTER' : 'VECTOR'),
          isRaster,
          opacity,
          visible,
          color,
        };
      });

      setMapConfigLayers(loadedLayers);
      notification.success({
        message: 'Map layers loaded',
        description: `Loaded ${loadedLayers.length} layer${loadedLayers.length > 1 ? 's' : ''} from "${mapData.name}".`,
        duration: 2.5
      });
    } catch (err) {
      console.error('Failed to load map layers:', err);
      notification.error({
        message: 'Failed to load map',
        description: 'Could not load layers from the selected map workspace.',
      });
    } finally {
      setLoadingMapLayers(false);
    }
  };

  const handleAddMapLayerOrMap = (value: string) => {
    setSelectedMapOrLayer(value);
    if (!value) return;

    if (value.startsWith('map:')) {
      const mapId = value.replace('map:', '');
      handleSelectMapWorkspace(mapId);
      return;
    }

    const vistaId = value.startsWith('dataset:') ? value.replace('dataset:', '') : value;
    const ds = availableDatasets.find((d) => d.id === vistaId);
    if (!ds) return;
    const name = ds.name;
    const styleObj = ds.style ? (typeof ds.style === 'string' ? JSON.parse(ds.style) : ds.style) : null;
    const isRaster = ds.data_type === 'RASTER';

    let color = '#3b82f6';
    if (styleObj?.fillColor) color = styleObj.fillColor;
    else if (styleObj?.strokeColor) color = styleObj.strokeColor;

    const newLayer: MapLayer = {
      datasetId: vistaId,
      name,
      opacity: 0.8,
      visible: true,
      color,
      isRaster,
    };
    setMapConfigLayers([newLayer]);
    if (!mapConfigTitle || mapConfigTitle === 'Map') {
      setMapConfigTitle(name.slice(0, 32));
    }
  };

  const handleConfirmMapWidget = () => {
    if (mapConfigLayers.length === 0) {
      notification.warning({ message: 'Add at least one layer to the map' });
      return;
    }
    const cleanTitle = mapConfigTitle.trim().slice(0, 32);
    if (!cleanTitle) {
      notification.warning({ message: 'Map title cannot be empty or contain only whitespace' });
      return;
    }
    const id = `map_${Date.now()}`;
    const nextY = widgets.reduce((maxY, item) => Math.max(maxY, (item.y !== undefined && item.y !== Infinity && !isNaN(item.y) ? item.y : 0) + (item.h || 436) + 16), 0);
    const newWidget: CanvasWidget = {
      id,
      type: 'map',
      title: cleanTitle,
      layers: mapConfigLayers,
      x: 0,
      y: nextY,
      w: 8,
      h: 436,
    };
    setWidgets((prev) => [...prev, newWidget]);
    setActivePanel(null);
    setMapConfigLayers([]);
    setSelectedMapOrLayer(null);
    setMapConfigTitle('Map');
    notification.success({ message: 'Added map widget to screen' });
  };



  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  };

  // GeoChart toolbar keys — these all open the geochart panel with a preset chart type
  const GEO_TOOLBAR_KEYS = ['pie', 'bar', 'line', 'area', 'scatter', 'donut', 'kpi', 'table', 'histogram', 'heatmap'];

  const handleToolbarClick = (panelKey: string) => {
    const isGeoKey = GEO_TOOLBAR_KEYS.includes(panelKey);
    const currentKey = isGeoKey ? `geo_${panelKey}` : panelKey;
    const prevKey = activePanel === 'geochart' ? `geo_${geoChartPresetType}` : activePanel;

    if (currentKey === prevKey) {
      setActivePanel(null);
      setGeoChartPresetType(null);
      return;
    }

    if (isGeoKey) {
      setGeoChartPresetType(panelKey);
      geoChartForm.resetFields();
      geoChartForm.setFieldValue('chartType', panelKey);
      setGeoChartLayerId(null);
      setGeoChartColumns([]);
      setActivePanel('geochart');
    } else {
      setGeoChartPresetType(null);
      setActivePanel(panelKey);
      if (panelKey === 'map') {
        fetchAvailableDatasets();
        fetchAvailableMaps();
      }
    }
  };

  if (loading || !hydrated || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Loading Dashboard Workspace..." />
      </div>
    );
  }

  const getPluralChartLabel = (type: string | null) => {
    switch (type) {
      case 'bar': return 'Bar Charts';
      case 'line': return 'Line Charts';
      case 'area': return 'Area Charts';
      case 'pie': return 'Pie Charts';
      case 'donut': return 'Donut Charts';
      case 'scatter': return 'Scatter Plots';
      case 'kpi': return 'KPI Widgets';
      case 'table': return 'Data Tables';
      default: return 'Charts';
    }
  };

  const filteredCharts = geoChartPresetType
    ? savedCharts.filter((sc) => sc.chartType === geoChartPresetType)
    : savedCharts;
  return (
    <div className="h-screen h-[100dvh] w-screen w-[100dvw] flex flex-col overflow-hidden bg-gray-50">

      {/* Horizontal Navbar Header */}
      <header className="h-12 md:h-16 bg-white border-b border-gray-100 flex items-center justify-between px-3 md:px-6 z-30 shadow-sm shrink-0">
        {/* Left: Logo & Editable Title */}
        <div className="flex items-center gap-1.5 md:gap-3.5 min-w-0 flex-1 overflow-hidden">
          <div
            onClick={() => router.push('/dashboard/manage')}
            className="flex items-center gap-2 sm:gap-2.5 min-w-fit shrink-0 cursor-pointer hover:opacity-85 transition-opacity"
          >
            {/* Primary Logo (VistaBridge) */}
            {siteConfig.logo && (
              <img
                src={siteConfig.logo}
                alt="VistaBridge Logo"
                className="h-6 md:h-8 w-auto object-contain shrink-0"
              />
            )}

            {/* Custom Product Logo (shown next to the VistaBridge logo if present) */}
            {customLogo && (
              <>
                <div className="h-4 sm:h-5 w-[1px] bg-gray-200" />
                <img
                  src={customLogo}
                  alt="Custom Product Logo"
                  className="h-6 md:h-8 max-w-[80px] sm:max-w-[110px] object-contain flex shrink-0 rounded"
                />
              </>
            )}
          </div>

          {/* Divider */}
          <Divider type="vertical" className="h-5 sm:h-6 bg-gray-200 !m-0 shrink-0" />

          {/* Dashboard name + edit btn */}
          <div className="flex items-center gap-1 md:gap-2 min-w-0 overflow-hidden">
            <Title
              level={5}
              className="!m-0 truncate font-extrabold text-xs md:text-sm text-gray-800 leading-tight cursor-pointer hover:text-primary transition-colors"
              onClick={() => {
                setNewName(dashboardName);
                setRenameModalOpen(true);
              }}
            >
              {dashboardName}
            </Title>
            {!isEditingPrintLayout && (
              <Tooltip title="Rename Dashboard">
                <Button
                  type="text"
                  size="small"
                  icon={<Edit2 size={12} className="text-gray-400 hover:text-gray-600 transition-colors" />}
                  onClick={() => {
                    setNewName(dashboardName);
                    setRenameModalOpen(true);
                  }}
                  className="flex items-center justify-center rounded-md shrink-0"
                  style={{ width: 22, height: 22 }}
                />
              </Tooltip>
            )}
          </div>

          {/* Visibility tag */}
          <Tag
            color={isPublic ? 'green' : 'orange'}
            className="text-[8px] md:text-[10px] font-bold uppercase tracking-wider rounded px-1.5 md:px-2.5 py-0.5 border-none cursor-pointer shrink-0"
            onClick={() => setIsShareModalOpen(true)}
          >
            {isPublic ? 'PUBLIC' : 'PRIVATE'}
          </Tag>
        </div>

        {/* Right Section: actions — compacted on mobile */}
        <div className="flex items-center gap-0.5 md:gap-2 shrink-0">
          {/* Share */}
          <Tooltip title="Share Dashboard">
            <Button
              type="text"
              icon={<Share2 size={16} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => setIsShareModalOpen(true)}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 34, height: 34 }}
            />
          </Tooltip>

          {/* Save — hidden when editing print layout */}
          {!isEditingPrintLayout && (
            <Tooltip title="Save Changes">
              <Button
                type="text"
                icon={<Save size={16} className="text-gray-500 hover:text-primary transition-colors" />}
                onClick={handleSaveDashboard}
                loading={saving}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 34, height: 34 }}
              />
            </Tooltip>
          )}

          {/* PDF Export — available on all screen sizes */}
          {popoverOpen && isMobile && (
            <div
              className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-200"
              onClick={() => setPopoverOpen(false)}
            />
          )}
          <Popover
            open={popoverOpen}
            onOpenChange={(v) => setPopoverOpen(v)}
            content={
              <div className="p-2 flex flex-col gap-3.5" style={{ width: 'min(320px, 85vw)' }}>
                <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="font-extrabold text-xs text-gray-800 flex items-center gap-1.5 uppercase tracking-wider">
                    <Printer size={14} className="text-primary" style={{ color: themePrimary }} />
                    Export PDF Options
                  </span>
                </div>

                {/* File Name input */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">File Name</label>
                  <Input
                    value={pdfFileName}
                    onChange={(e) => setPdfFileName(e.target.value)}
                    placeholder="Enter PDF filename"
                    className="rounded-lg text-xs h-8 font-medium"
                  />
                </div>

                {/* Page Size Selection */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Page Format</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        key: 'A4',
                        label: 'A4',
                        icon: (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5 inline-block align-middle">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        )
                      },
                      {
                        key: 'A3',
                        label: 'A3',
                        icon: (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5 inline-block align-middle">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        )
                      },
                      {
                        key: 'LETTER',
                        label: 'Letter',
                        icon: (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5 inline-block align-middle">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                          </svg>
                        )
                      },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPageSize(opt.key as any)}
                        className={`font-bold text-[10px] py-1.5 rounded-md border cursor-pointer transition-all text-center flex items-center justify-center ${pageSize === opt.key
                          ? 'bg-primary text-white border-primary shadow-2xs font-extrabold'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}
                        style={{
                          backgroundColor: pageSize === opt.key ? themePrimary : undefined,
                          borderColor: pageSize === opt.key ? themePrimary : undefined,
                        }}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Orientation (Landscape / Portrait) */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Orientation</label>
                  <div className="flex gap-1.5">
                    {[
                      {
                        key: 'landscape',
                        label: 'Landscape',
                        icon: (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5 inline-block align-middle">
                            <rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect>
                          </svg>
                        )
                      },
                      {
                        key: 'portrait',
                        label: 'Portrait',
                        icon: (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="mr-1.5 inline-block align-middle">
                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                          </svg>
                        )
                      },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setOrientation(opt.key as any)}
                        className={`flex-1 font-bold text-[10px] py-1.5 rounded-md border cursor-pointer transition-all hover:bg-gray-50 flex items-center justify-center ${orientation === opt.key
                          ? 'bg-primary text-white border-primary shadow-2xs font-extrabold'
                          : 'bg-white text-gray-600 border-gray-200'
                          }`}
                        style={{
                          backgroundColor: orientation === opt.key ? themePrimary : undefined,
                          borderColor: orientation === opt.key ? themePrimary : undefined,
                        }}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quality selection */}
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Quality</label>
                  <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
                    {[
                      { key: 'high', label: 'High (2x)' },
                      { key: 'ultra', label: 'Ultra HD' },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setPdfQuality(opt.key as any)}
                        className={`flex-1 font-bold text-[10px] py-1 rounded-md border-none transition-all cursor-pointer ${pdfQuality === opt.key ? 'bg-white text-gray-900 shadow-2xs font-extrabold' : 'text-gray-500 hover:text-gray-800'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edit & Arrange Layout */}
                <div className="flex flex-col gap-2 mt-1">
                  <Button
                    type="primary"
                    onClick={() => {
                      setPrePrintWidgetsBackup(JSON.parse(JSON.stringify(widgets)));
                      const adjusted = adjustWidgetsForPageFooters(widgets, singlePageHeight);
                      setWidgets(adjusted);
                      setIsEditingPrintLayout(true);
                      setPopoverOpen(false);
                      notification.info({
                        message: 'Print Layout Sandbox Mode',
                        description: 'Arrange cloned widgets across paper sheets. Click "Download PDF" when finished.',
                        placement: 'topRight'
                      });
                    }}
                    className="w-full rounded-lg font-bold bg-primary border-none text-xs h-9 flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                    style={{ backgroundColor: themePrimary }}
                  >
                    <Edit2 size={14} />
                    Edit & Arrange Layout →
                  </Button>
                </div>
              </div>
            }
            trigger="click"
            placement="bottomRight"
          >
            <Tooltip title="Export to PDF">
              <Button
                type="text"
                icon={<Printer size={16} className="text-gray-500 hover:text-primary transition-colors" />}
                onClick={() => setPdfFileName(pdfFileName || dashboardName)}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 34, height: 34 }}
              />
            </Tooltip>
          </Popover>

          <Divider type="vertical" className="h-5 bg-gray-100 !m-0" />

          {/* Back */}
          <Tooltip title="Back to Manage">
            <Button
              type="text"
              icon={<ArrowLeft size={16} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => router.push('/dashboard/manage')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 34, height: 34 }}
            />
          </Tooltip>

        </div>
      </header>

      {/* Main Workspace Area: Left Controls + Grid Canvas + Right Vertical Toolbar + sliding panel */}
      <div className="flex-grow min-h-0 w-full flex overflow-hidden relative">

        {/* Left vertical controls bar — hidden on mobile */}
        <div className="hidden md:flex w-14 bg-white border-r border-gray-100 flex-col items-center py-4 gap-4 z-10 shadow-sm shrink-0">
          <Tooltip title="Zoom In" placement="right">
            <Button
              type="text"
              icon={<Plus size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => setZoomScale((s) => Math.min(2, s + 0.1))}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Zoom Out" placement="right">
            <Button
              type="text"
              icon={<Minus size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => setZoomScale((s) => Math.max(0.5, s - 0.1))}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Toggle Full Screen" placement="right">
            <Button
              type="text"
              icon={<Maximize size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={toggleFullScreen}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
        </div>

        {/* Central Dashboard canvas grid area (supports absolute overlay panels) */}
        <div className="flex-grow min-h-0 relative overflow-hidden bg-gray-50/40 flex flex-col">

          {/* Print Layout Mode Sub-Header Bar (Just below top header navbar) */}
          {isEditingPrintLayout && (
            <div className="bg-white border-b border-gray-200 px-3 md:px-6 py-2 md:py-2.5 flex items-center justify-between shrink-0 z-20 shadow-2xs overflow-hidden whitespace-nowrap flex-nowrap">
              <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
                {!isMobile && (
                  <div className="p-1.5 bg-primary/10 rounded-lg text-primary" style={{ color: themePrimary, backgroundColor: `${themePrimary}15` }}>
                    <Printer size={16} />
                  </div>
                )}
                <div className="flex items-center gap-1 md:gap-2">
                  <span className="bg-primary/10 font-bold px-1.5 md:px-2.5 rounded text-[10px] md:text-[11px] flex items-center gap-1 shrink-0 h-6" style={{ color: themePrimary, backgroundColor: `${themePrimary}15` }}>
                    <FileText size={isMobile ? 11 : 13} className="shrink-0" />
                    {pageSize} {isMobile ? orientation.slice(0, 4).toUpperCase() : orientation.toUpperCase()}
                  </span>
                  <Button
                    size="small"
                    type={showDate ? "primary" : "default"}
                    onClick={() => setShowDate(!showDate)}
                    className="font-bold text-[9px] md:text-[10px] h-6 px-1.5 md:px-2.5 rounded-md flex items-center gap-1 shadow-2xs transition-all cursor-pointer border"
                    style={{
                      backgroundColor: showDate ? themePrimary : '#fff',
                      borderColor: showDate ? themePrimary : '#d9d9d9',
                      color: showDate ? '#fff' : '#595959',
                    }}
                  >
                    <Calendar size={isMobile ? 11 : 13} className="shrink-0" />
                    {showDate ? (isMobile ? 'ON' : 'Date: ON') : (isMobile ? 'OFF' : 'Date: OFF')}
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 md:gap-3 shrink-0 ml-auto md:ml-4">
                <Button
                  onClick={() => {
                    if (prePrintWidgetsBackup) setWidgets(prePrintWidgetsBackup);
                    setIsEditingPrintLayout(false);
                  }}
                  className="rounded-xl font-bold border-gray-300 text-gray-700 hover:bg-gray-100 h-9 px-2 md:px-4 flex items-center gap-1 cursor-pointer text-[10px] md:text-xs"
                >
                  <ArrowLeft size={14} />
                  {isMobile ? 'Exit' : 'Exit Layout'}
                </Button>

                {isMobile ? (
                  <Button
                    type="primary"
                    loading={exportingPdf}
                    onClick={async () => {
                      await handleExportPDF();
                    }}
                    className="flex items-center justify-center rounded-xl font-bold bg-primary text-white border-none h-9 w-9 cursor-pointer shrink-0"
                    style={{ backgroundColor: themePrimary }}
                    icon={<Printer size={16} />}
                  />
                ) : (
                  <Button
                    type="primary"
                    loading={exportingPdf}
                    onClick={async () => {
                      await handleExportPDF();
                    }}
                    className="rounded-xl font-bold bg-primary text-white border-none h-9 px-5 flex items-center gap-1.5 shadow-sm cursor-pointer text-xs"
                    style={{ backgroundColor: themePrimary }}
                  >
                    <Printer size={14} />
                    Download PDF
                  </Button>
                )}
              </div>
            </div>
          )}
          {(() => {
            const showPaperMode = isEditingPrintLayout;

            return (
              <div className={`dashboard-scroll-container flex-grow min-h-0 overflow-x-hidden overflow-y-auto ${showPaperMode ? 'p-4 md:p-8 bg-gray-200/80' : 'p-3 md:p-6'}`}>
                <div
                  id="dashboard-canvas"
                  className={`origin-top transition-all duration-300 relative ${showPaperMode ? 'bg-white shadow-2xl rounded-none border border-gray-350 mx-auto' : 'origin-top-left w-full max-w-full overflow-x-hidden'}`}
                  style={{
                    transform: showPaperMode && isMobile ? undefined : `scale(${zoomScale})`,
                    width: showPaperMode ? (isLandscape ? '1150px' : '820px') : '100%',
                    maxWidth: '100%',
                    height: showPaperMode && totalCanvasHeightPx ? `${totalCanvasHeightPx}px` : undefined,
                    minWidth: showPaperMode ? (isLandscape ? 950 : 700) : undefined,
                    minHeight: showPaperMode ? `${singlePageHeight}px` : '100%',
                  }}
                >
                  {/* Page background guide sheets (rendered behind widgets) */}
                  {showPaperMode &&
                    Array.from({ length: totalPagesNeeded }).map((_, idx) => {
                      const pageTop = idx * singlePageHeight;
                      return (
                        <div
                          key={`page-sheet-${idx}`}
                          className="absolute left-0 right-0 bg-transparent border-b border-gray-200 pointer-events-none z-20"
                          style={{
                            top: `${pageTop}px`,
                            height: `${singlePageHeight}px`,
                          }}
                        >
                          {/* Footer */}
                          <div
                            className="absolute left-8 right-8 flex items-center justify-between border-t border-gray-150 pt-2.5 z-20"
                            style={{ bottom: '24px', height: '30px' }}
                          >
                            <div className="flex items-center gap-2 min-w-[200px]">
                              <img src="/vblogo.png" alt="Logo" className="h-5 w-auto object-contain" />
                              <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">
                                Rotten Grapes Private Limited
                              </span>
                            </div>

                            {showDate && (
                              <div className="absolute left-1/2 -translate-x-1/2 text-[9px] text-gray-400 font-semibold tracking-wider uppercase">
                                {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                              </div>
                            )}

                            <span className="font-bold text-[9px] text-gray-455 uppercase tracking-widest min-w-[100px] text-right">
                              Page {idx + 1} of {totalPagesNeeded}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                  {/* Visual Page Break Lines */}
                  {showPaperMode &&
                    !isPdfLock &&
                    Array.from({ length: totalPagesNeeded - 1 }).map((_, idx) => {
                      const pageBreakTop = (idx + 1) * singlePageHeight;
                      return (
                        <div
                          key={`break-${idx}`}
                          className="absolute left-0 right-0 border-b-2 border-dashed border-red-400/80 pointer-events-none z-30 flex items-center justify-between px-6 h-0"
                          style={{ top: `${pageBreakTop}px` }}
                        >
                          <span className="bg-red-500 text-white font-extrabold text-[10px] px-2.5 py-0.5 rounded-full shadow-xs uppercase tracking-wider -translate-y-1/2">
                            ✂️ Page {idx + 1} End / Page Break
                          </span>
                          <span className="bg-red-500 text-white font-extrabold text-[10px] px-2.5 py-0.5 rounded-full shadow-xs uppercase tracking-wider -translate-y-1/2">
                            Page {idx + 2} Starts Below ↓
                          </span>
                        </div>
                      );
                    })}

                  {widgets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[440px] md:min-h-[500px] py-14 md:py-24 px-4 sm:px-6 text-center select-none relative w-full animate-in fade-in duration-500">
                      {/* Centered Guidance Content */}
                      <div className="max-w-md mx-auto flex flex-col items-center relative z-10 w-full">
                        <div className="w-13 h-13 md:w-14 md:h-14 rounded-2xl bg-blue-50/90 text-primary border border-blue-100 flex items-center justify-center mb-3 md:mb-4 shadow-xs">
                          <LayoutDashboard size={26} className="stroke-[1.8]" />
                        </div>

                        <div className="relative inline-flex items-center justify-center">
                          <h3 className="text-xl sm:text-2xl font-bold text-gray-800 tracking-tight mb-2 sm:mb-2.5 text-center leading-snug">
                            Start Building Your Dashboard
                          </h3>

                          {/* Laptop & Larger Screens only (hidden on tablet/mobile) curvy arrow pointing towards the right toolbar */}
                          <div className="hidden lg:block absolute left-full ml-4 -top-3 pointer-events-none w-[220px] xl:w-[280px] h-[50px]">
                            <svg
                              viewBox="0 0 260 50"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                              className="w-full h-auto overflow-visible drop-shadow-xs"
                            >
                              <defs>
                                <marker
                                  id="dashboard-curvy-arrow"
                                  viewBox="0 0 10 10"
                                  refX="6"
                                  refY="5"
                                  markerWidth="8"
                                  markerHeight="8"
                                  orient="auto"
                                >
                                  <path d="M 1 2 L 8 5 L 1 8 Z" fill="#0284c7" />
                                </marker>
                              </defs>
                              <path
                                d="M 4 34 C 60 48, 130 46, 185 28 C 215 18, 238 14, 252 14"
                                stroke="#0284c7"
                                strokeWidth="2.5"
                                strokeDasharray="6 4"
                                strokeLinecap="round"
                                markerEnd="url(#dashboard-curvy-arrow)"
                              />
                            </svg>
                          </div>
                        </div>

                        <p className="text-xs sm:text-sm text-gray-500 leading-relaxed max-w-xs sm:max-w-sm px-2">
                          {isMobile
                            ? 'Your canvas is currently blank. Select any widget or tool from the bottom toolbar to start drawing.'
                            : 'Your canvas is currently blank. Select any widget or tool from the panel on the right side to start drawing on the canvas.'}
                        </p>
                      </div>
                    </div>
                  ) : showPaperMode ? (
                    <DndContext sensors={sensors} onDragEnd={handlePrintDragEnd}>
                      <div className="relative w-full h-full min-h-[500px] z-10">
                        {widgets.map((widget) => (
                          <DraggableWidget
                            key={widget.id}
                            widget={widget}
                            isPdfLock={isPdfLock}
                            startResize={startResize}
                          >
                            <PrintableWidgetInner
                              widget={widget}
                              isPdfLock={isPdfLock}
                              publish={publish}
                              setWidgets={setWidgets}
                            />
                          </DraggableWidget>
                        ))}
                      </div>
                    </DndContext>
                  ) : (
                    <ResponsiveGridLayout
                      layouts={rglLayouts}
                      breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                      cols={{ lg: 1200, md: 1200, sm: 1200, xs: 1200, xxs: 1200 }}
                      rowHeight={1}
                      margin={[0, 0]}
                      bounded={true}
                      isDraggable={!isPdfLock && !isMobile}
                      isResizable={!isPdfLock && !isMobile}
                      draggableHandle=".drag-handle"
                      draggableCancel=".no-drag, button, input, textarea, select, .ant-popover, .ant-select"
                      onDragStart={() => {
                        isDraggingRef.current = true;
                        if (typeof document !== 'undefined') {
                          document.body.classList.add('is-dragging-widget');
                        }
                      }}
                      onDragStop={(layout: any) => {
                        isDraggingRef.current = false;
                        if (typeof document !== 'undefined') {
                          document.body.classList.remove('is-dragging-widget');
                        }
                        handleDragStop(layout);
                      }}
                      onResizeStart={() => {
                        isDraggingRef.current = true;
                        if (typeof document !== 'undefined') {
                          document.body.classList.add('is-dragging-widget');
                        }
                      }}
                      onResizeStop={(layout: any) => {
                        isDraggingRef.current = false;
                        if (typeof document !== 'undefined') {
                          document.body.classList.remove('is-dragging-widget');
                        }
                        handleResizeStop(layout);
                      }}
                      onLayoutChange={handleLayoutChange}
                      resizeHandles={['se']}
                      style={{ minHeight: '100%' }}
                    >
                      {widgets.map((widget) => (
                        <div key={widget.id} className="p-1.5">
                          <div
                            className={`w-full h-full flex flex-col overflow-hidden relative ${widget.type === 'text' ? 'drag-handle cursor-grab active:cursor-grabbing' : 'bg-white border border-gray-200 shadow-sm rounded-2xl'
                              }`}
                            style={{
                              backgroundColor: widget.type === 'text'
                                ? (widget.isTransparent ? 'transparent' : (widget.bgColor || '#ffffff'))
                                : '#ffffff',
                              color: widget.type === 'text' ? (widget.textColor || '#1f2937') : 'inherit',
                              border: widget.type === 'text'
                                ? `${widget.borderWidth !== undefined ? widget.borderWidth : 1}px ${(widget.borderWidth !== undefined ? widget.borderWidth : 1) > 0 ? 'solid' : 'none'
                                } ${widget.borderColor || '#e5e7eb'}`
                              : undefined,
                              borderRadius: widget.type === 'text'
                                ? `${widget.borderRadius !== undefined ? widget.borderRadius : 16}px`
                                : undefined,
                              boxShadow: widget.type === 'text' && widget.isTransparent ? 'none' : '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                            }}
                          >
                            {/* Floating Delete button for Text widgets (since they don't have a header) */}
                            {widget.type === 'text' && !isPdfLock && (
                              <button
                                className="absolute top-2.5 right-2.5 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors z-30 bg-white/95 backdrop-blur-sm border border-gray-150 shadow-sm pointer-events-auto no-drag"
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                onTouchStart={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
                                }}
                              >
                                <Trash2 size={14} className="pointer-events-none" />
                              </button>
                            )}

                            {/* Widget header (always editable except for text boxes) */}
                            {widget.type !== 'text' && (() => {
                              const isLocked = widget.locked !== false;
                              return (
                                <div
                                  className="flex items-center justify-between px-3 py-2 border-b border-gray-100 rounded-t-2xl shrink-0 bg-white relative z-20"
                                >
                                  <div
                                    className={`flex items-center gap-2 min-w-0 flex-grow ${!isLocked
                                      ? 'drag-handle cursor-grab active:cursor-grabbing'
                                      : 'cursor-default'
                                      }`}
                                  >
                                    {!isPdfLock && !isLocked && (
                                      <div className="flex flex-col gap-[3px] shrink-0">
                                        {[0, 1, 2].map((i) => (
                                          <div key={i} className="flex gap-[3px]">
                                            <div className="w-[3px] h-[3px] rounded-full bg-gray-300" />
                                            <div className="w-[3px] h-[3px] rounded-full bg-gray-300" />
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <span className="text-[12px] font-bold text-gray-700 truncate">{widget.title}</span>
                                  </div>

                                  {!isPdfLock && (
                                    <div
                                      className="flex items-center gap-1 shrink-0 pointer-events-auto no-drag"
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onTouchStart={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {/* Lock / Unlock toggle for all widgets/charts */}
                                      <button
                                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors no-drag ${isLocked
                                          ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100 font-semibold'
                                          : 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
                                          }`}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onTouchStart={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          isDraggingRef.current = false;
                                          if (typeof document !== 'undefined') {
                                            document.body.classList.remove('is-dragging-widget');
                                          }
                                          setWidgets((prev) =>
                                            prev.map((w) =>
                                              w.id === widget.id ? { ...w, locked: !isLocked } : w
                                            )
                                          );
                                        }}
                                        title={isLocked ? 'Unlock widget (enable drag/resize)' : 'Lock widget (disable drag/resize)'}
                                      >
                                        {isLocked ? <Lock size={14} className="pointer-events-none" /> : <Unlock size={14} className="pointer-events-none" />}
                                      </button>

                                      {widget.type === 'map' && (
                                        /* Zoom-to-fit (map only) */
                                        <button
                                          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                          onTouchEnd={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            publish({ type: 'zoom_map_widget', widgetId: widget.id });
                                          }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            publish({ type: 'zoom_map_widget', widgetId: widget.id });
                                          }}
                                          title="Zoom to fit all layers"
                                        >
                                          <Eye size={14} className="pointer-events-none" />
                                        </button>
                                      )}

                                      {widget.type === 'geochart' && widget.geoChartConfig &&
                                        !['kpi', 'table'].includes(widget.geoChartConfig.chartType) && (
                                          <Popover
                                            trigger="click"
                                            placement="bottomRight"
                                            content={
                                              <div className="w-80 p-1">
                                                <div className="mb-2.5 font-bold text-xs text-gray-800 flex items-center gap-1.5 border-b border-gray-100 pb-1.5">
                                                  <Palette size={14} className="text-indigo-600" />
                                                  <span>Customize Chart Colors</span>
                                                </div>
                                                <ChartThemePicker
                                                  compact
                                                  chartType={widget.geoChartConfig.chartType}
                                                  value={{
                                                    colorTheme: widget.geoChartConfig.colorTheme,
                                                    customColors: widget.geoChartConfig.customColors,
                                                    primaryColor: widget.geoChartConfig.primaryColor,
                                                    colorMode: widget.geoChartConfig.colorMode,
                                                    categoryColors: widget.geoChartConfig.categoryColors,
                                                  }}
                                                  onChange={(newTheme) => {
                                                    setWidgets((prev) =>
                                                      prev.map((w) =>
                                                        w.id === widget.id
                                                          ? {
                                                            ...w,
                                                            geoChartConfig: {
                                                              ...w.geoChartConfig!,
                                                              colorTheme: newTheme.colorTheme,
                                                              customColors: newTheme.customColors,
                                                              primaryColor: newTheme.primaryColor,
                                                              colorMode: newTheme.colorMode,
                                                              categoryColors: newTheme.categoryColors,
                                                            },
                                                          }
                                                          : w
                                                      )
                                                    );
                                                  }}
                                                />
                                              </div>
                                            }
                                          >
                                            <button
                                              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                                              title="Customize Chart Colors"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              <Palette size={14} className="pointer-events-none" />
                                            </button>
                                          </Popover>
                                        )}

                                      <button
                                        className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                        onTouchEnd={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
                                        }}
                                      >
                                        <Trash2 size={14} className="pointer-events-none" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Widget content */}
                            {widget.type === 'text' ? (
                              <div
                                id={`text-measure-${widget.id}`}
                                className="w-full overflow-hidden text-sm pl-4 pr-10 py-3 break-words rich-content pointer-events-none"
                                style={{ color: widget.textColor || '#1f2937' }}
                                dangerouslySetInnerHTML={{ __html: widget.content || '' }}
                              />
                            ) : (
                              <div
                                className="dashboard-widget-content flex-grow min-h-0 p-2 relative flex flex-col"
                                style={{ overflow: 'hidden' }}
                              >
                                {widget.type === 'map' ? (
                                  <MapWidget widgetId={widget.id} title={widget.title} layers={widget.layers ?? []} />
                                ) : widget.geoChartConfig ? (
                                  <GeoChartWidget widgetId={widget.id} config={widget.geoChartConfig} />
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </ResponsiveGridLayout>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Absolute Sliding panel overlay — desktop: right side rail, mobile: bottom sheet */}
          {activePanel && (
            <div
              className={isMobile
                ? 'absolute inset-x-0 bottom-0 h-[60vh] bg-white border-t border-gray-200 shadow-2xl z-40 flex flex-col rounded-t-2xl'
                : 'absolute right-0 top-0 h-full w-[24%] min-w-[280px] bg-white border-l border-gray-100 shadow-xl z-20 flex flex-col transition-all duration-300'
              }
            >
              {/* Mobile drag handle pill */}
              {isMobile && <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-2.5 mb-1 shrink-0" />}

              {/* Sliding panel header */}
              <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
                <span className="text-[12px] font-bold text-gray-700 uppercase tracking-wider">
                  {activePanel === 'text' && 'Add Text Note'}
                  {activePanel === 'map' && 'Configure Map Widget'}
                  {activePanel === 'geochart' && `Add ${GEO_CHART_TYPES.find(c => c.key === geoChartPresetType)?.label ?? 'Chart'}`}
                </span>
                <Button
                  type="text"
                  size="small"
                  icon={<X size={14} className="text-gray-400" />}
                  onClick={() => { setActivePanel(null); setGeoChartPresetType(null); }}
                  className="flex items-center justify-center hover:bg-gray-100 rounded-lg"
                  style={{ width: 24, height: 24 }}
                />
              </div>

              {/* Sliding panel contents */}
              <div className="flex-grow overflow-y-auto p-4 bg-white">

                {/* Text Widget add action */}
                {activePanel === 'text' && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 pb-3 border-b border-gray-100">
                      <div className="text-xs text-gray-500">Insert a rich text box widget onto the canvas to add titles, markdown formatting, or descriptions.</div>
                      <Button
                        type="primary"
                        icon={<FileText size={14} />}
                        onClick={handleAddTextWidget}
                        className="w-full rounded-xl font-bold bg-primary border-none text-[11px] h-9 flex items-center justify-center gap-1.5 shadow-sm"
                        style={{ backgroundColor: themePrimary }}
                      >
                        Add Text Box
                      </Button>
                    </div>

                    {/* Show created text boxes below it */}
                    {widgets.filter((w) => w.type === 'text').length > 0 && (
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Created Text Boxes</label>
                        <div className="flex flex-col gap-2">
                          {widgets.filter((w) => w.type === 'text').map((w) => (
                            <div key={w.id} className="bg-white border border-gray-250 rounded-xl p-2.5 flex flex-col gap-2 shadow-xs hover:border-gray-300 transition-colors">
                              {/* Header Row: Grab Handle, Small Name, Style Popover, Delete */}
                              <div className="flex items-center justify-between gap-1.5 border-b border-gray-100 pb-1.5">
                                <div className="flex items-center gap-1.5 min-w-0 flex-grow">
                                  {/* Grab Handle */}
                                  <div className="flex flex-col gap-[1.5px] shrink-0 text-gray-300">
                                    <div className="flex gap-[1.5px]">
                                      <div className="w-[2px] h-[2px] rounded-full bg-current" />
                                      <div className="w-[2px] h-[2px] rounded-full bg-current" />
                                    </div>
                                    <div className="flex gap-[1.5px]">
                                      <div className="w-[2px] h-[2px] rounded-full bg-current" />
                                      <div className="w-[2px] h-[2px] rounded-full bg-current" />
                                    </div>
                                    <div className="flex gap-[1.5px]">
                                      <div className="w-[2px] h-[2px] rounded-full bg-current" />
                                      <div className="w-[2px] h-[2px] rounded-full bg-current" />
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-extrabold text-gray-400 uppercase tracking-wider shrink-0">Name:</span>
                                  <Input
                                    value={w.title}
                                    maxLength={32}
                                    onChange={(e) => {
                                      const val = e.target.value.slice(0, 32);
                                      setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, title: val } : x));
                                    }}
                                    className="font-bold text-[10px] text-gray-700 bg-transparent border-none p-0 focus:bg-white focus:px-1 h-5 rounded hover:bg-gray-50 flex-grow truncate min-w-0"
                                  />
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {/* Style Popover */}
                                  <Popover
                                    content={
                                      <div className="flex flex-col gap-3 p-1 min-w-[210px]">
                                        <div className="flex items-center gap-1.5 border-b border-gray-100 pb-2">
                                          <Paintbrush size={11} className="text-gray-400" />
                                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Card Properties</span>
                                        </div>

                                        <div className="flex flex-col gap-2.5">
                                          {/* Background Picker with Transparency Option */}
                                          <div className="flex flex-col gap-1.5">
                                            <span className="text-[10px] text-gray-500 font-semibold block">Background:</span>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              {/* Transparent Swatch Option */}
                                              <button
                                                type="button"
                                                title="Transparent Background"
                                                onClick={() => {
                                                  setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, isTransparent: true } : x));
                                                }}
                                                className={`w-3.5 h-3.5 rounded-full border border-gray-300 cursor-pointer relative transition-all hover:scale-110 flex items-center justify-center overflow-hidden bg-white shrink-0 ${w.isTransparent ? 'ring-2 ring-primary ring-offset-0.5 scale-105 shadow-sm' : ''
                                                  }`}
                                              >
                                                {/* Red slash diagonal pattern */}
                                                <div className="w-[1.5px] h-full bg-red-500 rotate-45 absolute" />
                                              </button>

                                              {/* Preset Colors */}
                                              {[
                                                { hex: '#ffffff', name: 'White' },
                                                { hex: '#f8fafc', name: 'Slate' },
                                                { hex: '#fdfbf7', name: 'Cream' },
                                                { hex: '#eff6ff', name: 'Sky' },
                                                { hex: '#f0fdf4', name: 'Mint' },
                                                { hex: '#fffbeb', name: 'Honey' },
                                                { hex: '#fff1f2', name: 'Rose' },
                                                { hex: '#1e293b', name: 'Charcoal' }
                                              ].map((c) => (
                                                <button
                                                  key={c.hex}
                                                  type="button"
                                                  title={c.name}
                                                  onClick={() => {
                                                    setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, isTransparent: false, bgColor: c.hex } : x));
                                                  }}
                                                  className={`w-3.5 h-3.5 rounded-full border border-gray-200 cursor-pointer transition-all hover:scale-110 relative shrink-0 ${(!w.isTransparent && (w.bgColor || '#ffffff') === c.hex) ? 'ring-2 ring-primary ring-offset-0.5 scale-105' : ''
                                                    }`}
                                                  style={{ backgroundColor: c.hex }}
                                                />
                                              ))}

                                              {/* Custom Picker */}
                                              <div className="relative w-3.5 h-3.5 rounded-full border border-gray-200 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer hover:scale-110">
                                                <input
                                                  type="color"
                                                  value={w.bgColor || '#ffffff'}
                                                  onChange={(e) => {
                                                    const val = e.target.value;
                                                    setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, isTransparent: false, bgColor: val } : x));
                                                  }}
                                                  style={{
                                                    width: 24,
                                                    height: 24,
                                                    border: 'none',
                                                    padding: 0,
                                                    cursor: 'pointer',
                                                    position: 'absolute',
                                                    transform: 'scale(1.5)'
                                                  }}
                                                />
                                              </div>
                                            </div>
                                          </div>

                                          {/* Divider */}
                                          <div className="border-t border-gray-100 my-1" />

                                          {/* Text Color Picker */}
                                          <div className="flex flex-col gap-1.5">
                                            <span className="text-[10px] text-gray-500 font-semibold block">Text Color:</span>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              {[
                                                { hex: '#1f2937', name: 'Charcoal' },
                                                { hex: '#64748b', name: 'Slate' },
                                                { hex: '#1e3a8a', name: 'Blue' },
                                                { hex: '#064e3b', name: 'Green' },
                                                { hex: '#7f1d1d', name: 'Red' },
                                                { hex: '#581c87', name: 'Purple' },
                                                { hex: '#ffffff', name: 'White' }
                                              ].map((c) => (
                                                <button
                                                  key={c.hex}
                                                  type="button"
                                                  title={c.name}
                                                  onClick={() => {
                                                    setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, textColor: c.hex } : x));
                                                  }}
                                                  className={`w-3.5 h-3.5 rounded-full border border-gray-200 cursor-pointer transition-all hover:scale-110 relative shrink-0 ${(w.textColor || '#1f2937') === c.hex ? 'ring-2 ring-primary ring-offset-0.5 scale-105' : ''
                                                    }`}
                                                  style={{ backgroundColor: c.hex }}
                                                />
                                              ))}
                                              {/* Custom Picker */}
                                              <div className="relative w-3.5 h-3.5 rounded-full border border-gray-200 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer hover:scale-110">
                                                <input
                                                  type="color"
                                                  value={w.textColor || '#1f2937'}
                                                  onChange={(e) => {
                                                    const val = e.target.value;
                                                    setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, textColor: val } : x));
                                                  }}
                                                  style={{
                                                    width: 24,
                                                    height: 24,
                                                    border: 'none',
                                                    padding: 0,
                                                    cursor: 'pointer',
                                                    position: 'absolute',
                                                    transform: 'scale(1.5)'
                                                  }}
                                                />
                                              </div>
                                            </div>
                                          </div>

                                          {/* Divider */}
                                          <div className="border-t border-gray-100 my-1" />

                                          {/* Border Configuration */}
                                          <div className="flex flex-col gap-2.5">
                                            <div className="flex items-center justify-between gap-4">
                                              <span className="text-[10px] text-gray-500 font-semibold">Border Width:</span>
                                              <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-md p-0.5 shadow-xs">
                                                {[0, 1, 2].map((width) => (
                                                  <button
                                                    key={width}
                                                    type="button"
                                                    onClick={() => {
                                                      setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, borderWidth: width } : x));
                                                    }}
                                                    className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all border-none ${(w.borderWidth !== undefined ? w.borderWidth : 1) === width
                                                      ? 'bg-primary text-white shadow-xs'
                                                      : 'bg-white text-gray-550 hover:bg-gray-50'
                                                      }`}
                                                    style={{
                                                      backgroundColor: (w.borderWidth !== undefined ? w.borderWidth : 1) === width ? themePrimary : undefined,
                                                    }}
                                                  >
                                                    {width}px
                                                  </button>
                                                ))}
                                              </div>
                                            </div>

                                            {(w.borderWidth === undefined || w.borderWidth > 0) && (
                                              <div className="flex flex-col gap-1.5">
                                                <span className="text-[10px] text-gray-500 font-semibold">Border Color:</span>
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                  {[
                                                    { hex: '#e5e7eb', name: 'Light Gray' },
                                                    { hex: '#d1d5db', name: 'Muted Gray' },
                                                    { hex: '#9ca3af', name: 'Gray' },
                                                    { hex: '#3b82f6', name: 'Blue' },
                                                    { hex: '#10b981', name: 'Green' },
                                                    { hex: '#ef4444', name: 'Red' },
                                                    { hex: '#1e293b', name: 'Charcoal' }
                                                  ].map((c) => (
                                                    <button
                                                      key={c.hex}
                                                      type="button"
                                                      title={c.name}
                                                      onClick={() => {
                                                        setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, borderColor: c.hex } : x));
                                                      }}
                                                      className={`w-3.5 h-3.5 rounded-full border border-gray-200 cursor-pointer transition-all hover:scale-110 relative shrink-0 ${(w.borderColor || '#e5e7eb') === c.hex ? 'ring-1.5 ring-primary ring-offset-0.5 scale-105' : ''
                                                        }`}
                                                      style={{ backgroundColor: c.hex }}
                                                    />
                                                  ))}
                                                  {/* Custom Border Color */}
                                                  <div className="relative w-3.5 h-3.5 rounded-full border border-gray-250 overflow-hidden flex items-center justify-center shrink-0 cursor-pointer hover:scale-110">
                                                    <input
                                                      type="color"
                                                      value={w.borderColor || '#e5e7eb'}
                                                      onChange={(e) => {
                                                        const val = e.target.value;
                                                        setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, borderColor: val } : x));
                                                      }}
                                                      style={{
                                                        width: 24,
                                                        height: 24,
                                                        border: 'none',
                                                        padding: 0,
                                                        cursor: 'pointer',
                                                        position: 'absolute',
                                                        transform: 'scale(1.5)'
                                                      }}
                                                    />
                                                  </div>
                                                </div>
                                              </div>
                                            )}

                                            {/* Border Radius row */}
                                            <div className="flex items-center justify-between mt-1">
                                              <span className="text-[10px] text-gray-500 font-semibold">Corners:</span>
                                              <div className="flex items-center gap-1 bg-white border border-gray-250 rounded-md p-0.5 shadow-xs">
                                                {[
                                                  { val: 0, name: 'Sharp' },
                                                  { val: 8, name: 'Medium' },
                                                  { val: 16, name: 'Rounded' }
                                                ].map((rad) => (
                                                  <button
                                                    key={rad.val}
                                                    type="button"
                                                    onClick={() => {
                                                      setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, borderRadius: rad.val } : x));
                                                    }}
                                                    className={`text-[9px] px-2 py-0.5 rounded font-bold border-none transition-all ${(w.borderRadius !== undefined ? w.borderRadius : 16) === rad.val
                                                      ? 'bg-primary text-white shadow-xs'
                                                      : 'bg-white text-gray-550 hover:bg-gray-50'
                                                      }`}
                                                    style={{
                                                      backgroundColor: (w.borderRadius !== undefined ? w.borderRadius : 16) === rad.val ? themePrimary : undefined,
                                                    }}
                                                  >
                                                    {rad.name}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    }
                                    trigger="click"
                                    placement="bottom"
                                  >
                                    <Tooltip title="Style Card">
                                      <Button
                                        size="small"
                                        type="text"
                                        icon={<Paintbrush size={11} className="text-gray-500 hover:text-primary transition-colors" />}
                                        className="flex items-center justify-center w-5.5 h-5.5 hover:bg-gray-100 rounded-md"
                                      />
                                    </Tooltip>
                                  </Popover>

                                  <button
                                    onClick={() => setWidgets((prev) => prev.filter((x) => x.id !== w.id))}
                                    className="w-5.5 h-5.5 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                                    title="Delete widget"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                              </div>

                              {/* Rich Text Editor */}
                              <RichEditor
                                id={w.id}
                                initialValue={w.content || ''}
                                onChange={(html) => {
                                  setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, content: html } : x));
                                  // Debounce the height measurement to prevent jittering / "discodancing" of the widgets
                                  if (resizeTimeouts.current[w.id]) {
                                    clearTimeout(resizeTimeouts.current[w.id]);
                                  }
                                  resizeTimeouts.current[w.id] = setTimeout(() => {
                                    const el = document.getElementById(`text-measure-${w.id}`);
                                    if (el) {
                                      const requiredH = el.scrollHeight + 24;
                                      setWidgets((prev) => prev.map((x) => x.id === w.id ? { ...x, h: requiredH } : x));
                                    }
                                  }, 400);
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── GeoServer-native chart panel ─────────────────────── */}
                {activePanel === 'geochart' && (
                  <Form form={geoChartForm} layout="vertical" onFinish={handleAddGeoChart} requiredMark={false} className="flex flex-col gap-1">
                    <Form.Item name="title" rules={[
                      { max: 32, message: 'Title cannot exceed 32 characters' },
                      {
                        validator: (_, value) => {
                          if (!value) return Promise.resolve();
                          if (value.startsWith(' ') || value.endsWith(' ')) {
                            return Promise.reject(new Error('Title cannot start or end with spaces'));
                          }
                          if (value.trim().length === 0) {
                            return Promise.reject(new Error('Title cannot contain only spaces'));
                          }
                          const hasLetters = /[a-zA-Z]/.test(value);
                          const hasNumbers = /[0-9]/.test(value);
                          const hasSpecial = /[^a-zA-Z0-9\s]/.test(value);
                          if (!hasLetters && !hasNumbers && hasSpecial) {
                            return Promise.reject(new Error('Title cannot consist of only special characters'));
                          }
                          if (hasSpecial && hasNumbers) {
                            return Promise.reject(new Error('Title cannot contain both numbers and special characters'));
                          }
                          return Promise.resolve();
                        }
                      }
                    ]} noStyle>
                      {/* Chart title with same style counter as Map Title */}
                      <Form.Item shouldUpdate noStyle>
                        {() => {
                          const val: string = geoChartForm.getFieldValue('title') ?? '';
                          return (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Chart Title</label>
                                <span className={`text-[10px] font-mono ${val.length >= 32 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                                  {val.length}/32
                                </span>
                              </div>
                              <Form.Item name="title" noStyle rules={[
                                { max: 32, message: 'Title cannot exceed 32 characters' },
                                {
                                  validator: (_, value) => {
                                    if (!value) return Promise.resolve();
                                    if (value.startsWith(' ') || value.endsWith(' ')) {
                                      return Promise.reject(new Error('Title cannot start or end with spaces'));
                                    }
                                    if (value.trim().length === 0) {
                                      return Promise.reject(new Error('Title cannot contain only spaces'));
                                    }
                                    const hasLetters = /[a-zA-Z]/.test(value);
                                    const hasNumbers = /[0-9]/.test(value);
                                    const hasSpecial = /[^a-zA-Z0-9\s]/.test(value);
                                    if (!hasLetters && !hasNumbers && hasSpecial) {
                                      return Promise.reject(new Error('Title cannot consist of only special characters'));
                                    }
                                    if (hasSpecial && hasNumbers) {
                                      return Promise.reject(new Error('Title cannot contain both numbers and special characters'));
                                    }
                                    return Promise.resolve();
                                  }
                                }
                              ]}>
                                <Input
                                  placeholder="Auto-generated if blank"
                                  className="rounded-xl h-9"
                                  maxLength={32}
                                />
                              </Form.Item>
                            </div>
                          );
                        }}
                      </Form.Item>
                    </Form.Item>

                    <Form.Item
                      name="layerId"
                      label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Vector Layer</span>}
                      rules={[{ required: true, message: 'Select a layer' }]}
                    >
                      <Select
                        placeholder="Choose a GeoServer layer"
                        showSearch
                        loading={datasetsLoading}
                        onChange={handleGeoChartLayerChange}
                        options={availableDatasets
                          .filter(d => d.data_type === 'VECTOR')
                          .map(d => ({ label: d.name ?? d.id, value: d.id }))}
                        filterOption={(i, o) => (o?.label as string)?.toLowerCase().includes(i.toLowerCase())}
                        className="w-full"
                      />
                    </Form.Item>

                    {geoChartColsLoading && (
                      <div className="flex items-center gap-2 py-2 text-xs text-gray-400">
                        <Spin size="small" /><span>Loading columns…</span>
                      </div>
                    )}

                    {geoChartColumns.length > 0 && (
                      <>
                        {/* Chart type: locked display if preset, dropdown if free choice */}
                        {geoChartPresetType ? (
                          <div className="mb-3">
                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Chart Type</label>
                            <div className="h-9 px-3 flex items-center rounded-xl bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-700">
                              {GEO_CHART_TYPES.find(c => c.key === geoChartPresetType)?.label ?? geoChartPresetType}
                            </div>
                          </div>
                        ) : (
                          <Form.Item
                            name="chartType"
                            label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Chart Type</span>}
                            rules={[{ required: true, message: 'Select chart type' }]}
                          >
                            <Select
                              placeholder="Select chart type"
                              options={GEO_CHART_TYPES.map(c => ({ label: c.label, value: c.key }))}
                              className="w-full"
                              onChange={() => geoChartForm.resetFields(['dimension', 'metric', 'aggregation'])}
                            />
                          </Form.Item>
                        )}

                        <Form.Item noStyle shouldUpdate={(p, c) => p.chartType !== c.chartType || p.dimension !== c.dimension || p.metric !== c.metric}>
                          {({ getFieldValue }) => {
                            const ct = geoChartPresetType ?? getFieldValue('chartType');
                            const selectedDim = getFieldValue('dimension');
                            const selectedMet = getFieldValue('metric');

                            const selectedMetCol = selectedMet
                              ? (typeof selectedMet === 'string' && selectedMet.startsWith('sum__')
                                ? selectedMet.replace('sum__', '')
                                : selectedMet)
                              : null;

                            // Filter X-Axis (dimension) options to exclude selected Y-Axis metric
                            const dimCols = geoChartColumns
                              .filter(c => selectedMetCol ? c.name !== selectedMetCol : true)
                              .map(c => ({ label: c.name, value: c.name }));

                            // Filter Y-Axis numeric options to exclude selected X-Axis dimension
                            const numCols = geoChartColumns
                              .filter(c => c.type === 'number' && (selectedDim ? c.name !== selectedDim : true))
                              .map(c => ({ label: c.name, value: c.name }));

                            // Filter all Y-Axis measure options to exclude selected X-Axis dimension
                            const allColsForMetric = geoChartColumns
                              .filter(c => selectedDim ? c.name !== selectedDim : true)
                              .map(c => ({ label: c.name, value: c.name }));

                            const allCols = geoChartColumns.map(c => ({ label: c.name, value: c.name }));
                            const filterOpt = (i: string, o: any) => (o?.label as string)?.toLowerCase().includes(i.toLowerCase());

                            if (!ct) return null;

                            // ── KPI ──────────────────────────────────────────
                            if (ct === 'kpi') return (
                              <>
                                <Form.Item name="metric" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Value Field</span>} rules={[{ required: true, message: 'Select a field' }]}>
                                  <Select placeholder="Select a field..." showSearch options={allCols} filterOption={filterOpt} className="w-full" />
                                </Form.Item>
                                <Form.Item name="aggregation" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Aggregation</span>} initialValue="count" rules={[{ required: true }]}>
                                  <Select options={AGGREGATIONS.map(a => ({ label: a.label, value: a.key }))} className="w-full" />
                                </Form.Item>
                                {/* dimension hidden — KPI doesn't need it but handleAddGeoChart reads it */}
                                <Form.Item name="dimension" initialValue="__kpi__" noStyle><input type="hidden" /></Form.Item>
                              </>
                            );

                            // ── Pie / Donut ───────────────────────────────────
                            if (ct === 'pie' || ct === 'donut') return (
                              <>
                                <Form.Item name="dimension" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Slice By</span>} rules={[{ required: true, message: 'Select a column to slice by' }]}>
                                  <Select
                                    placeholder="Categorical column"
                                    showSearch
                                    options={dimCols}
                                    filterOption={filterOpt}
                                    className="w-full"
                                    onChange={(val) => {
                                      if (selectedMetCol === val) {
                                        geoChartForm.setFieldValue('metric', undefined);
                                      }
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item name="aggregation" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Slice Value</span>} initialValue="count" rules={[{ required: true }]}>
                                  <Select options={AGGREGATIONS.map(a => ({ label: a.label, value: a.key }))} className="w-full" />
                                </Form.Item>
                                <Form.Item noStyle shouldUpdate={(p, c) => p.aggregation !== c.aggregation || p.dimension !== c.dimension}>
                                  {({ getFieldValue: gfv }) => gfv('aggregation') !== 'count' && (
                                    <Form.Item name="metric" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Metric Column</span>} rules={[{ required: true, message: 'Select a numeric column' }]}>
                                      <Select
                                        placeholder="Numeric column"
                                        showSearch
                                        options={numCols}
                                        filterOption={filterOpt}
                                        className="w-full"
                                        onChange={(val) => {
                                          if (selectedDim === val) {
                                            geoChartForm.setFieldValue('dimension', undefined);
                                          }
                                        }}
                                      />
                                    </Form.Item>
                                  )}
                                </Form.Item>
                              </>
                            );

                            // ── Table ─────────────────────────────────────────
                            if (ct === 'table') return (
                              <>
                                <Form.Item name="tableColumns" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Columns to Display</span>} rules={[{ required: true, message: 'Select at least one column' }]}>
                                  <Select
                                    mode="multiple"
                                    placeholder="Select columns to show"
                                    showSearch
                                    options={allCols}
                                    filterOption={filterOpt}
                                    className="w-full"
                                  />
                                </Form.Item>
                                <Form.Item name="dimension" initialValue="__table__" noStyle><input type="hidden" /></Form.Item>
                                <Form.Item name="aggregation" initialValue="count" noStyle><input type="hidden" /></Form.Item>
                              </>
                            );

                            // ── Scatter ───────────────────────────────────────
                            if (ct === 'scatter') return (
                              <>
                                <Form.Item name="dimension" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">X Axis (Category)</span>} rules={[{ required: true, message: 'Select a column' }]}>
                                  <Select
                                    placeholder="Categorical column"
                                    showSearch
                                    options={dimCols}
                                    filterOption={filterOpt}
                                    className="w-full"
                                    onChange={(val) => {
                                      if (selectedMetCol === val) {
                                        geoChartForm.setFieldValue('metric', undefined);
                                      }
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item name="metric" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Y Axis Measure</span>} rules={[{ required: true, message: 'Select a column' }]}>
                                  <Select
                                    placeholder="Column to measure"
                                    showSearch
                                    options={allColsForMetric}
                                    filterOption={filterOpt}
                                    className="w-full"
                                    onChange={(val) => {
                                      if (selectedDim === val) {
                                        geoChartForm.setFieldValue('dimension', undefined);
                                      }
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item name="aggregation" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Y Axis Aggregation</span>} initialValue="count" rules={[{ required: true }]}>
                                  <Select options={AGGREGATIONS.map(a => ({ label: a.label, value: a.key }))} className="w-full" />
                                </Form.Item>
                              </>
                            );

                            // ── Bar / Line / Area (default) ───────────────────
                            return (
                              <>
                                <Form.Item name="dimension" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">X Axis</span>} rules={[{ required: true, message: 'Select a column' }]}>
                                  <Select
                                    placeholder="Categorical column"
                                    showSearch
                                    options={dimCols}
                                    filterOption={filterOpt}
                                    className="w-full"
                                    onChange={(val) => {
                                      if (selectedMetCol === val) {
                                        geoChartForm.setFieldValue('metric', undefined);
                                      }
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item name="metric" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Y Axis Measure</span>} rules={[{ required: true, message: 'Select a column' }]}>
                                  <Select
                                    placeholder="Column to measure"
                                    showSearch
                                    options={allColsForMetric}
                                    filterOption={filterOpt}
                                    className="w-full"
                                    onChange={(val) => {
                                      if (selectedDim === val) {
                                        geoChartForm.setFieldValue('dimension', undefined);
                                      }
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item name="aggregation" label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Y Axis Aggregation</span>} initialValue="count" rules={[{ required: true }]}>
                                  <Select options={AGGREGATIONS.map(a => ({ label: a.label, value: a.key }))} className="w-full" />
                                </Form.Item>
                              </>
                            );
                          }}
                        </Form.Item>

                        {/* Color Theme & Customization — only for charts that support multi-color */}
                        {geoChartPresetType && !['kpi', 'table'].includes(geoChartPresetType) && (
                          <Form.Item
                            name="themeSettings"
                            label={<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Color Theme &amp; Custom Colors</span>}
                            initialValue={{ colorTheme: 'default', colorMode: 'palette' }}
                          >
                            <ChartThemePicker chartType={geoChartPresetType ?? undefined} />
                          </Form.Item>
                        )}



                        <Button
                          type="primary"
                          onClick={() => geoChartForm.submit()}
                          className="w-full rounded-xl font-bold border-none h-9 text-xs mt-2"
                          style={{ backgroundColor: themePrimary }}
                        >
                          Add Chart to Canvas
                        </Button>
                      </>
                    )}
                  </Form>
                )}

                {/* ── Saved Charts Library ─────────────────────────────── */}
                {activePanel === 'geochart' && filteredCharts.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Saved {getPluralChartLabel(geoChartPresetType)} ({filteredCharts.length})</label>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {filteredCharts.map((sc) => {
                        const typeIcon: Record<string, React.ReactNode> = {
                          bar: <BarChart3 size={11} />, line: <LineChart size={11} />, area: <TrendingUp size={11} />,
                          pie: <PieChart size={11} />, donut: <Donut size={11} />, scatter: <ScatterChart size={11} />,
                          kpi: <Hash size={11} />, table: <Table size={11} />,
                        };
                        return (
                          <div key={sc.id} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-2.5 py-2 hover:border-gray-300 transition-colors group">
                            <span className="text-gray-400 shrink-0">{typeIcon[sc.chartType] ?? <BarChart3 size={11} />}</span>
                            <span className="text-[10px] font-semibold text-gray-700 truncate flex-1" title={sc.title}>{sc.title}</span>
                            <button
                              title="Add to canvas"
                              onClick={() => {
                                const nextY = widgets.reduce((maxY, item) => Math.max(maxY, (item.y !== undefined && item.y !== Infinity && !isNaN(item.y) ? item.y : 0) + (item.h || 300) + 16), 0);
                                const w: CanvasWidget = {
                                  id: `gc_${Date.now()}`,
                                  type: 'geochart',
                                  geoChartConfig: sc.config,
                                  title: sc.title,
                                  x: 0,
                                  y: nextY,
                                  w: sc.chartType === 'kpi' ? 3 : 6,
                                  h: sc.chartType === 'kpi' ? 120 : 300,
                                };
                                setWidgets(prev => [...prev, w]);
                                notification.success({ message: `"${sc.title}" added to canvas`, duration: 2 });
                              }}
                              className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-primary transition-colors"
                              style={{} as any}
                            >
                              <Plus size={11} />
                            </button>
                            <button
                              title="Remove from library"
                              onClick={() => persistChartDelete(sc.id)}
                              className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Map configuration fields */}
                {activePanel === 'map' && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Map Title</label>
                        <span className={`text-[10px] font-mono ${mapConfigTitle.length >= 32 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                          {mapConfigTitle.length}/32
                        </span>
                      </div>
                      <Input
                        value={mapConfigTitle}
                        maxLength={32}
                        onChange={(e) => setMapConfigTitle(e.target.value.slice(0, 32))}
                        placeholder="Map Name (max 32 chars)"
                        className="rounded-xl h-9"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">Select Map or Layer</label>
                      <Select
                        placeholder="Choose a created map or layer"
                        onChange={handleAddMapLayerOrMap}
                        value={selectedMapOrLayer}
                        showSearch
                        loading={datasetsLoading || mapsLoading || loadingMapLayers}
                        filterOption={(input, option) =>
                          (option?.title as unknown as string ?? option?.label as unknown as string ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                        options={[
                          ...(availableMaps.length > 0 ? [{
                            label: (
                              <span className="font-semibold text-gray-700 flex items-center gap-1.5 text-xs py-0.5">
                                <Globe size={13} className="text-primary" />
                                <span>Created Maps ({availableMaps.length})</span>
                              </span>
                            ),
                            title: 'Created Maps',
                            options: availableMaps.map((m) => ({
                              label: (
                                <div className="flex items-center justify-between text-xs py-0.5">
                                  <span className="font-medium text-gray-800 truncate">{m.name}</span>
                                  <Tag color="blue" className="text-[9px] px-1 py-0 mr-0 border-none font-medium">Map</Tag>
                                </div>
                              ),
                              title: m.name,
                              value: `map:${m.id}`,
                            })),
                          }] : []),
                          ...(availableDatasets.length > 0 ? [{
                            label: (
                              <span className="font-semibold text-gray-700 flex items-center gap-1.5 text-xs py-0.5">
                                <Layers size={13} className="text-indigo-500" />
                                <span>Account Layers ({availableDatasets.length})</span>
                              </span>
                            ),
                            title: 'Account Layers',
                            options: availableDatasets.map((d) => ({
                              label: (
                                <div className="flex items-center justify-between text-xs py-0.5">
                                  <span className="font-medium text-gray-800 truncate">{d.name}</span>
                                  <Tag color={d.data_type === 'RASTER' ? 'green' : 'geekblue'} className="text-[9px] px-1 py-0 mr-0 border-none font-medium">
                                    {d.data_type === 'RASTER' ? 'Raster' : 'Vector'}
                                  </Tag>
                                </div>
                              ),
                              title: d.name,
                              value: `dataset:${d.id}`,
                            })),
                          }] : []),
                        ]}
                        className="w-full"
                      />
                    </div>

                    {loadingMapLayers ? (
                      <div className="py-6 flex flex-col items-center justify-center gap-2 bg-gray-50 border border-gray-100 rounded-xl">
                        <Spin size="small" />
                        <span className="text-[11px] text-gray-500 font-medium">Loading map layers...</span>
                      </div>
                    ) : mapConfigLayers.length > 0 ? (
                      <div className="mt-1">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">
                            Selected Layers ({mapConfigLayers.length})
                          </label>
                          {mapConfigLayers.length > 1 && (
                            <button
                              onClick={() => {
                                setMapConfigLayers([]);
                                setSelectedMapOrLayer(null);
                              }}
                              className="text-[10px] text-red-500 hover:text-red-700 font-medium transition-colors"
                            >
                              Clear All
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                          {mapConfigLayers.map((layer) => (
                            <div key={layer.datasetId} className="bg-gray-50 border border-gray-100 rounded-xl p-2.5 flex flex-col gap-1.5 shadow-sm">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${layer.isRaster ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                                  <Text className="text-[11px] font-bold text-gray-700 truncate">{layer.name}</Text>
                                  <Tag color={layer.isRaster ? 'green' : 'blue'} className="text-[9px] px-1 py-0 border-none shrink-0 font-medium">
                                    {layer.isRaster ? 'Raster' : 'Vector'}
                                  </Tag>
                                </div>
                                <button
                                  onClick={() => setMapConfigLayers((p) => p.filter((l) => l.datasetId !== layer.datasetId))}
                                  className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
                                  title="Remove layer"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[8px] text-gray-400 font-bold uppercase w-10 shrink-0">Opacity</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={layer.opacity}
                                  onChange={(e) => setMapConfigLayers((p) =>
                                    p.map((l) => l.datasetId === layer.datasetId
                                      ? { ...l, opacity: parseFloat(e.target.value) }
                                      : l
                                    )
                                  )}
                                  className="flex-1 h-1 accent-blue-500"
                                />
                                <span className="text-[8px] text-gray-500 font-mono w-6 text-right">
                                  {Math.round(layer.opacity * 100)}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 bg-gray-50/60 rounded-xl border border-dashed border-gray-200">
                        <span className="text-[11px] text-gray-400">Choose a created map or account layer above to populate this widget.</span>
                      </div>
                    )}

                    <Button
                      type="primary"
                      onClick={handleConfirmMapWidget}
                      disabled={mapConfigLayers.length === 0 || loadingMapLayers}
                      className="w-full rounded-xl font-bold bg-primary border-none text-[11px] h-9 flex items-center justify-center gap-1.5 shadow-sm mt-2"
                      style={{ backgroundColor: themePrimary }}
                    >
                      Add Map Widget
                    </Button>
                  </div>
                )}



              </div>
            </div>
          )}

        </div>

        {/* Mobile floating bottom toolbar — 3 clean tabs: Map | Charts | Text */}
        {isMobile && !isEditingPrintLayout && (
          <div className="absolute bottom-3 left-0 right-0 flex flex-col items-center z-30 pointer-events-none">

            {/* Chart type picker — appears above the toolbar when Charts is tapped */}
            {showMobileChartPicker && (
              <div className="mb-2 bg-white/97 backdrop-blur-md border border-gray-200 shadow-xl rounded-2xl p-3 w-[92vw] max-w-sm pointer-events-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-extrabold text-gray-700 uppercase tracking-wider">Select Chart Type</span>
                  <button
                    onClick={() => setShowMobileChartPicker(false)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>
                {/* Chart type grid */}
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { key: 'bar', label: 'Bar', icon: <BarChart3 size={20} /> },
                    { key: 'line', label: 'Line', icon: <LineChart size={20} /> },
                    { key: 'area', label: 'Area', icon: <TrendingUp size={20} /> },
                    { key: 'pie', label: 'Pie', icon: <PieChart size={20} /> },
                    { key: 'donut', label: 'Donut', icon: <Donut size={20} /> },
                    { key: 'scatter', label: 'Scatter', icon: <ScatterChart size={20} /> },
                    { key: 'kpi', label: 'KPI', icon: <Hash size={20} /> },
                    { key: 'table', label: 'Table', icon: <Table size={20} /> },
                  ] as { key: string; label: string; icon: React.ReactNode }[]).map((ct) => (
                    <button
                      key={ct.key}
                      onClick={() => {
                        setShowMobileChartPicker(false);
                        handleToolbarClick(ct.key);
                      }}
                      className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border transition-all ${geoChartPresetType === ct.key && activePanel === 'geochart'
                        ? 'border-primary bg-indigo-50 text-primary'
                        : 'border-gray-150 bg-gray-50 text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600'
                        }`}
                    >
                      {ct.icon}
                      <span className="text-[9px] font-bold">{ct.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom tab bar */}
            <div className="flex items-center bg-white/95 backdrop-blur-md border border-gray-200 shadow-lg rounded-2xl overflow-hidden pointer-events-auto">
              {/* Map Widget */}
              <button
                onClick={() => {
                  setShowMobileChartPicker(false);
                  handleToolbarClick('map');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 px-5 py-2.5 transition-colors ${activePanel === 'map'
                  ? 'text-primary bg-indigo-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <Map size={18} />
                <span className="text-[9px] font-bold tracking-wide">Map</span>
              </button>

              <div className="w-px h-8 bg-gray-150" />

              {/* Charts — opens picker popup */}
              <button
                onClick={() => {
                  // If a chart panel is already open, close it; otherwise show picker
                  if (activePanel === 'geochart' && !showMobileChartPicker) {
                    handleToolbarClick(geoChartPresetType || 'pie'); // toggle off
                  } else {
                    setShowMobileChartPicker((prev) => !prev);
                  }
                }}
                className={`flex flex-col items-center justify-center gap-0.5 px-5 py-2.5 transition-colors ${showMobileChartPicker || activePanel === 'geochart'
                  ? 'text-primary bg-indigo-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <BarChart3 size={18} />
                <span className="text-[9px] font-bold tracking-wide">Charts</span>
              </button>

              <div className="w-px h-8 bg-gray-150" />

              {/* Text Box */}
              <button
                onClick={() => {
                  setShowMobileChartPicker(false);
                  handleToolbarClick('text');
                }}
                className={`flex flex-col items-center justify-center gap-0.5 px-5 py-2.5 transition-colors ${activePanel === 'text'
                  ? 'text-primary bg-indigo-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
              >
                <FileText size={18} />
                <span className="text-[9px] font-bold tracking-wide">Text</span>
              </button>
            </div>
          </div>
        )}

        {/* Right side narrow vertical toolbar (styled exactly like the map toolbar) — hidden on mobile */}
        <div className="hidden md:flex w-14 bg-white border-l border-gray-100 flex-col items-center py-4 gap-4 z-10 shadow-sm shrink-0 justify-between">
          <div className="flex flex-col items-center gap-4 w-full">

            {/* Widget templates shortcut icons */}
            <Tooltip title="Add Map Widget" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<Map size={20} className={`transition-colors ${activePanel === 'map' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('map')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Pie Chart" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<PieChart size={20} className={`transition-colors ${geoChartPresetType === 'pie' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('pie')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Bar Chart" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<BarChart3 size={20} className={`transition-colors ${geoChartPresetType === 'bar' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('bar')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Line Chart" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<LineChart size={20} className={`transition-colors ${geoChartPresetType === 'line' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('line')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Table Grid" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<Table size={20} className={`transition-colors ${geoChartPresetType === 'table' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('table')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add KPI Widget" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<Hash size={20} className={`transition-colors ${geoChartPresetType === 'kpi' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('kpi')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Scatter Plot" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<ScatterChart size={20} className={`transition-colors ${geoChartPresetType === 'scatter' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('scatter')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Donut Chart" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<Donut size={20} className={`transition-colors ${geoChartPresetType === 'donut' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('donut')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Area Chart" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<TrendingUp size={20} className={`transition-colors ${geoChartPresetType === 'area' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('area')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>

            <Tooltip title="Add Rich Text Box" placement="left">
              <Button
                type="text"
                disabled={isEditingPrintLayout}
                icon={<FileText size={20} className={`transition-colors ${activePanel === 'text' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
                onClick={() => handleToolbarClick('text')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 42, height: 42 }}
              />
            </Tooltip>
          </div>

          {/* Bottom section of toolbar */}
          <div className="flex flex-col items-center">
            <Tooltip title="Dashboard Workspace Help" placement="left">
              <Button
                type="text"
                icon={<Info size={18} className="text-gray-400 hover:text-primary transition-colors" />}
                onClick={() => {
                  notification.info({
                    message: 'Dashboard Workspace Guide',
                    description: 'Select widget types from the right toolbar to configure and add them to your dashboard canvas. Drag and resize widgets as desired.',
                    placement: 'topRight'
                  });
                }}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: 40, height: 40 }}
              />
            </Tooltip>
          </div>
        </div>

      </div>

      {/* Rename Dashboard Modal */}
      <Modal
        title="Rename Dashboard"
        open={renameModalOpen}
        onOk={handleRenameDashboard}
        onCancel={() => setRenameModalOpen(false)}
        okText="Rename"
        okButtonProps={{ style: { backgroundColor: themePrimary, border: 'none' } }}
        className="rounded-2xl"
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Enter new dashboard name"
          className="mt-3 rounded-xl h-9"
          maxLength={32}
          onPressEnter={handleRenameDashboard}
        />
      </Modal>

      {/* Share Dashboard Modal */}
      <Modal
        title="Dashboard Access Control"
        open={isShareModalOpen}
        onCancel={() => setIsShareModalOpen(false)}
        footer={null}
        centered
        width={440}
        className="rounded-2xl"
      >
        <div className="flex flex-col gap-4 pt-3 pb-2">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block mb-2">
              Visibility Level
            </label>
            <Select
              className="w-full h-11"
              value={isPublic ? 'PUBLIC' : 'PRIVATE'}
              onChange={(val) => setIsPublic(val === 'PUBLIC')}
              options={[
                { label: 'Private (Only you can access)', value: 'PRIVATE' },
                { label: 'Public (Anyone with link can view)', value: 'PUBLIC' }
              ]}
            />
          </div>
          <div className="flex justify-end pt-3 border-t border-gray-100 mt-2">
            <Button
              type="primary"
              onClick={() => {
                setIsShareModalOpen(false);
                handleSaveDashboard();
              }}
              style={{ backgroundColor: themePrimary, border: 'none' }}
              className="rounded-xl font-bold h-10 px-6"
            >
              Save Access Level
            </Button>
          </div>
        </div>
      </Modal>



      <style dangerouslySetInnerHTML={{
        __html: `
        .react-grid-item { transition: none !important; }
        .react-resizable-handle { z-index: 10; }
        .react-resizable-handle-se { bottom: 4px !important; right: 4px !important; }
        
        @media (max-width: 767px) {
          .ant-popover {
            position: fixed !important;
            top: 50% !important;
            left: 50% !important;
            transform: translate(-50%, -50%) !important;
            width: min(340px, 90vw) !important;
            z-index: 1050 !important;
            margin: 0 !important;
          }
          .ant-popover-arrow {
            display: none !important;
          }
          .ant-popover-inner {
            border-radius: 1.25rem !important;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3) !important;
            border: 1px solid #f1f5f9 !important;
          }
        }
      ` }} />
    </div>
  );
}

export default function ViewDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Loading Dashboard Workspace..." />
      </div>
    }>
      <ViewDashboardContent />
    </Suspense>
  );
}
