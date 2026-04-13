'use client';

import type { PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';

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
}

const PX_PER_FT = 24;
const GRID_SPACING_FT = 2;

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

export default function GridPlanView({
  widthFt, heightFt, centerLat, centerLng,
  plants, exclusionZones = [], existingTrees = [],
  selectedSlug, onPlantClick,
}: GridPlanViewProps) {
  const svgWidth = widthFt * PX_PER_FT;
  const svgHeight = heightFt * PX_PER_FT;
  const ftToPx = (ft: number) => ft * PX_PER_FT;

  // Compute bounds from actual plant positions to auto-fit
  const plantsWithCoords = plants.filter(p => p.lat && p.lng);
  let minLat = centerLat, maxLat = centerLat, minLng = centerLng, maxLng = centerLng;
  if (plantsWithCoords.length > 0) {
    minLat = Math.min(...plantsWithCoords.map(p => p.lat!));
    maxLat = Math.max(...plantsWithCoords.map(p => p.lat!));
    minLng = Math.min(...plantsWithCoords.map(p => p.lng!));
    maxLng = Math.max(...plantsWithCoords.map(p => p.lng!));
    // Add padding
    const padLat = (maxLat - minLat) * 0.15 || 0.00002;
    const padLng = (maxLng - minLng) * 0.15 || 0.00002;
    minLat -= padLat; maxLat += padLat;
    minLng -= padLng; maxLng += padLng;
  }

  function latLngToFt(lat: number, lng: number): { xFt: number; yFt: number } {
    const latRange = maxLat - minLat || 0.0001;
    const lngRange = maxLng - minLng || 0.0001;
    const xFt = ((lng - minLng) / lngRange) * widthFt;
    const yFt = ((maxLat - lat) / latRange) * heightFt; // SVG y inverted
    return { xFt, yFt };
  }

  // Grid lines
  const gridLines: React.ReactElement[] = [];
  for (let x = 0; x <= widthFt; x += GRID_SPACING_FT) {
    gridLines.push(<line key={`v${x}`} x1={ftToPx(x)} y1={0} x2={ftToPx(x)} y2={svgHeight}
      stroke="#e5e7eb" strokeWidth={x % 10 === 0 ? 1.5 : 0.5} />);
  }
  for (let y = 0; y <= heightFt; y += GRID_SPACING_FT) {
    gridLines.push(<line key={`h${y}`} x1={0} y1={ftToPx(y)} x2={svgWidth} y2={ftToPx(y)}
      stroke="#e5e7eb" strokeWidth={y % 10 === 0 ? 1.5 : 0.5} />);
  }

  return (
    <div>
      <div className="border border-stone-300 rounded-xl overflow-hidden bg-white relative" style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-white px-2 py-0.5 text-xs font-medium text-muted z-10 rounded-b">
          {widthFt} ft
        </div>
        <div className="absolute top-1/2 right-0 -translate-y-1/2 bg-white px-2 py-0.5 text-xs font-medium text-muted z-10 rounded-l" style={{ writingMode: 'vertical-lr' }}>
          {heightFt} ft
        </div>

        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full" style={{ maxHeight: '500px' }}>
          <rect width={svgWidth} height={svgHeight} fill="#f0fdf4" />
          {gridLines}

          {/* Ft labels */}
          {Array.from({ length: Math.floor(widthFt / 5) + 1 }).map((_, i) => (
            <text key={`xl${i}`} x={ftToPx(i * 5)} y={svgHeight - 4} fontSize="10" fill="#9ca3af" textAnchor="middle">{i * 5}'</text>
          ))}
          {Array.from({ length: Math.floor(heightFt / 5) + 1 }).map((_, i) => (
            <text key={`yl${i}`} x={4} y={ftToPx(i * 5)} fontSize="10" fill="#9ca3af" dominantBaseline="middle">{i * 5}'</text>
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
            const xFt = (t as any).gridXFt ?? widthFt / 2;
            const yFt = (t as any).gridYFt ?? heightFt / 2;
            const radiusPx = ftToPx(t.canopyDiameterFt / 2);
            return (
              <g key={t.id}>
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={radiusPx}
                  fill="#166534" fillOpacity={0.12} stroke="#166534" strokeWidth={2} strokeOpacity={0.4} />
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={5} fill="#78350f" stroke="white" strokeWidth={2} />
                <text x={ftToPx(xFt)} y={ftToPx(yFt) - radiusPx - 6}
                  textAnchor="middle" fontSize="10" fill="#166534" fontWeight="500">{t.label}</text>
              </g>
            );
          })}

          {/* Plant placements — circles sized to spread */}
          {plants.filter(p => p.lat && p.lng).map((p, i) => {
            const { xFt, yFt } = latLngToFt(p.lat!, p.lng!);
            const radiusPx = ftToPx((p.spreadInches || 24) / 24); // inches to feet, then to px
            const color = getPlantColor(p.bloomColor);
            const isSelected = selectedSlug === p.plantSlug;

            // Skip if out of bounds
            if (xFt < -2 || xFt > widthFt + 2 || yFt < -2 || yFt > heightFt + 2) return null;

            return (
              <g key={`${p.plantSlug}-${i}`}
                onClick={() => onPlantClick?.(p.plantSlug)}
                style={{ cursor: onPlantClick ? 'pointer' : 'default' }}>
                <circle cx={ftToPx(xFt)} cy={ftToPx(yFt)} r={Math.max(radiusPx, 8)}
                  fill={color} fillOpacity={0.6}
                  stroke={isSelected ? '#000' : 'white'} strokeWidth={isSelected ? 2.5 : 1.5} />
                <text x={ftToPx(xFt)} y={ftToPx(yFt) + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="9" fill="white" fontWeight="bold"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                  {p.speciesIndex || ''}
                </text>
              </g>
            );
          })}

          {/* North arrow */}
          <g transform={`translate(${svgWidth - 30}, 30)`}>
            <polygon points="0,-15 5,0 -5,0" fill="#374151" />
            <text x={0} y={12} textAnchor="middle" fontSize="10" fill="#374151" fontWeight="bold">N</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
