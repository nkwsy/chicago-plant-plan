import type { Plant } from '@/types/plant';
import type { UserPreferences } from '@/types/plan';
import type { DesignFormula, FormulaWeights } from '@/types/formula';

interface ScoringContext {
  selectedFamilies: Set<string>;
  selectedTypes: Set<string>;
  selectedBloomMonths: Set<number>;
  selectedColors: Set<string>;
  preferences: UserPreferences;
}

/** Pull a weight from the formula, defaulting to 1 (no change). */
function w(formula: DesignFormula | undefined, key: keyof FormulaWeights): number {
  return formula?.weights?.[key] ?? 1;
}

export function scorePlant(
  plant: Plant,
  ctx: ScoringContext,
  formula?: DesignFormula,
): number {
  let score = 0;

  // Diversity bonus: prefer underrepresented families (0-25 points)
  if (!ctx.selectedFamilies.has(plant.family)) {
    score += 25 * w(formula, 'familyDiversity');
  } else {
    score += 5 * w(formula, 'familyDiversity');
  }

  // Plant type diversity (0-15 points)
  if (!ctx.selectedTypes.has(plant.plantType)) {
    score += 15 * w(formula, 'typeDiversity');
  } else {
    score += 3 * w(formula, 'typeDiversity');
  }

  // Bloom season coverage (0-20 points)
  let newMonthsCovered = 0;
  for (let m = plant.bloomStartMonth; m <= plant.bloomEndMonth; m++) {
    if (!ctx.selectedBloomMonths.has(m)) newMonthsCovered++;
  }
  score += Math.min(newMonthsCovered * 5, 20) * w(formula, 'bloomCoverage');

  // Bloom preference alignment (0-10 points). Applies when the user picked a
  // specific season; if a formula also sets bloomEmphasisMonths, that's an
  // additional bonus below.
  if (ctx.preferences.bloomPreference !== 'continuous') {
    const prefMonths = getPreferenceMonths(ctx.preferences.bloomPreference);
    const inPref = prefMonths.some(
      (m) => m >= plant.bloomStartMonth && m <= plant.bloomEndMonth,
    );
    if (inPref) score += 10 * w(formula, 'bloomCoverage');
  } else {
    score += 5 * w(formula, 'bloomCoverage');
  }

  // Color diversity (0-10 points)
  if (!ctx.selectedColors.has(plant.bloomColor)) {
    score += 10 * w(formula, 'colorDiversity');
  }

  // Wildlife/habitat goal match (0-20 points)
  if (ctx.preferences.habitatGoals.length > 0) {
    const wildlifeMatch = plant.wildlifeValue.filter((x) =>
      ctx.preferences.habitatGoals.includes(x),
    ).length;
    score += Math.min(wildlifeMatch * 10, 20) * w(formula, 'wildlife');
  } else {
    // Default: favor pollinator-friendly plants
    if (plant.wildlifeValue.includes('pollinators')) score += 10 * w(formula, 'wildlife');
    if (plant.wildlifeValue.includes('butterflies')) score += 5 * w(formula, 'wildlife');
  }

  // Effort alignment (0-5 points)
  if (plant.effortLevel === 'low') score += 5 * w(formula, 'effort');
  else if (plant.effortLevel === 'medium') score += 3 * w(formula, 'effort');

  // Deer resistance bonus (0-5 points)
  if (plant.deerResistant) score += 5 * w(formula, 'deerResistance');

  // Special feature alignment (unchanged — these are user toggles, not
  // formula-driven)
  if (ctx.preferences.specialFeatures.includes('fall_color') && plant.bloomEndMonth >= 9) score += 5;
  if (ctx.preferences.specialFeatures.includes('winter_interest') && plant.plantType === 'grass') score += 5;
  if (ctx.preferences.specialFeatures.includes('edible') && plant.wildlifeValue.includes('birds')) score += 3;
  if (ctx.preferences.specialFeatures.includes('fragrant')) score += 3;

  // Curator favorability (±20 points). 50 is neutral; 100 gives +20, 0 gives -20.
  const favorability = typeof plant.favorability === 'number' ? plant.favorability : 50;
  score += (favorability - 50) * 0.4 * w(formula, 'favorability');

  // --- Formula-driven signals below. All no-ops when formula is undefined. ---

  // Oudolf winter interest / seed head — these axes default to 0 unless a
  // formula explicitly weights them, so they never contribute to classic
  // scoring.
  if (plant.winterStructure && formula?.weights?.winterInterest) {
    score += 10 * formula.weights.winterInterest;
  }
  if (plant.seedHeadInterest && formula?.weights?.seedHead) {
    score += 10 * formula.weights.seedHead;
  }

  // Characteristic-species pin
  if (formula?.characteristicSpecies?.includes(plant.slug)) {
    score += formula.pinBonus ?? 30;
  }

  // Tag bonuses and penalties
  if (formula && plant.tags?.length) {
    for (const tag of plant.tags) {
      if (formula.tagBonuses?.[tag]) score += formula.tagBonuses[tag];
      if (formula.tagPenalties?.[tag]) score += formula.tagPenalties[tag];
    }
  }

  // Bloom-month emphasis: extra credit when the bloom window overlaps months
  // the formula wants to highlight (e.g. [8,9,10] for Oudolf autumn focus).
  if (formula?.bloomEmphasisMonths?.length) {
    const bonus = formula.bloomEmphasisBonus ?? 10;
    const overlaps = formula.bloomEmphasisMonths.some(
      (m) => m >= plant.bloomStartMonth && m <= plant.bloomEndMonth,
    );
    if (overlaps) score += bonus;
  }

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
