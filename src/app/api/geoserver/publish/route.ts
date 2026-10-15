// ============================================================================
// GeoServer Raster Publishing API Route (/api/geoserver/publish)
//
// In GIS, raster analysis (e.g. Slope, Contour, Hillshade) generates GeoTIFFs.
// This route uploads the resulting binary TIFF to GeoServer's REST API:
// 1. Creates a new coverage store in the workspace
// 2. Publishes it as an active WMS/WCS map layer that can be added to the map
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const geoserverAuth = cookieStore.get('geoserver_auth')?.value;
    const geoserverUrlCookie = cookieStore.get('geoserver_url')?.value;

    if (!geoserverAuth) {
      return NextResponse.json({ error: 'Unauthorized: No GeoServer credentials' }, { status: 401 });
    }

    // Read the binary TIFF body
    const tiffBuffer = await req.arrayBuffer();
    if (!tiffBuffer || tiffBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty TIFF body received' }, { status: 400 });
    }

    const rawGeoserverBase = (geoserverUrlCookie || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
    const geoserverBase = resolveInternalGeoServerUrl(rawGeoserverBase);
    const ws = 'ne'; // Default workspace
    const storeName = `wps_raster_${Date.now()}`;

    // Upload & Publish TIFF via GeoServer REST API (using PUT to file.geotiff)
    const uploadUrl = `${geoserverBase}/rest/workspaces/${ws}/coveragestores/${storeName}/file.geotiff?configure=first&coverageName=${storeName}`;
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: geoserverAuth,
        'Content-Type': 'image/tiff',
      },
      body: Buffer.from(tiffBuffer),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('GeoServer raster publish failed:', errText);
      return NextResponse.json(
        { error: `GeoServer REST upload error (${response.status}): ${errText.slice(0, 400)}` },
        { status: 500 }
      );
    }

    // Retrieve published layer bounding box
    let bbox: number[] = [-180, -90, 180, 90];
    try {
      const covRes = await fetch(
        `${geoserverBase}/rest/workspaces/${ws}/coveragestores/${storeName}/coverages/${storeName}.json`,
        { headers: { Authorization: geoserverAuth, Accept: 'application/json' } }
      );
      if (covRes.ok) {
        const covData = await covRes.json();
        const lb = covData?.coverage?.latLonBoundingBox;
        if (lb && lb.minx !== undefined) {
          bbox = [lb.minx, lb.miny, lb.maxx, lb.maxy];
        }
      }
    } catch (err) {
      console.warn('Failed to retrieve bounding box for published raster:', err);
    }

    return NextResponse.json({
      layerName: `${ws}:${storeName}`,
      storeName,
      bbox,
      workspace: ws,
    });

  } catch (err: any) {
    console.error('publish route error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
