// ============================================================================
// Map Measurements API Route (/api/maps/measurements)
//
// In GIS, users measure distances (lines in meters/kilometers) and land areas
// (polygons in hectares/square meters).
//
// This route saves and retrieves those measurements in SQLite so they can be
// displayed whenever the user re-opens the map.
//
// Methods:
// - GET: Retrieves all measurement records for a given map_id
// - POST: Saves a new measurement (length or area with display text)
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
      'SELECT id, map_id, geometry, display_val, type, created_at FROM map_measurements WHERE map_id = $1 ORDER BY created_at ASC',
      [mapId]
    );

    const measurements = result.rows.map(row => ({
      id: row.id,
      map: row.map_id,
      geometry: row.geometry,
      display_val: row.display_val,
      type: row.type,
      created_at: row.created_at,
    }));

    return NextResponse.json(measurements);
  } catch (err) {
    console.error('Failed to get map measurements:', err);
    return NextResponse.json(
      { detail: 'Internal server error retrieving measurements.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const body = await request.json();
    const { id, map, geometry, display_val, type } = body;

    if (!id || !map || !geometry || !type) {
      return NextResponse.json(
        { detail: 'Missing required fields: id, map, geometry, type.' },
        { status: 400 }
      );
    }

    // Insert or update on conflict
    await pool.query(
      `INSERT INTO map_measurements (id, map_id, geometry, display_val, type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) 
       DO UPDATE SET geometry = $3, display_val = $4, type = $5`,
      [id, map, JSON.stringify(geometry), display_val || '', type]
    );

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('Failed to save map measurement:', err);
    return NextResponse.json(
      { detail: 'Internal server error saving measurement.' },
      { status: 500 }
    );
  }
}
