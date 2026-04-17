/**
 * POST /api/plants/enrich?slug=<slug>[&save=1]
 *
 * Ask Claude to fill missing fields on a plant.
 * - Without `save=1` returns the suggested patch for review (preview mode).
 * - With `save=1` applies the patch to the DB (only fills blanks, doesn't
 *   overwrite existing curator edits).
 *
 * Also accepts a full plant object in the body (no slug required) for
 * enriching during creation, before the record is persisted.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Plant } from '@/lib/db/models';
import { enrichPlant } from '@/lib/plants/enrich';
import type { Plant as PlantType } from '@/types/plant';

export const dynamic = 'force-dynamic';
// Claude calls can take a while on cold cache. Allow generous runtime.
export const maxDuration = 60;

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const save = searchParams.get('save') === '1';

  let current: Partial<PlantType>;

  if (slug) {
    await connectDB();
    const doc = await Plant.findOne({ slug }).lean();
    if (!doc) return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
    current = doc as Partial<PlantType>;
  } else {
    try {
      current = (await request.json()) as Partial<PlantType>;
    } catch {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }
  }

  const result = await enrichPlant(current);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 503 });
  }

  if (save && slug) {
    await connectDB();
    const { nonNativeWarning, ...patch } = result.patch;
    void nonNativeWarning; // informational — not persisted
    const updated = await Plant.findOneAndUpdate(
      { slug },
      { $set: { ...patch, lastEnrichedAt: new Date() } },
      { new: true },
    ).lean();
    return NextResponse.json({ plant: updated, patch: result.patch, usage: result.usage });
  }

  return NextResponse.json({ patch: result.patch, usage: result.usage });
}
