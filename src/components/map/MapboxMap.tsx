'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import SunCalc from 'suncalc';
import type { ExclusionZone, ExistingTree, SunGrid, SunGridCell } from '@/types/plan';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface PlantPlacement {
  lat: number; lng: number; color: string; name: string; slug: string;
  imageUrl?: string; spreadInches?: number; speciesIndex?: number; plantType?: string;
}

interface MapboxMapProps {
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  onAreaSelected?: (geoJson: GeoJSON.Polygon, center: [number, number], areaSqFt: number) => void;
  onLocationSelected?: (lat: number, lng: number, address: string) => void;
  showDrawControls?: boolean;
  showSearch?: boolean;
  show3D?: boolean;
  showSunlight?: boolean;
  plantPlacements?: PlantPlacement[];
  planMarkers?: { lat: number; lng: number; title: string; id: string }[];
  onPlantClick?: (slug: string) => void;
  onPlanMarkerClick?: (id: string) => void;
  areaOutline?: GeoJSON.Polygon | null;
  exclusionZones?: ExclusionZone[];
  existingTrees?: ExistingTree[];
  editMode?: 'none' | 'exclusion' | 'tree';
  onExclusionZoneCreated?: (zone: ExclusionZone) => void;
  onExistingTreePlaced?: (tree: ExistingTree) => void;
  /** Fires once per areaOutline change with any buildings the map finds near
   *  the drawn area. The parent decides whether to append them to
   *  exclusionZones (typically yes — auto-detection is what makes the
   *  sun-grid match the animated 3D shadows). */
  onBuildingsDetected?: (zones: ExclusionZone[]) => void;
  height?: string;
  style?: 'satellite' | 'streets' | 'satellite-streets';
  sunGrid?: SunGrid | null;
  showSunGrid?: boolean;
  detectBuildingsRef?: React.MutableRefObject<(() => ExclusionZone[]) | null>;
  computeSunGridRef?: React.MutableRefObject<(() => Promise<SunGrid | null>) | null>;
  /**
   * How to draw plant placements:
   *  - 'numbered': crisp circles with a species number inside — designer/build
   *    view, legible at close zoom (the default).
   *  - 'tapestry': blurred, soft-edged color blobs with no labels — evokes a
   *    Piet Oudolf planting render, so the user can judge the overall
   *    color/texture flow before committing. No stroke, higher blur.
   */
  plantRenderMode?: 'numbered' | 'tapestry';
}

const STYLE_URLS: Record<string, string> = {
  'satellite': 'mapbox://styles/mapbox/satellite-v9',
  'satellite-streets': 'mapbox://styles/mapbox/satellite-streets-v12',
  'streets': 'mapbox://styles/mapbox/streets-v12',
};

function inchesToMeters(inches: number): number {
  return (inches / 2) / 39.37;
}

function buildPlantGeoJSON(placements: PlantPlacement[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: placements.map(p => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: {
        slug: p.slug, name: p.name,
        color: getPlantColor(p.color),
        speciesIndex: p.speciesIndex || 0,
        radiusMeters: p.spreadInches ? inchesToMeters(p.spreadInches) : 0.3,
        plantType: p.plantType || 'forb',
      },
    })),
  };
}

function buildExclusionGeoJSON(zones: ExclusionZone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map(z => ({
      type: 'Feature' as const, geometry: z.geoJson, properties: { label: z.label, type: z.type },
    })),
  };
}

function buildTreeGeoJSON(trees: ExistingTree[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: trees.map(t => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [t.lng, t.lat] },
      properties: { label: t.label, canopyRadiusMeters: (t.canopyDiameterFt / 2) * 0.3048 },
    })),
  };
}

// --- Tapestry (Oudolf-style) rendering -------------------------------------
// Replaces the numbered-circle view with irregular organic blob polygons
// drawn in a saturated planting-plan palette with a 2-3 letter species
// abbreviation label. The look targets Piet Oudolf's hand-drawn plans:
// neighbouring drifts just overlap, colors are bold, labels are small.

function hashString(s: string): number {
  // FNV-1a — cheap deterministic integer hash so the same plant always gets
  // the same shape and color between renders (no shape flicker on regen).
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

function speciesAbbrev(slug: string | undefined, name: string): string {
  // Prefer the first slug segment (usually a genus in slug form), falling
  // back to the common-name initials. Oudolf plans use 3-letter genus
  // abbrevs like ECH, MOL, AST.
  const first = (slug || '').split('-')[0];
  if (first && first.length >= 3) return first.slice(0, 3).toUpperCase();
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

// Saturated planting-plan palette chosen to read like an Oudolf watercolor:
// lime, mustard, coral, magenta, purple, teal, terracotta, sage. Avoid
// muddy browns — tapestry needs visual pop.
const OUDOLF_PALETTE = [
  '#c9d13a', '#f6c845', '#ea5e52', '#9b4a92', '#74b340',
  '#ee7a70', '#d6934c', '#c16a9a', '#e7a2bd', '#7f6ba2',
  '#cfd56f', '#f8a94c', '#6bbeb8', '#b56363', '#d8d080',
  '#83a66e', '#e5ca4a', '#d27c48', '#89b995', '#bc8ab8',
];

function tapestryColor(speciesIdx: number, slug: string): string {
  // Bias the palette pick with a slug hash so neighbouring legend indices
  // don't always land on adjacent palette entries.
  const idx = (speciesIdx + hashString(slug || '')) % OUDOLF_PALETTE.length;
  return OUDOLF_PALETTE[idx];
}

function buildTapestryGeoJSON(placements: PlantPlacement[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: placements.map((p, i) => {
      // Oversize the blob relative to actual spread so neighbours just overlap
      // into a drift — discrete dots would read as "numbered" again.
      const baseR = (p.spreadInches ? inchesToMeters(p.spreadInches) : 0.3) * 1.35;
      const seed = hashString(p.slug || `p${i}`);
      const nV = 14;
      const coords: [number, number][] = [];
      for (let j = 0; j < nV; j++) {
        const ang = (j / nV) * Math.PI * 2;
        // Two-octave sine "noise" keyed off the seed — cheap, no dependency,
        // gives a believable irregular outline.
        const n1 = Math.sin(seed * 0.013 + j * 0.9) * 0.28;
        const n2 = Math.sin(seed * 0.029 + j * 2.1) * 0.14;
        const r = baseR * (1 + n1 + n2);
        coords.push([
          p.lng + (Math.cos(ang) * r) / M_PER_DEG_LNG,
          p.lat + (Math.sin(ang) * r) / M_PER_DEG_LAT,
        ]);
      }
      coords.push(coords[0]);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [coords] },
        properties: {
          slug: p.slug,
          name: p.name,
          color: tapestryColor(p.speciesIndex || 0, p.slug),
          abbrev: speciesAbbrev(p.slug, p.name),
          speciesIndex: p.speciesIndex || 0,
          plantType: p.plantType || 'forb',
        },
      };
    }),
  };
}

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos(41.88 * Math.PI / 180);
const FT_TO_M = 0.3048;
const CELL_FT = 5;

