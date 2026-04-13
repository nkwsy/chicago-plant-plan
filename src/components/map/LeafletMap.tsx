'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet-draw';

declare module 'leaflet' {
  namespace Control {
    class Draw extends L.Control {
      constructor(options?: any);
    }
  }
  namespace Draw {
    const Event: any;
  }
  namespace GeometryUtil {
    function geodesicArea(latLngs: L.LatLng[]): number;
  }
}

interface LeafletMapProps {
  center?: [number, number];
  zoom?: number;
  onAreaSelected?: (geoJson: GeoJSON.Polygon, center: [number, number], areaSqFt: number) => void;
  onLocationSelected?: (lat: number, lng: number, address: string) => void;
  showDrawControls?: boolean;
  showSearch?: boolean;
  showLayerToggle?: boolean;
  defaultSatellite?: boolean;
  markers?: { lat: number; lng: number; title: string; id: string }[];
  plantMarkers?: { lat: number; lng: number; color: string; name: string; slug: string }[];
  onMarkerClick?: (id: string) => void;
  onPlantClick?: (slug: string) => void;
  height?: string;
  drawnArea?: GeoJSON.Polygon | null;
  areaOutline?: GeoJSON.Polygon | null;
}

const TILE_LAYERS = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 20,
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 20,
  },
};

