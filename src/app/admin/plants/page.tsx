'use client';

/**
 * Admin plant list.
 * - Table view with search, favorability & completeness sort.
 * - Quick-toggle favorability via a slider on each row (auto-saved).
 * - "Enrich" button next to each plant (Claude patch).
 * - Batch enrich control.
 * - Link to create new.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Plant } from '@/types/plant';
import { computeCompleteness } from '@/lib/plants/completeness';

interface BatchSummary {
  total: number;
  incomplete: number;
  anthropicConfigured: boolean;
  threshold: number;
  sample: Array<{ slug: string; commonName: string; score: number; missing: string[]; weak: string[] }>;
}

interface BatchOutcome {
  slug: string;
  commonName: string;
  beforeScore: number;
  afterScore?: number;
  status: 'enriched' | 'skipped' | 'error';
  error?: string;
  patchedFields?: string[];
}

export default function AdminPlantsPage() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'favorability' | 'completeness'>('name');
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchOutcomes, setBatchOutcomes] = useState<BatchOutcome[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const loadPlants = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/plants', { cache: 'no-store' });
    const data = (await res.json()) as Plant[];
    setPlants(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  const loadSummary = useCallback(async () => {
    const res = await fetch('/api/plants/enrich-batch', { cache: 'no-store' });
    if (res.ok) setBatchSummary((await res.json()) as BatchSummary);
  }, []);

  useEffect(() => {
    loadPlants();
    loadSummary();
  }, [loadPlants, loadSummary]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    let list = s
      ? plants.filter(
          (p) =>
            p.commonName.toLowerCase().includes(s) ||
            p.scientificName.toLowerCase().includes(s) ||
            (p.family || '').toLowerCase().includes(s),
        )
      : [...plants];

    if (sortKey === 'name') list.sort((a, b) => a.commonName.localeCompare(b.commonName));
    else if (sortKey === 'favorability')
      list.sort((a, b) => (b.favorability ?? 50) - (a.favorability ?? 50));
    else if (sortKey === 'completeness')
      list.sort((a, b) => computeCompleteness(a).score - computeCompleteness(b).score);

    return list;
  }, [plants, search, sortKey]);

  const updateFavorability = async (slug: string, value: number) => {
    // Optimistic UI update
    setPlants((prev) =>
      prev.map((p) => (p.slug === slug ? { ...p, favorability: value } : p)),
    );
    await fetch(`/api/plants?slug=${encodeURIComponent(slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorability: value }),
    });
  };

  const deletePlant = async (slug: string) => {
    if (!confirm(`Delete "${slug}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/plants?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
    if (res.ok) setPlants((prev) => prev.filter((p) => p.slug !== slug));
  };

  const enrichOne = async (slug: string) => {
    const res = await fetch(`/api/plants/enrich?slug=${encodeURIComponent(slug)}&save=1`, {
      method: 'POST',
    });
    if (!res.ok) {
      alert(`Enrich failed: ${((await res.json()) as { error?: string }).error}`);
      return;
    }
    await loadPlants();
    await loadSummary();
  };

  const runBatch = async () => {
    setBatchRunning(true);
    setBatchError(null);
    setBatchOutcomes([]);
    try {
      const res = await fetch('/api/plants/enrich-batch?limit=10', { method: 'POST' });
      const data = (await res.json()) as { outcomes?: BatchOutcome[]; error?: string };
      if (!res.ok) setBatchError(data.error || 'Unknown error');
      else setBatchOutcomes(data.outcomes || []);
      await loadPlants();
      await loadSummary();
    } catch (e) {
      setBatchError((e as Error).message);
    } finally {
      setBatchRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <header className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-bold">Plants</h1>
          <p className="text-sm text-stone-600 mt-1">
            {plants.length} plant{plants.length === 1 ? '' : 's'} in database.
            {batchSummary &&
              ` ${batchSummary.incomplete} below completeness ${batchSummary.threshold}.`}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Link
            href="/admin/plants/new"
            className="bg-emerald-700 hover:bg-emerald-800 text-white text-sm rounded-md px-4 py-2"
          >
            + Add plant
          </Link>
          <button
            onClick={runBatch}
            disabled={batchRunning || !batchSummary?.anthropicConfigured || !batchSummary?.incomplete}
            className="bg-stone-800 hover:bg-stone-900 disabled:bg-stone-300 text-white text-sm rounded-md px-4 py-2"
            title={
              !batchSummary?.anthropicConfigured
                ? 'Set ANTHROPIC_API_KEY to enable'
                : 'Enrich up to 10 of the most incomplete plants'
            }
          >
            {batchRunning ? 'Enriching…' : `Run batch enrich (${batchSummary?.incomplete ?? 0})`}
          </button>
        </div>
      </header>

      {!batchSummary?.anthropicConfigured && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-md p-3 mb-4">
          Set <code className="bg-amber-100 px-1 rounded">ANTHROPIC_API_KEY</code> in
          <code className="bg-amber-100 px-1 rounded mx-1">.env.local</code> to enable Claude
          enrichment of species data.
        </div>
      )}

      {batchError && (
        <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3 mb-4">
          {batchError}
        </div>
      )}

      {batchOutcomes.length > 0 && (
        <details open className="bg-stone-50 border border-stone-200 rounded-md mb-4">
          <summary className="cursor-pointer p-3 text-sm font-medium">
            Last batch: {batchOutcomes.filter((o) => o.status === 'enriched').length} enriched,{' '}
            {batchOutcomes.filter((o) => o.status === 'skipped').length} skipped,{' '}
            {batchOutcomes.filter((o) => o.status === 'error').length} errored
          </summary>
          <ul className="p-3 pt-0 text-xs font-mono">
            {batchOutcomes.map((o) => (
              <li key={o.slug} className="py-0.5">
                [{o.status}] {o.commonName} {o.beforeScore}→{o.afterScore ?? '?'}
                {o.patchedFields?.length ? ` — ${o.patchedFields.join(', ')}` : ''}
                {o.error ? ` — ${o.error}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, scientific, family…"
          className="flex-1 min-w-64 border border-stone-300 rounded-md px-3 py-2 text-sm"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
          className="border border-stone-300 rounded-md px-3 py-2 text-sm"
        >
          <option value="name">Sort: Name</option>
          <option value="favorability">Sort: Favorability (high→low)</option>
          <option value="completeness">Sort: Completeness (low→high)</option>
        </select>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="overflow-x-auto border border-stone-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr className="text-left">
                <th className="p-2 font-medium">Plant</th>
                <th className="p-2 font-medium">Type</th>
                <th className="p-2 font-medium">Favorability</th>
                <th className="p-2 font-medium">Completeness</th>
                <th className="p-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const completeness = computeCompleteness(p);
                const fav = p.favorability ?? 50;
                return (
                  <tr key={p.slug} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="p-2">
                      <Link
                        href={`/admin/plants/${p.slug}`}
                        className="font-medium text-emerald-800 hover:underline"
                      >
                        {p.commonName}
                      </Link>
                      <div className="text-xs text-stone-500 italic">{p.scientificName}</div>
                    </td>
                    <td className="p-2 text-stone-700">{p.plantType}</td>
                    <td className="p-2 w-56">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={fav}
                          onChange={(e) => updateFavorability(p.slug, Number(e.target.value))}
                          className="flex-1"
                        />
                        <span className="w-8 text-right text-xs tabular-nums">{fav}</span>
                      </div>
                    </td>
                    <td className="p-2 w-48">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              completeness.score >= 80
                                ? 'bg-emerald-500'
                                : completeness.score >= 50
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${completeness.score}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums">
                          {completeness.score}
                        </span>
                      </div>
                      {completeness.missing.length > 0 && (
                        <div
                          className="text-xs text-stone-500 mt-0.5 truncate"
                          title={completeness.missing.join(', ')}
                        >
                          missing: {completeness.missing.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="p-2 w-48 whitespace-nowrap text-right">
                      <button
                        onClick={() => enrichOne(p.slug)}
                        className="text-xs text-emerald-800 hover:underline mr-3"
                        title="Ask Claude to fill missing fields"
                      >
                        Enrich
                      </button>
                      <button
                        onClick={() => deletePlant(p.slug)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-stone-500">
                    No plants match.
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
