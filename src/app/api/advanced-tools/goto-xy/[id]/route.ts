// ============================================================================
// Edit & Delete GoToXY Bookmark Route (/api/advanced-tools/goto-xy/[id])
//
// Manages an individual coordinate bookmark in SQLite:
// - PATCH: Renames an existing location bookmark
// - DELETE: Permanently deletes the location bookmark
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { name } = await request.json();

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ detail: 'Name is required.' }, { status: 400 });
    }

    await initDb();
    const result = await pool.query(
      'UPDATE goto_xy_points SET name = $1 WHERE id = $2 AND (username = $3 OR map_id IS NOT NULL) RETURNING id, map_id, name, latitude, longitude, zoom, created_at',
      [name.trim(), id, user.username]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ detail: 'Point not found.' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    console.error('Failed to update GoToXY point:', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await initDb();
    const result = await pool.query(
      'DELETE FROM goto_xy_points WHERE id = $1 AND (username = $2 OR map_id IS NOT NULL) RETURNING id',
      [id, user.username]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ detail: 'Point not found.' }, { status: 404 });
    }

    return NextResponse.json({ detail: 'Point deleted successfully.' });
  } catch (err: any) {
    console.error('Failed to delete GoToXY point:', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
