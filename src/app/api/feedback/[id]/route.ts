/**
 * /api/feedback/[id] — admin-only update + delete for a single feedback item.
 * Used by the admin page to triage status and add internal notes.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Feedback, type FeedbackStatus } from '@/lib/db/models';
import { getSessionUser } from '@/lib/auth/dal';

export const dynamic = 'force-dynamic';

const VALID_STATUSES: FeedbackStatus[] = ['new', 'in_progress', 'resolved', 'wontfix'];

interface Params {
  params: Promise<{ id: string }>;
}

interface PatchBody {
  status?: string;
  adminNotes?: string;
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const { id } = await params;
    const body = (await request.json()) as PatchBody;

    const update: Record<string, unknown> = {};
    if (typeof body.status === 'string') {
      if (!VALID_STATUSES.includes(body.status as FeedbackStatus)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      update.status = body.status;
    }
    if (typeof body.adminNotes === 'string') {
      update.adminNotes = body.adminNotes.slice(0, 5000);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    await connectDB();
    const updated = await Feedback.findOneAndUpdate(
      { feedbackId: id },
      { $set: update },
      { new: true },
    ).lean();

    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await getSessionUser();
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const { id } = await params;
    await connectDB();
    const res = await Feedback.deleteOne({ feedbackId: id });
    if (res.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
