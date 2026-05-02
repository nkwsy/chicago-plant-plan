'use client';

/**
 * Admin: symbol sets.
 *
 * Lists every symbol set the caller can see. Clicking one opens an inline
 * editor with a live preview palette: family/tier glyphs render as small
 * SVG tiles, paste an SVG body to replace one, and save. Built-ins are
 * read-only without explicit "Edit anyway" confirmation.
 *
 * Glyph SVGs are stored as raw inner-SVG markup (no <svg> wrapper); the
 * renderer wraps with a 24×24 viewBox and applies `currentColor`.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { SymbolSet, SymbolGlyph } from '@/types/symbol-set';

const FAMILY_ORDER = [
  'Asteraceae',
  'Poaceae',
  'Cyperaceae',
  'Apiaceae',
  'Lamiaceae',
  'Iridaceae',
  'Liliaceae',
  'Fagaceae',
  'Rosaceae',
];
const TIERS = [5, 4, 3, 2, 1] as const;

function GlyphTile({
  glyph,
  size = 48,
}: {
  glyph: SymbolGlyph | undefined;
  size?: number;
}) {
  if (!glyph?.svg) {
    return (
      <div
        className="border border-dashed border-stone-300 rounded-md flex items-center justify-center text-stone-300 text-xs"
        style={{ width: size, height: size }}
      >
        —
      </div>
    );
  }
  // SVG body is trusted (came from our DB / seed file). For paste-in user
  // input we sanitize lightly via a strip-script regex below.
  const inner = glyph.svg;
  return (
    <div
      className="border border-stone-200 rounded-md flex items-center justify-center bg-white"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size - 8}
        height={size - 8}
        style={{ color: glyph.defaultColor || '#2a2a2a' }}
        dangerouslySetInnerHTML={{ __html: inner }}
      />
    </div>
  );
}

function sanitizeSvgBody(input: string): string {
  // Prevent the obvious XSS trapdoor: drop <script> tags and on* attribute
  // handlers. Curators are admins anyway, but we're rendering this back to
  // the public plan view too, so belt-and-suspenders.
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
}

export default function AdminSymbolSetsPage() {
  const [sets, setSets] = useState<SymbolSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/symbol-sets', { cache: 'no-store' });
    const data = (await res.json()) as SymbolSet[];
    setSets(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const active = useMemo(() => sets.find((s) => s.slug === activeSlug) || null, [sets, activeSlug]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Symbol sets</h1>
        <p className="text-sm text-stone-600 mt-1">
          Reusable libraries of SVG glyphs. Plans pick a set; the renderer
          falls back from per-plant override → family → tier → set fallback.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* List */}
        <aside className="col-span-4">
          {loading ? (
            <p className="text-sm text-stone-500">Loading…</p>
          ) : sets.length === 0 ? (
            <p className="text-sm text-stone-500">No symbol sets yet.</p>
          ) : (
            <ul className="border border-stone-200 rounded-md divide-y divide-stone-100">
              {sets.map((s) => (
                <li
                  key={s.slug}
                  className={`p-3 cursor-pointer ${activeSlug === s.slug ? 'bg-emerald-50' : 'hover:bg-stone-50'}`}
                  onClick={() => setActiveSlug(s.slug)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-stone-500 truncate">{s.description}</div>
                    </div>
                    {s.isBuiltIn && (
                      <span className="text-[10px] uppercase tracking-wider bg-stone-200 text-stone-700 rounded px-1.5 py-0.5">
                        built-in
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-1">
                    {FAMILY_ORDER.slice(0, 6).map((fam) => (
                      <GlyphTile
                        key={fam}
                        glyph={s.byFamily?.[fam]}
                        size={28}
                      />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Editor */}
        <section className="col-span-8">
          {!active ? (
            <p className="text-sm text-stone-500">Pick a set on the left to inspect or edit.</p>
          ) : (
            <SymbolSetEditor
              set={active}
              onSaved={(updated) => {
                setSets((prev) => prev.map((s) => (s.slug === updated.slug ? updated : s)));
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function SymbolSetEditor({
  set,
  onSaved,
}: {
  set: SymbolSet;
  onSaved: (s: SymbolSet) => void;
}) {
  // Local edit state — seeded from the set, only flushed on Save.
  const [draft, setDraft] = useState<SymbolSet>(() => structuredClone(set));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bypassBuiltIn, setBypassBuiltIn] = useState(false);

  // Re-seed when the user picks a different set in the list.
  useEffect(() => {
    setDraft(structuredClone(set));
    setBypassBuiltIn(false);
    setError(null);
  }, [set]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(set);
  const locked = set.isBuiltIn && !bypassBuiltIn;

  const updateFamilyGlyph = (family: string, svg: string) => {
    setDraft((d) => ({
      ...d,
      byFamily: { ...d.byFamily, [family]: { ...(d.byFamily[family] || {}), svg: sanitizeSvgBody(svg) } },
    }));
  };
  const updateTierGlyph = (tier: number, svg: string) => {
    setDraft((d) => ({
      ...d,
      byTier: { ...d.byTier, [tier]: { ...(d.byTier?.[tier as 1 | 2 | 3 | 4 | 5] || {}), svg: sanitizeSvgBody(svg) } },
    }));
  };

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/symbol-sets?slug=${encodeURIComponent(draft.slug)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error || 'Save failed');
      return;
    }
    onSaved(draft);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{draft.name}</h2>
          <p className="text-sm text-stone-600">{draft.description}</p>
        </div>
        <div className="flex gap-2 items-center">
          {set.isBuiltIn && (
            <label className="text-xs text-stone-700 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={bypassBuiltIn}
                onChange={(e) => setBypassBuiltIn(e.target.checked)}
              />
              Edit built-in
            </label>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!dirty || locked || saving}
            className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white text-sm rounded-md px-4 py-2"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3">{error}</div>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">By family</h3>
        <div className="grid grid-cols-2 gap-3">
          {FAMILY_ORDER.map((fam) => (
            <GlyphRow
              key={fam}
              label={fam}
              glyph={draft.byFamily?.[fam]}
              onSvg={(s) => updateFamilyGlyph(fam, s)}
              locked={locked}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">By tier (fallback when no family glyph matches)</h3>
        <div className="grid grid-cols-2 gap-3">
          {TIERS.map((t) => (
            <GlyphRow
              key={t}
              label={`T${t}`}
              glyph={draft.byTier?.[t]}
              onSvg={(s) => updateTierGlyph(t, s)}
              locked={locked}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Final fallback</h3>
        <GlyphRow
          label="fallback"
          glyph={draft.fallback}
          onSvg={(s) => setDraft((d) => ({ ...d, fallback: { ...d.fallback, svg: sanitizeSvgBody(s) } }))}
          locked={locked}
        />
      </section>
    </div>
  );
}

function GlyphRow({
  label,
  glyph,
  onSvg,
  locked,
}: {
  label: string;
  glyph: SymbolGlyph | undefined;
  onSvg: (svg: string) => void;
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="border border-stone-200 rounded-md p-2 flex items-center gap-3">
      <GlyphTile glyph={glyph} size={48} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium">{label}</div>
        {editing ? (
          <textarea
            defaultValue={glyph?.svg || ''}
            rows={3}
            disabled={locked}
            onBlur={(e) => {
              onSvg(e.target.value);
              setEditing(false);
            }}
            placeholder='<circle cx="12" cy="12" r="3" fill="currentColor"/>'
            className="w-full font-mono text-[11px] border border-stone-300 rounded px-2 py-1 mt-1"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => !locked && setEditing(true)}
            className="text-xs text-emerald-800 hover:underline disabled:text-stone-400"
            disabled={locked}
          >
            {glyph?.svg ? 'Edit SVG' : 'Add SVG'}
          </button>
        )}
      </div>
    </div>
  );
}
