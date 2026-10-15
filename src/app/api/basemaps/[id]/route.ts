// ============================================================================
// Single Custom Basemap Delete Route (/api/basemaps/[id])
//
// Deletes a custom user-added tile basemap layer from SQLite (verifies ownership).
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ detail: 'Basemap ID is required.' }, { status: 400 });
    }

    await initDb();
    const isAdmin = user.role === 'ADMIN' || user.username === 'admin';
    const checkResult = await pool.query(
      isAdmin
        ? 'SELECT id FROM custom_basemaps WHERE id = $1'
        : 'SELECT id FROM custom_basemaps WHERE id = $1 AND username = $2',
      isAdmin ? [id] : [id, user.username]
    );

    if (checkResult.rows.length === 0) {
      return NextResponse.json({ detail: 'Basemap not found or unauthorized.' }, { status: 404 });
    }

    await pool.query(
      isAdmin
        ? 'DELETE FROM custom_basemaps WHERE id = $1'
        : 'DELETE FROM custom_basemaps WHERE id = $1 AND username = $2',
      isAdmin ? [id] : [id, user.username]
    );

    return NextResponse.json({ success: true, message: 'Basemap deleted successfully.' });
  } catch (err: any) {
    console.error('Failed to delete custom basemap:', err);
    return NextResponse.json({ detail: 'Internal server error deleting custom basemap.' }, { status: 500 });
  }
}
