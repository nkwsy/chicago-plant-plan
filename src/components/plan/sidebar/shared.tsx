'use client';

import { useState } from 'react';
import type { PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';
import PlanFilterPanel, { type PlanFilters } from '../PlanFilterPanel';

// ── Types ──────────────────────────────────────────────────────────────────

export type BrushPattern = 1 | 3 | 5 | 9;
export type BrushKind = 'paint' | 'erase' | 'select' | 'paste' | null;

export interface BrushState {
  kind: BrushKind;
  slugs: string[];
  pattern: BrushPattern;
}

export interface CopiedRegion {
  plants: { offsetLat: number; offsetLng: number; plant: PlanPlant }[];
  anchor: { lat: number; lng: number };
}

export interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  brush: BrushState;
  setBrush: (b: BrushState | ((prev: BrushState) => BrushState)) => void;
  copiedRegion: CopiedRegion | null;
  pinnedSlugs: string[];
  onUnpin: (slug: string) => void;
  onOpenCatalog: () => void;
  plants: PlanPlant[];
  selectedSlug: string | null;
  onSelectPlant: (slug: string | null) => void;
  allPlants: any[];
  densityMultiplier: number;
  onDensityChange: (d: number) => void;
  onRemoveSpecies: (slug: string) => void;
  onSwapSpecies: (oldSlug: string, newSlug: string) => void;
  filters: PlanFilters;
  onFiltersChange: (f: PlanFilters) => void;
  totalPlants: number;
  visiblePlants: number;
  exclusionZones: ExclusionZone[];
  setExclusionZones: (z: ExclusionZone[] | ((prev: ExclusionZone[]) => ExclusionZone[])) => void;
  existingTrees: ExistingTree[];
  setExistingTrees: (t: ExistingTree[] | ((prev: ExistingTree[]) => ExistingTree[])) => void;
  editMode: 'none' | 'exclusion' | 'tree' | 'fence';
  setEditMode: (m: 'none' | 'exclusion' | 'tree' | 'fence') => void;
  onDetectBuildings: () => void;
}

// ── Tools area ─────────────────────────────────────────────────────────────

