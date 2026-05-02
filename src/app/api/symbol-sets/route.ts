/**
 * Symbol-set API.
 *
 *   GET  /api/symbol-sets               → list (built-ins + caller's own)
 *   GET  /api/symbol-sets?slug=X        → single set
 *   POST /api/symbol-sets                → create (signed-in users only)
 *   PUT  /api/symbol-sets?slug=X         → update (admin or owner)
 *   DELETE /api/symbol-sets?slug=X       → delete (admin or owner)
 *
 * Built-ins are read-only by default; an admin can edit them after the
 * confirmation in the admin UI. Read endpoints fall back to
 * data/symbol-sets.json when MongoDB isn't reachable so dev works offline.
 */

import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db/connection';
import { SymbolSet } from '@/lib/db/models';
import { getSessionUser } from '@/lib/auth/dal';
import seedSets from '../../../../data/symbol-sets.json';
import type { SymbolSet as SymbolSetType } from '@/types/symbol-set';

export const dynamic = 'force-dynamic';

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  const session = await getSessionUser();

  // Single-set lookup
  if (slug) {
    try {
      await connectDB();
      const doc = await SymbolSet.findOne({ slug }).lean();
      if (doc) return NextResponse.json(doc);
    } catch {
      // fallthrough to JSON
    }
    const fallback = (seedSets as SymbolSetType[]).find((s) => s.slug === slug);
    if (fallback) return NextResponse.json(fallback);
    return NextResponse.json({ error: 'Symbol set not found' }, { status: 404 });
  }

  // List: built-ins + caller's own user sets
  try {
    await connectDB();
    const all = await SymbolSet.find({
      $or: [{ isBuiltIn: true }, ...(session ? [{ ownerId: session.userId }] : [])],
    })
      .sort({ isBuiltIn: -1, name: 1 })
      .lean();
    if (all.length > 0) return NextResponse.json(all);
  } catch {
    // fallthrough
  }
  return NextResponse.json(seedSets);
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = (await request.json()) as Partial<SymbolSetType>;
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  await connectDB();
  const slug = body.slug || toSlug(body.name);
  const existing = await SymbolSet.findOne({ slug }).lean();
  if (existing) {
    return NextResponse.json({ error: `Symbol set "${slug}" already exists` }, { status: 409 });
  }

  const doc = await SymbolSet.create({
    slug,
    name: body.name,
    description: body.description || '',
    isBuiltIn: false,
    parentSlug: body.parentSlug || null,
    ownerId: session.userId,
    byFamily: body.byFamily || {},
    byTier: body.byTier || {},
    overrides: body.overrides || {},
    fallback: body.fallback || { svg: '<circle cx="12" cy="12" r="3" fill="currentColor"/>' },
  });
  return NextResponse.json(doc.toObject(), { status: 201 });
}

export async function PUT(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  await connectDB();
  const existing = await SymbolSet.findOne({ slug });
  if (!existing) return NextResponse.json({ error: 'Symbol set not found' }, { status: 404 });

  // Admin can edit anything; owner can edit their own; nobody else.
  const canEdit =
    session.role === 'admin' ||
    (existing.ownerId && existing.ownerId === session.userId);
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json()) as Partial<SymbolSetType>;
  // Block slug renames — slug is the primary key + referenced from plans.
  const { slug: _ignore, _id, __v, createdAt, ...patch } = body as Record<string, unknown>;
  void _ignore; void _id; void __v; void createdAt;

  const updated = await SymbolSet.findOneAndUpdate(
    { slug },
    { $set: patch },
    { new: true, runValidators: true },
  ).lean();
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  await connectDB();
  const existing = await SymbolSet.findOne({ slug });
  if (!existing) return NextResponse.json({ error: 'Symbol set not found' }, { status: 404 });
  // Built-ins can be deleted by an admin only — guards against deleting a
  // set that 100 plans reference.
  if (existing.isBuiltIn && session.role !== 'admin') {
    return NextResponse.json({ error: 'Built-in sets are admin-only' }, { status: 403 });
  }
  if (!existing.isBuiltIn && existing.ownerId !== session.userId && session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await SymbolSet.deleteOne({ slug });
  return NextResponse.json({ ok: true, slug });
}
