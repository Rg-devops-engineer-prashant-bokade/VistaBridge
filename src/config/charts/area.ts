import { AreaChart } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric, getStandardGrid, getStandardTooltip, getStandardCategoryAxis, getStandardValueAxis } from '../utils';

/**
 * Area Chart Configuration
 * Renders timeseries data with an area fill under the line to illustrate cumulative trends.
 */
export const areaConfig: ChartTypeConfig = {
  viz_type: 'echarts_timeseries_area',
  label: 'Area Chart',
  icon: AreaChart,
  description: 'Show cumulative trends over time',
  defaultW: 6,
  defaultH: 9,
  fields: [
    { key: 'x_axis', label: 'X-Axis (Time)', role: 'time', required: true },
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
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(14, 165, 233, 0.35)' },
                { offset: 1, color: 'rgba(14, 165, 233, 0.02)' },
              ],
            },
          },
        },
      ],
    };
  },
};
