'use client';

import SunCalc from 'suncalc';
import type { PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';

export interface NearbyBuilding {
  lat: number;
  lng: number;
  heightMeters: number;
  widthMeters?: number;
}

interface GridPlanViewProps {
  widthFt: number;
  heightFt: number;
  centerLat: number;
  centerLng: number;
  plants: PlanPlant[];
  exclusionZones?: ExclusionZone[];
  existingTrees?: ExistingTree[];
  selectedSlug?: string | null;
  onPlantClick?: (slug: string) => void;
  nearbyBuildings?: NearbyBuilding[];
  showShadows?: boolean;
  shadowHour?: number; // 0–24
}

const PX_PER_FT = 22;
const GRID_SPACING_FT = 2;

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#7c3aed', blue: '#2563eb', pink: '#db2777', red: '#dc2626',
    orange: '#ea580c', yellow: '#ca8a04', white: '#94a3b8', green: '#16a34a',
    lavender: '#8b5cf6', gold: '#b45309', crimson: '#b91c1c', coral: '#e05d44',
    violet: '#6d28d9', magenta: '#c026d3', cream: '#b45309', rose: '#e11d48',
    bronze: '#78350f', silver: '#64748b', rust: '#92400e', scarlet: '#991b1b',
    tan: '#7c6144', brown: '#6b3a2a',
  };
  return colors[bloomColor?.toLowerCase()] || '#6b7280';
}

