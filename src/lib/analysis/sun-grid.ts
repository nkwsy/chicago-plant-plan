/**
 * Sun Grid Analysis — compute per-plot (5×5 ft) sun hours for a garden.
 *
 * Each cell gets its own sun calculation factoring in:
 * - Building shadows (from Overpass data)
 * - Tree canopy shadows (both inside and within 30ft outside property)
 * - A global user override that replaces all computed values
 */
import SunCalc from 'suncalc';
import { sunHoursToCategory } from './sun';
import type { NearbyBuilding } from './sun';
import type { ExistingTree, ExclusionZone, SunGrid, SunGridCell } from '@/types/plan';

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos(41.88 * Math.PI / 180);
const FT_TO_M = 0.3048;
const CELL_SIZE_FT = 5;

function ftToDegLat(ft: number): number { return ft * FT_TO_M / M_PER_DEG_LAT; }
function ftToDegLng(ft: number): number { return ft * FT_TO_M / M_PER_DEG_LNG; }

function toMeters(lat: number, lng: number, refLat: number, refLng: number) {
  return {
    x: (lng - refLng) * M_PER_DEG_LNG / FT_TO_M * FT_TO_M, // in meters
    y: (lat - refLat) * M_PER_DEG_LAT / FT_TO_M * FT_TO_M,
  };
}

/**
 * Build a sun grid for the garden area.
 *
 * @param bounds - Garden bounding box in lat/lng
 * @param trees - All trees (inside + outside property within 30ft)
 * @param buildings - Nearby buildings from Overpass
 * @param exclusionZones - Sidewalks, patios, etc.
 * @param polygon - Garden boundary polygon
 * @param globalOverride - User-set sun hours (null = use computed)
 */
export function buildSunGrid(
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  trees: ExistingTree[],
  buildings: NearbyBuilding[],
  exclusionZones: ExclusionZone[],
  polygon?: GeoJSON.Polygon | null,
  globalOverride?: number | null,
): SunGrid {
  const widthFt = (bounds.maxLng - bounds.minLng) * M_PER_DEG_LNG / FT_TO_M;
  const heightFt = (bounds.maxLat - bounds.minLat) * M_PER_DEG_LAT / FT_TO_M;

  const cols = Math.max(1, Math.ceil(widthFt / CELL_SIZE_FT));
  const rows = Math.max(1, Math.ceil(heightFt / CELL_SIZE_FT));

  const cells: SunGridCell[] = [];
  const year = new Date().getFullYear();
  // Sample on summer solstice (representative growing season day)
  const sampleDate = new Date(Date.UTC(year, 5, 21));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centerLat = bounds.minLat + (r + 0.5) * ftToDegLat(CELL_SIZE_FT);
      const centerLng = bounds.minLng + (c + 0.5) * ftToDegLng(CELL_SIZE_FT);

      // Check if under any tree canopy
      const underCanopy = isUnderAnyCanopy(centerLat, centerLng, trees);

      // Check if in exclusion zone
      const inExclusion = isInAnyExclusion(centerLat, centerLng, exclusionZones);

      // Compute sun hours for this cell
      let sunHours: number;
      if (globalOverride != null && globalOverride > 0) {
        // User override — but still reduce for canopy
        sunHours = underCanopy ? Math.max(1, globalOverride * 0.4) : globalOverride;
      } else {
        sunHours = computeCellSunHours(sampleDate, centerLat, centerLng, trees, buildings, exclusionZones);
      }

      sunHours = Math.round(sunHours * 10) / 10;

      cells.push({
        row: r,
        col: c,
        centerLat,
        centerLng,
        sunHours,
        sunCategory: sunHoursToCategory(sunHours),
        underCanopy,
        inExclusion,
      });
    }
  }

  return {
    cellSizeFt: CELL_SIZE_FT,
    rows,
    cols,
    originLat: bounds.minLat,
    originLng: bounds.minLng,
    cells,
    globalOverride: globalOverride ?? null,
  };
}

/** Get the sun grid cell for a given lat/lng */
export function getCellAt(grid: SunGrid, lat: number, lng: number): SunGridCell | null {
  const r = Math.floor((lat - grid.originLat) / ftToDegLat(grid.cellSizeFt));
  const c = Math.floor((lng - grid.originLng) / ftToDegLng(grid.cellSizeFt));
  if (r < 0 || r >= grid.rows || c < 0 || c >= grid.cols) return null;
  return grid.cells[r * grid.cols + c] || null;
}

function isUnderAnyCanopy(lat: number, lng: number, trees: ExistingTree[]): boolean {
  for (const tree of trees) {
    const rLat = ftToDegLat(tree.canopyDiameterFt / 2);
    const rLng = ftToDegLng(tree.canopyDiameterFt / 2);
    const d = ((lat - tree.lat) / rLat) ** 2 + ((lng - tree.lng) / rLng) ** 2;
    if (d <= 1) return true;
  }
  return false;
}

function isInAnyExclusion(lat: number, lng: number, zones: ExclusionZone[]): boolean {
  // Simple bounding box check since we don't want to import turf here
  // The layout module handles precise polygon containment
  for (const zone of zones) {
    try {
      const coords = zone.geoJson.coordinates[0];
      const lats = coords.map(c => c[1]);
      const lngs = coords.map(c => c[0]);
      if (lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
          lng >= Math.min(...lngs) && lng <= Math.max(...lngs)) {
        return true;
      }
    } catch { /* skip malformed */ }
  }
  return false;
}

/**
 * Ray-segment intersection test (2D ground plane).
 * Returns distance along ray to intersection, or null if no hit.
 */
