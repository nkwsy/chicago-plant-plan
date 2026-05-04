'use client';

import Link from 'next/link';
import Canvas from '../_shared/Canvas';
import { useToolbarState } from '../_shared/useToolbarState';
import type { Tool, LayerId } from '../_shared/types';
import { LAYER_LABELS } from '../_shared/mockData';

/** Variant 1 — Photoshop-style "Pro Editor" toolbar.
 *  Narrow icon rail (left), tool-options bar (top), 3 right panels. */

const TOOL_DEFS: { id: Tool; key: string; label: string; path: string }[] = [
  { id: 'move',       key: 'V', label: 'Move / Select', path: 'M5 3l14 9-7 1-3 7z' },
  { id: 'marquee',    key: 'M', label: 'Marquee',       path: 'M3 3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6m0-6V3' },
  { id: 'lasso',      key: 'L', label: 'Lasso',         path: 'M5 9c0-3 4-5 8-5s7 2 7 5-3 5-7 5h-2c-2 0-3 1-3 3 0 2 1 3 3 3h6' },
  { id: 'drag',       key: 'D', label: 'Drag-edit',     path: 'M9 5l-5 7 5 7M15 5l5 7-5 7M9 12h6' },
  { id: 'brush',      key: 'B', label: 'Brush',         path: 'M9.5 16a3 3 0 00-5.8 1.1 2.3 2.3 0 01-2.4 2.2 4.5 4.5 0 008.4-2.2c0-.4-.1-.8-.2-1.1zm0 0a16 16 0 003.4-1.6m-5-.1a16 16 0 011.6-3.4m3.4 3.4a16 16 0 004.8-4.6l3.9-5.8a1.2 1.2 0 00-1.6-1.6L8.8 8.2a16 16 0 00-4.6 4.8' },
  { id: 'stamp',      key: 'S', label: 'Stamp',         path: 'M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h6v6h-6z' },
  { id: 'erase',      key: 'E', label: 'Erase',         path: 'M14.7 9l-.4 9m-4.7 0L9.3 9m9.9-3.2c.3 0 .7.1 1 .2M5.8 7H18.2' },
  { id: 'eyedropper', key: 'I', label: 'Eyedropper',    path: 'M16 5l3 3-9 9-3 1 1-3z' },
];

