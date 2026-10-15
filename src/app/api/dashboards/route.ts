// ============================================================================
// Dashboards API (GET /api/dashboards & POST /api/dashboards)
//
// Manages dashboard layouts saved by users:
// - GET: Returns all dashboards created by the logged-in user
// - POST: Creates a new dashboard with widget layouts, charts, and KPIs
// All records are saved in the SQLite dashboards table.
// ============================================================================


import { NextResponse } from 'next/server';
import crypto from 'crypto';
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
    return decodeURIComponent(match[1]).replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/+$/, '');
}

const COLS = `id, name, description, is_public, content, tags, version, thumbnail, created_by, created_at, updated_at`;


// GET /api/dashboards
export async function GET(request: Request) {
  try {
    await ensureDb();
    const user = getUser(request);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });

    const configuredUrl = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '').toLowerCase();
    const tokenUrl = (user.geoserverUrl || '').replace(/\/+$/, '').toLowerCase();
    if (configuredUrl && tokenUrl && configuredUrl !== tokenUrl) {
      return NextResponse.json({ detail: 'Active GeoServer instance changed. Please sign in again.' }, { status: 401 });
    }

    const geoserverUrl = getGeoserverUrl(request, user);
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM dashboards WHERE created_by = $1 AND geoserver_url = $2 ORDER BY updated_at DESC`,
      [user.username, geoserverUrl]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /dashboards]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/dashboards
export async function POST(request: Request) {
  try {
    await ensureDb();
    const user = getUser(request);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });

    const configuredUrl = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '').toLowerCase();
    const tokenUrl = (user.geoserverUrl || '').replace(/\/+$/, '').toLowerCase();
    if (configuredUrl && tokenUrl && configuredUrl !== tokenUrl) {
      return NextResponse.json({ detail: 'Active GeoServer instance changed. Please sign in again.' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, is_public, content, tags, thumbnail } = body;
    if (!name?.trim()) return NextResponse.json({ detail: 'name is required.' }, { status: 400 });

    const tagsArr = Array.isArray(tags)
      ? `{${tags.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`
      : '{}';

    const id = crypto.randomUUID();
    const geoserverUrl = getGeoserverUrl(request, user);
    const { rows } = await pool.query(
      `INSERT INTO dashboards (id, name, description, is_public, content, tags, thumbnail, created_by, geoserver_url)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9)
       RETURNING ${COLS}`,
      [
        id,
        name.trim(),
        description ?? '',
        is_public ?? false,
        JSON.stringify(content ?? { widgets: [] }),
        tagsArr,
        thumbnail ?? null,
        user.username,
        geoserverUrl,
      ]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('[POST /dashboards]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
