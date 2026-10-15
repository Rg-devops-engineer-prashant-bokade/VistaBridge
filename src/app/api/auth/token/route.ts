// ============================================================================
// Auth Token Endpoint Route (/api/auth/token)
//
// Authenticates credentials with in-memory IP rate limiting protection:
// - Enforces max 10 failed login attempts per IP per 5-minute window
// - Issues JWT access and refresh token cookies upon successful verification
// ============================================================================

import { NextResponse } from 'next/server';
import { signJwt } from '@/lib/jwt';
import { getAppSetting } from '@/lib/settings';

// ─── Rate Limiter ────────────────────────────────────────────────────────────
// Simple in-memory store: max 10 login attempts per IP per 5 minutes.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now >= entry.resetAt) {
    // First request or window expired — reset
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  entry.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function POST(request: Request) {
  // ─── Rate Limiting ─────────────────────────────────────────────────────────
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  const { allowed, retryAfterSeconds } = checkRateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { detail: `Too many login attempts. Try again in ${retryAfterSeconds} seconds.` },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(MAX_ATTEMPTS),
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + retryAfterSeconds),
        },
      }
    );
  }
  try {
    const { username, password } = await request.json();

    let isAuthenticated = false;
    let jSessionIdCookie = null;

    // Check if the credentials are valid against GeoServer
    const defaultGeoserverUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
    const cleanUrl = defaultGeoserverUrl.replace(/\/+$/, '');

    try {
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('password', password);

      const geoRes = await fetch(`${cleanUrl}/j_spring_security_check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        redirect: 'manual',
      });

      const setCookieHeader = geoRes.headers.get('set-cookie');
      if (setCookieHeader) {
        const match = setCookieHeader.match(/JSESSIONID=([^;]+)/);
        if (match) {
          jSessionIdCookie = match[0];
        }
      }

      const location = geoRes.headers.get('location') || '';
      if (geoRes.status === 302 && !location.includes('error=true')) {
        isAuthenticated = true;
      }
    } catch (err) {
      console.error('GeoServer authentication check failed:', err);
    }

    // No backdoor fallback — if GeoServer is down or credentials are wrong, login fails.
    // This ensures all authentication is solely controlled by GeoServer.

    if (isAuthenticated) {
      const payload = { username, role: username === 'admin' ? 'ADMIN' : 'MEMBER', geoserverUrl: cleanUrl };
      // Access token valid for 1 hour; refresh token valid for 7 days
      const access = signJwt(payload, 3600);
      const refresh = signJwt(payload, 7 * 24 * 3600);
      const isProduction = process.env.NODE_ENV === 'production';

      // Return access token in JSON body (short-lived, kept in memory by Zustand)
      // Store refresh token in HttpOnly cookie — inaccessible to JavaScript (XSS-safe)
      const res = NextResponse.json({ access });

      res.cookies.set('refresh_token', refresh, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        path: '/api/auth/token',   // Scoped: only sent to the refresh endpoint
      });

      res.cookies.set('geoserver_url', encodeURIComponent(cleanUrl), {
        path: '/',
        sameSite: 'lax',
        secure: isProduction,
      });

      if (jSessionIdCookie) {
        const cookieValue = jSessionIdCookie.split('=')[1] || '';
        res.cookies.set('GEOSERVER_JSESSIONID', cookieValue, {
          path: '/',
          sameSite: 'lax',
          secure: isProduction,
        });
      }
      return res;
    }

    return NextResponse.json(
      { detail: 'Invalid credentials. Please try again.' },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { detail: 'Internal server error.' },
      { status: 500 }
    );
  }
}