export default function ProEditorVariant() {
  const t = useToolbarState();
  const { state } = t;
  const activeSp = state.species.find(s => s.idx === state.activeSpeciesIdx);

  const selectionCount = state.selectedIds.size;
  const selectedLayers = new Set(
    Array.from(state.selectedIds).map(id => {
      const p = state.plants.find(x => x.id === id);
      return p ? state.species.find(s => s.idx === p.speciesIdx)?.layer : null;
    }).filter(Boolean)
  );
  const totalPlants = state.plants.length;

  return (
    <div className="h-screen flex flex-col bg-stone-200 text-stone-900">
      {/* Top breadcrumb */}
      <div className="bg-stone-900 text-stone-100 px-3 py-1.5 flex items-center justify-between text-xs">
        <Link href="/sandbox/toolbar" className="text-stone-400 hover:text-white">← back to variants</Link>
        <span className="font-semibold tracking-wider uppercase">Pro Editor · Photoshop-style mockup</span>
        <span className="text-stone-500">prototype · not wired to real data</span>
      </div>

      {/* Tool options bar (contextual) */}
      <ToolOptionsBar t={t} activeSp={activeSp} />

      <div className="flex-1 flex min-h-0 bg-stone-300">
        {/* Left tool rail */}
        <aside className="w-12 bg-stone-800 flex flex-col items-center py-2 gap-1">
          {TOOL_DEFS.map(td => {
            const active = state.tool === td.id;
            return (
              <button key={td.id}
                onClick={() => t.setTool(td.id)}
                title={`${td.label} (${td.key})`}
                className={`relative w-9 h-9 rounded flex items-center justify-center transition-colors ${
                  active ? 'bg-amber-500 text-white' : 'text-stone-400 hover:bg-stone-700 hover:text-stone-100'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={td.path} />
                </svg>
                <span className="absolute bottom-0 right-0.5 text-[8px] font-mono opacity-70">{td.key}</span>
              </button>
            );
          })}
          <div className="mt-auto text-[8px] text-stone-500 -rotate-90 whitespace-nowrap pb-2">v1</div>
        </aside>

        {/* Canvas */}
        <main className="flex-1 p-2 min-w-0 flex items-center justify-center">
          <div className="w-full h-full max-h-full">
            <Canvas
              state={state}
              onClickPlant={t.clickPlant}
              onClickCanvas={t.clickCanvas}
              onCompleteRectSelect={t.completeRectSelect}
              onCompleteLassoSelect={t.completeLassoSelect}
              onMoveSelection={t.moveSelection}
              onPasteAt={t.pasteAt}
            />
          </div>
        </main>

        {/* Right panels */}
        <aside className="w-72 flex flex-col bg-stone-100 border-l border-stone-300 overflow-y-auto">
          <Panel title="Plant library">
            <div className="grid grid-cols-1 gap-1">
              {state.species.map(sp => {
                const isActive = sp.idx === state.activeSpeciesIdx;
                const count = state.plants.filter(p => p.speciesIdx === sp.idx).length;
                return (
                  <button key={sp.idx}
                    onClick={() => t.setActiveSpeciesIdx(sp.idx)}
                    className={`flex items-center gap-2 p-1.5 rounded text-left text-[12px] border transition-all ${
                      isActive ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-400/40' : 'border-stone-200 hover:border-stone-300 bg-white'
                    }`}
                  >
                    <span className="w-6 h-6 rounded flex items-center justify-center text-white font-bold text-[10px]"
                      style={{ backgroundColor: sp.color }}>{sp.idx}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{sp.commonName}</span>
                      <span className="block truncate text-[10px] italic text-stone-500">{sp.scientificName}</span>
                    </span>
                    <span className={`text-[10px] uppercase tracking-wider px-1 py-0.5 rounded ${LAYER_LABELS[sp.layer].tone}`}>{sp.layer.slice(0, 3)}</span>
                    <span className="text-[10px] text-stone-500 font-mono">×{count}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel title="Layers">
            <div className="space-y-1">
              {(['structure', 'scatter', 'filler', 'matrix'] as LayerId[]).map(layer => {
                const lc = state.layers[layer];
                const count = state.plants.filter(p => state.species.find(s => s.idx === p.speciesIdx)?.layer === layer).length;
                const selectedHere = selectedLayers.has(layer);
                return (
                  <div key={layer}
                    className={`flex items-center gap-1.5 p-1.5 rounded border ${
                      selectedHere ? 'bg-blue-50 border-blue-300' : 'border-transparent hover:bg-white/60'
                    }`}>
                    <button onClick={() => t.toggleLayerVisible(layer)} title={lc.visible ? 'Hide layer' : 'Show layer'}
                      className={`w-5 h-5 flex items-center justify-center rounded text-stone-500 hover:text-stone-900`}>
                      {lc.visible
                        ? <EyeIcon className="w-4 h-4" />
                        : <EyeOffIcon className="w-4 h-4" />}
                    </button>
                    <button onClick={() => t.toggleLayerLocked(layer)} title={lc.locked ? 'Unlock layer' : 'Lock layer'}
                      className={`w-5 h-5 flex items-center justify-center rounded ${lc.locked ? 'text-amber-600' : 'text-stone-400 hover:text-stone-900'}`}>
                      {lc.locked ? <LockedIcon className="w-4 h-4" /> : <UnlockedIcon className="w-4 h-4" />}
                    </button>
                    <span className={`flex-1 text-[12px] ${lc.visible ? 'text-stone-800' : 'text-stone-400'} ${lc.locked ? 'italic' : ''}`}>
                      {LAYER_LABELS[layer].label}
                    </span>
                    <span className="text-[10px] text-stone-500 font-mono">{count}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title={`Properties${selectionCount ? ` · ${selectionCount} selected` : ''}`}>
            {selectionCount === 0 ? (
              <p className="text-[11px] text-stone-500 italic">
                Click a plant or marquee a region to select. Shift-click adds, alt-click removes.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <button onClick={t.copySelection}
                    className="px-2 py-1 text-[11px] bg-white border border-stone-300 rounded hover:border-stone-500"
                    title="Copy (⌘C)">📋 Copy</button>
                  <button onClick={() => t.pasteAt(400, 250)}
                    disabled={!state.clipboard}
                    className="px-2 py-1 text-[11px] bg-white border border-stone-300 rounded hover:border-stone-500 disabled:opacity-40"
                    title="Paste at center (⌘V)">📋 Paste</button>
                  <button onClick={t.deleteSelection}
                    className="px-2 py-1 text-[11px] bg-red-50 border border-red-300 text-red-700 rounded hover:bg-red-100"
                    title="Delete (⌫)">⌫ Delete</button>
                </div>
                <p className="text-[11px] text-stone-600">
                  Switch to <kbd className="px-1 py-0.5 bg-stone-200 rounded font-mono text-[10px]">D</kbd> Drag-edit and click+drag the selection to move it.
                </p>
              </div>
            )}
          </Panel>

          <Panel title="Clipboard">
            {state.clipboard ? (
              <p className="text-[11px] text-stone-700">
                {state.clipboard.length} plant{state.clipboard.length === 1 ? '' : 's'} captured. Press <kbd className="px-1 py-0.5 bg-stone-200 rounded font-mono text-[10px]">⌘V</kbd> to paste at canvas center, or use the Paste button above.
              </p>
            ) : (
              <p className="text-[11px] text-stone-500 italic">Empty. Select plants then ⌘C to copy.</p>
            )}
          </Panel>
        </aside>
      </div>

      {/* Status bar */}
      <div className="bg-stone-900 text-stone-300 px-3 py-1 flex items-center gap-4 text-[11px]">
        <span>tool · <span className="text-amber-400 uppercase font-mono">{state.tool}</span></span>
        <span>{selectionCount > 0 ? `${selectionCount} selected` : `${totalPlants} plants`}</span>
        <span>brush · {activeSp?.commonName ?? '—'}</span>
        <span>stamp · {state.stampPattern}-up</span>
        <span className="ml-auto text-stone-500">
          shortcuts: V M L D B S E I · ⌘A select all · ⌘C/V copy/paste · ⌫ delete · esc deselect
        </span>
      </div>
    </div>
  );
}

// ── Tool options bar ──────────────────────────────────────────────────────

function ToolOptionsBar({ t, activeSp }: { t: ReturnType<typeof useToolbarState>; activeSp: any }) {
  const { state } = t;

  if (state.tool === 'brush' || state.tool === 'stamp') {
    return (
      <div className="bg-stone-100 border-b border-stone-300 px-3 py-1.5 flex items-center gap-3 text-[11px] flex-wrap">
        <span className="text-stone-500 uppercase font-medium">Brush:</span>
        <span className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-stone-200">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: activeSp?.color }} />
          {activeSp?.commonName}
        </span>
        <Divider />
        <span className="text-stone-500 uppercase font-medium">Pattern:</span>
        <div className="flex border border-stone-300 rounded overflow-hidden">
          {([1, 3, 5, 9] as const).map(n => (
            <button key={n} onClick={() => t.setStampPattern(n)}
              className={`px-2 py-0.5 ${state.stampPattern === n ? 'bg-amber-500 text-white' : 'bg-white hover:bg-stone-100'}`}>
              {n}
            </button>
          ))}
        </div>
        <Divider />
        <label className="flex items-center gap-1.5">
          <span className="text-stone-500 uppercase">Spacing:</span>
          <input type="range" min={12} max={40} value={state.brushSize}
            onChange={(e) => t.setBrushSize(parseInt(e.target.value))}
            className="accent-amber-500 w-32" />
          <span className="font-mono text-stone-600 w-7">{state.brushSize}</span>
        </label>
        <span className="ml-auto text-stone-400 text-[10px]">Click on canvas to place plants</span>
      </div>
    );
  }

  if (state.tool === 'move' || state.tool === 'marquee' || state.tool === 'lasso') {
    return (
      <div className="bg-stone-100 border-b border-stone-300 px-3 py-1.5 flex items-center gap-3 text-[11px]">
        <span className="text-stone-500 uppercase font-medium">Selection:</span>
        <span className="bg-white px-2 py-0.5 rounded border border-stone-200">
          {state.selectedIds.size === 0 ? 'empty' : `${state.selectedIds.size} plant${state.selectedIds.size === 1 ? '' : 's'}`}
        </span>
        <Divider />
        <button onClick={t.selectAll} className="px-2 py-0.5 bg-white border border-stone-300 rounded hover:border-stone-500">All (⌘A)</button>
        <button onClick={t.deselect} className="px-2 py-0.5 bg-white border border-stone-300 rounded hover:border-stone-500">None (Esc)</button>
        <Divider />
        <span className="text-stone-500">Hold Shift to add · Alt to subtract</span>
        <span className="ml-auto text-stone-400 text-[10px]">Tool: {state.tool}</span>
      </div>
    );
  }

  if (state.tool === 'drag') {
    return (
      <div className="bg-amber-50 border-b border-amber-300 px-3 py-1.5 flex items-center gap-3 text-[11px]">
        <span className="text-amber-800 uppercase font-medium">Drag-edit:</span>
        <span className="text-amber-900">
          Click+drag a selected plant to move the whole selection. {state.selectedIds.size === 0 && '(Make a selection first.)'}
        </span>
      </div>
    );
  }

  if (state.tool === 'erase') {
    return (
      <div className="bg-red-50 border-b border-red-300 px-3 py-1.5 flex items-center gap-3 text-[11px] text-red-900">
        <span className="uppercase font-medium">Erase:</span>
        <span>Click any plant to remove it. Locked layers are protected.</span>
      </div>
    );
  }

  if (state.tool === 'eyedropper') {
    return (
      <div className="bg-blue-50 border-b border-blue-300 px-3 py-1.5 flex items-center gap-3 text-[11px] text-blue-900">
        <span className="uppercase font-medium">Eyedropper:</span>
        <span>Click any plant to set it as the active species, then auto-switch to Brush.</span>
      </div>
    );
  }

  return null;
}

function Divider() { return <span className="w-px h-4 bg-stone-300" />; }

// ── Panel + icons ─────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-stone-300">
      <div className="px-3 py-1.5 bg-stone-200 text-[10px] font-bold uppercase tracking-wider text-stone-700">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.04 12C3.4 7.5 7.4 4 12 4s8.6 3.5 9.96 8c-1.36 4.5-5.36 8-9.96 8s-8.6-3.5-9.96-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>;
}
function EyeOffIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M9.9 5.1A10 10 0 0112 5c4.6 0 8.6 3.5 10 8a11 11 0 01-3 4.5M6.1 6.1A11 11 0 002 13c1.4 4.5 5.4 8 10 8 1.5 0 3-.4 4.3-1.1" />
  </svg>;
}
function LockedIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>;
}
function UnlockedIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 017-2.7" />
  </svg>;
}
