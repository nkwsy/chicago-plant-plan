import SunCalc from 'suncalc';
import type { SunExposure, DaySunData } from '@/types/analysis';
import type { ExistingTree } from '@/types/plan';

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
 * Compute effective sun hours considering existing trees.
 * For each hour of the growing season day (6AM-8PM), check if the garden
 * center is shadowed by any tree canopy using sun position + shadow projection.
 */
export function estimateEffectiveSunHours(
  sunExposure: SunExposure,
  lat?: number,
  lng?: number,
  existingTrees?: ExistingTree[],
  gardenCenterLat?: number,
  gardenCenterLng?: number,
): { summer: number; winter: number; average: number } {
  // If no trees or no location data, use a reasonable base estimate
  if (!lat || !lng || !existingTrees || existingTrees.length === 0) {
    // Base exposure factor: typical residential yard (no nearby obstructions)
    const exposureFactor = 0.7;
    const summer = Math.round(sunExposure.summerSolstice.totalDaylightHours * exposureFactor * 10) / 10;
    const winter = Math.round(sunExposure.winterSolstice.totalDaylightHours * exposureFactor * 10) / 10;
    return { summer, winter, average: Math.round(((summer + winter) / 2) * 10) / 10 };
  }

  const cLat = gardenCenterLat || lat;
  const cLng = gardenCenterLng || lng;
  const year = new Date().getFullYear();

  // Check summer solstice and winter solstice
  const summerHours = countDirectSunHours(new Date(year, 5, 21), cLat, cLng, existingTrees);
  const winterHours = countDirectSunHours(new Date(year, 11, 21), cLat, cLng, existingTrees);
  const average = Math.round(((summerHours + winterHours) / 2) * 10) / 10;

  return { summer: summerHours, winter: winterHours, average };
}

/**
 * Count hours of direct sun at a point, subtracting hours when tree shadows cover it.
 * Checks each hour from 6AM to 8PM.
 */
function countDirectSunHours(
  date: Date,
  lat: number,
  lng: number,
  trees: ExistingTree[],
): number {
  let sunHours = 0;

  for (let hour = 6; hour <= 20; hour++) {
    const time = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
    const sunPos = SunCalc.getPosition(time, lat, lng);
    const altitudeDeg = sunPos.altitude * (180 / Math.PI);

    // Sun below horizon
    if (altitudeDeg <= 0) continue;

    // Check if any tree casts shadow over this point at this time
    const azimuthDeg = sunPos.azimuth * (180 / Math.PI) + 180; // 0=N, 90=E, 180=S, 270=W
    let inShadow = false;

    for (const tree of trees) {
      // Assume tree height based on canopy: roughly canopyDiameterFt * 1.5
      const treeHeightFt = tree.canopyDiameterFt * 1.5;

      // Shadow length in feet: height / tan(altitude)
      const shadowLenFt = treeHeightFt / Math.tan(altitudeDeg * Math.PI / 180);

      // Shadow direction: opposite of sun azimuth
      const shadowDirRad = ((azimuthDeg + 180) % 360) * Math.PI / 180;

      // Shadow tip position relative to tree (in feet, then convert to degrees)
      const shadowTipDLat = Math.cos(shadowDirRad) * shadowLenFt;
      const shadowTipDLng = Math.sin(shadowDirRad) * shadowLenFt;

      // Convert shadow tip offset to degrees
      const metersPerFt = 0.3048;
      const tipLat = tree.lat + (shadowTipDLat * metersPerFt) / 111320;
      const tipLng = tree.lng + (shadowTipDLng * metersPerFt) / (111320 * Math.cos(lat * Math.PI / 180));

      // Check if the garden point is within the shadow cone
      // Simplified: check if point is between tree and shadow tip, within canopy width
      const canopyRadiusDeg = (tree.canopyDiameterFt / 2 * metersPerFt) / 111320;

      // Distance from point to the line segment tree→shadowTip
      const distToShadow = pointToSegmentDist(
        lng, lat,
        tree.lng, tree.lat,
        tipLng, tipLat,
      );

      // If within canopy radius of the shadow line, it's shaded
      if (distToShadow < canopyRadiusDeg * 1.5) {
        // Also check the point is on the shadow side (not behind the tree from sun)
        const dx = lng - tree.lng;
        const dy = lat - tree.lat;
        const sdx = tipLng - tree.lng;
        const sdy = tipLat - tree.lat;
        const dot = dx * sdx + dy * sdy;
        if (dot > 0) { // Point is in shadow direction
          inShadow = true;
          break;
        }
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
