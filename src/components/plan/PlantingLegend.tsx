'use client';

import type { PlanPlant } from '@/types/plan';
import Link from 'next/link';

interface LegendEntry {
  speciesIndex: number;
  slug: string;
  commonName: string;
  scientificName: string;
  bloomColor: string;
  plantType: string;
  quantity: number;
  spreadInches: number;
  heightMaxInches: number;
  imageUrl?: string;
}

interface PlantingLegendProps {
  plants: PlanPlant[];
  selectedSlug?: string | null;
  onSelect?: (slug: string | null) => void;
  compact?: boolean;
}

const TYPE_ORDER: Record<string, number> = { tree: 0, shrub: 1, vine: 2, fern: 3, forb: 4, grass: 5, sedge: 6 };
const TYPE_LABELS: Record<string, string> = {
  tree: 'Trees', shrub: 'Shrubs', vine: 'Vines', fern: 'Ferns',
  forb: 'Wildflowers', grass: 'Grasses', sedge: 'Sedges',
};

export default function PlantingLegend({ plants, selectedSlug, onSelect, compact = false }: PlantingLegendProps) {
  // Aggregate plants by species
  const speciesMap = new Map<string, LegendEntry>();
  plants.forEach(p => {
    const existing = speciesMap.get(p.plantSlug);
    if (existing) {
      existing.quantity += p.quantity;
    } else {
      speciesMap.set(p.plantSlug, {
        speciesIndex: p.speciesIndex || 0,
        slug: p.plantSlug,
        commonName: p.commonName,
        scientificName: p.scientificName,
        bloomColor: p.bloomColor,
        plantType: p.plantType || 'forb',
        quantity: p.quantity,
        spreadInches: p.spreadInches || 0,
        heightMaxInches: p.heightMaxInches,
        imageUrl: p.imageUrl,
      });
    }
  });

  const entries = Array.from(speciesMap.values()).sort((a, b) => {
    const ta = TYPE_ORDER[a.plantType] ?? 4;
    const tb = TYPE_ORDER[b.plantType] ?? 4;
    if (ta !== tb) return ta - tb;
    return (a.speciesIndex || 0) - (b.speciesIndex || 0);
  });

  // Group by plant type
  const groups = new Map<string, LegendEntry[]>();
  entries.forEach(e => {
    const type = e.plantType;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(e);
  });

  const totalPlants = entries.reduce((sum, e) => sum + e.quantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Plant Legend</h3>
        <span className="text-sm text-muted">{entries.length} species &middot; {totalPlants} plants</span>
      </div>

      {Array.from(groups.entries()).map(([type, group]) => (
        <div key={type}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            {TYPE_LABELS[type] || type}
          </h4>
          <div className={compact ? 'space-y-1' : 'space-y-2'}>
            {group.map(entry => (
              <button
                key={entry.slug}
                onClick={() => onSelect?.(entry.slug === selectedSlug ? null : entry.slug)}
                className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all ${
                  selectedSlug === entry.slug
                    ? 'bg-primary/10 ring-1 ring-primary'
                    : 'hover:bg-stone-50'
                }`}
              >
                {/* Number badge */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: getPlantColor(entry.bloomColor) }}
                >
                  {entry.speciesIndex}
                </div>

                {/* Image */}
                {!compact && entry.imageUrl && (
                  <img src={entry.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`font-medium ${compact ? 'text-sm' : ''}`}>{entry.commonName}</span>
                    <span className="text-xs text-muted">x{entry.quantity}</span>
                  </div>
                  {!compact && (
                    <div className="text-xs text-muted italic truncate">{entry.scientificName}</div>
                  )}
                </div>

                {/* Spread info */}
                {!compact && entry.spreadInches > 0 && (
                  <span className="text-xs text-muted flex-shrink-0">{entry.spreadInches}&quot; spread</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#94a3b8', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#d4a574', rose: '#f43f5e',
    bronze: '#92400e', silver: '#9ca3af', rust: '#b45309', scarlet: '#b91c1c',
    tan: '#a8896c', brown: '#92400e',
  };
  return colors[bloomColor?.toLowerCase()] || '#9ca3af';
}
