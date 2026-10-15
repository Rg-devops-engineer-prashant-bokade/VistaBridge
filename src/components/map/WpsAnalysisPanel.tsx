// ============================================================================
// WpsAnalysisPanel Component (Spatial Analysis & Geoprocessing)
//
// In GIS, "Geoprocessing" means taking spatial layers and performing geometric
// operations on them to answer questions or create new datasets.
// Examples:
// - Buffer: Create a 50-meter zone around a river or pipeline
// - Intersection: Find where building footprints overlap with flood zones
// - Clip: "Cookie-cut" city boundaries from a national roads layer
// - Centroid: Find the center coordinate point of each parcel/polygon
//
// This component provides the UI panel for:
// 1. Vector WPS operations (GeoServer WPS or client-side Turf.js fallback)
// 2. Raster WPS operations (Aspect, Slope, Contour, Reclassify)
// 3. Drawing custom shapes on the map to use as input (e.g. clipping boundary)
// 4. Adding the resulting output directly back to the map as a new layer
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import { Button, Select, Input, Spin, Segmented, Modal } from 'antd';
import { X, Play, ArrowLeft, Search, Info, PenTool, CheckCircle2, RotateCcw, MapPin } from 'lucide-react';
import RasterAnalysisPanel, { isExcludedRasterProcess } from '@/raster-analysis/components/RasterAnalysisPanel';

interface LayerState {
  id: string;
  name: string;
  type: 'VECTOR' | 'RASTER' | 'POINTCLOUD' | 'GROUP';
  visible: boolean;
  opacity: number;
  labelsEnabled: boolean;
  styles?: any[];
  activeStyle?: string;
  bbox?: number[];
}

interface WpsAnalysisPanelProps {
  addedLayers: LayerState[];
  user: any;
  notification: any;
  onExecuteSuccess: (geojson: any, resultLayerName: string) => void;
  onClose: () => void;
  onStartDrawGeom?: (geomType: 'Point' | 'LineString' | 'Polygon' | 'Box', callback: (geojson: any) => void, paramId?: string) => void;
  onStopDrawGeom?: () => void;
  isMobile?: boolean;
  isDrawing?: boolean;
  getLayerFeatures?: (layerId: string) => any;
  allDatasets?: any[];
}

interface ProcessInput {
  identifier: string;
  title: string;
  abstract: string;
  required: boolean;
  type: 'complex' | 'literal' | 'bbox';
  dataType: string;
  defaultValue: string;
}

// Allowed vector GIS tools shown in the tool menu
const VECTOR_WHITELIST_RULES = [
  {
    match: ['gs:bufferfeaturecollection', 'gs:buffer', 'jts:buffer'],
    title: 'Buffer',
    abstract: 'Buffers features by a distance value. Calculates buffers based on Cartesian distances.'
  },
  {
    match: ['gs:clip'],
    title: 'Clip',
    abstract: 'Clips input features using a clip geometry layer or drawn boundary.'
  },
  {
    match: ['gs:intersectionfeaturecollection', 'gs:intersection', 'jts:intersection'],
    title: 'Intersection',
    abstract: 'Calculates the spatial intersection of two vector layers.'
  },
  {
    match: ['gs:differencefeaturecollection', 'gs:difference', 'jts:difference'],
    title: 'Difference',
    abstract: 'Calculates the spatial difference (overlay subtraction) of two vector layers.'
  },
  {
    match: ['gs:unionfeaturecollection', 'gs:union', 'jts:union'],
    title: 'Union',
    abstract: 'Merges geometries of two or more vector layers.'
  },
  {
    match: ['gs:dissolve'],
    title: 'Dissolve',
    abstract: 'Merges adjacent polygon features that share identical attribute values.'
  },
  {
    match: ['gs:centroid', 'gs:centroids', 'jts:centroid'],
    title: 'Centroid',
    abstract: 'Calculates the geometric center point (centroid) for each input geometry.'
  },

  {
    match: ['gs:boundary', 'jts:boundary'],
    title: 'Boundary',
    abstract: 'Extracts the boundary lines/outlines of input geometries.'
  },
  {
    match: ['gs:envelope', 'gs:bounds', 'jts:envelope', 'jts:bounds'],
    title: 'Envelope / Bounding Box',
    abstract: 'Calculates the minimum axis-aligned bounding box enclosing all input features.'
  },
  {
    match: ['gs:simplify', 'jts:simplify'],
    title: 'Simplify',
    abstract: 'Reduces geometry vertex density using Douglas-Peucker simplification.'
  },
  {
    match: ['gs:nearest'],
    title: 'Nearest Feature',
    abstract: 'Finds the closest target feature for each source feature.'
  },
  {
    match: ['gs:distance', 'jts:distance'],
    title: 'Distance',
    abstract: 'Calculates the distance between geometry elements.'
  }
];

const isRasterProcess = (p: any) => {
  const id = (p.identifier || '').toLowerCase();
  return id.startsWith('ras:');
};

const isVectorProcess = (p: any) => {
  const id = p.identifier.toLowerCase();
  return VECTOR_WHITELIST_RULES.some(rule =>
    rule.match.some(m => id === m || id.endsWith(':' + m.split(':').pop()))
  );
};

const isLayerInput = (identifier: string): boolean => {
  const id = identifier.toLowerCase();
  return ['data', 'coverage', 'layer', 'features', 'first', 'second', 'a', 'b', 'input', 'source', 'target', 'clip', 'geom', 'geometry', 'point'].includes(id)
    || id.includes('layer')
    || id.includes('feature')
    || id.includes('coverage')
    || id.includes('point');
};

const isDatasetInput = (identifier: string): boolean => {
  const id = identifier.toLowerCase();
  return id === 'features' || id.includes('collection') || id.includes('dataset');
};

const isBoundaryInput = (identifier: string): boolean => {
  const id = identifier.toLowerCase();
  return id === 'clip' || id === 'boundary' || id.includes('boundary') || id === 'second' || id === 'b' || id === 'mask' || id === 'geom' || id === 'geometry';
};

const isDrawAllowed = (processId: string, inputId: string): boolean => {
  const proc = (processId || '').toLowerCase();
  const id = (inputId || '').toLowerCase();

  // Union processes merge multiple layers, drawing not supported
  if (proc.includes('union')) return false;

  // Single-layer operations operating on a dataset layer: Buffer, Dissolve, Centroid, Boundary, Envelope, Simplify
  if (proc.includes('dissolve') || proc.includes('centroid') || proc.includes('boundary') || proc.includes('envelope') || proc.includes('simplify') || proc.includes('buffer')) {
    return false;
  }

  // Clip: only clip boundary input can be drawn, not the source features
  if (proc.includes('clip')) {
    return id === 'clip' || id.includes('boundary') || id === 'second' || id === 'mask';
  }

  // Nearest: can draw the point
  if (proc.includes('nearest')) {
    return id === 'point' || id.includes('point') || id === 'target' || id === 'geom';
  }

  // Difference, Distance, Intersection: both inputs can be drawn (a, b, first, second, etc.)
  if (proc.includes('difference') || proc.includes('distance') || proc.includes('intersection')) {
    return ['a', 'b', 'first', 'second', 'geom', 'geometry', 'point', 'clip', 'mask'].includes(id);
  }

  return isBoundaryInput(id);
};

