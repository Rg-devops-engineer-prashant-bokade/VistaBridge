// ============================================================================
// Single Dashboard Chart Delete Route (/api/dashboards/charts/[id])
//
// Removes a saved chart widget definition from SQLite by its ID (creator only).
// ============================================================================

import { NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';
import { verifyJwt } from '@/lib/jwt';

let dbReady: Promise<void> | null = null;
function ensureDb() {
  if (!dbReady) dbReady = initDb().catch((err) => { dbReady = null; throw err; });
  return dbReady;
}

function getUser(req: Request) {
  const h = req.headers.get('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return verifyJwt(h.slice(7));
}

function getGeoserverUrl(req: Request, user: any): string {
  if (user?.geoserverUrl) return user.geoserverUrl;
  const cookiesHeader = req.headers.get('cookie') || '';
  const match = cookiesHeader.match(/geoserver_url=([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]).replace(/\/$/, '');
  }
  return (process.env.NEXT_PUBLIC_GEOSERVER_URL || '').replace(/\/$/, '');
}

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/dashboards/charts/[id]
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    const geoserverUrl = getGeoserverUrl(req, user);

    const { rowCount } = await pool.query(
      'DELETE FROM dashboard_charts WHERE id = $1 AND created_by = $2 AND geoserver_url = $3',
      [id, user.username, geoserverUrl]
    );
    if (!rowCount) return NextResponse.json({ detail: 'Not found.' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /dashboards/charts/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
