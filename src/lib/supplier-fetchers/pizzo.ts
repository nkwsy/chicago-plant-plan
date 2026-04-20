import * as XLSX from 'xlsx';
import type { SupplierFetcher } from './types';
import type { SupplierCatalogRow } from '../plant-matcher';

const PIZZO_AVAIL_URL =
  'https://pizzo.online-orders.sbiteam.com/api/v1/public/avail/excel?templateId=1';

/**
 * Try each of a set of likely column header names and return the first
 * matching value from a row.
 */
function pick(
  row: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    if (c in row && row[c] != null && row[c] !== '') {
      return String(row[c]).trim();
    }
    const cNorm = c.toLowerCase().replace(/\s+/g, '');
    const hit = keys.find(k => k.toLowerCase().replace(/\s+/g, '') === cNorm);
    if (hit && row[hit] != null && row[hit] !== '') {
      return String(row[hit]).trim();
    }
  }
  return undefined;
}

function parseQty(raw: string | undefined): number | null {
  if (!raw) return null;
  if (/out/i.test(raw)) return 0;
  const n = Number.parseInt(raw.replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pizzo Native Plant Nursery publishes a public availability spreadsheet
 * via the SBI Team online ordering platform. The export schema (as of
 * 2026-04) is:
 *
 *   Item # | Scientific Name | Common Name | Plugs Avail | Tray Size
 *          | Wetland Indicator | Soil Type
 *
 * Notes:
 *   - No price column. Pizzo's retail pricing is not in this export — it
 *     must be requested by email, same as Midwest Groundcovers.
 *   - "Plugs Avail" is a numeric stock count (0 = out of stock).
 *   - "Tray Size" is cell count per tray (e.g. 32 = 32-cell plug tray).
 *   - Everything in this export is plug-format; there are no potted/gallon
 *     rows here.
 */
export const pizzoFetcher: SupplierFetcher = {
  supplierSlug: 'pizzo',
  source: 'Pizzo SBI Team public availability Excel export (plug availability only; no prices)',
  async fetch(): Promise<SupplierCatalogRow[]> {
    const res = await fetch(PIZZO_AVAIL_URL, {
      headers: {
        'User-Agent': 'chicago-plant-plan/1.0 (+availability sync)',
      },
    });
    if (!res.ok) {
      throw new Error(`Pizzo availability fetch failed: ${res.status} ${res.statusText}`);
    }

    const buf = await res.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });

    const rows: SupplierCatalogRow[] = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
        raw: false,
      });

      for (const rawRow of json) {
        const sci = pick(rawRow, [
          'Scientific Name',
          'Botanical Name',
          'Latin Name',
          'Species',
        ]);
        const common = pick(rawRow, [
          'Common Name',
          'Common',
        ]);

        if (!sci && !common) continue;

        const trayCells = pick(rawRow, ['Tray Size', 'Cells', 'Cell Count']);
        const sizeLabel = trayCells ? `${trayCells}-cell plug` : 'plug';

        const qtyRaw = pick(rawRow, [
          'Plugs Avail',
          'Plugs Available',
          'Available',
          'Quantity',
          'Qty',
          'In Stock',
          'Stock',
        ]);

        const qty = parseQty(qtyRaw);
        // Pizzo's export gives a concrete count, so treat 0/null as out of stock.
        const inStock = qty !== null && qty > 0;

        rows.push({
          scientificName: sci,
          commonName: common,
          sizeLabel,
          format: 'plug',
          price: null, // Pizzo's public export has no price column
          inStock,
          quantity: qty,
          raw: rawRow,
        });
      }
    }

    return rows;
  },
};
