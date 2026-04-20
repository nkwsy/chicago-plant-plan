/**
 * Backfill the three Oudolf metadata fields on every plant:
 *   - oudolfRole        ('matrix' | 'structure' | 'scatter' | 'filler')
 *   - seedHeadInterest  boolean
 *   - winterStructure   boolean
 *
 * The existing completeness scorer (src/lib/plants/completeness.ts) doesn't
 * weight these fields, so POST /api/plants/enrich-batch — which filters on
 * score < threshold — often skips plants that have the rest of the record
 * filled in.  This script targets the three new fields directly.
 *
 * It calls the shared enrichPlant() SDK helper (same cached-prompt Claude
 * tool-use call the batch endpoint uses), mutates both MongoDB and
 * data/plants.json so the JSON fallback stays in sync, and writes a small
 * report to scripts/snapshots/oudolf-backfill.json.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-oudolf-metadata.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-oudolf-metadata.ts --write
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-oudolf-metadata.ts --write --limit 20
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-oudolf-metadata.ts --write --force
 *
 * Flags:
 *   --write   actually write to Mongo + plants.json (default is dry run)
 *   --limit N cap number of plants processed (default: all)
 *   --force   re-enrich plants that already have all three fields set
 */

import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { enrichPlant } from '../src/lib/plants/enrich';
import type { Plant as PlantType } from '../src/types/plant';

const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  if (i < 0) return Infinity;
  return Math.max(1, parseInt(process.argv[i + 1] || '0', 10) || Infinity);
})();
const ROOT = process.cwd();

interface Outcome {
  slug: string;
  commonName: string;
  before: { oudolfRole?: string | null; seedHeadInterest?: boolean; winterStructure?: boolean };
  after?: { oudolfRole?: string | null; seedHeadInterest?: boolean; winterStructure?: boolean };
  status: 'enriched' | 'skipped' | 'error';
  error?: string;
  patchedFields: string[];
}

