import type { Plant } from '@/types/plant';
import type { PlanPlant } from '@/types/plan';

interface LayoutConfig {
  areaSqFt: number;
  gridCols: number;
  gridRows: number;
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export function calculateGridSize(areaSqFt: number): LayoutConfig {
  const cellSizeFt = 2;
  const totalCells = Math.floor(areaSqFt / (cellSizeFt * cellSizeFt));
  const cols = Math.max(3, Math.ceil(Math.sqrt(totalCells * 1.5)));
  const rows = Math.max(3, Math.ceil(totalCells / cols));
  return { areaSqFt, gridCols: Math.min(cols, 20), gridRows: Math.min(rows, 15) };
}

/**
 * Convert a GeoJSON polygon to lat/lng bounds
 */
export function polygonToBounds(polygon: GeoJSON.Polygon | null, center?: [number, number]): {
  minLat: number; maxLat: number; minLng: number; maxLng: number;
} {
  if (polygon?.coordinates?.[0] && polygon.coordinates[0].length > 2) {
    const coords = polygon.coordinates[0];
    const lats = coords.map(c => c[1]);
    const lngs = coords.map(c => c[0]);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };
  }

  // Default: ~60x60 ft area from center (typical yard)
  const lat = center?.[0] || 41.88;
  const lng = center?.[1] || -87.63;
  const offsetLat = 0.00015; // ~50 ft
  const offsetLng = 0.0002;
  return {
    minLat: lat - offsetLat,
    maxLat: lat + offsetLat,
    minLng: lng - offsetLng,
    maxLng: lng + offsetLng,
  };
}

/**
 * Check if a point is inside a polygon using ray casting
 */
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = [polygon[i][0], polygon[i][1]];
    const [xj, yj] = [polygon[j][0], polygon[j][1]];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Layout plants as geo-positioned dots within a polygon/bounding box.
 * Each plant gets a lat/lng coordinate for satellite overlay display.
 * Uses natural-looking clustered scattering.
 */
export function layoutPlants(
  plants: Plant[],
  config: LayoutConfig,
  polygon?: GeoJSON.Polygon | null,
  centerCoords?: [number, number],
): PlanPlant[] {
  const bounds = config.bounds || polygonToBounds(polygon || null, centerCoords);
  const { gridCols, gridRows } = config;
  const totalCells = gridCols * gridRows;
  const result: PlanPlant[] = [];

  const sorted = [...plants].sort((a, b) => b.heightMaxInches - a.heightMaxInches);
  const targetFill = Math.floor(totalCells * 0.7);

  // Polygon coords for point-in-polygon test (lng, lat format)
  const polyCoords = polygon?.coordinates?.[0];

  const latRange = bounds.maxLat - bounds.minLat;
  const lngRange = bounds.maxLng - bounds.minLng;

  const placed: Set<string> = new Set();
  let plantIdx = 0;
  let attempts = 0;

  for (let i = 0; i < targetFill && plantIdx < sorted.length && attempts < targetFill * 3; ) {
    const plant = sorted[plantIdx % sorted.length];

    // Taller plants toward the north (higher lat)
    const heightBias = plant.heightMaxInches / 96;
    const targetLatMin = bounds.minLat + latRange * (0.5 + heightBias * 0.3);
    const targetLatMax = Math.min(bounds.maxLat, targetLatMin + latRange * 0.4);

    // Clump 1-3 of the same plant together
    const clumpSize = plant.plantType === 'grass' || plant.plantType === 'sedge'
      ? Math.min(3, Math.ceil(Math.random() * 3))
      : Math.min(2, Math.ceil(Math.random() * 2));

    const baseLat = targetLatMin + Math.random() * (targetLatMax - targetLatMin);
    const baseLng = bounds.minLng + Math.random() * lngRange;

    let placedInClump = 0;

    for (let c = 0; c < clumpSize && i < targetFill; c++) {
      // Add small jitter for clumping
      const jitterLat = (Math.random() - 0.5) * latRange * 0.08;
      const jitterLng = (Math.random() - 0.5) * lngRange * 0.08;
      const lat = Math.max(bounds.minLat, Math.min(bounds.maxLat, baseLat + jitterLat));
      const lng = Math.max(bounds.minLng, Math.min(bounds.maxLng, baseLng + jitterLng));

      // Check polygon containment if available
      if (polyCoords && !pointInPolygon(lng, lat, polyCoords)) {
        attempts++;
        continue;
      }

      // Quantize to grid to prevent exact overlaps
      const gx = Math.round((lng - bounds.minLng) / lngRange * gridCols);
      const gy = Math.round((lat - bounds.minLat) / latRange * gridRows);
      const key = `${gx},${gy}`;

      if (!placed.has(key)) {
        placed.add(key);
        result.push({
          plantSlug: plant.slug,
          commonName: plant.commonName,
          scientificName: plant.scientificName,
          gridX: gx,
          gridY: gy,
          quantity: 1,
          bloomColor: plant.bloomColor,
          heightMaxInches: plant.heightMaxInches,
          notes: '',
          lat,
          lng,
        });
        placedInClump++;
        i++;
      }
      attempts++;
    }

    if (placedInClump === 0) attempts++;
    plantIdx++;
  }

  return result;
}
