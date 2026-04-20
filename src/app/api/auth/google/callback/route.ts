/**
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Completes the Google OAuth round-trip:
 *  1. Verify the signed state (proves the request originated from our /start).
 *  2. Exchange the code for tokens.
 *  3. Decode the id_token to get email/name/sub.
 *  4. Upsert a Mongo User doc. First-time users get role=admin if their email
 *     is in AUTH_ADMIN_EMAILS.
 *  5. Sign a session JWT and set it as an httpOnly cookie.
 *  6. Redirect to the `next` path from the state.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectDB } from '@/lib/db/connection';
import { User, roleForEmail } from '@/lib/db/user';
import {
  verifyState,
  exchangeCodeForTokens,
  decodeIdToken,
} from '@/lib/auth/google';
import { encryptSession, sessionCookieOptions } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  const origin = `${url.protocol}//${url.host}`;

  if (err) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(err)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/login?error=missing_code_or_state`);
  }

  const verified = await verifyState(state);
  if (!verified) {
    return NextResponse.redirect(`${origin}/login?error=bad_state`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const id = decodeIdToken(tokens.id_token);
    const email = id.email.toLowerCase();

    await connectDB();

    // Upsert: if the user exists, bump lastLoginAt + refresh name/picture.
    // Otherwise create with the role derived from the admin allowlist.
    const existing = await User.findOne({ email });
    let userDoc;
    if (existing) {
      existing.name = id.name || existing.name;
      existing.image = id.picture || existing.image;
      existing.googleSub = id.sub;
      existing.lastLoginAt = new Date();
      // If a previously-created user now matches the admin allowlist, promote.
      // (Demotion on removal is NOT automatic — intentional: avoids locking
      // out an admin by typo'ing the env var.)
      const allowRole = roleForEmail(email);
      if (allowRole === 'admin' && existing.role !== 'admin') existing.role = 'admin';
      await existing.save();
      userDoc = existing;
    } else {
      userDoc = await User.create({
        email,
        name: id.name || '',
        image: id.picture || '',
        googleSub: id.sub,
        role: roleForEmail(email),
        lastLoginAt: new Date(),
      });
    }

    const token = await encryptSession({
      userId: userDoc._id.toString(),
      email: userDoc.email,
      role: userDoc.role,
      name: userDoc.name,
      image: userDoc.image,
    });

    const jar = await cookies();
    jar.set({ ...sessionCookieOptions(), value: token });

    const next = verified.next || '/';
    return NextResponse.redirect(`${origin}${next}`);
  } catch (e) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent((e as Error).message)}`,
    );
  }
}
