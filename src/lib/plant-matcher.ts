import { connectDB } from './db/connection';
import { Plant } from './db/models';
import type { AvailabilityType } from '@/types/plant';

export interface SupplierCatalogRow {
  scientificName?: string;
  commonName?: string;
  format?: AvailabilityType;
  sizeLabel?: string;
  price: number | null;
  inStock: boolean;
  quantity?: number | null;
  raw: Record<string, unknown>;
}

export interface MatchedRow {
  plantSlug: string;
  plantCommonName: string;
  row: SupplierCatalogRow;
  matchConfidence: 'exact' | 'fuzzy' | 'common-name';
}

/**
 * Normalize a plant name for comparison: lowercase, strip authors/cultivars,
 * collapse whitespace, remove punctuation.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/\([^)]*\)/g, '')   // strip parenthetical content
    .replace(/\bvar\.?\s+\w+/g, '') // var. xxx
    .replace(/\bssp\.?\s+\w+/g, '') // ssp. xxx
    .replace(/\bsubsp\.?\s+\w+/g, '')
    .replace(/\bf\.?\s+\w+/g, '')   // f. xxx (forma)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Take only the first two words of a scientific name (genus + species)
 * for loose matching, dropping any trailing taxonomic detail.
 */
export function binomial(name: string): string {
  const parts = normalizeName(name).split(' ');
  return parts.slice(0, 2).join(' ');
}

/**
 * Map a supplier catalog row to one of our plants (by slug).
 * Tries exact scientific match first, then binomial-only, then common name.
 */
export async function matchCatalogToPlants(
  rows: SupplierCatalogRow[],
): Promise<{ matched: MatchedRow[]; unmatched: SupplierCatalogRow[] }> {
  await connectDB();

  const plants = await Plant.find({})
    .select('slug commonName scientificName')
    .lean();

  // Build lookup maps
  const bySciFull = new Map<string, { slug: string; commonName: string }>();
  const bySciBinomial = new Map<string, { slug: string; commonName: string }>();
  const byCommon = new Map<string, { slug: string; commonName: string }>();

  for (const p of plants) {
    if (p.scientificName) {
      const full = normalizeName(p.scientificName);
      const bi = binomial(p.scientificName);
      if (!bySciFull.has(full)) {
        bySciFull.set(full, { slug: p.slug, commonName: p.commonName });
      }
      if (!bySciBinomial.has(bi)) {
        bySciBinomial.set(bi, { slug: p.slug, commonName: p.commonName });
      }
    }
    if (p.commonName) {
      const cn = normalizeName(p.commonName);
      if (!byCommon.has(cn)) {
        byCommon.set(cn, { slug: p.slug, commonName: p.commonName });
      }
    }
  }

  const matched: MatchedRow[] = [];
  const unmatched: SupplierCatalogRow[] = [];

  for (const row of rows) {
    let hit: { slug: string; commonName: string } | undefined;
    let confidence: MatchedRow['matchConfidence'] | null = null;

    if (row.scientificName) {
      const full = normalizeName(row.scientificName);
      hit = bySciFull.get(full);
      if (hit) confidence = 'exact';

      if (!hit) {
        const bi = binomial(row.scientificName);
        hit = bySciBinomial.get(bi);
        if (hit) confidence = 'fuzzy';
      }
    }

    if (!hit && row.commonName) {
      const cn = normalizeName(row.commonName);
      hit = byCommon.get(cn);
      if (hit) confidence = 'common-name';
    }

    if (hit && confidence) {
      matched.push({
        plantSlug: hit.slug,
        plantCommonName: hit.commonName,
        row,
        matchConfidence: confidence,
      });
    } else {
      unmatched.push(row);
    }
  }

  return { matched, unmatched };
}

/**
 * Infer our `AvailabilityType` (seed | plug | potted | bare_root) from a
 * free-text size/container label used by a supplier.
 */
export function inferFormat(sizeLabel: string): AvailabilityType {
  const s = sizeLabel.toLowerCase();
  if (/\bseed(s|ing)?\b|\bpacket\b|\boz\b/.test(s)) return 'seed';
  if (/\bbare\s*root\b|\bbr\b|\bdormant\b/.test(s)) return 'bare_root';
  if (/\bplug\b|\bcell\b|\btray\b|\b38[-\s]?cell\b|\b50[-\s]?cell\b|\b72[-\s]?cell\b/.test(s)) return 'plug';
  // containers: 4", gal, #1, quart, etc.
  if (/\b\d+\s*(gal|"|in|qt|quart|pot|#\d)/.test(s)) return 'potted';
  return 'potted';
}
