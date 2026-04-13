import type { SiteProfile } from '@/types/analysis';
import type { ExistingTree } from '@/types/plan';
import { analyzeSunExposure, estimateEffectiveSunHours } from './sun';
import { querySoilData, drainageToMoisture } from './soil';
import { queryElevation } from './elevation';
import { queryFloodZone } from './flood';

export async function analyzeSite(
  lat: number,
  lng: number,
  existingTrees: ExistingTree[] = [],
): Promise<SiteProfile> {
  const sunExposure = analyzeSunExposure(lat, lng);
  const effectiveSunHours = estimateEffectiveSunHours(sunExposure, lat, lng, existingTrees, lat, lng);

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
