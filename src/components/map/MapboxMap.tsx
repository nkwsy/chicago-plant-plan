'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import SunCalc from 'suncalc';
import type { ExclusionZone, ExistingTree } from '@/types/plan';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
mapboxgl.accessToken = MAPBOX_TOKEN;

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
}

const STYLE_URLS: Record<string, string> = {
  'satellite': 'mapbox://styles/mapbox/satellite-v9',
  'satellite-streets': 'mapbox://styles/mapbox/satellite-streets-v12',
  'streets': 'mapbox://styles/mapbox/streets-v12',
};

// Convert spread in inches to meters for circle radius
function inchesToMeters(inches: number): number {
  return (inches / 2) / 39.37; // radius in meters
}

export default function MapboxMap({
  center = [41.8781, -87.6298],
  zoom = 11,
  pitch = 0,
  bearing = 0,
  onAreaSelected,
  onLocationSelected,
  showDrawControls = false,
  showSearch = true,
  show3D = false,
  showSunlight = false,
  plantPlacements = [],
  planMarkers = [],
  onPlantClick,
  onPlanMarkerClick,
  areaOutline,
  exclusionZones = [],
  existingTrees = [],
  editMode = 'none',
  onExclusionZoneCreated,
  onExistingTreePlaced,
  height = '100%',
  style = 'satellite-streets',
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const planMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [mapStyle, setMapStyle] = useState(style);
  const [sunHour, setSunHour] = useState(12);
  const [showSunPanel, setShowSunPanel] = useState(false);
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !MAPBOX_TOKEN) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLE_URLS[mapStyle],
      center: [center[1], center[0]],
      zoom,
      pitch: showDrawControls ? 0 : (show3D ? 45 : pitch),
      bearing,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 150 }), 'bottom-left');

    map.on('load', () => {
      // 3D buildings
      if (show3D || zoom >= 15) {
        const layers = map.getStyle().layers;
        const labelLayerId = layers?.find(l => l.type === 'symbol' && l.layout?.['text-field'])?.id;
        map.addLayer({
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#ddd',
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'min_height'],
            'fill-extrusion-opacity': 0.7,
          },
        }, labelLayerId);
      }

      // Area outline
      if (areaOutline) {
        map.addSource('area-outline', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: areaOutline },
        });
        map.addLayer({ id: 'area-outline-fill', type: 'fill', source: 'area-outline',
          paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'area-outline-line', type: 'line', source: 'area-outline',
          paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-dasharray': [3, 2] } });
      }

      // Plant circles layer (GeoJSON)
      map.addSource('plants', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // Plant fill circles — sized by spread
      // At zoom 19, 1 meter ≈ 2.4 px. Circle-radius = radiusMeters * metersToPixels(zoom)
      // metersToPixels ≈ 256 * 2^zoom / (40075016.686 * cos(lat))
      // At 41.88N: z16=4.8, z17=9.6, z18=19.2, z19=38.4, z20=76.8, z21=153.6
      map.addLayer({
        id: 'plant-circles',
        type: 'circle',
        source: 'plants',
        paint: {
          'circle-radius': [
            'interpolate', ['exponential', 2], ['zoom'],
            16, ['*', ['get', 'radiusMeters'], 5],
            17, ['*', ['get', 'radiusMeters'], 10],
            18, ['*', ['get', 'radiusMeters'], 20],
            19, ['*', ['get', 'radiusMeters'], 40],
            20, ['*', ['get', 'radiusMeters'], 80],
            21, ['*', ['get', 'radiusMeters'], 160],
          ],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.6,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.85)',
        },
      });

      // Species index labels
      map.addLayer({
        id: 'plant-labels',
        type: 'symbol',
        source: 'plants',
        layout: {
          'text-field': ['to-string', ['get', 'speciesIndex']],
          'text-size': 11,
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 1,
        },
      });

      // Exclusion zones layer
      map.addSource('exclusions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'exclusion-fill', type: 'fill', source: 'exclusions',
        paint: { 'fill-color': '#9ca3af', 'fill-opacity': 0.35 } });
      map.addLayer({ id: 'exclusion-line', type: 'line', source: 'exclusions',
        paint: { 'line-color': '#6b7280', 'line-width': 2, 'line-dasharray': [4, 2] } });
      map.addLayer({ id: 'exclusion-labels', type: 'symbol', source: 'exclusions',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
        paint: { 'text-color': '#374151', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 } });

      // Existing trees layer
      map.addSource('existing-trees', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      // Canopy
      map.addLayer({
        id: 'tree-canopy',
        type: 'circle',
        source: 'existing-trees',
        paint: {
          'circle-radius': [
            'interpolate', ['exponential', 2], ['zoom'],
            16, ['*', ['get', 'canopyRadiusMeters'], 5],
            17, ['*', ['get', 'canopyRadiusMeters'], 10],
            18, ['*', ['get', 'canopyRadiusMeters'], 20],
            19, ['*', ['get', 'canopyRadiusMeters'], 40],
            20, ['*', ['get', 'canopyRadiusMeters'], 80],
            21, ['*', ['get', 'canopyRadiusMeters'], 160],
          ],
          'circle-color': '#166534',
          'circle-opacity': 0.2,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#166534',
          'circle-stroke-opacity': 0.5,
        },
      });
      // Trunk
      map.addLayer({
        id: 'tree-trunk',
        type: 'circle',
        source: 'existing-trees',
        paint: { 'circle-radius': 5, 'circle-color': '#78350f', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
      });
      map.addLayer({ id: 'tree-labels', type: 'symbol', source: 'existing-trees',
        layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -2],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
        paint: { 'text-color': '#166534', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 1.5 } });

      // Sunlight
      if (showSunlight) updateSunPosition(map, center[0], center[1], sunHour);

      // Plant click interaction
      map.on('click', 'plant-circles', (e) => {
        if (!e.features?.length) return;
        const slug = e.features[0].properties?.slug;
        if (slug && onPlantClick) onPlantClick(slug);
      });
      map.on('mouseenter', 'plant-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'plant-circles', () => { map.getCanvas().style.cursor = ''; });

      // Tree placement mode
      map.on('click', (e) => {
        if (editModeRef.current !== 'tree') return;
        const tree: ExistingTree = {
          id: `tree-${Date.now()}`,
          lat: e.lngLat.lat,
          lng: e.lngLat.lng,
          canopyDiameterFt: 20,
          label: 'Existing Tree',
        };
        onExistingTreePlaced?.(tree);
      });
    });

    // MapboxDraw for planting area + exclusion zones
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
          // Exclusion zone
          const zone: ExclusionZone = {
            id: `excl-${Date.now()}`,
            geoJson: feature.geometry as GeoJSON.Polygon,
            label: 'Excluded Area',
            type: 'other',
          };
          draw.deleteAll();
          onExclusionZoneCreated?.(zone);
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
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Update plant placement GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function updatePlants() {
      const src = map!.getSource('plants') as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;

    const features = plantPlacements.map(p => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: {
        slug: p.slug,
        name: p.name,
        color: getPlantColor(p.color),
        speciesIndex: p.speciesIndex || 0,
        radiusMeters: p.spreadInches ? inchesToMeters(p.spreadInches) : 0.5,
        plantType: p.plantType || 'forb',
      },
    }));

      src.setData({ type: 'FeatureCollection', features });
    }

    if (map.isStyleLoaded()) updatePlants();
    else map.once('style.load', updatePlants);
  }, [plantPlacements]);

  // Update exclusion zones GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function update() {
      const src = map!.getSource('exclusions') as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({ type: 'FeatureCollection', features: exclusionZones.map(z => ({
        type: 'Feature' as const, geometry: z.geoJson, properties: { label: z.label, type: z.type },
      })) });
    }
    if (map.isStyleLoaded()) update(); else map.once('style.load', update);
  }, [exclusionZones]);

  // Update existing trees GeoJSON
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function update() {
      const src = map!.getSource('existing-trees') as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({ type: 'FeatureCollection', features: existingTrees.map(t => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [t.lng, t.lat] },
        properties: { label: t.label, canopyRadiusMeters: (t.canopyDiameterFt / 2) * 0.3048 },
      })) });
    }
    if (map.isStyleLoaded()) update(); else map.once('style.load', update);
  }, [existingTrees]);

  // Plan markers (community map)
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
    if (!map || !showSunlight) return;
    if (map.isStyleLoaded()) updateSunPosition(map, center[0], center[1], sunHour);
    else map.once('style.load', () => updateSunPosition(map, center[0], center[1], sunHour));
  }, [sunHour, showSunlight]);

  function switchStyle(newStyle: string) {
    if (!mapRef.current) return;
    mapRef.current.setStyle(STYLE_URLS[newStyle]);
    setMapStyle(newStyle as any);
    // Re-add sources/layers after style change
    mapRef.current.once('style.load', () => {
      // Sources will be re-added on next useEffect cycle via setData
    });
  }

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || !mapRef.current) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}&bbox=-88.5,41.4,-87.2,42.2&limit=5`
      );
      const data = await res.json();
      const features = data?.features || [];
      setSearchResults(features);
      if (features.length > 0) {
        const [lng, lat] = features[0].center;
        mapRef.current.flyTo({ center: [lng, lat], zoom: 19, pitch: show3D ? 45 : 0 });
        onLocationSelected?.(lat, lng, features[0].place_name);
      }
    } catch (e) { console.error('Search error:', e); }
    finally { setSearching(false); }
  }, [searchQuery, onLocationSelected, show3D]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden" />

      {/* Style toggle */}
      <div className="absolute bottom-20 right-3 z-10 flex flex-col gap-1">
        {[
          { key: 'streets', label: 'Map' },
          { key: 'satellite-streets', label: 'Hybrid' },
          { key: 'satellite', label: 'Satellite' },
        ].map(s => (
          <button key={s.key} onClick={() => switchStyle(s.key)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg shadow-md transition-all ${
              mapStyle === s.key ? 'bg-white text-gray-800 ring-2 ring-primary' : 'bg-white/90 text-gray-600 hover:bg-white'
            }`}
          >{s.label}</button>
        ))}
      </div>

      {/* Draw hint */}
      {showDrawControls && editMode === 'none' && (
        <div className="absolute top-16 left-3 z-10 bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow text-xs text-gray-600 max-w-[240px]">
          Use the <strong>polygon tool</strong> (top-right) to draw your planting area. Click corners, double-click to finish.
        </div>
      )}

      {/* Edit mode indicators */}
      {editMode === 'exclusion' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-gray-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          Draw an exclusion zone (walkway, patio, etc). Double-click to finish.
        </div>
      )}
      {editMode === 'tree' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          Click on the map to place an existing tree.
        </div>
      )}

      {/* Sun control */}
      {showSunlight && (
        <div className="absolute top-3 right-16 z-10">
          <button onClick={() => setShowSunPanel(!showSunPanel)}
            className={`p-2.5 rounded-lg shadow-md transition-all ${showSunPanel ? 'bg-amber-500 text-white' : 'bg-white text-amber-600 hover:bg-amber-50'}`}
            title="Sun position"
          >
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
                  mapRef.current?.flyTo({ center: [lng, lat], zoom: 19, pitch: show3D ? 45 : 0 });
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
  const azimuth = sunPos.azimuth * (180 / Math.PI) + 180;
  if (altitude > 0) {
    map.setLight({ anchor: 'map', position: [1.5, azimuth, altitude], intensity: 0.4, color: altitude < 15 ? '#ff9944' : '#ffffff' });
  } else {
    map.setLight({ anchor: 'map', position: [1.5, 0, 0], intensity: 0.1, color: '#334466' });
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
