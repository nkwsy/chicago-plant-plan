import SunCalc from 'suncalc';
import type { SunExposure, DaySunData } from '@/types/analysis';
import type { ExistingTree } from '@/types/plan';

export interface NearbyBuilding {
  lat: number;
  lng: number;
  heightMeters: number;
  widthMeters?: number;
}

/**
 * Estimate local solar time offset from UTC using longitude.
 * Returns hours to subtract from local time to get UTC.
 * E.g., Chicago (lng ≈ -87.6) → offset ≈ -6 (standard) or -5 (DST).
 */
function estimateUTCOffset(lng: number, summer: boolean): number {
  const stdOffset = Math.round(lng / 15);
  // Rough DST: northern hemisphere gets +1 in summer
  return summer ? stdOffset + 1 : stdOffset;
}

function getDaySunData(date: Date, lat: number, lng: number): DaySunData {
  // Use SunCalc.getTimes with a properly constructed UTC date for this day
  const utcDate = new Date(Date.UTC(
    date.getUTCFullYear?.() ?? date.getFullYear(),
    date.getUTCMonth?.() ?? date.getMonth(),
    date.getUTCDate?.() ?? date.getDate(),
    12, 0 // noon UTC as a reference point for the day
  ));

  const times = SunCalc.getTimes(utcDate, lat, lng);

  // Compute actual local noon: sun is highest when it crosses the meridian
  // Local noon UTC hour ≈ 12 - (lng / 15)
  const localNoonUTC = 12 - (lng / 15);
  const noonDate = new Date(Date.UTC(
    utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate(),
    Math.floor(localNoonUTC), Math.round((localNoonUTC % 1) * 60)
  ));
  const noonPosition = SunCalc.getPosition(noonDate, lat, lng);

  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const daylightMs = sunset.getTime() - sunrise.getTime();
  const totalDaylightHours = daylightMs / (1000 * 60 * 60);
  const altitudeDeg = noonPosition.altitude * (180 / Math.PI);

  // Format times in approximate local time
  const tzOffset = estimateUTCOffset(lng, utcDate.getUTCMonth() >= 2 && utcDate.getUTCMonth() <= 10);
  const formatLocalTime = (d: Date) => {
    const localH = d.getUTCHours() + tzOffset;
    const h = ((localH % 24) + 24) % 24;
    const m = d.getUTCMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  return {
    sunrise: formatLocalTime(sunrise),
    sunset: formatLocalTime(sunset),
    totalDaylightHours: Math.round(totalDaylightHours * 10) / 10,
    sunPathAltitudeNoon: Math.round(altitudeDeg * 10) / 10,
  };
}

export function analyzeSunExposure(lat: number, lng: number): SunExposure {
  const year = new Date().getFullYear();
  return {
    summerSolstice: getDaySunData(new Date(Date.UTC(year, 5, 21)), lat, lng),
    winterSolstice: getDaySunData(new Date(Date.UTC(year, 11, 21)), lat, lng),
    springEquinox: getDaySunData(new Date(Date.UTC(year, 2, 20)), lat, lng),
    fallEquinox: getDaySunData(new Date(Date.UTC(year, 8, 22)), lat, lng),
  };
}

/**
 * Compute effective sun hours considering existing trees and adjacent buildings.
 * Samples multiple points across the garden area for accuracy.
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

  if (!lat || !lng || !hasObstructions) {
    const exposureFactor = 0.7;
    const summer = Math.round(sunExposure.summerSolstice.totalDaylightHours * exposureFactor * 10) / 10;
    const winter = Math.round(sunExposure.winterSolstice.totalDaylightHours * exposureFactor * 10) / 10;
    return { summer, winter, average: Math.round(((summer + winter) / 2) * 10) / 10 };
  }

  const cLat = gardenCenterLat || lat;
  const cLng = gardenCenterLng || lng;
  const year = new Date().getFullYear();

  // Sample a 3x3 grid of points across the garden (±15ft from center)
  const offsetFt = 15;
  const metersPerFt = 0.3048;
  const latPerFt = metersPerFt / 111320;
  const lngPerFt = metersPerFt / (111320 * Math.cos(cLat * Math.PI / 180));

  const samplePoints: { lat: number; lng: number }[] = [];
  for (const dy of [-offsetFt, 0, offsetFt]) {
    for (const dx of [-offsetFt, 0, offsetFt]) {
      samplePoints.push({
        lat: cLat + dy * latPerFt,
        lng: cLng + dx * lngPerFt,
      });
    }
  }

  let summerTotal = 0;
  let winterTotal = 0;

  for (const pt of samplePoints) {
    summerTotal += countDirectSunHours(
      new Date(Date.UTC(year, 5, 21)), pt.lat, pt.lng,
      existingTrees || [], nearbyBuildings || [],
    );
    winterTotal += countDirectSunHours(
      new Date(Date.UTC(year, 11, 21)), pt.lat, pt.lng,
      existingTrees || [], nearbyBuildings || [],
    );
  }

  const summerHours = Math.round((summerTotal / samplePoints.length) * 10) / 10;
  const winterHours = Math.round((winterTotal / samplePoints.length) * 10) / 10;
  const average = Math.round(((summerHours + winterHours) / 2) * 10) / 10;

  return { summer: summerHours, winter: winterHours, average };
}

/**
 * Count hours of direct sun at a point, considering tree and building shadows.
 * Iterates all 24 UTC hours and checks if the sun is above the horizon —
 * no timezone assumptions needed.
 */
/**
 * Convert lat/lng to local meters relative to a reference point.
 * Uses equirectangular projection (accurate enough for <500m distances).
 */
function toMeters(lat: number, lng: number, refLat: number, refLng: number): { x: number; y: number } {
  return {
    x: (lng - refLng) * 111320 * Math.cos(refLat * Math.PI / 180),
    y: (lat - refLat) * 111320,
  };
}

function countDirectSunHours(
  date: Date,
  lat: number,
  lng: number,
  trees: ExistingTree[],
  buildings: NearbyBuilding[],
): number {
  let sunHours = 0;
  const metersPerFt = 0.3048;

  // Garden point in meters (origin = garden point itself)
  const gardenM = { x: 0, y: 0 };

  // Loop 30 hours to cover daylight that extends past midnight UTC
  // (e.g., Chicago summer sunset ~1:30 AM UTC next day)
  for (let utcHour = 0; utcHour < 30; utcHour++) {
    const time = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), utcHour,
    ));
    const sunPos = SunCalc.getPosition(time, lat, lng);
    const altitudeDeg = sunPos.altitude * (180 / Math.PI);

    if (altitudeDeg <= 2) continue;

    // SunCalc azimuth: 0=south, clockwise. Convert to compass: +180
    const azimuthDeg = sunPos.azimuth * (180 / Math.PI) + 180;
    const altRad = altitudeDeg * Math.PI / 180;
    // Shadow falls opposite to sun direction
    const shadowBearingRad = ((azimuthDeg + 180) % 360) * Math.PI / 180;
    // Shadow direction vector (meters): north=+y, east=+x
    const shadowDirX = Math.sin(shadowBearingRad);
    const shadowDirY = Math.cos(shadowBearingRad);
    let inShadow = false;

    // Check tree shadows (all in meters)
    for (const tree of trees) {
      const treeM = toMeters(tree.lat, tree.lng, lat, lng);
      const treeHeightM = tree.canopyDiameterFt * 1.5 * metersPerFt;
      const shadowLenM = Math.min(treeHeightM / Math.tan(altRad), 200);
      const tipX = treeM.x + shadowDirX * shadowLenM;
      const tipY = treeM.y + shadowDirY * shadowLenM;
      const canopyRadiusM = tree.canopyDiameterFt / 2 * metersPerFt;

      const dist = pointToSegmentDistM(gardenM.x, gardenM.y, treeM.x, treeM.y, tipX, tipY);
      if (dist < canopyRadiusM * 1.5) {
        // Verify we're on the shadow side (not between sun and tree)
        const dx = gardenM.x - treeM.x, dy = gardenM.y - treeM.y;
        const sdx = tipX - treeM.x, sdy = tipY - treeM.y;
        if (dx * sdx + dy * sdy > 0) { inShadow = true; break; }
      }
    }

    if (inShadow) continue;

    // Check building shadows (all in meters)
    for (const building of buildings) {
      const bldgM = toMeters(building.lat, building.lng, lat, lng);
      const shadowLenM = Math.min(building.heightMeters / Math.tan(altRad), 300);
      const tipX = bldgM.x + shadowDirX * shadowLenM;
      const tipY = bldgM.y + shadowDirY * shadowLenM;
      const halfWidthM = (building.widthMeters || 15) / 2;

      const dist = pointToSegmentDistM(gardenM.x, gardenM.y, bldgM.x, bldgM.y, tipX, tipY);
      if (dist < halfWidthM) {
        const dx = gardenM.x - bldgM.x, dy = gardenM.y - bldgM.y;
        const sdx = tipX - bldgM.x, sdy = tipY - bldgM.y;
        if (dx * sdx + dy * sdy > 0) { inShadow = true; break; }
      }
    }

    if (!inShadow) sunHours++;
  }

  return sunHours;
}

/** Distance from point (px,py) to line segment (ax,ay)→(bx,by) in meters */
function pointToSegmentDistM(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
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
