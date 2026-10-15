// ============================================================================
// ChartWidget Component (Interactive Dashboard Chart)
//
// Displays a bar, line, pie, or area chart inside a dashboard card:
// 1. Fetches data and configuration from the analytics backend
// 2. Automatically syncs with the map via `useDashboardStore`:
//    - When the map is panned or zoomed, debounces the new `bbox` and queries
//      only the features visible within the map extent.
//    - When a user clicks a chart slice or bar, selects those features and
//      notifies other dashboard widgets.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import { useDashboardStore } from '@/store/useDashboardStore';
import { apiRequest } from '@/lib/api';
import { CHART_TYPES } from '@/config/chart-types';

const ANALYTICS = process.env.NEXT_PUBLIC_ANALYTICS_URL || 'http://localhost:8000';

let ecLoaded: Promise<any> | null = null;
function getECharts(): Promise<any> {
  if (ecLoaded) return ecLoaded;
  ecLoaded = import('echarts').then((m) => m);
  return ecLoaded;
}

interface Props {
  widgetId: string;
  chartId: number;
  vizType: string;
  vistaDatasetId?: string;
}

export default function ChartWidget({ widgetId, chartId, vizType, vistaDatasetId }: Props) {
  const { token } = useAuthStore();
  const {
    bbox,
    chartFilterDatasetId,
    activeMapDatasetIds,
    setChartFilter,
    subscribe,
  } = useDashboardStore();

  const [resolvedDatasetId, setResolvedDatasetId] = useState<string | null>(vistaDatasetId || null);

  // Debounce bbox — chart re-fetches 600 ms after the user stops panning/zooming
  const [debouncedBbox, setDebouncedBbox] = useState(bbox);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBbox(bbox), 1000);
    return () => clearTimeout(t);
  }, [bbox]);

  // The chart is connected to the map IF:
  // 1. We have a valid vistaDatasetId prop OR an extracted UUID from table name
  // 2. That dataset UUID is currently active on the map (exists in activeMapDatasetIds)
  const isConnected = !!(resolvedDatasetId && activeMapDatasetIds.includes(resolvedDatasetId));

  // localBbox is synced with debouncedBbox ONLY if the chart is connected to the map.
  // This prevents unconnected charts from re-fetching on map pan/zoom.
  const localBbox = isConnected ? debouncedBbox : null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const ecRef = useRef<any>(null);
  const groupByColRef = useRef<string>('');
  const activeFilterRef = useRef<{ col: string; val: string } | null>(null);

  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [tableData, setTableData] = useState<{ cols: string[]; rows: any[] } | null>(null);
  const [bigNum, setBigNum] = useState<{ value: any; label: string } | null>(null);

  // ── Core fetch + render ────────────────────────────────────────────────────
  const fetchAndRender = useCallback(async () => {
    if (!token || !chartId) return;
    setState('loading');
    setTableData(null);
    setBigNum(null);
    if (ecRef.current) { ecRef.current.dispose(); ecRef.current = null; }

    try {
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

      const cr = await fetch(`${ANALYTICS}/superset/api/v1/chart/${chartId}`, { headers: h });
      if (!cr.ok) throw new Error(`Chart API ${cr.status}`);
      const cj = await cr.json();
      // params is the source of truth — form_data is null in this Superset version
      const fd: any = cj.result?.params ? JSON.parse(cj.result.params) : {};

      let qc: any = null;
      if (cj.result?.query_context) {
        try {
          qc = JSON.parse(cj.result.query_context);
        } catch (e) {
          console.error("Failed to parse query_context", e);
        }
      }

      // Auto-extract UUID from table name: e.g. public.vistabridge_ds_b6836ebd_807c_4053_a41c_86998e9b8ff8
      if (!resolvedDatasetId && cj.result?.datasource_name_text) {
        const dsName = cj.result.datasource_name_text;
        const match = dsName.match(/(?:vistamap|vistabridge)_ds_([a-f0-9_]+)/i);
        const extractedUuid = match ? match[1].replace(/_/g, '-') : null;
        if (extractedUuid) {
          setResolvedDatasetId(extractedUuid);
        }
      }

      let bodyPayload: any;
      const config = CHART_TYPES.find((c) => c.viz_type === vizType);

      if (qc && qc.queries && qc.queries.length > 0) {
        const query = qc.queries[0];
        if (query.extras) {
          if ((query.extras as any).original_where_backup === undefined) {
            (query.extras as any).original_where_backup = query.extras.where || "";
          }
        } else {
          query.extras = { original_where_backup: "" };
        }
        const originalWhere = (query.extras as any).original_where_backup || "";
        let newWhere = "";

        if (isConnected && localBbox && localBbox.length === 4) {
          let [minLon, minLat, maxLon, maxLat] = localBbox.map(Number);
          minLon = Math.max(-180, Math.min(180, minLon));
          maxLon = Math.max(-180, Math.min(180, maxLon));
          minLat = Math.max(-90, Math.min(90, minLat));
          maxLat = Math.max(-90, Math.min(90, maxLat));
          if (minLon >= maxLon) { minLon = -180; maxLon = 180; }
          if (minLat >= maxLat) { minLat = -90; maxLat = 90; }

          const isFull = (minLon <= -170 && maxLon >= 170 && minLat <= -75 && maxLat >= 75) || (Math.abs(maxLon - minLon) >= 300);
          if (!isFull) {
            newWhere = `ST_Intersects(geom, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`;
          }
        }

        if (newWhere) {
          query.extras.where = originalWhere
            ? `(${originalWhere}) AND (${newWhere})`
            : newWhere;
        } else {
          query.extras.where = originalWhere;
        }

        if (config?.transformQuery) {
          config.transformQuery(query, fd);
        }

        bodyPayload = qc;
      } else {
        let newWhere = "";
        if (isConnected && localBbox) {
          const [minLon, minLat, maxLon, maxLat] = localBbox;
          console.log('[ChartWidget] Passing bbox to server side call:', localBbox);
          newWhere = `ST_Intersects(geom, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`;
        }

        const queryObj: any = {
          ...fd,
          slice_id: chartId,
        };

        if (config?.transformQuery) {
          config.transformQuery(queryObj, fd);
        } else {
          // Superset /chart/data expects `columns` not `all_columns` for table viz
          if (vizType === 'table' && fd.all_columns?.length) {
            queryObj.columns = fd.all_columns;
            if (!queryObj.groupby) queryObj.groupby = [];
            if (!queryObj.metrics) queryObj.metrics = [];
          }

          // Superset /chart/data expects `metrics` as array for big_number_total
          if (vizType === 'big_number_total' && fd.metric && !queryObj.metrics?.length) {
            queryObj.metrics = [fd.metric];
            if (!queryObj.groupby) queryObj.groupby = [];
          }

          // histogram uses `column` not groupby/metrics
          if (vizType === 'histogram' && fd.column) {
            queryObj.columns = [fd.column];
            if (!queryObj.groupby) queryObj.groupby = [];
            if (!queryObj.metrics) queryObj.metrics = [];
          }

          // heatmap: metric is singular, wrap to array
          if (vizType === 'heatmap' && fd.metric && !queryObj.metrics?.length) {
            queryObj.metrics = [fd.metric];
            if (!queryObj.groupby) queryObj.groupby = [fd.all_columns_x, fd.all_columns_y].filter(Boolean);
          }

          // echarts_scatter: needs metrics array
          if (vizType === 'echarts_scatter' && !queryObj.metrics?.length) {
            queryObj.metrics = [];
            queryObj.columns = [fd.x, fd.y, fd.entity].filter(Boolean);
            if (!queryObj.groupby) queryObj.groupby = [];
          }
        }

        if (newWhere) {
          if (!queryObj.extras) queryObj.extras = {};
          queryObj.extras.where = queryObj.extras.where
            ? `(${queryObj.extras.where}) AND (${newWhere})`
            : newWhere;
        }

        bodyPayload = {
          datasource: { id: cj.result?.datasource_id, type: cj.result?.datasource_type || 'table' },
          force: false,
          queries: [queryObj],
        };
      }

      const dr = await fetch(`${ANALYTICS}/superset/api/v1/chart/data`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(bodyPayload),
      });
      if (!dr.ok) throw new Error(`Data API ${dr.status}`);
      const dj = await dr.json();
      let result = dj.result?.[0];
      if (!result) throw new Error('No data');

      let data = result.data || [];
      let colnames = result.colnames || [];

      // If the spatial query returned no data, fall back to querying the complete unfiltered dataset
      if (data.length === 0 && isConnected && localBbox) {
        let fallbackPayload: any;
        if (qc && qc.queries && qc.queries.length > 0) {
          const query = qc.queries[0];
          query.extras.where = (query.extras as any).original_where_backup ?? "";
          fallbackPayload = qc;
        } else {
          const queryObj: any = {
            ...fd,
            slice_id: chartId,
          };
          if (config?.transformQuery) {
            config.transformQuery(queryObj, fd);
          } else {
            if (vizType === 'table' && fd.all_columns?.length) {
              queryObj.columns = fd.all_columns;
              if (!queryObj.groupby) queryObj.groupby = [];
              if (!queryObj.metrics) queryObj.metrics = [];
            }
            if (vizType === 'big_number_total' && fd.metric && !queryObj.metrics?.length) {
              queryObj.metrics = [fd.metric];
              if (!queryObj.groupby) queryObj.groupby = [];
            }
            if (vizType === 'histogram' && fd.column) {
              queryObj.columns = [fd.column];
              if (!queryObj.groupby) queryObj.groupby = [];
              if (!queryObj.metrics) queryObj.metrics = [];
            }
            if (vizType === 'heatmap' && fd.metric && !queryObj.metrics?.length) {
              queryObj.metrics = [fd.metric];
              if (!queryObj.groupby) queryObj.groupby = [fd.all_columns_x, fd.all_columns_y].filter(Boolean);
            }
            if (vizType === 'echarts_scatter' && !queryObj.metrics?.length) {
              queryObj.metrics = [];
              queryObj.columns = [fd.x, fd.y, fd.entity].filter(Boolean);
              if (!queryObj.groupby) queryObj.groupby = [];
            }
          }
          fallbackPayload = {
            datasource: { id: cj.result?.datasource_id, type: cj.result?.datasource_type || 'table' },
            force: false,
            queries: [queryObj],
          };
        }

        const drFallback = await fetch(`${ANALYTICS}/superset/api/v1/chart/data`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(fallbackPayload),
        });
        if (drFallback.ok) {
          const djFallback = await drFallback.json();
          const resFallback = djFallback.result?.[0];
          if (resFallback) {
            result = resFallback;
            data = resFallback.data || [];
            colnames = resFallback.colnames || [];
          }
        }
      }

      const metricRaw = fd.metrics?.[0] ?? fd.metric;
      const yKey: string =
        typeof metricRaw === 'string'
          ? metricRaw
          : metricRaw?.label ?? metricRaw?.column?.column_name ?? colnames[1] ?? '';

      const groupbyRaw = fd.groupby?.[0];
      const groupbyKey: string =
        typeof groupbyRaw === 'string'
          ? groupbyRaw
          : groupbyRaw?.label ?? groupbyRaw?.sqlExpression ?? '';

      const xKey: string = fd.x_axis
        ? typeof fd.x_axis === 'string' ? fd.x_axis : fd.x_axis?.label ?? ''
        : groupbyKey || colnames[0] || '';

      const resolvedX = colnames.includes(xKey) ? xKey : colnames[0] ?? '';
      const resolvedY = colnames.includes(yKey) ? yKey : colnames[1] ?? colnames[0] ?? '';

      groupByColRef.current = resolvedX;

      if (vizType === 'table') {
        const cols = fd.all_columns?.length ? fd.all_columns : colnames;
        setTableData({ cols, rows: data });
        setState('done');
        return;
      }
      if (vizType === 'big_number_total') {
        const cleanLabel = resolvedY
          .replace(/^(SUM|COUNT|AVG|MIN|MAX)\((.+)\)$/i, '$2')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
        setBigNum({ value: data[0]?.[resolvedY] ?? 0, label: cleanLabel });
        setState('done');
        return;
      }

      const ec = await getECharts();
      let tries = 0;
      while (tries < 40) {
        if (wrapRef.current && wrapRef.current.clientHeight > 10) break;
        await new Promise((r) => setTimeout(r, 50));
        tries++;
      }
      if (!wrapRef.current) return;

      ecRef.current = ec.init(wrapRef.current, null, { renderer: 'canvas' });
      ecRef.current.setOption(buildOption(vizType, data, colnames, fd, resolvedX, resolvedY), true);
      setState('done');
    } catch (e: any) {
      console.error("Chart load failed for ID:", chartId, e);
      setErrMsg(e.message);
      setState('error');
    }
  }, [token, chartId, vizType, localBbox, resolvedDatasetId, isConnected]);

  useEffect(() => {
    queueMicrotask(() => {
      fetchAndRender();
    });
  }, [fetchAndRender]);

  // ── Chart→Map click handler ────────────────────────────────────────────────
  useEffect(() => {
    if (!ecRef.current || !isConnected || !resolvedDatasetId) return;
    if (vizType !== 'pie' && vizType !== 'echarts_timeseries_bar') return;

    const handler = async (params: any) => {
      const col = groupByColRef.current;
      const val = String(params.name ?? '');
      if (!col || !val) return;

      if (
        activeFilterRef.current?.col === col &&
        activeFilterRef.current?.val === val &&
        chartFilterDatasetId === resolvedDatasetId
      ) {
        activeFilterRef.current = null;
        setChartFilter([], null);
        return;
      }

      activeFilterRef.current = { col, val };

      try {
        const qb = JSON.stringify({
          attribute_filters: [{ field: col, operator: 'equals', value: val }],
        });
        const res = await apiRequest(
          `/datasets/${resolvedDatasetId}/features/?columns=ogc_fid&page_size=5000&query_builder=${encodeURIComponent(qb)}`
        );
        const json = await res.json();
        const ids: string[] = (json.data ?? []).map((r: any) => String(r.ogc_fid));
        setChartFilter(ids, resolvedDatasetId);
      } catch {
        activeFilterRef.current = null;
      }
    };

    ecRef.current.on('click', handler);
    return () => { ecRef.current?.off('click', handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resolvedDatasetId, isConnected, vizType]);

  // ── Reset subscription ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribe(widgetId, (event) => {
      if (event.type === 'reset') {
        activeFilterRef.current = null;
        fetchAndRender();
      }
    });
    return unsub;
  }, [widgetId, subscribe, fetchAndRender]);

  // ── Resize ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => ecRef.current?.resize());
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const overlay = (() => {
    if (state === 'loading')
      return (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <Spin size="small" />
        </div>
      );
    if (state === 'error')
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center bg-white/80 z-10">
          <span className="text-red-400 text-xs font-semibold">Temporarily Unavailable</span>
          <span className="text-gray-400 text-[10px]">{errMsg || 'Failed to retrieve chart data'}</span>
        </div>
      );
    if (bigNum)
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 z-10">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
            {bigNum.label}
          </span>
          <span className="text-5xl font-black text-gray-800 tabular-nums">
            {typeof bigNum.value === 'number' ? bigNum.value.toLocaleString() : bigNum.value}
          </span>
        </div>
      );
    if (tableData)
      return (
        <div className="absolute inset-0 overflow-auto z-10">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                {tableData.cols.map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-left font-semibold text-gray-600 whitespace-nowrap"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.rows.map((row, i) => (
                <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                  {tableData.cols.map((c) => (
                    <td
                      key={c}
                      className="px-3 py-1.5 border-b border-gray-100 text-gray-700 whitespace-nowrap"
                    >
                      {row[c] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    return null;
  })();

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />
      {overlay}
    </div>
  );
}

// ── ECharts option builder ─────────────────────────────────────────────────────

function buildOption(
  vizType: string,
  data: any[],
  colnames: string[],
  fd: any,
  xKey: string,
  yKey: string
): any {
  const config = CHART_TYPES.find((c) => c.viz_type === vizType);
  if (config?.buildOption) {
    return config.buildOption(data, colnames, fd, xKey, yKey);
  }

  // Fallback simple bar chart
  const grid = { left: 15, right: 15, top: 40, bottom: 48, containLabel: true };
  const xVals = data.map((r) => r[xKey] ?? '');
  const yVals = data.map((r) => Number(r[yKey]) || 0);

  const formatAxisName = (raw: string) => {
    const cleaned = raw.replace(/^(SUM|COUNT|AVG|MIN|MAX)\((.+)\)$/i, '$2');
    return cleaned.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const catAxis: any = {
    type: 'category',
    data: xVals,
    name: formatAxisName(xKey),
    nameLocation: 'center',
    nameGap: 28,
    nameTextStyle: {
      fontSize: 11,
      color: '#6b7280',
      fontWeight: 600,
      align: 'center'
    },
    axisLabel: {
      fontSize: 11,
      color: '#6b7280',
      rotate: 20,
      interval: 0,
      overflow: 'truncate',
      width: 80,
    },
  };
  const valAxis: any = {
    type: 'value',
    name: formatAxisName(yKey),
    nameLocation: 'end',
    nameGap: 18,
    nameTextStyle: {
      fontSize: 11,
      color: '#6b7280',
      fontWeight: 600,
      align: 'left',
      padding: [0, 0, 0, -25]
    },
    axisLabel: {
      fontSize: 11,
      formatter: (val: number) => {
        if (Math.abs(val) >= 1000000) {
          return (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (Math.abs(val) >= 1000) {
          return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        return val;
      }
    },
    splitLine: { lineStyle: { color: '#f3f4f6' } },
  };
  const tip = {
    trigger: 'axis',
    backgroundColor: '#111827',
    borderColor: '#111827',
    textStyle: { color: '#fff', fontSize: 12 },
  };

  return {
    tooltip: tip,
    grid,
    xAxis: catAxis,
    yAxis: valAxis,
    series: [{ type: 'bar', data: yVals, itemStyle: { color: '#6366f1' } }],
  };
}
