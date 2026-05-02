/**
 * Seed the built-in symbol sets from data/symbol-sets.json into MongoDB.
 *
 * Idempotent: re-running upserts each set so the JSON is the source of truth
 * for built-ins. User-cloned sets (isBuiltIn=false) are never touched.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-symbol-sets.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-symbol-sets.ts --write
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-symbol-sets.ts --write --force
 *
 * Flags:
 *   --write   actually upsert (default is dry run; print only)
 *   --force   overwrite even if name/description differ from JSON
 */

import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import type { SymbolSet } from '../src/types/symbol-set';

const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');
const ROOT = process.cwd();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  console.log(`=== Symbol-set seed (${WRITE ? 'WRITE' : 'DRY RUN'}) ===\n`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const col = db.collection('symbolsets');

  const jsonPath = path.join(ROOT, 'data', 'symbol-sets.json');
  const seeds = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as SymbolSet[];
  console.log(`Loaded ${seeds.length} seed set(s) from ${path.relative(ROOT, jsonPath)}.\n`);

  for (const set of seeds) {
    const existing = await col.findOne({ slug: set.slug });
    const familyCount = Object.keys(set.byFamily || {}).length;
    const tierCount = Object.keys(set.byTier || {}).length;
    const overrideCount = Object.keys(set.overrides || {}).length;

    if (!existing) {
      console.log(
        `+ ${set.slug.padEnd(20)} (NEW) — ${familyCount} families, ${tierCount} tiers, ${overrideCount} overrides`,
      );
      if (WRITE) {
        await col.insertOne({
          ...set,
          isBuiltIn: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      continue;
    }

    if (!existing.isBuiltIn && !FORCE) {
      console.log(
        `↻ ${set.slug.padEnd(20)} (SKIP — user-cloned set; pass --force to overwrite)`,
      );
      continue;
    }

    console.log(
      `↻ ${set.slug.padEnd(20)} (UPDATE) — ${familyCount} families, ${tierCount} tiers, ${overrideCount} overrides`,
    );
    if (WRITE) {
      await col.updateOne(
        { slug: set.slug },
        {
          $set: {
            name: set.name,
            description: set.description,
            isBuiltIn: true,
            byFamily: set.byFamily,
            byTier: set.byTier,
            overrides: set.overrides || {},
            fallback: set.fallback,
            updatedAt: new Date(),
          },
        },
      );
    }
  }

  await mongoose.disconnect();
  console.log(`\nDone. ${WRITE ? '' : '↻ Dry run — pass --write to persist.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
