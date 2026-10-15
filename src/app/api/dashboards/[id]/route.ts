// ============================================================================
// Single Dashboard API Route (/api/dashboards/[id])
//
// Manages individual dashboard records in SQLite:
// - GET: Retrieves the saved dashboard canvas layout, widget configurations,
//        and tags. Allows public viewing if marked as `is_public`.
// - PUT: Saves layout changes, repositioned widgets, or updated settings.
// - DELETE: Removes the dashboard from the database (creator/admin only).
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

const COLS = `id, name, description, is_public, content, tags, version, thumbnail, created_by, geoserver_url, created_at, updated_at`;

type Ctx = { params: Promise<{ id: string }> };

// GET /api/dashboards/[id]
export async function GET(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT ${COLS} FROM dashboards WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return NextResponse.json({ detail: `Dashboard with ID "${id}" not found.` }, { status: 404 });
    }

    const dashboard = rows[0];
    const isPublic = Boolean(dashboard.is_public);

    // Enforce authentication & ownership for private dashboards
    if (!isPublic) {
      if (!user) {
        return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
      }
      if (dashboard.created_by && dashboard.created_by !== user.username) {
        return NextResponse.json(
          { detail: 'You do not have permission to view this dashboard.' },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(dashboard);
  } catch (err) {
    console.error('[GET /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// PUT /api/dashboards/[id] — full save
export async function PUT(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });

    let body: any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ detail: 'Invalid JSON body.' }, { status: 400 }); }

    const { name, description, is_public, content, tags, thumbnail } = body;
    if (!content || !Array.isArray(content.widgets)) {
      return NextResponse.json({ detail: 'content.widgets array is required.' }, { status: 400 });
    }

    const check = await pool.query(
      'SELECT id, created_by FROM dashboards WHERE id = $1',
      [id]
    );
    if (!check.rows.length) {
      return NextResponse.json({
        detail: `Dashboard id=${id} not found.`,
      }, { status: 404 });
    }

    const existing = check.rows[0];
    if (existing.created_by && existing.created_by !== user.username) {
      return NextResponse.json({
        detail: 'You do not have permission to modify this dashboard.',
      }, { status: 403 });
    }

    const tagsArr = Array.isArray(tags)
      ? `{${tags.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`
      : null;

    const { rows } = await pool.query(
      `UPDATE dashboards
          SET name        = COALESCE($1, name),
              description = COALESCE($2, description),
              is_public   = COALESCE($3, is_public),
              content     = $4::jsonb,
              tags        = COALESCE($5::text[], tags),
              thumbnail   = COALESCE($6, thumbnail),
              version     = version + 1,
              updated_at  = NOW()
        WHERE id=$7 AND created_by=$8
        RETURNING ${COLS}`,
      [name ?? null, description ?? null, is_public ?? null, JSON.stringify(content), tagsArr, thumbnail ?? null, id, user.username]
    );
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[PUT /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// PATCH /api/dashboards/[id] — partial update
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });

    let body: any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ detail: 'Invalid JSON body.' }, { status: 400 }); }

    const check = await pool.query(
      'SELECT id, created_by FROM dashboards WHERE id = $1',
      [id]
    );
    if (!check.rows.length) {
      return NextResponse.json({ detail: `Dashboard id=${id} not found.` }, { status: 404 });
    }

    if (check.rows[0].created_by && check.rows[0].created_by !== user.username) {
      return NextResponse.json({ detail: 'You do not have permission to update this dashboard.' }, { status: 403 });
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (body.name        != null) { sets.push(`name=$${i++}`);           vals.push(body.name); }
    if (body.description != null) { sets.push(`description=$${i++}`);    vals.push(body.description); }
    if (body.is_public   != null) { sets.push(`is_public=$${i++}`);      vals.push(body.is_public); }
    if (body.content     != null) { sets.push(`content=$${i++}::jsonb`); vals.push(JSON.stringify(body.content)); }
    if (body.thumbnail   != null) { sets.push(`thumbnail=$${i++}`);      vals.push(body.thumbnail); }
    if (Array.isArray(body.tags)) {
      sets.push(`tags=$${i++}::text[]`);
      vals.push(`{${body.tags.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`);
    }

    if (!sets.length) return NextResponse.json({ detail: 'No fields to update.' }, { status: 400 });
    sets.push(`version=version+1`, `updated_at=NOW()`);
    vals.push(id, user.username);

    const { rows } = await pool.query(
      `UPDATE dashboards SET ${sets.join(',')} WHERE id=$${i++} AND created_by=$${i} RETURNING ${COLS}`,
      vals
    );
    if (!rows.length) return NextResponse.json({ detail: 'Not found.' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// DELETE /api/dashboards/[id]
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });

    const check = await pool.query(
      'SELECT id, created_by FROM dashboards WHERE id = $1',
      [id]
    );
    if (!check.rows.length) {
      return NextResponse.json({ detail: `Dashboard id=${id} not found.` }, { status: 404 });
    }

    if (check.rows[0].created_by && check.rows[0].created_by !== user.username) {
      return NextResponse.json({ detail: 'You do not have permission to delete this dashboard.' }, { status: 403 });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM dashboards WHERE id=$1 AND created_by=$2',
      [id, user.username]
    );
    if (!rowCount) return NextResponse.json({ detail: 'Not found.' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
