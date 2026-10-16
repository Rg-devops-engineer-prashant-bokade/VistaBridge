// ============================================================================
// 2D Map Page (OpenLayers Engine)
//
// Interactive GIS map viewer:
// - Renders WMS/WFS layers from GeoServer, vector tiles, and XYZ basemaps.
// - Supports measurements (distance/area), drawing annotations, layer styling,
//   attribute tables, query building, and spatial WPS raster analysis.
// - Saves and loads map projects to/from SQLite (/api/maps/*).
// ============================================================================


/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useState, useRef, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useConfigStore } from '@/store/useConfigStore';
import { Spin, Typography, Button, App, Divider, Tooltip, Modal, Input, Dropdown, Table, Tag, Select, Popover, Slider } from 'antd';
import {
  ArrowLeft,
  ArrowRight,
  Map as MapIcon,
  Globe,
  Layers,
  Search,
  Compass,
  Navigation,
  Share2,
  Save,
  Edit2,
  Plus,
  Minus,
  Maximize,
  Info,
  Ruler,
  PenTool,
  Expand,
  ChevronDown,
  Workflow,
  Grid,
  X,
  Eye,
  EyeOff,
  Trash2,
  Palette,
  MapPin,
  Type,
  Activity,
  Square,
  Circle,
  Database,
  CircleDot,
  BoxSelect,
} from 'lucide-react';
import { apiRequest } from '@/lib/api';
import basemapsConfig from '@/config/basemap.config.json';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import Geocoder from '@/components/map/Geocoder';
import StyleEditor from '@/components/map/StyleEditor';
import AttributeTable, { type ZoomToFeaturesPayload } from '@/components/map/AttributeTable';
import FuzzySearch from '@/components/map/FuzzySearch';
import PrintComponent from '@/components/map/PrintComponent';
import QueryBuilder from '@/components/map/QueryBuilder';
import type { LayerActiveFilters } from '@/components/map/QueryBuilder/types';
import GoToXY from '@/components/map/GoToXY';
import LayerListPanel2D from '@/components/map/LayerListPanel2D';
import AnalysisPanel2D from '@/components/map/AnalysisPanel2D';
import WpsAnalysisPanel from '@/components/map/WpsAnalysisPanel';
import { ensureProjection } from '@/raster-analysis/services/rasterCRS';
import { sampleRasterPixel } from '@/raster-analysis/services/rasterPixelSample';
import { siteConfig } from '@/config/site-config';

import Feature from 'ol/Feature';

// OpenLayers Imports
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ImageLayer from 'ol/layer/Image';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import { toLonLat, fromLonLat, transformExtent } from 'ol/proj';
import { defaults as defaultControls } from 'ol/control';
import XYZ from 'ol/source/XYZ';
import TileWMS from 'ol/source/TileWMS';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import Draw, { createBox, createRegularPolygon } from 'ol/interaction/Draw';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom';
import { defaults as defaultInteractions } from 'ol/interaction';
import DragZoom from 'ol/interaction/DragZoom';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import { getLength, getArea } from 'ol/sphere';
import { Stroke, Style, Fill, Circle as CircleStyle, Text as TextStyle, Icon } from 'ol/style';

// Custom tile loader for GeoServer WMS layers:
// - Loads tiles with browser caching if no custom auth is needed.
// - If the URL exceeds 2048 characters (due to large CQL filters), automatically
//   switches to HTTP POST to prevent HTTP 414 URI Too Long errors.
// - Forwards GeoServer Basic Auth headers if logged in.
const createWmsTileLoadFunction = (geoserverAuth?: string) => {


  return (tile: any, src: string) => {
    const img = tile.getImage();

    // 1. Fast path: native browser image loading when no custom auth and standard GET URL.
    // Browser natively manages parallel downloads, automatically cancels unneeded tiles on zoom,
    // and uses browser HTTP disk/memory cache.
    if (!geoserverAuth && src.length <= 2048) {
      img.src = src;
      return;
    }

    // 2. Fetch path: required for custom Authorization headers or long POST bodies (>2048 chars)
    let objectUrl: string | null = null;
    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const headers: Record<string, string> = {};
    if (geoserverAuth) headers['Authorization'] = geoserverAuth;

    (async () => {
      try {
        let res: Response;
        if (src.length > 2048) {
          const qIdx = src.indexOf('?');
          const baseUrl = qIdx !== -1 ? src.substring(0, qIdx) : src;
          const query = qIdx !== -1 ? src.substring(qIdx + 1) : '';

          res = await fetch(baseUrl, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: query,
          });
        } else {
          res = await fetch(src, { headers });
        }

        if (!res.ok) throw new Error(`WMS tile failed: ${res.status}`);
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('xml') || contentType.includes('html')) {
          throw new Error(`WMS returned XML/HTML error: ${contentType}`);
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);

        img.onload = () => {
          cleanup();
        };
        img.onerror = () => {
          cleanup();
        };

        img.src = objectUrl;
      } catch (err: any) {
        cleanup();
        console.warn('Failed to load WMS tile:', err?.message || err);
        if (typeof tile.setState === 'function') {
          tile.setState(3); // ImageState.ERROR
        }
      }
    })();
  };
};
import { fromCircle } from 'ol/geom/Polygon';

const { Title, Text } = Typography;

const measurementStyleFunction = (feature: any) => {
  if (feature.get('visible') === false) {
    return [];
  }

  const styles: Style[] = [];
  const geom = feature.getGeometry();
  if (!geom) return styles;

  const type = geom.getType();

  // 1. Add the main geometry style
  styles.push(new Style({
    fill: new Fill({
      color: 'rgba(147, 51, 234, 0.15)',
    }),
    stroke: new Stroke({
      color: '#9333ea',
      width: 2.5,
      lineDash: type === 'LineString' ? [6, 4] : [],
    }),
  }));

  // 2. Compute and add segment length labels
  let coordinates: any[] = [];
  if (type === 'LineString') {
    coordinates = geom.getCoordinates();
  } else if (type === 'Polygon') {
    coordinates = geom.getCoordinates()[0] || [];
  }

  const count = type === 'Polygon' ? coordinates.length - 1 : coordinates.length - 1;
  let totalLength = 0;

  for (let i = 0; i < count; i++) {
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    if (!p1 || !p2) continue;

    const segmentGeom = new LineString([p1, p2]);
    const segmentLength = getLength(segmentGeom);
    totalLength += segmentLength;

    let lengthText = '';
    if (segmentLength > 1000) {
      lengthText = `${(segmentLength / 1000).toFixed(2)} km`;
    } else {
      lengthText = `${segmentLength.toFixed(1)} m`;
    }

    const midpoint = [
      (p1[0] + p2[0]) / 2,
      (p1[1] + p2[1]) / 2
    ];

    styles.push(new Style({
      geometry: new Point(midpoint),
      text: new TextStyle({
        text: lengthText,
        font: 'bold 10px Inter, sans-serif',
        fill: new Fill({ color: '#1e1b4b' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
        offsetY: -8,
      }),
    }));
  }

  // 3. Add total label (Perimeter / Area / Total Length)
  let totalText = '';
  let totalPosition: any = null;

  if (type === 'LineString' && coordinates.length > 0) {
    totalText = `Total: ${totalLength > 1000 ? (totalLength / 1000).toFixed(2) + ' km' : totalLength.toFixed(1) + ' m'}`;
    totalPosition = coordinates[coordinates.length - 1];
  } else if (type === 'Polygon' && coordinates.length > 0) {
    const area = getArea(geom);
    let areaText = '';
    if (area > 1000000) {
      areaText = `Area: ${(area / 1000000).toFixed(2)} km²`;
    } else {
      areaText = `Area: ${area.toFixed(1)} m²`;
    }
    const perimeterText = `Perimeter: ${totalLength > 1000 ? (totalLength / 1000).toFixed(2) + ' km' : totalLength.toFixed(1) + ' m'}`;
    totalText = `${areaText}\n${perimeterText}`;

    totalPosition = geom.getInteriorPoint().getCoordinates();
  }

  if (totalText && totalPosition) {
    styles.push(new Style({
      geometry: new Point(totalPosition),
      text: new TextStyle({
        text: totalText,
        font: 'bold 11px Inter, sans-serif',
        fill: new Fill({ color: '#ffffff' }),
        backgroundFill: new Fill({ color: '#9333ea' }),
        backgroundStroke: new Stroke({ color: '#7e22ce', width: 1 }),
        padding: [4, 6, 4, 6],
        offsetY: -15,
      }),
    }));
  }

  return styles;
};

const annotationStyleFunction = (feature: any) => {
  if (feature.get('visible') === false) {
    return [];
  }

  const labelText = feature.get('label');
  const styles = [
    new Style({
      stroke: new Stroke({
        color: '#1890ff',
        width: 2.5,
      }),
      fill: new Fill({
        color: 'rgba(24, 144, 255, 0.15)',
      }),
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({
          color: '#1890ff',
        }),
        stroke: new Stroke({
          color: '#ffffff',
          width: 1.5,
        }),
      }),
    })
  ];

  if (labelText) {
    styles.push(new Style({
      text: new TextStyle({
        text: labelText,
        font: 'bold 12px Inter, sans-serif',
        fill: new Fill({
          color: '#1890ff',
        }),
        stroke: new Stroke({
          color: '#ffffff',
          width: 3,
        }),
        offsetY: -15,
      }),
    }));
  }

  return styles;
};





