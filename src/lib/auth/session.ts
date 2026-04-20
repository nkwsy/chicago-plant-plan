/**
 * Stateless JWT sessions with `jose`.
 *
 * We deliberately roll our own instead of pulling Auth.js v5 because Next.js 16
 * renamed `middleware.ts` → `proxy.ts` (see node_modules/next/dist/docs/01-app/
 * 01-getting-started/16-proxy.md). The Auth.js re-export pattern
 * (`export { auth as middleware }`) doesn't fit the new convention, and we want
 * the implementation small enough that the naming mismatch isn't papered over
 * by a dependency upgrade.
 *
 * Design:
 *  - HS256 JWT signed by SESSION_SECRET (32+ random bytes, base64).
 *  - Payload carries just { userId, email, role, exp }. Claims are small so the
 *    cookie stays well under the 4 KB browser limit.
 *  - 7-day expiry; no refresh endpoint — user re-signs in via Google if it
 *    lapses. OAuth round-trip is cheap enough that refresh tokens aren't worth
 *    the complexity at this scale.
 *  - Cookie is httpOnly + secure (prod) + sameSite='lax' so it survives the
 *    Google OAuth redirect back to us.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { UserRole } from '@/lib/db/user';

const COOKIE_NAME = 'cpp_session';
const ALG = 'HS256';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export { COOKIE_NAME, MAX_AGE_SECONDS };

export interface SessionPayload extends JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  name?: string;
  image?: string;
}

function getSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) {
    throw new Error(
      'SESSION_SECRET is not set. Generate one with `openssl rand -base64 32` and add it to .env.local.',
    );
  }
  return new TextEncoder().encode(raw);
}

/** Sign a new session JWT. Expiry is embedded in the token. */
export async function encryptSession(
  payload: Omit<SessionPayload, 'exp' | 'iat'>,
): Promise<string> {
  return await new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

/** Verify a session JWT. Returns null on missing/invalid/expired tokens. */
export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALG] });
    // Narrow to SessionPayload. jwtVerify already validated exp, so the only
    // reason we'd fail here is if the shape is wrong (rotated secret + an old
    // token that slipped through).
    if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Shape used by cookie setters (Next `cookies().set(...)`). */
export function sessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}
