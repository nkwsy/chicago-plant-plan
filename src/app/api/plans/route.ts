import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';
import { getSessionUser } from '@/lib/auth/dal';

// File-based fallback storage for when MongoDB is not available
const PLANS_FILE = path.join(process.cwd(), 'data', 'plans.json');

function readPlansFile(): any[] {
  try {
    if (fs.existsSync(PLANS_FILE)) {
      return JSON.parse(fs.readFileSync(PLANS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function writePlansFile(plans: any[]) {
  try {
    fs.writeFileSync(PLANS_FILE, JSON.stringify(plans, null, 2));
  } catch (err) {
    console.error('Failed to write plans file:', err);
  }
}

async function getMongoConnection() {
  try {
    const { connectDB } = await import('@/lib/db/connection');
    await connectDB();
    const { Plan } = await import('@/lib/db/models');
    return Plan;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const planId = searchParams.get('id');
  const mineOnly = searchParams.get('mine') === '1';
  const session = await getSessionUser();

  // Try MongoDB first
  const Plan = await getMongoConnection();
  if (Plan) {
    try {
      if (planId) {
        const plan = await Plan.findOne({ planId }).lean();
        if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
        return NextResponse.json(plan);
      }
      if (mineOnly) {
        if (!session) return NextResponse.json([], { status: 200 });
        const plans = await Plan.find({ ownerId: session.userId })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean();
        return NextResponse.json(plans);
      }
      const plans = await Plan.find({ isPublic: true }).sort({ createdAt: -1 }).limit(50).lean();
      return NextResponse.json(plans);
    } catch {}
  }

  // File fallback
  const plans = readPlansFile();
  if (planId) {
    const plan = plans.find(p => p.planId === planId);
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json(plan);
  }
  if (mineOnly) {
    if (!session) return NextResponse.json([]);
    return NextResponse.json(plans.filter((p) => p.ownerId === session.userId).slice(0, 100));
  }
  return NextResponse.json(plans.filter(p => p.isPublic !== false).slice(0, 50));
}

export async function POST(request: Request) {
  const body = await request.json();
  const planId = nanoid(12);
  const now = new Date().toISOString();
  const session = await getSessionUser();

  const planData = {
    planId,
    title: body.title || 'My Native Garden',
    // Prefer the signed-in user's name/email when available; client values are
    // kept as fallbacks for anonymous saves.
    authorName: body.authorName || session?.name || '',
    authorEmail: body.authorEmail || session?.email || '',
    ownerId: session?.userId ?? null,
    areaGeoJson: body.areaGeoJson,
    centerLat: body.centerLat,
    centerLng: body.centerLng,
    siteProfile: body.siteProfile,
    preferences: body.preferences,
    plants: body.plants || [],
    gridCols: body.gridCols || 0,
    gridRows: body.gridRows || 0,
    areaSqFt: body.areaSqFt || 0,
    diversityScore: body.diversityScore || 0,
    exclusionZones: body.exclusionZones || [],
    existingTrees: body.existingTrees || [],
    sunGrid: body.sunGrid || null,
    layoutVersion: body.layoutVersion || 2,
    isPublic: body.isPublic !== false,
    createdAt: now,
    updatedAt: now,
  };

  // Try MongoDB
  const Plan = await getMongoConnection();
  if (Plan) {
    try {
      const plan = new Plan({
        ...planData,
        center: { type: 'Point', coordinates: [body.centerLng, body.centerLat] },
      });
      await plan.save();
      return NextResponse.json({ planId, message: 'Plan saved' }, { status: 201 });
    } catch {}
  }

  // File fallback
  const plans = readPlansFile();
  plans.unshift(planData);
  writePlansFile(plans);
  return NextResponse.json({ planId, message: 'Plan saved' }, { status: 201 });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const { planId, authorEmail, ...updates } = body;
  if (!planId) return NextResponse.json({ error: 'planId required' }, { status: 400 });

  updates.updatedAt = new Date().toISOString();
  const session = await getSessionUser();

  /** Can this viewer edit the given plan? Two paths:
   *   - Signed-in user whose session id matches the plan's ownerId.
   *   - Legacy email match for anonymous plans that predate auth.
   *  Admins can edit any plan. */
  function canEdit(existing: { ownerId?: string | null; authorEmail?: string }): boolean {
    if (session?.role === 'admin') return true;
    if (session && existing.ownerId && existing.ownerId === session.userId) return true;
    if (existing.authorEmail && authorEmail) {
      return authorEmail.toLowerCase() === existing.authorEmail.toLowerCase();
    }
    return false;
  }

  const Plan = await getMongoConnection();
  if (Plan) {
    try {
      const existing = await Plan.findOne({ planId }).lean();
      if (!existing) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
      if (!canEdit(existing)) {
        return NextResponse.json({ error: 'Not authorized to edit this plan' }, { status: 403 });
      }
      if (updates.centerLat && updates.centerLng) {
        updates.center = { type: 'Point', coordinates: [updates.centerLng, updates.centerLat] };
      }
      const plan = await Plan.findOneAndUpdate({ planId }, { $set: updates }, { new: true }).lean();
      return NextResponse.json(plan);
    } catch {}
  }

  // File fallback
  const plans = readPlansFile();
  const idx = plans.findIndex(p => p.planId === planId);
  if (idx === -1) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
  if (!canEdit(plans[idx])) {
    return NextResponse.json({ error: 'Not authorized to edit this plan' }, { status: 403 });
  }
  plans[idx] = { ...plans[idx], ...updates };
  writePlansFile(plans);
  return NextResponse.json(plans[idx]);
}
