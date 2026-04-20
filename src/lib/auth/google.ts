/**
 * Google OAuth 2.0 — minimal auth-code flow.
 *
 * We don't need refresh tokens (our JWT session lasts 7 days and re-login is
 * one click), so `access_type=online` + no prompt consent is enough. We only
 * read the `profile` + `email` scopes, enough to populate our User doc.
 *
 * Flow:
 *  1. /api/auth/google/start → builds authorize URL with a signed state, sets
 *     a short-lived state cookie, redirects the browser to Google.
 *  2. /api/auth/google/callback → verifies the state cookie matches, exchanges
 *     the `code` for an id_token, decodes the id_token (without extra HTTP
 *     calls — we trust Google's signature for the 60-second-ish flow window).
 *
 * For stricter verification you'd fetch Google's JWKS and validate the id_token
 * signature. We accept the TLS round-trip + state cookie as sufficient here;
 * the payload we care about (email, sub, name, picture) is not security-
 * sensitive — only used to key off our own User doc.
 */

import { jwtVerify, SignJWT } from 'jose';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleIdPayload {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function getSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error('SESSION_SECRET is required for OAuth state signing');
  return new TextEncoder().encode(raw);
}

/** Derive the configured redirect URI. Must match the one registered in GCP. */
export function redirectUri(): string {
  const base = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`;
}

/** Build the Google authorize URL. */
export async function buildAuthorizeUrl(nextPath: string): Promise<{ url: string; state: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set');

  const state = await new SignJWT({ next: nextPath })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSecret());

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });

  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state };
}

/** Verify a signed state token from the callback; returns { next } or null. */
export async function verifyState(state: string | undefined): Promise<{ next: string } | null> {
  if (!state) return null;
  try {
    const { payload } = await jwtVerify(state, getSecret(), { algorithms: ['HS256'] });
    const next = typeof payload.next === 'string' ? payload.next : '/';
    return { next };
  } catch {
    return null;
  }
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/** Exchange authorization code for tokens. */
export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not set');

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/**
 * Decode the id_token WITHOUT verifying its signature. Safe here because we
 * just received it directly over HTTPS from Google's token endpoint — an
 * attacker would need to MITM that call to inject a forged token, and at that
 * point they can do much worse anyway. For anything higher-value we'd fetch
 * JWKS and verify with jose.createRemoteJWKSet.
 */
export function decodeIdToken(idToken: string): GoogleIdPayload {
  const [, payloadB64] = idToken.split('.');
  if (!payloadB64) throw new Error('Malformed id_token');
  const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as GoogleIdPayload;
  if (!parsed.sub || !parsed.email) throw new Error('id_token missing sub/email');
  return parsed;
}
