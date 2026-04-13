'use client';

import { useEffect, useState } from 'react';
import MapContainer from '@/components/map/MapContainer';
import Link from 'next/link';

export default function ExplorePage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);

  useEffect(() => {
    fetch('/api/plans')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPlans(data); })
      .catch(() => {});
  }, []);

  const markers = plans.map(p => ({
    lat: p.centerLat,
    lng: p.centerLng,
    title: p.title || 'Native Garden Plan',
    id: p.planId,
  }));

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <div className="p-4 bg-surface border-b border-stone-200">
        <h1 className="text-xl font-bold">Explore Community Plans</h1>
        <p className="text-muted text-sm">{plans.length} native garden plans in Chicagoland</p>
      </div>

      <div className="flex-1 relative">
        <MapContainer
          center={[41.8781, -87.6298]}
          zoom={10}
          showSearch={true}
          markers={markers}
          onMarkerClick={(id) => {
            const plan = plans.find(p => p.planId === id);
            setSelected(plan);
          }}
          height="100%"
        />

        {selected && (
          <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-surface rounded-xl shadow-lg border border-stone-200 p-4 z-[1000]">
            <button
              onClick={() => setSelected(null)}
              className="absolute top-2 right-2 text-muted hover:text-foreground"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <h3 className="font-semibold pr-6">{selected.title || 'Native Garden Plan'}</h3>
            <p className="text-sm text-muted mt-1">
              {selected.areaSqFt?.toLocaleString()} sq ft &middot;
              {selected.plants?.length || 0} plants &middot;
              Diversity: {selected.diversityScore}/100
            </p>
            <Link
              href={`/plan/${selected.planId}`}
              className="inline-block mt-3 bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
            >
              View Plan →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
