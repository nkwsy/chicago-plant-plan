/**
 * POST /api/formulas/preview-plot
 *
 * Live preview of how a formula (saved or unsaved) places plants on a fixed
 * canonical synthetic plot. Used by the editor's live sandbox panel.
 *
 * Input:
 *   {
 *     formulaSlug?: string,          // load a saved formula by slug
 *     formulaDraft?: DesignFormula,  // OR pass an unsaved draft directly
 *     targetCount?: number,          // species count, defaults to 15
 *   }
 *
 * Output:
 *   {
 *     scenario: { widthFt, heightFt, trees[], buildings[], paths[] },
 *     sunGrid: { cellSizeFt, cols, rows, cells[{ xFt, yFt, sunCategory, ... }] },
 *     placements: [{ slug, name, xFt, yFt, radiusFt, speciesIndex, plantType, bloomColor }],
 *     species: [{ slug, commonName, scientificName, count, bloomColor, imageUrl }]
 *   }
 *
 * Design note: we reuse the full generatePlan() pipeline on the synthetic
 * polygon. The scenario is always the same, so building the sun grid is
 * consistent across calls — we don't bother caching it here since the expensive
 * part (SunCalc half-hour loop) is deterministic and already fast (<50 ms).
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Plant as PlantModel } from '@/lib/db/models';
import plantsData from '../../../../../data/plants.json';
import { getFormula } from '@/lib/formulas/load';
import { getSessionUser } from '@/lib/auth/dal';
import { generatePlan } from '@/lib/planner/generate';
import {
  buildSyntheticScenario,
  BED_WIDTH_FT,
  BED_HEIGHT_FT,
  sunGridToFeet,
  lngLatToFt,
} from '@/lib/formulas/synthetic-site';
import type { Plant } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences } from '@/types/plan';
import type { DesignFormula } from '@/types/formula';

export const dynamic = 'force-dynamic';

interface PreviewBody {
  formulaSlug?: string;
  formulaDraft?: DesignFormula;
  targetCount?: number;
}

function defaultSiteProfile(): SiteProfile {
  return {
    sunExposure: {
      summerSolstice: { sunrise: '', sunset: '', totalDaylightHours: 15, sunPathAltitudeNoon: 70 },
      winterSolstice: { sunrise: '', sunset: '', totalDaylightHours: 9, sunPathAltitudeNoon: 25 },
      springEquinox: { sunrise: '', sunset: '', totalDaylightHours: 12, sunPathAltitudeNoon: 48 },
      fallEquinox: { sunrise: '', sunset: '', totalDaylightHours: 12, sunPathAltitudeNoon: 48 },
    },
    soilType: 'loam',
    soilDrainage: 'well_drained',
    floodZone: null,
    elevation: 600,
    slopePercent: 0,
    moistureCategory: 'medium',
    effectiveSunHours: { summer: 8, winter: 5, average: 6.5 },
    rawData: {},
    nearbyBuildings: [],
  };
}

function defaultPreferences(): UserPreferences {
  return {
    effortLevel: 'normal',
    habitatGoals: [],
    aestheticPref: 'mixed',
    bloomPreference: 'continuous',
    maxHeightInches: null,
    avoidSlugs: [],
    specialFeatures: [],
    targetSpeciesCount: 15,
    densityMultiplier: 1.0,
  };
}

async function loadAllPlants(): Promise<Plant[]> {
  try {
    await connectDB();
    const docs = await PlantModel.find({}).lean();
    if (docs.length) return docs as unknown as Plant[];
  } catch {
    // fall through
  }
  return plantsData as unknown as Plant[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewBody;
    const targetCount = Math.max(5, Math.min(30, body.targetCount ?? 15));

    // Resolve the formula: inline draft wins over slug, so the live editor can
    // preview unsaved changes.
    let formula: DesignFormula | undefined;
    if (body.formulaDraft) {
      formula = body.formulaDraft;
    } else if (body.formulaSlug) {
      const session = await getSessionUser();
      const resolved = await getFormula(
        body.formulaSlug,
        session ? { userId: session.userId, role: session.role } : undefined,
      );
      if (!resolved) {
        return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
      }
      formula = resolved;
    }

    const scenario = buildSyntheticScenario();
    const preferences: UserPreferences = {
      ...defaultPreferences(),
      targetSpeciesCount: targetCount,
      // Synthetic scenario is compact; nudge density a touch above default so
      // the bed fills visually even at 15 species.
      densityMultiplier: 1.1,
    };
    const siteProfile: SiteProfile = {
      ...defaultSiteProfile(),
      nearbyBuildings: scenario.nearbyBuildings,
    };

    const all = await loadAllPlants();
    const plan = generatePlan(
      all,
      siteProfile,
      preferences,
      scenario.areaSqFt,
      scenario.polygon,
      scenario.center,
      scenario.exclusionZones,
      scenario.existingTrees,
      null,
      formula,
    );

    // Re-project PlanPlant (lat/lng) to cartesian feet for the SVG renderer.
    const placements = plan.plants
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p) => {
        const { xFt, yFt } = lngLatToFt(p.lng as number, p.lat as number);
        const radiusFt = Math.max(0.5, (p.spreadInches || 24) / 12 / 2);
        return {
          slug: p.plantSlug,
          name: p.commonName,
          xFt,
          yFt,
          radiusFt,
          speciesIndex: p.speciesIndex ?? 0,
          plantType: p.plantType ?? 'forb',
          bloomColor: p.bloomColor,
        };
      });

    const speciesCounts = new Map<
      string,
      {
        slug: string;
        commonName: string;
        scientificName: string;
        bloomColor: string;
        imageUrl: string;
        count: number;
        speciesIndex: number;
      }
    >();
    for (const p of plan.selectedSpecies) {
      speciesCounts.set(p.slug, {
        slug: p.slug,
        commonName: p.commonName,
        scientificName: p.scientificName,
        bloomColor: p.bloomColor,
        imageUrl: p.imageUrl,
        count: 0,
        speciesIndex: 0,
      });
    }
    for (const pl of plan.plants) {
      const s = speciesCounts.get(pl.plantSlug);
      if (s) {
        s.count += 1;
        s.speciesIndex = pl.speciesIndex ?? s.speciesIndex;
      }
    }

    // Describe the scenario geometry in feet for the client.
    const trees = scenario.existingTrees.map((t) => {
      const { xFt, yFt } = lngLatToFt(t.lng, t.lat);
      return {
        id: t.id,
        xFt,
        yFt,
        canopyRadiusFt: t.canopyDiameterFt / 2,
        label: t.label,
        outsideProperty: t.outsideProperty === true,
      };
    });

    const buildings = scenario.exclusionZones
      .filter((z) => z.type === 'building')
      .map((z) => {
        const corners = z.geoJson.coordinates[0].map(([lng, lat]) => {
          const { xFt, yFt } = lngLatToFt(lng, lat);
          return { xFt, yFt };
        });
        return { id: z.id, label: z.label, corners };
      });

    const paths = scenario.exclusionZones
      .filter((z) => z.type !== 'building')
      .map((z) => {
        const corners = z.geoJson.coordinates[0].map(([lng, lat]) => {
          const { xFt, yFt } = lngLatToFt(lng, lat);
          return { xFt, yFt };
        });
        return { id: z.id, label: z.label, type: z.type, corners };
      });

    return NextResponse.json({
      scenario: {
        widthFt: BED_WIDTH_FT,
        heightFt: BED_HEIGHT_FT,
        trees,
        buildings,
        paths,
      },
      sunGrid: plan.sunGrid ? sunGridToFeet(plan.sunGrid) : null,
      placements,
      species: Array.from(speciesCounts.values()).sort((a, b) => b.count - a.count),
      diversityScore: plan.diversityScore,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
