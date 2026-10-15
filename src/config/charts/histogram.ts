import { BarChart2 } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { getStandardGrid, formatAxisName } from '../utils';

/**
 * Histogram Configuration
 * Bins a single numeric column into equal intervals to visualize frequency distribution.
 */
export const histogramConfig: ChartTypeConfig = {
  viz_type: 'histogram',
  label: 'Histogram',
  icon: BarChart2,
  description: 'Show frequency distribution of a numeric column',
  defaultW: 6,
  defaultH: 9,
  fields: [
    { key: 'column', label: 'Numeric Column', role: 'dimension', required: true },
  ],
  buildParams: (v) => ({
    column: v.column,
    groupby: [],
    adhoc_filters: [],
    row_limit: 1000,
    bins: 10,
    cumulative: false,
    normalize: false,
  }),
  transformQuery: (queryObj, fd) => {
    // histogram uses `column` not groupby/metrics in columns array
    if (fd.column) {
      queryObj.columns = [fd.column];
    }
    queryObj.groupby = [];
    queryObj.metrics = [];
  },
  buildOption: (data, colnames, fd, _xKey, _yKey) => {
    const col = fd.column ?? colnames[0];
    const vals = data.map((r) => Number(r[col]) || 0).filter((v) => !isNaN(v));
    const bins = fd.bins ?? 10;
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 100;
    const binSize = (max - min) / bins || 1;
    const counts = Array(bins).fill(0);
    vals.forEach((v) => {
      const idx = Math.min(Math.floor((v - min) / binSize), bins - 1);
      if (idx >= 0 && idx < bins) {
        counts[idx]++;
      }
    });
    const labels = counts.map((_, i) => `${(min + i * binSize).toFixed(1)}–${(min + (i + 1) * binSize).toFixed(1)}`);
    return {
      tooltip: { trigger: 'axis', backgroundColor: '#111827', borderColor: '#111827', textStyle: { color: '#fff', fontSize: 12 } },
      grid: getStandardGrid(),
      xAxis: {
        type: 'category',
        data: labels,
        name: formatAxisName(col),
        nameLocation: 'center',
        nameGap: 38,
        nameTextStyle: { fontSize: 11, color: '#6b7280', fontWeight: 600 },
        axisLabel: { fontSize: 11, rotate: 20, interval: 0, overflow: 'truncate', width: 80 },
      },
      yAxis: {
        type: 'value',
        name: 'Frequency',
        nameLocation: 'end',
        nameGap: 18,
        nameTextStyle: { fontSize: 11, color: '#6b7280', fontWeight: 600 },
        axisLabel: {
          fontSize: 11,
          formatter: (val: number) => {
            if (Math.abs(val) >= 1000000) return (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
            return val;
          },
        },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: [{ type: 'bar', data: counts, itemStyle: { color: '#8b5cf6', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 48 }],
    };
  },
};
