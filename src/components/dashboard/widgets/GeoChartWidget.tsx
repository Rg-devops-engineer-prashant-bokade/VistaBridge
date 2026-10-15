// ============================================================================
// GeoChartWidget Component (GIS Layer-Linked Chart Widget)
//
// Directly connects a dashboard chart to a GIS vector layer on the map:
// 1. Groups features by a categorical column (e.g., land_use) and computes
//    aggregations (count, sum, avg, min, max) on a numeric metric (e.g., area).
// 2. Renders Bar, Line, Pie, Donut, Area, Scatter, KPI, or Table views.
// 3. Filters in real-time when the map view changes: uses Turf.js spatial checks
//    against the map's current bounding box (`bbox`).
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Spin } from 'antd';
import { apiRequest } from '@/lib/api';
import { useDashboardStore } from '@/store/useDashboardStore';
import { resolveChartColors, hexToRgba } from '@/config/chartThemes';

export interface GeoChartConfig {
  layerId: string;       // e.g. "tiger:tiger_roads"
  chartType: string;     // bar | line | pie | donut | scatter | area | kpi | table
  dimension: string;     // categorical column (X axis / group by)
  metric: string;        // numeric column or "count"
  aggregation: string;   // count | sum | avg | min | max
  limit?: number;        // top-N groups (0 = no limit)
  tableColumns?: string[]; // columns to display in table mode
  sortBy?: 'x-asc' | 'x-desc' | 'y-asc' | 'y-desc';
  colorTheme?: string;
  customColors?: string[];
  primaryColor?: string;
  colorMode?: 'palette' | 'single';
  categoryColors?: Record<string, string>;
}

interface Props {
  widgetId: string;
  config: GeoChartConfig;
}

let ecLoaded: Promise<any> | null = null;
const getEC = () => { if (!ecLoaded) ecLoaded = import('echarts'); return ecLoaded!; };

// Helper to parse string values as date timestamp or number for sorting
function parseDateOrNumber(val: string): number | null {
  const s = val.trim();
  if (s === '' || s.toLowerCase() === '(blank)') return null;
  const num = Number(s);
  if (!isNaN(num)) return num;
  const t = Date.parse(s);
  if (!isNaN(t)) return t;
  // Try parsing custom format DD/MM/YYYY or DD-MM-YYYY
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3) {
    const p0 = Number(parts[0]);
    const p1 = Number(parts[1]);
    const p2 = Number(parts[2]);
    if (!isNaN(p0) && !isNaN(p1) && !isNaN(p2)) {
      if (p2 > 1000) {
        // DD/MM/YYYY or MM/DD/YYYY
        if (p1 >= 1 && p1 <= 12 && p0 >= 1 && p0 <= 31) {
          return new Date(p2, p1 - 1, p0).getTime();
        }
      } else if (p0 > 1000) {
        // YYYY/MM/DD or YYYY/DD/MM
        if (p1 >= 1 && p1 <= 12 && p2 >= 1 && p2 <= 31) {
          return new Date(p0, p1 - 1, p2).getTime();
        }
      }
    }
  }
  return null;
}

