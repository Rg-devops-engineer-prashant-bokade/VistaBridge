// ============================================================================
// Layer List Panel (2D Map)
//
// Manages the list of active map layers:
// - Toggle visibility (hide/show)
// - Adjust opacity slider
// - Reorder layers (drag or move up/down)
// - Open attribute table, style editor, and view layer legends
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import { Button, Divider, Tooltip, Dropdown, Tag, Checkbox, Slider } from 'antd';
import LegendImage from './LegendImage';
import { useAuthStore } from '@/store/useAuthStore';
import {
  Plus,
  GripVertical,
  FileJson,
  Layers,
  Cloud,
  Folder,
  Maximize,
  Palette,
  Trash2,
  List,
  Sheet
} from 'lucide-react';


interface LayerState {
  id: string;
  name: string;
  type: 'VECTOR' | 'RASTER' | 'POINTCLOUD' | 'GROUP';
  visible: boolean;
  opacity: number;
  labelsEnabled: boolean;
  styles?: Array<{ name: string; title: string; legendUrl: string }>;
  activeStyle?: string;
}

interface LayerStyleData {
  styles: Array<{
    id: string;
    name: string;
    config: any;
    createdAt?: string;
  }>;
  activeStyleId: string;
  opacity?: number;
  labelsEnabled?: boolean;
}

interface LayerListPanel2DProps {
  addedLayers: LayerState[];
  setAddedLayers: React.Dispatch<React.SetStateAction<LayerState[]>>;
  vectorLayerStyles: { [layerId: string]: LayerStyleData };
  setVectorLayerStyles: React.Dispatch<React.SetStateAction<{ [layerId: string]: LayerStyleData }>>;
  draggingIndex: number | null;
  handleDragStart: (e: React.DragEvent, index: number) => void;
  handleDragOver: (e: React.DragEvent, index: number) => void;
  handleDragEnd: () => void;
  setIsAddLayerModalOpen: (open: boolean) => void;
  zoomToLayer: (layerId: string, layerType: string) => void;
  applyVectorLayerStyle: (layerId: string, config: any, labelsEnabled?: boolean) => void;
  handleOpenStyleEditor: (layer: any) => void;
  setAttributeTableDataset: React.Dispatch<React.SetStateAction<{ id: string; name: string } | null>>;
  setAttributeTableOpen: (open: boolean) => void;
  notification: any;
  modal: any;
  token?: string | null;
}

