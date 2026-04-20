import type { SupplierFetcher } from './types';
import type { SupplierCatalogRow } from '../plant-matcher';
import type { AvailabilityType } from '@/types/plant';

const SITEMAP_URL = 'https://www.midwestgroundcovers.com/sitemap_0.xml';
const SITEMAP_INDEX_URL = 'https://www.midwestgroundcovers.com/sitemap.xml';

/**
 * Extract all <loc>…</loc> URLs from an XML sitemap body.
 * Supports both sitemap-index files (pointing to child sitemaps) and
 * urlset files (containing product URLs).
 */
function extractLocs(xml: string): string[] {
  const matches = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
  return matches.map(m => m.replace(/<\/?loc>/g, '').trim());
}

/**
 * Midwest Groundcovers product URLs follow a slug pattern like:
 *   /rosa-drift-coral-11-3-16
 *   /cornus-alba-ivory-halo-11-5-20003.5g
 *   /asarum-canadense-pint-20013.pt
 *   /thymus-praecox-coccineus-3-7-cell-20016.03
 *   /panicum-virg-northwind-11-1-20056.1g
 *
 * The genus + species (or abbreviated genus like `panicum-virg`) appears at
 * the start. A numeric SKU follows, sometimes with a size suffix after a `.`
 * (`1g`, `3g`, `5g`, `pt`, `03`, `25`, etc.).
 */
interface ParsedSlug {
  genus: string;
  species: string;
  sizeToken: string;
}

function parseSlug(pathname: string): ParsedSlug | null {
  // Strip leading slash
  const slug = pathname.replace(/^\/+/, '');
  if (!slug) return null;

  // Size suffix: the last dotted segment often encodes container size.
  //   ...20003.5g    -> 5g
  //   ...20016.03    -> 03   (plug cell code)
  //   ...20013.pt    -> pt   (pint)
  const sizeMatch = slug.match(/\.([a-z0-9]+)$/i);
  const sizeToken = sizeMatch ? sizeMatch[1] : '';

  // Take just the leading non-numeric, hyphen-separated tokens
  // before we start hitting SKU-style numbers.
  const tokens = slug.split('-');
  const nameTokens: string[] = [];
  for (const t of tokens) {
    // Stop once we hit a purely numeric or number-heavy token — that's the SKU.
    if (/^\d/.test(t)) break;
    nameTokens.push(t);
  }

  if (nameTokens.length < 2) return null;

  // Heuristic: first token = genus, second = species.
  // Some MGC slugs abbreviate the genus (e.g. `panicum-virg`), but the matcher
  // will fall back to binomial matching on normalized names regardless.
  const genus = nameTokens[0];
  const species = nameTokens[1];
  return { genus, species, sizeToken };
}

/**
 * Convert a Midwest Groundcovers size token into one of our standard
 * availability formats.
 */
function tokenToFormat(token: string): AvailabilityType {
  const t = token.toLowerCase();
  if (/^\d+g$/.test(t)) return 'potted';      // 1g, 3g, 5g (gallon)
  if (t === 'pt') return 'potted';             // pint
  if (t === 'qt') return 'potted';             // quart
  if (/^0\d$/.test(t) || t === 'cell' || t === 'plug') return 'plug'; // 03, 04 cell
  if (/^\d{2}$/.test(t)) return 'plug';        // 2-digit often = cell tray
  return 'potted';
}

/**
 * Midwest Groundcovers is wholesale-only and doesn't expose prices
 * without a login. But their sitemap lists every product page, and each URL
 * slug encodes genus, species (or abbreviation), and container size.
 *
 * We harvest the sitemap to learn which plants they carry and in which
 * formats. Pricing is left `null` — the biweekly inquiry email will
 * follow up for current prices.
 */
export const midwestGroundcoversFetcher: SupplierFetcher = {
  supplierSlug: 'midwest-groundcovers',
  source: 'Midwest Groundcovers public sitemap (availability only, no pricing)',
  async fetch(): Promise<SupplierCatalogRow[]> {
    // 1. Grab the sitemap index and resolve all child sitemap URLs.
    const indexRes = await fetch(SITEMAP_INDEX_URL, {
      headers: { 'User-Agent': 'chicago-plant-plan/1.0 (+availability sync)' },
    });
    if (!indexRes.ok) {
      throw new Error(
        `Midwest Groundcovers sitemap index fetch failed: ${indexRes.status}`,
      );
    }
    const indexXml = await indexRes.text();

    let childSitemaps = extractLocs(indexXml).filter(u =>
      /sitemap.*\.xml$/i.test(u),
    );
    // Fallback if the index file was actually a urlset.
    if (childSitemaps.length === 0) {
      childSitemaps = [SITEMAP_URL];
    }

    // 2. Fetch each child sitemap and collect product URLs.
    const productUrls: string[] = [];
    for (const sm of childSitemaps) {
      try {
        const res = await fetch(sm, {
          headers: { 'User-Agent': 'chicago-plant-plan/1.0 (+availability sync)' },
        });
        if (!res.ok) continue;
        const xml = await res.text();
        const locs = extractLocs(xml);
        // Keep only leaf URLs (not nested sitemaps)
        for (const loc of locs) {
          if (!/\.xml$/i.test(loc)) productUrls.push(loc);
        }
      } catch {
        // Skip any individual child sitemap that fails
      }
    }

    // 3. Parse product URLs into catalog rows.
    const rows: SupplierCatalogRow[] = [];
    const seen = new Set<string>();

    for (const u of productUrls) {
      let pathname: string;
      try {
        pathname = new URL(u).pathname;
      } catch {
        continue;
      }

      const parsed = parseSlug(pathname);
      if (!parsed) continue;

      const scientificName = `${parsed.genus} ${parsed.species}`;
      const sizeLabel = parsed.sizeToken;
      const format = tokenToFormat(parsed.sizeToken);

      // Dedupe on scientific-name + format so one row per binomial/format.
      const key = `${scientificName.toLowerCase()}|${format}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        scientificName,
        commonName: undefined,
        sizeLabel,
        format,
        price: null, // unknown without wholesale login
        inStock: true, // presence in sitemap implies carried; assume available
        quantity: null,
        raw: { productUrl: u, sizeToken: sizeLabel },
      });
    }

    return rows;
  },
};
