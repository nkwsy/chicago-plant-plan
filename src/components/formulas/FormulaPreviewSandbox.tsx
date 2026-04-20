'use client';

/**
 * FormulaPreviewSandbox — live SVG renderer for the formula editor.
 *
 * Shows a fixed 40×25 ft canonical plot with:
 *   - An under-layer sun-category heatmap (from buildSunGrid).
 *   - The building / tree canopies / path overlays.
 *   - Oudolf-style tapestry blobs for the species the formula would pick.
 *   - A species legend with count per species.
 *
 * On editor changes the parent pushes the draft in via `onDraftChange` from
 * FormulaEditor (wired through the `onChange` prop). We debounce the preview
 * fetch by 400 ms so slider drags don't pound the server.
 *
 * The last-good render is kept visible during refetch so the canvas doesn't
 * flicker between loads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesignFormula } from '@/types/formula';
import { blobSvgPath, tapestryColor, speciesAbbrev } from '@/lib/render/tapestry-blobs';

const PX_PER_FT = 18;
// Extra padding in feet so the ouside-property tree at (8, -4) and the
// building polygon at y=25..35 both fit inside the viewbox.
const PAD_LEFT_FT = 2;
const PAD_RIGHT_FT = 2;
const PAD_TOP_FT = 12; // room for the building extending north
const PAD_BOTTOM_FT = 8; // room for the south tree

interface Scenario {
  widthFt: number;
  heightFt: number;
  trees: Array<{
    id: string;
    xFt: number;
    yFt: number;
    canopyRadiusFt: number;
    label: string;
    outsideProperty: boolean;
  }>;
  buildings: Array<{ id: string; label: string; corners: Array<{ xFt: number; yFt: number }> }>;
  paths: Array<{
    id: string;
    label: string;
    type: string;
    corners: Array<{ xFt: number; yFt: number }>;
  }>;
}

interface SunCell {
  xFt: number;
  yFt: number;
  sunCategory: 'full_sun' | 'part_sun' | 'part_shade' | 'full_shade';
  underCanopy: boolean;
  inExclusion: boolean;
}

interface Placement {
  slug: string;
  name: string;
  xFt: number;
  yFt: number;
  radiusFt: number;
  speciesIndex: number;
  plantType: string;
  bloomColor: string;
}

interface SpeciesSummary {
  slug: string;
  commonName: string;
  scientificName: string;
  bloomColor: string;
  imageUrl: string;
  count: number;
  speciesIndex: number;
}

interface PreviewResponse {
  scenario: Scenario;
  sunGrid: { cellSizeFt: number; cells: SunCell[] } | null;
  placements: Placement[];
  species: SpeciesSummary[];
  diversityScore: number;
  error?: string;
}

const SUN_COLORS: Record<SunCell['sunCategory'], string> = {
  full_sun: '#fffbeb',
  part_sun: '#fef3c7',
  part_shade: '#cbd5e1',
  full_shade: '#475569',
};

const SUN_LABELS: Record<SunCell['sunCategory'], string> = {
  full_sun: 'Full sun (6+ h)',
  part_sun: 'Part sun (4–6 h)',
  part_shade: 'Part shade (2–4 h)',
  full_shade: 'Full shade (<2 h)',
};

export default function FormulaPreviewSandbox({
  initialFormula,
  draft,
}: {
  /** The starting formula. Accepts partials so the `/formulas/new` flow works
   *  before the user has filled in slug/name/weights — the server falls back
   *  to "no formula bias" when the draft is empty, which is still a useful
   *  visual baseline. */
  initialFormula: Partial<DesignFormula>;
  /** Optional live draft from the editor; takes priority over initialFormula. */
  draft?: Partial<DesignFormula>;
}) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPreview = useCallback(
    async (formula: Partial<DesignFormula>) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/formulas/preview-plot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formulaDraft: formula, targetCount: 15 }),
          cache: 'no-store',
        });
        const body = (await res.json()) as PreviewResponse;
        if (!res.ok) {
          setError(body.error || res.statusText);
          return;
        }
        setData(body);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial load
  useEffect(() => {
    fetchPreview(initialFormula);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced refetch on draft change
  useEffect(() => {
    if (!draft) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPreview(draft);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, fetchPreview]);

  const vbWidthFt = data
    ? data.scenario.widthFt + PAD_LEFT_FT + PAD_RIGHT_FT
    : 40 + PAD_LEFT_FT + PAD_RIGHT_FT;
  const vbHeightFt = data
    ? data.scenario.heightFt + PAD_TOP_FT + PAD_BOTTOM_FT
    : 25 + PAD_TOP_FT + PAD_BOTTOM_FT;
  const vbWidth = vbWidthFt * PX_PER_FT;
  const vbHeight = vbHeightFt * PX_PER_FT;

  // Coordinate transform: cartesian feet (origin SW of bed) → SVG pixels
  // (origin top-left of viewBox). Y flips so north is up.
  const fx = (xFt: number) => (xFt + PAD_LEFT_FT) * PX_PER_FT;
  const fy = (yFt: number) => (vbHeightFt - PAD_BOTTOM_FT - yFt) * PX_PER_FT;
  const fr = (rFt: number) => rFt * PX_PER_FT;

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100">
        <div>
          <div className="text-sm font-medium">Synthetic preview</div>
          <div className="text-xs text-stone-500">
            40 × 25 ft plot · tree shadows + north wall = 4 sun categories
          </div>
        </div>
        {loading && <span className="text-xs text-stone-400 animate-pulse">Updating…</span>}
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 text-red-900 text-xs px-3 py-2">
          Preview error: {error}
        </div>
      )}

      <div className={`transition-opacity ${loading && data ? 'opacity-75' : ''}`}>
        <svg
          viewBox={`0 0 ${vbWidth} ${vbHeight}`}
          className="w-full h-auto bg-stone-50"
          role="img"
          aria-label="Synthetic plot preview"
        >
          {/* 1. Sun category heatmap */}
          {data?.sunGrid && (
            <g>
              {data.sunGrid.cells.map((cell, i) => (
                <rect
                  key={i}
                  x={fx(cell.xFt)}
                  // SW origin: the rect's top-left in SVG is the cell's NW corner,
                  // which in feet is (xFt, yFt + cellSize).
                  y={fy(cell.yFt + data.sunGrid!.cellSizeFt)}
                  width={fr(data.sunGrid!.cellSizeFt)}
                  height={fr(data.sunGrid!.cellSizeFt)}
                  fill={SUN_COLORS[cell.sunCategory]}
                  opacity={cell.inExclusion ? 0.4 : 1}
                />
              ))}
            </g>
          )}

          {/* 2. Bed outline */}
          {data && (
            <rect
              x={fx(0)}
              y={fy(data.scenario.heightFt)}
              width={fr(data.scenario.widthFt)}
              height={fr(data.scenario.heightFt)}
              fill="none"
              stroke="#78716c"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}

          {/* 3. Buildings */}
          {data?.scenario.buildings.map((b) => {
            const ptStr = b.corners
              .map((c) => `${fx(c.xFt).toFixed(1)},${fy(c.yFt).toFixed(1)}`)
              .join(' ');
            return (
              <g key={b.id}>
                <polygon points={ptStr} fill="#a8a29e" stroke="#57534e" strokeWidth={1} />
                <text
                  x={fx(
                    b.corners.reduce((s, c) => s + c.xFt, 0) / b.corners.length,
                  )}
                  y={fy(b.corners.reduce((s, c) => s + c.yFt, 0) / b.corners.length)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="#fff"
                  fontWeight={500}
                >
                  {b.label}
                </text>
              </g>
            );
          })}

          {/* 4. Tree canopies */}
          {data?.scenario.trees.map((t) => (
            <g key={t.id}>
              <ellipse
                cx={fx(t.xFt)}
                cy={fy(t.yFt)}
                rx={fr(t.canopyRadiusFt)}
                ry={fr(t.canopyRadiusFt)}
                fill="#4d7c0f"
                fillOpacity={0.25}
                stroke="#365314"
                strokeOpacity={0.4}
                strokeDasharray="3 2"
              />
              <circle cx={fx(t.xFt)} cy={fy(t.yFt)} r={3} fill="#365314" />
              <text
                x={fx(t.xFt) + 6}
                y={fy(t.yFt) - 6}
                fontSize={9}
                fill="#365314"
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* 5. Path exclusions */}
          {data?.scenario.paths.map((p) => {
            const ptStr = p.corners
              .map((c) => `${fx(c.xFt).toFixed(1)},${fy(c.yFt).toFixed(1)}`)
              .join(' ');
            return (
              <polygon
                key={p.id}
                points={ptStr}
                fill="#d6d3d1"
                stroke="#78716c"
                strokeDasharray="2 2"
              />
            );
          })}

          {/* 6. Tapestry blobs (top layer) */}
          {data?.placements.map((pl, i) => {
            const color = tapestryColor(pl.speciesIndex, pl.slug);
            const d = blobSvgPath(pl.slug, fx(pl.xFt), fy(pl.yFt), fr(pl.radiusFt));
            return (
              <path
                key={`${pl.slug}-${i}`}
                d={d}
                fill={color}
                fillOpacity={0.75}
                stroke={color}
                strokeOpacity={0.9}
                strokeWidth={0.6}
              >
                <title>
                  {pl.name} ({pl.plantType})
                </title>
              </path>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="border-t border-stone-100 p-3 space-y-2">
        <div className="flex flex-wrap gap-2 text-[11px]">
          {(Object.keys(SUN_COLORS) as SunCell['sunCategory'][]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-3 h-3 rounded-sm border border-stone-300"
                style={{ background: SUN_COLORS[k] }}
              />
              <span className="text-stone-600">{SUN_LABELS[k]}</span>
            </span>
          ))}
        </div>
        {data && (
          <div>
            <div className="text-xs font-medium text-stone-700 mb-1">
              Species · {data.species.length} picked · diversity {data.diversityScore}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.species.map((s) => {
                const color = tapestryColor(s.speciesIndex, s.slug);
                return (
                  <span
                    key={s.slug}
                    className="inline-flex items-center gap-1.5 text-[11px] bg-stone-50 border border-stone-200 rounded px-1.5 py-0.5"
                    title={s.scientificName}
                  >
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ background: color }}
                    />
                    <span className="font-medium">
                      {speciesAbbrev(s.slug, s.commonName)}
                    </span>
                    <span className="text-stone-500">× {s.count}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
