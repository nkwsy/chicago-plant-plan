'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlanPlant } from '@/types/plan';
import type { Plant } from '@/types/plant';
import type { BrushState, CopiedRegion } from '../sidebar/shared';

/** Photoshop-style editor chrome. The map is passed in as `mapSlot` so the
 *  editor stays display-only — it reads state and emits actions, but never
 *  touches plan data directly. The plan/new page owns the data and wires
 *  the slots together. */

// ── Types ──────────────────────────────────────────────────────────────────

export type EditorTool =
  | 'move' | 'marquee' | 'lasso' | 'drag'
  | 'brush' | 'stamp'
  | 'erase' | 'eyedropper';

export type LayerId = 'matrix' | 'structure' | 'scatter' | 'filler';
export type LayerState = { visible: boolean; locked: boolean };

const LAYER_LABELS: Record<LayerId, { label: string; description: string; tone: string; bgTone: string }> = {
  matrix:    { label: 'Matrix',    description: 'Groundcover · the green backdrop', tone: 'text-emerald-900', bgTone: 'bg-emerald-100 border-emerald-200' },
  structure: { label: 'Structure', description: 'Silhouette accents (Joe Pye, milkweed)', tone: 'text-violet-900', bgTone: 'bg-violet-100 border-violet-200' },
  scatter:   { label: 'Scatter',   description: 'Drift forbs in groups',             tone: 'text-rose-900',    bgTone: 'bg-rose-100 border-rose-200' },
  filler:    { label: 'Filler',    description: 'Seasonal gap-fillers',              tone: 'text-amber-900',   bgTone: 'bg-amber-100 border-amber-200' },
};

const TOOL_DEFS: { id: EditorTool; key: string; label: string; help: string; iconPath: string }[] = [
  { id: 'move',       key: 'V', label: 'Move / Select',    help: 'Click a plant to select. Shift-click to add, Alt-click to remove. Drag empty space to marquee.',                              iconPath: 'M5 3l14 9-7 1-3 7z' },
  { id: 'marquee',    key: 'M', label: 'Marquee',          help: 'Drag a rectangle to select every plant inside. Shift-drag adds to selection.',                                                  iconPath: 'M3 3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6m0-6V3' },
  { id: 'lasso',      key: 'L', label: 'Lasso',            help: 'Drag a freeform shape — every plant inside is selected. (Falls back to marquee on Mapbox for now.)',                            iconPath: 'M5 9c0-3 4-5 8-5s7 2 7 5-3 5-7 5h-2c-2 0-3 1-3 3 0 2 1 3 3 3h6' },
  { id: 'drag',       key: 'D', label: 'Drag-edit',        help: 'Once you have a selection, click and drag any selected plant to move the whole group. Arrow keys nudge by 6 inches.',           iconPath: 'M9 5l-5 7 5 7M15 5l5 7-5 7M9 12h6' },
  { id: 'brush',      key: 'B', label: 'Brush',            help: 'Click empty bed to drop one plant of the active species. Click a plant to swap it. Shift+drag paints continuously.',           iconPath: 'M9.5 16a3 3 0 00-5.8 1.1 2.3 2.3 0 01-2.4 2.2 4.5 4.5 0 008.4-2.2c0-.4-.1-.8-.2-1.1zm0 0a16 16 0 003.4-1.6m-5-.1a16 16 0 011.6-3.4m3.4 3.4a16 16 0 004.8-4.6l3.9-5.8a1.2 1.2 0 00-1.6-1.6L8.8 8.2a16 16 0 00-4.6 4.8' },
  { id: 'stamp',      key: 'S', label: 'Stamp',            help: 'Click to drop a 1/3/5/9-plant cluster (change in the options bar). Best for naturalistic drifts.',                              iconPath: 'M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h6v6h-6z' },
  { id: 'erase',      key: 'E', label: 'Erase',            help: 'Click any plant to remove just that placement. Locked layers are protected. Use ⌫ on a selection to delete in bulk.',           iconPath: 'M14.7 9l-.4 9m-4.7 0L9.3 9m9.9-3.2c.3 0 .7.1 1 .2M5.8 7H18.2' },
  { id: 'eyedropper', key: 'I', label: 'Eyedropper',       help: 'Click a plant to copy its species into the active brush. Auto-switches to the Brush tool right after.',                         iconPath: 'M16 5l3 3-9 9-3 1 1-3z' },
];