/**
 * Build GeoJSON for tree shadow polygons at a given time of day.
 * Each tree casts a capsule-shaped shadow based on SunCalc position.
 */
function computeTreeShadowGeoJSON(
  trees: ExistingTree[], lat: number, lng: number, hour: number,
): GeoJSON.FeatureCollection {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
    Math.floor(hour), (hour % 1) * 60);
  const sunPos = SunCalc.getPosition(date, lat, lng);
  const altDeg = sunPos.altitude * (180 / Math.PI);

  if (altDeg <= 2 || trees.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const azDeg = sunPos.azimuth * (180 / Math.PI) + 180;
  const altRad = altDeg * Math.PI / 180;
  const shadowDir = ((azDeg + 180) % 360) * Math.PI / 180;
  const sdx = Math.sin(shadowDir);
  const sdy = Math.cos(shadowDir);

  return {
    type: 'FeatureCollection',
    features: trees.map(tree => {
      const hM = (tree.heightFt || tree.canopyDiameterFt * 1.5) * FT_TO_M;
      const rM = (tree.canopyDiameterFt / 2) * FT_TO_M;
      // 200m cap matches computeCellSunHours() in src/lib/analysis/sun-grid.ts
      // so the animated silhouette and the numeric sun-hours agree on how far
      // a tall tree's shadow reaches at low sun angles.
      const shadowDist = Math.min(hM / Math.tan(altRad), 200);

      // Capsule shape: semicircle at tree (sun-side) + semicircle at shadow tip
      const coords: [number, number][] = [];
      const n = 12;
      const baseAngle = Math.atan2(-sdx, -sdy);

      for (let i = 0; i <= n; i++) {
        const a = baseAngle - Math.PI / 2 + (i / n) * Math.PI;
        coords.push([
          tree.lng + Math.cos(a) * rM / M_PER_DEG_LNG,
          tree.lat + Math.sin(a) * rM / M_PER_DEG_LAT,
        ]);
      }
      const tipAngle = Math.atan2(sdx, sdy);
      for (let i = 0; i <= n; i++) {
        const a = tipAngle - Math.PI / 2 + (i / n) * Math.PI;
        coords.push([
          tree.lng + (sdx * shadowDist + Math.cos(a) * rM) / M_PER_DEG_LNG,
          tree.lat + (sdy * shadowDist + Math.sin(a) * rM) / M_PER_DEG_LAT,
        ]);
      }
      coords.push(coords[0]);

      return {
        type: 'Feature' as const,
        geometry: { type: 'Polygon' as const, coordinates: [coords] },
        properties: { label: tree.label || 'Tree shadow' },
      };
    }),
  };
}

/**
 * Compute fraction of daylight hours a cell is shadowed by trees.
 * Samples 24 half-hour intervals across summer solstice using SunCalc.
 * Returns 0.0 (no shadow) to 1.0 (fully shadowed all day).
 */
function computeTreeShadowFraction(
  lat: number, lng: number, trees: ExistingTree[],
): number {
  if (trees.length === 0) return 0;
  const year = new Date().getFullYear();
  const date = new Date(Date.UTC(year, 5, 21));
  let sunSlots = 0;
  let shadowSlots = 0;

  for (let halfHour = 0; halfHour < 60; halfHour++) {
    const utcHour = halfHour / 2;
    const time = new Date(Date.UTC(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
      Math.floor(utcHour), (utcHour % 1) * 60,
    ));
    const sunPos = SunCalc.getPosition(time, lat, lng);
    const altDeg = sunPos.altitude * (180 / Math.PI);
    if (altDeg <= 2) continue;
    sunSlots++;

    const azDeg = sunPos.azimuth * (180 / Math.PI) + 180;
    const altRad = altDeg * Math.PI / 180;
    const bearRad = ((azDeg + 180) % 360) * Math.PI / 180;
    const sdx = Math.sin(bearRad), sdy = Math.cos(bearRad);
    const perpX = -sdy, perpY = sdx;

    for (const tree of trees) {
      const tx = (tree.lng - lng) * M_PER_DEG_LNG;
      const ty = (tree.lat - lat) * M_PER_DEG_LAT;
      const hM = (tree.heightFt || tree.canopyDiameterFt * 1.5) * FT_TO_M;
      const shadowLen = Math.min(hM / Math.tan(altRad), 200);
      const canopyR = tree.canopyDiameterFt / 2 * FT_TO_M;

      const dx = -tx, dy = -ty;
      const along = dx * sdx + dy * sdy;
      if (along < 0 || along > shadowLen) continue;
      const across = Math.abs(dx * perpX + dy * perpY);
      if (across < canopyR * 1.5) { shadowSlots++; break; }
    }
  }
  return sunSlots > 0 ? shadowSlots / sunSlots : 0;
}

function sunHoursToColor(hours: number): string {
  // Yellow (full sun) → Orange (part sun) → Blue-gray (part shade) → Dark blue (full shade)
  if (hours >= 6) return `rgba(255, 200, 0, 0.45)`;      // full sun — warm yellow
  if (hours >= 4) return `rgba(255, 140, 0, 0.45)`;       // part sun — orange
  if (hours >= 2) return `rgba(100, 140, 200, 0.45)`;     // part shade — cool blue
  return `rgba(50, 70, 130, 0.50)`;                        // full shade — deep blue
}

