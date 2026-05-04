'use client';

import { useMemo, useState } from 'react';
import type { Plant, SunRequirement, MoistureRequirement, PlantType } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import { sunHoursToCategory } from '@/lib/analysis/sun';

interface PlantCatalogPickerProps {
  open: boolean;
  onClose: () => void;
  allPlants: Plant[];
  siteProfile?: SiteProfile | null;
  pinnedSlugs: string[];
  paintingSlug: string | null;
  onPin: (slug: string) => void;
  onUnpin: (slug: string) => void;
  onPaint: (slug: string) => void;
}

const TYPE_LABELS: Record<PlantType, string> = {
  forb: 'Wildflower', grass: 'Grass', sedge: 'Sedge',
  shrub: 'Shrub', tree: 'Tree', vine: 'Vine', fern: 'Fern',
};

export default function PlantCatalogPicker({
  open, onClose, allPlants, siteProfile,
  pinnedSlugs, paintingSlug,
  onPin, onUnpin, onPaint,
}: PlantCatalogPickerProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<PlantType | 'all'>('all');
  const [showCompatibleOnly, setShowCompatibleOnly] = useState(true);

  const siteSun: SunRequirement | null = siteProfile
    ? sunHoursToCategory(siteProfile.effectiveSunHours.average)
    : null;
  const siteMoisture: MoistureRequirement | null = siteProfile?.moistureCategory ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allPlants.filter(p => {
      if (typeFilter !== 'all' && p.plantType !== typeFilter) return false;
      if (q && !(
        p.commonName.toLowerCase().includes(q) ||
        p.scientificName.toLowerCase().includes(q) ||
        p.family?.toLowerCase().includes(q)
      )) return false;
      if (showCompatibleOnly && siteProfile) {
        const sunOk = !siteSun || p.sun?.includes(siteSun);
        const moistureOk = !siteMoisture || p.moisture?.includes(siteMoisture);
        if (!sunOk || !moistureOk) return false;
      }
      return true;
    }).sort((a, b) => a.commonName.localeCompare(b.commonName));
  }, [allPlants, query, typeFilter, showCompatibleOnly, siteSun, siteMoisture, siteProfile]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-200">
          <div>
            <h3 className="font-semibold text-lg">Plant catalog</h3>
            <p className="text-xs text-muted">
              Pin a plant to guarantee it in the next regenerate, or pick one to paint onto the map.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-stone-200 space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by common name, scientific name, or family…"
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as PlantType | 'all')}
              className="px-2 py-1.5 border border-stone-300 rounded-md text-sm bg-white"
            >
              <option value="all">All types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}s</option>
              ))}
            </select>
            {siteProfile && (
              <label className="flex items-center gap-1.5 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={showCompatibleOnly}
                  onChange={(e) => setShowCompatibleOnly(e.target.checked)}
                  className="accent-primary"
                />
                Site-compatible only
                {siteSun && (
                  <span className="text-xs text-muted">(sun: {siteSun.replace('_', ' ')}, moisture: {siteMoisture})</span>
                )}
              </label>
            )}
            <span className="ml-auto text-xs text-muted">{filtered.length} plants</span>
          </div>
        </div>

        {/* Banner: active paint brush */}
        {paintingSlug && (
          <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.6-1.6L8.832 8.2a16 16 0 00-4.649 4.763m11.965 3.42z" />
            </svg>
            Painting with: <strong>{allPlants.find(p => p.slug === paintingSlug)?.commonName ?? paintingSlug}</strong>
            <button
              onClick={() => onPaint('')}
              className="ml-2 text-amber-700 hover:text-amber-900 underline"
            >Stop</button>
          </div>
        )}

        {/* Plant list */}
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 && (
            <div className="text-center text-sm text-muted p-8">
              No plants match. Try removing filters or searching by genus.
            </div>
          )}
          <div className="divide-y divide-stone-100">
            {filtered.map(p => {
              const pinned = pinnedSlugs.includes(p.slug);
              const painting = paintingSlug === p.slug;
              const sunOk = !siteSun || p.sun?.includes(siteSun);
              const moistureOk = !siteMoisture || p.moisture?.includes(siteMoisture);
              return (
                <div key={p.slug} className="flex items-center gap-3 p-2 hover:bg-stone-50 rounded">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0 bg-stone-100" loading="lazy" />
                  ) : (
                    <div className="w-12 h-12 rounded bg-stone-100 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-sm">{p.commonName}</span>
                      <span className="text-xs italic text-muted truncate">{p.scientificName}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-0.5 text-[11px]">
                      <span className="bg-stone-100 rounded px-1.5 py-0.5 capitalize">{TYPE_LABELS[p.plantType] || p.plantType}</span>
                      {p.heightMaxInches > 0 && (
                        <span className="bg-stone-100 rounded px-1.5 py-0.5">↕ {p.heightMaxInches}″</span>
                      )}
                      {!sunOk && (
                        <span className="bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">sun mismatch</span>
                      )}
                      {!moistureOk && (
                        <span className="bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">moisture mismatch</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => pinned ? onUnpin(p.slug) : onPin(p.slug)}
                      className={`text-xs px-2.5 py-1.5 rounded-md border transition-all ${
                        pinned
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-stone-300 text-stone-700 hover:border-emerald-500 hover:text-emerald-700'
                      }`}
                      title={pinned ? 'Click to unpin' : 'Force this species into the next regenerate'}
                    >
                      {pinned ? '✓ Pinned' : 'Pin'}
                    </button>
                    <button
                      onClick={() => { onPaint(p.slug); onClose(); }}
                      className={`text-xs px-2.5 py-1.5 rounded-md border transition-all ${
                        painting
                          ? 'bg-amber-600 border-amber-600 text-white'
                          : 'border-stone-300 text-stone-700 hover:border-amber-500 hover:text-amber-700'
                      }`}
                      title="Use this plant as the paintbrush — click on the map to paint cells"
                    >
                      Paint
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-stone-200 flex items-center justify-between text-xs text-muted">
          <span>
            {pinnedSlugs.length > 0 && (
              <>
                <strong className="text-emerald-700">{pinnedSlugs.length} pinned</strong> · will appear in the next regenerate
              </>
            )}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-primary text-white rounded-md hover:bg-primary-dark text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
