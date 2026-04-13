'use client';

import SunCalc from 'suncalc';
import type { PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';

interface NearbyBuilding {
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

const PX_PER_FT = 24;
const GRID_SPACING_FT = 2;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

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
  showSatellite = false,
  showShadows = false,
  shadowHour = 14,
}: GridPlanViewProps) {
  const svgWidth = widthFt * PX_PER_FT;
  const svgHeight = heightFt * PX_PER_FT;
  const ftToPx = (ft: number) => ft * PX_PER_FT;

  // Compute bounding box from actual plant positions
  const plantsWithCoords = plants.filter(p => p.lat && p.lng);
  let minLat: number, maxLat: number, minLng: number, maxLng: number;

  if (plantsWithCoords.length > 0) {
    minLat = Math.min(...plantsWithCoords.map(p => p.lat!));
    maxLat = Math.max(...plantsWithCoords.map(p => p.lat!));
    minLng = Math.min(...plantsWithCoords.map(p => p.lng!));
    maxLng = Math.max(...plantsWithCoords.map(p => p.lng!));
    const padLat = (maxLat - minLat) * 0.15 || 0.00002;
    const padLng = (maxLng - minLng) * 0.15 || 0.00002;
    minLat -= padLat; maxLat += padLat;
    minLng -= padLng; maxLng += padLng;
  } else {
    // Default: estimate from widthFt/heightFt around center
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
    const xFt = ((lng - minLng) / lngRange) * widthFt;
    const yFt = ((maxLat - lat) / latRange) * heightFt; // SVG y inverted
    return { xFt, yFt };
  }

  // Satellite image URL (Mapbox Static API, bbox auto-fit)
  const satelliteUrl = showSatellite && MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/[${minLng},${minLat},${maxLng},${maxLat}]/600x600?access_token=${MAPBOX_TOKEN}`
    : null;

  // Shadow polygons: buildings + trees
  const shadowPolygons: string[] = [];
  if (showShadows) {
    const date = new Date(new Date().getFullYear(), 5, 21, Math.floor(shadowHour), Math.round((shadowHour % 1) * 60));
    const sunPos = SunCalc.getPosition(date, centerLat, centerLng);
    const altDeg = sunPos.altitude * (180 / Math.PI);
    const azDeg = sunPos.azimuth * (180 / Math.PI) + 180; // 0=N, 90=E, 180=S, 270=W

    if (altDeg > 2) {
      const altRad = altDeg * Math.PI / 180;
      const shadowDirDeg = (azDeg + 180) % 360; // opposite of sun
      const shadowDirRad = shadowDirDeg * Math.PI / 180;
      const perpRad = shadowDirRad + Math.PI / 2;

      const M_TO_LAT = 1 / 111320;
      const M_TO_LNG = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));

      function makeShadowPoints(lat: number, lng: number, heightM: number, widthM: number): string | null {
        if (heightM <= 0) return null;
        const shadowLenM = Math.min(heightM / Math.tan(altRad), 200); // cap at 200m
        const halfW = widthM / 2;

        // Trapezoid: base at obstacle, tip at shadow end
        const corners = [
          { lat: lat + Math.cos(perpRad) * halfW * M_TO_LAT, lng: lng + Math.sin(perpRad) * halfW * M_TO_LNG },
          { lat: lat - Math.cos(perpRad) * halfW * M_TO_LAT, lng: lng - Math.sin(perpRad) * halfW * M_TO_LNG },
          {
            lat: lat - Math.cos(perpRad) * halfW * M_TO_LAT + Math.cos(shadowDirRad) * shadowLenM * M_TO_LAT,
            lng: lng - Math.sin(perpRad) * halfW * M_TO_LNG + Math.sin(shadowDirRad) * shadowLenM * M_TO_LNG,
          },
          {
            lat: lat + Math.cos(perpRad) * halfW * M_TO_LAT + Math.cos(shadowDirRad) * shadowLenM * M_TO_LAT,
            lng: lng + Math.sin(perpRad) * halfW * M_TO_LNG + Math.sin(shadowDirRad) * shadowLenM * M_TO_LNG,
          },
        ];

        return corners.map(c => {
          const { xFt, yFt } = latLngToFt(c.lat, c.lng);
          return `${ftToPx(xFt).toFixed(1)},${ftToPx(yFt).toFixed(1)}`;
        }).join(' ');
      }

      for (const b of nearbyBuildings) {
        const pts = makeShadowPoints(b.lat, b.lng, b.heightMeters, b.widthMeters ?? 15);
        if (pts) shadowPolygons.push(pts);
      }

      for (const t of existingTrees) {
        const heightM = t.canopyDiameterFt * 1.5 * 0.3048;
        const widthM = t.canopyDiameterFt * 0.3048;
        const pts = makeShadowPoints(t.lat, t.lng, heightM, widthM);
        if (pts) shadowPolygons.push(pts);
      }
    }
  }

  // Grid lines
  const gridLines: React.ReactElement[] = [];
  for (let x = 0; x <= widthFt; x += GRID_SPACING_FT) {
    gridLines.push(<line key={`v${x}`} x1={ftToPx(x)} y1={0} x2={ftToPx(x)} y2={svgHeight}
      stroke={showSatellite ? 'rgba(255,255,255,0.25)' : '#e5e7eb'}
      strokeWidth={x % 10 === 0 ? 1.5 : 0.5} />);
  }
  for (let y = 0; y <= heightFt; y += GRID_SPACING_FT) {
    gridLines.push(<line key={`h${y}`} x1={0} y1={ftToPx(y)} x2={svgWidth} y2={ftToPx(y)}
      stroke={showSatellite ? 'rgba(255,255,255,0.25)' : '#e5e7eb'}
      strokeWidth={y % 10 === 0 ? 1.5 : 0.5} />);
  }

  const labelColor = showSatellite ? 'rgba(255,255,255,0.8)' : '#9ca3af';

  return (
    <div>
      <div className="border border-stone-300 rounded-xl overflow-hidden bg-white relative" style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-white/80 px-2 py-0.5 text-xs font-medium text-muted z-10 rounded-b">
          {widthFt} ft
        </div>
        <div className="absolute top-1/2 right-0 -translate-y-1/2 bg-white/80 px-2 py-0.5 text-xs font-medium text-muted z-10 rounded-l" style={{ writingMode: 'vertical-lr' }}>
          {heightFt} ft
        </div>

        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: '500px' }}>
          {/* Background: satellite or solid */}
          {satelliteUrl ? (
            <image x={0} y={0} width={svgWidth} height={svgHeight}
              href={satelliteUrl} preserveAspectRatio="none" />
          ) : (
            <rect width={svgWidth} height={svgHeight} fill="#f0fdf4" />
          )}

          {gridLines}

          {/* Ft labels */}
          {Array.from({ length: Math.floor(widthFt / 5) + 1 }).map((_, i) => (
            <text key={`xl${i}`} x={ftToPx(i * 5)} y={svgHeight - 4} fontSize="10" fill={labelColor} textAnchor="middle">{i * 5}'</text>
          ))}
          {Array.from({ length: Math.floor(heightFt / 5) + 1 }).map((_, i) => (
            <text key={`yl${i}`} x={4} y={ftToPx(i * 5)} fontSize="10" fill={labelColor} dominantBaseline="middle">{i * 5}'</text>
          ))}

          {/* Shadow overlay */}
          {shadowPolygons.map((pts, i) => (
            <polygon key={`shadow-${i}`} points={pts}
              fill="#1a2e4a" fillOpacity={0.45}
              stroke="#0f172a" strokeWidth={0.5} strokeOpacity={0.3} />
          ))}

          {/* Exclusion zones */}
          {exclusionZones.map(z => {
            const rect = (z as any).gridRect;
            if (!rect) return null;
            return (
              <g key={z.id}>
                <rect x={ftToPx(rect.xFt)} y={ftToPx(rect.yFt)} width={ftToPx(rect.wFt)} height={ftToPx(rect.hFt)}
                  fill="#9ca3af" fillOpacity={0.25} stroke="#6b7280" strokeWidth={2} strokeDasharray="8,4" rx={4} />
                <text x={ftToPx(rect.xFt + rect.wFt / 2)} y={ftToPx(rect.yFt + rect.hFt / 2)}
                  textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#374151" fontWeight="500">{z.label}</text>
              </g>
            );
          })}

          {/* Existing trees */}
          {existingTrees.map(t => {
            const xFt = (t as any).gridXFt ?? latLngToFt(t.lat, t.lng).xFt;
            const yFt = (t as any).gridYFt ?? latLngToFt(t.lat, t.lng).yFt;
            const radiusPx = ftToPx(t.canopyDiameterFt / 2);
            return (
              <g key={t.id}>
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={radiusPx}
                  fill="#166534" fillOpacity={0.15} stroke="#166534" strokeWidth={2} strokeOpacity={0.5} />
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={5} fill="#78350f" stroke="white" strokeWidth={2} />
                <text x={ftToPx(xFt)} y={ftToPx(yFt) - radiusPx - 6}
                  textAnchor="middle" fontSize="10" fill={showSatellite ? 'white' : '#166534'} fontWeight="500">{t.label}</text>
              </g>
            );
          })}

          {/* Plant placements */}
          {plants.filter(p => p.lat && p.lng).map((p, i) => {
            const { xFt, yFt } = latLngToFt(p.lat!, p.lng!);
            const radiusPx = ftToPx((p.spreadInches || 24) / 24);
            const color = getPlantColor(p.bloomColor);
            const isSelected = selectedSlug === p.plantSlug;

            if (xFt < -2 || xFt > widthFt + 2 || yFt < -2 || yFt > heightFt + 2) return null;

            return (
              <g key={`${p.plantSlug}-${i}`}
                onClick={() => onPlantClick?.(p.plantSlug)}
                style={{ cursor: onPlantClick ? 'pointer' : 'default' }}>
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={Math.max(radiusPx, 8)}
                  fill={color} fillOpacity={0.75}
                  stroke={isSelected ? '#000' : 'rgba(255,255,255,0.9)'} strokeWidth={isSelected ? 2.5 : 1.5} />
                <text x={ftToPx(xFt)} y={ftToPx(yFt) + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="9" fill="white" fontWeight="bold">
                  {p.speciesIndex || ''}
                </text>
              </g>
            );
          })}

          {/* North arrow */}
          <g transform={`translate(${svgWidth - 30}, 30)`}>
            <circle cx={0} cy={0} r={18} fill="rgba(0,0,0,0.4)" />
            <polygon points="0,-12 4,2 -4,2" fill="white" />
            <text x={0} y={14} textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">N</text>
          </g>

          {/* Shadow legend */}
          {showShadows && shadowPolygons.length > 0 && (
            <g transform={`translate(8, ${svgHeight - 28})`}>
              <rect x={0} y={0} width={90} height={20} rx={3} fill="rgba(0,0,0,0.5)" />
              <rect x={4} y={5} width={12} height={10} fill="#1a2e4a" fillOpacity={0.7} />
              <text x={20} y={14} fontSize="9" fill="white">{formatHour(shadowHour)} shadow</text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
