'use client';

import { useEffect, useRef, useState } from 'react';
import {
  type SidebarProps,
  ToolsArea, PinnedArea, PlantsArea, FeaturesArea,
} from './shared';

/** Variant C — floating, draggable card. Sits above the map with a drop
 *  shadow and a drag handle on the title bar. The user can move it anywhere
 *  on the page; minimize collapses to just the header. Doesn't push page
 *  content, so the map gets its full width. Best when you want to see the
 *  whole map and only need the toolbar occasionally. */

export const FLOAT_OPEN_WIDTH = 0;   // doesn't push content
export const FLOAT_CLOSED_WIDTH = 0;

const PANEL_W = 320;
const HEADER_H = 36;

type Tab = 'tools' | 'pinned' | 'plants' | 'features';

export default function FloatingPanel(props: SidebarProps) {
  const { open, onToggle, brush, copiedRegion, pinnedSlugs, totalPlants, visiblePlants } = props;
  const [tab, setTab] = useState<Tab>('tools');
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 96 });
  const [minimized, setMinimized] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  // Pointer-driven drag using offsets cached at mousedown so the cursor
  // stays anchored to the same point on the title bar throughout the drag.
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragOffsetRef.current) return;
      setPos({
        x: Math.max(0, e.clientX - dragOffsetRef.current.x),
        y: Math.max(0, e.clientY - dragOffsetRef.current.y),
      });
    }
    function onUp() { dragOffsetRef.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    dragOffsetRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }

  if (!open) {
    // Tiny launcher chip in the top-left corner of the viewport.
    return (
      <button
        onClick={onToggle}
        className="fixed top-20 left-4 z-30 bg-white border border-stone-200 shadow-md rounded-full px-3 py-2 text-xs font-medium text-stone-700 hover:border-primary hover:text-primary flex items-center gap-1.5"
        title="Open planner toolbar"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.6-1.6L8.832 8.2a16 16 0 00-4.649 4.763m11.965 3.42z" />
        </svg>
        Toolbar
      </button>
    );
  }

  return (
    <aside
      className="fixed z-40 bg-white border border-stone-200 rounded-lg shadow-2xl flex flex-col select-none"
      style={{
        left: pos.x, top: pos.y,
        width: PANEL_W,
        maxHeight: minimized ? HEADER_H : '80vh',
      }}
    >
      {/* Title bar / drag handle */}
      <div
        onMouseDown={startDrag}
        className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 border-b border-stone-200 rounded-t-lg cursor-grab active:cursor-grabbing"
        style={{ height: HEADER_H }}
      >
        <DragGrip />
        <span className="text-xs font-semibold text-stone-700 flex-1">Planner toolbar</span>
        <button onClick={() => setMinimized(m => !m)}
          className="p-1 text-stone-500 hover:text-stone-800 rounded" title={minimized ? 'Expand' : 'Minimize'}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d={minimized ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
          </svg>
        </button>
        <button onClick={onToggle}
          className="p-1 text-stone-500 hover:text-red-600 rounded" title="Close">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!minimized && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-stone-200 bg-stone-50">
            <Tab id="tools" label="Tools" badge={brush.kind ? '●' : undefined} active={tab} onClick={setTab} />
            <Tab id="pinned" label="Pinned" badge={pinnedSlugs.length ? String(pinnedSlugs.length) : undefined} active={tab} onClick={setTab} />
            <Tab id="plants" label="Plants" badge={totalPlants ? `${visiblePlants}` : undefined} active={tab} onClick={setTab} />
            <Tab id="features" label="Features" active={tab} onClick={setTab} />
          </div>

          <div className="flex-1 overflow-y-auto p-2.5">
            {tab === 'tools' && (
              <ToolsArea brush={props.brush} setBrush={props.setBrush} copiedRegion={props.copiedRegion}
                allPlants={props.allPlants} onOpenCatalog={props.onOpenCatalog} />
            )}
            {tab === 'pinned' && (
              <PinnedArea pinnedSlugs={props.pinnedSlugs} onUnpin={props.onUnpin}
                onOpenCatalog={props.onOpenCatalog} allPlants={props.allPlants} />
            )}
            {tab === 'plants' && (
              <PlantsArea {...props} layout="cards" />
            )}
            {tab === 'features' && (
              <FeaturesArea
                editMode={props.editMode} setEditMode={props.setEditMode}
                exclusionZones={props.exclusionZones} setExclusionZones={props.setExclusionZones}
                existingTrees={props.existingTrees} setExistingTrees={props.setExistingTrees}
                onDetectBuildings={props.onDetectBuildings}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function Tab({ id, label, badge, active, onClick }: { id: 'tools' | 'pinned' | 'plants' | 'features'; label: string; badge?: string; active: 'tools' | 'pinned' | 'plants' | 'features'; onClick: (t: 'tools' | 'pinned' | 'plants' | 'features') => void }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex-1 px-2 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
        isActive
          ? 'border-primary text-primary bg-white'
          : 'border-transparent text-stone-600 hover:bg-white/60'
      }`}
    >
      {label}
      {badge && <span className="ml-1 text-[10px] text-stone-400">{badge}</span>}
    </button>
  );
}

function DragGrip() {
  return (
    <svg className="w-3.5 h-3.5 text-stone-400" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}
