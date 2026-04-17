/**
 * Thin iNaturalist v1 API wrapper used by the admin lookup flow.
 *
 * Docs: https://api.inaturalist.org/v1/docs/
 *
 * We only use public endpoints and no API key. iNat asks callers to set a
 * descriptive User-Agent so they can attribute traffic — we set one below.
 *
 * Responses are cached briefly in the ApiCache collection (if MongoDB is
 * available) to avoid hammering iNat for repeated lookups during editing.
 */

import { connectDB } from '@/lib/db/connection';
import { ApiCache } from '@/lib/db/models';

const UA = 'chicago-plant-plan/0.1 (+https://github.com/chicago-plant-plan)';
const BASE = 'https://api.inaturalist.org/v1';

export interface InatTaxonHit {
  id: number;
  name: string; // scientific
  preferredCommonName: string;
  rank: string;
  family: string | null;
  photoUrl: string | null;
  photoAttribution: string | null;
  wikipediaUrl: string | null;
}

async function cachedFetch(url: string, ttlSeconds = 60 * 60 * 24) {
  // Try DB cache first
  try {
    await connectDB();
    const hit = await ApiCache.findOne({ cacheKey: url }).lean();
    if (hit && (hit as { expiresAt?: Date }).expiresAt && (hit as { expiresAt: Date }).expiresAt > new Date()) {
      return (hit as { response: unknown }).response;
    }
  } catch {
    // DB not available — fall through to live fetch without cache.
  }

  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`iNat ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const data = await res.json();

  try {
    await ApiCache.updateOne(
      { cacheKey: url },
      { $set: { response: data, fetchedAt: new Date(), expiresAt: new Date(Date.now() + ttlSeconds * 1000) } },
      { upsert: true },
    );
  } catch {
    // best-effort cache
  }

  return data;
}

function normalizeTaxon(t: Record<string, unknown>): InatTaxonHit {
  const ancestors = (t.ancestors as Array<Record<string, unknown>> | undefined) ?? [];
  const family = ancestors.find((a) => a.rank === 'family')?.name as string | undefined;
  const defaultPhoto = t.default_photo as Record<string, unknown> | undefined;
  return {
    id: t.id as number,
    name: t.name as string,
    preferredCommonName: (t.preferred_common_name as string) || '',
    rank: t.rank as string,
    family: family || null,
    photoUrl: (defaultPhoto?.medium_url as string) || null,
    photoAttribution: (defaultPhoto?.attribution as string) || null,
    wikipediaUrl: (t.wikipedia_url as string) || null,
  };
}

/**
 * Search iNat for taxa by name (common or scientific).
 * Uses /taxa (not /taxa/autocomplete) so we get ancestors (→ family) back.
 * Slightly slower than autocomplete but the family field is worth it.
 */
export async function searchTaxa(query: string, limit = 10): Promise<InatTaxonHit[]> {
  if (!query.trim()) return [];
  const url = `${BASE}/taxa?q=${encodeURIComponent(query)}&per_page=${limit}&is_active=true&rank=species,subspecies,variety&all_names=true`;
  const data = (await cachedFetch(url)) as { results?: Array<Record<string, unknown>> };
  return (data.results || []).map(normalizeTaxon);
}

/** Fetch full taxon details (includes ancestors → family) for a given id. */
export async function getTaxon(id: number): Promise<InatTaxonHit | null> {
  const url = `${BASE}/taxa/${id}`;
  const data = (await cachedFetch(url)) as { results?: Array<Record<string, unknown>> };
  const first = data.results?.[0];
  return first ? normalizeTaxon(first) : null;
}
