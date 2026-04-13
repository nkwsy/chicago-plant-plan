'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { PlanPlant } from '@/types/plan';
import { SUPPLIERS } from '@/lib/suppliers';

export default function PrintPlanPage() {
  const params = useParams();
  const planId = params.planId as string;
  const [plan, setPlan] = useState<any | null>(null);

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
      {/* Print button */}
      <div className="no-print mb-6 flex gap-3">
        <button onClick={() => window.print()} className="bg-primary text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-dark transition-colors flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
          Print this plan
        </button>
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

function getUniquePlants(plants: PlanPlant[]): { plant: PlanPlant; count: number }[] {
  const map = new Map<string, { plant: PlanPlant; count: number }>();
  plants.forEach(p => {
    const existing = map.get(p.plantSlug);
    if (existing) existing.count += p.quantity;
    else map.set(p.plantSlug, { plant: p, count: p.quantity });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
