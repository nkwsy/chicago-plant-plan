'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MapContainer from '@/components/map/MapContainer';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences, PlanPlant } from '@/types/plan';

type Step = 'location' | 'analysis' | 'preferences' | 'plan';

interface LocationData {
  lat: number;
  lng: number;
  address: string;
  areaGeoJson: GeoJSON.Polygon | null;
  areaSqFt: number;
}

export default function NewPlanPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('location');
  const [location, setLocation] = useState<LocationData>({
    lat: 0, lng: 0, address: '', areaGeoJson: null, areaSqFt: 0,
  });
  const [siteProfile, setSiteProfile] = useState<SiteProfile | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences>({
    effortLevel: 'medium',
    habitatGoals: ['pollinators'],
    aestheticPref: 'mixed',
    bloomPreference: 'continuous',
    maxHeightInches: null,
    avoidSlugs: [],
    specialFeatures: [],
  });
  const [generatedPlan, setGeneratedPlan] = useState<{
    plants: PlanPlant[];
    gridCols: number;
    gridRows: number;
    diversityScore: number;
    species: any[];
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planTitle, setPlanTitle] = useState('My Native Garden');

  const steps: { key: Step; label: string }[] = [
    { key: 'location', label: 'Location' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'preferences', label: 'Goals' },
    { key: 'plan', label: 'Plan' },
  ];

  const currentIdx = steps.findIndex(s => s.key === step);

  async function runAnalysis() {
    if (!location.lat || !location.lng) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/site-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: location.lat, lng: location.lng }),
      });
      const profile = await res.json();
      setSiteProfile(profile);
      setStep('analysis');
    } catch (err) {
      console.error('Analysis failed:', err);
      alert('Site analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function generatePlan() {
    if (!siteProfile) return;
    setGenerating(true);
    try {
      // Fetch all plants
      const plantsRes = await fetch('/api/plants?all=1');
      const allPlants = await plantsRes.json();

      // Import and run generation client-side (using the JSON data)
      const { generatePlan: gen } = await import('@/lib/planner/generate');
      const areaSqFt = location.areaSqFt || 400; // Default 20x20 ft
      const result = gen(
        allPlants, siteProfile, preferences, areaSqFt,
        location.areaGeoJson, [location.lat, location.lng]
      );

      setGeneratedPlan({
        plants: result.plants,
        gridCols: result.gridCols,
        gridRows: result.gridRows,
        diversityScore: result.diversityScore,
        species: result.selectedSpecies,
      });
      setStep('plan');
    } catch (err) {
      console.error('Generation failed:', err);
      alert('Plan generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  function removePlantFromPlan(plantSlug: string, gridX: number, gridY: number) {
    if (!generatedPlan) return;
    const newPlants = generatedPlan.plants.filter(
      p => !(p.plantSlug === plantSlug && p.gridX === gridX && p.gridY === gridY)
    );
    const newSpecies = generatedPlan.species.filter((s: any) =>
      newPlants.some(p => p.plantSlug === s.slug)
    );
    setGeneratedPlan({ ...generatedPlan, plants: newPlants, species: newSpecies });
  }

  async function savePlan() {
    if (!generatedPlan) return;
    setSaving(true);
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: planTitle,
          areaGeoJson: location.areaGeoJson || makeDefaultPolygon(location.lat, location.lng),
          centerLat: location.lat,
          centerLng: location.lng,
          siteProfile,
          preferences,
          plants: generatedPlan.plants,
          gridCols: generatedPlan.gridCols,
          gridRows: generatedPlan.gridRows,
          areaSqFt: location.areaSqFt || 400,
          diversityScore: generatedPlan.diversityScore,
        }),
      });
      const data = await res.json();
      if (data.planId) {
        router.push(`/plan/${data.planId}`);
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Failed to save plan. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Step indicator */}
      <div className="flex items-center justify-center mb-8">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
              i <= currentIdx ? 'bg-primary text-white' : 'bg-stone-200 text-muted'
            }`}>
              {i < currentIdx ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`ml-2 text-sm hidden sm:inline ${i <= currentIdx ? 'text-foreground font-medium' : 'text-muted'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`w-8 sm:w-16 h-0.5 mx-2 ${i < currentIdx ? 'bg-primary' : 'bg-stone-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="wizard-step">
        {step === 'location' && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Where is your garden?</h2>
            <p className="text-muted mb-6">Search your address, then draw the area you want to plant using the polygon or rectangle tool on the map.</p>

            <div className="h-[450px] md:h-[500px] rounded-xl overflow-hidden border border-stone-200 shadow-sm mb-6">
              <MapContainer
                center={[41.8781, -87.6298]}
                zoom={12}
                showDrawControls={true}
                showSearch={true}
                height="100%"
                onLocationSelected={(lat, lng, address) => {
                  setLocation(prev => ({ ...prev, lat, lng, address }));
                }}
                onAreaSelected={(geoJson, center, areaSqFt) => {
                  setLocation(prev => ({
                    ...prev,
                    areaGeoJson: geoJson,
                    lat: center[0],
                    lng: center[1],
                    areaSqFt,
                  }));
                }}
              />
            </div>

            {location.address && (
              <div className="bg-surface rounded-lg p-4 border border-stone-200 mb-4">
                <p className="text-sm"><span className="font-medium">Location:</span> {location.address}</p>
                {location.areaSqFt > 0 && (
                  <p className="text-sm mt-1"><span className="font-medium">Area:</span> ~{location.areaSqFt.toLocaleString()} sq ft</p>
                )}
              </div>
            )}

            {!location.areaGeoJson && location.lat > 0 && (
              <p className="text-sm text-amber-600 mb-4">
                Use the rectangle or polygon tool (top-right of map) to draw your planting area.
              </p>
            )}

            <div className="flex justify-end">
              <button
                onClick={runAnalysis}
                disabled={!location.lat || !location.lng || analyzing}
                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {analyzing ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31" /></svg>
                    Analyzing site...
                  </>
                ) : (
                  'Analyze Site →'
                )}
              </button>
            </div>
          </div>
        )}

        {step === 'analysis' && siteProfile && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Site Analysis</h2>
            <p className="text-muted mb-6">Here&apos;s what we found about your site conditions.</p>

            <div className="grid md:grid-cols-2 gap-4 mb-8">
              <AnalysisCard
                title="Sun Exposure"
                icon={<svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7a5 5 0 100 10 5 5 0 000-10zm0-5a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm0 18a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm9-9a1 1 0 110 2h-1a1 1 0 110-2h1zM4 12a1 1 0 110 2H3a1 1 0 110-2h1z" /></svg>}
                value={`~${siteProfile.effectiveSunHours.average} hours/day average`}
                detail={`Summer: ${siteProfile.effectiveSunHours.summer}h | Winter: ${siteProfile.effectiveSunHours.winter}h`}
              />
              <AnalysisCard
                title="Soil"
                icon={<svg className="w-5 h-5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M3 17h18M5 13h14M7 9h10" /></svg>}
                value={siteProfile.soilType.replace('_', ' ')}
                detail={`Drainage: ${siteProfile.soilDrainage}`}
              />
              <AnalysisCard
                title="Moisture Level"
                icon={<svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2c-5.33 8-8 12-8 15a8 8 0 1016 0c0-3-2.67-7-8-15z" /></svg>}
                value={siteProfile.moistureCategory.charAt(0).toUpperCase() + siteProfile.moistureCategory.slice(1)}
                detail={siteProfile.rawData.soilDescription || ''}
              />
              <AnalysisCard
                title="Elevation & Flood Risk"
                icon={<svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                value={`${siteProfile.elevation} ft elevation`}
                detail={siteProfile.rawData.floodZoneDescription || 'No flood zone data'}
              />
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep('location')} className="text-muted hover:text-foreground px-4 py-2 transition-colors">
                ← Back
              </button>
              <button
                onClick={() => setStep('preferences')}
                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
              >
                Set Goals →
              </button>
            </div>
          </div>
        )}

        {step === 'preferences' && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Your goals</h2>
            <p className="text-muted mb-6">Tell us what you&apos;re looking for and we&apos;ll customize your plan.</p>

            <div className="space-y-6 mb-8">
              {/* Effort level */}
              <div>
                <label className="block font-medium mb-3">How much effort do you want to invest?</label>
                <div className="grid grid-cols-3 gap-3">
                  {(['low', 'medium', 'high'] as const).map(level => (
                    <button
                      key={level}
                      onClick={() => setPreferences(p => ({ ...p, effortLevel: level }))}
                      className={`p-3 rounded-lg border text-center transition-all ${
                        preferences.effortLevel === level
                          ? 'border-primary bg-primary/5 text-primary font-medium'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="font-medium capitalize">{level}</div>
                      <div className="text-xs text-muted mt-1">
                        {level === 'low' && 'Plant & forget'}
                        {level === 'medium' && 'Some care needed'}
                        {level === 'high' && 'Active gardening'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Wildlife goals */}
              <div>
                <label className="block font-medium mb-3">What wildlife do you want to support?</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'pollinators', label: 'Pollinators', emoji: '🐝' },
                    { id: 'butterflies', label: 'Butterflies', emoji: '🦋' },
                    { id: 'birds', label: 'Birds', emoji: '🐦' },
                    { id: 'mammals', label: 'Small mammals', emoji: '🐿' },
                  ].map(goal => (
                    <button
                      key={goal.id}
                      onClick={() => {
                        setPreferences(p => ({
                          ...p,
                          habitatGoals: p.habitatGoals.includes(goal.id)
                            ? p.habitatGoals.filter(g => g !== goal.id)
                            : [...p.habitatGoals, goal.id],
                        }));
                      }}
                      className={`px-4 py-2 rounded-full border text-sm transition-all ${
                        preferences.habitatGoals.includes(goal.id)
                          ? 'border-primary bg-primary/5 text-primary font-medium'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      {goal.emoji} {goal.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aesthetic preference */}
              <div>
                <label className="block font-medium mb-3">Garden style</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'wild', label: 'Natural/Wild', desc: 'Meadow-like feel' },
                    { id: 'mixed', label: 'Mixed', desc: 'Best of both' },
                    { id: 'structured', label: 'Structured', desc: 'Neat and orderly' },
                  ].map(style => (
                    <button
                      key={style.id}
                      onClick={() => setPreferences(p => ({ ...p, aestheticPref: style.id as any }))}
                      className={`p-3 rounded-lg border text-center transition-all ${
                        preferences.aestheticPref === style.id
                          ? 'border-primary bg-primary/5 text-primary font-medium'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="font-medium">{style.label}</div>
                      <div className="text-xs text-muted mt-1">{style.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Bloom preference */}
              <div>
                <label className="block font-medium mb-3">When do you want the most blooms?</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { id: 'spring', label: 'Spring' },
                    { id: 'summer', label: 'Summer' },
                    { id: 'fall', label: 'Fall' },
                    { id: 'continuous', label: 'All season' },
                  ].map(b => (
                    <button
                      key={b.id}
                      onClick={() => setPreferences(p => ({ ...p, bloomPreference: b.id as any }))}
                      className={`p-3 rounded-lg border text-center transition-all ${
                        preferences.bloomPreference === b.id
                          ? 'border-primary bg-primary/5 text-primary font-medium'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Special features */}
              <div>
                <label className="block font-medium mb-3">Any special features? (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'fall_color', label: 'Fall color' },
                    { id: 'winter_interest', label: 'Winter interest' },
                    { id: 'fragrant', label: 'Fragrant' },
                    { id: 'edible', label: 'Edible/medicinal' },
                    { id: 'rain_garden', label: 'Rain garden' },
                  ].map(feat => (
                    <button
                      key={feat.id}
                      onClick={() => {
                        setPreferences(p => ({
                          ...p,
                          specialFeatures: p.specialFeatures.includes(feat.id)
                            ? p.specialFeatures.filter(f => f !== feat.id)
                            : [...p.specialFeatures, feat.id],
                        }));
                      }}
                      className={`px-3 py-1.5 rounded-full border text-sm transition-all ${
                        preferences.specialFeatures.includes(feat.id)
                          ? 'border-primary bg-primary/5 text-primary font-medium'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      {feat.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setStep('analysis')} className="text-muted hover:text-foreground px-4 py-2 transition-colors">
                ← Back
              </button>
              <button
                onClick={generatePlan}
                disabled={generating}
                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {generating ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31" /></svg>
                    Generating plan...
                  </>
                ) : (
                  'Generate Plan →'
                )}
              </button>
            </div>
          </div>
        )}

        {step === 'plan' && generatedPlan && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Your Planting Plan</h2>
            <p className="text-muted mb-6">
              {generatedPlan.species.length} species selected across a {generatedPlan.gridCols}x{generatedPlan.gridRows} grid.
              Diversity score: {generatedPlan.diversityScore}/100
            </p>

            {/* Plan title */}
            <div className="mb-6">
              <input
                type="text"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                className="text-lg font-medium border-b-2 border-stone-200 focus:border-primary outline-none pb-1 w-full bg-transparent"
                placeholder="Name your plan..."
              />
            </div>

            {/* Satellite planting map */}
            <div className="h-[350px] md:h-[450px] rounded-xl overflow-hidden border border-stone-200 shadow-sm mb-2">
              <MapContainer
                center={[location.lat, location.lng]}
                zoom={19}
                showSearch={false}
                showLayerToggle={true}
                defaultSatellite={true}
                height="100%"
                areaOutline={location.areaGeoJson}
                plantMarkers={generatedPlan.plants
                  .filter(p => p.lat && p.lng)
                  .map(p => ({
                    lat: p.lat!,
                    lng: p.lng!,
                    color: p.bloomColor,
                    name: p.commonName,
                    slug: p.plantSlug,
                  }))}
              />
            </div>
            <p className="text-xs text-muted mb-6 text-center">
              Each dot represents a plant placement. Toggle Map/Satellite view in the bottom-right.
            </p>

            {/* Ecological impact */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
              <EcoCard label="Species" value={String(generatedPlan.species.length)} detail="unique native species" />
              <EcoCard label="Pollinators" value={String(generatedPlan.species.filter((s: any) => s.wildlifeValue?.includes('pollinators')).length)} detail="pollinator-supporting" />
              <EcoCard
                label="Bloom Months"
                value={String(new Set(generatedPlan.species.flatMap((s: any) => {
                  const months: number[] = [];
                  for (let m = s.bloomStartMonth; m <= s.bloomEndMonth; m++) months.push(m);
                  return months;
                })).size)}
                detail="months of blooms"
              />
              <EcoCard label="Diversity" value={`${generatedPlan.diversityScore}/100`} detail="diversity score" />
            </div>

            {/* Plant list */}
            <h3 className="text-lg font-semibold mb-4">Plant Manifest</h3>
            <div className="grid gap-3 mb-8">
              {getUniquePlants(generatedPlan.plants).map(({ plant, count }) => {
                const species = generatedPlan.species.find((s: any) => s.slug === plant.plantSlug);
                return (
                  <div key={plant.plantSlug} className="flex items-start gap-4 p-4 bg-surface rounded-lg border border-stone-200">
                    <div
                      className="w-10 h-10 rounded-full flex-shrink-0 mt-1"
                      style={{ backgroundColor: getPlantColor(plant.bloomColor) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium">{plant.commonName}</span>
                        <span className="text-sm text-muted italic">{plant.scientificName}</span>
                      </div>
                      <div className="text-sm text-muted mt-1">
                        Qty: {count} | Height: {plant.heightMaxInches}&quot; | Bloom: {plant.bloomColor}
                      </div>
                      {species?.description && (
                        <p className="text-sm text-muted mt-1">{species.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removePlantFromPlan(plant.plantSlug, plant.gridX, plant.gridY)}
                      className="text-stone-400 hover:text-red-500 transition-colors flex-shrink-0 mt-1"
                      title="Remove from plan"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3 justify-between">
              <button onClick={() => setStep('preferences')} className="text-muted hover:text-foreground px-4 py-2 transition-colors">
                ← Adjust goals
              </button>
              <div className="flex gap-3">
                <button
                  onClick={generatePlan}
                  disabled={generating}
                  className="border border-stone-300 px-4 py-2 rounded-lg hover:bg-stone-50 transition-colors text-sm"
                >
                  Regenerate
                </button>
                <button
                  onClick={savePlan}
                  disabled={saving}
                  className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? 'Saving...' : 'Save Plan'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EcoCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
      <div className="text-xs text-green-700 font-medium">{label}</div>
      <div className="text-xl font-bold text-green-800 mt-0.5">{value}</div>
      <div className="text-xs text-green-600">{detail}</div>
    </div>
  );
}

function makeDefaultPolygon(lat: number, lng: number): GeoJSON.Polygon {
  // ~20x20 ft area centered on the point
  const offset = 0.00003; // ~10 ft in degrees at Chicago latitude
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - offset, lat - offset],
      [lng + offset, lat - offset],
      [lng + offset, lat + offset],
      [lng - offset, lat + offset],
      [lng - offset, lat - offset],
    ]],
  };
}

function AnalysisCard({ title, icon, value, detail }: { title: string; icon: React.ReactNode; value: string; detail: string }) {
  return (
    <div className="p-4 bg-surface rounded-xl border border-stone-200">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-sm text-muted mt-1">{detail}</div>
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
  const color = getPlantColor(bloomColor);
  return color + '25'; // Add alpha
}

function getUniquePlants(plants: PlanPlant[]): { plant: PlanPlant; count: number }[] {
  const map = new Map<string, { plant: PlanPlant; count: number }>();
  plants.forEach(p => {
    const existing = map.get(p.plantSlug);
    if (existing) {
      existing.count += p.quantity;
    } else {
      map.set(p.plantSlug, { plant: p, count: p.quantity });
    }
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
