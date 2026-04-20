/**
 * DesignFormula — a named, tweakable preset that biases plant selection toward
 * a specific aesthetic / ecological style (e.g. Piet Oudolf prairie matrix).
 *
 * Formulas are data, not code: they're stored in MongoDB (with a JSON seed
 * fallback), chosen at plan-creation time, and editable through /admin/formulas.
 *
 * How it interacts with the planner:
 *  - `scorePlant(plant, ctx, formula?)` consumes an optional formula. When
 *    undefined, scoring is byte-identical to pre-formula behavior.
 *  - `generatePlan` reads `formula.typeRatios` and `formula.roleRatios` to
 *    drive the greedy selection loop's quota bonuses.
 *
 * Backward compatibility: `UserPreferences.formulaSlug` is optional; empty
 * means "classic selection" and nothing changes.
 */

import type { PlantType } from './plant';

/** Oudolf-style role: how a plant functions in the planting composition.
 *  - matrix: the repeating base, typically grasses and durable perennials
 *  - structure: taller, architectural plants that anchor the eye
 *  - scatter: accent species woven through the matrix in small numbers
 *  - filler: ephemerals / shorter-lived plants that plug gaps
 */
export type OudolfRole = 'matrix' | 'structure' | 'scatter' | 'filler';

/** The tunable weight surface. All fields optional; undefined = 1× default.
 *  `winterInterest` and `seedHead` are new signals that only contribute when
 *  explicitly weighted by a formula. */
export interface FormulaWeights {
  familyDiversity?: number;
  typeDiversity?: number;
  bloomCoverage?: number;
  colorDiversity?: number;
  wildlife?: number;
  effort?: number;
  deerResistance?: number;
  favorability?: number;
  winterInterest?: number;
  seedHead?: number;
}

export interface DesignFormula {
  slug: string;                 // 'piet-oudolf-prairie-matrix'
  name: string;                 // 'Piet Oudolf — Prairie Matrix'
  description: string;          // 1-2 sentence blurb for the wizard tile
  longDescription?: string;     // longer admin-only copy
  author?: string;              // 'Piet Oudolf', 'Built-in', user handle
  isBuiltIn: boolean;           // UI prevents deleting built-ins
  /** User id (stringified Mongo _id) of the creator. Undefined for built-ins
   *  and for legacy docs that predate auth. */
  ownerId?: string;
  parentSlug?: string;          // inheritance hint: "cloned from this formula"

  /** PlantType quotas. Fractions in [0,1]; omitted types are flexible.
   *  Replaces the hardcoded { forb:0.45, grass:0.2, shrub:0.15 } in the
   *  greedy selection loop when present. */
  typeRatios: Partial<Record<PlantType, number>>;
  /** Oudolf-role quotas applied in the same loop as typeRatios. */
  roleRatios: Partial<Record<OudolfRole, number>>;

  /** Multiplicative overrides against the default scorePlant() signals.
   *  1 = unchanged, 0 = disable, 2 = double. Undefined = 1. */
  weights: FormulaWeights;

  /** Additive score bump when a plant's tag matches. */
  tagBonuses: Record<string, number>;
  /** Additive score penalty when a plant's tag matches (typically negative). */
  tagPenalties: Record<string, number>;

  /** Signature species pinned as preferred picks (by plant.slug). */
  characteristicSpecies: string[];
  /** Bonus added when a candidate is in characteristicSpecies. Default 30. */
  pinBonus?: number;

  /** Months (1-12) to emphasize for bloom; e.g. [8,9,10] for an autumn focus. */
  bloomEmphasisMonths?: number[];
  /** Score bonus when bloom window overlaps bloomEmphasisMonths. Default 10. */
  bloomEmphasisBonus?: number;

  createdAt?: string;
  updatedAt?: string;
}

/** Just the payload clients send when creating/editing — no server-stamped
 *  fields, no _id, etc. */
export type DesignFormulaInput = Omit<DesignFormula, 'createdAt' | 'updatedAt'>;

/** Summary shape returned by list endpoints / wizard tiles. */
export interface DesignFormulaSummary {
  slug: string;
  name: string;
  description: string;
  author?: string;
  isBuiltIn: boolean;
  ownerId?: string;
  typeRatios: Partial<Record<PlantType, number>>;
  roleRatios: Partial<Record<OudolfRole, number>>;
  characteristicSpecies: string[];
}
