// ============================================================================
// Logout API Route (/api/auth/logout)
//
// Terminates the user's active session:
// 1. Sends a logout request to GeoServer to destroy the backend Spring session
// 2. Deletes all authentication cookies (`refresh_token`, `geoserver_auth`,
//    `geoserver_url`, and `GEOSERVER_JSESSIONID`)
// ============================================================================

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const cookiesHeader = request.headers.get('cookie') || '';
    const cookieMatch = cookiesHeader.match(/geoserver_url=([^;]+)/);
    const geoserverUrl = cookieMatch ? decodeURIComponent(cookieMatch[1]) : (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver');
    const cleanUrl = geoserverUrl.replace(/\/$/, '');

    const clientCookiesHeader = request.headers.get('cookie') || '';
    let clientCookies = clientCookiesHeader;
    if (clientCookies.includes('GEOSERVER_JSESSIONID=')) {
      clientCookies = clientCookies.replace(/GEOSERVER_JSESSIONID=/g, 'JSESSIONID=');
    }

    try {
      await fetch(`${cleanUrl}/logout`, {
        method: 'GET',
        headers: {
          'Cookie': clientCookies,
        },
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      console.error('GeoServer session logout failed:', err);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const res = NextResponse.json({ success: true });

    res.cookies.set('GEOSERVER_JSESSIONID', '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
    });

    res.cookies.set('geoserver_auth', '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
    });

    res.cookies.set('geoserver_username', '', {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
    });

    res.cookies.set('geoserver_url', '', {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
    });

    res.cookies.set('refresh_token', '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      expires: new Date(0),
      path: '/api/auth/token',
    });

    return res;
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
