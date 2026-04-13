import type { Plant, PlantType } from '@/types/plant';
import type { PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';
import * as turf from '@turf/turf';

// Convert inches to approximate degrees at Chicago latitude (~41.88N)
const INCHES_TO_DEG_LAT = 1 / (111320 * 39.37); // ~0.000000228
const INCHES_TO_DEG_LNG = 1 / (111320 * Math.cos(41.88 * Math.PI / 180) * 39.37);

interface LayoutConfig {
  areaSqFt: number;
  gridCols: number;
  gridRows: number;
}

export function calculateGridSize(areaSqFt: number): LayoutConfig {
  const cellSizeFt = 2;
  const totalCells = Math.floor(areaSqFt / (cellSizeFt * cellSizeFt));
  const cols = Math.max(3, Math.ceil(Math.sqrt(totalCells * 1.5)));
  const rows = Math.max(3, Math.ceil(totalCells / cols));
  return { areaSqFt, gridCols: Math.min(cols, 20), gridRows: Math.min(rows, 15) };
}

export function polygonToBounds(polygon: GeoJSON.Polygon | null, center?: [number, number]): {
  minLat: number; maxLat: number; minLng: number; maxLng: number;
} {
  if (polygon?.coordinates?.[0] && polygon.coordinates[0].length > 2) {
    const coords = polygon.coordinates[0];
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }
  const lat = center?.[0] || 41.88;
  const lng = center?.[1] || -87.63;
  return { minLat: lat - 0.00015, maxLat: lat + 0.00015, minLng: lng - 0.0002, maxLng: lng + 0.0002 };
}

/** Clump sizes by plant type */
function getClumpSize(type: PlantType, aesthetic: string): number {
  const base: Record<string, [number, number]> = {
    tree: [1, 1],
    shrub: [1, 3],
    vine: [1, 2],
    fern: [3, 7],
    forb: [3, 7],
    grass: [5, 9],
    sedge: [5, 9],
  };
  const [min, max] = base[type] || [2, 5];
  // Wilder aesthetics use bigger clumps
  const mult = aesthetic === 'wild' ? 1.3 : aesthetic === 'structured' ? 0.7 : 1.0;
  return Math.round(min + Math.random() * (max - min) * mult);
}

/** Check if a point is inside a GeoJSON polygon using Turf */
function isInsidePolygon(lat: number, lng: number, polygon: GeoJSON.Polygon): boolean {
  try {
    const pt = turf.point([lng, lat]);
    const poly = turf.polygon(polygon.coordinates);
    return turf.booleanPointInPolygon(pt, poly);
  } catch {
    return true; // Fallback: allow placement
  }
}

/** Check if point is inside any exclusion zone */
function isInExclusionZone(lat: number, lng: number, zones: ExclusionZone[]): boolean {
  return zones.some(z => isInsidePolygon(lat, lng, z.geoJson));
}

/** Check if point is under an existing tree canopy */
function getTreeShade(lat: number, lng: number, trees: ExistingTree[]): ExistingTree | null {
  for (const tree of trees) {
    const radiusDegLat = (tree.canopyDiameterFt / 2) * 12 * INCHES_TO_DEG_LAT;
    const radiusDegLng = (tree.canopyDiameterFt / 2) * 12 * INCHES_TO_DEG_LNG;
    const dLat = Math.abs(lat - tree.lat) / radiusDegLat;
    const dLng = Math.abs(lng - tree.lng) / radiusDegLng;
    if (dLat * dLat + dLng * dLng <= 1) return tree;
  }
  return null;
}

/** Check collision with already-placed plants */
function hasCollision(
  lat: number, lng: number, spreadInches: number,
  placed: { lat: number; lng: number; spreadInches: number }[]
): boolean {
  const myRadiusLat = (spreadInches / 2) * INCHES_TO_DEG_LAT;
  const myRadiusLng = (spreadInches / 2) * INCHES_TO_DEG_LNG;

  for (const p of placed) {
    const otherRadiusLat = (p.spreadInches / 2) * INCHES_TO_DEG_LAT;
    const otherRadiusLng = (p.spreadInches / 2) * INCHES_TO_DEG_LNG;
    const minDistLat = (myRadiusLat + otherRadiusLat) * 0.85; // Allow 15% overlap for natural look
    const minDistLng = (myRadiusLng + otherRadiusLng) * 0.85;
    const dLat = Math.abs(lat - p.lat);
    const dLng = Math.abs(lng - p.lng);
    if (dLat < minDistLat && dLng < minDistLng) return true;
  }
  return false;
}

/**
 * V2 layout: spacing-aware placement with exclusion zones and tree shade.
 * Plants are sized to their actual spread, placed without overlap,
 * grouped in natural-looking clumps.
 */
export function layoutPlants(
  plants: Plant[],
  config: LayoutConfig,
  polygon?: GeoJSON.Polygon | null,
  centerCoords?: [number, number],
  exclusionZones: ExclusionZone[] = [],
  existingTrees: ExistingTree[] = [],
  aesthetic: string = 'mixed',
): PlanPlant[] {
  const bounds = polygonToBounds(polygon || null, centerCoords);
  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;
  if (latRange === 0 || lngRange === 0) return [];

  const result: PlanPlant[] = [];
  const placedPositions: { lat: number; lng: number; spreadInches: number }[] = [];

  // Sort: trees first, then shrubs, then by spread descending
  const typeOrder: Record<string, number> = { tree: 0, shrub: 1, vine: 2, fern: 3, forb: 4, grass: 5, sedge: 6 };
  const sorted = [...plants].sort((a, b) => {
    const ta = typeOrder[a.plantType] ?? 4;
    const tb = typeOrder[b.plantType] ?? 4;
    if (ta !== tb) return ta - tb;
    return b.spreadMaxInches - a.spreadMaxInches;
  });

  // Assign species indices
  const speciesIndexMap = new Map<string, number>();
  sorted.forEach((p, i) => { if (!speciesIndexMap.has(p.slug)) speciesIndexMap.set(p.slug, speciesIndexMap.size + 1); });

  // Place all selected species — each gets at least 1 clump
  for (const plant of sorted) {
    const clumpSize = getClumpSize(plant.plantType, aesthetic);
    // Cap spread to something reasonable for the area — trees especially
    const rawSpread = (plant.spreadMinInches + plant.spreadMaxInches) / 2;
    const maxSpreadForArea = Math.sqrt(config.areaSqFt * 144) * 0.4; // Max 40% of area width
    const spread = Math.min(rawSpread, maxSpreadForArea);

    // Height bias: 0 = south edge, 1 = north edge
    const heightBias = Math.min(plant.heightMaxInches / 120, 1);
    const targetLatCenter = bounds.minLat + latRange * (0.2 + heightBias * 0.6);

    let placedInClump = 0;
    let clumpSeedLat = 0;
    let clumpSeedLng = 0;

    for (let c = 0; c < clumpSize; c++) {
      let placed = false;

      for (let attempt = 0; attempt < 40; attempt++) {
        let lat: number, lng: number;

        if (c === 0) {
          // Seed point: random within height band
          const bandSpread = latRange * 0.35;
          lat = targetLatCenter + (Math.random() - 0.5) * bandSpread;
          lng = bounds.minLng + (0.05 + Math.random() * 0.9) * lngRange;
        } else {
          // Clump member: offset from seed
          const angle = (Math.PI * 2 * c) / clumpSize + (Math.random() - 0.5) * 0.5;
          const dist = spread * (1.0 + Math.random() * 0.3);
          lat = clumpSeedLat + Math.sin(angle) * dist * INCHES_TO_DEG_LAT;
          lng = clumpSeedLng + Math.cos(angle) * dist * INCHES_TO_DEG_LNG;
        }

        // Clamp to bounds
        lat = Math.max(bounds.minLat + spread * INCHES_TO_DEG_LAT, Math.min(bounds.maxLat - spread * INCHES_TO_DEG_LAT, lat));
        lng = Math.max(bounds.minLng + spread * INCHES_TO_DEG_LNG, Math.min(bounds.maxLng - spread * INCHES_TO_DEG_LNG, lng));

        // Validation checks
        if (polygon && !isInsidePolygon(lat, lng, polygon)) continue;
        if (isInExclusionZone(lat, lng, exclusionZones)) continue;
        if (hasCollision(lat, lng, spread, placedPositions)) continue;

        // Tree shade check: if under a tree canopy, plant must tolerate shade
        const shadeTree = getTreeShade(lat, lng, existingTrees);
        if (shadeTree) {
          const toleratesShade = plant.sun.some(s => s === 'part_shade' || s === 'full_shade');
          if (!toleratesShade) continue;
        }

        // Place it
        placedPositions.push({ lat, lng, spreadInches: spread });
        result.push({
          plantSlug: plant.slug,
          commonName: plant.commonName,
          scientificName: plant.scientificName,
          gridX: 0,
          gridY: 0,
          quantity: 1,
          bloomColor: plant.bloomColor,
          heightMaxInches: plant.heightMaxInches,
          notes: '',
          lat,
          lng,
          imageUrl: plant.imageUrl || '',
          spreadInches: spread,
          speciesIndex: speciesIndexMap.get(plant.slug) || 0,
          plantType: plant.plantType,
          groupId: `${plant.slug}-${Math.floor(placedInClump / clumpSize)}`,
        });

        placedInClump++;
        placed = true;

        if (c === 0) {
          clumpSeedLat = lat;
          clumpSeedLng = lng;
        }
        break;
      }

      if (!placed && c === 0) break; // Can't place seed, skip this species entirely
    }
  }

  return result;
}
