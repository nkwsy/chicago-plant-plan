import type { SupplierFetcher } from './types';
import { pizzoFetcher } from './pizzo';
import { midwestGroundcoversFetcher } from './midwest-groundcovers';

/**
 * Registry of automated availability fetchers, keyed by supplier slug.
 *
 * Suppliers without an entry here are assumed to not expose a public
 * availability export, and fall back to the manual email inquiry flow.
 *
 * ---
 * Current status of each supplier (as of last investigation):
 *
 *   pizzo                — SBI Team Excel export (availability + tray size only; no prices)
 *   midwest-groundcovers — Public sitemap, parsed for availability; prices require email (implemented)
 *   prairie-moon         — Retail site only; no public bulk export. Email.
 *   possibility-place    — Posts seasonal availability PDFs on their site.
 *                          Could be parsed, but format varies. Email for now.
 *   the-growing-place    — No public availability data. Email.
 *   red-buffalo          — No website; phone only. Email (if reachable).
 *   living-habitats      — Design-first studio; no public catalog. Email.
 *   red-stem             — No public availability data. Email.
 */
export const SUPPLIER_FETCHERS: Record<string, SupplierFetcher> = {
  [pizzoFetcher.supplierSlug]: pizzoFetcher,
  [midwestGroundcoversFetcher.supplierSlug]: midwestGroundcoversFetcher,
};

export function getFetcher(supplierSlug: string): SupplierFetcher | undefined {
  return SUPPLIER_FETCHERS[supplierSlug];
}

export function hasFetcher(supplierSlug: string): boolean {
  return supplierSlug in SUPPLIER_FETCHERS;
}

export function listAutomatedSuppliers(): string[] {
  return Object.keys(SUPPLIER_FETCHERS);
}

export type { SupplierFetcher } from './types';
export { FetchNotSupportedError } from './types';
