/**
 * Fetches plant images from iNaturalist for all plants in data/plants.json.
 * Uses iNaturalist taxa API to find the default photo for each scientific name.
 *
 * Run: npx tsx scripts/fetch-plant-images.ts
 */

import fs from 'fs';
import path from 'path';

const PLANTS_FILE = path.join(__dirname, '..', 'data', 'plants.json');
const DELAY_MS = 350; // iNaturalist recommends max ~60 req/min

interface Plant {
  slug: string;
  commonName: string;
  scientificName: string;
  imageUrl: string;
  imageAttribution?: string;
  [key: string]: any;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function getINaturalistImage(scientificName: string): Promise<{ url: string; attribution: string } | null> {
  try {
    // Search taxa by scientific name
    const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&per_page=3&rank=species`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ChicagoNativePlantPlanner/1.0 (educational project; nick@example.com)' },
    });

    if (!res.ok) return null;
    const data = await res.json();

    // Find the best match — exact scientific name match preferred
    const results = data?.results || [];
    const exactMatch = results.find((t: any) =>
      t.name?.toLowerCase() === scientificName.toLowerCase()
    );
    const taxon = exactMatch || results[0];
    if (!taxon?.default_photo) return null;

    const photo = taxon.default_photo;
    // Get medium size (500px) — replace square with medium
    let imageUrl = photo.medium_url || photo.url?.replace('square', 'medium') || '';
    if (!imageUrl) return null;

    return {
      url: imageUrl,
      attribution: photo.attribution || `Photo via iNaturalist`,
    };
  } catch {
    return null;
  }
}

async function main() {
  const plants: Plant[] = JSON.parse(fs.readFileSync(PLANTS_FILE, 'utf-8'));

  let updated = 0;
  let failed: string[] = [];

  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];

    console.log(`[${i + 1}/${plants.length}] Fetching ${plant.commonName} (${plant.scientificName})...`);

    const result = await getINaturalistImage(plant.scientificName);

    if (result) {
      plant.imageUrl = result.url;
      plant.imageAttribution = result.attribution;
      updated++;
      console.log(`  ✓ Found image`);
    } else {
      failed.push(`${plant.commonName} (${plant.scientificName})`);
      console.log(`  ✗ No image found`);
    }

    await sleep(DELAY_MS);
  }

  // Write updated plants
  fs.writeFileSync(PLANTS_FILE, JSON.stringify(plants, null, 2));

  console.log(`\nDone! Updated ${updated} of ${plants.length} plants with iNaturalist images.`);
  if (failed.length > 0) {
    console.log(`\nFailed to find images for ${failed.length} plants:`);
    failed.forEach(f => console.log(`  - ${f}`));
  }
}

main().catch(console.error);
