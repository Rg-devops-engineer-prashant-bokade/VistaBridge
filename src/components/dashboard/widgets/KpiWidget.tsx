// ============================================================================
// KpiWidget Component (Single Metric / Summary Card)
//
// In GIS dashboards, KPI cards display high-level numbers at a glance:
// - Example: "Total Population: 2,450,000" or "Active Assets: 84"
//
// This component queries aggregate metrics from the analytics backend and
// dynamically updates the count when the user pans/zooms the map extent.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from '@/store/useAuthStore';
import { useDashboardStore } from '@/store/useDashboardStore';

const ANALYTICS = process.env.NEXT_PUBLIC_ANALYTICS_URL || 'http://localhost:8000';

interface Props {
  widgetId: string;
  chartId: number;
  label?: string;
  /** Optional prefix symbol, e.g. "$" */
  prefix?: string;
  /** Optional suffix symbol, e.g. "%" */
  suffix?: string;
}

export default function KpiWidget({ widgetId, chartId, label, prefix = '', suffix = '' }: Props) {
  const { token } = useAuthStore();
  const { bbox, activeMapDatasetIds, subscribe } = useDashboardStore();
  const [value, setValue] = useState<string | number | null>(null);
  const [metricLabel, setMetricLabel] = useState(label ?? '');
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [resolvedDatasetId, setResolvedDatasetId] = useState<string | null>(null);

  // The KPI is connected to the map IF its dataset is active as a layer in the map widget
  const isConnected = !!(resolvedDatasetId && activeMapDatasetIds.includes(resolvedDatasetId));

  // localBbox is synced with bbox ONLY if the KPI is connected to the map.
  // This prevents unconnected KPIs from re-fetching on map pan/zoom.
  const localBbox = isConnected ? bbox : null;

  const fetchKpi = useCallback(async () => {
    if (!token || !chartId) return;
    setState('loading');
    try {
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

      const cr = await fetch(`${ANALYTICS}/superset/api/v1/chart/${chartId}`, { headers: h });
      if (!cr.ok) throw new Error(`Chart API ${cr.status}`);
      const cj = await cr.json();
      const fd: any = cj.result?.params ? JSON.parse(cj.result.params) : {};

      let qc: any = null;
      if (cj.result?.query_context) {
        try {
          qc = JSON.parse(cj.result.query_context);
        } catch (e) {
          console.error("Failed to parse query_context", e);
        }
      }

      // Auto-extract UUID from table name
      if (!resolvedDatasetId && cj.result?.datasource_name_text) {
        const dsName = cj.result.datasource_name_text;
        const match = dsName.match(/(?:vistamap|vistabridge)_ds_([a-f0-9_]+)/i);
        const extractedUuid = match ? match[1].replace(/_/g, '-') : null;
        if (extractedUuid) {
          setResolvedDatasetId(extractedUuid);
        }
      }

      let bodyPayload: any;
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

        query.row_limit = 1;
        bodyPayload = qc;
      } else {
        let newWhere = "";
        if (isConnected && localBbox) {
          const [minLon, minLat, maxLon, maxLat] = localBbox;
          console.log('[KpiWidget] Passing bbox to server side call:', localBbox);
          newWhere = `ST_Intersects(geom, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))`;
        }

        const queryObj: any = {
          ...fd,
          row_limit: 1,
        };

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
            row_limit: 1,
          };
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

      const metricRaw = fd.metric ?? fd.metrics?.[0];
      const yKey: string =
        typeof metricRaw === 'string'
          ? metricRaw
          : metricRaw?.label ?? metricRaw?.column?.column_name ?? colnames[0] ?? '';

      const resolvedKey = colnames.includes(yKey) ? yKey : colnames[0] ?? '';
      const raw = data[0]?.[resolvedKey] ?? 0;

      setValue(typeof raw === 'number' ? raw : raw);
      if (!label) setMetricLabel(resolvedKey);
      setState('done');
    } catch (e: any) {
      setErrMsg(e.message);
      setState('error');
    }
  }, [token, chartId, label, localBbox, resolvedDatasetId, isConnected]);

  useEffect(() => {
    queueMicrotask(() => {
      fetchKpi();
    });
  }, [fetchKpi]);

  useEffect(() => {
    const unsub = subscribe(widgetId, (event) => {
      if (event.type === 'reset') fetchKpi();
    });
    return unsub;
  }, [widgetId, subscribe, fetchKpi]);

  if (state === 'loading')
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Spin size="small" />
      </div>
    );

  if (state === 'error')
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-3 text-center">
        <span className="text-red-400 text-xs font-semibold">Failed to load</span>
        <span className="text-gray-400 text-[10px]">{errMsg}</span>
      </div>
    );

  const display =
    typeof value === 'number'
      ? `${prefix}${value.toLocaleString()}${suffix}`
      : `${prefix}${value}${suffix}`;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 select-none">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-center px-2">
        {metricLabel}
      </span>
      <span className="text-4xl font-black text-gray-800 tabular-nums">{display}</span>
    </div>
  );
}
