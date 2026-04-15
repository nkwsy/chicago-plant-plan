import type { Plant, PlantType, SunRequirement } from '@/types/plant';
import type { PlanPlant, ExclusionZone, ExistingTree, SunGrid } from '@/types/plan';
import { getCellAt } from '@/lib/analysis/sun-grid';
import * as turf from '@turf/turf';

// Conversion at Chicago latitude (~41.88N)
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos(41.88 * Math.PI / 180);
const FT_TO_M = 0.3048;

function ftToDegLat(ft: number): number { return ft * FT_TO_M / M_PER_DEG_LAT; }
function ftToDegLng(ft: number): number { return ft * FT_TO_M / M_PER_DEG_LNG; }

interface LayoutConfig { areaSqFt: number; gridCols: number; gridRows: number; }

export function calculateGridSize(areaSqFt: number): LayoutConfig {
  const cols = Math.max(3, Math.ceil(Math.sqrt(areaSqFt) * 1.2));
  const rows = Math.max(3, Math.ceil(areaSqFt / cols));
  return { areaSqFt, gridCols: Math.min(cols, 30), gridRows: Math.min(rows, 25) };
}

export function polygonToBounds(polygon: GeoJSON.Polygon | null, center?: [number, number]) {
  if (polygon?.coordinates?.[0] && polygon.coordinates[0].length > 2) {
    const coords = polygon.coordinates[0];
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  }
  const lat = center?.[0] || 41.88;
  const lng = center?.[1] || -87.63;
  const offset = ftToDegLat(10); // 10ft each direction = 20ft total
  const offsetLng = ftToDegLng(10);
  return { minLat: lat - offset, maxLat: lat + offset, minLng: lng - offsetLng, maxLng: lng + offsetLng };
}

function isInsidePolygon(lat: number, lng: number, polygon: GeoJSON.Polygon): boolean {
  try { return turf.booleanPointInPolygon(turf.point([lng, lat]), turf.polygon(polygon.coordinates)); }
  catch { return true; }
}

function isInExclusionZone(lat: number, lng: number, zones: ExclusionZone[]): boolean {
  return zones.some(z => isInsidePolygon(lat, lng, z.geoJson));
}

function isUnderTreeCanopy(lat: number, lng: number, trees: ExistingTree[]): boolean {
  for (const tree of trees) {
    const rLat = ftToDegLat(tree.canopyDiameterFt / 2);
    const rLng = ftToDegLng(tree.canopyDiameterFt / 2);
    const d = ((lat - tree.lat) / rLat) ** 2 + ((lng - tree.lng) / rLng) ** 2;
    if (d <= 1) return true;
  }
  return false;
}

/** Check if a plant is sun-compatible with a specific grid cell */
function isPlantSunCompatible(plant: Plant, lat: number, lng: number, grid?: SunGrid | null): boolean {
  if (!grid) return true; // No grid = skip check (use global filter)
  const cell = getCellAt(grid, lat, lng);
  if (!cell) return true;

  const sunOrder: SunRequirement[] = ['full_sun', 'part_sun', 'part_shade', 'full_shade'];
  const cellIdx = sunOrder.indexOf(cell.sunCategory);

  return plant.sun.some(ps => {
    const plantIdx = sunOrder.indexOf(ps);
    return Math.abs(plantIdx - cellIdx) <= 1; // Allow adjacent tolerance
  });
}

/** Pick the best species for a location from a list, considering local sun */
function pickSpeciesForLocation(
  candidates: Plant[], lat: number, lng: number, grid?: SunGrid | null,
): Plant | null {
  if (!grid) return candidates[Math.floor(Math.random() * candidates.length)];

  const cell = getCellAt(grid, lat, lng);
  if (!cell) return candidates[Math.floor(Math.random() * candidates.length)];

  // Score candidates by sun match
  const sunOrder: SunRequirement[] = ['full_sun', 'part_sun', 'part_shade', 'full_shade'];
  const cellIdx = sunOrder.indexOf(cell.sunCategory);

  const compatible = candidates.filter(p => isPlantSunCompatible(p, lat, lng, grid));
  if (compatible.length === 0) return candidates[Math.floor(Math.random() * candidates.length)];

  // Prefer exact matches, then adjacent
  const exact = compatible.filter(p => p.sun.includes(cell.sunCategory));
  if (exact.length > 0) return exact[Math.floor(Math.random() * exact.length)];
  return compatible[Math.floor(Math.random() * compatible.length)];
}

