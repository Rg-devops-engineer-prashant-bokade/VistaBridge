// ============================================================================
// Clear Map Measurements Route (/api/maps/measurements/clear)
//
// Clears all saved distance lines and area measurements for a given `map_id`
// from the SQLite database.
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

export async function DELETE(request: Request) {
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

    await pool.query('DELETE FROM map_measurements WHERE map_id = $1', [mapId]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to clear map measurements:', err);
    return NextResponse.json(
      { detail: 'Internal server error clearing measurements.' },
      { status: 500 }
    );
  }
}
