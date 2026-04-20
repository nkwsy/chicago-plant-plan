/**
 * Synthetic canonical site for the formula preview sandbox.
 *
 * A fixed 40×25 ft rectangular bed anchored at a throwaway reference point in
 * Chicago. The layout is chosen so the resulting sun grid exercises all four
 * sun categories (full_sun / part_sun / part_shade / full_shade) on a single
 * canvas:
 *
 *   +-----------------------------------+  ← N wall of 30 ft building (full_shade strip)
 *   |           FULL / PART SHADE        |
 *   |                                    |
 *   |       ● (30, 18)  10 ft canopy     |
 *   |                                    |  25 ft tall
 *   |  FULL SUN        PART SUN / PART  |
 *   |                  SHADE under trees |
 *   |  [path 15-25, 0-5] ←───┐           |
 *   +--------▲---------------▼-----------+  ← 0,0 (SW corner) origin
 *            ● (8, -4) tree, 18 ft canopy
 *              (outside the bed so shadow enters from the south)
 *
 *   40 ft wide along x-axis; 25 ft tall along y-axis.
 *
 * Trees, building and path are expressed in feet. We project to a fixed
 * lat/lng origin so existing helpers (buildSunGrid / layout) work without
 * special-casing a cartesian code path.
 */

import type { ExistingTree, ExclusionZone, SunGrid } from '@/types/plan';
import type { NearbyBuilding } from '@/lib/analysis/sun';

// Arbitrary Chicago-ish origin. The sandbox never surfaces these lat/lngs to
// the user — they're just a coordinate frame the planner understands.
export const SYNTH_ORIGIN_LAT = 41.88;
export const SYNTH_ORIGIN_LNG = -87.65;

export const BED_WIDTH_FT = 40;
export const BED_HEIGHT_FT = 25;

const FT_TO_M = 0.3048;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos((SYNTH_ORIGIN_LAT * Math.PI) / 180);

export function ftToLatDelta(ft: number): number {
  return (ft * FT_TO_M) / M_PER_DEG_LAT;
}
export function ftToLngDelta(ft: number): number {
  return (ft * FT_TO_M) / M_PER_DEG_LNG;
}

/** Convert a cartesian (feet) point in the synthetic bed to [lng, lat]. */
export function ftToLngLat(xFt: number, yFt: number): [number, number] {
  return [SYNTH_ORIGIN_LNG + ftToLngDelta(xFt), SYNTH_ORIGIN_LAT + ftToLatDelta(yFt)];
}

/** Convert a lat/lng back to cartesian feet relative to the SW corner. */
export function lngLatToFt(lng: number, lat: number): { xFt: number; yFt: number } {
  const dx = (lng - SYNTH_ORIGIN_LNG) / ftToLngDelta(1);
  const dy = (lat - SYNTH_ORIGIN_LAT) / ftToLatDelta(1);
  return { xFt: dx, yFt: dy };
}

export interface SyntheticScenario {
  /** GeoJSON polygon of the bed (for filters that expect one). */
  polygon: GeoJSON.Polygon;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  center: [number, number]; // [lng, lat]
  areaSqFt: number;
  existingTrees: ExistingTree[];
  exclusionZones: ExclusionZone[];
  /** Buildings passed to buildSunGrid's NearbyBuilding argument. Different API
   *  shape than exclusion-zone buildings; we supply both so the shading
   *  ray-casting sees the building from both code paths. */
  nearbyBuildings: NearbyBuilding[];
}

