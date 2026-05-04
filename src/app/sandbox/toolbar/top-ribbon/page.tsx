'use client';

import Link from 'next/link';
import Canvas from '../_shared/Canvas';
import { useToolbarState } from '../_shared/useToolbarState';
import type { Tool, LayerId } from '../_shared/types';
import { LAYER_LABELS } from '../_shared/mockData';

/** Variant 2 — SketchUp-style "Top Ribbon" toolbar.
 *  Wide horizontal ribbon at the top with chunky labeled buttons grouped
 *  into Edit / View / Site / Plants. Active-tool subbar appears below the
 *  ribbon. Right side: plant library + layers panel. */

interface RibbonBtnDef {
  id?: Tool;
  label: string;
  icon: string;
  action?: 'selectAll' | 'deselect' | 'copy' | 'paste' | 'delete';
}

const EDIT_TOOLS: RibbonBtnDef[][] = [
  [
    { id: 'move',    label: 'Select',  icon: 'M5 3l14 9-7 1-3 7z' },
    { id: 'marquee', label: 'Marquee', icon: 'M3 3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6m0-6V3' },
    { id: 'lasso',   label: 'Lasso',   icon: 'M5 9c0-3 4-5 8-5s7 2 7 5-3 5-7 5h-2c-2 0-3 1-3 3 0 2 1 3 3 3h6' },
  ],
  [
    { id: 'drag',  label: 'Drag-edit', icon: 'M9 5l-5 7 5 7M15 5l5 7-5 7M9 12h6' },
    { id: 'brush', label: 'Brush',     icon: 'M9.5 16a3 3 0 00-5.8 1.1 2.3 2.3 0 01-2.4 2.2 4.5 4.5 0 008.4-2.2c0-.4-.1-.8-.2-1.1zm0 0a16 16 0 003.4-1.6m-5-.1a16 16 0 011.6-3.4m3.4 3.4a16 16 0 004.8-4.6l3.9-5.8a1.2 1.2 0 00-1.6-1.6L8.8 8.2a16 16 0 00-4.6 4.8' },
    { id: 'stamp', label: 'Stamp',     icon: 'M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h6v6h-6z' },
  ],
];