// ── Aggregate raw WFS rows client-side ────────────────────────────────────────
function aggregate(
  rows: any[],
  dimension: string,
  metric: string,
  aggregation: string,
  limit: number,
  chartType?: string,
  sortBy?: 'x-asc' | 'x-desc' | 'y-asc' | 'y-desc'
): { labels: string[]; values: number[] } {
  const groups = new Map<string, number[]>();
  const hasMetric = metric && metric !== 'count' && metric !== '';

  for (const row of rows) {
    const key = String(row[dimension] ?? '(blank)');
    if (!groups.has(key)) groups.set(key, []);

    if (aggregation === 'count') {
      if (hasMetric) {
        const val = row[metric];
        if (val !== undefined && val !== null && val !== '') {
          groups.get(key)!.push(1);
        }
      } else {
        groups.get(key)!.push(1);
      }
    } else {
      const v = Number(row[metric] ?? 0);
      if (!isNaN(v)) {
        groups.get(key)!.push(v);
      }
    }
  }

  const agg = (vals: number[]) => {
    if (!vals.length) return 0;
    switch (aggregation) {
      case 'count': return vals.length;
      case 'sum': return vals.reduce((a, b) => a + b, 0);
      case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length;
      case 'min': return Math.min(...vals);
      case 'max': return Math.max(...vals);
      default: return vals.length;
    }
  };

  const sorted = Array.from(groups.entries())
    .map(([k, v]) => ({ label: k, value: agg(v) }));

  const effectiveSortBy = sortBy || ((chartType === 'line' || chartType === 'area') ? 'x-asc' : 'y-desc');

  sorted.sort((a, b) => {
    if (effectiveSortBy === 'x-asc' || effectiveSortBy === 'x-desc') {
      const valA = parseDateOrNumber(a.label);
      const valB = parseDateOrNumber(b.label);
      let cmp = 0;
      if (valA !== null && valB !== null) {
        cmp = valA - valB;
      } else {
        cmp = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
      }
      return effectiveSortBy === 'x-asc' ? cmp : -cmp;
    } else {
      const cmp = a.value - b.value;
      return effectiveSortBy === 'y-asc' ? cmp : -cmp;
    }
  });

  const sliced = limit > 0 ? sorted.slice(0, limit) : sorted;

  return {
    labels: sliced.map(e => e.label),
    values: sliced.map(e => Math.round(e.value * 100) / 100),
  };
}

