'use client';

import { useRef, useState } from 'react';
import type { ToolbarState } from './types';
import { CANVAS } from './mockData';
import { stampOffsets } from './useToolbarState';

interface CanvasProps {
  state: ToolbarState;
  onClickPlant: (id: string, mods: { shift: boolean; alt: boolean }) => void;
  onClickCanvas: (x: number, y: number, mods: { shift: boolean }) => void;
  onCompleteRectSelect: (b: { x1: number; y1: number; x2: number; y2: number }, mods: { shift: boolean; alt: boolean }) => void;
  onCompleteLassoSelect: (pts: { x: number; y: number }[], mods: { shift: boolean; alt: boolean }) => void;
  onMoveSelection: (dx: number, dy: number) => void;
  onPasteAt: (x: number, y: number) => void;
}

interface DragState {
  kind: 'marquee' | 'lasso' | 'drag-edit';
  start: { x: number; y: number };
  current: { x: number; y: number };
  shift: boolean;
  alt: boolean;
  // Lasso path
  points?: { x: number; y: number }[];
}

/** SVG-rendered planting bed with all the selection / paint / drag interactions
 *  the toolbar variants exercise. Pure presentational: state lives in the
 *  parent (variant page) and is fed in via props. */
export default function Canvas(props: CanvasProps) {
  const { state, onClickPlant, onClickCanvas, onCompleteRectSelect, onCompleteLassoSelect, onMoveSelection, onPasteAt } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  // Track whether a mousedown turned into a drag — used to decide between
  // click-vs-drag on mouseup. Helps Move tool feel right.
  const dragMovedRef = useRef(false);

  function svgPoint(e: React.MouseEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS.w,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS.h,
    };
  }

  function onMouseDown(e: React.MouseEvent) {
    const pt = svgPoint(e);
    dragMovedRef.current = false;

    if (state.tool === 'lasso') {
      setDrag({ kind: 'lasso', start: pt, current: pt, shift: e.shiftKey, alt: e.altKey, points: [pt] });
      return;
    }

    if (state.tool === 'drag') {
      // Only drags selected plants. If user clicked an unselected plant first,
      // treat the click as a select (one plant) and immediately arm drag.
      const target = e.target as Element;
      const id = target.getAttribute('data-plant-id');
      if (id && !state.selectedIds.has(id)) {
        // Replace selection with this plant first.
        onClickPlant(id, { shift: false, alt: false });
      } else if (!state.selectedIds.size) {
        return; // nothing to drag
      }
      setDrag({ kind: 'drag-edit', start: pt, current: pt, shift: e.shiftKey, alt: e.altKey });
      return;
    }

    // Move/Marquee: start a marquee on canvas mousedown UNLESS we hit a plant
    if (state.tool === 'move' || state.tool === 'marquee') {
      const target = e.target as Element;
      const id = target.getAttribute('data-plant-id');
      if (state.tool === 'move' && id) return; // plant click is handled separately
      setDrag({ kind: 'marquee', start: pt, current: pt, shift: e.shiftKey, alt: e.altKey });
      return;
    }
  }

  function onMouseMove(e: React.MouseEvent) {
    const pt = svgPoint(e);
    setHoverPos(pt);
    if (!drag) return;
    dragMovedRef.current = true;
    setDrag(d => d ? {
      ...d,
      current: pt,
      points: d.kind === 'lasso' && d.points ? [...d.points, pt] : d.points,
    } : d);
  }

  function onMouseUp(e: React.MouseEvent) {
    if (!drag) return;
    const mods = { shift: drag.shift, alt: drag.alt };

    if (drag.kind === 'marquee') {
      const dx = drag.current.x - drag.start.x;
      const dy = drag.current.y - drag.start.y;
      // Tiny drags = treat as click on canvas
      if (dx * dx + dy * dy < 16) {
        onClickCanvas(drag.start.x, drag.start.y, { shift: drag.shift });
      } else {
        onCompleteRectSelect({ x1: drag.start.x, y1: drag.start.y, x2: drag.current.x, y2: drag.current.y }, mods);
      }
    } else if (drag.kind === 'lasso') {
      if ((drag.points?.length ?? 0) > 4) {
        onCompleteLassoSelect(drag.points!, mods);
      }
    } else if (drag.kind === 'drag-edit') {
      const dx = drag.current.x - drag.start.x;
      const dy = drag.current.y - drag.start.y;
      onMoveSelection(dx, dy);
    }
    setDrag(null);
  }

  function onPlantClick(e: React.MouseEvent<SVGCircleElement>, id: string) {
    if (drag) return; // drag in progress will be handled by mouseup
    if (state.tool === 'drag') return; // drag tool handles it via mousedown
    e.stopPropagation();
    onClickPlant(id, { shift: e.shiftKey, alt: e.altKey });
  }

  // Layer-aware visibility filter
  const visiblePlants = state.plants.filter(p => {
    const sp = state.species.find(s => s.idx === p.speciesIdx);
    return sp && state.layers[sp.layer].visible;
  });

  // Active species color — used for brush-cursor halo + stamp preview
  const activeSp = state.species.find(s => s.idx === state.activeSpeciesIdx);

  // Cursor style by tool
  const cursor: Record<string, string> = {
    move: 'default', marquee: 'crosshair', lasso: 'crosshair',
    drag: 'move', brush: 'crosshair', stamp: 'crosshair',
    erase: 'not-allowed', eyedropper: 'pointer',
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full bg-stone-100 rounded-lg"
      style={{ cursor: cursor[state.tool] }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => { setDrag(null); setHoverPos(null); }}
    >
      {/* Bed background — soil texture-ish hatch */}
      <defs>
        <pattern id="soil" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#f0e7d8" />
          <circle cx="2" cy="2" r="0.5" fill="#dcd0b8" />
          <circle cx="4" cy="4" r="0.5" fill="#dcd0b8" />
        </pattern>
      </defs>
      <rect x={CANVAS.padding} y={CANVAS.padding}
        width={CANVAS.w - CANVAS.padding * 2} height={CANVAS.h - CANVAS.padding * 2}
        fill="url(#soil)" stroke="#8b6f47" strokeWidth={2} strokeDasharray="6,4" rx={6} />

      {/* Grid */}
      <g stroke="rgba(139,111,71,0.08)" strokeWidth={0.5}>
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={`gx${i}`} x1={CANVAS.padding + i * 90} y1={CANVAS.padding}
            x2={CANVAS.padding + i * 90} y2={CANVAS.h - CANVAS.padding} />
        ))}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`gy${i}`} x1={CANVAS.padding} y1={CANVAS.padding + i * 84}
            x2={CANVAS.w - CANVAS.padding} y2={CANVAS.padding + i * 84} />
        ))}
      </g>

      {/* Plants */}
      {visiblePlants.map(p => {
        const sp = state.species.find(s => s.idx === p.speciesIdx);
        if (!sp) return null;
        const isSelected = state.selectedIds.has(p.id);
        const layerLocked = state.layers[sp.layer].locked;
        // While dragging the drag-edit tool, show selected plants offset live
        const offset = (drag?.kind === 'drag-edit' && isSelected) ? {
          dx: drag.current.x - drag.start.x,
          dy: drag.current.y - drag.start.y,
        } : { dx: 0, dy: 0 };
        const cx = p.x + offset.dx;
        const cy = p.y + offset.dy;
        return (
          <g key={p.id}>
            {isSelected && (
              <circle cx={cx} cy={cy} r={14} fill="none" stroke="#1d4ed8" strokeWidth={2.5} strokeDasharray="3,2" opacity={0.85} />
            )}
            <circle
              data-plant-id={p.id}
              cx={cx} cy={cy} r={9}
              fill={sp.color}
              fillOpacity={layerLocked ? 0.4 : 0.92}
              stroke="white" strokeWidth={1.5}
              onClick={(e) => onPlantClick(e, p.id)}
              style={{ cursor: layerLocked ? 'not-allowed' : cursor[state.tool] }}
            />
            <text data-plant-id={p.id}
              x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="central"
              fontSize="9" fontWeight={700} fill="white"
              stroke="rgba(0,0,0,0.4)" strokeWidth={1.4} paintOrder="stroke"
              style={{ pointerEvents: 'none' }}>
              {sp.idx}
            </text>
          </g>
        );
      })}

      {/* Brush/stamp ghost cursor */}
      {hoverPos && (state.tool === 'brush' || state.tool === 'stamp') && activeSp && (
        <g pointerEvents="none">
          {stampOffsets(state.tool === 'stamp' ? state.stampPattern : 1).map((off, i) => (
            <circle key={i}
              cx={hoverPos.x + off.dx * state.brushSize * 1.4}
              cy={hoverPos.y + off.dy * state.brushSize * 1.4}
              r={9}
              fill={activeSp.color} fillOpacity={0.45}
              stroke="white" strokeWidth={1.5} strokeDasharray="2,2" />
          ))}
        </g>
      )}

      {/* Marquee box */}
      {drag?.kind === 'marquee' && (
        <rect
          x={Math.min(drag.start.x, drag.current.x)}
          y={Math.min(drag.start.y, drag.current.y)}
          width={Math.abs(drag.current.x - drag.start.x)}
          height={Math.abs(drag.current.y - drag.start.y)}
          fill="rgba(29, 78, 216, 0.12)" stroke="#1d4ed8" strokeWidth={1.5} strokeDasharray="4,3"
          pointerEvents="none"
        />
      )}

      {/* Lasso path */}
      {drag?.kind === 'lasso' && drag.points && (
        <polyline
          points={drag.points.map(p => `${p.x},${p.y}`).join(' ')}
          fill="rgba(29, 78, 216, 0.10)" stroke="#1d4ed8" strokeWidth={1.5} strokeDasharray="4,3"
          pointerEvents="none"
        />
      )}

      {/* Bed label */}
      <text x={CANVAS.w - CANVAS.padding - 6} y={CANVAS.h - CANVAS.padding - 6}
        textAnchor="end" fontSize="11" fill="#8b6f47" opacity={0.8}>
        16 ft × 10 ft demo bed
      </text>
    </svg>
  );
}
