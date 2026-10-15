// ============================================================================
// LegendImage Component (GeoServer WMS Legend Graphic)
//
// Fetches the visual legend symbol graphic for a map layer from GeoServer
// via `GetLegendGraphic`:
// - Injects authenticated session headers if the layer requires authorization
// - Converts the resulting image response into a local Blob URL for <img> rendering
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';

interface LegendImageProps {
  url: string;
  notification: any;
}

export default function LegendImage({ url, notification }: LegendImageProps) {
  const { user } = useAuthStore();
  const [src, setSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl = '';

    const fetchLegend = async () => {
      try {
        const headers: HeadersInit = {};
        if (user?.geoserverAuth) {
          headers['Authorization'] = user.geoserverAuth;
        }

        const res = await fetch(url, { headers });
        if (!res.ok) {
          throw new Error(`Failed to load legend: ${res.status}`);
        }

        const blob = await res.blob();
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      } catch (err) {
        console.error('Failed to load legend graphic:', err);
        if (active) {
          notification.error({
            message: 'Legend Error',
            description: 'Failed to load legend graphic from GeoServer.',
            placement: 'topRight'
          });
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchLegend();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [url, user?.geoserverAuth, notification]);

  if (loading) {
    return <div className="text-xs text-gray-400 py-4 text-center">Loading legend...</div>;
  }

  if (!src) {
    return <div className="text-xs text-red-500 py-4 text-center">Failed to load legend graphic.</div>;
  }

  return (
    <img
      src={src}
      alt="Legend Graphic"
      className="max-w-full h-auto border border-gray-200/60 rounded shadow-sm bg-white p-2"
    />
  );
}
