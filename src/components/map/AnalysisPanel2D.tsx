// ============================================================================
// AnalysisPanel2D Component (2D Spatial & Raster Analysis Hub)
//
// Provides the sidebar panel for executing GIS workflows:
// - Vector workflows: Buffer analysis, Layer overlay / intersection
// - Raster workflows: Slope, Aspect, Hillshade, Reclassification
// - Displays execution progress bars, status messages, and workflow options
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { Button, Select, Input, Spin } from 'antd';

interface LayerState {
  id: string;
  name: string;
  type: 'VECTOR' | 'RASTER' | 'POINTCLOUD';
  visible: boolean;
  opacity: number;
  labelsEnabled: boolean;
}

interface AnalysisPanel2DProps {
  activePanel: 'vector' | 'raster';
  addedLayers: LayerState[];
  annotations: any[];
  analysisLoading: boolean;
  analysisStatus: string | null;
  analysisProgress: number;
  analysisMessage: string;
  selectedAnalysisWorkflow: string | null;
  setSelectedAnalysisWorkflow: (val: string | null) => void;
  selectedRasterWorkflow: string | null;
  setSelectedRasterWorkflow: (val: string | null) => void;
  triggerAnalysis: (workflowKey: string, params: any) => void;
  triggerRasterAnalysis: (workflowKey: string, params: any) => void;
}

