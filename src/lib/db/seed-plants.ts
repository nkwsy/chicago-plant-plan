import { connectDB } from './connection';
import { Plant } from './models';
import plantsData from '../../../data/plants.json';

export async function seedPlants() {
  await connectDB();

  const count = await Plant.countDocuments();
  if (count > 0) {
    console.log(`Plants collection already has ${count} documents, skipping seed.`);
    return count;
  }

  console.log(`Seeding ${plantsData.length} plants...`);
  await Plant.insertMany(plantsData);
  console.log('Plant seed complete.');
  return plantsData.length;
}

// Allow running directly: npx tsx src/lib/db/seed-plants.ts
if (require.main === module) {
  seedPlants()
    .then(n => { console.log(`Done. ${n} plants.`); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}
