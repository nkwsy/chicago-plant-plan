import type { SiteProfile } from '@/types/analysis';
import type { ExistingTree } from '@/types/plan';
import { analyzeSunExposure, estimateEffectiveSunHours, type NearbyBuilding } from './sun';
import { querySoilData, drainageToMoisture } from './soil';
import { queryElevation } from './elevation';
import { queryFloodZone } from './flood';

/**
 * Query Overpass API for buildings within ~150m of a point.
 * Returns estimated heights from OSM tags (height, building:levels).
 */
async function queryNearbyBuildings(lat: number, lng: number): Promise<NearbyBuilding[]> {
  const radius = 150; // meters
  const query = `[out:json][timeout:10];(way["building"](around:${radius},${lat},${lng});relation["building"](around:${radius},${lat},${lng}););out center tags;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const buildings: NearbyBuilding[] = [];

    for (const el of data.elements || []) {
      const center = el.center || { lat, lon: lng };
      const tags = el.tags || {};

      // Parse height: prefer explicit height tag, then estimate from levels
      let heightMeters = 0;
      if (tags.height) {
        const h = parseFloat(tags.height);
        if (!isNaN(h)) heightMeters = h;
      } else if (tags['building:levels']) {
        const levels = parseFloat(tags['building:levels']);
        if (!isNaN(levels)) heightMeters = levels * 3.5; // ~3.5m per floor
      } else {
        // Default: assume 2-story residential (7m)
        heightMeters = 7;
      }

      if (heightMeters > 0) {
        buildings.push({ lat: center.lat, lng: center.lon, heightMeters });
      }
    }
    return buildings;
  } catch {
    return [];
  }
}

export async function analyzeSite(
  lat: number,
  lng: number,
  existingTrees: ExistingTree[] = [],
): Promise<SiteProfile> {
  const sunExposure = analyzeSunExposure(lat, lng);
  const nearbyBuildings = await queryNearbyBuildings(lat, lng).catch(() => []);
  const effectiveSunHours = estimateEffectiveSunHours(sunExposure, lat, lng, existingTrees, lat, lng, nearbyBuildings);

  const [soilResult, elevation, floodResult] = await Promise.all([
    querySoilData(lat, lng).catch(() => ({
      soilType: 'clay_loam',
      drainage: 'Moderately well drained',
      description: 'Typical Chicagoland clay-loam soil (estimated)',
      hydricRating: 'C',
    })),
    queryElevation(lat, lng).catch(() => 600),
    queryFloodZone(lat, lng).catch(() => ({
      floodZone: null as string | null,
      isFloodHazard: false,
      description: 'Flood data unavailable',
    })),
  ]);

  let moistureCategory = drainageToMoisture(soilResult.drainage);
  if (floodResult.isFloodHazard) moistureCategory = 'wet';

  return {
    sunExposure,
    soilType: soilResult.soilType,
    soilDrainage: soilResult.drainage,
    floodZone: floodResult.floodZone,
    elevation,
    slopePercent: 1,
    moistureCategory,
    effectiveSunHours,
    rawData: {
      soilDescription: soilResult.description,
      floodZoneDescription: floodResult.description,
      elevationFeet: elevation,
    },
  };
}
