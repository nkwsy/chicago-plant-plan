/**
 * /api/formulas/[slug] — single-formula read/update/delete.
 *
 * Permissions:
 *  - GET: anonymous can read built-ins + legacy ownerless docs. Users can also
 *    read their own. Admins can read anything.
 *  - PUT: must be the owner, OR admin. Non-admins cannot flip isBuiltIn.
 *  - DELETE: owner-only for user formulas; admin can delete any non-built-in.
 *           Built-ins are never deletable (users clone + save a copy instead).
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Formula } from '@/lib/db/models';
import { getFormula } from '@/lib/formulas/load';
import { toPlain } from '@/lib/db/to-plain';
import { getSessionUser } from '@/lib/auth/dal';
import type { DesignFormulaInput } from '@/types/formula';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const session = await getSessionUser();
  const formula = await getFormula(
    slug,
    session ? { userId: session.userId, role: session.role } : undefined,
  );
  if (!formula) return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
  return NextResponse.json(formula);
}

type FormulaPatch = Partial<DesignFormulaInput>;

export async function PUT(request: Request, { params }: Params) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Sign in to edit a formula' }, { status: 401 });
    }

    const { slug } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    await connectDB();

    const existing = await Formula.findOne({ slug });
    if (!existing) return NextResponse.json({ error: 'Formula not found' }, { status: 404 });

    const isAdmin = session.role === 'admin';
    const isOwner = existing.ownerId && existing.ownerId === session.userId;

    // Non-admins cannot edit built-ins (clone-and-edit is the supported path).
    if (existing.isBuiltIn && !isAdmin) {
      return NextResponse.json(
        { error: 'Built-in formulas can only be edited by admins. Clone it to make changes.' },
        { status: 403 },
      );
    }
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Not your formula' }, { status: 403 });
    }

    // Strip server-managed / identity fields from the patch. Slug is the
    // primary key — renaming would orphan references in plans; force users to
    // clone if they want a new slug.
    const {
      slug: _slug,
      _id,
      __v,
      createdAt,
      updatedAt,
      ownerId: _ownerId,
      // Non-admins can't change the built-in flag. Admins can.
      isBuiltIn: bodyIsBuiltIn,
      ...patch
    } = body;
    void _slug;
    void _id;
    void __v;
    void createdAt;
    void updatedAt;
    void _ownerId;

    const finalPatch: FormulaPatch & { isBuiltIn?: boolean } = patch as FormulaPatch;
    if (isAdmin && typeof bodyIsBuiltIn === 'boolean') finalPatch.isBuiltIn = bodyIsBuiltIn;

    const updated = await Formula.findOneAndUpdate(
      { slug },
      { $set: finalPatch },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
    return NextResponse.json(toPlain(updated));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Sign in to delete a formula' }, { status: 401 });
    }

    const { slug } = await params;
    await connectDB();

    const existing = await Formula.findOne({ slug }).lean();
    if (!existing) return NextResponse.json({ error: 'Formula not found' }, { status: 404 });

    const doc = existing as { isBuiltIn?: boolean; ownerId?: string | null };
    const isAdmin = session.role === 'admin';
    const isOwner = doc.ownerId && doc.ownerId === session.userId;

    if (doc.isBuiltIn) {
      return NextResponse.json(
        { error: 'Built-in formulas cannot be deleted. Clone and edit instead.' },
        { status: 403 },
      );
    }
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Not your formula' }, { status: 403 });
    }

    await Formula.deleteOne({ slug });
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
