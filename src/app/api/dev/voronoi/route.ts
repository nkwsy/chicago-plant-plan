/**
 * Dev-only diagnostic endpoint for the Voronoi tapestry layout.
 *
 * Returns 404 in production. Used by the developer to verify cell generation
 * outside the full plan-creation wizard:
 *
 *   GET /api/_dev/voronoi?planId=tm4qdKPPENjY
 *
 * Loads the existing plan's polygon + center, picks 25 candidate plants from
 * the catalog, runs `generateVoronoiLayout()`, and returns the resulting
 * cells as a GeoJSON FeatureCollection plus tier counts. The response is
 * intentionally compact so it round-trips quickly to a browser console.
 */

import { NextResponse } from 'next/server';
import type { Plant } from '@/types/plant';
import type { PlanData } from '@/types/plan';
import { connectDB } from '@/lib/db/connection';
import { Plan as PlanModel, Plant as PlantModel } from '@/lib/db/models';
import { generateVoronoiLayout } from '@/lib/planner/voronoi-layout';
import { generateGridLayout } from '@/lib/planner/grid-layout';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const planId = searchParams.get('planId');
  const mode = searchParams.get('mode') === 'grid' ? 'grid' : 'voronoi';
  const gridSpacingInches = Number(searchParams.get('grid')) || 18;
  if (!planId) {
    return NextResponse.json({ error: 'planId query param required' }, { status: 400 });
  }

  await connectDB();
  const plan = (await PlanModel.findOne({ planId }).lean()) as PlanData | null;
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

  const allPlants = (await PlantModel.find({}).lean()) as unknown as Plant[];
  // Pick a small candidate pool spanning all 5 tiers so the layout has
  // something to seed at every level.
  const byTier = new Map<number, Plant[]>();
  for (const p of allPlants) {
    const t = p.tier ?? 3;
    byTier.set(t, [...(byTier.get(t) || []), p]);
  }
  const candidates: Plant[] = [];
  for (const tier of [5, 4, 3, 2, 1]) {
    candidates.push(...(byTier.get(tier) || []).slice(0, 5));
  }

  const t0 = Date.now();
  const result =
    mode === 'grid'
      ? generateGridLayout(
          candidates,
          plan.areaGeoJson,
          [plan.centerLat, plan.centerLng],
          {
            exclusionZones: plan.exclusionZones || [],
            existingTrees: plan.existingTrees || [],
            gridSpacingInches,
            seed: 7,
          },
        )
      : generateVoronoiLayout(
          candidates,
          plan.areaGeoJson,
          [plan.centerLat, plan.centerLng],
          {
            exclusionZones: plan.exclusionZones || [],
            existingTrees: plan.existingTrees || [],
            densityMultiplier: 1.0,
            seed: 7,
          },
        );
  const ms = Date.now() - t0;

  const featureCollection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: result.plants.map((p) => ({
      type: 'Feature' as const,
      geometry: p.cellGeoJson!,
      properties: {
        slug: p.plantSlug,
        commonName: p.commonName,
        tier: p.tier,
        sociability: p.sociability,
        speciesIndex: p.speciesIndex,
        areaSqFt: p.cellAreaSqFt,
      },
    })),
  };

  // Sanity-check shapes
  const ringLengths = result.plants
    .map((p) => p.cellGeoJson?.coordinates?.[0]?.length ?? 0)
    .sort((a, b) => a - b);
  const speciesUsed = new Set(result.plants.map((p) => p.plantSlug)).size;
  const totalCellArea = result.plants.reduce((s, p) => s + (p.cellAreaSqFt ?? 0), 0);

  return NextResponse.json({
    mode,
    elapsedMs: ms,
    candidates: candidates.length,
    cells: result.plants.length,
    speciesUsed,
    tierCounts: result.tierCounts,
    bedAreaSqFtReported: plan.areaSqFt,
    totalCellAreaSqFt: Math.round(totalCellArea * 10) / 10,
    ringLengthStats: {
      min: ringLengths[0],
      median: ringLengths[Math.floor(ringLengths.length / 2)],
      max: ringLengths[ringLengths.length - 1],
    },
    sample: result.plants.slice(0, 3).map((p) => ({
      slug: p.plantSlug,
      tier: p.tier,
      sociability: p.sociability,
      cellAreaSqFt: p.cellAreaSqFt,
      cellRingLen: p.cellGeoJson?.coordinates?.[0]?.length,
      cellFirstCoord: p.cellGeoJson?.coordinates?.[0]?.[0],
    })),
    featureCollection,
  });
}
