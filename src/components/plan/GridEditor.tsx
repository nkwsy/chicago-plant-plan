'use client';

import { useState, useRef, useCallback } from 'react';
import type { ExclusionZone, ExistingTree } from '@/types/plan';

interface GridEditorProps {
  widthFt: number;
  heightFt: number;
  centerLat: number;
  centerLng: number;
  exclusionZones: ExclusionZone[];
  existingTrees: ExistingTree[];
  onExclusionZonesChange: (zones: ExclusionZone[]) => void;
  onExistingTreesChange: (trees: ExistingTree[]) => void;
}

type Tool = 'select' | 'path' | 'tree';

const GRID_SPACING_FT = 2;
const PX_PER_FT = 24;
const TREE_SIZES = [
  { label: 'Small', diameterFt: 10 },
  { label: 'Medium', diameterFt: 20 },
  { label: 'Large', diameterFt: 30 },
];

export default function GridEditor({
  widthFt, heightFt, centerLat, centerLng,
  exclusionZones, existingTrees,
  onExclusionZonesChange, onExistingTreesChange,
}: GridEditorProps) {
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [treeSize, setTreeSize] = useState(20);
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [pathLabel, setPathLabel] = useState('');
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [pendingPath, setPendingPath] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const svgWidth = widthFt * PX_PER_FT;
  const svgHeight = heightFt * PX_PER_FT;

  const pxToFt = (px: number) => px / PX_PER_FT;
  const ftToPx = (ft: number) => ft * PX_PER_FT;

  // ── Satellite background ──────────────────────────────────────────────────
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const metersPerFt = 0.3048;
  const latPerFt = metersPerFt / 111320;
  const lngPerFt = metersPerFt / (111320 * Math.cos(centerLat * Math.PI / 180));
  const minLat = centerLat - (heightFt / 2) * latPerFt;
  const maxLat = centerLat + (heightFt / 2) * latPerFt;
  const minLng = centerLng - (widthFt / 2) * lngPerFt;
  const maxLng = centerLng + (widthFt / 2) * lngPerFt;

  const satImgW = Math.min(1280, Math.round(svgWidth));
  const satImgH = Math.min(1280, Math.round(svgHeight));
  const satelliteUrl = MAPBOX_TOKEN && centerLat !== 0
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/[${minLng},${minLat},${maxLng},${maxLat}]/${satImgW}x${satImgH}@2x?access_token=${MAPBOX_TOKEN}&padding=0`
    : null;

  const ftToLatLng = useCallback((xFt: number, yFt: number) => {
    const dLng = ((xFt - widthFt / 2) * metersPerFt) / (111320 * Math.cos(centerLat * Math.PI / 180));
    const dLat = -((yFt - heightFt / 2) * metersPerFt) / 111320;
    return { lat: centerLat + dLat, lng: centerLng + dLng };
  }, [widthFt, heightFt, centerLat, centerLng]);

  function getSVGPoint(e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * svgWidth,
      y: ((e.clientY - rect.top) / rect.height) * svgHeight,
    };
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (activeTool === 'path') {
      const pt = getSVGPoint(e);
      const snappedX = Math.round(pt.x / ftToPx(GRID_SPACING_FT)) * ftToPx(GRID_SPACING_FT);
      const snappedY = Math.round(pt.y / ftToPx(GRID_SPACING_FT)) * ftToPx(GRID_SPACING_FT);
      setDrawStart({ x: snappedX, y: snappedY });
      setDrawCurrent({ x: snappedX, y: snappedY });
      setDrawing(true);
    } else if (activeTool === 'tree') {
      const pt = getSVGPoint(e);
      const xFt = pxToFt(pt.x);
      const yFt = pxToFt(pt.y);
      const { lat, lng } = ftToLatLng(xFt, yFt);
      const newTree: ExistingTree = {
        id: `tree-${Date.now()}`,
        lat, lng,
        canopyDiameterFt: treeSize,
        label: 'Existing Tree',
      };
      (newTree as any).gridXFt = xFt;
      (newTree as any).gridYFt = yFt;
      onExistingTreesChange([...existingTrees, newTree]);
    }
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (drawing && activeTool === 'path') {
      const pt = getSVGPoint(e);
      const snappedX = Math.round(pt.x / ftToPx(GRID_SPACING_FT)) * ftToPx(GRID_SPACING_FT);
      const snappedY = Math.round(pt.y / ftToPx(GRID_SPACING_FT)) * ftToPx(GRID_SPACING_FT);
      setDrawCurrent({ x: snappedX, y: snappedY });
    }
  }

  function handleMouseUp() {
    if (drawing && drawStart && drawCurrent && activeTool === 'path') {
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      if (w > ftToPx(1) && h > ftToPx(1)) {
        setPendingPath({ x, y, w, h });
        setPathLabel('');
        setShowLabelInput(true);
      }
      setDrawing(false);
      setDrawStart(null);
      setDrawCurrent(null);
    }
  }

  function confirmPath() {
    if (!pendingPath) return;
    const { x, y, w, h } = pendingPath;
    const xFt = pxToFt(x);
    const yFt = pxToFt(y);
    const wFt = pxToFt(w);
    const hFt = pxToFt(h);

    const tl = ftToLatLng(xFt, yFt);
    const tr = ftToLatLng(xFt + wFt, yFt);
    const br = ftToLatLng(xFt + wFt, yFt + hFt);
    const bl = ftToLatLng(xFt, yFt + hFt);

    const zone: ExclusionZone = {
      id: `excl-${Date.now()}`,
      geoJson: {
        type: 'Polygon',
        coordinates: [[
          [tl.lng, tl.lat], [tr.lng, tr.lat], [br.lng, br.lat], [bl.lng, bl.lat], [tl.lng, tl.lat],
        ]],
      },
      label: pathLabel || 'Path',
      type: 'walkway',
    };
    (zone as any).gridRect = { xFt, yFt, wFt, hFt };

    onExclusionZonesChange([...exclusionZones, zone]);
    setShowLabelInput(false);
    setPendingPath(null);
  }

  function removeZone(id: string) {
    onExclusionZonesChange(exclusionZones.filter(z => z.id !== id));
  }

  function removeTree(id: string) {
    onExistingTreesChange(existingTrees.filter(t => t.id !== id));
  }

  // Grid lines — styled for satellite background
  const hasSat = !!satelliteUrl;
  const gridLines: React.ReactElement[] = [];
  for (let x = 0; x <= widthFt; x += GRID_SPACING_FT) {
    const major = x % 10 === 0;
    gridLines.push(
      <line key={`v${x}`} x1={ftToPx(x)} y1={0} x2={ftToPx(x)} y2={svgHeight}
        stroke={hasSat ? 'rgba(255,255,255,0.3)' : '#e5e7eb'}
        strokeWidth={major ? 1.5 : 0.5}
        strokeOpacity={hasSat ? (major ? 0.5 : 0.2) : 1} />
    );
  }
  for (let y = 0; y <= heightFt; y += GRID_SPACING_FT) {
    const major = y % 10 === 0;
    gridLines.push(
      <line key={`h${y}`} x1={0} y1={ftToPx(y)} x2={svgWidth} y2={ftToPx(y)}
        stroke={hasSat ? 'rgba(255,255,255,0.3)' : '#e5e7eb'}
        strokeWidth={major ? 1.5 : 0.5}
        strokeOpacity={hasSat ? (major ? 0.5 : 0.2) : 1} />
    );
  }

  const labelFill = hasSat ? 'white' : '#9ca3af';
  const labelStroke = hasSat ? 'rgba(0,0,0,0.5)' : 'none';
  const labelStrokeW = hasSat ? '2.5' : '0';

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setActiveTool('select')}
          className={`px-3 py-2 text-sm rounded-lg border flex items-center gap-2 transition-all ${
            activeTool === 'select' ? 'bg-primary text-white border-primary' : 'border-stone-300 hover:bg-stone-50'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
          Select
        </button>
        <button onClick={() => setActiveTool('path')}
          className={`px-3 py-2 text-sm rounded-lg border flex items-center gap-2 transition-all ${
            activeTool === 'path' ? 'bg-gray-700 text-white border-gray-700' : 'border-stone-300 hover:bg-stone-50'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          Draw Path / Patio
        </button>
        <button onClick={() => setActiveTool('tree')}
          className={`px-3 py-2 text-sm rounded-lg border flex items-center gap-2 transition-all ${
            activeTool === 'tree' ? 'bg-green-700 text-white border-green-700' : 'border-stone-300 hover:bg-stone-50'}`}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22V8M12 8C12 8 8 4 5 6C2 8 4 12 7 12C9 12 12 8 12 8ZM12 8C12 8 16 4 19 6C22 8 20 12 17 12C15 12 12 8 12 8Z" /></svg>
          Place Tree
        </button>

        {activeTool === 'tree' && (
          <select value={treeSize} onChange={e => setTreeSize(parseInt(e.target.value))}
            className="px-2 py-2 border border-stone-300 rounded-lg text-sm bg-white">
            {TREE_SIZES.map(s => (
              <option key={s.diameterFt} value={s.diameterFt}>{s.label} ({s.diameterFt}ft canopy)</option>
            ))}
          </select>
        )}
      </div>

      {/* Hint text */}
      <div className="text-xs text-muted mb-2">
        {activeTool === 'path' && 'Click and drag to draw a rectangular path or patio area.'}
        {activeTool === 'tree' && 'Click to place an existing tree. You can see them on the satellite image.'}
        {activeTool === 'select' && 'Click items to remove them. Use the tools above to add features.'}
      </div>

      {/* SVG Grid with satellite background */}
      <div className="border border-stone-300 rounded-xl overflow-hidden bg-white relative shadow-sm" style={{ maxWidth: '100%', overflowX: 'auto' }}>
        {/* Dimension labels */}
        <div className={`absolute top-0 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs font-medium z-10 rounded-b ${hasSat ? 'bg-black/50 text-white' : 'bg-white text-muted'}`}>
          {widthFt} ft
        </div>
        <div className={`absolute top-1/2 right-0 -translate-y-1/2 px-2 py-0.5 text-xs font-medium z-10 rounded-l ${hasSat ? 'bg-black/50 text-white' : 'bg-white text-muted'}`} style={{ writingMode: 'vertical-lr' }}>
          {heightFt} ft
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full"
          style={{ maxHeight: '500px', cursor: activeTool === 'path' ? 'crosshair' : activeTool === 'tree' ? 'pointer' : 'default' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { if (drawing) handleMouseUp(); }}
        >
          {/* Background: satellite or plain */}
          {satelliteUrl ? (
            <image href={satelliteUrl} x={0} y={0} width={svgWidth} height={svgHeight}
              preserveAspectRatio="xMidYMid slice" />
          ) : (
            <rect width={svgWidth} height={svgHeight} fill="#f0fdf4" />
          )}

          {/* Grid lines */}
          {gridLines}

          {/* Ft labels on edges */}
          {Array.from({ length: Math.floor(widthFt / 5) + 1 }).map((_, i) => (
            <text key={`xl${i}`} x={ftToPx(i * 5)} y={svgHeight - 4} fontSize="10"
              fill={labelFill} textAnchor="middle"
              stroke={labelStroke} strokeWidth={labelStrokeW} paintOrder="stroke">
              {i * 5}&apos;
            </text>
          ))}
          {Array.from({ length: Math.floor(heightFt / 5) + 1 }).map((_, i) => (
            <text key={`yl${i}`} x={4} y={ftToPx(i * 5)} fontSize="10"
              fill={labelFill} dominantBaseline="middle"
              stroke={labelStroke} strokeWidth={labelStrokeW} paintOrder="stroke">
              {i * 5}&apos;
            </text>
          ))}

          {/* Exclusion zones */}
          {exclusionZones.map(z => {
            const rect = (z as any).gridRect;
            if (!rect) return null;
            return (
              <g key={z.id} onClick={() => activeTool === 'select' && removeZone(z.id)} style={{ cursor: activeTool === 'select' ? 'pointer' : 'default' }}>
                <rect x={ftToPx(rect.xFt)} y={ftToPx(rect.yFt)} width={ftToPx(rect.wFt)} height={ftToPx(rect.hFt)}
                  fill={hasSat ? 'rgba(100,116,139,0.4)' : '#9ca3af'}
                  fillOpacity={hasSat ? 0.4 : 0.3}
                  stroke={hasSat ? 'rgba(255,255,255,0.7)' : '#6b7280'}
                  strokeWidth={2} strokeDasharray="8,4" rx={4} />
                <text x={ftToPx(rect.xFt + rect.wFt / 2)} y={ftToPx(rect.yFt + rect.hFt / 2)}
                  textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="500"
                  fill={hasSat ? 'white' : '#374151'}
                  stroke={hasSat ? 'rgba(0,0,0,0.5)' : 'none'} strokeWidth={hasSat ? '2.5' : '0'} paintOrder="stroke">
                  {z.label}
                </text>
              </g>
            );
          })}

          {/* Existing trees */}
          {existingTrees.map(t => {
            const xFt = (t as any).gridXFt ?? widthFt / 2;
            const yFt = (t as any).gridYFt ?? heightFt / 2;
            const radiusPx = ftToPx(t.canopyDiameterFt / 2);
            return (
              <g key={t.id} onClick={() => activeTool === 'select' && removeTree(t.id)} style={{ cursor: activeTool === 'select' ? 'pointer' : 'default' }}>
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={radiusPx}
                  fill="#166534" fillOpacity={0.2} stroke={hasSat ? 'rgba(255,255,255,0.6)' : '#166534'} strokeWidth={2} strokeOpacity={0.6} />
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={6}
                  fill="#78350f" stroke="white" strokeWidth={2} />
                <text x={ftToPx(xFt)} y={ftToPx(yFt) - radiusPx - 6}
                  textAnchor="middle" fontSize="11" fontWeight="500"
                  fill={hasSat ? 'white' : '#166534'}
                  stroke={hasSat ? 'rgba(0,0,0,0.5)' : 'white'} strokeWidth="2.5" paintOrder="stroke">
                  {t.label} ({t.canopyDiameterFt}ft)
                </text>
              </g>
            );
          })}

          {/* Drawing preview */}
          {drawing && drawStart && drawCurrent && activeTool === 'path' && (
            <rect
              x={Math.min(drawStart.x, drawCurrent.x)}
              y={Math.min(drawStart.y, drawCurrent.y)}
              width={Math.abs(drawCurrent.x - drawStart.x)}
              height={Math.abs(drawCurrent.y - drawStart.y)}
              fill={hasSat ? 'rgba(100,116,139,0.3)' : '#9ca3af'}
              fillOpacity={hasSat ? 0.3 : 0.2}
              stroke={hasSat ? 'rgba(255,255,255,0.7)' : '#6b7280'}
              strokeWidth={2} strokeDasharray="8,4" rx={4}
            />
          )}

          {/* North arrow */}
          <g transform={`translate(${svgWidth - 30}, 30)`}>
            <circle r={16} fill="rgba(15,23,42,0.55)" />
            <polygon points="0,-11 3.5,2 -3.5,2" fill="white" />
            <text x={0} y={12} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">N</text>
          </g>
        </svg>
      </div>

      {/* Label input modal */}
      {showLabelInput && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={pathLabel}
            onChange={e => setPathLabel(e.target.value)}
            placeholder="Label (e.g. Sidewalk, Patio)"
            className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm outline-none focus:border-primary"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && confirmPath()}
          />
          <button onClick={confirmPath} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium">
            Add
          </button>
          <button onClick={() => { setShowLabelInput(false); setPendingPath(null); }}
            className="px-3 py-2 border border-stone-300 rounded-lg text-sm">
            Cancel
          </button>
        </div>
      )}

      {/* Items list */}
      {(exclusionZones.length > 0 || existingTrees.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {exclusionZones.map(z => (
            <div key={z.id} className="flex items-center gap-1.5 bg-gray-100 px-2.5 py-1 rounded-lg text-xs">
              <div className="w-3 h-3 bg-gray-400 rounded-sm" />
              <span>{z.label}</span>
              <button onClick={() => removeZone(z.id)} className="text-gray-400 hover:text-red-500 ml-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          {existingTrees.map(t => (
            <div key={t.id} className="flex items-center gap-1.5 bg-green-50 px-2.5 py-1 rounded-lg text-xs">
              <div className="w-3 h-3 bg-green-600 rounded-full" />
              <span>{t.label} ({t.canopyDiameterFt}ft)</span>
              <button onClick={() => removeTree(t.id)} className="text-green-400 hover:text-red-500 ml-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
