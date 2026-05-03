/**
 * Seed sociability + tier on every plant in MongoDB and data/plants.json
 * using the deterministic inference rules in src/lib/plants/sociability.ts.
 *
 * Phase 1 of the planting-layout overhaul: we add the two new fields
 * needed by the upcoming Voronoi tapestry and grid-layout algorithms.
 *
 * Unlike scripts/backfill-oudolf-metadata.ts this script does not call
 * Claude — the inference is purely a function of plantType + oudolfRole +
 * size, which we already have curated. Free, instant, reproducible.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-sociability-tier.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-sociability-tier.ts --write
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-sociability-tier.ts --write --force
 *
 * Flags:
 *   --write   actually persist (default is dry run; print only)
 *   --force   overwrite existing sociability/tier values; without it we
 *             only fill in plants where the field is null/undefined
 */

import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { inferSociabilityAndTier } from '../src/lib/plants/sociability';
import type { Plant as PlantType } from '../src/types/plant';

const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');
const ROOT = process.cwd();

interface Outcome {
  slug: string;
  commonName: string;
  plantType?: string;
  oudolfRole?: string | null;
  before: { sociability?: number | null; tier?: number | null };
  after: { sociability: number; tier: number };
  reason: string;
  changed: boolean;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  console.log(`=== Sociability + tier seed (${WRITE ? 'WRITE' : 'DRY RUN'}) ===`);
  if (FORCE) console.log('(--force: will overwrite existing values)');
  console.log();

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const plantCol = db.collection('plants');

  const all = (await plantCol.find({}).toArray()) as Array<
    Partial<PlantType> & { _id: mongoose.Types.ObjectId; slug: string; commonName: string }
  >;
  console.log(`Loaded ${all.length} plants from Mongo.\n`);

  const plantsJsonPath = path.join(ROOT, 'data', 'plants.json');
  const plantsJson = JSON.parse(fs.readFileSync(plantsJsonPath, 'utf-8')) as PlantType[];
  const jsonIndex = new Map(plantsJson.map((p, i) => [p.slug, i] as const));

  const outcomes: Outcome[] = [];

  for (const plant of all) {
    const before = { sociability: plant.sociability, tier: plant.tier };
    const inferred = inferSociabilityAndTier(plant);

    const wantsSociability = FORCE || before.sociability == null;
    const wantsTier = FORCE || before.tier == null;
    const after = {
      sociability: wantsSociability ? inferred.sociability : (before.sociability as number),
      tier: wantsTier ? inferred.tier : (before.tier as number),
    };
    const changed = wantsSociability || wantsTier;

    outcomes.push({
      slug: plant.slug,
      commonName: plant.commonName,
      plantType: plant.plantType,
      oudolfRole: plant.oudolfRole ?? null,
      before,
      after,
      reason: inferred.reason,
      changed,
    });

    if (WRITE && changed) {
      const patch: Record<string, unknown> = {};
      if (wantsSociability) patch.sociability = inferred.sociability;
      if (wantsTier) patch.tier = inferred.tier;
      await plantCol.updateOne({ _id: plant._id }, { $set: patch });

      const idx = jsonIndex.get(plant.slug);
      if (idx !== undefined) {
        plantsJson[idx] = { ...plantsJson[idx], ...(patch as Partial<PlantType>) };
      }
    }
  }

  if (WRITE) {
    fs.writeFileSync(plantsJsonPath, JSON.stringify(plantsJson, null, 2) + '\n');
    console.log(`✓ Wrote ${path.relative(ROOT, plantsJsonPath)}`);
  }

  // -- Distribution summary -------------------------------------------------
  const byTier: Record<number, number> = {};
  const bySoc: Record<number, number> = {};
  const byTypeXTier: Record<string, Record<number, number>> = {};
  for (const o of outcomes) {
    byTier[o.after.tier] = (byTier[o.after.tier] || 0) + 1;
    bySoc[o.after.sociability] = (bySoc[o.after.sociability] || 0) + 1;
    const t = o.plantType || 'unknown';
    byTypeXTier[t] ||= {};
    byTypeXTier[t][o.after.tier] = (byTypeXTier[t][o.after.tier] || 0) + 1;
  }

  console.log('\n=== Tier distribution ===');
  for (const tier of [5, 4, 3, 2, 1]) {
    const label =
      tier === 5
        ? 'emergent (tall accents)'
        : tier === 4
          ? 'primary structural'
          : tier === 3
            ? 'secondary companion'
            : tier === 2
              ? 'matrix'
              : 'scatter / filler';
    console.log(`  T${tier} ${label.padEnd(28)} ${byTier[tier] || 0}`);
  }

  console.log('\n=== Sociability distribution ===');
  for (const soc of [1, 2, 3, 4, 5]) {
    const label =
      soc === 1
        ? 'solitary'
        : soc === 2
          ? 'small group (3–5)'
          : soc === 3
            ? 'drift (6–12)'
            : soc === 4
              ? 'sweep (15–30)'
              : 'colony';
    console.log(`  S${soc} ${label.padEnd(20)} ${bySoc[soc] || 0}`);
  }

  console.log('\n=== Type × tier matrix ===');
  for (const [type, byT] of Object.entries(byTypeXTier).sort()) {
    const cells = [1, 2, 3, 4, 5].map((t) => `T${t}=${byT[t] || 0}`).join(' ');
    console.log(`  ${type.padEnd(8)} ${cells}`);
  }

  // -- Sample preview: a few plants per tier --------------------------------
  console.log('\n=== Sample (first 3 per tier) ===');
  for (const tier of [5, 4, 3, 2, 1]) {
    const sample = outcomes.filter((o) => o.after.tier === tier).slice(0, 3);
    if (sample.length === 0) continue;
    console.log(`  T${tier}:`);
    for (const o of sample) {
      console.log(
        `    ${o.commonName.padEnd(32)} (${o.plantType}, role=${o.oudolfRole || '?'}) → S${o.after.sociability} — ${o.reason}`,
      );
    }
  }

  // -- Snapshot -------------------------------------------------------------
  const snapDir = path.join(ROOT, 'scripts', 'snapshots');
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
  const snapPath = path.join(snapDir, 'sociability-tier-seed.json');
  fs.writeFileSync(
    snapPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        write: WRITE,
        force: FORCE,
        totalPlants: outcomes.length,
        changed: outcomes.filter((o) => o.changed).length,
        distribution: { byTier, bySoc, byTypeXTier },
        outcomes,
      },
      null,
      2,
    ),
  );

  const changedCount = outcomes.filter((o) => o.changed).length;
  console.log(
    `\nProcessed ${outcomes.length} plants — ${changedCount} would change${WRITE ? ' (written)' : ''}.`,
  );
  console.log(`Report: ${path.relative(ROOT, snapPath)}`);

  await mongoose.disconnect();
  if (!WRITE) console.log('\n↻ Dry run — pass --write to persist.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
