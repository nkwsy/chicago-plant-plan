'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { PlanPlant } from '@/types/plan';
import { SUPPLIERS } from '@/lib/suppliers';
import GridPlanView, { type PlanRenderStyle } from '@/components/plan/GridPlanView';

const RENDER_STYLES: { id: PlanRenderStyle; label: string; hint: string }[] = [
  { id: 'matrix', label: 'Matrix', hint: 'Grid squares, install-friendly' },
  { id: 'dots', label: 'Dots', hint: 'Numbered circles, classic plan' },
  { id: 'tapestry', label: 'Tapestry', hint: 'Voronoi cells, Oudolf style' },
];

function isRenderStyle(s: string | null): s is PlanRenderStyle {
  return s === 'matrix' || s === 'dots' || s === 'tapestry';
}

export default function PrintPlanPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = params.planId as string;
  const [plan, setPlan] = useState<any | null>(null);

  // Render style is persisted in the URL so the print preview, browser refresh,
  // and shareable export-link all show the same view.
  const styleParam = searchParams.get('style');
  const renderStyle: PlanRenderStyle = isRenderStyle(styleParam) ? styleParam : 'dots';

  function setRenderStyle(next: PlanRenderStyle) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('style', next);
    router.replace(`/plan/${planId}/print?${sp.toString()}`, { scroll: false });
  }

  useEffect(() => {
    fetch(`/api/plans?id=${planId}`)
      .then(r => r.json())
      .then(data => setPlan(data))
      .catch(() => {});
  }, [planId]);

  if (!plan) return <div className="p-8 text-center text-muted">Loading...</div>;

  const uniquePlants = getUniquePlants(plan.plants || []);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Print + style controls — hidden when actually printing. */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-3">
        <button onClick={() => window.print()} className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-dark transition-colors flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
          Print this plan
        </button>

        <div className="flex items-center gap-1 bg-stone-50 border border-stone-200 rounded-lg p-1">
          <span className="text-xs font-medium text-muted px-2">Style:</span>
          {RENDER_STYLES.map(s => (
            <button
              key={s.id}
              onClick={() => setRenderStyle(s.id)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                renderStyle === s.id
                  ? 'bg-white shadow text-primary font-medium border border-stone-200'
                  : 'text-muted hover:text-foreground'
              }`}
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>

        <Link href={`/plan/${planId}`} className="border border-stone-300 px-4 py-2 rounded-lg text-sm hover:bg-stone-50">
          ← Back to plan
        </Link>
      </div>

      {/* Printable content */}
      <div className="print:text-black">
        <h1 className="text-3xl font-bold mb-1">{plan.title || 'Native Garden Plan'}</h1>
        <p className="text-muted text-sm mb-6">
          {plan.areaSqFt?.toLocaleString()} sq ft | {uniquePlants.length} species | {plan.plants?.length || 0} plants | Diversity: {plan.diversityScore}/100
        </p>

        {/* Plant layout diagram */}
        {plan.plants?.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 border-b pb-1">Planting Layout</h2>
            <GridPlanView
              widthFt={Math.max(10, Math.round(Math.sqrt(plan.areaSqFt || 400) * 1.2))}
              heightFt={Math.max(10, Math.round((plan.areaSqFt || 400) / Math.max(10, Math.round(Math.sqrt(plan.areaSqFt || 400) * 1.2))))}
              centerLat={plan.centerLat}
              centerLng={plan.centerLng}
              plants={plan.plants}
              exclusionZones={plan.exclusionZones || []}
              existingTrees={plan.existingTrees || []}
              renderStyle={renderStyle}
            />
            <p className="text-xs text-muted text-center mt-1">
              {renderStyle === 'matrix' && 'Squares sized to plant spread. Numbers correspond to species in the manifest below.'}
              {renderStyle === 'dots' && 'Circles sized to plant spread. Numbers correspond to species in the manifest below.'}
              {renderStyle === 'tapestry' && 'Voronoi cells in the Oudolf palette. Letter codes are genus abbreviations (see manifest).'}
            </p>
          </div>
        )}

        {/* Bloom calendar */}
        {uniquePlants.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 border-b pb-1">Bloom Calendar</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-1 font-medium w-32">Plant</th>
                    {['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => (
                      <th key={i} className="text-center py-1 font-medium w-8">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uniquePlants.map(({ plant }) => {
                    const start = (plant as any).bloomStartMonth ?? 5;
                    const end = (plant as any).bloomEndMonth ?? 8;
                    return (
                      <tr key={plant.plantSlug} className="border-t border-stone-100">
                        <td className="py-1 text-xs truncate max-w-[128px]">{plant.commonName}</td>
                        {Array.from({ length: 12 }).map((_, i) => {
                          const month = i + 1;
                          const blooming = month >= start && month <= end;
                          return (
                            <td key={i} className="text-center py-0.5">
                              {blooming && (
                                <div className="w-5 h-5 rounded-full mx-auto"
                                  style={{ backgroundColor: getPlantColor(plant.bloomColor), opacity: 0.75 }} />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Site conditions */}
        {plan.siteProfile && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 border-b pb-1">Site Conditions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted">Sun:</span> {(plan.siteProfile as any).effectiveSunHours?.average}h/day</div>
              <div><span className="text-muted">Soil:</span> {(plan.siteProfile as any).soilType?.replace('_', ' ')}</div>
              <div><span className="text-muted">Moisture:</span> {(plan.siteProfile as any).moistureCategory}</div>
              <div><span className="text-muted">Elevation:</span> {(plan.siteProfile as any).elevation} ft</div>
            </div>
          </div>
        )}

        {/* Plant manifest table */}
        <h2 className="text-lg font-semibold mb-2 border-b pb-1">Plant Manifest</h2>
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 font-medium">Common Name</th>
              <th className="py-2 font-medium">Scientific Name</th>
              <th className="py-2 font-medium text-center">Qty</th>
              <th className="py-2 font-medium text-center">Height</th>
              <th className="py-2 font-medium">Bloom</th>
            </tr>
          </thead>
          <tbody>
            {uniquePlants.map(({ plant, count }) => (
              <tr key={plant.plantSlug} className="border-b border-stone-100">
                <td className="py-1.5 font-medium">{plant.commonName}</td>
                <td className="py-1.5 italic text-muted">{plant.scientificName}</td>
                <td className="py-1.5 text-center">{count}</td>
                <td className="py-1.5 text-center">{plant.heightMaxInches}&quot;</td>
                <td className="py-1.5 capitalize">{plant.bloomColor}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Care timeline */}
        <h2 className="text-lg font-semibold mb-2 border-b pb-1">Care Timeline</h2>
        <div className="text-sm space-y-2 mb-6">
          <p><strong>March-April:</strong> Cut back dead growth. Remove invasive weeds. Light mulch on new plants.</p>
          <p><strong>April-May:</strong> Plant plugs after last frost (~May 15). Water deeply 2-3x/week.</p>
          <p><strong>June-August:</strong> Water new plants during dry spells. Pull invasive weeds.</p>
          <p><strong>September-October:</strong> Plant trees/shrubs. Collect seeds. Leave stems standing.</p>
          <p><strong>November-February:</strong> Leave all dead material for wildlife. Plan additions.</p>
        </div>

        {/* Suppliers */}
        <h2 className="text-lg font-semibold mb-2 border-b pb-1">Where to Buy</h2>
        <div className="text-sm space-y-1">
          {SUPPLIERS.map(s => (
            <div key={s.slug}>
              <strong>{s.name}</strong> — {s.location} | {s.phone}
              {s.url && <span className="text-muted"> | {s.url}</span>}
            </div>
          ))}
        </div>

        <div className="mt-8 text-xs text-muted text-center border-t pt-4">
          Generated by Chicago Native Plant Planner | chicagoplantplan.com
        </div>
      </div>
    </div>
  );
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#94a3b8', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#d4a574', rose: '#f43f5e',
  };
  return colors[bloomColor?.toLowerCase()] || '#9ca3af';
}

function getUniquePlants(plants: PlanPlant[]): { plant: PlanPlant; count: number }[] {
  const map = new Map<string, { plant: PlanPlant; count: number }>();
  plants.forEach(p => {
    const existing = map.get(p.plantSlug);
    if (existing) existing.count += p.quantity;
    else map.set(p.plantSlug, { plant: p, count: p.quantity });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
