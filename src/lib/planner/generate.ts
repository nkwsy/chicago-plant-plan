import type { Plant } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences, PlanPlant, ExclusionZone, ExistingTree, SunGrid } from '@/types/plan';
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
    return generateFromCandidates(relaxed, preferences, areaSqFt, polygon, center, exclusionZones, existingTrees, sunGrid);
  }

  return generateFromCandidates(prefFiltered, preferences, areaSqFt, polygon, center, exclusionZones, existingTrees, sunGrid);
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
): GeneratedPlan {
  const gridConfig = calculateGridSize(areaSqFt);
  const targetSpecies = Math.min(
    candidates.length,
    preferences.targetSpeciesCount || 10
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

  const typeTargets: Record<string, number> = {
    forb: Math.ceil(targetSpecies * 0.45),
    grass: Math.ceil(targetSpecies * 0.2),
    shrub: Math.ceil(targetSpecies * 0.15),
  };
  const typeCounts: Record<string, number> = {};

  while (selected.length < targetSpecies && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      let score = scorePlant(remaining[i], ctx);
      const type = remaining[i].plantType;
      const currentCount = typeCounts[type] || 0;
      const target = typeTargets[type] || 1;
      if (currentCount < target) score += 15;

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
