/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table,
  Input,
  Button,
  Dropdown,
  Select,
  Checkbox,
  Tooltip,
  Modal,
  notification,
  Tag,
  Divider,
} from 'antd';
import {
  Search,
  Download,
  RefreshCw,
  Maximize2,
  Minimize2,
  ChevronDown,
  X,
  Eye,
  EyeOff,
  Filter,
  SortAsc,
  SortDesc,
  ZoomIn,
  Layers,
} from 'lucide-react';
import { apiRequest } from '@/lib/api';

export interface ZoomToFeaturesPayload {
  bbox: [number, number, number, number];
  featureIds: string[];
}

interface AttributeTableProps {
  datasetId: string;
  datasetName: string;
  layerType?: 'VECTOR' | 'RASTER' | 'POINTCLOUD';
  geoserverBase?: string;
  geoserverAuth?: string;
  onClose: () => void;
  onZoomToFeatures?: (payload: ZoomToFeaturesPayload) => void;
  getVisibleFeatureIds?: () => Promise<string[]>;
  token?: string | null;
  externalSearch?: string;
  onClearExternalSearch?: () => void;
  initialFilterIds?: string[];
  onShowSelectedOnlyChange?: (selectedIds: string[] | null) => void;
  cqlFilter?: string;
  localFeatures?: any[];
}

interface Column {
  name: string;
  type: string;
}

interface PaginationInfo {
  page: number;
  page_size: number;
  total_records: number;
  total_pages: number;
}

interface SortInfo {
  sort_by: string | null;
  sort_order: 'asc' | 'desc';
}

interface FilterValue {
  operator: string;
  value: string;
}

// ============================================================================
// AttributeTable Component
//
// In GIS applications, every vector layer has a "table" behind it (like an Excel sheet)
// containing rows of features and columns of properties (e.g., name, area, population).
//
// This component displays that attribute table in a floating/docked panel at the bottom.
// It supports:
// 1. Viewing vector attributes from the backend or local client-side GeoJSON layers
// 2. Viewing raster coverage metadata (resolution, CRS, bands) via GeoServer WCS
// 3. Sorting by columns, searching text, and filtering by values
// 4. Selecting rows and zooming to their bounding box on the map
// 5. Exporting data to CSV, GeoJSON, KML, or Shapefiles
// ============================================================================

// Validate that IDs are not coordinates
const validateFeatureIds = (ids: string[]): boolean => {
  // Check if any ID looks like a coordinate (contains decimal point)
  const hasCoordinates = ids.some(id => {
    const parsed = parseFloat(id);
    return !isNaN(parsed) && id.includes('.') && Math.abs(parsed) <= 180;
  });

  if (hasCoordinates) {
    console.error('Feature IDs contain coordinate-like values:', ids);
    return false;
  }
  return true;
};

