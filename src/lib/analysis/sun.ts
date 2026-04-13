import SunCalc from 'suncalc';
import type { SunExposure, DaySunData } from '@/types/analysis';
import type { ExistingTree } from '@/types/plan';

export interface NearbyBuilding {
  lat: number;
  lng: number;
  heightMeters: number; // estimated or from OSM tags
}

function getDaySunData(date: Date, lat: number, lng: number): DaySunData {
  const times = SunCalc.getTimes(date, lat, lng);
  const noonPosition = SunCalc.getPosition(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0), lat, lng);

  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const daylightMs = sunset.getTime() - sunrise.getTime();
  const totalDaylightHours = daylightMs / (1000 * 60 * 60);
  const altitudeDeg = noonPosition.altitude * (180 / Math.PI);

  return {
    sunrise: sunrise.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    sunset: sunset.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    totalDaylightHours: Math.round(totalDaylightHours * 10) / 10,
    sunPathAltitudeNoon: Math.round(altitudeDeg * 10) / 10,
  };
}

export function analyzeSunExposure(lat: number, lng: number): SunExposure {
  const year = new Date().getFullYear();
  return {
    summerSolstice: getDaySunData(new Date(year, 5, 21), lat, lng),
    winterSolstice: getDaySunData(new Date(year, 11, 21), lat, lng),
    springEquinox: getDaySunData(new Date(year, 2, 20), lat, lng),
    fallEquinox: getDaySunData(new Date(year, 8, 22), lat, lng),
  };
}

/**
 * Compute effective sun hours considering existing trees and adjacent buildings.
 * For each hour of the growing season day (6AM-8PM), check if the garden
 * center is shadowed by any tree canopy or building using sun position + shadow projection.
 */
export function estimateEffectiveSunHours(
  sunExposure: SunExposure,
  lat?: number,
  lng?: number,
  existingTrees?: ExistingTree[],
  gardenCenterLat?: number,
  gardenCenterLng?: number,
  nearbyBuildings?: NearbyBuilding[],
): { summer: number; winter: number; average: number } {
  const hasObstructions = (existingTrees && existingTrees.length > 0) || (nearbyBuildings && nearbyBuildings.length > 0);

  // If no obstructions or no location data, use a reasonable base estimate
  if (!lat || !lng || !hasObstructions) {
    const exposureFactor = 0.7;
    const summer = Math.round(sunExposure.summerSolstice.totalDaylightHours * exposureFactor * 10) / 10;
    const winter = Math.round(sunExposure.winterSolstice.totalDaylightHours * exposureFactor * 10) / 10;
    return { summer, winter, average: Math.round(((summer + winter) / 2) * 10) / 10 };
  }

  const cLat = gardenCenterLat || lat;
  const cLng = gardenCenterLng || lng;
  const year = new Date().getFullYear();

  const summerHours = countDirectSunHours(new Date(year, 5, 21), cLat, cLng, existingTrees || [], nearbyBuildings || []);
  const winterHours = countDirectSunHours(new Date(year, 11, 21), cLat, cLng, existingTrees || [], nearbyBuildings || []);
  const average = Math.round(((summerHours + winterHours) / 2) * 10) / 10;

  return { summer: summerHours, winter: winterHours, average };
}

/**
 * Count hours of direct sun at a point, considering tree and building shadows.
 * Checks each hour from 6AM to 8PM.
 */
function countDirectSunHours(
  date: Date,
  lat: number,
  lng: number,
  trees: ExistingTree[],
  buildings: NearbyBuilding[],
): number {
  let sunHours = 0;
  const metersPerFt = 0.3048;

  for (let hour = 6; hour <= 20; hour++) {
    const time = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
    const sunPos = SunCalc.getPosition(time, lat, lng);
    const altitudeDeg = sunPos.altitude * (180 / Math.PI);

    if (altitudeDeg <= 0) continue;

    const azimuthDeg = sunPos.azimuth * (180 / Math.PI) + 180;
    const altRad = altitudeDeg * Math.PI / 180;
    // Shadow direction = opposite of sun direction
    const shadowDirRad = ((azimuthDeg + 180) % 360) * Math.PI / 180;
    let inShadow = false;

    // Check tree shadows
    for (const tree of trees) {
      const treeHeightFt = tree.canopyDiameterFt * 1.5;
      const shadowLenFt = treeHeightFt / Math.tan(altRad);
      const shadowTipDLat = Math.cos(shadowDirRad) * shadowLenFt;
      const shadowTipDLng = Math.sin(shadowDirRad) * shadowLenFt;
      const tipLat = tree.lat + (shadowTipDLat * metersPerFt) / 111320;
      const tipLng = tree.lng + (shadowTipDLng * metersPerFt) / (111320 * Math.cos(lat * Math.PI / 180));
      const canopyRadiusDeg = (tree.canopyDiameterFt / 2 * metersPerFt) / 111320;
      const distToShadow = pointToSegmentDist(lng, lat, tree.lng, tree.lat, tipLng, tipLat);

      if (distToShadow < canopyRadiusDeg * 1.5) {
        const dx = lng - tree.lng, dy = lat - tree.lat;
        const sdx = tipLng - tree.lng, sdy = tipLat - tree.lat;
        if (dx * sdx + dy * sdy > 0) { inShadow = true; break; }
      }
    }

    if (inShadow) { sunHours += 0; continue; }

    // Check building shadows
    for (const building of buildings) {
      // Shadow length in meters: height / tan(altitude)
      const shadowLenMeters = building.heightMeters / Math.tan(altRad);
      const shadowLenDegLat = shadowLenMeters / 111320;
      const shadowLenDegLng = shadowLenMeters / (111320 * Math.cos(lat * Math.PI / 180));

      const tipLat = building.lat + Math.cos(shadowDirRad) * shadowLenDegLat;
      const tipLng = building.lng + Math.sin(shadowDirRad) * shadowLenDegLng;

      // Buildings cast a wide shadow — use half of typical building width (~10m) as shadow corridor
      const shadowWidthDeg = 10 / 111320;
      const distToShadow = pointToSegmentDist(lng, lat, building.lng, building.lat, tipLng, tipLat);

      if (distToShadow < shadowWidthDeg) {
        const dx = lng - building.lng, dy = lat - building.lat;
        const sdx = tipLng - building.lng, sdy = tipLat - building.lat;
        if (dx * sdx + dy * sdy > 0) { inShadow = true; break; }
      }
    }

    if (!inShadow) sunHours++;
  }

  return sunHours;
}

/** Distance from point (px,py) to line segment (ax,ay)→(bx,by) */
function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

export function sunHoursToCategory(avgHours: number): 'full_sun' | 'part_sun' | 'part_shade' | 'full_shade' {
  if (avgHours >= 6) return 'full_sun';
  if (avgHours >= 4) return 'part_sun';
  if (avgHours >= 2) return 'part_shade';
  return 'full_shade';
}
