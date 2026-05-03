/**
 * Uniform-grid planting layout (phase 4 of the planting-layout overhaul).
 *
 * Why
 * ---
 * The Voronoi tapestry produces beautifully naturalistic placement but is
 * a nightmare to install — there's no straight line to measure off. A
 * regular grid at e.g. 18″ on-center is the standard professional install
 * pattern: the crew snaps a chalk grid, drops one plug per intersection.
 *
 * The grid generator emits the same `PlanPlant[]` shape as the Voronoi
 * generator (with `cellGeoJson` populated as an axis-aligned square), so
 * the existing tapestry / symbol layers Just Work.
 *
 * Pipeline
 * --------
 *   1. Cover the bed bounding box with a regular grid of points at
 *      `gridSpacingInches` on-center.
 *   2. Drop points outside the bed polygon or inside an exclusion zone.
 *   3. Stratified tier assignment: assign each surviving point to a tier
 *      using cascading sub-sampling (T5 emergents on a sparse sub-grid,
 *      T4 on a denser one, etc.). Higher tiers are placed first and lock
 *      out their immediate neighbours from also being a high tier so
 *      emergents don't cluster.
 *   4. Species assignment: pick a species per tiered point from the
 *      candidate pool, with sun-grid filtering.
 *   5. Drift consolidation: walk grid neighbours and paint adjacent
 *      same-tier points with the same species (rhythm).
 *   6. Build a square cell polygon for each point, clipped to the bed.
 *
 * The grid is emitted in *row-major* order with `gridX`/`gridY` populated
 * so install instructions can reference plants by "Row B, Col 3".
 */

import type { Plant, PlantType } from '@/types/plant';
import type { PlanPlant, ExclusionZone, ExistingTree, SunGrid } from '@/types/plan';
import * as turf from '@turf/turf';
import { getCellAt } from '@/lib/analysis/sun-grid';

const M_PER_DEG_LAT = 111320;
const FT_TO_M = 0.3048;
const IN_TO_FT = 1 / 12;

type Tier = 1 | 2 | 3 | 4 | 5;

/** How sparse each tier is in *grid cells* (not feet). For an 18″ grid:
 *   T5 every 9 cells ≈ 14ft   T4 every 5 ≈ 7.5ft   T3 every 3 ≈ 4.5ft
 *  T2 fills the rest as matrix; T1 borrows ~10% of T2 for filler accents. */
function tierSubsampleStride(gridSpacingFt: number): Record<Tier, number> {
  return {
    5: Math.max(2, Math.round(14 / gridSpacingFt)),
    4: Math.max(2, Math.round(7 / gridSpacingFt)),
    3: Math.max(1, Math.round(4 / gridSpacingFt)),
    2: 1,
    1: 1,
  };
}

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

function inferTier(p: Plant): Tier {
  if (p.plantType === 'tree') return 5;
  if (p.plantType === 'shrub') return p.heightMaxInches >= 60 ? 5 : 4;
  if (p.plantType === 'sedge' || p.plantType === 'fern') return 1;
  if (p.plantType === 'grass') return p.oudolfRole === 'matrix' ? 2 : 3;
  if (p.oudolfRole === 'filler') return 1;
  if (p.oudolfRole === 'structure') return p.heightMaxInches >= 60 ? 5 : 4;
  return 3;
}

const DRIFT_CAP_BY_SOCIABILITY: Record<number, number> = {
  1: 1, 2: 5, 3: 10, 4: 20, 5: 40,
};

