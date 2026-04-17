/**
 * Seed the Formula collection from data/formulas.json.
 * Mirrors seed-plants.ts: idempotent upsert-by-slug, safe to run repeatedly.
 *
 * Run directly:
 *   npx dotenv-cli -e .env.local -- npx tsx src/lib/db/seed-formulas.ts
 *   npx dotenv-cli -e .env.local -- npx tsx src/lib/db/seed-formulas.ts --force
 */

import { connectDB } from './connection';
import { Formula } from './models';
import formulasData from '../../../data/formulas.json';

export async function seedFormulas(force = false) {
  await connectDB();

  const count = await Formula.countDocuments();
  const jsonLen = (formulasData as unknown[]).length;

  if (force || count === 0 || count < jsonLen) {
    console.log(`Upserting ${jsonLen} formulas (${count} existing)...`);
    const ops = (formulasData as Array<Record<string, unknown>>).map((f) => ({
      updateOne: {
        filter: { slug: f.slug as string },
        update: { $set: f },
        upsert: true,
      },
    }));
    const result = await Formula.bulkWrite(ops);
    const finalCount = await Formula.countDocuments();
    console.log(
      `Upserted: ${result.upsertedCount} new, ${result.modifiedCount} updated. Total: ${finalCount}`,
    );
    return finalCount;
  }

  console.log(`Formula collection already has ${count} documents, skipping seed.`);
  return count;
}

// Allow running directly: npx tsx src/lib/db/seed-formulas.ts
if (require.main === module) {
  const force = process.argv.includes('--force');
  seedFormulas(force)
    .then((n) => {
      console.log(`Done. ${n} formulas.`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
