// ============================================================================
// Dashboard Charts API Route (/api/dashboards/charts)
//
// Manages saved chart definitions in SQLite:
// - GET: Lists reusable charts created by the user or configured for the active GeoServer
// - POST: Creates a new chart card definition (metrics, chart type, dataset ID)
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
    return decodeURIComponent(match[1]).replace(/\/$/, '');
  }
  return (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
}

// GET /api/dashboards/charts
export async function GET(req: Request) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });

    const geoserverUrl = getGeoserverUrl(req, user);
    const { rows } = await pool.query(
      `SELECT id, title, chart_type, config, created_at FROM dashboard_charts WHERE created_by = $1 AND geoserver_url = $2 ORDER BY created_at DESC`,
      [user.username, geoserverUrl]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[GET /dashboards/charts]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/dashboards/charts
export async function POST(req: Request) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });

    const body = await req.json();
    const { title, chart_type, config } = body;
    if (!title?.trim()) return NextResponse.json({ detail: 'title is required.' }, { status: 400 });
    if (!chart_type?.trim()) return NextResponse.json({ detail: 'chart_type is required.' }, { status: 400 });

    const id = crypto.randomUUID();
    const geoserverUrl = getGeoserverUrl(req, user);
    const { rows } = await pool.query(
      `INSERT INTO dashboard_charts (id, title, chart_type, config, created_by, geoserver_url)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, title, chart_type, config, created_at`,
      [id, title.trim(), chart_type.trim(), JSON.stringify(config ?? {}), user.username, geoserverUrl]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('[POST /dashboards/charts]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