export function ToolsArea({
  brush, setBrush, copiedRegion, allPlants, onOpenCatalog, dense = false,
}: {
  brush: BrushState;
  setBrush: (b: BrushState | ((prev: BrushState) => BrushState)) => void;
  copiedRegion: CopiedRegion | null;
  allPlants: any[];
  onOpenCatalog: () => void;
  dense?: boolean;
}) {
  const setKind = (kind: BrushKind) => setBrush(b => ({ ...b, kind: b.kind === kind ? null : kind }));
  const setPattern = (pattern: BrushPattern) => setBrush(b => ({ ...b, pattern }));
  const removeSlug = (slug: string) => setBrush(b => ({ ...b, slugs: b.slugs.filter(s => s !== slug) }));

  const gap = dense ? 'gap-1' : 'gap-1.5';
  const space = dense ? 'space-y-2' : 'space-y-2.5';

  return (
    <div className={space}>
      <div className={`grid grid-cols-2 ${gap}`}>
        <ModeBtn label="Paint" icon="brush" active={brush.kind === 'paint'} onClick={() => setKind('paint')} tone="amber" />
        <ModeBtn label="Erase" icon="trash" active={brush.kind === 'erase'} onClick={() => setKind('erase')} tone="red" />
        <ModeBtn label="Select" icon="select" active={brush.kind === 'select'} onClick={() => setKind('select')} tone="blue" />
        <ModeBtn label="Paste" icon="clipboard" active={brush.kind === 'paste'} onClick={() => setKind('paste')} tone="emerald"
          disabled={!copiedRegion}
          badge={copiedRegion ? `${copiedRegion.plants.length}` : undefined} />
      </div>

      {brush.kind && (
        <p className="text-[11px] text-stone-600 leading-snug bg-stone-100 rounded px-2 py-1.5">
          {brush.kind === 'paint' && (brush.slugs.length === 0
            ? 'Pick a species below, then click the map. Shift+drag to paint multiple.'
            : 'Click empty bed to drop your stamp; click a plant to swap it. Shift+drag for continuous.')}
          {brush.kind === 'erase' && 'Click any plant on the map to remove it.'}
          {brush.kind === 'select' && 'Drag a rectangle to capture plants.'}
          {brush.kind === 'paste' && copiedRegion && `Click to drop ${copiedRegion.plants.length} captured plants.`}
        </p>
      )}

      {brush.kind === 'paint' && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">Stamp pattern</p>
          <div className={`grid grid-cols-4 ${gap}`}>
            {([1, 3, 5, 9] as BrushPattern[]).map(n => (
              <button key={n}
                onClick={() => setPattern(n)}
                className={`p-1.5 rounded border text-[11px] transition-all ${
                  brush.pattern === n
                    ? 'border-amber-600 bg-amber-50 text-amber-900'
                    : 'border-stone-200 hover:border-stone-300 bg-white text-stone-600'
                }`}
                title={n === 1 ? 'Single' : n === 3 ? 'Triangle' : n === 5 ? 'Quincunx' : '3×3 grid'}
              >
                <StampIcon n={n} active={brush.pattern === n} />
                <div>{n}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {brush.kind === 'paint' && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
              Brush species{brush.slugs.length > 1 && <span className="text-amber-700 normal-case ml-1">(mix)</span>}
            </p>
            <button onClick={onOpenCatalog} className="text-[10px] text-primary hover:underline">+ Add</button>
          </div>
          {brush.slugs.length === 0 ? (
            <button onClick={onOpenCatalog}
              className="w-full p-2 bg-white border-2 border-dashed border-stone-300 rounded text-xs text-stone-500 hover:border-primary hover:text-primary">
              Pick a species…
            </button>
          ) : (
            <div className="space-y-1">
              {brush.slugs.map(slug => {
                const p = allPlants.find(x => x.slug === slug);
                return (
                  <div key={slug} className="flex items-center gap-1.5 bg-white border border-stone-200 rounded p-1">
                    {p?.imageUrl && <img src={p.imageUrl} alt="" className="w-6 h-6 rounded object-cover" />}
                    <span className="flex-1 text-[11px] truncate">{p?.commonName ?? slug}</span>
                    <button onClick={() => removeSlug(slug)} className="text-stone-400 hover:text-red-500 p-0.5">
                      <XIcon className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button onClick={onOpenCatalog}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium rounded-md border border-stone-300 hover:border-primary hover:bg-primary/5 bg-white">
        <SearchIcon className="w-4 h-4" />
        Browse catalog
      </button>
    </div>
  );
}

// ── Pinned area ────────────────────────────────────────────────────────────

export function PinnedArea({ pinnedSlugs, onUnpin, onOpenCatalog, allPlants }: {
  pinnedSlugs: string[];
  onUnpin: (slug: string) => void;
  onOpenCatalog: () => void;
  allPlants: any[];
}) {
  if (pinnedSlugs.length === 0) {
    return (
      <button onClick={onOpenCatalog}
        className="w-full p-2 bg-white border-2 border-dashed border-stone-300 rounded text-xs text-stone-500 hover:border-emerald-500 hover:text-emerald-700 text-left">
        Browse the catalog and pin plants you want guaranteed in the next regenerate.
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {pinnedSlugs.map(slug => {
        const p = allPlants.find(x => x.slug === slug);
        return (
          <span key={slug}
            className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded px-1.5 py-0.5 text-[11px]">
            📌 {p?.commonName ?? slug}
            <button onClick={() => onUnpin(slug)} className="text-emerald-600 hover:text-red-500" title="Unpin">×</button>
          </span>
        );
      })}
    </div>
  );
}

// ── Plants area (card list) ────────────────────────────────────────────────

interface SpeciesEntry {
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

function aggregateSpecies(plants: PlanPlant[]): SpeciesEntry[] {
  const map = new Map<string, SpeciesEntry>();
  for (const p of plants) {
    const ex = map.get(p.plantSlug);
    if (ex) ex.quantity += p.quantity;
    else map.set(p.plantSlug, {
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
  return Array.from(map.values()).sort((a, b) => (a.speciesIndex || 0) - (b.speciesIndex || 0));
}

export function PlantsArea(props: {
  plants: PlanPlant[];
  selectedSlug: string | null;
  onSelectPlant: (slug: string | null) => void;
  allPlants: any[];
  onRemoveSpecies: (slug: string) => void;
  onSwapSpecies: (oldSlug: string, newSlug: string) => void;
  densityMultiplier: number;
  onDensityChange: (d: number) => void;
  filters: PlanFilters;
  onFiltersChange: (f: PlanFilters) => void;
  totalPlants: number;
  visiblePlants: number;
  layout?: 'cards' | 'compact';
}) {
  const {
    plants, selectedSlug, onSelectPlant, allPlants,
    onRemoveSpecies, onSwapSpecies,
    densityMultiplier, onDensityChange,
    filters, onFiltersChange, totalPlants, visiblePlants,
    layout = 'cards',
  } = props;

  const species = aggregateSpecies(plants);

  return (
    <div className="space-y-2.5">
      <div className="bg-white border border-stone-200 rounded p-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-medium text-stone-700">Density</span>
          <span className="text-[11px] text-primary font-semibold">
            {densityMultiplier < 0.7 ? 'Sparse' : densityMultiplier > 1.3 ? 'Dense' : 'Standard'} · {densityMultiplier.toFixed(1)}x
          </span>
        </div>
        <input type="range" min={0.3} max={2.0} step={0.1}
          value={densityMultiplier}
          onChange={(e) => onDensityChange(parseFloat(e.target.value))}
          className="w-full accent-primary" />
      </div>

      <PlanFilterPanel
        filters={filters}
        onChange={onFiltersChange}
        totalCount={totalPlants}
        visibleCount={visiblePlants}
      />

      <div className="space-y-1.5">
        {species.map(s => {
          const cat = allPlants.find((p: any) => p.slug === s.slug);
          return (
            <PlantCard key={s.slug}
              entry={s} cat={cat} layout={layout}
              selected={selectedSlug === s.slug}
              onSelect={() => onSelectPlant(s.slug === selectedSlug ? null : s.slug)}
              onRemove={() => onRemoveSpecies(s.slug)}
              onSwap={(newSlug) => onSwapSpecies(s.slug, newSlug)}
              allPlants={allPlants}
            />
          );
        })}
        {species.length === 0 && (
          <p className="text-[11px] text-stone-500 italic">No plants yet — generate or paint some.</p>
        )}
      </div>
    </div>
  );
}

function PlantCard({
  entry, cat, selected, onSelect, onRemove, onSwap, allPlants, layout = 'cards',
}: {
  entry: SpeciesEntry;
  cat: any;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onSwap: (newSlug: string) => void;
  allPlants: any[];
  layout?: 'cards' | 'compact';
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const bloomMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const bloomLabel = cat?.bloomStartMonth && cat?.bloomEndMonth
    ? `${bloomMonths[cat.bloomStartMonth - 1]}–${bloomMonths[cat.bloomEndMonth - 1]}`
    : null;
  const heightLabel = entry.heightMaxInches
    ? entry.heightMaxInches >= 36
      ? `${Math.round(entry.heightMaxInches / 12)}ft`
      : `${entry.heightMaxInches}″`
    : null;

  return (
    <div className={`bg-white rounded-md border overflow-hidden transition-all ${
      selected ? 'border-primary ring-1 ring-primary/40' : 'border-stone-200 hover:border-stone-300'
    }`}>
      <button onClick={onSelect} className="w-full text-left flex gap-2 p-2">
        {entry.imageUrl ? (
          <img src={entry.imageUrl} alt="" className={`${layout === 'compact' ? 'w-9 h-9' : 'w-12 h-12'} rounded object-cover bg-stone-100 flex-shrink-0`} />
        ) : (
          <div className={`${layout === 'compact' ? 'w-9 h-9 text-xs' : 'w-12 h-12 text-sm'} rounded flex-shrink-0 flex items-center justify-center text-white font-bold`}
            style={{ backgroundColor: getPlantColor(entry.bloomColor) }}>
            {entry.speciesIndex}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-medium text-[13px] truncate flex-1">{entry.commonName}</span>
            <span className="text-[10px] text-stone-400 font-mono">#{entry.speciesIndex}</span>
            <span className="text-[11px] font-semibold text-stone-700">×{entry.quantity}</span>
          </div>
          <div className="text-[10px] italic text-muted truncate">{entry.scientificName}</div>
          {layout === 'cards' && (
            <div className="flex flex-wrap gap-1 mt-1">
              {bloomLabel && (
                <span className="inline-flex items-center gap-1 bg-stone-100 rounded px-1 py-0.5 text-[10px] text-stone-600">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: getPlantColor(entry.bloomColor) }} />
                  {bloomLabel}
                </span>
              )}
              {heightLabel && (
                <span className="bg-stone-100 rounded px-1 py-0.5 text-[10px] text-stone-600">↕ {heightLabel}</span>
              )}
              <span className="bg-stone-100 rounded px-1 py-0.5 text-[10px] text-stone-600 capitalize">{entry.plantType}</span>
            </div>
          )}
        </div>
      </button>

      <div className="flex border-t border-stone-100 text-[11px]">
        <button
          onClick={() => setSwapOpen(o => !o)}
          className={`flex-1 py-1.5 text-stone-600 hover:bg-stone-50 hover:text-primary border-r border-stone-100 ${swapOpen ? 'bg-stone-50 text-primary' : ''}`}
          title="Replace this species across the plan"
        >
          ↔ Replace
        </button>
        <button
          onClick={onRemove}
          className="flex-1 py-1.5 text-stone-600 hover:bg-red-50 hover:text-red-600"
          title="Remove all placements of this species"
        >
          × Remove
        </button>
      </div>

      {swapOpen && (
        <div className="border-t border-stone-100 p-2 bg-stone-50">
          <div className="text-[10px] font-medium text-muted mb-1.5">Replace with…</div>
          <div className="flex flex-wrap gap-1">
            {getSwapCandidates(entry, allPlants).map((c: any) => (
              <button key={c.slug}
                onClick={() => { onSwap(c.slug); setSwapOpen(false); }}
                className="flex items-center gap-1 px-1.5 py-1 bg-white border border-stone-200 rounded text-[10px] hover:border-primary hover:bg-primary/5"
              >
                {c.imageUrl && <img src={c.imageUrl} alt="" className="w-4 h-4 rounded object-cover" />}
                {c.commonName}
              </button>
            ))}
            {getSwapCandidates(entry, allPlants).length === 0 && (
              <span className="text-[10px] text-stone-500">No close matches.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getSwapCandidates(entry: SpeciesEntry, allPlants: any[]): any[] {
  return allPlants
    .filter(p =>
      p.slug !== entry.slug &&
      p.plantType === entry.plantType &&
      Math.abs(p.heightMaxInches - entry.heightMaxInches) < 24
    )
    .slice(0, 8);
}

// ── Features area ──────────────────────────────────────────────────────────

export function FeaturesArea(props: {
  editMode: 'none' | 'exclusion' | 'tree' | 'fence';
  setEditMode: (m: 'none' | 'exclusion' | 'tree' | 'fence') => void;
  exclusionZones: ExclusionZone[];
  setExclusionZones: (z: ExclusionZone[] | ((prev: ExclusionZone[]) => ExclusionZone[])) => void;
  existingTrees: ExistingTree[];
  setExistingTrees: (t: ExistingTree[] | ((prev: ExistingTree[]) => ExistingTree[])) => void;
  onDetectBuildings: () => void;
}) {
  const { editMode, setEditMode, exclusionZones, setExclusionZones, existingTrees, setExistingTrees, onDetectBuildings } = props;
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        <FeatureBtn active={editMode === 'exclusion'}
          onClick={() => setEditMode(editMode === 'exclusion' ? 'none' : 'exclusion')}
          color="bg-stone-700 border-stone-700"
          label={editMode === 'exclusion' ? 'Drawing…' : 'Exclude area'}
          hint="Polygon" />
        <FeatureBtn active={editMode === 'tree'}
          onClick={() => setEditMode(editMode === 'tree' ? 'none' : 'tree')}
          color="bg-green-700 border-green-700"
          label={editMode === 'tree' ? 'Click map…' : 'Add tree'}
          hint="Click to place" />
        <FeatureBtn active={editMode === 'fence'}
          onClick={() => setEditMode(editMode === 'fence' ? 'none' : 'fence')}
          color="bg-amber-800 border-amber-800"
          label={editMode === 'fence' ? 'Drawing fence…' : 'Add fence'}
          hint="Line · 6ft" />
        <FeatureBtn active={false}
          onClick={onDetectBuildings}
          color="bg-stone-600 border-stone-600"
          label="Detect buildings"
          hint="Auto from map" />
      </div>

      {exclusionZones.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">Excluded areas & fences</p>
          <div className="flex flex-col gap-1">
            {exclusionZones.map(z => (
              <div key={z.id} className="flex items-center gap-1.5 bg-white border border-stone-200 rounded px-2 py-1 text-[11px]">
                <span className={`w-2.5 h-2.5 rounded-sm ${z.type === 'fence' ? 'bg-amber-800' : 'bg-stone-400'}`} />
                <select
                  value={z.type}
                  onChange={(e) => setExclusionZones(prev =>
                    prev.map(ez => ez.id === z.id ? { ...ez, type: e.target.value as ExclusionZone['type'] } : ez)
                  )}
                  className="bg-transparent border-none outline-none text-[11px] flex-1 cursor-pointer"
                >
                  <option value="fence">Fence (6ft)</option>
                  <option value="sidewalk">Sidewalk</option>
                  <option value="walkway">Walkway</option>
                  <option value="patio">Patio</option>
                  <option value="driveway">Driveway</option>
                  <option value="shed">Shed</option>
                  <option value="building">Building</option>
                  <option value="other">Other</option>
                </select>
                <button onClick={() => setExclusionZones(prev => prev.filter(ez => ez.id !== z.id))}
                  className="text-stone-400 hover:text-red-500">×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {existingTrees.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-1">Nearby trees</p>
          <div className="flex flex-col gap-1.5">
            {existingTrees.map(t => (
              <div key={t.id} className="bg-white border border-stone-200 rounded px-2 py-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 mb-1">
                  <span>🌳</span>
                  <input type="text" value={t.label}
                    onChange={(e) => setExistingTrees(prev =>
                      prev.map(et => et.id === t.id ? { ...et, label: e.target.value } : et)
                    )}
                    className="bg-transparent border-none outline-none text-[11px] flex-1"
                  />
                  <button onClick={() => setExistingTrees(prev => prev.filter(et => et.id !== t.id))}
                    className="text-stone-400 hover:text-red-500">×</button>
                </div>
                <div className="flex gap-2 text-[10px] text-muted">
                  <label>Canopy
                    <select value={t.canopyDiameterFt}
                      onChange={(e) => setExistingTrees(prev =>
                        prev.map(et => et.id === t.id ? { ...et, canopyDiameterFt: Number(e.target.value) } : et)
                      )}
                      className="ml-1 bg-stone-50 border border-stone-200 rounded px-1 py-0.5">
                      {[10, 15, 20, 30, 40, 50].map(n => <option key={n} value={n}>{n}ft</option>)}
                    </select>
                  </label>
                  <label>Height
                    <select value={t.heightFt || 30}
                      onChange={(e) => setExistingTrees(prev =>
                        prev.map(et => et.id === t.id ? { ...et, heightFt: Number(e.target.value) } : et)
                      )}
                      className="ml-1 bg-stone-50 border border-stone-200 rounded px-1 py-0.5">
                      {[15, 20, 30, 40, 50, 60, 80].map(n => <option key={n} value={n}>{n}ft</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small atoms ────────────────────────────────────────────────────────────

export function ModeBtn({
  label, icon, active, onClick, tone, disabled, badge,
}: {
  label: string;
  icon: 'brush' | 'trash' | 'select' | 'clipboard';
  active: boolean;
  onClick: () => void;
  tone: 'amber' | 'red' | 'blue' | 'emerald';
  disabled?: boolean;
  badge?: string;
}) {
  const toneClasses = {
    amber: 'bg-amber-600 border-amber-600 text-white',
    red: 'bg-red-600 border-red-600 text-white',
    blue: 'bg-blue-600 border-blue-600 text-white',
    emerald: 'bg-emerald-600 border-emerald-600 text-white',
  }[tone];
  const paths: Record<typeof icon, string> = {
    brush: 'M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.6-1.6L8.832 8.2a16 16 0 00-4.649 4.763m11.965 3.42z',
    trash: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M5.84 7H18.16',
    select: 'M3 3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6m0-6V3',
    clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium rounded-md border transition-all relative ${
        active ? toneClasses : 'border-stone-200 hover:border-stone-300 bg-white text-stone-700'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d={paths[icon]} />
      </svg>
      {label}
      {badge && (
        <span className="absolute -top-1 -right-1 bg-emerald-700 text-white rounded-full text-[9px] px-1 min-w-[16px] text-center leading-4">{badge}</span>
      )}
    </button>
  );
}

export function FeatureBtn({ active, onClick, color, label, hint }: { active: boolean; onClick: () => void; color: string; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start gap-0.5 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-all ${
        active ? `${color} text-white` : 'border-stone-200 hover:border-stone-300 bg-white text-stone-700'
      }`}
    >
      <span>{label}</span>
      <span className={`text-[9px] font-normal ${active ? 'text-white/80' : 'text-stone-500'}`}>{hint}</span>
    </button>
  );
}

export function StampIcon({ n, active }: { n: BrushPattern; active: boolean }) {
  const dotProps = { r: 1.5, fill: active ? '#92400e' : '#78716c' };
  return (
    <svg viewBox="0 0 14 14" className="w-4 h-4 mx-auto">
      {n === 1 && <circle cx={7} cy={7} {...dotProps} />}
      {n === 3 && (
        <>
          <circle cx={7} cy={3} {...dotProps} />
          <circle cx={3} cy={11} {...dotProps} />
          <circle cx={11} cy={11} {...dotProps} />
        </>
      )}
      {n === 5 && (
        <>
          <circle cx={3} cy={3} {...dotProps} />
          <circle cx={11} cy={3} {...dotProps} />
          <circle cx={7} cy={7} {...dotProps} />
          <circle cx={3} cy={11} {...dotProps} />
          <circle cx={11} cy={11} {...dotProps} />
        </>
      )}
      {n === 9 && (
        <>
          {[3, 7, 11].map(y => [3, 7, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} {...dotProps} />))}
        </>
      )}
    </svg>
  );
}

export function getPlantColor(bloomColor: string): string {
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

// ── Tiny SVG icons ─────────────────────────────────────────────────────────

export function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

export function ChevronIcon({ className, direction = 'right' }: { className?: string; direction?: 'left' | 'right' }) {
  const d = direction === 'right' ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7';
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