export function buildSyntheticScenario(): SyntheticScenario {
  const sw = ftToLngLat(0, 0);
  const se = ftToLngLat(BED_WIDTH_FT, 0);
  const ne = ftToLngLat(BED_WIDTH_FT, BED_HEIGHT_FT);
  const nw = ftToLngLat(0, BED_HEIGHT_FT);

  const polygon: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [[sw, se, ne, nw, sw]],
  };

  // Tree 1 — outside the bed on the south edge, so its shadow reaches into
  // the lower portion of the bed as the sun tracks south across the summer sky.
  // 18 ft canopy = ~9 ft radius, positioned at (8, -4) so the canopy just
  // brushes the bed's south edge from below.
  const tree1Pos = ftToLngLat(8, -4);
  const tree1: ExistingTree = {
    id: 'synth-tree-1',
    lng: tree1Pos[0],
    lat: tree1Pos[1],
    canopyDiameterFt: 18,
    heightFt: 30,
    label: 'Mature oak (south)',
    outsideProperty: true,
  };

  // Tree 2 — inside the bed, east side. Small 10 ft canopy so there's still
  // sun around it.
  const tree2Pos = ftToLngLat(30, 18);
  const tree2: ExistingTree = {
    id: 'synth-tree-2',
    lng: tree2Pos[0],
    lat: tree2Pos[1],
    canopyDiameterFt: 10,
    heightFt: 16,
    label: 'Small serviceberry',
    outsideProperty: false,
  };

  // Building — 30 ft tall, north of the bed, wall running from x=0..40 at y=25.
  // Represented both as a NearbyBuilding (for the center-point shadow model)
  // and as an ExclusionZone building-polygon (for the raycast model).
  const bldgSW = ftToLngLat(0, 25);
  const bldgSE = ftToLngLat(40, 25);
  const bldgNE = ftToLngLat(40, 35);
  const bldgNW = ftToLngLat(0, 35);
  const bldgCenter = ftToLngLat(20, 30);

  const building: ExclusionZone = {
    id: 'synth-building',
    label: 'North wall (2-story)',
    type: 'building',
    heightMeters: 30 * FT_TO_M,
    geoJson: {
      type: 'Polygon',
      coordinates: [[bldgSW, bldgSE, bldgNE, bldgNW, bldgSW]],
    },
  };

  const nearbyBuilding: NearbyBuilding = {
    lat: bldgCenter[1],
    lng: bldgCenter[0],
    heightMeters: 30 * FT_TO_M,
    widthMeters: 40 * FT_TO_M,
  };

  // Path — 10 ft × 5 ft along the south edge, centered x-wise.
  const pathSW = ftToLngLat(15, 0);
  const pathSE = ftToLngLat(25, 0);
  const pathNE = ftToLngLat(25, 5);
  const pathNW = ftToLngLat(15, 5);
  const path: ExclusionZone = {
    id: 'synth-path',
    label: 'Gravel path',
    type: 'walkway',
    geoJson: {
      type: 'Polygon',
      coordinates: [[pathSW, pathSE, pathNE, pathNW, pathSW]],
    },
  };

  const bounds = {
    minLat: sw[1],
    maxLat: ne[1],
    minLng: sw[0],
    maxLng: se[0],
  };

  const center: [number, number] = ftToLngLat(BED_WIDTH_FT / 2, BED_HEIGHT_FT / 2);

  return {
    polygon,
    bounds,
    center,
    areaSqFt: BED_WIDTH_FT * BED_HEIGHT_FT,
    existingTrees: [tree1, tree2],
    exclusionZones: [building, path],
    nearbyBuildings: [nearbyBuilding],
  };
}

/** Reproject a SunGrid (lat/lng) into cartesian feet so the SVG renderer
 *  doesn't need to know about geography. */
export function sunGridToFeet(grid: SunGrid): {
  cells: Array<{
    row: number;
    col: number;
    xFt: number;
    yFt: number;
    sunHours: number;
    sunCategory: 'full_sun' | 'part_sun' | 'part_shade' | 'full_shade';
    underCanopy: boolean;
    inExclusion: boolean;
  }>;
  cellSizeFt: number;
  cols: number;
  rows: number;
} {
  return {
    cellSizeFt: grid.cellSizeFt,
    cols: grid.cols,
    rows: grid.rows,
    cells: grid.cells.map((c) => {
      const { xFt, yFt } = lngLatToFt(c.centerLng, c.centerLat);
      return {
        row: c.row,
        col: c.col,
        xFt: xFt - grid.cellSizeFt / 2, // SW corner of cell, not center
        yFt: yFt - grid.cellSizeFt / 2,
        sunHours: c.sunHours,
        sunCategory: c.sunCategory,
        underCanopy: c.underCanopy,
        inExclusion: c.inExclusion,
      };
    }),
  };
}
