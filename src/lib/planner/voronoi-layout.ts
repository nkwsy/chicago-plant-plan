/**
 * Voronoi-cell tapestry layout (phase 2 of the planting-layout overhaul).
 *
 * Why this exists
 * ---------------
 * The legacy `layoutPlants()` in ./layout.ts places plants on a jittered grid
 * and renders them as procedural blob polygons whose shapes are independent
 * of their neighbours. That looks pleasant in isolation but produces visible
 * voids and overlaps where blob radii don't match the actual ground area
 * each plant occupies.
 *
 * A Voronoi tessellation gives every patch of the planting bed to its
 * nearest seed, so the bed is fully tiled by definition — no voids, no
 * overlaps. With Lloyd's relaxation we also get a more even distribution
 * than pure Poisson-disc sampling.
 *
 * High-level pipeline
 * -------------------
 *   1. Convert lat/lng → local meter coordinates centered on the bed.
 *   2. Cascade-seed by tier (5 emergent → 1 filler), each tier using
 *      Bridson's Poisson-disc with tier-specific spacing. Higher tiers
 *      placed first; lower-tier candidates rejected if they fall inside a
 *      higher-tier seed's exclusion radius.
 *   3. Run Lloyd's relaxation on all seeds 2× (cells get more uniform).
 *   4. Compute final Voronoi via d3-delaunay; clip each cell to the bed
 *      polygon minus exclusion zones.
 *   5. Assign a species per cell using the formula scoring already in
 *      generate.ts (passed in as `pickSpecies`), with sun-grid filtering.
 *   6. Drift consolidation: walk neighbouring cells and, with probability
 *      proportional to sociability, give them the same species (capped at
 *      the species' max drift size).
 *   7. Convert each cell back to lng/lat GeoJSON.
 *
 * The result is `PlanPlant[]` (compatible with the existing renderers and
 * the database schema) where each plant carries a `cellGeoJson` polygon.
 */

import type { Plant, PlantType } from '@/types/plant';
import type { PlanPlant, ExclusionZone, ExistingTree, SunGrid } from '@/types/plan';
import { Delaunay } from 'd3-delaunay';
import * as turf from '@turf/turf';
import { getCellAt } from '@/lib/analysis/sun-grid';

// ---------------------------------------------------------------------------
// Coordinate conversions. The bed is small enough (sub-acre) that a flat
// equirectangular projection centered on the bed is plenty accurate; we
// don't need a real proj4 transform.
// ---------------------------------------------------------------------------

const M_PER_DEG_LAT = 111320;
const FT_TO_M = 0.3048;
const M_TO_FT = 1 / FT_TO_M;

interface LocalProjection {
  lat0: number;
  lng0: number;
  mPerDegLng: number;
  toMeters(lat: number, lng: number): [number, number];
  toLatLng(x: number, y: number): [number, number];
}

function makeProjection(centerLat: number, centerLng: number): LocalProjection {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  return {
    lat0: centerLat,
    lng0: centerLng,
    mPerDegLng,
    toMeters(lat, lng) {
      const x = (lng - centerLng) * mPerDegLng;
      const y = (lat - centerLat) * M_PER_DEG_LAT;
      return [x, y];
    },
    toLatLng(x, y) {
      const lng = centerLng + x / mPerDegLng;
      const lat = centerLat + y / M_PER_DEG_LAT;
      return [lat, lng];
    },
  };
}

// ---------------------------------------------------------------------------
// Seeded RNG for reproducible layouts. Tiny mulberry32 — enough randomness
// for plant placement without pulling in a dependency.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Seed placement
// ---------------------------------------------------------------------------

type Tier = 1 | 2 | 3 | 4 | 5;

interface Seed {
  /** local x/y in meters */
  x: number;
  y: number;
  tier: Tier;
}

/** Tier → minimum on-center spacing in feet. Density multiplier scales these
 *  uniformly. Source: Oudolf-style planting plans + restoration-ecology
 *  spacing tables.
 *   T5 emergent  → 14ft (canopy trees, large emergents)
 *   T4 primary   → 7ft  (silhouette forbs, mid shrubs)
 *   T3 secondary → 4ft  (companion drift forbs)
 *   T2 matrix    → 2ft  (grasses & sedges)
 *   T1 filler    → 1.5ft (low gap-fillers)
 */
const TIER_SPACING_FT: Record<Tier, number> = {
  5: 14,
  4: 7,
  3: 4,
  2: 2,
  1: 1.5,
};

