'use client';

/**
 * Admin formula list.
 * - Shows all formulas (built-in + user) with name, description, author.
 * - Edit link to the per-slug editor, Delete for user-created only.
 * - "Clone from…" shortcut that opens /admin/formulas/new?from=<slug> so users
 *   can start from a canonical preset without risking the built-in.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { DesignFormula } from '@/types/formula';

export default function AdminFormulasPage() {
  const [formulas, setFormulas] = useState<DesignFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/formulas', { cache: 'no-store' });
      const data = (await res.json()) as DesignFormula[];
      setFormulas(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (f: DesignFormula) => {
    if (f.isBuiltIn) {
      alert('Built-in formulas cannot be deleted. Clone and edit a copy instead.');
      return;
    }
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
            Named presets of scoring weights, type quotas, and pinned species. Each formula biases
            the planner toward a specific aesthetic.
          </p>
        </div>
        <Link
          href="/admin/formulas/new"
          className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm rounded-md px-4 py-2"
        >
          + New formula
        </Link>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3 mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="overflow-x-auto border border-stone-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr className="text-left">
                <th className="p-2 font-medium">Name</th>
                <th className="p-2 font-medium">Author</th>
                <th className="p-2 font-medium">Characteristic species</th>
                <th className="p-2 font-medium">Updated</th>
                <th className="p-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {formulas.map((f) => (
                <tr key={f.slug} className="border-b border-stone-100 hover:bg-stone-50 align-top">
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/formulas/${f.slug}`}
                        className="font-medium text-emerald-800 hover:underline"
                      >
                        {f.name}
                      </Link>
                      {f.isBuiltIn && (
                        <span className="text-[10px] uppercase tracking-wide text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">
                          Built-in
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">{f.description}</div>
                    <div className="text-xs text-stone-400 mt-0.5 font-mono">{f.slug}</div>
                  </td>
                  <td className="p-2 text-stone-700">{f.author || '—'}</td>
                  <td className="p-2 text-stone-700 text-xs">
                    {f.characteristicSpecies.length} species
                    {f.characteristicSpecies.length > 0 && (
                      <div className="text-stone-400 truncate max-w-[20rem]" title={f.characteristicSpecies.join(', ')}>
                        {f.characteristicSpecies.slice(0, 3).join(', ')}
                        {f.characteristicSpecies.length > 3 && ` +${f.characteristicSpecies.length - 3}`}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-xs text-stone-500">
                    {f.updatedAt ? new Date(f.updatedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="p-2 whitespace-nowrap text-right">
                    <Link
                      href={`/admin/formulas/new?from=${encodeURIComponent(f.slug)}`}
                      className="text-xs text-stone-700 hover:underline mr-3"
                      title="Clone this formula into a new editable copy"
                    >
                      Clone
                    </Link>
                    <Link
                      href={`/admin/formulas/${f.slug}`}
                      className="text-xs text-emerald-800 hover:underline mr-3"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => remove(f)}
                      disabled={f.isBuiltIn}
                      className="text-xs text-red-700 hover:underline disabled:text-stone-300 disabled:no-underline disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {formulas.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-stone-500">
                    No formulas yet. Run{' '}
                    <code className="bg-stone-100 rounded px-1">src/lib/db/seed-formulas.ts</code>{' '}
                    to seed the built-in presets.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
