'use client';

import { useState } from 'react';
import type { PlanPlant } from '@/types/plan';

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
  onRemoveSpecies?: (slug: string) => void;
  onSwapSpecies?: (oldSlug: string, newSlug: string) => void;
  allPlants?: any[]; // Full plant catalog for swap suggestions
  compact?: boolean;
  densityMultiplier?: number;
  onDensityChange?: (density: number) => void;
}

const TYPE_ORDER: Record<string, number> = { tree: 0, shrub: 1, vine: 2, fern: 3, forb: 4, grass: 5, sedge: 6 };
const TYPE_LABELS: Record<string, string> = {
  tree: 'Trees', shrub: 'Shrubs', vine: 'Vines', fern: 'Ferns',
  forb: 'Wildflowers', grass: 'Grasses', sedge: 'Sedges',
};

export default function PlantingLegend({
  plants, selectedSlug, onSelect, onRemoveSpecies, onSwapSpecies,
  allPlants, compact = false, densityMultiplier, onDensityChange,
}: PlantingLegendProps) {
  const [swapTarget, setSwapTarget] = useState<string | null>(null);

  // Aggregate by species
  const speciesMap = new Map<string, LegendEntry>();
  plants.forEach(p => {
    const ex = speciesMap.get(p.plantSlug);
    if (ex) { ex.quantity += p.quantity; }
    else {
      speciesMap.set(p.plantSlug, {
        speciesIndex: p.speciesIndex || 0, slug: p.plantSlug,
        commonName: p.commonName, scientificName: p.scientificName,
        bloomColor: p.bloomColor, plantType: p.plantType || 'forb',
        quantity: p.quantity, spreadInches: p.spreadInches || 0,
        heightMaxInches: p.heightMaxInches, imageUrl: p.imageUrl,
      });
    }
  });

  const entries = Array.from(speciesMap.values()).sort((a, b) => {
    const ta = TYPE_ORDER[a.plantType] ?? 4;
    const tb = TYPE_ORDER[b.plantType] ?? 4;
    return ta !== tb ? ta - tb : (a.speciesIndex || 0) - (b.speciesIndex || 0);
  });

  const groups = new Map<string, LegendEntry[]>();
  entries.forEach(e => {
    if (!groups.has(e.plantType)) groups.set(e.plantType, []);
    groups.get(e.plantType)!.push(e);
  });

  const totalPlants = entries.reduce((sum, e) => sum + e.quantity, 0);

  // Find swap candidates for a species
  function getSwapCandidates(entry: LegendEntry): any[] {
    if (!allPlants) return [];
    return allPlants.filter(p =>
      p.slug !== entry.slug &&
      p.plantType === entry.plantType &&
      Math.abs(p.heightMaxInches - entry.heightMaxInches) < 24
    ).slice(0, 8);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg">Plant Legend</h3>
        <span className="text-sm text-muted">{entries.length} species &middot; {totalPlants} plants</span>
      </div>

      {/* Density slider */}
      {onDensityChange && densityMultiplier !== undefined && (
        <div className="p-3 bg-stone-50 rounded-lg border border-stone-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Planting Density</span>
            <span className="text-sm text-primary font-semibold">
              {densityMultiplier < 0.7 ? 'Sparse' : densityMultiplier > 1.3 ? 'Dense' : 'Standard'}
              {' '}({(densityMultiplier).toFixed(1)}x)
            </span>
          </div>
          <input
            type="range" min={0.3} max={2.0} step={0.1}
            value={densityMultiplier}
            onChange={(e) => onDensityChange(parseFloat(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted mt-1">
            <span>Sparse</span>
            <span>1 plant/sqft</span>
            <span>Dense</span>
          </div>
        </div>
      )}

      {Array.from(groups.entries()).map(([type, group]) => (
        <div key={type}>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            {TYPE_LABELS[type] || type}
          </h4>
          <div className={compact ? 'space-y-1' : 'space-y-2'}>
            {group.map(entry => (
              <div key={entry.slug}>
                <div
                  onClick={() => onSelect?.(entry.slug === selectedSlug ? null : entry.slug)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all cursor-pointer ${
                    selectedSlug === entry.slug ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-stone-50'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: getPlantColor(entry.bloomColor) }}>
                    {entry.speciesIndex}
                  </div>

                  {!compact && entry.imageUrl && (
                    <img src={entry.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`font-medium ${compact ? 'text-sm' : ''}`}>{entry.commonName}</span>
                      <span className="text-xs text-muted">x{entry.quantity}</span>
                    </div>
                    {!compact && <div className="text-xs text-muted italic truncate">{entry.scientificName}</div>}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {onSwapSpecies && allPlants && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSwapTarget(swapTarget === entry.slug ? null : entry.slug); }}
                        className="p-1 text-stone-400 hover:text-primary transition-colors" title="Swap species"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                      </button>
                    )}
                    {onRemoveSpecies && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveSpecies(entry.slug); }}
                        className="p-1 text-stone-400 hover:text-red-500 transition-colors" title="Remove species"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Swap panel */}
                {swapTarget === entry.slug && onSwapSpecies && (
                  <div className="ml-11 mt-1 p-2 bg-stone-50 rounded-lg border border-stone-200">
                    <div className="text-xs font-medium text-muted mb-2">Replace with:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {getSwapCandidates(entry).map(candidate => (
                        <button
                          key={candidate.slug}
                          onClick={() => { onSwapSpecies(entry.slug, candidate.slug); setSwapTarget(null); }}
                          className="flex items-center gap-1.5 px-2 py-1 bg-white border border-stone-200 rounded text-xs hover:border-primary hover:bg-primary/5 transition-all"
                        >
                          {candidate.imageUrl && <img src={candidate.imageUrl} alt="" className="w-5 h-5 rounded object-cover" />}
                          <span>{candidate.commonName}</span>
                        </button>
                      ))}
                      {getSwapCandidates(entry).length === 0 && (
                        <span className="text-xs text-muted">No compatible alternatives found</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
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