export default function AnalysisPanel2D({
  activePanel,
  addedLayers,
  annotations,
  analysisLoading,
  analysisStatus,
  analysisProgress,
  analysisMessage,
  selectedAnalysisWorkflow,
  setSelectedAnalysisWorkflow,
  selectedRasterWorkflow,
  setSelectedRasterWorkflow,
  triggerAnalysis,
  triggerRasterAnalysis
}: AnalysisPanel2DProps) {

  // Local state for Vector Analysis form fields
  const [bufferDistance, setBufferDistance] = useState<number>(100);
  const [selectedLayer1, setSelectedLayer1] = useState<string>('');
  const [selectedLayer2, setSelectedLayer2] = useState<string>('');
  const [simplifyTolerance, setSimplifyTolerance] = useState<number>(1);
  const [dissolveField, setDissolveField] = useState<string>('');

  // Local state for Raster Analysis form fields
  const [selectedRasterLayer, setSelectedRasterLayer] = useState<string>('');
  const [rasterAzimuth, setRasterAzimuth] = useState<number>(315.0);
  const [rasterAltitude, setRasterAltitude] = useState<number>(45.0);
  const [rasterRedBand, setRasterRedBand] = useState<number>(3);
  const [rasterNirBand, setRasterNirBand] = useState<number>(4);
  const [rasterTargetCrs, setRasterTargetCrs] = useState<string>('EPSG:3857');
  const [rasterSrcMin, setRasterSrcMin] = useState<number>(0.0);
  const [rasterSrcMax, setRasterSrcMax] = useState<number>(255.0);
  const [rasterDstMin, setRasterDstMin] = useState<number>(0.0);
  const [rasterDstMax, setRasterDstMax] = useState<number>(255.0);
  const [selectedClipAnnotation, setSelectedClipAnnotation] = useState<string>('');
  const [clipGeoJsonStr, setClipGeoJsonStr] = useState<string>('');

  const renderWorkflowForm = (workflow: string) => {
    const vectorLayers = addedLayers.filter(l => l.type === 'VECTOR');

    if (analysisLoading) {
      return (
        <div className="flex flex-col items-center justify-center p-6 gap-4">
          <Spin size="large" />
          <div className="text-center">
            <div className="font-bold text-gray-800 text-sm mb-1">Running Analysis</div>
            <div className="text-xs text-gray-500 font-medium">Status: {analysisStatus}</div>
            {analysisProgress > 0 && <div className="text-xs text-gray-500 font-medium">Progress: {analysisProgress}%</div>}
            {analysisMessage && <div className="text-xs text-gray-400 mt-2 italic">&quot;{analysisMessage}&quot;</div>}
          </div>
        </div>
      );
    }

    switch (workflow) {
      case 'buffer':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Configure parameters to execute a Buffer zone generation process.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Buffer Distance (meters)
              </label>
              <Input
                type="number"
                value={bufferDistance}
                onChange={(e) => setBufferDistance(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('buffer', { selectedLayer1, bufferDistance })}
              disabled={!selectedLayer1 || bufferDistance <= 0}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'dissolve':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Merge adjacent polygons sharing matching attribute fields.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Dissolve Attribute Field (Optional)
              </label>
              <Input
                placeholder="e.g. state_name"
                value={dissolveField}
                onChange={(e) => setDissolveField(e.target.value)}
                className="w-full"
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('dissolve', { selectedLayer1, dissolveField })}
              disabled={!selectedLayer1}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'centroid':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Generate geometric center points for each polygon geometry.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('centroid', { selectedLayer1 })}
              disabled={!selectedLayer1}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'simplify':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Reduce vertex count while retaining overall geometry shape.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Simplification Tolerance (degrees/meters)
              </label>
              <Input
                type="number"
                step="0.001"
                value={simplifyTolerance}
                onChange={(e) => setSimplifyTolerance(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('simplify', { selectedLayer1, simplifyTolerance })}
              disabled={!selectedLayer1 || simplifyTolerance <= 0}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'voronoi':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Create Voronoi partition polygons from input point seeds.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Seed Points Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('voronoi', { selectedLayer1 })}
              disabled={!selectedLayer1}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'overlay':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Perform Boolean intersection overlay between two layers.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Base Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select base vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Overlay Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer2}
                onChange={setSelectedLayer2}
                className="w-full"
                placeholder="Select overlay vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('overlay', { selectedLayer1, selectedLayer2 })}
              disabled={!selectedLayer1 || !selectedLayer2}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'clip':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Clip geometries of a layer using the boundaries of a polygon layer.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Source Vector Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer1}
                onChange={setSelectedLayer1}
                className="w-full"
                placeholder="Select source vector layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Clip Polygon Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedLayer2}
                onChange={setSelectedLayer2}
                className="w-full"
                placeholder="Select clip polygon layer"
                options={vectorLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerAnalysis('clip', { selectedLayer1, selectedLayer2 })}
              disabled={!selectedLayer1 || !selectedLayer2}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  const renderRasterWorkflowForm = (workflow: string) => {
    const rasterLayers = addedLayers.filter(l => l.type === 'RASTER');

    if (analysisLoading) {
      return (
        <div className="flex flex-col items-center justify-center p-6 gap-4">
          <Spin size="large" />
          <div className="text-center">
            <div className="font-bold text-gray-800 text-sm mb-1">Running Analysis</div>
            <div className="text-xs text-gray-500 font-medium">Status: {analysisStatus}</div>
            {analysisProgress > 0 && <div className="text-xs text-gray-500 font-medium">Progress: {analysisProgress}%</div>}
            {analysisMessage && <div className="text-xs text-gray-400 mt-2 italic">&quot;{analysisMessage}&quot;</div>}
          </div>
        </div>
      );
    }

    switch (workflow) {
      case 'slope':
      case 'aspect':
      case 'roughness':
      case 'tri':
      case 'tpi':
      case 'polygonize': {
        const descMap: Record<string, string> = {
          slope: 'Calculate slope gradient in degrees from input Digital Elevation Model (DEM) raster.',
          aspect: 'Calculate downslope direction (0 to 360 degrees) from input DEM raster.',
          roughness: 'Calculate terrain roughness values across the raster surface.',
          tri: 'Calculate Terrain Ruggedness Index based on elevation variations.',
          tpi: 'Calculate Topographic Position Index by comparing cell value to neighborhood average.',
          polygonize: 'Convert contiguous groups of pixels with identical values into vector polygons.'
        };
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              {descMap[workflow]}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Raster Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedRasterLayer}
                onChange={setSelectedRasterLayer}
                className="w-full"
                placeholder="Select raster layer"
                options={rasterLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerRasterAnalysis(workflow, { selectedRasterLayer })}
              disabled={!selectedRasterLayer}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      }
      case 'hillshade':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Generate a shaded relief representation of the terrain by considering light source position.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Raster Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedRasterLayer}
                onChange={setSelectedRasterLayer}
                className="w-full"
                placeholder="Select raster layer"
                options={rasterLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Azimuth Angle (0 - 360)
              </label>
              <Input
                type="number"
                min={0}
                max={360}
                value={rasterAzimuth}
                onChange={(e) => setRasterAzimuth(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Altitude Angle (0 - 90)
              </label>
              <Input
                type="number"
                min={0}
                max={90}
                value={rasterAltitude}
                onChange={(e) => setRasterAltitude(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerRasterAnalysis('hillshade', { selectedRasterLayer, rasterAzimuth, rasterAltitude })}
              disabled={!selectedRasterLayer}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'ndvi':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Calculate Normalized Difference Vegetation Index (NDVI) from Red and NIR spectral bands.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Raster Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedRasterLayer}
                onChange={setSelectedRasterLayer}
                className="w-full"
                placeholder="Select raster layer"
                options={rasterLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Red Band Index
                </label>
                <Input
                  type="number"
                  min={1}
                  value={rasterRedBand}
                  onChange={(e) => setRasterRedBand(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  NIR Band Index
                </label>
                <Input
                  type="number"
                  min={1}
                  value={rasterNirBand}
                  onChange={(e) => setRasterNirBand(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <Button
              type="primary"
              onClick={() => triggerRasterAnalysis('ndvi', { selectedRasterLayer, rasterRedBand, rasterNirBand })}
              disabled={!selectedRasterLayer}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'reproject':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Reproject the raster dataset to a target Coordinate Reference System (CRS).
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Raster Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedRasterLayer}
                onChange={setSelectedRasterLayer}
                className="w-full"
                placeholder="Select raster layer"
                options={rasterLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Target CRS
              </label>
              <Select
                value={rasterTargetCrs}
                onChange={setRasterTargetCrs}
                className="w-full"
                options={[
                  { label: 'EPSG:3857 (Web Mercator)', value: 'EPSG:3857' },
                  { label: 'EPSG:4326 (WGS 84 Geographic)', value: 'EPSG:4326' },
                ]}
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerRasterAnalysis('reproject', { selectedRasterLayer, rasterTargetCrs })}
              disabled={!selectedRasterLayer || !rasterTargetCrs}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'rescale':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Map raster values linearly from a source min/max range to a destination range.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Raster Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedRasterLayer}
                onChange={setSelectedRasterLayer}
                className="w-full"
                placeholder="Select raster layer"
                options={rasterLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Src Min
                </label>
                <Input
                  type="number"
                  value={rasterSrcMin}
                  onChange={(e) => setRasterSrcMin(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Src Max
                </label>
                <Input
                  type="number"
                  value={rasterSrcMax}
                  onChange={(e) => setRasterSrcMax(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Dst Min
                </label>
                <Input
                  type="number"
                  value={rasterDstMin}
                  onChange={(e) => setRasterDstMin(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Dst Max
                </label>
                <Input
                  type="number"
                  value={rasterDstMax}
                  onChange={(e) => setRasterDstMax(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <Button
              type="primary"
              onClick={() => triggerRasterAnalysis('rescale', { selectedRasterLayer, rasterSrcMin, rasterSrcMax, rasterDstMin, rasterDstMax })}
              disabled={!selectedRasterLayer}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      case 'clip':
        return (
          <div className="flex flex-col gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Mask or crop the raster using a drawn polygon annotation or custom GeoJSON boundary.
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Input Raster Layer
              </label>
              <Select
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
                value={selectedRasterLayer}
                onChange={setSelectedRasterLayer}
                className="w-full"
                placeholder="Select raster layer"
                options={rasterLayers.map(l => ({ label: l.name, value: l.id }))}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Select Drawn Annotation
              </label>
              <Select
                allowClear
                value={selectedClipAnnotation}
                onChange={(val) => {
                  setSelectedClipAnnotation(val);
                  if (val) setClipGeoJsonStr('');
                }}
                className="w-full"
                placeholder="Select drawn annotation"
                options={annotations.map(a => ({ label: a.label || `Annotation (${a.type})`, value: a.id }))}
              />
            </div>
            <div className="text-center text-xs text-gray-400 font-medium my-1">
              — OR —
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Custom GeoJSON Geometry
              </label>
              <Input.TextArea
                rows={4}
                value={clipGeoJsonStr}
                onChange={(e) => {
                  setClipGeoJsonStr(e.target.value);
                  if (e.target.value) setSelectedClipAnnotation('');
                }}
                placeholder='{"type": "Polygon", "coordinates": [[...]]}'
                className="text-xs font-mono"
              />
            </div>
            <Button
              type="primary"
              onClick={() => triggerRasterAnalysis('clip', { selectedRasterLayer, selectedClipAnnotation, clipGeoJsonStr })}
              disabled={!selectedRasterLayer || (!selectedClipAnnotation && !clipGeoJsonStr)}
              className="w-full font-bold rounded-lg mt-2"
            >
              Run Analysis
            </Button>
          </div>
        );
      default:
        return null;
    }
  };

  if (activePanel === 'vector') {
    return (
      <div className="flex flex-col gap-4">
        <Select
          placeholder="Select Vector Workflow..."
          className="w-full"
          value={selectedAnalysisWorkflow}
          onChange={(val) => setSelectedAnalysisWorkflow(val)}
          options={[
            { value: 'buffer', label: 'Buffer Analysis' },
            { value: 'clip', label: 'Clip / Subset Layer' },
            { value: 'centroid', label: 'Polygon Centroid' },
            { value: 'simplify', label: 'Simplify Geometries' },
            { value: 'dissolve', label: 'Dissolve Polygons' },
            { value: 'voronoi', label: 'Voronoi Diagram' },
            { value: 'overlay', label: 'Boolean Overlay (Intersect)' }
          ]}
        />
        {selectedAnalysisWorkflow && (
          <div className="border border-gray-100 rounded-2xl p-4 bg-white shadow-sm mt-2">
            <div className="text-xs font-bold text-gray-800 mb-3 flex items-center gap-1.5 capitalize">
              <span className="w-1.5 h-1.5 bg-primary rounded-full" />
              {selectedAnalysisWorkflow} Settings
            </div>
            {renderWorkflowForm(selectedAnalysisWorkflow)}
          </div>
        )}
      </div>
    );
  }

  if (activePanel === 'raster') {
    return (
      <div className="flex flex-col gap-4">
        <Select
          placeholder="Select Raster Workflow..."
          className="w-full"
          value={selectedRasterWorkflow}
          onChange={(val) => setSelectedRasterWorkflow(val)}
          options={[
            { value: 'slope', label: 'Slope Calculation' },
            { value: 'aspect', label: 'Aspect / Orientation' },
            { value: 'hillshade', label: 'Hillshade Relief' },
            { value: 'roughness', label: 'Terrain Roughness' },
            { value: 'tri', label: 'Terrain Ruggedness (TRI)' },
            { value: 'tpi', label: 'Topographic Position (TPI)' },
            { value: 'ndvi', label: 'NDVI Vegetation Index' },
            { value: 'reproject', label: 'Reproject Raster' },
            { value: 'rescale', label: 'Rescale Band Values' },
            { value: 'clip', label: 'Clip / Crop Raster' },
            { value: 'polygonize', label: 'Polygonize Raster' }
          ]}
        />
        {selectedRasterWorkflow && (
          <div className="border border-gray-100 rounded-2xl p-4 bg-white shadow-sm mt-2">
            <div className="text-xs font-bold text-gray-800 mb-3 flex items-center gap-1.5 capitalize">
              <span className="w-1.5 h-1.5 bg-primary rounded-full" />
              {selectedRasterWorkflow} Settings
            </div>
            {renderRasterWorkflowForm(selectedRasterWorkflow)}
          </div>
        )}
      </div>
    );
  }

  return null;
}
