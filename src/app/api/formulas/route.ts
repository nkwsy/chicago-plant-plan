/**
 * /api/formulas — list + create design formulas.
 *
 * Mirrors the plants API pattern in src/app/api/plants/route.ts:
 *  - GET: Mongo-first with JSON fallback, so dev and unconnected environments
 *    still see the 4 built-ins from data/formulas.json.
 *  - POST: create a new (user) formula. Built-ins can only be seeded via the
 *    CLI script; the UI enforces isBuiltIn=false at create time.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Formula } from '@/lib/db/models';
import { listFormulas } from '@/lib/formulas/load';
import { toPlain } from '@/lib/db/to-plain';
import type { DesignFormulaInput } from '@/types/formula';

export const dynamic = 'force-dynamic';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET() {
  const formulas = await listFormulas();
  return NextResponse.json(formulas);
}

interface FormulaBody extends Partial<DesignFormulaInput> {
  slug?: string;
}

function validateBody(body: FormulaBody): string | null {
  if (!body.name || typeof body.name !== 'string') return 'name is required';
  return null;
}

/** Create a new formula. User-created formulas are always isBuiltIn=false. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as FormulaBody;
    const err = validateBody(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await connectDB();

    const slug = body.slug || slugify(body.name as string);
    const existing = await Formula.findOne({ slug }).lean();
    if (existing) {
      return NextResponse.json(
        { error: `Formula with slug "${slug}" already exists` },
        { status: 409 },
      );
    }

    const doc = await Formula.create({
      description: '',
      longDescription: '',
      author: '',
      parentSlug: null,
      typeRatios: {},
      roleRatios: {},
      weights: {},
      tagBonuses: {},
      tagPenalties: {},
      characteristicSpecies: [],
      pinBonus: 30,
      bloomEmphasisMonths: [],
      bloomEmphasisBonus: 0,
      ...body,
      slug,
      // Never let a client mark its own formula built-in — that flag guards
      // delete + is reserved for seeded presets.
      isBuiltIn: false,
    });
    return NextResponse.json(toPlain(doc.toObject()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
