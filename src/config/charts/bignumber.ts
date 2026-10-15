import { Hash } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';
import { resolveMetric } from '../utils';

/**
 * Big Number (KPI) Configuration
 * Displays a single aggregated metric value as an executive stat card.
 */
export const bigNumberConfig: ChartTypeConfig = {
  viz_type: 'big_number_total',
  label: 'Big Number',
  icon: Hash,
  description: 'Display a single large KPI value',
  defaultW: 3,
  defaultH: 5,
  fields: [
    { key: 'metric', label: 'Metric', role: 'metric', required: true },
  ],
  buildParams: (v) => ({
    metric: resolveMetric(v.metric),
    adhoc_filters: [],
  }),
  transformQuery: (queryObj, fd) => {
    // Superset /chart/data expects `metrics` as array for big_number_total
    if (fd.metric && !queryObj.metrics?.length) {
      queryObj.metrics = [fd.metric];
    }
    queryObj.groupby = [];
  },
};
