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
  const query = `[out:json][timeout:15];(way["building"](around:${radius},${lat},${lng});relation["building"](around:${radius},${lat},${lng}););out center tags;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`Overpass query failed: ${res.status} ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    const buildings: NearbyBuilding[] = [];

    for (const el of data.elements || []) {
      const center = el.center || { lat, lon: lng };
      const tags = el.tags || {};

      // Skip only buildings the garden is literally inside of (within ~3m of center)
      const distM = Math.sqrt(
        ((center.lat - lat) * 111320) ** 2 +
        ((center.lon - lng) * 111320 * Math.cos(lat * Math.PI / 180)) ** 2
      );
      if (distM < 3) continue;

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

      // Estimate width from building type
      let widthMeters = 15; // default residential
      if (tags['building'] === 'commercial' || tags['building'] === 'retail') widthMeters = 25;
      else if (tags['building'] === 'apartments' || (tags['building:levels'] && parseFloat(tags['building:levels']) > 4)) widthMeters = 30;

      if (heightMeters > 0) {
        buildings.push({ lat: center.lat, lng: center.lon, heightMeters, widthMeters });
      }
    }
    console.log(`Overpass: found ${data.elements?.length || 0} raw, ${buildings.length} buildings (after filtering)`);
    return buildings;
  } catch (err) {
    console.warn('Overpass query error:', err);
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
    nearbyBuildings: nearbyBuildings.map(b => ({
      lat: b.lat, lng: b.lng, heightMeters: b.heightMeters, widthMeters: b.widthMeters ?? 15,
    })),
    rawData: {
      soilDescription: soilResult.description,
      floodZoneDescription: floodResult.description,
      elevationFeet: elevation,
    },
  };
}
