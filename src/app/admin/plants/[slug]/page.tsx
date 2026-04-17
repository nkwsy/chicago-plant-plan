import PlantEditor from '@/components/admin/PlantEditor';
import { connectDB } from '@/lib/db/connection';
import { Plant as PlantModel } from '@/lib/db/models';
import plantsData from '../../../../../data/plants.json';
import { notFound } from 'next/navigation';
import type { Plant } from '@/types/plant';
import { toPlain } from '@/lib/db/to-plain';

export const dynamic = 'force-dynamic';

async function loadPlant(slug: string): Promise<Plant | null> {
  try {
    await connectDB();
    const doc = await PlantModel.findOne({ slug }).lean();
    if (doc) return toPlain(doc) as Plant;
  } catch {
    // fallthrough
  }
  const fallback = (plantsData as Array<Record<string, unknown>>).find((p) => p.slug === slug);
  return fallback ? (toPlain(fallback) as Plant) : null;
}

export default async function EditPlantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const plant = await loadPlant(slug);
  if (!plant) return notFound();

  return <PlantEditor mode="edit" initial={plant} />;
}
