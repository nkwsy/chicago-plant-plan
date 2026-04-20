/**
 * Data Access Layer for auth.
 *
 * These helpers are the single source of "who is the viewer?" for server code
 * (RSCs, Route Handlers, Server Actions). They read the session cookie,
 * verify the JWT, and memoize the result per render via React's cache() so
 * we don't verify the same token 10x when multiple components need the user.
 *
 * Do NOT call these from client components — they read cookies() which is
 * server-only. Use /api/auth/me (or pass the user down as a prop) instead.
 */

import { cookies } from 'next/headers';
import { cache } from 'react';
import { COOKIE_NAME, decryptSession, type SessionPayload } from './session';

/** Verify the session cookie, returning the JWT payload or null. Cached per-request. */
export const getSessionUser = cache(async (): Promise<SessionPayload | null> => {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  return decryptSession(raw);
});

/** Throw a 401-like error if nobody is signed in. */
export async function requireUser(): Promise<SessionPayload> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('Authentication required', 401);
  return user;
}

/** Throw if not signed in, or signed in but not admin. */
export async function requireAdmin(): Promise<SessionPayload> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new AuthError('Admin role required', 403);
  return user;
}

/** Convenience: "is this session user the owner of the given resource?" */
export function isOwnerOrAdmin(viewer: SessionPayload | null, ownerId: string | undefined): boolean {
  if (!viewer) return false;
  if (viewer.role === 'admin') return true;
  return !!ownerId && ownerId === viewer.userId;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}
