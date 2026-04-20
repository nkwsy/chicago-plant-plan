/**
 * Rename plant slugs from "common-name" form to "scientific-name" form.
 *
 * The slug is the primary key across three data surfaces:
 *   1. data/plants.json, data/new-plants.json     (source-of-truth JSON seeds)
 *   2. data/formulas.json.characteristicSpecies[] (formula → plant references)
 *   3. MongoDB:
 *      - plants collection (the slug field itself + unique index)
 *      - plans collection: each plan.plants[].plantSlug reference
 *      - any formulas collection docs: characteristicSpecies array
 *
 * We slugify the scientificName (e.g. "Echinacea purpurea" → "echinacea-purpurea").
 * A dry run is printed first; pass --write to actually mutate files + DB.
 *
 * Run:
 *   npx tsx scripts/migrate-slugs.ts            # dry run
 *   npx tsx scripts/migrate-slugs.ts --write    # apply
 */

import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
// dotenv is loaded via `dotenv-cli -e .env.local` when running this script.

const WRITE = process.argv.includes('--write');
const ROOT = process.cwd();

interface Plantish {
  slug: string;
  scientificName: string;
  commonName?: string;
  [k: string]: unknown;
}

function sciSlug(sci: string): string {
  return sci
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')) as T;
}

function writeJson(rel: string, data: unknown) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(data, null, 2) + '\n');
}

