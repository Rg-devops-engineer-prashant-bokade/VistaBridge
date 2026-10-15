// ============================================================================
// Single Measurement Delete Route (/api/maps/measurements/[id])
//
// Removes a specific distance or area measurement record from SQLite by its ID.
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureDb();
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { detail: 'ID parameter is required.' },
        { status: 400 }
      );
    }

    const result = await pool.query('DELETE FROM map_measurements WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json(
        { detail: `Measurement with ID "${id}" not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete map measurement:', err);
    return NextResponse.json(
      { detail: 'Internal server error deleting measurement.' },
      { status: 500 }
    );
  }
}
