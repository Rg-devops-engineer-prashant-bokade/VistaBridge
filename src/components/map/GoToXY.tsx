// ============================================================================
// GoToXY Component (Coordinate Navigation & Bookmarks)
//
// In GIS, users frequently need to navigate directly to precise coordinates:
// - Decimal Degrees (DD): e.g. Latitude 28.6139, Longitude 77.2090
// - Degrees Minutes Seconds (DMS): e.g. 28° 36' 50" N, 77° 12' 32" E
// - Universal Transverse Mercator (UTM): Zone + Easting + Northing in meters
//
// This component parses inputs in any of these systems, converts between them,
// animates the map to that exact location with a pin, and allows users to save
// bookmarks to the SQLite database.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Tabs, Input, Tooltip, Modal, Table, App, Dropdown } from 'antd';
import { Clipboard, Save, Trash2, ArrowRight, Download, Pencil, X, Check, MapPinOff, MoreHorizontal, MapPin } from 'lucide-react';
import { apiRequest } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface GoToXYProps {
  mapId?: string | null;
  currentZoom?: number;
  onGoToLocation: (lon: number, lat: number, zoom?: number) => void;
  onClearMarker: () => void;
  onMapClickRegister: (cb: ((lon: number, lat: number) => void) | null) => void;
  token: string | null;
  activeMarkerCoords: [number, number] | null;
  onShowMarker: (lon: number, lat: number) => void;
}

interface SavedPoint {
  id: number;
  map_id?: string | null;
  name: string;
  latitude: number;
  longitude: number;
  zoom?: number | null;
  username?: string;
}

// ── Pure conversion helpers ────────────────────────────────────────────────

function ddToDms(decimal: number) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = (minFull - min) * 60;
  return { deg: decimal < 0 ? -deg : deg, min, sec };
}

function dmsToDd(deg: number, min: number, sec: number) {
  const sign = deg < 0 ? -1 : 1;
  return sign * (Math.abs(deg) + min / 60 + sec / 3600);
}

function ddToUtm(lon: number, lat: number) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const k0 = 0.9996;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const lon0R = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(latR) ** 2;
  const A = Math.cos(latR) * (lonR - lon0R);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latR -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * latR) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latR) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latR));
  const easting =
    k0 *
    N *
    (A +
      ((1 - T + C) * A ** 3) / 6 +
      ((5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5) / 120) +
    500000;
  const northing =
    k0 *
    (M +
      N *
      Math.tan(latR) *
      (A ** 2 / 2 +
        ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
        ((61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6) / 720));
  return { easting, northing: lat < 0 ? northing + 10000000 : northing, zone };
}

function utmToDd(easting: number, northing: number, zone: number, isNorth: boolean) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  const k0 = 0.9996;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = easting - 500000;
  const y = isNorth ? northing : northing - 10000000;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = (e2 / (1 - e2)) * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
    (D ** 2 / 2 -
      ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * (e2 / (1 - e2))) * D ** 4) / 24 +
      ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * (e2 / (1 - e2)) - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * (e2 / (1 - e2)) + 24 * T1 ** 2) * D ** 5) / 120) /
    Math.cos(phi1);
  return { lon: lon * (180 / Math.PI), lat: lat * (180 / Math.PI) };
}

function isPolarRegion(lat: number) {
  return lat > 84 || lat < -80;
}