function rayIntersectsSegment(
  px: number, py: number,  // ray origin (cell position in meters)
  dx: number, dy: number,  // ray direction (toward sun)
  ax: number, ay: number,  // segment start
  bx: number, by: number,  // segment end
): number | null {
  const ex = bx - ax, ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((ax - px) * ey - (ay - py) * ex) / denom;
  const u = ((ax - px) * dy - (ay - py) * dx) / denom;
  if (t > 0 && u >= 0 && u <= 1) return t;
  return null;
}

/** Default building height for ExclusionZone buildings without explicit height */
const DEFAULT_BUILDING_HEIGHT_M = 8;

/**
 * Compute sun hours at a specific point for a sample day.
 * Factors in tree shadows, center-point building shadows, and polygon building shadows.
 */
function computeCellSunHours(
  date: Date,
  lat: number,
  lng: number,
  trees: ExistingTree[],
  buildings: NearbyBuilding[],
  exclusionZones: ExclusionZone[],
): number {
  let sunHours = 0;

  // Pre-extract shadow-casting polygons (buildings + fences) and convert
  // coords to meters. Fences default to 6 ft (1.83 m) and so cast a much
  // shorter shadow than buildings, but the rest of the ray-cast is identical.
  const FENCE_DEFAULT_M = 1.83; // 6 ft
  const shadowPolygons = exclusionZones
    .filter(z => z.type === 'building' || z.type === 'fence')
    .map(z => {
      const coords = z.geoJson.coordinates[0];
      const verticesM = coords.map(c => ({
        x: (c[0] - lng) * M_PER_DEG_LNG,
        y: (c[1] - lat) * M_PER_DEG_LAT,
      }));
      const heightM = z.heightMeters
        ?? (z.type === 'fence' ? FENCE_DEFAULT_M : DEFAULT_BUILDING_HEIGHT_M);
      return { verticesM, heightM };
    });

  // Sample every 30 min for accuracy
  for (let halfHour = 0; halfHour < 60; halfHour++) {
    const utcHour = halfHour / 2;
    const time = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
      Math.floor(utcHour), (utcHour % 1) * 60,
    ));
    const sunPos = SunCalc.getPosition(time, lat, lng);
    const altitudeDeg = sunPos.altitude * (180 / Math.PI);
    if (altitudeDeg <= 2) continue;

    const azimuthDeg = sunPos.azimuth * (180 / Math.PI) + 180;
    const altRad = altitudeDeg * Math.PI / 180;
    const shadowBearingRad = ((azimuthDeg + 180) % 360) * Math.PI / 180;
    const sdx = Math.sin(shadowBearingRad);
    const sdy = Math.cos(shadowBearingRad);
    const perpX = -sdy;
    const perpY = sdx;

    // Sun direction is opposite of shadow direction
    const sunDx = -sdx;
    const sunDy = -sdy;

    let inShadow = false;

    // Tree shadows
    for (const tree of trees) {
      const treeM = {
        x: (tree.lng - lng) * M_PER_DEG_LNG,
        y: (tree.lat - lat) * M_PER_DEG_LAT,
      };
      const treeHeightM = (tree.heightFt || tree.canopyDiameterFt * 1.5) * FT_TO_M;
      const shadowLenM = Math.min(treeHeightM / Math.tan(altRad), 200);
      const canopyRadiusM = tree.canopyDiameterFt / 2 * FT_TO_M;

      const dx = -treeM.x, dy = -treeM.y;
      const along = dx * sdx + dy * sdy;
      if (along < 0 || along > shadowLenM) continue;
      const across = Math.abs(dx * perpX + dy * perpY);
      // Use the actual canopy radius, not a 1.5× fuzz factor. The visual
      // shadow capsule in MapboxMap.tsx draws at exactly canopyRadius wide,
      // so agreeing on 1.0× keeps numeric and rendered shadows consistent —
      // cells that look sunlit in the animation aren't silently counted as
      // shaded by the sun-hours calc.
      if (across < canopyRadiusM) {
        inShadow = true; break;
      }
    }

    if (inShadow) continue;

    // Building shadows (center-point rectangular model from Overpass API)
    for (const building of buildings) {
      const bldgM = {
        x: (building.lng - lng) * M_PER_DEG_LNG,
        y: (building.lat - lat) * M_PER_DEG_LAT,
      };
      const shadowLenM = Math.min(building.heightMeters / Math.tan(altRad), 300);
      const halfWidthM = (building.widthMeters || 15) / 2;

      const dx = -bldgM.x, dy = -bldgM.y;
      const along = dx * sdx + dy * sdy;
      if (along < -halfWidthM || along > shadowLenM) continue;
      const across = Math.abs(dx * perpX + dy * perpY);
      if (across < halfWidthM) {
        inShadow = true; break;
      }
    }

    if (inShadow) continue;

    // Building + fence polygon shadows (drawn by user or auto-detected via
    // Mapbox). Cast a ray from the cell toward the sun. If it hits a polygon
    // edge within shadow range (height/tan(alt)), the obstacle is between us
    // and the sun = we're in shadow.
    for (const bldg of shadowPolygons) {
      const shadowLenM = Math.min(bldg.heightM / Math.tan(altRad), 300);
      const verts = bldg.verticesM;
      for (let i = 0; i < verts.length - 1; i++) {
        const hitDist = rayIntersectsSegment(
          0, 0,                    // cell is at origin (vertices already relative)
          sunDx, sunDy,            // ray toward sun
          verts[i].x, verts[i].y,  // edge start
          verts[i + 1].x, verts[i + 1].y, // edge end
        );
        if (hitDist !== null && hitDist <= shadowLenM) {
          inShadow = true;
          break;
        }
      }
      if (inShadow) break;
    }

    if (!inShadow) sunHours += 0.5;
  }

  return sunHours;
}
