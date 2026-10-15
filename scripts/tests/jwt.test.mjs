import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Reusable JWT implementation logic matching src/lib/jwt.ts
function signJwt(payload, secret = 'test-secret-key-123', expiresInSeconds = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}

function verifyJwt(token, secret = 'test-secret-key-123') {
  try {
    const [headerB64, payloadB64, signature] = token.split('.');
    if (!headerB64 || !payloadB64 || !signature) return null;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (signature !== expectedSignature) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

test('JWT Suite: Successfully signs and verifies token', () => {
  const data = { userId: 101, role: 'admin' };
  const token = signJwt(data);
  assert.ok(typeof token === 'string');

  const decoded = verifyJwt(token);
  assert.strictEqual(decoded.userId, 101);
  assert.strictEqual(decoded.role, 'admin');
});

test('JWT Suite: Rejects token with invalid secret', () => {
  const token = signJwt({ user: 'alice' }, 'secret-a');
  const decoded = verifyJwt(token, 'wrong-secret-b');
  assert.strictEqual(decoded, null);
});

test('JWT Suite: Rejects expired token', () => {
  // Negative expiry (already expired)
  const expiredToken = signJwt({ user: 'bob' }, 'test-secret-key-123', -10);
  const decoded = verifyJwt(expiredToken);
  assert.strictEqual(decoded, null);
});

