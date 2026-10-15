// ============================================================================
// ChartRenderer Component (Apache ECharts & KPI Renderer)
//
// In dashboard widgets, charts are rendered dynamically:
// 1. Fetches chart query definitions (metrics, groupby columns, filters)
// 2. Dispatches query requests to the analytics backend
// 3. Dynamically imports Apache ECharts (`echarts`) only on the client
// 4. Formats data according to chart type (Bar, Line, Pie, Donut, Heatmap,
//    Big Number KPI metric, or Table view)
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import { CHART_TYPES } from '@/config/chart-types';

const ANALYTICS = process.env.NEXT_PUBLIC_ANALYTICS_URL || 'http://localhost:8000';

let ecLoaded: Promise<any> | null = null;
function getECharts(): Promise<any> {
  if (ecLoaded) return ecLoaded;
  ecLoaded = import('echarts').then(m => m);
  return ecLoaded;
}

interface Props { chartId: number; vizType: string; }

export default function ChartRenderer({ chartId, vizType }: Props) {
  const { token } = useAuthStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const ecRef = useRef<any>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [tableData, setTableData] = useState<{ cols: string[]; rows: any[] } | null>(null);
  const [bigNum, setBigNum] = useState<{ value: any; label: string } | null>(null);

  useEffect(() => {
    if (!token || !chartId) return;
    let dead = false;

    (async () => {
      setState('loading');
      setTableData(null); setBigNum(null);
      if (ecRef.current) { ecRef.current.dispose(); ecRef.current = null; }

      try {
        const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

        const cr = await fetch(`${ANALYTICS}/superset/api/v1/chart/${chartId}`, { headers: h });
        if (!cr.ok) throw new Error(`Chart API ${cr.status}`);
        const cj = await cr.json();
        const params: any = cj.result?.params ? JSON.parse(cj.result.params) : {};
        const fd: any = { ...params, slice_id: chartId };

        let bodyPayload: any;
        const config = CHART_TYPES.find((c) => c.viz_type === vizType);

        if (cj.result?.query_context) {
          try {
            bodyPayload = JSON.parse(cj.result.query_context);
            if (bodyPayload.queries && bodyPayload.queries.length > 0) {
              const query = bodyPayload.queries[0];
              if (config?.transformQuery) {
                config.transformQuery(query, fd);
              }
            }
          } catch (e) {
            console.error("Failed to parse query_context", e);
          }
        }

        if (!bodyPayload) {
          const queryObj = { ...fd };
          if (config?.transformQuery) {
            config.transformQuery(queryObj, fd);
          }
          bodyPayload = {
            datasource: { id: cj.result?.datasource_id, type: cj.result?.datasource_type || 'table' },
            force: false,
            queries: [queryObj],
          };
        }

        // Use chart's own stored params — datasource_id is chart-specific from the metadata fetch
        const dr = await fetch(`${ANALYTICS}/superset/api/v1/chart/data`, {
          method: 'POST', headers: h,
          body: JSON.stringify(bodyPayload),
        });
        if (!dr.ok) throw new Error(`Data API ${dr.status}`);
        const dj = await dr.json();
        const result = dj.result?.[0];
        if (!result) throw new Error('No data');
        if (dead) return;

        const { data = [], colnames = [] } = result;

        // Resolve x/y keys — handle all form_data shapes Superset uses
        const metricRaw = fd.metrics?.[0] ?? fd.metric;
        const yKey: string = typeof metricRaw === 'string'
          ? metricRaw
          : metricRaw?.label ?? metricRaw?.column?.column_name ?? colnames[1] ?? '';

        // groupby can be string[] or {columnType,sqlExpression}[]
        const groupbyRaw = fd.groupby?.[0];
        const groupbyKey: string = typeof groupbyRaw === 'string'
          ? groupbyRaw
          : groupbyRaw?.label ?? groupbyRaw?.sqlExpression ?? '';

        const xKey: string = fd.x_axis
          ? (typeof fd.x_axis === 'string' ? fd.x_axis : fd.x_axis?.label ?? '')
          : groupbyKey || colnames[0] || '';

        // Verify keys actually exist in data, fallback to colnames order
        const resolvedX = colnames.includes(xKey) ? xKey : colnames[0] ?? '';
        const resolvedY = colnames.includes(yKey) ? yKey : colnames[1] ?? colnames[0] ?? '';

        if (vizType === 'table') {
          const cols = fd.all_columns?.length ? fd.all_columns : colnames;
          setTableData({ cols, rows: data });
          setState('done'); return;
        }
        if (vizType === 'big_number_total') {
          const cleanLabel = resolvedY
            .replace(/^(SUM|COUNT|AVG|MIN|MAX)\((.+)\)$/i, '$2')
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
          setBigNum({ value: data[0]?.[resolvedY] ?? 0, label: cleanLabel });
          setState('done'); return;
        }

        const ec = await getECharts();
        if (dead) return;

        let tries = 0;
        while (tries < 40) {
          if (wrapRef.current && wrapRef.current.clientHeight > 10) break;
          await new Promise(r => setTimeout(r, 50));
          tries++;
        }
        if (dead || !wrapRef.current) return;

        ecRef.current = ec.init(wrapRef.current, null, { renderer: 'canvas' });
        ecRef.current.setOption(buildOption(vizType, data, colnames, fd, resolvedX, resolvedY), true);
        setState('done');
      } catch (e: any) {
        console.error("Chart load failed for ID:", chartId, e);
        if (!dead) { setErrMsg(e.message); setState('error'); }
      }
    })();

    return () => { dead = true; ecRef.current?.dispose(); ecRef.current = null; };
  }, [chartId, vizType, token]);

  // Resize whenever the wrapper changes size
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => ecRef.current?.resize());
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const overlay = (() => {
    if (state === 'loading') return (
      <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
        <Spin size="small" />
      </div>
    );
    if (state === 'error') return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center bg-white/80 z-10">
        <span className="text-red-400 text-xs font-semibold">Temporarily Unavailable</span>
        <span className="text-gray-400 text-[10px]">{errMsg || 'Failed to retrieve chart data'}</span>
      </div>
    );
    if (bigNum) return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 z-10">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">{bigNum.label}</span>
        <span className="text-5xl font-black text-gray-800 tabular-nums">
          {typeof bigNum.value === 'number' ? bigNum.value.toLocaleString() : bigNum.value}
        </span>
      </div>
    );
    if (tableData) return (
      <div className="absolute inset-0 overflow-auto z-10">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>{tableData.cols.map(c => (
              <th key={c} className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-left font-semibold text-gray-600 whitespace-nowrap">{c}</th>
            ))}</tr>
          </thead>
          <tbody>
            {tableData.rows.map((row, i) => (
              <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                {tableData.cols.map(c => (
                  <td key={c} className="px-3 py-1.5 border-b border-gray-100 text-gray-700 whitespace-nowrap">{row[c] ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    return null;
  })();

  // wrapRef div is always in DOM so ECharts can measure real dimensions
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
      <div ref={wrapRef} style={{ width: '100%', height: '100%', minHeight: 0 }} />
      {overlay}
    </div>
  );
}

function buildOption(vizType: string, data: any[], colnames: string[], fd: any, xKey: string, yKey: string): any {
  const config = CHART_TYPES.find((c) => c.viz_type === vizType);
  if (config?.buildOption) {
    return config.buildOption(data, colnames, fd, xKey, yKey);
  }

  // Fallback simple bar chart
  const grid = { left: 12, right: 12, top: 16, bottom: 12, containLabel: true };
  const xVals = data.map(r => r[xKey] ?? '');
  const yVals = data.map(r => Number(r[yKey]) || 0);
  const catAxis: any = { type: 'category', data: xVals, axisLabel: { fontSize: 11, hideOverlap: true } };
  const valAxis: any = { type: 'value', axisLabel: { fontSize: 11 }, splitLine: { lineStyle: { color: '#f3f4f6' } } };
  const tip = { trigger: 'axis', backgroundColor: '#111827', borderColor: '#111827', textStyle: { color: '#fff', fontSize: 12 } };

  return {
    tooltip: tip,
    grid,
    xAxis: catAxis,
    yAxis: valAxis,
    series: [{ type: 'bar', data: yVals, itemStyle: { color: '#6366f1' } }]
  };
}
