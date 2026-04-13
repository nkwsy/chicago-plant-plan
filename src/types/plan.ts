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
  type: 'walkway' | 'patio' | 'shed' | 'driveway' | 'other';
}

export interface ExistingTree {
  id: string;
  lat: number;
  lng: number;
  canopyDiameterFt: number;
  label: string;
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