const cleanCoordinates = (coords: any): any => {
  if (!Array.isArray(coords)) return coords;

  if (coords.length > 0 && typeof coords[0] === 'number') {
    const rawX = coords[0];
    const rawY = coords[1];
    if (isNaN(rawX) || isNaN(rawY)) {
      return [0, 0];
    }
    // Round to 6 decimal places to resolve JTS TopologyExceptions (approx 11cm precision)
    const x = Number(rawX.toFixed(6));
    const y = Number(rawY.toFixed(6));
    return [x, y];
  }

  // If it's an array of coordinate tuples (like a polygon ring or linestring)
  if (coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
    const uniqueCoords: any[] = [];
    let lastX: number | null = null;
    let lastY: number | null = null;

    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const cleaned = cleanCoordinates(c);
      const x = cleaned[0];
      const y = cleaned[1];

      // Avoid duplicate adjacent coordinates
      if (x === lastX && y === lastY) {
        continue;
      }

      uniqueCoords.push(cleaned);
      lastX = x;
      lastY = y;
    }

    // Ensure polygon ring is closed (first and last coordinate are identical) and has at least 4 coordinates
    if (uniqueCoords.length > 0) {
      const first = uniqueCoords[0];
      const last = uniqueCoords[uniqueCoords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        uniqueCoords.push([first[0], first[1]]);
      }
    }

    return uniqueCoords;
  }

  return coords.map(cleanCoordinates);
};

// @turf/buffer is imported dynamically to avoid Next.js SSR build issues
let turfBuffer: ((geom: any, radius: number, opts?: any) => any) | null = null;
import('@turf/buffer').then(m => { turfBuffer = m.default ?? m.buffer ?? null; }).catch(() => { });