// ── Component props ────────────────────────────────────────────────────────

export interface ProEditorProps {
  // Tools / brush
  tool: EditorTool;
  setTool: (t: EditorTool) => void;
  brush: BrushState;
  setBrush: (b: BrushState | ((prev: BrushState) => BrushState)) => void;
  copiedRegion: CopiedRegion | null;
  // Plants
  plants: PlanPlant[];
  /** Visible/filtered subset (after layer filter) — used for the status bar count. */
  visiblePlants: number;
  species: Plant[];
  activeSpeciesIdx: number | null;
  onSetActiveSpeciesIdx: (slug: string) => void;
  pinnedSlugs: string[];
  onUnpin: (slug: string) => void;
  onOpenCatalog: () => void;
  // Layers
  layers: Record<LayerId, LayerState>;
  toggleLayerVisible: (l: LayerId) => void;
  toggleLayerLocked: (l: LayerId) => void;
  // Selection
  selectedIds: Set<string>;
  selectionCount: number;
  selectionSpecies: { slug: string; commonName: string; count: number }[];
  onSelectAll: () => void;
  onDeselect: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSwapSelectionTo: (slug: string) => void;
  // Plan-level controls
  planTitle: string;
  setPlanTitle: (t: string) => void;
  speciesCount: number;
  setSpeciesCount: (n: number) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  // Map slot
  mapSlot: ReactNode;
  // View toggles passed through for the top toolbar
  viewControls: ReactNode;
}

// ── Top-level component ────────────────────────────────────────────────────

