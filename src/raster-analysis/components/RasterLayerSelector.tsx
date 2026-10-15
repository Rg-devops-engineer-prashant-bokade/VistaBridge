// ============================================================================
// Raster Layer Selector Component
//
// Dropdown to select a raster layer from the current map:
// - Shows raster layers that are active on the map
// - If the layer is an in-memory analysis result, loads its cached metadata
// - If it's a published GeoServer coverage, calls getRasterMetadata()
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from 'react';
import { Select } from 'antd';
import { LayerState, RasterMetadata } from '../types/rasterAnalysis';
import { getRasterMetadata } from '../services/rasterMetadata';

interface RasterLayerSelectorProps {
  addedLayers: LayerState[];
  allDatasets?: any[];
  value: string;
  onChange: (layerId: string, metadata: RasterMetadata | null) => void;
  geoserverUrl: string;
  authHeader?: string;
  placeholder?: string;
}

export default function RasterLayerSelector({
  addedLayers,
  value,
  onChange,
  geoserverUrl,
  authHeader,
  placeholder = 'Select raster layer from map'
}: RasterLayerSelectorProps) {

  // Only show raster layers that are currently in the map layer panel
  const rasterLayers = addedLayers.filter(l => l.type === 'RASTER');

  const options = rasterLayers.map(l => ({
    label: l.name || l.id,
    value: l.id
  }));

  // Resolve metadata whenever selected layer changes
  useEffect(() => {
    if (!value) {
      return;
    }

    // Check if the layer is an in-memory analysis result layer from the map
    const selectedLayer = addedLayers.find(l => l.id === value);
    if (selectedLayer && (selectedLayer.rawBuffer || selectedLayer.imageBlob || selectedLayer.imageUrl?.startsWith('blob:') || selectedLayer.id.startsWith('raster_res_'))) {
      const bboxObj = selectedLayer.bbox ? {
        minX: selectedLayer.bbox[0],
        minY: selectedLayer.bbox[1],
        maxX: selectedLayer.bbox[2],
        maxY: selectedLayer.bbox[3],
      } : { minX: -180, minY: -90, maxX: 180, maxY: 90 };

      const inMemoryMeta: RasterMetadata = {
        layerName: selectedLayer.id,
        title: selectedLayer.name || selectedLayer.id,
        nativeCRS: selectedLayer.nativeCRS || 'EPSG:4326',
        bbox: bboxObj,
        latLonBbox: bboxObj,
        rawBuffer: selectedLayer.rawBuffer,
        imageBlob: selectedLayer.imageBlob,
      };

      onChange(value, inMemoryMeta);
      return;
    }

    let isMounted = true;

    getRasterMetadata(value, geoserverUrl, authHeader)
      .then(meta => {
        if (isMounted) {
          onChange(value, meta);
        }
      })
      .catch(err => {
        console.warn('Failed to resolve raster metadata from GeoServer REST:', err);
      });

    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, addedLayers, geoserverUrl, authHeader]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <Select
        showSearch
        value={value || undefined}
        onChange={(val) => onChange(val, null)}
        placeholder={rasterLayers.length === 0 ? 'No raster layers on map — add one first' : placeholder}
        options={options}
        filterOption={(input, option) =>
          (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
        }
        className="w-full"
        notFoundContent={
          <div className="text-xs text-gray-400 py-2 px-1">
            No raster layers in map. Add a raster layer to the map first.
          </div>
        }
      />
    </div>
  );
}
