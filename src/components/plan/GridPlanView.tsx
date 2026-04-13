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
  showSatellite?: boolean;
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

/** Convert compass bearing (0=N, 90=E) to SVG x,y on a circle */
function bearingToXY(bearingDeg: number, radius: number) {
  const rad = bearingDeg * Math.PI / 180;
  return { x: Math.sin(rad) * radius, y: -Math.cos(rad) * radius };
}

export default function GridPlanView({
  widthFt, heightFt, centerLat, centerLng,
  plants, exclusionZones = [], existingTrees = [],
  selectedSlug, onPlantClick,
  nearbyBuildings = [],
  showSatellite,
  showShadows,
  shadowHour = 14,
}: GridPlanViewProps) {
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

  // ── Satellite background URL ────────────────────────────────────────────────
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const satImgW = Math.min(1280, Math.round(svgWidth));
  const satImgH = Math.min(1280, Math.round(svgHeight));
  const satelliteUrl = showSatellite && MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/[${minLng},${minLat},${maxLng},${maxLat}]/${satImgW}x${satImgH}@2x?access_token=${MAPBOX_TOKEN}&padding=0`
    : null;

  // ── Sun position and path ───────────────────────────────────────────────────
  // Use UTC dates based on garden longitude to avoid timezone issues
  // Local noon ≈ 12:00 - (longitude / 15) UTC
  const year = new Date().getFullYear();
  const localNoonUTC = 12 - (centerLng / 15); // e.g., ~17.8 UTC for Chicago
  const utcShadowHour = shadowHour + (localNoonUTC - 12); // shift by difference from local noon
  const sunDate = new Date(Date.UTC(year, 5, 21, Math.floor(utcShadowHour), Math.round(((utcShadowHour % 1 + 1) % 1) * 60)));
  const sunPos = SunCalc.getPosition(sunDate, centerLat, centerLng);
  const sunAltDeg = sunPos.altitude * 180 / Math.PI;
  const sunAzDeg = (sunPos.azimuth * 180 / Math.PI + 180) % 360;

  // Hourly sun positions for the path arc (in local time at the garden)
  const sunPathPoints: { hour: number; azDeg: number; altDeg: number }[] = [];
  for (let localH = 5; localH <= 21; localH += 0.5) {
    const utcH = localH + (localNoonUTC - 12);
    const d = new Date(Date.UTC(year, 5, 21, Math.floor(utcH), Math.round(((utcH % 1 + 1) % 1) * 60)));
    const p = SunCalc.getPosition(d, centerLat, centerLng);
    const alt = p.altitude * 180 / Math.PI;
    if (alt > 0) sunPathPoints.push({ hour: localH, azDeg: (p.azimuth * 180 / Math.PI + 180) % 360, altDeg: alt });
  }

  // ── Building positions in plan coordinates ──────────────────────────────────
  const buildingInfo = nearbyBuildings.map(b => {
    const { xFt, yFt } = latLngToFt(b.lat, b.lng);
    const wFt = (b.widthMeters ?? 15) * 3.28084;
    const inView = xFt >= -wFt && xFt <= widthFt + wFt && yFt >= -wFt && yFt <= heightFt + wFt;
    const angle = Math.atan2(yFt - heightFt / 2, xFt - widthFt / 2);
    return { ...b, xFt, yFt, wFt, inView, angle };
  });

  // ── Shadow polygons ─────────────────────────────────────────────────────────
  const shadowPolygons: string[] = [];
  if (shadowsOn && (nearbyBuildings.length > 0 || existingTrees.length > 0)) {
    if (sunAltDeg > 2) {
      const altRad = sunAltDeg * Math.PI / 180;
      const shadowDirRad = ((sunAzDeg + 180) % 360) * Math.PI / 180;
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
  const speciesGroups = new Map<string, { cx: number; cy: number; r: number; color: string }>();
  const slugPositions = new Map<string, { xFt: number; yFt: number; color: string }[]>();
  for (const p of plantsWithCoords) {
    const { xFt, yFt } = latLngToFt(p.lat!, p.lng!);
    if (xFt < 0 || xFt > widthFt || yFt < 0 || yFt > heightFt) continue;
    if (!slugPositions.has(p.plantSlug)) slugPositions.set(p.plantSlug, []);
    slugPositions.get(p.plantSlug)!.push({ xFt, yFt, color: getPlantColor(p.bloomColor) });
  }
  for (const [, pts] of slugPositions) {
    const cx = pts.reduce((s, p) => s + p.xFt, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.yFt, 0) / pts.length;
    const r = Math.max(...pts.map(p => Math.sqrt((p.xFt - cx) ** 2 + (p.yFt - cy) ** 2))) + 1.5;
    speciesGroups.set(`${cx}-${cy}`, { cx, cy, r, color: pts[0].color });
  }

  // ── Grid lines (style adapts to satellite background) ──────────────────────
  const isSat = !!showSatellite;
  const gridLines: React.ReactElement[] = [];
  for (let x = 0; x <= widthFt; x += GRID_SPACING_FT) {
    const major = x % 10 === 0;
    gridLines.push(
      <line key={`v${x}`} x1={ftToPx(x)} y1={0} x2={ftToPx(x)} y2={svgHeight}
        stroke={isSat ? 'rgba(255,255,255,0.25)' : '#d1d5db'}
        strokeWidth={major ? 1 : 0.4}
        strokeOpacity={isSat ? (major ? 0.5 : 0.25) : 0.6} />
    );
  }
  for (let y = 0; y <= heightFt; y += GRID_SPACING_FT) {
    const major = y % 10 === 0;
    gridLines.push(
      <line key={`h${y}`} x1={0} y1={ftToPx(y)} x2={svgWidth} y2={ftToPx(y)}
        stroke={isSat ? 'rgba(255,255,255,0.25)' : '#d1d5db'}
        strokeWidth={major ? 1 : 0.4}
        strokeOpacity={isSat ? (major ? 0.5 : 0.25) : 0.6} />
    );
  }

  // ── Off-screen building edge indicators ─────────────────────────────────────
  const edgeIndicators = buildingInfo.filter(b => !b.inView).map((b, i) => {
    const margin = 24;
    const cx = Math.max(margin, Math.min(svgWidth - margin, ftToPx(b.xFt)));
    const cy = Math.max(margin, Math.min(svgHeight - margin, ftToPx(b.yFt)));
    const aLen = 10;
    const ax = Math.cos(b.angle) * aLen;
    const ay = Math.sin(b.angle) * aLen;
    return (
      <g key={`bedge-${i}`} transform={`translate(${cx},${cy})`}>
        <polygon
          points={`${ax},${ay} ${-ay * 0.4 + ax * 0.3},${ax * 0.4 + ay * 0.3} ${ay * 0.4 + ax * 0.3},${-ax * 0.4 + ay * 0.3}`}
          fill="#64748b" fillOpacity={0.7} />
        <text x={0} y={-10} textAnchor="middle" fontSize="7" fontWeight="600"
          fill={isSat ? 'white' : '#475569'}
          stroke={isSat ? 'rgba(0,0,0,0.5)' : 'white'} strokeWidth="2" paintOrder="stroke">
          {Math.round(b.heightMeters * 3.28084)}ft
        </text>
      </g>
    );
  });

  // ── Sun compass geometry ────────────────────────────────────────────────────
  const compassR = 28;
  const compassCx = svgWidth - 32;
  const compassCy = 72; // below north arrow area

  // Sun path arc as SVG path string
  const sunArcD = sunPathPoints.length > 1
    ? sunPathPoints.map((p, i) => {
        const { x, y } = bearingToXY(p.azDeg, compassR - 5);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ')
    : null;

  // Current sun dot position
  const sunDot = sunAltDeg > 0 ? bearingToXY(sunAzDeg, compassR - 5) : null;

  // Label text color
  const labelFill = isSat ? 'white' : '#9ca3af';
  const labelStroke = isSat ? 'rgba(0,0,0,0.5)' : 'none';
  const labelStrokeW = isSat ? '2' : '0';

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
          {nearbyBuildings.length > 0 && (
            <><span className="text-stone-300 mx-0.5">|</span>
            <span className="inline-block w-2 h-2 rounded-sm bg-slate-500 opacity-60" /> {nearbyBuildings.length} buildings</>
          )}
        </span>
      </div>

      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: '520px' }}>
        <defs>
          <pattern id="soil" x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#ecfdf5" />
            <circle cx="1" cy="1" r="0.5" fill="#d1fae5" />
            <circle cx="3" cy="3" r="0.5" fill="#d1fae5" />
          </pattern>
        </defs>

        {/* Background: satellite image or soil texture */}
        {satelliteUrl ? (
          <image href={satelliteUrl} x={0} y={0} width={svgWidth} height={svgHeight}
            preserveAspectRatio="xMidYMid slice" />
        ) : (
          <>
            <rect width={svgWidth} height={svgHeight} fill="#f8fafc" />
            <rect width={svgWidth} height={svgHeight} fill="url(#soil)" opacity={0.4} />
          </>
        )}

        {/* Grid lines */}
        {gridLines}

        {/* Ft labels every 5 ft */}
        {Array.from({ length: Math.floor(widthFt / 5) + 1 }).map((_, i) => (
          <text key={`xl${i}`} x={ftToPx(i * 5)} y={svgHeight - 3} fontSize="9"
            fill={labelFill} textAnchor="middle"
            stroke={labelStroke} strokeWidth={labelStrokeW} paintOrder="stroke">
            {i * 5}&apos;
          </text>
        ))}
        {Array.from({ length: Math.floor(heightFt / 5) + 1 }).map((_, i) => (
          <text key={`yl${i}`} x={3} y={ftToPx(i * 5)} fontSize="9"
            fill={labelFill} dominantBaseline="middle"
            stroke={labelStroke} strokeWidth={labelStrokeW} paintOrder="stroke">
            {i * 5}&apos;
          </text>
        ))}

        {/* Species zone washes (hidden when satellite is on — they obscure imagery) */}
        {!isSat && Array.from(speciesGroups.values()).map((zone, i) => (
          <ellipse key={`zone-${i}`}
            cx={ftToPx(zone.cx)} cy={ftToPx(zone.cy)}
            rx={ftToPx(zone.r)} ry={ftToPx(zone.r * 0.75)}
            fill={zone.color} fillOpacity={0.08} />
        ))}

        {/* Building footprints (visible buildings near/in viewport) */}
        {buildingInfo.filter(b => b.inView).map((b, i) => {
          const halfPx = ftToPx(b.wFt / 2);
          const cx = ftToPx(b.xFt);
          const cy = ftToPx(b.yFt);
          return (
            <g key={`bldg-${i}`}>
              <rect x={cx - halfPx} y={cy - halfPx} width={halfPx * 2} height={halfPx * 2}
                fill={isSat ? 'rgba(100,116,139,0.25)' : '#94a3b8'}
                fillOpacity={isSat ? 0.25 : 0.2}
                stroke={isSat ? 'rgba(255,255,255,0.6)' : '#64748b'}
                strokeWidth={1.5} strokeDasharray="4,2" rx={2} />
              <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                fontSize="9" fontWeight="700"
                fill={isSat ? 'white' : '#475569'}
                stroke={isSat ? 'rgba(0,0,0,0.6)' : 'white'} strokeWidth="2.5" paintOrder="stroke">
                {Math.round(b.heightMeters * 3.28084)}ft
              </text>
            </g>
          );
        })}

        {/* Shadow overlay */}
        {shadowPolygons.map((pts, i) => (
          <polygon key={`shadow-${i}`} points={pts}
            fill="#0f172a" fillOpacity={isSat ? 0.5 : 0.38}
            stroke="#0f172a" strokeWidth={0.3} strokeOpacity={0.2} />
        ))}

        {/* Off-screen building direction indicators */}
        {edgeIndicators}

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

        {/* Plant circles */}
        {plantsWithCoords.map((p, i) => {
          const { xFt, yFt } = latLngToFt(p.lat!, p.lng!);
          if (xFt < -1 || xFt > widthFt + 1 || yFt < -1 || yFt > heightFt + 1) return null;

          const spreadFt = (p.spreadInches || 24) / 12;
          const radiusPx = Math.min(11, Math.max(5, spreadFt * PX_PER_FT * 0.22));
          const color = getPlantColor(p.bloomColor);
          const isSelected = selectedSlug === p.plantSlug;
          const cx = ftToPx(xFt), cy = ftToPx(yFt);

          return (
            <g key={`${p.plantSlug}-${i}`}
              onClick={() => onPlantClick?.(p.plantSlug)}
              style={{ cursor: onPlantClick ? 'pointer' : 'default' }}>
              {isSelected && <circle cx={cx} cy={cy} r={radiusPx + 3} fill="none" stroke="#000" strokeWidth={2} strokeOpacity={0.5} />}
              {/* Wider backing disc on satellite for contrast */}
              <circle cx={cx} cy={cy} r={radiusPx + (isSat ? 2 : 1)}
                fill={isSat ? 'rgba(0,0,0,0.5)' : 'white'} fillOpacity={isSat ? 0.5 : 0.6} />
              <circle cx={cx} cy={cy} r={radiusPx}
                fill={color} fillOpacity={0.88}
                stroke="white" strokeWidth={isSat ? 1.5 : 1} />
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

        {/* Sun compass — combined north arrow + sun path */}
        <g transform={`translate(${compassCx}, ${compassCy})`}>
          <circle r={compassR} fill="rgba(15,23,42,0.6)" />
          <circle r={compassR} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />

          {/* Sun path arc */}
          {sunArcD && (
            <path d={sunArcD} fill="none" stroke="#fbbf24" strokeWidth={2.5}
              strokeOpacity={0.5} strokeLinecap="round" />
          )}

          {/* Current sun position */}
          {sunDot && (
            <>
              <circle cx={sunDot.x} cy={sunDot.y} r={5} fill="#fbbf24" stroke="white" strokeWidth={1} />
              <circle cx={sunDot.x} cy={sunDot.y} r={2} fill="#f59e0b" />
            </>
          )}

          {/* North indicator */}
          <polygon points="0,-22 3,-14 -3,-14" fill="white" fillOpacity={0.9} />
          <text x={0} y={-13} textAnchor="middle" fontSize="6" fill="white" fontWeight="bold" dominantBaseline="central">N</text>

          {/* Cardinal directions */}
          <text x={0} y={20} textAnchor="middle" fontSize="5" fill="rgba(255,255,255,0.5)">S</text>
          <text x={20} y={1} textAnchor="middle" fontSize="5" fill="rgba(255,255,255,0.5)" dominantBaseline="central">E</text>
          <text x={-20} y={1} textAnchor="middle" fontSize="5" fill="rgba(255,255,255,0.5)" dominantBaseline="central">W</text>
        </g>

        {/* Sun compass label */}
        <text x={compassCx} y={compassCy + compassR + 10} textAnchor="middle" fontSize="7"
          fill={isSat ? 'white' : '#6b7280'}
          stroke={isSat ? 'rgba(0,0,0,0.5)' : 'none'} strokeWidth={isSat ? '2' : '0'}
          paintOrder="stroke">
          {formatHour(shadowHour)}
        </text>

        {/* Scale bar — bottom right */}
        <g transform={`translate(${svgWidth - 80}, ${svgHeight - 14})`}>
          <rect x={0} y={4} width={ftToPx(5)} height={4}
            fill={isSat ? 'white' : '#374151'} rx={1} />
          <text x={0} y={2} fontSize="8" fill={isSat ? 'white' : '#6b7280'}
            stroke={isSat ? 'rgba(0,0,0,0.4)' : 'none'} strokeWidth={isSat ? '2' : '0'} paintOrder="stroke">0</text>
          <text x={ftToPx(5)} y={2} fontSize="8" fill={isSat ? 'white' : '#6b7280'} textAnchor="middle"
            stroke={isSat ? 'rgba(0,0,0,0.4)' : 'none'} strokeWidth={isSat ? '2' : '0'} paintOrder="stroke">5 ft</text>
        </g>
      </svg>
    </div>
  );
}
