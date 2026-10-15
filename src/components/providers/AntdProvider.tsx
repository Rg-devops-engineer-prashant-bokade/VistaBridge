// ============================================================================
// Ant Design Theme & Silent Auth Provider (AntdProvider.tsx)
//
// Client bootstrap wrapper for the application:
// 1. Injects dynamic branding primary color into Ant Design's `ConfigProvider`
// 2. Performs silent authentication on startup (reads HttpOnly cookie into memory)
// 3. Fetches appearance settings and public configurations from the server
// ============================================================================

'use client';

import React from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider, App } from 'antd';
import { siteConfig } from '@/config/site-config';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useConfigStore } from '@/store/useConfigStore';

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  const { primaryColor, fetchAppearance, isLoaded } = useAppearanceStore();
  const { fetchConfig } = useConfigStore();

  // 1. Silent Authentication Initialization (HttpOnly Cookie -> In-Memory State)
  // Completely eliminates localStorage storage of tokens while keeping session persistence
  React.useEffect(() => {
    // Clean up any legacy localStorage entry
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('vismap-auth');
      } catch {}
    }

    const initAuth = async () => {
      const store = useAuthStore.getState();
      if (store.hydrated && store.token) return;

      try {
        const token = await store.refreshAccessToken();
        if (!token) {
          store.clearAuth();
        }
      } catch {
        store.clearAuth();
      } finally {
        useAuthStore.getState().setHydrated(true);
      }
    };

    initAuth();
  }, []);

  React.useEffect(() => {
    fetchConfig();
    if (!isLoaded) {
      fetchAppearance();
    }
  }, [isLoaded, fetchAppearance, fetchConfig]);

  React.useEffect(() => {
    if (primaryColor) {
      document.documentElement.style.setProperty('--primary-color', primaryColor);
    }
  }, [primaryColor]);

  const activePrimary = primaryColor || siteConfig.colors.primary || '#0284c7';

  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: activePrimary,
            borderRadius: 8,
            fontFamily: siteConfig.font,
          },
          components: {
            Button: {
              colorPrimary: activePrimary,
              colorPrimaryHover: `color-mix(in srgb, ${activePrimary} 85%, black)`,
              colorPrimaryActive: `color-mix(in srgb, ${activePrimary} 70%, black)`,
            },
            Menu: {
              itemSelectedColor: activePrimary,
              itemSelectedBg: `color-mix(in srgb, ${activePrimary} 10%, transparent)`,
            },
            Tabs: {
              inkBarColor: activePrimary,
              itemSelectedColor: activePrimary,
            },
            Radio: {
              colorPrimary: activePrimary,
            },
            Checkbox: {
              colorPrimary: activePrimary,
            },
            Switch: {
              colorPrimary: activePrimary,
            },
            Select: {
              colorPrimary: activePrimary,
            },
            Input: {
              colorPrimary: activePrimary,
            },
            Spin: {
              colorPrimary: activePrimary,
            },
          }
        }}
      >
        <App>
          {children}
        </App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