const LABEL_OVERLAY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export default function LeafletMap({
  center = [41.8781, -87.6298],
  zoom = 11,
  onAreaSelected,
  onLocationSelected,
  showDrawControls = false,
  showSearch = true,
  showLayerToggle = true,
  defaultSatellite = false,
  markers = [],
  plantMarkers = [],
  onMarkerClick,
  onPlantClick,
  height = '100%',
  drawnArea,
  areaOutline,
}: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const labelLayerRef = useRef<L.TileLayer | null>(null);
  const plantMarkersRef = useRef<L.LayerGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [activeLayer, setActiveLayer] = useState<'street' | 'satellite'>(defaultSatellite ? 'satellite' : 'street');

  const switchLayer = useCallback((layer: 'street' | 'satellite') => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    if (labelLayerRef.current) map.removeLayer(labelLayerRef.current);

    const config = layer === 'satellite' ? TILE_LAYERS.satellite : TILE_LAYERS.street;
    tileLayerRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
    }).addTo(map);

    // Add labels overlay on satellite
    if (layer === 'satellite') {
      labelLayerRef.current = L.tileLayer(LABEL_OVERLAY_URL, {
        maxZoom: 20,
        opacity: 0.7,
      }).addTo(map);
    }

    setActiveLayer(layer);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Initial tile layer
    const initialConfig = defaultSatellite ? TILE_LAYERS.satellite : TILE_LAYERS.street;
    tileLayerRef.current = L.tileLayer(initialConfig.url, {
      attribution: initialConfig.attribution,
      maxZoom: initialConfig.maxZoom,
    }).addTo(map);

    if (defaultSatellite) {
      labelLayerRef.current = L.tileLayer(LABEL_OVERLAY_URL, { maxZoom: 20, opacity: 0.7 }).addTo(map);
    }

    // Plant markers layer group
    plantMarkersRef.current = L.layerGroup().addTo(map);

    // Draw controls
    if (showDrawControls) {
      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawnItemsRef.current = drawnItems;

      const drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
          polygon: {
            allowIntersection: false,
            showArea: true,
            shapeOptions: { color: '#22c55e', weight: 3, fillOpacity: 0.1, fillColor: '#22c55e' },
          },
          rectangle: {
            shapeOptions: { color: '#22c55e', weight: 3, fillOpacity: 0.1, fillColor: '#22c55e' },
          },
          circle: false,
          circlemarker: false,
          marker: false,
          polyline: false,
        },
        edit: { featureGroup: drawnItems },
      });
      map.addControl(drawControl);

      map.on(L.Draw.Event.CREATED, (e: any) => {
        drawnItems.clearLayers();
        drawnItems.addLayer(e.layer);
        const geoJson = e.layer.toGeoJSON();
        const polygon = geoJson.geometry as GeoJSON.Polygon;
        const bounds = e.layer.getBounds();
        const c = bounds.getCenter();
        const areaSqM = L.GeometryUtil?.geodesicArea?.(e.layer.getLatLngs()[0]) || calculateArea(polygon.coordinates[0]);
        const areaSqFt = Math.round(areaSqM * 10.7639);
        onAreaSelected?.(polygon, [c.lat, c.lng], areaSqFt);
      });
    }

    mapRef.current = map;

    // Show existing drawn area
    if (drawnArea && drawnItemsRef.current) {
      const layer = L.geoJSON(drawnArea as any, {
        style: { color: '#22c55e', weight: 3, fillOpacity: 0.1 },
      });
      drawnItemsRef.current.addLayer(layer);
      map.fitBounds(layer.getBounds(), { padding: [50, 50] });
    }

    // Show area outline (for plan view)
    if (areaOutline) {
      L.geoJSON(areaOutline as any, {
        style: { color: '#22c55e', weight: 3, fillOpacity: 0.05, dashArray: '8,4' },
      }).addTo(map);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update plan markers
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const plantIcon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="background:#16a34a;width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 22V8M12 8C12 8 8 4 5 6C2 8 4 12 7 12C9 12 12 8 12 8ZM12 8C12 8 16 4 19 6C22 8 20 12 17 12C15 12 12 8 12 8Z"/></svg>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    markers.forEach(m => {
      const marker = L.marker([m.lat, m.lng], { icon: plantIcon })
        .addTo(map)
        .bindPopup(`<div class="p-2 font-sans"><strong>${m.title}</strong></div>`);
      if (onMarkerClick) marker.on('click', () => onMarkerClick(m.id));
    });
  }, [markers, onMarkerClick]);

  // Update plant overlay markers
  useEffect(() => {
    if (!plantMarkersRef.current) return;
    plantMarkersRef.current.clearLayers();

    plantMarkers.forEach(pm => {
      const color = getPlantColor(pm.color);
      const icon = L.divIcon({
        className: 'plant-dot',
        html: `<div style="
          width:22px;height:22px;border-radius:50%;
          background:${color};
          border:2px solid white;
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
          cursor:pointer;
          transition:transform 0.15s;
        " title="${pm.name}"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker([pm.lat, pm.lng], { icon }).addTo(plantMarkersRef.current!);
      marker.bindTooltip(pm.name, {
        direction: 'top',
        offset: [0, -12],
        className: 'plant-tooltip',
      });
      if (onPlantClick) marker.on('click', () => onPlantClick(pm.slug));
    });
  }, [plantMarkers, onPlantClick]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&limit=5&countrycodes=us&viewbox=-88.5,42.2,-87.2,41.4&bounded=1`,
        { headers: { 'User-Agent': 'ChicagoNativePlantPlanner/1.0' } }
      );
      const data = await response.json();
      setSearchResults(data);

      if (data.length > 0) {
        const { lat, lon, display_name } = data[0];
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lon);
        mapRef.current?.setView([latNum, lngNum], 19);
        onLocationSelected?.(latNum, lngNum, display_name);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, onLocationSelected]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden" />

      {/* Layer toggle */}
      {showLayerToggle && (
        <div className="absolute bottom-14 right-3 z-[1000] flex flex-col gap-1">
          <button
            onClick={() => switchLayer('street')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg shadow-md transition-all ${
              activeLayer === 'street'
                ? 'bg-white text-gray-800 ring-2 ring-primary'
                : 'bg-white/80 text-gray-600 hover:bg-white'
            }`}
          >
            Map
          </button>
          <button
            onClick={() => switchLayer('satellite')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg shadow-md transition-all ${
              activeLayer === 'satellite'
                ? 'bg-white text-gray-800 ring-2 ring-primary'
                : 'bg-white/80 text-gray-600 hover:bg-white'
            }`}
          >
            Satellite
          </button>
        </div>
      )}

      {/* Search */}
      {showSearch && (
        <div className="absolute top-3 left-3 right-16 z-[1000]">
          <div className="flex bg-white rounded-lg shadow-lg overflow-hidden">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search address in Chicagoland..."
              className="flex-1 px-4 py-2.5 text-sm outline-none text-gray-800"
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              className="px-4 bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {searching ? (
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              )}
            </button>
          </div>

          {searchResults.length > 1 && (
            <div className="mt-1 bg-white rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    const lat = parseFloat(r.lat);
                    const lng = parseFloat(r.lon);
                    mapRef.current?.setView([lat, lng], 19);
                    onLocationSelected?.(lat, lng, r.display_name);
                    setSearchResults([]);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-stone-50 border-b border-stone-100 last:border-0 text-gray-700"
                >
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function calculateArea(coords: number[][]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    area += lng1 * lat2 - lng2 * lat1;
  }
  area = Math.abs(area) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((coords[0][1] * Math.PI) / 180);
  return area * mPerDegLat * mPerDegLng;
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#e2e8f0', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#fef3c7', rose: '#f43f5e',
    bronze: '#92400e', silver: '#9ca3af', rust: '#b45309', scarlet: '#b91c1c',
    tan: '#a8896c',
  };
  return colors[bloomColor?.toLowerCase()] || '#9ca3af';
}
