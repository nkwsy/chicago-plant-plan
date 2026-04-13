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
  suppliers: PlantSupplier[];
}

export interface PlantSupplier {
  supplierSlug: string;
  availability: AvailabilityType[];
}
