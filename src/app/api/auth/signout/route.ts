/**
 * POST /api/auth/signout — clear the session cookie.
 *
 * We use POST (not GET) so a GET from a link or prefetch can't accidentally
 * log users out. The client hits this from a form or button.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