const lonLatToMercator = (lon: number, lat: number): [number, number] => {
  const x = (lon * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
};

const projectCoordinates = (coords: any): any => {
  if (!Array.isArray(coords)) return coords;
  if (coords.length > 0 && typeof coords[0] === 'number') {
    return lonLatToMercator(coords[0], coords[1]);
  }
  return coords.map((c: any) => projectCoordinates(c));
};

const projectGeometry = (geom: any): any => {
  if (!geom) return null;
  if (geom.type === 'GeometryCollection') {
    return {
      ...geom,
      geometries: (geom.geometries || []).map(projectGeometry)
    };
  }
  return {
    ...geom,
    coordinates: projectCoordinates(geom.coordinates)
  };
};

const cleanGeoJsonGeometry = (geom: any): any => {
  if (!geom) return null;
  if (geom.type === 'GeometryCollection') {
    return {
      ...geom,
      geometries: (geom.geometries || []).map(cleanGeoJsonGeometry)
    };
  }

  let cleanedGeom = {
    ...geom,
    coordinates: cleanCoordinates(geom.coordinates)
  };

  // Run a client-side zero-buffer using turf to repair self-intersections and invalid topology before sending to WPS
  if (turfBuffer && ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(cleanedGeom.type)) {
    try {
      const feat = {
        type: 'Feature',
        geometry: cleanedGeom,
        properties: {}
      };
      const buffered = turfBuffer(feat, 0);
      if (buffered && buffered.geometry) {
        cleanedGeom = buffered.geometry;
      }
    } catch (e) {
      console.warn('Failed to repair geometry using turf buffer:', e);
    }
  }

  return cleanedGeom;
};

const standardizeFeatureCollectionGeometries = (fc: any): any => {
  if (!fc || fc.type !== 'FeatureCollection') return fc;

  // 1. Inject standard CRS definition to prevent SRS mapping/projection mismatches
  const nextFc = {
    ...fc,
    crs: {
      type: 'name',
      properties: {
        name: 'urn:ogc:def:crs:EPSG::4326'
      }
    }
  };

  // 2. Remove 'geometry_name' from features to allow GeoServer to default to 'geometry' uniformly
  let updatedFeatures = (nextFc.features || []).map((f: any) => {
    const nextF = { ...f };
    delete nextF.geometry_name;
    return nextF;
  });

  // 3. Detect geometry types inside features
  let hasPolygon = false;
  let hasLine = false;
  let hasPoint = false;

  updatedFeatures.forEach((f: any) => {
    if (!f.geometry) return;
    const t = f.geometry.type;
    if (t === 'Polygon' || t === 'MultiPolygon') hasPolygon = true;
    if (t === 'LineString' || t === 'MultiLineString') hasLine = true;
    if (t === 'Point' || t === 'MultiPoint') hasPoint = true;
  });

  // 4. Map geometries to unified Multi-geometries
  if (hasPolygon) {
    updatedFeatures = updatedFeatures.map((f: any) => {
      if (f.geometry && f.geometry.type === 'Polygon') {
        return {
          ...f,
          geometry: {
            type: 'MultiPolygon',
            coordinates: [f.geometry.coordinates]
          }
        };
      }
      return f;
    });
  } else if (hasLine) {
    updatedFeatures = updatedFeatures.map((f: any) => {
      if (f.geometry && f.geometry.type === 'LineString') {
        return {
          ...f,
          geometry: {
            type: 'MultiLineString',
            coordinates: [f.geometry.coordinates]
          }
        };
      }
      return f;
    });
  } else if (hasPoint) {
    updatedFeatures = updatedFeatures.map((f: any) => {
      if (f.geometry && f.geometry.type === 'Point') {
        return {
          ...f,
          geometry: {
            type: 'MultiPoint',
            coordinates: [f.geometry.coordinates]
          }
        };
      }
      return f;
    });
  }

  return {
    ...nextFc,
    features: updatedFeatures
  };
};

export default function WpsAnalysisPanel({
  addedLayers,
  user,
  notification,
  onExecuteSuccess,
  onClose,
  onStartDrawGeom,
  onStopDrawGeom,
  isMobile,
  isDrawing,
  getLayerFeatures,
  allDatasets = []
}: WpsAnalysisPanelProps) {
  const [processes, setProcesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<string>('');
  const [describeLoading, setDescribeLoading] = useState(false);
  const [processInputs, setProcessInputs] = useState<ProcessInput[]>([]);
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [inputSources, setInputSources] = useState<Record<string, 'layer' | 'draw'>>({});
  const [layerFields, setLayerFields] = useState<Record<string, string[]>>({});
  const [fieldsLoading, setFieldsLoading] = useState<Record<string, boolean>>({});
  const [executing, setExecuting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'vector' | 'raster'>('vector');
  const [outputIdentifier, setOutputIdentifier] = useState<string>('result');
  const [resultLayerName, setResultLayerName] = useState<string>('');

  const geoserverUrl = (user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');

  // 1. Fetch available processes list
  useEffect(() => {
    const fetchCapabilities = async () => {
      setLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (user?.geoserverAuth) {
          headers['Authorization'] = user.geoserverAuth;
        }
        const res = await fetch(`${geoserverUrl}/wps?service=WPS&version=1.0.0&request=GetCapabilities`, { headers });
        if (!res.ok) throw new Error('Failed to fetch GetCapabilities');
        const text = await res.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const processNodes = xml.getElementsByTagNameNS('*', 'Process');
        const rawList: any[] = [];
        for (let i = 0; i < processNodes.length; i++) {
          const node = processNodes[i];
          const identifier = node.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent || '';
          const title = node.getElementsByTagNameNS('*', 'Title')[0]?.textContent || '';
          const abstract = node.getElementsByTagNameNS('*', 'Abstract')[0]?.textContent || '';
          rawList.push({ identifier, title, abstract });
        }

        // Prioritize 'gs:' namespace for sorting to keep standard names clean
        rawList.sort((a, b) => {
          const aId = a.identifier.toLowerCase();
          const bId = b.identifier.toLowerCase();

          // Prioritize robust featurecollection-based processes over geometry-only equivalents
          const aHasFC = aId.includes('featurecollection');
          const bHasFC = bId.includes('featurecollection');
          if (aHasFC && !bHasFC) return -1;
          if (!aHasFC && bHasFC) return 1;

          if (aId.startsWith('gs:') && !bId.startsWith('gs:')) return -1;
          if (!aId.startsWith('gs:') && bId.startsWith('gs:')) return 1;
          return a.title.localeCompare(b.title);
        });

        // Keep unique mapped whitelisted titles for Vector, and keep unique identifiers for Raster
        const list: any[] = [];
        const seenMappedTitles = new Set<string>();
        const seenRasterLocalNames = new Set<string>();
        for (const item of rawList) {
          const localName = item.identifier.split(':').pop() || '';

          if (isRasterProcess(item)) {
            if (isExcludedRasterProcess(item.identifier, item.title)) {
              continue;
            }
            if (seenRasterLocalNames.has(localName)) {
              continue;
            }
            seenRasterLocalNames.add(localName);
            list.push(item);
          } else {
            const idLower = item.identifier.toLowerCase();
            const rule = VECTOR_WHITELIST_RULES.find(r =>
              r.match.some(m => idLower === m || idLower.endsWith(':' + m.split(':').pop()))
            );
            if (rule) {
              if (seenMappedTitles.has(rule.title)) {
                continue;
              }
              seenMappedTitles.add(rule.title);
              list.push({
                identifier: item.identifier,
                title: rule.title,
                abstract: rule.abstract
              });
            }
          }
        }

        list.sort((a, b) => a.title.localeCompare(b.title));
        setProcesses(list);
      } catch (err: any) {
        console.error(err);
        notification.error({
          message: 'WPS Capabilities Error',
          description: err.message || 'Failed to load available WPS processes.',
          placement: 'topRight'
        });
      } finally {
        setLoading(false);
      }
    };

    fetchCapabilities();
  }, [geoserverUrl, user?.geoserverAuth, notification]);

  // 2. Fetch process details & dynamic parameters
  const handleSelectProcess = async (processId: string) => {
    setSelectedProcess(processId);
    setResultLayerName('');
    setDescribeLoading(true);
    setProcessInputs([]);
    setFormValues({});
    setInputSources({});

    try {
      const headers: Record<string, string> = {};
      if (user?.geoserverAuth) {
        headers['Authorization'] = user.geoserverAuth;
      }
      const res = await fetch(`${geoserverUrl}/wps?service=WPS&version=1.0.0&request=DescribeProcess&identifier=${processId}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch process description details.');
      const text = await res.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, 'text/xml');

      const inputNodes = xmlDoc.getElementsByTagNameNS('*', 'Input');
      const parsedInputs: ProcessInput[] = [];

      for (let i = 0; i < inputNodes.length; i++) {
        const node = inputNodes[i];
        const identifier = node.getElementsByTagNameNS('*', 'Identifier')[0]?.textContent || '';
        const title = node.getElementsByTagNameNS('*', 'Title')[0]?.textContent || '';
        const abstract = node.getElementsByTagNameNS('*', 'Abstract')[0]?.textContent || '';
        const minOccurs = node.getAttribute('minOccurs');
        const required = minOccurs !== '0';

        let type: 'complex' | 'literal' | 'bbox' = 'literal';
        let dataType = '';
        let defaultValue = '';

        if (node.getElementsByTagNameNS('*', 'ComplexData').length > 0) {
          type = 'complex';
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
          defaultValue
        });
      }

      setProcessInputs(parsedInputs);

      // Parse the output identifier dynamically
      const outputNodes = xmlDoc.getElementsByTagNameNS('*', 'Output');
      if (outputNodes.length > 0) {
        const outId = outputNodes[0].getElementsByTagNameNS('*', 'Identifier')[0]?.textContent || 'result';
        setOutputIdentifier(outId);
      } else {
        setOutputIdentifier('result');
      }

      // Populate default parameters values
      const defaults: Record<string, any> = {};
      parsedInputs.forEach(input => {
        if (input.defaultValue) {
          defaults[input.identifier] = input.type === 'literal' && ['double', 'float', 'int', 'integer', 'long'].includes(input.dataType.toLowerCase())
            ? Number(input.defaultValue)
            : input.defaultValue;
        } else if (input.type === 'literal' && ['double', 'float', 'int', 'integer', 'long'].includes(input.dataType.toLowerCase())) {
          defaults[input.identifier] = input.identifier === 'distance' ? 100 : 0;
        }
      });
      setFormValues(defaults);

    } catch (err: any) {
      console.error(err);
      notification.error({
        message: 'DescribeProcess Failed',
        description: err.message || 'Could not parse process details.',
        placement: 'topRight'
      });
      setSelectedProcess('');
    } finally {
      setDescribeLoading(false);
    }
  };

  const handleSelectLayerChange = async (paramId: string, layerId: string) => {
    setFormValues(prev => ({ ...prev, [paramId]: layerId }));

    // If groupby or field parameters are expected, fetch attributes schema dynamically
    const hasFieldInput = processInputs.some(i => i.identifier === 'groupby' || i.identifier.includes('field'));
    if (!hasFieldInput) return;

    if (layerId.startsWith('wps_result_') || layerId.startsWith('raster_res_')) {
      const match = addedLayers.find(l => l.id === layerId);
      const features = (match as any)?.geojson?.features || [];
      if (features.length > 0 && features[0].properties) {
        setLayerFields(prev => ({ ...prev, [layerId]: Object.keys(features[0].properties) }));
      } else if (getLayerFeatures) {
        const fc = getLayerFeatures(layerId);
        if (fc?.features?.[0]?.properties) {
          setLayerFields(prev => ({ ...prev, [layerId]: Object.keys(fc.features[0].properties) }));
        }
      }
      return;
    }

    setFieldsLoading(prev => ({ ...prev, [layerId]: true }));
    try {
      const response = await fetch(`${geoserverUrl}/wfs?service=WFS&version=1.0.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`);
      if (response.ok) {
        const text = await response.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');
        const elements = xml.getElementsByTagNameNS('*', 'element');
        const fields: string[] = [];
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i];
          const name = el.getAttribute('name');
          const type = el.getAttribute('type') || '';
          if (name && !type.includes('Geometry') && !type.includes('gml:')) {
            fields.push(name);
          }
        }
        setLayerFields(prev => ({ ...prev, [layerId]: fields }));
      }
    } catch (e) {
      console.error('Failed to fetch layer fields schema:', e);
    } finally {
      setFieldsLoading(prev => ({ ...prev, [layerId]: false }));
    }
  };

  const handleStartDrawing = (paramId: string, customGeomType?: 'Point' | 'LineString' | 'Polygon') => {
    if (!onStartDrawGeom) return;

    const isDistance = selectedProcess.toLowerCase().includes('distance');
    const isNearest = selectedProcess.toLowerCase().includes('nearest');
    const geomType = customGeomType || ((paramId.toLowerCase() === 'point' || isNearest) ? 'Point' : 'Polygon');

    onStartDrawGeom(geomType, (geojson) => {
      setFormValues(prev => ({ ...prev, [paramId]: geojson }));
      notification.success({
        message: 'Geometry Captured',
        description: 'Direct map drawing geometry captured successfully.',
        placement: 'topRight'
      });
    }, paramId);
  };

  const handleBack = () => {
    setSelectedProcess('');
    setResultLayerName('');
    onStopDrawGeom?.();
  };

  const handleClosePanel = () => {
    onStopDrawGeom?.();
    onClose();
  };

  const handleExecute = async () => {
    if (!selectedProcess) return;

    // Validate required fields
    const missing = processInputs.find(i => i.required && (formValues[i.identifier] === undefined || formValues[i.identifier] === ''));
    if (missing) {
      notification.warning({
        message: 'Required Parameter Missing',
        description: `Please configure the required parameter: ${missing.title || missing.identifier}`,
        placement: 'topRight'
      });
      return;
    }

    setExecuting(true);

    try {
      const headers: Record<string, string> = {};
      if (user?.geoserverAuth) {
        headers['Authorization'] = user.geoserverAuth;
      }

      // Build data inputs XML nodes dynamically
      let dataInputsXml = '';
      for (const input of processInputs) {
        const val = formValues[input.identifier];
        if (val === undefined || val === '') continue;

        if (input.type === 'complex') {
          // If it is NOT a spatial layer input (e.g. classificationRanges config), serialize as plain text
          if (!isLayerInput(input.identifier)) {
            dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="text/plain"><![CDATA[${val}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
            continue;
          }

          // If it IS a spatial layer input, check if the selected layer is a raster layer
          const isRasterLayer = addedLayers.some(l => l.id === val && l.type === 'RASTER');
          if (isRasterLayer) {
            const layerState = addedLayers.find(l => l.id === val);
            const bbox = layerState?.bbox || [-180, -90, 180, 90];
            const minx = bbox[0];
            const miny = bbox[1];
            const maxx = bbox[2];
            const maxy = bbox[3];

            dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Reference mimeType="image/tiff" xlink:href="http://geoserver/wcs" method="POST">
        <wps:Body>
          <wcs:GetCoverage service="WCS" version="1.1.1">
            <ows:Identifier>${val}</ows:Identifier>
            <wcs:DomainSubset>
              <ows:BoundingBox crs="urn:ogc:def:crs:EPSG::4326">
                <ows:LowerCorner>${miny} ${minx}</ows:LowerCorner>
                <ows:UpperCorner>${maxy} ${maxx}</ows:UpperCorner>
              </ows:BoundingBox>
            </wcs:DomainSubset>
            <wcs:Output format="image/tiff"/>
          </wcs:GetCoverage>
        </wps:Body>
      </wps:Reference>
    </wps:Input>`;
            continue;
          }

          // Otherwise, it is a vector layer or drawn boundary
          const isJtsProcess = selectedProcess.toLowerCase().startsWith('jts:');
          const expectsGeometry = (isJtsProcess && ['geom', 'geometry', 'a', 'b', 'first', 'second'].includes(input.identifier.toLowerCase())) ||
            (selectedProcess.toLowerCase() === 'gs:clip' && input.identifier === 'clip') ||
            (selectedProcess.toLowerCase() === 'gs:distance' && ['first', 'second'].includes(input.identifier)) ||
            (selectedProcess.toLowerCase() === 'gs:nearest' && input.identifier === 'point');

          let geojsonPayload = null;
          if (getLayerFeatures) {
            geojsonPayload = getLayerFeatures(val);
          }

          let isWfsReference = false;
          let typeNameForWfs = '';

          if (!geojsonPayload && typeof val === 'string') {
            typeNameForWfs = val;
            const matchedLayer = addedLayers.find(l => l.id === val);
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
            if (isUuid && matchedLayer) {
              typeNameForWfs = matchedLayer.name;
            }

            // If it's a permanent layer (does not start with wps_result_) and the input expects a FeatureCollection rather than a raw JTS Geometry
            if (!typeNameForWfs.startsWith('wps_result_') && !expectsGeometry) {
              isWfsReference = true;
            }
          }

          if (isWfsReference) {
            const isDistanceOrBufferProcess =
              selectedProcess.toLowerCase() === 'gs:distance' ||
              selectedProcess.toLowerCase() === 'jts:distance' ||
              selectedProcess.toLowerCase() === 'gs:bufferfeaturecollection' ||
              selectedProcess.toLowerCase() === 'gs:buffer' ||
              selectedProcess.toLowerCase() === 'jts:buffer';
            const srsName = isDistanceOrBufferProcess ? 'EPSG:3857' : 'EPSG:4326';

            dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Reference mimeType="text/xml" xlink:href="http://geoserver/wfs" method="POST">
        <wps:Body>
          <wfs:GetFeature service="WFS" version="1.0.0" outputFormat="GML2" xmlns:wfs="http://www.opengis.net/wfs">
            <wfs:Query typeName="${typeNameForWfs}" srsName="${srsName}"/>
          </wfs:GetFeature>
        </wps:Body>
      </wps:Reference>
    </wps:Input>`;
            continue;
          }

          if (!geojsonPayload && typeof val === 'string') {
            if (typeNameForWfs.startsWith('wps_result_')) {
              throw new Error(`Temporary result layer "${typeNameForWfs}" is empty or not found on the map. Please re-run the previous analysis.`);
            }
            const queryUrl = `${geoserverUrl}/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=${encodeURIComponent(typeNameForWfs)}&outputFormat=application/json&srsName=EPSG:4326`;
            const fetchRes = await fetch(queryUrl, { headers });
            if (!fetchRes.ok) {
              throw new Error(`Failed to retrieve WFS features for layer ${typeNameForWfs}`);
            }
            geojsonPayload = await fetchRes.json();
          } else if (!geojsonPayload) {
            geojsonPayload = val;
          }

          let finalPayload = geojsonPayload;
          if (expectsGeometry) {
            if (geojsonPayload && geojsonPayload.type === 'FeatureCollection') {
              if (geojsonPayload.features.length === 0) {
                finalPayload = null;
              } else if (geojsonPayload.features.length === 1) {
                finalPayload = geojsonPayload.features[0].geometry;
              } else {
                const types = geojsonPayload.features.map((f: any) => f.geometry?.type || '');
                const isPolygon = types.every((t: string) => t === 'Polygon' || t === 'MultiPolygon');
                const isLine = types.every((t: string) => t === 'LineString' || t === 'MultiLineString');
                const isPoint = types.every((t: string) => t === 'Point' || t === 'MultiPoint');

                if (isPolygon) {
                  const coords: any[] = [];
                  geojsonPayload.features.forEach((f: any) => {
                    if (f.geometry.type === 'Polygon') {
                      coords.push(f.geometry.coordinates);
                    } else if (f.geometry.type === 'MultiPolygon') {
                      coords.push(...f.geometry.coordinates);
                    }
                  });
                  finalPayload = { type: 'MultiPolygon', coordinates: coords };
                } else if (isLine) {
                  const coords: any[] = [];
                  geojsonPayload.features.forEach((f: any) => {
                    if (f.geometry.type === 'LineString') {
                      coords.push(f.geometry.coordinates);
                    } else if (f.geometry.type === 'MultiLineString') {
                      coords.push(...f.geometry.coordinates);
                    }
                  });
                  finalPayload = { type: 'MultiLineString', coordinates: coords };
                } else if (isPoint) {
                  const coords: any[] = [];
                  geojsonPayload.features.forEach((f: any) => {
                    if (f.geometry.type === 'Point') {
                      coords.push(f.geometry.coordinates);
                    } else if (f.geometry.type === 'MultiPoint') {
                      coords.push(...f.geometry.coordinates);
                    }
                  });
                  finalPayload = { type: 'MultiPoint', coordinates: coords };
                } else {
                  finalPayload = geojsonPayload.features[0].geometry;
                }
              }
            } else if (geojsonPayload && geojsonPayload.type === 'Feature') {
              finalPayload = geojsonPayload.geometry;
            }
          }

          if (finalPayload) {
            if (finalPayload.type === 'FeatureCollection') {
              const standardized = standardizeFeatureCollectionGeometries(finalPayload);
              finalPayload = {
                ...standardized,
                features: (standardized.features || []).map((f: any) => ({
                  ...f,
                  geometry: cleanGeoJsonGeometry(f.geometry)
                }))
              };
            } else if (finalPayload.type === 'Feature') {
              finalPayload = {
                ...finalPayload,
                geometry: cleanGeoJsonGeometry(finalPayload.geometry)
              };
            } else {
              finalPayload = cleanGeoJsonGeometry(finalPayload);
            }

            // If it is a distance or buffer process, project coordinates to EPSG:3857 (Web Mercator meters) client-side
            const isDistanceOrBufferProcess =
              selectedProcess.toLowerCase() === 'gs:distance' ||
              selectedProcess.toLowerCase() === 'jts:distance' ||
              selectedProcess.toLowerCase() === 'gs:bufferfeaturecollection' ||
              selectedProcess.toLowerCase() === 'gs:buffer' ||
              selectedProcess.toLowerCase() === 'jts:buffer';
            if (isDistanceOrBufferProcess) {
              if (finalPayload.type === 'FeatureCollection') {
                finalPayload = {
                  ...finalPayload,
                  features: (finalPayload.features || []).map((f: any) => ({
                    ...f,
                    geometry: projectGeometry(f.geometry)
                  }))
                };
              } else if (finalPayload.type === 'Feature') {
                finalPayload = {
                  ...finalPayload,
                  geometry: projectGeometry(finalPayload.geometry)
                };
              } else {
                finalPayload = projectGeometry(finalPayload);
              }
            }
          }

          dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:ComplexData mimeType="application/json"><![CDATA[${JSON.stringify(finalPayload)}]]></wps:ComplexData>
      </wps:Data>
    </wps:Input>`;
        } else if (input.type === 'bbox') {
          const parts = typeof val === 'string' ? val.split(/[,\s]+/).map(Number) : [];
          if (parts.length >= 4) {
            dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <ows:BoundingBox crs="urn:ogc:def:crs:EPSG::4326">
          <ows:LowerCorner>${parts[1]} ${parts[0]}</ows:LowerCorner>
          <ows:UpperCorner>${parts[3]} ${parts[2]}</ows:UpperCorner>
        </ows:BoundingBox>
      </wps:Data>
    </wps:Input>`;
          }
        } else {
          dataInputsXml += `
    <wps:Input>
      <ows:Identifier>${input.identifier}</ows:Identifier>
      <wps:Data>
        <wps:LiteralData>${val}</wps:LiteralData>
      </wps:Data>
    </wps:Input>`;
        }
      }

      const isRasterProc = isRasterProcess({ identifier: selectedProcess });
      const isContour = selectedProcess.toLowerCase().includes('contour');
      const outputMimeType = (isRasterProc && !isContour) ? 'image/tiff' : 'application/json';

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<wps:Execute version="1.0.0" service="WPS" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.opengis.net/wps/1.0.0" xmlns:wfs="http://www.opengis.net/wfs" xmlns:wps="http://www.opengis.net/wps/1.0.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:gml="http://www.opengis.net/gml" xmlns:ogc="http://www.opengis.net/ogc" xmlns:wcs="http://www.opengis.net/wcs/1.1.1" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:schemaLocation="http://www.opengis.net/wps/1.0.0 http://schemas.opengis.net/wps/1.0.0/wpsAll.xsd">
  <ows:Identifier>${selectedProcess}</ows:Identifier>
  <wps:DataInputs>
    ${dataInputsXml}
  </wps:DataInputs>
  <wps:ResponseForm>
    <wps:RawDataOutput mimeType="${outputMimeType}">
      <ows:Identifier>${outputIdentifier}</ows:Identifier>
    </wps:RawDataOutput>
  </wps:ResponseForm>
</wps:Execute>`;

      const executeHeaders: Record<string, string> = {
        ...headers,
        'Content-Type': 'application/xml',
      };

      const response = await fetch(`${geoserverUrl}/wps`, {
        method: 'POST',
        headers: executeHeaders,
        body: xmlPayload,
      });

      let geojson = null;

      if (outputMimeType === 'image/tiff') {
        let isXmlError = false;
        let xmlText = '';
        const contentType = response.headers.get('content-type') || '';

        if (!response.ok || contentType.includes('xml') || contentType.includes('text')) {
          isXmlError = true;
          xmlText = await response.text();
        } else {
          // Read array buffer
          const buffer = await response.arrayBuffer();
          // Check if it's actually an XML exception (sometimes Content-Type is wrong or generic)
          const snippet = new Uint8Array(buffer.slice(0, 1000));
          const decoded = new TextDecoder().decode(snippet).toLowerCase();
          if (decoded.includes('<?xml') || decoded.includes('exceptionreport') || decoded.includes('exception')) {
            isXmlError = true;
            xmlText = new TextDecoder().decode(new Uint8Array(buffer));
          } else {
            // It's a valid binary image/TIFF!
            const blob = new Blob([buffer], { type: 'image/tiff' });
            const imageUrl = URL.createObjectURL(blob);
            const finalLayerName = resultLayerName.trim() || `${selectedProcess.split(':').pop()}_result`;

            notification.success({
              message: 'Raster Analysis Complete',
              description: `Layer ${finalLayerName} generated and loaded successfully.`,
              placement: 'topRight'
            });

            onExecuteSuccess({
              type: 'RASTER',
              layerName: finalLayerName,
              imageUrl,
              imageBlob: blob,
            }, finalLayerName);

            setExecuting(false);
            return;
          }
        }

        if (isXmlError) {
          const parser = new DOMParser();
          const xml = parser.parseFromString(xmlText, 'text/xml');
          const exceptionNode = xml.getElementsByTagNameNS('*', 'Exception')[0] || xml.getElementsByTagName('ows:Exception')[0];
          if (exceptionNode) {
            const exceptionText = xml.getElementsByTagNameNS('*', 'ExceptionText')[0]?.textContent || exceptionNode.textContent || 'Unknown WPS Exception';
            throw new Error(exceptionText.trim());
          }
          throw new Error(xmlText || 'Failed to execute WPS process');
        }
      } else {
        const responseText = await response.text();

        // Check if response contains XML anywhere (since exceptions can be appended after partial JSON output)
        const xmlStartIndex = responseText.indexOf('<?xml');
        const exceptionStartIndex = responseText.indexOf('<ows:ExceptionReport');
        const targetIndex = xmlStartIndex !== -1 ? xmlStartIndex : exceptionStartIndex;

        let parsedBBoxGeojson = null;
        if (targetIndex !== -1 || responseText.trim().startsWith('<')) {
          const xmlText = targetIndex !== -1 ? responseText.slice(targetIndex) : responseText;
          try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'text/xml');
            const exceptionNode = xml.getElementsByTagNameNS('*', 'Exception')[0] || xml.getElementsByTagName('ows:Exception')[0];
            if (exceptionNode) {
              const exceptionText = xml.getElementsByTagNameNS('*', 'ExceptionText')[0]?.textContent || exceptionNode.textContent || 'Unknown WPS Exception';
              throw new Error(exceptionText.trim());
            }

            // Check if it's a valid BoundingBox output (not an exception)
            const bboxNode = xml.getElementsByTagNameNS('*', 'BoundingBox')[0] || xml.getElementsByTagName('ows:BoundingBox')[0];
            if (bboxNode) {
              const lowerCorner = bboxNode.getElementsByTagNameNS('*', 'LowerCorner')[0]?.textContent || '';
              const upperCorner = bboxNode.getElementsByTagNameNS('*', 'UpperCorner')[0]?.textContent || '';
              const crs = bboxNode.getAttribute('crs') || 'EPSG:4326';

              const lowerCoords = lowerCorner.trim().split(/\s+/).map(Number);
              const upperCoords = upperCorner.trim().split(/\s+/).map(Number);

              if (lowerCoords.length >= 2 && upperCoords.length >= 2) {
                const minX = lowerCoords[0];
                const minY = lowerCoords[1];
                const maxX = upperCoords[0];
                const maxY = upperCoords[1];

                // Map bbox corners to a closed rectangular polygon GeoJSON
                parsedBBoxGeojson = {
                  type: 'FeatureCollection',
                  features: [
                    {
                      type: 'Feature',
                      geometry: {
                        type: 'Polygon',
                        coordinates: [
                          [
                            [minX, minY],
                            [maxX, minY],
                            [maxX, maxY],
                            [minX, maxY],
                            [minX, minY]
                          ]
                        ]
                      },
                      properties: {
                        crs: crs
                      }
                    }
                  ]
                };
              }
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes('parsing')) {
              throw parseErr;
            }
          }

          if (!parsedBBoxGeojson) {
            throw new Error(`Server Exception: ${xmlText.slice(0, 300)}`);
          }
        }

        if (!response.ok && !parsedBBoxGeojson) {
          throw new Error(responseText || 'Failed to execute WPS process');
        }

        if (parsedBBoxGeojson) {
          geojson = parsedBBoxGeojson;
        } else {
          try {
            geojson = JSON.parse(responseText);
          } catch (parseErr: any) {
            console.error('Failed to parse WPS response:', responseText, parseErr);
            throw new Error(`Invalid JSON response from WPS server. Response was: ${responseText.slice(0, 300)}`);
          }
        }
      }

      // If the result is a number, it's a literal result (like distance)
      if (typeof geojson === 'number' || !isNaN(Number(geojson))) {
        const numVal = Number(geojson);

        let distanceInMeters = numVal;
        let _scaleFormulaInfo = '';

        const isDistanceProcess = selectedProcess.toLowerCase() === 'gs:distance' || selectedProcess.toLowerCase() === 'jts:distance';
        if (isDistanceProcess) {
          // Find the average latitude of original coordinates in formValues to compute cosine scale factor correction
          let latSum = 0;
          let latCount = 0;

          const extractLats = (obj: any) => {
            if (!obj) return;
            if (Array.isArray(obj)) {
              if (obj.length > 0 && typeof obj[0] === 'number') {
                if (Math.abs(obj[1]) <= 90) {
                  latSum += obj[1];
                  latCount++;
                }
              } else {
                obj.forEach(extractLats);
              }
            } else if (typeof obj === 'object') {
              Object.values(obj).forEach(extractLats);
            }
          };

          Object.values(formValues).forEach(extractLats);
          const avgLat = latCount > 0 ? (latSum / latCount) : 0;

          // Web Mercator distance is stretched by 1 / cos(lat).
          // We multiply by cos(lat) to get the correct ellipsoidal geodesic distance in meters.
          const cosLat = Math.cos((avgLat * Math.PI) / 180);
          distanceInMeters = numVal * cosLat;
          _scaleFormulaInfo = `Measured via EPSG:3857 (projected) corrected by cos(${avgLat.toFixed(4)}°) scale factor`;
        } else {
          // Fallback for non-distance literal results
          distanceInMeters = numVal * 111320;
          _scaleFormulaInfo = `Approximate equirectangular degree multiplier conversion`;
        }

        const formattedDistance = distanceInMeters < 1e-7
          ? '0 meters and overlapping'
          : (distanceInMeters >= 1000
            ? `${(distanceInMeters / 1000).toFixed(7)} km`
            : `${distanceInMeters.toFixed(7)} meters`);

        Modal.success({
          title: <span className="text-xs md:text-sm font-bold text-gray-800">Distance Analysis Result</span>,
          width: isMobile ? '88%' : 380,
          style: { top: isMobile ? 12 : 50 },
          content: (
            <div className="flex flex-col gap-1 pt-2 w-full">
              <div className="text-[10px] md:text-xs text-gray-500 font-medium leading-relaxed">The calculated spatial distance between the two selected geometries is:</div>
              <div className="text-lg md:text-2xl font-black text-gray-800 my-1 select-all tracking-tight break-all">
                {formattedDistance}
              </div>
            </div>
          ),
          okText: 'Close',
          okButtonProps: {
            className: 'bg-primary border-primary text-white rounded-lg px-3 hover:bg-primary-hover hover:border-primary-hover h-7 md:h-8 text-[10px] md:text-xs font-bold'
          }
        });


        // Clear drawn geometries from form values
        setFormValues(prev => {
          const next = { ...prev };
          Object.keys(inputSources).forEach((key) => {
            if (inputSources[key] === 'draw') {
              delete next[key];
            }
          });
          return next;
        });

        setExecuting(false);
        if (onStopDrawGeom) {
          onStopDrawGeom();
        }
        return; // Early return to avoid adding result layer to map
      }

      if (geojson && ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(geojson.type)) {
        geojson = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: geojson,
              properties: {}
            }
          ]
        };
      } else if (geojson && geojson.type === 'Feature') {
        geojson = {
          type: 'FeatureCollection',
          features: [geojson]
        };
      }

      if (!geojson || geojson.type !== 'FeatureCollection') {
        throw new Error('Invalid GeoJSON returned from WPS server');
      }

      notification.success({
        message: 'WPS Execution Complete',
        description: `Successfully executed ${selectedProcess.split(':').pop()}`,
        placement: 'topRight'
      });

      // Clear drawn geometries from form values
      setFormValues(prev => {
        const next = { ...prev };
        Object.keys(inputSources).forEach((key) => {
          if (inputSources[key] === 'draw') {
            delete next[key];
          }
        });
        return next;
      });

      const finalLayerName = resultLayerName.trim() || `${selectedProcess.split(':').pop()}_result`;
      onExecuteSuccess(geojson, finalLayerName);
    } catch (err: any) {
      console.error(err);
      notification.error({
        message: 'WPS Execution Failed',
        description: err.message || 'An error occurred during WPS process execution.',
        placement: 'topRight'
      });
    } finally {
      setExecuting(false);
    }
  };

  const vectorLayers = addedLayers.filter(l =>
    l.type === 'VECTOR' &&
    (allDatasets || []).some(d => d.id === l.id || d.name === l.id)
  );
  const _rasterLayers = addedLayers.filter(l =>
    l.type === 'RASTER' &&
    (allDatasets || []).some(d => d.id === l.id || d.name === l.id)
  );
  const activeProcessDetails = processes.find(p => p.identifier === selectedProcess);

  // Filter based on selected Tab and search query
  const filteredProcesses = processes
    .filter(p => (activeTab === 'raster' ? isRasterProcess(p) : isVectorProcess(p)))
    .filter(p =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.identifier.toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <div
      className="absolute left-0 md:left-auto md:right-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-l border-gray-150 shadow-2xl md:shadow-xl z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-right transition-all duration-300"
      style={{ display: isMobile && isDrawing ? 'none' : 'flex' }}
    >
      {isMobile && (
        <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
      )}
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0 select-none">
        <div className="flex items-center gap-2">
          {selectedProcess && (
            <Button
              type="text"
              size="small"
              icon={<ArrowLeft size={14} />}
              onClick={handleBack}
              className="flex items-center justify-center rounded-full hover:bg-gray-100 shrink-0"
            />
          )}
          <span className="font-bold text-gray-800 uppercase tracking-wider text-xs truncate">WPS Analysis</span>
        </div>
        <Button
          type="text"
          size="small"
          icon={<X size={14} />}
          onClick={handleClosePanel}
          className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 shrink-0"
        />
      </div>

      {/* Body */}
      <div className="flex-grow overflow-y-auto p-4 flex flex-col min-h-0">
        {activeTab === 'raster' ? (
          <div className="flex flex-col gap-3 w-full h-full">
            <div className="shrink-0">
              <Segmented
                options={[
                  { label: 'Vector Analysis', value: 'vector' },
                  { label: 'Raster Analysis', value: 'raster' }
                ]}
                value={activeTab}
                onChange={(val: any) => {
                  setActiveTab(val);
                  setSelectedProcess('');
                }}
                block
                className="rounded-xl border border-gray-100"
              />
            </div>
            <RasterAnalysisPanel
              addedLayers={addedLayers}
              user={user}
              notification={notification}
              onExecuteSuccess={onExecuteSuccess}
              onStartDrawGeom={onStartDrawGeom}
              onStopDrawGeom={onStopDrawGeom}
              allDatasets={allDatasets}
              isMobile={isMobile}
            />
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 flex-grow">
            <Spin size="medium" />
            <div className="text-[11px] text-gray-400 font-medium">Fetching GeoServer WPS Processes...</div>
          </div>
        ) : !selectedProcess ? (
          // View 1: Process Cards list
          <div className="flex flex-col gap-4 w-full">
            {/* Category Tab Segmented Control */}
            <div className="shrink-0">
              <Segmented
                options={[
                  { label: 'Vector Analysis', value: 'vector' },
                  { label: 'Raster Analysis', value: 'raster' }
                ]}
                value={activeTab}
                onChange={(val: any) => setActiveTab(val)}
                block
                className="rounded-xl border border-gray-100"
              />
            </div>

            <div className="relative shrink-0">
              <Input
                placeholder="Search WPS processes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                prefix={<Search size={14} className="text-gray-400" />}
                className="w-full rounded-xl bg-gray-50 border-gray-200"
                allowClear
              />
            </div>

            <div className="space-y-3 pr-1 w-full">
              {filteredProcesses.map(p => (
                <div key={p.identifier} className="p-3.5 bg-gray-50 border border-gray-200 rounded-2xl hover:border-primary/35 hover:bg-primary/5 transition-all flex flex-col gap-2">
                  <div>
                    <div className="font-bold text-gray-800 text-xs truncate">{p.title}</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">{p.identifier}</div>
                  </div>
                  <div className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{p.abstract || 'No description available.'}</div>
                  <Button
                    type="primary"
                    onClick={() => handleSelectProcess(p.identifier)}
                    className="self-end text-[11px] h-7 font-bold rounded-lg px-4"
                  >
                    Configure
                  </Button>
                </div>
              ))}
              {filteredProcesses.length === 0 && (
                <div className="text-xs text-gray-400 text-center py-8">No WPS processes found in this category.</div>
              )}
            </div>
          </div>
        ) : describeLoading ? (
          // View 2: DescribeProcess fetching
          <div className="flex flex-col items-center justify-center py-10 gap-3 flex-grow">
            <Spin size="medium" />
            <div className="text-[11px] text-gray-400 font-medium">Loading process parameters schema...</div>
          </div>
        ) : (
          // View 3: Dynamic parameter form
          <div className="flex flex-col gap-4 w-full">
            {activeProcessDetails && (
              <div className="p-3 bg-blue-50/50 rounded-2xl border border-blue-100 text-xs text-gray-600 flex gap-2 shrink-0">
                <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-gray-800">{activeProcessDetails.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-gray-500">{activeProcessDetails.abstract || 'No description available.'}</div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4 pr-1 w-full">
              {processInputs.map((input) => {
                const isNumber = input.type === 'literal' && ['double', 'float', 'int', 'integer', 'long'].includes(input.dataType.toLowerCase());
                const isComplex = input.type === 'complex';
                const isDistanceProcess = selectedProcess.toLowerCase().includes('distance');
                const isNearestProcess = selectedProcess.toLowerCase().includes('nearest');
                const drawAllowed = isDrawAllowed(selectedProcess, input.identifier);
                const inputSource = !drawAllowed ? 'layer' : (inputSources[input.identifier] || 'layer');
                const isFieldSelect = input.identifier === 'groupby' || input.identifier.includes('field');

                return (
                  <div key={input.identifier} className="flex flex-col gap-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                      {input.title || input.identifier}
                      {input.required && <span className="text-red-500 ml-1 font-bold">*</span>}
                    </label>

                    {isComplex ? (
                      <div className="flex flex-col gap-3">
                        {!isLayerInput(input.identifier) ? (
                          <Input.TextArea
                            rows={3}
                            placeholder={input.abstract || "Enter configuration parameter..."}
                            value={formValues[input.identifier] !== undefined ? formValues[input.identifier] : ''}
                            onChange={e => {
                              const rawVal = e.target.value;
                              setFormValues(prev => ({ ...prev, [input.identifier]: rawVal }));
                            }}
                            className="w-full rounded-lg text-xs font-mono"
                          />
                        ) : (
                          <>
                            {activeTab === 'vector' && drawAllowed && (
                              <Segmented
                                options={[
                                  { label: 'Layer', value: 'layer' },
                                  { label: 'Draw', value: 'draw' }
                                ]}
                                value={inputSource}
                                onChange={(val: any) => {
                                  setInputSources(prev => ({ ...prev, [input.identifier]: val }));
                                  setFormValues(prev => ({ ...prev, [input.identifier]: undefined }));
                                }}
                                block
                                className="text-xs rounded-lg"
                              />
                            )}

                            {inputSource === 'layer' ? (
                              (() => {
                                const selectedLayerIdsInOtherParams = Object.keys(formValues)
                                  .filter(key => key !== input.identifier)
                                  .map(key => formValues[key]);
                                const availableLayers = vectorLayers
                                  .filter(l => !selectedLayerIdsInOtherParams.includes(l.id));

                                return (
                                  <Select
                                    showSearch
                                    value={formValues[input.identifier] || ''}
                                    onChange={val => handleSelectLayerChange(input.identifier, val)}
                                    className="w-full"
                                    placeholder="Select input layer"
                                    options={availableLayers.map(l => ({ label: l.name, value: l.id }))}
                                    filterOption={(inputStr, option) =>
                                      (option?.label ?? '').toString().toLowerCase().includes(inputStr.toLowerCase())
                                    }
                                  />
                                );
                              })()
                            ) : (
                              <div className="flex items-center gap-2">
                                {formValues[input.identifier] ? (
                                  (() => {
                                    const capturedGeomType = formValues[input.identifier]?.geometry?.type || formValues[input.identifier]?.type;
                                    const redrawType = (capturedGeomType === 'Polygon' || capturedGeomType === 'MultiPolygon')
                                      ? 'Polygon'
                                      : (capturedGeomType === 'Point' || capturedGeomType === 'MultiPoint' ? 'Point' : ((isDistanceProcess || isNearestProcess) ? 'Point' : 'Polygon'));

                                    return (
                                      <div className="flex items-center justify-between border border-emerald-250 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl flex-grow text-xs font-medium">
                                        <span className="flex items-center gap-1.5">
                                          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                                          Geometry Captured!
                                        </span>
                                        <Button
                                          type="text"
                                          size="small"
                                          icon={<RotateCcw size={12} className="text-emerald-600" />}
                                          onClick={() => handleStartDrawing(input.identifier, redrawType)}
                                          className="h-6 hover:bg-emerald-100 flex items-center justify-center rounded"
                                        >
                                          Redraw
                                        </Button>
                                      </div>
                                    );
                                  })()
                                ) : (isDistanceProcess || isNearestProcess) ? (
                                  <div className="flex flex-col gap-1.5 w-full">
                                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">
                                      Choose drawing type:
                                    </div>
                                    <div className="flex flex-wrap sm:flex-nowrap gap-1.5 w-full">
                                      <Button
                                        type="dashed"
                                        icon={<MapPin size={11} className="text-gray-400" />}
                                        onClick={() => handleStartDrawing(input.identifier, 'Point')}
                                        className="flex-1 min-w-[70px] flex items-center justify-center gap-1 text-[11px] rounded-xl h-8 text-gray-500 hover:text-primary hover:border-primary"
                                        style={{ padding: '0 4px' }}
                                      >
                                        Point
                                      </Button>
                                      <Button
                                        type="dashed"
                                        icon={<PenTool size={11} className="text-gray-400" />}
                                        onClick={() => handleStartDrawing(input.identifier, 'Polygon')}
                                        className="flex-1 min-w-[70px] flex items-center justify-center gap-1 text-[11px] rounded-xl h-8 text-gray-500 hover:text-primary hover:border-primary"
                                        style={{ padding: '0 4px' }}
                                      >
                                        Polygon
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <Button
                                    type="dashed"
                                    icon={<PenTool size={13} className="text-gray-500 shrink-0" />}
                                    onClick={() => handleStartDrawing(input.identifier, 'Polygon')}
                                    className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border-dashed border-gray-300 text-gray-700 hover:text-primary hover:border-primary text-xs font-medium"
                                  >
                                    Draw Polygon
                                  </Button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ) : isFieldSelect ? (
                      (() => {
                        const featuresInput = processInputs.find(i => i.identifier === 'features' || i.identifier.includes('layer') || i.identifier.includes('first'));
                        const selectedLayerId = featuresInput ? formValues[featuresInput.identifier] : '';
                        const fields = selectedLayerId ? (layerFields[selectedLayerId] || []) : [];
                        const isFieldsLoading = selectedLayerId ? !!fieldsLoading[selectedLayerId] : false;

                        return (
                          <Select
                            value={formValues[input.identifier] || ''}
                            onChange={val => setFormValues(prev => ({ ...prev, [input.identifier]: val }))}
                            className="w-full"
                            placeholder={selectedLayerId ? "Select attribute field" : "Please select features layer first"}
                            disabled={!selectedLayerId || isFieldsLoading}
                            loading={isFieldsLoading}
                            options={fields.map(f => ({ label: f, value: f }))}
                          />
                        );
                      })()
                    ) : input.type === 'bbox' ? (
                      <div className="relative">
                        <Input
                          type="text"
                          placeholder="e.g. minx, miny, maxx, maxy"
                          value={formValues[input.identifier] !== undefined ? formValues[input.identifier] : ''}
                          onChange={e => {
                            const rawVal = e.target.value;
                            setFormValues(prev => ({ ...prev, [input.identifier]: rawVal }));
                          }}
                          className="w-full rounded-lg"
                        />
                      </div>
                    ) : (
                      <div className="relative">
                        <Input
                          type={isNumber ? 'number' : 'text'}
                          value={formValues[input.identifier] !== undefined ? formValues[input.identifier] : ''}
                          onChange={e => {
                            const rawVal = e.target.value;
                            const typedVal = isNumber && rawVal !== '' ? Number(rawVal) : rawVal;
                            setFormValues(prev => ({ ...prev, [input.identifier]: typedVal }));
                          }}
                          className="w-full rounded-lg"
                        />
                        {input.identifier === 'distance' && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-bold uppercase tracking-wider select-none">
                            meters
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Result Layer Name + Execute Button */}
            <div className="pt-3 border-t border-gray-100 shrink-0 flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Result Layer Name</label>
                <Input
                  placeholder={`${selectedProcess.split(':').pop()}_result`}
                  value={resultLayerName}
                  onChange={e => setResultLayerName(e.target.value)}
                  className="w-full rounded-lg text-xs"
                />
              </div>
              <Button
                type="primary"
                icon={<Play size={14} />}
                loading={executing}
                onClick={handleExecute}
                className="w-full h-10 font-bold rounded-xl flex items-center justify-center gap-1.5"
              >
                Execute Analysis
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
