/**
 * Next.js 16 Proxy (formerly Middleware) — optimistic admin gate.
 *
 * Runs in the edge runtime on every request matching the config below. We do
 * NOT do full session management here (per the Next 16 guidance in
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md); route
 * handlers and RSCs re-verify via lib/auth/dal.ts before touching data.
 *
 * This proxy is _only_ a fast redirect for users who hit /admin/* without the
 * right role — they go to /login instead of seeing an auth error later.
 *
 * Edge compatibility: we decode the JWT via jose (edge-safe). We do NOT import
 * Mongoose or anything that pulls in Node APIs.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { decryptSession, COOKIE_NAME } from '@/lib/auth/session';

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Only guard admin routes. Everything else passes through.
  if (!pathname.startsWith('/admin')) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = await decryptSession(token);

  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (session.role !== 'admin') {
    // Signed in but not authorized — send home with a flag so we can surface
    // a toast later if we want.
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '?forbidden=admin';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
