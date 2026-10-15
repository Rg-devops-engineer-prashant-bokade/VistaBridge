// ============================================================================
// JWT Helper (JSON Web Tokens)
//
// Creates and verifies login session tokens using Node.js built-in crypto.
// Does not need external packages like 'jsonwebtoken'.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';

// In-memory cache for the secret key so we don't query the database every time
let cachedJwtSecret: string = process.env.JWT_SECRET || '';

// Saves the secret key in memory (called when database starts up)
export function setCachedJwtSecret(secret: string) {
  if (secret) {
    cachedJwtSecret = secret;
  }
}

// Gets the active secret key for signing tokens
export function getJwtSecret(): string {
  if (cachedJwtSecret) return cachedJwtSecret;
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  return 'geovista-sqlite-persisted-jwt-secret-key-stable-default';
}

// Signs a new JWT token (header.payload.signature) with an expiration time
export function signJwt(payload: Record<string, any>, expiresInSeconds: number = 3600): string {
  const secret = getJwtSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  // Add expiration timestamp (in seconds)
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  // Base64URL encode the header and payload
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  // Create HMAC-SHA256 signature using the secret key
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

// Verifies a JWT token:
// 1. Checks that the signature matches our secret key
// 2. Checks if the token has expired
// Returns the decoded user payload if valid, or null if invalid/expired.
export function verifyJwt(token: string): Record<string, any> | null {
  try {
    const secret = getJwtSecret();
    const [headerB64, payloadB64, signature] = token.split('.');
    if (!headerB64 || !payloadB64 || !signature) return null;

    // Recalculate signature to verify token wasn't tampered with
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signature !== expectedSignature) return null;

    // Decode and parse the payload JSON
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    // Check expiration timestamp
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // Token expired
    }
    return payload;
  } catch {
    return null;
  }
}


