// ============================================================================
// App Configuration Store (Zustand)
//
// Fetches system URLs from /api/config/public (stored in SQLite)
// so the frontend knows where GeoServer and the TileServer are running.
// ============================================================================


import { create } from 'zustand';

interface ConfigState {
  geoserverUrl: string;
  tileservUrl: string;
  apiUrl: string;
  isLoaded: boolean;
  fetchConfig: () => Promise<void>;
  getConfig: () => { geoserverUrl: string; tileservUrl: string };
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  geoserverUrl: 'http://localhost:8080/geoserver',
  tileservUrl: 'http://localhost:7800',
  apiUrl: '/api',
  isLoaded: false,

  fetchConfig: async () => {
    try {
      const res = await fetch('/api/config/public', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        set({
          geoserverUrl: data.geoserverUrl || 'http://localhost:8080/geoserver',
          tileservUrl: data.tileservUrl || 'http://localhost:7800',
          apiUrl: data.apiUrl || '/api',
          isLoaded: true,
        });
      }
    } catch (err) {
      console.warn('[useConfigStore] Failed to load config from SQLite API:', err);
    }
  },
  getConfig: () => {
    const state = get();
    return {
      geoserverUrl: state.geoserverUrl,
      tileservUrl: state.tileservUrl,
    };
  },
}));
