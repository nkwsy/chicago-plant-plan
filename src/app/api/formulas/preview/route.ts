/**
 * POST /api/formulas/preview
 *
 * Preview the species a formula would pick for a given site, without doing
 * any layout. Used by the wizard's formula tile side-panel to show "this is
 * what you'll get" before the user commits to a style.
 *
 * Input: { formulaSlug, siteProfile?, preferences?, targetCount? }
 * Output: { species: [{ slug, commonName, scientificName, plantType, oudolfRole,
 *          bloomColor, imageUrl, isCharacteristic }] }
 *
 * Runs filterPlantsBySite → filterPlantsByPreferences → greedy scoring loop.
 * Mirrors generatePlan() without the layout step, which is the expensive part.
 * If siteProfile is omitted, a permissive full-sun/medium-moisture default is
 * used so the wizard can show a preview before site analysis completes.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { Plant as PlantModel } from '@/lib/db/models';
import plantsData from '../../../../../data/plants.json';
import { getFormula } from '@/lib/formulas/load';
import { filterPlantsBySite, filterPlantsByPreferences } from '@/lib/planner/filter';
import { scorePlant } from '@/lib/planner/score';
import type { Plant } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences } from '@/types/plan';
import type { DesignFormula, OudolfRole } from '@/types/formula';

export const dynamic = 'force-dynamic';

interface PreviewBody {
  formulaSlug?: string;
  siteProfile?: Partial<SiteProfile>;
  preferences?: Partial<UserPreferences>;
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
    effortLevel: 'medium',
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

/** Greedy selection mirroring generatePlan, minus layout. */
function selectSpecies(
  candidates: Plant[],
  preferences: UserPreferences,
  targetCount: number,
  formula: DesignFormula | undefined,
): Plant[] {
  if (!candidates.length) return [];

  const selected: Plant[] = [];
  const remaining = [...candidates];
  const ctx = {
    selectedFamilies: new Set<string>(),
    selectedTypes: new Set<string>(),
    selectedBloomMonths: new Set<number>(),
    selectedColors: new Set<string>(),
    preferences,
  };

  const DEFAULT_TYPE_RATIOS: Record<string, number> = { forb: 0.45, grass: 0.2, shrub: 0.15 };
  const typeRatios: Record<string, number> =
    formula?.typeRatios && Object.keys(formula.typeRatios).length
      ? (formula.typeRatios as Record<string, number>)
      : DEFAULT_TYPE_RATIOS;
  const typeTargets: Record<string, number> = {};
  for (const [k, v] of Object.entries(typeRatios)) typeTargets[k] = Math.ceil(targetCount * v);
  const typeCounts: Record<string, number> = {};

  const roleTargets: Partial<Record<OudolfRole, number>> = {};
  if (formula?.roleRatios) {
    for (const [k, v] of Object.entries(formula.roleRatios)) {
      if (typeof v === 'number') roleTargets[k as OudolfRole] = Math.ceil(targetCount * v);
    }
  }
  const roleCounts: Partial<Record<OudolfRole, number>> = {};

  while (selected.length < targetCount && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      let score = scorePlant(remaining[i], ctx, formula);

      const type = remaining[i].plantType;
      const currentCount = typeCounts[type] || 0;
      const target = typeTargets[type] || 1;
      if (currentCount < target) score += 15;

      const role = remaining[i].oudolfRole as OudolfRole | undefined;
      if (role && roleTargets[role]) {
        const roleCount = roleCounts[role] || 0;
        if (roleCount < (roleTargets[role] as number)) score += 15;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);

    ctx.selectedFamilies.add(chosen.family);
    ctx.selectedTypes.add(chosen.plantType);
    ctx.selectedColors.add(chosen.bloomColor);
    for (let m = chosen.bloomStartMonth; m <= chosen.bloomEndMonth; m++) {
      ctx.selectedBloomMonths.add(m);
    }
    typeCounts[chosen.plantType] = (typeCounts[chosen.plantType] || 0) + 1;
    const chosenRole = chosen.oudolfRole as OudolfRole | undefined;
    if (chosenRole) roleCounts[chosenRole] = (roleCounts[chosenRole] || 0) + 1;
  }

  return selected;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewBody;

    const formula = body.formulaSlug ? await getFormula(body.formulaSlug) : undefined;
    if (body.formulaSlug && !formula) {
      return NextResponse.json({ error: 'Formula not found' }, { status: 404 });
    }

    const siteProfile: SiteProfile = { ...defaultSiteProfile(), ...(body.siteProfile as SiteProfile) };
    const preferences: UserPreferences = { ...defaultPreferences(), ...body.preferences };
    const targetCount = Math.max(1, Math.min(30, body.targetCount ?? 15));

    const all = await loadAllPlants();
    const siteCompatible = filterPlantsBySite(all, siteProfile);
    const prefFiltered = filterPlantsByPreferences(siteCompatible, preferences);

    // Same fallback semantics as generatePlan — if preferences are too strict,
    // relax them before giving up (so a preview still returns something).
    const candidates = prefFiltered.length
      ? prefFiltered
      : filterPlantsByPreferences(siteCompatible, {
          ...preferences,
          maxHeightInches: null,
          effortLevel: 'high',
        });

    const selected = selectSpecies(candidates, preferences, targetCount, formula ?? undefined);
    const pinned = new Set(formula?.characteristicSpecies ?? []);

    const species = selected.map((p) => ({
      slug: p.slug,
      commonName: p.commonName,
      scientificName: p.scientificName,
      plantType: p.plantType,
      oudolfRole: p.oudolfRole ?? null,
      bloomColor: p.bloomColor,
      imageUrl: p.imageUrl,
      isCharacteristic: pinned.has(p.slug),
    }));

    return NextResponse.json({
      formulaSlug: formula?.slug ?? null,
      count: species.length,
      candidatePoolSize: candidates.length,
      species,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
