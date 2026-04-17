/**
 * /api/formulas/[slug] — single-formula read/update/delete.
 *
 * DELETE refuses to remove built-ins so the canonical 4 presets stay stable
 * (users can still clone → edit → save as a new slug).
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Formula } from '@/lib/db/models';
import { getFormula } from '@/lib/formulas/load';
import { toPlain } from '@/lib/db/to-plain';
import type { DesignFormulaInput } from '@/types/formula';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params;
  const formula = await getFormula(slug);
  if (!formula) return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
  return NextResponse.json(formula);
}

type FormulaPatch = Partial<DesignFormulaInput>;

export async function PUT(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    await connectDB();

    // Strip server-managed / identity fields from the patch. Slug is the
    // primary key — renaming would orphan references in plans; force users to
    // clone if they want a new slug. isBuiltIn is also server-owned.
    const {
      slug: _slug,
      _id,
      __v,
      createdAt,
      updatedAt,
      isBuiltIn: _isBuiltIn,
      ...patch
    } = body;
    void _slug;
    void _id;
    void __v;
    void createdAt;
    void updatedAt;
    void _isBuiltIn;

    const updated = await Formula.findOneAndUpdate(
      { slug },
      { $set: patch as FormulaPatch },
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
    const { slug } = await params;
    await connectDB();

    const existing = await Formula.findOne({ slug }).lean();
    if (!existing) return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
    if ((existing as { isBuiltIn?: boolean }).isBuiltIn) {
      return NextResponse.json(
        { error: 'Built-in formulas cannot be deleted. Clone and edit instead.' },
        { status: 403 },
      );
    }

    await Formula.deleteOne({ slug });
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
