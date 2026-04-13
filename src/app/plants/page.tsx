'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Plant } from '@/types/plant';

const SUN_OPTIONS = [
  { value: '', label: 'All sun levels' },
  { value: 'full_sun', label: 'Full sun' },
  { value: 'part_sun', label: 'Part sun' },
  { value: 'part_shade', label: 'Part shade' },
  { value: 'full_shade', label: 'Full shade' },
];

const MOISTURE_OPTIONS = [
  { value: '', label: 'All moisture' },
  { value: 'dry', label: 'Dry' },
  { value: 'medium', label: 'Medium' },
  { value: 'wet', label: 'Wet' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'forb', label: 'Forbs' },
  { value: 'grass', label: 'Grasses' },
  { value: 'sedge', label: 'Sedges' },
  { value: 'shrub', label: 'Shrubs' },
  { value: 'tree', label: 'Trees' },
  { value: 'vine', label: 'Vines' },
  { value: 'fern', label: 'Ferns' },
];

const HABITAT_OPTIONS = [
  { value: '', label: 'All habitats' },
  { value: 'prairie', label: 'Prairie' },
  { value: 'woodland', label: 'Woodland' },
  { value: 'wetland', label: 'Wetland' },
  { value: 'savanna', label: 'Savanna' },
];

export default function PlantsPage() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sun, setSun] = useState('');
  const [moisture, setMoisture] = useState('');
  const [type, setType] = useState('');
  const [habitat, setHabitat] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sun) params.set('sun', sun);
    if (moisture) params.set('moisture', moisture);
    if (type) params.set('type', type);
    if (habitat) params.set('habitat', habitat);
    if (search) params.set('search', search);

    fetch(`/api/plants?${params}`)
      .then(r => r.json())
      .then(data => { setPlants(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [sun, moisture, type, habitat, search]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Native Plant Guide</h1>
          <p className="text-muted text-sm mt-1">{plants.length} Chicagoland native species</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plants..."
          className="px-4 py-2 border border-stone-200 rounded-lg text-sm outline-none focus:border-primary bg-surface min-w-[200px]"
        />
        <select value={sun} onChange={(e) => setSun(e.target.value)} className="px-3 py-2 border border-stone-200 rounded-lg text-sm bg-surface">
          {SUN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={moisture} onChange={(e) => setMoisture(e.target.value)} className="px-3 py-2 border border-stone-200 rounded-lg text-sm bg-surface">
          {MOISTURE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 border border-stone-200 rounded-lg text-sm bg-surface">
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={habitat} onChange={(e) => setHabitat(e.target.value)} className="px-3 py-2 border border-stone-200 rounded-lg text-sm bg-surface">
          {HABITAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex border border-stone-200 rounded-lg overflow-hidden ml-auto">
          <button onClick={() => setViewMode('grid')} className={`px-3 py-2 text-sm ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-surface'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
          </button>
          <button onClick={() => setViewMode('list')} className={`px-3 py-2 text-sm ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-surface'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-muted">Loading plants...</div>
      ) : plants.length === 0 ? (
        <div className="text-center py-16 text-muted">No plants match your filters.</div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {plants.map((plant: any) => (
            <Link
              key={plant.slug}
              href={`/plants/${plant.slug}`}
              className="bg-surface rounded-xl border border-stone-200 overflow-hidden hover:shadow-md transition-shadow group"
            >
              <div className="h-32 flex items-center justify-center" style={{ backgroundColor: getPlantBgColor(plant.bloomColor) }}>
                <div className="w-16 h-16 rounded-full" style={{ backgroundColor: getPlantColor(plant.bloomColor) }} />
              </div>
              <div className="p-4">
                <h3 className="font-semibold group-hover:text-primary transition-colors">{plant.commonName}</h3>
                <p className="text-sm text-muted italic">{plant.scientificName}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Badge>{plant.plantType}</Badge>
                  {plant.sun?.map((s: string) => <Badge key={s}>{s.replace('_', ' ')}</Badge>)}
                  {plant.moisture?.map((m: string) => <Badge key={m}>{m}</Badge>)}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {plant.wildlifeValue?.map((w: string) => (
                    <span key={w} className="text-xs">
                      {w === 'pollinators' ? '🐝' : w === 'butterflies' ? '🦋' : w === 'birds' ? '🐦' : '🐿'}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {plants.map((plant: any) => (
            <Link
              key={plant.slug}
              href={`/plants/${plant.slug}`}
              className="flex items-center gap-4 p-4 bg-surface rounded-lg border border-stone-200 hover:shadow-sm transition-shadow"
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: getPlantColor(plant.bloomColor) }} />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{plant.commonName}</span>
                <span className="text-muted italic ml-2 text-sm">{plant.scientificName}</span>
              </div>
              <div className="hidden md:flex gap-1.5">
                <Badge>{plant.plantType}</Badge>
                <Badge>{plant.effortLevel} effort</Badge>
              </div>
              <div className="text-sm text-muted">
                {plant.heightMinInches}&quot;-{plant.heightMaxInches}&quot;
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-xs px-2 py-0.5 bg-stone-100 text-muted rounded-full capitalize">{children}</span>;
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#e5e7eb', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#fef3c7', rose: '#f43f5e',
  };
  return colors[bloomColor?.toLowerCase()] || '#9ca3af';
}

function getPlantBgColor(bloomColor: string): string {
  return getPlantColor(bloomColor) + '20';
}
