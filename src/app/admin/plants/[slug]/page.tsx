import PlantEditor from '@/components/admin/PlantEditor';
import { connectDB } from '@/lib/db/connection';
import { Plant as PlantModel } from '@/lib/db/models';
import plantsData from '../../../../../data/plants.json';
import { notFound } from 'next/navigation';
import type { Plant } from '@/types/plant';

export const dynamic = 'force-dynamic';

/**
 * Recursively coerce Mongoose/BSON values (ObjectId, Buffer, Date, Decimal128,
 * etc.) to plain JSON-safe primitives, and drop Mongo internals (_id, __v,
 * createdAt, updatedAt) from every object in the tree.
 *
 * RSC rejects objects with prototypes other than Object.prototype or values
 * that carry a toJSON method, so lean() output alone isn't enough — its
 * embedded ObjectIds are class instances. Doing this once up-front is more
 * reliable than JSON.parse(JSON.stringify(...)) because it also strips
 * internal fields recursively (including nested supplier.pricing[]._id).
 */
function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // ObjectId / Mongoose _id — collapse to a hex string (which we then drop at
  // the parent level for _id keys, but keep for any other fields).
  const maybeId = value as { _bsontype?: string; toHexString?: () => string };
  if (typeof maybeId.toHexString === 'function') return maybeId.toHexString();

  // Binary Buffer (Mongo sometimes represents ObjectId subdocs as { buffer })
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) return value.map(toPlain);

  // Anything else with a toJSON (e.g. Decimal128) — delegate then recurse.
  const maybeJson = value as { toJSON?: () => unknown };
  if (typeof maybeJson.toJSON === 'function' && maybeJson.toJSON !== Object.prototype.toString) {
    return toPlain(maybeJson.toJSON());
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === '_id' || k === '__v' || k === 'createdAt' || k === 'updatedAt') continue;
    out[k] = toPlain(v);
  }
  return out;
}

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
