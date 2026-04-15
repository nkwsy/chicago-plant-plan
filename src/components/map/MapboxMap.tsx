'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import SunCalc from 'suncalc';
import type { ExclusionZone, ExistingTree, SunGrid } from '@/types/plan';

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
  height?: string;
  style?: 'satellite' | 'streets' | 'satellite-streets';
  sunGrid?: SunGrid | null;
  showSunGrid?: boolean;
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

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos(41.88 * Math.PI / 180);
const FT_TO_M = 0.3048;
const CELL_FT = 5;

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
  plantData: GeoJSON.FeatureCollection,
  exclusionData: GeoJSON.FeatureCollection,
  treeData: GeoJSON.FeatureCollection,
  areaOutline: GeoJSON.Polygon | null | undefined,
  show3D: boolean,
  sunGridData?: GeoJSON.FeatureCollection | null,
  showSunGrid?: boolean,
) {
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
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.6)',
      'text-halo-width': 1,
    },
  });

  // Click interaction
  map.on('click', 'plant-circles', (e) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties;
    new mapboxgl.Popup({ offset: 10, closeButton: false })
      .setLngLat(e.lngLat)
      .setHTML(`<div style="padding:6px 10px;font-size:13px;"><strong>${props?.name}</strong></div>`)
      .addTo(map);
  });
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
  height = '100%', style = 'satellite-streets',
  sunGrid, showSunGrid = false,
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

      addMapLayers(
        map,
        buildPlantGeoJSON(plantPlacementsRef.current),
        buildExclusionGeoJSON(exclusionZonesRef.current),
        buildTreeGeoJSON(existingTreesRef.current),
        areaOutline,
        show3D,
        sunGridRef.current ? buildSunGridGeoJSON(sunGridRef.current) : null,
        showSunGrid,
      );

      // Sun lighting
      if (showSunlight) updateSunPosition(map, center[0], center[1], sunHour);

      // Plant click handler
      map.on('click', 'plant-circles', (e) => {
        const slug = e.features?.[0]?.properties?.slug;
        if (slug && onPlantClick) onPlantClick(slug);
      });

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
          buildPlantGeoJSON(plantPlacementsRef.current),
          buildExclusionGeoJSON(exclusionZonesRef.current),
          buildTreeGeoJSON(existingTreesRef.current),
          areaOutline,
          show3D,
          sunGridRef.current ? buildSunGridGeoJSON(sunGridRef.current) : null,
          showSunGrid,
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

        if (editModeRef.current === 'exclusion') {
          draw.deleteAll();
          onExclusionZoneCreated?.({
            id: `excl-${Date.now()}`, geoJson: feature.geometry as GeoJSON.Polygon,
            label: 'Excluded Area', type: 'other',
          });
          return;
        }

        // Planting area
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
      }

      map.on('draw.create', handleDrawUpdate);
      map.on('draw.update', handleDrawUpdate);
    }

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layersAddedRef.current = false; };
  }, []);

  // Update plant data when it changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      try {
        const src = map.getSource('plants') as mapboxgl.GeoJSONSource;
        if (src) src.setData(buildPlantGeoJSON(plantPlacements));
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

  // Toggle sun grid visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      if (map.getLayer('sun-grid-fill')) {
        map.setPaintProperty('sun-grid-fill', 'fill-opacity', showSunGrid ? 0.7 : 0);
      }
      if (map.getLayer('sun-grid-lines')) {
        map.setPaintProperty('sun-grid-lines', 'line-opacity', showSunGrid ? 1 : 0);
      }
      if (map.getLayer('sun-grid-labels')) {
        map.setPaintProperty('sun-grid-labels', 'text-opacity', showSunGrid ? 1 : 0);
      }
    } catch { /* layers may not exist yet */ }
  }, [showSunGrid]);

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
      {showDrawControls && editMode === 'none' && (
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
            <div className="mt-2 bg-white rounded-lg shadow-lg p-3 w-56">
              <div className="text-xs font-medium text-gray-600 mb-2">Time: {formatHour(sunHour)}</div>
              <input type="range" min={5} max={21} step={0.5} value={sunHour}
                onChange={(e) => setSunHour(parseFloat(e.target.value))} className="w-full accent-amber-500" />
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