function Map2DContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mapId = searchParams.get('id');
  const { notification, modal } = App.useApp();
  const { user, token, hydrated } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [mapDetail, setMapDetail] = useState<any>(null);
  const [isPublicMap, setIsPublicMap] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isQueryDrawing, setIsQueryDrawing] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // Disable window scrolling to prevent double scrollbars on medium/large screens
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('resize', handleResize);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, []);

  // Coordinates and Zoom state
  const lonRef = useRef<HTMLSpanElement>(null);
  const latRef = useRef<HTMLSpanElement>(null);
  const [zoomLevel, setZoomLevel] = useState(2);
  const [scaleText, setScaleText] = useState('1 : 150,000,000');

  // Map view rotation state (in degrees 0-359)
  const [rotationDeg, setRotationDeg] = useState(0);
  const isSliderRotatingRef = useRef(false);
  const rotateRafRef = useRef<number | null>(null);

  const handleRotateChange = useCallback((val: number | [number, number] | null | undefined) => {
    try {
      const rawVal = Array.isArray(val) ? val[0] : val;
      if (typeof rawVal !== 'number' || isNaN(rawVal) || !isFinite(rawVal)) {
        return;
      }
      const safeDeg = Math.min(360, Math.max(0, Math.round(rawVal)));
      setRotationDeg(safeDeg);

      isSliderRotatingRef.current = true;
      if (rotateRafRef.current) {
        cancelAnimationFrame(rotateRafRef.current);
      }

      rotateRafRef.current = requestAnimationFrame(() => {
        try {
          const view = mapInstance.current?.getView();
          if (view) {
            const rad = (safeDeg * Math.PI) / 180;
            if (isFinite(rad)) {
              view.setRotation(rad);
            }
          }
        } finally {
          isSliderRotatingRef.current = false;
        }
      });
    } catch (err) {
      console.warn('Error applying map rotation:', err);
    }
  }, []);

  const handleRotateAnimate = useCallback((targetDeg: number) => {
    try {
      if (typeof targetDeg !== 'number' || isNaN(targetDeg) || !isFinite(targetDeg)) {
        targetDeg = 0;
      }
      const view = mapInstance.current?.getView();
      if (!view) return;
      const center = view.getCenter();
      if (!center) return;

      const currentRot = view.getRotation();
      const safeRot = typeof currentRot === 'number' && isFinite(currentRot) ? currentRot : 0;
      const currentDeg = (safeRot * 180) / Math.PI;

      let diff = (targetDeg - (currentDeg % 360)) % 360;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;

      const targetRad = ((currentDeg + diff) * Math.PI) / 180;
      if (!isFinite(targetRad)) return;

      setRotationDeg(((Math.round(targetDeg) % 360) + 360) % 360);

      view.animate({
        rotation: targetRad,
        duration: 350,
        easing: (t) => t * (2 - t),
      });
    } catch (err) {
      console.warn('Error animating map rotation:', err);
    }
  }, []);

  const handleStepRotate = useCallback((delta: number) => {
    const current = typeof rotationDeg === 'number' && isFinite(rotationDeg) ? rotationDeg : 0;
    const next = (((Math.round(current) + delta) % 360) + 360) % 360;
    handleRotateAnimate(next);
  }, [rotationDeg, handleRotateAnimate]);

  const updateCoordinatesText = (lon: number, lat: number) => {
    if (lonRef.current) lonRef.current.innerText = lon.toFixed(6) + '°';
    if (latRef.current) latRef.current.innerText = lat.toFixed(6) + '°';
    const mobileLon = document.getElementById('mobile-lon-value');
    const mobileLat = document.getElementById('mobile-lat-value');
    if (mobileLon) mobileLon.innerText = lon.toFixed(6) + '°';
    if (mobileLat) mobileLat.innerText = lat.toFixed(6) + '°';
  };

  // Renaming state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Inline editing states
  const [isEditingCoords, setIsEditingCoords] = useState(false);
  const [editLon, setEditLon] = useState('');
  const [editLat, setEditLat] = useState('');
  const isEditingCoordsRef = useRef(false);

  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [editZoom, setEditZoom] = useState('');

  const [isEditingScaleText, setIsEditingScaleText] = useState(false);
  const [editScaleVal, setEditScaleVal] = useState('');

  // Active Panel state
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const {
    customLogo,
    defaultBasemap,
    fetchAppearance,
  } = useAppearanceStore();

  // Basemap state
  const [selectedBasemap, setSelectedBasemap] = useState(() => defaultBasemap || 'osm');
  const [basemapSearch, setBasemapSearch] = useState('');
  const [customBasemaps, setCustomBasemaps] = useState<any[]>([]);
  const customBasemapsRef = useRef<any[]>([]);
  customBasemapsRef.current = customBasemaps;

  const fetchCustomBasemaps = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest('/basemaps');
      if (res.ok) {
        const data = await res.json();
        setCustomBasemaps(data);
      }
    } catch (err) {
      console.error('Failed to load custom basemaps:', err);
    }
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => {
      fetchCustomBasemaps();
    });
  }, [fetchCustomBasemaps]);

  // Sync active custom basemap layer source when custom basemaps load/update
  useEffect(() => {
    if (!mapInstance.current || customBasemaps.length === 0) return;
    const isCustom = customBasemaps.some(bm => bm.id === selectedBasemap);
    if (isCustom) {
      const layers = mapInstance.current.getLayers();
      const firstLayer = layers.item(0) as TileLayer<any>;
      if (firstLayer) {
        const bm = customBasemaps.find(item => item.id === selectedBasemap);
        if (bm) {
          firstLayer.setSource(new XYZ({
            url: bm.url,
            attributions: bm.attributions || undefined
          }));
        }
      }
    }
  }, [customBasemaps, selectedBasemap]);

  // Ensure appearance is loaded for this GeoServer
  useEffect(() => {
    fetchAppearance(user?.geoserverUrl);
  }, [fetchAppearance, user?.geoserverUrl]);

  const changeBasemap = useCallback((type: string) => {
    if (!mapInstance.current) return;
    mapInstance.current.set('user_selected_basemap', true);
    const layers = mapInstance.current.getLayers();
    const firstLayer = layers.item(0) as TileLayer<any>;
    if (firstLayer) {
      if (type === 'none') {
        firstLayer.setVisible(false);
        setSelectedBasemap('none');
        return;
      }
      const allList = [...basemapsConfig, ...customBasemaps];
      const bm = allList.find(item => item.id === type);
      if (!bm && type !== 'osm') return;
      let source;
      if (type === 'osm') {
        source = new OSM();
      } else if (bm) {
        source = new XYZ({
          url: bm.url,
          attributions: bm.attributions || undefined
        });
      }
      if (source) {
        firstLayer.setVisible(true);
        firstLayer.setSource(source);
        setSelectedBasemap(type);
      }
    }
  }, [customBasemaps]);

  // Synchronize default basemap if user has not explicitly clicked a different basemap
  useEffect(() => {
    if (mapDetail || !mapInstance.current) return;
    if (defaultBasemap && !mapInstance.current.get('user_selected_basemap')) {
      changeBasemap(defaultBasemap);
    }
  }, [defaultBasemap, mapDetail, changeBasemap]);




  // Measurement state
  const [measurementType, setMeasurementType] = useState<'LineString' | 'Polygon' | null>(null);
  const [measurements, setMeasurements] = useState<any[]>([]);
  const drawInteractionRef = useRef<Draw | null>(null);
  const measurementSourceRef = useRef<VectorSource | null>(null);
  const measurementLayerRef = useRef<VectorLayer<any> | null>(null);

  // Annotation state
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [annotationType, setAnnotationType] = useState<string | null>(null);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [labelText, setLabelText] = useState('');
  const tempLabelFeatureRef = useRef<any>(null);
  const annotationSourceRef = useRef<VectorSource | null>(null);
  const annotationLayerRef = useRef<VectorLayer<any> | null>(null);
  const annotationDrawRef = useRef<Draw | null>(null);

  // Info & Styling Panel state
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [leftPanelMode, setLeftPanelMode] = useState<'info' | 'style'>('info');
  const [selectedStyleLayer, setSelectedStyleLayer] = useState<any | null>(null);
  const [selectedLayerSchema, setSelectedLayerSchema] = useState<{ [key: string]: any }>({});
  const [selectedLayerGeomType, setSelectedLayerGeomType] = useState<string | null>(null);
  interface StyleConfig {
    mode: 'single' | 'categorized' | 'graduated' | 'single_band' | 'multiband';
    strokeColor?: string;
    strokeWidth?: number;
    lineDash?: string;
    fillColor?: string;
    fillOpacity?: number;
    categorizeField?: string;
    graduatedField?: string;
    graduatedMinVal?: number;
    graduatedMaxVal?: number;
    graduatedColorStart?: string;
    graduatedColorEnd?: string;
    labelField?: string;
    labelOffsetX?: number;
    labelOffsetY?: number;
    labelAlign?: string;
    labelBaseline?: string;
    labelColor?: string;
    labelOutlineColor?: string;
    labelOutlineWidth?: number;
    labelSize?: number;
    labelRepeat?: 'once' | 'repeat';
    labelRepeatSpacing?: number;
    pointType?: 'circle' | 'icon';
    pointIcon?: 'marker' | 'star' | 'square' | 'flag';
    pointSize?: number;
    strokeOpacity?: number;
    band?: string;
    rescaleMin?: number;
    rescaleMax?: number;
    colormapName?: string;
    redBand?: string;
    greenBand?: string;
    blueBand?: string;
  }

  interface LayerStyleData {
    styles: Array<{
      id: string;
      name: string;
      config: StyleConfig;
      createdAt?: string;
    }>;
    activeStyleId: string;
    activeStyle?: string;
    opacity?: number;
    labelsEnabled?: boolean;
  }

  const [vectorLayerStyles, setVectorLayerStyles] = useState<{
    [layerId: string]: LayerStyleData;
  }>({});
  const [infoData, setInfoData] = useState<any[]>([]);

  // Vector analysis info modal content
  const [infoModalContent, setInfoModalContent] = useState<{ title: string; detail: string } | null>(null);

  // Selected Vector Analysis workflow
  const [selectedAnalysisWorkflow, setSelectedAnalysisWorkflow] = useState<string | null>(null);

  // Selected Raster Analysis workflow
  const [selectedRasterWorkflow, setSelectedRasterWorkflow] = useState<string | null>(null);

  // Analysis running & status states
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);
  const [analysisMessage, setAnalysisMessage] = useState<string>('');

  // Layer list and Add layer state
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
    rawBuffer?: ArrayBuffer;
    imageBlob?: Blob;
    imageUrl?: string;
    nativeCRS?: string;
    url?: string;
    geojson?: any;
  }
  const [addedLayers, setAddedLayers] = useState<LayerState[]>([]);
  const [isAddLayerModalOpen, setIsAddLayerModalOpen] = useState(false);
  const [datasetsList, setDatasetsList] = useState<any[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [gisAccessToken, setGisAccessToken] = useState('');
  const [modalSearchText, setModalSearchText] = useState('');
  const [modalTypeFilter, setModalTypeFilter] = useState('ALL');

  const olLayersRef = useRef<{ [key: string]: any }>({});
  const loadedMapIdRef = useRef<string | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      if (mapInstance.current) {
        mapInstance.current.setTarget(undefined);
        mapInstance.current = null;
      }
      olLayersRef.current = {};
      loadedMapIdRef.current = null;
      if (typeof window !== 'undefined') {
        delete (window as any).vismapMapInstance;
        delete (window as any).vismapLayers;
      }
    };
  }, []);

  // Explicitly reset layer and map state whenever mapId changes
  useEffect(() => {
    setAddedLayers([]);
    setMapDetail(null);
    loadedMapIdRef.current = null;
    if (mapInstance.current) {
      Object.values(olLayersRef.current).forEach((layer: any) => {
        try {
          mapInstance.current?.removeLayer(layer);
        } catch {
          // ignore
        }
      });
      olLayersRef.current = {};
    }
  }, [mapId]);

  const handleCopyLink = () => {
    const link = `${window.location.protocol}//${window.location.host}${window.location.pathname}?id=${mapId}`;
    navigator.clipboard.writeText(link);
    notification.success({
      message: 'Link Copied',
      description: 'The map link has been copied to your clipboard.',
      placement: 'topRight'
    });
  };

  // Synchronize OpenLayers map and layers to window globals for LayerListPanel2D
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).vismapMapInstance = mapInstance.current;
      (window as any).vismapLayers = olLayersRef.current;
    }
  });

  // Attribute Table state
  const [attributeTableOpen, setAttributeTableOpen] = useState(false);
  const [attributeTableDataset, setAttributeTableDataset] = useState<{ id: string; name: string } | null>(null);

  const handleOpenAttributeTable = useCallback((open: boolean) => {
    setAttributeTableOpen(open);
    if (open && isMobile) {
      setActivePanel(null);
    }
  }, [isMobile]);
  const [attributeTableFilterIds, setAttributeTableFilterIds] = useState<Record<string, string[]>>({});
  const [attributeTableFilterCqls, setAttributeTableFilterCqls] = useState<Record<string, string>>({});
  const [qbActiveFilters, setQbActiveFilters] = useState<Record<string, LayerActiveFilters>>({});
  const highlightSourceRef = useRef<VectorSource | null>(null);
  const highlightLayerRef = useRef<VectorLayer<any> | null>(null);

  // Fuzzy Search state
  const [fuzzySearchLayerId, setFuzzySearchLayerId] = useState<string>('');
  const [fuzzySearchKeywords, setFuzzySearchKeywords] = useState<string[]>([]);
  const [fuzzySearchActive, setFuzzySearchActive] = useState(false);
  const [fuzzySearchLoading, setFuzzySearchLoading] = useState(false);

  // Reset layer selection if feature search panel is opened with no selected keywords
  useEffect(() => {
    if (activePanel === 'fuzzysearch' && fuzzySearchKeywords.length === 0) {
      queueMicrotask(() => {
        setFuzzySearchLayerId('');
      });
    }
  }, [activePanel, fuzzySearchKeywords.length]);

  // Query Builder draw state — fully separate per section so they never interfere
  const [bufferDrawnGeometry, setBufferDrawnGeometry] = useState<any>(null);
  const [spatialDrawnGeometry, setSpatialDrawnGeometry] = useState<any>(null);
  const queryDrawRef = useRef<Draw | null>(null);
  // Each section has its own OL source + layer so clearing one never wipes the other
  const bufferDrawSourceRef = useRef<VectorSource | null>(null);
  const bufferDrawLayerRef = useRef<VectorLayer<any> | null>(null);
  const spatialDrawSourceRef = useRef<VectorSource | null>(null);
  const spatialDrawLayerRef = useRef<VectorLayer<any> | null>(null);
  // Track which section is actively drawing so drawend knows where to deliver the geometry
  const queryDrawOwnerRef = useRef<'buffer' | 'spatial'>('buffer');
  // WPS drawing state
  const wpsDrawSourceRef = useRef<VectorSource | null>(null);
  const wpsDrawLayerRef = useRef<VectorLayer<any> | null>(null);
  const [wpsDrawingActive, setWpsDrawingActive] = useState(false);
  const wpsDrawCallbackRef = useRef<((geojson: any) => void) | null>(null);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const doubleClickZoomRef = useRef<DoubleClickZoom | null>(null);

  // Zoom & Extent navigation state
  const [activeZoomTool, setActiveZoomTool] = useState<string | null>(null);
  const [extentFeedback, setExtentFeedback] = useState(false);
  const activeZoomToolRef = useRef<string | null>(null);
  const [canGoPrev, setCanGoPrev] = useState(false);
  const [canGoNext, setCanGoNext] = useState(false);

  const zoomBoxSourceRef = useRef<VectorSource | null>(null);
  const zoomBoxLayerRef = useRef<VectorLayer<any> | null>(null);
  const zoomBoxDrawRef = useRef<Draw | null>(null);

  const gotoXYSourceRef = useRef<VectorSource | null>(null);
  const gotoXYLayerRef = useRef<VectorLayer<any> | null>(null);
  const gotoXYMapClickRef = useRef<((lon: number, lat: number) => void) | null>(null);
  const [gotoXYMarkerActive, setGotoXYMarkerActive] = useState(false);
  const [gotoXYMarkerCoords, setGotoXYMarkerCoords] = useState<[number, number] | null>(null);

  const extentHistoryRef = useRef<{ center: number[]; zoom: number }[]>([]);
  const currentHistoryIndexRef = useRef<number>(-1);
  const isNavigatingHistoryRef = useRef<boolean>(false);

  useEffect(() => {
    activeZoomToolRef.current = activeZoomTool;
  }, [activeZoomTool]);

  /**
   * Migrates old style format to new multi-style format
   * Ensures backward compatibility with existing saved maps
   */
  const migrateStyleConfig = useCallback((oldConfig: any, layerType?: string, schema?: any): LayerStyleData => {
    // Check if already migrated
    if (oldConfig && oldConfig.styles && Array.isArray(oldConfig.styles)) {
      return {
        ...oldConfig,
        opacity: oldConfig.opacity ?? 1.0,
        labelsEnabled: oldConfig.labelsEnabled ?? false,
      };
    }

    // Migrate old format
    let defaultStyle: StyleConfig;

    if (layerType === 'RASTER' && schema) {
      const bandKeys = Object.keys(schema).filter(k => k.startsWith('band_'));
      const numBands = bandKeys.length;
      if (numBands > 1) {
        defaultStyle = oldConfig || {
          mode: 'multiband',
          redBand: 'band_1',
          greenBand: 'band_2',
          blueBand: 'band_3'
        };
      } else {
        const firstBand = bandKeys[0] || 'band_1';
        const bandMeta = (schema as any)[firstBand] || {};
        defaultStyle = oldConfig || {
          mode: 'single_band',
          band: firstBand,
          rescaleMin: bandMeta.min !== undefined && bandMeta.min !== null ? bandMeta.min : 0,
          rescaleMax: bandMeta.max !== undefined && bandMeta.max !== null ? bandMeta.max : 255,
          colormapName: 'gray'
        };
      }
    } else {
      defaultStyle = oldConfig || {
        mode: 'single',
        strokeColor: '#ff4d4f',
        strokeWidth: 1.5,
        fillColor: '#ff4d4f',
        fillOpacity: 0.1,
      };
    }

    return {
      styles: [
        {
          id: 'style_default_' + Date.now(),
          name: 'Default',
          config: defaultStyle,
          createdAt: new Date().toISOString(),
        }
      ],
      activeStyleId: 'style_default_' + Date.now(),
      opacity: 1.0,
      labelsEnabled: !!defaultStyle.labelField, // Preserve if labels were configured
    };
  }, []);

  /**
   * Safely retrieves the currently active style config
   */
  const getActiveStyleConfig = (layerId: string): StyleConfig | null => {
    const layerStyleData = vectorLayerStyles[layerId];
    if (!layerStyleData) return null;

    const activeStyle = layerStyleData.styles?.find(
      s => s.id === layerStyleData.activeStyleId
    );
    return activeStyle?.config || layerStyleData.styles?.[0]?.config || null;
  };

  // Fetch GIS access token
  useEffect(() => {
    if (!hydrated || !token || isPublicMap) return;
    const fetchGisToken = async () => {
      try {
        const response = await apiRequest('/auth/access-token/');
        if (response.ok) {
          const data = await response.json();
          setGisAccessToken(data.access_token);
        }
      } catch (err) {
        console.error('Failed to fetch GIS access token:', err);
      }
    };
    fetchGisToken();
  }, [hydrated, token, isPublicMap]);

  // Auth and Data Fetch
  useEffect(() => {
    if (!hydrated) return;

    const checkAuthAndFetchMap = async () => {
      let isPublicMap = false;
      let mapData = null;

      try {
        if (mapId) {
          const mapResponse = await apiRequest(`/maps/${mapId}/`, { auth: !!token });
          if (mapResponse.ok) {
            mapData = await mapResponse.json();
            if (mapData && mapData.share === 'PUBLIC') {
              isPublicMap = true;
              setIsPublicMap(true);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to check public map status:', err);
      }

      if (!isPublicMap && !token) {
        const redirectUrl = window.location.pathname + window.location.search;
        router.replace(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
        return;
      }

      if (mapData) {
        setMapDetail(mapData);
        setNewName(mapData.name || '');
        setNewDescription(mapData.description || '');
        if (mapData.basemap_id) {
          setSelectedBasemap(mapData.basemap_id);
        }
      }

      setLoading(false);
    };

    checkAuthAndFetchMap();
  }, [token, hydrated, mapId, router]);

  // OpenLayers Map Initialization
  useEffect(() => {
    if (loading || !mapRef.current) return;
    if (mapInstance.current) return;

    // Determine initial center and zoom from saved mapDetail or appearance defaults
    const appearanceState = useAppearanceStore.getState();
    const defaultLat = typeof appearanceState.defaultLatitude === 'number' && !isNaN(appearanceState.defaultLatitude)
      ? appearanceState.defaultLatitude
      : 20.5937;
    const defaultLon = typeof appearanceState.defaultLongitude === 'number' && !isNaN(appearanceState.defaultLongitude)
      ? appearanceState.defaultLongitude
      : 78.9629;
    const defaultZoomLevel = typeof appearanceState.defaultZoom === 'number' && !isNaN(appearanceState.defaultZoom)
      ? appearanceState.defaultZoom
      : 4;

    let initialLat = defaultLat;
    let initialLon = defaultLon;
    let initialZoom = defaultZoomLevel;

    if (mapDetail) {
      if (typeof mapDetail.center_lat === 'number' && !isNaN(mapDetail.center_lat) &&
        typeof mapDetail.center_lon === 'number' && !isNaN(mapDetail.center_lon)) {
        initialLat = mapDetail.center_lat;
        initialLon = mapDetail.center_lon;
      }
      if (typeof mapDetail.zoom === 'number' && !isNaN(mapDetail.zoom)) {
        initialZoom = mapDetail.zoom;
      }
    }

    const initialCenter = fromLonLat([initialLon, initialLat]);

    const getBasemapSource = (type: string) => {
      if (type === 'none') return null;
      if (type === 'osm') return new OSM();
      const allList = [...basemapsConfig, ...customBasemapsRef.current];
      const bm = allList.find(item => item.id === type);
      if (!bm) return new OSM();
      return new XYZ({
        url: bm.url,
        attributions: bm.attributions || undefined
      });
    };

    // Determine initial basemap source from mapDetail or appearance defaults
    const activeBasemap = mapDetail?.basemap_id || appearanceState.defaultBasemap || 'osm';
    const initialBasemapSource = getBasemapSource(activeBasemap);

    const doubleClickZoom = new DoubleClickZoom();
    doubleClickZoomRef.current = doubleClickZoom;

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: initialBasemapSource || undefined,
          visible: activeBasemap !== 'none',
          zIndex: 0,
          preload: 4,
        }),
      ],
      view: new View({
        center: initialCenter,
        zoom: initialZoom,
      }),
      controls: defaultControls({ zoom: false, rotate: false }),
      interactions: defaultInteractions({ doubleClickZoom: false }).extend([doubleClickZoom]),
    });

    mapInstance.current = map;

    // Add global Ctrl + drag to zoom interaction
    const ctrlDragZoom = new DragZoom({
      condition: (mapBrowserEvent) => {
        const originalEvent = mapBrowserEvent.originalEvent;
        return originalEvent ? (originalEvent.ctrlKey || originalEvent.metaKey) : false;
      },
    });
    map.addInteraction(ctrlDragZoom);

    // Initialize measurement layer and source
    const measureSource = new VectorSource();
    measurementSourceRef.current = measureSource;

    const measureLayer = new VectorLayer({
      source: measureSource,
      style: measurementStyleFunction,
      zIndex: 999,
    });
    measureLayer.set('id', 'measurements');
    measurementLayerRef.current = measureLayer;
    map.addLayer(measureLayer);

    // Initialize annotation layer and source
    const annotationSource = new VectorSource();
    annotationSourceRef.current = annotationSource;

    const annotationLayer = new VectorLayer({
      source: annotationSource,
      style: annotationStyleFunction,
      zIndex: 1000,
    });
    annotationLayer.set('id', 'annotations');
    annotationLayerRef.current = annotationLayer;
    map.addLayer(annotationLayer);

    const highlightSource = new VectorSource();
    highlightSourceRef.current = highlightSource;

    const highlightLayer = new VectorLayer({
      source: highlightSource,
      zIndex: 1001,
      style: (feature: any) => {
        const geometryType = feature.getGeometry()?.getType();

        return new Style({
          stroke: new Stroke({
            color: '#facc15',
            width: geometryType?.includes('Line') ? 5 : 4,
          }),
          fill: new Fill({
            color: 'rgba(250, 204, 21, 0.22)',
          }),
          image: new CircleStyle({
            radius: 9,
            fill: new Fill({
              color: 'rgba(250, 204, 21, 0.32)',
            }),
            stroke: new Stroke({
              color: '#f59e0b',
              width: 3,
            }),
          }),
        });
      },
    });
    highlightLayerRef.current = highlightLayer;
    map.addLayer(highlightLayer);

    // Initialize zoom box layer and source
    const zbSource = new VectorSource();
    zoomBoxSourceRef.current = zbSource;

    const zbLayer = new VectorLayer({
      source: zbSource,
      style: new Style({
        fill: new Fill({
          color: 'rgba(24, 144, 255, 0.15)',
        }),
        stroke: new Stroke({
          color: '#1890ff',
          width: 2,
          lineDash: [4, 4],
        }),
      }),
      zIndex: 1002,
    });
    zoomBoxLayerRef.current = zbLayer;
    map.addLayer(zbLayer);

    // Initialize GoToXY marker layer
    const gotoXYSource = new VectorSource();
    gotoXYSourceRef.current = gotoXYSource;
    const gotoXYLayer = new VectorLayer({
      source: gotoXYSource,
      zIndex: 1003,
      style: new Style({
        image: new CircleStyle({
          radius: 8,
          fill: new Fill({ color: '#ef4444' }),
          stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
        }),
      }),
    });
    gotoXYLayerRef.current = gotoXYLayer;
    map.addLayer(gotoXYLayer);

    // Listen to mouse movement for coordinates
    map.on('pointermove', (evt) => {
      if (evt.coordinate) {
        const coord = toLonLat(evt.coordinate);
        if (!isEditingCoordsRef.current) {
          updateCoordinatesText(coord[0], coord[1]);
        }
      }
    });

    // Listen to double click for Zoom to Box
    map.on('dblclick', (evt) => {
      if (zoomBoxSourceRef.current) {
        const features = zoomBoxSourceRef.current.getFeatures();
        if (features && features.length > 0) {
          evt.preventDefault();
          const geometry = features[0].getGeometry();
          if (geometry) {
            const extent = geometry.getExtent();
            map.getView().fit(extent, {
              padding: [20, 20, 20, 20],
              duration: 800,
            });
          }
          zoomBoxSourceRef.current.clear();

          // Deactivate Zoom to Box tool after zooming
          if (zoomBoxDrawRef.current) {
            map.removeInteraction(zoomBoxDrawRef.current);
            zoomBoxDrawRef.current = null;
          }

          // Re-enable double click zoom
          if (doubleClickZoomRef.current) {
            doubleClickZoomRef.current.setActive(true);
          }

          setActiveZoomTool(null);
        }
      }
    });

    // Listen to single click for Zoom to Extent of clicked feature/layer
    map.on('singleclick', (evt) => {
      // GoToXY map click sync - does not block other handlers
      if (gotoXYMapClickRef.current) {
        const coord = toLonLat(evt.coordinate);
        gotoXYMapClickRef.current(coord[0], coord[1]);
      }

      if (activeZoomToolRef.current === 'extent') {
        const clickedFeature = map.forEachFeatureAtPixel(evt.pixel, (feature) => {
          return feature;
        });

        if (clickedFeature) {
          const geometry = clickedFeature.getGeometry();
          if (geometry) {
            map.getView().fit(geometry.getExtent(), {
              padding: [50, 50, 50, 50],
              duration: 800,
              maxZoom: 18,
            });
          }
        }
      }
    });

    // Listen to moveend for extent history tracking
    map.on('moveend', () => {

      if (isNavigatingHistoryRef.current) {
        isNavigatingHistoryRef.current = false;
        return;
      }

      const view = map.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      if (!center || zoom === undefined) return;

      const history = extentHistoryRef.current;
      const index = currentHistoryIndexRef.current;

      // Compare with current history item to avoid duplicates
      if (index >= 0 && index < history.length) {
        const current = history[index];
        const dist = Math.sqrt(
          Math.pow(current.center[0] - center[0], 2) +
          Math.pow(current.center[1] - center[1], 2)
        );
        const zoomDiff = Math.abs(current.zoom - zoom);
        if (dist < 1.0 && zoomDiff < 0.05) {
          return;
        }
      }

      const newHistory = history.slice(0, index + 1);
      newHistory.push({ center: [...center], zoom });
      extentHistoryRef.current = newHistory;
      currentHistoryIndexRef.current = newHistory.length - 1;

      setCanGoPrev(newHistory.length > 1 && currentHistoryIndexRef.current > 0);
      setCanGoNext(false);
    });

    // Listen to resolution changes for zoom level and dynamic scale estimation
    const updateZoomAndScale = () => {
      const view = map.getView();
      const z = view.getZoom();
      if (z !== undefined) {
        setZoomLevel(Math.round(z * 10) / 10);
      }

      const resolution = view.getResolution();
      if (resolution !== undefined) {
        const dpi = 96;
        const inchesPerMeter = 39.37;
        const scale = Math.round(resolution * dpi * inchesPerMeter);
        setScaleText(`1 : ${scale.toLocaleString()}`);
      }
    };

    map.getView().on('change:resolution', updateZoomAndScale);
    updateZoomAndScale();

    // Listen to view rotation changes
    const updateRotationFromView = () => {
      if (isSliderRotatingRef.current) return;
      try {
        const view = map.getView();
        if (!view) return;
        const rot = view.getRotation();
        if (typeof rot !== 'number' || !isFinite(rot)) return;
        const deg = Math.round((rot * 180) / Math.PI);
        const normalized = ((deg % 360) + 360) % 360;
        setRotationDeg((prev) => (Math.abs(prev - normalized) < 0.5 ? prev : normalized));
      } catch (err) {
        console.warn('Error reading rotation from view:', err);
      }
    };

    map.getView().on('change:rotation', updateRotationFromView);
    updateRotationFromView();

    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
    });
    if (mapRef.current) {
      resizeObserver.observe(mapRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [loading]);

  const clearFeatureHighlight = () => {
    highlightSourceRef.current?.clear();
  };

  const fetchFeatureCollectionByIds = async (datasetId: string, featureIds: string[]) => {
    const tileservUrl = (useConfigStore.getState().tileservUrl || process.env.NEXT_PUBLIC_TILESERV_URL || 'http://localhost:7800').replace(/\/$/, '');
    const tokenVal = gisAccessToken || token || '';

    const responses = await Promise.allSettled(
      featureIds.map(async (featureId) => {
        const featureUrl = new URL(
          `${tileservUrl}/vectorfeature/${datasetId}/items/${encodeURIComponent(featureId)}`
        );
        if (tokenVal) {
          featureUrl.searchParams.set('token', tokenVal);
        }

        const response = await fetch(featureUrl.toString());

        if (!response.ok) {
          throw new Error(`Failed to fetch feature ${featureId}`);
        }

        return response.json();
      })
    );

    const features = responses
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .flatMap((result) => {
        const payload = result.value;
        if (payload?.type === 'FeatureCollection') {
          return payload.features || [];
        }
        return payload?.type === 'Feature' ? [payload] : [];
      })
      .filter((feature) => feature?.geometry);

    return {
      type: 'FeatureCollection',
      features,
    };
  };

  const highlightFeaturesFromTable = async (datasetId: string, featureIds: string[]) => {
    if (!highlightSourceRef.current || !datasetId || featureIds.length === 0) return;

    clearFeatureHighlight();

    const featureCollection = await fetchFeatureCollectionByIds(datasetId, featureIds);
    if (featureCollection.features.length === 0) {
      throw new Error('Selected features could not be highlighted on the 2D map.');
    }

    const geojsonFormat = new GeoJSON();
    const features = geojsonFormat.readFeatures(featureCollection, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    });

    highlightSourceRef.current.addFeatures(features);
  };

  /**
   * Clears fuzzy search filters from all map layers
   * Restores original styling to filtered layers
   */
  const clearMapLayerFilters = useCallback(() => {
    if (!mapInstance.current) return;

    Object.keys(olLayersRef.current).forEach(layerId => {
      const olLayer = olLayersRef.current[layerId];
      if (olLayer) {
        if (olLayer.get('filtered')) {
          const originalStyleFn = olLayer.get('original_style_function');
          if (originalStyleFn) {
            olLayer.setStyle(originalStyleFn);
          }

          olLayer.unset('filtered');
          olLayer.unset('filtered_ids');
          olLayer.unset('original_style_function');
        }

        // Clear WMS params
        if (typeof olLayer.getSource === 'function') {
          const source = olLayer.getSource();
          if (source && typeof source.updateParams === 'function') {
            source.updateParams({ 'cql_filter': undefined, 'CQL_FILTER': undefined, 'featureid': undefined });
          }
        }

        olLayer.changed();
      }
    });
    clearFeatureHighlight();
  }, []);

  /**
   * Clears fuzzy search state and resets map layer filters
   * Refreshes attribute table if open
   */
  const handleClearFuzzySearch = useCallback(() => {
    setFuzzySearchLayerId('');
    setFuzzySearchKeywords([]);
    setFuzzySearchActive(false);
    setFuzzySearchLoading(false);

    clearMapLayerFilters();

    if (attributeTableOpen && attributeTableDataset) {
      const currentDataset = attributeTableDataset;
      setAttributeTableOpen(false);
      requestAnimationFrame(() => {
        setAttributeTableDataset(currentDataset);
        handleOpenAttributeTable(true);
      });
    }
  }, [attributeTableOpen, attributeTableDataset, clearMapLayerFilters, handleOpenAttributeTable]);

  /**
   * Applies feature filter to OpenLayers map layer
   * Shows only features with IDs in matchingIds array
   */
  const applyFeatureFilterToMapLayer = useCallback((layerId: string, matchingIds: string[], cqlFilter?: string) => {
    if (!mapInstance.current) return;

    let olLayer = olLayersRef.current[layerId];
    if (!olLayer) {
      const localName = layerId.includes(':') ? layerId.split(':')[1] : layerId;
      const matchingKey = Object.keys(olLayersRef.current).find(key =>
        key === localName ||
        key.endsWith(`:${localName}`) ||
        (key.includes(':') && key.split(':')[1] === localName)
      );
      if (matchingKey) {
        olLayer = olLayersRef.current[matchingKey];
      }
    }
    if (!olLayer) return;

    // 1. If WMS layer, update source params directly (no mock setStyle needed)
    const source = olLayer.getSource();
    if (source && typeof (source as any).updateParams === 'function') {
      const isWfsFeatureId = matchingIds.length > 0 && matchingIds[0].includes('.');
      if (isWfsFeatureId) {
        const cappedIds = matchingIds.slice(0, 5000);
        (source as any).updateParams({
          'CQL_FILTER': undefined,
          'cql_filter': undefined,
          'featureid': cappedIds.join(','),
        });
      } else {
        const filterStr = cqlFilter
          ? cqlFilter
          : (matchingIds.length > 0
            ? `IN (${matchingIds.map(id => /^\d+$/.test(id) ? id : `'${id.replace(/'/g, "''")}'`).join(',')})`
            : '1 = 2');
        (source as any).updateParams({
          'featureid': undefined,
          'CQL_FILTER': filterStr,
        });
      }
      olLayer.set('filtered', true);
      olLayer.set('filtered_ids', matchingIds);
      if (cqlFilter) olLayer.set('cql_filter_string', cqlFilter);
      olLayer.changed();
      return;
    }

    // 2. If vector layer, use style function filtering
    const idSet = new Set(matchingIds);

    if (!olLayer.get('original_style_function')) {
      olLayer.set('original_style_function', olLayer.getStyleFunction());
    }

    if (typeof olLayer.setStyle === 'function') {
      olLayer.setStyle((feature: any) => {
        const featureId = String(feature.get('ogc_fid') || feature.getId() || '');

        if (matchingIds.length === 0 || idSet.has(featureId)) {
          const originalStyleFn = olLayer.get('original_style_function');
          if (originalStyleFn) {
            return originalStyleFn(feature);
          }
          return new Style({
            stroke: new Stroke({
              color: '#ff4d4f',
              width: 1.5,
            }),
            fill: new Fill({
              color: 'rgba(255, 77, 79, 0.1)',
            }),
          });
        } else {
          return new Style({});
        }
      });
    }

    olLayer.set('filtered', true);
    olLayer.set('filtered_ids', matchingIds);
    if (cqlFilter) olLayer.set('cql_filter_string', cqlFilter);
  }, []);

  const addLayerToMap = useCallback(async (dataset: any) => {
    if (olLayersRef.current[dataset.id]) {
      notification.warning({
        message: 'Layer Already Added',
        description: `"${dataset.name}" is already on the map.`,
        placement: 'topRight'
      });
      return;
    }

    const fullDataset = dataset;

    const nextZIndex = addedLayers.length + 1;
    let newOlLayer: any = null;

    const geoserverWmsUrl = (user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '') + '/wms';
    const geoserverAuth = user?.geoserverAuth;
    newOlLayer = new TileLayer({
      source: new TileWMS({
        url: geoserverWmsUrl,
        params: {
          'LAYERS': dataset.name,
          'TILED': true,
        },
        serverType: 'geoserver',
        transition: 200,
        tileLoadFunction: createWmsTileLoadFunction(geoserverAuth),
      }),
      zIndex: nextZIndex,
      preload: 2,
    });

    if (newOlLayer) {
      newOlLayer.setOpacity(1.0);
      newOlLayer.set('name', fullDataset.name || dataset.name);
      if (fullDataset.metadata?.bbox) {
        newOlLayer.set('bbox', fullDataset.metadata.bbox);
      }
      mapInstance.current?.addLayer(newOlLayer);
      olLayersRef.current[dataset.id] = newOlLayer;
      setAddedLayers(prev => [...prev, {
        id: dataset.id,
        name: fullDataset.name || dataset.name,
        type: dataset.data_type,
        visible: true,
        opacity: 1.0,
        labelsEnabled: false,
        styles: dataset.styles || [],
        activeStyle: dataset.styles?.[0]?.name || '',
        bbox: fullDataset.metadata?.bbox,
        nativeCRS: fullDataset.metadata?.crs || fullDataset.metadata?.nativeCRS || fullDataset.crs || 'EPSG:4326',
      }]);
    } else {
      notification.error({
        message: 'Error',
        description: `Unsupported dataset type "${dataset.data_type}".`,
        placement: 'topRight'
      });
    }
  }, [addedLayers.length, notification, user?.geoserverAuth, user?.geoserverUrl]);

  const handleFuzzySearch = useCallback(async (layerId: string, keywords: string[]) => {
    if (!layerId) {
      handleClearFuzzySearch();
      return;
    }

    setFuzzySearchLayerId(layerId);
    setFuzzySearchKeywords(keywords);

    if (keywords.length === 0) {
      setFuzzySearchActive(false);
      setFuzzySearchLoading(false);
      clearMapLayerFilters();
      return;
    }

    setFuzzySearchActive(true);
    setFuzzySearchLoading(true);

    try {
      const searchQuery = keywords.join(', ');

      const params = new URLSearchParams({
        search: searchQuery,
        page_size: '5000'
      });

      const response = await apiRequest(`/datasets/${layerId}/features/?${params}`);
      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();

      // Filter out null/undefined/empty IDs and convert to strings
      const matchingIds = data.data
        .map((f: any) => f.ogc_fid || f.fid || f.id)
        .filter((id: any) => id !== null && id !== undefined && id !== '')
        .map((id: any) => String(id));

      if (matchingIds.length === 0) {
        notification.warning({
          message: 'No Results Found',
          description: `No features match the keywords: ${keywords.join(', ')}`,
          placement: 'topRight',
        });
        setFuzzySearchActive(false);
        clearMapLayerFilters();
        return;
      }

      let layer = addedLayers.find((l: any) => l.id === layerId);
      if (!layer) {
        const dataset = datasetsList.find((d: any) => d.id === layerId);
        if (dataset) {
          await addLayerToMap(dataset);
          layer = {
            id: dataset.id,
            name: dataset.name,
            type: dataset.data_type,
            visible: true,
            opacity: 1,
            labelsEnabled: false
          };
        }
      }

      if (layer) {
        applyFeatureFilterToMapLayer(layerId, matchingIds);
        setAttributeTableDataset({ id: layer.id, name: layer.name });
        handleOpenAttributeTable(true);
      }

      notification.success({
        message: 'Search Complete',
        description: `Found ${data.pagination?.total_records || 0} matching features`,
        placement: 'topRight',
      });
    } catch (err: any) {
      notification.error({
        message: 'Search Error',
        description: err.message || 'Failed to search features',
        placement: 'topRight',
      });
    } finally {
      setFuzzySearchLoading(false);
    }
  }, [addedLayers, datasetsList, addLayerToMap, clearMapLayerFilters, handleClearFuzzySearch, applyFeatureFilterToMapLayer, notification, handleOpenAttributeTable]);

  // Load saved annotations from DB
  useEffect(() => {
    if (loading || !mapId || !mapInstance.current || !annotationSourceRef.current) return;

    const loadAnnotations = async () => {
      try {
        const response = await apiRequest(`/maps/annotations?map_id=${mapId}`);
        if (response.ok) {
          const data = await response.json();
          const geojsonFormat = new GeoJSON();

          const features = data.map((ann: any) => {
            const feature = geojsonFormat.readFeature({
              type: 'Feature',
              geometry: ann.geometry,
              properties: {
                label: ann.label,
                type: ann.type,
                visible: true
              }
            }, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            }) as any;
            feature.setId(ann.id);
            return feature;
          });

          annotationSourceRef.current?.addFeatures(features);
          updateAnnotationsList();
        }
      } catch (err) {
        console.error('Failed to load annotations:', err);
      }
    };

    loadAnnotations();
  }, [mapId, loading]);

  // Load saved measurements from DB
  useEffect(() => {
    if (loading || !mapId || !mapInstance.current || !measurementSourceRef.current) return;

    const loadMeasurements = async () => {
      try {
        const response = await apiRequest(`/maps/measurements?map_id=${mapId}`);
        if (response.ok) {
          const data = await response.json();
          const geojsonFormat = new GeoJSON();

          const features = data.map((meas: any) => {
            const feature = geojsonFormat.readFeature({
              type: 'Feature',
              geometry: meas.geometry,
              properties: {
                displayVal: meas.display_val,
                type: meas.type,
                visible: true
              }
            }, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            }) as any;
            feature.setId(meas.id);
            return feature;
          });

          measurementSourceRef.current?.addFeatures(features);
          updateMeasurementsList();
        }
      } catch (err) {
        console.error('Failed to load measurements:', err);
      }
    };

    loadMeasurements();
  }, [mapId, loading]);

  // Load saved layers from workspace on initialization (2D)
  useEffect(() => {
    if (loading || !mapId || !mapInstance.current || !mapDetail || !mapDetail.layers) return;
    if (!token && mapDetail.share !== 'PUBLIC') return;
    // If layers for this mapId are already loaded, don't re-run loadLayers on workspace save
    if (loadedMapIdRef.current === mapId && addedLayers.length > 0) return;

    const loadLayers = async () => {
      const map = mapInstance.current;
      if (!map) return;

      const rawLayers = mapDetail.layers;
      const layersToLoad: any[] = Array.isArray(rawLayers)
        ? rawLayers
        : typeof rawLayers === 'string'
          ? (() => { try { return JSON.parse(rawLayers); } catch { return []; } })()
          : [];

      const layersListState: LayerState[] = [];
      let zIndex = 1;

      const geoserverUrl = (
        user?.geoserverUrl ||
        useConfigStore.getState().geoserverUrl ||
        'http://localhost:8080/geoserver'
      ).replace(/\/$/, '');
      const geoserverAuth = user?.geoserverAuth;
      const headers: Record<string, string> = {};
      if (geoserverAuth) {
        headers['Authorization'] = geoserverAuth;
      }

      // Fetch WMS GetCapabilities to extract styles and bounding boxes
      const layersStylesMap = new globalThis.Map<string, any[]>();
      const layersBboxMap = new globalThis.Map<string, number[]>();
      try {
        const capUrl = `${geoserverUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;
        const capRes = await fetch(capUrl, { headers });
        if (capRes.ok) {
          const capText = await capRes.text();
          const parser = new DOMParser();
          const xml = parser.parseFromString(capText, 'text/xml');
          const layerElements = xml.getElementsByTagNameNS('*', 'Layer');
          for (let i = 0; i < layerElements.length; i++) {
            const nameEl = layerElements[i].getElementsByTagNameNS('*', 'Name')[0];
            const name = nameEl?.textContent?.trim();
            if (name) {
              const stylesList: any[] = [];
              const styleElements = layerElements[i].getElementsByTagNameNS('*', 'Style');
              for (let j = 0; j < styleElements.length; j++) {
                const sNameEl = styleElements[j].getElementsByTagNameNS('*', 'Name')[0];
                const sName = sNameEl?.textContent?.trim() || '';
                const sTitleEl = styleElements[j].getElementsByTagNameNS('*', 'Title')[0];
                const sTitle = sTitleEl?.textContent?.trim() || sName;

                const legendUrlEl = styleElements[j].getElementsByTagNameNS('*', 'LegendURL')[0];
                const resourceEl = legendUrlEl ? legendUrlEl.getElementsByTagNameNS('*', 'OnlineResource')[0] : null;
                const legendHref = resourceEl
                  ? (resourceEl.getAttribute('xlink:href') || resourceEl.getAttribute('href') || '')
                  : '';

                stylesList.push({ name: sName, title: sTitle, legendUrl: legendHref });
              }
              layersStylesMap.set(name, stylesList);
              if (name.includes(':')) {
                layersStylesMap.set(name.split(':').pop()!, stylesList);
              }

              // Extract bounding box
              let bbox: number[] = [-180, -90, 180, 90];
              const bboxEl = layerElements[i].getElementsByTagNameNS('*', 'EX_GeographicBoundingBox')[0] ||
                layerElements[i].getElementsByTagName('EX_GeographicBoundingBox')[0];
              if (bboxEl) {
                const west = parseFloat(bboxEl.getElementsByTagNameNS('*', 'westBoundLongitude')[0]?.textContent || bboxEl.getElementsByTagName('westBoundLongitude')[0]?.textContent || '-180');
                const east = parseFloat(bboxEl.getElementsByTagNameNS('*', 'eastBoundLongitude')[0]?.textContent || bboxEl.getElementsByTagName('eastBoundLongitude')[0]?.textContent || '180');
                const south = parseFloat(bboxEl.getElementsByTagNameNS('*', 'southBoundLatitude')[0]?.textContent || bboxEl.getElementsByTagName('southBoundLatitude')[0]?.textContent || '-90');
                const north = parseFloat(bboxEl.getElementsByTagNameNS('*', 'northBoundLatitude')[0]?.textContent || bboxEl.getElementsByTagName('northBoundLatitude')[0]?.textContent || '90');
                bbox = [west, south, east, north];
              } else {
                const bboxes = layerElements[i].getElementsByTagNameNS('*', 'BoundingBox') || layerElements[i].getElementsByTagName('BoundingBox');
                for (let k = 0; k < bboxes.length; k++) {
                  const crs = bboxes[k].getAttribute('CRS') || bboxes[k].getAttribute('crs');
                  if (crs === 'EPSG:4326' || crs === 'CRS:84') {
                    const minx = parseFloat(bboxes[k].getAttribute('minx') || '0');
                    const miny = parseFloat(bboxes[k].getAttribute('miny') || '0');
                    const maxx = parseFloat(bboxes[k].getAttribute('maxx') || '0');
                    const maxy = parseFloat(bboxes[k].getAttribute('maxy') || '0');
                    bbox = [minx, miny, maxx, maxy];
                    break;
                  }
                }
              }
              layersBboxMap.set(name, bbox);
              if (name.includes(':')) {
                layersBboxMap.set(name.split(':').pop()!, bbox);
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch WMS GetCapabilities for layer styles/bbox:', err);
      }

      for (const layerData of layersToLoad) {
        if (!layerData) continue;
        const layerId = layerData.layer_id || layerData.id;
        const layerName = layerData.name || layerId;
        if (!layerId) continue;

        if (olLayersRef.current[layerId]) {
          if (!map.getLayers().getArray().includes(olLayersRef.current[layerId])) {
            map.addLayer(olLayersRef.current[layerId]);
          }
          continue;
        }

        const styleData = migrateStyleConfig(layerData.style_json);
        const layerOpacity = layerData.opacity ?? styleData.opacity ?? 1.0;
        const layerActiveStyle = layerData.activeStyle || layerData.style_json?.activeStyle || styleData.activeStyle || '';
        const geoserverWmsUrl = geoserverUrl + '/wms';

        const newOlLayer = new TileLayer({
          source: new TileWMS({
            url: geoserverWmsUrl,
            params: {
              'LAYERS': layerName,
              ...(layerActiveStyle ? { 'STYLES': layerActiveStyle } : {}),
              'TILED': true,
            },
            serverType: 'geoserver',
            transition: 0,
            tileLoadFunction: createWmsTileLoadFunction(geoserverAuth),
          }),
          zIndex: zIndex++,
        });

        newOlLayer.setOpacity(layerOpacity);
        newOlLayer.set('name', layerName);
        newOlLayer.setVisible(layerData.visible ?? true);

        // Store bounding box on OL Layer object if we have it
        const layerBbox = layersBboxMap.get(layerId) || layersBboxMap.get(layerName);
        if (layerBbox) {
          newOlLayer.set('bbox', layerBbox);
        }

        map.addLayer(newOlLayer);
        olLayersRef.current[layerId] = newOlLayer;

        const layerStyles = layersStylesMap.get(layerId) || layersStylesMap.get(layerName) || [];
        const resolvedActiveStyle = layerActiveStyle || layerStyles[0]?.name || '';
        layersListState.push({
          id: layerId,
          name: layerName,
          type: layerData.type || 'VECTOR',
          visible: layerData.visible ?? true,
          opacity: layerOpacity,
          labelsEnabled: styleData.labelsEnabled ?? false,
          styles: layerStyles,
          activeStyle: resolvedActiveStyle,
          bbox: layerBbox,
        });

        setVectorLayerStyles(prev => ({
          ...prev,
          [layerId]: {
            ...styleData,
            opacity: layerOpacity,
            activeStyle: resolvedActiveStyle,
          }
        }));
      }

      setAddedLayers(layersListState);

      // Restore map center & zoom from saved mapDetail
      if (mapDetail && mapDetail.center_lon != null && mapDetail.center_lat != null && mapDetail.zoom != null) {
        map.getView().setCenter(fromLonLat([Number(mapDetail.center_lon), Number(mapDetail.center_lat)]));
        map.getView().setZoom(Number(mapDetail.zoom));
      }

      loadedMapIdRef.current = mapId;
    };

    loadLayers();
  }, [mapId, loading, mapDetail, token, user, migrateStyleConfig]);



  const handleSaveRename = async () => {
    const trimmedName = newName.trim();
    if (!mapId) return;

    if (!trimmedName) {
      notification.warning({
        message: 'Invalid Map Name',
        description: 'Map name cannot be empty or contain only spaces.',
        placement: 'topRight'
      });
      return;
    }
    if (trimmedName.length < 2) {
      notification.warning({
        message: 'Invalid Map Name',
        description: 'Map name must be at least 2 characters long.',
        placement: 'topRight'
      });
      return;
    }
    if (trimmedName.length > 32) {
      notification.warning({
        message: 'Invalid Map Name',
        description: 'Map name cannot exceed 32 characters.',
        placement: 'topRight'
      });
      return;
    }
    if (/[<>]/.test(trimmedName)) {
      notification.warning({
        message: 'Invalid Map Name',
        description: 'Map name contains invalid characters (< or >).',
        placement: 'topRight'
      });
      return;
    }

    setRenaming(true);
    try {
      const response = await apiRequest(`/maps/${mapId}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          description: newDescription.trim()
        })
      });
      if (response.ok) {
        const updatedMap = await response.json();
        setMapDetail(updatedMap);
        notification.success({
          message: 'Success',
          description: 'Map details updated successfully.',
          placement: 'topRight'
        });
        setRenameModalOpen(false);
      } else {
        throw new Error('Failed to update map');
      }
    } catch {
      notification.error({
        message: 'Error',
        description: 'Failed to update map. Please try again.',
        placement: 'topRight'
      });
    } finally {
      setRenaming(false);
    }
  };

  const handleSaveMapWorkspace = async () => {
    if (!mapId || !mapInstance.current) return;
    try {
      const view = mapInstance.current.getView();
      const center = view.getCenter();
      const zoom = view.getZoom();
      let centerLon = 0;
      let centerLat = 0;
      if (center) {
        const lonLat = toLonLat(center);
        centerLon = lonLat[0];
        centerLat = lonLat[1];
      }

      const layersPayload = addedLayers
        .filter(layer => !layer.id.startsWith('wps_result_'))
        .map((layer, index) => {
          const styleData = vectorLayerStyles[layer.id];
          const migratedStyleData = styleData ? migrateStyleConfig(styleData) : null;
          const currentOpacity = layer.opacity ?? styleData?.opacity ?? 1.0;
          const currentActiveStyle = layer.activeStyle || styleData?.activeStyle || '';

          return {
            layer_id: layer.id,
            name: layer.name,
            type: layer.type,
            z_index: index,
            visible: layer.visible ?? true,
            opacity: currentOpacity,
            activeStyle: currentActiveStyle,
            style_json: {
              ...(migratedStyleData || {
                styles: [{
                  id: 'style_default',
                  name: 'Default',
                  config: {
                    mode: 'single',
                    strokeColor: '#ff4d4f',
                    strokeWidth: 1.5,
                    fillColor: '#ff4d4f',
                    fillOpacity: 0.1,
                  }
                }],
                activeStyleId: 'style_default',
                labelsEnabled: layer.labelsEnabled ?? false,
              }),
              opacity: currentOpacity,
              activeStyle: currentActiveStyle,
            }
          };
        });

      const response = await apiRequest(`/maps/${mapId}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          center_lon: centerLon,
          center_lat: centerLat,
          zoom: zoom,
          basemap_id: selectedBasemap,
          layers: layersPayload
        })
      });

      if (response.ok) {
        const data = await response.json();
        setMapDetail(data);
        loadedMapIdRef.current = mapId;
        notification.success({
          message: 'Workspace Saved',
          description: 'Map location, basemap state, and layers saved successfully.',
          placement: 'topRight'
        });
      } else {
        throw new Error('Failed to save workspace');
      }
    } catch {
      notification.error({
        message: 'Error Saving Workspace',
        description: 'Failed to save workspace state.',
        placement: 'topRight'
      });
    }
  };

  const saveAnnotationToDB = async (feature: any, labelTextVal?: string) => {
    if (!mapId) return;
    try {
      const geojsonFormat = new GeoJSON();
      const geometry = feature.getGeometry();
      if (!geometry) return;

      const geometryGeoJSON = geojsonFormat.writeGeometryObject(geometry, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });

      const body = {
        id: feature.getId()?.toString(),
        map: mapId,
        geometry: geometryGeoJSON,
        label: labelTextVal || feature.get('label') || '',
        type: feature.get('type') || 'shape'
      };

      const response = await apiRequest('/maps/annotations', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error('Failed to save annotation to database');
      }
    } catch (err) {
      console.error('Failed to save annotation:', err);
      notification.error({
        message: 'Persistence Error',
        description: 'Failed to save annotation to the database.',
        placement: 'topRight'
      });
    }
  };

  const deleteAnnotationFromDB = async (id: string) => {
    try {
      const response = await apiRequest(`/maps/annotations/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to delete annotation from DB');
      }
    } catch (err) {
      console.error('Failed to delete annotation:', err);
      notification.error({
        message: 'Persistence Error',
        description: 'Failed to remove annotation from the database.',
        placement: 'topRight'
      });
    }
  };

  const clearAnnotationsFromDB = async () => {
    if (!mapId) return;
    try {
      const response = await apiRequest(`/maps/annotations/clear?map_id=${mapId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to clear annotations from DB');
      }
      notification.success({
        message: 'Cleared',
        description: 'All annotations cleared successfully.',
        placement: 'topRight'
      });
    } catch (err) {
      console.error('Failed to clear annotations:', err);
      notification.error({
        message: 'Persistence Error',
        description: 'Failed to clear annotations from the database.',
        placement: 'topRight'
      });
    }
  };

  const pollAnalysisStatus = async (datasetId: string, datasetName: string, isRaster: boolean = false) => {
    try {
      const endpoint = isRaster
        ? `/rasteranalysis/status/${datasetId}/`
        : `/vectoranalysis/status/${datasetId}/`;
      const response = await apiRequest(endpoint);
      if (response.ok) {
        const data = await response.json();
        setAnalysisStatus(data.status);
        setAnalysisProgress(data.progress || 0);
        setAnalysisMessage(data.status_message || '');

        if (data.status === 'READY') {
          notification.success({
            message: 'Analysis Succeeded',
            description: `Layer "${datasetName}" is ready. Loading on map shortly...`,
            placement: 'topRight'
          });

          let detectedType = isRaster ? 'RASTER' : 'VECTOR';
          try {
            const dsRes = await apiRequest(`/datasets/${datasetId}/`);
            if (dsRes.ok) {
              const dsData = await dsRes.json();
              if (dsData.data_type) {
                detectedType = dsData.data_type;
              }
            }
          } catch (e) {
            console.error('Error fetching dataset detail to verify type:', e);
          }

          setTimeout(() => {
            addLayerToMap({
              id: datasetId,
              name: datasetName,
              data_type: detectedType
            });
            zoomToLayer(datasetId, detectedType);
            setAnalysisLoading(false);
            setAnalysisStatus(null);
            setAnalysisProgress(0);
            setAnalysisMessage('');
          }, 2500);
        } else if (data.status === 'FAILED') {
          notification.error({
            message: 'Analysis Failed',
            description: data.status_message || 'The spatial analysis task failed.',
            placement: 'topRight'
          });
          setAnalysisLoading(false);
          setAnalysisStatus(null);
        } else {
          setTimeout(() => pollAnalysisStatus(datasetId, datasetName, isRaster), 2000);
        }
      } else {
        throw new Error('Status check failed');
      }
    } catch (err) {
      console.error('Error polling status:', err);
      setTimeout(() => pollAnalysisStatus(datasetId, datasetName, isRaster), 3000);
    }
  };

  const triggerRasterAnalysis = async (workflowKey: string, params: any) => {
    let bodyData: any = {};
    let endpoint = '';

    const selectedRasterLayer = params.selectedRasterLayer;

    if (workflowKey === 'slope') {
      endpoint = '/rasteranalysis/slope/';
      bodyData = { dataset_id: selectedRasterLayer };
    } else if (workflowKey === 'aspect') {
      endpoint = '/rasteranalysis/aspect/';
      bodyData = { dataset_id: selectedRasterLayer };
    } else if (workflowKey === 'hillshade') {
      endpoint = '/rasteranalysis/hillshade/';
      bodyData = {
        dataset_id: selectedRasterLayer,
        azimuth: Number(params.rasterAzimuth),
        altitude: Number(params.rasterAltitude)
      };
    } else if (workflowKey === 'roughness') {
      endpoint = '/rasteranalysis/roughness/';
      bodyData = { dataset_id: selectedRasterLayer };
    } else if (workflowKey === 'tri') {
      endpoint = '/rasteranalysis/tri/';
      bodyData = { dataset_id: selectedRasterLayer };
    } else if (workflowKey === 'tpi') {
      endpoint = '/rasteranalysis/tpi/';
      bodyData = { dataset_id: selectedRasterLayer };
    } else if (workflowKey === 'reproject') {
      endpoint = '/rasteranalysis/reproject/';
      bodyData = {
        dataset_id: selectedRasterLayer,
        target_crs: params.rasterTargetCrs
      };
    } else if (workflowKey === 'rescale') {
      endpoint = '/rasteranalysis/rescale/';
      bodyData = {
        dataset_id: selectedRasterLayer,
        src_min: Number(params.rasterSrcMin),
        src_max: Number(params.rasterSrcMax),
        dst_min: Number(params.rasterDstMin),
        dst_max: Number(params.rasterDstMax)
      };
    } else if (workflowKey === 'ndvi') {
      endpoint = '/rasteranalysis/ndvi/';
      bodyData = {
        dataset_id: selectedRasterLayer,
        red_band: Number(params.rasterRedBand),
        nir_band: Number(params.rasterNirBand)
      };
    } else if (workflowKey === 'polygonize') {
      endpoint = '/rasteranalysis/polygonize/';
      bodyData = { dataset_id: selectedRasterLayer };
    } else if (workflowKey === 'clip') {
      endpoint = '/rasteranalysis/clip/';
      let geojsonObj: any = null;
      const selectedClipAnnotation = params.selectedClipAnnotation;
      const clipGeoJsonStr = params.clipGeoJsonStr;

      if (selectedClipAnnotation) {
        const ann = annotations.find(a => a.id === selectedClipAnnotation);
        if (ann && ann.featureRef) {
          const geojsonFormat = new GeoJSON();
          const geometry = ann.featureRef.getGeometry();
          if (geometry) {
            geojsonObj = geojsonFormat.writeGeometryObject(geometry, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            });
          }
        }
      } else if (clipGeoJsonStr) {
        try {
          geojsonObj = JSON.parse(clipGeoJsonStr);
        } catch {
          notification.error({
            message: 'Invalid GeoJSON',
            description: 'Could not parse custom GeoJSON geometry.',
            placement: 'topRight'
          });
          return;
        }
      }

      if (!geojsonObj) {
        notification.error({
          message: 'Missing Boundary',
          description: 'Please select a drawn annotation or provide a valid GeoJSON polygon to clip.',
          placement: 'topRight'
        });
        return;
      }

      bodyData = {
        dataset_id: selectedRasterLayer,
        clip_geojson: geojsonObj
      };
    }

    if (!endpoint) return;

    setAnalysisLoading(true);
    setAnalysisStatus('PROCESSING');
    setAnalysisProgress(0);
    setAnalysisMessage('Starting raster analysis...');

    try {
      const response = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(bodyData)
      });

      if (response.ok) {
        const data = await response.json();
        notification.success({
          message: 'Analysis Triggered',
          description: `Analysis task successfully started: ${data.name}`,
          placement: 'topRight'
        });

        pollAnalysisStatus(data.id, data.name, true);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.detail || 'Failed to start analysis.');
      }
    } catch (err: any) {
      notification.error({
        message: 'Analysis Error',
        description: err.message || 'An error occurred while starting the analysis.',
        placement: 'topRight'
      });
      setAnalysisLoading(false);
      setAnalysisStatus(null);
    }
  };

  const triggerAnalysis = async (workflowKey: string, params: any) => {
    let bodyData: any = {};
    let endpoint = '';

    if (workflowKey === 'buffer') {
      endpoint = '/vectoranalysis/buffer/';
      bodyData = {
        dataset_id: params.selectedLayer1,
        distance: params.bufferDistance
      };
    } else if (workflowKey === 'dissolve') {
      endpoint = '/vectoranalysis/dissolve/';
      bodyData = {
        dataset_id: params.selectedLayer1,
        by_attribute: params.dissolveField
      };
    } else if (workflowKey === 'centroid') {
      endpoint = '/vectoranalysis/centroid/';
      bodyData = {
        dataset_id: params.selectedLayer1
      };
    } else if (workflowKey === 'simplify') {
      endpoint = '/vectoranalysis/simplify/';
      bodyData = {
        dataset_id: params.selectedLayer1,
        tolerance: params.simplifyTolerance
      };
    } else if (workflowKey === 'voronoi') {
      endpoint = '/vectoranalysis/voronoi/';
      bodyData = {
        dataset_id: params.selectedLayer1
      };
    } else if (workflowKey === 'overlay') {
      endpoint = '/vectoranalysis/difference/';
      bodyData = {
        dataset_id: params.selectedLayer1,
        difference_dataset_id: params.selectedLayer2
      };
    } else if (workflowKey === 'clip') {
      endpoint = '/vectoranalysis/clip/';
      bodyData = {
        dataset_id: params.selectedLayer1,
        clip_dataset_id: params.selectedLayer2
      };
    }

    if (!endpoint) return;

    setAnalysisLoading(true);
    setAnalysisStatus('PROCESSING');
    setAnalysisProgress(0);
    setAnalysisMessage('Starting analysis...');

    try {
      const response = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify(bodyData)
      });

      if (response.ok) {
        const data = await response.json();
        notification.success({
          message: 'Analysis Triggered',
          description: `Analysis task successfully started: ${data.name}`,
          placement: 'topRight'
        });

        pollAnalysisStatus(data.id, data.name);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.detail || 'Failed to start analysis.');
      }
    } catch (err: any) {
      notification.error({
        message: 'Analysis Error',
        description: err.message || 'An error occurred while running analysis.',
        placement: 'topRight'
      });
      setAnalysisLoading(false);
      setAnalysisStatus(null);
    }
  };

  const saveMeasurementToDB = async (feature: any, type: string, displayVal: string) => {
    if (!mapId) return;
    try {
      const geojsonFormat = new GeoJSON();
      const geometry = feature.getGeometry();
      if (!geometry) return;

      const geometryGeoJSON = geojsonFormat.writeGeometryObject(geometry, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });

      const body = {
        id: feature.getId()?.toString(),
        map: mapId,
        geometry: geometryGeoJSON,
        display_val: displayVal,
        type: type
      };

      const response = await apiRequest('/maps/measurements', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error('Failed to save measurement to database');
      }
    } catch (err) {
      console.error('Failed to save measurement:', err);
      notification.error({
        message: 'Persistence Error',
        description: 'Failed to save measurement to the database.',
        placement: 'topRight'
      });
    }
  };

  const deleteMeasurementFromDB = async (id: string) => {
    try {
      const response = await apiRequest(`/maps/measurements/${id}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to delete measurement from DB');
      }
    } catch (err) {
      console.error('Failed to delete measurement:', err);
      notification.error({
        message: 'Persistence Error',
        description: 'Failed to remove measurement from the database.',
        placement: 'topRight'
      });
    }
  };

  const clearMeasurementsFromDB = async () => {
    if (!mapId) return;
    try {
      const response = await apiRequest(`/maps/measurements/clear?map_id=${mapId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error('Failed to clear measurements from DB');
      }
      notification.success({
        message: 'Cleared',
        description: 'All measurements cleared successfully.',
        placement: 'topRight'
      });
    } catch (err) {
      console.error('Failed to clear measurements:', err);
      notification.error({
        message: 'Persistence Error',
        description: 'Failed to clear measurements from the database.',
        placement: 'topRight'
      });
    }
  };



  const setScale = (scaleValue: number) => {
    const view = mapInstance.current?.getView();
    if (view) {
      const dpi = 96;
      const inchesPerMeter = 39.37;
      const resolution = scaleValue / (dpi * inchesPerMeter);
      view.setResolution(resolution);
      notification.success({
        message: 'Scale Updated',
        description: `Map scale set to 1 : ${scaleValue.toLocaleString()}`,
        placement: 'topRight'
      });
    }
  };

  const startEditingCoords = () => {
    isEditingCoordsRef.current = true;
    setIsEditingCoords(true);
    const center = mapInstance.current?.getView().getCenter();
    if (center) {
      const coord = toLonLat(center);
      setEditLon(coord[0].toFixed(6));
      setEditLat(coord[1].toFixed(6));
    } else {
      setEditLon('0.000000');
      setEditLat('0.000000');
    }
  };

  const saveCoords = () => {
    const lon = parseFloat(editLon);
    const lat = parseFloat(editLat);
    if (!isNaN(lon) && !isNaN(lat)) {
      const view = mapInstance.current?.getView();
      if (view) {
        view.setCenter(fromLonLat([lon, lat]));
        updateCoordinatesText(lon, lat);
        notification.success({
          message: 'Location Updated',
          description: `Map center set to Longitude: ${lon}, Latitude: ${lat}`,
          placement: 'topRight'
        });
      }
    }
    isEditingCoordsRef.current = false;
    setIsEditingCoords(false);
  };

  // Layer list and Add layer helpers
  const fetchDatasetsForModal = useCallback(async () => {
    setModalLoading(true);
    try {
      const res = await apiRequest('/datasets/');
      if (!res.ok) throw new Error(`GeoServer returned status: ${res.status}`);
      const layers = await res.json();
      setDatasetsList(layers);
    } catch (err: any) {
      console.error('Failed to load layers from GeoServer capabilities:', err);
      notification.error({
        message: 'GetCapabilities Error',
        description: err.message || 'Could not fetch capabilities layers list from GeoServer.',
        placement: 'topRight'
      });
    } finally {
      setModalLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    if (token) {
      queueMicrotask(() => {
        fetchDatasetsForModal();
      });
    }
  }, [token, isAddLayerModalOpen, fetchDatasetsForModal]);




  const dragItemRef = useRef<number | null>(null);
  const dragOverItemRef = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragItemRef.current = index;
    setDraggingIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const dragIndex = dragItemRef.current;
    if (dragIndex === null || dragIndex === index) return;

    if (dragOverItemRef.current === index) return;
    dragOverItemRef.current = index;

    const updatedLayers = [...addedLayers];
    const [draggedItem] = updatedLayers.splice(dragIndex, 1);
    updatedLayers.splice(index, 0, draggedItem);

    dragItemRef.current = index;
    setDraggingIndex(index);
    setAddedLayers(updatedLayers);

    // Apply the new z-index values directly to the OpenLayers map layers
    updatedLayers.forEach((layer, idx) => {
      const olLayer = olLayersRef.current[layer.id];
      if (olLayer) {
        olLayer.setZIndex(idx + 1);
      }
    });
  };

  const handleDragEnd = () => {
    dragItemRef.current = null;
    dragOverItemRef.current = null;
    setDraggingIndex(null);
  };

  const zoomToLayer = async (id: string, _type?: string) => {
    try {
      // 1. Check if the layer is loaded locally and has a VectorSource or bbox
      const olLayer = olLayersRef.current[id];
      if (olLayer) {
        if (typeof olLayer.getSource === 'function') {
          const source = olLayer.getSource();
          if (source && typeof source.getExtent === 'function') {
            const extent = source.getExtent();
            if (extent && extent[0] !== Infinity && !isNaN(extent[0]) && isFinite(extent[0])) {
              mapInstance.current?.getView().fit(extent, {
                padding: [80, 80, 80, 80],
                duration: 1000,
                maxZoom: 17
              });
              return;
            }
          }
        }

        const localBbox = olLayer.get('bbox');
        if (localBbox && Array.isArray(localBbox) && localBbox.length === 4) {
          const isWorldExtent = localBbox[0] === -180 && localBbox[1] === -90 && localBbox[2] === 180 && localBbox[3] === 90;
          if (!isWorldExtent) {
            const transformedExtent = [
              ...fromLonLat([localBbox[0], localBbox[1]]),
              ...fromLonLat([localBbox[2], localBbox[3]]),
            ];
            mapInstance.current?.getView().fit(transformedExtent, {
              padding: [50, 50, 50, 50],
              duration: 1000,
            });
            return;
          }
        }
      }

      const response = await apiRequest(`/datasets/${id}`);
      if (!response.ok) throw new Error('Failed to fetch dataset details');
      const data = await response.json();

      const bbox = data.metadata?.bbox;
      if (bbox && bbox.coordinates && bbox.coordinates[0]) {
        const coords = bbox.coordinates[0];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        coords.forEach((c: number[]) => {
          const lon = c[0];
          const lat = c[1];
          if (lon < minX) minX = lon;
          if (lon > maxX) maxX = lon;
          if (lat < minY) minY = lat;
          if (lat > maxY) maxY = lat;
        });

        const transformedExtent = [
          ...fromLonLat([minX, minY]),
          ...fromLonLat([maxX, maxY]),
        ];
        mapInstance.current?.getView().fit(transformedExtent, {
          padding: [50, 50, 50, 50],
          duration: 1000,
        });
      } else {
        // Fallback: query GeoServer WMS GetCapabilities for the layer's real bbox
        try {
          const geoserverUrl = (user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
          const headers: Record<string, string> = {};
          if (user?.geoserverAuth) headers['Authorization'] = user.geoserverAuth;
          const capRes = await fetch(`${geoserverUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`, { headers });
          if (capRes.ok) {
            const capText = await capRes.text();
            const parser = new DOMParser();
            const xml = parser.parseFromString(capText, 'text/xml');
            const layerEls = xml.getElementsByTagNameNS('*', 'Layer');
            let found = false;
            for (let i = 0; i < layerEls.length; i++) {
              const nameEl = layerEls[i].getElementsByTagNameNS('*', 'Name')[0];
              if (nameEl?.textContent?.trim() !== id) continue;
              const geoBbox = layerEls[i].querySelector('EX_GeographicBoundingBox');
              if (geoBbox) {
                const w = parseFloat(geoBbox.querySelector('westBoundLongitude')?.textContent || '-180');
                const s = parseFloat(geoBbox.querySelector('southBoundLatitude')?.textContent || '-90');
                const e = parseFloat(geoBbox.querySelector('eastBoundLongitude')?.textContent || '180');
                const n = parseFloat(geoBbox.querySelector('northBoundLatitude')?.textContent || '90');
                const isWorld = w === -180 && s === -90 && e === 180 && n === 90;
                if (!isWorld) {
                  mapInstance.current?.getView().fit(
                    [...fromLonLat([w, s]), ...fromLonLat([e, n])],
                    { padding: [50, 50, 50, 50], duration: 1000 }
                  );
                  found = true;
                }
              }
              break;
            }
            if (!found) {
              notification.warning({
                message: 'Extent Not Found',
                description: 'No bounding box extent metadata found for this dataset.',
                placement: 'topRight'
              });
            }
          } else {
            notification.warning({
              message: 'Extent Not Found',
              description: 'No bounding box extent metadata found for this dataset.',
              placement: 'topRight'
            });
          }
        } catch (capErr) {
          console.error('Failed to fetch GetCapabilities bbox:', capErr);
        }
      }
    } catch (err: any) {
      console.error(err);
      notification.error({
        message: 'Zoom Failed',
        description: err.message || 'Failed to zoom to dataset extent',
        placement: 'topRight'
      });
    }
  };

  const startEditingZoom = () => {
    setIsEditingZoom(true);
    setEditZoom(zoomLevel.toString());
  };

  const saveZoom = () => {
    const z = parseFloat(editZoom);
    if (!isNaN(z)) {
      const view = mapInstance.current?.getView();
      if (view) {
        view.setZoom(z);
        setZoomLevel(z);
        notification.success({
          message: 'Zoom Updated',
          description: `Map zoom set to ${z}`,
          placement: 'topRight'
        });
      }
    }
    setIsEditingZoom(false);
  };

  const saveScale = () => {
    const s = parseFloat(editScaleVal);
    if (!isNaN(s)) {
      setScale(s);
    }
    setIsEditingScaleText(false);
  };

  const togglePanel = (panelName: string) => {
    setActivePanel(prev => prev === panelName ? null : panelName);
    setActiveZoomTool(null);
    stopZoomBox();
  };

  const addWpsResultLayerToMap = async (geojsonOrRaster: any, resultLayerName: string) => {
    if (!mapInstance.current) return;

    if (wpsDrawSourceRef.current) {
      wpsDrawSourceRef.current.clear();
    }

    // ── Handle Raster Result ──────────────────────────────────────────────
    if (geojsonOrRaster && geojsonOrRaster.type === 'RASTER') {
      const layerId = `raster_res_${Date.now()}`;
      const layerName = geojsonOrRaster.layerName || layerId;
      const bbox = geojsonOrRaster.bbox || [55.1, 24.9, 55.4, 25.2];
      const mapProj = mapInstance.current.getView().getProjection();
      let projExtent: number[];
      try {
        projExtent = transformExtent(bbox, 'EPSG:4326', mapProj);
        if (!projExtent || projExtent.some(n => isNaN(n) || !isFinite(n))) {
          projExtent = [-20037508.34, -20037508.34, 20037508.34, 20037508.34];
        }
      } catch {
        projExtent = [-20037508.34, -20037508.34, 20037508.34, 20037508.34];
      }

      // Compute highest zIndex
      let maxZIndex = 0;
      addedLayers.forEach(l => {
        const olLayer = (olLayersRef.current as any)[l.id];
        if (olLayer) {
          const z = olLayer.getZIndex();
          if (z > maxZIndex) maxZIndex = z;
        }
      });

      let newOlLayer: any;

      if (geojsonOrRaster.imageUrl) {
        newOlLayer = new ImageLayer({
          source: new ImageStatic({
            url: geojsonOrRaster.imageUrl,
            imageExtent: projExtent,
            projection: mapProj,
          }),
          zIndex: maxZIndex + 10,
        });
      } else {
        const geoserverUrl = (user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
        const geoserverAuth = user?.geoserverAuth;

        newOlLayer = new TileLayer({
          source: new TileWMS({
            url: geoserverUrl + '/wms',
            params: {
              'LAYERS': layerName,
              'TILED': true,
            },
            serverType: 'geoserver',
            transition: 200,
            tileLoadFunction: createWmsTileLoadFunction(geoserverAuth),
          }),
          zIndex: maxZIndex + 10,
          preload: 2,
        });
      }

      newOlLayer.setOpacity(1.0);
      newOlLayer.set('name', resultLayerName);
      newOlLayer.set('id', layerId);
      newOlLayer.set('bbox', bbox);
      newOlLayer.setVisible(true);

      mapInstance.current.addLayer(newOlLayer);
      olLayersRef.current[layerId] = newOlLayer;
      if (typeof window !== 'undefined' && (window as any).vismapLayers) {
        (window as any).vismapLayers[layerId] = newOlLayer;
      }

      const newLayer: LayerState = {
        id: layerId,
        name: resultLayerName,
        type: 'RASTER',
        visible: true,
        opacity: 1.0,
        labelsEnabled: false,
        bbox: bbox,
        rawBuffer: geojsonOrRaster.rawBuffer,
        imageBlob: geojsonOrRaster.imageBlob,
        imageUrl: geojsonOrRaster.imageUrl,
        nativeCRS: geojsonOrRaster.nativeCRS || 'EPSG:4326',
      };
      setAddedLayers(prev => [...prev, newLayer]);

      // Zoom to raster bounding box extent
      try {
        mapInstance.current.getView().fit(projExtent, {
          padding: [50, 50, 50, 50],
          duration: 1000,
          maxZoom: 16
        });
      } catch (zoomErr) {
        console.error('Failed to fit view to raster result bbox:', zoomErr);
      }
      return;
    }

    // ── Handle Vector Result (GeoJSON) ────────────────────────────────────
    const geojson = geojsonOrRaster?.geojson || geojsonOrRaster;
    const geojsonFormat = new GeoJSON();

    let dataCRS = geojsonOrRaster?.nativeCRS;
    if (geojson?.crs?.properties?.name) {
      const crsName = String(geojson.crs.properties.name);
      const match = crsName.match(/(?:EPSG[:\s#]+|::)(\d+)/i);
      if (match) dataCRS = `EPSG:${match[1]}`;
    }

    let firstCoord: number[] | null = null;
    try {
      const firstFeature = geojson?.features?.[0];
      const geom = firstFeature?.geometry;
      if (geom) {
        if (geom.type === 'Point') firstCoord = geom.coordinates;
        else if (geom.type === 'LineString' || geom.type === 'MultiPoint') firstCoord = geom.coordinates[0];
        else if (geom.type === 'Polygon' || geom.type === 'MultiLineString') firstCoord = geom.coordinates[0][0];
        else if (geom.type === 'MultiPolygon') firstCoord = geom.coordinates[0][0][0];
      }
    } catch (e) {
      console.error('Failed to parse first feature coordinate:', e);
    }

    if (firstCoord) {
      const isDegree = Math.abs(firstCoord[0]) <= 180 && Math.abs(firstCoord[1]) <= 90;
      if (isDegree) {
        dataCRS = 'EPSG:4326';
      } else if (!dataCRS || dataCRS === 'EPSG:4326') {
        dataCRS = geojsonOrRaster?.nativeCRS || 'EPSG:3857';
      }
    } else if (!dataCRS) {
      dataCRS = 'EPSG:4326';
    }

    if (dataCRS && dataCRS !== 'EPSG:4326' && dataCRS !== 'EPSG:3857') {
      try {
        await ensureProjection(dataCRS);
      } catch (err) {
        console.warn(`Could not ensure projection for ${dataCRS}:`, err);
      }
    }

    const mapProj = mapInstance.current.getView().getProjection();
    let features: any[] = [];
    try {
      const cleanGeojson = { ...geojson };
      delete cleanGeojson.crs;
      features = geojsonFormat.readFeatures(cleanGeojson, {
        dataProjection: dataCRS,
        featureProjection: mapProj
      });
    } catch (readErr) {
      console.warn('Failed to read features with dataCRS, falling back to auto read:', readErr);
      try {
        features = geojsonFormat.readFeatures(geojson, {
          featureProjection: mapProj
        });
      } catch {
        features = [];
      }
    }

    // Filter out features with missing or empty geometries that lack getExtent to prevent OpenLayers crashes
    const validFeatures = features.filter(f => {
      const geom = f.getGeometry();
      return geom && typeof geom.getExtent === 'function';
    });

    const vectorSource = new VectorSource({
      features: validFeatures
    });

    const isContourLayer = resultLayerName.toLowerCase().includes('contour');
    const isZonalLayer = resultLayerName.toLowerCase().includes('zonal') || resultLayerName.toLowerCase().includes('stat');
    const isPointLayer = resultLayerName.toLowerCase().includes('point') || (validFeatures[0]?.getGeometry()?.getType() === 'Point' || validFeatures[0]?.getGeometry()?.getType() === 'MultiPoint');

    const strokeColor = isZonalLayer ? '#059669' : (isContourLayer ? '#ea580c' : '#2563eb');
    const fillColor = isZonalLayer ? 'rgba(5, 150, 105, 0.25)' : (isContourLayer || isPointLayer ? 'transparent' : 'rgba(37, 99, 235, 0.35)');
    const pointRadius = validFeatures.length > 5000 ? 1.5 : (validFeatures.length > 1000 ? 2 : (validFeatures.length > 300 ? 3 : 5));

    // Style supporting ALL geometry types (Polygon fill+stroke, Line stroke, Point circle)
    const baseStyle = new Style({
      stroke: isPointLayer ? undefined : new Stroke({
        color: strokeColor,
        width: isContourLayer ? 1.5 : (isZonalLayer ? 2.5 : 2)
      }),
      fill: (isContourLayer || isPointLayer) ? undefined : new Fill({
        color: fillColor
      }),
      image: new CircleStyle({
        radius: pointRadius,
        fill: new Fill({
          color: strokeColor
        }),
        stroke: validFeatures.length > 500 ? undefined : new Stroke({
          color: '#ffffff',
          width: 1
        })
      })
    });

    const styleFunction = (feat: any) => {
      const props = feat?.getProperties ? feat.getProperties() : {};
      const avg = props.avg ?? props.mean ?? props.average;
      const min = props.min ?? props.minimum;
      const max = props.max ?? props.maximum;
      const count = props.count;

      if (isZonalLayer && avg !== undefined) {
        const numAvg = typeof avg === 'number' ? avg.toFixed(2) : String(avg);
        const minStr = min !== undefined ? (typeof min === 'number' ? min.toFixed(1) : String(min)) : '—';
        const maxStr = max !== undefined ? (typeof max === 'number' ? max.toFixed(1) : String(max)) : '—';
        const countStr = count !== undefined ? `\n(${typeof count === 'number' ? count.toLocaleString() : count} px)` : '';
        const labelText = `Avg: ${numAvg}\nMin: ${minStr} | Max: ${maxStr}${countStr}`;

        return new Style({
          stroke: new Stroke({
            color: strokeColor,
            width: 2.5
          }),
          fill: new Fill({
            color: fillColor
          }),
          text: new TextStyle({
            text: labelText,
            font: 'bold 11px Inter, sans-serif',
            fill: new Fill({ color: '#064e3b' }),
            backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.94)' }),
            backgroundStroke: new Stroke({ color: '#059669', width: 1.5 }),
            padding: [4, 8, 4, 8],
            offsetY: 0,
            overflow: true
          })
        });
      }
      return baseStyle;
    };

    // Compute highest zIndex among existing layers to ensure this layer is strictly on top
    let maxZIndex = 0;
    addedLayers.forEach(l => {
      const olLayer = (olLayersRef.current as any)[l.id];
      if (olLayer) {
        const z = olLayer.getZIndex();
        if (z > maxZIndex) maxZIndex = z;
      }
    });

    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: isZonalLayer ? styleFunction : baseStyle,
      zIndex: maxZIndex + 10
    });

    vectorLayer.setVisible(true);
    vectorLayer.setOpacity(1.0);

    // Save metadata on the layer (so it can be zoomed/styled)
    vectorLayer.set('name', resultLayerName);
    const layerId = `wps_result_${Date.now()}`;
    vectorLayer.set('id', layerId);
    vectorLayer.set('bbox', vectorSource.getExtent());

    // Store in our layers ref
    (olLayersRef.current as any)[layerId] = vectorLayer;
    if (typeof window !== 'undefined' && (window as any).vismapLayers) {
      (window as any).vismapLayers[layerId] = vectorLayer;
    }
    mapInstance.current.addLayer(vectorLayer);

    const extent = vectorSource.getExtent();

    // Update state to include this layer
    const newLayer: LayerState = {
      id: layerId,
      name: resultLayerName,
      type: 'VECTOR',
      visible: true,
      opacity: 1,
      labelsEnabled: false,
      geojson: geojson,
      nativeCRS: dataCRS,
      bbox: extent ? [...extent] : undefined
    };
    setAddedLayers(prev => [...prev, newLayer]);

    // Zoom to this new result layer
    if (extent && extent[0] !== Infinity && !isNaN(extent[0]) && isFinite(extent[0])) {
      try {
        mapInstance.current.getView().fit(extent, {
          padding: [80, 80, 80, 80],
          duration: 1000,
          maxZoom: 16
        });
      } catch (fitErr) {
        console.warn('Failed to fit extent for vector result:', fitErr);
      }
    }
  };

  const getLayerFeaturesLocal = (layerId: string) => {
    const olLayer = olLayersRef.current[layerId];
    if (olLayer && typeof olLayer.getSource === 'function') {
      const source = olLayer.getSource();
      if (source && typeof source.getFeatures === 'function') {
        const features = source.getFeatures();
        if (features && features.length > 0) {
          const geojsonFormat = new GeoJSON();
          return geojsonFormat.writeFeaturesObject(features, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:4326'
          });
        }
      }
    }
    return null;
  };

  const stopQueryDraw = () => {
    setIsQueryDrawing(false);
    if (mapInstance.current && queryDrawRef.current) {
      mapInstance.current.removeInteraction(queryDrawRef.current);
      queryDrawRef.current = null;
    }
    if (mapInstance.current) {
      const viewport = mapInstance.current.getViewport();
      if (viewport) viewport.style.cursor = 'default';

      // Re-enable double click zoom with a slight delay to prevent double-click zoom when finishing a drawing.
      setTimeout(() => {
        if (doubleClickZoomRef.current) {
          doubleClickZoomRef.current.setActive(true);
        }
      }, 250);
    }
  };

  // Ensure a section's draw source+layer exists, return the source
  const ensureDrawLayer = (
    sourceRef: React.MutableRefObject<VectorSource | null>,
    layerRef: React.MutableRefObject<VectorLayer<any> | null>,
    strokeColor: string,
    zIndex: number,
  ): VectorSource => {
    if (!sourceRef.current) {
      const src = new VectorSource();
      sourceRef.current = src;
      const lyr = new VectorLayer({
        source: src,
        style: [
          new Style({
            fill: new Fill({ color: 'rgba(255,255,255,0.18)' }),
            stroke: new Stroke({ color: '#000000', width: 3.5 }),
            image: new CircleStyle({ radius: 6, fill: new Fill({ color: '#ffffff' }), stroke: new Stroke({ color: '#000000', width: 2.5 }) }),
          }),
          new Style({
            stroke: new Stroke({ color: strokeColor, width: 1.5, lineDash: [6, 4] }),
            image: new CircleStyle({ radius: 6, fill: new Fill({ color: 'rgba(0,0,0,0)' }), stroke: new Stroke({ color: strokeColor, width: 1 }) }),
          }),
        ],
        zIndex,
      });
      layerRef.current = lyr;
      mapInstance.current!.addLayer(lyr);
    }
    return sourceRef.current;
  };

  const handleStartQueryDraw = (type: string, owner: 'buffer' | 'spatial') => {
    queryDrawOwnerRef.current = owner;
    if (!mapInstance.current) return;
    stopMeasurement();
    stopDrawingAnnotation();
    if (queryDrawRef.current) {
      mapInstance.current.removeInteraction(queryDrawRef.current);
      queryDrawRef.current = null;
    }
    setIsQueryDrawing(true);

    // Disable double click zoom while drawing
    if (doubleClickZoomRef.current) {
      doubleClickZoomRef.current.setActive(false);
    }

    const isBuffer = owner === 'buffer';
    if (isBuffer) setBufferDrawnGeometry(null);
    else setSpatialDrawnGeometry(null);

    const src = ensureDrawLayer(
      isBuffer ? bufferDrawSourceRef : spatialDrawSourceRef,
      isBuffer ? bufferDrawLayerRef : spatialDrawLayerRef,
      isBuffer ? '#00e5ff' : '#ff9500',
      isBuffer ? 1003 : 1004,
    );
    src.clear();

    const drawOptions: any = { source: src };
    if (type === 'Point') drawOptions.type = 'Point';
    else if (type === 'LineString') drawOptions.type = 'LineString';
    else if (type === 'Polygon') drawOptions.type = 'Polygon';
    else if (type === 'Box') { drawOptions.type = 'Circle'; drawOptions.geometryFunction = createBox(); }
    else if (type === 'Circle') drawOptions.type = 'Circle';
    else drawOptions.type = 'Polygon';

    const draw = new Draw(drawOptions);
    queryDrawRef.current = draw;
    const viewport = mapInstance.current.getViewport();
    if (viewport) viewport.style.cursor = 'crosshair';
    draw.on('drawend', (evt) => {
      const geom = evt.feature.getGeometry();
      if (!geom) return;
      const finalGeom = geom.getType() === 'Circle' ? fromCircle(geom as any, 64) : geom;
      const geojsonFormat = new GeoJSON();
      const geoJsonGeom = geojsonFormat.writeGeometryObject(finalGeom, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      if (queryDrawOwnerRef.current === 'buffer') setBufferDrawnGeometry(geoJsonGeom);
      else setSpatialDrawnGeometry(geoJsonGeom);
      stopQueryDraw();
    });
    mapInstance.current.addInteraction(draw);
  };

  const handleClearBufferDraw = () => {
    setBufferDrawnGeometry(null);
    bufferDrawSourceRef.current?.clear();
    stopQueryDraw();
  };

  const handleClearSpatialDraw = () => {
    setSpatialDrawnGeometry(null);
    spatialDrawSourceRef.current?.clear();
    stopQueryDraw();
  };

  // Render a geometry (from pasted GeoJSON or bookmark) onto the correct section's draw layer
  const handleShowGeometryOnMap = (geometry: any, owner: 'buffer' | 'spatial') => {
    if (!mapInstance.current) return;
    const isBuffer = owner === 'buffer';
    const src = ensureDrawLayer(
      isBuffer ? bufferDrawSourceRef : spatialDrawSourceRef,
      isBuffer ? bufferDrawLayerRef : spatialDrawLayerRef,
      isBuffer ? '#00e5ff' : '#ff9500',
      isBuffer ? 1003 : 1004,
    );
    src.clear();
    try {
      const geojsonFormat = new GeoJSON();
      const features = geojsonFormat.readFeatures(
        { type: 'Feature', geometry, properties: {} },
        { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' }
      );
      src.addFeatures(features);
    } catch {
      // invalid geometry — ignore
    }
  };

  const handleGoToXYLocation = (lon: number, lat: number, zoom?: number) => {
    gotoXYSourceRef.current?.clear();
    const feature = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
    gotoXYSourceRef.current?.addFeature(feature);
    setGotoXYMarkerCoords([lon, lat]);
    setGotoXYMarkerActive(true);
    const targetZoom = typeof zoom === 'number' && !isNaN(zoom) ? zoom : 13;
    mapInstance.current?.getView().animate({ center: fromLonLat([lon, lat]), zoom: targetZoom, duration: 800 });
  };

  const handleClearGotoXYMarker = () => {
    gotoXYSourceRef.current?.clear();
    setGotoXYMarkerCoords(null);
    setGotoXYMarkerActive(false);
  };

  const handleShowGotoXYMarker = (lon: number, lat: number) => {
    if (!mapInstance.current) return;
    gotoXYSourceRef.current?.clear();
    const feature = new Feature({ geometry: new Point(fromLonLat([lon, lat])) });
    gotoXYSourceRef.current?.addFeature(feature);
    setGotoXYMarkerCoords([lon, lat]);
    setGotoXYMarkerActive(true);
  };



  const handleSelectLocation = (lon: number, lat: number) => {
    const view = mapInstance.current?.getView();
    if (view) {
      view.animate({
        center: fromLonLat([lon, lat]),
        zoom: 14,
        duration: 800
      });
    }
  };

  const startMeasurement = (type: 'LineString' | 'Polygon') => {
    if (!mapInstance.current) return;

    // Clear existing interaction
    if (drawInteractionRef.current) {
      mapInstance.current.removeInteraction(drawInteractionRef.current);
    }

    setMeasurementType(type);

    const draw = new Draw({
      source: measurementSourceRef.current!,
      type: type,
      style: new Style({
        fill: new Fill({
          color: 'rgba(147, 51, 234, 0.1)',
        }),
        stroke: new Stroke({
          color: '#9333ea',
          lineDash: [4, 4],
          width: 2,
        }),
        image: new CircleStyle({
          radius: 5,
          stroke: new Stroke({
            color: 'rgba(0, 0, 0, 0.7)',
          }),
          fill: new Fill({
            color: 'rgba(255, 255, 255, 0.2)',
          }),
        }),
      }),
    });

    draw.on('drawend', (evt) => {
      const feature = evt.feature;
      const id = 'measure_' + Date.now();
      feature.setId(id);
      feature.set('visible', true);

      const geom = feature.getGeometry();
      if (!geom) return;
      const geomType = geom.getType();
      let displayVal = '';
      if (geomType === 'LineString') {
        const len = getLength(geom);
        displayVal = len > 1000 ? `${(len / 1000).toFixed(2)} km` : `${len.toFixed(1)} m`;
      } else if (geomType === 'Polygon') {
        const area = getArea(geom);
        displayVal = area > 1000000 ? `${(area / 1000000).toFixed(2)} km²` : `${area.toFixed(1)} m²`;
      }

      feature.set('type', geomType);
      feature.set('displayVal', displayVal);

      setMeasurements(prev => [...prev, {
        id,
        type: geomType,
        displayVal,
        visible: true,
        featureRef: feature
      }]);
      saveMeasurementToDB(feature, geomType, displayVal);
    });

    drawInteractionRef.current = draw;
    mapInstance.current.addInteraction(draw);
  };

  const toggleMeasurementVisibility = (id: string) => {
    setMeasurements(prev => prev.map(m => {
      if (m.id === id) {
        const newVisible = !m.visible;
        m.featureRef.set('visible', newVisible);
        measurementSourceRef.current?.changed();
        return { ...m, visible: newVisible };
      }
      return m;
    }));
  };

  const deleteMeasurement = (id: string) => {
    setMeasurements(prev => {
      const mToDelete = prev.find(m => m.id === id);
      if (mToDelete) {
        measurementSourceRef.current?.removeFeature(mToDelete.featureRef);
      }
      return prev.filter(m => m.id !== id);
    });
    deleteMeasurementFromDB(id);
  };

  const updateMeasurementsList = () => {
    if (!measurementSourceRef.current) return;
    const features = measurementSourceRef.current.getFeatures();
    const list = features.map(f => ({
      id: f.getId(),
      type: f.get('type') || f.getGeometry()?.getType() || 'LineString',
      displayVal: f.get('displayVal') || '',
      visible: f.get('visible') !== false,
      featureRef: f
    }));
    setMeasurements(list);
  };

  const stopMeasurement = () => {
    if (mapInstance.current && drawInteractionRef.current) {
      mapInstance.current.removeInteraction(drawInteractionRef.current);
      drawInteractionRef.current = null;
    }
    setMeasurementType(null);
  };

  const clearMeasurements = () => {
    if (measurementSourceRef.current) {
      measurementSourceRef.current.clear();
    }
    setMeasurements([]);
    clearMeasurementsFromDB();
  };

  const startDrawingAnnotation = (type: string) => {
    console.log('startDrawingAnnotation called with type:', type);
    console.log('mapInstance.current:', mapInstance.current);
    console.log('annotationSourceRef.current:', annotationSourceRef.current);
    if (!mapInstance.current || !annotationSourceRef.current) {
      console.warn('Map or annotation source is null, returning.');
      return;
    }

    // Remove existing draw interaction
    if (annotationDrawRef.current) {
      console.log('Removing existing annotation draw interaction');
      mapInstance.current.removeInteraction(annotationDrawRef.current);
    }

    setAnnotationType(type);

    const drawOption: any = {
      source: annotationSourceRef.current,
    };

    if (type === 'line') {
      drawOption.type = 'LineString';
    } else if (type === 'point') {
      drawOption.type = 'Point';
    } else if (type === 'freehand_line') {
      drawOption.type = 'LineString';
      drawOption.freehand = true;
    } else if (type === 'freehand_polygon') {
      drawOption.type = 'Polygon';
      drawOption.freehand = true;
    } else if (type === 'circle') {
      drawOption.type = 'Circle';
    } else if (type === 'square') {
      drawOption.type = 'Circle';
      drawOption.geometryFunction = createRegularPolygon(4);
    } else if (type === 'rectangle') {
      drawOption.type = 'Circle';
      drawOption.geometryFunction = createBox();
    } else if (type === 'label') {
      drawOption.type = 'Point';
    }

    // Set cursor to crosshair
    const viewport = mapInstance.current.getViewport();
    if (viewport) {
      viewport.style.cursor = 'crosshair';
    }

    const draw = new Draw(drawOption);
    annotationDrawRef.current = draw;

    draw.on('drawstart', () => {
      console.log('Drawstart event triggered');
    });

    draw.on('drawend', (evt) => {
      const feature = evt.feature;
      const id = 'annotation_' + Date.now();
      feature.setId(id);
      feature.set('visible', true);
      feature.set('type', type);
      console.log('Drawend triggered, feature created:', id, 'type:', type);

      if (type === 'label') {
        // Stop draw interaction first so they can type
        stopDrawingAnnotation();

        // Open modal to input text
        tempLabelFeatureRef.current = feature;
        setLabelText('');
        setIsLabelModalOpen(true);
      } else {
        // Standard shape: add to annotations list
        setTimeout(() => {
          const geom = feature.getGeometry();
          if (geom && geom.getType() === 'Circle') {
            const polygonGeom = fromCircle(geom as any, 64);
            feature.setGeometry(polygonGeom);
          }
          updateAnnotationsList();
          saveAnnotationToDB(feature);
        }, 100);
      }
    });

    mapInstance.current.addInteraction(draw);
    console.log('Draw interaction added to map');
  };

  const handleSaveLabel = () => {
    const cleanLabel = labelText.trim();
    if (!cleanLabel) {
      notification.warning({
        message: 'Invalid Label Text',
        description: 'Annotation label text cannot be empty or contain only spaces.',
        placement: 'topRight'
      });
      return;
    }
    if (cleanLabel.length > 32) {
      notification.warning({
        message: 'Invalid Label Text',
        description: 'Annotation label text cannot exceed 32 characters.',
        placement: 'topRight'
      });
      return;
    }

    if (tempLabelFeatureRef.current) {
      tempLabelFeatureRef.current.set('label', cleanLabel);
      updateAnnotationsList();
      saveAnnotationToDB(tempLabelFeatureRef.current, cleanLabel);
    }
    setIsLabelModalOpen(false);
    tempLabelFeatureRef.current = null;
    setLabelText('');
  };

  const handleCancelLabel = () => {
    if (tempLabelFeatureRef.current && annotationSourceRef.current) {
      annotationSourceRef.current.removeFeature(tempLabelFeatureRef.current);
    }
    setIsLabelModalOpen(false);
    tempLabelFeatureRef.current = null;
    setLabelText('');
  };

  const updateAnnotationsList = () => {
    if (!annotationSourceRef.current) return;
    const features = annotationSourceRef.current.getFeatures();
    const list = features.map(f => ({
      id: f.getId(),
      type: f.get('type') || 'shape',
      label: f.get('label') || '',
      visible: f.get('visible') !== false,
      featureRef: f
    }));
    setAnnotations(list);
  };

  const toggleAnnotationVisibility = (id: string) => {
    setAnnotations(prev => prev.map(ann => {
      if (ann.id === id) {
        const newVisible = !ann.visible;
        ann.featureRef.set('visible', newVisible);
        annotationSourceRef.current?.changed();
        return { ...ann, visible: newVisible };
      }
      return ann;
    }));
  };

  const deleteAnnotation = (id: string, label?: string) => {
    const displayName = label ? `"${label}"` : 'this annotation';
    modal.confirm({
      title: 'Delete Annotation',
      content: `Are you sure you want to delete ${displayName}?`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk() {
        setAnnotations(prev => {
          const annToDelete = prev.find(ann => ann.id === id);
          if (annToDelete) {
            annotationSourceRef.current?.removeFeature(annToDelete.featureRef);
          }
          return prev.filter(ann => ann.id !== id);
        });
        deleteAnnotationFromDB(id);
      }
    });
  };

  const stopDrawingAnnotation = () => {
    if (mapInstance.current && annotationDrawRef.current) {
      mapInstance.current.removeInteraction(annotationDrawRef.current);
      annotationDrawRef.current = null;
    }
    if (mapInstance.current) {
      const viewport = mapInstance.current.getViewport();
      if (viewport) {
        viewport.style.cursor = 'default';
      }
    }
    setAnnotationType(null);
  };

  const stopZoomBox = () => {
    if (mapInstance.current && zoomBoxDrawRef.current) {
      mapInstance.current.removeInteraction(zoomBoxDrawRef.current);
      zoomBoxDrawRef.current = null;
    }
    zoomBoxSourceRef.current?.clear();

    if (doubleClickZoomRef.current) {
      doubleClickZoomRef.current.setActive(true);
    }
  };



  const zoomToFullExtent = async () => {
    const visibleLayers = addedLayers.filter(l => l.visible);
    const combinedExtent = [Infinity, Infinity, -Infinity, -Infinity];

    if (visibleLayers.length > 0) {
      try {
        const extents = await Promise.all(
          visibleLayers.map(async (layer) => {
            const response = await apiRequest(`/datasets/${layer.id}/`);
            if (response.ok) {
              const data = await response.json();
              const bbox = data.metadata?.bbox;
              if (bbox && bbox.coordinates && bbox.coordinates[0]) {
                const coords = bbox.coordinates[0];
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                coords.forEach((c: number[]) => {
                  const lon = c[0];
                  const lat = c[1];
                  if (lon < minX) minX = lon;
                  if (lon > maxX) maxX = lon;
                  if (lat < minY) minY = lat;
                  if (lat > maxY) maxY = lat;
                });
                return [minX, minY, maxX, maxY];
              }
            }
            return null;
          })
        );

        const validExtents = extents.filter(Boolean) as number[][];
        validExtents.forEach((ext) => {
          const transformed = [
            ...fromLonLat([ext[0], ext[1]]),
            ...fromLonLat([ext[2], ext[3]]),
          ];
          if (transformed[0] < combinedExtent[0]) combinedExtent[0] = transformed[0];
          if (transformed[1] < combinedExtent[1]) combinedExtent[1] = transformed[1];
          if (transformed[2] > combinedExtent[2]) combinedExtent[2] = transformed[2];
          if (transformed[3] > combinedExtent[3]) combinedExtent[3] = transformed[3];
        });
      } catch (err) {
        console.error('Error fetching layer extents:', err);
      }
    }

    // Include local annotations extent
    const annoSource = annotationSourceRef.current;
    if (annoSource && annoSource.getFeatures().length > 0) {
      const ext = annoSource.getExtent();
      if (ext) {
        if (ext[0] < combinedExtent[0]) combinedExtent[0] = ext[0];
        if (ext[1] < combinedExtent[1]) combinedExtent[1] = ext[1];
        if (ext[2] > combinedExtent[2]) combinedExtent[2] = ext[2];
        if (ext[3] > combinedExtent[3]) combinedExtent[3] = ext[3];
      }
    }

    // Include local measurements extent
    const measSource = measurementSourceRef.current;
    if (measSource && measSource.getFeatures().length > 0) {
      const ext = measSource.getExtent();
      if (ext) {
        if (ext[0] < combinedExtent[0]) combinedExtent[0] = ext[0];
        if (ext[1] < combinedExtent[1]) combinedExtent[1] = ext[1];
        if (ext[2] > combinedExtent[2]) combinedExtent[2] = ext[2];
        if (ext[3] > combinedExtent[3]) combinedExtent[3] = ext[3];
      }
    }

    // Zoom to final combined extent
    if (
      combinedExtent[0] !== Infinity &&
      combinedExtent[1] !== Infinity &&
      combinedExtent[2] !== -Infinity &&
      combinedExtent[3] !== -Infinity
    ) {
      mapInstance.current?.getView().fit(combinedExtent, {
        padding: [50, 50, 50, 50],
        duration: 1000,
      });
    } else {
      notification.info({
        message: 'No Features or Layers',
        description: 'There are no active layers or drawn features on the map. Zooming to default extent.',
        placement: 'topRight'
      });
      mapInstance.current?.getView().animate({
        center: [0, 0],
        zoom: 2,
        duration: 1000,
      });
    }
  };

  const goToPreviousExtent = () => {
    if (currentHistoryIndexRef.current > 0 && mapInstance.current) {
      currentHistoryIndexRef.current--;
      const prevState = extentHistoryRef.current[currentHistoryIndexRef.current];
      isNavigatingHistoryRef.current = true;

      mapInstance.current.getView().animate({
        center: prevState.center,
        zoom: prevState.zoom,
        duration: 500,
      });

      setCanGoPrev(currentHistoryIndexRef.current > 0);
      setCanGoNext(true);
    }
  };

  const goToNextExtent = () => {
    if (currentHistoryIndexRef.current < extentHistoryRef.current.length - 1 && mapInstance.current) {
      currentHistoryIndexRef.current++;
      const nextState = extentHistoryRef.current[currentHistoryIndexRef.current];
      isNavigatingHistoryRef.current = true;

      mapInstance.current.getView().animate({
        center: nextState.center,
        zoom: nextState.zoom,
        duration: 500,
      });

      setCanGoPrev(true);
      setCanGoNext(currentHistoryIndexRef.current < extentHistoryRef.current.length - 1);
    }
  };

  const handleZoomToExtentClick = async () => {
    stopMeasurement();
    stopDrawingAnnotation();
    stopZoomBox();
    setExtentFeedback(true);
    setTimeout(() => setExtentFeedback(false), 700);
    await zoomToFullExtent();
    setActiveZoomTool(null);
  };




  const clearAllAnnotations = () => {
    modal.confirm({
      title: 'Clear All Annotations',
      content: 'Are you sure you want to clear all annotations from the map?',
      okText: 'Clear All',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk() {
        if (annotationSourceRef.current) {
          annotationSourceRef.current.clear();
        }
        setAnnotations([]);
        clearAnnotationsFromDB();
      }
    });
  };



  const applyStyleToOlLayer = (
    olLayer: any,
    styleConfig: any,
    labelsEnabled?: boolean
  ) => {
    // Get layer metadata for labels
    const layerId = Object.keys(olLayersRef.current).find(
      key => olLayersRef.current[key] === olLayer
    );
    const layerState = addedLayers.find(l => l.id === layerId);
    const shouldShowLabels = labelsEnabled !== undefined ? labelsEnabled : (layerState?.labelsEnabled ?? false);

    const hexToRgba = (hex: string, opacity: number) => {
      let c = hex.substring(1);
      if (c.length === 3) {
        c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      }
      const r = parseInt(c.substring(0, 2), 16);
      const g = parseInt(c.substring(2, 4), 16);
      const b = parseInt(c.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    };

    const getFeatureProp = (feature: any, fieldName: string) => {
      const props = feature.getProperties();
      if (!props) return undefined;
      if (props[fieldName] !== undefined) return props[fieldName];

      const lowerField = fieldName.toLowerCase();
      if (props[lowerField] !== undefined) return props[lowerField];

      const upperField = fieldName.toUpperCase();
      if (props[upperField] !== undefined) return props[upperField];

      for (const key of Object.keys(props)) {
        if (key.toLowerCase() === lowerField) {
          return props[key];
        }
      }
      return undefined;
    };

    const parseLineDash = (dashStr: string | any) => {
      if (!dashStr || typeof dashStr !== 'string') return undefined;
      const parts = dashStr.trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n) && n > 0);
      return parts.length > 0 ? parts : undefined;
    };

    const strokeConfig = {
      color: styleConfig.strokeColor || '#ff4d4f',
      width: styleConfig.strokeWidth ?? 1.5,
      lineDash: parseLineDash(styleConfig.lineDash),
    };

    const createTextStyle = (feature: any) => {
      if (!styleConfig.labelField || !shouldShowLabels) return undefined;
      const rawVal = getFeatureProp(feature, styleConfig.labelField);
      const val = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';
      if (!val) return undefined;

      return new TextStyle({
        text: val,
        font: `bold ${styleConfig.labelSize ?? 12}px Inter, sans-serif`,
        fill: new Fill({ color: styleConfig.labelColor || '#000000' }),
        stroke: new Stroke({ color: styleConfig.labelOutlineColor || '#ffffff', width: styleConfig.labelOutlineWidth ?? 2 }),
        offsetX: Number(styleConfig.labelOffsetX ?? 0),
        offsetY: Number(styleConfig.labelOffsetY ?? 0),
        textAlign: (styleConfig.labelAlign || 'center') as any,
        textBaseline: (styleConfig.labelBaseline || 'middle') as any,
        placement: styleConfig.labelRepeat === 'repeat' ? 'line' : 'point',
        repeat: styleConfig.labelRepeat === 'repeat' ? (styleConfig.labelRepeatSpacing ?? 300) : undefined,
      });
    };

    if (olLayer.prerenderListener) {
      olLayer.un('prerender', olLayer.prerenderListener);
    }
    const renderedFeatureIds = new Set<string>();
    const prerenderListener = () => {
      renderedFeatureIds.clear();
    };
    olLayer.on('prerender', prerenderListener);
    olLayer.prerenderListener = prerenderListener;

    const getSvgIconDataUri = (iconName: string, fillColor: string, fillOpacity: number, strokeColor: string, strokeWidth: number) => {
      const fillWithOpacity = hexToRgba(fillColor, fillOpacity);
      let path = '';
      if (iconName === 'marker') {
        path = `<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>`;
      } else if (iconName === 'star') {
        path = `<polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/>`;
      } else if (iconName === 'square') {
        path = `<rect x="4" y="4" width="16" height="16" rx="2"/>`;
      } else if (iconName === 'flag') {
        path = `<path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/>`;
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="${fillWithOpacity}" stroke="${strokeColor}" stroke-width="${strokeWidth}">${path}</svg>`;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    };

    const createImageStyle = (fillColor: string, fillOpacity: number, strokeColor: string, strokeWidth: number, strokeOpacity: number) => {
      const iconName = styleConfig.pointIcon || 'circle';
      if (iconName !== 'circle') {
        return new Icon({
          src: getSvgIconDataUri(
            iconName,
            fillColor,
            fillOpacity,
            strokeColor,
            strokeWidth
          ),
          scale: (styleConfig.pointSize ?? 8) / 12,
        });
      } else {
        return new CircleStyle({
          radius: styleConfig.pointSize ?? 8,
          fill: new Fill({
            color: hexToRgba(fillColor, fillOpacity),
          }),
          stroke: new Stroke({
            color: hexToRgba(strokeColor, strokeOpacity),
            width: strokeWidth,
          }),
        });
      }
    };

    const styleCache: { [key: string]: Style } = {};

    if (styleConfig.mode === 'single') {
      const singleStyle = new Style({
        stroke: new Stroke(strokeConfig),
        fill: new Fill({
          color: hexToRgba(styleConfig.fillColor || '#ff4d4f', styleConfig.fillOpacity ?? 0.1),
        }),
        image: createImageStyle(
          styleConfig.fillColor || '#ff4d4f',
          styleConfig.fillOpacity ?? 0.1,
          styleConfig.strokeColor || '#ff4d4f',
          styleConfig.strokeWidth ?? 1.5,
          styleConfig.strokeOpacity ?? 1
        ),
      });

      if (styleConfig.labelField) {
        olLayer.setStyle((feature: any) => {
          const textVal = styleConfig.labelField ? String(getFeatureProp(feature, styleConfig.labelField) ?? '') : '';
          if (!textVal) {
            return singleStyle;
          }

          if (styleConfig.labelRepeat !== 'repeat') {
            const featId = feature.getId() !== undefined ? String(feature.getId()) : textVal;
            if (renderedFeatureIds.has(featId)) {
              return singleStyle;
            }
            renderedFeatureIds.add(featId);
          }

          return new Style({
            stroke: new Stroke(strokeConfig),
            fill: new Fill({
              color: hexToRgba(styleConfig.fillColor || '#ff4d4f', styleConfig.fillOpacity ?? 0.1),
            }),
            image: createImageStyle(
              styleConfig.fillColor || '#ff4d4f',
              styleConfig.fillOpacity ?? 0.1,
              styleConfig.strokeColor || '#ff4d4f',
              styleConfig.strokeWidth ?? 1.5,
              styleConfig.strokeOpacity ?? 1
            ),
            text: createTextStyle(feature),
          });
        });
      } else {
        olLayer.setStyle(singleStyle);
      }
    } else if (styleConfig.mode === 'categorized') {
      const field = styleConfig.categorizeField;

      olLayer.setStyle((feature: any) => {
        const rawVal = getFeatureProp(feature, field);
        const val = String(rawVal ?? 'Default');
        const textVal = styleConfig.labelField ? String(getFeatureProp(feature, styleConfig.labelField) ?? '') : '';

        const baseCacheKey = `base_${val}`;
        if (!styleCache[baseCacheKey]) {
          // Generate color based on string hash
          let hash = 0;
          for (let i = 0; i < val.length; i++) {
            hash = val.charCodeAt(i) + ((hash << 5) - hash);
          }
          let hexColor = '#';
          for (let i = 0; i < 3; i++) {
            const byte = (hash >> (i * 8)) & 0xFF;
            hexColor += ('00' + byte.toString(16)).slice(-2);
          }

          styleCache[baseCacheKey] = new Style({
            stroke: new Stroke(strokeConfig),
            fill: new Fill({
              color: hexToRgba(hexColor, styleConfig.fillOpacity ?? 0.1),
            }),
            image: createImageStyle(
              hexColor,
              styleConfig.fillOpacity ?? 0.1,
              styleConfig.strokeColor || '#ff4d4f',
              styleConfig.strokeWidth ?? 1.5,
              styleConfig.strokeOpacity ?? 1
            ),
          });
        }

        if (!textVal) {
          return styleCache[baseCacheKey];
        }

        if (styleConfig.labelRepeat !== 'repeat') {
          const featId = feature.getId() !== undefined ? String(feature.getId()) : textVal;
          if (renderedFeatureIds.has(featId)) {
            return styleCache[baseCacheKey];
          }
          renderedFeatureIds.add(featId);
        }

        const cacheKey = `${val}_${textVal}`;
        if (!styleCache[cacheKey]) {
          styleCache[cacheKey] = new Style({
            stroke: new Stroke(strokeConfig),
            fill: new Fill({
              color: (styleCache[baseCacheKey].getFill()?.getColor() as string),
            }),
            image: createImageStyle(
              val === 'Default' ? '#ff4d4f' : baseCacheKey, // Will fallback to actual hexColor computed above
              styleConfig.fillOpacity ?? 0.1,
              styleConfig.strokeColor || '#ff4d4f',
              styleConfig.strokeWidth ?? 1.5,
              styleConfig.strokeOpacity ?? 1
            ),
            text: createTextStyle(feature),
          });
          // Fix standard dynamic color rendering inside cached images
          let hash = 0;
          for (let i = 0; i < val.length; i++) {
            hash = val.charCodeAt(i) + ((hash << 5) - hash);
          }
          let hexColor = '#';
          for (let i = 0; i < 3; i++) {
            const byte = (hash >> (i * 8)) & 0xFF;
            hexColor += ('00' + byte.toString(16)).slice(-2);
          }
          styleCache[cacheKey] = new Style({
            stroke: new Stroke(strokeConfig),
            fill: new Fill({
              color: hexToRgba(hexColor, styleConfig.fillOpacity ?? 0.1),
            }),
            image: createImageStyle(
              hexColor,
              styleConfig.fillOpacity ?? 0.1,
              styleConfig.strokeColor || '#ff4d4f',
              styleConfig.strokeWidth ?? 1.5,
              styleConfig.strokeOpacity ?? 1
            ),
            text: createTextStyle(feature),
          });
        }
        return styleCache[cacheKey];
      });
    } else if (styleConfig.mode === 'graduated') {
      const field = styleConfig.graduatedField;
      const minVal = styleConfig.graduatedMinVal ?? 0;
      const maxVal = styleConfig.graduatedMaxVal ?? 100;
      const colorStart = styleConfig.graduatedColorStart || '#fee8c8';
      const colorEnd = styleConfig.graduatedColorEnd || '#e34a33';

      // Parse colors
      const parseHex = (hex: string) => {
        let c = hex.substring(1);
        if (c.length === 3) {
          c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        }
        return [
          parseInt(c.substring(0, 2), 16),
          parseInt(c.substring(2, 4), 16),
          parseInt(c.substring(4, 6), 16)
        ];
      };

      const rgbStart = parseHex(colorStart);
      const rgbEnd = parseHex(colorEnd);

      olLayer.setStyle((feature: any) => {
        const rawVal = parseFloat(getFeatureProp(feature, field));
        const val = isNaN(rawVal) ? minVal : rawVal;
        const textVal = styleConfig.labelField ? String(getFeatureProp(feature, styleConfig.labelField) ?? '') : '';

        // Normalize val between min and max
        const range = maxVal - minVal;
        const pct = range === 0 ? 0 : Math.max(0, Math.min(1, (val - minVal) / range));

        // Interpolate color
        const r = Math.round(rgbStart[0] + pct * (rgbEnd[0] - rgbStart[0]));
        const g = Math.round(rgbStart[1] + pct * (rgbEnd[1] - rgbStart[1]));
        const b = Math.round(rgbStart[2] + pct * (rgbEnd[2] - rgbStart[2]));
        const hexColor = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;

        const baseCacheKey = `base_${hexColor}`;
        if (!styleCache[baseCacheKey]) {
          styleCache[baseCacheKey] = new Style({
            stroke: new Stroke(strokeConfig),
            fill: new Fill({
              color: hexToRgba(hexColor, styleConfig.fillOpacity ?? 0.1),
            }),
            image: createImageStyle(
              hexColor,
              styleConfig.fillOpacity ?? 0.1,
              styleConfig.strokeColor || '#ff4d4f',
              styleConfig.strokeWidth ?? 1.5,
              styleConfig.strokeOpacity ?? 1
            ),
          });
        }

        if (!textVal) {
          return styleCache[baseCacheKey];
        }

        if (styleConfig.labelRepeat !== 'repeat') {
          const featId = feature.getId() !== undefined ? String(feature.getId()) : textVal;
          if (renderedFeatureIds.has(featId)) {
            return styleCache[baseCacheKey];
          }
          renderedFeatureIds.add(featId);
        }

        const cacheKey = `${hexColor}_${textVal}`;
        if (!styleCache[cacheKey]) {
          styleCache[cacheKey] = new Style({
            stroke: new Stroke(strokeConfig),
            fill: new Fill({
              color: hexToRgba(hexColor, styleConfig.fillOpacity ?? 0.1),
            }),
            image: createImageStyle(
              hexColor,
              styleConfig.fillOpacity ?? 0.1,
              styleConfig.strokeColor || '#ff4d4f',
              styleConfig.strokeWidth ?? 1.5,
              styleConfig.strokeOpacity ?? 1
            ),
            text: createTextStyle(feature),
          });
        }
        return styleCache[cacheKey];
      });
    }
  };

  const applyVectorLayerStyle = (
    layerId: string,
    styleName: string
  ) => {
    const olLayer = olLayersRef.current[layerId];
    if (olLayer) {
      const source = olLayer.getSource();
      if (source && typeof (source as any).updateParams === 'function') {
        (source as any).updateParams({ 'STYLES': styleName });
      }
    }
  };

  const handleOpenStyleEditor = async (layer: any) => {
    let schema = {};
    try {
      const response = await apiRequest(`/datasets/${layer.id}/`);
      if (response.ok) {
        const data = await response.json();
        schema = data.metadata?.attributes_schema || {};
        setSelectedLayerSchema(schema);
        setSelectedLayerGeomType(data.metadata?.geometry_type || null);
      }
    } catch (err) {
      console.error('Failed to load schema for layer styling:', err);
    }

    let layerStyleData = vectorLayerStyles[layer.id];

    // Migrate if needed
    if (!layerStyleData || !layerStyleData.styles) {
      layerStyleData = migrateStyleConfig(layerStyleData);
      setVectorLayerStyles(prev => ({
        ...prev,
        [layer.id]: layerStyleData
      }));
    }

    setSelectedStyleLayer(layer);
    setLeftPanelMode('style');
    setIsLeftPanelOpen(true);
    setActivePanel(null);
    stopMeasurement();
    stopDrawingAnnotation();

    if (layer.type === 'VECTOR') {
      // Auto-populate active fields if empty
      const fields = Object.keys(schema);
      if (fields.length > 0) {
        const activeConfig = getActiveStyleConfig(layer.id) || {} as StyleConfig;
        const updatedConfig = { ...activeConfig };

        if (!updatedConfig.categorizeField) {
          updatedConfig.categorizeField = fields[0];
        }

        const numericTypes = ['integer', 'double', 'float', 'real', 'numeric', 'bigint', 'decimal'];
        const numericFields = fields.filter(f =>
          numericTypes.some(t => (schema as any)[f]?.toLowerCase().includes(t))
        );
        if (!updatedConfig.graduatedField) {
          updatedConfig.graduatedField = numericFields.length > 0 ? numericFields[0] : fields[0];
        }

        // Update the active style with new fields
        setVectorLayerStyles(prev => {
          const existing = prev[layer.id];
          return {
            ...prev,
            [layer.id]: {
              ...existing,
              styles: existing.styles.map(style =>
                style.id === existing.activeStyleId
                  ? { ...style, config: updatedConfig }
                  : style
              )
            }
          };
        });
      }
    }
  };

  const toggleInfoActive = () => {
    if (isLeftPanelOpen && leftPanelMode === 'info') {
      setIsLeftPanelOpen(false);
      setInfoData([]);
    } else {
      setLeftPanelMode('info');
      setIsLeftPanelOpen(true);
      if (activePanel !== 'gotoXY') {
        setActivePanel(null);
      }
      stopMeasurement();
      stopDrawingAnnotation();
    }
  };

  // Map click listener for Info Popup
  useEffect(() => {
    if (!mapInstance.current) return;

    const map = mapInstance.current;

    const handleMapClick = async (evt: any) => {
      if (activePanel === 'measurement' || activePanel === 'annotation' || queryDrawRef.current || wpsDrawingActive) return;

      const coord = toLonLat(evt.coordinate);
      const lon = coord[0];
      const lat = coord[1];

      if (isMobile) {
        updateCoordinatesText(lon, lat);
        setEditLon(lon.toFixed(6));
        setEditLat(lat.toFixed(6));
      }

      // 1. Query client-side vector features
      const featuresList: { feature: any; layer: any }[] = [];
      map.forEachFeatureAtPixel(evt.pixel, (feature, layer) => {
        const id = feature.getId()?.toString() || '';
        if (!id.startsWith('measure_') && !id.startsWith('annotation_')) {
          featuresList.push({ feature, layer });
        }
      });

      const parsedFeatures = featuresList.map(({ feature, layer }, index) => {
        const props = feature.getProperties();
        const tableRows = Object.entries(props)
          .filter(([key]) => key !== 'geometry' && key !== 'layer')
          .map(([key, val]: [string, any]) => ({
            key,
            attribute: key,
            value: typeof val === 'object' ? JSON.stringify(val) : String(val)
          }));

        const layerName = layer?.get?.('name') || '';
        const nameAttr = props.name || props.title || props.id || feature.getId() || `Feature #${index + 1}`;
        const titleStr = layerName ? `${layerName} - ${nameAttr}` : String(nameAttr);

        return {
          id: feature.getId()?.toString() || `f_${index}_${Date.now()}`,
          title: titleStr,
          rows: tableRows
        };
      });

      // 2. Query visible WMS layers using GetFeatureInfo
      const wmsInfos: any[] = [];
      const visibleWmsLayers = addedLayers.filter(l => l.visible);

      const view = map.getView();
      const viewResolution = view.getResolution();
      const projection = view.getProjection();
      const mapCRS = projection.getCode() || 'EPSG:3857';

      let wmsSampleCoord: [number, number] | null = null;

      const wmsPromises = visibleWmsLayers.map(async (layer) => {
        const olLayer = olLayersRef.current[layer.id];
        if (olLayer && olLayer instanceof TileLayer) {
          const source = olLayer.getSource();
          if (source && typeof (source as any).getFeatureInfoUrl === 'function') {
            const url = (source as any).getFeatureInfoUrl(
              evt.coordinate,
              viewResolution,
              projection,
              {
                'INFO_FORMAT': 'application/json',
                'FEATURE_COUNT': '5'
              }
            );

            if (url) {
              // Extract exact GeoServer server-side pixel sampling coordinate from WMS Tile parameters
              if (!wmsSampleCoord) {
                try {
                  const parsedUrl = new URL(url);
                  const bboxParam = parsedUrl.searchParams.get('BBOX');
                  const widthParam = Number(parsedUrl.searchParams.get('WIDTH')) || 256;
                  const heightParam = Number(parsedUrl.searchParams.get('HEIGHT')) || 256;
                  const xParam = Number(parsedUrl.searchParams.get('X') || parsedUrl.searchParams.get('I'));
                  const yParam = Number(parsedUrl.searchParams.get('Y') || parsedUrl.searchParams.get('J'));

                  if (bboxParam && !isNaN(xParam) && !isNaN(yParam)) {
                    const parts = bboxParam.split(',').map(Number);
                    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
                      const sx = parts[0] + (xParam + 0.5) * ((parts[2] - parts[0]) / widthParam);
                      const sy = parts[3] - (yParam + 0.5) * ((parts[3] - parts[1]) / heightParam);
                      wmsSampleCoord = [sx, sy];
                    }
                  }
                } catch {
                  // ignore
                }
              }

              try {
                const headers: Record<string, string> = {};
                if (user?.geoserverAuth) {
                  headers['Authorization'] = user.geoserverAuth;
                }
                const res = await fetch(url, { headers });
                if (res.ok) {
                  const contentType = res.headers.get('content-type') || '';
                  if (contentType.includes('application/json') || contentType.includes('text/json')) {
                    const data = await res.json();
                    if (data && data.features && data.features.length > 0) {
                      data.features.forEach((feature: any, idx: number) => {
                        const props = feature.properties || {};
                        const rows = Object.entries(props).map(([key, val]: [string, any]) => ({
                          key,
                          attribute: key,
                          value: typeof val === 'object' ? JSON.stringify(val) : String(val)
                        }));

                        const nameAttr = props.name || props.title || props.id || feature.id || `Feature #${idx + 1}`;
                        wmsInfos.push({
                          id: feature.id || `wms_${layer.id}_${idx}_${Date.now()}`,
                          title: `${layer.name} - ${nameAttr}`,
                          rows
                        });
                      });
                    }
                  } else {
                    const textVal = await res.text();
                    console.warn(`WMS layer ${layer.name} GetFeatureInfo returned non-JSON response:`, textVal.substring(0, 200));
                  }
                }
              } catch (err) {
                console.error(`Error fetching GetFeatureInfo for WMS layer ${layer.name}:`, err);
              }
            }
          }
        }
      });

      await Promise.all(wmsPromises);

      // 3. Query visible on-the-fly raster layers (in-memory GeoTIFF buffer / ImageLayer)
      const rasterInfos: any[] = [];
      const visibleRasterLayers = addedLayers.filter(l => l.visible && l.type === 'RASTER');

      // Use the exact sample coordinate that matches GeoServer WMS tile evaluation when available
      const sampleCoord: [number, number] = wmsSampleCoord || (evt.coordinate as [number, number]);

      for (const layer of visibleRasterLayers) {
        let buffer = layer.rawBuffer;
        if (!buffer && layer.imageBlob) {
          try {
            buffer = await layer.imageBlob.arrayBuffer();
            layer.rawBuffer = buffer; // Cache for future clicks
          } catch {
            // ignore
          }
        }

        if (buffer) {
          try {
            const sampleBbox: [number, number, number, number] =
              (layer.bbox && Array.isArray(layer.bbox) && layer.bbox.length === 4)
                ? [layer.bbox[0], layer.bbox[1], layer.bbox[2], layer.bbox[3]]
                : [-180, -90, 180, 90];

            const sample = await sampleRasterPixel(
              buffer,
              sampleBbox,
              sampleCoord,
              layer.name || 'Raster Result Layer',
              layer.nativeCRS || 'EPSG:4326',
              mapCRS
            );

            if (sample && sample.bands && sample.bands.length > 0) {
              const rows: Array<{ key: string; attribute: string; value: string }> = [];

              sample.bands.forEach(b => {
                rows.push({
                  key: `band_${b.bandIndex}`,
                  attribute: b.name,
                  value: String(b.value)
                });
              });

              rasterInfos.push({
                id: `raster_${layer.id}_${Date.now()}`,
                title: layer.name,
                rows
              });
            }
          } catch (sampleErr) {
            console.warn(`Failed to sample raster pixel for layer ${layer.name}:`, sampleErr);
          }
        }
      }

      const allResults = [...parsedFeatures, ...rasterInfos, ...wmsInfos];
      setInfoData(allResults);
      if (allResults.length > 0) {
        if (activePanel === 'gotoXY') {
          // Do not close the go to xy panel and also do not open the features details panel.
          // The results are populated in infoData so they can be viewed via the info button.
        } else {
          setLeftPanelMode('info');
          setIsLeftPanelOpen(true);
          setActivePanel(null); // Close right floating overlays so there's no conflict
        }
      }
    };

    map.on('click', handleMapClick);

    const viewport = map.getViewport();
    if (viewport) {
      viewport.style.cursor = 'help'; // Keep cursor as help so the user knows clicking queries features
    }

    return () => {
      map.un('click', handleMapClick);
      if (viewport) {
        viewport.style.cursor = 'default';
      }
    };
  }, [addedLayers, gisAccessToken, token, activePanel, wpsDrawingActive, isMobile, user?.geoserverAuth]);

  // Cleanup measurement, annotation, and query drawing on panel change
  useEffect(() => {
    queueMicrotask(() => {
      if (activePanel !== 'measurement') {
        stopMeasurement();
      }
      if (activePanel !== 'annotation') {
        stopDrawingAnnotation();
      }
      stopQueryDraw();
      if (activePanel !== 'wps-analysis') {
        if (wpsDrawSourceRef.current) {
          wpsDrawSourceRef.current.clear();
        }
        handleWpsStopDrawGeom();
      }
      if (activePanel && activePanel !== 'gotoXY') {
        setIsLeftPanelOpen(false);
        setInfoData([]);
        setSelectedAnalysisWorkflow(null);
      }
    });
  }, [activePanel]);



  const basemapsList = [...basemapsConfig, ...customBasemaps];



  const filteredBasemaps = basemapsList.filter(bm => {
    const cleanSearch = basemapSearch.trim().toLowerCase();
    return bm.name.toLowerCase().includes(cleanSearch) ||
      (bm.desc && bm.desc.toLowerCase().includes(cleanSearch));
  });




  const scaleItems = [
    { key: '2500', label: '1 : 2,500', onClick: () => setScale(2500) },
    { key: '25000', label: '1 : 25,000', onClick: () => setScale(25000) },
    { key: '250000', label: '1 : 250,000', onClick: () => setScale(250000) },
    { key: '2500000', label: '1 : 2,500,000', onClick: () => setScale(2500000) },
    { key: '25000000', label: '1 : 25,000,000', onClick: () => setScale(25000000) },
    {
      key: 'custom',
      label: 'Custom Scale...',
      onClick: () => {
        setIsEditingScaleText(true);
        const currentNum = scaleText.replace(/[^\d]/g, '').slice(1);
        setEditScaleVal(currentNum);
      }
    }
  ];

  if (loading || !hydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Launching 2D Map Workspace..." />
      </div>
    );
  }

  const filteredModalDatasets = datasetsList.filter((d: any) => {
    const cleanSearch = modalSearchText.trim().toLowerCase();
    const matchesSearch = d.name.toLowerCase().includes(cleanSearch) ||
      d.id.toLowerCase().includes(cleanSearch);
    const matchesType = modalTypeFilter === 'ALL' || d.data_type === modalTypeFilter;

    // If the map is PUBLIC, restrict the list to PUBLIC datasets only
    const isPublicMap = mapDetail?.share === 'PUBLIC';
    const matchesAccess = !isPublicMap || d.access_level === 'PUBLIC';

    return matchesSearch && matchesType && matchesAccess;
  });

  // Zoom to selected features from Attribute Table
  const handleZoomToFeaturesFromTable = async ({ bbox, featureIds }: ZoomToFeaturesPayload) => {
    if (!mapInstance.current || !bbox || bbox.length !== 4) return;

    try {
      // bbox is [minLon, minLat, maxLon, maxLat] in EPSG:4326
      const transformedExtent = [
        ...fromLonLat([bbox[0], bbox[1]]),
        ...fromLonLat([bbox[2], bbox[3]]),
      ];

      mapInstance.current.getView().fit(transformedExtent, {
        padding: [50, 50, 50, 50],
        duration: 1000,
      });

      try {
        await highlightFeaturesFromTable(attributeTableDataset?.id || '', featureIds);
      } catch (highlightErr: any) {
        // Fail silently — WMS layers do not support direct client-side highlighting
        console.warn('Zoom completed, but features could not be highlighted:', highlightErr);
      }
    } catch (err: any) {
      notification.error({
        message: 'Zoom Error',
        description: err.message || 'Could not zoom to selected features',
        placement: 'topRight',
      });
    }
  };

  // Get visible feature IDs by querying backend with current viewport bbox
  const getVisibleFeatureIds = async (): Promise<string[]> => {
    if (!mapInstance.current || !attributeTableDataset) return [];

    try {
      // Get the current map extent in EPSG:3857 (Web Mercator)
      const extent = mapInstance.current.getView().calculateExtent(mapInstance.current.getSize());

      // Convert extent to EPSG:4326 (lat/lon) for backend
      const bottomLeft = toLonLat([extent[0], extent[1]]);
      const topRight = toLonLat([extent[2], extent[3]]);

      // Build bbox parameter: minLon,minLat,maxLon,maxLat
      const bbox = `${bottomLeft[0]},${bottomLeft[1]},${topRight[0]},${topRight[1]}`;

      // Query backend for features within this bounding box (PostGIS does spatial filtering)
      const response = await apiRequest(
        `/datasets/${attributeTableDataset.id}/features/?bbox=${bbox}&page_size=10000`
      );

      if (!response.ok) {
        console.error('Failed to fetch features in viewport extent');
        return [];
      }

      const data = await response.json();
      const features = data.data || [];

      // Extract feature IDs
      const featureIds = features.map((feature: any) => {
        return String(feature.ogc_fid || feature.fid || feature.id);
      }).filter((id: string) => id);

      return Array.from(new Set<string>(featureIds));
    } catch (err) {
      console.error('Error getting visible features from viewport extent:', err);
      return [];
    }
  };

  const getLocalFeaturesForTable = () => {
    if (!attributeTableDataset || !attributeTableDataset.id.startsWith('wps_result_')) {
      return undefined;
    }
    const olLayer = olLayersRef.current[attributeTableDataset.id];
    if (!olLayer) return undefined;

    const source = olLayer.getSource();
    if (!source) return undefined;

    const features = source.getFeatures();
    const geojsonFormat = new GeoJSON();
    return features.map((f: any) => geojsonFormat.writeFeatureObject(f, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    }));
  };

  const handleWpsStartDrawGeom = (geomType: 'Point' | 'LineString' | 'Polygon' | 'Box', callback: (geojson: any) => void, paramId?: string) => {
    if (!mapInstance.current) return;

    // Stop any active drawings
    stopMeasurement();
    stopDrawingAnnotation();
    stopQueryDraw();
    handleWpsStopDrawGeom();

    setWpsDrawingActive(true);
    wpsDrawCallbackRef.current = callback;

    const src = ensureDrawLayer(
      wpsDrawSourceRef,
      wpsDrawLayerRef,
      '#10b981', // green theme for wps drawing
      1005
    );

    // Only clear features that match this paramId (if paramId is provided), keeping other parameters' shapes visible
    if (paramId) {
      const existingFeatures = src.getFeatures();
      existingFeatures.forEach(f => {
        if (f.get('wpsParamId') === paramId) {
          src.removeFeature(f);
        }
      });
    } else {
      src.clear();
    }

    const isBox = (geomType as string) === 'Box';
    const draw = new Draw({
      source: src,
      type: (isBox ? 'Circle' : geomType) as any,
      geometryFunction: isBox ? createBox() : undefined
    });
    queryDrawRef.current = draw; // Reuse the queryDrawRef cleanup container

    const viewport = mapInstance.current.getViewport();
    if (viewport) viewport.style.cursor = 'crosshair';

    draw.on('drawend', (evt) => {
      const geom = evt.feature.getGeometry();
      if (!geom) return;

      // Tag the feature with the parameter ID so we can track and selectively clear it
      if (paramId) {
        evt.feature.set('wpsParamId', paramId);
      }

      const geojsonFormat = new GeoJSON();
      const geojsonGeom = geojsonFormat.writeGeometryObject(geom, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });

      // Construct FeatureCollection wrapper
      const featureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: geojsonGeom,
          properties: {}
        }]
      };

      if (wpsDrawCallbackRef.current) {
        wpsDrawCallbackRef.current(featureCollection);
      }

      // Automatically clean up draw interaction
      setTimeout(() => {
        handleWpsStopDrawGeom();
      }, 100);
    });

    mapInstance.current.addInteraction(draw);
  };

  function handleWpsStopDrawGeom() {
    setWpsDrawingActive(false);
    wpsDrawCallbackRef.current = null;
    if (mapInstance.current && queryDrawRef.current) {
      mapInstance.current.removeInteraction(queryDrawRef.current);
      queryDrawRef.current = null;
    }
    const viewport = mapInstance.current?.getViewport();
    if (viewport) viewport.style.cursor = 'default';
  }



  const handleCloseAttributeTable = () => {
    setAttributeTableOpen(false);
    setAttributeTableDataset(null);
  };

  const handleShowSelectedOnlyChange = (selectedIds: string[] | null) => {
    if (!selectedIds || selectedIds.length === 0) {
      clearFeatureHighlight();
    }
    if (!attributeTableDataset) return;
    const olLayer = olLayersRef.current[attributeTableDataset.id];
    if (olLayer && typeof olLayer.getSource === 'function') {
      const source = olLayer.getSource();
      if (source && typeof source.updateParams === 'function') {
        if (selectedIds && selectedIds.length > 0) {
          const isWfsFeatureId = selectedIds[0].includes('.');
          if (isWfsFeatureId) {
            const cappedIds = selectedIds.slice(0, 5000);
            source.updateParams({
              'cql_filter': undefined,
              'CQL_FILTER': undefined,
              'featureid': cappedIds.join(',')
            });
          } else {
            const idsList = selectedIds.map(id => `'${id}'`).join(',');
            source.updateParams({
              'featureid': undefined,
              'cql_filter': `IN (${idsList})`
            });
          }
        } else {
          // Restore the Query Builder filters if active
          const queryCql = attributeTableFilterCqls[attributeTableDataset.id];
          if (queryCql) {
            source.updateParams({
              'featureid': undefined,
              'cql_filter': queryCql
            });
          } else {
            const queryIds = attributeTableFilterIds[attributeTableDataset.id];
            if (queryIds && queryIds.length > 0) {
              const isWfsFeatureId = queryIds[0].includes('.');
              if (isWfsFeatureId) {
                const cappedIds = queryIds.slice(0, 5000);
                source.updateParams({
                  'cql_filter': undefined,
                  'CQL_FILTER': undefined,
                  'featureid': cappedIds.join(',')
                });
              } else {
                const idsList = queryIds.map(id => `'${id}'`).join(',');
                source.updateParams({
                  'featureid': undefined,
                  'cql_filter': `IN (${idsList})`
                });
              }
            } else {
              source.updateParams({
                'featureid': undefined,
                'cql_filter': undefined
              });
            }
          }
        }
      }
    }
  };

  const isDrawing = !!measurementType || !!annotationType || isQueryDrawing || wpsDrawingActive;

  const renderRotationPopoverContent = () => (
    <div className="w-56 p-2.5 flex flex-col gap-2.5 select-none" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between pb-1.5 border-b border-gray-150">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-50 text-primary flex items-center justify-center font-bold">
            <Compass
              size={15}
              style={{ transform: `rotate(${rotationDeg}deg)` }}
              className="transition-transform duration-100"
            />
          </div>
          <span className="text-xs font-bold text-gray-800">Rotate Map</span>
        </div>
        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-primary border border-blue-200">
          {Math.round(rotationDeg)}°
        </span>
      </div>

      {/* Slider */}
      <div className="px-1 pt-1">
        <div className="flex justify-between text-[10px] text-gray-400 font-medium mb-1">
          <span>0° (N)</span>
          <span>180°</span>
          <span>360°</span>
        </div>
        <Slider
          min={0}
          max={360}
          step={1}
          value={Math.round(rotationDeg)}
          onChange={handleRotateChange}
          tooltip={{ formatter: (val) => `${val}°` }}
          className="!m-0"
        />
      </div>

      {/* Reset North Button below Slider */}
      <Button
        type={rotationDeg !== 0 ? 'primary' : 'default'}
        size="small"
        icon={<Compass size={14} style={{ transform: `rotate(${rotationDeg}deg)` }} className="transition-transform duration-150" />}
        onClick={() => handleRotateAnimate(0)}
        disabled={rotationDeg === 0}
        className="w-full text-xs font-medium flex items-center justify-center gap-1.5 h-7 mt-0.5"
      >
        Reset North (0°)
      </Button>
    </div>
  );

  return (
    <div className="h-screen h-[100dvh] w-screen w-[100dvw] flex flex-col overflow-hidden bg-gray-50">
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @media (min-width: 768px) {
          .md\\:animate-slide-right {
            animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .md\\:animate-slide-left {
            animation: slideInLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .md\\:animate-none {
            animation: none;
          }
        }
      `}} />
      {/* Horizontal Navbar */}
      <header className="h-14 md:h-16 bg-white border-b border-gray-100 flex items-center justify-between px-3 md:px-6 z-30 shadow-sm shrink-0">
        {/* Left Section: Logo & Title */}
        <div className="flex items-center gap-2 md:gap-3.5 min-w-0">
          <div
            onClick={() => {
              if (!(isPublicMap && !token)) {
                router.push('/overview');
              }
            }}
            className={`flex items-center gap-2 sm:gap-2.5 min-w-fit shrink-0 ${!(isPublicMap && !token) ? 'cursor-pointer hover:opacity-85' : 'cursor-default'} transition-opacity`}
          >
            {/* Primary Logo (VistaBridge) */}
            {siteConfig.logo && (
              <img
                src={siteConfig.logo}
                alt="VistaBridge Logo"
                className="h-6 md:h-8 w-auto object-contain flex shrink-0"
              />
            )}

            {/* Custom Product Logo (shown next to the VistaBridge logo if present) */}
            {customLogo && (
              <>
                <div className="h-4 sm:h-5 w-[1px] bg-gray-200" />
                <img
                  src={customLogo}
                  alt="Custom Product Logo"
                  className="h-6 md:h-8 max-w-[80px] sm:max-w-[110px] object-contain flex shrink-0 rounded"
                />
              </>
            )}
          </div>

          <Divider type="vertical" className="h-5 sm:h-6 bg-gray-200 !m-0 shrink-0" />
          <div className="flex items-center gap-1 md:gap-2 min-w-0">
            <Title level={5} className="!m-0 truncate font-extrabold text-gray-800 leading-tight" style={isMobile ? { fontSize: '13px', margin: 0 } : { margin: 0 }}>
              {mapDetail?.name || 'Untitled 2D Map'}
            </Title>
            {!(isPublicMap && !token) && !isMobile && (
              <Tooltip title="Edit Map Details">
                <Button
                  type="text"
                  size="small"
                  icon={<Edit2 size={14} className="text-gray-400 hover:text-gray-600 transition-colors" />}
                  onClick={() => {
                    setNewName(mapDetail?.name || 'Untitled 2D Map');
                    setNewDescription(mapDetail?.description || '');
                    setRenameModalOpen(true);
                  }}
                  className="flex items-center justify-center rounded-md"
                  style={{ width: 28, height: 28 }}
                />
              </Tooltip>
            )}
          </div>
        </div>

        {/* Right Section: Action Buttons */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          {mapDetail?.share && !isMobile && (
            <Tag
              color={
                mapDetail.share === 'PUBLIC' ? 'green' :
                  mapDetail.share === 'INTERNAL' ? 'blue' : 'orange'
              }
              className="text-[10px] font-bold uppercase tracking-wider rounded px-2.5 py-0.5 border-none mr-1.5"
            >
              {mapDetail.share}
            </Tag>
          )}
          {!(isPublicMap && !token) && (
            <Tooltip title="Share Map">
              <Button
                type="text"
                icon={<Share2 size={isMobile ? 16 : 18} className="text-gray-500 hover:text-primary transition-colors" />}
                onClick={() => {
                  if (!mapDetail) {
                    notification.warning({
                      message: 'Map Not Saved',
                      description: 'Please save the map workspace first before sharing.',
                      placement: 'topRight'
                    });
                    return;
                  }
                  setIsShareModalOpen(true);
                }}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: isMobile ? 32 : 40, height: isMobile ? 32 : 40 }}
              />
            </Tooltip>
          )}
          {!(isPublicMap && !token) && (
            <Tooltip title="Save Map">
              <Button
                type="text"
                icon={<Save size={isMobile ? 16 : 18} className="text-gray-500 hover:text-primary transition-colors" />}
                onClick={handleSaveMapWorkspace}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: isMobile ? 32 : 40, height: isMobile ? 32 : 40 }}
              />
            </Tooltip>
          )}
          <PrintComponent mapInstance={mapInstance.current} addedLayers={addedLayers} />
          {!isMobile && <Divider type="vertical" className="h-6 bg-gray-100 !m-0" />}
          {!(isPublicMap && !token) && (
            <Tooltip title="Back to Manage Maps">
              <Button
                type="text"
                icon={<ArrowLeft size={isMobile ? 16 : 18} className="text-gray-500 hover:text-primary transition-colors" />}
                onClick={() => router.push('/map/manage')}
                className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
                style={{ width: isMobile ? 32 : 40, height: isMobile ? 32 : 40 }}
              />
            </Tooltip>
          )}
        </div>
      </header>


      {/* Main Workspace Area: Left Bar + Map + Right Bar */}
      <div className="flex-grow w-full flex overflow-hidden relative">
        {/* Left vertical bar */}
        <div className="hidden md:flex w-14 bg-white border-r border-gray-100 flex-col items-center py-4 gap-4 z-10 shadow-sm shrink-0">
          <Tooltip title="Zoom In" placement="right">
            <Button
              type="text"
              icon={<Plus size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => {
                const view = mapInstance.current?.getView();
                if (view) {
                  const z = view.getZoom();
                  if (z !== undefined) {
                    view.animate({ zoom: z + 1, duration: 400 });
                  }
                }
              }}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Zoom Out" placement="right">
            <Button
              type="text"
              icon={<Minus size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => {
                const view = mapInstance.current?.getView();
                if (view) {
                  const z = view.getZoom();
                  if (z !== undefined) {
                    view.animate({ zoom: z - 1, duration: 400 });
                  }
                }
              }}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Toggle Full Screen" placement="right">
            <Button
              type="text"
              icon={<Maximize size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => { });
                } else {
                  document.exitFullscreen().catch(() => { });
                }
              }}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Popover
            content={renderRotationPopoverContent()}
            trigger={['click']}
            placement="right"
            overlayInnerStyle={{ padding: 6 }}
          >
            <div className="relative">
              <Button
                type="text"
                title="Rotate Map"
                icon={
                  <Compass
                    size={20}
                    className={`transition-all duration-150 ${rotationDeg !== 0 ? 'text-primary' : 'text-gray-500 hover:text-primary'}`}
                    style={{ transform: `rotate(${rotationDeg}deg)` }}
                  />
                }
                className={`flex items-center justify-center hover:bg-gray-50 rounded-xl relative ${
                  rotationDeg !== 0 ? 'bg-blue-50/60' : ''
                }`}
                style={{ width: 42, height: 42 }}
              />
              {rotationDeg !== 0 && (
                <span className="absolute -top-1 -right-1 px-1 bg-primary text-white text-[8px] font-bold rounded-full pointer-events-none">
                  {Math.round(rotationDeg)}°
                </span>
              )}
            </div>
          </Popover>
          <Tooltip title="Zoom to Current Location" placement="right">
            <Button
              type="text"
              icon={<Navigation size={20} className="text-gray-500 hover:text-primary transition-colors" />}
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (position) => {
                      const { longitude, latitude } = position.coords;
                      const view = mapInstance.current?.getView();
                      if (view) {
                        view.animate({
                          center: fromLonLat([longitude, latitude]),
                          zoom: 17,
                          duration: 800
                        });
                        notification.success({
                          title: 'Location Found',
                          message: 'Location Found',
                          description: `Zoomed to precise location (Lng: ${longitude.toFixed(4)}, Lat: ${latitude.toFixed(4)})`,
                          placement: 'topRight'
                        });
                      }
                    },
                    (error) => {
                      console.warn(`GPS geolocation failed. Code: ${error.code}, Message: ${error.message}`);

                      if (error.code === 1) { // PERMISSION_DENIED
                        notification.warning({
                          title: 'Location Permission Denied',
                          message: 'Location Permission Denied',
                          description: 'User denied location',
                          placement: 'topRight',
                          duration: 4
                        });
                      } else if (error.code === 2) { // POSITION_UNAVAILABLE
                        notification.warning({
                          title: 'Position Unavailable',
                          message: 'Position Unavailable',
                          description: 'Unable to determine GPS location.',
                          placement: 'topRight',
                          duration: 5
                        });
                      } else if (error.code === 3) { // TIMEOUT
                        notification.warning({
                          title: 'Location Timeout',
                          message: 'Location Timeout',
                          description: 'GPS request timed out.',
                          placement: 'topRight',
                          duration: 5
                        });
                      }
                    },
                    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
                  );
                } else {
                  notification.error({
                    title: 'Geolocation Unsupported',
                    message: 'Geolocation Unsupported',
                    description: 'Your browser does not support geolocation.',
                    placement: 'topRight'
                  });
                }
              }}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>

          {/* Full Extent */}
          <Tooltip title="Full Extent" placement="right">
            <Button
              type="text"
              icon={<Expand size={20} className={`transition-colors ${extentFeedback ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={handleZoomToExtentClick}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>

          {/* Previous Extent */}
          <Tooltip title="Previous Extent" placement="right">
            <Button
              type="text"
              disabled={!canGoPrev}
              icon={<ArrowLeft size={20} className="transition-colors" />}
              onClick={goToPreviousExtent}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl disabled:opacity-40 disabled:hover:bg-transparent"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>

          {/* Next Extent */}
          <Tooltip title="Next Extent" placement="right">
            <Button
              type="text"
              disabled={!canGoNext}
              icon={<ArrowRight size={20} className="transition-colors" />}
              onClick={goToNextExtent}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl disabled:opacity-40 disabled:hover:bg-transparent"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>

          {/* Toggle Info Popup */}
          <Tooltip title="Toggle Info Popup" placement="right">
            <Button
              type="text"
              icon={
                (isLeftPanelOpen && leftPanelMode === 'info') ? (
                  <X size={20} className="text-primary transition-colors animate-in spin duration-300" />
                ) : (
                  <Info size={20} className="text-gray-500 hover:text-primary transition-colors" />
                )
              }
              onClick={toggleInfoActive}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
        </div>

        {/* Left panel (for Info Popup results / Vector Styling) */}
        {isLeftPanelOpen && (
          <div className="absolute md:relative left-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-r border-gray-150 shadow-2xl md:shadow-lg z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-left transition-all duration-300" style={{ display: isMobile && isDrawing ? 'none' : 'flex' }}>
            {isMobile && (
              <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
            )}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              {leftPanelMode === 'info' ? (
                <span className="font-bold text-gray-800 uppercase tracking-wider text-xs flex items-center gap-1.5">
                  <Info size={14} className="text-primary" /> Feature Information
                </span>
              ) : (
                <span className="font-bold text-gray-800 uppercase tracking-wider text-xs flex items-center gap-1.5">
                  <Palette size={14} className="text-primary" /> {selectedStyleLayer?.type === 'RASTER' ? 'Raster Style' : 'Vector Style'}
                </span>
              )}
              <Button
                type="text"
                size="small"
                icon={<X size={14} />}
                onClick={() => {
                  setIsLeftPanelOpen(false);
                  setInfoData([]);
                  setSelectedStyleLayer(null);
                }}
                className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600"
              />
            </div>

            {leftPanelMode === 'info' ? (
              <div className="flex-grow overflow-y-auto p-4 flex flex-col gap-3">
                {infoData.length > 0 ? (
                  <div className="flex flex-col gap-5">
                    <div className="text-[10px] uppercase font-bold text-gray-400">
                      Found {infoData.length} Feature{infoData.length > 1 ? 's' : ''}
                    </div>
                    {infoData.map((feature) => (
                      <div key={feature.id} className="flex flex-col gap-2 p-3 bg-gray-50 border border-gray-150 rounded-xl">
                        <div className="text-xs font-extrabold text-gray-700 border-b border-gray-200 pb-1.5 flex items-center justify-between">
                          <span className="truncate">{feature.title}</span>
                        </div>
                        {feature.rows.length > 0 ? (
                          <div className="border border-gray-150 rounded-lg overflow-hidden bg-white text-[11px]">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr className="bg-gray-100/50 border-b border-gray-150">
                                  <th className="px-2.5 py-1.5 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px] w-2/5">Attribute</th>
                                  <th className="px-2.5 py-1.5 text-left font-bold text-gray-500 uppercase tracking-wider text-[10px]">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {feature.rows.map((row: any, rIdx: number) => (
                                  <tr key={row.key} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'}>
                                    <td className="px-2.5 py-1.5 border-b border-gray-100 font-semibold text-gray-700 break-words max-w-[85px]">{row.attribute}</td>
                                    <td className="px-2.5 py-1.5 border-b border-gray-100 text-gray-600 font-mono text-[10px] break-all">{row.value}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-[10px] text-gray-400 italic">No attributes.</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400 text-xs italic">
                    No feature selected. Click on a vector or raster layer on the map.
                  </div>
                )}
              </div>
            ) : (
              // Vector Styling View
              <div className="flex-grow overflow-y-auto p-4 flex flex-col gap-5">
                {selectedStyleLayer ? (
                  <StyleEditor
                    layer={selectedStyleLayer}
                    schema={selectedLayerSchema}
                    geometryType={selectedLayerGeomType}
                    styleConfig={getActiveStyleConfig(selectedStyleLayer.id) || {}}
                    onChange={(newConfig) => {
                      const layerStyleData = vectorLayerStyles[selectedStyleLayer.id];
                      const activeStyleId = layerStyleData?.activeStyleId;

                      if (!layerStyleData || !activeStyleId) return;

                      // Update the active style's config
                      setVectorLayerStyles(prev => ({
                        ...prev,
                        [selectedStyleLayer.id]: {
                          ...prev[selectedStyleLayer.id],
                          styles: prev[selectedStyleLayer.id].styles.map(style =>
                            style.id === activeStyleId
                              ? { ...style, config: newConfig }
                              : style
                          )
                        }
                      }));

                      const currentLayer = addedLayers.find(l => l.id === selectedStyleLayer.id);
                      const olLayer = olLayersRef.current[selectedStyleLayer.id];
                      if (olLayer) {
                        applyStyleToOlLayer(olLayer, newConfig, currentLayer?.labelsEnabled);
                      }
                    }}
                  />
                ) : (
                  <div className="text-center py-8 text-gray-400 text-xs italic">
                    No layer selected. Select a vector or raster layer from the Active Layers list and click the Style button.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Map View with Floating Drawer overlay */}
        <div className="flex-grow relative overflow-hidden bg-white">
          <div ref={mapRef} className="w-full h-full" />

          {/* Mobile Coordinates, Zoom & Scale panel */}
          {isMobile && (
            <div className="absolute left-4 top-4 bg-white/95 backdrop-blur-md border border-gray-150 shadow-md rounded-xl p-2.5 z-30 text-[10px] text-gray-600 font-semibold flex flex-col gap-1 pointer-events-auto min-w-[190px]">
              <div className="flex items-center gap-1 font-mono">
                <span className="text-gray-400 font-bold uppercase tracking-wider text-[8px]">Lon:</span>
                <span id="mobile-lon-value" className="text-gray-800 font-medium">0.000000°</span>
              </div>
              <div className="flex items-center gap-1 font-mono">
                <span className="text-gray-400 font-bold uppercase tracking-wider text-[8px]">Lat:</span>
                <span id="mobile-lat-value" className="text-gray-800 font-medium">0.000000°</span>
              </div>
              <div className="flex items-center gap-2 border-t border-gray-100 pt-1.5 text-[9px] w-full">
                {/* Zoom Section */}
                <div className="flex items-center shrink-0">
                  {isEditingZoom ? (
                    <div className="flex items-center gap-0.5">
                      <span className="text-[9px] text-gray-400">Z:</span>
                      <input
                        type="text"
                        value={editZoom}
                        onChange={(e) => setEditZoom(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveZoom();
                        }}
                        onBlur={saveZoom}
                        autoFocus
                        className="font-mono text-[9px] px-1 py-0 text-center bg-gray-50 border border-gray-200 rounded focus:outline-none focus:border-primary shrink-0"
                        style={{ width: '30px', height: '14px', lineHeight: '10px' }}
                      />
                    </div>
                  ) : (
                    <span className="cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded font-bold text-gray-700" onClick={startEditingZoom} title="Click to edit zoom">
                      Zoom: <span className="font-mono text-primary font-bold">{zoomLevel}</span>
                    </span>
                  )}
                </div>

                <span className="text-gray-200 shrink-0">|</span>

                {/* Scale Section */}
                <div className="flex items-center shrink-0 min-w-0">
                  {isEditingScaleText ? (
                    <div className="flex items-center gap-0.5">
                      <span className="font-mono text-[9px] text-gray-400">1:</span>
                      <input
                        type="text"
                        value={editScaleVal}
                        onChange={(e) => setEditScaleVal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveScale();
                        }}
                        onBlur={saveScale}
                        autoFocus
                        className="font-mono text-[9px] px-1 py-0 text-center bg-gray-50 border border-gray-200 rounded focus:outline-none focus:border-primary shrink-0"
                        style={{ width: '60px', height: '14px', lineHeight: '10px' }}
                        placeholder="Scale"
                      />
                    </div>
                  ) : (
                    <Dropdown menu={{ items: scaleItems }} trigger={['click']} placement="bottomLeft">
                      <span className="font-mono text-gray-700 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-150 cursor-pointer hover:bg-gray-100 hover:text-primary transition-all flex items-center gap-0.5 truncate text-[9px]">
                        {scaleText.replace('1 : ', '1:')} <ChevronDown size={8} className="text-gray-400" />
                      </span>
                    </Dropdown>
                  )}
                </div>
              </div>
            </div>
          )}


          {/* Mobile Zoom/GPS Floating controls */}
          {isMobile && (
            <div className="absolute right-4 top-4 flex flex-col gap-2.5 z-30 pointer-events-auto">
              <Button
                shape="circle"
                icon={<Maximize size={16} />}
                onClick={() => {
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => { });
                  } else {
                    document.exitFullscreen().catch(() => { });
                  }
                }}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center"
                style={{ width: 36, height: 36 }}
              />
              <Button
                shape="circle"
                icon={<Expand size={16} />}
                onClick={handleZoomToExtentClick}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center"
                style={{ width: 36, height: 36 }}
              />
              <Button
                shape="circle"
                icon={<Plus size={16} />}
                onClick={() => {
                  const view = mapInstance.current?.getView();
                  if (view) {
                    const z = view.getZoom();
                    if (z !== undefined) view.animate({ zoom: z + 1, duration: 300 });
                  }
                }}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center"
                style={{ width: 36, height: 36 }}
              />
              <Button
                shape="circle"
                icon={<Minus size={16} />}
                onClick={() => {
                  const view = mapInstance.current?.getView();
                  if (view) {
                    const z = view.getZoom();
                    if (z !== undefined) view.animate({ zoom: z - 1, duration: 300 });
                  }
                }}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center"
                style={{ width: 36, height: 36 }}
              />
              <Button
                shape="circle"
                icon={<Navigation size={16} />}
                onClick={() => {
                  if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                      (position) => {
                        const { longitude, latitude } = position.coords;
                        const view = mapInstance.current?.getView();
                        if (view) {
                          view.animate({
                            center: fromLonLat([longitude, latitude]),
                            zoom: 17,
                            duration: 800
                          });
                        }
                      },
                      (error) => {
                        console.warn(`GPS geolocation failed: ${error.message}`);
                      }
                    );
                  }
                }}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center"
                style={{ width: 36, height: 36 }}
              />
              <Popover
                content={renderRotationPopoverContent()}
                trigger={['click']}
                placement="left"
                overlayInnerStyle={{ padding: 6 }}
              >
                <div className="relative">
                  <Button
                    shape="circle"
                    icon={
                      <Compass
                        size={16}
                        className={`transition-all duration-150 ${rotationDeg !== 0 ? 'text-primary' : ''}`}
                        style={{ transform: `rotate(${rotationDeg}deg)` }}
                      />
                    }
                    className={`bg-white/95 border shadow-md hover:bg-white flex items-center justify-center ${
                      rotationDeg !== 0 ? 'border-primary/50 bg-blue-50/50' : 'border-gray-200/80'
                    }`}
                    style={{ width: 36, height: 36 }}
                  />
                  {rotationDeg !== 0 && (
                    <span className="absolute -top-1 -right-1 px-1 bg-primary text-white text-[7px] font-bold rounded-full pointer-events-none">
                      {Math.round(rotationDeg)}°
                    </span>
                  )}
                </div>
              </Popover>
              <Button
                shape="circle"
                disabled={!canGoPrev}
                icon={<ArrowLeft size={16} />}
                onClick={goToPreviousExtent}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center disabled:opacity-40"
                style={{ width: 36, height: 36 }}
              />
              <Button
                shape="circle"
                disabled={!canGoNext}
                icon={<ArrowRight size={16} />}
                onClick={goToNextExtent}
                className="bg-white/95 border border-gray-200/80 shadow-md hover:bg-white flex items-center justify-center disabled:opacity-40"
                style={{ width: 36, height: 36 }}
              />
            </div>
          )}

          {/* Mobile drawing guide */}
          {isMobile && isDrawing && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-purple-600 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg z-50 flex items-center gap-2">
              <span>Draw on map. Double-tap to finish.</span>
              <Button
                size="small"
                type="primary"
                danger
                className="text-[10px] h-5 px-2 flex items-center justify-center border-none rounded-md"
                onClick={() => {
                  stopMeasurement();
                  stopDrawingAnnotation();
                  stopQueryDraw();
                  handleWpsStopDrawGeom();
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Mobile Bottom Floating Toolbar */}
          {isMobile && !isDrawing && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-md border border-gray-200/80 shadow-lg rounded-2xl flex items-center px-2 py-1.5 gap-1 z-30 max-w-[95vw] pointer-events-auto">
              <Button
                type="text"
                icon={<Layers size={18} className={activePanel === 'layerlist' ? 'text-primary' : 'text-gray-500'} />}
                onClick={() => togglePanel('layerlist')}
                className="flex items-center justify-center h-10 w-10 rounded-xl"
              />
              <Button
                type="text"
                icon={<Search size={18} className={activePanel === 'fuzzysearch' ? 'text-primary' : 'text-gray-500'} />}
                onClick={() => togglePanel('fuzzysearch')}
                className="flex items-center justify-center h-10 w-10 rounded-xl"
              />
              <Button
                type="text"
                icon={<Ruler size={18} className={activePanel === 'measurement' ? 'text-primary' : 'text-gray-500'} />}
                onClick={() => togglePanel('measurement')}
                className="flex items-center justify-center h-10 w-10 rounded-xl"
              />
              <Button
                type="text"
                icon={<PenTool size={18} className={activePanel === 'annotation' ? 'text-primary' : 'text-gray-500'} />}
                onClick={() => togglePanel('annotation')}
                className="flex items-center justify-center h-10 w-10 rounded-xl"
              />
              <Button
                type="text"
                icon={
                  <div className="relative">
                    <Info size={18} className={isLeftPanelOpen && leftPanelMode === 'info' ? 'text-primary' : 'text-gray-500'} />
                    {infoData.length > 0 && !isLeftPanelOpen && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[8px] text-white font-bold border border-white">
                        {infoData.length}
                      </span>
                    )}
                  </div>
                }
                onClick={toggleInfoActive}
                className="flex items-center justify-center h-10 w-10 rounded-xl"
              />
              <Dropdown
                menu={{
                  items: [
                    { key: 'basemap', label: 'Basemaps', icon: <Globe size={14} />, onClick: () => togglePanel('basemap') },
                    { key: 'gotoXY', label: 'Go To XY', icon: <MapPin size={14} />, onClick: () => togglePanel('gotoXY') },
                    { key: 'query-attribute', label: 'Attribute Query', icon: <Database size={14} />, onClick: () => togglePanel('query-attribute') },
                    { key: 'query-buffer', label: 'Buffer Query', icon: <CircleDot size={14} />, onClick: () => togglePanel('query-buffer') },
                    { key: 'query-spatial', label: 'Spatial Query', icon: <BoxSelect size={14} />, onClick: () => togglePanel('query-spatial') },
                    { key: 'wps-analysis', label: 'WPS Analysis', icon: <Workflow size={14} />, onClick: () => togglePanel('wps-analysis') },
                  ]
                }}
                trigger={['click']}
                placement="topCenter"
              >
                <Button
                  type="text"
                  icon={<Grid size={18} className="text-gray-500" />}
                  className="flex items-center justify-center h-10 w-10 rounded-xl"
                />
              </Dropdown>
            </div>
          )}

          {activePanel && (
            <div className="absolute left-0 md:left-auto md:right-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-l border-gray-150 shadow-2xl md:shadow-xl z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-right transition-all duration-300" style={{ display: isMobile && isDrawing ? 'none' : 'flex' }}>
              {isMobile && (
                <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
              )}
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {activePanel === 'vector' && selectedAnalysisWorkflow && (
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowLeft size={14} />}
                      onClick={() => setSelectedAnalysisWorkflow(null)}
                      className="flex items-center justify-center rounded-full hover:bg-gray-150 shrink-0"
                      style={{ width: 24, height: 24 }}
                    />
                  )}
                  {activePanel === 'raster' && selectedRasterWorkflow && (
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowLeft size={14} />}
                      onClick={() => setSelectedRasterWorkflow(null)}
                      className="flex items-center justify-center rounded-full hover:bg-gray-150 shrink-0"
                      style={{ width: 24, height: 24 }}
                    />
                  )}
                  <span className="font-bold text-gray-800 uppercase tracking-wider text-xs truncate">
                    {activePanel === 'geocoder' && 'Search Location'}
                    {activePanel === 'fuzzysearch' && 'Feature Search'}
                    {activePanel === 'basemap' && 'Base Map Selector'}
                    {activePanel === 'layerlist' && 'Layer List'}
                    {activePanel === 'measurement' && 'Measurement'}
                    {activePanel === 'annotation' && 'Annotations'}
                    {activePanel === 'vector' && (selectedAnalysisWorkflow ? selectedAnalysisWorkflow.replace('_', ' ') : 'Vector Analysis')}
                    {activePanel === 'raster' && (selectedRasterWorkflow ? selectedRasterWorkflow.replace('_', ' ') : 'Raster Analysis')}
                    {activePanel === 'gotoXY' && 'Go To XY'}
                  </span>
                </div>
                <Button
                  type="text"
                  size="small"
                  icon={<X size={14} />}
                  onClick={() => setActivePanel(null)}
                  className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 shrink-0"
                />
              </div>
              <div className="flex-grow p-4 overflow-y-auto">
                {activePanel === 'geocoder' && (
                  <Geocoder onSelectLocation={handleSelectLocation} />
                )}
                {activePanel === 'fuzzysearch' && (
                  <div className="flex flex-col gap-4">
                    <div className="text-xs text-gray-500 font-medium">
                      Search for features within vector layers using fuzzy keyword matching.
                    </div>

                    <FuzzySearch
                      layers={datasetsList}
                      onSearch={handleFuzzySearch}
                      loading={fuzzySearchLoading}
                      selectedLayerId={fuzzySearchLayerId}
                      selectedKeywords={fuzzySearchKeywords}
                      searchActive={fuzzySearchActive}
                    />

                    {fuzzySearchActive && (
                      <div className="text-xs text-gray-400 italic text-center">
                        Filter is active. Close this panel to view filtered results.
                      </div>
                    )}
                  </div>
                )}
                {activePanel === 'basemap' && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <Input
                        placeholder="Search basemaps..."
                        allowClear
                        value={basemapSearch}
                        onChange={(e) => setBasemapSearch(e.target.value.replace(/^\s+/, ''))}
                        onBlur={() => {
                          if (basemapSearch) {
                            setBasemapSearch(basemapSearch.trim());
                          }
                        }}
                        onPressEnter={() => {
                          if (basemapSearch) {
                            setBasemapSearch(basemapSearch.trim());
                          }
                        }}
                        prefix={<Search size={14} className="text-gray-400" />}
                      />
                    </div>
                    <div className="flex flex-col gap-3">
                      {filteredBasemaps.map((bm) => (
                        <div
                          key={bm.id}
                          onClick={() => changeBasemap(bm.id)}
                          className={`p-3 bg-white border rounded-xl cursor-pointer hover:shadow-md hover:border-primary/50 transition-all flex items-center justify-between gap-3 overflow-hidden ${selectedBasemap === bm.id
                            ? 'border-primary ring-2 ring-primary/20 shadow-sm'
                            : 'border-gray-155'
                            }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-grow">
                            <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                              {bm.id === 'none' ? (
                                <EyeOff size={22} className="text-gray-400" />
                              ) : bm.thumbnail ? (
                                <img src={bm.thumbnail} alt={bm.name} className="w-full h-full object-cover" onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }} />
                              ) : (
                                <Globe size={22} className="text-primary/70" />
                              )}
                            </div>
                            <div className="min-w-0 flex-grow">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-gray-800 truncate">{bm.name}</span>
                                {bm.isCustom && (
                                  <span className="text-[9px] bg-primary/10 text-primary font-medium px-1.5 py-0.5 rounded-full">
                                    Custom
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-400 truncate mt-0.5">{bm.desc || bm.url}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                      {filteredBasemaps.length === 0 && (
                        <div className="text-xs text-gray-400 text-center py-4">No basemaps match search.</div>
                      )}
                    </div>
                  </div>
                )}
                {activePanel === 'layerlist' && (
                  <LayerListPanel2D
                    addedLayers={addedLayers}
                    setAddedLayers={setAddedLayers}
                    vectorLayerStyles={vectorLayerStyles}
                    setVectorLayerStyles={setVectorLayerStyles}
                    draggingIndex={draggingIndex}
                    handleDragStart={handleDragStart}
                    handleDragOver={handleDragOver}
                    handleDragEnd={handleDragEnd}
                    setIsAddLayerModalOpen={setIsAddLayerModalOpen}
                    zoomToLayer={zoomToLayer}
                    applyVectorLayerStyle={applyVectorLayerStyle}
                    handleOpenStyleEditor={handleOpenStyleEditor}
                    setAttributeTableDataset={setAttributeTableDataset}
                    setAttributeTableOpen={handleOpenAttributeTable}
                    notification={notification}
                    modal={modal}
                    token={token}
                  />
                )}

                {activePanel === 'measurement' && (
                  <div className="flex flex-col gap-4">
                    <div className="text-xs text-gray-500 font-medium">
                      Select a measurement tool, click on the map to place points, and double-click to finish drawing.
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        type={measurementType === 'LineString' ? 'primary' : 'default'}
                        onClick={() => startMeasurement('LineString')}
                        className="w-full text-left flex items-center justify-start gap-2"
                      >
                        <Ruler size={16} /> Measure Distance / Length
                      </Button>
                      <Button
                        type={measurementType === 'Polygon' ? 'primary' : 'default'}
                        onClick={() => startMeasurement('Polygon')}
                        className="w-full text-left flex items-center justify-start gap-2"
                      >
                        <MapIcon size={16} /> Measure Area
                      </Button>
                    </div>

                    {(measurementType || (measurementSourceRef.current && measurementSourceRef.current.getFeatures().length > 0)) && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                        {measurementType && (
                          <Button danger type="dashed" onClick={stopMeasurement} className="w-full">
                            Stop Active Drawing
                          </Button>
                        )}
                        <Button danger onClick={clearMeasurements} className="w-full">
                          Clear All Measurements
                        </Button>
                      </div>
                    )}

                    {measurements.length > 0 && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100 max-h-[calc(100vh-320px)] overflow-y-auto">
                        <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">
                          History
                        </div>
                        {measurements.map((m) => (
                          <div key={m.id} className="p-2.5 bg-gray-50 border border-gray-150 rounded-xl flex items-center justify-between gap-2 transition-all">
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-gray-800">
                                {m.type === 'LineString' ? 'Distance' : 'Area'}
                              </div>
                              <div className="text-xs font-semibold text-primary mt-0.5 font-mono">
                                {m.displayVal}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="small"
                                type="text"
                                onClick={() => toggleMeasurementVisibility(m.id)}
                                icon={m.visible ? <Eye size={14} className="text-gray-500" /> : <EyeOff size={14} className="text-gray-400" />}
                                className="flex items-center justify-center hover:bg-gray-200 rounded-md"
                              />
                              <Button
                                size="small"
                                type="text"
                                danger
                                onClick={() => deleteMeasurement(m.id)}
                                icon={<Trash2 size={14} />}
                                className="flex items-center justify-center hover:bg-red-50 rounded-md"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {activePanel === 'annotation' && (
                  <div className="flex flex-col gap-4">
                    <div className="text-xs text-gray-500 font-medium">
                      Select an annotation tool, click/drag on the map to draw, and double-click/release to finish.
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type={annotationType === 'point' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('point')}
                        className="flex items-center justify-center gap-1.5 text-xs h-9"
                        icon={<MapPin size={14} />}
                      >
                        Point
                      </Button>
                      <Button
                        type={annotationType === 'line' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('line')}
                        className="flex items-center justify-center gap-1.5 text-xs h-9"
                        icon={<PenTool size={14} />}
                      >
                        Line
                      </Button>
                      <Button
                        type={annotationType === 'square' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('square')}
                        className="flex items-center justify-center gap-1.5 text-xs h-9"
                        icon={<Square size={14} />}
                      >
                        Square
                      </Button>
                      <Button
                        type={annotationType === 'rectangle' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('rectangle')}
                        className="flex items-center justify-center gap-1.5 text-xs h-9"
                        icon={<Square size={14} className="rotate-90" />}
                      >
                        Rectangle
                      </Button>
                      <Button
                        type={annotationType === 'circle' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('circle')}
                        className="flex items-center justify-center gap-1.5 text-xs h-9"
                        icon={<Circle size={14} />}
                      >
                        Circle
                      </Button>
                      <Button
                        type={annotationType === 'label' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('label')}
                        className="flex items-center justify-center gap-1.5 text-xs h-9"
                        icon={<Type size={14} />}
                      >
                        Label
                      </Button>
                      <Button
                        type={annotationType === 'freehand_line' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('freehand_line')}
                        className="flex items-center justify-center gap-2 text-xs h-auto min-h-[44px] py-2.5 px-3 font-normal text-center"
                        icon={<Activity size={14} className="shrink-0" />}
                      >
                        <span className="flex flex-col items-center leading-snug font-normal">
                          <span>Freehand</span>
                          <span>Line</span>
                        </span>
                      </Button>
                      <Button
                        type={annotationType === 'freehand_polygon' ? 'primary' : 'default'}
                        onClick={() => startDrawingAnnotation('freehand_polygon')}
                        className="flex items-center justify-center gap-2 text-xs h-auto min-h-[44px] py-2.5 px-3 font-normal text-center"
                        icon={<Activity size={14} className="text-purple-600 shrink-0" />}
                      >
                        <span className="flex flex-col items-center leading-snug font-normal">
                          <span>Freehand</span>
                          <span>Polygon</span>
                        </span>
                      </Button>
                    </div>

                    {(annotationType || annotations.length > 0) && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
                        {annotationType && (
                          <Button danger type="dashed" onClick={stopDrawingAnnotation} className="w-full">
                            Stop Active Drawing
                          </Button>
                        )}
                        {annotations.length > 0 && (
                          <Button danger onClick={clearAllAnnotations} className="w-full">
                            Clear All Annotations
                          </Button>
                        )}
                      </div>
                    )}

                    {annotations.length > 0 && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100 max-h-[calc(100vh-360px)] overflow-y-auto pr-1">
                        <div className="text-[10px] uppercase font-bold text-gray-400 mb-1">
                          History List
                        </div>
                        {annotations.map((ann) => (
                          <div key={ann.id} className="p-2.5 bg-gray-50 border border-gray-150 rounded-xl flex items-center justify-between gap-2 transition-all">
                            <div className="min-w-0 flex-grow">
                              <div className="text-[11px] font-bold text-gray-800 capitalize flex items-center gap-1">
                                {ann.type === 'point' && <MapPin size={10} className="text-blue-500" />}
                                {ann.type === 'line' && <PenTool size={10} className="text-blue-500" />}
                                {ann.type === 'square' && <Square size={10} className="text-blue-500" />}
                                {ann.type === 'rectangle' && <Square size={10} className="text-blue-500 rotate-90" />}
                                {ann.type === 'circle' && <Circle size={10} className="text-blue-500" />}
                                {ann.type === 'freehand_line' && <Activity size={10} className="text-blue-500" />}
                                {ann.type === 'freehand_polygon' && <Activity size={10} className="text-purple-500" />}
                                {ann.type === 'label' && <Type size={10} className="text-blue-500" />}
                                {ann.type.replace('_', ' ')}
                              </div>
                              {ann.label && (
                                <div className="text-xs font-semibold text-primary mt-0.5 font-mono truncate">
                                  {ann.label}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Tooltip title={ann.visible ? "Hide Annotation" : "Show Annotation"}>
                                <Button
                                  size="small"
                                  type="text"
                                  onClick={() => toggleAnnotationVisibility(ann.id)}
                                  icon={ann.visible ? <Eye size={14} className="text-gray-500" /> : <EyeOff size={14} className="text-gray-400" />}
                                  className="flex items-center justify-center hover:bg-gray-200 rounded-md"
                                />
                              </Tooltip>
                              <Tooltip title="Delete Annotation">
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  onClick={() => deleteAnnotation(ann.id, ann.label)}
                                  icon={<Trash2 size={14} />}
                                  className="flex items-center justify-center hover:bg-red-50 rounded-md"
                                />
                              </Tooltip>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {(activePanel === 'vector' || activePanel === 'raster') && (
                  <AnalysisPanel2D
                    activePanel={activePanel}
                    addedLayers={addedLayers as any}
                    annotations={annotations}
                    analysisLoading={analysisLoading}
                    analysisStatus={analysisStatus}
                    analysisProgress={analysisProgress}
                    analysisMessage={analysisMessage}
                    selectedAnalysisWorkflow={selectedAnalysisWorkflow}
                    setSelectedAnalysisWorkflow={setSelectedAnalysisWorkflow}
                    selectedRasterWorkflow={selectedRasterWorkflow}
                    setSelectedRasterWorkflow={setSelectedRasterWorkflow}
                    triggerAnalysis={triggerAnalysis}
                    triggerRasterAnalysis={triggerRasterAnalysis}
                  />
                )}
              </div>
            </div>
          )}

          {activePanel === 'gotoXY' && (
            <div className="absolute left-0 md:left-auto md:right-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-l border-gray-150 shadow-2xl md:shadow-xl z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-right transition-all duration-300" style={{ display: isMobile && isDrawing ? 'none' : 'flex' }}>
              {isMobile && (
                <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
              )}
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <span className="font-bold text-gray-800 uppercase tracking-wider text-xs truncate">Go To XY</span>
                <Button
                  type="text"
                  size="small"
                  icon={<X size={14} />}
                  onClick={() => setActivePanel(null)}
                  className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 shrink-0"
                />
              </div>
              <div className="flex-grow overflow-y-auto p-4">
                <GoToXY
                  mapId={mapId}
                  currentZoom={zoomLevel}
                  onGoToLocation={handleGoToXYLocation}
                  onClearMarker={handleClearGotoXYMarker}
                  onMapClickRegister={(cb) => { gotoXYMapClickRef.current = cb; }}
                  token={token}
                  activeMarkerCoords={gotoXYMarkerCoords}
                  onShowMarker={handleShowGotoXYMarker}
                />
              </div>
            </div>
          )}

          {activePanel === 'wps-analysis' && (
            <WpsAnalysisPanel
              addedLayers={addedLayers}
              user={user}
              notification={notification}
              onExecuteSuccess={addWpsResultLayerToMap}
              onClose={() => setActivePanel(null)}
              onStartDrawGeom={handleWpsStartDrawGeom}
              onStopDrawGeom={handleWpsStopDrawGeom}
              isMobile={isMobile}
              isDrawing={isDrawing}
              getLayerFeatures={getLayerFeaturesLocal}
              allDatasets={datasetsList}
            />
          )}

          {/* Query by Attributes — always mounted to preserve state across panel open/close */}
          <div
            className="absolute left-0 md:left-auto md:right-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-l border-gray-150 shadow-2xl md:shadow-xl z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-right transition-all duration-300"
            style={{ display: (activePanel as string) === 'query-attribute' && !(isMobile && isDrawing) ? 'flex' : 'none' }}
          >
            {isMobile && (
              <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
            )}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-bold text-gray-800 uppercase tracking-wider text-xs truncate">Query by Attributes</span>
              <Button
                type="text"
                size="small"
                icon={<X size={14} />}
                onClick={() => setActivePanel(null)}
                className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 shrink-0"
              />
            </div>
            <div className="flex-grow overflow-y-auto p-4 query-builder-scroll">
              <QueryBuilder
                mode="attribute"
                activeFilters={qbActiveFilters}
                onActiveFiltersChange={setQbActiveFilters}
                layers={addedLayers}
                allDatasets={datasetsList}
                onStartDraw={handleStartQueryDraw}
                bufferDrawnGeometry={bufferDrawnGeometry}
                spatialDrawnGeometry={spatialDrawnGeometry}
                onClearBufferDraw={handleClearBufferDraw}
                onClearSpatialDraw={handleClearSpatialDraw}
                onShowGeometryOnMap={handleShowGeometryOnMap}
                onQueryResult={(layerId, layerName, featureIds, cqlFilter) => {
                  applyFeatureFilterToMapLayer(layerId, featureIds, cqlFilter);
                  setAttributeTableFilterIds(prev => ({ ...prev, [layerId]: featureIds }));
                  setAttributeTableFilterCqls(prev => ({ ...prev, [layerId]: cqlFilter || '' }));
                  setAttributeTableDataset({ id: layerId, name: layerName });
                  handleOpenAttributeTable(true);
                }}
                onUpdateMapFilter={(layerId, featureIds, cqlFilter) => {
                  applyFeatureFilterToMapLayer(layerId, featureIds, cqlFilter);
                  setAttributeTableFilterIds(prev => ({ ...prev, [layerId]: featureIds }));
                  setAttributeTableFilterCqls(prev => ({ ...prev, [layerId]: cqlFilter || '' }));
                }}
                onResetLayer={(layerId) => {
                  const olLayer = (olLayersRef.current as any)[layerId];
                  if (olLayer) {
                    const orig = olLayer.get('original_style_function');
                    if (orig) olLayer.setStyle(orig);
                    olLayer.unset('filtered');
                    olLayer.unset('filtered_ids');
                    olLayer.unset('cql_filter_string');
                    olLayer.unset('original_style_function');

                    const source = olLayer.getSource();
                    if (source && typeof source.updateParams === 'function') {
                      source.updateParams({ 'cql_filter': undefined, 'CQL_FILTER': undefined, 'featureid': undefined });
                    }
                    olLayer.changed();
                  }
                  clearFeatureHighlight();
                  setAttributeTableFilterIds(prev => { const n = { ...prev }; delete n[layerId]; return n; });
                  setAttributeTableFilterCqls(prev => { const n = { ...prev }; delete n[layerId]; return n; });
                  if (attributeTableDataset?.id === layerId) setAttributeTableOpen(false);
                }}
              />
            </div>
          </div>

          {/* Buffer Query — always mounted to preserve state across panel open/close */}
          <div
            className="absolute left-0 md:left-auto md:right-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-l border-gray-150 shadow-2xl md:shadow-xl z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-right transition-all duration-300"
            style={{ display: (activePanel as string) === 'query-buffer' && !(isMobile && isDrawing) ? 'flex' : 'none' }}
          >
            {isMobile && (
              <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
            )}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-bold text-gray-800 uppercase tracking-wider text-xs truncate">Buffer Query</span>
              <Button
                type="text"
                size="small"
                icon={<X size={14} />}
                onClick={() => setActivePanel(null)}
                className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 shrink-0"
              />
            </div>
            <div className="flex-grow overflow-y-auto p-4 query-builder-scroll">
              <QueryBuilder
                mode="buffer"
                activeFilters={qbActiveFilters}
                onActiveFiltersChange={setQbActiveFilters}
                layers={addedLayers}
                allDatasets={datasetsList}
                onStartDraw={handleStartQueryDraw}
                bufferDrawnGeometry={bufferDrawnGeometry}
                spatialDrawnGeometry={spatialDrawnGeometry}
                onClearBufferDraw={handleClearBufferDraw}
                onClearSpatialDraw={handleClearSpatialDraw}
                onShowGeometryOnMap={handleShowGeometryOnMap}
                onQueryResult={(layerId, layerName, featureIds, cqlFilter) => {
                  applyFeatureFilterToMapLayer(layerId, featureIds, cqlFilter);
                  setAttributeTableFilterIds(prev => ({ ...prev, [layerId]: featureIds }));
                  setAttributeTableFilterCqls(prev => ({ ...prev, [layerId]: cqlFilter || '' }));
                  setAttributeTableDataset({ id: layerId, name: layerName });
                  handleOpenAttributeTable(true);
                }}
                onUpdateMapFilter={(layerId, featureIds, cqlFilter) => {
                  applyFeatureFilterToMapLayer(layerId, featureIds, cqlFilter);
                  setAttributeTableFilterIds(prev => ({ ...prev, [layerId]: featureIds }));
                  setAttributeTableFilterCqls(prev => ({ ...prev, [layerId]: cqlFilter || '' }));
                }}
                onResetLayer={(layerId) => {
                  const olLayer = (olLayersRef.current as any)[layerId];
                  if (olLayer) {
                    const orig = olLayer.get('original_style_function');
                    if (orig) olLayer.setStyle(orig);
                    olLayer.unset('filtered');
                    olLayer.unset('filtered_ids');
                    olLayer.unset('cql_filter_string');
                    olLayer.unset('original_style_function');

                    const source = olLayer.getSource();
                    if (source && typeof source.updateParams === 'function') {
                      source.updateParams({ 'cql_filter': undefined, 'CQL_FILTER': undefined, 'featureid': undefined });
                    }
                    olLayer.changed();
                  }
                  clearFeatureHighlight();
                  setAttributeTableFilterIds(prev => { const n = { ...prev }; delete n[layerId]; return n; });
                  setAttributeTableFilterCqls(prev => { const n = { ...prev }; delete n[layerId]; return n; });
                  if (attributeTableDataset?.id === layerId) setAttributeTableOpen(false);
                }}
              />
            </div>
          </div>

          {/* Spatial Query — always mounted to preserve state across panel open/close */}
          <div
            className="absolute left-0 md:left-auto md:right-0 bottom-0 md:top-0 h-[50vh] md:h-full w-full md:w-[20%] md:min-w-[280px] bg-white border-t md:border-t-0 md:border-l border-gray-150 shadow-2xl md:shadow-xl z-40 flex flex-col rounded-t-2xl md:rounded-t-none animate-slide-up md:animate-slide-right transition-all duration-300"
            style={{ display: (activePanel as string) === 'query-spatial' && !(isMobile && isDrawing) ? 'flex' : 'none' }}
          >
            {isMobile && (
              <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto my-2.5 shrink-0" />
            )}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-bold text-gray-800 uppercase tracking-wider text-xs truncate">Spatial Query</span>
              <Button
                type="text"
                size="small"
                icon={<X size={14} />}
                onClick={() => setActivePanel(null)}
                className="flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 shrink-0"
              />
            </div>
            <div className="flex-grow overflow-y-auto p-4 query-builder-scroll">
              <QueryBuilder
                mode="spatial"
                activeFilters={qbActiveFilters}
                onActiveFiltersChange={setQbActiveFilters}
                layers={addedLayers}
                allDatasets={datasetsList}
                onStartDraw={handleStartQueryDraw}
                bufferDrawnGeometry={bufferDrawnGeometry}
                spatialDrawnGeometry={spatialDrawnGeometry}
                onClearBufferDraw={handleClearBufferDraw}
                onClearSpatialDraw={handleClearSpatialDraw}
                onShowGeometryOnMap={handleShowGeometryOnMap}
                onQueryResult={(layerId, layerName, featureIds, cqlFilter) => {
                  applyFeatureFilterToMapLayer(layerId, featureIds, cqlFilter);
                  setAttributeTableFilterIds(prev => ({ ...prev, [layerId]: featureIds }));
                  setAttributeTableFilterCqls(prev => ({ ...prev, [layerId]: cqlFilter || '' }));
                  setAttributeTableDataset({ id: layerId, name: layerName });
                  handleOpenAttributeTable(true);
                }}
                onUpdateMapFilter={(layerId, featureIds, cqlFilter) => {
                  applyFeatureFilterToMapLayer(layerId, featureIds, cqlFilter);
                  setAttributeTableFilterIds(prev => ({ ...prev, [layerId]: featureIds }));
                  setAttributeTableFilterCqls(prev => ({ ...prev, [layerId]: cqlFilter || '' }));
                }}
                onResetLayer={(layerId) => {
                  const olLayer = (olLayersRef.current as any)[layerId];
                  if (olLayer) {
                    const orig = olLayer.get('original_style_function');
                    if (orig) olLayer.setStyle(orig);
                    olLayer.unset('filtered');
                    olLayer.unset('filtered_ids');
                    olLayer.unset('cql_filter_string');
                    olLayer.unset('original_style_function');

                    const source = olLayer.getSource();
                    if (source && typeof source.updateParams === 'function') {
                      source.updateParams({ 'cql_filter': undefined, 'CQL_FILTER': undefined, 'featureid': undefined });
                    }
                    olLayer.changed();
                  }
                  clearFeatureHighlight();
                  setAttributeTableFilterIds(prev => { const n = { ...prev }; delete n[layerId]; return n; });
                  setAttributeTableFilterCqls(prev => { const n = { ...prev }; delete n[layerId]; return n; });
                  if (attributeTableDataset?.id === layerId) setAttributeTableOpen(false);
                }}
              />
            </div>
          </div>
        </div>

        {/* Right vertical bar */}
        <div className="hidden md:flex w-14 bg-white border-l border-gray-100 flex-col items-center py-4 gap-4 z-10 shadow-sm shrink-0">
          {/* <Tooltip title="Search Location (Geocoder)" placement="left">
            <Button
              type="text"
              icon={<Search size={20} className={`transition-colors ${activePanel === 'geocoder' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('geocoder')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip> */}
          <Tooltip title="Feature Search (Fuzzy)" placement="left">
            <Button
              type="text"
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-colors ${activePanel === 'fuzzysearch' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`}>
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
                <path d="M11 8a3 3 0 0 0-3 3"></path>
              </svg>}
              onClick={() => togglePanel('fuzzysearch')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Base Map Selector" placement="left">
            <Button
              type="text"
              icon={<Globe size={20} className={`transition-colors ${activePanel === 'basemap' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('basemap')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Layer List" placement="left">
            <Button
              type="text"
              icon={<Layers size={20} className={`transition-colors ${activePanel === 'layerlist' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('layerlist')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Measurement Tools" placement="left">
            <Button
              type="text"
              icon={<Ruler size={20} className={`transition-colors ${activePanel === 'measurement' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('measurement')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Annotations" placement="left">
            <Button
              type="text"
              icon={<PenTool size={20} className={`transition-colors ${activePanel === 'annotation' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('annotation')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>

          <Tooltip title="Go To XY" placement="left">
            <Button
              type="text"
              icon={
                <div className="relative">
                  <MapPin size={20} className={`transition-colors ${activePanel === 'gotoXY' ? 'text-primary' : 'text-gray-950 hover:text-primary'}`} />
                  {gotoXYMarkerActive && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </div>
              }
              onClick={() => togglePanel('gotoXY')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Query by Attributes" placement="left">
            <Button
              type="text"
              icon={<Database size={20} className={`transition-colors ${activePanel === 'query-attribute' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('query-attribute')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Buffer Query" placement="left">
            <Button
              type="text"
              icon={<CircleDot size={20} className={`transition-colors ${activePanel === 'query-buffer' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('query-buffer')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>
          <Tooltip title="Spatial Query" placement="left">
            <Button
              type="text"
              icon={<BoxSelect size={20} className={`transition-colors ${activePanel === 'query-spatial' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('query-spatial')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>

          <Tooltip title="WPS Analysis" placement="left">
            <Button
              type="text"
              icon={<Workflow size={20} className={`transition-colors ${activePanel === 'wps-analysis' ? 'text-primary' : 'text-gray-500 hover:text-primary'}`} />}
              onClick={() => togglePanel('wps-analysis')}
              className="flex items-center justify-center hover:bg-gray-50 rounded-xl"
              style={{ width: 42, height: 42 }}
            />
          </Tooltip>



        </div>
      </div>

      {/* Bottom Horizontal Bar */}
      <div className="hidden md:flex h-8 bg-white border-t border-gray-100 items-center justify-between px-6 z-20 shrink-0 text-[11px] text-gray-500 select-none">
        {/* Left: Mouse longitude | latitude | zoom */}
        <div className="flex items-center gap-4">
          {isEditingCoords ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-semibold text-gray-400">Lon:</span>
              <Input
                size="small"
                value={editLon}
                onChange={(e) => setEditLon(e.target.value)}
                className="w-20 font-mono text-[11px]"
                onPressEnter={saveCoords}
              />
              <span className="text-[10px] uppercase font-semibold text-gray-400">Lat:</span>
              <Input
                size="small"
                value={editLat}
                onChange={(e) => setEditLat(e.target.value)}
                className="w-20 font-mono text-[11px]"
                onPressEnter={saveCoords}
              />
              <Button size="small" type="primary" onClick={saveCoords} className="text-[10px] h-5 flex items-center">Save</Button>
              <Button size="small" onClick={() => { isEditingCoordsRef.current = false; setIsEditingCoords(false); }} className="text-[10px] h-5 flex items-center">Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded transition-all" onClick={startEditingCoords} title="Click to edit coordinates">
              <span>
                Longitude: <span ref={lonRef} className="font-mono text-gray-700 font-medium">0.000000°</span>
              </span>
              <span className="text-gray-200">|</span>
              <span>
                Latitude: <span ref={latRef} className="font-mono text-gray-700 font-medium">0.000000°</span>
              </span>
            </div>
          )}

          <span className="text-gray-200">|</span>

          {isEditingZoom ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] uppercase font-semibold text-gray-400">Zoom:</span>
              <Input
                size="small"
                value={editZoom}
                onChange={(e) => setEditZoom(e.target.value)}
                className="w-12 font-mono text-[11px]"
                onPressEnter={saveZoom}
                onBlur={saveZoom}
                autoFocus
              />
            </div>
          ) : (
            <span className="cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded transition-all font-medium" onClick={startEditingZoom} title="Click to edit zoom">
              Zoom: <span className="font-mono text-gray-700 font-medium">{zoomLevel}</span>
            </span>
          )}

          <span className="text-gray-200">|</span>

          {/* Bearing / Rotation in bottom bar */}
          <Popover
            content={renderRotationPopoverContent()}
            trigger={['click']}
            placement="top"
            overlayInnerStyle={{ padding: 6 }}
          >
            <span
              className="cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded transition-all font-medium flex items-center gap-1"
              title="Click to rotate map"
            >
              <Compass
                size={12}
                className={`transition-transform duration-150 ${rotationDeg !== 0 ? 'text-primary' : 'text-gray-400'}`}
                style={{ transform: `rotate(${rotationDeg}deg)` }}
              />
              <span className="text-[10px] uppercase font-semibold text-gray-400">Bearing:</span>
              <span className="font-mono text-gray-700 font-medium">{Math.round(rotationDeg)}°</span>
            </span>
          </Popover>
        </div>

        {/* Right: Scale */}
        <div className="flex items-center gap-2">
          <span>Scale:</span>
          {isEditingScaleText ? (
            <div className="flex items-center gap-1">
              <span className="font-mono text-gray-700">1 : </span>
              <Input
                size="small"
                value={editScaleVal}
                onChange={(e) => setEditScaleVal(e.target.value)}
                className="w-24 font-mono text-[11px]"
                onPressEnter={saveScale}
                onBlur={saveScale}
                autoFocus
                placeholder="Scale value"
              />
            </div>
          ) : (
            <Dropdown menu={{ items: scaleItems }} trigger={['click']} placement="topRight">
              <span className="font-mono text-gray-700 font-medium bg-gray-50 px-2 py-0.5 rounded border border-gray-150 cursor-pointer hover:bg-gray-100 hover:text-primary transition-all flex items-center gap-1">
                {scaleText} <ChevronDown size={10} className="text-gray-400" />
              </span>
            </Dropdown>
          )}
        </div>
      </div>

      {/* Attribute Table — routes to raster coverage view or vector feature table based on layer type */}
      {attributeTableOpen && attributeTableDataset && (
        <div className="fixed bottom-20 md:bottom-[36px] left-0 right-0 md:left-14 md:right-14 z-50 px-4 pointer-events-none">
          <AttributeTable
            key={`${attributeTableDataset.id}-${attributeTableFilterCqls[attributeTableDataset.id] || ''}-${(attributeTableFilterIds[attributeTableDataset.id] || []).join(',')}`}
            datasetId={attributeTableDataset.id}
            datasetName={attributeTableDataset.name}
            layerType={addedLayers.find(l => l.id === attributeTableDataset.id)?.type as any}
            geoserverBase={(user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '')}
            geoserverAuth={user?.geoserverAuth}
            onClose={handleCloseAttributeTable}
            getVisibleFeatureIds={getVisibleFeatureIds}
            onZoomToFeatures={handleZoomToFeaturesFromTable}
            token={token}
            externalSearch={fuzzySearchActive && fuzzySearchLayerId === attributeTableDataset?.id ? fuzzySearchKeywords.join(', ') : undefined}
            onClearExternalSearch={handleClearFuzzySearch}
            initialFilterIds={attributeTableFilterIds[attributeTableDataset.id]}
            onShowSelectedOnlyChange={handleShowSelectedOnlyChange}
            cqlFilter={attributeTableFilterCqls[attributeTableDataset.id]}
            localFeatures={getLocalFeaturesForTable()}
          />
        </div>
      )}

      {/* Label Modal */}
      <Modal
        title="Add Annotation Label"
        open={isLabelModalOpen}
        onOk={handleSaveLabel}
        onCancel={handleCancelLabel}
        okText="Add Label"
        cancelText="Cancel"
        width="min(100% - 32px, 400px)"
        centered
      >
        <div className="py-4">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Label Text
          </label>
          <Input
            value={labelText}
            onChange={(e) => setLabelText(e.target.value.replace(/^\s+/, ''))}
            onBlur={() => setLabelText(labelText.trim())}
            placeholder="Enter text for the label..."
            onPressEnter={handleSaveLabel}
            maxLength={32}
            autoFocus
          />
        </div>
      </Modal>

      {/* Vector Analysis Info Modal */}
      <Modal
        title={<span className="font-extrabold text-gray-800 flex items-center gap-1.5"><Info size={16} className="text-primary" /> {infoModalContent?.title}</span>}
        open={!!infoModalContent}
        onCancel={() => setInfoModalContent(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setInfoModalContent(null)}>
            Close
          </Button>
        ]}
        width="min(100% - 32px, 450px)"
        centered
      >
        <p className="text-xs text-gray-600 leading-relaxed py-3">{infoModalContent?.detail}</p>
      </Modal>

      {/* Rename Modal */}
      <Modal
        title="Edit Map Details"
        open={renameModalOpen}
        onOk={handleSaveRename}
        onCancel={() => setRenameModalOpen(false)}
        confirmLoading={renaming}
        okText="Save"
        cancelText="Cancel"
        width="min(100% - 32px, 520px)"
        centered
      >
        <div className="py-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Map Name
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter map name"
              onPressEnter={handleSaveRename}
              maxLength={32}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Description
            </label>
            <Input.TextArea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Enter map description"
              rows={4}
              maxLength={500}
            />
          </div>
        </div>
      </Modal>

      {/* Add Layer Modal */}
      <Modal
        title={<div className="text-sm font-bold text-gray-800 flex items-center gap-2"><Layers size={18} className="text-primary" /> Add Map Layers</div>}
        open={isAddLayerModalOpen}
        onCancel={() => {
          setIsAddLayerModalOpen(false);
          setModalSearchText('');
          setModalTypeFilter('ALL');
        }}
        footer={null}
        width="min(100% - 32px, 650px)"
        centered
      >
        <div className="py-2 flex flex-col gap-4" style={{ touchAction: 'pan-y' }}>
          <Text type="secondary" className="text-xs">
            Select a GIS dataset from your workspace data store to add it as a visualization layer on the map.
          </Text>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Search dataset name or ID..."
              prefix={<Search size={16} className="text-gray-400" />}
              value={modalSearchText}
              onChange={(e) => setModalSearchText(e.target.value.replace(/^\s+/, ''))}
              onBlur={() => {
                if (modalSearchText) {
                  setModalSearchText(modalSearchText.trim());
                }
              }}
              onPressEnter={() => {
                if (modalSearchText) {
                  setModalSearchText(modalSearchText.trim());
                }
              }}
              allowClear
              className="rounded-xl border-gray-200 h-9 w-full sm:flex-grow"
            />
            <Select
              showSearch
              filterOption={(input, option) => (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
              value={modalTypeFilter}
              onChange={setModalTypeFilter}
              className="w-full sm:w-32 h-9"
              options={[
                { label: 'All Types', value: 'ALL' },
                { label: 'Vector', value: 'VECTOR' },
                { label: 'Raster', value: 'RASTER' },
                { label: 'Layer Group', value: 'GROUP' },
              ]}
            />
          </div>
          <Table
            dataSource={filteredModalDatasets}
            loading={modalLoading}
            rowKey="id"
            pagination={{ pageSize: 5 }}
            size="small"
            columns={[
              {
                title: 'Dataset Name',
                dataIndex: 'name',
                key: 'name',
                render: (text: string, record: any) => {
                  let color = 'blue';
                  const type = record.data_type;
                  if (type === 'RASTER') color = 'green';
                  if (type === 'POINTCLOUD') color = 'purple';
                  if (type === 'GROUP') color = 'gold';
                  return (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-gray-700">{text}</span>
                        <span className="sm:hidden">
                          <Tag color={color} className="text-[8px] font-bold tracking-wider rounded uppercase border-none m-0 px-1 py-0 leading-tight">
                            {type === 'GROUP' ? 'GROUP' : type}
                          </Tag>
                        </span>
                      </div>
                      <span className="block text-[9px] text-gray-400 font-mono">{record.id}</span>
                    </div>
                  );
                },
              },
              {
                title: 'Owner',
                dataIndex: 'owner',
                key: 'owner',
                responsive: ['sm'] as any,
                render: (owner: string) => (
                  <span className="text-xs text-gray-500 font-medium">{owner || 'System'}</span>
                )
              },
              {
                title: 'Type',
                dataIndex: 'data_type',
                key: 'type',
                responsive: ['sm'] as any,
                render: (type: string) => {
                  let color = 'blue';
                  if (type === 'RASTER') color = 'green';
                  if (type === 'POINTCLOUD') color = 'purple';
                  if (type === 'GROUP') color = 'gold';
                  return <Tag color={color} className="text-[9px] font-bold tracking-wider rounded uppercase border-none">{type === 'GROUP' ? 'LAYER GROUP' : type}</Tag>;
                }
              },
              {
                title: 'Action',
                key: 'action',
                align: 'right',
                render: (_: any, record: any) => {
                  const isAlreadyAdded = addedLayers.some(l => l.id === record.id);
                  return (
                    <Button
                      size="small"
                      type={isAlreadyAdded ? 'default' : 'primary'}
                      disabled={isAlreadyAdded}
                      onClick={() => addLayerToMap(record)}
                      className="text-[11px] h-7 rounded-lg font-bold"
                    >
                      {isAlreadyAdded ? 'Added' : 'Add'}
                    </Button>
                  );
                }
              }
            ]}
          />
        </div>
      </Modal>

      <Modal
        title={
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Share2 className="text-blue-500" size={20} />
            <span className="font-bold text-gray-800 text-lg">Share Map Workspace</span>
          </div>
        }
        open={isShareModalOpen}
        onCancel={() => setIsShareModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setIsShareModalOpen(false)} className="rounded-xl px-5">
            Close
          </Button>
        ]}
        width="min(100% - 32px, 500px)"
        className="share-modal"
      >
        <div className="py-4 flex flex-col gap-5">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Shareable Link
            </div>
            <div className="flex gap-2">
              <Input
                readOnly
                value={`${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${typeof window !== 'undefined' ? window.location.host : 'localhost'}${typeof window !== 'undefined' ? window.location.pathname : '/map/2d'}?id=${mapId}`}
                className="bg-gray-50 border-gray-200 rounded-xl"
              />
              <Button
                type="primary"
                onClick={handleCopyLink}
                className="bg-blue-600 hover:bg-blue-700 border-none rounded-xl"
              >
                Copy
              </Button>
            </div>
          </div>
        </div>
      </Modal>


    </div>
  );
}

function Map2DWrapper() {
  const searchParams = useSearchParams();
  const mapId = searchParams.get('id');
  return <Map2DContent key={mapId || 'new'} />;
}

export default function Map2DPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Loading 2D Map Workspace..." />
      </div>
    }>
      <Map2DWrapper />
    </Suspense>
  );
}


