// ============================================================================
// GeoServer Overview API (GET /api/geoserver/overview)
//
// Fetches summary statistics from GeoServer REST API:
// - List of workspaces (/rest/workspaces.json)
// - Published layers (/rest/layers.json)
// - Layer groups (/rest/layergroups.json)
// - Server connection health check
// ============================================================================


import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const geoserverAuth = cookieStore.get('geoserver_auth')?.value;
    const geoserverUrlCookie = cookieStore.get('geoserver_url')?.value;
    const geoserverUsername = cookieStore.get('geoserver_username')?.value || 'admin';

    const configuredBase = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '');
    const rawGeoserverBase = configuredBase || (geoserverUrlCookie || '').replace(/\/+$/, '') || 'http://localhost:8080/geoserver';
    const geoserverBase = resolveInternalGeoServerUrl(rawGeoserverBase);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (geoserverAuth) {
      headers['Authorization'] = geoserverAuth;
    }


    let workspacesList: any[] = [];
    let layersList: any[] = [];
    let layerGroupsList: any[] = [];
    let usersList: any[] = [];
    let geoserverConnected = false;

    try {
      const wsRes = await fetch(`${geoserverBase}/rest/workspaces.json`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (wsRes.ok) {
        geoserverConnected = true;
        const wsData = await wsRes.json();
        const ws = wsData?.workspaces?.workspace || [];
        workspacesList = Array.isArray(ws) ? ws : [ws];
      }

      const lyRes = await fetch(`${geoserverBase}/rest/layers.json`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (lyRes.ok) {
        geoserverConnected = true;
        const lyData = await lyRes.json();
        const ly = lyData?.layers?.layer || [];
        layersList = Array.isArray(ly) ? ly : [ly];
      }

      const lgRes = await fetch(`${geoserverBase}/rest/layergroups.json`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (lgRes.ok) {
        geoserverConnected = true;
        const lgData = await lgRes.json();
        const lg = lgData?.layerGroups?.layerGroup || [];
        layerGroupsList = Array.isArray(lg) ? lg : [lg];
      }

      // Fetch workspace-specific layer groups
      if (workspacesList.length > 0) {
        await Promise.all(
          workspacesList.map(async (ws) => {
            try {
              if (!ws?.name) return;
              const wsLgRes = await fetch(`${geoserverBase}/rest/workspaces/${ws.name}/layergroups.json`, {
                headers,
                signal: AbortSignal.timeout(3000),
              });
              if (wsLgRes.ok) {
                const wsLgData = await wsLgRes.json();
                const wsLg = wsLgData?.layerGroups?.layerGroup || [];
                const wsLgArray = Array.isArray(wsLg) ? wsLg : [wsLg];
                wsLgArray.forEach((item: any) => {
                  if (item && item.name) {
                    const prefixedName = `${ws.name}:${item.name}`;
                    if (!layerGroupsList.some((existing) => existing.name === item.name || existing.name === prefixedName)) {
                      layerGroupsList.push({ ...item, name: prefixedName });
                    }
                  }
                });
              }
            } catch {
              // Ignore individual workspace group failures
            }
          })
        );
      }

      const usRes = await fetch(`${geoserverBase}/rest/security/usergroup/users.json`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });

      if (usRes.ok) {
        const usData = await usRes.json();
        const us = usData?.users?.user || usData?.users || [];
        usersList = Array.isArray(us) ? us : [us];
      } else {
        usersList = [{ userName: geoserverUsername, enabled: true }];
      }
    } catch (restErr) {
      console.error('REST fetch error in overview API route:', restErr);
    }

    return NextResponse.json({
      geoserverConnected,
      workspaces: workspacesList,
      layers: layersList,
      layerGroups: layerGroupsList,
      users: workspacesList.length > 0 ? usersList : [],
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        geoserverConnected: false,
        workspaces: [],
        layers: [],
        layerGroups: [],
        users: [],
        error: error.message,
      },
      { status: 500 }
    );
  }
}
