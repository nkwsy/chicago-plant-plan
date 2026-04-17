import { connectDB } from '../src/lib/db/connection';
import { Plant } from '../src/lib/db/models';
(async () => {
  await connectDB();
  const count = await Plant.countDocuments();
  const last = await Plant.find({}).sort({ commonName: 1 }).select('commonName slug').lean();
  console.log('Count:', count);
  console.log('First 3:', last.slice(0,3).map((p:any)=>p.commonName));
  console.log('Last 3:', last.slice(-3).map((p:any)=>p.commonName));
  const newOnes = ['White Oak','Sugar Maple','Buttonbush','Bottle Gentian','Common Mountain Mint'];
  for (const n of newOnes) {
    const f = await Plant.findOne({ commonName: n }).select('slug').lean();
    console.log(' ', n, '->', f ? 'present' : 'MISSING');
  }
  process.exit(0);
})();