function buildSunGridGeoJSON(grid: SunGrid): GeoJSON.FeatureCollection {
  const halfLatDeg = (CELL_FT / 2) * FT_TO_M / M_PER_DEG_LAT;
  const halfLngDeg = (CELL_FT / 2) * FT_TO_M / M_PER_DEG_LNG;

  return {
    type: 'FeatureCollection',
    features: grid.cells
      .filter(c => !c.inExclusion)
      .map(cell => {
        const lat = cell.centerLat;
        const lng = cell.centerLng;
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [lng - halfLngDeg, lat - halfLatDeg],
              [lng + halfLngDeg, lat - halfLatDeg],
              [lng + halfLngDeg, lat + halfLatDeg],
              [lng - halfLngDeg, lat + halfLatDeg],
              [lng - halfLngDeg, lat - halfLatDeg],
            ]],
          },
          properties: {
            sunHours: cell.sunHours,
            sunCategory: cell.sunCategory,
            color: sunHoursToColor(cell.sunHours),
            underCanopy: cell.underCanopy,
            label: `${cell.sunHours}h`,
          },
        };
      }),
  };
}

// Meters-per-pixel at Chicago latitude for zoom levels
// Formula: 40075016.686 * cos(41.88°) / (256 * 2^zoom)
// z17=1.11, z18=0.556, z19=0.278, z20=0.139, z21=0.0694
function addMapLayers(
  map: mapboxgl.Map,
  plants: PlantPlacement[],
  exclusionData: GeoJSON.FeatureCollection,
  treeData: GeoJSON.FeatureCollection,
  areaOutline: GeoJSON.Polygon | null | undefined,
  show3D: boolean,
  sunGridData?: GeoJSON.FeatureCollection | null,
  showSunGrid?: boolean,
  plantRenderMode: 'numbered' | 'tapestry' = 'numbered',
) {
  // Build both representations up front — tapestry mode flips visibility
  // at runtime rather than tearing layers down, so both sources always live.
  const plantData = buildPlantGeoJSON(plants);
  const tapestryData = buildTapestryGeoJSON(plants);
  const tapestryOn = plantRenderMode === 'tapestry';
  // 3D buildings with shadow support
  if (show3D) {
    const layers = map.getStyle().layers;
    const labelLayerId = layers?.find(l => l.type === 'symbol' && l.layout?.['text-field'])?.id;
    try {
      map.addLayer({
        id: '3d-buildings', source: 'composite', 'source-layer': 'building',
        filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
        paint: {
          'fill-extrusion-color': '#ddd',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.75,
          'fill-extrusion-cast-shadows': true,
          'fill-extrusion-receive-shadows': true,
        } as any,
      }, labelLayerId);
    } catch (e) {
      // Fallback: add without shadow properties if not supported
      console.warn('3D buildings shadow setup failed, using fallback:', e);
      try {
        map.addLayer({
          id: '3d-buildings', source: 'composite', 'source-layer': 'building',
          filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
          paint: {
            'fill-extrusion-color': '#ddd',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.6,
          },
        }, labelLayerId);
      } catch { /* layer may already exist */ }
    }
  }

  // Area outline
  if (areaOutline) {
    map.addSource('area-outline', {
      type: 'geojson', data: { type: 'Feature', properties: {}, geometry: areaOutline },
    });
    map.addLayer({ id: 'area-outline-fill', type: 'fill', source: 'area-outline',
      paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'area-outline-line', type: 'line', source: 'area-outline',
      paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-dasharray': [3, 2] } });
  }

  // Sun grid heatmap overlay
  if (sunGridData) {
    map.addSource('sun-grid', { type: 'geojson', data: sunGridData });
    map.addLayer({
      id: 'sun-grid-fill', type: 'fill', source: 'sun-grid',
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': showSunGrid ? 0.7 : 0,
      },
    });
    map.addLayer({
      id: 'sun-grid-lines', type: 'line', source: 'sun-grid',
      paint: {
        'line-color': 'rgba(255,255,255,0.4)',
        'line-width': 0.5,
        'line-opacity': showSunGrid ? 1 : 0,
      },
    });
    map.addLayer({
      id: 'sun-grid-labels', type: 'symbol', source: 'sun-grid',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#fff',
        'text-halo-color': 'rgba(0,0,0,0.6)',
        'text-halo-width': 1,
        'text-opacity': showSunGrid ? 1 : 0,
      },
    });
  }

  // Tree shadow polygons (visual, updated with sun position)
  map.addSource('tree-shadows', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'tree-shadow-fill', type: 'fill', source: 'tree-shadows',
    paint: { 'fill-color': '#1a1a2e', 'fill-opacity': 0.25 },
  });

  // Exclusion zones
  map.addSource('exclusions', { type: 'geojson', data: exclusionData });
  map.addLayer({ id: 'exclusion-fill', type: 'fill', source: 'exclusions',
    paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.35 } });
  map.addLayer({ id: 'exclusion-line', type: 'line', source: 'exclusions',
    paint: { 'line-color': '#6b7280', 'line-width': 2, 'line-dasharray': [4, 2] } });
  map.addLayer({ id: 'exclusion-labels', type: 'symbol', source: 'exclusions',
    layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
    paint: { 'text-color': '#374151', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 } });

  // Existing trees — canopy + trunk + label
  map.addSource('existing-trees', { type: 'geojson', data: treeData });
  map.addLayer({
    id: 'tree-canopy', type: 'circle', source: 'existing-trees',
    paint: {
      'circle-radius': [
        'interpolate', ['exponential', 2], ['zoom'],
        17, ['*', ['get', 'canopyRadiusMeters'], 0.9],
        18, ['*', ['get', 'canopyRadiusMeters'], 1.8],
        19, ['*', ['get', 'canopyRadiusMeters'], 3.6],
        20, ['*', ['get', 'canopyRadiusMeters'], 7.2],
        21, ['*', ['get', 'canopyRadiusMeters'], 14.4],
      ],
      'circle-color': '#166534', 'circle-opacity': 0.2,
      'circle-stroke-width': 2, 'circle-stroke-color': '#166534', 'circle-stroke-opacity': 0.5,
    },
  });
  map.addLayer({ id: 'tree-trunk', type: 'circle', source: 'existing-trees',
    paint: { 'circle-radius': 5, 'circle-color': '#78350f', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'tree-labels', type: 'symbol', source: 'existing-trees',
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -2],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
    paint: { 'text-color': '#166534', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 } });

  // Plant circles — SIZED TO ACTUAL SPREAD
  // For a 20x20ft yard at zoom 19-20, a 24" spread plant should be clearly visible
  map.addSource('plants', { type: 'geojson', data: plantData });
  map.addLayer({
    id: 'plant-circles', type: 'circle', source: 'plants',
    layout: { 'visibility': tapestryOn ? 'none' : 'visible' },
    paint: {
      'circle-radius': [
        'interpolate', ['exponential', 2], ['zoom'],
        17, ['*', ['get', 'radiusMeters'], 0.9],
        18, ['*', ['get', 'radiusMeters'], 1.8],
        19, ['*', ['get', 'radiusMeters'], 3.6],
        20, ['*', ['get', 'radiusMeters'], 7.2],
        21, ['*', ['get', 'radiusMeters'], 14.4],
      ],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.65,
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255,255,255,0.9)',
    },
  });

  // Species number labels on top of circles
  map.addLayer({
    id: 'plant-labels', type: 'symbol', source: 'plants',
    layout: {
      'text-field': ['to-string', ['get', 'speciesIndex']],
      'text-size': 11,
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-allow-overlap': true,
      'visibility': tapestryOn ? 'none' : 'visible',
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.6)',
      'text-halo-width': 1,
    },
  });

  // --- Tapestry layers (Oudolf-style) --------------------------------------
  // Organic blob fill + thin dark stroke + short genus abbreviation. Lives
  // alongside plant-circles; render-mode effect toggles visibility.
  map.addSource('plant-blobs', { type: 'geojson', data: tapestryData });
  map.addLayer({
    id: 'plant-blob-fill', type: 'fill', source: 'plant-blobs',
    layout: { 'visibility': tapestryOn ? 'visible' : 'none' },
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.82,
      'fill-antialias': true,
    },
  });
  map.addLayer({
    id: 'plant-blob-stroke', type: 'line', source: 'plant-blobs',
    layout: { 'visibility': tapestryOn ? 'visible' : 'none' },
    paint: {
      'line-color': 'rgba(40,35,30,0.45)',
      'line-width': 0.7,
    },
  });
  map.addLayer({
    id: 'plant-blob-labels', type: 'symbol', source: 'plant-blobs',
    layout: {
      'text-field': ['get', 'abbrev'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        17, 8, 19, 10, 21, 13,
      ],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-placement': 'point',
      'visibility': tapestryOn ? 'visible' : 'none',
    },
    paint: {
      'text-color': '#1f1915',
      'text-halo-color': 'rgba(255,255,252,0.78)',
      'text-halo-width': 1.1,
      'text-halo-blur': 0.3,
    },
  });

  // Click interaction — parent supplies the popup via onPlantClick, so the
  // rendered card can show full plant details rather than the plain-name
  // tooltip Mapbox provides. Still flip the cursor so the plants feel
  // interactive.
  map.on('mouseenter', 'plant-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'plant-circles', () => { map.getCanvas().style.cursor = ''; });
}

