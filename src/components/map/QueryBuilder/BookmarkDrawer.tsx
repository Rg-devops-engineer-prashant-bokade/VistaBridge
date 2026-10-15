// ============================================================================
// Query Bookmarks Drawer (BookmarkDrawer.tsx)
//
// In GIS, users frequently re-run complex filter combinations:
// - Saves combinations of Attribute, Buffer, and Spatial filter conditions
// - Displays saved bookmarks in a sliding side drawer
// - Lets users re-execute a bookmarked query on the active map in one click
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input, Button, Spin, Empty, Tooltip, notification, Drawer } from 'antd';
import { Search, Star, Play, Edit2, Trash2, Save, X, Bookmark } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import type { Bookmark as BookmarkType, BookmarkContent, LayerActiveFilters, LayerState } from './types';

interface BookmarkDrawerProps {
  open: boolean;
  onClose: () => void;
  layers: LayerState[];
  allDatasets?: any[];
  onExecuteBookmark: (
    datasetId: string,
    datasetName: string,
    slots: Partial<LayerActiveFilters>,
    drawnGeometry?: any,
    isComplementary?: boolean,
  ) => void;
  shouldRefresh?: boolean;
}

const SLOT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  attribute: { bg: 'bg-violet-50', text: 'text-violet-700', label: 'Attribute' },
  buffer:    { bg: 'bg-violet-50', text: 'text-violet-700', label: 'Buffer'    },
  spatial:   { bg: 'bg-violet-50', text: 'text-violet-700', label: 'Spatial'   },
  layer:     { bg: 'bg-violet-50', text: 'text-violet-700', label: 'Layer'     },
};

