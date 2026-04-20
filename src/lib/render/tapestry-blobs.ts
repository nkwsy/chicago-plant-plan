/**
 * Shared tapestry-blob math.
 *
 * Generates the irregular polygon that represents one plant as an Oudolf-style
 * drift. Used by both the geographic renderer (MapboxMap, in lng/lat with
 * on-the-fly meter conversion) and the synthetic SVG sandbox (in plain
 * cartesian feet).
 *
 * Accepts a `project(angleRad, radius)` callback so neither callsite needs to
 * know about the other's coordinate system. The palette + abbrev helpers are
 * also centralized here so the two views look identical.
 */

// Saturated planting-plan palette chosen to read like an Oudolf watercolor:
// lime, mustard, coral, magenta, purple, teal, terracotta, sage. Avoid
// muddy browns — tapestry needs visual pop.
export const OUDOLF_PALETTE = [
  '#c9d13a',
  '#f6c845',
  '#ea5e52',
  '#9b4a92',
  '#74b340',
  '#ee7a70',
  '#d6934c',
  '#c16a9a',
  '#e7a2bd',
  '#7f6ba2',
  '#cfd56f',
  '#f8a94c',
  '#6bbeb8',
  '#b56363',
  '#d8d080',
  '#83a66e',
  '#e5ca4a',
  '#d27c48',
  '#89b995',
  '#bc8ab8',
];

export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function tapestryColor(speciesIdx: number, slug: string): string {
  const idx = (speciesIdx + hashString(slug || '')) % OUDOLF_PALETTE.length;
  return OUDOLF_PALETTE[idx];
}

export function speciesAbbrev(slug: string, name: string): string {
  if (slug.includes('-')) {
    const parts = slug.split('-');
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

export interface BlobInput {
  /** Stable key for noise seeding; typically the plant slug. */
  slug: string;
  /** Base radius of the blob in whatever planar unit the projector uses. */
  baseRadius: number;
}

/**
 * Compute blob vertices in polar offsets (angle + radius). The caller projects
 * each offset into its own coordinate system — lng/lat for the map, SVG
 * pixels for the sandbox.
 */
export function blobVertices(input: BlobInput): Array<{ angle: number; radius: number }> {
  const seed = hashString(input.slug || '');
  const nV = 14;
  const out: Array<{ angle: number; radius: number }> = [];
  for (let j = 0; j < nV; j++) {
    const angle = (j / nV) * Math.PI * 2;
    // Two-octave sine "noise" keyed off the seed — cheap, no dependency,
    // gives a believable irregular outline.
    const n1 = Math.sin(seed * 0.013 + j * 0.9) * 0.28;
    const n2 = Math.sin(seed * 0.029 + j * 2.1) * 0.14;
    const radius = input.baseRadius * (1 + n1 + n2);
    out.push({ angle, radius });
  }
  return out;
}

/** Build an SVG <path d="..."> string for the blob, centered at (cx, cy),
 *  in the same units as baseRadius. */
export function blobSvgPath(slug: string, cx: number, cy: number, baseRadius: number): string {
  const verts = blobVertices({ slug, baseRadius });
  const pts = verts.map((v) => {
    const x = cx + Math.cos(v.angle) * v.radius;
    const y = cy + Math.sin(v.angle) * v.radius;
    return { x, y };
  });
  if (!pts.length) return '';
  const first = pts[0];
  const rest = pts.slice(1).map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  return `M${first.x.toFixed(2)},${first.y.toFixed(2)} ${rest} Z`;
}
