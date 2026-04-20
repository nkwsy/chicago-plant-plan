/**
 * Claude-powered enrichment for plant entries.
 *
 * Given a (possibly partial) plant record, this asks Claude to fill any
 * missing fields using its botanical knowledge, scoped to Chicagoland /
 * Upper Midwest native horticulture.
 *
 * - Uses strict tool-use JSON output so the model can't drift into prose.
 * - Uses prompt caching on the long system prompt — every enrichment in a
 *   session reuses the same cached prefix, so per-call cost is mostly just
 *   the small per-plant user message.
 * - If ANTHROPIC_API_KEY is not set, returns {skipped:true} so the caller
 *   can display a helpful message rather than crashing.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Plant } from '@/types/plant';

const MODEL = 'claude-sonnet-4-5';

// Valid enum values live in one place so both the prompt and the runtime
// validation agree.
const ENUMS = {
  plantType: ['forb', 'grass', 'sedge', 'shrub', 'tree', 'vine', 'fern'],
  sun: ['full_sun', 'part_sun', 'part_shade', 'full_shade'],
  moisture: ['dry', 'medium', 'wet'],
  soilTypes: ['clay', 'loam', 'sand'],
  nativeHabitats: ['prairie', 'woodland', 'wetland', 'savanna'],
  wildlifeValue: ['pollinators', 'birds', 'butterflies', 'mammals'],
  effortLevel: ['low', 'medium', 'high'],
  oudolfRole: ['matrix', 'structure', 'scatter', 'filler'],
} as const;

const SYSTEM = `You are a horticulturalist specialized in Chicagoland and Upper Midwest native plants. You help curate a database of plants suitable for ecological landscaping in USDA zones 5b–6a (Chicago, IL and surrounds).

For each species the user asks about, fill in any missing fields using established botanical and horticultural knowledge. Be conservative — if you genuinely don't know a value, leave the field null rather than guessing. If the species is not native to the Chicagoland / Upper Midwest region, note that in \`nonNativeWarning\` but still fill other fields.

Units:
- Heights and spreads are in INCHES. Trees commonly range 240–1440.
- Bloom months are integers 1–12. Use bloomStartMonth == bloomEndMonth for a tight window. For foliage-only plants (ferns) use 1 for both.

Constraints:
- Arrays should list only truly applicable values. A plant that tolerates only dry sites should not list 'wet'.
- \`description\`, \`careNotes\`, and \`plantingInstructions\` should each be 1–3 sentences of concrete, useful text — no marketing fluff.
- Never invent supplier information.

Oudolf / design-formula metadata (used by the planner to honor a chosen design style):
- \`oudolfRole\` — how this plant functions in a naturalistic composition:
  • "matrix": the repeating base — typically warm-season grasses (Schizachyrium, Sporobolus, Panicum) and durable mid-height perennials that read as a tapestry (e.g. Pycnanthemum).
  • "structure": taller architectural plants that anchor the eye and punctuate the matrix (Echinacea, Baptisia, Veronicastrum, Eutrochium, Silphium).
  • "scatter": accent species woven through in small numbers for seasonal highlights (Liatris, Monarda, Asclepias).
  • "filler": short-lived or ephemeral plants that plug gaps in spring or early in a planting's life (Aquilegia, Rudbeckia hirta, ephemerals).
  Pick the SINGLE role that best fits how the plant is typically used. Trees/large shrubs can be null if no role applies.
- \`seedHeadInterest\`: true when the plant's seed heads persist attractively after bloom (Echinacea, Rudbeckia, most grasses, Eryngium). False for plants that go messy or disappear after flowering (most ephemerals, mints).
- \`winterStructure\`: true when the plant holds architectural form through winter — dried stems, seed heads, or evergreen foliage standing above the snow (grasses, Echinacea, Rudbeckia, Baptisia, evergreen ferns). False for plants that flop or disappear after frost.`;

// Tool schema forces JSON output and the valid enum set. Typed as Anthropic.Tool
// (not `as const`) because the SDK's Tool.input_schema.required wants a mutable
// `string[]`, which a readonly const tuple doesn't satisfy.
const ENRICH_TOOL: Anthropic.Tool = {
  name: 'enrich_plant',
  description: 'Return enriched plant data for a single species.',
  input_schema: {
    type: 'object',
    properties: {
      family: { type: ['string', 'null'] },
      plantType: { type: ['string', 'null'], enum: [...ENUMS.plantType, null] },
      heightMinInches: { type: ['number', 'null'] },
      heightMaxInches: { type: ['number', 'null'] },
      spreadMinInches: { type: ['number', 'null'] },
      spreadMaxInches: { type: ['number', 'null'] },
      sun: { type: 'array', items: { type: 'string', enum: [...ENUMS.sun] } },
      moisture: { type: 'array', items: { type: 'string', enum: [...ENUMS.moisture] } },
      soilTypes: { type: 'array', items: { type: 'string', enum: [...ENUMS.soilTypes] } },
      bloomStartMonth: { type: ['number', 'null'], minimum: 1, maximum: 12 },
      bloomEndMonth: { type: ['number', 'null'], minimum: 1, maximum: 12 },
      bloomColor: { type: ['string', 'null'] },
      nativeHabitats: { type: 'array', items: { type: 'string', enum: [...ENUMS.nativeHabitats] } },
      wildlifeValue: { type: 'array', items: { type: 'string', enum: [...ENUMS.wildlifeValue] } },
      effortLevel: { type: ['string', 'null'], enum: [...ENUMS.effortLevel, null] },
      deerResistant: { type: ['boolean', 'null'] },
      description: { type: ['string', 'null'] },
      careNotes: { type: ['string', 'null'] },
      plantingInstructions: { type: ['string', 'null'] },
      nonNativeWarning: { type: ['string', 'null'] },
      oudolfRole: { type: ['string', 'null'], enum: [...ENUMS.oudolfRole, null] },
      seedHeadInterest: { type: ['boolean', 'null'] },
      winterStructure: { type: ['boolean', 'null'] },
    },
    required: [],
  },
};

export interface EnrichmentResult {
  ok: true;
  patch: Partial<Plant> & { nonNativeWarning?: string | null };
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
}
export interface EnrichmentSkipped {
  ok: false;
  reason: string;
}

function getClient(): Anthropic | null {
  // Support both authentication modes the SDK accepts:
  //   - `apiKey`   → `x-api-key` header. Standard developer API key.
  //   - `authToken` → `Authorization: Bearer …`. Used by OAuth tokens
  //     (`sk-ant-o…` prefix), including Claude Code's own credentials —
  //     lets this pipeline run under `npx tsx` inside a Claude Code
  //     session without plumbing a separate API key.
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return new Anthropic({ apiKey: key });
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (authToken) return new Anthropic({ authToken });
  return null;
}

/**
 * Ask Claude to fill missing fields for a single plant.
 * Only empty/falsy fields on `current` will be considered "missing" and asked
 * for; caller is responsible for merging the returned patch onto the record.
 */
