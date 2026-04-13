import type { SiteProfile } from './analysis';

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
