'use client';

import { useState } from 'react';
import {
  type SidebarProps,
  ToolsArea, PinnedArea, PlantsArea, FeaturesArea,
  ChevronIcon,
} from './shared';

/** Variant B — VSCode-style. Permanent dark icon rail (always 56px) on the
 *  left edge; clicking an icon slides out a flyout panel showing only that
 *  one section. Click the active icon again (or the close button) to hide
 *  the flyout. Cleaner than accordion when only one section matters at a
 *  time. */

const RAIL_WIDTH = 56;
const FLYOUT_WIDTH = 300;
export const RAIL_OPEN_WIDTH = RAIL_WIDTH + FLYOUT_WIDTH;
export const RAIL_CLOSED_WIDTH = RAIL_WIDTH;

type Section = 'tools' | 'pinned' | 'plants' | 'features';

const SECTIONS: { id: Section; label: string; icon: string; badge?: (p: SidebarProps) => string | undefined }[] = [
  { id: 'tools', label: 'Tools', icon: 'M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.6-1.6L8.832 8.2a16 16 0 00-4.649 4.763m11.965 3.42z' },
  { id: 'pinned', label: 'Pinned', icon: 'M5 5a2 2 0 012-2h6l1.5 1.5L17 6v3l-3 3 1 6-3-2-3 2 1-6-3-3V5z',
    badge: (p) => p.pinnedSlugs.length ? String(p.pinnedSlugs.length) : undefined },
  { id: 'plants', label: 'Plants', icon: 'M12 2c-3.5 4-8 6-8 12a8 8 0 0016 0c0-6-4.5-8-8-12z',
    badge: (p) => p.totalPlants ? `${p.visiblePlants}` : undefined },
  { id: 'features', label: 'Features', icon: 'M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75',
    badge: (p) => (p.exclusionZones.length + p.existingTrees.length) ? String(p.exclusionZones.length + p.existingTrees.length) : undefined },
];

export default function IconRail(props: SidebarProps) {
  const { open, onToggle } = props;
  // `open` controls whether the flyout panel is visible. The rail itself is
  // permanent — toggling collapses *the flyout*, not the rail.
  const [activeSection, setActiveSection] = useState<Section>('tools');

  const railWidth = RAIL_WIDTH;

  return (
    <>
      {/* Rail — always present, even when "collapsed" */}
      <aside
        className="fixed left-0 z-40 bg-slate-900 text-slate-200 flex flex-col items-center py-2 gap-1 shadow-lg"
        style={{ width: railWidth, top: 56, height: 'calc(100vh - 56px)' }}
      >
        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold pb-1">Planner</div>
        {SECTIONS.map(s => {
          const isActive = open && activeSection === s.id;
          const badge = s.badge?.(props);
          return (
            <button
              key={s.id}
              onClick={() => {
                if (open && activeSection === s.id) {
                  onToggle();
                } else {
                  setActiveSection(s.id);
                  if (!open) onToggle();
                }
              }}
              title={s.label}
              className={`relative w-10 h-10 rounded-md flex items-center justify-center transition-colors ${
                isActive ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
              {badge && (
                <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-white rounded-full text-[9px] px-1 min-w-[15px] text-center leading-[14px]">{badge}</span>
              )}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-400 rounded-r" />
              )}
            </button>
          );
        })}
        <button onClick={onToggle} title={open ? 'Close panel' : 'Open panel'}
          className="mt-auto w-10 h-10 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-slate-100">
          <ChevronIcon className="w-4 h-4" direction={open ? 'left' : 'right'} />
        </button>
      </aside>

      {/* Flyout panel — slides out next to the rail */}
      {open && (
        <aside
          className="fixed z-30 bg-stone-50 border-r border-stone-200 flex flex-col shadow-lg"
          style={{ left: railWidth, width: FLYOUT_WIDTH, top: 56, height: 'calc(100vh - 56px)' }}
        >
          <div className="px-3 py-2 border-b border-stone-200 flex items-center justify-between bg-white">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-700">
              {SECTIONS.find(s => s.id === activeSection)?.label}
            </span>
            <button onClick={onToggle} title="Close" className="p-1 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5">
            {activeSection === 'tools' && (
              <ToolsArea brush={props.brush} setBrush={props.setBrush} copiedRegion={props.copiedRegion}
                allPlants={props.allPlants} onOpenCatalog={props.onOpenCatalog} />
            )}
            {activeSection === 'pinned' && (
              <PinnedArea pinnedSlugs={props.pinnedSlugs} onUnpin={props.onUnpin}
                onOpenCatalog={props.onOpenCatalog} allPlants={props.allPlants} />
            )}
            {activeSection === 'plants' && (
              <PlantsArea {...props} layout="cards" />
            )}
            {activeSection === 'features' && (
              <FeaturesArea
                editMode={props.editMode} setEditMode={props.setEditMode}
                exclusionZones={props.exclusionZones} setExclusionZones={props.setExclusionZones}
                existingTrees={props.existingTrees} setExistingTrees={props.setExistingTrees}
                onDetectBuildings={props.onDetectBuildings}
              />
            )}
          </div>
        </aside>
      )}
    </>
  );
}