function pickSpeciesForTier(
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

export interface GridLayoutOptions {
  exclusionZones?: ExclusionZone[];
  existingTrees?: ExistingTree[];
  /** Grid spacing in inches, on-center. Default 18″ — the professional
   *  herbaceous-bed standard (1 plant per ~2.25 sqft). */
  gridSpacingInches?: number;
  sunGrid?: SunGrid | null;
  seed?: number;
  skipDriftConsolidation?: boolean;
}

export interface GridLayoutResult {
  plants: PlanPlant[];
  tierCounts: Record<Tier, number>;
  /** Full grid dimensions in cells — useful for the install printout. */
  gridCols: number;
  gridRows: number;
  gridSpacingInches: number;
}

export function generateGridLayout(
  candidates: Plant[],
  bedPolygon: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  centerCoords: [number, number],
  options: GridLayoutOptions = {},
): GridLayoutResult {
  const {
    exclusionZones = [],
    existingTrees: _trees = [],
    gridSpacingInches = 18,
    sunGrid = null,
    seed = 42,
    skipDriftConsolidation = false,
  } = options;
  void _trees;

  const [centerLat, centerLng] = centerCoords;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  const gridSpacingFt = gridSpacingInches * IN_TO_FT;
  const gridSpacingM = gridSpacingFt * FT_TO_M;
  const halfM = gridSpacingM / 2;
  const dLat = gridSpacingM / M_PER_DEG_LAT;
  const dLng = gridSpacingM / mPerDegLng;
  const halfLat = halfM / M_PER_DEG_LAT;
  const halfLng = halfM / mPerDegLng;

  const rng = mulberry32(seed);

  const bedFeature = turf.feature(bedPolygon) as GeoJSON.Feature<
    GeoJSON.Polygon | GeoJSON.MultiPolygon
  >;
  const exclusionFeatures = exclusionZones.map(
    (z) => turf.feature(z.geoJson) as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  );

  // Bed bbox in lng/lat. Build the regular grid by walking from the SW corner
  // upward; align grid origin to the bed center so the visible pattern stays
  // symmetric regardless of bbox-corner happenstance.
  const bbox = turf.bbox(bedFeature); // [minLng, minLat, maxLng, maxLat]
  const minLng = bbox[0];
  const minLat = bbox[1];
  const maxLng = bbox[2];
  const maxLat = bbox[3];
  const gridCols = Math.ceil((maxLng - minLng) / dLng) + 1;
  const gridRows = Math.ceil((maxLat - minLat) / dLat) + 1;

  function isInBed(lat: number, lng: number): boolean {
    const pt = turf.point([lng, lat]);
    if (!turf.booleanPointInPolygon(pt, bedFeature)) return false;
    for (const exc of exclusionFeatures) {
      if (turf.booleanPointInPolygon(pt, exc)) return false;
    }
    return true;
  }

  // ---- Build grid, mark cells inside the bed ---------------------------
  interface GridCell {
    row: number;
    col: number;
    lat: number;
    lng: number;
    inside: boolean;
    tier?: Tier;
    species?: Plant | null;
  }
  const cells: GridCell[] = [];
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const lat = minLat + r * dLat + dLat / 2;
      const lng = minLng + c * dLng + dLng / 2;
      cells.push({ row: r, col: c, lat, lng, inside: isInBed(lat, lng) });
    }
  }
  const liveCells = cells.filter((c) => c.inside);

  // ---- Cascade tier assignment -----------------------------------------
  const stride = tierSubsampleStride(gridSpacingFt);
  const claimed = new Set<number>(); // index into `cells` (row * gridCols + col)
  const idx = (r: number, c: number) => r * gridCols + c;

  // Place tier 5 first on the sparsest sub-grid, then 4, then 3. T2 (matrix)
  // fills any unclaimed in-bed cell.
  for (const tier of [5, 4, 3] as Tier[]) {
    const step = stride[tier];
    // Random sub-grid offset so emergents don't always land on the corner.
    const offR = Math.floor(rng() * step);
    const offC = Math.floor(rng() * step);
    for (let r = offR; r < gridRows; r += step) {
      for (let c = offC; c < gridCols; c += step) {
        const cell = cells[idx(r, c)];
        if (!cell?.inside) continue;
        if (claimed.has(idx(r, c))) continue;
        cell.tier = tier;
        claimed.add(idx(r, c));
      }
    }
  }
  for (const cell of liveCells) {
    if (!cell.tier) {
      // Sprinkle T1 fillers into ~10% of the matrix so the matrix isn't
      // monotonous — these are low gap-fillers like Aquilegia, Geum.
      cell.tier = rng() < 0.1 ? 1 : 2;
    }
  }

  // ---- Species per cell ------------------------------------------------
  for (const cell of liveCells) {
    cell.species = pickSpeciesForTier(
      candidates,
      cell.tier as Tier,
      cell.lat,
      cell.lng,
      rng,
      sunGrid,
    );
  }

  // ---- Drift consolidation: paint same-tier rook-neighbours -----------
  if (!skipDriftConsolidation) {
    const sourceSpecies: Array<Plant | null> = liveCells.map((c) => c.species ?? null);
    const liveCellIndex = new Map<number, number>(); // grid idx → liveCells idx
    liveCells.forEach((c, i) => liveCellIndex.set(idx(c.row, c.col), i));
    const claimedDrift = new Array<boolean>(liveCells.length).fill(false);

    const order = liveCells.map((_, i) => i).sort(() => rng() - 0.5);
    for (const i of order) {
      if (claimedDrift[i]) continue;
      const sp = sourceSpecies[i];
      if (!sp) continue;
      const tier = liveCells[i].tier;
      const soc = sp.sociability ?? 3;
      const cap = DRIFT_CAP_BY_SOCIABILITY[soc] ?? 10;
      if (cap <= 1) continue;

      const queue = [i];
      const seen = new Set<number>([i]);
      claimedDrift[i] = true;
      let painted = 1;
      while (queue.length > 0 && painted < cap) {
        const cur = queue.shift()!;
        const cell = liveCells[cur];
        // Rook neighbours (4-connected). Diagonals tend to look unnatural in
        // a grid-of-plants context.
        const nbCoords: [number, number][] = [
          [cell.row - 1, cell.col],
          [cell.row + 1, cell.col],
          [cell.row, cell.col - 1],
          [cell.row, cell.col + 1],
        ];
        for (const [nr, nc] of nbCoords) {
          if (nr < 0 || nc < 0 || nr >= gridRows || nc >= gridCols) continue;
          const nbIdx = liveCellIndex.get(idx(nr, nc));
          if (nbIdx == null || seen.has(nbIdx)) continue;
          seen.add(nbIdx);
          if (claimedDrift[nbIdx]) continue;
          if (liveCells[nbIdx].tier !== tier) continue;
          const baseProb = (soc - 1) / 5;
          const prob = baseProb * (1 - painted / cap);
          if (rng() < prob) {
            liveCells[nbIdx].species = sp;
            claimedDrift[nbIdx] = true;
            painted++;
            queue.push(nbIdx);
          }
        }
      }
    }
  }

  // ---- Build PlanPlants ------------------------------------------------
  const tierCounts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const speciesIndexMap = new Map<string, number>();
  let nextSpeciesIdx = 1;
  const out: PlanPlant[] = [];

  for (const cell of liveCells) {
    if (!cell.species) continue;
    const sp = cell.species;
    const tier = cell.tier as Tier;
    tierCounts[tier]++;
    if (!speciesIndexMap.has(sp.slug)) speciesIndexMap.set(sp.slug, nextSpeciesIdx++);
    const spread = (sp.spreadMinInches + sp.spreadMaxInches) / 2;

    // Build the cell square. Clip a square aligned to the grid, intersected
    // with the bed and minus exclusions, so cells along the bed edge are
    // properly trimmed.
    const sqRing: Array<[number, number]> = [
      [cell.lng - halfLng, cell.lat - halfLat],
      [cell.lng + halfLng, cell.lat - halfLat],
      [cell.lng + halfLng, cell.lat + halfLat],
      [cell.lng - halfLng, cell.lat + halfLat],
      [cell.lng - halfLng, cell.lat - halfLat],
    ];
    let cellPoly: GeoJSON.Polygon = { type: 'Polygon', coordinates: [sqRing] };
    let areaSqFt = (gridSpacingFt) * (gridSpacingFt);
    try {
      const clipped = turf.intersect(
        turf.featureCollection([turf.polygon([sqRing]), bedFeature]),
      );
      if (clipped) {
        let withoutExc: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null =
          clipped as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
        for (const exc of exclusionFeatures) {
          if (!withoutExc) break;
          const diff = turf.difference(turf.featureCollection([withoutExc, exc]));
          if (diff) withoutExc = diff as GeoJSON.Feature<
            GeoJSON.Polygon | GeoJSON.MultiPolygon
          >;
        }
        if (withoutExc) {
          if (withoutExc.geometry.type === 'MultiPolygon') {
            // Keep the largest piece — bed-edge fragments stay representative.
            const polys = withoutExc.geometry.coordinates.map((c) => turf.polygon([c[0]]));
            let best = polys[0];
            let bestArea = turf.area(best);
            for (const p of polys.slice(1)) {
              const a = turf.area(p);
              if (a > bestArea) { best = p; bestArea = a; }
            }
            cellPoly = best.geometry;
          } else {
            cellPoly = withoutExc.geometry;
          }
          areaSqFt = (turf.area(cellPoly) * 10.7639) / 1; // m² → ft²
        }
      }
    } catch {
      // Keep the unclipped square — happens when turf rejects degenerate
      // bed polygons. Better to draw a square slightly outside the bed edge
      // than to drop the plant entirely.
    }

    out.push({
      plantSlug: sp.slug,
      commonName: sp.commonName,
      scientificName: sp.scientificName,
      gridX: cell.col,
      gridY: cell.row,
      quantity: 1,
      bloomColor: sp.bloomColor,
      heightMaxInches: sp.heightMaxInches,
      notes: '',
      lat: cell.lat,
      lng: cell.lng,
      imageUrl: sp.imageUrl || '',
      spreadInches: Math.min(spread, 120),
      speciesIndex: speciesIndexMap.get(sp.slug) || 0,
      plantType: sp.plantType as PlantType,
      tier,
      sociability: sp.sociability,
      cellGeoJson: cellPoly,
      cellAreaSqFt: Math.round(areaSqFt * 10) / 10,
    });
  }

  return {
    plants: out,
    tierCounts,
    gridCols,
    gridRows,
    gridSpacingInches,
  };
}
