import type { Plant, PlantType } from '@/types/plant';
import type { PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';
import * as turf from '@turf/turf';

// Conversion constants at Chicago latitude (~41.88N)
const METERS_PER_DEG_LAT = 111320;
const METERS_PER_DEG_LNG = 111320 * Math.cos(41.88 * Math.PI / 180);
const INCHES_PER_METER = 39.37;

function inchesToDegLat(inches: number): number {
  return inches / (METERS_PER_DEG_LAT * INCHES_PER_METER);
}
function inchesToDegLng(inches: number): number {
  return inches / (METERS_PER_DEG_LNG * INCHES_PER_METER);
}

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

export function polygonToBounds(polygon: GeoJSON.Polygon | null, center?: [number, number]) {
  if (polygon?.coordinates?.[0] && polygon.coordinates[0].length > 2) {
    const coords = polygon.coordinates[0];
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }
  // Default: ~20x20 ft
  const lat = center?.[0] || 41.88;
  const lng = center?.[1] || -87.63;
  const offset = 10 * 12; // 10 ft in inches
  return {
    minLat: lat - inchesToDegLat(offset),
    maxLat: lat + inchesToDegLat(offset),
    minLng: lng - inchesToDegLng(offset),
    maxLng: lng + inchesToDegLng(offset),
  };
}

function getClumpSize(type: PlantType, aesthetic: string, smallArea: boolean): number {
  if (smallArea) {
    const base: Record<string, [number, number]> = {
      tree: [1, 1], shrub: [1, 2], vine: [1, 1], fern: [2, 4],
      forb: [2, 4], grass: [3, 5], sedge: [3, 5],
    };
    const [min, max] = base[type] || [1, 3];
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  const base: Record<string, [number, number]> = {
    tree: [1, 1], shrub: [1, 3], vine: [1, 2], fern: [3, 7],
    forb: [3, 7], grass: [5, 9], sedge: [5, 9],
  };
  const [min, max] = base[type] || [2, 5];
  const mult = aesthetic === 'wild' ? 1.3 : aesthetic === 'structured' ? 0.7 : 1.0;
  return Math.round(min + Math.random() * (max - min) * mult);
}

function isInsidePolygon(lat: number, lng: number, polygon: GeoJSON.Polygon): boolean {
  try {
    return turf.booleanPointInPolygon(turf.point([lng, lat]), turf.polygon(polygon.coordinates));
  } catch { return true; }
}

function isInExclusionZone(lat: number, lng: number, zones: ExclusionZone[]): boolean {
  return zones.some(z => isInsidePolygon(lat, lng, z.geoJson));
}

function getTreeShade(lat: number, lng: number, trees: ExistingTree[]): boolean {
  for (const tree of trees) {
    const radiusLat = inchesToDegLat(tree.canopyDiameterFt * 6); // ft to inches radius
    const radiusLng = inchesToDegLng(tree.canopyDiameterFt * 6);
    const dLat = (lat - tree.lat) / radiusLat;
    const dLng = (lng - tree.lng) / radiusLng;
    if (dLat * dLat + dLng * dLng <= 1) return true;
  }
  return false;
}

/** Circular distance collision check — much more accurate than axis-aligned */
function hasCollision(
  lat: number, lng: number, spreadInches: number,
  placed: { lat: number; lng: number; spreadInches: number }[],
  overlapFactor: number,
): boolean {
  const myRadiusLat = inchesToDegLat(spreadInches / 2);
  const myRadiusLng = inchesToDegLng(spreadInches / 2);

  for (const p of placed) {
    const otherRadiusLat = inchesToDegLat(p.spreadInches / 2);
    const otherRadiusLng = inchesToDegLng(p.spreadInches / 2);

    // Circular distance using normalized coordinates
    const dLat = (lat - p.lat) / (myRadiusLat + otherRadiusLat);
    const dLng = (lng - p.lng) / (myRadiusLng + otherRadiusLng);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);

    if (dist < overlapFactor) return true;
  }
  return false;
}

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

  const smallArea = config.areaSqFt < 400;
  const result: PlanPlant[] = [];
  const placedPositions: { lat: number; lng: number; spreadInches: number }[] = [];

  // Sort: trees → shrubs → forbs → grasses (large footprint first)
  const typeOrder: Record<string, number> = { tree: 0, shrub: 1, vine: 2, fern: 3, forb: 4, grass: 5, sedge: 6 };
  const sorted = [...plants].sort((a, b) => {
    const ta = typeOrder[a.plantType] ?? 4;
    const tb = typeOrder[b.plantType] ?? 4;
    if (ta !== tb) return ta - tb;
    return b.spreadMaxInches - a.spreadMaxInches;
  });

  // Assign species indices
  const speciesIndexMap = new Map<string, number>();
  sorted.forEach(p => { if (!speciesIndexMap.has(p.slug)) speciesIndexMap.set(p.slug, speciesIndexMap.size + 1); });

  // Max spread relative to area
  const areaWidthInches = Math.sqrt(config.areaSqFt) * 12;
  const maxSpread = areaWidthInches * 0.5;

  for (const plant of sorted) {
    const clumpSize = getClumpSize(plant.plantType, aesthetic, smallArea);
    const rawSpread = (plant.spreadMinInches + plant.spreadMaxInches) / 2;
    const spread = Math.min(rawSpread, maxSpread);

    // Overlap tolerance: grasses/groundcovers can overlap more
    const overlapFactor = (plant.plantType === 'grass' || plant.plantType === 'sedge' || plant.plantType === 'fern')
      ? 0.5 : 0.65;

    const heightBias = Math.min(plant.heightMaxInches / 120, 1);
    const targetLatCenter = bounds.minLat + latRange * (0.2 + heightBias * 0.6);

    let clumpSeedLat = 0, clumpSeedLng = 0;

    for (let c = 0; c < clumpSize; c++) {
      let placed = false;
      const maxAttempts = c === 0 ? 60 : 30;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let lat: number, lng: number;

        if (c === 0) {
          // Seed point
          const bandSpread = latRange * 0.4;
          lat = targetLatCenter + (Math.random() - 0.5) * bandSpread;
          lng = bounds.minLng + (0.05 + Math.random() * 0.9) * lngRange;
        } else {
          // Clump member — tight offset from seed
          const angle = (Math.PI * 2 * c) / clumpSize + (Math.random() - 0.5) * 0.8;
          const dist = spread * (0.8 + Math.random() * 0.4);
          lat = clumpSeedLat + Math.sin(angle) * inchesToDegLat(dist);
          lng = clumpSeedLng + Math.cos(angle) * inchesToDegLng(dist);
        }

        // Clamp to bounds with margin
        const margin = 0.02;
        lat = bounds.minLat + latRange * margin + (lat - bounds.minLat) % (latRange * (1 - 2 * margin));
        lat = Math.max(bounds.minLat, Math.min(bounds.maxLat, lat));
        lng = Math.max(bounds.minLng, Math.min(bounds.maxLng, lng));

        // Validation
        if (polygon && !isInsidePolygon(lat, lng, polygon)) continue;
        if (isInExclusionZone(lat, lng, exclusionZones)) continue;

        // Relaxed collision on later attempts
        const relaxed = attempt > maxAttempts * 0.7;
        const factor = relaxed ? overlapFactor * 0.5 : overlapFactor;
        if (hasCollision(lat, lng, spread, placedPositions, factor)) continue;

        // Tree shade: if under canopy, plant must tolerate shade
        if (getTreeShade(lat, lng, existingTrees)) {
          const ok = plant.sun.some(s => s === 'part_shade' || s === 'full_shade');
          if (!ok) continue;
        }

        placedPositions.push({ lat, lng, spreadInches: spread });
        result.push({
          plantSlug: plant.slug,
          commonName: plant.commonName,
          scientificName: plant.scientificName,
          gridX: 0, gridY: 0,
          quantity: 1,
          bloomColor: plant.bloomColor,
          heightMaxInches: plant.heightMaxInches,
          notes: '',
          lat, lng,
          imageUrl: plant.imageUrl || '',
          spreadInches: spread,
          speciesIndex: speciesIndexMap.get(plant.slug) || 0,
          plantType: plant.plantType,
        });

        placed = true;
        if (c === 0) { clumpSeedLat = lat; clumpSeedLng = lng; }
        break;
      }

      // If seed can't place, try one random position (don't skip species entirely)
      if (!placed && c === 0) {
        const lat = bounds.minLat + Math.random() * latRange;
        const lng = bounds.minLng + Math.random() * lngRange;
        if (!polygon || isInsidePolygon(lat, lng, polygon)) {
          if (!isInExclusionZone(lat, lng, exclusionZones)) {
            placedPositions.push({ lat, lng, spreadInches: spread });
            result.push({
              plantSlug: plant.slug, commonName: plant.commonName,
              scientificName: plant.scientificName,
              gridX: 0, gridY: 0, quantity: 1,
              bloomColor: plant.bloomColor, heightMaxInches: plant.heightMaxInches,
              notes: '', lat, lng,
              imageUrl: plant.imageUrl || '',
              spreadInches: spread,
              speciesIndex: speciesIndexMap.get(plant.slug) || 0,
              plantType: plant.plantType,
            });
            clumpSeedLat = lat; clumpSeedLng = lng;
          }
        }
        // Still continue with remaining clump members
      }
    }
  }

  return result;
}
