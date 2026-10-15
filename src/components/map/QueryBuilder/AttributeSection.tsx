// ============================================================================
// AttributeSection Component
//
// Allows users to filter GIS layer features using attribute values:
// - Fetches the layer's schema (column names and data types like string/number)
// - Lets users add multiple condition rows: [Field] [Operator] [Value]
//   (e.g., [City] [equals] ['New York'], [Population] [>] [100000])
// - Fetches distinct values for selected columns to provide autocomplete suggestions
// - Combines rows using AND / OR logical operators
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { Select, Button, Input, Radio, Spin, Tooltip, AutoComplete } from 'antd';
import { Plus, Trash2, FlipHorizontal } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { ATTRIBUTE_OPERATORS, OPERATORS_BY_TYPE, SKIP_FIELD_TYPES, DEFAULT_OPERATOR_BY_TYPE } from './constants';
import type { AttributeFilter, FilterCondition, QueryBuilderPayload } from './types';

export interface AttributeSectionHandle {
  buildPayload: () => QueryBuilderPayload | null;
  validate: () => boolean;
  fill: (payload: QueryBuilderPayload) => void;
  reset: () => void;
}

interface Props {
  layerId: string;
  enabled: boolean;
}

interface FilterRow {
  id: string;
  field: string;
  operator: string;
  value: any;
  error?: string;
}

// Generates an initial blank condition row
const emptyRow = (): FilterRow => ({
  id: Math.random().toString(36).slice(2),
  field: '',
  operator: 'equals',
  value: '',
});

