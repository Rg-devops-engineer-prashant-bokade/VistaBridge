// ============================================================================
// Login API (POST /api/auth/login)
//
// 1. Verifies username and password against GeoServer (/j_spring_security_check).
// 2. Checks if user is an admin (/rest/about/system-status.json).
// 3. Generates JWT access/refresh tokens.
// 4. Creates or updates the user profile in local SQLite (user_profiles table).
// 5. Sets secure HttpOnly cookies so GeoServer requests work automatically.
// ============================================================================


import { NextResponse } from 'next/server';
import { signJwt } from '@/lib/jwt';
import { pool, initDb } from '@/lib/db';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';
import { getAppSetting } from '@/lib/settings';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, geoserverUrl } = body;

    if (!username || !password) {
      return NextResponse.json(
        { detail: 'Username and password are required.' },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------------
    // STEP 1: Resolve target GeoServer URL & encode HTTP Basic credentials
    // ------------------------------------------------------------------------
    const defaultGeoserverUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
    const rawTarget = geoserverUrl || defaultGeoserverUrl;
    const serverFetchUrl = resolveInternalGeoServerUrl(rawTarget);
    const cleanUrl = serverFetchUrl.replace(/\/+$/, '');

    // Encode Basic Authentication token
    const basicAuth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');


    let isAuthenticated = false;
    let isAdmin = false;

    try {
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('password', password);

      const geoRes = await fetch(`${serverFetchUrl}/j_spring_security_check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });

      const location = geoRes.headers.get('location') || '';
      if (geoRes.status === 302 && !location.includes('error=true')) {
        isAuthenticated = true;
      }
    } catch (err) {
      console.error('GeoServer login verification failed:', err);
    }

    if (isAuthenticated) {
      if (username.toLowerCase() === 'admin') {
        isAdmin = true;
      }
      // Check if user is admin via system-status
      try {
        const statusRes = await fetch(`${serverFetchUrl}/rest/about/system-status.json`, {
          method: 'GET',
          headers: {
            'Authorization': basicAuth,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(3000),
        });

        if (statusRes.status === 200) {
          isAdmin = true;
        }
      } catch (err) {
        // Safe to ignore, fallback is non-admin
      }
    }

    if (!isAuthenticated) {
      return NextResponse.json(
        { detail: 'Invalid credentials or unable to contact GeoServer.' },
        { status: 401 }
      );
    }

    // JWT sign for frontend site status compatibility
    const role = isAdmin ? 'ADMIN' : 'MEMBER';
    const payload = { username, role, geoserverUrl: cleanUrl };
    const access = signJwt(payload, 3600);
    const refresh = signJwt(payload, 7 * 24 * 3600);

    let firstName = '';
    let lastName = '';
    let emailAddress = '';

    try {
      await initDb();
      const profileResult = await pool.query(
        'SELECT first_name, last_name, email, role FROM user_profiles WHERE username = $1 AND geoserver_url = $2',
        [username, cleanUrl]
      );
      if (profileResult.rows.length > 0) {
        firstName = profileResult.rows[0].first_name || '';
        lastName = profileResult.rows[0].last_name || '';
        emailAddress = profileResult.rows[0].email || '';
        // Keep database role in sync with live GeoServer authority
        const currentRole = isAdmin ? 'ADMIN' : 'MEMBER';
        if (profileResult.rows[0].role !== currentRole) {
          await pool.query(
            'UPDATE user_profiles SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2 AND geoserver_url = $3',
            [currentRole, username, cleanUrl]
          );
        }
      } else {
        // First-time login: Auto-create user profile in database
        const autoRole = isAdmin ? 'ADMIN' : 'MEMBER';
        const autoFirst = username.charAt(0).toUpperCase() + username.slice(1);
        firstName = autoFirst;
        lastName = 'User';
        emailAddress = `${username}@vismap.com`;

        await pool.query(
          `INSERT INTO user_profiles (username, geoserver_url, role, first_name, last_name, email)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (username, geoserver_url) DO UPDATE SET role = EXCLUDED.role`,
          [username, cleanUrl, autoRole, autoFirst, lastName, emailAddress]
        );
      }
    } catch (dbErr) {
      console.error('Error fetching or bootstrapping profile on login:', dbErr);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({
      success: true,
      access,
      username,
      role: isAdmin ? 'ADMIN' : 'USER',
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      email: emailAddress || undefined,
      geoserverUrl: cleanUrl,
    });

    // Set GeoServer Auth Cookies
    response.cookies.set('geoserver_auth', basicAuth, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    response.cookies.set('geoserver_username', username, {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    response.cookies.set('geoserver_url', cleanUrl, {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // Also set standard refresh token cookie for backward compatibility
    response.cookies.set('refresh_token', refresh, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/api/auth/token',
    });

    return response;
  } catch (error: any) {
    console.error('Login route error:', error);
    return NextResponse.json(
      { detail: 'Internal server error during authentication.' },
      { status: 500 }
    );
  }
}
