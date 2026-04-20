/**
 * Synthetic canonical sites for the formula preview sandbox.
 *
 * Four fixed rectangular beds anchored at a throwaway reference point in
 * Chicago. Each variant is chosen to exercise a different slice of the
 * scoring + layout surface so the user can see how a formula performs
 * across very different site conditions before saving.
 *
 *   default          — 40 × 25 ft, south tree + inside tree + 30 ft north
 *                      building + south walkway. All four sun categories
 *                      appear on one canvas.
 *   open_meadow      — 40 × 25 ft, no trees, no building. Everything is
 *                      full sun. Tests prairie / pollinator formulas.
 *   shaded_courtyard — 30 × 20 ft, three canopy trees + tall north building.
 *                      Mostly part-shade / full-shade. Tests shade formulas.
 *   compact_urban    — 15 × 10 ft small bed with one corner tree and an
 *                      east wall. Tests density + formula behavior on tight
 *                      urban plots.
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

export type ScenarioVariant =
  | 'default'
  | 'open_meadow'
  | 'shaded_courtyard'
  | 'compact_urban';

export const SCENARIO_VARIANTS: Array<{
  id: ScenarioVariant;
  label: string;
  blurb: string;
}> = [
  {
    id: 'default',
    label: 'Mixed site (default)',
    blurb: '40 × 25 ft · two trees + north wall · all four sun categories',
  },
  {
    id: 'open_meadow',
    label: 'Open meadow',
    blurb: '40 × 25 ft · full sun, no trees · pollinator / prairie stress test',
  },
  {
    id: 'shaded_courtyard',
    label: 'Shaded courtyard',
    blurb: '30 × 20 ft · three canopy trees + tall wall · mostly shade',
  },
  {
    id: 'compact_urban',
    label: 'Compact urban bed',
    blurb: '15 × 10 ft · corner tree + east wall · tight urban plot',
  },
];

export interface SyntheticScenario {
  variant: ScenarioVariant;
  widthFt: number;
  heightFt: number;
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

/** Helper: build a rectangular bed with the given cartesian dimensions. */
function buildBed(widthFt: number, heightFt: number) {
  const sw = ftToLngLat(0, 0);
  const se = ftToLngLat(widthFt, 0);
  const ne = ftToLngLat(widthFt, heightFt);
  const nw = ftToLngLat(0, heightFt);
  const polygon: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [[sw, se, ne, nw, sw]],
  };
  const bounds = {
    minLat: sw[1],
    maxLat: ne[1],
    minLng: sw[0],
    maxLng: se[0],
  };
  const center: [number, number] = ftToLngLat(widthFt / 2, heightFt / 2);
  return { polygon, bounds, center };
}

/** Helper: tree at cartesian (x,y) with the given canopy + height. */
function makeTree(
  id: string,
  xFt: number,
  yFt: number,
  canopyDiameterFt: number,
  heightFt: number,
  label: string,
  outsideProperty = false,
): ExistingTree {
  const [lng, lat] = ftToLngLat(xFt, yFt);
  return { id, lng, lat, canopyDiameterFt, heightFt, label, outsideProperty };
}

/** Helper: rectangular building exclusion zone + its NearbyBuilding twin. */
function makeBuilding(
  id: string,
  label: string,
  xFtMin: number,
  yFtMin: number,
  xFtMax: number,
  yFtMax: number,
  heightFt: number,
): { zone: ExclusionZone; nearby: NearbyBuilding } {
  const sw = ftToLngLat(xFtMin, yFtMin);
  const se = ftToLngLat(xFtMax, yFtMin);
  const ne = ftToLngLat(xFtMax, yFtMax);
  const nw = ftToLngLat(xFtMin, yFtMax);
  const centerFt = ftToLngLat((xFtMin + xFtMax) / 2, (yFtMin + yFtMax) / 2);
  return {
    zone: {
      id,
      label,
      type: 'building',
      heightMeters: heightFt * FT_TO_M,
      geoJson: { type: 'Polygon', coordinates: [[sw, se, ne, nw, sw]] },
    },
    nearby: {
      lat: centerFt[1],
      lng: centerFt[0],
      heightMeters: heightFt * FT_TO_M,
      widthMeters: (xFtMax - xFtMin) * FT_TO_M,
    },
  };
}

