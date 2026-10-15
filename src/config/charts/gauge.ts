import { Gauge } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric } from '../utils';

/**
 * Gauge Chart Configuration
 * Visualizes a single numeric KPI against a circular speedometer dial.
 */
export const gaugeConfig: ChartTypeConfig = {
  viz_type: 'gauge_chart',
  label: 'Gauge',
  icon: Gauge,
  description: 'Show a single KPI as a gauge meter',
  defaultW: 4,
  defaultH: 7,
  fields: [
    { key: 'metric', label: 'Metric', role: 'metric', required: true },
  ],
  buildParams: (v) => ({
    metric: resolveMetric(v.metric),
    adhoc_filters: [],
  }),
  buildOption: (data, colnames, fd, xKey, yKey) => {
    const val = Number(data[0]?.[yKey]) || 0;
    return {
      series: [
        {
          type: 'gauge',
          radius: '88%',
          progress: { show: true, width: 14, itemStyle: { color: '#6366f1' } },
          axisLine: { lineStyle: { width: 14, color: [[1, '#e5e7eb']] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { fontSize: 10, color: '#9ca3af', distance: 20 },
          pointer: { itemStyle: { color: '#6366f1' } },
          detail: {
            valueAnimation: true,
            fontSize: 26,
            fontWeight: 'bold',
            color: '#111827',
            offsetCenter: [0, '65%'],
          },
          title: { fontSize: 11, color: '#9ca3af', offsetCenter: [0, '88%'] },
          data: [{ value: Math.round(val * 100) / 100, name: yKey }],
        },
      ],
    };
  },
};
