import type { SiteProfile } from '@/types/analysis';
import { analyzeSunExposure, estimateEffectiveSunHours } from './sun';
import { querySoilData, drainageToMoisture } from './soil';
import { queryElevation } from './elevation';
import { queryFloodZone } from './flood';

export async function analyzeSite(lat: number, lng: number): Promise<SiteProfile> {
  // Sun analysis is always available (local calculation)
  const sunExposure = analyzeSunExposure(lat, lng);
  const effectiveSunHours = estimateEffectiveSunHours(sunExposure);

  // Run external queries in parallel with individual error handling
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

  // Determine moisture from soil drainage + flood zone
  let moistureCategory = drainageToMoisture(soilResult.drainage);
  if (floodResult.isFloodHazard) {
    moistureCategory = 'wet';
  }

  return {
    sunExposure,
    soilType: soilResult.soilType,
    soilDrainage: soilResult.drainage,
    floodZone: floodResult.floodZone,
    elevation,
    slopePercent: 1, // Flat default for Chicago
    moistureCategory,
    effectiveSunHours,
    rawData: {
      soilDescription: soilResult.description,
      floodZoneDescription: floodResult.description,
      elevationFeet: elevation,
    },
  };
}
