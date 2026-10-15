// ============================================================================
// Chart Query & Format Utilities (utils.ts)
//
// Shared helpers for dashboard chart queries and ECharts rendering:
// - resolveMetric: Converts metric strings into SQL aggregate expressions (COUNT, SUM)
// - formatAxisName: Cleans up axis labels for readable display
// - createEChartsAxis: Builds standard grid axis configuration options
// ============================================================================

export type ResolvedMetric =
  | string
  | {
      expressionType: string;
      sqlExpression?: string;
      column?: { column_name: string };
      aggregate?: string;
      label: string;
    };

export function resolveMetric(value: string): ResolvedMetric {
  if (value === 'count') {
    return {
      expressionType: 'SQL',
      sqlExpression: 'COUNT(*)',
      label: 'COUNT(*)',
    };
  }
  if (value.startsWith('sum__')) {
    const col = value.slice(5);
    return {
      expressionType: 'SIMPLE',
      column: { column_name: col },
      aggregate: 'SUM',
      label: `SUM(${col})`,
    };
  }
  // Assume it's a saved metric name (returned as-is)
  return value;
}

// Clean up axis label text: strip aggregation prefixes like "SUM(population)" → "Population"
export function formatAxisName(raw: string): string {
  const cleaned = raw.replace(/^(SUM|COUNT|AVG|MIN|MAX)\((.+)\)$/i, '$2');
  return cleaned.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getStandardGrid(hasXName: boolean = true) {
  return { left: 15, right: 15, top: 40, bottom: hasXName ? 48 : 20, containLabel: true };
}

export function getStandardTooltip() {
  return {
    trigger: 'axis',
    backgroundColor: '#111827',
    borderColor: '#111827',
    textStyle: { color: '#fff', fontSize: 12 },
  };
}

export function getStandardCategoryAxis(xVals: (string | number)[], xKey: string): Record<string, unknown> {
  const needsRotation = xVals.length > 8 && (xVals.length > 12 || xVals.some((v) => String(v).length > 3));
  return {
    type: 'category',
    data: xVals,
    name: formatAxisName(xKey),
    nameLocation: 'center',
    nameGap: needsRotation ? 34 : 24,
    nameTextStyle: {
      fontSize: 11,
      color: '#6b7280',
      fontWeight: 600,
      align: 'center'
    },
    axisLabel: {
      fontSize: 11,
      color: '#6b7280',
      rotate: needsRotation ? 20 : 0,
      interval: 0,
      overflow: 'truncate',
      width: 80,
    },
  };
}

export function getStandardValueAxis(yKey: string): Record<string, unknown> {
  return {
    type: 'value',
    name: formatAxisName(yKey),
    nameLocation: 'end',
    nameGap: 18,
    nameTextStyle: {
      fontSize: 11,
      color: '#6b7280',
      fontWeight: 600,
      align: 'left',
      padding: [0, 0, 0, -25]
    },
    axisLabel: {
      fontSize: 11,
      formatter: (val: number) => {
        if (Math.abs(val) >= 1000000) {
          return (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (Math.abs(val) >= 1000) {
          return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        }
        return val;
      }
    },
    splitLine: { lineStyle: { color: '#f3f4f6' } },
  };
}
