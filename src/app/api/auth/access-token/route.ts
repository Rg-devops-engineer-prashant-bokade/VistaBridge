// ============================================================================
// External API Access Token Route (/api/auth/access-token)
//
// Manages API access keys for third-party script integrations:
// - GET: Retrieves the user's active API integration key
// - POST: Generates and rolls a new API key
// ============================================================================

import { NextResponse } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import crypto from 'crypto';

let currentAccessToken = 'vismap_data_access_token_mock_key_abc123';

function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyJwt(token);
}

export async function GET(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  return NextResponse.json({ access_token: currentAccessToken });
}

export async function POST(request: Request) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
  }

  currentAccessToken = `vismap_data_access_token_mock_key_${crypto.randomBytes(8).toString('hex')}`;
  return NextResponse.json({ access_token: currentAccessToken });
}
