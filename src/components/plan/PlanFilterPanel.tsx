'use client';

/**
 * Filter panel for the plan view.
 *
 * Toggles which plants are *visible* on the map without regenerating the
 * layout — i.e. the underlying PlanData is unchanged, the map just hides
 * filtered-out features. Useful for previewing "what does the matrix
 * layer look like alone?" or "what blooms in October?".
 *
 * The panel collapses into a single "Filters" pill when no filters are
 * active and expands inline when the user clicks. Filter state lives in
 * the parent (so the same panel works on /plan/new and /plan/[planId])
 * and is applied to the placement array before it reaches MapboxMap.
 */

import { useState } from 'react';
import type { PlantType } from '@/types/plant';

export type Tier = 1 | 2 | 3 | 4 | 5;
export type BloomSeason = 'spring' | 'summer' | 'fall' | 'winter';

export interface PlanFilters {
  /** Plant-type categories visible. Empty array = show all. */
  types: PlantType[];
  /** Hierarchy tiers visible (5 = emergent → 1 = filler). Empty = show all. */
  tiers: Tier[];
  /** Bloom-season filter. Empty = show all. 'winter' covers seed-head /
   *  winter-structure plants in addition to literal Dec–Feb bloomers. */
  seasons: BloomSeason[];
}

export const EMPTY_FILTERS: PlanFilters = { types: [], tiers: [], seasons: [] };

const PLANT_TYPES: PlantType[] = ['forb', 'grass', 'sedge', 'tree', 'shrub', 'vine', 'fern'];
const TIERS: Tier[] = [5, 4, 3, 2, 1];
const SEASONS: BloomSeason[] = ['spring', 'summer', 'fall', 'winter'];

const TIER_LABEL: Record<Tier, string> = {
  5: 'Emergent',
  4: 'Primary',
  3: 'Companion',
  2: 'Matrix',
  1: 'Filler',
};

const SEASON_LABEL: Record<BloomSeason, string> = {
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall',
  winter: 'Winter / seedhead',
};

interface Props {
  filters: PlanFilters;
  onChange: (next: PlanFilters) => void;
  /** Total/visible plant counts for the badge — purely cosmetic. */
  totalCount?: number;
  visibleCount?: number;
}

export default function PlanFilterPanel({ filters, onChange, totalCount, visibleCount }: Props) {
  const [open, setOpen] = useState(false);

  const activeCount =
    filters.types.length + filters.tiers.length + filters.seasons.length;

  const toggle = <K extends keyof PlanFilters>(
    key: K,
    value: PlanFilters[K][number],
  ) => {
    const current = filters[key] as Array<typeof value>;
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next as PlanFilters[K] });
  };

  const clearAll = () => onChange(EMPTY_FILTERS);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
          activeCount > 0
            ? 'bg-sky-700 text-white border-sky-700'
            : 'bg-white border-stone-300 hover:border-stone-400'
        }`}
        title="Filter visible plants by type, tier, or bloom season"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="bg-white text-sky-800 rounded-full text-xs px-1.5 py-0.5 font-medium">
            {activeCount}
          </span>
        )}
        {totalCount != null && visibleCount != null && visibleCount !== totalCount && (
          <span className="text-xs opacity-80">
            {visibleCount}/{totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-20 w-80 bg-white border border-stone-200 rounded-lg shadow-lg p-4 space-y-3">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Show only…</h3>
            <button
              type="button"
              onClick={clearAll}
              disabled={activeCount === 0}
              className="text-xs text-stone-600 hover:text-stone-900 disabled:text-stone-300"
            >
              Clear all
            </button>
          </header>

          <FilterGroup label="Plant type">
            {PLANT_TYPES.map((t) => (
              <Chip
                key={t}
                active={filters.types.includes(t)}
                onClick={() => toggle('types', t)}
              >
                {t}
              </Chip>
            ))}
          </FilterGroup>

          <FilterGroup label="Hierarchy tier">
            {TIERS.map((t) => (
              <Chip
                key={t}
                active={filters.tiers.includes(t)}
                onClick={() => toggle('tiers', t)}
                title={`Tier ${t}`}
              >
                T{t} {TIER_LABEL[t]}
              </Chip>
            ))}
          </FilterGroup>

          <FilterGroup label="Bloom / interest season">
            {SEASONS.map((s) => (
              <Chip
                key={s}
                active={filters.seasons.includes(s)}
                onClick={() => toggle('seasons', s)}
              >
                {SEASON_LABEL[s]}
              </Chip>
            ))}
          </FilterGroup>

          <p className="text-xs text-stone-500 pt-1 border-t border-stone-100">
            Empty selection in a row = show all of that row. Filters apply per-row, ANDed across rows.
          </p>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-stone-700 mb-1.5">{label}</div>
      <div className="flex gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
        active
          ? 'bg-emerald-700 border-emerald-700 text-white'
          : 'bg-white border-stone-300 text-stone-700 hover:border-stone-400'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Filter a list of placements/plants according to PlanFilters. Centralized
 * so /plan/new and /plan/[planId] apply identical semantics.
 */
export function applyPlanFilters<
  P extends {
    plantType?: string;
    tier?: number;
    bloomStartMonth?: number;
    bloomEndMonth?: number;
    seedHeadInterest?: boolean;
    winterStructure?: boolean;
  },
>(plants: P[], filters: PlanFilters): P[] {
  if (!filters.types.length && !filters.tiers.length && !filters.seasons.length) {
    return plants;
  }
  return plants.filter((p) => {
    if (filters.types.length && !filters.types.includes(p.plantType as PlantType)) {
      return false;
    }
    if (filters.tiers.length && (!p.tier || !filters.tiers.includes(p.tier as Tier))) {
      return false;
    }
    if (filters.seasons.length) {
      const matches = filters.seasons.some((season) => seasonMatches(p, season));
      if (!matches) return false;
    }
    return true;
  });
}

function seasonMatches(
  p: { bloomStartMonth?: number; bloomEndMonth?: number; seedHeadInterest?: boolean; winterStructure?: boolean },
  season: BloomSeason,
): boolean {
  const start = p.bloomStartMonth;
  const end = p.bloomEndMonth;
  // Treat seedhead/winterStructure as a winter "interest" match even when the
  // plant doesn't bloom in winter.
  if (season === 'winter') {
    if (p.seedHeadInterest || p.winterStructure) return true;
  }
  if (start == null || end == null) return false;
  // Bloom range may straddle Jan (e.g. start=11, end=2). Normalize by
  // generating the set of months covered.
  const months = new Set<number>();
  if (start <= end) {
    for (let m = start; m <= end; m++) months.add(m);
  } else {
    for (let m = start; m <= 12; m++) months.add(m);
    for (let m = 1; m <= end; m++) months.add(m);
  }
  const seasonMonths: Record<BloomSeason, number[]> = {
    spring: [3, 4, 5],
    summer: [6, 7, 8],
    fall: [9, 10, 11],
    winter: [12, 1, 2],
  };
  return seasonMonths[season].some((m) => months.has(m));
}
