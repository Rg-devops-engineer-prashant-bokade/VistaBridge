import { Table2 } from 'lucide-react';
import { ChartTypeConfig } from '../chart-types';

/**
 * Table Widget Configuration
 * Displays raw or aggregated data in tabular format with selectable columns and groupings.
 */
export const tableConfig: ChartTypeConfig = {
  viz_type: 'table',
  label: 'Table',
  icon: Table2,
  description: 'Display raw or aggregated tabular data',
  defaultW: 8,
  defaultH: 9,
  fields: [
    { key: 'columns', label: 'Columns to display', role: 'columns', required: true, multi: true },
    { key: 'groupby', label: 'Group By (optional)', role: 'dimension', required: false, multi: true },
  ],
  buildParams: (v) => ({
    all_columns: Array.isArray(v.columns) ? v.columns : [v.columns],
    groupby: v.groupby ? (Array.isArray(v.groupby) ? v.groupby : [v.groupby]) : [],
    adhoc_filters: [],
    row_limit: 1000,
  }),
  transformQuery: (queryObj, fd) => {
    // Superset /chart/data expects `columns` not `all_columns` for table viz
    if (fd.all_columns?.length) {
      queryObj.columns = fd.all_columns;
    }
    queryObj.groupby = [];
    queryObj.metrics = [];
  },
};
