// ============================================================================
// Appearance & Customization Settings Page (/accounts/appearance)
//
// Administrative styling console:
// - Upload custom product logo
// - Configure primary theme colors and branding name
// - Set default map center coordinates, initial zoom, and default basemap
// - Customize login screen wallpaper image, headline, and subtitle
// ============================================================================

'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Typography, Card, Input, Button, App, Divider, Spin, Tag, InputNumber, Modal, Tooltip } from 'antd';
import { useRouter } from 'next/navigation';
import {
  Palette,
  Upload as UploadIcon,
  Trash2,
  RotateCcw,
  Check,
  Image as ImageIcon,
  Building2,
  ShieldCheck,
  Globe,
  MapPin,
  Navigation,
  Compass,
  ZoomIn,
  LogIn,
  Eye,
  EyeOff,
  Plus,
  Lock,
  User,
  ExternalLink,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/store/useAuthStore';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { siteConfig } from '@/config/site-config';
import basemapsConfig from '@/config/basemap.config.json';

const { Title, Text } = Typography;
const { TextArea } = Input;

type TabKey = 'map' | 'logo' | 'theme' | 'login';

export default function AppearancePage() {
  const router = useRouter();
  const { notification } = App.useApp();
  const { token, hydrated, user } = useAuthStore();
  const {
    customLogo,
    productName,
    primaryColor,
    defaultBasemap,
    defaultLatitude,
    defaultLongitude,
    defaultZoom,
    loginHeadline,
    loginSubtitle,
    loginBgUrl,
    loginQuote,
    geoserverUrl,
    setCustomLogo,
    setProductName,
    setPrimaryColor,
    setDefaultBasemap,
    setDefaultLatitude,
    setDefaultLongitude,
    setDefaultZoom,
    setLoginHeadline,
    setLoginSubtitle,
    setLoginBgUrl,
    setLoginQuote,
    resetAppearance,
    fetchAppearance,
  } = useAppearanceStore();

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<TabKey>('map');

  // Form states
  const [localName, setLocalName] = useState('');
  const [localLogo, setLocalLogo] = useState<string | null>(null);
  const [localColor, setLocalColor] = useState('#0284c7');
  const [localBasemap, setLocalBasemap] = useState('osm');
  const [localLat, setLocalLat] = useState<number>(20.5937);
  const [localLon, setLocalLon] = useState<number>(78.9629);
  const [localZoom, setLocalZoom] = useState<number>(4);
  const [localHeadline, setLocalHeadline] = useState('Precision Geospatial Intelligence for All');
  const [localSubtitle, setLocalSubtitle] = useState('Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.');
  const [localBgUrl, setLocalBgUrl] = useState('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop');
  const [localQuote, setLocalQuote] = useState('Data is the new geography.');
  const connectedGeoserverUrl =
    user?.geoserverUrl ||
    geoserverUrl ||
    process.env.NEXT_PUBLIC_GEOSERVER_URL ||
    'http://localhost:8080/geoserver';

  interface BasemapItem {
    id: string;
    name: string;
    url: string;
    desc?: string;
    description?: string;
    thumbnail?: string;
    attributions?: string;
    isCustom?: boolean;
  }

  const [customBasemaps, setCustomBasemaps] = useState<BasemapItem[]>([]);
  const [isAddBasemapModalOpen, setIsAddBasemapModalOpen] = useState(false);
  const [newBasemapName, setNewBasemapName] = useState('');
  const [newBasemapUrl, setNewBasemapUrl] = useState('');
  const [newBasemapDesc, setNewBasemapDesc] = useState('');
  const [newBasemapThumbnail, setNewBasemapThumbnail] = useState('');
  const [newBasemapAttributions, setNewBasemapAttributions] = useState('');
  const [addingBasemap, setAddingBasemap] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loginImageInputRef = useRef<HTMLInputElement>(null);

  const presetColors = [
    { name: 'Ocean Blue', hex: '#0284c7' },
    { name: 'Electric Indigo', hex: '#6366f1' },
    { name: 'Emerald Green', hex: '#10b981' },
    { name: 'Royal Purple', hex: '#8b5cf6' },
    { name: 'Sunset Amber', hex: '#f59e0b' },
    { name: 'Crimson Rose', hex: '#f43f5e' },
    { name: 'Teal Cyan', hex: '#0d9488' },
    { name: 'Midnight Slate', hex: '#0f172a' },
  ];

  const wallpaperPresets = [
    {
      name: 'NASA Blue Marble',
      url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
      desc: 'High-res illuminated orbit view',
    },
    {
      name: 'Dark Space Satellite',
      url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?q=80&w=2070&auto=format&fit=crop',
      desc: 'Deep atmospheric horizon and starlight',
    },
    {
      name: 'Orbital Night Grid',
      url: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=2072&auto=format&fit=crop',
      desc: 'City lights and global transport corridors',
    },
    {
      name: 'Cyber Matrix Topo',
      url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?q=80&w=2070&auto=format&fit=crop',
      desc: 'Modern digital mesh and geospatial nodes',
    },
  ];

  useEffect(() => {
    fetchAppearance(user?.geoserverUrl);
  }, [fetchAppearance, user?.geoserverUrl]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setLocalName(productName || '');
      setLocalLogo(customLogo || null);
      setLocalColor(primaryColor || '#0284c7');
      setLocalBasemap(defaultBasemap || 'osm');
      setLocalLat(typeof defaultLatitude === 'number' ? defaultLatitude : 20.5937);
      setLocalLon(typeof defaultLongitude === 'number' ? defaultLongitude : 78.9629);
      setLocalZoom(typeof defaultZoom === 'number' ? defaultZoom : 4);
      setLocalHeadline(loginHeadline || 'Precision Geospatial Intelligence for All');
      setLocalSubtitle(loginSubtitle || 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.');
      setLocalBgUrl(loginBgUrl || 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop');
      setLocalQuote(loginQuote || 'Data is the new geography.');
    });
    return () => {
      active = false;
    };
  }, [
    productName,
    customLogo,
    primaryColor,
    defaultBasemap,
    defaultLatitude,
    defaultLongitude,
    defaultZoom,
    loginHeadline,
    loginSubtitle,
    loginBgUrl,
    loginQuote,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    const isAdmin = user?.role === 'ADMIN' || user?.username === 'admin';
    if (!isAdmin) {
      notification.warning({
        message: 'Access Restricted',
        description: 'Appearance settings are only visible and accessible by administrators.',
        placement: 'topRight',
      });
      router.replace('/overview');
    }
  }, [hydrated, token, user, router, notification]);

  // Load any custom basemaps created by user
  useEffect(() => {
    if (!token) return;
    fetch('/api/basemaps', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setCustomBasemaps(data);
      })
      .catch(() => { });
  }, [token]);

  const handleAddCustomBasemap = async () => {
    const trimmedName = newBasemapName.trim();
    const trimmedUrl = newBasemapUrl.trim();

    if (!trimmedName) {
      notification.warning({ message: 'Validation Error', description: 'Please enter a name for the basemap.' });
      return;
    }
    if (!trimmedUrl) {
      notification.warning({ message: 'Validation Error', description: 'Please enter a tile URL template (e.g. https://.../{z}/{x}/{y}.png).' });
      return;
    }

    setAddingBasemap(true);
    try {
      const res = await fetch('/api/basemaps', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: trimmedName,
          url: trimmedUrl,
          description: newBasemapDesc.trim(),
          thumbnail: newBasemapThumbnail.trim(),
          attributions: newBasemapAttributions.trim(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to add basemap.');
      }

      const newBm = await res.json();
      setCustomBasemaps((prev) => [...prev, newBm]);
      setLocalBasemap(newBm.id);
      notification.success({ message: 'Success', description: `Basemap "${newBm.name}" added successfully and selected.` });

      // Reset form
      setNewBasemapName('');
      setNewBasemapUrl('');
      setNewBasemapDesc('');
      setNewBasemapThumbnail('');
      setNewBasemapAttributions('');
      setIsAddBasemapModalOpen(false);
    } catch (err: any) {
      notification.error({ message: 'Error', description: err.message || 'Failed to add basemap.' });
    } finally {
      setAddingBasemap(false);
    }
  };

  const handleDeleteCustomBasemap = async (e: React.MouseEvent, bmId: string, bmName: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/basemaps/${bmId}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to delete basemap.');
      }

      setCustomBasemaps((prev) => prev.filter((b) => b.id !== bmId));
      if (localBasemap === bmId) {
        setLocalBasemap('osm');
      }
      notification.success({ message: 'Success', description: `Basemap "${bmName}" deleted.` });
    } catch (err: any) {
      notification.error({ message: 'Error', description: err.message || 'Failed to delete basemap.' });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notification.error({
        message: 'Invalid File',
        description: 'Please upload an image file (PNG, JPG, SVG, WebP).',
        placement: 'topRight',
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      notification.error({
        message: 'File Too Large',
        description: 'Image size should be less than 2MB.',
        placement: 'topRight',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setLocalLogo(base64);
      setCustomLogo(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleLoginImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      notification.error({
        message: 'Invalid File',
        description: 'Please upload an image file (PNG, JPG, WebP).',
        placement: 'topRight',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      notification.error({
        message: 'File Too Large',
        description: 'Image size should be less than 5MB.',
        placement: 'topRight',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setLocalBgUrl(base64);
      notification.success({
        message: 'Custom Wallpaper Loaded',
        description: 'Uploaded wallpaper image is ready. Click Save to apply.',
        placement: 'topRight',
      });
    };
    reader.readAsDataURL(file);
  };

  const handleColorChange = (hex: string) => {
    setLocalColor(hex);
    setPrimaryColor(hex);
  };

  const handleDetectLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      notification.warning({
        message: 'Geolocation Not Supported',
        description: 'Your browser or device does not support automatic location detection.',
      });
      return;
    }
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(4));
        const lon = parseFloat(pos.coords.longitude.toFixed(4));
        setLocalLat(lat);
        setLocalLon(lon);
        setLocalZoom(11);
        setDetectingLocation(false);
        notification.success({
          message: 'Location Detected',
          description: `Coordinates set to [${lat}°, ${lon}°] at zoom level 11.`,
        });
      },
      (err) => {
        setDetectingLocation(false);
        notification.error({
          message: 'Location Detection Failed',
          description: err.message || 'Could not retrieve device location. Please enter coordinates manually.',
        });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };



  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmedName = localName.trim().slice(0, 20);
      const res = await fetch('/api/config/appearance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          customLogo: localLogo,
          productName: trimmedName,
          primaryColor: localColor,
          defaultBasemap: localBasemap,
          defaultLatitude: typeof localLat === 'number' ? localLat : 20.5937,
          defaultLongitude: typeof localLon === 'number' ? localLon : 78.9629,
          defaultZoom: typeof localZoom === 'number' ? localZoom : 4,
          loginHeadline: localHeadline,
          loginSubtitle: localSubtitle,
          loginBgUrl: localBgUrl,
          loginQuote: localQuote,
          geoserverUrl: connectedGeoserverUrl,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setProductName(data.productName);
      setCustomLogo(data.customLogo);
      setPrimaryColor(data.primaryColor);
      setDefaultBasemap(data.defaultBasemap);
      setDefaultLatitude(data.defaultLatitude);
      setDefaultLongitude(data.defaultLongitude);
      setDefaultZoom(data.defaultZoom);
      setLoginHeadline(data.loginHeadline);
      setLoginSubtitle(data.loginSubtitle);
      setLoginBgUrl(data.loginBgUrl);
      setLoginQuote(data.loginQuote);

      // Re-sync appearance store to ensure consistent state across the entire app
      await fetchAppearance(connectedGeoserverUrl);

      notification.success({
        message: 'Settings Saved Successfully',
        description: 'Branding, theme, basemap defaults, and login styling have been updated.',
        placement: 'topRight',
      });
    } catch (err: any) {
      notification.error({
        message: 'Save Failed',
        description: err.message || 'Could not save appearance settings to the database.',
        placement: 'topRight',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const defaultColor = siteConfig.colors.primary || '#0284c7';
    try {
      await fetch('/api/config/appearance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          resetToDefault: true,
          geoserverUrl: connectedGeoserverUrl,
        }),
      });
      resetAppearance();
      await fetchAppearance(connectedGeoserverUrl);
      setLocalName('');
      setLocalLogo(null);
      setLocalColor(defaultColor);
      setLocalBasemap('osm');
      setLocalLat(20.5937);
      setLocalLon(78.9629);
      setLocalZoom(4);
      setLocalHeadline('Precision Geospatial Intelligence for All');
      setLocalSubtitle('Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.');
      setLocalBgUrl('https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop');
      setLocalQuote('Data is the new geography.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      notification.info({
        message: 'Appearance Reset',
        description: 'Restored default VistaBridge branding, theme, basemap, and login layout.',
        placement: 'topRight',
      });
    } catch (err: any) {
      notification.error({
        message: 'Reset Failed',
        description: err.message || 'Could not reset appearance.',
        placement: 'topRight',
      });
    }
  };

  const isAdmin = user?.role === 'ADMIN' || user?.username === 'admin';

  if (!hydrated || !user || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" />
      </div>
    );
  }

  const allBasemaps: BasemapItem[] = [
    ...basemapsConfig.map((b) => ({ ...b, isCustom: false })),
    ...customBasemaps.map((b) => ({ ...b, desc: b.desc || b.description, isCustom: true })),
  ];
  const selectedBasemapObj = allBasemaps.find((bm) => bm.id === localBasemap) || allBasemaps[0];

  const navigationTabs = [
    {
      key: 'map' as TabKey,
      label: 'Map & Basemap',
      icon: <Globe size={15} />,
      badge: selectedBasemapObj?.name || 'OSM',
    },
    {
      key: 'logo' as TabKey,
      label: 'Logo & Branding',
      icon: <Building2 size={15} />,
      badge: localName ? localName.slice(0, 10) : undefined,
    },
    {
      key: 'theme' as TabKey,
      label: 'Color Theme',
      icon: <Palette size={15} />,
      colorDot: localColor,
    },
    {
      key: 'login' as TabKey,
      label: 'Login Page',
      icon: <LogIn size={15} />,
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-[1.25rem] sm:space-y-[1.5rem] animate-in fade-in slide-in-from-bottom-[1rem] duration-700 pb-[5rem]">
        {/* Header Block */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex flex-col gap-[0.25rem]">
            <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-wider mb-1">
              <Palette size={14} />
              <span>Platform Customization Suite</span>
            </div>
            <Title level={2} className="!m-0 !text-[1.125rem] sm:!text-[1.375rem] md:!text-[1.625rem] font-black text-gray-900 tracking-tight">
              Appearance & Platform Configuration
            </Title>
            <Text className="text-[0.75rem] sm:text-[0.875rem] text-gray-400 font-medium">
              Manage company logo, theme colors, default map view, basemap layer, and login screen customization.
            </Text>
          </div>

          <div className="flex items-center gap-2">
            <Tag color="gold" className="px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 border-none shadow-xs">
              <ShieldCheck size={14} />
              <span>Admin Workspace Access</span>
            </Tag>
          </div>
        </div>

        {/* Modern Segmented Navigation Toggle Bar */}
        <div className="bg-white/80 backdrop-blur-md p-1.5 rounded-2xl border border-gray-200/80 shadow-xs flex items-center gap-1.5 overflow-x-auto">
          {navigationTabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all whitespace-nowrap cursor-pointer ${isActive
                  ? 'bg-primary text-white shadow-sm scale-[1.01]'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/70'
                  }`}
              >
                <span className={isActive ? 'text-white' : 'text-primary'}>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.colorDot && (
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-white shadow-xs inline-block"
                    style={{ backgroundColor: tab.colorDot }}
                  />
                )}
                {tab.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ─── TAB 1: MAP FUNCTIONALITY & BASEMAP ─────────────────────────────────── */}
        {activeTab === 'map' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Default Basemap & Initial Map View Card */}
            <Card
              variant="borderless"
              title={
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                    <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                      <Globe size={16} />
                    </div>
                    <span>Default Basemap & Initial Map View</span>
                  </div>
                </div>
              }
              className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
              styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
            >
              <div className="space-y-6">
                {/* Basemap Selection Grid */}
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                    <div>
                      <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest ml-[0.25rem]">
                        Default Basemap Selection
                      </label>
                      <Text className="text-[11px] text-gray-400 block ml-[0.25rem] mt-0.5">
                        Choose which map layer loads by default when any new map is created.
                      </Text>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tag color="blue" className="rounded-full text-[11px] font-semibold px-2.5 py-0.5 border-none">
                        Active: {selectedBasemapObj?.name || localBasemap}
                      </Tag>
                      {isAdmin && (
                        <Button
                          type="primary"
                          size="small"
                          icon={<Plus size={13} />}
                          onClick={() => setIsAddBasemapModalOpen(true)}
                          className="rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1"
                        >
                          Add Custom Basemap
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                    {allBasemaps.map((bm) => {
                      const isSelected = localBasemap === bm.id;
                      return (
                        <div
                          key={bm.id}
                          onClick={() => {
                            if (isAdmin) setLocalBasemap(bm.id);
                          }}
                          className={`relative flex flex-col p-3 rounded-2xl border-2 transition-all cursor-pointer ${isSelected
                            ? 'border-primary bg-primary/[0.04] shadow-md ring-2 ring-primary/20 scale-[1.01]'
                            : 'border-gray-200/80 hover:border-gray-300 hover:bg-gray-50/50 bg-white'
                            } ${!isAdmin ? 'opacity-80 cursor-not-allowed' : ''}`}
                        >
                          <div className="relative w-full h-24 rounded-xl overflow-hidden bg-gray-100 border border-gray-200/60 mb-2.5 flex items-center justify-center">
                            {bm.id === 'none' ? (
                              <div className="flex flex-col items-center gap-1 text-gray-400">
                                <EyeOff size={24} />
                                <span className="text-[10px] font-medium">No Background</span>
                              </div>
                            ) : bm.thumbnail ? (
                              <img
                                src={bm.thumbnail}
                                alt={bm.name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <Globe size={24} className="text-gray-300" />
                            )}
                            {isSelected && (
                              <div className="absolute top-2 right-2 bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center shadow-md animate-in zoom-in-50 duration-200">
                                <Check size={13} strokeWidth={3} />
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-1">
                            <span className={`text-[12px] font-bold ${isSelected ? 'text-primary' : 'text-gray-800'}`}>
                              {bm.name}
                            </span>
                            <div className="flex items-center gap-1">
                              {bm.isCustom && (
                                <span className="text-[9px] uppercase px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded font-bold border border-amber-200/60">
                                  Custom
                                </span>
                              )}
                              {bm.isCustom && isAdmin && (
                                <Tooltip title="Delete custom basemap">
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteCustomBasemap(e, bm.id, bm.name)}
                                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                          <span className="text-[11px] text-gray-400 line-clamp-1 mt-0.5 font-normal">
                            {bm.desc || 'Standard tile layer provider'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Divider className="my-2 border-gray-100" />

                {/* Coordinates Inputs & Zoom Level */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest ml-[0.25rem]">
                        Initial Map Center Coordinates & Zoom Level
                      </label>
                      <Text className="text-[11px] text-gray-400 block ml-[0.25rem] mt-0.5">
                        Define default camera center focus and zoom level applied on map initialization.
                      </Text>
                    </div>
                    {isAdmin && (
                      <Button
                        size="small"
                        icon={<Navigation size={12} className={detectingLocation ? 'animate-spin' : ''} />}
                        loading={detectingLocation}
                        onClick={handleDetectLocation}
                        className="rounded-lg text-xs font-semibold border-primary/30 text-primary hover:text-primary hover:border-primary"
                      >
                        Detect Current Location
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Latitude */}
                    <div className="p-3.5 bg-gray-50/70 border border-gray-200/80 rounded-2xl">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                          <MapPin size={13} className="text-primary" />
                          <span>Latitude (°N/S)</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-mono">-90 to +90</span>
                      </div>
                      <InputNumber
                        min={-90}
                        max={90}
                        step={0.0001}
                        value={localLat}
                        disabled={!isAdmin}
                        onChange={(val) => setLocalLat(val ?? 0)}
                        className="w-full rounded-xl border-gray-200 font-mono font-bold text-[13px] h-10 flex items-center"
                        placeholder="20.5937"
                      />
                      <span className="text-[10px] text-gray-400 block mt-1">Positive for North, Negative for South</span>
                    </div>

                    {/* Longitude */}
                    <div className="p-3.5 bg-gray-50/70 border border-gray-200/80 rounded-2xl">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                          <Compass size={13} className="text-primary" />
                          <span>Longitude (°E/W)</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-mono">-180 to +180</span>
                      </div>
                      <InputNumber
                        min={-180}
                        max={180}
                        step={0.0001}
                        value={localLon}
                        disabled={!isAdmin}
                        onChange={(val) => setLocalLon(val ?? 0)}
                        className="w-full rounded-xl border-gray-200 font-mono font-bold text-[13px] h-10 flex items-center"
                        placeholder="78.9629"
                      />
                      <span className="text-[10px] text-gray-400 block mt-1">Positive for East, Negative for West</span>
                    </div>

                    {/* Zoom Level */}
                    <div className="p-3.5 bg-gray-50/70 border border-gray-200/80 rounded-2xl">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                          <ZoomIn size={13} className="text-primary" />
                          <span>Initial Zoom</span>
                        </label>
                        <span className="text-[10px] text-gray-400 font-mono">1 to 20</span>
                      </div>
                      <InputNumber
                        min={1}
                        max={20}
                        step={1}
                        value={localZoom}
                        disabled={!isAdmin}
                        onChange={(val) => setLocalZoom(val ?? 4)}
                        className="w-full rounded-xl border-gray-200 font-mono font-bold text-[13px] h-10 flex items-center"
                        placeholder="4"
                      />
                      <span className="text-[10px] text-gray-400 block mt-1">2 = World, 5 = Country, 12 = City</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ─── TAB 2: LOGO & BRANDING ────────────────────────────────────────────── */}
        {activeTab === 'logo' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1.25rem] sm:gap-[1.5rem]">
              {/* Product Name Card */}
              <Card
                variant="borderless"
                title={
                  <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                    <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                      <Building2 size={16} />
                    </div>
                    <span>Company / Product Name</span>
                  </div>
                }
                className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
                styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">
                      Product Name
                    </label>
                    <Input
                      value={localName}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        const val = e.target.value.slice(0, 20);
                        setLocalName(val);
                        setProductName(val);
                      }}
                      placeholder="e.g. Urban Geospatial Suite"
                      maxLength={20}
                      suffix={<span className="text-[11px] text-gray-400 font-mono">{localName.length}/20</span>}
                      className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] bg-gray-50/50 hover:bg-gray-100/50 focus:bg-white focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-semibold"
                    />
                    <Text className="text-[11px] text-gray-400 block mt-2">
                      Maximum 20 characters. Displayed in the top navigation bar and login screen header.
                    </Text>
                  </div>

                  {localName && (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 flex items-center justify-between">
                      <span className="text-xs text-gray-700 font-medium">Displaying: <strong>{localName}</strong></span>
                      {isAdmin && (
                        <Button
                          type="text"
                          size="small"
                          onClick={() => {
                            setLocalName('');
                            setProductName('');
                          }}
                          className="text-xs text-gray-400 hover:text-red-500"
                        >
                          Clear Name
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Card>

              {/* Custom Logo Card */}
              <Card
                variant="borderless"
                title={
                  <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                    <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                      <ImageIcon size={16} />
                    </div>
                    <span>Company / Product Logo</span>
                  </div>
                }
                className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
                styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
              >
                <div className="space-y-4">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden"
                    disabled={!isAdmin}
                  />

                  {localLogo ? (
                    <div className="flex flex-col sm:flex-row items-center gap-4 p-4 border border-gray-200 rounded-2xl bg-gray-50/50">
                      <div className="w-24 h-16 bg-white border border-gray-200 rounded-xl flex items-center justify-center p-2 shadow-sm shrink-0">
                        <img
                          src={localLogo}
                          alt="Uploaded Logo"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="flex-1 text-center sm:text-left">
                        <Text className="text-xs font-bold text-gray-700 block">Custom Logo Active</Text>
                        <Text className="text-[11px] text-gray-400 block mb-2">Shown alongside the product name in navigation headers</Text>
                        {isAdmin && (
                          <div className="flex gap-2 justify-center sm:justify-start">
                            <Button
                              size="small"
                              onClick={() => fileInputRef.current?.click()}
                              className="rounded-lg text-xs font-semibold"
                            >
                              Replace Image
                            </Button>
                            <Button
                              size="small"
                              danger
                              icon={<Trash2 size={12} />}
                              onClick={() => {
                                setLocalLogo(null);
                                setCustomLogo(null);
                                if (fileInputRef.current) fileInputRef.current.value = '';
                              }}
                              className="rounded-lg text-xs"
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        if (isAdmin) {
                          fileInputRef.current?.click();
                        }
                      }}
                      className={`border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center transition-all ${isAdmin
                        ? 'cursor-pointer hover:border-primary/50 bg-gray-50/50 hover:bg-primary/5 group'
                        : 'cursor-not-allowed bg-gray-50/30 opacity-70'
                        }`}
                    >
                      <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mx-auto mb-3 text-gray-400 group-hover:text-primary group-hover:scale-110 transition-transform">
                        <UploadIcon size={20} />
                      </div>
                      <Text className="text-xs font-bold text-gray-700 block mb-0.5 group-hover:text-primary transition-colors">
                        {isAdmin ? 'Click or Drag to Upload Company Logo' : 'No Custom Logo Configured'}
                      </Text>
                      <Text className="text-[11px] text-gray-400">
                        {isAdmin ? 'Supports PNG, JPG, SVG, WebP (Max 2MB)' : 'Managed by workspace administrators'}
                      </Text>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Live Navigation Mockup Preview */}
            <Card
              variant="borderless"
              className="shadow-sm border border-gray-100/60 rounded-[2rem] bg-gray-50/70 p-4 sm:p-6"
            >
              <div className="flex items-center gap-2 mb-3">
                <Eye size={15} className="text-primary" />
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Live Top Bar Branding Preview
                </span>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {siteConfig.logo && <img src={siteConfig.logo} alt="Logo" className="h-6 object-contain" />}
                  {localLogo && (
                    <>
                      <div className="h-4 w-[1px] bg-gray-300" />
                      <img src={localLogo} alt="Logo" className="h-6 max-w-[100px] object-contain rounded" />
                    </>
                  )}
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-gray-900 leading-tight">
                      {localName || siteConfig.name}
                    </span>
                    <span className="text-[9px] text-gray-400 font-mono">
                      {siteConfig.name} Platform
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">Theme Highlight:</span>
                  <div className="w-5 h-5 rounded-full shadow-xs" style={{ backgroundColor: localColor }} />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* ─── TAB 3: COLOR THEME ─────────────────────────────────────────────────── */}
        {activeTab === 'theme' && (
          <Card
            variant="borderless"
            title={
              <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                  <Palette size={16} />
                </div>
                <span>Company Theme & Brand Color Palette</span>
              </div>
            }
            className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden animate-in fade-in duration-300"
            styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
          >
            <div className="space-y-6">
              <div>
                <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.75rem] ml-[0.25rem]">
                  Select Theme Palette Preset
                </label>
                <div className="grid grid-cols-2 xs:grid-cols-4 sm:grid-cols-8 gap-3">
                  {presetColors.map((col) => {
                    const isSelected = localColor.toLowerCase() === col.hex.toLowerCase();
                    return (
                      <button
                        key={col.hex}
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => handleColorChange(col.hex)}
                        className={`flex flex-col items-center gap-2 p-2.5 rounded-2xl border transition-all cursor-pointer ${isSelected
                          ? 'border-gray-900 bg-gray-50 shadow-sm scale-105 ring-2 ring-gray-900/10'
                          : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50/60'
                          } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        <div
                          className="w-9 h-9 rounded-xl shadow-sm flex items-center justify-center text-white transition-transform"
                          style={{ backgroundColor: col.hex }}
                        >
                          {isSelected && <Check size={16} className="drop-shadow" />}
                        </div>
                        <span className="text-[11px] font-bold text-gray-700 truncate max-w-full">
                          {col.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Divider className="my-3 border-gray-100" />

              {/* Custom Color Input */}
              <div>
                <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">
                  Custom Brand Hex Color
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center">
                    <input
                      type="color"
                      value={localColor}
                      disabled={!isAdmin}
                      onChange={(e) => handleColorChange(e.target.value)}
                      className="w-12 h-11 rounded-xl cursor-pointer border border-gray-200 p-1 bg-white shadow-sm"
                    />
                  </div>
                  <Input
                    value={localColor}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocalColor(val);
                      if (/^#([0-9a-fA-F]{3}){1,2}$/.test(val)) {
                        setPrimaryColor(val);
                      }
                    }}
                    placeholder="#0284c7"
                    maxLength={7}
                    className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] max-w-[160px] font-mono font-bold uppercase"
                  />
                </div>
                <Text className="text-[11px] text-gray-400 block mt-1.5">
                  Applies instantly across buttons, navigation highlights, active tab states, and the login page.
                </Text>
              </div>

              {/* Interactive Component Preview */}
              <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200/80">
                <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-3">
                  Live Component Theme Preview
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl text-white font-bold text-xs shadow-sm transition-transform active:scale-95 cursor-pointer"
                    style={{ backgroundColor: localColor }}
                  >
                    Primary Action
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 rounded-xl font-bold text-xs border transition-colors cursor-pointer bg-white"
                    style={{ borderColor: localColor, color: localColor }}
                  >
                    Outlined Button
                  </button>
                  <div
                    className="px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: `${localColor}18`, color: localColor }}
                  >
                    Active Tag Badge
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ─── TAB 4: LOGIN PAGE CUSTOMIZATION ───────────────────────────────────── */}
        {activeTab === 'login' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1.25rem] sm:gap-[1.5rem]">
              {/* Left: Login Content Editor */}
              <Card
                variant="borderless"
                title={
                  <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                    <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                      <LogIn size={16} />
                    </div>
                    <span>Login Page Content & Typography</span>
                  </div>
                }
                className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
                styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
              >
                <div className="space-y-4">
                  {/* Headline */}
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">
                      Main Headline
                    </label>
                    <Input
                      value={localHeadline}
                      disabled={!isAdmin}
                      onChange={(e) => setLocalHeadline(e.target.value)}
                      placeholder="e.g. Precision Geospatial Intelligence for All"
                      maxLength={100}
                      className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] font-semibold"
                    />
                  </div>

                  {/* Subtitle / Mission */}
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">
                      Subtitle / Mission Description
                    </label>
                    <TextArea
                      value={localSubtitle}
                      disabled={!isAdmin}
                      onChange={(e) => setLocalSubtitle(e.target.value)}
                      placeholder="Transforming raw data into actionable insights..."
                      rows={3}
                      maxLength={300}
                      className="rounded-[1rem] border-gray-200 text-[0.875rem]"
                    />
                  </div>

                  {/* Inspirational Quote */}
                  <div>
                    <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">
                      Right Panel Quote Subtext
                    </label>
                    <Input
                      value={localQuote}
                      disabled={!isAdmin}
                      onChange={(e) => setLocalQuote(e.target.value)}
                      placeholder="e.g. Data is the new geography."
                      maxLength={80}
                      className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] italic"
                    />
                  </div>
                </div>
              </Card>

              {/* Right: Wallpaper Selector */}
              <Card
                variant="borderless"
                title={
                  <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                    <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                      <ImageIcon size={16} />
                    </div>
                    <span>Login Left Wallpaper Selection</span>
                  </div>
                }
                className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
                styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
              >
                <div className="space-y-4">
                  <input
                    type="file"
                    ref={loginImageInputRef}
                    onChange={handleLoginImageUpload}
                    accept="image/*"
                    className="hidden"
                    disabled={!isAdmin}
                  />

                  {/* Upload button or current preview */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 border border-gray-200/80 rounded-xl mb-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="small"
                        icon={<UploadIcon size={13} />}
                        onClick={() => loginImageInputRef.current?.click()}
                        disabled={!isAdmin}
                        className="rounded-lg text-xs font-semibold border-primary/40 text-primary hover:border-primary hover:text-primary cursor-pointer"
                      >
                        Upload Custom Wallpaper
                      </Button>
                      <span className="text-[11px] text-gray-400">Max 5MB (PNG, JPG, WebP)</span>
                    </div>
                    {localBgUrl && (
                      <Button
                        danger
                        type="text"
                        size="small"
                        icon={<Trash2 size={12} />}
                        onClick={() =>
                          setLocalBgUrl(
                            'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop'
                          )
                        }
                        disabled={!isAdmin}
                        className="text-xs text-gray-400 hover:text-red-500 cursor-pointer"
                      >
                        Reset to Default
                      </Button>
                    )}
                  </div>

                  <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest ml-[0.25rem]">
                    Curated Satellite & Planetary Wallpapers
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {wallpaperPresets.map((wp) => {
                      const isSelected = localBgUrl === wp.url;
                      return (
                        <div
                          key={wp.name}
                          onClick={() => {
                            if (isAdmin) setLocalBgUrl(wp.url);
                          }}
                          className={`relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${isSelected
                            ? 'border-primary ring-2 ring-primary/20 shadow-md scale-[1.02]'
                            : 'border-gray-200 hover:border-gray-300'
                            } ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                          <div className="h-20 w-full overflow-hidden bg-gray-900 relative">
                            <img src={wp.url} alt={wp.name} className="w-full h-full object-cover" />
                            {isSelected && (
                              <div className="absolute top-1.5 right-1.5 bg-primary text-white w-5 h-5 rounded-full flex items-center justify-center shadow">
                                <Check size={12} strokeWidth={3} />
                              </div>
                            )}
                          </div>
                          <div className="p-2 bg-white">
                            <span className="text-[11px] font-bold text-gray-800 block truncate">{wp.name}</span>
                            <span className="text-[9px] text-gray-400 block truncate">{wp.desc}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Custom URL Input */}
                  <div className="pt-2">
                    <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.25rem] ml-[0.25rem]">
                      Or Custom Image URL
                    </label>
                    <Input
                      value={localBgUrl}
                      disabled={!isAdmin}
                      onChange={(e) => setLocalBgUrl(e.target.value)}
                      placeholder="https://example.com/satellite-wallpaper.jpg"
                      className="vismap-input rounded-[1rem] border-gray-200 h-[2.5rem] text-[0.8125rem]"
                    />
                  </div>
                </div>
              </Card>
            </div>

            {/* Split Screen Login Mockup Preview */}
            <Card
              variant="borderless"
              className="shadow-sm border border-gray-100/60 rounded-[2rem] bg-gray-50/70 p-4 sm:p-6"
            >
              <div className="flex items-center gap-2 mb-4">
                <Eye size={15} className="text-primary" />
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Interactive Login Screen Live Mockup
                </span>
              </div>

              {/* Centered mockup with realistic 16:10 desktop dimensions */}
              <div className="flex justify-center w-full">
                <div className="w-full max-w-[760px] rounded-2xl overflow-hidden border border-gray-300 shadow-md aspect-[16/10] flex flex-row bg-white select-none">
                  {/* Left Banner: 60% */}
                  <div className="w-3/5 relative overflow-hidden flex flex-col justify-between p-5 sm:p-7 text-white bg-gray-900">
                    <div
                      className="absolute inset-0 bg-cover bg-center transition-all duration-700"
                      style={{ backgroundImage: `url('${localBgUrl}')` }}
                    />
                    <div
                      className="absolute inset-0 transition-colors duration-300"
                      style={{
                        background: `linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 50%, color-mix(in srgb, ${localColor} 30%, rgba(0,0,0,0.85)) 100%)`,
                      }}
                    />

                    {/* Header Logo & Brand */}
                    <div className="relative z-10 flex items-center gap-2">
                      {siteConfig.logo && <img src={siteConfig.logo} alt="Logo" className="h-4 sm:h-5 object-contain" />}
                      {localLogo && (
                        <>
                          <div className="h-3 w-[1px] bg-white/40" />
                          <img src={localLogo} alt="Logo" className="h-4 sm:h-5 max-w-[80px] object-contain rounded" />
                        </>
                      )}
                      <span className="text-xs sm:text-sm font-bold tracking-tight">
                        {localName || siteConfig.name}
                      </span>
                      {localName?.trim() && (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded text-white backdrop-blur-xs hidden sm:inline"
                          style={{ backgroundColor: `${localColor}80` }}
                        >
                          {siteConfig.name}
                        </span>
                      )}
                    </div>

                    {/* Center Headline & Subtitle */}
                    <div className="relative z-10 max-w-sm my-auto py-2">
                      <span className="text-sm sm:text-xl font-extrabold leading-tight block mb-2 drop-shadow-md whitespace-pre-line">
                        {localHeadline || 'Precision Geospatial Intelligence for All'}
                      </span>
                      <p className="text-[10px] sm:text-xs text-white/85 line-clamp-3 font-light leading-relaxed">
                        {localSubtitle || 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.'}
                      </p>
                    </div>

                    <div />
                  </div>

                  {/* Right Form: 40% */}
                  <div className="w-2/5 p-3 sm:p-4 bg-[#f8fafc] flex flex-col justify-between items-center overflow-hidden">
                    {/* Top spacer */}
                    <div />

                    {/* Middle Card & Credentials */}
                    <div className="w-full max-w-[210px] my-auto">
                      <div className="mb-2 sm:mb-2.5 text-left">
                        <span className="text-xs sm:text-sm font-bold text-gray-900 block leading-tight">
                          Welcome Back
                        </span>
                        <span className="text-[9px] sm:text-[10px] text-gray-400 italic line-clamp-2 block mt-0.5">
                          &quot;{localQuote || 'Data is the new geography.'}&quot;
                        </span>
                      </div>

                      {/* Mini Form Card */}
                      <div className="bg-white rounded-xl p-2.5 sm:p-3 border border-gray-100 shadow-sm space-y-2">
                        <div>
                          <span className="block text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                            Username
                          </span>
                          <div className="h-6 sm:h-7 bg-gray-50/80 border border-gray-200 rounded-lg px-2 flex items-center gap-1.5 text-[9px] sm:text-[10px] text-gray-500">
                            <User size={10} className="text-gray-400 shrink-0" />
                            <span className="truncate">admin@geovista.com</span>
                          </div>
                        </div>

                        <div>
                          <span className="block text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">
                            Password
                          </span>
                          <div className="h-6 sm:h-7 bg-gray-50/80 border border-gray-200 rounded-lg px-2 flex items-center gap-1.5 text-[9px] sm:text-[10px] text-gray-500">
                            <Lock size={10} className="text-gray-400 shrink-0" />
                            <span>••••••••</span>
                          </div>
                        </div>

                        <div
                          className="h-7 sm:h-8 rounded-lg text-white font-bold text-[10px] sm:text-[11px] flex items-center justify-center shadow-xs cursor-pointer transition-all mt-1 hover:brightness-105"
                          style={{
                            backgroundColor: localColor,
                            boxShadow: `0 2px 8px ${localColor}40`,
                          }}
                        >
                          Sign In
                        </div>
                      </div>

                      {/* Secure Access Subtext */}
                      <div className="mt-2 text-center">
                        <span className="text-[7.5px] sm:text-[8px] text-gray-400 leading-tight block">
                          Secure institutional access managed by {localName || siteConfig.name} Identity.
                        </span>
                      </div>
                    </div>

                    {/* Bottom Footer */}
                    <div className="text-center pt-1.5 border-t border-gray-200/60 w-full">
                      <span className="text-[7.5px] sm:text-[8px] text-gray-400 tracking-wide inline-flex items-center gap-0.5 justify-center">
                        Product by -{' '}
                        <span className="font-semibold inline-flex items-center gap-0.5" style={{ color: localColor }}>
                          Rotten Grapes Private limited <ExternalLink size={7} />
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Global Action Controls Bar (Persistent across all tabs) */}
        {isAdmin && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm mt-6">
            <div>
              <Text className="text-xs text-gray-500 font-medium">
                Changes apply instantly across all buttons, pages, map views, and the login screen.
              </Text>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <Button
                icon={<RotateCcw size={15} />}
                onClick={handleReset}
                className="rounded-xl h-11 px-5 font-semibold text-gray-600 hover:text-gray-900 border-gray-200 cursor-pointer"
              >
                Reset to Default
              </Button>
              <Button
                type="primary"
                icon={<Check size={16} />}
                loading={saving}
                onClick={handleSave}
                className="rounded-xl h-11 px-8 font-bold bg-primary border-none shadow-md hover:shadow-lg transition-all cursor-pointer"
              >
                Save Appearance & Defaults
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Add Custom Basemap Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Globe className="text-primary" size={20} />
            <span className="font-bold text-gray-800 text-lg">Add Custom Basemap</span>
          </div>
        }
        open={isAddBasemapModalOpen}
        onCancel={() => {
          if (!addingBasemap) {
            setIsAddBasemapModalOpen(false);
          }
        }}
        footer={[
          <Button key="cancel" onClick={() => setIsAddBasemapModalOpen(false)} disabled={addingBasemap}>
            Cancel
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={addingBasemap}
            onClick={handleAddCustomBasemap}
          >
            Add Basemap
          </Button>,
        ]}
        width="min(100% - 32px, 520px)"
        className="rounded-2xl"
      >
        <div className="py-4 flex flex-col gap-4 text-xs">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Basemap Name <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="e.g., OpenTopoMap, Stamen Terrain"
              value={newBasemapName}
              onChange={(e) => setNewBasemapName(e.target.value)}
              maxLength={100}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Tile URL Template (XYZ) <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder="e.g., https://tile.opentopomap.org/{z}/{x}/{y}.png"
              value={newBasemapUrl}
              onChange={(e) => setNewBasemapUrl(e.target.value)}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Must include standard XYZ placeholders: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">{'{z}'}</code>, <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">{'{x}'}</code>, and <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">{'{y}'}</code>.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <Input
              placeholder="Short description of this basemap"
              value={newBasemapDesc}
              onChange={(e) => setNewBasemapDesc(e.target.value)}
              maxLength={200}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Thumbnail URL <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <Input
              placeholder="https://example.com/thumbnail.png"
              value={newBasemapThumbnail}
              onChange={(e) => setNewBasemapThumbnail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Attributions / Copyright <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <Input
              placeholder="e.g., Map data &copy; OpenStreetMap contributors"
              value={newBasemapAttributions}
              onChange={(e) => setNewBasemapAttributions(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
}