export default function BookmarkDrawer({
  open, onClose, layers, allDatasets: _allDatasets = [], onExecuteBookmark, shouldRefresh,
}: BookmarkDrawerProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBookmarks = useCallback(async (name?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page_size: '100' });
      if (name) params.set('name', name);
      const res = await apiRequest(`/dashboards/bookmarks/?${params}`);
      if (res.ok) {
        const data = await res.json();
        const results: BookmarkType[] = (data.results || data || []);
        setBookmarks(results);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        fetchBookmarks();
      });
    }
  }, [open, shouldRefresh, fetchBookmarks]);

  const handleSearch = (value: string) => {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchBookmarks(value || undefined), 300);
  };

  const handleToggleFavourite = async (bookmark: BookmarkType) => {
    const updatedContent: BookmarkContent = { ...bookmark.content, is_favourite: !bookmark.content.is_favourite };
    setBookmarks(prev => prev.map(b => b.id === bookmark.id ? { ...b, content: updatedContent } : b));
    try {
      const res = await apiRequest(`/dashboards/bookmarks/${bookmark.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ content: updatedContent }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setBookmarks(prev => prev.map(b => b.id === bookmark.id ? bookmark : b));
      notification.error({ message: 'Failed to update favourite', placement: 'topRight' });
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      const res = await apiRequest(`/dashboards/bookmarks/${id}/`, { method: 'DELETE' });
      if (res.ok || res.status === 204) {
        setBookmarks(prev => prev.filter(b => b.id !== id));
        notification.success({ message: `Deleted "${name}"`, placement: 'topRight' });
      } else throw new Error();
    } catch {
      notification.error({ message: 'Failed to delete bookmark', placement: 'topRight' });
    }
  };

  const handleSaveEdit = async (bookmark: BookmarkType) => {
    if (!editName.trim()) return;
    setSavingId(bookmark.id);
    try {
      const res = await apiRequest(`/dashboards/bookmarks/${bookmark.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setBookmarks(prev => prev.map(b => b.id === bookmark.id
          ? { ...b, name: updated.name, description: updated.description } : b));
        setEditingId(null);
      } else throw new Error();
    } catch {
      notification.error({ message: 'Failed to save changes', placement: 'topRight' });
    } finally { setSavingId(null); }
  };

  const handleExecute = (bookmark: BookmarkType) => {
    const content = bookmark.content;
    if (!content?.dataset_id) {
      notification.error({ message: 'Bookmark data is incomplete — missing dataset', placement: 'topRight' });
      return;
    }
    const { dataset_id, dataset_name, slots, drawn_geometry, complementary } = content;
    // Backwards compat: old bookmarks have payload + query_tab instead of slots
    const resolvedSlots: Partial<LayerActiveFilters> = slots ?? (() => {
      const legacy = bookmark.content as any;
      if (!legacy.payload) return {};
      const tab = legacy.query_tab;
      if (tab === 'attribute') return { attribute: legacy.payload };
      if (tab === 'buffer')    return { buffer: legacy.payload };
      if (tab === 'spatial')   return legacy.payload?.layer_filter
        ? { layer: legacy.payload }
        : { spatial: legacy.payload };
      return {};
    })();
    if (Object.keys(resolvedSlots).length === 0) {
      notification.error({ message: 'Bookmark has no filter data to execute', placement: 'topRight' });
      return;
    }
    onClose();
    notification.info({ message: `Executing "${bookmark.name}"`, placement: 'topRight', duration: 2 });
    onExecuteBookmark(dataset_id, dataset_name, resolvedSlots, drawn_geometry, complementary);
  };

  const layerIds = new Set(layers.map(l => l.id));

  const renderSlotPills = (content: BookmarkContent) => {
    // Support both new slots format and legacy payload format
    const slots: Record<string, boolean> = {};
    if (content.slots) {
      if (content.slots.attribute) slots.attribute = true;
      if (content.slots.buffer)    slots.buffer = true;
      if (content.slots.spatial)   slots.spatial = true;
      if (content.slots.layer)     slots.layer = true;
    } else {
      const legacy = content as any;
      if (legacy.query_tab) slots[legacy.query_tab] = true;
    }
    return Object.keys(slots).map(slot => {
      const cfg = SLOT_COLORS[slot] || SLOT_COLORS.attribute;
      return (
        <span key={slot} className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cfg.bg} ${cfg.text}`}>
          {cfg.label}
        </span>
      );
    });
  };

  const renderCard = (bookmark: BookmarkType) => {
    const isOnMap = layerIds.has(bookmark.content?.dataset_id);
    const isEditing = editingId === bookmark.id;

    return (
      <div key={bookmark.id}
        className="flex flex-col gap-2 p-3 bg-white border border-gray-100 rounded-xl hover:shadow-sm transition-all"
      >
        {isEditing ? (
          <>
            <Input size="small" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name *" />
            <Input size="small" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" />
            <div className="flex gap-1">
              <Button size="small" type="primary" icon={<Save size={11} />}
                loading={savingId === bookmark.id}
                onClick={() => handleSaveEdit(bookmark)}
                disabled={!editName.trim()}
              >Save</Button>
              <Button size="small" icon={<X size={11} />} onClick={() => setEditingId(null)}>Cancel</Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2 w-full overflow-hidden">
            {/* Dataset + slot pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5 truncate max-w-[120px]">
                {bookmark.content?.dataset_name || 'Unknown layer'}
              </div>
              {renderSlotPills(bookmark.content)}
              {!isOnMap && (
                <Tooltip title="This layer is not currently on the map">
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                    Not on map
                  </span>
                </Tooltip>
              )}
            </div>

            {/* Name + star */}
            <div className="flex items-start justify-between gap-1">
              <div className="text-sm font-bold text-gray-800 leading-snug flex-1 min-w-0 break-words">
                {bookmark.name}
              </div>
              <Tooltip title={bookmark.content?.is_favourite ? 'Remove from favourites' : 'Add to favourites'}>
                <Button type="text" size="small"
                  icon={<Star size={13} className={bookmark.content?.is_favourite ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'} />}
                  onClick={() => handleToggleFavourite(bookmark)}
                  className="h-6 w-6 flex items-center justify-center shrink-0"
                />
              </Tooltip>
            </div>

            {bookmark.description && (
              <div className="text-xs text-gray-400 leading-snug">{bookmark.description}</div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-1 border-t border-gray-100 mt-0.5">
              <div className="text-[10px] text-gray-300">{new Date(bookmark.updated_at).toLocaleDateString()}</div>
              <div className="flex items-center gap-0.5">
                <Tooltip title="Execute">
                  <Button type="text" size="small" icon={<Play size={12} className="text-green-600" />}
                    onClick={() => handleExecute(bookmark)} className="h-6 w-6 flex items-center justify-center" />
                </Tooltip>
                <Tooltip title="Edit">
                  <Button type="text" size="small" icon={<Edit2 size={12} className="text-gray-400" />}
                    onClick={() => { setEditingId(bookmark.id); setEditName(bookmark.name); setEditDesc(bookmark.description || ''); }}
                    className="h-6 w-6 flex items-center justify-center" />
                </Tooltip>
                <Tooltip title="Delete">
                  <Button type="text" size="small" danger icon={<Trash2 size={12} />}
                    onClick={() => handleDelete(bookmark.id, bookmark.name)}
                    className="h-6 w-6 flex items-center justify-center" />
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const favourites = bookmarks.filter(b => b.content?.is_favourite);
  const others = bookmarks.filter(b => !b.content?.is_favourite);

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <Bookmark size={14} className="text-violet-600" />
          <span className="text-sm font-bold text-gray-800">Saved Bookmarks</span>
        </div>
      }
      placement="right"
      width={325}
      open={open}
      onClose={onClose}
      styles={{
        body: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' },
        mask: { background: 'rgba(15,10,30,0.45)', backdropFilter: 'blur(2px)' },
      }}
      getContainer={false}
      style={{ position: 'absolute' }}
    >
      <Input size="small" placeholder="Search bookmarks..."
        prefix={<Search size={13} className="text-gray-400" />}
        value={searchText} onChange={e => handleSearch(e.target.value)} allowClear
      />

      {loading ? (
        <div className="flex justify-center py-6"><Spin size="small" /></div>
      ) : bookmarks.length === 0 ? (
        <Empty
          description={<span className="text-xs text-gray-400">No bookmarks yet. Run a query and save it.</span>}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto">
          {favourites.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-bold text-yellow-600 uppercase tracking-wider flex items-center gap-1">
                <Star size={10} className="fill-yellow-400 text-yellow-400" /> Favourites
              </div>
              {favourites.map(renderCard)}
            </div>
          )}
          {others.length > 0 && (
            <div className="flex flex-col gap-2">
              {favourites.length > 0 && (
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">All Bookmarks</div>
              )}
              {others.map(renderCard)}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
