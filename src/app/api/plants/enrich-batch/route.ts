/**
 * POST /api/plants/enrich-batch
 *
 * Scans the DB for plants with a completeness score below the threshold
 * (default 80) and runs Claude enrichment on each, saving the resulting
 * patches.  Processes plants serially to respect API rate limits and keep
 * token costs predictable.
 *
 * Query params:
 *   threshold   — completeness threshold under which a plant qualifies
 *                 (default 80, range 0–100).
 *   limit       — max plants to enrich this request (default 10, max 50).
 *   dryRun      — if "1", report what would change without saving.
 *
 * Response includes per-plant outcomes so the admin UI can show progress.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Plant } from '@/lib/db/models';
import { computeCompleteness } from '@/lib/plants/completeness';
import { enrichPlant } from '@/lib/plants/enrich';
import type { Plant as PlantType } from '@/types/plant';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // up to 5 min for batches

interface Outcome {
  slug: string;
  commonName: string;
  beforeScore: number;
  afterScore?: number;
  status: 'enriched' | 'skipped' | 'error';
  error?: string;
  patchedFields?: string[];
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const threshold = Math.min(100, Math.max(0, Number(searchParams.get('threshold')) || 80));
  const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 10));
  const dryRun = searchParams.get('dryRun') === '1';

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured — cannot run enrichment' },
      { status: 503 },
    );
  }

  await connectDB();

  // Load all plants (fields are small enough that this is fine up to
  // thousands). Score locally so we can sort by "most incomplete first".
  const all = (await Plant.find({}).lean()) as Array<Partial<PlantType> & { _id?: unknown; slug: string; commonName: string }>;

  const candidates = all
    .map((p) => ({ plant: p, completeness: computeCompleteness(p) }))
    .filter((x) => x.completeness.score < threshold)
    .sort((a, b) => a.completeness.score - b.completeness.score)
    .slice(0, limit);

  const outcomes: Outcome[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;

  for (const { plant, completeness } of candidates) {
    try {
      const result = await enrichPlant(plant);
      if (!result.ok) {
        outcomes.push({
          slug: plant.slug,
          commonName: plant.commonName,
          beforeScore: completeness.score,
          status: 'skipped',
          error: result.reason,
        });
        continue;
      }

      totalInputTokens += result.usage?.inputTokens || 0;
      totalOutputTokens += result.usage?.outputTokens || 0;
      totalCacheRead += result.usage?.cacheReadTokens || 0;

      const { nonNativeWarning, ...patch } = result.patch;
      void nonNativeWarning;
      const patchedFields = Object.keys(patch);

      let afterScore = completeness.score;
      if (!dryRun && patchedFields.length > 0) {
        await Plant.updateOne(
          { slug: plant.slug },
          { $set: { ...patch, lastEnrichedAt: new Date() } },
        );
        const after = await Plant.findOne({ slug: plant.slug }).lean();
        afterScore = computeCompleteness(after as Partial<PlantType>).score;
      } else if (dryRun) {
        // Compute hypothetical after-score
        afterScore = computeCompleteness({ ...plant, ...patch } as Partial<PlantType>).score;
      }

      outcomes.push({
        slug: plant.slug,
        commonName: plant.commonName,
        beforeScore: completeness.score,
        afterScore,
        status: 'enriched',
        patchedFields,
      });
    } catch (e) {
      outcomes.push({
        slug: plant.slug,
        commonName: plant.commonName,
        beforeScore: completeness.score,
        status: 'error',
        error: (e as Error).message,
      });
    }
  }

  return NextResponse.json({
    dryRun,
    threshold,
    limit,
    considered: candidates.length,
    totalIncomplete: all.filter((p) => computeCompleteness(p).score < threshold).length,
    outcomes,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheRead,
    },
  });
}

/** GET returns a quick summary of how many plants need enrichment. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threshold = Math.min(100, Math.max(0, Number(searchParams.get('threshold')) || 80));

  await connectDB();
  const all = (await Plant.find({}).select('slug commonName scientificName description careNotes plantingInstructions family plantType heightMinInches heightMaxInches spreadMinInches spreadMaxInches sun moisture soilTypes bloomStartMonth bloomEndMonth bloomColor nativeHabitats wildlifeValue effortLevel deerResistant').lean()) as Array<Partial<PlantType> & { slug: string; commonName: string }>;

  const withScores = all.map((p) => ({ ...p, _completeness: computeCompleteness(p) }));
  const incomplete = withScores.filter((p) => p._completeness.score < threshold);

  return NextResponse.json({
    threshold,
    total: all.length,
    incomplete: incomplete.length,
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    sample: incomplete.slice(0, 20).map((p) => ({
      slug: p.slug,
      commonName: p.commonName,
      score: p._completeness.score,
      missing: p._completeness.missing,
      weak: p._completeness.weak,
    })),
  });
}
