import type { Plant } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences, PlanPlant, ExclusionZone, ExistingTree, SunGrid } from '@/types/plan';
import type { DesignFormula, OudolfRole } from '@/types/formula';
import type { NearbyBuilding } from '@/lib/analysis/sun';
import { filterPlantsBySite, filterPlantsByPreferences } from './filter';
import { scorePlant, calculateDiversityScore } from './score';
import { calculateGridSize, layoutPlants, polygonToBounds } from './layout';
import { buildSunGrid } from '@/lib/analysis/sun-grid';

interface GeneratedPlan {
  plants: PlanPlant[];
  selectedSpecies: Plant[];
  gridCols: number;
  gridRows: number;
  areaSqFt: number;
  diversityScore: number;
  sunGrid?: SunGrid;
}

/** Default plantType distribution — preserved from the pre-formula behavior.
 *  Used when neither the formula nor its overrides specify a type ratio. */
const DEFAULT_TYPE_RATIOS: Record<string, number> = {
  forb: 0.45,
  grass: 0.2,
  shrub: 0.15,
};

export function generatePlan(
  allPlants: Plant[],
  siteProfile: SiteProfile,
  preferences: UserPreferences,
  areaSqFt: number,
  polygon?: GeoJSON.Polygon | null,
  center?: [number, number],
  exclusionZones: ExclusionZone[] = [],
  existingTrees: ExistingTree[] = [],
  globalSunOverride?: number | null,
  formula?: DesignFormula,
): GeneratedPlan {
  // Build the 5x5ft sun grid for per-plot analysis
  const bounds = polygonToBounds(polygon || null, center);
  const buildings: NearbyBuilding[] = siteProfile.nearbyBuildings || [];
  const sunGrid = buildSunGrid(bounds, existingTrees, buildings, exclusionZones, polygon, globalSunOverride);

  const siteCompatible = filterPlantsBySite(allPlants, siteProfile);
  const prefFiltered = filterPlantsByPreferences(siteCompatible, preferences);

  if (prefFiltered.length === 0) {
    const relaxed = filterPlantsByPreferences(siteCompatible, {
      ...preferences,
      maxHeightInches: null,
      effortLevel: 'high',
    });
    if (relaxed.length === 0) {
      return { plants: [], selectedSpecies: [], gridCols: 3, gridRows: 3, areaSqFt, diversityScore: 0, sunGrid };
    }
    return generateFromCandidates(relaxed, preferences, areaSqFt, polygon, center, exclusionZones, existingTrees, sunGrid, formula);
  }

  return generateFromCandidates(prefFiltered, preferences, areaSqFt, polygon, center, exclusionZones, existingTrees, sunGrid, formula);
}

function generateFromCandidates(
  candidates: Plant[],
  preferences: UserPreferences,
  areaSqFt: number,
  polygon?: GeoJSON.Polygon | null,
  center?: [number, number],
  exclusionZones: ExclusionZone[] = [],
  existingTrees: ExistingTree[] = [],
  sunGrid?: SunGrid,
  formula?: DesignFormula,
): GeneratedPlan {
  const gridConfig = calculateGridSize(areaSqFt);
  const targetSpecies = Math.min(
    candidates.length,
    preferences.targetSpeciesCount || 10,
  );

  // Greedy selection with diversity scoring
  const selected: Plant[] = [];
  const remaining = [...candidates];
  const ctx = {
    selectedFamilies: new Set<string>(),
    selectedTypes: new Set<string>(),
    selectedBloomMonths: new Set<number>(),
    selectedColors: new Set<string>(),
    preferences,
  };

  // Type quotas: formula overrides when present, otherwise preserved defaults.
  const typeRatios: Record<string, number> =
    formula?.typeRatios && Object.keys(formula.typeRatios).length
      ? (formula.typeRatios as Record<string, number>)
      : DEFAULT_TYPE_RATIOS;
  const typeTargets: Record<string, number> = {};
  for (const [k, v] of Object.entries(typeRatios)) {
    typeTargets[k] = Math.ceil(targetSpecies * v);
  }
  const typeCounts: Record<string, number> = {};

  // Oudolf-role quotas: only active when the formula defines roleRatios AND
  // candidate plants have an oudolfRole. Candidates without a role never get
  // the bonus; they can still be selected on other merits.
  const roleTargets: Partial<Record<OudolfRole, number>> = {};
  if (formula?.roleRatios) {
    for (const [k, v] of Object.entries(formula.roleRatios)) {
      if (typeof v === 'number') {
        roleTargets[k as OudolfRole] = Math.ceil(targetSpecies * v);
      }
    }
  }
  const roleCounts: Partial<Record<OudolfRole, number>> = {};

  while (selected.length < targetSpecies && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      let score = scorePlant(remaining[i], ctx, formula);

      // PlantType quota bonus
      const type = remaining[i].plantType;
      const currentCount = typeCounts[type] || 0;
      const target = typeTargets[type] || 1;
      if (currentCount < target) score += 15;

      // Oudolf role quota bonus (only when formula sets roleRatios)
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

  // Layout with spacing, exclusion zones, tree shade, and per-plot sun
  const planPlants = layoutPlants(
    selected, gridConfig, polygon, center,
    exclusionZones, existingTrees,
    preferences.aestheticPref || 'mixed',
    preferences.densityMultiplier || 1.0,
    sunGrid,
  );
  const diversityScore = calculateDiversityScore(selected);

  return {
    plants: planPlants,
    selectedSpecies: selected,
    gridCols: gridConfig.gridCols,
    gridRows: gridConfig.gridRows,
    areaSqFt,
    diversityScore,
    sunGrid,
  };
}
