/**
 * Formula loader — same Mongo-first / JSON-fallback pattern used throughout
 * the codebase (see src/app/api/plants/route.ts).
 *
 * - getFormula(slug): single formula, or null if not found
 * - listFormulas(): all formulas for the wizard tile grid / admin list
 *
 * The JSON fallback means development and self-hosted deployments without a
 * Mongo connection still have the built-ins available.
 */

import { connectDB } from '@/lib/db/connection';
import { Formula as FormulaModel } from '@/lib/db/models';
import formulasData from '../../../data/formulas.json';
import type { DesignFormula } from '@/types/formula';
import { toPlain } from '@/lib/db/to-plain';

type RawFormula = Record<string, unknown>;

function sanitize(raw: unknown): DesignFormula {
  // toPlain handles ObjectId/Date/etc. and strips _id/__v/createdAt/updatedAt
  // from the tree (though we re-surface createdAt/updatedAt as ISO strings for
  // the admin view).
  const doc = raw as RawFormula;
  const plain = toPlain(raw) as DesignFormula;
  if (doc.createdAt) plain.createdAt = new Date(doc.createdAt as string | Date).toISOString();
  if (doc.updatedAt) plain.updatedAt = new Date(doc.updatedAt as string | Date).toISOString();
  return plain;
}

export async function getFormula(slug: string): Promise<DesignFormula | null> {
  if (!slug) return null;
  try {
    await connectDB();
    const doc = await FormulaModel.findOne({ slug }).lean();
    if (doc) return sanitize(doc);
  } catch {
    // fall through to JSON
  }
  const fallback = (formulasData as RawFormula[]).find((f) => f.slug === slug);
  return fallback ? sanitize(fallback) : null;
}

export async function listFormulas(): Promise<DesignFormula[]> {
  try {
    await connectDB();
    const docs = await FormulaModel.find({}).lean();
    if (docs.length) return docs.map(sanitize);
  } catch {
    // fall through
  }
  return (formulasData as RawFormula[]).map(sanitize);
}
