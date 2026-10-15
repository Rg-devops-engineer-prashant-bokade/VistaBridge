// ============================================================================
// GeoServer Vector Publishing API Route (/api/geoserver/publish-vector)
//
// In GIS, users often want to save vector analysis outputs (e.g. buffers, clips)
// directly to the server:
// 1. Accepts a GeoJSON FeatureCollection from the client
// 2. Publishes it to GeoServer's REST API as a persistent vector datastore layer
// 3. Returns the workspace-qualified layer ID so it can be added to maps
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

    const body = await req.json();
    const { geojson, layerName, workspace } = body;

    if (!geojson || !layerName) {
      return NextResponse.json({ error: 'Missing geojson or layerName' }, { status: 400 });
    }

    const rawGeoserverBase = (geoserverUrlCookie || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
    const geoserverBase = resolveInternalGeoServerUrl(rawGeoserverBase);
    const ws = workspace || 'ne';

    // Sanitize the store name
    const storeName = layerName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60);

    const authHeaders = {
      Authorization: geoserverAuth,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Step 1: Delete existing store if it exists
    await fetch(
      `${geoserverBase}/rest/workspaces/${ws}/datastores/${storeName}?recurse=true`,
      { method: 'DELETE', headers: { Authorization: geoserverAuth } }
    ).catch(() => { });

    // Step 2: Try creating a GeoJSON datastore
    const createStoreRes = await fetch(
      `${geoserverBase}/rest/workspaces/${ws}/datastores`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          dataStore: {
            name: storeName,
            type: 'GeoJSON',
            connectionParameters: {
              entry: [
                { '@key': 'url', $: `file:data/${ws}/${storeName}.json` }
              ]
            }
          }
        })
      }
    );

    if (!createStoreRes.ok) {
      const errText = await createStoreRes.text();
      console.warn('GeoJSON datastore creation failed, trying fallback:', errText);
    }

    // Step 3: Upload the GeoJSON file to GeoServer
    const uploadUrl = `${geoserverBase}/rest/workspaces/${ws}/datastores/${storeName}/file.json?filename=${storeName}.json`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: geoserverAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(geojson)
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('GeoServer vector upload failed:', errText);
      return NextResponse.json(
        { error: `GeoServer REST upload error (${uploadRes.status}): ${errText.slice(0, 400)}` },
        { status: 500 }
      );
    }

    const publishedLayerName = `${ws}:${storeName}`;

    // Get layer bbox
    let bbox: number[] = [-180, -90, 180, 90];
    try {
      const ftRes = await fetch(
        `${geoserverBase}/rest/workspaces/${ws}/datastores/${storeName}/featuretypes/${storeName}.json`,
        { headers: { Authorization: geoserverAuth, Accept: 'application/json' } }
      );
      if (ftRes.ok) {
        const ftData = await ftRes.json();
        const lb = ftData?.featureType?.latLonBoundingBox;
        if (lb && lb.minx !== undefined) {
          bbox = [lb.minx, lb.miny, lb.maxx, lb.maxy];
        }
      }
    } catch { }

    return NextResponse.json({
      layerName: publishedLayerName,
      storeName,
      bbox,
      workspace: ws,
    });

  } catch (err: any) {
    console.error('publish-vector route error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
