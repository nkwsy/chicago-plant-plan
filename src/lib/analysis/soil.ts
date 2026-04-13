interface SoilResult {
  soilType: string;
  drainage: string;
  description: string;
  hydricRating: string;
}

const DEFAULT_SOIL: SoilResult = {
  soilType: 'clay_loam',
  drainage: 'Moderately well drained',
  description: 'Typical Chicagoland clay-loam soil (estimated)',
  hydricRating: 'C',
};

export async function querySoilData(lat: number, lng: number): Promise<SoilResult> {
  const query = `SELECT TOP 1 musym, muname, drclassdcd, hydgrpdcd, taxsubgrp FROM mapunit mu INNER JOIN component c ON c.mukey = mu.mukey WHERE mu.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('POINT(${lng.toFixed(6)} ${lat.toFixed(6)})')) AND c.comppct_r = (SELECT MAX(comppct_r) FROM component cc WHERE cc.mukey = mu.mukey)`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `QUERY=${encodeURIComponent(query)}&FORMAT=JSON+COLUMNNAME`,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error('USDA soil query failed:', response.status);
      return DEFAULT_SOIL;
    }

    const text = await response.text();
    if (!text || text.trim().length === 0) return DEFAULT_SOIL;

    const data = JSON.parse(text);
    if (!data?.Table || data.Table.length === 0) return DEFAULT_SOIL;

    const row = data.Table[0];
    return {
      soilType: mapSoilType(row.taxsubgrp || '', row.muname || ''),
      drainage: row.drclassdcd || 'Moderately well drained',
      description: row.muname || 'Unknown soil',
      hydricRating: row.hydgrpdcd || 'C',
    };
  } catch (error) {
    console.error('Soil query error:', error);
    return DEFAULT_SOIL;
  }
}

function mapSoilType(taxonomy: string, name: string): string {
  const combined = (taxonomy + ' ' + name).toLowerCase();
  if (combined.includes('sand')) return 'sand';
  if (combined.includes('clay')) return 'clay';
  if (combined.includes('silt')) return 'loam';
  if (combined.includes('loam')) return 'loam';
  if (combined.includes('muck') || combined.includes('peat')) return 'muck';
  return 'clay_loam';
}

export function drainageToMoisture(drainage: string): 'dry' | 'medium' | 'wet' {
  const d = drainage.toLowerCase();
  if (d.includes('excessive') || d.includes('somewhat excessive')) return 'dry';
  if (d.includes('well drain') && !d.includes('poorly')) return 'medium';
  if (d.includes('moderately well')) return 'medium';
  if (d.includes('somewhat poorly') || d.includes('poorly') || d.includes('very poorly')) return 'wet';
  return 'medium';
}
