export interface SiteProfile {
  sunExposure: SunExposure;
  soilType: string;
  soilDrainage: string;
  floodZone: string | null;
  elevation: number;
  slopePercent: number;
  moistureCategory: 'dry' | 'medium' | 'wet';
  effectiveSunHours: {
    summer: number;
    winter: number;
    average: number;
  };
  rawData: {
    soilDescription?: string;
    floodZoneDescription?: string;
    elevationFeet?: number;
  };
  nearbyBuildings?: Array<{ lat: number; lng: number; heightMeters: number; widthMeters?: number }>;
}

export interface SunExposure {
  summerSolstice: DaySunData;
  winterSolstice: DaySunData;
  springEquinox: DaySunData;
  fallEquinox: DaySunData;
}

export interface DaySunData {
  sunrise: string;
  sunset: string;
  totalDaylightHours: number;
  sunPathAltitudeNoon: number;
}

export interface Building {
  id: string;
  footprint: [number, number][];
  height: number;
  distanceMeters: number;
  bearingDegrees: number;
}

export interface ElevationPoint {
  lat: number;
  lng: number;
  elevationFeet: number;
}
