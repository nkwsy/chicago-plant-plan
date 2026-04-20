import type { SupplierCatalogRow } from '../plant-matcher';

/**
 * A supplier fetcher knows how to retrieve a current availability/price list
 * from a single supplier. Returns a normalized set of catalog rows.
 *
 * Fetchers should throw on hard failures (network error, parsing error)
 * so the caller can log and fall back to an email inquiry.
 */
export interface SupplierFetcher {
  supplierSlug: string;
  /** Human-readable description of how this fetcher works, for logs. */
  source: string;
  /** Fetch the current catalog for this supplier. */
  fetch(): Promise<SupplierCatalogRow[]>;
}

export class FetchNotSupportedError extends Error {
  constructor(supplierSlug: string) {
    super(`Automated availability fetch is not supported for ${supplierSlug}`);
    this.name = 'FetchNotSupportedError';
  }
}
