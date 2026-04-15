import { connectDB } from './connection';
import { Plant } from './models';
import plantsData from '../../../data/plants.json';

export async function seedPlants(force = false) {
  await connectDB();

  const count = await Plant.countDocuments();

  if (force || count === 0) {
    // Upsert all plants from JSON (insert new, update existing)
    console.log(`Upserting ${plantsData.length} plants (${count} existing)...`);
    const ops = (plantsData as any[]).map((p: any) => ({
      updateOne: {
        filter: { slug: p.slug },
        update: { $set: p },
        upsert: true,
      },
    }));
    const result = await Plant.bulkWrite(ops);
    const finalCount = await Plant.countDocuments();
    console.log(`Upserted: ${result.upsertedCount} new, ${result.modifiedCount} updated. Total: ${finalCount}`);
    return finalCount;
  }

  if (count >= plantsData.length) {
    console.log(`Plants collection already has ${count} documents, skipping seed.`);
    return count;
  }

  // More plants in JSON than DB — upsert the diff
  console.log(`DB has ${count}, JSON has ${plantsData.length}. Upserting new plants...`);
  const ops = (plantsData as any[]).map((p: any) => ({
    updateOne: {
      filter: { slug: p.slug },
      update: { $set: p },
      upsert: true,
    },
  }));
  const result = await Plant.bulkWrite(ops);
  const finalCount = await Plant.countDocuments();
  console.log(`Upserted: ${result.upsertedCount} new, ${result.modifiedCount} updated. Total: ${finalCount}`);
  return finalCount;
}

// Allow running directly: npx tsx src/lib/db/seed-plants.ts
if (require.main === module) {
  const force = process.argv.includes('--force');
  seedPlants(force)
    .then(n => { console.log(`Done. ${n} plants.`); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
