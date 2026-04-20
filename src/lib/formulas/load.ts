/**
 * Formula loader — same Mongo-first / JSON-fallback pattern used throughout
 * the codebase (see src/app/api/plants/route.ts).
 *
 * - getFormula(slug): single formula, or null if not found
 * - listFormulas(viewer?): visible formulas for the given viewer
 *
 * The JSON fallback means development and self-hosted deployments without a
 * Mongo connection still have the built-ins available.
 *
 * Viewer scoping:
 *   - anonymous → built-ins + ownerless legacy docs only
 *   - user      → built-ins + any formula whose ownerId === user's id
 *   - admin     → everything, unfiltered
 */

import { connectDB } from '@/lib/db/connection';
import { Formula as FormulaModel } from '@/lib/db/models';
import formulasData from '../../../data/formulas.json';
import type { DesignFormula } from '@/types/formula';
import { toPlain } from '@/lib/db/to-plain';

type RawFormula = Record<string, unknown>;

export interface FormulaViewer {
  userId?: string;
  role?: 'user' | 'admin';
}

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

/** Can this viewer read this formula? Mirrors the filter we push into Mongo. */
export function canReadFormula(formula: DesignFormula, viewer?: FormulaViewer): boolean {
  if (viewer?.role === 'admin') return true;
  if (formula.isBuiltIn) return true;
  if (!formula.ownerId) return true; // legacy/public
  return !!viewer?.userId && formula.ownerId === viewer.userId;
}

export async function getFormula(
  slug: string,
  viewer?: FormulaViewer,
): Promise<DesignFormula | null> {
  if (!slug) return null;
  try {
    await connectDB();
    const doc = await FormulaModel.findOne({ slug }).lean();
    if (doc) {
      const sanitized = sanitize(doc);
      return canReadFormula(sanitized, viewer) ? sanitized : null;
    }
  } catch {
    // fall through to JSON
  }
  const fallback = (formulasData as RawFormula[]).find((f) => f.slug === slug);
  if (!fallback) return null;
  const sanitized = sanitize(fallback);
  return canReadFormula(sanitized, viewer) ? sanitized : null;
}

export async function listFormulas(viewer?: FormulaViewer): Promise<DesignFormula[]> {
  try {
    await connectDB();
    // Push the visibility filter into the query when we have one — avoids
    // shipping other users' formula blobs across the network.
    const filter =
      viewer?.role === 'admin'
        ? {}
        : viewer?.userId
          ? {
              $or: [
                { isBuiltIn: true },
                { ownerId: null },
                { ownerId: { $exists: false } },
                { ownerId: viewer.userId },
              ],
            }
          : {
              $or: [{ isBuiltIn: true }, { ownerId: null }, { ownerId: { $exists: false } }],
            };
    const docs = await FormulaModel.find(filter).lean();
    if (docs.length) return docs.map(sanitize);
  } catch {
    // fall through
  }
  // JSON fallback has no owners, so every entry is visible to every viewer.
  return (formulasData as RawFormula[]).map(sanitize);
}