export async function enrichPlant(current: Partial<Plant>): Promise<EnrichmentResult | EnrichmentSkipped> {
  const client = getClient();
  if (!client) {
    return { ok: false, reason: 'ANTHROPIC_API_KEY not configured' };
  }
  if (!current.scientificName && !current.commonName) {
    return { ok: false, reason: 'Need at least a scientificName or commonName' };
  }

  const missing = describeMissing(current);
  const userMsg = [
    `Species: ${current.scientificName || '(unknown)'}${current.commonName ? ` — ${current.commonName}` : ''}`,
    current.family ? `Family: ${current.family}` : null,
    current.plantType ? `Type: ${current.plantType}` : null,
    '',
    `Fields needing values: ${missing.length ? missing.join(', ') : '(none identified — verify existing values only)'}`,
    '',
    'Please call enrich_plant with the values you are confident about. Leave fields null/empty when unsure.',
  ].filter(Boolean).join('\n');

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    tools: [ENRICH_TOOL],
    tool_choice: { type: 'tool', name: 'enrich_plant' },
    messages: [{ role: 'user', content: userMsg }],
  });

  const toolUse = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) {
    return { ok: false, reason: 'No tool_use in Claude response' };
  }

  const patch = sanitizePatch(toolUse.input as Record<string, unknown>, current);

  return {
    ok: true,
    patch,
    usage: {
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      cacheReadTokens: resp.usage.cache_read_input_tokens ?? undefined,
    },
  };
}

function describeMissing(p: Partial<Plant>): string[] {
  const missing: string[] = [];
  if (!p.family) missing.push('family');
  if (!p.plantType) missing.push('plantType');
  if (!p.heightMinInches || !p.heightMaxInches) missing.push('height range (inches)');
  if (!p.spreadMinInches || !p.spreadMaxInches) missing.push('spread range (inches)');
  if (!p.sun?.length) missing.push('sun');
  if (!p.moisture?.length) missing.push('moisture');
  if (!p.soilTypes?.length) missing.push('soilTypes');
  if (!p.bloomStartMonth || !p.bloomEndMonth) missing.push('bloom months');
  if (!p.bloomColor) missing.push('bloomColor');
  if (!p.nativeHabitats?.length) missing.push('nativeHabitats');
  if (!p.wildlifeValue?.length) missing.push('wildlifeValue');
  if (!p.effortLevel) missing.push('effortLevel');
  if (typeof p.deerResistant !== 'boolean') missing.push('deerResistant');
  if (!p.description) missing.push('description');
  if (!p.careNotes) missing.push('careNotes');
  if (!p.plantingInstructions) missing.push('plantingInstructions');
  if (!p.oudolfRole) missing.push('oudolfRole');
  if (typeof p.seedHeadInterest !== 'boolean') missing.push('seedHeadInterest');
  if (typeof p.winterStructure !== 'boolean') missing.push('winterStructure');
  return missing;
}

