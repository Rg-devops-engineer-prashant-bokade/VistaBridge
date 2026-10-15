// ============================================================================
// Raster Analysis Panel Component
//
// Interactive UI panel that lets users:
// 1. Search and select raster WPS algorithms (e.g. Crop, Contour, Zonal Statistics)
// 2. Configure input parameters and draw geometries on the map
// 3. Execute the process and display output layers (GeoTIFFs or vectors) on the map
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import { Button, Input, Spin } from 'antd';
import { ArrowLeft, Search, Info, Play } from 'lucide-react';
import {
  RasterProcess,
  RasterProcessInput,
  RasterProcessOutput,
  RasterMetadata,
  LayerState
} from '../types/rasterAnalysis';
import RasterProcessForm from './RasterProcessForm';
import { executeRasterWPS } from '../services/rasterWps';

interface RasterAnalysisPanelProps {
  addedLayers: LayerState[];
  user: any;
  notification: any;
  onExecuteSuccess: (result: any, resultLayerName: string) => void;
  onStartDrawGeom?: (geomType: 'Box' | 'Polygon' | 'Point' | 'LineString', callback: (geojson: any) => void) => void;
  onStopDrawGeom?: () => void;
  allDatasets?: any[];
  isMobile?: boolean;
}


export const isRasterProcessIdentifier = (id: string): boolean => {
  return id.toLowerCase().startsWith('ras:');
};

const EXCLUDED_PROCESS_PATTERNS = [
  'jiffle',
  'coverageclassstats',
  'coverage class stats',
  'reclassify',
  'selectcoverage',
  'select coverage',
  'transformedcoverage',
  'transformed coverage',
  'stylecoverage',
  'style coverage',
  'areagrid',
  'area grid',
  'area_grid'
];

export const isExcludedRasterProcess = (identifier: string, title?: string): boolean => {
  const id = (identifier || '').toLowerCase();
  const localName = (id.split(':').pop() || '').toLowerCase();
  const t = (title || '').toLowerCase();

  return EXCLUDED_PROCESS_PATTERNS.some(pattern => {
    const pClean = pattern.replace(/\s+/g, '');
    const idClean = id.replace(/[\s_:-]+/g, '');
    const localClean = localName.replace(/[\s_:-]+/g, '');
    const tClean = t.replace(/[\s_:-]+/g, '');

    return (
      idClean.includes(pClean) ||
      localClean.includes(pClean) ||
      tClean.includes(pClean) ||
      id.includes(pattern) ||
      localName.includes(pattern) ||
      t.includes(pattern)
    );
  });
};