/** Helper: rectangular walkway exclusion zone. */
function makePath(
  id: string,
  label: string,
  xFtMin: number,
  yFtMin: number,
  xFtMax: number,
  yFtMax: number,
): ExclusionZone {
  const sw = ftToLngLat(xFtMin, yFtMin);
  const se = ftToLngLat(xFtMax, yFtMin);
  const ne = ftToLngLat(xFtMax, yFtMax);
  const nw = ftToLngLat(xFtMin, yFtMax);
  return {
    id,
    label,
    type: 'walkway',
    geoJson: { type: 'Polygon', coordinates: [[sw, se, ne, nw, sw]] },
  };
}

export function buildSyntheticScenario(
  variant: ScenarioVariant = 'default',
): SyntheticScenario {
  switch (variant) {
    case 'open_meadow': {
      const widthFt = 40;
      const heightFt = 25;
      const { polygon, bounds, center } = buildBed(widthFt, heightFt);
      return {
        variant,
        widthFt,
        heightFt,
        polygon,
        bounds,
        center,
        areaSqFt: widthFt * heightFt,
        existingTrees: [],
        exclusionZones: [],
        nearbyBuildings: [],
      };
    }

    case 'shaded_courtyard': {
      const widthFt = 30;
      const heightFt = 20;
      const { polygon, bounds, center } = buildBed(widthFt, heightFt);
      // Three canopy trees arranged inside the bed, so almost every cell is
      // under at least one canopy. North wall at y=20..30 adds hard shade on
      // the top strip.
      const trees: ExistingTree[] = [
        makeTree('sc-tree-1', 8, 5, 20, 35, 'Mature maple'),
        makeTree('sc-tree-2', 22, 8, 16, 28, 'Oak'),
        makeTree('sc-tree-3', 15, 16, 12, 22, 'Serviceberry'),
      ];
      const { zone: wall, nearby } = makeBuilding(
        'sc-wall',
        '3-story wall',
        0,
        heightFt,
        widthFt,
        heightFt + 10,
        40,
      );
      return {
        variant,
        widthFt,
        heightFt,
        polygon,
        bounds,
        center,
        areaSqFt: widthFt * heightFt,
        existingTrees: trees,
        exclusionZones: [wall],
        nearbyBuildings: [nearby],
      };
    }

    case 'compact_urban': {
      const widthFt = 15;
      const heightFt = 10;
      const { polygon, bounds, center } = buildBed(widthFt, heightFt);
      // Small tree in the NW corner, east wall on the right.
      const tree = makeTree('cu-tree', 3, 8, 10, 18, 'Corner dogwood');
      const { zone: wall, nearby } = makeBuilding(
        'cu-wall',
        'East wall',
        widthFt,
        0,
        widthFt + 8,
        heightFt,
        25,
      );
      return {
        variant,
        widthFt,
        heightFt,
        polygon,
        bounds,
        center,
        areaSqFt: widthFt * heightFt,
        existingTrees: [tree],
        exclusionZones: [wall],
        nearbyBuildings: [nearby],
      };
    }

    case 'default':
    default: {
      const widthFt = 40;
      const heightFt = 25;
      const { polygon, bounds, center } = buildBed(widthFt, heightFt);

      // Tree 1 — outside the bed on the south edge, so its shadow reaches
      // into the lower portion of the bed as the sun tracks south.
      const tree1 = makeTree('synth-tree-1', 8, -4, 18, 30, 'Mature oak (south)', true);
      // Tree 2 — inside the bed, east side.
      const tree2 = makeTree('synth-tree-2', 30, 18, 10, 16, 'Small serviceberry');
      const { zone: building, nearby } = makeBuilding(
        'synth-building',
        'North wall (2-story)',
        0,
        heightFt,
        widthFt,
        heightFt + 10,
        30,
      );
      const path = makePath('synth-path', 'Gravel path', 15, 0, 25, 5);
      return {
        variant: 'default',
        widthFt,
        heightFt,
        polygon,
        bounds,
        center,
        areaSqFt: widthFt * heightFt,
        existingTrees: [tree1, tree2],
        exclusionZones: [building, path],
        nearbyBuildings: [nearby],
      };
    }
  }
}

/** Legacy constants kept for callers that still import them. The sandbox
 *  endpoint derives width/height from the chosen scenario directly; these
 *  are the default variant's dimensions for backward compatibility. */
export const BED_WIDTH_FT = 40;
export const BED_HEIGHT_FT = 25;

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