function formatHour(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h % 1) * 60);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${min.toString().padStart(2, '0')} ${ampm}`;
}

export default function GridPlanView({
  widthFt, heightFt, centerLat, centerLng,
  plants, exclusionZones = [], existingTrees = [],
  selectedSlug, onPlantClick,
  nearbyBuildings = [],
  showShadows,
  shadowHour = 14,
}: GridPlanViewProps) {
  // Auto-enable shadows when buildings are present
  const shadowsOn = showShadows !== undefined ? showShadows : nearbyBuildings.length > 0;

  const svgWidth = widthFt * PX_PER_FT;
  const svgHeight = heightFt * PX_PER_FT;
  const ftToPx = (ft: number) => ft * PX_PER_FT;

  // Bounding box from actual plant positions
  const plantsWithCoords = plants.filter(p => p.lat && p.lng);
  let minLat: number, maxLat: number, minLng: number, maxLng: number;

  if (plantsWithCoords.length > 0) {
    minLat = Math.min(...plantsWithCoords.map(p => p.lat!));
    maxLat = Math.max(...plantsWithCoords.map(p => p.lat!));
    minLng = Math.min(...plantsWithCoords.map(p => p.lng!));
    maxLng = Math.max(...plantsWithCoords.map(p => p.lng!));
    const padLat = (maxLat - minLat) * 0.12 || 0.00002;
    const padLng = (maxLng - minLng) * 0.12 || 0.00002;
    minLat -= padLat; maxLat += padLat;
    minLng -= padLng; maxLng += padLng;
  } else {
    const latPerFt = 0.3048 / 111320;
    const lngPerFt = 0.3048 / (111320 * Math.cos(centerLat * Math.PI / 180));
    minLat = centerLat - (heightFt / 2) * latPerFt;
    maxLat = centerLat + (heightFt / 2) * latPerFt;
    minLng = centerLng - (widthFt / 2) * lngPerFt;
    maxLng = centerLng + (widthFt / 2) * lngPerFt;
  }

  function latLngToFt(lat: number, lng: number): { xFt: number; yFt: number } {
    const latRange = maxLat - minLat || 0.0001;
    const lngRange = maxLng - minLng || 0.0001;
    return {
      xFt: ((lng - minLng) / lngRange) * widthFt,
      yFt: ((maxLat - lat) / latRange) * heightFt,
    };
  }

  // ── Shadow polygons ─────────────────────────────────────────────────────────
  const shadowPolygons: string[] = [];
  if (shadowsOn && (nearbyBuildings.length > 0 || existingTrees.length > 0)) {
    const date = new Date(new Date().getFullYear(), 5, 21, Math.floor(shadowHour), Math.round((shadowHour % 1) * 60));
    const sunPos = SunCalc.getPosition(date, centerLat, centerLng);
    const altDeg = sunPos.altitude * (180 / Math.PI);
    const azDeg = sunPos.azimuth * (180 / Math.PI) + 180;

    if (altDeg > 2) {
      const altRad = altDeg * Math.PI / 180;
      const shadowDirRad = ((azDeg + 180) % 360) * Math.PI / 180;
      const perpRad = shadowDirRad + Math.PI / 2;
      const M_TO_LAT = 1 / 111320;
      const M_TO_LNG = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));

      const makeShadowPoints = (lat: number, lng: number, heightM: number, widthM: number) => {
        if (heightM <= 0) return null;
        const lenM = Math.min(heightM / Math.tan(altRad), 150);
        const hw = widthM / 2;
        const c = [
          { lat: lat + Math.cos(perpRad) * hw * M_TO_LAT, lng: lng + Math.sin(perpRad) * hw * M_TO_LNG },
          { lat: lat - Math.cos(perpRad) * hw * M_TO_LAT, lng: lng - Math.sin(perpRad) * hw * M_TO_LNG },
          { lat: lat - Math.cos(perpRad) * hw * M_TO_LAT + Math.cos(shadowDirRad) * lenM * M_TO_LAT,
            lng: lng - Math.sin(perpRad) * hw * M_TO_LNG + Math.sin(shadowDirRad) * lenM * M_TO_LNG },
          { lat: lat + Math.cos(perpRad) * hw * M_TO_LAT + Math.cos(shadowDirRad) * lenM * M_TO_LAT,
            lng: lng + Math.sin(perpRad) * hw * M_TO_LNG + Math.sin(shadowDirRad) * lenM * M_TO_LNG },
        ];
        return c.map(p => { const { xFt, yFt } = latLngToFt(p.lat, p.lng); return `${ftToPx(xFt).toFixed(1)},${ftToPx(yFt).toFixed(1)}`; }).join(' ');
      };

      for (const b of nearbyBuildings) {
        const pts = makeShadowPoints(b.lat, b.lng, b.heightMeters, b.widthMeters ?? 15);
        if (pts) shadowPolygons.push(pts);
      }
      for (const t of existingTrees) {
        const pts = makeShadowPoints(t.lat, t.lng, t.canopyDiameterFt * 1.5 * 0.3048, t.canopyDiameterFt * 0.3048);
        if (pts) shadowPolygons.push(pts);
      }
    }
  }

  // ── Species zone backgrounds ────────────────────────────────────────────────
  // Group visible plants by species, compute centroid + radius for a soft wash
  const speciesGroups = new Map<string, { cx: number; cy: number; r: number; color: string }>();
  const slugPositions = new Map<string, { xFt: number; yFt: number; color: string }[]>();
  for (const p of plantsWithCoords) {
    const { xFt, yFt } = latLngToFt(p.lat!, p.lng!);
    if (xFt < 0 || xFt > widthFt || yFt < 0 || yFt > heightFt) continue;
    if (!slugPositions.has(p.plantSlug)) slugPositions.set(p.plantSlug, []);
    slugPositions.get(p.plantSlug)!.push({ xFt, yFt, color: getPlantColor(p.bloomColor) });
  }
  for (const [slug, pts] of slugPositions) {
    const cx = pts.reduce((s, p) => s + p.xFt, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.yFt, 0) / pts.length;
    const r = Math.max(...pts.map(p => Math.sqrt((p.xFt - cx) ** 2 + (p.yFt - cy) ** 2))) + 1.5;
    speciesGroups.set(slug, { cx, cy, r, color: pts[0].color });
  }

  // ── Grid lines ──────────────────────────────────────────────────────────────
  const gridLines: React.ReactElement[] = [];
  for (let x = 0; x <= widthFt; x += GRID_SPACING_FT) {
    gridLines.push(<line key={`v${x}`} x1={ftToPx(x)} y1={0} x2={ftToPx(x)} y2={svgHeight}
      stroke="#d1d5db" strokeWidth={x % 10 === 0 ? 1 : 0.4} strokeOpacity={0.6} />);
  }
  for (let y = 0; y <= heightFt; y += GRID_SPACING_FT) {
    gridLines.push(<line key={`h${y}`} x1={0} y1={ftToPx(y)} x2={svgWidth} y2={ftToPx(y)}
      stroke="#d1d5db" strokeWidth={y % 10 === 0 ? 1 : 0.4} strokeOpacity={0.6} />);
  }

  return (
    <div className="border border-stone-300 rounded-xl overflow-hidden bg-white shadow-sm" style={{ maxWidth: '100%', overflowX: 'auto' }}>
      {/* Dimension labels */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-stone-50 border-b border-stone-200 text-xs text-muted font-medium">
        <span>{widthFt} ft wide × {heightFt} ft deep</span>
        {shadowsOn && shadowPolygons.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-slate-800 opacity-50" />
            Shadows at {formatHour(shadowHour)}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-primary opacity-60" /> Plants
        </span>
      </div>

      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: '520px' }}>
        {/* Background */}
        <rect width={svgWidth} height={svgHeight} fill="#f8fafc" />
        {/* Subtle soil texture */}
        <rect width={svgWidth} height={svgHeight} fill="url(#soil)" opacity={0.4} />
        <defs>
          <pattern id="soil" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#ecfdf5" />
            <circle cx="1" cy="1" r="0.5" fill="#d1fae5" />
            <circle cx="3" cy="3" r="0.5" fill="#d1fae5" />
          </pattern>
        </defs>

        {gridLines}

        {/* Ft labels every 5 ft */}
        {Array.from({ length: Math.floor(widthFt / 5) + 1 }).map((_, i) => (
          <text key={`xl${i}`} x={ftToPx(i * 5)} y={svgHeight - 3} fontSize="9" fill="#9ca3af" textAnchor="middle">{i * 5}'</text>
        ))}
        {Array.from({ length: Math.floor(heightFt / 5) + 1 }).map((_, i) => (
          <text key={`yl${i}`} x={3} y={ftToPx(i * 5)} fontSize="9" fill="#9ca3af" dominantBaseline="middle">{i * 5}'</text>
        ))}

        {/* Species zone washes — drawn first, behind shadows */}
        {Array.from(speciesGroups.values()).map((zone, i) => (
          <ellipse key={`zone-${i}`}
            cx={ftToPx(zone.cx)} cy={ftToPx(zone.cy)}
            rx={ftToPx(zone.r)} ry={ftToPx(zone.r * 0.75)}
            fill={zone.color} fillOpacity={0.08} />
        ))}

        {/* Shadow overlay */}
        {shadowPolygons.map((pts, i) => (
          <polygon key={`shadow-${i}`} points={pts}
            fill="#0f172a" fillOpacity={0.38}
            stroke="#0f172a" strokeWidth={0.3} strokeOpacity={0.2} />
        ))}

        {/* Exclusion zones */}
        {exclusionZones.map(z => {
          const rect = (z as any).gridRect;
          if (!rect) return null;
          return (
            <g key={z.id}>
              <rect x={ftToPx(rect.xFt)} y={ftToPx(rect.yFt)} width={ftToPx(rect.wFt)} height={ftToPx(rect.hFt)}
                fill="#6b7280" fillOpacity={0.2} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="6,3" rx={3} />
              <text x={ftToPx(rect.xFt + rect.wFt / 2)} y={ftToPx(rect.yFt + rect.hFt / 2)}
                textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#374151" fontWeight="500">{z.label}</text>
            </g>
          );
        })}

        {/* Existing trees */}
        {existingTrees.map(t => {
          const xFt = (t as any).gridXFt ?? latLngToFt(t.lat, t.lng).xFt;
          const yFt = (t as any).gridYFt ?? latLngToFt(t.lat, t.lng).yFt;
          const rPx = ftToPx(t.canopyDiameterFt / 2);
          return (
            <g key={t.id}>
              <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={rPx}
                fill="#15803d" fillOpacity={0.15} stroke="#15803d" strokeWidth={1.5} strokeDasharray="4,2" strokeOpacity={0.5} />
              <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={4} fill="#713f12" stroke="white" strokeWidth={1.5} />
              <text x={ftToPx(xFt)} y={ftToPx(yFt) - rPx - 5}
                textAnchor="middle" fontSize="9" fill="#14532d" fontWeight="600"
                stroke="white" strokeWidth="2" paintOrder="stroke">{t.label}</text>
            </g>
          );
        })}

        {/* Plant circles — compact, readable, species-coded */}
        {plantsWithCoords.map((p, i) => {
          const { xFt, yFt } = latLngToFt(p.lat!, p.lng!);
          if (xFt < -1 || xFt > widthFt + 1 || yFt < -1 || yFt > heightFt + 1) return null;

          // Circle sized to ~40% of actual spread, capped for readability
          const spreadFt = (p.spreadInches || 24) / 12;
          const radiusPx = Math.min(11, Math.max(5, spreadFt * PX_PER_FT * 0.22));
          const color = getPlantColor(p.bloomColor);
          const isSelected = selectedSlug === p.plantSlug;
          const cx = ftToPx(xFt), cy = ftToPx(yFt);

          return (
            <g key={`${p.plantSlug}-${i}`}
              onClick={() => onPlantClick?.(p.plantSlug)}
              style={{ cursor: onPlantClick ? 'pointer' : 'default' }}>
              {/* Outer glow ring for selected */}
              {isSelected && <circle cx={cx} cy={cy} r={radiusPx + 3} fill="none" stroke="#000" strokeWidth={2} strokeOpacity={0.5} />}
              {/* White backing disc for contrast on any background */}
              <circle cx={cx} cy={cy} r={radiusPx + 1} fill="white" fillOpacity={0.6} />
              {/* Main species circle */}
              <circle cx={cx} cy={cy} r={radiusPx}
                fill={color} fillOpacity={0.88}
                stroke="white" strokeWidth={1} />
              {/* Species number with stroke-based halo */}
              {p.speciesIndex != null && (
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                  fontSize={radiusPx >= 9 ? '8' : '7'} fontWeight="bold" fill="white"
                  stroke="rgba(0,0,0,0.55)" strokeWidth="1.8" paintOrder="stroke">
                  {p.speciesIndex}
                </text>
              )}
            </g>
          );
        })}

        {/* North arrow */}
        <g transform={`translate(${svgWidth - 26}, 26)`}>
          <circle cx={0} cy={0} r={16} fill="rgba(15,23,42,0.55)" />
          <polygon points="0,-11 3.5,2 -3.5,2" fill="white" />
          <text x={0} y={12} textAnchor="middle" fontSize="8" fill="white" fontWeight="bold">N</text>
        </g>

        {/* Scale bar — bottom right */}
        <g transform={`translate(${svgWidth - 80}, ${svgHeight - 14})`}>
          <rect x={0} y={4} width={ftToPx(5)} height={4} fill="#374151" rx={1} />
          <text x={0} y={2} fontSize="8" fill="#6b7280">0</text>
          <text x={ftToPx(5)} y={2} fontSize="8" fill="#6b7280" textAnchor="middle">5 ft</text>
        </g>
      </svg>
    </div>
  );
}
