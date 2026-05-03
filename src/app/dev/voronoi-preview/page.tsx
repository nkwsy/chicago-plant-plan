/**
 * Dev-only visual preview of the Voronoi tapestry layout.
 *
 * Loads /api/dev/voronoi for a given plan, drops the resulting cells onto a
 * Mapbox map, and labels each with its species abbreviation. Used by the
 * developer to eyeball the geometry — gap-free coverage, drift sizes,
 * tier hierarchy — without having to walk the full plan-creation wizard.
 */

'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import { OUDOLF_PALETTE, speciesAbbrev } from '@/lib/render/tapestry-blobs';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface VoronoiResponse {
  elapsedMs: number;
  cells: number;
  speciesUsed: number;
  tierCounts: Record<string, number>;
  bedAreaSqFtReported: number;
  totalCellAreaSqFt: number;
  featureCollection: GeoJSON.FeatureCollection;
}

function VoronoiPreviewInner() {
  const searchParams = useSearchParams();
  const planId = searchParams.get('planId') || 'tm4qdKPPENjY';
  const mode = searchParams.get('mode') === 'grid' ? 'grid' : 'voronoi';
  const grid = searchParams.get('grid') || '18';
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<VoronoiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(
      `/api/dev/voronoi?planId=${encodeURIComponent(planId)}&mode=${mode}&grid=${grid}`,
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(String(e)));
  }, [planId, mode, grid]);

  useEffect(() => {
    if (!data || !containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Compute bbox of the cells to center the map.
    const allCoords: Array<[number, number]> = [];
    for (const f of data.featureCollection.features) {
      if (f.geometry.type === 'Polygon') {
        for (const ring of f.geometry.coordinates) {
          for (const c of ring) allCoords.push(c as [number, number]);
        }
      }
    }
    if (allCoords.length === 0) return;
    const lngs = allCoords.map((c) => c[0]);
    const lats = allCoords.map((c) => c[1]);
    const bounds = new mapboxgl.LngLatBounds(
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    );

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      bounds,
      fitBoundsOptions: { padding: 60, maxZoom: 21 },
    });
    map.on('error', (e) => console.error('[mapbox]', e?.error?.message || e));
    (window as unknown as { __vmap?: mapboxgl.Map }).__vmap = map;

    map.on('load', () => {
      // Tag each feature with a stable color so neighbouring cells of the
      // same species share a fill. We index by speciesIndex from the API
      // response, falling back to a slug hash.
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: data.featureCollection.features.map((f) => {
          const speciesIdx = (f.properties?.speciesIndex as number) ?? 0;
          const color = OUDOLF_PALETTE[speciesIdx % OUDOLF_PALETTE.length];
          return { ...f, properties: { ...f.properties, color } };
        }),
      };
      map.addSource('cells', { type: 'geojson', data: fc });
      map.addLayer({
        id: 'cells-fill',
        type: 'fill',
        source: 'cells',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.7 },
      });
      map.addLayer({
        id: 'cells-line',
        type: 'line',
        source: 'cells',
        paint: { 'line-color': '#000', 'line-opacity': 0.25, 'line-width': 0.5 },
      });

      // Centroid points for labels.
      const labelFc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: data.featureCollection.features.map((f) => {
          let cx = 0;
          let cy = 0;
          let n = 0;
          if (f.geometry.type === 'Polygon') {
            for (const ring of f.geometry.coordinates) {
              for (const c of ring) {
                cx += c[0];
                cy += c[1];
                n++;
              }
            }
          }
          const slug = (f.properties?.slug as string) || '';
          const name = (f.properties?.commonName as string) || slug;
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [cx / n, cy / n] },
            properties: { abbrev: speciesAbbrev(slug, name), tier: f.properties?.tier },
          };
        }),
      };
      map.addSource('labels', { type: 'geojson', data: labelFc });
      map.addLayer({
        id: 'labels',
        type: 'symbol',
        source: 'labels',
        layout: {
          'text-field': ['get', 'abbrev'],
          'text-size': 11,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 },
      });
    });

    return () => map.remove();
  }, [data]);

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-stone-900 text-stone-100 px-4 py-2 flex items-center gap-4 text-sm">
        <span className="font-mono">Voronoi preview · planId={planId}</span>
        {data && (
          <>
            <span>{data.cells} cells</span>
            <span>{data.speciesUsed} species</span>
            <span>{data.elapsedMs}ms</span>
            <span>
              {data.totalCellAreaSqFt}/{data.bedAreaSqFtReported} sqft (
              {Math.round((data.totalCellAreaSqFt / data.bedAreaSqFtReported) * 100)}%)
            </span>
            <span className="font-mono text-xs">
              T5={data.tierCounts['5'] || 0} T4={data.tierCounts['4'] || 0}{' '}
              T3={data.tierCounts['3'] || 0} T2={data.tierCounts['2'] || 0}{' '}
              T1={data.tierCounts['1'] || 0}
            </span>
          </>
        )}
        {error && <span className="text-red-300">err: {error}</span>}
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}

export default function VoronoiPreviewPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading…</div>}>
      <VoronoiPreviewInner />
    </Suspense>
  );
}