export default function ProEditor(props: ProEditorProps) {
  const {
    tool, setTool, brush, setBrush, copiedRegion,
    plants, visiblePlants, species, activeSpeciesIdx, onSetActiveSpeciesIdx,
    pinnedSlugs, onUnpin, onOpenCatalog,
    layers, toggleLayerVisible, toggleLayerLocked,
    selectedIds, selectionCount, selectionSpecies,
    onSelectAll, onDeselect, onCopy, onPaste, onDelete, onSwapSelectionTo,
    planTitle, setPlanTitle, speciesCount, setSpeciesCount,
    onRegenerate, regenerating,
    mapSlot, viewControls,
  } = props;

  const activeSpecies = species.find(s => s.slug === (brush.slugs[0] ?? ''));

  // ── Keyboard shortcuts (V/M/L/D/B/S/E/I, ⌘A, ⌘C/V, ⌫, esc) ────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.key.toLowerCase() === 'a') { e.preventDefault(); onSelectAll(); return; }
      if (cmd && e.key.toLowerCase() === 'c') { e.preventDefault(); onCopy(); return; }
      if (cmd && e.key.toLowerCase() === 'v') { e.preventDefault(); onPaste(); return; }
      if (cmd && e.key.toLowerCase() === 'd') { e.preventDefault(); onDeselect(); return; }
      if (cmd) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectionCount > 0) { e.preventDefault(); onDelete(); return; }
      }
      if (e.key === 'Escape') { onDeselect(); return; }
      const map: Record<string, EditorTool> = { v: 'move', m: 'marquee', l: 'lasso', d: 'drag', b: 'brush', s: 'stamp', e: 'erase', i: 'eyedropper' };
      const next = map[e.key.toLowerCase()];
      if (next) { e.preventDefault(); setTool(next); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool, onSelectAll, onCopy, onPaste, onDeselect, onDelete, selectionCount]);

  // ── Onboarding card (dismissable, persisted in localStorage) ──────────
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem('proEditorWelcomeDismissed') === '1') setWelcomeOpen(false);
  }, []);
  function dismissWelcome() {
    setWelcomeOpen(false);
    try { window.localStorage.setItem('proEditorWelcomeDismissed', '1'); } catch {}
  }

  return (
    <div className="border border-stone-300 rounded-lg overflow-hidden bg-stone-200 shadow-md">
      {/* ── Top header strip ────────────────────────────────────────── */}
      <div className="bg-stone-900 text-stone-100 px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
        <input
          type="text"
          value={planTitle}
          onChange={(e) => setPlanTitle(e.target.value)}
          className="bg-transparent border-b border-stone-700 focus:border-amber-400 outline-none text-base font-medium px-1"
          placeholder="Plan title…"
        />
        <div className="flex items-center gap-1 bg-stone-800 rounded p-0.5">
          <button onClick={() => setSpeciesCount(Math.max(3, speciesCount - 1))}
            className="w-6 h-6 rounded hover:bg-stone-700 text-stone-300 leading-none">−</button>
          <span className="w-7 text-center font-mono text-amber-400">{speciesCount}</span>
          <button onClick={() => setSpeciesCount(Math.min(40, speciesCount + 1))}
            className="w-6 h-6 rounded hover:bg-stone-700 text-stone-300 leading-none">+</button>
          <span className="text-[10px] uppercase tracking-wider text-stone-500 px-1">species</span>
        </div>
        <button
          onClick={onRegenerate}
          disabled={regenerating}
          className="bg-amber-500 hover:bg-amber-400 text-stone-900 font-medium text-xs px-3 py-1 rounded disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : '↻ Regenerate'}
        </button>
        <div className="flex-1 min-w-0" />
        <div className="text-[11px] text-stone-400 flex items-center gap-2">{viewControls}</div>
      </div>

      {/* ── Tool options bar (contextual) ──────────────────────────── */}
      <ToolOptionsBar
        tool={tool} brush={brush} setBrush={setBrush}
        activeSpecies={activeSpecies} onOpenCatalog={onOpenCatalog}
        copiedRegion={copiedRegion}
        selectionCount={selectionCount}
        onSelectAll={onSelectAll} onDeselect={onDeselect}
        onCopy={onCopy} onPaste={onPaste} onDelete={onDelete}
      />

      {/* ── Editor body: rail | map | right panels ───────────────── */}
      <div className="flex bg-stone-200" style={{ height: '70vh', minHeight: 480 }}>
        {/* Tool rail */}
        <aside className="w-12 bg-stone-800 flex flex-col items-center py-2 gap-1 flex-shrink-0">
          {TOOL_DEFS.map(td => {
            const active = tool === td.id;
            return (
              <ToolButton
                key={td.id}
                td={td}
                active={active}
                onClick={() => setTool(td.id)}
              />
            );
          })}
          <div className="my-1 w-6 border-t border-stone-700" />
          <ToolHint />
          <div className="mt-auto text-[8px] text-stone-500 -rotate-90 whitespace-nowrap pb-2 select-none">v1 editor</div>
        </aside>

        {/* Map slot */}
        <main className="flex-1 relative min-w-0">
          {mapSlot}
          {/* Floating welcome / onboarding card. Sits on the map in the top-right */}
          {welcomeOpen && (
            <div className="absolute top-3 left-3 z-10 max-w-xs bg-white/95 backdrop-blur rounded-lg shadow-xl border border-stone-300 p-3 text-xs">
              <div className="flex items-start gap-2">
                <span className="text-amber-500 text-base leading-none">★</span>
                <div className="flex-1">
                  <div className="font-semibold text-stone-900 text-sm mb-1">Welcome to the editor</div>
                  <ul className="text-stone-700 space-y-1 leading-snug">
                    <li>Pick a tool from the left rail (or press its letter — V, B, S, E…).</li>
                    <li>The bar above the map shows what each tool does.</li>
                    <li>Plants are organized into <strong>layers</strong> (matrix → structure → scatter → filler) — toggle visibility on the right.</li>
                    <li>Hover any tool button for a tooltip with its shortcut.</li>
                  </ul>
                  <button
                    onClick={dismissWelcome}
                    className="mt-2 text-amber-700 hover:text-amber-900 underline text-[11px]"
                  >Got it · don't show this again</button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right panels */}
        <aside className="w-72 bg-stone-100 border-l border-stone-300 overflow-y-auto flex flex-col flex-shrink-0">
          <PlantLibraryPanel
            species={species} plants={plants}
            activeSpeciesIdx={activeSpeciesIdx}
            onSetActiveSpeciesIdx={onSetActiveSpeciesIdx}
            onOpenCatalog={onOpenCatalog}
          />
          <LayersPanel
            plants={plants} species={species}
            layers={layers}
            toggleVisible={toggleLayerVisible}
            toggleLocked={toggleLayerLocked}
          />
          <PropertiesPanel
            selectionCount={selectionCount}
            selectionSpecies={selectionSpecies}
            tool={tool}
            onCopy={onCopy} onPaste={onPaste} onDelete={onDelete}
            onSwapTo={onSwapSelectionTo}
            species={species}
            copiedRegion={copiedRegion}
          />
          <PinnedPanel pinnedSlugs={pinnedSlugs} onUnpin={onUnpin} onOpenCatalog={onOpenCatalog} species={species} />
          <HelpPanel />
        </aside>
      </div>

      {/* ── Status bar ──────────────────────────────────────────── */}
      <StatusBar
        tool={tool}
        selectionCount={selectionCount}
        totalPlants={plants.length}
        visiblePlants={visiblePlants}
        activeSpeciesName={activeSpecies?.commonName ?? null}
        stampPattern={brush.pattern}
        copiedCount={copiedRegion?.plants.length ?? 0}
      />
    </div>
  );
}

// ── Tool button with hover help ────────────────────────────────────────────

function ToolButton({ td, active, onClick }: { td: typeof TOOL_DEFS[number]; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={`${td.label} (${td.key})`}
        className={`relative w-9 h-9 rounded flex items-center justify-center transition-colors ${
          active ? 'bg-amber-500 text-white' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-100'
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d={td.iconPath} />
        </svg>
        <span className="absolute bottom-0 right-0.5 text-[8px] font-mono opacity-70">{td.key}</span>
      </button>
      {hover && (
        <div className="absolute left-12 top-0 z-50 w-60 bg-stone-900 text-stone-100 rounded shadow-xl p-2 text-[11px] pointer-events-none">
          <div className="font-semibold mb-0.5">{td.label}
            <span className="ml-1.5 text-[10px] bg-stone-700 px-1 py-0.5 rounded font-mono">{td.key}</span>
          </div>
          <div className="text-stone-300 leading-snug">{td.help}</div>
        </div>
      )}
    </div>
  );
}

function ToolHint() {
  return (
    <button
      title="Press V / M / L / D / B / S / E / I to switch tools. ⌘A all · ⌘C/V copy/paste · ⌫ delete"
      className="w-9 h-9 rounded text-stone-400 hover:bg-stone-700 hover:text-stone-100 flex items-center justify-center"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9a2.5 2.5 0 015 0c0 1-.5 1.5-1.5 2-1 .5-1.5 1-1.5 2M12 17h.01" />
      </svg>
    </button>
  );
}

// ── Tool options bar ───────────────────────────────────────────────────────

function ToolOptionsBar(props: {
  tool: EditorTool;
  brush: BrushState;
  setBrush: (b: BrushState | ((prev: BrushState) => BrushState)) => void;
  activeSpecies: Plant | undefined;
  onOpenCatalog: () => void;
  copiedRegion: CopiedRegion | null;
  selectionCount: number;
  onSelectAll: () => void;
  onDeselect: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
}) {
  const { tool, brush, setBrush, activeSpecies, onOpenCatalog, copiedRegion, selectionCount, onSelectAll, onDeselect, onCopy, onPaste, onDelete } = props;

  if (tool === 'brush' || tool === 'stamp') {
    return (
      <div className="bg-amber-50 border-y border-amber-200 px-3 py-1.5 flex items-center gap-2 text-[11px] flex-wrap">
        <span className="font-bold text-amber-900 uppercase tracking-wider">{tool === 'stamp' ? 'Stamp' : 'Brush'}:</span>
        <span className="text-amber-800">
          Click empty bed to drop. Click an existing plant to swap. Hold <kbd className="px-1 bg-amber-200 rounded font-mono text-[10px]">Shift</kbd>+drag to paint multiple cells.
        </span>
        <Divider />
        <span className="text-stone-500 uppercase">Species:</span>
        {activeSpecies ? (
          <button onClick={onOpenCatalog}
            className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-amber-300 hover:border-amber-500">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getPlantColor(activeSpecies.bloomColor) }} />
            {activeSpecies.commonName}
          </button>
        ) : (
          <button onClick={onOpenCatalog}
            className="bg-white px-2 py-0.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-100">
            Pick a species…
          </button>
        )}
        {tool === 'stamp' && (
          <>
            <Divider />
            <span className="text-stone-500 uppercase">Pattern:</span>
            <div className="flex border border-amber-300 rounded overflow-hidden">
              {([1, 3, 5, 9] as const).map(n => (
                <button key={n}
                  onClick={() => setBrush(b => ({ ...b, pattern: n }))}
                  title={n === 1 ? 'Single' : n === 3 ? 'Triangle drift' : n === 5 ? 'Quincunx' : '3×3 grid'}
                  className={`px-2 py-0.5 ${brush.pattern === n ? 'bg-amber-500 text-white' : 'bg-white text-stone-700 hover:bg-amber-100'}`}>
                  {n}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  if (tool === 'move' || tool === 'marquee' || tool === 'lasso') {
    return (
      <div className="bg-blue-50 border-y border-blue-200 px-3 py-1.5 flex items-center gap-2 text-[11px] flex-wrap">
        <span className="font-bold text-blue-900 uppercase tracking-wider">{tool === 'lasso' ? 'Lasso' : tool === 'marquee' ? 'Marquee' : 'Move'}:</span>
        <span className="text-blue-800">
          {tool === 'move' && 'Click a plant to select. '}
          Drag to {tool === 'lasso' ? 'paint a freeform shape' : 'draw a rectangle'} — every plant inside gets selected.
          Hold <kbd className="px-1 bg-blue-200 rounded font-mono text-[10px]">Shift</kbd> to add, <kbd className="px-1 bg-blue-200 rounded font-mono text-[10px]">Alt</kbd> to subtract.
        </span>
        <Divider />
        <span className="bg-white px-2 py-0.5 rounded border border-blue-200">
          {selectionCount === 0 ? 'no selection' : `${selectionCount} plant${selectionCount === 1 ? '' : 's'} selected`}
        </span>
        <button onClick={onSelectAll} className="px-2 py-0.5 bg-white border border-blue-300 rounded hover:bg-blue-100">All <kbd className="ml-1 px-0.5 bg-blue-100 rounded font-mono text-[10px]">⌘A</kbd></button>
        <button onClick={onDeselect} className="px-2 py-0.5 bg-white border border-blue-300 rounded hover:bg-blue-100">None <kbd className="ml-1 px-0.5 bg-blue-100 rounded font-mono text-[10px]">Esc</kbd></button>
        {selectionCount > 0 && (
          <>
            <Divider />
            <button onClick={onCopy} className="px-2 py-0.5 bg-white border border-blue-300 rounded hover:bg-blue-100">📋 Copy</button>
            <button onClick={onPaste} disabled={!copiedRegion} className="px-2 py-0.5 bg-white border border-blue-300 rounded hover:bg-blue-100 disabled:opacity-40">Paste</button>
            <button onClick={onDelete} className="px-2 py-0.5 bg-red-50 border border-red-300 text-red-700 rounded hover:bg-red-100">⌫ Delete</button>
          </>
        )}
      </div>
    );
  }

  if (tool === 'drag') {
    return (
      <div className="bg-violet-50 border-y border-violet-200 px-3 py-1.5 text-[11px] text-violet-900">
        <span className="font-bold uppercase tracking-wider">Drag-edit:</span>{' '}
        {selectionCount === 0
          ? 'Make a selection first (press M and drag), then click+drag any selected plant to move the whole group.'
          : `${selectionCount} plant${selectionCount === 1 ? '' : 's'} selected. Click+drag a selected plant to move the group, or use arrow keys to nudge.`}
      </div>
    );
  }

  if (tool === 'erase') {
    return (
      <div className="bg-red-50 border-y border-red-200 px-3 py-1.5 text-[11px] text-red-900">
        <span className="font-bold uppercase tracking-wider">Erase:</span>{' '}
        Click any plant to remove just that placement. Locked layers (right panel) are protected.
        {selectionCount > 0 && (
          <> Or press <kbd className="px-1 bg-red-200 rounded font-mono text-[10px]">⌫</kbd> to delete the {selectionCount} selected plant{selectionCount === 1 ? '' : 's'} at once.</>
        )}
      </div>
    );
  }

  if (tool === 'eyedropper') {
    return (
      <div className="bg-sky-50 border-y border-sky-200 px-3 py-1.5 text-[11px] text-sky-900">
        <span className="font-bold uppercase tracking-wider">Eyedropper:</span>{' '}
        Click any plant on the map. Its species becomes the active brush, and the tool auto-switches to Brush so you can keep painting.
      </div>
    );
  }

  return null;
}

function Divider() { return <span className="w-px h-4 bg-stone-300 inline-block" />; }

// ── Right panels ───────────────────────────────────────────────────────────

function Panel({ title, hint, children, defaultOpen = true }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stone-300">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-stone-200/70 hover:bg-stone-200 text-[10px] font-bold uppercase tracking-wider text-stone-700"
      >
        <span>{title}</span>
        <span className="flex items-center gap-1.5">
          {hint && <span className="text-stone-500 normal-case font-normal">{hint}</span>}
          <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </button>
      {open && <div className="p-2">{children}</div>}
    </div>
  );
}

function PlantLibraryPanel({
  species, plants, activeSpeciesIdx, onSetActiveSpeciesIdx, onOpenCatalog,
}: {
  species: Plant[];
  plants: PlanPlant[];
  activeSpeciesIdx: number | null;
  onSetActiveSpeciesIdx: (slug: string) => void;
  onOpenCatalog: () => void;
}) {
  // Group species used in plan by their oudolfRole
  const used = new Map<string, { slug: string; commonName: string; scientificName: string; bloomColor: string; oudolfRole?: string; speciesIdx?: number; count: number; imageUrl?: string }>();
  for (const p of plants) {
    const ex = used.get(p.plantSlug);
    if (ex) ex.count += p.quantity;
    else {
      const cat = species.find(s => s.slug === p.plantSlug);
      used.set(p.plantSlug, {
        slug: p.plantSlug,
        commonName: p.commonName,
        scientificName: p.scientificName,
        bloomColor: p.bloomColor,
        oudolfRole: cat?.oudolfRole,
        speciesIdx: p.speciesIndex,
        count: p.quantity,
        imageUrl: p.imageUrl,
      });
    }
  }
  const list = Array.from(used.values()).sort((a, b) => (a.speciesIdx ?? 0) - (b.speciesIdx ?? 0));

  return (
    <Panel title={`Plant library · ${list.length} in plan`} hint="click to set as brush">
      <div className="space-y-1">
        {list.map(s => {
          const isActive = s.speciesIdx === activeSpeciesIdx;
          const layer = s.oudolfRole as LayerId | undefined;
          return (
            <button key={s.slug}
              onClick={() => onSetActiveSpeciesIdx(s.slug)}
              className={`w-full flex items-center gap-2 p-1.5 rounded text-left text-[11px] border transition-all ${
                isActive ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-400/40' : 'border-stone-200 hover:border-stone-300 bg-white'
              }`}
            >
              {s.imageUrl ? (
                <img src={s.imageUrl} alt="" className="w-7 h-7 rounded object-cover flex-shrink-0 bg-stone-100" />
              ) : (
                <span className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0"
                  style={{ backgroundColor: getPlantColor(s.bloomColor) }}>{s.speciesIdx}</span>
              )}
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium text-stone-900">{s.commonName}</span>
                <span className="block truncate text-[10px] italic text-stone-500">{s.scientificName}</span>
              </span>
              {layer && <span className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded border ${LAYER_LABELS[layer].bgTone} ${LAYER_LABELS[layer].tone}`}>{layer.slice(0, 3)}</span>}
              <span className="text-[10px] text-stone-500 font-mono">×{s.count}</span>
            </button>
          );
        })}
        <button onClick={onOpenCatalog}
          className="w-full mt-1 px-2 py-1.5 text-[11px] border-2 border-dashed border-stone-300 rounded text-stone-500 hover:border-primary hover:text-primary">
          + Browse full catalog
        </button>
      </div>
    </Panel>
  );
}

