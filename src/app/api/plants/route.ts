import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Plant } from '@/lib/db/models';
import plantsData from '../../../../data/plants.json';

export const dynamic = 'force-dynamic';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const sun = searchParams.get('sun');
  const moisture = searchParams.get('moisture');
  const type = searchParams.get('type');
  const habitat = searchParams.get('habitat');
  const effort = searchParams.get('effort');
  const search = searchParams.get('search');

  // Single plant lookup by slug
  if (slug) {
    try {
      await connectDB();
      const plant = await Plant.findOne({ slug }).lean();
      if (plant) return NextResponse.json(plant);
    } catch {}
    const found = (plantsData as Array<Record<string, unknown>>).find((p) => p.slug === slug);
    if (found) return NextResponse.json(found);
    return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
  }

  // Try MongoDB first, fall back to JSON file
  try {
    await connectDB();
    const count = await Plant.countDocuments();

    if (count > 0) {
      const query: Record<string, unknown> = {};
      if (sun) query.sun = sun;
      if (moisture) query.moisture = moisture;
      if (type) query.plantType = type;
      if (habitat) query.nativeHabitats = habitat;
      if (effort) query.effortLevel = effort;
      if (search) {
        query.$or = [
          { commonName: { $regex: search, $options: 'i' } },
          { scientificName: { $regex: search, $options: 'i' } },
          { family: { $regex: search, $options: 'i' } },
        ];
      }

      const plants = await Plant.find(query).sort({ commonName: 1 }).lean();
      return NextResponse.json(plants);
    }
  } catch {
    // MongoDB not available, use JSON fallback
  }

  // Fallback: filter from JSON file
  let plants = plantsData as Array<Record<string, unknown>>;
  if (sun) plants = plants.filter((p) => (p.sun as string[] | undefined)?.includes(sun));
  if (moisture) plants = plants.filter((p) => (p.moisture as string[] | undefined)?.includes(moisture));
  if (type) plants = plants.filter((p) => p.plantType === type);
  if (habitat) plants = plants.filter((p) => (p.nativeHabitats as string[] | undefined)?.includes(habitat));
  if (effort) plants = plants.filter((p) => p.effortLevel === effort);
  if (search) {
    const s = search.toLowerCase();
    plants = plants.filter((p) =>
      (p.commonName as string | undefined)?.toLowerCase().includes(s) ||
      (p.scientificName as string | undefined)?.toLowerCase().includes(s) ||
      (p.family as string | undefined)?.toLowerCase().includes(s)
    );
  }

  return NextResponse.json(plants);
}

// ---------------------------------------------------------------------------
// Write endpoints (admin)
// ---------------------------------------------------------------------------

interface PlantBody extends Record<string, unknown> {
  slug?: string;
  commonName?: string;
  scientificName?: string;
}

function validateBody(body: PlantBody): string | null {
  if (!body.commonName || typeof body.commonName !== 'string') return 'commonName is required';
  if (!body.scientificName || typeof body.scientificName !== 'string') return 'scientificName is required';
  if (!body.plantType || typeof body.plantType !== 'string') return 'plantType is required';
  return null;
}

/** Create a new plant. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PlantBody;
    const err = validateBody(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await connectDB();

    const slug = (body.slug as string) || slugify(body.commonName as string);
    const existing = await Plant.findOne({ slug }).lean();
    if (existing) {
      return NextResponse.json({ error: `Plant with slug "${slug}" already exists` }, { status: 409 });
    }

    const doc = await Plant.create({
      favorability: 50,
      deerResistant: false,
      tags: [],
      notes: '',
      suppliers: [],
      ...body,
      slug,
    });
    return NextResponse.json(doc.toObject(), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Update an existing plant. Slug is taken from the query string or body. */
export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const body = (await request.json()) as PlantBody;
    const slug = searchParams.get('slug') || (body.slug as string | undefined);
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    await connectDB();

    // Don't let the client silently rename the slug (it's the primary key).
    // If they want a new slug they should delete + recreate.
    const { slug: _ignore, _id, __v, createdAt, updatedAt, ...patch } = body as Record<string, unknown>;
    void _ignore; void _id; void __v; void createdAt; void updatedAt;

    const updated = await Plant.findOneAndUpdate(
      { slug },
      { $set: patch },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Delete a plant by slug. */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    await connectDB();
    const res = await Plant.deleteOne({ slug });
    if (res.deletedCount === 0) return NextResponse.json({ error: 'Plant not found' }, { status: 404 });
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
