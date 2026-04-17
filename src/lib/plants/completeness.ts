import type { Plant } from '@/types/plant';

/**
 * Score 0-100 reflecting how "complete" a plant entry is.
 * Used to surface plants needing curation work, and to decide which
 * entries the batch enrichment routine should target.
 */
export interface CompletenessReport {
  score: number;
  missing: string[];
  weak: string[];
}

const HEAVY_TEXT_MIN = 40; // description/care/planting prose must be at least this long

export function computeCompleteness(p: Partial<Plant>): CompletenessReport {
  const missing: string[] = [];
  const weak: string[] = [];

  // Required identity
  if (!p.commonName) missing.push('commonName');
  if (!p.scientificName) missing.push('scientificName');
  if (!p.family) missing.push('family');
  if (!p.plantType) missing.push('plantType');

  // Growing conditions
  if (!p.sun?.length) missing.push('sun');
  if (!p.moisture?.length) missing.push('moisture');
  if (!p.soilTypes?.length) missing.push('soilTypes');

  // Size
  if (!p.heightMinInches && !p.heightMaxInches) missing.push('height');
  if (!p.spreadMinInches && !p.spreadMaxInches) missing.push('spread');

  // Bloom
  if (!p.bloomStartMonth || !p.bloomEndMonth) missing.push('bloom');
  if (!p.bloomColor) missing.push('bloomColor');

  // Ecology
  if (!p.nativeHabitats?.length) missing.push('nativeHabitats');
  if (!p.wildlifeValue?.length) weak.push('wildlifeValue');

  // Textual
  if (!p.description) missing.push('description');
  else if (p.description.length < HEAVY_TEXT_MIN) weak.push('description');

  if (!p.careNotes) weak.push('careNotes');
  else if (p.careNotes.length < HEAVY_TEXT_MIN) weak.push('careNotes');

  if (!p.plantingInstructions) weak.push('plantingInstructions');
  else if (p.plantingInstructions.length < HEAVY_TEXT_MIN) weak.push('plantingInstructions');

  // Effort (has a default, rarely missing)
  if (!p.effortLevel) weak.push('effortLevel');

  // Total possible strikes: missing counts double, weak counts single.
  const total = 20; // rough denominator — tuned so a complete plant hits 100
  const penalty = missing.length * 2 + weak.length;
  const score = Math.max(0, Math.round(100 - (penalty / total) * 100));

  return { score, missing, weak };
}

export function isIncomplete(p: Partial<Plant>, threshold = 80): boolean {
  return computeCompleteness(p).score < threshold;
}