export default function MapboxMap({
  center = [41.8781, -87.6298],
  zoom = 11, pitch = 0, bearing = 0,
  onAreaSelected, onLocationSelected,
  showDrawControls = false, showSearch = true,
  show3D = false, showSunlight = false,
  plantPlacements = [], planMarkers = [],
  onPlantClick, onPlanMarkerClick,
  areaOutline, exclusionZones = [], existingTrees = [],
  editMode = 'none', onExclusionZoneCreated, onExistingTreePlaced,
  onBuildingsDetected,
  height = '100%', style = 'satellite-streets',
  sunGrid, showSunGrid = false,
  detectBuildingsRef, computeSunGridRef,
  plantRenderMode = 'numbered',
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const planMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const layersAddedRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState(style);
  const [sunHour, setSunHour] = useState(12);
  const [showSunPanel, setShowSunPanel] = useState(false);
  const [animatingSun, setAnimatingSun] = useState(false);
  // Polygon drawn by the user in this session — tracked internally so the
  // location-step map (which doesn't pass areaOutline back as a prop) can
  // still feed the auto-detect-buildings effect.
  const [drawnArea, setDrawnArea] = useState<GeoJSON.Polygon | null>(null);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  // Store latest props in refs so the load callback can read them
  const plantPlacementsRef = useRef(plantPlacements);
  plantPlacementsRef.current = plantPlacements;
  const exclusionZonesRef = useRef(exclusionZones);
  exclusionZonesRef.current = exclusionZones;
  const existingTreesRef = useRef(existingTrees);
  existingTreesRef.current = existingTrees;
  const sunGridRef = useRef(sunGrid);
  sunGridRef.current = sunGrid;
  // Keep a live ref to the render mode so the one-shot load / style.load
  // callbacks pick up the current value (their closures deliberately capture
  // [] so they don't re-fire on every prop change).
  const plantRenderModeRef = useRef(plantRenderMode);
  plantRenderModeRef.current = plantRenderMode;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!MAPBOX_TOKEN) {
      setMapError('Mapbox token is missing. Set NEXT_PUBLIC_MAPBOX_TOKEN in your environment variables.');
      return;
    }

    // Set access token inside useEffect to ensure it runs in browser context
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLE_URLS[mapStyle],
      center: [center[1], center[0]],
      zoom,
      pitch: showDrawControls ? 0 : pitch,
      bearing, antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 150 }), 'bottom-left');

    map.on('load', () => {
      if (layersAddedRef.current) return;
      layersAddedRef.current = true;

      const sg = sunGridRef.current;
      const sgGeoJSON = sg ? buildSunGridGeoJSON(sg) : null;

      addMapLayers(
        map,
        plantPlacementsRef.current,
        buildExclusionGeoJSON(exclusionZonesRef.current),
        buildTreeGeoJSON(existingTreesRef.current),
        areaOutline,
        show3D,
        sgGeoJSON,
        showSunGrid,
        plantRenderModeRef.current,
      );

      // Sun lighting
      if (showSunlight) updateSunPosition(map, center[0], center[1], sunHour);

      // Plant click handlers — both renders delegate to the same callback,
      // so the floating plant card in the parent works regardless of mode.
      map.on('click', 'plant-circles', (e) => {
        const slug = e.features?.[0]?.properties?.slug;
        if (slug && onPlantClick) onPlantClick(slug);
      });
      map.on('click', 'plant-blob-fill', (e) => {
        const slug = e.features?.[0]?.properties?.slug;
        if (slug && onPlantClick) onPlantClick(slug);
      });
      map.on('mouseenter', 'plant-blob-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'plant-blob-fill', () => { map.getCanvas().style.cursor = ''; });

      // Tree placement click
      map.on('click', (e) => {
        if (editModeRef.current !== 'tree') return;
        onExistingTreePlaced?.({
          id: `tree-${Date.now()}`,
          lat: e.lngLat.lat, lng: e.lngLat.lng,
          canopyDiameterFt: 20, label: 'Existing Tree',
        });
      });
    });

    // Re-add layers on style change
    map.on('style.load', () => {
      if (!layersAddedRef.current) return;
      // Layers were already added once — re-add after style switch
      try {
        addMapLayers(
          map,
          plantPlacementsRef.current,
          buildExclusionGeoJSON(exclusionZonesRef.current),
          buildTreeGeoJSON(existingTreesRef.current),
          areaOutline,
          show3D,
          sunGridRef.current ? buildSunGridGeoJSON(sunGridRef.current) : null,
          showSunGrid,
          plantRenderModeRef.current,
        );
      } catch (e) { /* sources may already exist */ }
    });

    // MapboxDraw
    if (showDrawControls) {
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
        defaultMode: 'simple_select',
        styles: [
          { id: 'gl-draw-polygon-fill', type: 'fill', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.12 } },
          { id: 'gl-draw-polygon-stroke', type: 'line', filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
            paint: { 'line-color': '#16a34a', 'line-width': 3 } },
          { id: 'gl-draw-point', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex']],
            paint: { 'circle-radius': 6, 'circle-color': '#16a34a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
          { id: 'gl-draw-midpoint', type: 'circle', filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
            paint: { 'circle-radius': 4, 'circle-color': '#22c55e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
          { id: 'gl-draw-line', type: 'line', filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
            paint: { 'line-color': '#16a34a', 'line-width': 3, 'line-dasharray': [2, 2] } },
        ],
      });
      map.addControl(draw, 'top-right');
      drawRef.current = draw;

      function handleDrawUpdate() {
        const data = draw.getAll();
        if (!data?.features?.length) return;
        const feature = data.features[data.features.length - 1];
        if (feature.geometry.type !== 'Polygon') return;

        // If areaOutline exists, we're in plan-edit mode — all draws are exclusions
        if (editModeRef.current === 'exclusion' || areaOutline) {
          draw.deleteAll();
          onExclusionZoneCreated?.({
            id: `excl-${Date.now()}`, geoJson: feature.geometry as GeoJSON.Polygon,
            label: 'Excluded Area', type: 'other',
          });
          return;
        }

        // Planting area (only in location step when no areaOutline)
        const ids = data.features.map((f: any) => f.id);
        if (ids.length > 1) ids.slice(0, -1).forEach((id: string) => draw.delete(id));
        const polygon = feature.geometry as GeoJSON.Polygon;
        const coords = polygon.coordinates[0];
        const lats = coords.map(c => c[1]);
        const lngs = coords.map(c => c[0]);
        const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
        let area = 0;
        for (let i = 0; i < coords.length - 1; i++) {
          area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
        }
        area = Math.abs(area) / 2;
        const areaSqFt = Math.round(area * 111320 * 111320 * Math.cos(cLat * Math.PI / 180) * 10.7639);
        onAreaSelected?.(polygon, [cLat, cLng], areaSqFt);
        // Surface the drawn polygon internally too so the auto-detect effect
        // can fire on the location step (where areaOutline isn't passed back).
        setDrawnArea(polygon);
      }

      map.on('draw.create', handleDrawUpdate);
      map.on('draw.update', handleDrawUpdate);
    }

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layersAddedRef.current = false; };
  }, []);

  // Update plant data when it changes — both the numbered-circle source and
  // the tapestry blob source need to stay in lockstep so a mode toggle never
  // shows stale data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      try {
        const src = map.getSource('plants') as mapboxgl.GeoJSONSource;
        if (src) src.setData(buildPlantGeoJSON(plantPlacements));
        const tsrc = map.getSource('plant-blobs') as mapboxgl.GeoJSONSource;
        if (tsrc) tsrc.setData(buildTapestryGeoJSON(plantPlacements));
      } catch {}
    };
    if (map.isStyleLoaded() && layersAddedRef.current) update();
    else map.once('idle', update);
  }, [plantPlacements]);

  // Update exclusion zones
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      try {
        const src = map.getSource('exclusions') as mapboxgl.GeoJSONSource;
        if (src) src.setData(buildExclusionGeoJSON(exclusionZones));
      } catch {}
    };
    if (map.isStyleLoaded() && layersAddedRef.current) update();
    else map.once('idle', update);
  }, [exclusionZones]);

  // Update existing trees
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      try {
        const src = map.getSource('existing-trees') as mapboxgl.GeoJSONSource;
        if (src) src.setData(buildTreeGeoJSON(existingTrees));
      } catch {}
    };
    if (map.isStyleLoaded() && layersAddedRef.current) update();
    else map.once('idle', update);
  }, [existingTrees]);

  // Plan markers (community map — DOM markers)
  useEffect(() => {
    if (!mapRef.current) return;
    planMarkersRef.current.forEach(m => m.remove());
    planMarkersRef.current = [];
    planMarkers.forEach(pm => {
      const el = document.createElement('div');
      el.innerHTML = `<div style="background:#16a34a;width:30px;height:30px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;cursor:pointer;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 22V8M12 8C12 8 8 4 5 6C2 8 4 12 7 12C9 12 12 8 12 8ZM12 8C12 8 16 4 19 6C22 8 20 12 17 12C15 12 12 8 12 8Z"/></svg>
      </div>`;
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([pm.lng, pm.lat])
        .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(`<div style="padding:8px"><strong>${pm.title}</strong></div>`))
        .addTo(mapRef.current!);
      el.addEventListener('click', () => onPlanMarkerClick?.(pm.id));
      planMarkersRef.current.push(marker);
    });
  }, [planMarkers, onPlanMarkerClick]);

  // Sun position
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showSunlight) {
      // Reset lighting when sunlight disabled
      try {
        if (map.isStyleLoaded()) {
          try { (map as any).setLights(null); } catch { /* fallback */ }
          map.setLight({ anchor: 'viewport', intensity: 0.5, color: '#ffffff' });
          try { if (map.getLayer('sky')) map.removeLayer('sky'); } catch { /* ok */ }
        }
      } catch { /* style not loaded */ }
      return;
    }
    const update = () => updateSunPosition(map, center[0], center[1], sunHour);
    if (map.isStyleLoaded()) update();
    else map.once('style.load', update);
  }, [sunHour, showSunlight]);

  // Respond to pitch prop changes (top-down vs 3D toggle)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch, duration: 500 });
  }, [pitch]);

  // Toggle sun grid visibility — use a ref so we can also call from style.load
  const showSunGridRef = useRef(showSunGrid);
  showSunGridRef.current = showSunGrid;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Try immediately, also schedule for after style loads
    function applyGridVisibility() {
      const show = showSunGridRef.current;
      try {
        if (!map!.getLayer('sun-grid-fill')) return;
        map!.setPaintProperty('sun-grid-fill', 'fill-opacity', show ? 0.7 : 0);
        map!.setPaintProperty('sun-grid-lines', 'line-opacity', show ? 1 : 0);
        map!.setPaintProperty('sun-grid-labels', 'text-opacity', show ? 1 : 0);
      } catch { /* layers may not exist yet */ }
    }

    // Use a small delay to ensure layers are added after style.load
    const timer = setTimeout(applyGridVisibility, 100);
    return () => clearTimeout(timer);
  }, [showSunGrid]);

  // Auto-activate draw_polygon when editMode switches to 'exclusion'
  useEffect(() => {
    if (editMode === 'exclusion' && drawRef.current) {
      try { drawRef.current.changeMode('draw_polygon'); } catch {}
    }
  }, [editMode]);

  // Update tree shadow polygons when sun hour or trees change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !showSunlight) return;
    const update = () => {
      try {
        const src = map.getSource('tree-shadows') as mapboxgl.GeoJSONSource;
        if (src) {
          src.setData(computeTreeShadowGeoJSON(existingTrees, center[0], center[1], sunHour));
        }
      } catch {}
    };
    if (map.isStyleLoaded() && layersAddedRef.current) update();
    else map.once('idle', update);
  }, [sunHour, existingTrees, showSunlight]);

  // Sun animation: cycle sun hour from 5 AM to 9 PM
  useEffect(() => {
    if (animatingSun) {
      animationRef.current = setInterval(() => {
        setSunHour(prev => {
          const next = prev + 0.25;
          if (next > 21) {
            setAnimatingSun(false);
            return 5;
          }
          return next;
        });
      }, 150);
    }
    return () => {
      if (animationRef.current) clearInterval(animationRef.current);
    };
  }, [animatingSun]);

  // Swap between numbered circles (with species #s) and the Oudolf-style
  // tapestry blobs by flipping layer visibility. Both sources are populated
  // continuously in the plantPlacements effect so toggling is instant.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      try {
        const tapestry = plantRenderMode === 'tapestry';
        const vis = (id: string, show: boolean) => {
          if (map.getLayer(id))
            map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
        };
        vis('plant-circles', !tapestry);
        vis('plant-labels', !tapestry);
        vis('plant-blob-fill', tapestry);
        vis('plant-blob-stroke', tapestry);
        vis('plant-blob-labels', tapestry);
      } catch { /* layers may not exist yet */ }
    };
    if (map.isStyleLoaded() && layersAddedRef.current) apply();
    else map.once('idle', apply);
  }, [plantRenderMode]);

  // Update sun grid data source when sunGrid prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sunGrid) return;
    const update = () => {
      try {
        const src = map.getSource('sun-grid') as mapboxgl.GeoJSONSource;
        if (src) src.setData(buildSunGridGeoJSON(sunGrid));
      } catch {}
    };
    if (map.isStyleLoaded() && layersAddedRef.current) update();
    else map.once('idle', update);
  }, [sunGrid]);

  // Expose building detection via ref
  useEffect(() => {
    if (!detectBuildingsRef) return;
    detectBuildingsRef.current = () => {
      const map = mapRef.current;
      if (!map || !areaOutline) return [];

      // Query building footprints from rendered tiles
      const buildingLayers = map.getStyle().layers
        ?.filter(l => (l as any)['source-layer'] === 'building')
        .map(l => l.id) || [];
      const features = buildingLayers.length
        ? (map as any).queryRenderedFeatures({ layers: buildingLayers })
        : [];

      if (!features.length) return [];

      // Deduplicate by building ID and convert to ExclusionZones
      const seen = new Set<string>();
      const zones: ExclusionZone[] = [];
      for (const f of features) {
        const id = f.id?.toString() || JSON.stringify(f.geometry).substring(0, 50);
        if (seen.has(id)) continue;
        seen.add(id);
        if (f.geometry.type === 'Polygon') {
          const height = f.properties?.height
            || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.5 : null);
          zones.push({
            id: `bldg-${Date.now()}-${zones.length}`,
            geoJson: f.geometry as GeoJSON.Polygon,
            label: 'Building',
            type: 'building',
            heightMeters: height || 8,
          });
        }
      }
      return zones;
    };
  }, [areaOutline, detectBuildingsRef]);

  // Auto-detect nearby buildings the first time the user draws an area.
  // Previously this was a manual "Detect Buildings" button, which meant the
  // sun-hours numeric calc silently ignored every building visible on the
  // map (only visual 3D extrusions cast shadows). Auto-detecting the moment
  // the area is drawn is what makes the sun grid and the animated building
  // shadows agree — see bug 3 in the ticket. We only run this once per
  // area change, and we filter to buildings within ~100m of the garden
  // centroid so distant downtown buildings don't pollute the zone list.
  const autoDetectedForOutlineRef = useRef<GeoJSON.Polygon | null>(null);
  useEffect(() => {
    // Prefer the parent-provided outline; fall back to whatever the user
    // just drew on the map. Both cases want the same behavior — the first
    // time a real polygon becomes available, detect buildings once.
    const activeArea = areaOutline ?? drawnArea;
    if (!activeArea || !onBuildingsDetected) return;
    if (autoDetectedForOutlineRef.current === activeArea) return;
    const map = mapRef.current;
    if (!map) return;

    const run = () => {
      if (autoDetectedForOutlineRef.current === activeArea) return;
      autoDetectedForOutlineRef.current = activeArea;

      const coords = activeArea.coordinates[0];
      const latsArr = coords.map((c) => c[1]);
      const lngsArr = coords.map((c) => c[0]);
      const centerLat = (Math.min(...latsArr) + Math.max(...latsArr)) / 2;
      const centerLng = (Math.min(...lngsArr) + Math.max(...lngsArr)) / 2;

      const buildingLayers = map.getStyle().layers
        ?.filter((l) => (l as any)['source-layer'] === 'building')
        .map((l) => l.id) || [];
      if (!buildingLayers.length) return;
      const features = (map as any).queryRenderedFeatures({ layers: buildingLayers }) || [];

      const MAX_DIST_M = 100;
      const zones: ExclusionZone[] = [];
      const seen = new Set<string>();
      for (const f of features) {
        if (f.geometry?.type !== 'Polygon') continue;
        const id = f.id?.toString() || JSON.stringify(f.geometry).substring(0, 50);
        if (seen.has(id)) continue;
        seen.add(id);

        // Distance from garden centroid to nearest building vertex, in meters.
        const bCoords = (f.geometry as GeoJSON.Polygon).coordinates[0] || [];
        let minM = Infinity;
        for (const [blng, blat] of bCoords) {
          const dx = (blng - centerLng) * M_PER_DEG_LNG;
          const dy = (blat - centerLat) * M_PER_DEG_LAT;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < minM) minM = d;
        }
        if (minM > MAX_DIST_M) continue;

        const height = f.properties?.height
          || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.5 : null);
        zones.push({
          id: `bldg-auto-${Date.now()}-${zones.length}`,
          geoJson: f.geometry as GeoJSON.Polygon,
          label: 'Building',
          type: 'building',
          heightMeters: height || 8,
        });
      }

      if (zones.length) onBuildingsDetected(zones);
    };

    // The building layer only has queryable features once tiles have loaded.
    // `idle` fires after any style/tile activity settles, which is the safest
    // single signal — polling is brittle at drawing-time zooms.
    if (layersAddedRef.current) map.once('idle', run);
    else map.once('load', () => map.once('idle', run));
  }, [areaOutline, drawnArea, onBuildingsDetected]);

  // Compute sun grid using building polygons from Mapbox tiles + SunCalc ray-casting (free, no API key)
  useEffect(() => {
    if (!computeSunGridRef) return;
    computeSunGridRef.current = async () => {
      const map = mapRef.current;
      if (!map || !areaOutline) return null;

      // Detect building polygons from Mapbox vector tiles
      const buildingLayers = map.getStyle().layers
        ?.filter(l => (l as any)['source-layer'] === 'building')
        .map(l => l.id) || [];
      const features = buildingLayers.length
        ? (map as any).queryRenderedFeatures({ layers: buildingLayers })
        : [];

      // Convert buildings to ExclusionZones for ray-casting
      const detectedBuildings: ExclusionZone[] = [];
      const seen = new Set<string>();
      for (const f of features) {
        const id = f.id?.toString() || JSON.stringify(f.geometry).substring(0, 50);
        if (seen.has(id)) continue;
        seen.add(id);
        if (f.geometry.type === 'Polygon') {
          const h = f.properties?.height
            || (f.properties?.['building:levels'] ? f.properties['building:levels'] * 3.5 : null);
          detectedBuildings.push({
            id: `bldg-auto-${detectedBuildings.length}`,
            geoJson: f.geometry as GeoJSON.Polygon,
            label: 'Building', type: 'building',
            heightMeters: h || 8,
          });
        }
      }

      // Merge detected buildings with user-drawn exclusion zones
      const allExclusions = [
        ...exclusionZonesRef.current,
        ...detectedBuildings.filter(db =>
          !exclusionZonesRef.current.some(ez =>
            ez.type === 'building' && Math.abs(
              JSON.stringify(ez.geoJson).length - JSON.stringify(db.geoJson).length
            ) < 10
          )
        ),
      ];

      const coords = areaOutline.coordinates[0];
      const lats = coords.map(c => c[1]);
      const lngs = coords.map(c => c[0]);
      const bounds = {
        minLat: Math.min(...lats), maxLat: Math.max(...lats),
        minLng: Math.min(...lngs), maxLng: Math.max(...lngs),
      };

      // Use buildSunGrid with all building polygons + trees for accurate ray-casting
      const { buildSunGrid } = await import('@/lib/analysis/sun-grid');
      const trees = existingTreesRef.current;
      const grid = buildSunGrid(bounds, trees, [], allExclusions, areaOutline, null);
      return grid;
    };
  }, [areaOutline, computeSunGridRef]);

  function switchStyle(s: string) {
    if (!mapRef.current) return;
    mapRef.current.setStyle(STYLE_URLS[s]);
    setMapStyle(s as 'satellite' | 'streets' | 'satellite-streets');
  }

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !mapRef.current) return;
    setSearching(true); setSearchResults([]);
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}&bbox=-88.5,41.4,-87.2,42.2&limit=5`
      );
      const data = await res.json();
      const features = data?.features || [];
      setSearchResults(features);
      if (features.length > 0) {
        const [lng, lat] = features[0].center;
        mapRef.current.flyTo({ center: [lng, lat], zoom: 20, pitch: pitch });
        onLocationSelected?.(lat, lng, features[0].place_name);
      }
    } catch (e) { console.error(e); }
    finally { setSearching(false); }
  }, [searchQuery, onLocationSelected, show3D]);

  if (mapError) {
    return (
      <div className="w-full rounded-xl bg-stone-100 flex items-center justify-center" style={{ height }}>
        <div className="text-center p-6 max-w-sm">
          <svg className="w-10 h-10 mx-auto mb-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-red-600 font-medium">{mapError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden" />

      {/* Style toggle */}
      <div className="absolute bottom-20 right-3 z-10 flex flex-col gap-1">
        {[{ k: 'streets', l: 'Map' }, { k: 'satellite-streets', l: 'Hybrid' }, { k: 'satellite', l: 'Satellite' }].map(s => (
          <button key={s.k} onClick={() => switchStyle(s.k)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg shadow-md transition-all ${
              mapStyle === s.k ? 'bg-white text-gray-800 ring-2 ring-primary' : 'bg-white/90 text-gray-600 hover:bg-white'}`}
          >{s.l}</button>
        ))}
      </div>

      {/* Draw hint */}
      {showDrawControls && editMode === 'none' && !areaOutline && (
        <div className="absolute top-16 left-3 z-10 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow text-xs text-gray-600 max-w-[240px]">
          Use the <strong>polygon tool</strong> (top-right) to draw your planting area.
        </div>
      )}
      {editMode === 'exclusion' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-gray-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          Draw an exclusion zone. Double-click to finish.
        </div>
      )}
      {editMode === 'tree' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          Click to place an existing tree.
        </div>
      )}

      {/* Sun control */}
      {showSunlight && (
        <div className="absolute top-3 right-16 z-10">
          <button onClick={() => setShowSunPanel(!showSunPanel)}
            className={`p-2.5 rounded-lg shadow-md transition-all ${showSunPanel ? 'bg-amber-500 text-white' : 'bg-white text-amber-600 hover:bg-amber-50'}`}>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7a5 5 0 100 10 5 5 0 000-10zm0-5a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm0 18a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm9-9h1a1 1 0 110 2h-1a1 1 0 110-2zM3 12a1 1 0 110 2H2a1 1 0 110-2h1z" /></svg>
          </button>
          {showSunPanel && (
            <div className="mt-2 bg-white rounded-lg shadow-lg p-3 w-64">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-gray-600">Time: {formatHour(sunHour)}</div>
                <button
                  onClick={() => {
                    if (animatingSun) {
                      setAnimatingSun(false);
                    } else {
                      if (sunHour >= 20.5) setSunHour(5);
                      setAnimatingSun(true);
                    }
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-all ${
                    animatingSun
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  }`}
                >
                  {animatingSun ? (
                    <>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      Pause
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      Animate Sun
                    </>
                  )}
                </button>
              </div>
              <input type="range" min={5} max={21} step={0.25} value={sunHour}
                onChange={(e) => { setAnimatingSun(false); setSunHour(parseFloat(e.target.value)); }}
                className="w-full accent-amber-500" />
              <div className="flex justify-between text-xs text-gray-400 mt-1"><span>5 AM</span><span>9 PM</span></div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      {showSearch && (
        <div className="absolute top-3 left-3 right-24 z-10">
          <div className="flex bg-white rounded-lg shadow-lg overflow-hidden">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search address in Chicagoland..."
              className="flex-1 px-4 py-2.5 text-sm outline-none text-gray-800" />
            <button onClick={handleSearch} disabled={searching}
              className="px-4 bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
              {searching
                ? <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31" /></svg>
                : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>}
            </button>
          </div>
          {searchResults.length > 1 && (
            <div className="mt-1 bg-white rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {searchResults.map((r: any, i: number) => (
                <button key={i} onClick={() => {
                  const [lng, lat] = r.center;
                  mapRef.current?.flyTo({ center: [lng, lat], zoom: 20, pitch: pitch });
                  onLocationSelected?.(lat, lng, r.place_name);
                  setSearchResults([]);
                }} className="w-full text-left px-4 py-2 text-sm hover:bg-stone-50 border-b border-stone-100 last:border-0 text-gray-700"
                >{r.place_name}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function updateSunPosition(map: mapboxgl.Map, lat: number, lng: number, hour: number) {
  try { if (!map.isStyleLoaded()) return; } catch { return; }
  const date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), Math.floor(hour), (hour % 1) * 60);
  const sunPos = SunCalc.getPosition(date, lat, lng);
  const altitude = sunPos.altitude * (180 / Math.PI);
  // SunCalc azimuth: 0=south, clockwise. Convert to compass bearing (0=north).
  const azimuth = (sunPos.azimuth * (180 / Math.PI) + 180) % 360;

  // Use setLights() with directional + ambient for real shadow casting
  try {
    if (altitude > 0) {
      const warmth = altitude < 15 ? '#ff9944' : altitude < 30 ? '#ffe0b2' : '#ffffff';
      const ambientIntensity = 0.2 + Math.min(altitude / 90, 1) * 0.3;
      const directionalIntensity = 0.3 + Math.min(altitude / 60, 1) * 0.5;

      (map as any).setLights([
        { id: 'ambient', type: 'ambient', properties: { color: warmth, intensity: ambientIntensity } },
        {
          id: 'sun', type: 'directional', properties: {
            direction: [azimuth, altitude],
            color: warmth,
            intensity: directionalIntensity,
            'cast-shadows': true,
            'shadow-intensity': 0.6,
          },
        },
      ]);
    } else {
      (map as any).setLights([
        { id: 'ambient', type: 'ambient', properties: { color: '#334466', intensity: 0.3 } },
        {
          id: 'sun', type: 'directional', properties: {
            direction: [0, 5],
            color: '#334466',
            intensity: 0.05,
            'cast-shadows': false,
            'shadow-intensity': 0,
          },
        },
      ]);
    }
  } catch {
    // Fallback for older GL JS versions without setLights
    if (altitude > 0) {
      map.setLight({ anchor: 'map', position: [1.5, azimuth, altitude], intensity: 0.5, color: altitude < 15 ? '#ff9944' : '#ffffff' });
    } else {
      map.setLight({ anchor: 'map', position: [1.5, 0, 5], intensity: 0.15, color: '#334466' });
    }
  }

  // Update sky layer for atmospheric sun rendering
  try {
    if (map.getLayer('sky')) {
      map.setPaintProperty('sky', 'sky-atmosphere-sun', altitude > 0 ? [azimuth, altitude] : [0, 0]);
    } else if (altitude > 0) {
      map.addLayer({
        id: 'sky', type: 'sky' as any, paint: {
          'sky-type': 'atmosphere' as any,
          'sky-atmosphere-sun': [azimuth, altitude] as any,
          'sky-atmosphere-sun-intensity': 5,
          'sky-atmosphere-color': 'rgba(135, 206, 235, 0.5)' as any,
          'sky-atmosphere-halo-color': 'rgba(255, 200, 100, 0.4)' as any,
          'sky-opacity': 0.5,
        },
      });
    }
  } catch {
    // Sky layer not supported — skip
  }
}

function formatHour(h: number): string {
  const hour = Math.floor(h); const min = Math.round((h % 1) * 60);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${min.toString().padStart(2, '0')} ${ampm}`;
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#e2e8f0', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#fef3c7', rose: '#f43f5e',
    bronze: '#92400e', silver: '#9ca3af', rust: '#b45309', scarlet: '#b91c1c',
    tan: '#a8896c', brown: '#92400e',
  };
  return colors[bloomColor?.toLowerCase()] || '#9ca3af';
}
