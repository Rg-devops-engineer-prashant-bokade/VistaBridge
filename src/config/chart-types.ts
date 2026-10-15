// ============================================================================
// Supported Chart Types Registry (chart-types.ts)
//
// Defines the catalog of visualizations supported in the dashboard:
// - Metadata: Display name, Lucide icon, default grid dimensions (W x H)
// - Form fields schema: Required metrics and grouping dimensions
// - Query builders: Translates form inputs into analytics query requests
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LucideIcon } from 'lucide-react';

export type FieldRole =
  | 'metric'
  | 'dimension'
  | 'time'
  | 'x_axis'
  | 'y_axis'
  | 'columns';

export interface ChartFormField {
  key: string;
  label: string;
  role: FieldRole;
  required: boolean;
  multi?: boolean;
}

export interface ChartTypeConfig {
  viz_type: string;
  label: string;
  icon: LucideIcon;
  description: string;
  defaultW: number;
  defaultH: number;
  fields: ChartFormField[];
  buildParams: (values: Record<string, any>) => Record<string, any>;
  
  // Custom query object transformation for /chart/data POST request
  transformQuery?: (queryObj: any, fd: any) => void;
  
  // ECharts option builder
  buildOption?: (data: any[], colnames: string[], fd: any, xKey: string, yKey: string) => any;
}

import { barConfig } from './charts/bar';
import { lineConfig } from './charts/line';
import { areaConfig } from './charts/area';
import { donutConfig } from './charts/donut';
import { scatterConfig } from './charts/scatter';
import { histogramConfig } from './charts/histogram';
import { heatmapConfig } from './charts/heatmap';
import { gaugeConfig } from './charts/gauge';
import { bigNumberConfig } from './charts/bignumber';
import { tableConfig } from './charts/table';

export const CHART_TYPES: ChartTypeConfig[] = [
  barConfig,
  lineConfig,
  areaConfig,
  scatterConfig,
  donutConfig,
  histogramConfig,
  heatmapConfig,
  gaugeConfig,
  bigNumberConfig,
  tableConfig,
];


