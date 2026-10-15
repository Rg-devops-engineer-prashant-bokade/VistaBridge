import { LineChart } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric, getStandardGrid, getStandardTooltip, getStandardCategoryAxis, getStandardValueAxis } from '../utils';

/**
 * Line Chart Configuration
 * Visualizes trends over time or ordered dimension values using continuous line segments.
 */
export const lineConfig: ChartTypeConfig = {
  viz_type: 'echarts_timeseries_line',
  label: 'Line Chart',
  icon: LineChart,
  description: 'Show trends over time',
  defaultW: 6,
  defaultH: 9,
  fields: [
    { key: 'x_axis', label: 'X-Axis (Time / Dimension)', role: 'time', required: true },
    { key: 'metric', label: 'Metric', role: 'metric', required: true },
  ],
  buildParams: (v) => ({
    x_axis: v.x_axis,
    metrics: [resolveMetric(v.metric)],
    groupby: [v.x_axis],
    adhoc_filters: [],
    row_limit: 1000,
  }),
  buildOption: (data, colnames, fd, xKey, yKey) => {
    const xVals = data.map((r) => r[xKey] ?? '');
    const yVals = data.map((r) => Number(r[yKey]) || 0);
    return {
      tooltip: getStandardTooltip(),
      grid: getStandardGrid(),
      xAxis: getStandardCategoryAxis(xVals, xKey),
      yAxis: getStandardValueAxis(yKey),
      series: [
        {
          type: 'line',
          data: yVals,
          smooth: false,
          color: '#0ea5e9',
          symbol: yVals.length === 1 ? 'circle' : 'none',
          symbolSize: yVals.length === 1 ? 6 : 4,
          lineStyle: { width: 2 },
        },
      ],
    };
  },
};
