import { Grid3x3 } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric } from '../utils';

/**
 * Heatmap Configuration
 * Displays value intensity across a 2-dimensional grid (X and Y dimension categories).
 */
export const heatmapConfig: ChartTypeConfig = {
  viz_type: 'heatmap',
  label: 'Heatmap',
  icon: Grid3x3,
  description: 'Show intensity across two dimensions',
  defaultW: 8,
  defaultH: 10,
  fields: [
    { key: 'x_axis', label: 'X-Axis (Dimension)', role: 'dimension', required: true },
    { key: 'y_axis', label: 'Y-Axis (Dimension)', role: 'dimension', required: true },
    { key: 'metric', label: 'Metric (Value)', role: 'metric', required: true },
  ],
  buildParams: (v) => ({
    all_columns_x: v.x_axis,
    all_columns_y: v.y_axis,
    metric: resolveMetric(v.metric),
    adhoc_filters: [],
    row_limit: 1000,
  }),
  transformQuery: (queryObj, fd) => {
    // heatmap: metric is singular, wrap to array, group by dimensions in groupby
    if (fd.metric && !queryObj.metrics?.length) {
      queryObj.metrics = [fd.metric];
    }
    queryObj.groupby = [fd.all_columns_x, fd.all_columns_y].filter(Boolean);
    queryObj.columns = [];
  },
  buildOption: (data, colnames, fd, xKey, yKey) => {
    const xK = fd.all_columns_x ?? colnames[0];
    const yK = fd.all_columns_y ?? colnames[1];
    const vK = yKey || (colnames[2] ?? colnames[0]);
    const xCats = [...new Set(data.map((r) => String(r[xK] ?? '')))];
    const yCats = [...new Set(data.map((r) => String(r[yK] ?? '')))];
    const heatData = data.map((r) => [
      xCats.indexOf(String(r[xK] ?? '')),
      yCats.indexOf(String(r[yK] ?? '')),
      Number(r[vK]) || 0,
    ]);
    const maxVal = heatData.length ? Math.max(...heatData.map((d) => d[2] as number), 1) : 1;
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#111827',
        borderColor: '#111827',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: { value: [number, number, number] }) => `${xCats[p.value[0]]}, ${yCats[p.value[1]]}: <b>${p.value[2]}</b>`,
      },
      grid: { left: 15, right: 80, top: 20, bottom: 18, containLabel: true },
      xAxis: { type: 'category', data: xCats, axisLabel: { fontSize: 10, rotate: 20 } },
      yAxis: { type: 'category', data: yCats, axisLabel: { fontSize: 10 } },
      visualMap: { min: 0, max: maxVal, calculable: true, orient: 'vertical', right: 0, top: 'center', itemHeight: 80, textStyle: { fontSize: 10 }, inRange: { color: ['#e0f2fe', '#0284c7'] } },
      series: [{ type: 'heatmap', data: heatData, emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } } }],
    };
  },
};
