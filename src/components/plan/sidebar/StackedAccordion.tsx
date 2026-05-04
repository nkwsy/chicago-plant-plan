'use client';

import { useState } from 'react';
import {
  type SidebarProps,
  ToolsArea, PinnedArea, PlantsArea, FeaturesArea,
  ChevronIcon,
} from './shared';

/** Variant A — fixed-left toolbar with always-visible accordion sections.
 *  Heavy chrome, very discoverable: every section's header is a click away. */

export const STACKED_OPEN_WIDTH = 320;
export const STACKED_CLOSED_WIDTH = 48;

export default function StackedAccordion(props: SidebarProps) {
  const {
    open, onToggle, brush, setBrush, copiedRegion,
    pinnedSlugs, onUnpin, onOpenCatalog,
    plants, selectedSlug, onSelectPlant, allPlants,
    densityMultiplier, onDensityChange,
    onRemoveSpecies, onSwapSpecies,
    filters, onFiltersChange, totalPlants, visiblePlants,
    exclusionZones, setExclusionZones, existingTrees, setExistingTrees,
    editMode, setEditMode, onDetectBuildings,
  } = props;

  if (!open) {
    return (
      <aside
        className="fixed left-0 z-30 bg-stone-50 border-r border-stone-200 flex flex-col items-center py-3 gap-2 shadow-md"
        style={{ width: STACKED_CLOSED_WIDTH, top: 56, height: 'calc(100vh - 56px)' }}
      >
        <button onClick={onToggle} title="Show toolbar"
          className="p-2 text-stone-600 hover:text-primary hover:bg-white rounded-md">
          <ChevronIcon className="w-5 h-5" direction="right" />
        </button>
        <div className="w-6 border-t border-stone-300 my-1" />
        <div className="text-[10px] text-stone-400 mt-2">A</div>
      </aside>
    );
  }

  return (
    <aside
      className="fixed left-0 z-30 bg-stone-50 border-r border-stone-200 flex flex-col shadow-md"
      style={{ width: STACKED_OPEN_WIDTH, top: 56, height: 'calc(100vh - 56px)' }}
    >
      <div className="px-3 py-2 border-b border-stone-200 flex items-center justify-between bg-white">
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">Planner toolbar</span>
        <button onClick={onToggle} title="Hide toolbar"
          className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded">
          <ChevronIcon className="w-4 h-4" direction="left" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Edit tools" defaultOpen>
          <ToolsArea brush={brush} setBrush={setBrush} copiedRegion={copiedRegion}
            allPlants={allPlants} onOpenCatalog={onOpenCatalog} />
        </Section>
        <Section title={`Pinned for regenerate${pinnedSlugs.length ? ` · ${pinnedSlugs.length}` : ''}`} defaultOpen={pinnedSlugs.length > 0}>
          <PinnedArea pinnedSlugs={pinnedSlugs} onUnpin={onUnpin} onOpenCatalog={onOpenCatalog} allPlants={allPlants} />
        </Section>
        <Section title={`Plants · ${visiblePlants}/${totalPlants}`} defaultOpen>
          <PlantsArea
            plants={plants} selectedSlug={selectedSlug} onSelectPlant={onSelectPlant}
            allPlants={allPlants}
            onRemoveSpecies={onRemoveSpecies} onSwapSpecies={onSwapSpecies}
            densityMultiplier={densityMultiplier} onDensityChange={onDensityChange}
            filters={filters} onFiltersChange={onFiltersChange}
            totalPlants={totalPlants} visiblePlants={visiblePlants}
          />
        </Section>
        <Section title={`Features${exclusionZones.length + existingTrees.length > 0 ? ` · ${exclusionZones.length + existingTrees.length}` : ''}`} defaultOpen={false}>
          <FeaturesArea
            editMode={editMode} setEditMode={setEditMode}
            exclusionZones={exclusionZones} setExclusionZones={setExclusionZones}
            existingTrees={existingTrees} setExistingTrees={setExistingTrees}
            onDetectBuildings={onDetectBuildings}
          />
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="border-b border-stone-200">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-stone-700 hover:bg-stone-100 bg-stone-100/60"
      >
        <span>{title}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && <div className="p-2.5">{children}</div>}
    </div>
  );
}
