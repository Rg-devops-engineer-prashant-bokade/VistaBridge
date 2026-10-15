// ============================================================================
// Appearance & Branding State Store (useAppearanceStore)
//
// Manages customizable branding and default settings:
// - Custom logo image & Product title name
// - Primary brand color (dynamically updates CSS variable `--primary-color`)
// - Default map center coordinates (lat/lon), default zoom, and default basemap
// - Login screen hero headline, subtitle, background image, and quote
//
// Values are persisted in SQLite and loaded on startup via `/api/config/appearance`.
// ============================================================================

import { create } from 'zustand';
import { siteConfig } from '@/config/site-config';

export interface AppearanceState {
  geoserverUrl: string;
  customLogo: string | null;
  productName: string;
  primaryColor: string;
  defaultBasemap: string;
  defaultLatitude: number;
  defaultLongitude: number;
  defaultZoom: number;
  loginHeadline: string;
  loginSubtitle: string;
  loginBgUrl: string | null;
  loginQuote: string;
  isLoaded: boolean;
  isLoading: boolean;
  setGeoserverUrl: (url: string) => void;
  setCustomLogo: (logo: string | null) => void;
  setProductName: (name: string) => void;
  setPrimaryColor: (color: string) => void;
  setDefaultBasemap: (basemap: string) => void;
  setDefaultLatitude: (lat: number) => void;
  setDefaultLongitude: (lon: number) => void;
  setDefaultZoom: (zoom: number) => void;
  setLoginHeadline: (headline: string) => void;
  setLoginSubtitle: (subtitle: string) => void;
  setLoginBgUrl: (url: string | null) => void;
  setLoginQuote: (quote: string) => void;
  resetAppearance: () => void;
  fetchAppearance: (geoserverUrl?: string) => Promise<void>;
}

export const useAppearanceStore = create<AppearanceState>((set) => ({
  geoserverUrl: '',
  customLogo: null,
  productName: '',
  primaryColor: siteConfig.colors.primary || '#0284c7',
  defaultBasemap: 'osm',
  defaultLatitude: 20.5937,
  defaultLongitude: 78.9629,
  defaultZoom: 4,
  loginHeadline: 'Precision Geospatial Intelligence for All',
  loginSubtitle: 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
  loginBgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
  loginQuote: 'Data is the new geography.',
  isLoaded: false,
  isLoading: false,

  setGeoserverUrl: (url) => set({ geoserverUrl: url }),
  setCustomLogo: (logo) => set({ customLogo: logo }),
  setProductName: (name) => set({ productName: name }),

  setPrimaryColor: (color) => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--primary-color', color);
    }
    set({ primaryColor: color });
  },

  setDefaultBasemap: (basemap) => set({ defaultBasemap: basemap }),
  setDefaultLatitude: (lat) => set({ defaultLatitude: lat }),
  setDefaultLongitude: (lon) => set({ defaultLongitude: lon }),
  setDefaultZoom: (zoom) => set({ defaultZoom: zoom }),

  setLoginHeadline: (headline) => set({ loginHeadline: headline }),
  setLoginSubtitle: (subtitle) => set({ loginSubtitle: subtitle }),
  setLoginBgUrl: (url) => set({ loginBgUrl: url }),
  setLoginQuote: (quote) => set({ loginQuote: quote }),

  resetAppearance: () => {
    const defaultCol = siteConfig.colors.primary || '#0284c7';
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--primary-color', defaultCol);
    }
    set({
      geoserverUrl: '',
      customLogo: null,
      productName: '',
      primaryColor: defaultCol,
      defaultBasemap: 'osm',
      defaultLatitude: 20.5937,
      defaultLongitude: 78.9629,
      defaultZoom: 4,
      loginHeadline: 'Precision Geospatial Intelligence for All',
      loginSubtitle: 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
      loginBgUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
      loginQuote: 'Data is the new geography.',
    });
  },

  fetchAppearance: async (targetGeoserverUrl?: string) => {
    set({ isLoading: true });
    try {
      let gsUrl = targetGeoserverUrl;
      if (!gsUrl && typeof window !== 'undefined') {
        try {
          const authState = (await import('@/store/useAuthStore')).useAuthStore.getState();
          gsUrl = authState.user?.geoserverUrl;
        } catch {}
        if (!gsUrl) {
          const match = document.cookie.match(/(?:^|;\s*)geoserver_url=([^;]+)/);
          if (match) gsUrl = decodeURIComponent(match[1]);
        }
      }

      const query = gsUrl ? `?geoserverUrl=${encodeURIComponent(gsUrl)}` : '';
      const res = await fetch(`/api/config/appearance${query}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const col = data.primaryColor || siteConfig.colors.primary || '#0284c7';

        if (typeof document !== 'undefined') {
          document.documentElement.style.setProperty('--primary-color', col);
        }
        set({
          geoserverUrl: data.geoserverUrl || gsUrl || '',
          customLogo: data.customLogo || null,
          productName: data.productName || '',
          primaryColor: col,
          defaultBasemap: data.defaultBasemap || 'osm',
          defaultLatitude: typeof data.defaultLatitude === 'number' ? data.defaultLatitude : 20.5937,
          defaultLongitude: typeof data.defaultLongitude === 'number' ? data.defaultLongitude : 78.9629,
          defaultZoom: typeof data.defaultZoom === 'number' ? data.defaultZoom : 4,
          loginHeadline: typeof data.loginHeadline === 'string' ? data.loginHeadline : 'Precision Geospatial Intelligence for All',
          loginSubtitle: typeof data.loginSubtitle === 'string' ? data.loginSubtitle : 'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.',
          loginBgUrl: typeof data.loginBgUrl === 'string' ? data.loginBgUrl : 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
          loginQuote: typeof data.loginQuote === 'string' ? data.loginQuote : 'Data is the new geography.',
          isLoaded: true,
          isLoading: false,
        });
      } else {
        set({ isLoaded: true, isLoading: false });
      }
    } catch (e) {
      console.error('Failed to load server appearance:', e);
      set({ isLoaded: true, isLoading: false });
    }
  },
}));