// ── ECharts option builders ───────────────────────────────────────────────────
function buildOption(
  chartType: string,
  labels: string[],
  values: number[],
  xLabel: string,
  yLabel: string,
  isPdfLock: boolean,
  colorConfig?: {
    colorTheme?: string;
    customColors?: string[];
    primaryColor?: string;
    colorMode?: 'palette' | 'single';
    categoryColors?: Record<string, string>;
  }
): any {
  const { palette, primary, getColorForCategory } = resolveChartColors(colorConfig);

  const tip = isPdfLock
    ? { show: false, trigger: 'none' }
    : {
      trigger: chartType === 'pie' || chartType === 'donut' ? 'item' : 'axis',
      backgroundColor: '#111827', borderColor: '#111827',
      textStyle: { color: '#fff', fontSize: 11 },
    };
  const hasXName = Boolean(xLabel && xLabel.trim());
  const needsRotation = labels.length > 8 && (labels.length > 14 || labels.some((l) => String(l).length > 3));
  const axisLabelRotate = needsRotation ? 30 : 0;
  const nameGap = hasXName ? (needsRotation ? 38 : 25) : 0;
  const gridBottom = hasXName ? (needsRotation ? 56 : 42) : (needsRotation ? 32 : 18);

  const grid = { left: 14, right: 18, top: 32, bottom: gridBottom, containLabel: true };
  const catAxis = {
    type: 'category',
    data: labels,
    name: hasXName ? xLabel : undefined,
    nameLocation: 'middle',
    nameGap,
    nameTextStyle: { fontSize: 10, color: '#6b7280', fontWeight: 500 },
    axisLabel: {
      fontSize: 10,
      color: '#6b7280',
      rotate: axisLabelRotate,
      overflow: 'truncate',
      width: 70,
    },
    axisTick: { alignWithLabel: true },
  };
  const valAxis = {
    type: 'value',
    name: yLabel,
    nameTextStyle: { fontSize: 10, color: '#6b7280', fontWeight: 500 },
    axisLabel: {
      fontSize: 10,
      color: '#6b7280',
      formatter: (v: number) => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M'
        : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v),
    },
    splitLine: { lineStyle: { color: '#f3f4f6' } },
  };

  const anim = {
    animation: !isPdfLock,
    animationDuration: 300,
    animationDurationUpdate: 300,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicOut',
  };
  const interactionLock = {
    silent: isPdfLock,
    emphasis: isPdfLock ? { disabled: true } : undefined,
  };

  if (chartType === 'pie' || chartType === 'donut') {
    const manySlices = labels.length > 10;
    return {
      ...anim,
      color: palette,
      tooltip: { ...tip, formatter: '{b}: {c} ({d}%)' },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 0,
        top: 0,
        bottom: 16,
        width: 140,
        textStyle: { fontSize: 10, color: '#374151', overflow: 'truncate', width: 110 },
        pageTextStyle: { fontSize: 9, color: '#6b7280' },
        data: labels,
      },
      series: [{
        type: 'pie',
        ...interactionLock,
        radius: chartType === 'donut' ? ['38%', '65%'] : '65%',
        center: ['38%', '50%'],
        data: labels.map((l, i) => ({
          name: l,
          value: values[i],
          itemStyle: { color: getColorForCategory(l, i) },
        })),
        label: { show: !manySlices, fontSize: 10 },
        labelLine: { show: !manySlices },
        emphasis: isPdfLock ? { disabled: true } : { label: { show: true, fontSize: 11, fontWeight: 'bold' } },
      }],
    };
  }

  if (chartType === 'scatter') {
    return {
      ...anim,
      color: palette,
      tooltip: tip,
      grid,
      xAxis: catAxis,
      yAxis: valAxis,
      series: [{
        type: 'scatter',
        ...interactionLock,
        data: values.map((v, i) => [labels[i], v]),
        itemStyle: { color: (p: any) => getColorForCategory(labels[p.dataIndex], p.dataIndex) },
        symbolSize: 8,
      }],
    };
  }

  if (chartType === 'line' || chartType === 'area') {
    return {
      ...anim,
      color: palette,
      tooltip: tip, grid,
      xAxis: catAxis, yAxis: valAxis,
      series: [{
        type: 'line',
        data: values,
        ...interactionLock,
        smooth: true,
        areaStyle: chartType === 'area' ? {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: hexToRgba(primary, 0.45) },
              { offset: 1, color: hexToRgba(primary, 0.02) },
            ],
          },
        } : undefined,
        lineStyle: { color: primary, width: 2.5 },
        itemStyle: { color: primary },
      }],
    };
  }

  // default: bar
  return {
    ...anim,
    color: palette,
    tooltip: tip, grid,
    xAxis: catAxis, yAxis: valAxis,
    series: [{
      type: 'bar',
      data: values,
      ...interactionLock,
      itemStyle: {
        color: (p: any) => getColorForCategory(labels[p.dataIndex], p.dataIndex),
        borderRadius: [3, 3, 0, 0],
      },
    }],
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GeoChartWidget({ widgetId: _widgetId, config }: Props) {
  const { layerId, chartType, dimension, metric, aggregation, limit = 0, sortBy } = config;
  const wrapRef = useRef<HTMLDivElement>(null);
  const ecRef = useRef<any>(null);

  const globalBbox = useDashboardStore((state) => state.bbox);
  const layerBboxes = useDashboardStore((state) => state.layerBboxes);
  const activeMapDatasetIds = useDashboardStore((state) => state.activeMapDatasetIds);
  const isPdfLock = useDashboardStore((state) => state.isPdfLock);
  const mapsSettled = useDashboardStore((state) => state.mapsSettled);

  const normalizeId = (id?: string) => (id && id.includes(':') ? id.split(':')[1] : id || '');

  const effectiveLayerBbox = useMemo(() => {
    if (!layerId) return globalBbox;
    const normalized = normalizeId(layerId);
    for (const [k, v] of Object.entries(layerBboxes)) {
      if (v && (k === layerId || normalizeId(k) === normalized)) {
        return v;
      }
    }
    return globalBbox;
  }, [layerId, layerBboxes, globalBbox]);

  const isLayerInMap = useMemo(() => {
    if (!layerId) return false;
    if (activeMapDatasetIds.length === 0) return false;
    const normalized = normalizeId(layerId);
    return activeMapDatasetIds.some(id => id === layerId || normalizeId(id) === normalized);
  }, [layerId, activeMapDatasetIds]);

  // Smooth delayed readiness state: wait 300ms after map zoom settles before triggering WFS query,
  // or trigger immediately if layer is independent / no map widgets on canvas.
  const [readyToLoad, setReadyToLoad] = useState(false);
  useEffect(() => {
    if (!isLayerInMap || activeMapDatasetIds.length === 0) {
      const timer = setTimeout(() => {
        setReadyToLoad(true);
      }, 50);
      return () => clearTimeout(timer);
    }

    if (mapsSettled) {
      const timer = setTimeout(() => {
        setReadyToLoad(true);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      // Safety fallback: if maps take longer than 800ms, start loading features anyway
      const fallbackTimer = setTimeout(() => {
        setReadyToLoad(true);
      }, 800);
      return () => clearTimeout(fallbackTimer);
    }
  }, [mapsSettled, isLayerInMap, activeMapDatasetIds.length]);

  // Debounce effectiveLayerBbox by 400ms for smooth rendering during pan/zoom
  const [debouncedLayerBbox, setDebouncedLayerBbox] = useState<[number, number, number, number] | null>(effectiveLayerBbox);
  const bboxStr = effectiveLayerBbox ? effectiveLayerBbox.join(',') : '';

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedLayerBbox(prev => {
        const prevStr = prev ? prev.join(',') : '';
        if (prevStr === bboxStr) return prev;
        return effectiveLayerBbox;
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [bboxStr, effectiveLayerBbox]);

  const activeBbox = debouncedLayerBbox;

  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [allFeatures, setAllFeatures] = useState<any[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);

  const isFullExtent = useMemo(() => {
    if (!activeBbox || activeBbox.length !== 4) return true;
    const [minX, minY, maxX, maxY] = activeBbox;
    // Strictly true full world view (-180 to 180, -90 to 90)
    return minX <= -179 && maxX >= 179 && minY <= -89 && maxY >= 89;
  }, [activeBbox]);

  const load = useCallback(async () => {
    if (!layerId) return;
    if (!readyToLoad) {
      console.log(`[GeoChartWidget] ⏳ Chart loading deferred until map extent zoom completes for layer "${layerId}"...`);
      return;
    }
    if (isPdfLock) {
      console.log(`[BBOX DEBUG] 🔒 PDF Lock active. Skipping WFS reload for layer "${layerId}".`);
      return;
    }
    setLoadingFeatures(true);
    try {
      let url = `/datasets/${layerId}/features/?page_size=999999&page=1`;
      if (isLayerInMap && activeBbox && !isFullExtent) {
        url += `&bbox=${activeBbox.join(',')}`;
        console.log(`[BBOX DEBUG] 🛰️ Fetching features with BBOX for layer "${layerId}":`, {
          bboxCoordinates: activeBbox,
          urlRequested: url,
        });
      } else {
        console.log(`[BBOX DEBUG] 🌐 Fetching full dataset for layer "${layerId}" (isFullExtent: ${isFullExtent}):`, {
          urlRequested: url,
        });
      }

      const res = await apiRequest(url);
      if (!res.ok) throw new Error(`WFS ${res.status}`);
      const json = await res.json();
      let rows: any[] = json.data ?? [];
      let total = json.pagination?.total_records ?? rows.length;

      // Fallback: if BBOX query returned 0 features, fetch the full dataset
      if (rows.length === 0 && isLayerInMap && activeBbox && !isFullExtent) {
        console.log(`[BBOX DEBUG] 🔄 BBOX query returned 0 features. Falling back to fetching full dataset for layer "${layerId}"...`);
        const fallbackUrl = `/datasets/${layerId}/features/?page_size=999999&page=1`;
        const fallbackRes = await apiRequest(fallbackUrl);
        if (fallbackRes.ok) {
          const fallbackJson = await fallbackRes.json();
          rows = fallbackJson.data ?? [];
          total = fallbackJson.pagination?.total_records ?? rows.length;
        }
      }

      console.log(`%c[BBOX LAYER DATA] 📦 Layer "${layerId}" returned ${rows.length} features for BBOX:`, 'color: #00ffaa; font-weight: bold;', activeBbox);

      const cleanTableData = rows.map(r => {
        const attributes = { ...r };
        delete attributes.geometry;
        delete attributes.geometry_type;
        delete attributes.id;
        return attributes;
      });

      console.log(`[BBOX LAYER DATA] 📋 Layer Features Attributes Table (showing first 50):`);
      console.table(cleanTableData.slice(0, 50));
      console.log(`[BBOX LAYER DATA] 🗃️ Complete Layer Feature Objects (Expand to inspect all attributes):`, rows);

      setAllFeatures(rows);
      setTotalRecords(total);
      setFetchError('');
    } catch (e: any) {
      console.error(`[BBOX DEBUG] ❌ Error fetching features for layer "${layerId}":`, e.message);
      setFetchError(e.message);
      setAllFeatures([]);
      setTotalRecords(0);
    } finally {
      setHasLoadedOnce(true);
      setLoadingFeatures(false);
    }
  }, [layerId, isLayerInMap, activeBbox, isFullExtent, isPdfLock, readyToLoad]);

  useEffect(() => {
    if (readyToLoad) {
      queueMicrotask(() => {
        load();
      });
    }
  }, [load, readyToLoad]);

  const displayData = useMemo(() => {
    if (!readyToLoad || !hasLoadedOnce || (loadingFeatures && allFeatures.length === 0)) {
      if (allFeatures.length === 0) return { status: 'loading' as const };
    }
    if (fetchError) return { status: 'error' as const, error: fetchError };
    if (allFeatures.length === 0) return { status: 'error' as const, error: 'No features returned from layer for current map extent' };

    // allFeatures is 100% server-side filtered by GeoServer / PostGIS database BBOX query
    const filtered = allFeatures;

    if (filtered.length === 0) {
      return { status: 'error' as const, error: 'No features found in current map extent' };
    }

    if (chartType === 'table') {
      const cols = (config.tableColumns && config.tableColumns.length > 0)
        ? config.tableColumns
        : Object.keys(filtered[0] ?? {}).filter(k => k !== 'geometry_type' && k !== 'id' && k !== 'geometry');
      return { status: 'table' as const, tableData: { columns: cols, rows: filtered } };
    }

    const fmt = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const yLabel = (metric && metric !== '__kpi__' && metric !== 'count' && metric !== '')
      ? fmt(metric)
      : (chartType === 'kpi' ? 'Total Features' : 'Count');

    if (chartType === 'kpi') {
      const kpiTotal = (aggregation === 'count' && (!metric || metric === '__kpi__' || metric === 'count'))
        ? totalRecords
        : (() => {
          const vals: any[] = [];
          for (const row of filtered) {
            const v = row[metric];
            if (v !== undefined && v !== null && v !== '') {
              vals.push(v);
            }
          }
          switch (aggregation) {
            case 'count': return vals.length;
            case 'sum': return vals.map(Number).filter(n => !isNaN(n)).reduce((a, b) => a + b, 0);
            case 'avg': {
              const nums = vals.map(Number).filter(n => !isNaN(n));
              return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
            }
            case 'min': {
              const nums = vals.map(Number).filter(n => !isNaN(n));
              return nums.length ? Math.min(...nums) : 0;
            }
            case 'max': {
              const nums = vals.map(Number).filter(n => !isNaN(n));
              return nums.length ? Math.max(...nums) : 0;
            }
            default: return vals.length;
          }
        })();
      return { status: 'kpi' as const, kpiVal: { value: kpiTotal.toLocaleString(), label: yLabel } };
    }

    const { labels, values } = aggregate(filtered, dimension, metric, aggregation, limit, chartType, sortBy);
    if (labels.length === 0) {
      return { status: 'error' as const, error: 'No data after aggregation' };
    }

    const xLabel = fmt(dimension);

    console.log(`[BBOX DEBUG] 📊 Final Chart Aggregation for "${layerId}":`, {
      activeBbox: debouncedLayerBbox,
      featuresCountBeforeFilter: allFeatures.length,
      featuresCountAfterFilter: filtered.length,
      sampleFilteredNames: filtered.slice(0, 10).map(r => r.NAME || r.name || r.title || r.id),
      chartLabels: labels,
      chartValues: values,
    });

    return {
      status: 'done' as const,
      labels,
      values,
      xLabel,
      yLabel,
    };
  }, [allFeatures, fetchError, debouncedLayerBbox, chartType, dimension, metric, aggregation, limit, sortBy, config.tableColumns, totalRecords, readyToLoad, hasLoadedOnce, layerId, loadingFeatures]);

  useEffect(() => {
    if (displayData.status !== 'done') {
      if (ecRef.current) {
        ecRef.current.dispose();
        ecRef.current = null;
      }
      return;
    }

    let active = true;
    (async () => {
      const ec = await getEC();
      let tries = 0;
      while (tries++ < 40 && (!wrapRef.current || wrapRef.current.clientHeight < 10 || wrapRef.current.clientWidth < 10)) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (!wrapRef.current || !active) return;
      if (wrapRef.current.clientHeight < 10 || wrapRef.current.clientWidth < 10) return;

      if (!ecRef.current) {
        ecRef.current = ec.init(wrapRef.current, null, { renderer: 'canvas' });
      }
      ecRef.current.setOption(
        buildOption(chartType, displayData.labels, displayData.values, displayData.xLabel, displayData.yLabel, isPdfLock, config),
        true
      );
      if (isPdfLock) {
        ecRef.current.dispatchAction({ type: 'hideTip' });
        ecRef.current.dispatchAction({ type: 'downplay' });
      }
      // Synchronize dimension boundaries and interaction coordinates immediately
      ecRef.current.resize();
      setTimeout(() => {
        if (active && ecRef.current) {
          ecRef.current.resize();
        }
      }, 150);
    })();

    return () => {
      active = false;
    };
  }, [displayData, chartType, isPdfLock, config]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => ecRef.current?.resize());
    ro.observe(wrapRef.current);
    return () => {
      ro.disconnect();
      if (ecRef.current) {
        ecRef.current.dispose();
        ecRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />

      {displayData.status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-white/80 z-10">
          <Spin size="small" />
          {!readyToLoad && (
            <span className="text-gray-400 text-[10px] font-medium tracking-wide">Syncing with map extent...</span>
          )}
        </div>
      )}
      {displayData.status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center bg-white/80 z-10">
          <span className="text-red-400 text-xs font-semibold">Chart Error</span>
          <span className="text-gray-400 text-[10px]">{displayData.error}</span>
        </div>
      )}
      {displayData.status === 'kpi' && displayData.kpiVal && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 z-10">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">{displayData.kpiVal.label}</span>
          <span
            className="text-5xl font-black tabular-nums tracking-tight"
            style={{ color: resolveChartColors(config).primary }}
          >
            {displayData.kpiVal.value}
          </span>
        </div>
      )}
      {displayData.status === 'table' && displayData.tableData && (
        <div className="absolute inset-0 overflow-auto z-10">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0">
              <tr>
                {displayData.tableData.columns.map(col => (
                  <th key={col} className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-left font-semibold text-gray-600 whitespace-nowrap">
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayData.tableData.rows.map((row, i) => (
                <tr key={i} className="hover:bg-blue-50/40">
                  {displayData.tableData.columns.map(col => (
                    <td key={col} className="px-3 py-1.5 border-b border-gray-100 text-gray-700 whitespace-nowrap">
                      {typeof row[col] === 'object' && row[col] !== null
                        ? JSON.stringify(row[col])
                        : String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
