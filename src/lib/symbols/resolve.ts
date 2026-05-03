/**
 * Resolve "what glyph should this plant get?" for a given symbol set.
 *
 * Resolution order, first hit wins:
 *   1. plan-level override   (per-plan, supplied separately to allow plan
 *                            customization without mutating the shared set)
 *   2. set.overrides[slug]   (species-specific override on the set itself)
 *   3. set.byFamily[family]  (botanical-family default)
 *   4. set.byTier[tier]      (hierarchy-tier fallback)
 *   5. set.fallback          (last resort)
 *
 * The resolver returns merged glyph + color + scale. Color/scale from a
 * lower-priority entry is used when the higher-priority entry omits it,
 * so e.g. an override that only sets a color still picks up the family
 * glyph below it.
 */

import type { Plant } from '@/types/plant';
import type { SymbolSet, SymbolGlyph, SymbolOverride, PlanSymbolOverrides } from '@/types/symbol-set';

export interface ResolvedSymbol {
  /** Inner SVG markup, ready to drop inside an <svg viewBox="0 0 24 24">. */
  svg: string;
  color: string;
  scale: number;
  /** Where in the resolution chain this came from — useful in admin UI to
   *  explain why a plant is showing a particular symbol. */
  source: 'plan-override' | 'set-override' | 'family' | 'tier' | 'fallback';
}

const DEFAULT_COLOR = '#2a2a2a';
const DEFAULT_SCALE = 1;

function mergeGlyph(
  base: { svg?: string; color?: string; scale?: number } | undefined,
  glyph: SymbolGlyph,
  source: ResolvedSymbol['source'],
): ResolvedSymbol {
  return {
    svg: base?.svg || glyph.svg,
    color: base?.color || glyph.defaultColor || DEFAULT_COLOR,
    scale: base?.scale ?? glyph.scale ?? DEFAULT_SCALE,
    source,
  };
}

export function resolveSymbol(
  plant: Pick<Plant, 'slug' | 'family' | 'tier' | 'plantType'>,
  set: SymbolSet,
  planOverrides?: PlanSymbolOverrides,
): ResolvedSymbol {
  const planOverride = planOverrides?.[plant.slug];
  const setOverride: SymbolOverride | undefined = set.overrides?.[plant.slug];

  // Pick the lowest-priority concrete glyph that exists, then layer in
  // the higher-priority partial overrides on top.
  let baseGlyph: { glyph: SymbolGlyph; source: ResolvedSymbol['source'] };

  if (plant.family && set.byFamily?.[plant.family]) {
    baseGlyph = { glyph: set.byFamily[plant.family], source: 'family' };
  } else if (plant.tier != null) {
    // byTier may serialize numeric keys as strings on Mongo round-trip.
    const tierKey = String(plant.tier);
    const tierGlyph = (set.byTier as Record<string, SymbolGlyph | undefined>)?.[tierKey];
    if (tierGlyph) {
      baseGlyph = { glyph: tierGlyph, source: 'tier' };
    } else {
      baseGlyph = { glyph: set.fallback, source: 'fallback' };
    }
  } else {
    baseGlyph = { glyph: set.fallback, source: 'fallback' };
  }

  // Set-level override: the override may carry its own SVG (full replacement)
  // or only color/scale (recolor of the underlying family/tier glyph).
  if (setOverride) {
    if (setOverride.svg) {
      return mergeGlyph(setOverride, { svg: setOverride.svg }, 'set-override');
    }
    return mergeGlyph(setOverride, baseGlyph.glyph, baseGlyph.source);
  }

  // Plan-level override sits above the set-level override.
  if (planOverride) {
    if (planOverride.svg) {
      return mergeGlyph(planOverride, { svg: planOverride.svg }, 'plan-override');
    }
    return mergeGlyph(planOverride, baseGlyph.glyph, baseGlyph.source);
  }

  return mergeGlyph(undefined, baseGlyph.glyph, baseGlyph.source);
}

/** Wrap raw glyph markup in a full <svg> tag, injecting the resolved color
 *  via `currentColor`. The result is suitable for direct innerHTML, an
 *  <img src="data:image/svg+xml,…">, or rasterizing onto a canvas for
 *  Mapbox icon registration. */
export function renderSymbolSvg(symbol: ResolvedSymbol, sizePx = 24): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" style="color:${symbol.color}">${symbol.svg}</svg>`;
}