const ACTION_BTNS: RibbonBtnDef[][] = [
  [
    { action: 'copy', label: 'Copy ⌘C',   icon: 'M9 12V5a2 2 0 012-2h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2zM5 9a2 2 0 00-2 2v7a2 2 0 002 2h7a2 2 0 002-2v-1' },
    { action: 'paste', label: 'Paste ⌘V', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  ],
  [
    { id: 'erase', label: 'Erase',  icon: 'M14.7 9l-.4 9m-4.7 0L9.3 9m9.9-3.2c.3 0 .7.1 1 .2M5.8 7H18.2' },
    { action: 'delete', label: 'Delete',  icon: 'M14.7 9l-.4 9m-4.7 0L9.3 9M5.84 7H18.16M9 3h6a1 1 0 011 1v3H8V4a1 1 0 011-1z' },
    { id: 'eyedropper', label: 'Eyedrop', icon: 'M16 5l3 3-9 9-3 1 1-3z' },
  ],
];

export default function TopRibbonVariant() {
  const t = useToolbarState();
  const { state } = t;
  const activeSp = state.species.find(s => s.idx === state.activeSpeciesIdx);
  const selectionCount = state.selectedIds.size;
  const totalPlants = state.plants.length;

  return (
    <div className="h-screen flex flex-col bg-slate-100 text-slate-900">
      {/* Top breadcrumb */}
      <div className="bg-slate-800 text-slate-200 px-3 py-1.5 flex items-center justify-between text-xs">
        <Link href="/sandbox/toolbar" className="text-slate-400 hover:text-white">← back to variants</Link>
        <span className="font-semibold tracking-wider uppercase">Top Ribbon · SketchUp-style mockup</span>
        <span className="text-slate-500">prototype · not wired to real data</span>
      </div>

      {/* Ribbon */}
      <div className="bg-gradient-to-b from-slate-50 to-slate-200 border-b border-slate-300">
        <div className="flex items-stretch divide-x divide-slate-300">
          {/* Edit group */}
          <RibbonGroup title="Edit">
            {EDIT_TOOLS.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map(btn => (
                  <RibbonButton key={btn.label}
                    btn={btn}
                    active={btn.id ? state.tool === btn.id : false}
                    onClick={() => btn.id && t.setTool(btn.id)} />
                ))}
              </div>
            ))}
          </RibbonGroup>

          {/* Actions group */}
          <RibbonGroup title="Actions">
            {ACTION_BTNS.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map(btn => (
                  <RibbonButton key={btn.label}
                    btn={btn}
                    active={btn.id ? state.tool === btn.id : false}
                    onClick={() => {
                      if (btn.action === 'copy') t.copySelection();
                      else if (btn.action === 'paste') t.pasteAt(400, 250);
                      else if (btn.action === 'delete') t.deleteSelection();
                      else if (btn.id) t.setTool(btn.id);
                    }} />
                ))}
              </div>
            ))}
          </RibbonGroup>

          {/* Stamp pattern group (always-visible — common SketchUp pattern of
              keeping settings flat across the ribbon) */}
          <RibbonGroup title="Stamp pattern">
            <div className="grid grid-cols-2 gap-1">
              {([1, 3, 5, 9] as const).map(n => (
                <button key={n}
                  onClick={() => t.setStampPattern(n)}
                  title={n === 1 ? 'Single' : n === 3 ? 'Triangle' : n === 5 ? 'Quincunx' : '3×3 grid'}
                  className={`px-3 py-1.5 text-[11px] font-medium border rounded ${
                    state.stampPattern === n
                      ? 'bg-amber-500 border-amber-600 text-white'
                      : 'bg-white border-slate-300 hover:border-slate-500'
                  }`}>
                  {n}-up
                </button>
              ))}
            </div>
          </RibbonGroup>

          {/* Quick layer toggles */}
          <RibbonGroup title="Layers">
            <div className="grid grid-cols-2 gap-1">
              {(['structure', 'scatter', 'matrix', 'filler'] as LayerId[]).map(l => {
                const lc = state.layers[l];
                return (
                  <button key={l}
                    onClick={() => t.toggleLayerVisible(l)}
                    title={lc.visible ? 'Hide layer' : 'Show layer'}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider border rounded ${
                      lc.visible
                        ? `${LAYER_LABELS[l].tone} border-current`
                        : 'bg-slate-100 border-slate-300 text-slate-400 line-through'
                    }`}>
                    {LAYER_LABELS[l].label}
                  </button>
                );
              })}
            </div>
          </RibbonGroup>

          {/* Brush species spotlight */}
          <RibbonGroup title="Active species">
            <button onClick={() => t.setTool('brush')}
              className="flex items-center gap-2 px-2 py-1.5 bg-white border border-slate-300 rounded hover:border-slate-500">
              <span className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-[11px]"
                style={{ backgroundColor: activeSp?.color }}>{activeSp?.idx}</span>
              <span className="text-left">
                <span className="block text-[12px] font-medium leading-tight">{activeSp?.commonName}</span>
                <span className="block text-[10px] italic text-slate-500 leading-tight">{activeSp?.scientificName}</span>
              </span>
            </button>
          </RibbonGroup>
        </div>

        {/* Active-tool subbar */}
        <ToolSubbar t={t} activeSp={activeSp} />
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Canvas */}
        <main className="flex-1 p-3 min-w-0 flex items-center justify-center bg-slate-200">
          <div className="w-full h-full">
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

        {/* Right panel: plant library + layers */}
        <aside className="w-72 bg-white border-l border-slate-300 overflow-y-auto">
          <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-700">Plant library</div>
          <div className="p-2 space-y-1">
            {state.species.map(sp => {
              const isActive = sp.idx === state.activeSpeciesIdx;
              const count = state.plants.filter(p => p.speciesIdx === sp.idx).length;
              return (
                <button key={sp.idx}
                  onClick={() => t.setActiveSpeciesIdx(sp.idx)}
                  className={`w-full flex items-center gap-2 p-2 rounded text-left text-[12px] border transition-all ${
                    isActive ? 'bg-amber-50 border-amber-400' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <span className="w-7 h-7 rounded flex items-center justify-center text-white font-bold text-[11px]"
                    style={{ backgroundColor: sp.color }}>{sp.idx}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{sp.commonName}</span>
                    <span className="block truncate text-[10px] italic text-slate-500">{sp.scientificName}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">×{count}</span>
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2 bg-slate-100 border-y border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-700">Layers</div>
          <div className="p-2 space-y-1">
            {(['structure', 'scatter', 'filler', 'matrix'] as LayerId[]).map(l => {
              const lc = state.layers[l];
              const count = state.plants.filter(p => state.species.find(s => s.idx === p.speciesIdx)?.layer === l).length;
              return (
                <div key={l} className="flex items-center gap-2 p-2 rounded border border-slate-200 bg-white">
                  <button onClick={() => t.toggleLayerVisible(l)} className="text-slate-500 hover:text-slate-900">
                    <span className="text-[12px]">{lc.visible ? '👁' : '⊘'}</span>
                  </button>
                  <button onClick={() => t.toggleLayerLocked(l)} className="text-slate-500 hover:text-slate-900">
                    <span className="text-[12px]">{lc.locked ? '🔒' : '🔓'}</span>
                  </button>
                  <span className={`flex-1 text-[12px] ${lc.visible ? 'text-slate-800' : 'text-slate-400'} ${lc.locked ? 'italic' : ''}`}>
                    {LAYER_LABELS[l].label}
                    <span className="block text-[10px] text-slate-500">{LAYER_LABELS[l].description}</span>
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">{count}</span>
                </div>
              );
            })}
          </div>

          {selectionCount > 0 && (
            <>
              <div className="px-3 py-2 bg-amber-50 border-y border-amber-200 text-[11px] font-bold uppercase tracking-wider text-amber-900">Selection · {selectionCount}</div>
              <div className="p-2 space-y-2">
                <p className="text-[11px] text-slate-600">
                  Switch to <strong>Drag-edit</strong> to drag the selection. Hold <kbd className="px-1 bg-slate-200 rounded text-[10px] font-mono">Shift</kbd> while clicking another plant to add to selection.
                </p>
                <div className="flex gap-1">
                  <button onClick={t.copySelection} className="flex-1 px-2 py-1 text-[11px] border border-slate-300 rounded hover:border-slate-500 bg-white">Copy</button>
                  <button onClick={t.deleteSelection} className="flex-1 px-2 py-1 text-[11px] border border-red-300 text-red-700 rounded hover:bg-red-50">Delete</button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Status bar */}
      <div className="bg-slate-800 text-slate-300 px-3 py-1 flex items-center gap-4 text-[11px]">
        <span>tool · <span className="text-amber-400 uppercase font-mono">{state.tool}</span></span>
        <span>{selectionCount > 0 ? `${selectionCount} selected` : `${totalPlants} plants`}</span>
        <span>brush · {activeSp?.commonName}</span>
        <span>stamp · {state.stampPattern}-up</span>
        <span className="ml-auto text-slate-500">
          shortcuts: V M L D B S E I · ⌘A all · ⌘C/V copy/paste · ⌫ delete
        </span>
      </div>
    </div>
  );
}

// ── Ribbon parts ──────────────────────────────────────────────────────────

function RibbonGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-1.5 flex flex-col items-center min-w-[120px]">
      <div className="flex items-center gap-1 flex-wrap justify-center">{children}</div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500 mt-1">{title}</div>
    </div>
  );
}

function RibbonButton({ btn, active, onClick }: { btn: RibbonBtnDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={btn.label}
      className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded border text-[10px] font-medium transition-all min-w-[50px] ${
        active
          ? 'bg-amber-500 border-amber-600 text-white'
          : 'bg-white border-slate-300 hover:border-slate-500 text-slate-700'
      }`}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d={btn.icon} />
      </svg>
      <span>{btn.label}</span>
    </button>
  );
}

// ── Tool subbar ───────────────────────────────────────────────────────────

function ToolSubbar({ t, activeSp }: { t: ReturnType<typeof useToolbarState>; activeSp: any }) {
  const { state } = t;
  if (state.tool === 'brush' || state.tool === 'stamp') {
    return (
      <div className="bg-amber-50 border-t border-amber-200 px-4 py-1.5 flex items-center gap-3 text-[11px]">
        <span className="text-amber-800 uppercase font-medium">{state.tool === 'stamp' ? 'Stamp' : 'Brush'}:</span>
        <span className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-amber-300">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: activeSp?.color }} />
          {activeSp?.commonName}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="text-amber-800 uppercase">Spacing:</span>
          <input type="range" min={12} max={40} value={state.brushSize}
            onChange={(e) => t.setBrushSize(parseInt(e.target.value))}
            className="accent-amber-500 w-32" />
          <span className="font-mono text-amber-800 w-7">{state.brushSize}</span>
        </label>
        <span className="ml-auto text-amber-700">Click on canvas to drop</span>
      </div>
    );
  }
  if (state.tool === 'drag') {
    return (
      <div className="bg-blue-50 border-t border-blue-200 px-4 py-1.5 text-[11px] text-blue-900">
        <strong className="uppercase">Drag-edit:</strong> Click+drag a selected plant to move the whole selection. {state.selectedIds.size === 0 && '(Make a selection first.)'}
      </div>
    );
  }
  if (state.tool === 'erase') {
    return (
      <div className="bg-red-50 border-t border-red-200 px-4 py-1.5 text-[11px] text-red-900">
        <strong className="uppercase">Erase:</strong> Click any plant to remove. Locked layers are protected.
      </div>
    );
  }
  if (state.tool === 'eyedropper') {
    return (
      <div className="bg-violet-50 border-t border-violet-200 px-4 py-1.5 text-[11px] text-violet-900">
        <strong className="uppercase">Eyedropper:</strong> Click any plant to set it as the active species, then auto-switch to Brush.
      </div>
    );
  }
  return (
    <div className="bg-slate-50 border-t border-slate-200 px-4 py-1.5 text-[11px] text-slate-600">
      <strong className="uppercase">{state.tool}:</strong> Click to select · Shift-click to add · Alt-click to subtract · Drag for {state.tool === 'lasso' ? 'lasso' : 'marquee'}
    </div>
  );
}
