// ============================================================================
// Single Map Workspace API Route (/api/maps/[id])
//
// When a user opens, saves changes to, or deletes a specific map workspace,
// this endpoint handles the database operations in SQLite.
//
// Methods:
// - GET: Retrieves the map's saved state (center coordinates, zoom level,
//        active basemap, and configured layer stack). Allows public access if
//        the map is marked as PUBLIC.
// - PATCH: Updates map metadata or layer settings. Verifies that only the creator
//          can modify their private maps.
// - DELETE: Permanently removes the map workspace from the database.
// ============================================================================

import { NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';
import { verifyJwt } from '@/lib/jwt';

// Ensure SQLite tables are initialized before handling queries
let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

// Extracts and verifies JWT bearer token from HTTP Authorization header
function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyJwt(token);
}

// GET /api/maps/[id] - Fetch a saved map by its unique ID
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const user = getAuthUser(request);

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { detail: 'ID parameter is required.' },
        { status: 400 }
      );
    }

    const result = await pool.query('SELECT * FROM map_workspaces WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json(
        { detail: `Map workspace with ID "${id}" not found.` },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    const isPublicMap = row.share === 'PUBLIC';

    // Enforce authentication for private maps
    if (!isPublicMap && !user) {
      return NextResponse.json(
        { detail: 'Authentication credentials were not provided.' },
        { status: 401 }
      );
    }

    // Enforce ownership checks for private maps
    if (!isPublicMap && row.created_by && (!user || row.created_by !== user.username)) {
      return NextResponse.json(
        { detail: 'You do not have permission to view this workspace.' },
        { status: 403 }
      );
    }

    const map = {
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
    };

    return NextResponse.json(map, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });
  } catch (err) {
    console.error('Failed to get map workspace:', err);
    return NextResponse.json(
      { detail: 'Internal server error retrieving map.' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { detail: 'Authentication credentials were not provided.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { detail: 'ID parameter is required.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description, share, center_lon, center_lat, zoom, basemap_id, layers } = body;

    const selectResult = await pool.query('SELECT * FROM map_workspaces WHERE id = $1', [id]);
    if (selectResult.rows.length === 0) {
      return NextResponse.json(
        { detail: `Map workspace with ID "${id}" not found.` },
        { status: 404 }
      );
    }

    const existing = selectResult.rows[0];
    if (existing.created_by && existing.created_by !== user.username) {
      return NextResponse.json(
        { detail: 'You do not have permission to update this workspace.' },
        { status: 403 }
      );
    }

    let updatedName = existing.name;
    if (name !== undefined) {
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
      updatedName = trimmedName;
    }

    const updatedDesc = description !== undefined ? (typeof description === 'string' ? description.trim() : description) : existing.description;
    const updatedShare = share !== undefined ? share : existing.share;
    const updatedCenterLon = center_lon !== undefined ? center_lon : existing.center_lon;
    const updatedCenterLat = center_lat !== undefined ? center_lat : existing.center_lat;
    const updatedZoom = zoom !== undefined ? zoom : existing.zoom;
    const updatedBasemapId = basemap_id !== undefined ? basemap_id : existing.basemap_id;
    const parsedLayers = layers !== undefined
      ? (Array.isArray(layers) ? layers : typeof layers === 'string' ? (() => { try { return JSON.parse(layers); } catch { return []; } })() : [])
      : (existing.layers ? (Array.isArray(existing.layers) ? existing.layers : (() => { try { return JSON.parse(existing.layers); } catch { return []; } })()) : []);
    const updatedTime = new Date().toISOString();

    await pool.query(
      `UPDATE map_workspaces 
       SET name = $1, description = $2, share = $3, center_lon = $4, center_lat = $5, 
           zoom = $6, basemap_id = $7, layers = $8, updated_at = $9 
       WHERE id = $10`,
      [
        updatedName,
        updatedDesc,
        updatedShare,
        updatedCenterLon != null ? Number(updatedCenterLon) : null,
        updatedCenterLat != null ? Number(updatedCenterLat) : null,
        updatedZoom != null ? Number(updatedZoom) : null,
        updatedBasemapId,
        JSON.stringify(parsedLayers),
        updatedTime,
        id
      ]
    );

    const updatedMap = {
      id,
      name: updatedName,
      description: updatedDesc || '',
      share: updatedShare || 'PRIVATE',
      type: existing.type,
      center_lon: updatedCenterLon,
      center_lat: updatedCenterLat,
      zoom: updatedZoom,
      basemap_id: updatedBasemapId,
      layers: parsedLayers,
      created_by: existing.created_by,
      created_at: existing.created_at,
      updated_at: updatedTime,
    };

    return NextResponse.json(updatedMap);
  } catch (err) {
    console.error('Failed to update map workspace:', err);
    return NextResponse.json(
      { detail: 'Internal server error updating map.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json(
        { detail: 'Authentication credentials were not provided.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { detail: 'ID parameter is required.' },
        { status: 400 }
      );
    }

    const selectResult = await pool.query('SELECT * FROM map_workspaces WHERE id = $1', [id]);
    if (selectResult.rows.length === 0) {
      return NextResponse.json(
        { detail: `Map workspace with ID "${id}" not found.` },
        { status: 404 }
      );
    }

    const existing = selectResult.rows[0];
    if (existing.created_by && existing.created_by !== user.username) {
      return NextResponse.json(
        { detail: 'You do not have permission to delete this workspace.' },
        { status: 403 }
      );
    }

    await pool.query('DELETE FROM map_workspaces WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete map workspace:', err);
    return NextResponse.json(
      { detail: 'Internal server error deleting map.' },
      { status: 500 }
    );
  }
}
