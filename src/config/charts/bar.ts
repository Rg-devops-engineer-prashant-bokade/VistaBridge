import { BarChart3 } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric, getStandardGrid, getStandardTooltip, getStandardCategoryAxis, getStandardValueAxis } from '../utils';

/**
 * Bar Chart Configuration
 * Renders categorical dimension data compared against numeric metric values.
 */
export const barConfig: ChartTypeConfig = {
  viz_type: 'echarts_timeseries_bar',
  label: 'Bar Chart',
  icon: BarChart3,
  description: 'Compare values across categories',
  defaultW: 6,
  defaultH: 9,
  fields: [
    { key: 'x_axis', label: 'X-Axis (Dimension)', role: 'dimension', required: true },
    { key: 'metric', label: 'Metric (Y-Axis)', role: 'metric', required: true },
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
          type: 'bar',
          data: yVals,
          itemStyle: { borderRadius: [4, 4, 0, 0], color: '#0ea5e9' },
          barMaxWidth: 48,
        },
      ],
    };
  },
};