const AttributeTable: React.FC<AttributeTableProps> = ({
  datasetId,
  datasetName,
  layerType,
  geoserverBase,
  geoserverAuth,
  onClose,
  onZoomToFeatures,
  getVisibleFeatureIds,
  token: _token,
  externalSearch,
  onClearExternalSearch,
  initialFilterIds,
  onShowSelectedOnlyChange,
  cqlFilter,
  localFeatures,
}) => {
  // Check if this layer is raster (imagery/grid) or vector (points/lines/polygons)
  const isRaster = layerType === 'RASTER';

  // UI state for loading indicators and table contents
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<Column[]>([]);
  const [data, setData] = useState<any[]>([]);

  // Pagination state (tracks current page, page size, total rows)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    page_size: 100,
    total_records: 0,
    total_pages: 0,
  });

  // Sorting state (which column to sort by and ascending/descending direction)
  const [sort, setSort] = useState<SortInfo>({
    sort_by: null,
    sort_order: 'asc',
  });

  // Search and filter state
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());

  // Selection tracking (indices and actual feature IDs)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>(() => initialFilterIds || []);

  // Panel display toggles (maximized, minimized, show only selected rows)
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showOnlySelected, setShowOnlySelected] = useState(() => !!initialFilterIds?.length && !cqlFilter);
  const [geometryTypes, setGeometryTypes] = useState<Record<string, number>>({});
  const [hideComplexColumns, setHideComplexColumns] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [zoomLoading, setZoomLoading] = useState(false);

  // Notify parent map when "show only selected" changes, so map can highlight or filter them
  useEffect(() => {
    if (onShowSelectedOnlyChange) {
      if (showOnlySelected && selectedFeatureIds.length > 0) {
        onShowSelectedOnlyChange(selectedFeatureIds);
      } else {
        onShowSelectedOnlyChange(null);
      }
    }
  }, [showOnlySelected, selectedFeatureIds, onShowSelectedOnlyChange]);

  // Fetches data either from local client features, GeoServer WCS (for rasters), or backend API
  const fetchData = useCallback(async (
    forceShowOnlySelected?: boolean,
    forceSelectedIds?: string[]
  ) => {
    setLoading(true);
    try {
      // ── LOCAL CLIENT-SIDE FEATURES: read from localFeatures prop ──
      if (localFeatures && localFeatures.length > 0) {
        const colSet = new Set<string>();
        const allRows: any[] = [];

        localFeatures.forEach((f, idx) => {
          const props = f.properties && Object.keys(f.properties).length > 0 
            ? { ...f.properties } 
            : { Feature: `${f.geometry?.type || 'Geometry'} ${idx + 1}` };
            
          Object.keys(props).forEach(k => colSet.add(k));
          allRows.push({
            ogc_fid: f.id || String(idx),
            id: f.id || String(idx),
            ...props
          });
        });

        if (columns.length === 0) {
          const parsedCols = Array.from(colSet).map(c => ({
            name: c,
            type: typeof allRows[0]?.[c] === 'number' ? 'number' : 'string'
          }));
          setColumns(parsedCols);
          setVisibleColumns(new Set(parsedCols.map(c => c.name)));
        }

        // Apply search filter
        let filteredRows = allRows;
        const searchToUse = externalSearch || searchText;
        if (searchToUse) {
          const q = searchToUse.toLowerCase();
          filteredRows = filteredRows.filter(row =>
            Object.entries(row).some(([key, val]) =>
              key !== 'id' && key !== 'ogc_fid' && String(val).toLowerCase().includes(q)
            )
          );
        }

        // Apply sorting
        if (sort.sort_by) {
          const field = sort.sort_by;
          const order = sort.sort_order;
          filteredRows.sort((a, b) => {
            const valA = a[field];
            const valB = b[field];
            if (valA === valB) return 0;
            if (valA == null) return 1;
            if (valB == null) return -1;
            const compare = typeof valA === 'number' && typeof valB === 'number'
              ? valA - valB
              : String(valA).localeCompare(String(valB));
            return order === 'asc' ? compare : -compare;
          });
        }

        const totalRecords = filteredRows.length;
        const pageSize = pagination?.page_size || 100;
        const pageIndex = (pagination?.page || 1) - 1;
        const sliced = filteredRows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

        setData(sliced);
        setPagination(prev => ({
          page: prev?.page || 1,
          page_size: pageSize,
          total_records: totalRecords,
          total_pages: Math.ceil(totalRecords / pageSize)
        }));
        setLoading(false);
        return;
      }

      // ── RASTER: fetch WCS DescribeCoverage and build flat rows ──
      if (isRaster && geoserverBase) {
        const headers: Record<string, string> = {};
        if (geoserverAuth) headers['Authorization'] = geoserverAuth;
        const [workspace] = datasetId.includes(':') ? datasetId.split(':') : ['wcs', datasetId];
        const url = `${geoserverBase}/${workspace}/wcs?service=WCS&version=1.1.1&request=DescribeCoverage&identifiers=${encodeURIComponent(datasetId)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`WCS DescribeCoverage failed: ${res.status}`);
        const xml = await res.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const cov = doc.querySelector('CoverageDescription');
        if (!cov) throw new Error('No CoverageDescription in WCS response');

        const title = cov.querySelector('Title')?.textContent?.trim() || datasetName;
        const srs = (cov.querySelector('GridCRS GridBaseCRS')?.textContent?.trim() || cov.querySelector('BoundingBox')?.getAttribute('crs') || 'Unknown').split('/').pop() || 'Unknown';
        const lc = cov.querySelector('BoundingBox LowerCorner')?.textContent?.trim() || '';
        const uc = cov.querySelector('BoundingBox UpperCorner')?.textContent?.trim() || '';
        const gh = cov.querySelector('GridEnvelope high')?.textContent?.trim() || '';

        const rows: any[] = [
          { property: 'Title', value: title },
          { property: 'Layer ID', value: datasetId },
          { property: 'CRS', value: srs },
          { property: 'Dimensions', value: gh ? `${gh.split(' ').join(' × ')} px` : 'Unknown' },
          { property: 'Bounding Box', value: lc && uc ? `${lc} → ${uc}` : 'Unknown' },
        ];

        const bandEls = Array.from(cov.querySelectorAll('RangeField, Field'));
        const source = bandEls.length > 0 ? bandEls : Array.from(cov.querySelectorAll('SampleDimension'));
        source.forEach((el, i) => {
          const name = el.querySelector('Identifier, Name, Description')?.textContent?.trim() || `Band ${i + 1}`;
          const dataType = el.querySelector('DataType')?.textContent?.trim() || 'Unknown';
          const noData = el.querySelector('NullValue')?.textContent?.trim() || '—';
          const min = el.querySelector('MinimumValue')?.textContent?.trim();
          const max = el.querySelector('MaximumValue')?.textContent?.trim();
          rows.push({ property: `Band ${i + 1} — Name`, value: name });
          rows.push({ property: `Band ${i + 1} — Data Type`, value: dataType });
          rows.push({ property: `Band ${i + 1} — No Data`, value: noData });
          if (min) rows.push({ property: `Band ${i + 1} — Min`, value: min });
          if (max) rows.push({ property: `Band ${i + 1} — Max`, value: max });
        });

        setColumns([{ name: 'property', type: 'string' }, { name: 'value', type: 'string' }]);
        setData(rows);
        setVisibleColumns(new Set(['property', 'value']));
        setPagination(prev => ({
          page: prev?.page || 1,
          page_size: prev?.page_size || 100,
          total_records: rows.length,
          total_pages: 1
        }));
        return;
      }

      // ── VECTOR: fetch from backend API ──
      const params = new URLSearchParams({
        page: (pagination?.page || 1).toString(),
        page_size: (pagination?.page_size || 100).toString(),
      });

      if (sort?.sort_by) {
        params.append('sort_by', sort.sort_by);
        params.append('sort_order', sort.sort_order || 'asc');
      }

      // Use externalSearch as priority, fall back to searchText
      const searchToUse = externalSearch || searchText;
      if (searchToUse) {
        params.append('search', searchToUse);
      }

      // Add filters
      Object.entries(filters).forEach(([key, filter]) => {
        params.append(`filters[${key}__${filter.operator}]`, filter.value);
      });

      const activeShowOnlySelected = forceShowOnlySelected !== undefined ? forceShowOnlySelected : showOnlySelected;
      const activeSelectedFeatureIds = forceSelectedIds !== undefined ? forceSelectedIds : selectedFeatureIds;

      // Show only selected
      if (activeShowOnlySelected && activeSelectedFeatureIds.length > 0) {
        if (!validateFeatureIds(activeSelectedFeatureIds)) {
          console.error('Invalid feature IDs in selection, clearing selection');
          setSelectedFeatureIds([]);
          setSelectedRowKeys([]);
          setShowOnlySelected(false);
          notification.error({
            message: 'Invalid Selection',
            description: 'Feature selection was corrupted. Please select features again.',
            placement: 'topRight',
          });
          return;
        }
        console.log('Fetching with selected IDs:', activeSelectedFeatureIds);
        params.append('ids', activeSelectedFeatureIds.join(','));
      } else if (cqlFilter) {
        console.log('Fetching with CQL filter:', cqlFilter);
        params.append('query_builder', cqlFilter);
      }

      const url = `/datasets/${datasetId}/features/?${params.toString()}`;
      console.log('Fetching features URL:', url);

      const response = await apiRequest(url);

      if (response.ok) {
        const result = await response.json();
        setColumns(result.columns || []);
        setData(result.data || []);
        if (result.pagination) {
          setPagination(result.pagination);
        } else {
          setPagination(prev => ({
            page: prev?.page || 1,
            page_size: prev?.page_size || 100,
            total_records: result.data?.length || 0,
            total_pages: Math.ceil((result.data?.length || 0) / (prev?.page_size || 100)),
          }));
        }
        if (result.sorting) {
          setSort(result.sorting);
        }

        console.log('TABLE DATA', result);

        // Initialize visible columns
        if (visibleColumns.size === 0 && result.columns) {
          const allColumns = result.columns.map((c: Column) => c.name);
          setVisibleColumns(new Set(allColumns));
        }
      } else {
        throw new Error('Failed to fetch attribute data');
      }
    } catch (error: any) {
      notification.error({
        message: 'Error',
        description: error.message || 'Failed to load attribute table data',
        placement: 'topRight',
      });
    } finally {
      setLoading(false);
    }
  }, [
    datasetId,
    datasetName,
    isRaster,
    geoserverBase,
    geoserverAuth,
    cqlFilter,
    columns.length,
    visibleColumns.size,
    pagination,
    sort,
    searchText,
    filters,
    showOnlySelected,
    selectedFeatureIds,
    externalSearch,
    localFeatures
  ]);

  // Reset and load data when dataset changes
  useEffect(() => {
    if (!datasetId) {
      return;
    }
    queueMicrotask(() => {
      setData([]);
      setColumns([]);
      setLoading(true);
      setInitialLoad(true);
      setVisibleColumns(new Set());
      setSelectedRowKeys([]);

      const nextSelected = initialFilterIds || [];
      const nextShowOnly = !!initialFilterIds?.length && !cqlFilter;
      setSelectedFeatureIds(nextSelected);
      setShowOnlySelected(nextShowOnly);

      fetchData(nextShowOnly, nextSelected).then(() => setInitialLoad(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, initialFilterIds, localFeatures]);

  const selectedFeaturesKey = showOnlySelected ? selectedFeatureIds.join(',') : '';

  // Reload data when dependencies change (skip on initial load)
  useEffect(() => {
    if (!initialLoad && columns.length > 0) {
      queueMicrotask(() => {
        fetchData();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pagination?.page,
    pagination?.page_size,
    sort?.sort_by,
    sort?.sort_order,
    searchText,
    filters,
    showOnlySelected,
    selectedFeaturesKey,
    externalSearch
  ]);

  // Clear selections when data changes (except during show selected only mode)
  useEffect(() => {
    if (!showOnlySelected) {
      queueMicrotask(() => {
        setSelectedRowKeys(prev => prev.length > 0 ? [] : prev);
        setSelectedFeatureIds(prev => prev.length > 0 ? [] : prev);
      });
    }
  }, [data, showOnlySelected]);

  // Calculate geometry type distribution (client-side)
  useEffect(() => {
    const types: Record<string, number> = {};
    data.forEach((row) => {
      const geomType = row.geometry_type || 'Unknown';
      types[geomType] = (types[geomType] || 0) + 1;
    });
    queueMicrotask(() => {
      setGeometryTypes(types);
    });
  }, [data]);

  // Handle sort
  const handleSort = (columnName: string) => {
    setSort((prev) => ({
      sort_by: columnName,
      sort_order: prev?.sort_by === columnName && prev?.sort_order === 'asc' ? 'desc' : 'asc',
    }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  // Handle filter
  const handleFilter = useCallback((columnName: string, operator: string, value: string) => {
    if (!value) {
      setFilters((prev) => {
        const newFilters = { ...prev };
        delete newFilters[columnName];
        return newFilters;
      });
    } else {
      setFilters((prev) => ({
        ...prev,
        [columnName]: { operator, value },
      }));
    }
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, []);

  // Handle search
  const handleSearch = (value: string) => {
    setSearchText(value);
    setPagination((prev) => ({ ...prev, page: 1 }));
  };



  // Handle export map extent
  const handleExportMapExtent = async (format: 'csv' | 'geojson' | 'kml' | 'shapefile') => {
    if (!getVisibleFeatureIds) {
      notification.error({
        message: 'Map Integration Missing',
        description: 'Cannot get visible features from map',
        placement: 'topRight',
      });
      return;
    }

    try {
      // Get visible feature IDs from map (now async)
      const visibleIds = await getVisibleFeatureIds();

      if (visibleIds.length === 0) {
        notification.warning({
          message: 'No Features Visible',
          description: 'No features from this layer are currently visible on the map viewport',
          placement: 'topRight',
        });
        return;
      }

      // Confirm export
      Modal.confirm({
        title: 'Export Visible Features',
        content: `Export ${visibleIds.length} visible feature(s) from current map viewport as ${format.toUpperCase()}?`,
        okText: 'Export',
        cancelText: 'Cancel',
        onOk: async () => {
          try {
            await performExport(format, visibleIds, '_visible');
          } catch (error: any) {
            notification.error({
              message: 'Export Failed',
              description: error.message || 'Failed to export visible features',
              placement: 'topRight',
            });
          }
        },
      });

    } catch (error: any) {
      notification.error({
        message: 'Export Failed',
        description: error.message || 'Failed to get visible features',
        placement: 'topRight',
      });
    }
  };

  // Perform export with IDs
  const performExport = async (
    format: 'csv' | 'geojson' | 'kml' | 'shapefile',
    featureIds: string[],
    suffix: string = '_export'
  ) => {
    const params = new URLSearchParams({
      format,
      ids: featureIds.join(',')
    });

    const response = await apiRequest(
      `/datasets/${datasetId}/export/?${params.toString()}`
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Export request failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${datasetName}${suffix}.${format === 'shapefile' ? 'zip' : format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    notification.success({
      message: 'Export Successful',
      description: `${featureIds.length} features exported as ${format.toUpperCase()}`,
      placement: 'topRight',
    });
  };

  // Handle export
  const handleExport = async (format: 'csv' | 'geojson' | 'kml' | 'shapefile') => {
    try {
      // ── Client-side export for local features (e.g. analysis results) ──
      if (localFeatures && localFeatures.length > 0) {
        let exportFeatures = localFeatures;
        if (selectedFeatureIds.length > 0) {
          const selSet = new Set(selectedFeatureIds);
          exportFeatures = exportFeatures.filter((f, idx) => {
            const id = f.id !== undefined ? String(f.id) : String(idx);
            return selSet.has(id);
          });
        }

        let blob: Blob;
        let ext = format === 'shapefile' ? 'geojson' : format;

        if (format === 'csv') {
          const rows = exportFeatures.map((f, idx) => ({
            id: f.id ?? idx + 1,
            ...(f.properties || {})
          }));
          const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
          const csvLines = [
            headers.join(','),
            ...rows.map(r => headers.map(h => {
              const val = r[h] !== undefined ? String(r[h]) : '';
              return `"${val.replace(/"/g, '""')}"`;
            }).join(','))
          ];
          blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
          ext = 'csv';
        } else {
          const fc = {
            type: 'FeatureCollection',
            features: exportFeatures
          };
          blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
          ext = 'geojson';
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${datasetName}_export.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        notification.success({
          message: 'Export Successful',
          description: `${exportFeatures.length} features exported as ${ext.toUpperCase()}`,
          placement: 'topRight',
        });
        return;
      }

      const params = new URLSearchParams({ format });

      if (sort.sort_by) {
        params.append('sort_by', sort.sort_by);
        params.append('sort_order', sort.sort_order);
      }

      // Use externalSearch as priority, fall back to searchText
      const searchToUse = externalSearch || searchText;
      if (searchToUse) {
        params.append('search', searchToUse);
      }

      if (cqlFilter) {
        params.append('query_builder', cqlFilter);
      }

      Object.entries(filters).forEach(([key, filter]) => {
        params.append(`filters[${key}__${filter.operator}]`, filter.value);
      });

      // Use selected IDs if available
      const idsToExport = selectedFeatureIds.length > 0 ? selectedFeatureIds : [];

      if (idsToExport.length > 0) {
        await performExport(format, idsToExport);
      } else {
        // Export all with filters
        const response = await apiRequest(
          `/datasets/${datasetId}/export/?${params.toString()}`
        );

        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${datasetName}_export.${format === 'shapefile' ? 'zip' : format}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);

          notification.success({
            message: 'Export Successful',
            description: `Data exported as ${format.toUpperCase()}`,
            placement: 'topRight',
          });
        } else {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.detail || 'Export failed from server');
        }
      }
    } catch (error: any) {
      notification.error({
        message: 'Export Error',
        description: error.message || 'Failed to export data',
        placement: 'topRight',
      });
    }
  };

  // Handle selection
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
      // Extract actual feature IDs from selected rows (prioritize ogc_fid, fallback to id)
      const featureIds = newSelectedRowKeys.map((key) => {
        const row = data[key as number];
        const id = row?.ogc_fid !== undefined ? row.ogc_fid : row?.id;
        return String(id);
      }).filter(id => id !== undefined && id !== 'undefined');
      console.log('Selected feature IDs:', featureIds);
      setSelectedFeatureIds(featureIds);
    },
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedRowKeys.length === data.length) {
      setSelectedRowKeys([]);
      setSelectedFeatureIds([]);
    } else {
      const allKeys = data.map((_, idx) => idx);
      const allIds = data.map((row) => {
        const id = row?.ogc_fid !== undefined ? row.ogc_fid : row?.id;
        return String(id);
      }).filter(id => id !== undefined && id !== 'undefined');
      setSelectedRowKeys(allKeys);
      setSelectedFeatureIds(allIds);
    }
  };

  // Invert selection
  const invertSelection = () => {
    const allKeys = data.map((_, idx) => idx);
    const newSelection = allKeys.filter((key) => !selectedRowKeys.includes(key));
    const newIds = newSelection.map((key) => {
      const row = data[key as number];
      const id = row?.ogc_fid !== undefined ? row.ogc_fid : row?.id;
      return String(id);
    }).filter(id => id !== undefined && id !== 'undefined');
    setSelectedRowKeys(newSelection);
    setSelectedFeatureIds(newIds);
  };

  // Move selected to top
  const moveSelectedToTop = () => {
    const selectedData = data.filter((_, idx) => selectedRowKeys.includes(idx));
    const unselectedData = data.filter((_, idx) => !selectedRowKeys.includes(idx));
    setData([...selectedData, ...unselectedData]);
    const newKeys = selectedData.map((_, idx) => idx);
    const newIds = selectedData.map((row) => {
      const id = row?.ogc_fid !== undefined ? row.ogc_fid : row?.id;
      return String(id);
    }).filter(id => id !== undefined && id !== 'undefined');
    setSelectedRowKeys(newKeys);
    setSelectedFeatureIds(newIds);
  };

  // Fetch bounding box for features
  const fetchFeatureBoundingBox = async (featureIds: string[]): Promise<[number, number, number, number] | null> => {
    try {
      if (!validateFeatureIds(featureIds)) {
        throw new Error('Invalid feature IDs detected. Please refresh and try again.');
      }

      console.log('Fetching bbox for feature IDs:', featureIds);
      const params = new URLSearchParams({
        ids: featureIds.join(',')
      });

      const url = `/datasets/${datasetId}/features/bbox/?${params.toString()}`;
      console.log('Bbox API URL:', url);

      const response = await apiRequest(url);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch bounding box');
      }

      const result = await response.json();
      console.log('Bbox API response:', result);

      if (!result.bbox) {
        return null;
      }

      return result.bbox as [number, number, number, number];
    } catch (error: any) {
      console.error('Bbox fetch error:', error);
      throw new Error(error.message || 'Failed to retrieve feature bounds');
    }
  };

  // Zoom to selected features
  const handleZoomToSelected = async () => {
    if (selectedFeatureIds.length === 0) {
      notification.warning({
        message: 'No Selection',
        description: 'Please select features to zoom to',
        placement: 'topRight',
      });
      return;
    }

    if (!onZoomToFeatures) {
      notification.warning({
        message: 'Feature Not Available',
        description: 'Map zoom functionality is not available',
        placement: 'topRight',
      });
      return;
    }

    setZoomLoading(true);
    try {
      const bbox = await fetchFeatureBoundingBox(selectedFeatureIds);

      if (!bbox) {
        notification.warning({
          message: 'No Geometry',
          description: 'Selected features have no geometry to zoom to',
          placement: 'topRight',
        });
        return;
      }

      onZoomToFeatures({
        bbox,
        featureIds: selectedFeatureIds,
      });

      notification.success({
        message: 'Zoomed to Features',
        description: `Zoomed to ${selectedFeatureIds.length} selected feature(s)`,
        placement: 'topRight',
        duration: 2,
      });
    } catch (error: any) {
      notification.error({
        message: 'Zoom Failed',
        description: error.message || 'Failed to zoom to selected features',
        placement: 'topRight',
      });
    } finally {
      setZoomLoading(false);
    }
  };

  // Check if value is complex (object/array)
  const isComplexValue = (value: any): boolean => {
    return value !== null && value !== undefined && (typeof value === 'object' || Array.isArray(value));
  };

  // Format complex value for preview
  const formatComplexPreview = (value: any): string => {
    if (Array.isArray(value)) {
      return `Array[${value.length}]`;
    }
    if (typeof value === 'object') {
      return `Object{${Object.keys(value).length}}`;
    }
    return String(value);
  };

  // Show complex value in modal
  const showComplexValue = (columnName: string, value: any) => {
    Modal.info({
      title: columnName,
      content: (
        <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-96">
          {JSON.stringify(value, null, 2)}
        </pre>
      ),
      width: 600,
      okText: 'Close',
    });
  };

  // Determine if column contains complex data
  const isComplexColumn = useCallback((columnName: string): boolean => {
    return data.some(row => isComplexValue(row[columnName]));
  }, [data]);

  // Build table columns
  const tableColumns = useMemo(() => {
    return columns
      .filter((col) => {
        if (!visibleColumns.has(col.name)) return false;
        if (hideComplexColumns && isComplexColumn(col.name)) return false;
        return true;
      })
      .map((col) => {
        const isComplex = isComplexColumn(col.name);

        return {
          title: (
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 min-w-0">
                <span className="font-semibold text-xs truncate">{col.name}</span>
                {isComplex && <Tag color="orange" className="text-[9px] px-1 m-0">JSON Field</Tag>}
              </div>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'sort_asc',
                      label: (
                        <div className="flex items-center gap-2">
                          <SortAsc size={14} />
                          Sort Ascending
                        </div>
                      ),
                      onClick: () => handleSort(col.name),
                      disabled: isComplex,
                    },
                    {
                      key: 'sort_desc',
                      label: (
                        <div className="flex items-center gap-2">
                          <SortDesc size={14} />
                          Sort Descending
                        </div>
                      ),
                      onClick: () => handleSort(col.name),
                      disabled: isComplex,
                    },
                    { type: 'divider' },
                    {
                      key: 'filter',
                      label: 'Filter...',
                      onClick: () => {
                        Modal.confirm({
                          title: `Filter: ${col.name}`,
                          content: (
                            <FilterModal
                              columnName={col.name}
                              columnType={col.type}
                              currentFilter={filters[col.name]}
                              onApply={(operator, value) => {
                                handleFilter(col.name, operator, value);
                              }}
                            />
                          ),
                          okText: 'Apply',
                          width: 400,
                        });
                      },
                      disabled: isComplex,
                    },
                  ],
                }}
                trigger={['click']}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<ChevronDown size={12} />}
                  className="flex items-center"
                />
              </Dropdown>
            </div>
          ),
          dataIndex: col.name,
          key: col.name,
          width: isComplex ? 200 : 150,
          ellipsis: true,
          render: (value: any) => {
            if (value === null || value === undefined) {
              return <span className="text-xs text-gray-400">null</span>;
            }

            if (isComplexValue(value)) {
              return (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-600 font-mono">{formatComplexPreview(value)}</span>
                  <Button
                    type="link"
                    size="small"
                    className="text-xs p-0 h-auto"
                    onClick={() => showComplexValue(col.name, value)}
                  >
                    View
                  </Button>
                </div>
              );
            }

            return <span className="text-xs">{String(value)}</span>;
          },
        };
      });
  }, [columns, visibleColumns, filters, hideComplexColumns, handleFilter, isComplexColumn]);

  // Export menu items
  const exportMenuItems = [
    {
      key: 'csv',
      label: 'Export All to CSV',
      onClick: () => handleExport('csv'),
    },
    {
      key: 'geojson',
      label: 'Export All to GeoJSON',
      onClick: () => handleExport('geojson'),
    },
    {
      key: 'kml',
      label: 'Export All to KML',
      onClick: () => handleExport('kml'),
    },
    {
      key: 'shapefile',
      label: 'Export All to Shapefile',
      onClick: () => handleExport('shapefile'),
    },
    ...(getVisibleFeatureIds ? [
      { type: 'divider' as const },
      {
        key: 'visible-csv',
        label: 'Export Visible Features (CSV)',
        onClick: () => handleExportMapExtent('csv'),
      },
      {
        key: 'visible-geojson',
        label: 'Export Visible Features (GeoJSON)',
        onClick: () => handleExportMapExtent('geojson'),
      },
      {
        key: 'visible-kml',
        label: 'Export Visible Features (KML)',
        onClick: () => handleExportMapExtent('kml'),
      },
      {
        key: 'visible-shapefile',
        label: 'Export Visible Features (Shapefile)',
        onClick: () => handleExportMapExtent('shapefile'),
      },
    ] : []),
  ];

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col overflow-hidden pointer-events-auto ${isMaximized ? 'fixed inset-4 z-50' : isMinimized ? 'h-[48px] w-fit max-w-[420px]' : (externalSearch ? 'h-[500px]' : 'h-[450px]')
        }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers size={16} className="text-primary shrink-0" />
          <span className="font-bold text-sm text-gray-800 truncate">{datasetName}</span>
          <Tag color={isRaster ? 'green' : 'blue'} className="text-[10px] m-0">
            {isRaster ? 'RASTER' : `${pagination.total_records.toLocaleString()} records`}
          </Tag>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip title="Refresh">
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={() => {
                setSelectedRowKeys([]);
                setSelectedFeatureIds([]);
                setShowOnlySelected(false);
                fetchData(false, []);
              }}
              loading={loading}
              disabled={isMinimized}
            />
          </Tooltip>
          <Tooltip title={isMinimized ? 'Restore' : isMaximized ? 'Minimize' : 'Maximize'}>
            <Button
              type="text"
              size="small"
              icon={isMinimized ? <Maximize2 size={14} /> : isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onClick={() => {
                if (isMinimized) {
                  setIsMinimized(false);
                } else {
                  setIsMaximized(!isMaximized);
                }
              }}
            />
          </Tooltip>
          {!isMinimized && (<Tooltip title="Minimize to bar">
            <Button
              type="text"
              size="small"
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>}
              onClick={() => {
                setIsMinimized(!isMinimized);
                if (isMaximized) setIsMaximized(false);
              }}
            />
          </Tooltip>)}
          <Tooltip title="Close">
            <Button type="text" size="small" icon={<X size={14} />} onClick={onClose} />
          </Tooltip>
        </div>
      </div>

      {/* Toolbar */}
      {!isMinimized && (
        <div className="p-2.5 border-b border-gray-200 bg-gray-50 shrink-0">
          {externalSearch && onClearExternalSearch && (
            <div className="w-full flex items-center justify-between px-2 py-1.5 bg-blue-50 border border-blue-200 rounded mb-2">
              <span className="text-xs text-blue-800 font-medium">Filtered by: {externalSearch}</span>
              <Button size="small" type="text" danger onClick={onClearExternalSearch}>Reset Filter</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip title={externalSearch ? "Global search is disabled when fuzzy search filter is active" : ""}>
              <Input
                placeholder={externalSearch ? "Disabled (Fuzzy Search Active)" : "Global search..."}
                prefix={<Search size={14} />}
                value={searchText}
                onChange={(e) => handleSearch(e.target.value)}
                allowClear
                className="w-48"
                size="small"
                disabled={!!externalSearch}
              />
            </Tooltip>

            <Dropdown menu={{ items: exportMenuItems }} trigger={['click']}>
              <Button size="small" icon={<Download size={14} />} disabled={isRaster}>
                Export
              </Button>
            </Dropdown>

            <Dropdown
              menu={{
                items: columns.map((col) => {
                  const isComplex = isComplexColumn(col.name);
                  return {
                    key: col.name,
                    label: (
                      <div className="flex items-center justify-between gap-2 min-w-[200px]">
                        <Checkbox
                          checked={visibleColumns.has(col.name)}
                          onChange={(e) => {
                            const newVisible = new Set(visibleColumns);
                            if (e.target.checked) {
                              newVisible.add(col.name);
                            } else {
                              newVisible.delete(col.name);
                            }
                            setVisibleColumns(newVisible);
                          }}
                        >
                          {col.name}
                        </Checkbox>
                        {isComplex && <Tag color="orange" className="text-[9px] px-1 m-0">JSON Field</Tag>}
                      </div>
                    ),
                  };
                }),
              }}
              trigger={['click']}
            >
              <Button size="small" icon={visibleColumns.size === columns.length ? <Eye size={14} /> : <EyeOff size={14} />}>
                Columns
              </Button>
            </Dropdown>

            <Button
              size="small"
              type={hideComplexColumns ? 'default' : 'primary'}
              onClick={() => setHideComplexColumns(!hideComplexColumns)}
            >
              {hideComplexColumns ? 'Show JSON Fields' : 'Hide JSON Fields'}
            </Button>

            {!isRaster && selectedRowKeys.length > 0 && (
              <>
                <Divider type="vertical" />
                <Tag color="blue">{selectedRowKeys.length} selected</Tag>
                <Button size="small" onClick={toggleSelectAll}>
                  {selectedRowKeys.length === data.length ? 'Deselect All' : 'Select All'}
                </Button>
                <Button size="small" onClick={invertSelection}>
                  Invert
                </Button>
                <Button size="small" onClick={moveSelectedToTop}>
                  Move to Top
                </Button>
                <Button size="small" onClick={() => setShowOnlySelected(!showOnlySelected)} type={showOnlySelected ? 'primary' : 'default'}>
                  {showOnlySelected ? 'Show All' : 'Show Selected Only'}
                </Button>
                {onZoomToFeatures && (
                  <Button
                    size="small"
                    icon={<ZoomIn size={14} />}
                    onClick={handleZoomToSelected}
                    loading={zoomLoading}
                  >
                    Zoom To
                  </Button>
                )}
              </>
            )}

            {!isRaster && Object.keys(geometryTypes).length > 0 && (
              <>
                <Divider type="vertical" />
                <Dropdown
                  menu={{
                    items: Object.entries(geometryTypes).map(([type, count]) => ({
                      key: type,
                      label: `${type}: ${count}`,
                    })),
                  }}
                  trigger={['click']}
                >
                  <Button size="small" icon={<Filter size={14} />}>
                    Geometry Types
                  </Button>
                </Dropdown>
              </>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      {!isMinimized && (
        <div className="flex-1 min-h-0">
          <Table
            columns={tableColumns}
            dataSource={data}
            rowSelection={isRaster ? undefined : rowSelection}
            loading={loading}
            pagination={isRaster ? false : {
              current: pagination?.page || 1,
              pageSize: pagination?.page_size || 100,
              total: pagination?.total_records || 0,
              showSizeChanger: true,
              showTotal: (total) => `Total ${total.toLocaleString()} records`,
              onChange: (page, pageSize) => {
                setPagination((prev) => ({
                  page: page,
                  page_size: pageSize,
                  total_records: prev?.total_records || 0,
                  total_pages: Math.ceil((prev?.total_records || 0) / pageSize)
                }));
              },
              pageSizeOptions: ['10', '50', '100', '500', '1000'],
              size: 'small',
              position: ['bottomCenter'],
            }}
            scroll={{
              x: 'max-content',
              y: isMaximized ? 'calc(100vh - 280px)' : '235px'
            }}
            size="small"
            rowKey={(_, index) => index!}
          />
        </div>
      )}
    </div>
  );
};

// Filter Modal Component
const FilterModal: React.FC<{
  columnName: string;
  columnType: string;
  currentFilter?: FilterValue;
  onApply: (operator: string, value: string) => void;
}> = ({ columnName: _columnName, columnType, currentFilter, onApply }) => {
  const [operator, setOperator] = useState(currentFilter?.operator || 'contains');
  const [value, setValue] = useState(currentFilter?.value || '');

  const operatorOptions =
    columnType === 'integer' || columnType === 'float'
      ? [
        { label: 'Equals', value: 'eq' },
        { label: 'Greater Than', value: 'gt' },
        { label: 'Greater or Equal', value: 'gte' },
        { label: 'Less Than', value: 'lt' },
        { label: 'Less or Equal', value: 'lte' },
      ]
      : [
        { label: 'Contains', value: 'contains' },
        { label: 'Starts With', value: 'startswith' },
        { label: 'Ends With', value: 'endswith' },
        { label: 'Equals', value: 'eq' },
      ];

  useEffect(() => {
    if (currentFilter) {
      onApply(operator, value);
    }
  }, [operator, value, currentFilter, onApply]);

  return (
    <div className="flex flex-col gap-3 py-2">
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Operator</label>
        <Select
          value={operator}
          onChange={setOperator}
          options={operatorOptions}
          className="w-full"
          size="small"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">Value</label>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter filter value..."
          size="small"
        />
      </div>
    </div>
  );
};

export default AttributeTable;




