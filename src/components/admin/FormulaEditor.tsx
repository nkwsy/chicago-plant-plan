'use client';

/**
 * Shared design-formula editor — used for both "new" and "edit" flows.
 *
 * Layout:
 *  - Left column: metadata (name, description, author), characteristicSpecies
 *    multi-select with autocomplete, tag bonus/penalty chip editors, bloom
 *    month emphasis.
 *  - Right column: sliders for each weight + type/role ratio.
 *
 * Built-in formulas are read-only by default. The "Unlock to edit" checkbox
 * still submits changes to the same slug — use it with care. The typical way
 * to customize a built-in is to Clone first from the list page.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DesignFormula,
  DesignFormulaInput,
  FormulaWeights,
  OudolfRole,
} from '@/types/formula';
import type { PlantType, Plant } from '@/types/plant';

type Mode = 'create' | 'edit';

const PLANT_TYPES: PlantType[] = ['forb', 'grass', 'sedge', 'shrub', 'tree', 'vine', 'fern'];
const ROLES: OudolfRole[] = ['matrix', 'structure', 'scatter', 'filler'];
const WEIGHT_KEYS: (keyof FormulaWeights)[] = [
  'familyDiversity',
  'typeDiversity',
  'bloomCoverage',
  'colorDiversity',
  'wildlife',
  'effort',
  'deerResistance',
  'favorability',
  'winterInterest',
  'seedHead',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function emptyFormula(): DesignFormulaInput {
  return {
    slug: '',
    name: '',
    description: '',
    longDescription: '',
    author: '',
    isBuiltIn: false,
    typeRatios: {},
    roleRatios: {},
    weights: {},
    tagBonuses: {},
    tagPenalties: {},
    characteristicSpecies: [],
    pinBonus: 30,
    bloomEmphasisMonths: [],
    bloomEmphasisBonus: 10,
  };
}

export default function FormulaEditor({
  initial,
  mode,
}: {
  initial: Partial<DesignFormula>;
  mode: Mode;
}) {
  const router = useRouter();
  const [formula, setFormula] = useState<DesignFormulaInput>({
    ...emptyFormula(),
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Built-ins are read-only until the user explicitly unlocks. This is a safety
  // net against accidental edits to canonical presets; cloning is still the
  // preferred path (see the Clone button on the list page).
  const [unlocked, setUnlocked] = useState(!initial.isBuiltIn);

  const disabled = initial.isBuiltIn === true && !unlocked;

  const update = <K extends keyof DesignFormulaInput>(key: K, value: DesignFormulaInput[K]) =>
    setFormula((prev) => ({ ...prev, [key]: value }));

  const updateRatio = (
    field: 'typeRatios' | 'roleRatios',
    key: string,
    value: number | undefined,
  ) => {
    setFormula((prev) => {
      const next = { ...(prev[field] as Record<string, number>) };
      if (value === undefined || value === 0) delete next[key];
      else next[key] = value;
      return { ...prev, [field]: next };
    });
  };

  const updateWeight = (key: keyof FormulaWeights, value: number | undefined) => {
    setFormula((prev) => {
      const next = { ...prev.weights };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return { ...prev, weights: next };
    });
  };

  const submit = async () => {
    if (!formula.name) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const url = mode === 'create' ? '/api/formulas' : `/api/formulas/${encodeURIComponent(formula.slug)}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formula),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || res.statusText);
        return;
      }
      const saved = (await res.json()) as DesignFormula;
      router.push(`/admin/formulas/${saved.slug}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Running sum for the type/role ratio sliders — formulas don't need to sum
  // to 1, but seeing the running total helps the editor understand how much
  // quota pressure they're applying.
  const typeSum = useMemo(
    () => Object.values(formula.typeRatios).reduce((a, b) => a + (b || 0), 0),
    [formula.typeRatios],
  );
  const roleSum = useMemo(
    () => Object.values(formula.roleRatios).reduce((a, b) => a + (b || 0), 0),
    [formula.roleRatios],
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">
          {mode === 'create' ? 'New formula' : `Edit: ${formula.name}`}
        </h1>
        {initial.isBuiltIn && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-[10px] uppercase tracking-wide text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">
              Built-in
            </span>
            <label className="inline-flex items-center gap-1.5 text-stone-700">
              <input
                type="checkbox"
                checked={unlocked}
                onChange={(e) => setUnlocked(e.target.checked)}
              />
              Unlock to edit (prefer Clone instead)
            </label>
          </div>
        )}
      </header>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3 mb-4">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* LEFT: metadata, pins, tags, bloom months */}
        <section className="space-y-5">
          <Field label="Slug">
            <input
              type="text"
              disabled={mode === 'edit'}
              value={formula.slug}
              onChange={(e) => update('slug', e.target.value)}
              placeholder="auto-generated from name if empty"
              className="w-full border border-stone-300 rounded px-2 py-1 text-sm disabled:bg-stone-50 disabled:text-stone-500"
            />
          </Field>

          <Field label="Name">
            <input
              type="text"
              disabled={disabled}
              value={formula.name}
              onChange={(e) => update('name', e.target.value)}
              className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
            />
          </Field>

          <Field label="Short description" hint="Shown on the wizard tile.">
            <textarea
              disabled={disabled}
              rows={2}
              value={formula.description}
              onChange={(e) => update('description', e.target.value)}
              className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
            />
          </Field>

          <Field label="Long description" hint="Admin-only notes.">
            <textarea
              disabled={disabled}
              rows={3}
              value={formula.longDescription || ''}
              onChange={(e) => update('longDescription', e.target.value)}
              className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
            />
          </Field>

          <Field label="Author">
            <input
              type="text"
              disabled={disabled}
              value={formula.author || ''}
              onChange={(e) => update('author', e.target.value)}
              className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
            />
          </Field>

          <CharacteristicSpeciesPicker
            disabled={disabled}
            value={formula.characteristicSpecies}
            onChange={(next) => update('characteristicSpecies', next)}
          />

          <Field
            label={`Pin bonus: ${formula.pinBonus ?? 30}`}
            hint="Extra score added when a candidate is in characteristic species."
          >
            <input
              type="range"
              disabled={disabled}
              min={0}
              max={100}
              step={5}
              value={formula.pinBonus ?? 30}
              onChange={(e) => update('pinBonus', Number(e.target.value))}
              className="w-full"
            />
          </Field>

          <TagEditor
            label="Tag bonuses"
            hint="Add score when a plant has a matching tag."
            disabled={disabled}
            value={formula.tagBonuses}
            onChange={(next) => update('tagBonuses', next)}
            defaultDelta={10}
          />

          <TagEditor
            label="Tag penalties"
            hint="Subtract score when a plant has a matching tag. Use negative numbers."
            disabled={disabled}
            value={formula.tagPenalties}
            onChange={(next) => update('tagPenalties', next)}
            defaultDelta={-10}
          />

          <Field label="Bloom emphasis months">
            <div className="flex flex-wrap gap-1.5">
              {MONTHS.map((label, i) => {
                const m = i + 1;
                const selected = (formula.bloomEmphasisMonths || []).includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const current = formula.bloomEmphasisMonths || [];
                      const next = selected ? current.filter((x) => x !== m) : [...current, m].sort();
                      update('bloomEmphasisMonths', next);
                    }}
                    className={`px-2 py-1 rounded border text-xs ${
                      selected
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                        : 'border-stone-200 hover:border-stone-300 bg-white'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label={`Bloom emphasis bonus: ${formula.bloomEmphasisBonus ?? 10}`}>
            <input
              type="range"
              disabled={disabled}
              min={0}
              max={30}
              step={1}
              value={formula.bloomEmphasisBonus ?? 10}
              onChange={(e) => update('bloomEmphasisBonus', Number(e.target.value))}
              className="w-full"
            />
          </Field>
        </section>

        {/* RIGHT: weights, ratios */}
        <section className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-medium">Plant-type quotas</h3>
              <span className="text-xs text-stone-500">sum {Math.round(typeSum * 100)}%</span>
            </div>
            <p className="text-xs text-stone-500 mb-2">
              Fractions of the target species count reserved for each type. Omitted = no quota.
            </p>
            <div className="space-y-1">
              {PLANT_TYPES.map((t) => (
                <RatioRow
                  key={t}
                  label={t}
                  disabled={disabled}
                  value={formula.typeRatios[t] ?? 0}
                  onChange={(v) => updateRatio('typeRatios', t, v)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-medium">Oudolf-role quotas</h3>
              <span className="text-xs text-stone-500">sum {Math.round(roleSum * 100)}%</span>
            </div>
            <p className="text-xs text-stone-500 mb-2">
              Only effective once plants are tagged with <code>oudolfRole</code>.
            </p>
            <div className="space-y-1">
              {ROLES.map((r) => (
                <RatioRow
                  key={r}
                  label={r}
                  disabled={disabled}
                  value={formula.roleRatios[r] ?? 0}
                  onChange={(v) => updateRatio('roleRatios', r, v)}
                />
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-1">Signal weights</h3>
            <p className="text-xs text-stone-500 mb-2">
              1× is the default, 0 disables, 2× doubles. <code>winterInterest</code> and{' '}
              <code>seedHead</code> only contribute when explicitly weighted above 0.
            </p>
            <div className="space-y-1">
              {WEIGHT_KEYS.map((k) => (
                <WeightRow
                  key={k}
                  label={k}
                  disabled={disabled}
                  value={formula.weights[k]}
                  onChange={(v) => updateWeight(k, v)}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end gap-3 mt-8 pt-4 border-t border-stone-200">
        <button
          onClick={() => router.push('/admin/formulas')}
          className="text-sm text-stone-600 hover:text-stone-900 px-4 py-2"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || disabled}
          className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-300 text-white text-sm rounded-md px-5 py-2"
        >
          {saving ? 'Saving…' : mode === 'create' ? 'Create formula' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {hint && <div className="text-xs text-stone-500 mb-1.5">{hint}</div>}
      {children}
    </label>
  );
}

function RatioRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 text-stone-700 capitalize">{label}</span>
      <input
        type="range"
        disabled={disabled}
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-12 text-right text-xs tabular-nums text-stone-600">
        {Math.round(value * 100)}%
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(undefined)}
        className="text-xs text-stone-400 hover:text-red-600 disabled:opacity-40 w-4"
        title="Clear"
      >
        ×
      </button>
    </div>
  );
}

function WeightRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: keyof FormulaWeights;
  value: number | undefined;
  disabled?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const effective = value ?? 1;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32 text-stone-700">{label}</span>
      <input
        type="range"
        disabled={disabled}
        min={0}
        max={3}
        step={0.1}
        value={effective}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
      />
      <span className="w-12 text-right text-xs tabular-nums text-stone-600">
        {effective.toFixed(1)}×
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(undefined)}
        className="text-xs text-stone-400 hover:text-red-600 disabled:opacity-40 w-4"
        title="Clear (reset to 1×)"
      >
        ×
      </button>
    </div>
  );
}

function TagEditor({
  label,
  hint,
  value,
  onChange,
  disabled,
  defaultDelta,
}: {
  label: string;
  hint: string;
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled?: boolean;
  defaultDelta: number;
}) {
  const [tag, setTag] = useState('');
  const [delta, setDelta] = useState(defaultDelta);
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {Object.entries(value).map(([k, v]) => (
          <span
            key={k}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-stone-100 text-xs"
          >
            <span className="font-mono">{k}</span>
            <input
              type="number"
              disabled={disabled}
              value={v}
              onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}
              className="w-14 border border-stone-300 rounded px-1 text-xs"
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                const next = { ...value };
                delete next[k];
                onChange(next);
              }}
              className="text-stone-400 hover:text-red-600"
            >
              ×
            </button>
          </span>
        ))}
        {Object.keys(value).length === 0 && (
          <span className="text-xs text-stone-400">No tags yet.</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          disabled={disabled}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder="tag (e.g. warm-season-grass)"
          className="flex-1 border border-stone-300 rounded px-2 py-1 text-sm"
        />
        <input
          type="number"
          disabled={disabled}
          value={delta}
          onChange={(e) => setDelta(Number(e.target.value))}
          className="w-20 border border-stone-300 rounded px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={disabled || !tag.trim()}
          onClick={() => {
            onChange({ ...value, [tag.trim()]: delta });
            setTag('');
            setDelta(defaultDelta);
          }}
          className="text-sm px-3 py-1 bg-stone-800 text-white rounded disabled:bg-stone-300"
        >
          Add
        </button>
      </div>
    </Field>
  );
}

/** Picker for pinned species. Fetches the plant list once and filters in-memory
 *  for the typeahead. Displays selected species as removable chips. */
function CharacteristicSpeciesPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetch('/api/plants')
      .then((r) => r.json())
      .then((data: Plant[]) => setPlants(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const bySlug = useMemo(() => {
    const m = new Map<string, Plant>();
    for (const p of plants) m.set(p.slug, p);
    return m;
  }, [plants]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const selected = new Set(value);
    return plants
      .filter((p) => !selected.has(p.slug))
      .filter(
        (p) =>
          p.commonName.toLowerCase().includes(q) ||
          p.scientificName.toLowerCase().includes(q) ||
          p.slug.includes(q),
      )
      .slice(0, 6);
  }, [plants, query, value]);

  return (
    <Field
      label="Characteristic species"
      hint="Signature picks that get a pin bonus when present in candidate set."
    >
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((slug) => {
          const p = bySlug.get(slug);
          return (
            <span
              key={slug}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs"
            >
              <span>{p?.commonName || slug}</span>
              {p?.scientificName && (
                <span className="italic text-stone-500">{p.scientificName}</span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((s) => s !== slug))}
                className="text-emerald-700 hover:text-red-600"
              >
                ×
              </button>
            </span>
          );
        })}
        {value.length === 0 && (
          <span className="text-xs text-stone-400">No species pinned.</span>
        )}
      </div>
      <div className="relative">
        <input
          type="text"
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plants by name…"
          className="w-full border border-stone-300 rounded px-2 py-1 text-sm"
        />
        {filtered.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-md shadow-sm overflow-hidden">
            {filtered.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  onChange([...value, p.slug]);
                  setQuery('');
                }}
                className="block w-full text-left px-3 py-2 hover:bg-stone-50 text-sm"
              >
                <span className="font-medium">{p.commonName}</span>{' '}
                <span className="text-xs italic text-stone-500">{p.scientificName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
