// ============================================================================
// GoToXY Bookmarks API Route (/api/advanced-tools/goto-xy)
//
// In GIS navigation, users save favourite map coordinates:
// - GET: Retrieves bookmarked location pins (latitude, longitude, zoom level)
// - POST: Saves a new coordinate bookmark to the SQLite database
// ============================================================================

import { NextResponse } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import { pool, initDb } from '@/lib/db';

function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyJwt(token);
}

export async function GET(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mapId = searchParams.get('map_id');

  try {
    await initDb();
    let query: string;
    let params: any[];

    if (mapId) {
      query = 'SELECT id, map_id, name, latitude, longitude, zoom, created_at, username FROM goto_xy_points WHERE map_id = $1 ORDER BY created_at DESC';
      params = [mapId];
    } else {
      query = 'SELECT id, map_id, name, latitude, longitude, zoom, created_at, username FROM goto_xy_points WHERE username = $1 AND (map_id IS NULL OR map_id = \'\') ORDER BY created_at DESC';
      params = [user.username];
    }

    const result = await pool.query(query, params);
    return NextResponse.json(result.rows);
  } catch (err: any) {
    console.error('Failed to get GoToXY points:', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  try {
    const { map_id, name, latitude, longitude, zoom } = await request.json();

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ detail: 'Name is required.' }, { status: 400 });
    }
    if (latitude === undefined || longitude === undefined) {
      return NextResponse.json({ detail: 'Latitude and longitude are required.' }, { status: 400 });
    }

    await initDb();
    const result = await pool.query(
      'INSERT INTO goto_xy_points (username, map_id, name, latitude, longitude, zoom) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, map_id, name, latitude, longitude, zoom, created_at',
      [user.username, map_id || null, name.trim(), latitude, longitude, zoom ?? null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err: any) {
    console.error('Failed to create GoToXY point:', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
