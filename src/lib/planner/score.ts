import type { Plant } from '@/types/plant';
import type { UserPreferences } from '@/types/plan';

interface ScoringContext {
  selectedFamilies: Set<string>;
  selectedTypes: Set<string>;
  selectedBloomMonths: Set<number>;
  selectedColors: Set<string>;
  preferences: UserPreferences;
}

export function scorePlant(plant: Plant, ctx: ScoringContext): number {
  let score = 0;

  // Diversity bonus: prefer underrepresented families (0-25 points)
  if (!ctx.selectedFamilies.has(plant.family)) {
    score += 25;
  } else {
    score += 5;
  }

  // Plant type diversity (0-15 points)
  if (!ctx.selectedTypes.has(plant.plantType)) {
    score += 15;
  } else {
    score += 3;
  }

  // Bloom season coverage (0-20 points)
  let newMonthsCovered = 0;
  for (let m = plant.bloomStartMonth; m <= plant.bloomEndMonth; m++) {
    if (!ctx.selectedBloomMonths.has(m)) newMonthsCovered++;
  }
  score += Math.min(newMonthsCovered * 5, 20);

  // Bloom preference alignment (0-10 points)
  if (ctx.preferences.bloomPreference !== 'continuous') {
    const prefMonths = getPreferenceMonths(ctx.preferences.bloomPreference);
    const inPref = prefMonths.some(m => m >= plant.bloomStartMonth && m <= plant.bloomEndMonth);
    if (inPref) score += 10;
  } else {
    score += 5; // Small bonus for all when continuous
  }

  // Color diversity (0-10 points)
  if (!ctx.selectedColors.has(plant.bloomColor)) {
    score += 10;
  }

  // Wildlife/habitat goal match (0-20 points)
  if (ctx.preferences.habitatGoals.length > 0) {
    const wildlifeMatch = plant.wildlifeValue.filter(w => ctx.preferences.habitatGoals.includes(w)).length;
    score += Math.min(wildlifeMatch * 10, 20);
  } else {
    // Default: favor pollinator-friendly plants
    if (plant.wildlifeValue.includes('pollinators')) score += 10;
    if (plant.wildlifeValue.includes('butterflies')) score += 5;
  }

  // Effort alignment (0-5 points)
  if (plant.effortLevel === 'low') score += 5;
  else if (plant.effortLevel === 'medium') score += 3;

  // Deer resistance bonus (0-5 points)
  if (plant.deerResistant) score += 5;

  // Special feature alignment
  if (ctx.preferences.specialFeatures.includes('fall_color') && plant.bloomEndMonth >= 9) score += 5;
  if (ctx.preferences.specialFeatures.includes('winter_interest') && plant.plantType === 'grass') score += 5;
  if (ctx.preferences.specialFeatures.includes('edible') && plant.wildlifeValue.includes('birds')) score += 3;
  if (ctx.preferences.specialFeatures.includes('fragrant')) score += 3;

  // Small random factor to prevent identical plans (0-5 points)
  score += Math.random() * 5;

  return score;
}

function getPreferenceMonths(pref: string): number[] {
  switch (pref) {
    case 'spring': return [3, 4, 5];
    case 'summer': return [6, 7, 8];
    case 'fall': return [9, 10, 11];
    default: return [1,2,3,4,5,6,7,8,9,10,11,12];
  }
}

export function calculateDiversityScore(plants: Plant[]): number {
  if (plants.length === 0) return 0;

  const families = new Set(plants.map(p => p.family));
  const types = new Set(plants.map(p => p.plantType));
  const habitats = new Set(plants.flatMap(p => p.nativeHabitats));
  const colors = new Set(plants.map(p => p.bloomColor));

  // Bloom month coverage
  const bloomMonths = new Set<number>();
  plants.forEach(p => {
    for (let m = p.bloomStartMonth; m <= p.bloomEndMonth; m++) {
      bloomMonths.add(m);
    }
  });

  // Score components (each 0-20, total 0-100)
  const familyScore = Math.min((families.size / plants.length) * 40, 20);
  const typeScore = Math.min((types.size / 5) * 20, 20);
  const habitatScore = Math.min((habitats.size / 4) * 20, 20);
  const bloomScore = Math.min((bloomMonths.size / 9) * 20, 20); // Mar-Nov = 9 months
  const colorScore = Math.min((colors.size / 8) * 20, 20);

  return Math.round(familyScore + typeScore + habitatScore + bloomScore + colorScore);
}
