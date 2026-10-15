// ============================================================================
// ChartFormFields Component (Chart Query Configuration Form)
//
// Dynamically renders the appropriate configuration form inputs
// depending on the selected chart type (Bar, Line, Pie, Area):
// - Metrics dropdown (Count, Sum, Average)
// - Group-by / Dimensions dropdown (Categorical columns)
// - Time grain / Temporal columns for time-series trends
// ============================================================================

'use client';

import { Form, Select, Spin } from 'antd';
import { ChartTypeConfig } from '@/config/chart-types';

export interface SupersetColumn {
  column_name: string;
  type: string;
  is_dttm: boolean;
}

export interface SupersetMetric {
  metric_name: string;
  verbose_name?: string;
}

interface Props {
  chartType: ChartTypeConfig;
  columns: SupersetColumn[];
  metrics: SupersetMetric[];
  loading: boolean;
}

const fieldLabel = (text: string) => (
  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{text}</span>
);

export default function ChartFormFields({ chartType, columns, metrics, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spin size="small" />
        <span className="ml-2 text-xs text-gray-400">Loading dataset columns...</span>
      </div>
    );
  }

  const formatLabel = (name: string) => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const dimensionOptions = columns.map((c) => ({ label: formatLabel(c.column_name), value: c.column_name }));
  const timeOptions = columns
    .filter((c) => c.is_dttm)
    .map((c) => ({ label: formatLabel(c.column_name), value: c.column_name }));
  const allColumnOptions = columns.map((c) => ({
    label: formatLabel(c.column_name),
    value: c.column_name,
  }));
  const metricOptions = [
    { label: 'Total Count', value: 'count' },
    ...metrics
      .filter((m) => m.metric_name !== 'count')
      .map((m) => ({ label: m.verbose_name || formatLabel(m.metric_name), value: m.metric_name })),
    ...columns
      .filter((c) =>
        ['INTEGER', 'FLOAT', 'NUMERIC', 'DOUBLE', 'BIGINT', 'DECIMAL'].some((t) =>
          c.type?.toUpperCase().includes(t)
        )
      )
      .map((c) => ({ label: `SUM(${formatLabel(c.column_name)})`, value: `sum__${c.column_name}` })),
  ];

  return (
    <Form.Item noStyle shouldUpdate>
      {({ getFieldValue, setFieldValue }) => {
        // Collect currently selected dimension/x-axis values
        const selectedXValues = chartType.fields
          .filter(f => f.role !== 'metric')
          .map(f => getFieldValue(f.key))
          .filter(Boolean);

        // Collect currently selected metric values (stripping sum__ prefix if present)
        const selectedYValues = chartType.fields
          .filter(f => f.role === 'metric')
          .map(f => {
            const val = getFieldValue(f.key);
            if (!val) return null;
            return typeof val === 'string' && val.startsWith('sum__') ? val.replace('sum__', '') : val;
          })
          .filter(Boolean);

        return (
          <>
            {chartType.fields.map((field) => {
              let rawOptions: { label: string; value: string }[] = [];
              if (field.role === 'metric') rawOptions = metricOptions;
              else if (field.role === 'time') rawOptions = timeOptions.length ? timeOptions : dimensionOptions;
              else if (field.role === 'columns') rawOptions = allColumnOptions;
              else rawOptions = dimensionOptions;

              // Filter out values selected in opposing axis
              const options = rawOptions.filter((opt) => {
                if (field.role === 'metric') {
                  return !selectedXValues.includes(opt.value);
                } else {
                  return !selectedYValues.includes(opt.value);
                }
              });

              return (
                <Form.Item
                  key={field.key}
                  name={field.key}
                  label={fieldLabel(field.label)}
                  rules={field.required ? [{ required: true, message: `${field.label} is required` }] : []}
                >
                  <Select
                    mode={field.multi ? 'multiple' : undefined}
                    placeholder={columns.length === 0 ? 'Select a dataset first' : `Select ${field.label}`}
                    disabled={columns.length === 0}
                    options={options}
                    showSearch
                    filterOption={(input, opt) =>
                      (opt?.label as string)?.toLowerCase().includes(input.toLowerCase())
                    }
                    onChange={(val) => {
                      if (field.role === 'metric') {
                        const col = typeof val === 'string' && val.startsWith('sum__') ? val.replace('sum__', '') : val;
                        chartType.fields.filter(f => f.role !== 'metric').forEach(f => {
                          if (getFieldValue(f.key) === col) {
                            setFieldValue(f.key, undefined);
                          }
                        });
                      } else {
                        chartType.fields.filter(f => f.role === 'metric').forEach(f => {
                          const yVal = getFieldValue(f.key);
                          const yCol = typeof yVal === 'string' && yVal.startsWith('sum__') ? yVal.replace('sum__', '') : yVal;
                          if (yCol === val) {
                            setFieldValue(f.key, undefined);
                          }
                        });
                      }
                    }}
                  />
                </Form.Item>
              );
            })}
          </>
        );
      }}
    </Form.Item>
  );
}
