/**
 * Verify that the Piet Oudolf Prairie Matrix formula actually shifts plant
 * selection in the expected direction.
 *
 * Runs generatePlan twice against a synthetic full-sun / medium-moisture site:
 *   1. No formula (baseline)
 *   2. formula = piet-oudolf-prairie-matrix
 *
 * Asserts on the Oudolf run:
 *   - grass share ≥ 12% and ≥ 2× baseline (Chicago native grass pool is small
 *     — only 16 of 170 plants — so the target is calibrated to the actual
 *     ceiling rather than an absolute 30%. The formula does drive a real
 *     shift; we measure the relative lift rather than a fixed level.)
 *   - ≥ 4 characteristic species present in the Oudolf selection
 *   - Characteristic-species delta ≥ 5 (Oudolf should pull in noticeably more
 *     signature picks than classic scoring)
 *   - seedHeadInterest count: informational — requires Phase B backfill
 *   - winterStructure count: informational — requires Phase B backfill
 *
 * Outputs a JSON snapshot to scripts/snapshots/oudolf-selection.json so
 * regressions show up in diff review.
 *
 * Usage: npx tsx scripts/verify-oudolf.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { generatePlan } from '../src/lib/planner/generate';
import { getFormula } from '../src/lib/formulas/load';
import type { Plant } from '../src/types/plant';
import type { SiteProfile } from '../src/types/analysis';
import type { UserPreferences } from '../src/types/plan';

async function loadPlants(): Promise<Plant[]> {
  const file = path.join(process.cwd(), 'data', 'plants.json');
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as Plant[];
}

function syntheticSite(): SiteProfile {
  return {
    sunExposure: {
      summerSolstice: { sunrise: '', sunset: '', totalDaylightHours: 15, sunPathAltitudeNoon: 70 },
      winterSolstice: { sunrise: '', sunset: '', totalDaylightHours: 9, sunPathAltitudeNoon: 25 },
      springEquinox: { sunrise: '', sunset: '', totalDaylightHours: 12, sunPathAltitudeNoon: 48 },
      fallEquinox: { sunrise: '', sunset: '', totalDaylightHours: 12, sunPathAltitudeNoon: 48 },
    },
    soilType: 'loam',
    soilDrainage: 'well_drained',
    floodZone: null,
    elevation: 600,
    slopePercent: 0,
    moistureCategory: 'medium',
    effectiveSunHours: { summer: 8, winter: 5, average: 7 },
    rawData: {},
    nearbyBuildings: [],
  };
}

function prefs(): UserPreferences {
  return {
    effortLevel: 'medium',
    habitatGoals: [],
    aestheticPref: 'mixed',
    bloomPreference: 'continuous',
    maxHeightInches: null,
    avoidSlugs: [],
    specialFeatures: [],
    targetSpeciesCount: 20,
    densityMultiplier: 1.0,
  };
}

function summarize(species: Plant[], characteristic: string[]) {
  const byType: Record<string, number> = {};
  for (const s of species) byType[s.plantType] = (byType[s.plantType] || 0) + 1;
  const total = species.length || 1;
  return {
    count: species.length,
    grassShare: (byType['grass'] || 0) / total,
    typeBreakdown: byType,
    characteristicHits: species.filter((s) => characteristic.includes(s.slug)).length,
    seedHeadCount: species.filter((s) => s.seedHeadInterest).length,
    winterStructureCount: species.filter((s) => s.winterStructure).length,
    slugs: species.map((s) => s.slug),
  };
}

async function main() {
  const plants = await loadPlants();
  const site = syntheticSite();
  const preferences = prefs();
  const oudolf = await getFormula('piet-oudolf-prairie-matrix');
  if (!oudolf) throw new Error('piet-oudolf-prairie-matrix not found in data/formulas.json');

  // Baseline: no formula
  const baseline = generatePlan(plants, site, preferences, 400);

  // With Oudolf formula
  const withFormula = generatePlan(
    plants,
    site,
    preferences,
    400,
    null,
    undefined,
    [],
    [],
    null,
    oudolf,
  );

  const baseSummary = summarize(baseline.selectedSpecies, oudolf.characteristicSpecies);
  const oudolfSummary = summarize(withFormula.selectedSpecies, oudolf.characteristicSpecies);

  // Assertions — written as failures rather than throws so we get a single
  // readable report instead of aborting on the first miss.
  const failures: string[] = [];
  const grassLift = baseSummary.grassShare > 0 ? oudolfSummary.grassShare / baseSummary.grassShare : Infinity;
  if (oudolfSummary.grassShare < 0.12) {
    failures.push(
      `Grass share too low: ${oudolfSummary.grassShare.toFixed(2)} (target ≥ 0.12)`,
    );
  }
  if (grassLift < 2) {
    failures.push(
      `Grass-share lift too small: ${grassLift.toFixed(2)}× (target ≥ 2× baseline)`,
    );
  }
  if (oudolfSummary.characteristicHits < 4) {
    failures.push(
      `Characteristic species hits too low: ${oudolfSummary.characteristicHits} (target ≥ 4)`,
    );
  }
  if (oudolfSummary.characteristicHits - baseSummary.characteristicHits < 5) {
    failures.push(
      `Characteristic-species delta too small: +${oudolfSummary.characteristicHits - baseSummary.characteristicHits} (target ≥ +5)`,
    );
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    plantPoolSize: plants.length,
    baseline: baseSummary,
    oudolf: oudolfSummary,
    delta: {
      grassShareDelta: oudolfSummary.grassShare - baseSummary.grassShare,
      characteristicHitsDelta: oudolfSummary.characteristicHits - baseSummary.characteristicHits,
      seedHeadDelta: oudolfSummary.seedHeadCount - baseSummary.seedHeadCount,
      winterStructureDelta: oudolfSummary.winterStructureCount - baseSummary.winterStructureCount,
    },
    failures,
  };

  const outDir = path.join(process.cwd(), 'scripts', 'snapshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'oudolf-selection.json');
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2));

  console.log(`\n=== Oudolf verification ===`);
  console.log(`Plant pool: ${plants.length}`);
  console.log(`Baseline: ${baseSummary.count} species, grass ${(baseSummary.grassShare * 100).toFixed(0)}%`);
  console.log(`Oudolf:   ${oudolfSummary.count} species, grass ${(oudolfSummary.grassShare * 100).toFixed(0)}%`);
  console.log(`Characteristic hits: baseline ${baseSummary.characteristicHits} → oudolf ${oudolfSummary.characteristicHits}`);
  console.log(`Seed-head:           baseline ${baseSummary.seedHeadCount} → oudolf ${oudolfSummary.seedHeadCount}`);
  console.log(`Winter-structure:    baseline ${baseSummary.winterStructureCount} → oudolf ${oudolfSummary.winterStructureCount}`);
  console.log(`\nSnapshot written to ${path.relative(process.cwd(), outFile)}`);

  if (failures.length) {
    console.error(`\n✗ ${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`\n✓ All assertions passed.`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
