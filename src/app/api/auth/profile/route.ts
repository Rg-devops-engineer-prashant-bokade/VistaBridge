// ============================================================================
// User Profile API Route (/api/auth/profile)
//
// Retrieves information about the currently logged-in user:
// - Extracts user identity and permissions from the JWT Bearer token
// - Returns username, email, roles (ADMIN/USER), and active GeoServer workspace info
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

function getGeoserverUrlFromRequest(request: Request): string {
  const cookiesHeader = request.headers.get('cookie') || '';
  const match = cookiesHeader.match(/geoserver_url=([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]).replace(/\/$/, '');
  }
  return (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
}

export async function GET(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  const configuredUrl = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '').toLowerCase();
  const tokenUrl = (user.geoserverUrl || '').replace(/\/+$/, '').toLowerCase();
  if (configuredUrl && tokenUrl && configuredUrl !== tokenUrl) {
    const res = NextResponse.json({ detail: 'Active GeoServer instance changed. Please sign in again.' }, { status: 401 });
    res.cookies.delete('refresh_token');
    res.cookies.delete('geoserver_auth');
    res.cookies.delete('geoserver_url');
    res.cookies.delete('geoserver_username');
    return res;
  }

  try {
    await initDb();
    const geoserverUrl = getGeoserverUrlFromRequest(request);
    const result = await pool.query(
      'SELECT first_name, last_name, email, role FROM user_profiles WHERE username = $1 AND geoserver_url = $2',
      [user.username, geoserverUrl]
    );

    if (result.rows.length === 0) {
      // Return default values based on username
      const defaultFirstName = user.username.charAt(0).toUpperCase() + user.username.slice(1);
      const defaultLastName = 'User';
      const defaultEmail = `${user.username}@vismap.com`;
      const defaultRole = user.role || 'MEMBER';

      return NextResponse.json({
        username: user.username,
        first_name: defaultFirstName,
        last_name: defaultLastName,
        email: defaultEmail,
        profile: {
          role: defaultRole
        }
      });
    }

    const row = result.rows[0];
    return NextResponse.json({
      username: user.username,
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      email: row.email || '',
      profile: {
        role: row.role || user.role || 'MEMBER'
      }
    });
  } catch (err: any) {
    console.error('Failed to get profile:', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  try {
    const { first_name, last_name, email } = await request.json();

    // Validations
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!first_name || first_name.trim().length === 0) {
      return NextResponse.json({ first_name: ['First name is required.'] }, { status: 400 });
    }
    if (first_name.length > 16) {
      return NextResponse.json({ first_name: ['First name must not exceed 16 characters.'] }, { status: 400 });
    }
    if (!/[a-zA-Z]/.test(first_name)) {
      return NextResponse.json({ first_name: ['First name must contain at least one letter.'] }, { status: 400 });
    }

    if (!last_name || last_name.trim().length === 0) {
      return NextResponse.json({ last_name: ['Last name is required.'] }, { status: 400 });
    }
    if (last_name.length > 16) {
      return NextResponse.json({ last_name: ['Last name must not exceed 16 characters.'] }, { status: 400 });
    }
    if (!/[a-zA-Z]/.test(last_name)) {
      return NextResponse.json({ last_name: ['Last name must contain at least one letter.'] }, { status: 400 });
    }
    if (email && email.trim().length > 0) {
      if (!emailRegex.test(email)) {
        return NextResponse.json({ email: ['Invalid email format.'] }, { status: 400 });
      }
      if (email.length > 100) {
        return NextResponse.json({ email: ['Email must not exceed 100 characters.'] }, { status: 400 });
      }
    }

    await initDb();
    const geoserverUrl = getGeoserverUrlFromRequest(request);

    // Save to DB scoped by geoserver_url
    const role = user.role || 'MEMBER';
    const result = await pool.query(
      `INSERT INTO user_profiles (username, geoserver_url, first_name, last_name, email, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (username, geoserver_url)
       DO UPDATE SET first_name = $3, last_name = $4, email = COALESCE($5, user_profiles.email), role = $6, updated_at = NOW()
       RETURNING first_name, last_name, email, role`,
      [user.username, geoserverUrl, first_name.trim(), (last_name || '').trim(), email ? email.trim().toLowerCase() : null, role]
    );

    const row = result.rows[0];
    return NextResponse.json({
      username: user.username,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      profile: {
        role: row.role
      }
    });
  } catch (err: any) {
    console.error('Failed to update profile:', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
