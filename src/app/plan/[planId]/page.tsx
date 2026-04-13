'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import MapContainer from '@/components/map/MapContainer';
import PlantingLegend from '@/components/plan/PlantingLegend';
import GridPlanView from '@/components/plan/GridPlanView';
import type { PlanData, PlanPlant } from '@/types/plan';
import { SUPPLIERS } from '@/lib/suppliers';

export default function PlanViewPage() {
  const params = useParams();
  const planId = params.planId as string;
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'layout' | 'plants' | 'care' | 'suppliers'>('layout');
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allPlants, setAllPlants] = useState<any[]>([]);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showSatBg, setShowSatBg] = useState(false);
  const [showShadows, setShowShadows] = useState(false);
  const [shadowHour, setShadowHour] = useState(14);

  useEffect(() => {
    fetch(`/api/plans?id=${planId}`)
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) setPlan(data as any);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch plant catalog for swap functionality
    fetch('/api/plants?all=1')
      .then(r => r.json())
      .then(setAllPlants)
      .catch(() => {});
  }, [planId]);

  function removePlant(slug: string) {
    if (!plan) return;
    const newPlants = plan.plants.filter(p => p.plantSlug !== slug);
    setPlan({ ...plan, plants: newPlants });
    setEditing(true);
  }

  async function saveEdits() {
    if (!plan) return;
    setSaving(true);
    try {
      await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, plants: plan.plants }),
      });
      setEditing(false);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31" /></svg>
        <p className="text-muted">Loading plan...</p>
      </div>
    </div>
  );

  if (!plan) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h2 className="text-xl font-bold mb-2">Plan not found</h2>
      <p className="text-muted mb-4">This plan may have been removed or the link is incorrect.</p>
      <Link href="/" className="text-primary hover:underline">Go home</Link>
    </div>
  );

  const uniquePlants = getUniquePlants(plan.plants);
  const totalPlants = plan.plants.reduce((sum, p) => sum + p.quantity, 0);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{plan.title || 'Native Garden Plan'}</h1>
          <p className="text-muted text-sm mt-1">
            {plan.areaSqFt.toLocaleString()} sq ft &middot; {uniquePlants.length} species &middot; {totalPlants} plants
            &middot; Diversity: {plan.diversityScore}/100
          </p>
        </div>
        <div className="flex gap-2 no-print">
          {editing && (
            <button
              onClick={saveEdits}
              disabled={saving}
              className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
          <Link
            href={`/plan/${planId}/print`}
            className="border border-stone-300 px-4 py-2 rounded-lg hover:bg-stone-50 transition-colors text-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            Print
          </Link>
          <Link
            href={`/quote?plan=${planId}`}
            className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition-colors"
          >
            Get Quote
          </Link>
        </div>
      </div>

      {/* Map */}
      {/* Location context map removed — satellite view is in the Layout tab */}

      {/* Site Analysis Summary */}
      {plan.siteProfile && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Sun" value={`${(plan.siteProfile as any).effectiveSunHours?.average || '?'}h/day`} />
          <StatCard label="Soil" value={(plan.siteProfile as any).soilType?.replace('_', ' ') || 'Unknown'} />
          <StatCard label="Moisture" value={(plan.siteProfile as any).moistureCategory || 'Unknown'} />
          <StatCard label="Elevation" value={`${(plan.siteProfile as any).elevation || '?'} ft`} />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-stone-200 mb-6 no-print">
        <div className="flex gap-6 -mb-px">
          {[
            { key: 'layout', label: 'Layout' },
            { key: 'plants', label: 'Plant List' },
            { key: 'care', label: 'Care Timeline' },
            { key: 'suppliers', label: 'Where to Buy' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`pb-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'layout' && (
        <div>
          {/* View mode toggle */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="flex rounded-lg border border-stone-200 overflow-hidden text-sm">
              <button
                onClick={() => setShowSatellite(false)}
                className={`px-3 py-1.5 transition-colors ${!showSatellite ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
              >
                Plan View
              </button>
              <button
                onClick={() => setShowSatellite(true)}
                className={`px-3 py-1.5 border-l border-stone-200 transition-colors ${showSatellite ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
              >
                Satellite + 3D
              </button>
            </div>

            {!showSatellite && (
              <>
                <button
                  onClick={() => setShowSatBg(s => !s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-all ${
                    showSatBg ? 'bg-blue-600 text-white border-blue-600' : 'border-stone-300 hover:border-stone-400 bg-white'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
                  Satellite
                </button>
                <button
                  onClick={() => setShowShadows(s => !s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-all ${
                    showShadows ? 'bg-slate-700 text-white border-slate-700' : 'border-stone-300 hover:border-stone-400 bg-white'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
                  Shadows
                </button>
              </>
            )}

            <div className="flex items-center gap-2 ml-1">
              <input
                type="range" min={6} max={20} step={0.5}
                value={shadowHour}
                onChange={e => setShadowHour(parseFloat(e.target.value))}
                className="w-24 accent-slate-600"
              />
              <span className="text-xs text-muted w-14">
                {shadowHour < 12 ? `${Math.floor(shadowHour)}:${String(Math.round((shadowHour%1)*60)).padStart(2,'0')} AM`
                  : shadowHour === 12 ? '12:00 PM'
                  : `${Math.floor(shadowHour)-12}:${String(Math.round((shadowHour%1)*60)).padStart(2,'0')} PM`}
              </span>
            </div>
          </div>

          {/* Plan view: satellite 3D map OR clean SVG layout */}
          {showSatellite ? (
            <div className="rounded-xl overflow-hidden border border-stone-200 shadow-sm mb-2" style={{ height: '460px' }}>
              <MapContainer
                center={[plan.centerLat, plan.centerLng]}
                zoom={20}
                style="satellite-streets"
                show3D={true}
                showSunlight={true}
                showSearch={false}
                areaOutline={(plan as any).areaGeoJson}
                exclusionZones={(plan as any).exclusionZones || []}
                existingTrees={(plan as any).existingTrees || []}
                plantPlacements={plan.plants
                  .filter(p => p.lat && p.lng)
                  .map(p => ({
                    lat: p.lat!, lng: p.lng!,
                    color: p.bloomColor, name: p.commonName,
                    slug: p.plantSlug, imageUrl: p.imageUrl,
                    spreadInches: p.spreadInches, speciesIndex: p.speciesIndex,
                    plantType: p.plantType,
                  }))}
                onPlantClick={(slug) => setSelectedPlant(slug === selectedPlant ? null : slug)}
                height="100%"
              />
            </div>
          ) : (
            <GridPlanView
              widthFt={Math.max(10, Math.round(Math.sqrt(plan.areaSqFt || 400) * 1.2))}
              heightFt={Math.max(10, Math.round((plan.areaSqFt || 400) / Math.max(10, Math.round(Math.sqrt(plan.areaSqFt || 400) * 1.2))))}
              centerLat={plan.centerLat}
              centerLng={plan.centerLng}
              plants={plan.plants}
              exclusionZones={(plan as any).exclusionZones || []}
              existingTrees={(plan as any).existingTrees || []}
              selectedSlug={selectedPlant}
              onPlantClick={(slug) => setSelectedPlant(slug === selectedPlant ? null : slug)}
              nearbyBuildings={(plan.siteProfile as any)?.nearbyBuildings}
              showSatellite={showSatBg}
              showShadows={showShadows}
              shadowHour={shadowHour}
            />
          )}
          <p className="text-xs text-muted mt-2 mb-6 text-center">
            {showSatellite
              ? '3D view — buildings cast real shadows. Use the time slider above to see shadow movement.'
              : 'Numbered circles match the legend below. Colors show species zones.'}
          </p>

          {/* Plant legend with remove/swap */}
          <PlantingLegend
            plants={plan.plants}
            selectedSlug={selectedPlant}
            onSelect={setSelectedPlant}
            allPlants={allPlants}
            onRemoveSpecies={(slug) => {
              const newPlants = plan.plants.filter(p => p.plantSlug !== slug);
              setPlan({ ...plan, plants: newPlants });
              setEditing(true);
            }}
            onSwapSpecies={(oldSlug, newSlug) => {
              const replacement = allPlants.find((p: any) => p.slug === newSlug);
              if (!replacement) return;
              const newPlants = plan.plants.map(p =>
                p.plantSlug === oldSlug ? {
                  ...p,
                  plantSlug: replacement.slug,
                  commonName: replacement.commonName,
                  scientificName: replacement.scientificName,
                  bloomColor: replacement.bloomColor,
                  heightMaxInches: replacement.heightMaxInches,
                  imageUrl: replacement.imageUrl || '',
                } : p
              );
              setPlan({ ...plan, plants: newPlants });
              setEditing(true);
            }}
          />
        </div>
      )}

      {activeTab === 'plants' && (
        <div className="space-y-3">
          {uniquePlants.map(({ plant, count }) => (
            <div key={plant.plantSlug} className="flex items-start gap-3 p-3 bg-surface rounded-lg border border-stone-200">
              {plant.imageUrl ? (
                <img src={plant.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" loading="lazy" />
              ) : (
                <div className="w-14 h-14 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: getPlantBgColor(plant.bloomColor) }}>
                  <div className="w-8 h-8 rounded-full" style={{ backgroundColor: getPlantColor(plant.bloomColor) }} />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold">{plant.commonName}</span>
                  <span className="text-sm text-muted italic">{plant.scientificName}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted mt-1">
                  <span>Qty: <strong className="text-foreground">{count}</strong></span>
                  <span>Height: up to {plant.heightMaxInches}&quot;</span>
                  <span>Bloom: {plant.bloomColor}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link href={`/plants/${plant.plantSlug}`} className="text-primary text-sm hover:underline">
                  Details
                </Link>
                <button
                  onClick={() => removePlant(plant.plantSlug)}
                  className="text-stone-400 hover:text-red-500 transition-colors"
                  title="Remove from plan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'care' && (
        <div>
          <p className="text-muted text-sm mb-6">General care timeline for your native garden in Chicagoland.</p>
          <div className="space-y-4">
            {[
              { months: 'March - April', title: 'Spring Prep', tasks: ['Cut back last year\'s dead growth to 4-6"', 'Remove any invasive weeds', 'Apply light mulch (1-2") around new plants', 'Plant bare root trees and shrubs'] },
              { months: 'April - May', title: 'Planting Season', tasks: ['Plant plugs and potted perennials after last frost (~May 15)', 'Water new plants deeply, 2-3x per week', 'Sow native seed mixes on prepared soil', 'Mark planted areas to avoid accidental weeding'] },
              { months: 'June - August', title: 'Summer Care', tasks: ['Water new plants during dry spells (1" per week)', 'Established natives rarely need watering', 'Pull any invasive weeds you spot', 'Enjoy the blooms and wildlife!'] },
              { months: 'September - October', title: 'Fall Tasks', tasks: ['Plant trees, shrubs, and spring bulbs', 'Collect seeds from plants you want to spread', 'Leave dead stems standing for overwintering insects', 'No fall cleanup — leave the leaves!'] },
              { months: 'November - February', title: 'Winter', tasks: ['Leave all dead plant material standing', 'Stems provide shelter for beneficial insects', 'Plan next year\'s additions', 'Order seeds early for best selection'] },
            ].map(period => (
              <div key={period.months} className="p-4 bg-surface rounded-lg border border-stone-200">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-1 rounded">{period.months}</span>
                  <span className="font-semibold">{period.title}</span>
                </div>
                <ul className="space-y-1 ml-4">
                  {period.tasks.map((task, i) => (
                    <li key={i} className="text-sm text-muted flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      {task}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'suppliers' && (
        <div>
          <p className="text-muted text-sm mb-6">Local and regional nurseries that carry native Chicagoland plants.</p>
          <div className="grid md:grid-cols-2 gap-4">
            {SUPPLIERS.map(supplier => (
              <div key={supplier.slug} className="p-4 bg-surface rounded-lg border border-stone-200">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{supplier.name}</h3>
                    <p className="text-sm text-muted">{supplier.location}</p>
                  </div>
                  <div className="flex gap-1">
                    {supplier.shipping && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Ships</span>}
                    {supplier.pickup && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Pickup</span>}
                  </div>
                </div>
                <p className="text-sm text-muted mt-2">{supplier.description}</p>
                <div className="flex items-center gap-4 mt-3 text-sm">
                  {supplier.url && (
                    <a href={supplier.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Website →
                    </a>
                  )}
                  <span className="text-muted">{supplier.phone}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <h3 className="font-semibold text-amber-800 mb-1">Want us to handle procurement?</h3>
            <p className="text-sm text-amber-700 mb-3">
              We can compile quotes from multiple nurseries and manage logistics for your order.
            </p>
            <Link
              href={`/quote?plan=${planId}`}
              className="inline-block bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              Request a Quote
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-surface rounded-lg border border-stone-200 text-center">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold text-sm mt-0.5 capitalize">{value}</div>
    </div>
  );
}

function getPlantColor(bloomColor: string): string {
  const colors: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#e5e7eb', green: '#22c55e',
    lavender: '#a78bfa', gold: '#ca8a04', crimson: '#dc2626', coral: '#fb923c',
    violet: '#7c3aed', magenta: '#d946ef', cream: '#fef3c7', rose: '#f43f5e',
    bronze: '#92400e', silver: '#9ca3af', rust: '#b45309', scarlet: '#b91c1c',
  };
  return colors[bloomColor.toLowerCase()] || '#9ca3af';
}

function getPlantBgColor(bloomColor: string): string {
  return getPlantColor(bloomColor) + '25';
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
