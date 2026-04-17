import { connectDB } from '../src/lib/db/connection';
import { Plant } from '../src/lib/db/models';
import plantsData from '../data/plants.json';

(async () => {
  await connectDB();
  const fileSlugs = new Set((plantsData as any[]).map(p => p.slug));
  const inDb = await Plant.find({}, 'slug').lean();
  const orphans = inDb.filter((p: any) => !fileSlugs.has(p.slug));
  console.log('Orphans in DB:', orphans.map((o: any) => o.slug));
  if (orphans.length) {
    const res = await Plant.deleteMany({ slug: { $in: orphans.map((o: any) => o.slug) } });
    console.log('Deleted:', res.deletedCount);
  }
  const final = await Plant.countDocuments();
  console.log('Final count:', final);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
