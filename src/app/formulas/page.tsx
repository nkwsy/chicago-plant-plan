'use client';

/**
 * /formulas — user-facing formula list with tabs:
 *   - Built-in: always visible, anyone can browse.
 *   - My formulas: visible when signed in. Shows formulas the user owns.
 *   - All: admin-only superset (moderates others' formulas).
 *
 * Actions per row:
 *   - View     → /formulas/[slug]        (read-only detail)
 *   - Edit     → /formulas/[slug]/edit   (owner or admin only)
 *   - Clone    → /formulas/new?from=…
 *   - Delete   → DELETE /api/formulas/[slug]  (owner or admin, never built-in)
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { DesignFormula } from '@/types/formula';

interface Me {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

type Tab = 'built-in' | 'mine' | 'all';

export default function FormulasListPage() {
  // useSearchParams() requires a Suspense boundary in Next 16 so the client
  // bundle can statically render the surrounding shell before hydrating the
  // tab state. Wrapping the inner component keeps the page prerenderable.
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-6 py-8">Loading…</div>}>
      <FormulasListInner />
    </Suspense>
  );
}

function FormulasListInner() {
  const [formulas, setFormulas] = useState<DesignFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const searchParams = useSearchParams();
  const queryTab = searchParams?.get('tab');
  const [tab, setTab] = useState<Tab>(
    (queryTab === 'mine' || queryTab === 'all') ? queryTab : 'built-in',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, fRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/formulas', { cache: 'no-store' }),
      ]);
      const meData = (await meRes.json()) as { user: Me | null };
      setMe(meData.user);
      const list = (await fRes.json()) as DesignFormula[];
      setFormulas(Array.isArray(list) ? list : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    if (tab === 'built-in') return formulas.filter((f) => f.isBuiltIn);
    if (tab === 'mine') return formulas.filter((f) => me && f.ownerId === me.id);
    return formulas;
  }, [formulas, tab, me]);

  const canManage = (f: DesignFormula): boolean => {
    if (!me) return false;
    if (me.role === 'admin') return !f.isBuiltIn; // admins still can't delete built-ins
    return !!f.ownerId && f.ownerId === me.id;
  };

  const remove = async (f: DesignFormula) => {
    if (!canManage(f)) return;
    if (!confirm(`Delete "${f.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/formulas/${encodeURIComponent(f.slug)}`, { method: 'DELETE' });
    if (res.ok) setFormulas((prev) => prev.filter((x) => x.slug !== f.slug));
    else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      alert(`Delete failed: ${body.error || res.statusText}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold">Design formulas</h1>
          <p className="text-sm text-stone-600 mt-1">
            Named presets of scoring weights, type quotas, and pinned species. Pick one in the
            wizard to bias your plant list toward a style, or build your own.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {me && (
            <Link
              href="/formulas/new"
              className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm rounded-md px-4 py-2"
            >
              + New formula
            </Link>
          )}
          {!me && (
            <Link
              href="/login?next=/formulas"
              className="text-sm text-emerald-800 hover:underline"
            >
              Sign in to create your own →
            </Link>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-stone-200 mb-4">
        <TabButton active={tab === 'built-in'} onClick={() => setTab('built-in')}>
          Built-in
        </TabButton>
        <TabButton
          active={tab === 'mine'}
          onClick={() => me && setTab('mine')}
          disabled={!me}
          title={!me ? 'Sign in to use personal formulas' : undefined}
        >
          My formulas
          {me && (
            <span className="ml-1.5 text-xs text-stone-500 bg-stone-100 rounded-full px-1.5">
              {formulas.filter((f) => f.ownerId === me.id).length}
            </span>
          )}
        </TabButton>
        {me?.role === 'admin' && (
          <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
            All <span className="ml-1.5 text-xs text-stone-500">(admin)</span>
          </TabButton>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState tab={tab} signedIn={!!me} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((f) => (
            <FormulaCard
              key={f.slug}
              formula={f}
              canManage={canManage(f)}
              onDelete={() => remove(f)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-emerald-700 text-emerald-900'
          : disabled
            ? 'border-transparent text-stone-300 cursor-not-allowed'
            : 'border-transparent text-stone-600 hover:text-stone-900'
      }`}
    >
      {children}
    </button>
  );
}

function FormulaCard({
  formula: f,
  canManage,
  onDelete,
}: {
  formula: DesignFormula;
  canManage: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="border border-stone-200 rounded-lg p-4 bg-white hover:border-stone-300 transition-colors flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link href={`/formulas/${f.slug}`} className="font-medium text-emerald-800 hover:underline">
          {f.name}
        </Link>
        {f.isBuiltIn && (
          <span className="text-[10px] uppercase tracking-wide text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">
            Built-in
          </span>
        )}
      </div>
      <p className="text-xs text-stone-500 flex-1">{f.description}</p>
      <div className="text-xs text-stone-400 mt-2">
        {f.characteristicSpecies.length} pinned species
        {f.author ? ` · ${f.author}` : ''}
      </div>
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-stone-100">
        <Link
          href={`/formulas/${f.slug}`}
          className="text-xs text-stone-700 hover:text-emerald-800"
        >
          View
        </Link>
        {canManage && (
          <Link
            href={`/formulas/${f.slug}/edit`}
            className="text-xs text-stone-700 hover:text-emerald-800"
          >
            Edit
          </Link>
        )}
        <Link
          href={`/formulas/new?from=${encodeURIComponent(f.slug)}`}
          className="text-xs text-stone-700 hover:text-emerald-800"
        >
          Clone
        </Link>
        {canManage && (
          <button
            onClick={onDelete}
            className="text-xs text-red-700 hover:underline ml-auto"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ tab, signedIn }: { tab: Tab; signedIn: boolean }) {
  if (tab === 'mine' && !signedIn) {
    return (
      <div className="text-center py-16 text-stone-500">
        <p className="mb-3">Sign in to create and manage your own formulas.</p>
        <Link
          href="/login?next=/formulas?tab=mine"
          className="inline-block text-sm bg-emerald-700 text-white rounded-md px-4 py-2 hover:bg-emerald-800"
        >
          Sign in with Google
        </Link>
      </div>
    );
  }
  if (tab === 'mine') {
    return (
      <div className="text-center py-16 text-stone-500">
        <p className="mb-3">You haven&apos;t created a formula yet.</p>
        <Link
          href="/formulas/new"
          className="inline-block text-sm bg-emerald-700 text-white rounded-md px-4 py-2 hover:bg-emerald-800"
        >
          + Start a new formula
        </Link>
      </div>
    );
  }
  return (
    <div className="text-center py-16 text-stone-500">No formulas found.</div>
  );
}
