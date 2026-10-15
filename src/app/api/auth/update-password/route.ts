// ============================================================================
// Password Update API Route (/api/auth/update-password)
//
// Updates the authenticated user's credentials:
// 1. Verifies the existing password against GeoServer's security API
// 2. Enforces password matching and strength validation
// 3. Updates the user account password in GeoServer
// ============================================================================

import { NextResponse, NextRequest } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';

function getAuthUser(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyJwt(token);
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  try {
    const { old_password, new_password, confirm_new_password } = await request.json();

    if (!old_password || !new_password || !confirm_new_password) {
      return NextResponse.json({ detail: 'All fields are required.' }, { status: 400 });
    }

    if (new_password !== confirm_new_password) {
      return NextResponse.json({ new_password: ['New passwords do not match.'] }, { status: 400 });
    }

    if (/\s/.test(new_password)) {
      return NextResponse.json({ new_password: ['Password must not contain spaces.'] }, { status: 400 });
    }

    if (new_password.length < 8) {
      return NextResponse.json({ new_password: ['New password must be at least 8 characters long.'] }, { status: 400 });
    }

    // Complexity validation: must contain one uppercase, one lowercase and one number
    const hasUppercase = /[A-Z]/.test(new_password);
    const hasLowercase = /[a-z]/.test(new_password);
    const hasNumber = /[0-9]/.test(new_password);
    if (!hasUppercase || !hasLowercase || !hasNumber) {
      return NextResponse.json({ new_password: ['New password must contain at least one uppercase letter, one lowercase letter, and one number.'] }, { status: 400 });
    }

    if (new_password === old_password) {
      return NextResponse.json({ new_password: ['New password cannot be the same as the old password.'] }, { status: 400 });
    }

    // 1. Verify old password using session cookies first (local check)
    const basicAuthCookie = request.cookies.get('geoserver_auth')?.value;
    let cookiePasswordVerified = false;
    if (basicAuthCookie && basicAuthCookie.startsWith('Basic ')) {
      const credentials = Buffer.from(basicAuthCookie.substring(6), 'base64').toString('utf8');
      const [cookieUsername, cookiePassword] = credentials.split(':');

      if (old_password !== cookiePassword) {
        return NextResponse.json({ old_password: ['Incorrect current password.'] }, { status: 400 });
      }
      cookiePasswordVerified = true;
    }

    // 2. Perform live check against GeoServer if local check wasn't possible or just as a validation fallback
    const geoserverUrl = request.cookies.get('geoserver_url')?.value || process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver';
    const cleanUrl = geoserverUrl.replace(/\/$/, '');
    const oldBasicAuth = 'Basic ' + Buffer.from(`${user.username}:${old_password}`).toString('base64');

    if (!cookiePasswordVerified) {
      try {
        const params = new URLSearchParams();
        params.append('username', user.username);
        params.append('password', old_password);

        const serverFetchUrl = resolveInternalGeoServerUrl(cleanUrl);
        const testRes = await fetch(`${serverFetchUrl}/j_spring_security_check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
          redirect: 'manual',
          signal: AbortSignal.timeout(4000),
        });

        const location = testRes.headers.get('location') || '';
        const success = testRes.status === 302 && !location.includes('error=true');
        if (!success) {
          return NextResponse.json({ old_password: ['Incorrect current password.'] }, { status: 400 });
        }
      } catch (err) {
        console.warn('Fallback network check for current password failed:', err);
        return NextResponse.json({ old_password: ['Could not contact authentication service.'] }, { status: 400 });
      }
    }

    // 3. Try to update password in GeoServer via self-admin endpoint
    try {
      const serverFetchUrl = resolveInternalGeoServerUrl(cleanUrl);
      const geoRes = await fetch(`${serverFetchUrl}/rest/security/self/password`, {
        method: 'PUT',
        headers: {
          'Authorization': oldBasicAuth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          newPassword: new_password
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!geoRes.ok) {
        const errorText = await geoRes.text();
        console.warn(`GeoServer self password update returned status ${geoRes.status}: ${errorText}`);
        return NextResponse.json({ detail: `Failed to update password in GeoServer (Status ${geoRes.status}).` }, { status: 400 });
      }

      console.log('Successfully updated password on GeoServer.');
    } catch (err: any) {
      console.error('Failed to update password in GeoServer:', err);
      return NextResponse.json({ detail: `Failed to connect to GeoServer for password update: ${err.message || 'Connection timeout'}` }, { status: 500 });
    }

    const newBasicAuth = 'Basic ' + Buffer.from(`${user.username}:${new_password}`).toString('base64');

    // Prepare response
    const response = NextResponse.json({
      detail: 'Password updated successfully.',
      geoserverAuth: newBasicAuth
    });

    // Update the geoserver_auth cookie with the new password basic auth token
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookies.set('geoserver_auth', newBasicAuth, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    return NextResponse.json({ detail: 'Invalid request body or internal error.' }, { status: 400 });
  }
}