function LayersPanel({
  plants, species, layers, toggleVisible, toggleLocked,
}: {
  plants: PlanPlant[];
  species: Plant[];
  layers: Record<LayerId, LayerState>;
  toggleVisible: (l: LayerId) => void;
  toggleLocked: (l: LayerId) => void;
}) {
  // Count plants per layer
  const counts: Record<LayerId, number> = { matrix: 0, structure: 0, scatter: 0, filler: 0 };
  for (const p of plants) {
    const cat = species.find(s => s.slug === p.plantSlug);
    const role = (cat?.oudolfRole ?? 'matrix') as LayerId;
    counts[role] = (counts[role] || 0) + 1;
  }

  return (
    <Panel title="Layers" hint="visibility · lock">
      <p className="text-[10px] text-stone-500 italic mb-2 leading-snug">
        Plants are grouped by Oudolf role. Hide a layer to focus on the rest. Lock to protect from accidental edits.
      </p>
      <div className="space-y-1">
        {(['structure', 'scatter', 'filler', 'matrix'] as LayerId[]).map(layer => {
          const lc = layers[layer];
          const def = LAYER_LABELS[layer];
          return (
            <div key={layer}
              className={`flex items-center gap-1.5 p-1.5 rounded border ${
                lc.visible ? 'border-stone-200 bg-white' : 'border-stone-200 bg-stone-50'
              }`}>
              <button onClick={() => toggleVisible(layer)} title={lc.visible ? 'Hide layer' : 'Show layer'}
                className="w-5 h-5 flex items-center justify-center text-stone-500 hover:text-stone-900">
                {lc.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button onClick={() => toggleLocked(layer)} title={lc.locked ? 'Unlock layer' : 'Lock layer'}
                className={`w-5 h-5 flex items-center justify-center ${lc.locked ? 'text-amber-600' : 'text-stone-400 hover:text-stone-900'}`}>
                {lc.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <div className="flex-1 min-w-0">
                <div className={`text-[12px] font-medium ${lc.visible ? 'text-stone-900' : 'text-stone-400'} ${lc.locked ? 'italic' : ''}`}>
                  {def.label}
                </div>
                <div className="text-[10px] text-stone-500 truncate">{def.description}</div>
              </div>
              <span className="text-[10px] text-stone-500 font-mono">{counts[layer]}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function PropertiesPanel({
  selectionCount, selectionSpecies, tool,
  onCopy, onPaste, onDelete, onSwapTo, species, copiedRegion,
}: {
  selectionCount: number;
  selectionSpecies: { slug: string; commonName: string; count: number }[];
  tool: EditorTool;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSwapTo: (slug: string) => void;
  species: Plant[];
  copiedRegion: CopiedRegion | null;
}) {
  if (selectionCount === 0) {
    return (
      <Panel title="Properties · empty">
        <p className="text-[11px] text-stone-600 leading-snug">
          Click a plant on the map to select it, or press <kbd className="px-1 bg-stone-200 rounded font-mono text-[10px]">M</kbd> and drag a marquee.
          Selected plants get a dashed blue ring. Use <kbd className="px-1 bg-stone-200 rounded font-mono text-[10px]">Shift</kbd>+click to add to selection.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={`Properties · ${selectionCount} selected`} defaultOpen>
      {/* Action buttons */}
      <div className="flex flex-wrap gap-1 mb-2">
        <button onClick={onCopy} className="px-2 py-1 text-[11px] bg-white border border-stone-300 rounded hover:border-stone-500">📋 Copy</button>
        <button onClick={onPaste} disabled={!copiedRegion} className="px-2 py-1 text-[11px] bg-white border border-stone-300 rounded hover:border-stone-500 disabled:opacity-40">Paste</button>
        <button onClick={onDelete} className="px-2 py-1 text-[11px] bg-red-50 border border-red-300 text-red-700 rounded hover:bg-red-100">⌫ Delete</button>
      </div>
      {tool !== 'drag' && (
        <p className="text-[10px] text-stone-500 italic mb-2">
          Switch to <kbd className="px-1 bg-stone-200 rounded font-mono">D</kbd> Drag-edit and click+drag a selected plant to move the whole group.
        </p>
      )}

      {/* Selection breakdown */}
      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">Species in selection</div>
      <div className="space-y-1 mb-2">
        {selectionSpecies.map(s => (
          <div key={s.slug} className="flex items-center gap-1.5 text-[11px] bg-white border border-stone-200 rounded px-1.5 py-1">
            <span className="flex-1 truncate">{s.commonName}</span>
            <span className="text-stone-500 font-mono">×{s.count}</span>
          </div>
        ))}
      </div>

      {/* Replace-with quick action */}
      {selectionSpecies.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">Replace selection with</div>
          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
            {species
              .filter(s => !selectionSpecies.some(sel => sel.slug === s.slug))
              .slice(0, 10)
              .map(s => (
                <button key={s.slug}
                  onClick={() => onSwapTo(s.slug)}
                  className="px-1.5 py-0.5 text-[10px] bg-white border border-stone-300 rounded hover:border-primary hover:bg-primary/5">
                  {s.commonName}
                </button>
              ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function PinnedPanel({ pinnedSlugs, onUnpin, onOpenCatalog, species }: { pinnedSlugs: string[]; onUnpin: (slug: string) => void; onOpenCatalog: () => void; species: Plant[] }) {
  return (
    <Panel title={`Pinned · ${pinnedSlugs.length}`} defaultOpen={false}>
      <p className="text-[10px] text-stone-500 italic mb-2">
        Pinned plants are forced into the next regenerate so the auto-scorer can't drop them.
      </p>
      {pinnedSlugs.length === 0 ? (
        <button onClick={onOpenCatalog}
          className="w-full p-1.5 text-[11px] border-2 border-dashed border-stone-300 rounded text-stone-500 hover:border-emerald-500 hover:text-emerald-700">
          Browse catalog to pin plants
        </button>
      ) : (
        <div className="flex flex-wrap gap-1">
          {pinnedSlugs.map(slug => {
            const s = species.find(x => x.slug === slug);
            return (
              <span key={slug} className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded px-1.5 py-0.5 text-[10px]">
                📌 {s?.commonName ?? slug}
                <button onClick={() => onUnpin(slug)} className="text-emerald-600 hover:text-red-500">×</button>
              </span>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function HelpPanel() {
  return (
    <Panel title="Keyboard shortcuts" defaultOpen={false}>
      <div className="text-[11px] text-stone-700 space-y-0.5">
        <Shortcut k="V" desc="Move / Select cursor" />
        <Shortcut k="M" desc="Marquee select (rectangle)" />
        <Shortcut k="L" desc="Lasso select (freeform)" />
        <Shortcut k="D" desc="Drag-edit (move selection)" />
        <Shortcut k="B" desc="Brush — paint single plant" />
        <Shortcut k="S" desc="Stamp — paint a 1/3/5/9 cluster" />
        <Shortcut k="E" desc="Erase plants" />
        <Shortcut k="I" desc="Eyedropper — pick species" />
        <div className="border-t border-stone-200 mt-1 pt-1" />
        <Shortcut k="⌘A" desc="Select all visible plants" />
        <Shortcut k="⌘C" desc="Copy selection (with offsets)" />
        <Shortcut k="⌘V" desc="Paste at last cursor" />
        <Shortcut k="⌫" desc="Delete selection" />
        <Shortcut k="Esc" desc="Clear selection" />
        <Shortcut k="Shift+click" desc="Add plant to selection" />
        <Shortcut k="Shift+drag" desc="Continuous paint while in Brush" />
      </div>
    </Panel>
  );
}

function Shortcut({ k, desc }: { k: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <kbd className="px-1.5 py-0.5 bg-stone-200 rounded font-mono text-[10px] min-w-[28px] text-center">{k}</kbd>
      <span>{desc}</span>
    </div>
  );
}

// ── Status bar ─────────────────────────────────────────────────────────────

const TIPS = [
  'Tip: hover any tool button on the rail to see what it does.',
  'Tip: Shift-drag while painting to drop a continuous trail of plants.',
  'Tip: Lock a layer to protect those plants from accidental edits.',
  'Tip: Copy/paste preserves relative positions — great for repeating drifts.',
  'Tip: Press I to eyedrop a species, then B to keep painting it.',
];

function StatusBar({
  tool, selectionCount, totalPlants, visiblePlants, activeSpeciesName, stampPattern, copiedCount,
}: {
  tool: EditorTool;
  selectionCount: number;
  totalPlants: number;
  visiblePlants: number;
  activeSpeciesName: string | null;
  stampPattern: number;
  copiedCount: number;
}) {
  const [tipIdx, setTipIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTipIdx(i => (i + 1) % TIPS.length), 8000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bg-stone-900 text-stone-300 px-3 py-1 flex items-center gap-3 text-[11px] flex-wrap">
      <span>tool · <span className="text-amber-400 uppercase font-mono">{tool}</span></span>
      <span>{selectionCount > 0 ? `${selectionCount} selected` : `${visiblePlants}/${totalPlants} visible`}</span>
      <span>brush · {activeSpeciesName ?? '—'}</span>
      <span>stamp · {stampPattern}-up</span>
      {copiedCount > 0 && <span>clipboard · {copiedCount} plants</span>}
      <span className="ml-auto text-stone-500 italic">{TIPS[tipIdx]}</span>
    </div>
  );
}

// ── Tiny icons + helpers ───────────────────────────────────────────────────

function EyeIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.04 12C3.4 7.5 7.4 4 12 4s8.6 3.5 9.96 8c-1.36 4.5-5.36 8-9.96 8s-8.6-3.5-9.96-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}
function EyeOffIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M9.9 5.1A10 10 0 0112 5c4.6 0 8.6 3.5 10 8a11 11 0 01-3 4.5M6.1 6.1A11 11 0 002 13c1.4 4.5 5.4 8 10 8 1.5 0 3-.4 4.3-1.1" />
  </svg>;
}
function LockIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>;
}
function UnlockIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 017-2.7" />
  </svg>;
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