/** Professional spacing in feet on-center by plant type */
function getSpacingFt(type: PlantType, densityMultiplier: number): number {
  // Professional standards: trees 14ft, shrubs 6ft, herbaceous 1.5ft
  const base: Record<string, number> = {
    tree: 14, shrub: 6, vine: 4, fern: 1.5, forb: 1.5, grass: 1.5, sedge: 1.5,
  };
  return (base[type] || 1.5) / densityMultiplier;
}

/** Categorize species for zone-fill: structure, matrix, or accent */
function getPlantRole(type: PlantType): 'structure' | 'matrix' | 'accent' {
  if (type === 'tree' || type === 'shrub') return 'structure';
  if (type === 'grass' || type === 'sedge') return 'matrix';
  return 'accent'; // forbs, ferns, vines
}

/**
 * Professional zone-fill layout algorithm.
 *
 * Based on restoration ecology practices:
 * 1. Place STRUCTURE plants (trees, shrubs) first at wide spacing
 * 2. Fill MATRIX with grasses/sedges at 18" on-center (continuous groundcover)
 * 3. Insert ACCENT forbs in natural drift patterns (odd groups of 3-7)
 *
 * Default density: ~1 plant per sqft for herbaceous, adjustable via densityMultiplier
 */
export function layoutPlants(
  plants: Plant[],
  config: LayoutConfig,
  polygon?: GeoJSON.Polygon | null,
  centerCoords?: [number, number],
  exclusionZones: ExclusionZone[] = [],
  existingTrees: ExistingTree[] = [],
  aesthetic: string = 'mixed',
  densityMultiplier: number = 1.0,
  sunGrid?: SunGrid | null,
): PlanPlant[] {
  const bounds = polygonToBounds(polygon || null, centerCoords);
  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;
  if (latRange === 0 || lngRange === 0) return [];

  const result: PlanPlant[] = [];

  // Assign species indices and categorize
  const speciesIndexMap = new Map<string, number>();
  let idx = 1;
  plants.forEach(p => { if (!speciesIndexMap.has(p.slug)) speciesIndexMap.set(p.slug, idx++); });

  const structure = plants.filter(p => getPlantRole(p.plantType) === 'structure');
  const matrix = plants.filter(p => getPlantRole(p.plantType) === 'matrix');
  const accent = plants.filter(p => getPlantRole(p.plantType) === 'accent');

  // Track occupied cells (1ft grid for collision)
  const gridResolutionFt = 1;
  const gridW = Math.ceil(lngRange / ftToDegLng(gridResolutionFt));
  const gridH = Math.ceil(latRange / ftToDegLat(gridResolutionFt));
  const occupied = new Set<string>();

  function gridKey(lat: number, lng: number): string {
    const gx = Math.round((lng - bounds.minLng) / ftToDegLng(gridResolutionFt));
    const gy = Math.round((lat - bounds.minLat) / ftToDegLat(gridResolutionFt));
    return `${gx},${gy}`;
  }

  function isOccupied(lat: number, lng: number, radiusFt: number): boolean {
    const cx = Math.round((lng - bounds.minLng) / ftToDegLng(gridResolutionFt));
    const cy = Math.round((lat - bounds.minLat) / ftToDegLat(gridResolutionFt));
    const r = Math.ceil(radiusFt / gridResolutionFt);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy <= r * r && occupied.has(`${cx + dx},${cy + dy}`)) return true;
      }
    }
    return false;
  }

  function markOccupied(lat: number, lng: number, radiusFt: number) {
    const cx = Math.round((lng - bounds.minLng) / ftToDegLng(gridResolutionFt));
    const cy = Math.round((lat - bounds.minLat) / ftToDegLat(gridResolutionFt));
    const r = Math.ceil(radiusFt / gridResolutionFt);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy <= r * r) occupied.add(`${cx + dx},${cy + dy}`);
      }
    }
  }

  function isValid(lat: number, lng: number): boolean {
    if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) return false;
    if (polygon && !isInsidePolygon(lat, lng, polygon)) return false;
    if (isInExclusionZone(lat, lng, exclusionZones)) return false;
    return true;
  }

  function placePlant(plant: Plant, lat: number, lng: number): PlanPlant {
    const spread = (plant.spreadMinInches + plant.spreadMaxInches) / 2;
    return {
      plantSlug: plant.slug,
      commonName: plant.commonName,
      scientificName: plant.scientificName,
      gridX: 0, gridY: 0, quantity: 1,
      bloomColor: plant.bloomColor,
      heightMaxInches: plant.heightMaxInches,
      notes: '', lat, lng,
      imageUrl: plant.imageUrl || '',
      spreadInches: Math.min(spread, 120), // Cap display at 10ft
      speciesIndex: speciesIndexMap.get(plant.slug) || 0,
      plantType: plant.plantType,
    };
  }

  // === PHASE 1: Place structure plants (trees, shrubs) ===
  for (const plant of structure) {
    const spacingFt = getSpacingFt(plant.plantType, densityMultiplier);
    const spacingLat = ftToDegLat(spacingFt);
    const spacingLng = ftToDegLng(spacingFt);
    const radiusFt = spacingFt / 2;

    // Try to place one instance with random jitter
    for (let attempt = 0; attempt < 30; attempt++) {
      const lat = bounds.minLat + latRange * (0.2 + Math.random() * 0.6);
      const lng = bounds.minLng + lngRange * (0.15 + Math.random() * 0.7);
      if (!isValid(lat, lng)) continue;
      if (isOccupied(lat, lng, radiusFt)) continue;

      // Check shade compatibility via sun grid or tree canopy
      if (!isPlantSunCompatible(plant, lat, lng, sunGrid)) continue;
      if (!sunGrid && isUnderTreeCanopy(lat, lng, existingTrees)) {
        if (!plant.sun.some(s => s === 'part_shade' || s === 'full_shade')) continue;
      }

      markOccupied(lat, lng, radiusFt);
      result.push(placePlant(plant, lat, lng));
      break;
    }
  }

  // === PHASE 2: Fill matrix (grasses/sedges) at professional density ===
  if (matrix.length > 0) {
    const spacingFt = getSpacingFt('grass', densityMultiplier);
    const stepLat = ftToDegLat(spacingFt);
    const stepLng = ftToDegLng(spacingFt);

    // Systematic grid fill with slight jitter for natural look
    for (let lat = bounds.minLat + stepLat; lat < bounds.maxLat - stepLat / 2; lat += stepLat) {
      for (let lng = bounds.minLng + stepLng; lng < bounds.maxLng - stepLng / 2; lng += stepLng) {
        // Add natural jitter (±30% of spacing)
        const jLat = lat + (Math.random() - 0.5) * stepLat * 0.6;
        const jLng = lng + (Math.random() - 0.5) * stepLng * 0.6;

        if (!isValid(jLat, jLng)) continue;
        if (isOccupied(jLat, jLng, spacingFt * 0.4)) continue;

        // Pick best matrix species for this location's sun conditions
        const species = pickSpeciesForLocation(matrix, jLat, jLng, sunGrid);
        if (!species) continue;

        // Fallback shade check when no sun grid
        if (!sunGrid && isUnderTreeCanopy(jLat, jLng, existingTrees)) {
          if (!species.sun.some(s => s === 'part_shade' || s === 'full_shade')) continue;
        }

        markOccupied(jLat, jLng, spacingFt * 0.4);
        result.push(placePlant(species, jLat, jLng));
      }
    }
  }

  // === PHASE 3: Insert accent forbs in drift patterns ===
  if (accent.length > 0) {
    const spacingFt = getSpacingFt('forb', densityMultiplier);
    const driftSizes = [3, 5, 7]; // Professional: odd-numbered groups

    for (const species of accent) {
      const driftSize = driftSizes[Math.floor(Math.random() * driftSizes.length)];
      let placed = 0;

      // Pick a seed location
      for (let seedAttempt = 0; seedAttempt < 20 && placed === 0; seedAttempt++) {
        const seedLat = bounds.minLat + latRange * (0.1 + Math.random() * 0.8);
        const seedLng = bounds.minLng + lngRange * (0.1 + Math.random() * 0.8);
        if (!isValid(seedLat, seedLng)) continue;

        // Sun compatibility check
        if (!isPlantSunCompatible(species, seedLat, seedLng, sunGrid)) continue;
        if (!sunGrid) {
          const underCanopy = isUnderTreeCanopy(seedLat, seedLng, existingTrees);
          if (underCanopy && !species.sun.some(s => s === 'part_shade' || s === 'full_shade')) continue;
        }

        // Place the drift
        for (let d = 0; d < driftSize; d++) {
          const angle = (Math.PI * 2 * d) / driftSize + (Math.random() - 0.5) * 1.2;
          const dist = spacingFt * (0.8 + Math.random() * 0.8);
          const pLat = seedLat + Math.sin(angle) * ftToDegLat(dist);
          const pLng = seedLng + Math.cos(angle) * ftToDegLng(dist);

          if (!isValid(pLat, pLng)) continue;

          // For accents, we replace matrix plants — don't check occupation strictly
          result.push(placePlant(species, pLat, pLng));
          placed++;
        }
      }
    }
  }

  return result;
}