async function main() {
  console.log(`=== Slug migration (${WRITE ? 'WRITE' : 'DRY RUN'}) ===\n`);

  // Build slug map from plants.json — this is the source of truth (matches DB).
  // new-plants.json is a staging file with heavy overlap; its slugs also get
  // renamed below but it doesn't contribute to collision detection because
  // many of its entries are same-species duplicates of plants.json.
  const plants = loadJson<Plantish[]>('data/plants.json');
  const newPlants = loadJson<Plantish[]>('data/new-plants.json');

  const map = new Map<string, string>();
  const collisions: Array<{ oldA: string; oldB: string; sci: string }> = [];
  const newSlugToOld = new Map<string, string>();

  for (const p of plants) {
    if (!p.scientificName) {
      console.warn(`  ! ${p.slug} has no scientificName — leaving unchanged`);
      map.set(p.slug, p.slug);
      continue;
    }
    const ns = sciSlug(p.scientificName);
    map.set(p.slug, ns);

    if (newSlugToOld.has(ns) && newSlugToOld.get(ns) !== p.slug) {
      collisions.push({
        oldA: newSlugToOld.get(ns) as string,
        oldB: p.slug,
        sci: p.scientificName,
      });
    }
    newSlugToOld.set(ns, p.slug);
  }

  // new-plants.json: add mappings for any slug not already mapped (so its
  // renamed output file stays self-consistent), but never override a mapping
  // already set by plants.json.
  for (const p of newPlants) {
    if (!p.scientificName) continue;
    if (map.has(p.slug)) continue;
    map.set(p.slug, sciSlug(p.scientificName));
  }

  if (collisions.length) {
    console.error('\nCollisions detected (two different plants would map to same slug):');
    collisions.forEach((c) => console.error(`  ${c.oldA} + ${c.oldB} — ${c.sci}`));
    console.error('\nAborting. Resolve collisions manually.');
    process.exit(1);
  }

  console.log(`Mapped ${map.size} slugs. No collisions.\n`);

  // Sample the rename
  const changed = Array.from(map.entries()).filter(([a, b]) => a !== b);
  const unchanged = map.size - changed.length;
  console.log(`Will rename ${changed.length} slugs; ${unchanged} unchanged.\n`);
  console.log('Sample renames:');
  changed.slice(0, 8).forEach(([a, b]) => console.log(`  ${a.padEnd(30)} → ${b}`));
  console.log('');

  // --- 1. data/plants.json ---------------------------------------------------
  const plantsOut = plants.map((p) => ({ ...p, slug: map.get(p.slug) || p.slug }));
  if (WRITE) writeJson('data/plants.json', plantsOut);
  console.log(`  ${WRITE ? '✓' : '·'} data/plants.json (${plants.length} entries)`);

  // --- 2. data/new-plants.json ----------------------------------------------
  const newOut = newPlants.map((p) => ({ ...p, slug: map.get(p.slug) || p.slug }));
  if (WRITE) writeJson('data/new-plants.json', newOut);
  console.log(`  ${WRITE ? '✓' : '·'} data/new-plants.json (${newPlants.length} entries)`);

  // --- 3. data/formulas.json characteristicSpecies --------------------------
  const formulas = loadJson<Array<{ slug: string; characteristicSpecies: string[] }>>(
    'data/formulas.json',
  );
  let fRefTotal = 0;
  let fRefUnmapped: string[] = [];
  const formulasOut = formulas.map((f) => {
    const remapped = f.characteristicSpecies.map((s) => {
      fRefTotal++;
      const next = map.get(s);
      if (!next) fRefUnmapped.push(`${f.slug}:${s}`);
      return next || s;
    });
    return { ...f, characteristicSpecies: remapped };
  });
  if (WRITE) writeJson('data/formulas.json', formulasOut);
  console.log(
    `  ${WRITE ? '✓' : '·'} data/formulas.json (${fRefTotal} species refs across ${formulas.length} formulas)`,
  );
  if (fRefUnmapped.length) {
    console.warn('    unmapped references (not in plants.json):');
    fRefUnmapped.forEach((u) => console.warn(`      ${u}`));
  }

  // --- 4. MongoDB ------------------------------------------------------------
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('\nMONGODB_URI not set — skipping DB migration.');
    printNextSteps();
    return;
  }

  console.log('\n--- MongoDB ---');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  // Plants
  const plantCol = db.collection('plants');
  const plantCount = await plantCol.countDocuments();
  console.log(`  plants collection: ${plantCount} docs`);

  let renamed = 0;
  let skipped = 0;
  for (const [oldSlug, newSlug] of map) {
    if (oldSlug === newSlug) continue;
    const doc = await plantCol.findOne({ slug: oldSlug });
    if (!doc) {
      skipped++;
      continue;
    }
    const existingAtNew = await plantCol.findOne({ slug: newSlug });
    if (existingAtNew && String(existingAtNew._id) !== String(doc._id)) {
      console.warn(`    ! ${oldSlug} → ${newSlug}: both exist in DB, skipping rename`);
      continue;
    }
    if (WRITE) {
      await plantCol.updateOne({ _id: doc._id }, { $set: { slug: newSlug } });
    }
    renamed++;
  }
  console.log(`  ${WRITE ? '✓' : '·'} plants renamed: ${renamed} (${skipped} not present in DB)`);

  // Plans: rewrite each plan.plants[].plantSlug using $map via aggregation
  // pipeline update (Mongo 4.2+) — far faster than pulling every plan.
  const planCol = db.collection('plans');
  const planCount = await planCol.countDocuments();
  console.log(`  plans collection: ${planCount} docs`);

  if (WRITE) {
    // Build a $switch expression that maps each old slug to its new slug.
    // Plants absent from the map are left untouched.
    const branches = Array.from(map.entries())
      .filter(([a, b]) => a !== b)
      .map(([a, b]) => ({ case: { $eq: ['$$p.plantSlug', a] }, then: b }));

    if (branches.length) {
      const result = await planCol.updateMany({}, [
        {
          $set: {
            plants: {
              $map: {
                input: '$plants',
                as: 'p',
                in: {
                  $mergeObjects: [
                    '$$p',
                    {
                      plantSlug: {
                        $switch: {
                          branches,
                          default: '$$p.plantSlug',
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ]);
      console.log(`  ✓ plans updated: matched ${result.matchedCount}, modified ${result.modifiedCount}`);
    } else {
      console.log('  · no plant renames to propagate to plans');
    }
  } else {
    console.log('  · plans update (would rewrite plans[].plantSlug via aggregation pipeline)');
  }

  // Formulas collection
  const formulaCol = db.collection('formulas');
  const formulaCount = await formulaCol.countDocuments();
  console.log(`  formulas collection: ${formulaCount} docs`);
  if (WRITE && formulaCount > 0) {
    const allFormulas = await formulaCol.find({}).toArray();
    let fChanged = 0;
    for (const f of allFormulas) {
      const cs: string[] = f.characteristicSpecies || [];
      const next = cs.map((s) => map.get(s) || s);
      const changed = next.some((v, i) => v !== cs[i]);
      if (changed) {
        await formulaCol.updateOne({ _id: f._id }, { $set: { characteristicSpecies: next } });
        fChanged++;
      }
    }
    console.log(`  ✓ formulas updated: ${fChanged} doc(s)`);
  } else {
    console.log('  · formulas update (would rewrite characteristicSpecies)');
  }

  await mongoose.disconnect();
  printNextSteps();
}

function printNextSteps() {
  if (!WRITE) {
    console.log('\n↻ Dry run — re-run with --write to apply changes.');
  } else {
    console.log('\n✓ Migration complete.');
    console.log('\nNext steps:');
    console.log('  1. Rebuild the app: npm run build');
    console.log('  2. Verify: npx tsx scripts/verify-oudolf.ts');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
