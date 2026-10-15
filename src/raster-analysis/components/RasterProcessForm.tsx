// ============================================================================
// Dynamic Raster Process Form Component
//
// Automatically renders input fields based on the selected WPS process schema:
// - Raster layer pickers for input coverages
// - Geometry drawers for crop regions / ROI
// - Number, text, dropdown, and switch inputs for process arguments
// - Range editor for reclassification
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Input, InputNumber, Switch, Select } from 'antd';
import {
  RasterProcess,
  RasterProcessInput,
  RasterMetadata,
  LayerState
} from '../types/rasterAnalysis';
import RasterLayerSelector from './RasterLayerSelector';
import RasterGeometryInput from './RasterGeometryInput';
import RasterClassificationRanges from './RasterClassificationRanges';

interface RasterProcessFormProps {
  process: RasterProcess;
  inputs: RasterProcessInput[];
  formValues: Record<string, any>;
  onFormValueChange: (field: string, value: any) => void;
  addedLayers: LayerState[];
  allDatasets?: any[];
  rasterMetadata: RasterMetadata | null;
  onRasterMetadataChange: (meta: RasterMetadata | null) => void;
  onStartDrawGeom: (drawType: 'Box' | 'Polygon' | 'Point' | 'LineString', callback: (geojson: any) => void) => void;
  onStopDrawGeom?: () => void;
  geoserverUrl: string;
  authHeader?: string;
  disabled?: boolean;
}

export default function RasterProcessForm({

  process: _process,
  inputs,
  formValues,
  onFormValueChange,
  addedLayers,
  allDatasets = [],
  rasterMetadata: _rasterMetadata,
  onRasterMetadataChange,
  onStartDrawGeom,
  onStopDrawGeom,
  geoserverUrl,
  authHeader,
  disabled = false
}: RasterProcessFormProps) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {inputs.map((input) => {
        const idLower = input.identifier.toLowerCase();
        const isCoverage =
          idLower === 'coverage' ||
          idLower === 'coveragea' ||
          idLower === 'coverageb' ||
          idLower === 'coverages' ||
          idLower === 'data' ||
          idLower === 'input' ||
          idLower === 'inputcoverage' ||
          idLower === 'sourcecoverage' ||
          idLower === 'classification' ||
          (input.type === 'complex' && (input.dataType?.toLowerCase().includes('gridcoverage') || input.dataType?.toLowerCase().includes('coverage')));
        const isClassificationRanges =
          idLower === 'classificationranges' ||
          idLower === 'ranges' ||
          idLower === 'lookupranges' ||
          idLower === 'rangelookuptable';
        const isGeometry =
          idLower === 'cropshape' ||
          idLower === 'roi' ||
          idLower === 'geometry' ||
          idLower === 'geom' ||
          idLower === 'cropgeom' ||
          idLower === 'clipgeom' ||
          idLower === 'shape' ||
          idLower === 'polygon' ||
          idLower === 'bounds' ||
          idLower === 'mask' ||
          idLower === 'footprint' ||
          idLower === 'area' ||
          idLower === 'zones' ||
          input.dataType?.toLowerCase().includes('geometry') ||
          input.dataType?.toLowerCase().includes('jts');
        const isNumber =
          input.type === 'literal' &&
          ['double', 'float', 'int', 'integer', 'long', 'xs:double', 'xs:int', 'xs:float'].includes(
            input.dataType.toLowerCase()
          );
        const isBoolean =
          input.type === 'literal' &&
          ['boolean', 'bool', 'xs:boolean'].includes(input.dataType.toLowerCase());

        return (
          <div key={input.identifier} className="flex flex-col gap-1.5 w-full">
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
              {input.title || input.identifier}
              {input.required && <span className="text-red-500 ml-1 font-bold">*</span>}
            </label>

            {input.abstract && (
              <span className="text-[11px] text-gray-400 leading-tight">
                {input.abstract}
              </span>
            )}

            {/* 1. Raster Coverage Layer Selector */}
            {isCoverage ? (
              <RasterLayerSelector
                addedLayers={addedLayers}
                allDatasets={allDatasets}
                value={formValues[input.identifier] || ''}
                onChange={(layerId, meta) => {
                  onFormValueChange(input.identifier, layerId);
                  if (meta) {
                    onRasterMetadataChange(meta);
                  }
                }}
                geoserverUrl={geoserverUrl}
                authHeader={authHeader}
              />
            ) : isClassificationRanges ? (
              /* Classification Ranges Builder */
              <RasterClassificationRanges
                value={Array.isArray(formValues[input.identifier]) ? formValues[input.identifier] : [
                  { min: 0, max: 100, output: 1 },
                  { min: 100, max: 500, output: 2 },
                  { min: 500, max: 1000, output: 3 }
                ]}
                onChange={(ranges) => onFormValueChange(input.identifier, ranges)}
                disabled={disabled}
              />
            ) : isGeometry ? (
              /* 2. Map Geometry Input (Draw Rectangle / Draw Polygon) */
              <RasterGeometryInput
                value={formValues[input.identifier]}
                onChange={(geom) => onFormValueChange(input.identifier, geom)}
                onStartDraw={onStartDrawGeom}
                onStopDraw={onStopDrawGeom}
                allowedTypes={['Box', 'Polygon']}
                addedLayers={addedLayers}
                disabled={disabled}
              />
            ) : isNumber ? (
              /* 3. Number Input */
              <InputNumber
                value={formValues[input.identifier] !== undefined ? formValues[input.identifier] : input.defaultValue}
                onChange={(val) => onFormValueChange(input.identifier, val)}
                className="w-full rounded-lg"
                disabled={disabled}
                placeholder={
                  input.identifier.toLowerCase() === 'scale'
                    ? 'e.g. 10 (sample step in pixels)'
                    : input.defaultValue !== undefined
                      ? String(input.defaultValue)
                      : 'Enter number'
                }
              />
            ) : isBoolean ? (
              /* 4. Boolean Switch */
              <div className="flex items-center gap-2 pt-1">
                <Switch
                  checked={Boolean(formValues[input.identifier])}
                  onChange={(checked) => onFormValueChange(input.identifier, checked)}
                  disabled={disabled}
                />
                <span className="text-xs text-gray-600 font-medium">
                  {formValues[input.identifier] ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ) : input.allowedValues && input.allowedValues.length > 0 ? (
              /* 5. Enumeration Select */
              <Select
                value={formValues[input.identifier] || input.defaultValue}
                onChange={(val) => onFormValueChange(input.identifier, val)}
                options={input.allowedValues.map((v) => ({ label: String(v), value: v }))}
                className="w-full"
                disabled={disabled}
              />
            ) : (
              /* 6. General Text Input */
              <Input
                value={formValues[input.identifier] !== undefined ? formValues[input.identifier] : (input.defaultValue || '')}
                onChange={(e) => onFormValueChange(input.identifier, e.target.value)}
                className="w-full rounded-lg text-xs"
                disabled={disabled}
                placeholder={
                  input.identifier.toLowerCase().includes('crs')
                    ? 'e.g. EPSG:4326'
                    : input.abstract || `Enter ${input.title || input.identifier}`
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
