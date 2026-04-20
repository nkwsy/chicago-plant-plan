/**
 * GET /api/auth/google/start?next=/foo
 *
 * Entry point for the Google OAuth redirect flow. We sign the `next` path into
 * the OAuth `state` param (HMAC via SESSION_SECRET) so:
 *   a) CSRF: a malicious page can't forge a callback, and
 *   b) Round-trip: after login, we bounce the user back where they came from.
 */

import { NextResponse } from 'next/server';
import { buildAuthorizeUrl } from '@/lib/auth/google';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawNext = url.searchParams.get('next') || '/';
  // Only allow same-site relative paths as the post-login redirect.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  try {
    const { url: authorizeUrl } = await buildAuthorizeUrl(next);
    return NextResponse.redirect(authorizeUrl);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
