import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Plant } from '@/lib/db/models';
import plantsData from '../../../../data/plants.json';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const sun = searchParams.get('sun');
  const moisture = searchParams.get('moisture');
  const type = searchParams.get('type');
  const habitat = searchParams.get('habitat');
  const effort = searchParams.get('effort');
  const search = searchParams.get('search');
  const all = searchParams.get('all');

  // Single plant lookup by slug
  if (slug) {
    try {
      await connectDB();
      const plant = await Plant.findOne({ slug }).lean();
      if (plant) return NextResponse.json(plant);
    } catch {}
    const found = (plantsData as any[]).find((p: any) => p.slug === slug);
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
  let plants = plantsData as Record<string, unknown>[];

  if (sun) plants = plants.filter((p: any) => p.sun?.includes(sun));
  if (moisture) plants = plants.filter((p: any) => p.moisture?.includes(moisture));
  if (type) plants = plants.filter((p: any) => p.plantType === type);
  if (habitat) plants = plants.filter((p: any) => p.nativeHabitats?.includes(habitat));
  if (effort) plants = plants.filter((p: any) => p.effortLevel === effort);
  if (search) {
    const s = search.toLowerCase();
    plants = plants.filter((p: any) =>
      p.commonName?.toLowerCase().includes(s) ||
      p.scientificName?.toLowerCase().includes(s) ||
      p.family?.toLowerCase().includes(s)
    );
  }

  return NextResponse.json(plants);
}