const AttributeSection = forwardRef<AttributeSectionHandle, Props>(({ layerId, enabled }, ref) => {
  const [filterCondition, setFilterCondition] = useState<FilterCondition>('AND');
  const [rows, setRows] = useState<FilterRow[]>([emptyRow()]);
  const [schema, setSchema] = useState<Record<string, string>>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [distinctValues, setDistinctValues] = useState<Record<string, string[]>>({});
  const distinctRef = useRef<Record<string, string[]>>({});
  useEffect(() => { distinctRef.current = distinctValues; }, [distinctValues]);

  // Reload schema when layer changes, reset rows
  useEffect(() => {
    if (!layerId) { setSchema({}); setRows([emptyRow()]); return; }
    setSchemaLoading(true);
    setRows([emptyRow()]);
    setDistinctValues({});
    distinctRef.current = {};
    apiRequest(`/datasets/${layerId}/`)
      .then(r => r.json())
      .then(d => {
        const raw = d.metadata?.attributes_schema || {};
        // ogrinfo stores types as capitalized ("String", "Integer", "Real") — normalize to lowercase
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          const t = String(v).toLowerCase();
          normalized[k] = t === 'real' ? 'float' : t;
        }
        setSchema(normalized);
      })
      .catch(() => setSchema({}))
      .finally(() => setSchemaLoading(false));
  }, [layerId]);

  // Geometry field names to always hide (common across PostGIS, OGR, GeoServer)
  const GEOM_FIELD_NAME_PATTERNS = [
    'the_geom', 'geom', 'geometry', 'wkb_geometry', 'wkt_geometry',
    'shape', 'msgeometry', 'geometria',
  ];

  // Only expose fields that are not json/geometry types or known geometry column names
  const fields = Object.entries(schema)
    .filter(([name, type]) => {
      if (SKIP_FIELD_TYPES.has(type)) return false;
      const n = name.toLowerCase();
      if (GEOM_FIELD_NAME_PATTERNS.includes(n)) return false;
      if (n.endsWith('_geom') || n.endsWith('_geometry') || n.endsWith('_shape')) return false;
      return true;
    })
    .map(([name, type]) => ({ name, type }));

  const fetchDistincts = useCallback(async (field: string) => {
    if (!layerId || !field || distinctRef.current[field] !== undefined) return;
    distinctRef.current[field] = [];
    try {
      const res = await apiRequest(`/datasets/${layerId}/distincts/features/`, {
        method: 'POST',
        body: JSON.stringify({ fields: [field] }),
      });
      const json = await res.json();
      const vals = res.ok ? json[field]?.map(String) ?? [] : [];
      setDistinctValues(prev => ({ ...prev, [field]: vals }));
    } catch {
      setDistinctValues(prev => ({ ...prev, [field]: [] }));
    }
  }, [layerId]);

  const updateRow = (id: string, patch: Partial<FilterRow>) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch, error: undefined } : r));

  const handleFieldChange = (id: string, field: string) => {
    const fieldType = schema[field] || 'string';
    const defaultOp = DEFAULT_OPERATOR_BY_TYPE[fieldType] || 'equals';
    const opMeta = ATTRIBUTE_OPERATORS.find(o => o.value === defaultOp)!;
    const defaultValue = opMeta.valueType === 'range' ? ['', ''] : opMeta.valueType === 'multi' ? [] : '';
    updateRow(id, { field, operator: defaultOp, value: defaultValue });
    fetchDistincts(field);
  };

  const handleOperatorChange = (id: string, operator: string) => {
    const opMeta = ATTRIBUTE_OPERATORS.find(o => o.value === operator)!;
    const newValue = opMeta.valueType === 'range' ? ['', ''] : opMeta.valueType === 'multi' ? [] : '';
    updateRow(id, { operator, value: newValue });
  };

  const validate = (): boolean => {
    let valid = true;
    setRows(prev => prev.map(r => {
      const opMeta = ATTRIBUTE_OPERATORS.find(o => o.value === r.operator);
      if (!r.field) { valid = false; return { ...r, error: 'Select a field' }; }
      if (!opMeta?.needsValue) return r;
      if (opMeta.valueType === 'range') {
        const [a, b] = r.value as [any, any];
        if (a === '' || b === '') { valid = false; return { ...r, error: 'Both range values required' }; }
        if (isNaN(Number(a)) || isNaN(Number(b))) { valid = false; return { ...r, error: 'Range values must be numbers' }; }
      } else if (opMeta.valueType === 'multi') {
        if (!Array.isArray(r.value) || r.value.length === 0) { valid = false; return { ...r, error: 'Add at least one value' }; }
      } else {
        if (r.value === '' || r.value === null || r.value === undefined) { valid = false; return { ...r, error: 'Value required' }; }
      }
      return r;
    }));
    return valid;
  };

  const buildPayload = (): QueryBuilderPayload | null => {
    if (rows.length === 0 || rows.every(r => !r.field)) return null;
    const attribute_filters: AttributeFilter[] = rows
      .filter(r => r.field)
      .map(r => {
        const opMeta = ATTRIBUTE_OPERATORS.find(o => o.value === r.operator)!;
        const filter: AttributeFilter = { field: r.field, operator: r.operator };
        if (opMeta.needsValue) {
          if (opMeta.valueType === 'range') {
            filter.value = [Number(r.value[0]), Number(r.value[1])];
          } else if (opMeta.valueType === 'multi') {
            filter.value = r.value;
          } else {
            filter.value = typeof r.value === 'string' ? r.value.replace(/^[\"']|[\"']$/g, '').trim() : r.value;
          }
        }
        return filter;
      });
    if (attribute_filters.length === 0) return null;
    return { filter_condition: filterCondition, attribute_filters };
  };

  const fill = (payload: QueryBuilderPayload) => {
    setFilterCondition(payload.filter_condition || 'AND');
    const newRows = payload.attribute_filters?.length
      ? payload.attribute_filters.map(f => ({
          id: Math.random().toString(36).slice(2),
          field: f.field,
          operator: f.operator,
          value: f.value ?? '',
        }))
      : [emptyRow()];
    setRows(newRows);
    setDistinctValues({});
    distinctRef.current = {};
    newRows.forEach(r => { if (r.field) fetchDistincts(r.field); });
  };

  const reset = () => {
    setRows([emptyRow()]);
    setFilterCondition('AND');
    setDistinctValues({});
    distinctRef.current = {};
  };

  useImperativeHandle(ref, () => ({ buildPayload, validate, fill, reset }));

  const renderValueInput = (row: FilterRow) => {
    const opMeta = ATTRIBUTE_OPERATORS.find(o => o.value === row.operator);
    if (!opMeta?.needsValue) return null;
    const fieldType = schema[row.field] || 'string';
    const distincts = distinctValues[row.field] || [];

    if (opMeta.valueType === 'range') {
      return (
        <div className="flex gap-1">
          <Input size="small" placeholder="Min" value={Array.isArray(row.value) ? row.value[0] : ''}
            onChange={e => updateRow(row.id, { value: [e.target.value, Array.isArray(row.value) ? row.value[1] : ''] })}
            className="flex-1" />
          <Input size="small" placeholder="Max" value={Array.isArray(row.value) ? row.value[1] : ''}
            onChange={e => updateRow(row.id, { value: [Array.isArray(row.value) ? row.value[0] : '', e.target.value] })}
            className="flex-1" />
        </div>
      );
    }

    // Multi-select: string in/not_in — show distinct values as options + allow free text
    if (opMeta.valueType === 'multi') {
      return (
        <Select mode="tags" size="small"
          value={Array.isArray(row.value) ? row.value : []}
          onChange={v => updateRow(row.id, { value: v })}
          className="w-full" placeholder="Select or type values"
          options={distincts.map(v => ({ label: v, value: v }))}
          maxTagCount="responsive"
          getPopupContainer={trigger => trigger.parentElement}
        />
      );
    }

    // Single value — string type: free text input with distinct value suggestions
    if (fieldType === 'string' && opMeta.valueType === 'single') {
      return (
        <AutoComplete
          size="small"
          value={row.value}
          onChange={v => updateRow(row.id, { value: v })}
          className="w-full"
          placeholder="Type or select a value"
          options={distincts.map(v => ({ label: v, value: v }))}
        />
      );
    }

    // Boolean: show true/false select
    if (fieldType === 'boolean') {
      return (
        <Select size="small" value={row.value === '' ? undefined : row.value}
          onChange={v => updateRow(row.id, { value: v })}
          className="w-full"
          options={[{ label: 'True', value: true }, { label: 'False', value: false }]}
          getPopupContainer={trigger => trigger.parentElement}
        />
      );
    }

    return (
      <Input size="small" value={row.value}
        onChange={e => updateRow(row.id, { value: e.target.value })}
        placeholder={fieldType === 'date' ? 'YYYY-MM-DD' : 'Value'}
        type={fieldType === 'integer' || fieldType === 'float' ? 'number' : 'text'}
      />
    );
  };

  if (!layerId) {
    return <div className="text-xs text-gray-400 italic py-2">Select a target layer first.</div>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Match condition */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0">Match</span>
        <Radio.Group size="small" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}
          optionType="button" buttonStyle="solid" disabled={!enabled}
          options={[{ label: 'ALL', value: 'AND' }, { label: 'ANY', value: 'OR' }, { label: 'NONE', value: 'NONE' }]}
        />
        <Tooltip title="NONE returns features matching none of the conditions (complement)">
          <FlipHorizontal size={13} className="text-gray-400 cursor-help shrink-0" />
        </Tooltip>
      </div>

      {/* Filter rows */}
      {schemaLoading ? (
        <div className="flex justify-center py-3"><Spin size="small" /></div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row, idx) => {
            const fieldType = schema[row.field] || 'string';
            const allowedOps = row.field
              ? (OPERATORS_BY_TYPE[fieldType] || OPERATORS_BY_TYPE.string)
              : OPERATORS_BY_TYPE.string;
            const opOptions = ATTRIBUTE_OPERATORS
              .filter(o => allowedOps.includes(o.value))
              .map(o => ({ label: o.label, value: o.value }));

            return (
              <div
                key={row.id}
                className={`flex flex-col gap-2 p-2.5 rounded-lg border transition-colors ${
                  row.error ? 'border-red-200 bg-red-50/30' : 'border-gray-100 bg-gray-50/50'
                }`}
              >
                {/* Row 1: index + field + delete */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 font-bold w-4 shrink-0 text-center">{idx + 1}</span>
                  <Select
                    showSearch size="small"
                    value={row.field || undefined}
                    onChange={v => handleFieldChange(row.id, v)}
                    className="w-full"
                    placeholder="Select field"
                    options={fields.map(f => ({
                      label: (
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0 leading-none">
                            {f.type}
                          </span>
                          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{f.name}</span>
                        </span>
                      ),
                      value: f.name,
                    }))}
                    filterOption={(input, opt) => String(opt?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                    notFoundContent={<span className="text-xs text-gray-400">No fields</span>}
                    disabled={!enabled}
                    dropdownStyle={{ minWidth: 200, maxWidth: 260 }}
                    getPopupContainer={() => document.querySelector('.query-builder-panel') as HTMLElement || document.body}
                  />
                  <Button
                    type="text" size="small" danger
                    icon={<Trash2 size={12} />}
                    onClick={() => setRows(prev => prev.length === 1 ? [emptyRow()] : prev.filter(r => r.id !== row.id))}
                    className="shrink-0 h-6 w-6 flex items-center justify-center"
                    disabled={!enabled}
                  />
                </div>
                {/* Row 2: operator + value */}
                {row.field && (
                  <div className="flex flex-col gap-1.5 pl-5">
                    <Select
                      size="small"
                      value={row.operator}
                      onChange={v => handleOperatorChange(row.id, v)}
                      className="w-full"
                      options={opOptions}
                      disabled={!enabled}
                      getPopupContainer={trigger => trigger.parentElement}
                    />
                    {renderValueInput(row)}
                  </div>
                )}
                {row.error && (
                  <div className="pl-5 text-[10px] text-red-500">{row.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Button type="dashed" size="small" icon={<Plus size={12} />}
        onClick={() => setRows(prev => [...prev, emptyRow()])}
        disabled={!enabled || !layerId || fields.length === 0}
        className="w-full"
      >
        Add Condition
      </Button>
    </div>
  );
});

AttributeSection.displayName = 'AttributeSection';
export default AttributeSection;
