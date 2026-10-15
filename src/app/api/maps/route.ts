// ============================================================================
// Maps API (GET /api/maps & POST /api/maps)
//
// Manages map projects saved by users:
// - GET: Returns all map workspaces created by the logged-in user
// - POST: Creates a new map workspace with name, center coordinates, zoom, and basemap
// All records are saved in the SQLite map_workspaces table.
// ============================================================================


import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, initDb } from '@/lib/db';
import { verifyJwt } from '@/lib/jwt';
import { getAppSetting } from '@/lib/settings';

let dbInitialized = false;

/**
 * Ensures the SQLite database schema and tables are initialized before handling requests.
 */
async function ensureDb() {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

/**
 * Extracts and cryptographically verifies the authenticated user from the Authorization header.
 * 
 * @param request - Incoming HTTP Request
 * @returns Decoded JWT claims or null if missing / expired / invalid
 */
function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyJwt(token);
}

/**
 * Resolves the active GeoServer base URL associated with the session or database settings.
 * 
 * @param req - Incoming HTTP Request
 * @param user - Authenticated user claims object
 * @returns Clean GeoServer URL without trailing slash
 */
async function getGeoserverUrl(req: Request, user: any): Promise<string> {
  if (user?.geoserverUrl) return user.geoserverUrl.replace(/\/+$/, '');
  const cookiesHeader = req.headers.get('cookie') || '';
  const match = cookiesHeader.match(/geoserver_url=([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]).replace(/\/+$/, '');
  }
  const dbUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
  return dbUrl.replace(/\/+$/, '');
}


export async function GET(request: Request) {
  try {
    await ensureDb();
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { detail: 'Authentication credentials were not provided.' },
        { status: 401 }
      );
    }

    const geoserverUrl = await getGeoserverUrl(request, user);
    const result = await pool.query(
      `SELECT * FROM map_workspaces 
       WHERE created_by = $1 
         AND (
           geoserver_url = $2 
           OR geoserver_url = '' 
           OR geoserver_url IS NULL 
           OR LOWER(RTRIM(geoserver_url, '/')) = LOWER(RTRIM($2, '/'))
         ) 
       ORDER BY created_at DESC`,
      [user.username, geoserverUrl]
    );
    
    const workspaces = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      share: row.share || 'PRIVATE',
      type: row.type,
      center_lon: row.center_lon,
      center_lat: row.center_lat,
      zoom: row.zoom,
      basemap_id: row.basemap_id,
      layers: Array.isArray(row.layers)
        ? row.layers
        : typeof row.layers === 'string'
        ? (() => { try { return JSON.parse(row.layers); } catch { return []; } })()
        : [],
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return NextResponse.json(workspaces);
  } catch (err) {
    console.error('Failed to read map workspaces:', err);
    return NextResponse.json(
      { detail: 'Internal server error reading maps.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { detail: 'Authentication credentials were not provided.' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description, share, type } = body;

    const trimmedName = typeof name === 'string' ? name.trim() : '';

    if (!trimmedName) {
      return NextResponse.json(
        { detail: 'Map name cannot be empty or contain only spaces.' },
        { status: 400 }
      );
    }

    if (trimmedName.length < 2) {
      return NextResponse.json(
        { detail: 'Map name must be at least 2 characters long.' },
        { status: 400 }
      );
    }

    if (trimmedName.length > 32) {
      return NextResponse.json(
        { detail: 'Map name cannot exceed 32 characters.' },
        { status: 400 }
      );
    }

    if (/[<>]/.test(trimmedName)) {
      return NextResponse.json(
        { detail: 'Map name contains invalid characters (< or >).' },
        { status: 400 }
      );
    }

    if (!type || !['2D'].includes(type)) {
      return NextResponse.json(
        { detail: 'Type must be: 2D.' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const desc = (description || '').trim();
    const sh = share || 'PRIVATE';
    const now = new Date().toISOString();
    const geoserverUrl = await getGeoserverUrl(request, user);
    const cleanUrl = geoserverUrl ? geoserverUrl.trim().toLowerCase().replace(/\/+$/, '') : '';

    let defaultLat = 20.5937;
    let defaultLon = 78.9629;
    let defaultZoom = 4;
    let defaultBasemap = 'osm';

    if (cleanUrl) {
      const geoRes = await pool.query(
        "SELECT value FROM app_settings WHERE key = $1",
        [`appearance:${cleanUrl}`]
      );
      if (geoRes.rows.length > 0 && geoRes.rows[0].value) {
        const val = geoRes.rows[0].value;
        if (typeof val.defaultLatitude === 'number') defaultLat = val.defaultLatitude;
        if (typeof val.defaultLongitude === 'number') defaultLon = val.defaultLongitude;
        if (typeof val.defaultZoom === 'number') defaultZoom = val.defaultZoom;
        if (typeof val.defaultBasemap === 'string' && val.defaultBasemap) defaultBasemap = val.defaultBasemap;
      }
    }

    if (defaultLat === 20.5937 && defaultLon === 78.9629) {
      const globalRes = await pool.query("SELECT value FROM app_settings WHERE key = 'appearance'");
      if (globalRes.rows.length > 0 && globalRes.rows[0].value) {
        const val = globalRes.rows[0].value;
        if (typeof val.defaultLatitude === 'number') defaultLat = val.defaultLatitude;
        if (typeof val.defaultLongitude === 'number') defaultLon = val.defaultLongitude;
        if (typeof val.defaultZoom === 'number') defaultZoom = val.defaultZoom;
        if (typeof val.defaultBasemap === 'string' && val.defaultBasemap) defaultBasemap = val.defaultBasemap;
      }
    }

    const finalLat =
      typeof body.center_lat === 'number' && !isNaN(body.center_lat) ? body.center_lat : defaultLat;
    const finalLon =
      typeof body.center_lon === 'number' && !isNaN(body.center_lon) ? body.center_lon : defaultLon;
    const finalZoom =
      typeof body.zoom === 'number' && !isNaN(body.zoom) ? body.zoom : defaultZoom;
    const finalBasemap =
      typeof body.basemap_id === 'string' && body.basemap_id.trim() ? body.basemap_id.trim() : defaultBasemap;

    const finalLayers = Array.isArray(body.layers)
      ? JSON.stringify(body.layers)
      : typeof body.layers === 'string'
      ? body.layers
      : JSON.stringify([]);

    await pool.query(
      `INSERT INTO map_workspaces (id, name, description, share, type, center_lon, center_lat, zoom, basemap_id, created_at, updated_at, layers, created_by, geoserver_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id, trimmedName, desc, sh, type, finalLon, finalLat, finalZoom, finalBasemap, now, now, finalLayers, user.username, geoserverUrl]
    );

    const newMap = {
      id,
      name: trimmedName,
      description: desc,
      share: sh,
      type,
      center_lon: finalLon,
      center_lat: finalLat,
      zoom: finalZoom,
      basemap_id: finalBasemap,
      created_by: user.username,
      created_at: now,
      updated_at: now,
      layers: Array.isArray(body.layers) ? body.layers : [],
    };

    return NextResponse.json(newMap, { status: 201 });
  } catch (err) {
    console.error('Failed to create map workspace:', err);
    return NextResponse.json(
      { detail: 'Internal server error creating map.' },
      { status: 500 }
    );
  }
}
