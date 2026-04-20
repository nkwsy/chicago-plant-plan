/**
 * GET /api/auth/me — returns the current session user (or null).
 *
 * Exists because client components can't read cookies directly, and we want
 * the header avatar / user menu to render on client render without making
 * each page server-render its own auth state.
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name ?? '',
      image: session.image ?? '',
      role: session.role,
    },
  });
}