function hasAllOudolfFields(p: Partial<PlantType>): boolean {
  return (
    typeof p.oudolfRole === 'string' &&
    typeof p.seedHeadInterest === 'boolean' &&
    typeof p.winterStructure === 'boolean'
  );
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  if (
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.ANTHROPIC_AUTH_TOKEN &&
    !process.env.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    throw new Error(
      'No Anthropic credentials: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN',
    );
  }

  console.log(`=== Oudolf metadata backfill (${WRITE ? 'WRITE' : 'DRY RUN'}) ===\n`);
  if (FORCE) console.log('(--force: will re-enrich plants that already have all three fields)');
  if (LIMIT !== Infinity) console.log(`(--limit: processing at most ${LIMIT} plants)`);

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const plantCol = db.collection('plants');

  // Pull the full plant docs — we need every scalar the prompt uses to pick a
  // plausible oudolfRole.
  const all = (await plantCol.find({}).toArray()) as Array<Partial<PlantType> & { _id: mongoose.Types.ObjectId; slug: string; commonName: string }>;
  console.log(`Loaded ${all.length} plants from Mongo.`);

  const candidates = (FORCE ? all : all.filter((p) => !hasAllOudolfFields(p))).slice(0, LIMIT);
  console.log(`${candidates.length} plants need Oudolf metadata.\n`);

  if (candidates.length === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // Pre-load plants.json so we can mutate it as we go (keeps DB + JSON in
  // lockstep; the JSON is the seed source for fresh environments).
  const plantsJsonPath = path.join(ROOT, 'data', 'plants.json');
  const plantsJson = JSON.parse(fs.readFileSync(plantsJsonPath, 'utf-8')) as PlantType[];
  const jsonIndex = new Map(plantsJson.map((p, i) => [p.slug, i] as const));

  const outcomes: Outcome[] = [];
  let totalIn = 0, totalOut = 0, totalCache = 0;
  let processed = 0;

  for (const plant of candidates) {
    processed++;
    const prefix = `[${processed}/${candidates.length}] ${plant.commonName}`.padEnd(56).slice(0, 56);
    process.stdout.write(`${prefix} `);

    const before = {
      oudolfRole: plant.oudolfRole,
      seedHeadInterest: plant.seedHeadInterest,
      winterStructure: plant.winterStructure,
    };

    try {
      // enrichPlant only emits patch entries for fields that are currently
      // missing or (for Oudolf fields specifically) always. That's the
      // behaviour we want: we'd rather let the curator keep any manual edits
      // intact, and the Oudolf fields are subjective enough that overwriting
      // from Claude is fine.
      const result = await enrichPlant(plant as Partial<PlantType>);
      if (!result.ok) {
        console.log(`⟳ skipped: ${result.reason}`);
        outcomes.push({
          slug: plant.slug,
          commonName: plant.commonName,
          before,
          status: 'skipped',
          patchedFields: [],
          error: result.reason,
        });
        continue;
      }

      totalIn += result.usage?.inputTokens || 0;
      totalOut += result.usage?.outputTokens || 0;
      totalCache += result.usage?.cacheReadTokens || 0;

      // Narrow the patch to the three Oudolf fields. The SDK helper may also
      // return other filled-in fields for plants that had gaps elsewhere —
      // we apply all of them so the backfill doubles as a general cleanup
      // pass.
      const { nonNativeWarning, ...patch } = result.patch;
      void nonNativeWarning;
      const patchedFields = Object.keys(patch);

      const after = {
        oudolfRole: (patch.oudolfRole ?? before.oudolfRole) as typeof before.oudolfRole,
        seedHeadInterest: (patch.seedHeadInterest ?? before.seedHeadInterest) as typeof before.seedHeadInterest,
        winterStructure: (patch.winterStructure ?? before.winterStructure) as typeof before.winterStructure,
      };

      if (WRITE && patchedFields.length) {
        await plantCol.updateOne(
          { _id: plant._id },
          { $set: { ...patch, lastEnrichedAt: new Date() } },
        );
        // Mirror into plants.json so seeding a fresh DB reproduces the state.
        const idx = jsonIndex.get(plant.slug);
        if (idx !== undefined) {
          plantsJson[idx] = { ...plantsJson[idx], ...(patch as Partial<PlantType>) };
        }
      }

      const oudolfNote = [
        after.oudolfRole ? `role=${after.oudolfRole}` : 'role=?',
        `sh=${after.seedHeadInterest === true ? 'Y' : after.seedHeadInterest === false ? 'N' : '?'}`,
        `ws=${after.winterStructure === true ? 'Y' : after.winterStructure === false ? 'N' : '?'}`,
      ].join(' ');
      console.log(`✓ ${oudolfNote}  (+${patchedFields.length} fields)`);

      outcomes.push({
        slug: plant.slug,
        commonName: plant.commonName,
        before,
        after,
        status: 'enriched',
        patchedFields,
      });
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`✗ error: ${msg}`);
      outcomes.push({
        slug: plant.slug,
        commonName: plant.commonName,
        before,
        status: 'error',
        patchedFields: [],
        error: msg,
      });
    }

    // Small pause — the SDK has its own rate-limit backoff, but courtesy
    // still applies.
    await new Promise((r) => setTimeout(r, 200));
  }

  if (WRITE) {
    fs.writeFileSync(plantsJsonPath, JSON.stringify(plantsJson, null, 2) + '\n');
    console.log(`\n✓ Wrote ${path.relative(ROOT, plantsJsonPath)}`);
  }

  // Summary stats
  const enriched = outcomes.filter((o) => o.status === 'enriched');
  const byRole = enriched.reduce<Record<string, number>>((acc, o) => {
    const role = o.after?.oudolfRole || '(none)';
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});
  const seedHeadYes = enriched.filter((o) => o.after?.seedHeadInterest === true).length;
  const winterStructureYes = enriched.filter((o) => o.after?.winterStructure === true).length;

  const snapshot = {
    generatedAt: new Date().toISOString(),
    write: WRITE,
    totalPlants: all.length,
    processed: outcomes.length,
    enriched: enriched.length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    errors: outcomes.filter((o) => o.status === 'error').length,
    distribution: {
      oudolfRole: byRole,
      seedHeadInterestYes: seedHeadYes,
      winterStructureYes,
    },
    tokenUsage: {
      input: totalIn,
      output: totalOut,
      cacheRead: totalCache,
    },
    outcomes,
  };

  const snapDir = path.join(ROOT, 'scripts', 'snapshots');
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
  const snapPath = path.join(snapDir, 'oudolf-backfill.json');
  fs.writeFileSync(snapPath, JSON.stringify(snapshot, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Processed: ${outcomes.length}  (enriched ${enriched.length}, errors ${snapshot.errors}, skipped ${snapshot.skipped})`);
  console.log(`Role distribution:`, byRole);
  console.log(`seedHeadInterest=true: ${seedHeadYes} / ${enriched.length}`);
  console.log(`winterStructure=true:  ${winterStructureYes} / ${enriched.length}`);
  console.log(`Tokens: in=${totalIn} out=${totalOut} cacheRead=${totalCache}`);
  console.log(`Report: ${path.relative(ROOT, snapPath)}`);

  await mongoose.disconnect();

  if (!WRITE) {
    console.log('\n↻ Dry run — pass --write to persist changes.');
  } else {
    console.log('\nNext: rerun Oudolf verification');
    console.log('  npx dotenv-cli -e .env.local -- npx tsx scripts/verify-oudolf.ts');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
