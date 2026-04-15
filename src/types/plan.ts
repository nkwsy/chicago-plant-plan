import type { SiteProfile } from './analysis';
import type { PlantType, SunRequirement } from './plant';

export interface UserPreferences {
  effortLevel: 'low' | 'medium' | 'high';
  habitatGoals: string[];
  aestheticPref: 'wild' | 'structured' | 'mixed';
  bloomPreference: 'spring' | 'summer' | 'fall' | 'continuous';
  maxHeightInches: number | null;
  avoidSlugs: string[];
  specialFeatures: string[];
  targetSpeciesCount: number;
  densityMultiplier: number; // 0.5 = sparse, 1.0 = standard (1 plant/sqft), 2.0 = dense
}

export interface PlanPlant {
  plantSlug: string;
  commonName: string;
  scientificName: string;
  gridX: number;
  gridY: number;
  quantity: number;
  bloomColor: string;
  heightMaxInches: number;
  notes: string;
  lat?: number;
  lng?: number;
  imageUrl?: string;
  // V2 layout fields
  spreadInches?: number;
  speciesIndex?: number;
  plantType?: PlantType;
  groupId?: string;
}

export interface ExclusionZone {
  id: string;
  geoJson: GeoJSON.Polygon;
  label: string;
  type: 'walkway' | 'patio' | 'shed' | 'driveway' | 'sidewalk' | 'building' | 'other';
}

export interface ExistingTree {
  id: string;
  lat: number;
  lng: number;
  canopyDiameterFt: number;
  heightFt?: number; // estimated height for shadow calc (default: canopy * 1.5)
  label: string;
  outsideProperty?: boolean; // true if tree is outside the garden boundary (within 30ft)
}

/** 5×5 ft sub-plot sun analysis grid */
export interface SunGridCell {
  row: number;
  col: number;
  centerLat: number;
  centerLng: number;
  sunHours: number; // effective sun hours per day (summer average)
  sunCategory: 'full_sun' | 'part_sun' | 'part_shade' | 'full_shade';
  underCanopy: boolean;
  inExclusion: boolean;
}

export interface SunGrid {
  cellSizeFt: number; // 5
  rows: number;
  cols: number;
  originLat: number; // SW corner
  originLng: number;
  cells: SunGridCell[];
  globalOverride?: number | null; // user-set override sun hours
}

export interface PlanData {
  id: string;
  title: string;
  authorName: string;
  authorEmail: string;
  areaGeoJson: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  centerLat: number;
  centerLng: number;
  siteProfile: SiteProfile | null;
  preferences: UserPreferences | null;
  plants: PlanPlant[];
  gridCols: number;
  gridRows: number;
  areaSqFt: number;
  diversityScore: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  // V2 fields
  exclusionZones?: ExclusionZone[];
  existingTrees?: ExistingTree[];
  layoutVersion?: number;
  // V3 fields
  sunGrid?: SunGrid;
}

export interface QuoteRequest {
  id: string;
  planId: string;
  email: string;
  name: string;
  phone: string;
  notes: string;
  status: 'pending' | 'sent' | 'replied';
  createdAt: string;
}
