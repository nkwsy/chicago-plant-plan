/** Oudolf-inspired layer model — every plant in the sandbox belongs to one
 *  of four roles. Layers are filterable + lockable in the UI, mirroring how
 *  a real planting designer thinks about composition. */
export type LayerId = 'matrix' | 'structure' | 'scatter' | 'filler';

export interface Species {
  idx: number;          // 1-based, used as the legend number
  slug: string;
  commonName: string;
  scientificName: string;
  color: string;        // CSS color
  layer: LayerId;
}

export interface Plant {
  id: string;           // stable id; copy/paste preserves species but generates new id
  speciesIdx: number;   // → Species.idx
  x: number;            // SVG canvas px
  y: number;            // SVG canvas px
}

export type Tool =
  | 'move'              // V — click selects/toggles, drag = marquee
  | 'marquee'           // M — drag rectangle, ignores plant clicks
  | 'lasso'             // L — drag freeform path
  | 'drag'              // D — click+drag selected plants to move them
  | 'brush'             // B — click adds one plant of active species
  | 'stamp'             // S — click adds a stamp pattern
  | 'erase'             // E — click removes a plant
  | 'eyedropper';       // I — click sets the active species

export type StampPattern = 1 | 3 | 5 | 9;

export interface LayerState {
  visible: boolean;
  locked: boolean;
}

export interface ToolbarState {
  tool: Tool;
  activeSpeciesIdx: number;
  stampPattern: StampPattern;
  brushSize: number;          // px (visual; multiplied into stamp spacing)
  plants: Plant[];
  species: Species[];
  layers: Record<LayerId, LayerState>;
  selectedIds: Set<string>;
  clipboard: { x: number; y: number; speciesIdx: number }[] | null;
  /** Persistent flag — set when user has visibly interacted, hides hints. */
  hasUsed: boolean;
}
