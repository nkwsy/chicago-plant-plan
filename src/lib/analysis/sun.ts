import SunCalc from 'suncalc';
import type { SunExposure, DaySunData } from '@/types/analysis';

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

export function estimateEffectiveSunHours(sunExposure: SunExposure): { summer: number; winter: number; average: number } {
  // Estimate usable garden sun hours (not total daylight, but direct exposure)
  // Typical residential yards get 60-80% of total daylight as direct sun
  const exposureFactor = 0.7;

  const summer = Math.round(sunExposure.summerSolstice.totalDaylightHours * exposureFactor * 10) / 10;
  const winter = Math.round(sunExposure.winterSolstice.totalDaylightHours * exposureFactor * 10) / 10;
  const average = Math.round(((summer + winter) / 2) * 10) / 10;

  return { summer, winter, average };
}

export function sunHoursToCategory(avgHours: number): 'full_sun' | 'part_sun' | 'part_shade' | 'full_shade' {
  if (avgHours >= 6) return 'full_sun';
  if (avgHours >= 4) return 'part_sun';
  if (avgHours >= 2) return 'part_shade';
  return 'full_shade';
}
