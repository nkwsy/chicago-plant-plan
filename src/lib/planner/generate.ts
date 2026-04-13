import type { Plant } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences, PlanPlant } from '@/types/plan';
import { filterPlantsBySite, filterPlantsByPreferences } from './filter';
import { scorePlant, calculateDiversityScore } from './score';
import { calculateGridSize, layoutPlants } from './layout';

interface GeneratedPlan {
  plants: PlanPlant[];
  selectedSpecies: Plant[];
  gridCols: number;
  gridRows: number;
  areaSqFt: number;
  diversityScore: number;
}

export function generatePlan(
  allPlants: Plant[],
  siteProfile: SiteProfile,
  preferences: UserPreferences,
  areaSqFt: number,
  polygon?: GeoJSON.Polygon | null,
  center?: [number, number],
): GeneratedPlan {
  // Step 1: Filter by site conditions
  const siteCompatible = filterPlantsBySite(allPlants, siteProfile);

  // Step 2: Filter by user preferences
  const prefFiltered = filterPlantsByPreferences(siteCompatible, preferences);

  if (prefFiltered.length === 0) {
    // Fallback: relax filters
    const relaxed = filterPlantsByPreferences(siteCompatible, {
      ...preferences,
      maxHeightInches: null,
      effortLevel: 'high',
    });
    if (relaxed.length === 0) {
      return { plants: [], selectedSpecies: [], gridCols: 3, gridRows: 3, areaSqFt, diversityScore: 0 };
    }
    return generateFromCandidates(relaxed, preferences, areaSqFt, polygon, center);
  }

  return generateFromCandidates(prefFiltered, preferences, areaSqFt, polygon, center);
}

function generateFromCandidates(
  candidates: Plant[],
  preferences: UserPreferences,
  areaSqFt: number,
  polygon?: GeoJSON.Polygon | null,
  center?: [number, number],
): GeneratedPlan {
  const gridConfig = calculateGridSize(areaSqFt);
  const targetSpecies = Math.min(
    candidates.length,
    preferences.targetSpeciesCount || 10
  );

  // Step 3: Greedy selection with diversity scoring
  const selected: Plant[] = [];
  const remaining = [...candidates];
  const ctx = {
    selectedFamilies: new Set<string>(),
    selectedTypes: new Set<string>(),
    selectedBloomMonths: new Set<number>(),
    selectedColors: new Set<string>(),
    preferences,
  };

  // Ensure mix of plant types - reserve slots
  const typeTargets: Record<string, number> = {
    forb: Math.ceil(targetSpecies * 0.45),
    grass: Math.ceil(targetSpecies * 0.2),
    shrub: Math.ceil(targetSpecies * 0.15),
  };
  const typeCounts: Record<string, number> = {};

  while (selected.length < targetSpecies && remaining.length > 0) {
    // Score all remaining
    let bestIdx = 0;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      let score = scorePlant(remaining[i], ctx);

      // Boost underrepresented types
      const type = remaining[i].plantType;
      const currentCount = typeCounts[type] || 0;
      const target = typeTargets[type] || 1;
      if (currentCount < target) {
        score += 15;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);

    // Update context
    ctx.selectedFamilies.add(chosen.family);
    ctx.selectedTypes.add(chosen.plantType);
    ctx.selectedColors.add(chosen.bloomColor);
    for (let m = chosen.bloomStartMonth; m <= chosen.bloomEndMonth; m++) {
      ctx.selectedBloomMonths.add(m);
    }
    typeCounts[chosen.plantType] = (typeCounts[chosen.plantType] || 0) + 1;
  }

  // Step 4: Layout (with geo-coordinates if polygon/center available)
  const planPlants = layoutPlants(selected, gridConfig, polygon, center);
  const diversityScore = calculateDiversityScore(selected);

  return {
    plants: planPlants,
    selectedSpecies: selected,
    gridCols: gridConfig.gridCols,
    gridRows: gridConfig.gridRows,
    areaSqFt,
    diversityScore,
  };
}
