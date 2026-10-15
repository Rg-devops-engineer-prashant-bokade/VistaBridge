import { ScatterChart } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { getStandardGrid, formatAxisName } from '../utils';

/**
 * Scatter Plot Configuration
 * Plots two continuous numeric variables to display correlation, clusters, and distribution patterns.
 */
export const scatterConfig: ChartTypeConfig = {
  viz_type: 'echarts_scatter',
  label: 'Scatter Plot',
  icon: ScatterChart,
  description: 'Show correlation between two metrics',
  defaultW: 6,
  defaultH: 9,
  fields: [
    { key: 'x_axis', label: 'X-Axis Column', role: 'x_axis', required: true },
    { key: 'y_axis', label: 'Y-Axis Column', role: 'y_axis', required: true },
    { key: 'entity', label: 'Entity (Label column)', role: 'dimension', required: false },
  ],
  buildParams: (v) => ({
    x: v.x_axis,
    y: v.y_axis,
    entity: v.entity || null,
    adhoc_filters: [],
    row_limit: 1000,
  }),
  transformQuery: (queryObj, fd) => {
    // echarts_scatter: needs metrics array, columns instead of groupby
    queryObj.metrics = [];
    queryObj.columns = [fd.x, fd.y, fd.entity].filter(Boolean);
    queryObj.groupby = [];
  },
  buildOption: (data, colnames, fd, _xKey, _yKey) => {
    const xK = fd.x ?? colnames[0];
    const yK = fd.y ?? colnames[1];
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#111827',
        borderColor: '#111827',
        textStyle: { color: '#fff' },
        formatter: (p: { value: [number, number] }) => `${p.value[0]}, ${p.value[1]}`,
      },
      grid: getStandardGrid(),
      xAxis: {
        type: 'value',
        name: formatAxisName(xK),
        nameLocation: 'center',
        nameGap: 28,
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { color: '#f3f4f6' } }
      },
      yAxis: {
        type: 'value',
        name: formatAxisName(yK),
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { color: '#f3f4f6' } }
      },
      series: [
        {
          type: 'scatter',
          data: data.map((r) => [Number(r[xK]) || 0, Number(r[yK]) || 0]),
          symbolSize: 7,
          itemStyle: { color: '#6366f1', opacity: 0.7 },
        },
      ],
    };
  },
};