/**
 * Clean up Claude's output:
 *  - drop nulls
 *  - clamp enum arrays to valid values
 *  - only include fields the caller didn't already have (preserve curator edits)
 */
function sanitizePatch(
  raw: Record<string, unknown>,
  current: Partial<Plant>,
): Partial<Plant> & { nonNativeWarning?: string | null } {
  const patch: Record<string, unknown> = {};

  const filterEnum = (arr: unknown, allowed: readonly string[]) =>
    Array.isArray(arr) ? (arr as unknown[]).filter((v): v is string => typeof v === 'string' && allowed.includes(v)) : [];

  if (!current.family && typeof raw.family === 'string') patch.family = raw.family;
  if (!current.plantType && typeof raw.plantType === 'string' && ENUMS.plantType.includes(raw.plantType as typeof ENUMS.plantType[number])) {
    patch.plantType = raw.plantType;
  }
  if (!current.heightMinInches && typeof raw.heightMinInches === 'number') patch.heightMinInches = raw.heightMinInches;
  if (!current.heightMaxInches && typeof raw.heightMaxInches === 'number') patch.heightMaxInches = raw.heightMaxInches;
  if (!current.spreadMinInches && typeof raw.spreadMinInches === 'number') patch.spreadMinInches = raw.spreadMinInches;
  if (!current.spreadMaxInches && typeof raw.spreadMaxInches === 'number') patch.spreadMaxInches = raw.spreadMaxInches;

  if (!current.sun?.length) {
    const v = filterEnum(raw.sun, ENUMS.sun);
    if (v.length) patch.sun = v;
  }
  if (!current.moisture?.length) {
    const v = filterEnum(raw.moisture, ENUMS.moisture);
    if (v.length) patch.moisture = v;
  }
  if (!current.soilTypes?.length) {
    const v = filterEnum(raw.soilTypes, ENUMS.soilTypes);
    if (v.length) patch.soilTypes = v;
  }

  if (!current.bloomStartMonth && typeof raw.bloomStartMonth === 'number') patch.bloomStartMonth = raw.bloomStartMonth;
  if (!current.bloomEndMonth && typeof raw.bloomEndMonth === 'number') patch.bloomEndMonth = raw.bloomEndMonth;
  if (!current.bloomColor && typeof raw.bloomColor === 'string') patch.bloomColor = raw.bloomColor;

  if (!current.nativeHabitats?.length) {
    const v = filterEnum(raw.nativeHabitats, ENUMS.nativeHabitats);
    if (v.length) patch.nativeHabitats = v;
  }
  if (!current.wildlifeValue?.length) {
    const v = filterEnum(raw.wildlifeValue, ENUMS.wildlifeValue);
    if (v.length) patch.wildlifeValue = v;
  }

  if (!current.effortLevel && typeof raw.effortLevel === 'string' && ENUMS.effortLevel.includes(raw.effortLevel as typeof ENUMS.effortLevel[number])) {
    patch.effortLevel = raw.effortLevel;
  }
  if (typeof current.deerResistant !== 'boolean' && typeof raw.deerResistant === 'boolean') {
    patch.deerResistant = raw.deerResistant;
  }

  if (!current.description && typeof raw.description === 'string') patch.description = raw.description.trim();
  if (!current.careNotes && typeof raw.careNotes === 'string') patch.careNotes = raw.careNotes.trim();
  if (!current.plantingInstructions && typeof raw.plantingInstructions === 'string') patch.plantingInstructions = raw.plantingInstructions.trim();

  if (typeof raw.nonNativeWarning === 'string' && raw.nonNativeWarning.trim()) {
    (patch as Record<string, unknown>).nonNativeWarning = raw.nonNativeWarning.trim();
  }

  // Oudolf metadata. Unlike the scalar fields above these OVERWRITE existing
  // values if present — the roles are a subjective judgment and re-running
  // the enrichment should be allowed to correct a bad classification. If a
  // curator has manually set the role they can flip `lastEnrichedAt` or
  // unset the field in the admin UI before re-running.
  if (typeof raw.oudolfRole === 'string' && ENUMS.oudolfRole.includes(raw.oudolfRole as typeof ENUMS.oudolfRole[number])) {
    patch.oudolfRole = raw.oudolfRole;
  }
  if (typeof raw.seedHeadInterest === 'boolean') patch.seedHeadInterest = raw.seedHeadInterest;
  if (typeof raw.winterStructure === 'boolean') patch.winterStructure = raw.winterStructure;

  return patch as Partial<Plant> & { nonNativeWarning?: string | null };
}
