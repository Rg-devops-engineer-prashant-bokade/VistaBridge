// ============================================================================
// Map Annotations API Route (/api/maps/annotations)
//
// Users can draw custom markers, text notes, and shapes directly on the map.
// This route saves and retrieves those annotations in SQLite so they persist
// when the user re-opens their map workspace.
//
// Methods:
// - GET: Retrieves all annotations linked to a given map_id
// - POST: Saves a new user-drawn annotation (pin, text, or polygon markup)
// ============================================================================

import { NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';

let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

export async function GET(request: Request) {
  try {
    await ensureDb();
    const { searchParams } = new URL(request.url);
    const mapId = searchParams.get('map_id');

    if (!mapId) {
      return NextResponse.json(
        { detail: 'map_id query parameter is required.' },
        { status: 400 }
      );
    }

    const result = await pool.query(
      'SELECT id, map_id, geometry, label, type, created_at FROM map_annotations WHERE map_id = $1 ORDER BY created_at ASC',
      [mapId]
    );

    // Map database keys to frontend keys if needed (map_id -> map)
    const annotations = result.rows.map(row => ({
      id: row.id,
      map: row.map_id,
      geometry: row.geometry,
      label: row.label,
      type: row.type,
      created_at: row.created_at,
    }));

    return NextResponse.json(annotations);
  } catch (err) {
    console.error('Failed to get map annotations:', err);
    return NextResponse.json(
      { detail: 'Internal server error retrieving annotations.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const body = await request.json();
    const { id, map, geometry, label, type } = body;

    if (!id || !map || !geometry || !type) {
      return NextResponse.json(
        { detail: 'Missing required fields: id, map, geometry, type.' },
        { status: 400 }
      );
    }

    // Insert or update on conflict
    await pool.query(
      `INSERT INTO map_annotations (id, map_id, geometry, label, type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) 
       DO UPDATE SET geometry = $3, label = $4, type = $5`,
      [id, map, JSON.stringify(geometry), label || '', type]
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('Failed to save map annotation:', err);
    return NextResponse.json(
      { detail: 'Internal server error saving annotation.' },
      { status: 500 }
    );
  }
}
