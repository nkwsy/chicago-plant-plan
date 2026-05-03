/**
 * Symbol sets — reusable libraries of SVG glyphs that decorate planting
 * plans the way a Piet Oudolf hand-drawn plan does.
 *
 * A symbol set resolves "what glyph should I draw for this plant?" via a
 * three-step lookup with sensible fallbacks:
 *
 *   1. set.overrides[plantSlug]   — exact match for a single species
 *   2. set.byFamily[family]       — botanical-family default (Asteraceae, …)
 *   3. set.byTier[tier]           — hierarchy-tier fallback (T5 emergent → …)
 *   4. set.fallback               — last resort, used when nothing else matched
 *
 * Each entry is a `SymbolGlyph`: an SVG body string (no <svg> wrapper —
 * the renderer wraps with a normalized 24×24 viewBox) plus an optional
 * default color and scale.
 */

export interface SymbolGlyph {
  /** Inner SVG markup. Drawn inside a 24×24 viewBox. The renderer wraps
   *  this in <svg viewBox="0 0 24 24">…</svg> at paint time. Use
   *  `currentColor` so the renderer's color override flows through.
   *
   *  Example: `<circle cx="12" cy="12" r="6" fill="currentColor" />` */
  svg: string;
  /** Fallback color (hex or CSS named) when neither the override nor the
   *  set's palette specifies one. */
  defaultColor?: string;
  /** Multiplier on the rendered glyph size; 1.0 = the renderer's nominal
   *  pixel/meter size for that tier. Useful for emphasizing emergents. */
  scale?: number;
}

/** Per-plant override stored on a SymbolSet. The `svg` field is optional —
 *  if absent, the resolver falls back to byFamily/byTier but still applies
 *  the color/scale override. */
export interface SymbolOverride {
  svg?: string;
  color?: string;
  scale?: number;
}

export interface SymbolSet {
  slug: string;
  name: string;
  description: string;
  /** Built-in sets shipped with the app — not user-editable; users can
   *  clone them. */
  isBuiltIn: boolean;
  /** Cloned sets carry the slug of their parent so the UI can show "based
   *  on Oudolf classic" and to make diff-and-merge plausible later. */
  parentSlug?: string | null;
  /** Owning user's id (Mongo _id as string). Built-ins leave this null. */
  ownerId?: string | null;
  /** Family-keyed glyphs. Keys are botanical family names exactly as they
   *  appear in `Plant.family` (case-sensitive: "Asteraceae" not "asteraceae"). */
  byFamily: Record<string, SymbolGlyph>;
  /** Tier-keyed fallbacks (1–5). Numeric keys converted to/from strings on
   *  Mongo round-trip; the resolver handles both shapes. */
  byTier: Partial<Record<1 | 2 | 3 | 4 | 5, SymbolGlyph>>;
  /** Per-species overrides. Keys are plant slugs ("echinacea-purpurea"). */
  overrides: Record<string, SymbolOverride>;
  /** Last-resort fallback when nothing else matched. */
  fallback: SymbolGlyph;
  createdAt?: string;
  updatedAt?: string;
}

/** A SymbolSet can be saved on a PlanData via `symbolSetSlug`; per-plan
 *  overrides ride alongside in `symbolOverrides` (small, stored on the plan
 *  doc itself rather than mutating the shared set). */
export interface PlanSymbolOverrides {
  [plantSlug: string]: SymbolOverride;
}
