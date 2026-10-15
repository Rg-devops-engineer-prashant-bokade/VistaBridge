// ============================================================================
// Custom Basemaps API Route (/api/basemaps)
//
// In GIS, users often want custom tile layers as background maps:
// - GET: Retrieves custom basemap layers saved by the authenticated user
// - POST: Saves a new XYZ/tile basemap URL, name, and thumbnail in SQLite
// ============================================================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';
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

export async function GET(request: Request) {
  try {
    await initDb();
    const result = await pool.query(
      'SELECT id, username, name, description AS desc, url, thumbnail, attributions, created_at FROM custom_basemaps ORDER BY created_at ASC'
    );

    const basemaps = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      desc: row.desc || '',
      url: row.url,
      thumbnail: row.thumbnail || '',
      attributions: row.attributions || '',
      created_at: row.created_at,
      isCustom: true,
    }));

    return NextResponse.json(basemaps);
  } catch (err: any) {
    console.error('Failed to get custom basemaps:', err);
    return NextResponse.json({ detail: 'Internal server error fetching custom basemaps.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, url, description, thumbnail, attributions } = body;

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedUrl = typeof url === 'string' ? url.trim() : '';

    if (!trimmedName) {
      return NextResponse.json({ detail: 'Basemap name is required.' }, { status: 400 });
    }

    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return NextResponse.json({ detail: 'Basemap name must be between 2 and 100 characters.' }, { status: 400 });
    }

    if (!trimmedUrl) {
      return NextResponse.json({ detail: 'Tile URL is required.' }, { status: 400 });
    }

    // Basic URL format validation
    try {
      // Allow URL templates with {z}, {x}, {y}
      const testUrl = trimmedUrl.replace(/\{[xyzs]\}/gi, '0');
      new URL(testUrl);
    } catch {
      return NextResponse.json({ detail: 'Invalid URL format. Please provide a valid XYZ tile URL (e.g., https://example.com/{z}/{x}/{y}.png).' }, { status: 400 });
    }

    const id = `custom_${crypto.randomUUID()}`;
    const desc = typeof description === 'string' ? description.trim() : '';
    const thumb = typeof thumbnail === 'string' ? thumbnail.trim() : '';
    const attr = typeof attributions === 'string' ? attributions.trim() : '';

    await initDb();
    const result = await pool.query(
      `INSERT INTO custom_basemaps (id, username, name, description, url, thumbnail, attributions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, name, description AS desc, url, thumbnail, attributions, created_at`,
      [id, user.username, trimmedName, desc, trimmedUrl, thumb, attr]
    );

    const created = result.rows[0];
    return NextResponse.json({
      id: created.id,
      name: created.name,
      desc: created.desc || '',
      url: created.url,
      thumbnail: created.thumbnail || '',
      attributions: created.attributions || '',
      created_at: created.created_at,
      isCustom: true,
    }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to create custom basemap:', err);
    return NextResponse.json({ detail: 'Internal server error creating custom basemap.' }, { status: 500 });
  }
}