export default function LayerListPanel2D({
  addedLayers,
  setAddedLayers,
  vectorLayerStyles,
  setVectorLayerStyles,
  draggingIndex,
  handleDragStart,
  handleDragOver,
  handleDragEnd,
  setIsAddLayerModalOpen,
  zoomToLayer,
  applyVectorLayerStyle,
  handleOpenStyleEditor: _handleOpenStyleEditor,
  setAttributeTableDataset,
  setAttributeTableOpen,
  notification,
  modal,
  token
}: LayerListPanel2DProps) {
  const { user } = useAuthStore();
  const [expandedLegends, setExpandedLegends] = useState<Record<string, boolean>>({});
  const [expandedOpacity, setExpandedOpacity] = useState<Record<string, boolean>>({});
  const [draggableLayerId, setDraggableLayerId] = useState<string | null>(null);

  const _getActiveStyleConfig = (layerId: string) => {
    const layerStyleData = vectorLayerStyles[layerId];
    if (!layerStyleData) return null;

    const activeStyle = layerStyleData.styles?.find(
      s => s.id === layerStyleData.activeStyleId
    );
    return activeStyle?.config || layerStyleData.styles?.[0]?.config || null;
  };

  const _migrateStyleConfig = (oldConfig: any): LayerStyleData => {
    if (oldConfig && oldConfig.styles && Array.isArray(oldConfig.styles)) {
      return {
        ...oldConfig,
        opacity: oldConfig.opacity ?? 1.0,
        labelsEnabled: oldConfig.labelsEnabled ?? false,
      };
    }
    const defaultStyle = oldConfig || {
      mode: 'single',
      strokeColor: '#ff4d4f',
      strokeWidth: 1.5,
      fillColor: '#ff4d4f',
      fillOpacity: 0.1,
    };
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
      labelsEnabled: false,
    };
  };

  const showLegendModal = (layer: LayerState) => {
    const styleName = layer.activeStyle || '';
    const geoserverBase = (user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');

    if (layer.id.startsWith('wps_result_') || !layer.id.includes(':')) {
      modal.info({
        title: `Legend - ${layer.name}`,
        content: (
          <div className="flex flex-col gap-2 pt-4 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded border border-gray-400/80 bg-gray-400/25 flex items-center justify-center font-bold text-gray-500">v</div>
              <span>Vector Feature Result</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Local vector layer computed dynamically from spatial analysis.</p>
          </div>
        ),
        okText: 'Close',
        icon: null,
        width: 320,
      });
      return;
    }

    const layerParam = layer.id;
    const legendUrl = `${geoserverBase}/wms?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=${encodeURIComponent(layerParam)}&style=${encodeURIComponent(styleName)}`;

    modal.info({
      title: `Legend - ${layer.name}`,
      content: (
        <div className="flex flex-col items-center justify-center p-4 bg-gray-50/50 rounded-xl border border-gray-100/50 mt-4">
          <LegendImage url={legendUrl} notification={notification} />
        </div>
      ),
      okText: 'Close',
      icon: null,
      width: 320,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Layers</div>
        <Button
          type="primary"
          size="small"
          disabled={!token}
          icon={<Plus size={14} />}
          onClick={() => setIsAddLayerModalOpen(true)}
          className="text-[11px] h-7 flex items-center gap-1 rounded-lg font-bold"
        >
          Add Layer
        </Button>
      </div>
      <Divider className="my-0 bg-gray-100" />

      <div className="flex flex-col gap-2">
        {[...addedLayers].reverse().map((layer, revIdx) => {
          const index = addedLayers.length - 1 - revIdx;
          return (
            <div
              key={layer.id}
              draggable={draggableLayerId === layer.id}
              onDragStart={(e) => {
                if (draggableLayerId !== layer.id) {
                  e.preventDefault();
                  return;
                }
                handleDragStart(e, index);
              }}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={() => {
                setDraggableLayerId(null);
                handleDragEnd();
              }}
              className={`flex flex-col gap-2 p-2.5 bg-gray-50 border rounded-xl hover:shadow-sm transition-all ${draggingIndex === index ? 'opacity-40 border-dashed border-blue-500 bg-blue-50/30 scale-[0.98]' : 'border-gray-100'
                }`}
            >
              <div
                className="flex items-center justify-between gap-1.5 min-w-0 w-full cursor-grab active:cursor-grabbing select-none"
                onMouseEnter={() => setDraggableLayerId(layer.id)}
                onMouseLeave={() => {
                  if (draggingIndex === null) {
                    setDraggableLayerId(null);
                  }
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-grow">
                  <GripVertical size={13} className="text-gray-400 shrink-0" />
                  {layer.type === 'VECTOR' ? (
                    <FileJson size={14} className="text-blue-500 shrink-0" />
                  ) : layer.type === 'RASTER' ? (
                    <Layers size={14} className="text-green-500 shrink-0" />
                  ) : layer.type === 'GROUP' ? (
                    <Folder size={14} className="text-amber-500 shrink-0" />
                  ) : (
                    <Cloud size={14} className="text-purple-500 shrink-0" />
                  )}
                  <div className="text-xs font-bold text-gray-700 truncate">{layer.name}</div>
                </div>
                <Tag
                  color={
                    layer.type === 'VECTOR'
                      ? 'blue'
                      : layer.type === 'RASTER'
                        ? 'green'
                        : layer.type === 'GROUP'
                          ? 'gold'
                          : 'purple'
                  }
                  className="text-[9px] font-extrabold tracking-wider px-1 py-0 m-0 border-none rounded uppercase shrink-0"
                >
                  {layer.type === 'VECTOR'
                    ? 'Vector'
                    : layer.type === 'RASTER'
                      ? 'Raster'
                      : layer.type === 'GROUP'
                        ? 'Group'
                        : 'Point Cloud'}
                </Tag>
              </div>

              {/* Layer Operations Icon Row */}
              <div className="no-drag flex items-center gap-1 bg-white border border-gray-100 rounded-lg p-1 justify-start flex-wrap">
                <Tooltip title={layer.visible ? "Hide Layer" : "Show Layer"}>
                  <Checkbox
                    checked={layer.visible}
                    onChange={(e) => {
                      const newVisible = e.target.checked;
                      setAddedLayers(prev => prev.map(l =>
                        l.id === layer.id ? { ...l, visible: newVisible } : l
                      ));

                      const layerInstance = (window as any).vismapLayers?.[layer.id];
                      if (layerInstance && typeof layerInstance.setVisible === 'function') {
                        layerInstance.setVisible(newVisible);
                      }
                    }}
                    className="mr-0.5 ml-1"
                  />
                </Tooltip>

                <Tooltip title="Zoom to all">
                  <Button
                    type="text"
                    size="small"
                    icon={<Maximize size={12} className="text-gray-500" />}
                    onClick={() => zoomToLayer(layer.id, layer.type)}
                    className="flex items-center justify-center hover:bg-gray-50 rounded h-6 w-6"
                  />
                </Tooltip>

                {/* Style Dropdown with GeoServer-defined Styles */}
                <Dropdown
                  menu={{
                    items: (layer.styles || []).map((style: any) => ({
                      key: style.name,
                      label: (
                        <div className="flex items-center justify-between gap-2 min-w-[120px]">
                          <span className="text-xs truncate">{style.title || style.name}</span>
                          {style.name === (layer.activeStyle || '') && (
                            <Tag color="blue" className="text-[9px] m-0 px-1 py-0">Active</Tag>
                          )}
                        </div>
                      ),
                      onClick: () => {
                        setAddedLayers(prev => prev.map(l => l.id === layer.id ? { ...l, activeStyle: style.name } : l));
                        setVectorLayerStyles(prev => ({
                          ...prev,
                          [layer.id]: {
                            ...prev[layer.id],
                            activeStyle: style.name,
                          }
                        }));
                        applyVectorLayerStyle(layer.id, style.name);
                        notification.success({
                          message: 'Style Applied',
                          description: `Applied GeoServer style "${style.title || style.name}" to layer "${layer.name}".`,
                          placement: 'topRight'
                        });
                      }
                    }))
                  }}
                  trigger={['click']}
                  placement="bottomLeft"
                  disabled={!layer.styles || layer.styles.length <= 1}
                >
                  <Tooltip title={layer.styles && layer.styles.length > 1 ? "Select GeoServer Style" : "No other GeoServer styles"}>
                    <Button
                      type="text"
                      size="small"
                      icon={
                        layer.styles && layer.styles.length > 1 ? (
                          <Palette size={12} className="text-blue-500" />
                        ) : (
                          <div className="relative flex items-center justify-center w-3 h-3">
                            <Palette size={12} className="text-gray-400" />
                            <span className="absolute w-[16px] h-[1.5px] bg-gray-400 rotate-45 pointer-events-none" />
                          </div>
                        )
                      }
                      className={layer.styles && layer.styles.length > 1 ? "flex items-center justify-center hover:bg-gray-50 rounded h-6 w-6" : "flex items-center justify-center rounded h-6 w-6 cursor-not-allowed opacity-60"}
                    />
                  </Tooltip>
                </Dropdown>

                {/* {layer.type === 'VECTOR' && (
                  <Tooltip title={layer.labelsEnabled ? "Hide Labels" : "Show Labels"}>
                    <Button
                      type="text"
                      size="small"
                      icon={
                        layer.labelsEnabled ? (
                          <Type size={12} className="text-primary" />
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                            <polyline points="4 7 4 4 20 4 20 7"></polyline>
                            <line x1="9" y1="20" x2="15" y2="20"></line>
                            <line x1="12" y1="4" x2="12" y2="20"></line>
                            <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2"></line>
                          </svg>
                        )
                      }
                      onClick={() => {
                        const newLabelsEnabled = !layer.labelsEnabled;

                        setAddedLayers(prev => prev.map(l =>
                          l.id === layer.id ? { ...l, labelsEnabled: newLabelsEnabled } : l
                        ));
 
                        setVectorLayerStyles(prev => ({
                          ...prev,
                          [layer.id]: {
                            ...prev[layer.id],
                            labelsEnabled: newLabelsEnabled,
                          }
                        }));

                        const styleConfig = getActiveStyleConfig(layer.id);
                        if (styleConfig) {
                          applyVectorLayerStyle(layer.id, styleConfig, newLabelsEnabled);
                        }
                      }}
                      className="flex items-center justify-center hover:bg-gray-50 rounded h-6 w-6"
                    />
                  </Tooltip>
                )} */}

                <Tooltip title={expandedLegends[layer.id] ? "Hide Legend" : "Show Legend"}>
                  <Button
                    type="text"
                    size="small"
                    icon={<List size={12} className={expandedLegends[layer.id] ? "text-blue-500" : "text-gray-500"} />}
                    onClick={() => {
                      setExpandedLegends(prev => ({
                        ...prev,
                        [layer.id]: !prev[layer.id]
                      }));
                    }}
                    className={`flex items-center justify-center rounded h-6 w-6 ${
                      expandedLegends[layer.id] ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  />
                </Tooltip>
                {layer.type === 'VECTOR' && (
                  <Tooltip title="Attribute table">
                    <Button
                      type="text"
                      size="small"
                      icon={<Sheet size={12} className="text-gray-500" />}
                      onClick={() => {
                        setAttributeTableDataset({ id: layer.id, name: layer.name });
                        setAttributeTableOpen(true);
                      }}
                      className="flex items-center justify-center hover:bg-gray-50 rounded h-6 w-6"
                    />
                  </Tooltip>
                )}
                <Divider type="vertical" className="h-4 bg-gray-200 !m-0" />
                <Tooltip title={`Opacity: ${Math.round((layer.opacity ?? 1.0) * 100)}% (Click to adjust)`}>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => {
                      setExpandedOpacity(prev => ({
                        ...prev,
                        [layer.id]: !prev[layer.id]
                      }));
                    }}
                    className={`flex items-center justify-center rounded h-6 px-1 ${
                      expandedOpacity[layer.id] ? 'bg-blue-50 text-blue-600 font-bold' : 'hover:bg-gray-50 text-gray-600'
                    }`}
                    style={{ fontSize: 10, fontWeight: 'bold' }}
                  >
                    {Math.round((layer.opacity ?? 1.0) * 100)}%
                  </Button>
                </Tooltip>


                <Tooltip title="Remove Layer">
                  <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={12} />}
                    onClick={() => {
                      setAddedLayers(prev => prev.filter(l => l.id !== layer.id));

                      const layerInstance = (window as any).vismapLayers?.[layer.id];
                      if (layerInstance) {
                        // Suppress TS compiler checks for window extensions
                        const map: any = (window as any).vismapMapInstance;
                        if (map && typeof map.removeLayer === 'function') {
                          map.removeLayer(layerInstance);
                        }
                        delete (window as any).vismapLayers[layer.id];
                      }

                      setAttributeTableDataset((curr: { id: string; name: string } | null) => {
                        if (curr?.id === layer.id) {
                          setAttributeTableOpen(false);
                          return null;
                        }
                        return curr;
                      });

                      notification.success({
                        message: 'Layer Removed',
                        description: `"${layer.name}" was successfully removed from the map.`,
                        placement: 'topRight'
                      });
                    }}
                    className="flex items-center justify-center hover:bg-red-50 text-red-500 hover:text-red-600 rounded h-6 w-6"
                  />
                </Tooltip>
              </div>

              {/* Inline Opacity Slider */}
              {expandedOpacity[layer.id] && (
                <div
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="no-drag flex items-center gap-2 px-2.5 py-1.5 bg-white border border-gray-100 rounded-lg shadow-2xs select-none"
                >
                  <span className="text-[11px] text-gray-500 font-medium shrink-0">Opacity:</span>
                  <div
                    className="flex-1 my-0 cursor-pointer"
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                  >
                    <Slider
                      min={0}
                      max={100}
                      value={Math.round((layer.opacity ?? 1.0) * 100)}
                      onChange={(val: number) => {
                        const nextOpacity = val / 100;
                        setAddedLayers(prev => prev.map(l =>
                          l.id === layer.id ? { ...l, opacity: nextOpacity } : l
                        ));
                        setVectorLayerStyles(prev => ({
                          ...prev,
                          [layer.id]: {
                            ...prev[layer.id],
                            opacity: nextOpacity,
                          }
                        }));
                        const layerInstance = (window as any).vismapLayers?.[layer.id];
                        if (layerInstance && typeof layerInstance.setOpacity === 'function') {
                          layerInstance.setOpacity(nextOpacity);
                        }
                      }}
                      className="my-0"
                    />
                  </div>
                  <span className="text-[11px] text-gray-700 font-bold shrink-0 w-9 text-right">
                    {Math.round((layer.opacity ?? 1.0) * 100)}%
                  </span>
                </div>
              )}

              {/* Inline Legend */}
              {expandedLegends[layer.id] && (
                <div
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="no-drag p-2.5 bg-white border border-gray-100 rounded-lg flex flex-col items-center justify-center overflow-hidden shadow-2xs select-none"
                >
                  {layer.id.startsWith('wps_result_') || !layer.id.includes(':') ? (
                    <div className="flex flex-col gap-1.5 text-xs text-gray-600 w-full">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded border border-gray-400/80 bg-gray-400/25 flex items-center justify-center font-bold text-[10px] text-gray-500">v</div>
                        <span className="text-[11px] font-medium">Vector Feature Result</span>
                      </div>
                      <p className="text-[10px] text-gray-400">Local vector layer computed dynamically from spatial analysis.</p>
                    </div>
                  ) : (
                    <LegendImage
                      url={`${(user?.geoserverUrl || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '')}/wms?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=${encodeURIComponent(layer.id)}&style=${encodeURIComponent(layer.activeStyle || '')}`}
                      notification={notification}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {addedLayers.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-4">No layers added to map yet.</div>
        )}
      </div>
    </div>
  );
}
