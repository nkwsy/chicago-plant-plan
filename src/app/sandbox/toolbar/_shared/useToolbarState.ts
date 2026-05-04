'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Plant, Species, Tool, StampPattern, ToolbarState, LayerId } from './types';
import { SPECIES, INITIAL_PLANTS, DEFAULT_LAYERS } from './mockData';

/** Stamp offsets in unit-circle space (multiplied by stampSpacing px when
 *  emitting plants). Mirrors src/app/plan/new helpers but local so the
 *  sandbox doesn't reach into production code. */
export function stampOffsets(p: StampPattern): { dx: number; dy: number }[] {
  if (p === 1) return [{ dx: 0, dy: 0 }];
  if (p === 3) return [0, 120, 240].map(deg => {
    const r = deg * Math.PI / 180;
    return { dx: Math.sin(r), dy: -Math.cos(r) };
  });
  if (p === 5) return [
    { dx: 0, dy: 0 },
    { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
  ];
  const out: { dx: number; dy: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push({ dx, dy });
  return out;
}

/** Single source-of-truth hook for the sandbox toolbars. Returns the current
 *  state plus a flat set of action callbacks. Both variants consume this
 *  hook so the only difference between them is JSX chrome. */
export function useToolbarState() {
  const [state, setState] = useState<ToolbarState>({
    tool: 'move',
    activeSpeciesIdx: 6, // Purple Coneflower — easy to spot
    stampPattern: 1,
    brushSize: 22,
    plants: INITIAL_PLANTS,
    species: SPECIES,
    layers: DEFAULT_LAYERS,
    selectedIds: new Set(),
    clipboard: null,
    hasUsed: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Helpers
  const speciesById = useCallback((idx: number): Species | undefined => state.species.find(s => s.idx === idx), [state.species]);
  const plantById = useCallback((id: string) => state.plants.find(p => p.id === id), [state.plants]);

  // ── Tool actions (each returns a state-mutating callback) ──────────────

  const setTool = useCallback((tool: Tool) => setState(s => ({ ...s, tool, hasUsed: true })), []);
  const setActiveSpeciesIdx = useCallback((idx: number) => setState(s => ({ ...s, activeSpeciesIdx: idx })), []);
  const setStampPattern = useCallback((pattern: StampPattern) => setState(s => ({ ...s, stampPattern: pattern })), []);
  const setBrushSize = useCallback((px: number) => setState(s => ({ ...s, brushSize: px })), []);

  /** Click a plant (if any) or empty canvas — dispatched by the Canvas. */
  const clickPlant = useCallback((plantId: string, mods: { shift: boolean; alt: boolean }) => {
    setState(s => {
      const tool = s.tool;
      const plant = s.plants.find(p => p.id === plantId);
      if (!plant) return s;
      const layer = s.species.find(sp => sp.idx === plant.speciesIdx)?.layer;
      if (layer && s.layers[layer].locked) return s; // can't touch locked layer

      // Erase tool: remove regardless of selection
      if (tool === 'erase') {
        const sel = new Set(s.selectedIds); sel.delete(plantId);
        return { ...s, plants: s.plants.filter(p => p.id !== plantId), selectedIds: sel, hasUsed: true };
      }

      // Eyedropper: copy species
      if (tool === 'eyedropper') {
        return { ...s, activeSpeciesIdx: plant.speciesIdx, tool: 'brush', hasUsed: true };
      }

      // Brush/Stamp: clicking an existing plant adds at its position too
      // (treat plant clicks the same as canvas clicks in those modes —
      //  user expects to be able to paint over).
      if (tool === 'brush' || tool === 'stamp') {
        return paintAt(s, plant.x, plant.y);
      }

      // Default selection behavior: shift toggles, alt subtracts, plain click replaces
      const sel = new Set(s.selectedIds);
      if (mods.alt) sel.delete(plantId);
      else if (mods.shift) {
        if (sel.has(plantId)) sel.delete(plantId);
        else sel.add(plantId);
      } else {
        sel.clear(); sel.add(plantId);
      }
      return { ...s, selectedIds: sel, hasUsed: true };
    });
  }, []);

  /** Click empty canvas — semantics depend on the active tool. */
  const clickCanvas = useCallback((x: number, y: number, mods: { shift: boolean }) => {
    setState(s => {
      if (s.tool === 'brush' || s.tool === 'stamp') return paintAt(s, x, y);
      // Move/marquee/lasso: empty click clears selection (unless shift held).
      if (!mods.shift && s.selectedIds.size > 0) {
        return { ...s, selectedIds: new Set(), hasUsed: true };
      }
      return s;
    });
  }, []);

  /** Marquee/lasso completes — replace or extend selection with the hit set. */
  const completeRectSelect = useCallback((bounds: { x1: number; y1: number; x2: number; y2: number }, mods: { shift: boolean; alt: boolean }) => {
    setState(s => {
      const minX = Math.min(bounds.x1, bounds.x2);
      const maxX = Math.max(bounds.x1, bounds.x2);
      const minY = Math.min(bounds.y1, bounds.y2);
      const maxY = Math.max(bounds.y1, bounds.y2);
      const inside = s.plants.filter(p => {
        const sp = s.species.find(x => x.idx === p.speciesIdx);
        if (!sp || !s.layers[sp.layer].visible || s.layers[sp.layer].locked) return false;
        return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
      });
      const sel = new Set(mods.shift || mods.alt ? s.selectedIds : []);
      for (const p of inside) {
        if (mods.alt) sel.delete(p.id);
        else sel.add(p.id);
      }
      return { ...s, selectedIds: sel, hasUsed: true };
    });
  }, []);

  const completeLassoSelect = useCallback((points: { x: number; y: number }[], mods: { shift: boolean; alt: boolean }) => {
    setState(s => {
      const inside = s.plants.filter(p => {
        const sp = s.species.find(x => x.idx === p.speciesIdx);
        if (!sp || !s.layers[sp.layer].visible || s.layers[sp.layer].locked) return false;
        return pointInPolygon(p.x, p.y, points);
      });
      const sel = new Set(mods.shift || mods.alt ? s.selectedIds : []);
      for (const p of inside) {
        if (mods.alt) sel.delete(p.id);
        else sel.add(p.id);
      }
      return { ...s, selectedIds: sel, hasUsed: true };
    });
  }, []);

  /** Drag-edit: move every selected plant by (dx, dy) px. Called on mouseup
   *  after the user drags with the Drag tool active. */
  const moveSelection = useCallback((dx: number, dy: number) => {
    setState(s => {
      if (!s.selectedIds.size || (dx === 0 && dy === 0)) return s;
      return {
        ...s,
        plants: s.plants.map(p => s.selectedIds.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p),
        hasUsed: true,
      };
    });
  }, []);

  // ── Layers
  const toggleLayerVisible = useCallback((layer: LayerId) => {
    setState(s => ({ ...s, layers: { ...s.layers, [layer]: { ...s.layers[layer], visible: !s.layers[layer].visible } } }));
  }, []);
  const toggleLayerLocked = useCallback((layer: LayerId) => {
    setState(s => ({ ...s, layers: { ...s.layers, [layer]: { ...s.layers[layer], locked: !s.layers[layer].locked } } }));
  }, []);

  // ── Selection ops
  const selectAll = useCallback(() => {
    setState(s => ({
      ...s,
      selectedIds: new Set(s.plants
        .filter(p => {
          const sp = s.species.find(x => x.idx === p.speciesIdx);
          return sp && s.layers[sp.layer].visible && !s.layers[sp.layer].locked;
        })
        .map(p => p.id)),
      hasUsed: true,
    }));
  }, []);
  const deselect = useCallback(() => setState(s => ({ ...s, selectedIds: new Set() })), []);
  const deleteSelection = useCallback(() => {
    setState(s => {
      if (!s.selectedIds.size) return s;
      return { ...s, plants: s.plants.filter(p => !s.selectedIds.has(p.id)), selectedIds: new Set(), hasUsed: true };
    });
  }, []);

  const copySelection = useCallback(() => {
    setState(s => {
      if (!s.selectedIds.size) return s;
      const sel = s.plants.filter(p => s.selectedIds.has(p.id));
      const cx = sel.reduce((a, p) => a + p.x, 0) / sel.length;
      const cy = sel.reduce((a, p) => a + p.y, 0) / sel.length;
      return { ...s, clipboard: sel.map(p => ({ x: p.x - cx, y: p.y - cy, speciesIdx: p.speciesIdx })) };
    });
  }, []);

  const pasteAt = useCallback((x: number, y: number) => {
    setState(s => {
      if (!s.clipboard) return s;
      const newPlants: Plant[] = s.clipboard.map((c, i) => ({
        id: `pst-${Date.now()}-${i}`,
        speciesIdx: c.speciesIdx,
        x: x + c.x,
        y: y + c.y,
      }));
      return { ...s, plants: [...s.plants, ...newPlants], hasUsed: true };
    });
  }, []);

  // ── Keyboard shortcuts (V/M/L/D/B/S/E/I, Ctrl+A, Ctrl+C/V, Delete, Esc)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore typing in inputs/textareas
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); return; }
      if (cmd && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
      if (cmd && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteAt(400, 250); return; }
      if (cmd && e.key.toLowerCase() === 'd') { e.preventDefault(); deselect(); return; }
      if (cmd) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
      if (e.key === 'Escape') { deselect(); return; }
      const map: Record<string, Tool> = { v: 'move', m: 'marquee', l: 'lasso', d: 'drag', b: 'brush', s: 'stamp', e: 'erase', i: 'eyedropper' };
      const tool = map[e.key.toLowerCase()];
      if (tool) setTool(tool);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectAll, copySelection, pasteAt, deselect, deleteSelection, setTool]);

  return {
    state,
    setState,
    speciesById, plantById,
    setTool, setActiveSpeciesIdx, setStampPattern, setBrushSize,
    clickPlant, clickCanvas, completeRectSelect, completeLassoSelect, moveSelection,
    toggleLayerVisible, toggleLayerLocked,
    selectAll, deselect, deleteSelection, copySelection, pasteAt,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────

function paintAt(s: ToolbarState, x: number, y: number): ToolbarState {
  const sp = s.species.find(x => x.idx === s.activeSpeciesIdx);
  if (!sp) return s;
  if (s.layers[sp.layer].locked) return s;
  const offsets = stampOffsets(s.tool === 'stamp' ? s.stampPattern : 1);
  const step = s.brushSize * 1.4;
  const newPlants: Plant[] = offsets.map((off, i) => ({
    id: `pt-${Date.now()}-${i}`,
    speciesIdx: s.activeSpeciesIdx,
    x: x + off.dx * step,
    y: y + off.dy * step,
  }));
  return { ...s, plants: [...s.plants, ...newPlants], hasUsed: true };
}

function pointInPolygon(x: number, y: number, points: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
