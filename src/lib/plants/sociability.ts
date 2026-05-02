import type { Plant } from '@/types/plant';

/**
 * Infer sociability (1–5) and hierarchy tier (1–5) from a plant's botanical
 * attributes. Uses Aster's sociability scale + Oudolf's 5-layer model.
 *
 * Designed as a *seed* — curators can override via the admin editor and the
 * helper will leave existing values alone (see applyInference()).
 *
 * Sociability scale:
 *   1 = solitary specimen          (single tree, large emergent forb)
 *   2 = small group of 3–5         (primary structural forbs)
 *   3 = drift of 6–12              (companion forbs, scatter accents)
 *   4 = sweep of 15–30             (matrix grasses, mass-planted forbs)
 *   5 = colony / continuous carpet (sedges, low groundcovers)
 *
 * Hierarchy tier (Oudolf 5-layer):
 *   1 = scatter / filler           (low gap-fillers, single accents)
 *   2 = matrix                     (groundcover grasses & sedges)
 *   3 = secondary companion        (drift-forming forbs of medium height)
 *   4 = primary structural         (silhouette forbs, mid-canopy shrubs)
 *   5 = emergent                   (tall accents — trees, large shrubs, very
 *                                   tall forbs/grasses)
 */
export interface InferenceResult {
  sociability: 1 | 2 | 3 | 4 | 5;
  tier: 1 | 2 | 3 | 4 | 5;
  reason: string;
}

export function inferSociabilityAndTier(p: Partial<Plant>): InferenceResult {
  const type = p.plantType;
  const role = p.oudolfRole;
  const heightMax = p.heightMaxInches ?? 0;
  const spreadMax = p.spreadMaxInches ?? 0;

  // -- Trees --------------------------------------------------------------
  // Always emergent canopy + solitary specimen. No real Oudolf-bed trees go
  // in clusters at our scales.
  if (type === 'tree') {
    return { sociability: 1, tier: 5, reason: 'tree → solo emergent overstory' };
  }

  // -- Shrubs -------------------------------------------------------------
  if (type === 'shrub') {
    if (heightMax >= 60) {
      return { sociability: 1, tier: 5, reason: 'large shrub (≥5ft) → solo emergent' };
    }
    if (heightMax >= 36) {
      return { sociability: 2, tier: 4, reason: 'mid shrub (3–5ft) → small group, primary' };
    }
    return { sociability: 2, tier: 3, reason: 'low shrub (<3ft) → small group, secondary' };
  }

  // -- Vines / ferns ------------------------------------------------------
  if (type === 'vine') {
    return { sociability: 2, tier: 3, reason: 'vine → small group, secondary layer' };
  }
  if (type === 'fern') {
    return { sociability: 4, tier: 1, reason: 'fern → sweep, low filler/groundcover' };
  }

  // -- Sedges -------------------------------------------------------------
  // Carex etc. are the gold-standard matrix base — colony-forming, low.
  if (type === 'sedge') {
    return { sociability: 5, tier: 2, reason: 'sedge → matrix colony' };
  }

  // -- Grasses ------------------------------------------------------------
  // Role wins over height for grasses. Big Bluestem (5–6ft) is *the*
  // canonical prairie matrix grass — its function is groundcover, not
  // emergent screen, so role=matrix pins it to T2 regardless of stature.
  if (type === 'grass') {
    if (role === 'matrix') {
      return { sociability: 4, tier: 2, reason: 'matrix grass → sweep, matrix layer' };
    }
    // Tall non-matrix grass (Calamagrostis cultivars, ornamental selections)
    // — used as drift specimens, primary structural.
    if (heightMax >= 60) {
      return { sociability: 3, tier: 4, reason: 'tall non-matrix grass (≥5ft) → drift, primary structural' };
    }
    // Mid grass without matrix role → secondary companion.
    return { sociability: 3, tier: 3, reason: 'mid grass → drift, secondary companion' };
  }

  // -- Forbs --------------------------------------------------------------
  // Role pins matrix/filler regardless of size; tier otherwise scales with
  // height. We reserve T5 for true emergents (≥6.5ft) — coneflower at 4ft
  // is structural primary (T4), not an emergent.
  if (type === 'forb') {
    if (role === 'filler') {
      // Low gap-fillers — Allium, Aquilegia, Geum, Heuchera.
      if (heightMax <= 18 || (spreadMax > 0 && spreadMax >= 18)) {
        return { sociability: 4, tier: 1, reason: 'low filler forb → sweep, filler layer' };
      }
      return { sociability: 3, tier: 1, reason: 'filler forb → drift, filler layer' };
    }
    if (role === 'matrix') {
      // Rare for a forb (Geranium maculatum, low Heuchera) but real.
      return { sociability: 4, tier: 2, reason: 'matrix-role forb → sweep, matrix layer' };
    }
    // True emergent forbs — Silphium laciniatum, Vernonia, very tall Eutrochium.
    if (heightMax >= 78) {
      return { sociability: 1, tier: 5, reason: 'very tall forb (≥6.5ft) → solo emergent accent' };
    }
    if (heightMax >= 60 && role === 'structure') {
      return { sociability: 2, tier: 5, reason: 'tall structural forb (5–6.5ft) → small group, emergent' };
    }
    // Primary structural — coneflower, Baptisia, Eryngium, Liatris.
    if (role === 'structure') {
      return { sociability: 2, tier: 4, reason: 'structural forb → small group, primary' };
    }
    // Companion drift forbs (scatter role or unset). Default for the bulk
    // of the catalog.
    return { sociability: 3, tier: 3, reason: 'companion forb → drift, secondary layer' };
  }

  // Unknown plantType — neutral middle of the road.
  return { sociability: 3, tier: 3, reason: 'unknown plantType → conservative defaults' };
}

/**
 * Apply inferred values onto a plant, leaving any existing curator-set
 * sociability/tier untouched. Returns the patch of fields that *changed*.
 */
export function inferenceAsPatch(
  p: Partial<Plant>,
): { sociability?: number; tier?: number; reason: string } {
  const inferred = inferSociabilityAndTier(p);
  const patch: { sociability?: number; tier?: number; reason: string } = {
    reason: inferred.reason,
  };
  if (p.sociability == null) patch.sociability = inferred.sociability;
  if (p.tier == null) patch.tier = inferred.tier;
  return patch;
}
