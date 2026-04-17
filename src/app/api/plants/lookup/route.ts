/**
 * Plant species lookup via iNaturalist.
 *
 * Used by the admin "new plant" page to auto-populate scientific name,
 * family, common name, and a photo URL from a user-typed common or
 * scientific name. Returns up to 10 candidate taxa.
 */

import { NextResponse } from 'next/server';
import { searchTaxa, getTaxon } from '@/lib/plants/inaturalist';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const id = searchParams.get('id');

  try {
    if (id) {
      const taxon = await getTaxon(Number(id));
      if (!taxon) return NextResponse.json({ error: 'not found' }, { status: 404 });
      return NextResponse.json(taxon);
    }
    if (!q) return NextResponse.json({ results: [] });
    const results = await searchTaxa(q, 10);
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
