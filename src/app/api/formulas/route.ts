/**
 * /api/formulas — list + create design formulas.
 *
 * Visibility model:
 *  - GET: anonymous sees built-ins (and legacy ownerless docs). Signed-in users
 *    additionally see their own formulas. Admins see everything.
 *  - POST: requires auth. Server stamps ownerId from the session and forces
 *    isBuiltIn=false for non-admins. Admins can set isBuiltIn=true when seeding
 *    new presets.
 *
 * Mirrors the plants API pattern in src/app/api/plants/route.ts:
 *  - Mongo-first with JSON fallback, so dev and unconnected environments still
 *    see the 4 built-ins from data/formulas.json.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Formula } from '@/lib/db/models';
import { listFormulas } from '@/lib/formulas/load';
import { toPlain } from '@/lib/db/to-plain';
import { getSessionUser } from '@/lib/auth/dal';
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
  const session = await getSessionUser();
  const formulas = await listFormulas(
    session ? { userId: session.userId, role: session.role } : undefined,
  );
  return NextResponse.json(formulas);
}

interface FormulaBody extends Partial<DesignFormulaInput> {
  slug?: string;
}

function validateBody(body: FormulaBody): string | null {
  if (!body.name || typeof body.name !== 'string') return 'name is required';
  return null;
}

/** Create a new formula. Auth required; ownerId stamped from session. */
export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: 'Sign in to create a formula' }, { status: 401 });
    }

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

    // Only admins can seed new built-ins; everyone else is forced to user-owned.
    const isAdmin = session.role === 'admin';
    const clientWantsBuiltIn = !!body.isBuiltIn;

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
      isBuiltIn: isAdmin ? clientWantsBuiltIn : false,
      // Built-ins don't belong to any one user — keep ownerId null so they
      // stay visible to everyone even if the seeding admin later leaves.
      ownerId: isAdmin && clientWantsBuiltIn ? null : session.userId,
    });
    return NextResponse.json(toPlain(doc.toObject()), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