function filterNumericInput(val: string, allowNegative: boolean = false, allowDecimal: boolean = true) {
  let cleaned = val;
  if (allowNegative) {
    cleaned = cleaned.replace(/[^0-9.-]/g, '');
    if (cleaned.includes('-')) {
      const isNegative = cleaned.startsWith('-');
      cleaned = (isNegative ? '-' : '') + cleaned.replace(/-/g, '');
    }
  } else {
    cleaned = cleaned.replace(/[^0-9.]/g, '');
  }

  if (allowDecimal) {
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }
  } else {
    cleaned = cleaned.replace(/\./g, '');
  }

  return cleaned;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function GoToXY({
  mapId,
  currentZoom,
  onGoToLocation,
  onClearMarker,
  onMapClickRegister,
  token,
  activeMarkerCoords,
  onShowMarker
}: GoToXYProps) {
  const { notification } = App.useApp();
  const [activeTab, setActiveTab] = useState<'DD' | 'DMS' | 'UTM' | 'Export'>('DD');
  const [dd, setDd] = useState({ lon: '', lat: '' });
  const [dms, setDms] = useState({ lonDeg: '', lonMin: '', lonSec: '', latDeg: '', latMin: '', latSec: '' });
  const [utm, setUtm] = useState({ easting: '', northing: '', zone: '' });

  const [errors, setErrors] = useState({ lon: '', lat: '' });
  const [savedPoints, setSavedPoints] = useState<SavedPoint[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  const isSyncingRef = useRef(false);
  const isUserTypingRef = useRef(false);

  // ── Map click registration ───────────────────────────────────────────────

  useEffect(() => {
    onMapClickRegister((lon, lat) => {
      if (isUserTypingRef.current) return;
      isSyncingRef.current = true;
      const lonStr = lon.toFixed(6);
      const latStr = lat.toFixed(6);
      setDd({ lon: lonStr, lat: latStr });
      const lonDms = ddToDms(lon);
      const latDms = ddToDms(lat);
      setDms({
        lonDeg: String(lonDms.deg), lonMin: String(lonDms.min), lonSec: lonDms.sec.toFixed(4),
        latDeg: String(latDms.deg), latMin: String(latDms.min), latSec: latDms.sec.toFixed(4),
      });
      const utmVal = ddToUtm(lon, lat);
      setUtm({ easting: utmVal.easting.toFixed(2), northing: utmVal.northing.toFixed(2), zone: String(utmVal.zone) });
      setErrors({ lon: '', lat: '' });
      isSyncingRef.current = false;
    });
    return () => onMapClickRegister(null);
  }, [onMapClickRegister]);

  const loadSavedPoints = useCallback(async () => {
    setExportLoading(true);
    setExportError(false);
    try {
      const url = mapId
        ? `/advanced-tools/goto-xy/?map_id=${encodeURIComponent(mapId)}&page_size=100`
        : '/advanced-tools/goto-xy/?page_size=100';
      const res = await apiRequest(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSavedPoints(data.results ?? data);
    } catch {
      setExportError(true);
    } finally {
      setExportLoading(false);
    }
  }, [mapId]);

  useEffect(() => {
    if (token) {
      queueMicrotask(() => {
        loadSavedPoints();
      });
    }
  }, [token, loadSavedPoints]);

  // ── Validation ───────────────────────────────────────────────────────────

  function validateDd(): { lon: number; lat: number } | null {
    const lon = parseFloat(dd.lon);
    const lat = parseFloat(dd.lat);
    const errs = { lon: '', lat: '' };
    if (isNaN(lon) || lon < -180 || lon > 180) errs.lon = 'Longitude must be -180 to 180';
    if (isNaN(lat) || lat < -90 || lat > 90) errs.lat = 'Latitude must be -90 to 90';
    setErrors(errs);
    if (errs.lon || errs.lat) return null;
    return { lon, lat };
  }

  function isDdValid() {
    const lon = parseFloat(dd.lon);
    const lat = parseFloat(dd.lat);
    return !isNaN(lon) && lon >= -180 && lon <= 180 && !isNaN(lat) && lat >= -90 && lat <= 90;
  }

  // ── Sync helpers ─────────────────────────────────────────────────────────

  function syncFromDd(lon: number, lat: number) {
    const lonDms = ddToDms(lon);
    const latDms = ddToDms(lat);
    setDms({
      lonDeg: String(lonDms.deg), lonMin: String(lonDms.min), lonSec: lonDms.sec.toFixed(4),
      latDeg: String(latDms.deg), latMin: String(latDms.min), latSec: latDms.sec.toFixed(4),
    });
    if (!isPolarRegion(lat)) {
      const utmVal = ddToUtm(lon, lat);
      setUtm({ easting: utmVal.easting.toFixed(2), northing: utmVal.northing.toFixed(2), zone: String(utmVal.zone) });
    }
  }

  function handleDdBlur() {
    if (isSyncingRef.current) return;
    const coords = validateDd();
    if (!coords) return;
    isSyncingRef.current = true;
    syncFromDd(coords.lon, coords.lat);
    isSyncingRef.current = false;
  }

  function handleDmsBlur() {
    if (isSyncingRef.current) return;
    const lonDeg = parseFloat(dms.lonDeg) || 0;
    const lonMin = Math.min(59, Math.max(0, parseFloat(dms.lonMin) || 0));
    const lonSec = Math.min(59.9999, Math.max(0, parseFloat(dms.lonSec) || 0));
    const latDeg = parseFloat(dms.latDeg) || 0;
    const latMin = Math.min(59, Math.max(0, parseFloat(dms.latMin) || 0));
    const latSec = Math.min(59.9999, Math.max(0, parseFloat(dms.latSec) || 0));
    setDms({ lonDeg: String(lonDeg), lonMin: String(lonMin), lonSec: String(lonSec), latDeg: String(latDeg), latMin: String(latMin), latSec: String(latSec) });
    const lon = dmsToDd(lonDeg, lonMin, lonSec);
    const lat = dmsToDd(latDeg, latMin, latSec);
    isSyncingRef.current = true;
    setDd({ lon: lon.toFixed(6), lat: lat.toFixed(6) });
    setErrors({ lon: '', lat: '' });
    if (!isPolarRegion(lat)) {
      const utmVal = ddToUtm(lon, lat);
      setUtm({ easting: utmVal.easting.toFixed(2), northing: utmVal.northing.toFixed(2), zone: String(utmVal.zone) });
    }
    isSyncingRef.current = false;
  }

  function handleUtmBlur() {
    if (isSyncingRef.current) return;
    const easting = parseFloat(utm.easting);
    const northing = parseFloat(utm.northing);
    const zone = parseInt(utm.zone);
    if (isNaN(easting) || isNaN(northing) || isNaN(zone)) return;
    if (zone < 1 || zone > 60) { setErrors(e => ({ ...e, lon: 'Zone must be 1–60' })); return; }
    if (easting < 100000 || easting > 900000) { setErrors(e => ({ ...e, lon: 'Easting must be 100000–900000' })); return; }
    if (northing < 0 || northing > 10000000) { setErrors(e => ({ ...e, lat: 'Northing must be 0–10000000' })); return; }
    const coords = utmToDd(easting, northing, zone, northing < 10000000);
    isSyncingRef.current = true;
    setDd({ lon: coords.lon.toFixed(6), lat: coords.lat.toFixed(6) });
    setErrors({ lon: '', lat: '' });
    const lonDms = ddToDms(coords.lon);
    const latDms = ddToDms(coords.lat);
    setDms({
      lonDeg: String(lonDms.deg), lonMin: String(lonDms.min), lonSec: lonDms.sec.toFixed(4),
      latDeg: String(latDms.deg), latMin: String(latDms.min), latSec: latDms.sec.toFixed(4),
    });
    isSyncingRef.current = false;
  }

  // ── Export tab ───────────────────────────────────────────────────────────

  function handleTabChange(key: string) {
    setActiveTab(key as any);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function handleCopy() {
    if (!isDdValid()) return;
    let text = '';
    if (activeTab === 'DD') text = `${dd.lon}, ${dd.lat}`;
    else if (activeTab === 'DMS') text = `${dms.lonDeg}°${dms.lonMin}'${dms.lonSec}"  ${dms.latDeg}°${dms.latMin}'${dms.latSec}"`;
    else if (activeTab === 'UTM') text = `${utm.easting} ${utm.northing} Zone ${utm.zone}`;
    navigator.clipboard.writeText(text);
  }

  function resetAll() {
    setDd({ lon: '', lat: '' });
    setDms({ lonDeg: '', lonMin: '', lonSec: '', latDeg: '', latMin: '', latSec: '' });
    setUtm({ easting: '', northing: '', zone: '' });
    setErrors({ lon: '', lat: '' });
    onClearMarker();
  }

  function handleSave() {
    if (!isDdValid()) return;
    const lon = parseFloat(dd.lon);
    const lat = parseFloat(dd.lat);
    let name = '';
    const capturedZoom = currentZoom !== undefined && !isNaN(currentZoom) ? Math.round(currentZoom * 10) / 10 : undefined;

    Modal.confirm({
      title: 'Save Point',
      content: (
        <div className="flex flex-col gap-2">
          <Input
            defaultValue={`Point ${savedPoints.length + 1}`}
            onChange={(e) => { name = e.target.value; }}
            placeholder={`Point ${savedPoints.length + 1}`}
          />
          {capturedZoom !== undefined && (
            <div className="text-[11px] text-gray-500">
              Saving with current map zoom: <span className="font-mono font-bold text-primary">{capturedZoom}</span>
            </div>
          )}
        </div>
      ),
      onOk: async () => {
        const finalName = name.trim() || `Point ${savedPoints.length + 1}`;
        try {
          const res = await apiRequest('/advanced-tools/goto-xy/', {
            method: 'POST',
            body: JSON.stringify({
              map_id: mapId || null,
              name: finalName,
              latitude: lat,
              longitude: lon,
              zoom: capturedZoom ?? null
            }),
          });
          if (!res.ok) {
            throw new Error('Failed to save point to the server.');
          }
          loadSavedPoints();
          resetAll();
          notification.success({
            message: 'Point Saved',
            description: `"${finalName}" saved at ${lat.toFixed(6)}, ${lon.toFixed(6)}${capturedZoom !== undefined ? ` (Zoom: ${capturedZoom})` : ''}.`,
            placement: 'topRight',
          });
        } catch (err: any) {
          notification.error({
            message: 'Save Failed',
            description: err.message || 'Could not save the location point.',
            placement: 'topRight',
          });
        }
      },
    });
  }

  function handleClear() {
    resetAll();
  }

  function handleShow() {
    const coords = validateDd();
    if (!coords) return;
    onShowMarker(coords.lon, coords.lat);
  }

  function handleGo() {
    const coords = validateDd();
    if (!coords) return;
    onGoToLocation(coords.lon, coords.lat, currentZoom);
  }

  async function handleRenamePoint(id: number) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    await apiRequest(`/advanced-tools/goto-xy/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed }),
    });
    setSavedPoints(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
    setEditingId(null);
  }

  function handleDeletePoint(id: number) {
    const point = savedPoints.find(p => p.id === id);
    Modal.confirm({
      title: 'Delete Point',
      content: `Are you sure you want to delete "${point?.name}"?`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        await apiRequest(`/advanced-tools/goto-xy/${id}/`, { method: 'DELETE' });
        setSavedPoints(prev => prev.filter(p => p.id !== id));
        notification.success({
          message: 'Point Deleted',
          description: `"${point?.name}" has been deleted.`,
          placement: 'topRight',
        });
      },
    });
  }

  function handleCsvDownload() {
    const rows = [
      ['Sr.No', 'Name', 'Latitude', 'Longitude', 'Zoom'],
      ...savedPoints.map((p, i) => [i + 1, p.name, p.latitude, p.longitude, p.zoom ?? ''])
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `goto_xy_points_${mapId || 'export'}.csv`;
    a.click();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        size="small"
        items={[
          {
            key: 'DD',
            label: 'DD',
            children: (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-gray-400">
                  Enter decimal degrees. Example: DD -73.816623, 18.638469
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Longitude</label>
                  <Input
                    value={dd.lon}
                    placeholder="73.856917"
                    onChange={e => { isUserTypingRef.current = true; const val = filterNumericInput(e.target.value, true, true); setDd(d => ({ ...d, lon: val })); }}
                    onBlur={() => { isUserTypingRef.current = false; handleDdBlur(); }}
                    status={errors.lon ? 'error' : ''}
                  />
                  {errors.lon && <div className="text-[10px] text-red-500">{errors.lon}</div>}
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Latitude</label>
                  <Input
                    value={dd.lat}
                    placeholder="18.569022"
                    onChange={e => { isUserTypingRef.current = true; const val = filterNumericInput(e.target.value, true, true); setDd(d => ({ ...d, lat: val })); }}
                    onBlur={() => { isUserTypingRef.current = false; handleDdBlur(); }}
                    status={errors.lat ? 'error' : ''}
                  />
                  {errors.lat && <div className="text-[10px] text-red-500">{errors.lat}</div>}
                </div>
              </div>
            ),
          },
          {
            key: 'DMS',
            label: 'DMS',
            children: (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-gray-400">
                  Example: DMS 73°48&apos;59.84&quot;E 18°38&apos;18.48&quot;N
                </div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase">Longitude</label>
                <div className="flex gap-1">
                  {(['lonDeg', 'lonMin', 'lonSec'] as const).map((f, i) => (
                    <Input key={f} value={(dms as any)[f]} placeholder={['Deg', 'Min', 'Sec'][i]}
                      onChange={e => {
                        isUserTypingRef.current = true;
                        const allowNegative = f === 'lonDeg';
                        const val = filterNumericInput(e.target.value, allowNegative, true);
                        setDms(d => ({ ...d, [f]: val }));
                      }}
                      onBlur={() => { isUserTypingRef.current = false; handleDmsBlur(); }}
                    />
                  ))}
                </div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase">Latitude</label>
                <div className="flex gap-1">
                  {(['latDeg', 'latMin', 'latSec'] as const).map((f, i) => (
                    <Input key={f} value={(dms as any)[f]} placeholder={['Deg', 'Min', 'Sec'][i]}
                      onChange={e => {
                        isUserTypingRef.current = true;
                        const allowNegative = f === 'latDeg';
                        const val = filterNumericInput(e.target.value, allowNegative, true);
                        setDms(d => ({ ...d, [f]: val }));
                      }}
                      onBlur={() => { isUserTypingRef.current = false; handleDmsBlur(); }}
                    />
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: 'UTM',
            label: 'UTM',
            children: (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-gray-400">
                  Example: UTM 375176 2061237
                </div>
                {isPolarRegion(parseFloat(dd.lat)) && (
                  <div className="text-[11px] text-orange-500 font-medium">
                    ⚠ Polar region — UTM not reliable above 84°N or below 80°S.
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Easting</label>
                  <Input value={utm.easting} placeholder="375176"
                    onChange={e => { isUserTypingRef.current = true; const val = filterNumericInput(e.target.value, false, true); setUtm(u => ({ ...u, easting: val })); }}
                    onBlur={() => { isUserTypingRef.current = false; handleUtmBlur(); }}
                    status={(errors.lon && !errors.lon.includes('Zone')) ? 'error' : ''}
                  />
                  {errors.lon && !errors.lon.includes('Zone') && <div className="text-[10px] text-red-500">{errors.lon}</div>}
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Northing</label>
                  <Input value={utm.northing} placeholder="2061237"
                    onChange={e => { isUserTypingRef.current = true; const val = filterNumericInput(e.target.value, false, true); setUtm(u => ({ ...u, northing: val })); }}
                    onBlur={() => { isUserTypingRef.current = false; handleUtmBlur(); }}
                    status={errors.lat ? 'error' : ''}
                  />
                  {errors.lat && <div className="text-[10px] text-red-500">{errors.lat}</div>}
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-500 uppercase">Zone</label>
                  <Input value={utm.zone} placeholder="43"
                    onChange={e => { isUserTypingRef.current = true; const val = filterNumericInput(e.target.value, false, false); setUtm(u => ({ ...u, zone: val })); }}
                    onBlur={() => { isUserTypingRef.current = false; handleUtmBlur(); }}
                    status={(errors.lon && errors.lon.includes('Zone')) ? 'error' : ''}
                  />
                  {errors.lon && errors.lon.includes('Zone') && <div className="text-[10px] text-red-500">{errors.lon}</div>}
                </div>
              </div>
            ),
          },
          {
            key: 'Export',
            label: 'Export',
            disabled: savedPoints.length === 0,
            children: (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-gray-400">
                  Export saved coordinate locations to a CSV file.
                </div>
                <Button size="small" icon={<Download size={13} />} onClick={handleCsvDownload} disabled={savedPoints.length === 0} className="w-full flex items-center justify-center gap-1">
                  Download CSV
                </Button>
              </div>
            ),
          },
        ]}
      />
      {activeTab !== 'Export' && (
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
          <Button size="small" icon={<Clipboard size={12} />} onClick={handleCopy} disabled={!isDdValid()} className="w-full flex items-center justify-center gap-1">Copy</Button>
          <Button size="small" icon={<Save size={12} />} onClick={handleSave} disabled={!isDdValid()} className="w-full flex items-center justify-center gap-1">Save</Button>
          {activeMarkerCoords !== null ? (
            <Button size="small" icon={<Trash2 size={12} />} onClick={handleClear} className="w-full flex items-center justify-center gap-1">Clear</Button>
          ) : (
            <Button size="small" icon={<MapPin size={12} />} onClick={handleShow} disabled={!isDdValid()} className="w-full flex items-center justify-center gap-1">Show</Button>
          )}
          <Button size="small" type="primary" icon={<ArrowRight size={12} />} onClick={handleGo} disabled={!isDdValid()} className="w-full flex items-center justify-center gap-1">Go</Button>
        </div>
      )}

      <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700">Saved Locations</span>
        </div>
        {exportLoading && <div className="text-xs text-gray-400 text-center py-4">Loading saved locations...</div>}
        {exportError && (
          <div className="flex flex-col items-center gap-2 py-4">
            <div className="text-xs text-red-500">Failed to load saved locations.</div>
            <Button size="small" onClick={loadSavedPoints}>Retry</Button>
          </div>
        )}
        {!exportLoading && !exportError && (
          <>
            {savedPoints.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-4 bg-gray-50/50 rounded-xl border border-dashed border-gray-100">No saved points yet.</div>
            ) : (
              <div className="flex flex-col gap-1">
                <Table
                  size="small"
                  pagination={false}
                  dataSource={savedPoints.map((p, i) => ({ ...p, srNo: i + 1 }))}
                  rowKey="id"
                  expandable={{
                    expandedRowKeys: editingId !== null ? [editingId] : [],
                    showExpandColumn: false,
                    expandedRowRender: (record: SavedPoint) => (
                      <div className="flex items-center gap-2 py-1 px-1">
                        <Input
                          size="small"
                          autoFocus
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onPressEnter={() => handleRenamePoint(record.id)}
                          className="flex-1"
                        />
                        <Button size="small" type="primary" icon={<Check size={13} />} onClick={() => handleRenamePoint(record.id)} />
                        <Button size="small" icon={<X size={13} />} onClick={() => setEditingId(null)} />
                      </div>
                    ),
                  }}
                  columns={[
                    { title: '#', dataIndex: 'srNo', width: 22, onHeaderCell: () => ({ style: { padding: '6px 2px', textAlign: 'center' } }), onCell: () => ({ style: { padding: '6px 2px', textAlign: 'center' } }) },
                    { title: 'Name', dataIndex: 'name', ellipsis: true, onHeaderCell: () => ({ style: { padding: '6px 4px' } }), onCell: () => ({ style: { padding: '6px 4px' } }), render: (text: string) => <Tooltip title={text}>{text}</Tooltip> },
                    { title: 'Lat', dataIndex: 'latitude', width: 62, onHeaderCell: () => ({ style: { padding: '6px 4px' } }), onCell: () => ({ style: { padding: '6px 4px' } }), render: (v: number) => <span className="tabular-nums font-mono text-[10px]">{Number(v).toFixed(4)}</span> },
                    { title: 'Lon', dataIndex: 'longitude', width: 62, onHeaderCell: () => ({ style: { padding: '6px 4px' } }), onCell: () => ({ style: { padding: '6px 4px' } }), render: (v: number) => <span className="tabular-nums font-mono text-[10px]">{Number(v).toFixed(4)}</span> },
                    { title: 'Zoom', dataIndex: 'zoom', width: 44, onHeaderCell: () => ({ style: { padding: '6px 2px', textAlign: 'center' } }), onCell: () => ({ style: { padding: '6px 2px', textAlign: 'center' } }), render: (z: number) => z !== undefined && z !== null ? <span className="tabular-nums font-mono text-[10px] text-primary font-medium">{z}</span> : <span className="text-gray-300 text-[10px]">—</span> },
                    {
                      title: '', key: 'actions', width: 26, onHeaderCell: () => ({ style: { padding: '6px 2px' } }), onCell: () => ({ style: { padding: '6px 2px' } }),
                      render: (_: any, record: SavedPoint) => {
                        const isThisMarkerActive = activeMarkerCoords !== null &&
                          Math.abs(activeMarkerCoords[0] - record.longitude) < 0.00001 &&
                          Math.abs(activeMarkerCoords[1] - record.latitude) < 0.00001;
                        return (
                          <Dropdown
                            trigger={['click']}
                            menu={{
                              items: [
                                { key: 'fly', label: 'Fly to', icon: <ArrowRight size={13} />, onClick: () => onGoToLocation(record.longitude, record.latitude, record.zoom ?? undefined) },
                                { key: 'rename', label: 'Rename', icon: <Pencil size={13} />, onClick: () => { setEditingId(record.id); setEditingName(record.name); } },
                                isThisMarkerActive ? (
                                   { key: 'clear', label: 'Clear marker', icon: <MapPinOff size={13} />, onClick: onClearMarker }
                                ) : (
                                  { key: 'show', label: 'Show marker', icon: <MapPin size={13} />, onClick: () => onShowMarker(record.longitude, record.latitude) }
                                ),
                                { type: 'divider' },
                                { key: 'delete', label: 'Delete', icon: <Trash2 size={13} />, danger: true, onClick: () => handleDeletePoint(record.id) },
                              ],
                            }}
                          >
                            <Button size="small" type="text" icon={<MoreHorizontal size={14} />} style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
                          </Dropdown>
                        );
                      },
                    },
                  ]}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
