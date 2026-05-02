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

  // Oudolf / design-formula metadata. All optional; populated by the Claude
  // enrichment pipeline (see src/lib/plants/enrich.ts). Consumed by
  // scorePlant() when a DesignFormula is active.
  /** How this plant functions in a naturalistic composition. */
  oudolfRole?: 'matrix' | 'structure' | 'scatter' | 'filler';
  /** True if the plant's seed heads persist attractively after bloom. */
  seedHeadInterest?: boolean;
  /** True if the plant holds architectural form through winter (dried stems
   *  standing above the snow, for example). */
  winterStructure?: boolean;

  // ---- Layout-geometry metadata (phase 1 of the planting-layout overhaul) --
  // These two fields drive the Voronoi-based tapestry algorithm and the
  // installation-grid mode. Initial values are inferred from oudolfRole +
  // plantType + size by inferSociabilityAndTier(); curators can hand-tune.
  /** Aster-style sociability scale.
   *  1 = solitary specimen (single tree, large emergent forb)
   *  2 = small group of 3–5 (primary structural forbs)
   *  3 = drift of 6–12 (companion forbs)
   *  4 = sweep of 15–30 (matrix grasses, mass-planted forbs)
   *  5 = colony / continuous carpet (sedges, low groundcovers)
   */
  sociability?: 1 | 2 | 3 | 4 | 5;
  /** Visual hierarchy tier in the planting (Oudolf 5-layer model).
   *  1 = scatter / filler (low gap-fillers, single accents)
   *  2 = matrix (groundcover grasses & sedges — the green backdrop)
   *  3 = secondary companion (drift-forming forbs of medium height)
   *  4 = primary structural (silhouette forbs / mid-canopy shrubs)
   *  5 = emergent (tall accents — trees, large shrubs, very tall forbs/grasses)
   */
  tier?: 1 | 2 | 3 | 4 | 5;
  /** Optional override into the active symbol set. When unset, the renderer
   *  falls back to the symbol set's per-family / per-tier default. */
  defaultSymbolKey?: string;
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
