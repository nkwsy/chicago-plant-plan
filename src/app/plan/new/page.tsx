'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MapContainer from '@/components/map/MapContainer';
import PlantingLegend from '@/components/plan/PlantingLegend';
import GridPlanView from '@/components/plan/GridPlanView';
import type { EditTool } from '@/components/plan/GridPlanView';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences, PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';

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
    targetSpeciesCount: 5,
    densityMultiplier: 1.0,
  });
  const [allPlantsCache, setAllPlantsCache] = useState<any[]>([]);
  const [exclusionZones, setExclusionZones] = useState<ExclusionZone[]>([]);
  const [existingTrees, setExistingTrees] = useState<ExistingTree[]>([]);
  const [editMode, setEditMode] = useState<'none' | 'exclusion' | 'tree'>('none');
  const [editTool, setEditTool] = useState<EditTool>('select');
  const [editTreeSize, setEditTreeSize] = useState(20);
  const [selectedPlantSlug, setSelectedPlantSlug] = useState<string | null>(null);
  const [showSatellite, setShowSatellite] = useState(false);
  const [showSatBg, setShowSatBg] = useState(false);
  const [showShadows, setShowShadows] = useState(false);
  const [shadowHour, setShadowHour] = useState(14);
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

  // Compute area dimensions in feet
  const areaWidthFt = Math.max(10, Math.round(Math.sqrt(location.areaSqFt || 400) * 1.2));
  const areaHeightFt = Math.max(10, Math.round((location.areaSqFt || 400) / areaWidthFt));

  const currentIdx = steps.findIndex(s => s.key === step);

  async function runAnalysis() {
    if (!location.lat || !location.lng) return;
    setAnalyzing(true);
    try {
      const res = await fetch('/api/site-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: location.lat, lng: location.lng, existingTrees }),
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
      let allPlants = allPlantsCache;
      if (allPlants.length === 0) {
        const plantsRes = await fetch('/api/plants?all=1');
        allPlants = await plantsRes.json();
        setAllPlantsCache(allPlants);
      }

      // Import and run generation client-side (using the JSON data)
      const { generatePlan: gen } = await import('@/lib/planner/generate');
      const areaSqFt = location.areaSqFt || 400; // Default 20x20 ft
      const result = gen(
        allPlants, siteProfile, preferences, areaSqFt,
        location.areaGeoJson, [location.lat, location.lng],
        exclusionZones, existingTrees,
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
          exclusionZones,
          existingTrees,
          layoutVersion: 2,
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
                show3D={false}
                style="satellite-streets"
                height="100%"
                editMode={editMode}
                exclusionZones={exclusionZones}
                existingTrees={existingTrees}
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
                  setEditMode('none');
                }}
                onExclusionZoneCreated={(zone) => {
                  setExclusionZones(prev => [...prev, zone]);
                  setEditMode('none');
                }}
                onExistingTreePlaced={(tree) => {
                  setExistingTrees(prev => [...prev, tree]);
                  setEditMode('none');
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
                Draw your planting area on the map using the polygon tool (top-right).
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

              {/* Species count */}
              <div>
                <label className="block font-medium mb-1">How many different species?</label>
                <p className="text-sm text-muted mb-3">Start small and add more for greater diversity.</p>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={3}
                    max={40}
                    step={1}
                    value={preferences.targetSpeciesCount}
                    onChange={(e) => setPreferences(p => ({ ...p, targetSpeciesCount: parseInt(e.target.value) }))}
                    className="flex-1 accent-primary h-2 rounded-lg cursor-pointer"
                  />
                  <div className="w-16 text-center">
                    <span className="text-2xl font-bold text-primary">{preferences.targetSpeciesCount}</span>
                    <span className="text-xs text-muted block">species</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted mt-1 px-0.5">
                  <span>Simple</span>
                  <span>Diverse</span>
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

            {/* Plan title */}
            <div className="mb-4">
              <input
                type="text"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                className="text-lg font-medium border-b-2 border-stone-200 focus:border-primary outline-none pb-1 w-full bg-transparent"
                placeholder="Name your plan..."
              />
            </div>

            {/* Species count + quick regenerate */}
            <div className="flex items-center gap-3 mb-4 p-3 bg-stone-50 rounded-lg border border-stone-200 flex-wrap">
              <span className="text-sm font-medium text-muted">Species count:</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPreferences(p => ({ ...p, targetSpeciesCount: Math.max(3, p.targetSpeciesCount - 1) }))}
                  className="w-7 h-7 rounded-full border border-stone-300 bg-white hover:bg-stone-100 flex items-center justify-center text-lg font-bold leading-none"
                >−</button>
                <span className="w-10 text-center text-xl font-bold text-primary">{preferences.targetSpeciesCount}</span>
                <button
                  onClick={() => setPreferences(p => ({ ...p, targetSpeciesCount: Math.min(40, p.targetSpeciesCount + 1) }))}
                  className="w-7 h-7 rounded-full border border-stone-300 bg-white hover:bg-stone-100 flex items-center justify-center text-lg font-bold leading-none"
                >+</button>
              </div>
              <button
                onClick={generatePlan}
                disabled={generating}
                className="ml-auto text-sm px-4 py-1.5 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Regenerate'}
              </button>
            </div>

            {/* Site features editing toolbar */}
            <div className="flex flex-wrap items-center gap-2 mb-3 p-3 bg-stone-50 rounded-lg border border-stone-200">
              <span className="text-xs font-medium text-muted mr-1">Edit site:</span>
              <button onClick={() => setEditTool('select')}
                className={`px-3 py-1.5 text-sm rounded-lg border flex items-center gap-1.5 transition-all ${
                  editTool === 'select' ? 'bg-primary text-white border-primary' : 'border-stone-300 hover:bg-stone-50 bg-white'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
                Select
              </button>
              <button onClick={() => setEditTool('path')}
                className={`px-3 py-1.5 text-sm rounded-lg border flex items-center gap-1.5 transition-all ${
                  editTool === 'path' ? 'bg-gray-700 text-white border-gray-700' : 'border-stone-300 hover:bg-stone-50 bg-white'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                Draw Path
              </button>
              <button onClick={() => setEditTool('tree')}
                className={`px-3 py-1.5 text-sm rounded-lg border flex items-center gap-1.5 transition-all ${
                  editTool === 'tree' ? 'bg-green-700 text-white border-green-700' : 'border-stone-300 hover:bg-stone-50 bg-white'}`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 22V8M12 8C12 8 8 4 5 6C2 8 4 12 7 12C9 12 12 8 12 8ZM12 8C12 8 16 4 19 6C22 8 20 12 17 12C15 12 12 8 12 8Z" /></svg>
                Place Tree
              </button>
              {editTool === 'tree' && (
                <select value={editTreeSize} onChange={e => setEditTreeSize(parseInt(e.target.value))}
                  className="px-2 py-1.5 border border-stone-300 rounded-lg text-sm bg-white">
                  <option value={10}>Small (10ft)</option>
                  <option value={20}>Medium (20ft)</option>
                  <option value={30}>Large (30ft)</option>
                </select>
              )}
              <span className="text-xs text-muted ml-auto">
                {editTool === 'path' && 'Click and drag to draw a path or patio'}
                {editTool === 'tree' && 'Click to place a tree'}
                {editTool === 'select' && 'Click features to remove them'}
              </span>
            </div>

            {/* Feature tags */}
            {(exclusionZones.length > 0 || existingTrees.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-3">
                {exclusionZones.map(z => (
                  <div key={z.id} className="flex items-center gap-1.5 bg-gray-100 px-2.5 py-1 rounded-lg text-xs">
                    <div className="w-3 h-3 bg-gray-400 rounded-sm" />
                    <span>{z.label}</span>
                    <button onClick={() => { setExclusionZones(prev => prev.filter(x => x.id !== z.id)); }}
                      className="text-gray-400 hover:text-red-500 ml-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                {existingTrees.map(t => (
                  <div key={t.id} className="flex items-center gap-1.5 bg-green-50 px-2.5 py-1 rounded-lg text-xs">
                    <div className="w-3 h-3 bg-green-600 rounded-full" />
                    <span>{t.label} ({t.canopyDiameterFt}ft)</span>
                    <button onClick={() => { setExistingTrees(prev => prev.filter(x => x.id !== t.id)); }}
                      className="text-green-400 hover:text-red-500 ml-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* View controls */}
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
                  onChange={(e) => setShadowHour(parseFloat(e.target.value))}
                  className="w-24 accent-slate-600"
                />
                <span className="text-xs text-muted w-14">
                  {shadowHour < 12 ? `${Math.floor(shadowHour)}:${String(Math.round((shadowHour%1)*60)).padStart(2,'0')} AM`
                    : shadowHour === 12 ? '12:00 PM'
                    : `${Math.floor(shadowHour)-12}:${String(Math.round((shadowHour%1)*60)).padStart(2,'0')} PM`}
                </span>
              </div>

              <span className="ml-auto text-xs text-muted">
                {generatedPlan.species.length} spp · {generatedPlan.plants.length} plants
              </span>
            </div>

            {/* Plan view: satellite 3D map OR clean SVG layout */}
            {showSatellite ? (
              <div className="rounded-xl overflow-hidden border border-stone-200 shadow-sm mb-2" style={{ height: '460px' }}>
                <MapContainer
                  center={[location.lat, location.lng]}
                  zoom={20}
                  style="satellite-streets"
                  show3D={true}
                  showSunlight={true}
                  showSearch={false}
                  areaOutline={location.areaGeoJson}
                  exclusionZones={exclusionZones}
                  existingTrees={existingTrees}
                  plantPlacements={generatedPlan.plants
                    .filter((p: PlanPlant) => p.lat && p.lng)
                    .map((p: PlanPlant) => ({
                      lat: p.lat!, lng: p.lng!,
                      color: p.bloomColor, name: p.commonName,
                      slug: p.plantSlug, imageUrl: p.imageUrl,
                      spreadInches: p.spreadInches, speciesIndex: p.speciesIndex,
                      plantType: p.plantType,
                    }))}
                  onPlantClick={(slug) => setSelectedPlantSlug(slug === selectedPlantSlug ? null : slug)}
                  height="100%"
                />
              </div>
            ) : (
              <GridPlanView
                widthFt={areaWidthFt}
                heightFt={areaHeightFt}
                centerLat={location.lat}
                centerLng={location.lng}
                plants={generatedPlan.plants}
                exclusionZones={exclusionZones}
                existingTrees={existingTrees}
                selectedSlug={selectedPlantSlug}
                onPlantClick={(slug) => setSelectedPlantSlug(slug === selectedPlantSlug ? null : slug)}
                nearbyBuildings={siteProfile?.nearbyBuildings}
                showSatellite={showSatBg}
                showShadows={showShadows}
                shadowHour={shadowHour}
                editable
                editTool={editTool}
                editTreeSize={editTreeSize}
                onPathDrawn={(zone) => setExclusionZones(prev => [...prev, zone])}
                onTreePlaced={(tree) => setExistingTrees(prev => [...prev, tree])}
                onFeatureRemoved={(type, id) => {
                  if (type === 'zone') setExclusionZones(prev => prev.filter(z => z.id !== id));
                  else setExistingTrees(prev => prev.filter(t => t.id !== id));
                }}
              />
            )}
            <p className="text-xs text-muted mb-4 mt-2 text-center">
              {showSatellite
                ? '3D view — buildings cast real shadows. Use the time slider above to see shadow movement.'
                : 'Numbered circles match the legend below. Colors show species zones.'}
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

            {/* Plant legend */}
            <div className="mb-8">
              <PlantingLegend
                plants={generatedPlan.plants}
                selectedSlug={selectedPlantSlug}
                onSelect={setSelectedPlantSlug}
                allPlants={allPlantsCache}
                densityMultiplier={preferences.densityMultiplier}
                onDensityChange={(d) => {
                  setPreferences(p => ({ ...p, densityMultiplier: d }));
                  // Will regenerate on next click
                }}
                onRemoveSpecies={(slug) => {
                  if (!generatedPlan) return;
                  const newPlants = generatedPlan.plants.filter(p => p.plantSlug !== slug);
                  const newSpecies = generatedPlan.species.filter((s: any) => s.slug !== slug);
                  setGeneratedPlan({ ...generatedPlan, plants: newPlants, species: newSpecies });
                }}
                onSwapSpecies={(oldSlug, newSlug) => {
                  if (!generatedPlan) return;
                  const replacement = allPlantsCache.find((p: any) => p.slug === newSlug);
                  if (!replacement) return;
                  const newPlants = generatedPlan.plants.map(p =>
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
                  const newSpecies = generatedPlan.species.map((s: any) =>
                    s.slug === oldSlug ? replacement : s
                  );
                  setGeneratedPlan({ ...generatedPlan, plants: newPlants, species: newSpecies });
                }}
              />
            </div>

            <div className="flex flex-wrap gap-3 justify-between">
              <button onClick={() => setStep('preferences')} className="text-muted hover:text-foreground px-4 py-2 transition-colors">
                ← Adjust goals
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
