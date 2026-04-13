interface FloodResult {
  floodZone: string | null;
  isFloodHazard: boolean;
  description: string;
}

export async function queryFloodZone(lat: number, lng: number): Promise<FloodResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const url = `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?` +
      `geometry=${lng},${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects` +
      `&outFields=FLD_ZONE,SFHA_TF,ZONE_SUBTY&returnGeometry=false&f=json`;

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return { floodZone: null, isFloodHazard: false, description: 'Flood data unavailable' };
    }

    const data = await response.json();

    if (!data?.features || data.features.length === 0) {
      return { floodZone: null, isFloodHazard: false, description: 'Not in a mapped flood zone' };
    }

    const attrs = data.features[0].attributes;
    const zone = attrs.FLD_ZONE || null;
    const isSFHA = attrs.SFHA_TF === 'T';

    return {
      floodZone: zone,
      isFloodHazard: isSFHA,
      description: getFloodZoneDescription(zone),
    };
  } catch (error) {
    console.error('Flood zone query error:', error);
    return { floodZone: null, isFloodHazard: false, description: 'Flood data unavailable' };
  }
}

function getFloodZoneDescription(zone: string | null): string {
  if (!zone) return 'No flood zone data available';

  const descriptions: Record<string, string> = {
    'A': 'High-risk flood zone (1% annual chance)',
    'AE': 'High-risk flood zone with established base flood elevation',
    'AH': 'High-risk shallow flooding area (1-3 feet)',
    'AO': 'High-risk sheet flow area',
    'V': 'High-risk coastal flood zone',
    'VE': 'High-risk coastal flood zone with wave action',
    'X': 'Minimal flood risk',
    'B': 'Moderate flood risk (0.2% annual chance)',
    'C': 'Minimal flood risk',
    'D': 'Undetermined flood risk',
  };

  return descriptions[zone] || `Flood zone ${zone}`;
}
