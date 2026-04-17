export type SunRequirement = 'full_sun' | 'part_sun' | 'part_shade' | 'full_shade';
export type MoistureRequirement = 'dry' | 'medium' | 'wet';
export type EffortLevel = 'low' | 'medium' | 'high';
export type PlantType = 'forb' | 'grass' | 'sedge' | 'shrub' | 'tree' | 'vine' | 'fern';
export type NativeHabitat = 'prairie' | 'woodland' | 'wetland' | 'savanna';
export type WildlifeValue = 'pollinators' | 'birds' | 'butterflies' | 'mammals';
export type AvailabilityType = 'seed' | 'plug' | 'potted' | 'bare_root';

export interface Plant {
  slug: string;
  commonName: string;
  scientificName: string;
  family: string;
  plantType: PlantType;
  heightMinInches: number;
  heightMaxInches: number;
  spreadMinInches: number;
  spreadMaxInches: number;
  sun: SunRequirement[];
  moisture: MoistureRequirement[];
  soilTypes: string[];
  bloomStartMonth: number;
  bloomEndMonth: number;
  bloomColor: string;
  nativeHabitats: NativeHabitat[];
  wildlifeValue: WildlifeValue[];
  effortLevel: EffortLevel;
  deerResistant: boolean;
  description: string;
  careNotes: string;
  plantingInstructions: string;
  imageUrl: string;
  imageAttribution?: string;
  suppliers: PlantSupplier[];

  // Admin / curation fields
  /** 0-100. 50 is neutral. Values >50 make this plant more likely to be picked
   *  during plan generation; <50 makes it less likely. Used by scorePlant. */
  favorability?: number;
  /** Freeform tags: "keystone", "monarch-host", "rare", "clay-tolerant", etc. */
  tags?: string[];
  /** Private notes from curators; not shown to end users. */
  notes?: string;
  /** ISO timestamp of the last successful Claude enrichment pass. */
  lastEnrichedAt?: string | null;
  /** iNaturalist taxon id, set when a plant was looked up via iNat. */
  inatTaxonId?: number | null;
}

export interface SupplierPricing {
  format: AvailabilityType;
  price: number | null;
  inStock: boolean;
}

export interface PlantSupplier {
  supplierSlug: string;
  availability: AvailabilityType[];
  pricing: SupplierPricing[];
  lastPriceUpdate: string | null;
}
