// ============================================================================
// Clear Map Annotations Route (/api/maps/annotations/clear)
//
// Removes all saved annotations and markups belonging to a given `map_id`
// from the SQLite database in a single transaction.
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

    await pool.query('DELETE FROM map_annotations WHERE map_id = $1', [mapId]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to clear map annotations:', err);
    return NextResponse.json(
      { detail: 'Internal server error clearing annotations.' },
      { status: 500 }
    );
  }
}
