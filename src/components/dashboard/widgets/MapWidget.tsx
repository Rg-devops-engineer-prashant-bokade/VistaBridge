// ============================================================================
// MapWidget Component (Embedded Dashboard Map)
//
// Displays an interactive OpenLayers map inside a dashboard grid card:
// 1. Loads configured WMS/WFS map layers from GeoServer
// 2. Coordinates with sibling dashboard charts via `useDashboardStore`:
//    - When user pans/zooms this map, broadcasts the new `bbox` so charts
//      update to show statistics for visible features only.
//    - When user clicks a chart slice or bar, highlights the selected features
//      on this map in yellow/orange.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Spin } from 'antd';
import { useDashboardStore } from '@/store/useDashboardStore';
import { useAuthStore } from '@/store/useAuthStore';
import { apiRequest } from '@/lib/api';

export interface MapLayer {
  datasetId: string;
  name: string;
  type?: 'VECTOR' | 'RASTER';
  isRaster?: boolean;
  color?: string;
  opacity: number;
  visible: boolean;
  tileRef?: string;
}

interface Props {
  widgetId: string;
  title?: string;
  layers?: MapLayer[];
}

const GEOSERVER = (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');

// Global cache for dataset metadata
const datasetCache = new Map<string, Promise<any>>();
const fetchDatasetWithCache = (datasetId: string): Promise<any> => {
  if (!datasetId || datasetId === 'undefined') return Promise.resolve({ metadata: {} });
  if (!datasetCache.has(datasetId)) {
    const p = apiRequest(`/datasets/${datasetId}/`).then((res) => {
      if (!res.ok) { datasetCache.delete(datasetId); throw new Error(`HTTP ${res.status}`); }
      return res.json();
    });
    datasetCache.set(datasetId, p);
  }
  return datasetCache.get(datasetId)!;
};

export default function MapWidget({ widgetId, layers = [] }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const olLayersRef = useRef<Record<string, any>>({});
  const highlightLayerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const { setActiveMapDatasetIds, subscribe, updateMapBboxes } = useDashboardStore();

  const isInitialZoomingRef = useRef(layers.length > 0);
  const updateBboxRef = useRef<() => void>(() => {});
  const layersRef = useRef(layers);
  const updateMapBboxesRef = useRef(updateMapBboxes);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    updateMapBboxesRef.current = updateMapBboxes;
  }, [updateMapBboxes]);

  // ── Zoom to all layers using WMS GetCapabilities bbox ───────────────────────
  const zoomToAllLayers = useCallback(async () => {
    if (!mapInstance.current) return;
    if (layers.length === 0) {
      isInitialZoomingRef.current = false;
      if (updateBboxRef.current) updateBboxRef.current();
      useDashboardStore.getState().setMapsSettled(true);
      return;
    }
    try {
      let combined: [number, number, number, number] | null = null;
      for (const layer of layers) {
        try {
          const ds = await fetchDatasetWithCache(layer.datasetId);
          const bbox = ds.metadata?.bbox;
          if (Array.isArray(bbox) && bbox.length === 4) {
            const [minX, minY, maxX, maxY] = bbox;
            combined = combined
              ? [Math.min(combined[0], minX), Math.min(combined[1], minY), Math.max(combined[2], maxX), Math.max(combined[3], maxY)]
              : [minX, minY, maxX, maxY];
          }
        } catch { /* skip */ }
      }
      if (combined) {
        const { fromLonLat } = await import('ol/proj');
        const extent = [...fromLonLat([combined[0], combined[1]]), ...fromLonLat([combined[2], combined[3]])];
        mapInstance.current.getView().fit(extent, {
          padding: [40, 40, 40, 40],
          duration: 800,
          callback: () => {
            // Wait 400ms after 800ms zoom animation completes so map view settles 100%
            setTimeout(() => {
              isInitialZoomingRef.current = false;
              if (updateBboxRef.current) updateBboxRef.current();
              useDashboardStore.getState().setMapsSettled(true);
            }, 400);
          }
        });
      } else {
        isInitialZoomingRef.current = false;
        if (updateBboxRef.current) updateBboxRef.current();
        useDashboardStore.getState().setMapsSettled(true);
      }
    } catch {
      isInitialZoomingRef.current = false;
      if (updateBboxRef.current) updateBboxRef.current();
      useDashboardStore.getState().setMapsSettled(true);
    }
  }, [layers]);

  const hasZoomedRef = useRef(false);

  const visibleLayerIds = useMemo(() => {
    return layers.filter(l => l.visible).map(l => l.datasetId).sort().join(',');
  }, [layers]);

  useEffect(() => {
    const ids = layers.filter(l => l.visible).map(l => l.datasetId);
    setActiveMapDatasetIds(widgetId, ids);
    return () => setActiveMapDatasetIds(widgetId, []);
  }, [widgetId, visibleLayerIds, setActiveMapDatasetIds]);

  // ── Init map ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let dead = false;
    (async () => {
      await import('ol/ol.css');
      const { default: Map } = await import('ol/Map');
      const { default: View } = await import('ol/View');
      const { default: TileLayer } = await import('ol/layer/Tile');
      const { default: OSM } = await import('ol/source/OSM');
      const { fromLonLat, transformExtent } = await import('ol/proj');
      const { defaults } = await import('ol/control');
      const { useAppearanceStore } = await import('@/store/useAppearanceStore');

      if (dead || !mapRef.current) return;

      const appearanceState = useAppearanceStore.getState();
      const activeBasemap = appearanceState.defaultBasemap || 'osm';
      const lat = typeof appearanceState.defaultLatitude === 'number' && !isNaN(appearanceState.defaultLatitude)
        ? appearanceState.defaultLatitude
        : 20.5937;
      const lon = typeof appearanceState.defaultLongitude === 'number' && !isNaN(appearanceState.defaultLongitude)
        ? appearanceState.defaultLongitude
        : 78.9629;
      const initialZoom = typeof appearanceState.defaultZoom === 'number' && !isNaN(appearanceState.defaultZoom)
        ? appearanceState.defaultZoom
        : 4;

      let basemapSource: any = new OSM({ crossOrigin: 'anonymous', wrapX: false });
      if (activeBasemap !== 'osm') {
        try {
          const basemapsConfig = (await import('@/config/basemap.config.json')).default;
          const bm = basemapsConfig.find((item: any) => item.id === activeBasemap);
          if (bm) {
            const { default: XYZ } = await import('ol/source/XYZ');
            basemapSource = new XYZ({
              url: bm.url,
              attributions: bm.attributions || undefined,
              crossOrigin: 'anonymous',
              wrapX: false,
            });
          }
        } catch {}
      }

      // Constrain view to world boundaries in Web Mercator
      const worldExtent = transformExtent([-180, -85.051129, 180, 85.051129], 'EPSG:4326', 'EPSG:3857');

      const map = new Map({
        target: mapRef.current,
        layers: [new TileLayer({ source: basemapSource, zIndex: 0 })],
        view: new View({
          center: fromLonLat([lon, lat]),
          zoom: Math.max(initialZoom, 1),
          minZoom: 1, // Full world map is the max zoom out
          maxZoom: 20,
          extent: worldExtent, // Prevents panning left/right beyond world extent
          constrainOnlyCenter: false, // Ensures entire view extent remains within world boundary
          multiWorld: false, // Disables multi-world wrapping horizontally
          smoothExtentConstraint: true,
        }),
        controls: defaults({ zoom: false, attribution: false }),
      });

      mapInstance.current = map;

      const updateBbox = () => {
        if (!mapInstance.current || isInitialZoomingRef.current) return;
        const map = mapInstance.current;
        map.updateSize();
        const size = map.getSize();
        if (!size || size[0] <= 0 || size[1] <= 0) return;

        const view = map.getView();
        const zoom = view.getZoom() ?? 2;

        try {
          const extent3857 = view.calculateExtent(size);
          const extent4326 = transformExtent(extent3857, 'EPSG:3857', 'EPSG:4326');
          let [minLon, minLat, maxLon, maxLat] = extent4326;

          const lonSpan = Math.abs(maxLon - minLon);

          let currentBbox: [number, number, number, number];

          // If view spans whole world horizontally or reaches edges, publish full world bounds
          if (
            lonSpan >= 350 ||
            (minLon <= -175 && maxLon >= 175) ||
            isNaN(minLon) ||
            isNaN(maxLon) ||
            isNaN(minLat) ||
            isNaN(maxLat)
          ) {
            currentBbox = [-180, -90, 180, 90];
          } else {
            minLon = Math.max(-180, Math.min(180, minLon));
            maxLon = Math.max(-180, Math.min(180, maxLon));
            minLat = Math.max(-90, Math.min(90, minLat));
            maxLat = Math.max(-90, Math.min(90, maxLat));

            if (minLon >= maxLon || minLat >= maxLat) {
              currentBbox = [-180, -90, 180, 90];
            } else {
              currentBbox = [minLon, minLat, maxLon, maxLat];
            }
          }

          console.log('[MapWidget] Published bbox (settled view, zoom:', zoom, 'span:', lonSpan, '):', currentBbox);

          const layerBboxesUpdate: Record<string, [number, number, number, number] | null> = {};
          layersRef.current.filter(l => l.visible).forEach(l => {
            layerBboxesUpdate[l.datasetId] = currentBbox;
            if (l.datasetId.includes(':')) {
              layerBboxesUpdate[l.datasetId.split(':')[1]] = currentBbox;
            }
          });
          updateMapBboxesRef.current(currentBbox, layerBboxesUpdate);
        } catch (err) {
          console.warn('[MapWidget] Failed to calculate extent:', err);
          updateMapBboxesRef.current([-180, -90, 180, 90], {});
        }
      };
      updateBboxRef.current = updateBbox;

      let debounceTimer: NodeJS.Timeout | null = null;
      const scheduleUpdate = (delay = 400) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateBbox, delay);
      };

      map.on('moveend', () => scheduleUpdate(300));

      let resizeObserver: ResizeObserver | null = null;
      if (mapRef.current) {
        resizeObserver = new ResizeObserver(() => {
          if (mapInstance.current) {
            mapInstance.current.updateSize();
          }
        });
        resizeObserver.observe(mapRef.current);
      }

      if (!dead) {
        setReady(true);
        if (layersRef.current.length === 0) {
          isInitialZoomingRef.current = false;
          updateBbox();
          useDashboardStore.getState().setMapsSettled(true);
        }
        setTimeout(() => {
          if (isInitialZoomingRef.current) {
            isInitialZoomingRef.current = false;
            updateBbox();
            useDashboardStore.getState().setMapsSettled(true);
          }
        }, 1800);
      }
    })();

    return () => {
      dead = true;
      mapInstance.current?.setTarget(undefined);
      mapInstance.current = null;
      olLayersRef.current = {};
      highlightLayerRef.current = null;
    };
  }, []);

  // ── Sync WMS layers ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance.current || !ready) return;
    let active = true;

    (async () => {
      const [
        { default: TileLayer },
        { default: TileWMS },
      ] = await Promise.all([
        import('ol/layer/Tile'),
        import('ol/source/TileWMS'),
      ]);

      if (!active || !mapInstance.current) return;
      const map = mapInstance.current;
      const currentIds = new Set(layers.map(l => l.datasetId));

      // Remove layers no longer in the list
      Object.keys(olLayersRef.current).forEach((id) => {
        if (!currentIds.has(id)) {
          map.removeLayer(olLayersRef.current[id]);
          delete olLayersRef.current[id];
        }
      });

      layers.forEach((layer, idx) => {
        const zIndex = idx + 1;

        // Fast-path: just update properties if already added
        if (olLayersRef.current[layer.datasetId]) {
          const ol = olLayersRef.current[layer.datasetId];
          ol.setOpacity(layer.opacity);
          ol.setVisible(layer.visible);
          ol.setZIndex(zIndex);
          return;
        }

        if (!active || !mapInstance.current) return;

        const store = useAuthStore.getState();
        const geoserverAuth = store.user?.geoserverAuth;
        let geoserverBase = (store.user?.geoserverUrl || '').replace(/\/$/, '');
        if (!geoserverBase && typeof window !== 'undefined') {
          const match = document.cookie.match(/geoserver_url=([^;]+)/);
          if (match) {
            geoserverBase = decodeURIComponent(match[1]).replace(/\/$/, '');
          }
        }
        if (!geoserverBase) geoserverBase = GEOSERVER;
        const wmsUrl = `${geoserverBase}/wms`;

        const wmsSource = new TileWMS({
          url: wmsUrl,
          params: {
            LAYERS: layer.datasetId,
            TILED: true,
            FORMAT: 'image/png',
            TRANSPARENT: true,
            VERSION: '1.1.1',  // 1.1.1 uses EPSG codes directly; 1.3.0 swaps lat/lon axis
          },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
          transition: 0,
          wrapX: false,
        });

        // Inject Authorization header for secured GeoServer instances
        if (geoserverAuth) {
          wmsSource.setTileLoadFunction((tile: any, src: string) => {
            const img = tile.getImage() as HTMLImageElement;
            fetch(src, { headers: { Authorization: geoserverAuth } })
              .then((r) => r.blob())
              .then((blob) => { img.src = URL.createObjectURL(blob); })
              .catch(() => tile.setState(3)); // 3 = ERROR
          });
        }

        const olLayer = new TileLayer({
          source: wmsSource,
          opacity: layer.opacity,
          visible: layer.visible,
          zIndex,
        });

        olLayer.set('datasetId', layer.datasetId);
        map.addLayer(olLayer);
        olLayersRef.current[layer.datasetId] = olLayer;
      });

      // Zoom to fit all layers on first load
      if (!hasZoomedRef.current && layers.length > 0) {
        hasZoomedRef.current = true;
        zoomToAllLayers();
      }
    })();

    return () => { active = false; };
  }, [layers, ready, zoomToAllLayers]);

  // ── Chart filter highlight overlay ──────────────────────────────────────────
  const { chartFilterIds, chartFilterDatasetId } = useDashboardStore();
  useEffect(() => {
    if (!ready || !mapInstance.current) return;
    const map = mapInstance.current;
    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }
    if (!chartFilterDatasetId || chartFilterIds.length === 0) return;

    (async () => {
      const { default: VectorLayer } = await import('ol/layer/Vector');
      const { default: VectorSource } = await import('ol/source/Vector');
      const { default: GeoJSON } = await import('ol/format/GeoJSON');
      const { Stroke, Style, Fill, Circle: CircleStyle } = await import('ol/style');

      try {
        const res = await apiRequest(`/datasets/${chartFilterDatasetId}/export/?format=geojson&ids=${chartFilterIds.join(',')}`);
        if (!res.ok || !mapInstance.current) return;
        const geojson = await res.json();
        const source = new VectorSource({
          features: new GeoJSON().readFeatures(geojson, { featureProjection: 'EPSG:3857' }),
        });
        const highlightLayer = new VectorLayer({
          source,
          style: new Style({
            stroke: new Stroke({ color: '#f59e0b', width: 3 }),
            fill: new Fill({ color: 'rgba(245,158,11,0.4)' }),
            image: new CircleStyle({
              radius: 8,
              fill: new Fill({ color: 'rgba(245,158,11,0.6)' }),
              stroke: new Stroke({ color: '#f59e0b', width: 2.5 }),
            }),
          }),
          zIndex: 999,
        });
        mapInstance.current.addLayer(highlightLayer);
        highlightLayerRef.current = highlightLayer;
        const extent = source.getExtent();
        if (extent && isFinite(extent[0])) {
          mapInstance.current.getView().fit(extent, { padding: [60, 60, 60, 60], duration: 500, maxZoom: 18 });
        }
      } catch { /* ignore */ }
    })();
  }, [chartFilterIds, chartFilterDatasetId, ready]);

  // ── Event bus subscription ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribe(widgetId, (event) => {
      if (event.type === 'reset' && mapInstance.current) {
        if (highlightLayerRef.current) {
          mapInstance.current.removeLayer(highlightLayerRef.current);
          highlightLayerRef.current = null;
        }
        mapInstance.current.getView().animate({ center: [0, 0], zoom: 2, duration: 600 });
      } else if (event.type === 'zoom_map_widget' && event.widgetId === widgetId) {
        zoomToAllLayers();
      }
    });
    return unsub;
  }, [widgetId, subscribe, zoomToAllLayers]);

  // ── Keep OL sized to container ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const ro = new ResizeObserver(() => mapInstance.current?.updateSize());
    ro.observe(mapRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <Spin size="small" />
        </div>
      )}
    </div>
  );
}