/** When placing a lower tier, reject candidates within this fraction of a
 *  higher-tier seed's spacing. Lets matrix grasses come close to a tree but
 *  not sit on top of its trunk. */
const HIGHER_TIER_REJECT_FRACTION = 0.4;

/** Bridson-style Poisson-disc seeding inside a polygon. We iterate over the
 *  bed bounding box at minSpacing-resolution, jitter each grid cell, then
 *  reject points that violate the spacing or fall outside the polygon /
 *  exclusion zones. */
function poissonDiscSeeds(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  minSpacingM: number,
  rng: () => number,
  isInBed: (x: number, y: number) => boolean,
  existingSeeds: Seed[],
  rejectRadiusForExisting: (s: Seed) => number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  // Cell size for our internal accept grid: minSpacing/√2 means a candidate
  // within minSpacing distance can only land in one of the 5×5 neighbouring
  // cells, so collision check is O(25).
  const cellSize = minSpacingM / Math.SQRT2;
  const cols = Math.ceil((bbox.maxX - bbox.minX) / cellSize);
  const rows = Math.ceil((bbox.maxY - bbox.minY) / cellSize);
  const grid: Array<Array<[number, number] | null>> = Array.from({ length: rows }, () =>
    Array(cols).fill(null),
  );

  function gridIdx(x: number, y: number): [number, number] {
    return [Math.floor((x - bbox.minX) / cellSize), Math.floor((y - bbox.minY) / cellSize)];
  }

  function tooCloseToSelf(x: number, y: number): boolean {
    const [gx, gy] = gridIdx(x, y);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const p = grid[ny][nx];
        if (!p) continue;
        const ddx = p[0] - x;
        const ddy = p[1] - y;
        if (ddx * ddx + ddy * ddy < minSpacingM * minSpacingM) return true;
      }
    }
    return false;
  }

  function tooCloseToExisting(x: number, y: number): boolean {
    for (const s of existingSeeds) {
      const r = rejectRadiusForExisting(s);
      const dx = s.x - x;
      const dy = s.y - y;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  // Iterate bbox in a coarse sweep, jitter inside each step, then attempt
  // placement. Two passes — second pass picks up holes left by the first.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = bbox.minY; y < bbox.maxY; y += minSpacingM * 0.85) {
      for (let x = bbox.minX; x < bbox.maxX; x += minSpacingM * 0.85) {
        const jx = x + (rng() - 0.5) * minSpacingM * 0.6;
        const jy = y + (rng() - 0.5) * minSpacingM * 0.6;
        if (jx < bbox.minX || jx > bbox.maxX || jy < bbox.minY || jy > bbox.maxY) continue;
        if (!isInBed(jx, jy)) continue;
        if (tooCloseToExisting(jx, jy)) continue;
        if (tooCloseToSelf(jx, jy)) continue;

        const [gx, gy] = gridIdx(jx, jy);
        if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
          grid[gy][gx] = [jx, jy];
        }
        out.push([jx, jy]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lloyd's relaxation. Re-centers each seed to the centroid of its Voronoi
// cell, repeating a few times. Converges fast for our cell counts.
// ---------------------------------------------------------------------------

function lloydRelax(
  points: Array<[number, number]>,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  passes: number,
): Array<[number, number]> {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    const flat = pts.flatMap(([x, y]) => [x, y]);
    const delaunay = new Delaunay(Float64Array.from(flat));
    const voronoi = delaunay.voronoi([bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]);
    pts = pts.map((_, i) => {
      const cell = voronoi.cellPolygon(i);
      if (!cell) return pts[i];
      // Centroid of the cell polygon (signed area formula).
      let cx = 0;
      let cy = 0;
      let area = 0;
      for (let j = 0; j < cell.length - 1; j++) {
        const [x0, y0] = cell[j];
        const [x1, y1] = cell[j + 1];
        const a = x0 * y1 - x1 * y0;
        area += a;
        cx += (x0 + x1) * a;
        cy += (y0 + y1) * a;
      }
      area *= 0.5;
      if (Math.abs(area) < 1e-9) return pts[i];
      cx /= 6 * area;
      cy /= 6 * area;
      return [cx, cy] as [number, number];
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Voronoi build + cell→polygon clip
// ---------------------------------------------------------------------------

interface BuiltCell {
  index: number;
  /** local-meter polygon, [x,y] coords, closed (last == first). */
  cellMeters: Array<[number, number]>;
  /** Clipped GeoJSON polygon in lng/lat coords. May have multiple rings if
   *  the cell straddles an exclusion zone — for simplicity we drop those and
   *  keep only the largest piece. */
  geoJson: GeoJSON.Polygon | null;
  areaSqFt: number;
  centerLat: number;
  centerLng: number;
}

function clipCellToBed(
  cellMeters: Array<[number, number]>,
  proj: LocalProjection,
  bedFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  exclusionFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): { geoJson: GeoJSON.Polygon | null; areaSqFt: number } {
  // Convert cell to lng/lat and feed turf.
  const ring: Array<[number, number]> = cellMeters.map(([x, y]) => {
    const [lat, lng] = proj.toLatLng(x, y);
    return [lng, lat];
  });
  if (ring.length < 4) return { geoJson: null, areaSqFt: 0 };
  // Ensure closed.
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  let cellPoly: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null;
  try {
    cellPoly = turf.polygon([ring]);
  } catch {
    return { geoJson: null, areaSqFt: 0 };
  }

  // Intersect with the bed.
  let clipped: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null = null;
  try {
    clipped = turf.intersect(turf.featureCollection([cellPoly, bedFeature])) as
      | GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
      | null;
  } catch {
    clipped = cellPoly;
  }
  if (!clipped) return { geoJson: null, areaSqFt: 0 };

  // Subtract exclusion zones one at a time.
  for (const exc of exclusionFeatures) {
    try {
      const diff = turf.difference(turf.featureCollection([clipped, exc])) as
        | GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
        | null;
      if (diff) clipped = diff;
    } catch {
      // ignore — keep current clipped
    }
  }
  if (!clipped) return { geoJson: null, areaSqFt: 0 };

  // If a MultiPolygon (cell got split by an exclusion), keep the largest piece.
  let polyGeo: GeoJSON.Polygon;
  if (clipped.geometry.type === 'MultiPolygon') {
    const polys = clipped.geometry.coordinates.map((c) => turf.polygon([c[0]]));
    let best = polys[0];
    let bestArea = turf.area(best);
    for (const p of polys.slice(1)) {
      const a = turf.area(p);
      if (a > bestArea) {
        best = p;
        bestArea = a;
      }
    }
    polyGeo = best.geometry;
  } else {
    polyGeo = clipped.geometry;
  }

  const areaM2 = turf.area(polyGeo);
  const areaSqFt = areaM2 * M_TO_FT * M_TO_FT;
  return { geoJson: polyGeo, areaSqFt };
}

// ---------------------------------------------------------------------------
// Species assignment + drift consolidation
// ---------------------------------------------------------------------------

function pickSpeciesForTierAndLocation(
  candidates: Plant[],
  tier: Tier,
  lat: number,
  lng: number,
  rng: () => number,
  sunGrid?: SunGrid | null,
): Plant | null {
  if (candidates.length === 0) return null;
  const tierMatches = candidates.filter((p) => (p.tier ?? inferTier(p)) === tier);
  const pool = tierMatches.length > 0 ? tierMatches : candidates;

  if (sunGrid) {
    const cell = getCellAt(sunGrid, lat, lng);
    if (cell) {
      const exact = pool.filter((p) => p.sun.includes(cell.sunCategory));
      if (exact.length > 0) return exact[Math.floor(rng() * exact.length)];
    }
  }
  return pool[Math.floor(rng() * pool.length)];
}

/** Fallback inference for plants saved before phase 1 ran. */
function inferTier(p: Plant): Tier {
  if (p.plantType === 'tree') return 5;
  if (p.plantType === 'shrub') return p.heightMaxInches >= 60 ? 5 : 4;
  if (p.plantType === 'sedge' || p.plantType === 'fern') return 1;
  if (p.plantType === 'grass') return p.oudolfRole === 'matrix' ? 2 : 3;
  if (p.oudolfRole === 'filler') return 1;
  if (p.oudolfRole === 'structure') return p.heightMaxInches >= 60 ? 5 : 4;
  return 3;
}

/** Drift cap by sociability — a sweep of S4 maxes around 30 cells; a solo
 *  S1 stays a single cell. */
const DRIFT_CAP_BY_SOCIABILITY: Record<number, number> = {
  1: 1,
  2: 5,
  3: 12,
  4: 30,
  5: 60,
};

/** Walk the Voronoi neighbour graph from each seed and, with probability
 *  scaled by sociability, paint adjacent cells of the SAME tier with the
 *  same species.
 *
 *  Two invariants keep the drifts from running away across the bed:
 *   1. We snapshot the species assignment up front so a painted cell never
 *      becomes a paint source itself (otherwise a sociable groundcover
 *      cascades across the whole tessellation).
 *   2. Painting only crosses cells of the same tier — drifts of matrix
 *      grasses don't swallow neighbouring tier-5 emergent specimens.
 *  We also skip cells that are already part of another drift this pass. */
function consolidateDrifts(
  cellSpecies: Array<Plant | null>,
  cellTiers: Array<Tier | null>,
  delaunay: Delaunay<Float64Array>,
  rng: () => number,
): void {
  const n = cellSpecies.length;
  const sourceSpecies = cellSpecies.slice();
  const claimed = new Array<boolean>(n).fill(false);

  // Visit cells in random order so drift roots aren't biased to the top-left.
  const order = Array.from({ length: n }, (_, i) => i).sort(() => rng() - 0.5);

  for (const i of order) {
    if (claimed[i]) continue;
    const sp = sourceSpecies[i];
    if (!sp) continue;
    const soc = sp.sociability ?? 3;
    const cap = DRIFT_CAP_BY_SOCIABILITY[soc] ?? 12;
    if (cap <= 1) continue;
    const sourceTier = cellTiers[i];
    if (!sourceTier) continue;

    // BFS painting. A cell is a candidate if (a) same tier as the root,
    // (b) not already claimed, (c) currently a different species.
    const queue: number[] = [i];
    const seen = new Set<number>([i]);
    claimed[i] = true;
    let painted = 1;

    while (queue.length > 0 && painted < cap) {
      const cur = queue.shift()!;
      for (const nb of delaunay.neighbors(cur)) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        if (claimed[nb]) continue;
        if (cellTiers[nb] !== sourceTier) continue;
        const nbSp = sourceSpecies[nb];
        if (!nbSp) continue;
        // Probability of painting falls off as the drift grows so a soc-4
        // species doesn't bulldoze its tier. soc=4 → 0.5 base; soc=2 → 0.17.
        const baseProb = (soc - 1) / 6;
        const prob = baseProb * (1 - painted / cap);
        if (rng() < prob) {
          cellSpecies[nb] = sp;
          claimed[nb] = true;
          painted++;
          queue.push(nb);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface VoronoiLayoutOptions {
  exclusionZones?: ExclusionZone[];
  existingTrees?: ExistingTree[];
  densityMultiplier?: number;
  sunGrid?: SunGrid | null;
  /** Lloyd's relaxation passes (default 2). Higher = more uniform cells. */
  relaxationPasses?: number;
  /** RNG seed. Same seed + same inputs ⇒ same layout. */
  seed?: number;
  /** Skip drift consolidation (one-cell-per-seed mode, useful for QA). */
  skipDriftConsolidation?: boolean;
}

export interface VoronoiLayoutResult {
  plants: PlanPlant[];
  /** Diagnostic — number of cells per tier post-seeding. */
  tierCounts: Record<Tier, number>;
}

export function generateVoronoiLayout(
  candidates: Plant[],
  bedPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  centerCoords: [number, number],
  options: VoronoiLayoutOptions = {},
): VoronoiLayoutResult {
  const {
    exclusionZones = [],
    existingTrees: _existingTrees = [],
    densityMultiplier = 1,
    sunGrid = null,
    relaxationPasses = 2,
    seed = 42,
    skipDriftConsolidation = false,
  } = options;
  void _existingTrees;

  const [centerLat, centerLng] = centerCoords;
  const proj = makeProjection(centerLat, centerLng);
  const rng = mulberry32(seed);

  // ---- Bed setup --------------------------------------------------------
  const bedFeature = turf.feature(bedPolygon) as GeoJSON.Feature<
    GeoJSON.Polygon | GeoJSON.MultiPolygon
  >;
  const exclusionFeatures = exclusionZones.map(
    (z) => turf.feature(z.geoJson) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  );

  // Bed bounding box in local meters.
  const bbox = turf.bbox(bedFeature); // [minLng, minLat, maxLng, maxLat]
  const [minX, minY] = proj.toMeters(bbox[1], bbox[0]);
  const [maxX, maxY] = proj.toMeters(bbox[3], bbox[2]);
  const localBbox = { minX, minY, maxX, maxY };

  function isInBed(x: number, y: number): boolean {
    const [lat, lng] = proj.toLatLng(x, y);
    const pt = turf.point([lng, lat]);
    if (!turf.booleanPointInPolygon(pt, bedFeature)) return false;
    for (const exc of exclusionFeatures) {
      if (turf.booleanPointInPolygon(pt, exc)) return false;
    }
    return true;
  }

  // ---- Cascade-seed by tier (5 → 1) ------------------------------------
  const seeds: Seed[] = [];
  const tiersDescending: Tier[] = [5, 4, 3, 2, 1];
  for (const tier of tiersDescending) {
    const minSpacingFt = TIER_SPACING_FT[tier] / densityMultiplier;
    const minSpacingM = minSpacingFt * FT_TO_M;
    const newPoints = poissonDiscSeeds(
      localBbox,
      minSpacingM,
      rng,
      isInBed,
      seeds,
      (s) => (TIER_SPACING_FT[s.tier] / densityMultiplier) * FT_TO_M *
        HIGHER_TIER_REJECT_FRACTION,
    );
    for (const [x, y] of newPoints) seeds.push({ x, y, tier });
  }

  if (seeds.length === 0) {
    return { plants: [], tierCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  }

  // ---- Lloyd's relaxation ---------------------------------------------
  let pts: Array<[number, number]> = seeds.map((s) => [s.x, s.y]);
  pts = lloydRelax(pts, localBbox, relaxationPasses);
  for (let i = 0; i < seeds.length; i++) {
    seeds[i].x = pts[i][0];
    seeds[i].y = pts[i][1];
  }

  // ---- Final Voronoi --------------------------------------------------
  const flat = Float64Array.from(pts.flatMap(([x, y]) => [x, y]));
  const delaunay = new Delaunay(flat);
  const voronoi = delaunay.voronoi([
    localBbox.minX,
    localBbox.minY,
    localBbox.maxX,
    localBbox.maxY,
  ]);

  // ---- Build cells ----------------------------------------------------
  const built: BuiltCell[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell || cell.length < 4) continue;
    const cellMeters = cell as Array<[number, number]>;
    const { geoJson, areaSqFt } = clipCellToBed(
      cellMeters,
      proj,
      bedFeature,
      exclusionFeatures,
    );
    if (!geoJson || areaSqFt < 0.25) continue;
    const [centerLatLocal, centerLngLocal] = proj.toLatLng(seeds[i].x, seeds[i].y);
    built.push({
      index: i,
      cellMeters,
      geoJson,
      areaSqFt,
      centerLat: centerLatLocal,
      centerLng: centerLngLocal,
    });
  }

  // ---- Species assignment --------------------------------------------
  const speciesIndexMap = new Map<string, number>();
  let nextSpeciesIdx = 1;
  const cellSpecies: Array<Plant | null> = new Array(seeds.length).fill(null);

  for (const c of built) {
    const tier = seeds[c.index].tier;
    const species = pickSpeciesForTierAndLocation(
      candidates,
      tier,
      c.centerLat,
      c.centerLng,
      rng,
      sunGrid,
    );
    cellSpecies[c.index] = species;
    if (species && !speciesIndexMap.has(species.slug)) {
      speciesIndexMap.set(species.slug, nextSpeciesIdx++);
    }
  }

  if (!skipDriftConsolidation) {
    // cellTiers is parallel to seeds; cells without species/tier stay null.
    const cellTiers: Array<Tier | null> = seeds.map((s, i) =>
      cellSpecies[i] ? s.tier : null,
    );
    consolidateDrifts(cellSpecies, cellTiers, delaunay, rng);
    for (const sp of cellSpecies) {
      if (sp && !speciesIndexMap.has(sp.slug)) speciesIndexMap.set(sp.slug, nextSpeciesIdx++);
    }
  }

  // ---- Build PlanPlants ----------------------------------------------
  const plants: PlanPlant[] = [];
  const tierCounts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const c of built) {
    const sp = cellSpecies[c.index];
    if (!sp) continue;
    const tier = seeds[c.index].tier;
    tierCounts[tier]++;
    const spread = (sp.spreadMinInches + sp.spreadMaxInches) / 2;
    plants.push({
      plantSlug: sp.slug,
      commonName: sp.commonName,
      scientificName: sp.scientificName,
      gridX: 0,
      gridY: 0,
      quantity: 1,
      bloomColor: sp.bloomColor,
      heightMaxInches: sp.heightMaxInches,
      notes: '',
      lat: c.centerLat,
      lng: c.centerLng,
      imageUrl: sp.imageUrl || '',
      spreadInches: Math.min(spread, 120),
      speciesIndex: speciesIndexMap.get(sp.slug) || 0,
      plantType: sp.plantType as PlantType,
      tier: (sp.tier ?? tier) as 1 | 2 | 3 | 4 | 5,
      sociability: sp.sociability,
      cellGeoJson: c.geoJson!,
      cellAreaSqFt: Math.round(c.areaSqFt * 10) / 10,
    });
  }

  return { plants, tierCounts };
}