export default function RasterAnalysisPanel({
  addedLayers,
  user,
  notification,
  onExecuteSuccess,
  onStartDrawGeom,
  onStopDrawGeom,
  allDatasets = [],
  isMobile: _isMobile = false
}: RasterAnalysisPanelProps) {
  const [processes, setProcesses] = useState<RasterProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<string>('');
  const [describeLoading, setDescribeLoading] = useState(false);
  const [processInputs, setProcessInputs] = useState<RasterProcessInput[]>([]);
  const [processOutput, setProcessOutput] = useState<RasterProcessOutput | null>(null);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [rasterMetadata, setRasterMetadata] = useState<RasterMetadata | null>(null);
  const [executing, setExecuting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [resultLayerName, setResultLayerName] = useState<string>('');

  const geoserverUrl = (user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');

  // 1. Fetch available raster processes dynamically via GetCapabilities
  useEffect(() => {
    const fetchCapabilities = async () => {
      setLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (user?.geoserverAuth) {
          headers['Authorization'] = user.geoserverAuth;
        }

        const res = await fetch(`${geoserverUrl}/wps?service=WPS&version=1.0.0&request=GetCapabilities`, { headers });
        if (!res.ok) throw new Error('Failed to fetch WPS GetCapabilities');

        const text = await res.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const processNodes = xml.getElementsByTagNameNS('*', 'Process');
        const list: RasterProcess[] = [];
        const seenLocalNames = new Set<string>();

        for (let i = 0; i < processNodes.length; i++) {
          const node = processNodes[i];
          const identifier = node.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent || '';
          const title = node.getElementsByTagNameNS('*', 'Title')[0]?.textContent || identifier;
          const abstract = node.getElementsByTagNameNS('*', 'Abstract')[0]?.textContent || '';

          if (isRasterProcessIdentifier(identifier)) {
            if (isExcludedRasterProcess(identifier, title)) {
              continue;
            }
            const localName = identifier.split(':').pop() || identifier;
            // De-duplicate gs: vs ras: by prioritizing ras:
            if (seenLocalNames.has(localName)) {
              if (identifier.startsWith('ras:')) {
                const idx = list.findIndex(p => p.identifier.endsWith(`:${localName}`));
                if (idx !== -1) {
                  list[idx] = { identifier, title, abstract };
                }
              }
              continue;
            }
            seenLocalNames.add(localName);
            list.push({ identifier, title, abstract });
          }
        }

        // Sort: prioritize CropCoverage, Contour, ScaleCoverage
        list.sort((a, b) => {
          const aId = a.identifier.toLowerCase();
          const bId = b.identifier.toLowerCase();
          if (aId.includes('cropcoverage')) return -1;
          if (bId.includes('cropcoverage')) return 1;
          if (aId.includes('contour')) return -1;
          if (bId.includes('contour')) return 1;
          return a.title.localeCompare(b.title);
        });

        setProcesses(list);
      } catch (err: any) {
        console.error('Failed to load raster processes:', err);
        notification.error({
          message: 'WPS Capabilities Error',
          description: err.message || 'Failed to load raster processes from GeoServer.',
          placement: 'topRight'
        });
      } finally {
        setLoading(false);
      }
    };

    fetchCapabilities();
  }, [geoserverUrl, user?.geoserverAuth, notification]);

  // 2. Fetch DescribeProcess schema dynamically
  const handleSelectProcess = async (processId: string) => {
    setSelectedProcess(processId);
    setResultLayerName('');
    setDescribeLoading(true);
    setProcessInputs([]);
    setFormValues({});
    setRasterMetadata(null);

    try {
      const headers: Record<string, string> = {};
      if (user?.geoserverAuth) {
        headers['Authorization'] = user.geoserverAuth;
      }

      const res = await fetch(`${geoserverUrl}/wps?service=WPS&version=1.0.0&request=DescribeProcess&identifier=${encodeURIComponent(processId)}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch process description.');

      const text = await res.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');

      const inputNodes = xmlDoc.getElementsByTagNameNS('*', 'Input');
      const parsedInputs: RasterProcessInput[] = [];

      for (let i = 0; i < inputNodes.length; i++) {
        const node = inputNodes[i];
        const identifier = node.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent || '';
        const title = node.getElementsByTagNameNS('*', 'Title')[0]?.textContent || identifier;
        const abstract = node.getElementsByTagNameNS('*', 'Abstract')[0]?.textContent || '';
        const minOccurs = node.getAttribute('minOccurs');
        const required = minOccurs !== '0';

        let type: 'complex' | 'literal' | 'bbox' = 'literal';
        let dataType = '';
        let defaultValue = '';
        const supportedFormats: string[] = [];

        if (node.getElementsByTagNameNS('*', 'ComplexData').length > 0) {
          type = 'complex';
          const formatNodes = node.getElementsByTagNameNS('*', 'MimeType');
          for (let f = 0; f < formatNodes.length; f++) {
            const m = formatNodes[f].textContent?.trim();
            if (m) supportedFormats.push(m);
          }
        } else if (node.getElementsByTagNameNS('*', 'BoundingBoxData').length > 0) {
          type = 'bbox';
        } else if (node.getElementsByTagNameNS('*', 'LiteralData').length > 0) {
          type = 'literal';
          dataType = node.getElementsByTagNameNS('*', 'DataType')[0]?.textContent || '';
          defaultValue = node.getElementsByTagNameNS('*', 'DefaultValue')[0]?.textContent || '';
        }

        parsedInputs.push({
          identifier,
          title,
          abstract,
          required,
          type,
          dataType,
          defaultValue,
          supportedFormats
        });
      }

      setProcessInputs(parsedInputs);

      // Parse output format and identifier
      const outputNodes = xmlDoc.getElementsByTagNameNS('*', 'Output');
      if (outputNodes.length > 0) {
        const outNode = outputNodes[0];
        const outId = outNode.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent || 'result';
        const mimeNodes = outNode.getElementsByTagNameNS('*', 'MimeType');
        const supportedFormats: string[] = [];
        for (let m = 0; m < mimeNodes.length; m++) {
          const val = mimeNodes[m].textContent?.trim();
          if (val && !supportedFormats.includes(val)) {
            supportedFormats.push(val);
          }
        }
        const mime = supportedFormats[0] || 'image/tiff';
        setProcessOutput({
          identifier: outId,
          title: outNode.getElementsByTagNameNS('*', 'Title')[0]?.textContent || outId,
          mimeType: mime,
          supportedFormats
        });
      }

      // Populate default values — prefer DescribeProcess defaults, then fall back to sensible hardcoded values
      const SMART_DEFAULTS: Record<string, number | string | boolean> = {
        // CoverageClassStats
        classes: 10,
        numclasses: 10,
        numlevels: 10,
        // Contour
        interval: 10,
        // ScaleCoverage
        scalex: 1,
        scaley: 1,
        // RangeLookup / PolygonExtraction
        nodata: 0,
        band: 0,
        inside: 'true',
        // RasterAsPointCollection
        scale: 10,
        targetcrs: 'EPSG:4326',
        emisphere: 'false',
      };

      const defaults: Record<string, any> = {};
      parsedInputs.forEach(input => {
        if (input.defaultValue) {
          const isNum = ['double', 'float', 'int', 'integer', 'long'].includes(input.dataType.toLowerCase());
          defaults[input.identifier] = isNum ? Number(input.defaultValue) : input.defaultValue;
        } else {
          // Apply smart defaults by matching the identifier (case-insensitive)
          const idLower = input.identifier.toLowerCase();
          if (idLower in SMART_DEFAULTS) {
            defaults[input.identifier] = SMART_DEFAULTS[idLower];
          }
        }
      });

      // Auto-select first active raster layer if present
      const firstRaster = addedLayers.find(l => l.type === 'RASTER');
      if (firstRaster) {
        const coverageInput = parsedInputs.find(i => {
          const id = i.identifier.toLowerCase();
          return id === 'coverage' || id === 'data' || id === 'input' || id === 'source';
        });
        if (coverageInput) {
          defaults[coverageInput.identifier] = firstRaster.id;
        }
      }

      setFormValues(defaults);
    } catch (err: any) {
      console.error('DescribeProcess error:', err);
      notification.error({
        message: 'DescribeProcess Failed',
        description: err.message || 'Could not parse process schema.',
        placement: 'topRight'
      });
      setSelectedProcess('');
    } finally {
      setDescribeLoading(false);
    }
  };

  const handleBack = () => {
    setSelectedProcess('');
    setResultLayerName('');
    onStopDrawGeom?.();
  };

  const handleExecute = async () => {
    if (!selectedProcess) return;

    // Validate required inputs
    const missing = processInputs.find(
      i => i.required && (formValues[i.identifier] === undefined || formValues[i.identifier] === '' || formValues[i.identifier] === null)
    );
    if (missing) {
      notification.warning({
        message: 'Required Parameter Missing',
        description: `Please specify the parameter: ${missing.title || missing.identifier}`,
        placement: 'topRight'
      });
      return;
    }

    const coverageInput = processInputs.find(i => {
      const id = i.identifier.toLowerCase();
      return (
        id === 'coverage' ||
        id === 'coveragea' ||
        id === 'coverageb' ||
        id === 'coverages' ||
        id === 'data' ||
        id === 'input' ||
        id === 'inputcoverage' ||
        id === 'sourcecoverage' ||
        id === 'classification' ||
        (i.type === 'complex' && (i.dataType?.toLowerCase().includes('gridcoverage') || i.dataType?.toLowerCase().includes('coverage')))
      );
    });

    // Dynamically resolve metadata for the selected coverage layer to avoid stale or null state
    let effectiveMetadata = rasterMetadata;
    if (coverageInput) {
      const selectedId = formValues[coverageInput.identifier];
      const match = addedLayers.find(l => l.id === selectedId || l.name === selectedId);
      if (match) {
        const bboxObj = match.bbox ? {
          minX: match.bbox[0],
          minY: match.bbox[1],
          maxX: match.bbox[2],
          maxY: match.bbox[3],
        } : { minX: -180, minY: -90, maxX: 180, maxY: 90 };

        if (!effectiveMetadata || effectiveMetadata.layerName !== match.id) {
          effectiveMetadata = {
            layerName: match.id,
            title: match.name || match.id,
            nativeCRS: match.nativeCRS || 'EPSG:4326',
            bbox: bboxObj,
            latLonBbox: bboxObj,
            rawBuffer: match.rawBuffer,
            imageBlob: match.imageBlob,
          };
        }
      }
    }

    if (!effectiveMetadata) {
      const firstRaster = addedLayers.find(l => l.type === 'RASTER');
      const bboxObj = firstRaster?.bbox ? {
        minX: firstRaster.bbox[0],
        minY: firstRaster.bbox[1],
        maxX: firstRaster.bbox[2],
        maxY: firstRaster.bbox[3],
      } : { minX: -180, minY: -90, maxX: 180, maxY: 90 };

      effectiveMetadata = {
        layerName: firstRaster?.id || 'raster_layer',
        title: firstRaster?.name || firstRaster?.id || 'Raster Layer',
        nativeCRS: firstRaster?.nativeCRS || 'EPSG:4326',
        bbox: bboxObj,
        latLonBbox: bboxObj,
        rawBuffer: firstRaster?.rawBuffer,
        imageBlob: firstRaster?.imageBlob,
      };
    }

    setExecuting(true);

    try {
      const result = await executeRasterWPS({
        processId: selectedProcess,
        inputs: formValues,
        inputSchema: processInputs,
        rasterMetadata: effectiveMetadata!,
        outputIdentifier: processOutput?.identifier || 'result',
        processOutput: processOutput || undefined,
        geoserverUrl,
        authHeader: user?.geoserverAuth,
        resultLayerName,
        addedLayers
      });

      const finalName = resultLayerName.trim() || `${selectedProcess.split(':').pop()}_result`;

      if (result.type === 'RASTER') {
        notification.success({
          message: 'Raster Analysis Complete',
          description: `Layer ${result.layerName} generated and loaded successfully.`,
          placement: 'topRight'
        });
        onExecuteSuccess(result, finalName);
      } else {
        const count = result.geojson?.features?.length ?? 0;
        const firstProps = result.geojson?.features?.[0]?.properties || {};
        const avg = firstProps.avg ?? firstProps.mean ?? firstProps.average;
        const min = firstProps.min ?? firstProps.minimum;
        const max = firstProps.max ?? firstProps.maximum;
        const isZonal = selectedProcess.toLowerCase().includes('zonal');

        const desc = isZonal && avg !== undefined
          ? `Calculated metrics: Avg ${typeof avg === 'number' ? avg.toFixed(2) : avg}, Min ${min !== undefined ? min : '—'}, Max ${max !== undefined ? max : '—'}.`
          : `Process ${selectedProcess.split(':').pop()} generated ${count} vector feature${count === 1 ? '' : 's'}.`;

        notification.success({
          message: isZonal ? 'Zonal Statistics Complete' : 'Raster Analysis Complete',
          description: desc,
          placement: 'topRight'
        });
        onExecuteSuccess(result, finalName);
      }

      onStopDrawGeom?.();
    } catch (err: any) {
      console.error('Raster WPS Execution failed:', err);
      notification.error({
        message: 'Raster Analysis Failed',
        description: err.message || 'An error occurred during raster execution.',
        placement: 'topRight'
      });
    } finally {
      setExecuting(false);
    }
  };

  const activeProcess = processes.find(p => p.identifier === selectedProcess);
  const filteredProcesses = processes.filter(
    p =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.identifier.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full w-full">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-3 flex-grow">
          <Spin size="medium" />
          <div className="text-[11px] text-gray-400 font-medium">Discovering GeoServer Raster Processes...</div>
        </div>
      ) : !selectedProcess ? (
        // ── View 1: Process List ──────────────────────────────────────────
        <div className="flex flex-col gap-3 w-full">
          <div className="relative shrink-0">
            <Input
              placeholder="Search raster processes (e.g. crop, contour)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              prefix={<Search size={14} className="text-gray-400" />}
              className="w-full rounded-xl bg-gray-50 border-gray-200"
              allowClear
            />
          </div>

          <div className="space-y-2.5 pr-1 w-full overflow-y-auto">
            {filteredProcesses.map(p => (
              <div
                key={p.identifier}
                className="p-3 bg-gray-50 border border-gray-200 rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all flex flex-col gap-1.5"
              >
                <div>
                  <div className="font-bold text-gray-800 text-xs truncate">{p.title}</div>
                  <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">{p.identifier}</div>
                </div>
                <div className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">
                  {p.abstract || 'Raster processing algorithm.'}
                </div>
                <Button
                  type="primary"
                  onClick={() => handleSelectProcess(p.identifier)}
                  className="self-end text-[11px] h-7 font-bold rounded-lg px-3.5 mt-1"
                >
                  Configure
                </Button>
              </div>
            ))}

            {filteredProcesses.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-8">
                No matching raster processes found on GeoServer.
              </div>
            )}
          </div>
        </div>
      ) : describeLoading ? (
        // ── View 2: DescribeProcess Loading ────────────────────────────────
        <div className="flex flex-col items-center justify-center py-10 gap-3 flex-grow">
          <Spin size="medium" />
          <div className="text-[11px] text-gray-400 font-medium">Loading raster process parameters...</div>
        </div>
      ) : (
        // ── View 3: Dynamic Process Form ──────────────────────────────────
        <div className="flex flex-col gap-4 w-full">
          <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
            <Button
              type="text"
              size="small"
              icon={<ArrowLeft size={13} />}
              onClick={handleBack}
              className="rounded-full hover:bg-gray-100 flex items-center justify-center p-1"
            />
            <div className="text-xs font-bold text-gray-800 truncate">
              {activeProcess?.title || selectedProcess.split(':').pop()}
            </div>
          </div>

          {activeProcess && (
            <div className="p-2.5 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-gray-600 flex gap-2 shrink-0">
              <Info size={15} className="text-blue-500 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed text-gray-500">
                {activeProcess.abstract || 'Configured via WPS DescribeProcess schema.'}
              </div>
            </div>
          )}

          {/* Dynamic Form Controls */}
          <RasterProcessForm
            process={activeProcess!}
            inputs={processInputs}
            formValues={formValues}
            onFormValueChange={(field, val) => setFormValues(prev => ({ ...prev, [field]: val }))}
            addedLayers={addedLayers}
            allDatasets={allDatasets}
            rasterMetadata={rasterMetadata}
            onRasterMetadataChange={setRasterMetadata}
            onStartDrawGeom={onStartDrawGeom || (() => { })}
            onStopDrawGeom={onStopDrawGeom}
            geoserverUrl={geoserverUrl}
            authHeader={user?.geoserverAuth}
            disabled={executing}
          />

          {/* Result Layer Name & Execution */}
          <div className="pt-3 border-t border-gray-100 shrink-0 flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider">
                Result Layer Name
              </label>
              <Input
                placeholder={`${selectedProcess.split(':').pop()}_result`}
                value={resultLayerName}
                onChange={e => setResultLayerName(e.target.value)}
                className="w-full rounded-lg text-xs"
                disabled={executing}
              />
            </div>

            <Button
              type="primary"
              icon={<Play size={14} />}
              loading={executing}
              onClick={handleExecute}
              className="w-full h-10 font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-md"
            >
              Run Raster Analysis
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
