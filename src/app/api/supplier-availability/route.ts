import { NextRequest } from 'next/server';
import {
  fetchAndSaveAvailability,
  fetchAllAutomated,
  hasFetcher,
  listAutomatedSuppliers,
} from '@/lib/supplier-availability';

export const dynamic = 'force-dynamic';
// Large supplier catalogs can take > 10s to download and parse.
export const maxDuration = 60;

/**
 * GET /api/supplier-availability
 * List which suppliers support automated availability fetches.
 */
export async function GET() {
  return Response.json({
    automatedSuppliers: listAutomatedSuppliers(),
  });
}

/**
 * POST /api/supplier-availability
 * Run the automated availability fetch for a single supplier (or all).
 *
 * Body: { supplierSlug?: string }
 *   - omit supplierSlug to fetch every supplier that has an automated fetcher
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { supplierSlug } = body as { supplierSlug?: string };

    if (supplierSlug) {
      if (!hasFetcher(supplierSlug)) {
        return Response.json(
          {
            error: `No automated fetcher for supplier "${supplierSlug}". Fall back to /api/supplier-inquiry.`,
            automatedSuppliers: listAutomatedSuppliers(),
          },
          { status: 400 },
        );
      }
      const result = await fetchAndSaveAvailability(supplierSlug);
      return Response.json({ results: [result] });
    }

    const results = await fetchAllAutomated();
    return Response.json({ results });
  } catch (error) {
    console.error('Error fetching supplier availability:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: msg }, { status: 500 });
  }
}
