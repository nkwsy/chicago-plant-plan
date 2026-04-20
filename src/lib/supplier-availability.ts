import { connectDB } from './db/connection';
import { Plant } from './db/models';
import {
  getFetcher,
  hasFetcher,
  listAutomatedSuppliers,
  FetchNotSupportedError,
} from './supplier-fetchers';
import { matchCatalogToPlants } from './plant-matcher';
import type { SupplierCatalogRow, MatchedRow } from './plant-matcher';
import type { AvailabilityType } from '@/types/plant';

export interface FetchResult {
  supplierSlug: string;
  source: string;
  rowsFetched: number;
  matchedCount: number;
  unmatchedCount: number;
  plantsUpdated: number;
  unmatched: { scientificName?: string; commonName?: string; sizeLabel?: string }[];
  /** For diagnostics: column headers present in the fetched catalog. */
  columnHeaders?: string[];
  /** For diagnostics: first raw row from the catalog (all columns). */
  sampleRawRow?: Record<string, unknown>;
  error?: string;
}

/**
 * Group matched rows by plant slug, then collapse into one pricing
 * entry per format. If the same format appears multiple times (different
 * container sizes), we keep the lowest in-stock price.
 */
function collapsePricing(
  matched: MatchedRow[],
): Map<string, { format: AvailabilityType; price: number | null; inStock: boolean }[]> {
  const byPlant = new Map<string, MatchedRow[]>();
  for (const m of matched) {
    const arr = byPlant.get(m.plantSlug) || [];
    arr.push(m);
    byPlant.set(m.plantSlug, arr);
  }

  const out = new Map<
    string,
    { format: AvailabilityType; price: number | null; inStock: boolean }[]
  >();

  for (const [slug, rows] of byPlant) {
    const byFormat = new Map<
      AvailabilityType,
      { format: AvailabilityType; price: number | null; inStock: boolean }
    >();
    for (const r of rows) {
      const fmt = (r.row.format || 'potted') as AvailabilityType;
      const existing = byFormat.get(fmt);
      if (!existing) {
        byFormat.set(fmt, {
          format: fmt,
          price: r.row.price,
          inStock: r.row.inStock,
        });
      } else {
        // Merge: prefer in-stock, prefer lowest price
        const merged = { ...existing };
        merged.inStock = merged.inStock || r.row.inStock;
        if (
          r.row.price != null &&
          (merged.price == null || r.row.price < merged.price)
        ) {
          merged.price = r.row.price;
        }
        byFormat.set(fmt, merged);
      }
    }
    out.set(slug, [...byFormat.values()]);
  }

  return out;
}

/**
 * Save pricing into the Plant collection. For each plant with matched
 * rows, update the supplier entry's `pricing[]`, `availability[]`,
 * and `lastPriceUpdate`. If the supplier wasn't previously on the
 * plant, add them.
 */
async function persistPricing(
  supplierSlug: string,
  pricingBySlug: Map<
    string,
    { format: AvailabilityType; price: number | null; inStock: boolean }[]
  >,
): Promise<number> {
  await connectDB();
  let updated = 0;

  for (const [plantSlug, pricing] of pricingBySlug) {
    const availability = pricing
      .filter(p => p.inStock)
      .map(p => p.format);
    // dedupe
    const uniqueAvail = Array.from(new Set(availability));

    const hasSupplier = await Plant.exists({
      slug: plantSlug,
      'suppliers.supplierSlug': supplierSlug,
    });

    if (hasSupplier) {
      const result = await Plant.updateOne(
        { slug: plantSlug, 'suppliers.supplierSlug': supplierSlug },
        {
          $set: {
            'suppliers.$.pricing': pricing,
            'suppliers.$.availability': uniqueAvail,
            'suppliers.$.lastPriceUpdate': new Date(),
          },
        },
      );
      if (result.modifiedCount > 0) updated++;
    } else {
      const result = await Plant.updateOne(
        { slug: plantSlug },
        {
          $push: {
            suppliers: {
              supplierSlug,
              availability: uniqueAvail,
              pricing,
              lastPriceUpdate: new Date(),
            },
          },
        },
      );
      if (result.modifiedCount > 0) updated++;
    }
  }

  return updated;
}

/**
 * Run an automated availability fetch for one supplier and save the
 * results to the database.
 */
export async function fetchAndSaveAvailability(
  supplierSlug: string,
): Promise<FetchResult> {
  const fetcher = getFetcher(supplierSlug);
  if (!fetcher) {
    throw new FetchNotSupportedError(supplierSlug);
  }

  let rows: SupplierCatalogRow[];
  try {
    rows = await fetcher.fetch();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      supplierSlug,
      source: fetcher.source,
      rowsFetched: 0,
      matchedCount: 0,
      unmatchedCount: 0,
      plantsUpdated: 0,
      unmatched: [],
      error: msg,
    };
  }

  const { matched, unmatched } = await matchCatalogToPlants(rows);
  const pricingBySlug = collapsePricing(matched);
  const plantsUpdated = await persistPricing(supplierSlug, pricingBySlug);

  const firstRaw = rows[0]?.raw;
  const columnHeaders = firstRaw ? Object.keys(firstRaw) : undefined;

  return {
    supplierSlug,
    source: fetcher.source,
    rowsFetched: rows.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    plantsUpdated,
    unmatched: unmatched.slice(0, 25).map(u => ({
      scientificName: u.scientificName,
      commonName: u.commonName,
      sizeLabel: u.sizeLabel,
    })),
    columnHeaders,
    sampleRawRow: firstRaw,
  };
}

/**
 * Run fetches for every supplier that has an automated fetcher.
 */
export async function fetchAllAutomated(): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  for (const slug of listAutomatedSuppliers()) {
    try {
      results.push(await fetchAndSaveAvailability(slug));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        supplierSlug: slug,
        source: 'unknown',
        rowsFetched: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        plantsUpdated: 0,
        unmatched: [],
        error: msg,
      });
    }
  }
  return results;
}

export { hasFetcher, listAutomatedSuppliers };
