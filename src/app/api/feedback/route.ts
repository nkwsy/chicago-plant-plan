/**
 * /api/feedback
 *  - POST: public. Anyone (signed-in or not) can leave feedback. If signed in,
 *    we stamp userId/userEmail/userName from the session.
 *  - GET: admin only. Returns recent feedback, optionally filtered by status
 *    or category via query params.
 */

import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { connectDB } from '@/lib/db/connection';
import { Feedback, type FeedbackCategory, type FeedbackStatus } from '@/lib/db/models';
import { getSessionUser } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: FeedbackCategory[] = ['bug', 'idea', 'praise', 'question', 'other'];
const VALID_STATUSES: FeedbackStatus[] = ['new', 'in_progress', 'resolved', 'wontfix'];

interface FeedbackBody {
  page?: string;
  category?: string;
  comment?: string;
  email?: string;
  requestFollowup?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FeedbackBody;

    const comment = (body.comment || '').trim();
    if (!comment) {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 });
    }
    if (comment.length > 5000) {
      return NextResponse.json({ error: 'Comment too long (5000 char max)' }, { status: 400 });
    }

    const category = (body.category || 'other') as FeedbackCategory;
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }

    const page = (body.page || '/').slice(0, 500);
    const email = (body.email || '').trim().slice(0, 200);
    const requestFollowup = !!body.requestFollowup;

    if (requestFollowup && !email) {
      return NextResponse.json(
        { error: 'Email is required when requesting follow-up' },
        { status: 400 },
      );
    }

    const session = await getSessionUser();
    const userAgent = request.headers.get('user-agent')?.slice(0, 500) ?? null;

    await connectDB();
    const doc = await Feedback.create({
      feedbackId: nanoid(12),
      page,
      category,
      comment,
      email,
      requestFollowup,
      status: 'new',
      userId: session?.userId ?? null,
      userEmail: session?.email ?? null,
      userName: session?.name ?? null,
      userAgent,
    });

    return NextResponse.json(
      { ok: true, feedbackId: doc.feedbackId },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const category = url.searchParams.get('category');
    const followup = url.searchParams.get('followup');

    const filter: Record<string, unknown> = {};
    if (status && VALID_STATUSES.includes(status as FeedbackStatus)) filter.status = status;
    if (category && VALID_CATEGORIES.includes(category as FeedbackCategory)) {
      filter.category = category;
    }
    if (followup === '1') filter.requestFollowup = true;

    await connectDB();
    const docs = await Feedback.find(filter).sort({ createdAt: -1 }).limit(500).lean();

    const items = docs.map((d) => ({
      feedbackId: d.feedbackId,
      page: d.page,
      category: d.category,
      comment: d.comment,
      email: d.email,
      requestFollowup: d.requestFollowup,
      status: d.status,
      userId: d.userId ?? null,
      userEmail: d.userEmail ?? null,
      userName: d.userName ?? null,
      userAgent: d.userAgent ?? null,
      adminNotes: d.adminNotes ?? '',
      createdAt: d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,
      updatedAt: d.updatedAt instanceof Date ? d.updatedAt.toISOString() : d.updatedAt,
    }));

    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
