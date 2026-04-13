'use client';

import Link from 'next/link';
import MapContainer from '@/components/map/MapContainer';
import { useState, useEffect } from 'react';

export default function HomePage() {
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/plans')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPlans(data); })
      .catch(() => {});
  }, []);

  const markers = plans.map((p: any) => ({
    lat: p.centerLat,
    lng: p.centerLng,
    title: p.title || 'Native Garden Plan',
    id: p.planId,
  }));

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-green-800 to-green-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-16 md:py-24">
          <div className="max-w-2xl">
            <h1 className="text-3xl md:text-5xl font-bold leading-tight mb-4">
              Grow native.<br />Grow Chicagoland.
            </h1>
            <p className="text-lg md:text-xl text-green-100 mb-8 leading-relaxed">
              Create a personalized native planting plan for your yard using real sun, soil, and
              topography data. Support pollinators, birds, and the local ecosystem.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/plan/new"
                className="bg-white text-green-800 px-6 py-3 rounded-lg font-semibold hover:bg-green-50 transition-colors"
              >
                Start Your Plan
              </Link>
              <Link
                href="/plants"
                className="border border-green-300 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-800 transition-colors"
              >
                Browse Plants
              </Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
        <div className="grid md:grid-cols-4 gap-8">
          {[
            { step: '1', title: 'Select your yard', desc: 'Search your address and draw the area you want to plant.' },
            { step: '2', title: 'We analyze the site', desc: 'Sun exposure, soil type, drainage, and flood risk — all automatic.' },
            { step: '3', title: 'Get your plan', desc: 'A diverse native planting layout tailored to your site and goals.' },
            { step: '4', title: 'Plant it', desc: 'Print your plan, order plants from local nurseries, and get growing.' },
          ].map(item => (
            <div key={item.step} className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary font-bold text-lg flex items-center justify-center mx-auto mb-4">
                {item.step}
              </div>
              <h3 className="font-semibold mb-2">{item.title}</h3>
              <p className="text-muted text-sm">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Community map */}
      <section className="max-w-7xl mx-auto px-4 pb-16 w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Community Plans</h2>
          <Link href="/explore" className="text-primary text-sm font-medium hover:underline">
            View all →
          </Link>
        </div>
        <div className="h-[400px] rounded-xl overflow-hidden shadow-sm border border-stone-200">
          <MapContainer
            center={[41.8781, -87.6298]}
            zoom={10}
            style="streets"
            planMarkers={markers}
            onPlanMarkerClick={(id) => { window.location.href = `/plan/${id}`; }}
            height="400px"
          />
        </div>
        <p className="text-center text-muted text-sm mt-4">
          {plans.length > 0
            ? `${plans.length} native garden plan${plans.length === 1 ? '' : 's'} created in Chicagoland`
            : 'Be the first to create a native garden plan!'
          }
        </p>
      </section>

      {/* Why native */}
      <section className="bg-surface-alt py-16">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-12">Why plant native?</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                title: 'Support pollinators',
                desc: 'Native plants provide essential food and habitat for bees, butterflies, and other pollinators that our ecosystem depends on.',
                icon: (
                  <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 8.25 2.658" /><path strokeLinecap="round" strokeWidth={1.5} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                ),
              },
              {
                title: 'Reduce maintenance',
                desc: 'Once established, native plants are adapted to local conditions — less watering, less fertilizing, fewer pesticides.',
                icon: (
                  <svg className="w-8 h-8 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9 9 0 0 0 0-18C6 3 3 8.5 3 12a9 9 0 0 0 9 9Zm0-18v18" /></svg>
                ),
              },
              {
                title: 'Manage stormwater',
                desc: 'Deep-rooted native plants absorb significantly more rainfall than lawns, reducing flooding and improving water quality.',
                icon: (
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 22V8M12 8C12 8 8 4 5 6C2 8 4 12 7 12C9 12 12 8 12 8ZM12 8C12 8 16 4 19 6C22 8 20 12 17 12C15 12 12 8 12 8Z" /></svg>
                ),
              },
            ].map(item => (
              <div key={item.title} className="bg-surface rounded-xl p-6 shadow-sm border border-stone-100">
                <div className="mb-4">{item.icon}</div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-stone-200 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-muted text-sm">
          <p>Chicago Native Plant Planner — Helping restore native ecosystems, one yard at a time.</p>
          <p className="mt-2">
            Data sources: USDA NRCS, USGS 3DEP, FEMA NFHL, OpenStreetMap
          </p>
        </div>
      </footer>
    </div>
  );
}
