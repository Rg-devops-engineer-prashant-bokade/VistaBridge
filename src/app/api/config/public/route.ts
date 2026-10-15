// ============================================================================
// Public Runtime Config API Route (/api/config/public)
//
// Exposes non-sensitive server configuration to the frontend browser:
// - GeoServer base URL and Tile Server URL
// - Accessible anonymously without login so the frontend can initialize
//   connection stores and basemaps before authenticating.
// ============================================================================

import { NextResponse } from 'next/server';
import { getPublicConfig } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await getPublicConfig();
    return NextResponse.json(config);
  } catch (err) {
    console.error('[GET /api/config/public] Failed to fetch config:', err);
    return NextResponse.json(
      { geoserverUrl: 'http://localhost:8080/geoserver', tileservUrl: 'http://localhost:7800' },
      { status: 200 }
    );
  }
}
