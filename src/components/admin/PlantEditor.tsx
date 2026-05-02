'use client';

/**
 * Shared plant editor — used for both "new" and "edit" flows.
 *
 * Design choices:
 * - Single controlled form; no lib to keep deps small. Local state per field
 *   collapses into one `plant` object on submit.
 * - Species lookup (iNaturalist) is only shown on create — once slug is set
 *   it's hidden to avoid accidental overwrites of curator edits.
 * - "Enrich with Claude" fills empty fields only; never overwrites curator
 *   data unless the user hits "Apply to all" after reviewing the diff.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  Plant,
  PlantType,
  SunRequirement,
  MoistureRequirement,
  NativeHabitat,
  WildlifeValue,
  EffortLevel,
} from '@/types/plant';
import { inferSociabilityAndTier } from '@/lib/plants/sociability';

const PLANT_TYPES: PlantType[] = ['forb', 'grass', 'sedge', 'shrub', 'tree', 'vine', 'fern'];
const SUN: SunRequirement[] = ['full_sun', 'part_sun', 'part_shade', 'full_shade'];
const MOISTURE: MoistureRequirement[] = ['dry', 'medium', 'wet'];
const SOILS = ['clay', 'loam', 'sand'] as const;
const HABITATS: NativeHabitat[] = ['prairie', 'woodland', 'wetland', 'savanna'];
const WILDLIFE: WildlifeValue[] = ['pollinators', 'birds', 'butterflies', 'mammals'];
const EFFORT: EffortLevel[] = ['low', 'medium', 'high'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const OUDOLF_ROLES = ['matrix', 'structure', 'scatter', 'filler'] as const;
type OudolfRole = (typeof OUDOLF_ROLES)[number];

const TIER_LABELS: Record<number, string> = {
  5: 'Emergent — tall accents (trees, large shrubs, tall forbs)',
  4: 'Primary structural — silhouette forbs, mid shrubs',
  3: 'Secondary companion — drift forbs, mid grasses',
  2: 'Matrix — groundcover grasses & sedges',
  1: 'Scatter / filler — low gap-fillers, single accents',
};

const SOCIABILITY_LABELS: Record<number, string> = {
  1: 'Solitary specimen',
  2: 'Small group of 3–5',
  3: 'Drift of 6–12',
  4: 'Sweep of 15–30',
  5: 'Colony / continuous carpet',
};

interface InatHit {
  id: number;
  name: string;
  preferredCommonName: string;
  family: string | null;
  photoUrl: string | null;
  photoAttribution: string | null;
}

type Mode = 'create' | 'edit';

export default function PlantEditor({ initial, mode }: { initial: Partial<Plant>; mode: Mode }) {
  const router = useRouter();
  const [plant, setPlant] = useState<Partial<Plant>>({
    favorability: 50,
    deerResistant: false,
    sun: [],
    moisture: [],
    soilTypes: [],
    nativeHabitats: [],
    wildlifeValue: [],
    tags: [],
    bloomStartMonth: 6,
    bloomEndMonth: 8,
    effortLevel: 'low',
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupResults, setLookupResults] = useState<InatHit[] | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichPatch, setEnrichPatch] = useState<Partial<Plant> & { nonNativeWarning?: string } | null>(null);

  const update = <K extends keyof Plant>(key: K, value: Plant[K] | undefined) =>
    setPlant((prev) => ({ ...prev, [key]: value as Plant[K] }));

  const toggleArr = <T extends string>(key: keyof Plant, value: T) =>
    setPlant((prev) => {
      const current = (prev[key] as T[] | undefined) || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [key]: next as unknown as Plant[typeof key] };
    });

  const onLookup = async () => {
    if (!lookupQuery.trim()) return;
    setLookupLoading(true);
    try {
      const res = await fetch(`/api/plants/lookup?q=${encodeURIComponent(lookupQuery)}`);
      const data = (await res.json()) as { results?: InatHit[] };
      setLookupResults(data.results || []);
    } finally {
      setLookupLoading(false);
    }
  };

  const applyInatHit = async (hit: InatHit) => {
    // Hydrate family from the full-taxon endpoint (search response only has
    // ancestor_ids, not resolved names).
    let family = hit.family || '';
    if (!family) {
      try {
        const res = await fetch(`/api/plants/lookup?id=${hit.id}`);
        if (res.ok) {
          const full = (await res.json()) as InatHit;
          family = full.family || '';
        }
      } catch {
        // ignore — user can fill family manually
      }
    }
    setPlant((prev) => ({
      ...prev,
      scientificName: prev.scientificName || hit.name,
      commonName: prev.commonName || hit.preferredCommonName || hit.name,
      family: prev.family || family,
      imageUrl: prev.imageUrl || hit.photoUrl || '',
      imageAttribution: prev.imageAttribution || hit.photoAttribution || '',
      inatTaxonId: hit.id,
    }));
    setLookupResults(null);
    setLookupQuery('');
  };

  const askClaude = async () => {
    setEnrichLoading(true);
    setError(null);
    try {
      // Preview first — no save. On edit pages we send slug so the server can
      // read the current DB state; on create, we send the in-memory plant.
      const url =
        mode === 'edit' && plant.slug
          ? `/api/plants/enrich?slug=${encodeURIComponent(plant.slug)}`
          : '/api/plants/enrich';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: mode === 'create' ? JSON.stringify(plant) : undefined,
      });
      const data = (await res.json()) as { patch?: Partial<Plant>; error?: string };
      if (!res.ok) {
        setError(data.error || 'Enrichment failed');
        return;
      }
      setEnrichPatch(data.patch || {});
    } finally {
      setEnrichLoading(false);
    }
  };

  const applyPatch = () => {
    if (!enrichPatch) return;
    const { nonNativeWarning, ...patch } = enrichPatch;
    void nonNativeWarning;
    setPlant((prev) => ({ ...prev, ...patch }));
    setEnrichPatch(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res =
        mode === 'create'
          ? await fetch('/api/plants', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(plant),
            })
          : await fetch(`/api/plants?slug=${encodeURIComponent(plant.slug!)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(plant),
            });
      const data = (await res.json()) as { error?: string; slug?: string };
      if (!res.ok) {
        setError(data.error || 'Save failed');
        return;
      }
      router.push('/admin/plants');
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-3xl font-bold">
          {mode === 'create' ? 'New plant' : plant.commonName || plant.slug}
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={askClaude}
            disabled={enrichLoading || (!plant.scientificName && !plant.commonName)}
            className="bg-stone-800 hover:bg-stone-900 disabled:bg-stone-300 text-white text-sm rounded-md px-4 py-2"
            title="Ask Claude to suggest values for empty fields"
          >
            {enrichLoading ? 'Asking Claude…' : 'Enrich with Claude'}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-emerald-700 hover:bg-emerald-800 disabled:bg-emerald-300 text-white text-sm rounded-md px-4 py-2"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </header>

      {error && <div className="bg-red-50 border border-red-200 text-red-900 text-sm rounded-md p-3">{error}</div>}

      {enrichPatch && Object.keys(enrichPatch).length > 0 && (
        <div className="bg-sky-50 border border-sky-200 rounded-md p-3 text-sm">
          <div className="flex items-center justify-between mb-2">
            <strong>Claude suggests:</strong>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEnrichPatch(null)}
                className="text-xs text-stone-700 hover:underline"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={applyPatch}
                className="text-xs bg-sky-700 text-white rounded px-2 py-1"
              >
                Apply all
              </button>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            {Object.entries(enrichPatch).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-sky-800">{k}</dt>
                <dd>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
              </div>
            ))}
          </dl>
          {enrichPatch.nonNativeWarning && (
            <p className="text-xs text-amber-800 mt-2">⚠️ {enrichPatch.nonNativeWarning}</p>
          )}
        </div>
      )}

      {mode === 'create' && (
        <section className="bg-stone-50 border border-stone-200 rounded-md p-4">
          <h2 className="font-semibold text-sm mb-2">Look up species (iNaturalist)</h2>
          <div className="flex gap-2">
            <input
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onLookup())}
              placeholder="Common or scientific name…"
              className="flex-1 border border-stone-300 rounded-md px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={onLookup}
              disabled={lookupLoading}
              className="bg-stone-700 hover:bg-stone-800 text-white text-sm rounded-md px-4 py-2"
            >
              {lookupLoading ? 'Searching…' : 'Search'}
            </button>
          </div>
          {lookupResults && lookupResults.length > 0 && (
            <ul className="mt-3 divide-y divide-stone-200 border border-stone-200 rounded-md bg-white">
              {lookupResults.map((hit) => (
                <li key={hit.id} className="flex items-center gap-3 p-2">
                  {hit.photoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={hit.photoUrl} alt={hit.name} className="w-10 h-10 rounded object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded bg-stone-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{hit.preferredCommonName || hit.name}</div>
                    <div className="text-xs text-stone-500 italic truncate">
                      {hit.name}
                      {hit.family ? ` · ${hit.family}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applyInatHit(hit)}
                    className="text-xs text-emerald-800 hover:underline"
                  >
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lookupResults && lookupResults.length === 0 && (
            <p className="text-xs text-stone-500 mt-2">No results.</p>
          )}
        </section>
      )}

      <section className="grid grid-cols-2 gap-4">
        <Field label="Common name *">
          <input
            value={plant.commonName || ''}
            onChange={(e) => update('commonName', e.target.value)}
            className="input"
            required
          />
        </Field>
        <Field label="Scientific name *">
          <input
            value={plant.scientificName || ''}
            onChange={(e) => update('scientificName', e.target.value)}
            className="input italic"
            required
          />
        </Field>
        <Field label="Family">
          <input
            value={plant.family || ''}
            onChange={(e) => update('family', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Plant type *">
          <select
            value={plant.plantType || ''}
            onChange={(e) => update('plantType', e.target.value as PlantType)}
            className="input"
            required
          >
            <option value="">—</option>
            {PLANT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="grid grid-cols-4 gap-4">
        <Field label="Height min (in)">
          <input
            type="number"
            value={plant.heightMinInches ?? ''}
            onChange={(e) => update('heightMinInches', e.target.value ? Number(e.target.value) : undefined)}
            className="input"
          />
        </Field>
        <Field label="Height max (in)">
          <input
            type="number"
            value={plant.heightMaxInches ?? ''}
            onChange={(e) => update('heightMaxInches', e.target.value ? Number(e.target.value) : undefined)}
            className="input"
          />
        </Field>
        <Field label="Spread min (in)">
          <input
            type="number"
            value={plant.spreadMinInches ?? ''}
            onChange={(e) => update('spreadMinInches', e.target.value ? Number(e.target.value) : undefined)}
            className="input"
          />
        </Field>
        <Field label="Spread max (in)">
          <input
            type="number"
            value={plant.spreadMaxInches ?? ''}
            onChange={(e) => update('spreadMaxInches', e.target.value ? Number(e.target.value) : undefined)}
            className="input"
          />
        </Field>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Growing conditions</h2>
        <Multi
          label="Sun"
          options={SUN}
          values={plant.sun || []}
          onToggle={(v) => toggleArr('sun', v)}
        />
        <Multi
          label="Moisture"
          options={MOISTURE}
          values={plant.moisture || []}
          onToggle={(v) => toggleArr('moisture', v)}
        />
        <Multi
          label="Soil"
          options={[...SOILS]}
          values={plant.soilTypes || []}
          onToggle={(v) => toggleArr('soilTypes', v)}
        />
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Field label="Bloom start month">
          <select
            value={plant.bloomStartMonth ?? ''}
            onChange={(e) => update('bloomStartMonth', Number(e.target.value))}
            className="input"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {i + 1} — {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bloom end month">
          <select
            value={plant.bloomEndMonth ?? ''}
            onChange={(e) => update('bloomEndMonth', Number(e.target.value))}
            className="input"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {i + 1} — {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bloom color">
          <input
            value={plant.bloomColor || ''}
            onChange={(e) => update('bloomColor', e.target.value)}
            placeholder="purple, gold, white…"
            className="input"
          />
        </Field>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Ecology</h2>
        <Multi
          label="Habitats"
          options={HABITATS}
          values={plant.nativeHabitats || []}
          onToggle={(v) => toggleArr('nativeHabitats', v)}
        />
        <Multi
          label="Wildlife value"
          options={WILDLIFE}
          values={plant.wildlifeValue || []}
          onToggle={(v) => toggleArr('wildlifeValue', v)}
        />
      </section>

      <section>
        <header className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Design role &amp; layout geometry</h2>
          <button
            type="button"
            onClick={() => {
              const inferred = inferSociabilityAndTier(plant);
              setPlant((prev) => ({
                ...prev,
                sociability: inferred.sociability,
                tier: inferred.tier,
              }));
            }}
            className="text-xs text-emerald-800 hover:underline"
            title="Recompute sociability + tier from plantType, oudolfRole, and size"
          >
            Auto-infer from botanical fields
          </button>
        </header>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Oudolf role">
            <select
              value={plant.oudolfRole || ''}
              onChange={(e) =>
                update('oudolfRole', (e.target.value || undefined) as OudolfRole | undefined)
              }
              className="input"
            >
              <option value="">— unset —</option>
              {OUDOLF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500 mt-1">
              How the plant functions in a naturalistic composition.
            </p>
          </Field>

          <Field label="Hierarchy tier">
            <select
              value={plant.tier ?? ''}
              onChange={(e) =>
                update(
                  'tier',
                  (e.target.value
                    ? (Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                    : undefined),
                )
              }
              className="input"
            >
              <option value="">— unset —</option>
              {[5, 4, 3, 2, 1].map((t) => (
                <option key={t} value={t}>
                  T{t} — {TIER_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500 mt-1">
              5 = emergent canopy → 1 = scatter / filler. Drives Voronoi-cell weight in the
              tapestry layout.
            </p>
          </Field>

          <Field label="Sociability">
            <select
              value={plant.sociability ?? ''}
              onChange={(e) =>
                update(
                  'sociability',
                  (e.target.value
                    ? (Number(e.target.value) as 1 | 2 | 3 | 4 | 5)
                    : undefined),
                )
              }
              className="input"
            >
              <option value="">— unset —</option>
              {[1, 2, 3, 4, 5].map((s) => (
                <option key={s} value={s}>
                  S{s} — {SOCIABILITY_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="text-xs text-stone-500 mt-1">
              How many plants typically cluster together. Aster-style scale.
            </p>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-3">
          <Field label="Seed-head interest">
            <input
              type="checkbox"
              checked={!!plant.seedHeadInterest}
              onChange={(e) => update('seedHeadInterest', e.target.checked)}
              className="mt-2"
            />
          </Field>
          <Field label="Winter structure">
            <input
              type="checkbox"
              checked={!!plant.winterStructure}
              onChange={(e) => update('winterStructure', e.target.checked)}
              className="mt-2"
            />
          </Field>
          <Field label="Default symbol key">
            <input
              value={plant.defaultSymbolKey || ''}
              onChange={(e) => update('defaultSymbolKey', e.target.value || undefined)}
              placeholder="optional override into a symbol set"
              className="input"
            />
          </Field>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Field label="Effort level">
          <select
            value={plant.effortLevel || 'low'}
            onChange={(e) => update('effortLevel', e.target.value as EffortLevel)}
            className="input"
          >
            {EFFORT.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deer resistant">
          <input
            type="checkbox"
            checked={!!plant.deerResistant}
            onChange={(e) => update('deerResistant', e.target.checked)}
            className="mt-2"
          />
        </Field>
        <Field label={`Favorability (${plant.favorability ?? 50})`}>
          <input
            type="range"
            min={0}
            max={100}
            value={plant.favorability ?? 50}
            onChange={(e) => update('favorability', Number(e.target.value))}
            className="w-full mt-2"
          />
          <p className="text-xs text-stone-500 mt-1">
            50 = neutral. Above 50 boosts in plan generation; below 50 deprioritizes.
          </p>
        </Field>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Description</h2>
        <Field label="Description (shown to end users)">
          <textarea
            value={plant.description || ''}
            onChange={(e) => update('description', e.target.value)}
            rows={3}
            className="input"
          />
        </Field>
        <Field label="Care notes">
          <textarea
            value={plant.careNotes || ''}
            onChange={(e) => update('careNotes', e.target.value)}
            rows={2}
            className="input"
          />
        </Field>
        <Field label="Planting instructions">
          <textarea
            value={plant.plantingInstructions || ''}
            onChange={(e) => update('plantingInstructions', e.target.value)}
            rows={2}
            className="input"
          />
        </Field>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Image &amp; tags</h2>
        <Field label="Image URL">
          <input
            value={plant.imageUrl || ''}
            onChange={(e) => update('imageUrl', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Image attribution">
          <input
            value={plant.imageAttribution || ''}
            onChange={(e) => update('imageAttribution', e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Tags (comma-separated)">
          <input
            value={(plant.tags || []).join(', ')}
            onChange={(e) =>
              update(
                'tags',
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            className="input"
            placeholder="keystone, monarch-host, rare"
          />
        </Field>
        <Field label="Private curator notes">
          <textarea
            value={plant.notes || ''}
            onChange={(e) => update('notes', e.target.value)}
            rows={2}
            className="input"
          />
        </Field>
      </section>

      {plant.lastEnrichedAt && (
        <p className="text-xs text-stone-500">
          Last enriched by Claude: {new Date(plant.lastEnrichedAt).toLocaleString()}
        </p>
      )}

      <style jsx>{`
        :global(.input) {
          display: block;
          width: 100%;
          border: 1px solid rgb(214 211 209);
          border-radius: 0.375rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
      `}</style>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-stone-700 font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Multi<T extends string>({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: T[];
  values: T[];
  onToggle: (v: T) => void;
}) {
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-stone-700 mb-1">{label}</div>
      <div className="flex gap-2 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`px-2 py-1 text-xs rounded-md border ${
              values.includes(opt)
                ? 'bg-emerald-700 border-emerald-700 text-white'
                : 'bg-white border-stone-300 text-stone-700 hover:border-stone-400'
            }`}
          >
            {opt.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
    </div>
  );
}
