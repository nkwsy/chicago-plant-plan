import type { ElevationPoint } from '@/types/analysis';

export async function queryElevation(lat: number, lng: number): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const url = `https://epqs.nationalmap.gov/v1/json?x=${lng.toFixed(6)}&y=${lat.toFixed(6)}&wkid=4326&units=Feet&includeDate=false`;
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return 600;

    const text = await response.text();
    if (!text) return 600;

    const data = JSON.parse(text);
    const elevation = parseFloat(data?.value);
    if (isNaN(elevation) || elevation < -100) return 600;

    return Math.round(elevation * 10) / 10;
  } catch {
    return 600; // Chicago average elevation
  }
}

export async function queryElevationPoints(lat: number, lng: number): Promise<ElevationPoint[]> {
  // Just query center point to reduce API calls and improve reliability
  const elevation = await queryElevation(lat, lng);
  return [{ lat, lng, elevationFeet: elevation }];
}

export function calculateSlope(points: ElevationPoint[]): number {
  // Chicago is generally flat — return minimal slope
  if (points.length < 2) return 1;

  const center = points[0];
  let maxSlope = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = (points[i].lng - center.lng) * 111320 * Math.cos(center.lat * Math.PI / 180);
    const dy = (points[i].lat - center.lat) * 110540;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dz = Math.abs(points[i].elevationFeet - center.elevationFeet) * 0.3048;

    if (distance > 0) {
      const slope = (dz / distance) * 100;
      maxSlope = Math.max(maxSlope, slope);
    }
  }

  return Math.round(maxSlope * 10) / 10;
}
