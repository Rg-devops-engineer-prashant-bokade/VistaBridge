import { Donut } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric } from '../utils';

/**
 * Donut Chart Configuration
 * Renders categorical proportional distribution with a hollow center.
 */
export const donutConfig: ChartTypeConfig = {
  viz_type: 'donut',
  label: 'Donut Chart',
  icon: Donut,
  description: 'Pie chart with a hollow center',
  defaultW: 7,
  defaultH: 11,
  fields: [
    { key: 'groupby', label: 'Dimension (Slice by)', role: 'dimension', required: true },
    { key: 'metric', label: 'Metric (Value)', role: 'metric', required: true },
  ],
  buildParams: (v) => ({
    groupby: [v.groupby],
    metrics: [resolveMetric(v.metric)],
    adhoc_filters: [],
    row_limit: 100,
    donut: true,
    innerRadius: 40,
  }),
  transformQuery: (queryObj, fd) => {
    // Superset /chart/data expects `columns` instead of `groupby` for non-timeseries categorical charts
    if (fd.groupby?.length) {
      queryObj.columns = fd.groupby;
      queryObj.groupby = [];
    }
    if (fd.metric && !queryObj.metrics?.length) {
      queryObj.metrics = [fd.metric];
    }
  },
  buildOption: (data, colnames, fd, xKey, yKey) => {
    const pieData = data.map((r) => ({
      name: String(r[xKey] ?? ''),
      value: Number(r[yKey]) || 0,
    }));
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#111827',
        borderColor: '#111827',
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: { name: string; value: number; percent?: number }) =>
          `<b>${p.name}</b><br/>${yKey}: ${p.value.toLocaleString()} (${p.percent}%)`,
      },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 8,
        top: 'middle',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11, color: '#6b7280' },
        formatter: (n: string) => (n.length > 20 ? n.slice(0, 20) + '…' : n),
      },
      series: [
        {
          type: 'pie',
          radius: ['40%', '68%'],
          center: ['36%', '50%'],
          data: pieData,
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 5,
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.15)' },
          },
          itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: '#fff' },
        },
      ],
    };
  },
};
