'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import MapContainer from '@/components/map/MapContainer';
import PlanFilterPanel, { EMPTY_FILTERS, applyPlanFilters, type PlanFilters } from '@/components/plan/PlanFilterPanel';
import PlantCatalogPicker from '@/components/plan/PlantCatalogPicker';
import { type BrushState, type CopiedRegion } from '@/components/plan/sidebar/shared';
import ProEditor, {
  type EditorTool, type LayerId, type LayerState,
} from '@/components/plan/editor/ProEditor';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences, PlanPlant, ExclusionZone, ExistingTree } from '@/types/plan';
import type { DesignFormula } from '@/types/formula';
import * as turf from '@turf/turf';

/** True when the tree's lat/lng falls outside the bed polygon. The
 *  "outside" status is purely a function of geometry — having the user
 *  hand-flag it would let the saved label drift out of sync if they redrew
 *  the bed. */
function isTreeOutsideBed(
  tree: { lat: number; lng: number },
  polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined,
): boolean {
  if (!polygon) return true;
  try {
    return !turf.booleanPointInPolygon(turf.point([tree.lng, tree.lat]), polygon);
  } catch {
    return true;
  }
}

type Step = 'location' | 'analysis' | 'design' | 'plan';

/** Species shape returned by /api/formulas/preview. */
interface PreviewSpecies {
  slug: string;
  commonName: string;
  scientificName: string;
  plantType: string;
  oudolfRole: string | null;
  bloomColor: string;
  imageUrl: string;
  isCharacteristic: boolean;
}

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
  // Preferences are a mix of UI-exposed fields (effort, species count, tree /
  // shrub toggles) and defaulted-to-sensible fields (habitatGoals,
  // bloomPreference, specialFeatures) that the scorer still reads but the
  // simplified wizard no longer asks about. The formula handles those axes
  // with much richer controls.
  const [preferences, setPreferences] = useState<UserPreferences>({
    effortLevel: 'normal',
    habitatGoals: ['pollinators'],
    aestheticPref: 'mixed',
    bloomPreference: 'continuous',
    maxHeightInches: null,
    avoidSlugs: [],
    specialFeatures: [],
    targetSpeciesCount: 15,
    densityMultiplier: 1.0,
    includeTrees: true,
    includeShrubs: true,
    layoutMode: 'numbered',
  });
  const [allPlantsCache, setAllPlantsCache] = useState<any[]>([]);
  const [exclusionZones, setExclusionZones] = useState<ExclusionZone[]>([]);
  const [existingTrees, setExistingTrees] = useState<ExistingTree[]>([]);
  const [editMode, setEditMode] = useState<'none' | 'exclusion' | 'tree' | 'fence'>('none');
  const [selectedPlantSlug, setSelectedPlantSlug] = useState<string | null>(null);
  const detectBuildingsRef = useRef<(() => ExclusionZone[]) | null>(null);
  const computeSunGridRef = useRef<(() => Promise<import('@/types/plan').SunGrid | null>) | null>(null);
  const [view3D, setView3D] = useState(false);
  const [showSunlight, setShowSunlight] = useState(true);
  const [showSunGrid, setShowSunGrid] = useState(false);
  // Plant rendering: 'numbered' (default, designer view) vs 'tapestry' (soft
  // Oudolf-style render of the planting drift). Users toggle from the plan
  // step toolbar.
  const [plantRenderMode, setPlantRenderMode] = useState<'numbered' | 'tapestry'>('numbered');
  const [showSymbols, setShowSymbols] = useState(true);
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [symbolSetSlug, setSymbolSetSlug] = useState<string>('oudolf-classic');
  const [symbolSets, setSymbolSets] = useState<import('@/types/symbol-set').SymbolSet[]>([]);
  const activeSymbolSet = symbolSets.find((s) => s.slug === symbolSetSlug) || null;
  // Load available symbol sets once.
  useEffect(() => {
    fetch('/api/symbol-sets')
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setSymbolSets(d) : null)
      .catch(() => {/* keep going without symbols */});
  }, []);
  const [generatedPlan, setGeneratedPlan] = useState<{
    plants: PlanPlant[];
    gridCols: number;
    gridRows: number;
    diversityScore: number;
    species: any[];
    sunGrid?: any;
  } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planTitle, setPlanTitle] = useState('My Native Garden');
  const [authorEmail, setAuthorEmail] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  // --- Manual editing state ----------------------------------------------------
  // brush: unified state for all canvas-edit modes (paint/erase/select/paste)
  //   plus the active species set + stamp pattern. Lives in the parent so the
  //   sidebar tools and the map-click handlers share one source of truth.
  // pinnedSlugs: species the user pinned from the catalog. Forced into the
  //   candidate selection on the next regenerate.
  // copiedRegion: most recent select-rectangle capture, for paste.
  // pickerOpen: catalog modal visibility.
  // sidebarOpen: collapsible sidebar.
  const [brush, setBrush] = useState<BrushState>({ kind: null, slugs: [], pattern: 1 });
  const [pinnedSlugs, setPinnedSlugs] = useState<string[]>([]);
  const [copiedRegion, setCopiedRegion] = useState<CopiedRegion | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Pro Editor (v1) tool state. Tools map onto brush.kind for the existing
  // map handlers — see toolToEditMode() below.
  const [tool, setTool] = useState<EditorTool>('move');
  // Multi-selection (placement indices, stored as strings to align with the
  // sandbox model). Drives the Properties panel + bulk Copy / Delete.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Layer model — every plant rolls up into one of four Oudolf roles. The
  // catalog's `oudolfRole` field is the source of truth; plants without one
  // default to 'matrix'.
  const [layers, setLayers] = useState<Record<LayerId, LayerState>>({
    matrix: { visible: true, locked: false },
    structure: { visible: true, locked: false },
    scatter: { visible: true, locked: false },
    filler: { visible: true, locked: false },
  });
  // Modifier-key refs — read inside map click handlers to decide whether
  // shift-click adds and alt-click subtracts. We track via window listeners
  // so the refs reflect the current state regardless of focus path.
  const shiftKeyRef = useRef(false);
  const altKeyRef = useRef(false);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Shift') shiftKeyRef.current = true;
      if (e.key === 'Alt') altKeyRef.current = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Shift') shiftKeyRef.current = false;
      if (e.key === 'Alt') altKeyRef.current = false;
    }
    function onBlur() { shiftKeyRef.current = false; altKeyRef.current = false; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Tool ↔ brush.kind sync — the editor's user-facing tool maps to the
  // map's existing placementEditMode. Stamp tool just toggles a different
  // pattern; brush.kind stays 'paint'. Eyedropper is handled in onPlantEdit.
  useEffect(() => {
    setBrush(b => {
      const map: Record<EditorTool, BrushState['kind']> = {
        move: 'select', marquee: 'select', lasso: 'select', drag: 'select',
        brush: 'paint', stamp: 'paint',
        erase: 'erase', eyedropper: 'select',
      };
      return {
        ...b,
        kind: map[tool],
        // Brush is single-up; Stamp uses whatever pattern the user picked.
        pattern: tool === 'stamp' ? (b.pattern === 1 ? 3 : b.pattern) : 1,
      };
    });
  }, [tool]);

  const steps: { key: Step; label: string }[] = [
    { key: 'location', label: 'Location' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'design', label: 'Design' },
    { key: 'plan', label: 'Plan' },
  ];

  const currentIdx = steps.findIndex(s => s.key === step);

  // --- Design-formula state ---------------------------------------------------
  // Formulas are loaded once when the user reaches the 'design' step. Preview
  // data is fetched per-selection and cached by slug to avoid re-running the
  // scorer when the user toggles between tiles.
  const [formulas, setFormulas] = useState<DesignFormula[]>([]);
  const [formulasLoading, setFormulasLoading] = useState(false);
  const [previewBySlug, setPreviewBySlug] = useState<Record<string, PreviewSpecies[]>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  // Session + tab state for the Built-in / My formulas picker.
  const [me, setMe] = useState<{ id: string; role: 'user' | 'admin' } | null>(null);
  const [formulaTab, setFormulaTab] = useState<'built-in' | 'mine'>('built-in');

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { user: { id: string; role: 'user' | 'admin' } | null }) => setMe(d.user))
      .catch(() => {});
  }, []);

  // Re-derive each existing tree's outside-bed flag whenever the bed
  // polygon changes. The badge in the list reads the flag from state, so
  // without this the saved values lag behind the live geometry after a
  // redraw.
  useEffect(() => {
    setExistingTrees(prev => {
      let changed = false;
      const next = prev.map(t => {
        const want = isTreeOutsideBed(t, location.areaGeoJson);
        if ((t.outsideProperty ?? false) === want) return t;
        changed = true;
        return { ...t, outsideProperty: want };
      });
      return changed ? next : prev;
    });
  }, [location.areaGeoJson]);

  useEffect(() => {
    if (step !== 'design' || formulas.length > 0 || formulasLoading) return;
    setFormulasLoading(true);
    fetch('/api/formulas')
      .then((r) => r.json())
      .then((data: DesignFormula[]) => setFormulas(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setFormulasLoading(false));
  }, [step, formulas.length, formulasLoading]);

  async function loadPreview(slug: string | undefined) {
    // "None" (classic selection) uses empty-string cache key.
    const cacheKey = slug || '__none__';
    if (previewBySlug[cacheKey]) return;
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/formulas/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formulaSlug: slug,
          siteProfile,
          preferences,
          targetCount: 15,
        }),
      });
      const data = (await res.json()) as { species?: PreviewSpecies[] };
      setPreviewBySlug((prev) => ({ ...prev, [cacheKey]: data.species || [] }));
    } catch {
      // Silent fail — the UI shows an empty preview
    } finally {
      setPreviewLoading(false);
    }
  }

  function selectFormula(slug: string | undefined) {
    setPreferences((p) => ({ ...p, formulaSlug: slug }));
    loadPreview(slug);
  }

  /**
   * Append auto-detected buildings to exclusionZones, skipping any that
   * already overlap a user-drawn or previously-auto-detected zone. Dedup
   * is by first-vertex proximity (~1m in lat/lng at Chicago). Cheaper than
   * a full polygon overlap check and good enough — Mapbox returns the
   * same building feature with the same vertex order across tiles.
   */
  function mergeDetectedBuildings(zones: ExclusionZone[]) {
    if (!zones.length) return;
    setExclusionZones((prev) => {
      const existingFirstVerts = prev
        .filter((z) => z.type === 'building')
        .map((z) => z.geoJson.coordinates[0]?.[0])
        .filter(Boolean) as [number, number][];
      const TOL = 0.00001; // ≈1m
      const novel = zones.filter((z) => {
        const v = z.geoJson.coordinates[0]?.[0];
        if (!v) return false;
        return !existingFirstVerts.some(
          ([elng, elat]) =>
            Math.abs((v[0] as number) - elng) < TOL &&
            Math.abs((v[1] as number) - elat) < TOL,
        );
      });
      if (!novel.length) return prev;
      return [...prev, ...novel];
    });
  }

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

      // Resolve the selected formula (if any). Fetched on demand rather than
      // kept in state so a user editing the slug via URL/query never gets a
      // stale preset.
      let formula: DesignFormula | undefined;
      if (preferences.formulaSlug) {
        try {
          const res = await fetch(
            `/api/formulas/${encodeURIComponent(preferences.formulaSlug)}`,
          );
          if (res.ok) formula = (await res.json()) as DesignFormula;
        } catch {
          // Swallow — generation still works without the formula, just reverts to classic.
        }
      }

      // Import and run generation client-side (using the JSON data)
      const { generatePlan: gen } = await import('@/lib/planner/generate');
      const areaSqFt = location.areaSqFt || 400; // Default 20x20 ft
      // Pass global sun override if user manually set it
      const sunOverride = (siteProfile.effectiveSunHours as any)?.userOverride ?? null;
      const result = gen(
        allPlants, siteProfile, preferences, areaSqFt,
        location.areaGeoJson, [location.lat, location.lng],
        exclusionZones, existingTrees, sunOverride,
        formula, pinnedSlugs,
      );

      setGeneratedPlan({
        plants: result.plants,
        gridCols: result.gridCols,
        gridRows: result.gridRows,
        diversityScore: result.diversityScore,
        species: result.selectedSpecies,
        sunGrid: result.sunGrid,
      });
      setStep('plan');
    } catch (err) {
      console.error('Generation failed:', err);
      alert('Plan generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  }

  const [recalculating, setRecalculating] = useState(false);

  async function regenerateSunGrid() {
    if (!generatedPlan || !location.areaGeoJson) return;
    setRecalculating(true);
    try {
      // Try ShadeMap-powered computation (uses actual building geometry from map tiles)
      if (computeSunGridRef.current) {
        const newSunGrid = await computeSunGridRef.current();
        if (newSunGrid) {
          setGeneratedPlan(prev => prev ? { ...prev, sunGrid: newSunGrid } : prev);
          return;
        }
      }
      // Fallback: manual computation with polygon ray-casting
      const { polygonToBounds } = await import('@/lib/planner/layout');
      const { buildSunGrid } = await import('@/lib/analysis/sun-grid');
      const bounds = polygonToBounds(location.areaGeoJson, [location.lat, location.lng]);
      const buildings = siteProfile?.nearbyBuildings || [];
      const sunOverride = (siteProfile?.effectiveSunHours as any)?.userOverride ?? null;
      const newSunGrid = buildSunGrid(bounds, existingTrees, buildings, exclusionZones, location.areaGeoJson, sunOverride);
      setGeneratedPlan(prev => prev ? { ...prev, sunGrid: newSunGrid } : prev);
    } catch (err) {
      console.error('Sun grid regeneration failed:', err);
    } finally {
      setRecalculating(false);
    }
  }

  // Auto-regenerate the plan when trees or exclusions change (debounced).
  // `generatePlan()` already recomputes the sun grid as a side-effect via
  // `gen()` → `buildSunGrid`, so a full regen is strictly more complete than
  // refreshing the sun grid alone. We only fire on the plan step — you don't
  // have a plan to regenerate earlier in the wizard. Debounce 1500ms so
  // rapid tree-detail edits (canopy size, label) coalesce into one run.
  const autoRegenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regenInFlightRef = useRef(false);
  // Track the state that was present when the plan last regenerated, so the
  // effect only re-runs on real user changes — not on the initial transition
  // into the plan step (where the exclusion/tree arrays are identical to
  // what the plan was just generated against).
  const lastRegenSnapshotRef = useRef<{ excl: ExclusionZone[]; trees: ExistingTree[] } | null>(null);
  useEffect(() => {
    if (step !== 'plan' || !generatedPlan || !location.areaGeoJson) return;

    // First arrival on the plan step: snapshot the inputs the plan was
    // generated against, but don't regen.
    if (!lastRegenSnapshotRef.current) {
      lastRegenSnapshotRef.current = { excl: exclusionZones, trees: existingTrees };
      return;
    }
    // If nothing actually changed (e.g. a regen itself just set state), skip.
    if (
      lastRegenSnapshotRef.current.excl === exclusionZones &&
      lastRegenSnapshotRef.current.trees === existingTrees
    ) {
      return;
    }

    if (autoRegenTimerRef.current) clearTimeout(autoRegenTimerRef.current);
    autoRegenTimerRef.current = setTimeout(() => {
      if (regenInFlightRef.current || generating) return;
      regenInFlightRef.current = true;
      lastRegenSnapshotRef.current = { excl: exclusionZones, trees: existingTrees };
      generatePlan().finally(() => {
        regenInFlightRef.current = false;
      });
    }, 1500);
    return () => {
      if (autoRegenTimerRef.current) clearTimeout(autoRegenTimerRef.current);
    };
  }, [exclusionZones, existingTrees, step]); // eslint-disable-line react-hooks/exhaustive-deps

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
          authorEmail: authorEmail.trim().toLowerCase(),
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
          sunGrid: generatedPlan.sunGrid,
          layoutVersion: 3,
          isPublic,
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

  // The plan step renders the Pro Editor (v1) which manages its own
  // chrome and lays the map inline — so no fixed-position offset is needed
  // anymore. We just give the plan step a full-width container; other
  // steps keep the centered wizard column.
  const isPlanStep = step === 'plan' && generatedPlan;

  return (
    <div
      className={`${isPlanStep ? 'max-w-none px-4 py-4' : 'max-w-4xl mx-auto px-4 py-6'}`}
    >
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
                onBuildingsDetected={mergeDetectedBuildings}
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
                onClick={() => setStep('design')}
                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
              >
                Design →
              </button>
            </div>
          </div>
        )}

        {step === 'design' && (
          <div>
            <h2 className="text-2xl font-bold mb-2">Design your garden</h2>
            <p className="text-muted mb-6">
              Pick a design formula to bias plant selection, then set a few basic goals.
              Most of the style — bloom season, wildlife, aesthetic — is handled by the formula
              itself, so the questions below stay short.
            </p>

            {/* --- Design formula tiles ----------------------------------------- */}
            <h3 className="font-medium mb-3">Style</h3>

            {/* Tabs: Built-in (always), My formulas (auth-gated), and a "Create new" CTA. */}
            <div className="flex items-center gap-1 border-b border-stone-200 mb-4">
              <button
                type="button"
                onClick={() => setFormulaTab('built-in')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  formulaTab === 'built-in'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-foreground'
                }`}
              >
                Built-in
              </button>
              <button
                type="button"
                onClick={() => me && setFormulaTab('mine')}
                disabled={!me}
                title={!me ? 'Sign in to use personal formulas' : undefined}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  formulaTab === 'mine'
                    ? 'border-primary text-primary'
                    : !me
                      ? 'border-transparent text-stone-300 cursor-not-allowed'
                      : 'border-transparent text-muted hover:text-foreground'
                }`}
              >
                My formulas
                {me && (
                  <span className="ml-1.5 text-xs text-stone-500 bg-stone-100 rounded-full px-1.5">
                    {formulas.filter((f) => f.ownerId === me.id).length}
                  </span>
                )}
              </button>
              <a
                href={
                  me
                    ? '/formulas/new?next=/plan/new'
                    : '/login?next=/formulas/new?next=/plan/new'
                }
                className="ml-auto px-3 py-2 text-sm text-primary hover:underline"
              >
                + Create new formula
              </a>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {/* "None" tile — always first, restores classic pre-formula behavior. */}
              <FormulaTile
                name="Classic"
                description="Balanced selection across all available species. No style bias."
                selected={!preferences.formulaSlug}
                previewCount={previewBySlug['__none__']?.length}
                onClick={() => selectFormula(undefined)}
              />
              {formulasLoading && !formulas.length && (
                <div className="text-sm text-muted col-span-full">Loading formulas…</div>
              )}
              {formulas
                .filter((f) =>
                  formulaTab === 'built-in' ? f.isBuiltIn : me && f.ownerId === me.id,
                )
                .map((f) => (
                  <FormulaTile
                    key={f.slug}
                    name={f.name}
                    description={f.description}
                    selected={preferences.formulaSlug === f.slug}
                    previewCount={previewBySlug[f.slug]?.length}
                    ratios={f.typeRatios}
                    roleRatios={f.roleRatios}
                    isBuiltIn={f.isBuiltIn}
                    onClick={() => selectFormula(f.slug)}
                  />
                ))}
              {formulaTab === 'mine' && me && formulas.filter((f) => f.ownerId === me.id).length === 0 && (
                <div className="col-span-full bg-stone-50 border border-dashed border-stone-300 rounded-lg p-6 text-center text-sm text-muted">
                  You haven&apos;t created any formulas yet.{' '}
                  <a href="/formulas/new?next=/plan/new" className="text-primary hover:underline">
                    Start one →
                  </a>
                </div>
              )}
              {formulaTab === 'mine' && !me && (
                <div className="col-span-full bg-stone-50 border border-dashed border-stone-300 rounded-lg p-6 text-center text-sm text-muted">
                  <a href="/login?next=/plan/new" className="text-primary hover:underline">
                    Sign in
                  </a>{' '}
                  to use your own formulas.
                </div>
              )}
            </div>

            {/* Preview panel — shows the top species the formula would pick. */}
            <div className="bg-surface rounded-lg border border-stone-200 p-4 mb-8">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">
                  Preview
                  {preferences.formulaSlug
                    ? `: ${formulas.find((f) => f.slug === preferences.formulaSlug)?.name ?? ''}`
                    : ': Classic selection'}
                </h3>
                {previewLoading && (
                  <span className="text-xs text-muted">Calculating…</span>
                )}
              </div>
              <FormulaPreview
                species={previewBySlug[preferences.formulaSlug || '__none__']}
                loading={previewLoading}
              />
            </div>

            {/* --- Simplified goals ---------------------------------------------
             *  Everything else in the old preferences step (bloom season,
             *  wildlife goals, aesthetic preference, special features) is driven
             *  by the chosen formula or safely defaulted. We only expose the
             *  four controls that have no good formula proxy: maintenance
             *  effort, whether to include large structural plants, and
             *  species count.
             */}
            <h3 className="font-medium mb-3">Goals</h3>
            <div className="space-y-6 mb-8">
              {/* Effort level — two tiers only */}
              <div>
                <label className="block font-medium mb-3">Maintenance effort</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { id: 'low', title: 'Low', desc: 'Plant & forget' },
                    { id: 'normal', title: 'Normal', desc: 'Some seasonal care' },
                  ] as const).map(level => (
                    <button
                      key={level.id}
                      onClick={() => setPreferences(p => ({ ...p, effortLevel: level.id }))}
                      className={`p-3 rounded-lg border text-center transition-all ${
                        preferences.effortLevel === level.id
                          ? 'border-primary bg-primary/5 text-primary font-medium'
                          : 'border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      <div className="font-medium">{level.title}</div>
                      <div className="text-xs text-muted mt-1">{level.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Structural plants: trees and shrubs */}
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <label className="block font-medium mb-3">Include trees?</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: true, label: 'Yes' },
                      { id: false, label: 'No' },
                    ] as const).map(opt => (
                      <button
                        key={String(opt.id)}
                        onClick={() => setPreferences(p => ({ ...p, includeTrees: opt.id }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          (preferences.includeTrees !== false) === opt.id
                            ? 'border-primary bg-primary/5 text-primary font-medium'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block font-medium mb-3">Include shrubs?</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: true, label: 'Yes' },
                      { id: false, label: 'No' },
                    ] as const).map(opt => (
                      <button
                        key={String(opt.id)}
                        onClick={() => setPreferences(p => ({ ...p, includeShrubs: opt.id }))}
                        className={`p-3 rounded-lg border text-center transition-all ${
                          (preferences.includeShrubs !== false) === opt.id
                            ? 'border-primary bg-primary/5 text-primary font-medium'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
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
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep('analysis')}
                className="text-muted hover:text-foreground px-4 py-2 transition-colors"
              >
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
            <h2 className="text-2xl font-bold mb-3">Your Planting Plan</h2>

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
                  onClick={() => setView3D(false)}
                  className={`px-3 py-1.5 transition-colors ${!view3D ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                >
                  Top View
                </button>
                <button
                  onClick={() => setView3D(true)}
                  className={`px-3 py-1.5 border-l border-stone-200 transition-colors ${view3D ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                >
                  3D View
                </button>
              </div>

              {/* Render mode — numbered designer view vs Oudolf-style tapestry. */}
              <div className="flex rounded-lg border border-stone-200 overflow-hidden text-sm">
                <button
                  onClick={() => setPlantRenderMode('numbered')}
                  className={`px-3 py-1.5 transition-colors ${plantRenderMode === 'numbered' ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                  title="Crisp circles with species numbers"
                >
                  Numbered
                </button>
                <button
                  onClick={() => setPlantRenderMode('tapestry')}
                  className={`px-3 py-1.5 border-l border-stone-200 transition-colors ${plantRenderMode === 'tapestry' ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                  title="Soft-edge blobs that blend into a planting drift (Oudolf style)"
                >
                  Tapestry
                </button>
              </div>

              {/* Layout algorithm — legacy 3-phase placement, Voronoi-cell
               *  tapestry, or install-friendly uniform grid. Switching to
               *  Voronoi/Grid auto-flips render mode to Tapestry so the
               *  user immediately sees the cell shapes; regen on next
               *  Recalculate. */}
              <div className="flex rounded-lg border border-stone-200 overflow-hidden text-sm">
                <button
                  onClick={() => {
                    setPreferences(p => ({ ...p, layoutMode: 'numbered' }));
                  }}
                  className={`px-3 py-1.5 transition-colors ${(preferences.layoutMode ?? 'numbered') === 'numbered' ? 'bg-emerald-700 text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                  title="3-phase placement (legacy): structure → matrix → accent drifts"
                >
                  Layout: Drifts
                </button>
                <button
                  onClick={() => {
                    setPreferences(p => ({ ...p, layoutMode: 'tapestry' }));
                    setPlantRenderMode('tapestry');
                  }}
                  className={`px-3 py-1.5 border-l border-stone-200 transition-colors ${preferences.layoutMode === 'tapestry' ? 'bg-emerald-700 text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                  title="Voronoi-cell tapestry — every patch of bed owned by a plant, no voids (Oudolf-style)"
                >
                  Layout: Voronoi
                </button>
                <button
                  onClick={() => {
                    setPreferences(p => ({ ...p, layoutMode: 'grid' }));
                    setPlantRenderMode('tapestry');
                  }}
                  className={`px-3 py-1.5 border-l border-stone-200 transition-colors ${preferences.layoutMode === 'grid' ? 'bg-emerald-700 text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                  title="Uniform grid at on-center spacing — easiest to install with a tape measure"
                >
                  Layout: Grid
                </button>
              </div>

              {/* Grid spacing — only meaningful in grid mode. */}
              {preferences.layoutMode === 'grid' && (
                <label className="flex items-center gap-2 text-sm text-stone-700">
                  <span>Grid o.c.</span>
                  <select
                    value={preferences.gridSpacingInches ?? 18}
                    onChange={(e) => setPreferences(p => ({ ...p, gridSpacingInches: Number(e.target.value) }))}
                    className="border border-stone-300 rounded-md px-2 py-1 text-sm bg-white"
                    title="On-center spacing between grid points"
                  >
                    <option value={12}>12&quot;</option>
                    <option value={15}>15&quot;</option>
                    <option value={18}>18&quot;</option>
                    <option value={24}>24&quot;</option>
                    <option value={36}>36&quot;</option>
                  </select>
                </label>
              )}

              {/* Symbol set picker + on/off toggle. Glyphs render over both
               *  numbered and tapestry layers. */}
              <div className="flex rounded-lg border border-stone-200 overflow-hidden text-sm">
                <button
                  onClick={() => setShowSymbols(s => !s)}
                  className={`px-3 py-1.5 transition-colors ${showSymbols ? 'bg-amber-700 text-white' : 'bg-white text-muted hover:bg-stone-50'}`}
                  title="Toggle Oudolf-style plant symbols"
                >
                  Symbols
                </button>
                <select
                  value={symbolSetSlug}
                  onChange={(e) => setSymbolSetSlug(e.target.value)}
                  disabled={!showSymbols}
                  className="px-2 py-1.5 border-l border-stone-200 bg-white text-stone-700 text-sm disabled:bg-stone-50 disabled:text-stone-400"
                  title="Active symbol set"
                >
                  {symbolSets.map((s) => (
                    <option key={s.slug} value={s.slug}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Visibility filters live in the sidebar's Plants tab. */}

              <button
                onClick={() => setShowSunlight(s => !s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-all ${
                  showSunlight ? 'bg-amber-500 text-white border-amber-500' : 'border-stone-300 hover:border-stone-400 bg-white'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 7a5 5 0 100 10 5 5 0 000-10zm0-5a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm0 18a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm9-9a1 1 0 110 2h-1a1 1 0 110-2h1zM4 12a1 1 0 110 2H3a1 1 0 110-2h1z" /></svg>
                Sunlight
              </button>

              {generatedPlan.sunGrid && (
                <button
                  onClick={() => setShowSunGrid(s => !s)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-all ${
                    showSunGrid ? 'bg-blue-600 text-white border-blue-600' : 'border-stone-300 hover:border-stone-400 bg-white'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                  Sun Grid
                </button>
              )}

              <button
                onClick={regenerateSunGrid}
                disabled={recalculating || !generatedPlan}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border border-amber-400 hover:border-amber-500 bg-white text-amber-700 hover:bg-amber-50 transition-all disabled:opacity-50"
                title="Recalculate sun hours using current trees and building exclusions"
              >
                {recalculating ? (
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31" /></svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                )}
                {recalculating ? 'Recalculating...' : 'Recalculate Sun'}
              </button>

              <span className="ml-auto text-xs text-muted">
                {generatedPlan.species.length} spp · {generatedPlan.plants.length} plants
              </span>
            </div>

            {/* Edit tools (paint/stamps/multi-brush/erase/select/paste),
                features (exclusion/tree/fence), filters, pinned-plant chips,
                and the legend all live in PlannerSidebar now. The toolbar
                above this point keeps view-only controls (3D, render mode,
                layout, symbols, sun) where the user expects them. */}
            <div className="bg-surface rounded-lg p-4 border border-stone-200 mb-3 hidden">
              <p className="text-sm font-medium mb-3">Mark features on your property <span className="text-muted font-normal">(optional)</span></p>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => setEditMode(editMode === 'exclusion' ? 'none' : 'exclusion')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-all ${
                    editMode === 'exclusion'
                      ? 'bg-stone-700 text-white border-stone-700'
                      : 'border-stone-300 hover:border-stone-400 bg-white'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  {editMode === 'exclusion' ? 'Drawing... (double-click to finish)' : 'Mark Path / Area to Exclude'}
                </button>
                <button
                  onClick={() => setEditMode(editMode === 'tree' ? 'none' : 'tree')}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-all ${
                    editMode === 'tree'
                      ? 'bg-green-700 text-white border-green-700'
                      : 'border-stone-300 hover:border-stone-400 bg-white'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-6m0 0l-3 3m3-3l3 3M6.75 9a5.25 5.25 0 1110.5 0C17.25 12.75 12 15 12 15S6.75 12.75 6.75 9z" />
                  </svg>
                  {editMode === 'tree' ? 'Click map to place tree...' : 'Add Nearby Tree'}
                </button>
                <button
                  onClick={() => {
                    const zones = detectBuildingsRef.current?.() || [];
                    if (zones.length > 0) {
                      setExclusionZones(prev => [...prev, ...zones]);
                    } else {
                      alert('No buildings detected in the current map view. Try zooming in closer.');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-stone-300 hover:border-stone-400 bg-white transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                  Detect Buildings
                </button>
                {editMode !== 'none' && (
                  <button
                    onClick={() => setEditMode('none')}
                    className="px-3 py-2 text-sm text-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* Listed exclusion zones */}
              {exclusionZones.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-medium text-muted mb-1">Excluded areas:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {exclusionZones.map((z) => (
                      <div key={z.id} className="flex items-center gap-1 bg-stone-100 rounded px-2 py-1 text-xs">
                        <select
                          value={z.type}
                          onChange={(e) => setExclusionZones(prev =>
                            prev.map(ez => ez.id === z.id ? { ...ez, type: e.target.value as ExclusionZone['type'], label: e.target.value === 'other' ? 'Excluded Area' : e.target.value.charAt(0).toUpperCase() + e.target.value.slice(1) } : ez)
                          )}
                          className="bg-transparent text-xs border-none outline-none cursor-pointer pr-1"
                        >
                          <option value="sidewalk">Sidewalk</option>
                          <option value="walkway">Walkway</option>
                          <option value="patio">Patio</option>
                          <option value="driveway">Driveway</option>
                          <option value="shed">Shed</option>
                          <option value="building">Building</option>
                          <option value="other">Other</option>
                        </select>
                        <button
                          onClick={() => setExclusionZones(prev => prev.filter(ez => ez.id !== z.id))}
                          className="text-stone-400 hover:text-red-500 ml-1"
                        >&times;</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Listed trees */}
              {existingTrees.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted mb-1">Nearby trees:</p>
                  <div className="flex flex-col gap-1.5">
                    {existingTrees.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 bg-green-50 rounded px-2 py-1.5 text-xs">
                        <span className="text-green-800">🌳</span>
                        <input
                          type="text"
                          value={t.label}
                          onChange={(e) => setExistingTrees(prev =>
                            prev.map(et => et.id === t.id ? { ...et, label: e.target.value } : et)
                          )}
                          className="bg-transparent border-none outline-none text-xs w-24"
                          placeholder="Label"
                        />
                        <label className="flex items-center gap-1 text-xs text-muted">
                          Canopy:
                          <select
                            value={t.canopyDiameterFt}
                            onChange={(e) => setExistingTrees(prev =>
                              prev.map(et => et.id === t.id ? { ...et, canopyDiameterFt: Number(e.target.value) } : et)
                            )}
                            className="bg-white border border-stone-200 rounded px-1 py-0.5 text-xs"
                          >
                            <option value={10}>10ft</option>
                            <option value={15}>15ft</option>
                            <option value={20}>20ft</option>
                            <option value={30}>30ft</option>
                            <option value={40}>40ft</option>
                            <option value={50}>50ft</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1 text-xs text-muted">
                          Height:
                          <select
                            value={t.heightFt || 30}
                            onChange={(e) => setExistingTrees(prev =>
                              prev.map(et => et.id === t.id ? { ...et, heightFt: Number(e.target.value) } : et)
                            )}
                            className="bg-white border border-stone-200 rounded px-1 py-0.5 text-xs"
                          >
                            <option value={15}>15ft</option>
                            <option value={20}>20ft</option>
                            <option value={30}>30ft</option>
                            <option value={40}>40ft</option>
                            <option value={50}>50ft</option>
                            <option value={60}>60ft</option>
                            <option value={80}>80ft</option>
                          </select>
                        </label>
                        {/* Derived badge — point-in-polygon against the bed
                         *  outline. No checkbox: the geometry is the source
                         *  of truth, hand-editing the flag just lets it drift
                         *  out of sync. */}
                        {(() => {
                          const outside = isTreeOutsideBed(t, location.areaGeoJson);
                          return (
                            <span
                              className={`text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5 ml-1 ${
                                outside
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                              title={
                                outside
                                  ? 'This tree sits outside the bed polygon — its shadow still affects the plan.'
                                  : 'This tree is inside the bed polygon.'
                              }
                            >
                              {outside ? 'Outside bed' : 'Inside bed'}
                            </span>
                          );
                        })()}
                        <button
                          onClick={() => setExistingTrees(prev => prev.filter(et => et.id !== t.id))}
                          className="text-stone-400 hover:text-red-500 ml-auto"
                        >&times;</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Pro Editor — wraps the map with a Photoshop-style toolbar
                (left rail of tools, contextual options bar above the map,
                right panels for plant library / layers / properties / pinned
                / shortcuts, status bar at the bottom). */}
            <ProEditor
              tool={tool}
              setTool={setTool}
              brush={brush}
              setBrush={setBrush}
              copiedRegion={copiedRegion}
              plants={generatedPlan.plants}
              visiblePlants={generatedPlan.plants.filter((p: PlanPlant) => {
                const cat = allPlantsCache.find((c: { slug: string }) => c.slug === p.plantSlug);
                const layer = (cat?.oudolfRole ?? 'matrix') as LayerId;
                return layers[layer].visible;
              }).length}
              species={allPlantsCache as any}
              activeSpeciesIdx={(() => {
                const slug = brush.slugs[0];
                if (!slug) return null;
                const sp = allPlantsCache.find((s: any) => s.slug === slug);
                return sp?.speciesIndex ?? null;
              })()}
              onSetActiveSpeciesIdx={(slug) => {
                setBrush(b => ({ ...b, kind: 'paint', slugs: [slug] }));
                if (tool !== 'brush' && tool !== 'stamp') setTool('brush');
              }}
              pinnedSlugs={pinnedSlugs}
              onUnpin={(slug) => setPinnedSlugs(s => s.filter(x => x !== slug))}
              onOpenCatalog={() => setPickerOpen(true)}
              layers={layers}
              toggleLayerVisible={(l) => setLayers(prev => ({ ...prev, [l]: { ...prev[l], visible: !prev[l].visible } }))}
              toggleLayerLocked={(l) => setLayers(prev => ({ ...prev, [l]: { ...prev[l], locked: !prev[l].locked } }))}
              selectedIds={selectedIds}
              selectionCount={selectedIds.size}
              selectionSpecies={(() => {
                const map = new Map<string, { slug: string; commonName: string; count: number }>();
                for (const id of selectedIds) {
                  const p = generatedPlan.plants[Number(id)];
                  if (!p) continue;
                  const ex = map.get(p.plantSlug);
                  if (ex) ex.count += 1;
                  else map.set(p.plantSlug, { slug: p.plantSlug, commonName: p.commonName, count: 1 });
                }
                return Array.from(map.values());
              })()}
              onSelectAll={() => {
                const all = new Set<string>();
                generatedPlan.plants.forEach((p, i) => {
                  const cat = allPlantsCache.find((s: any) => s.slug === p.plantSlug);
                  const layer = (cat?.oudolfRole ?? 'matrix') as LayerId;
                  if (layers[layer].visible && !layers[layer].locked) all.add(String(i));
                });
                setSelectedIds(all);
              }}
              onDeselect={() => setSelectedIds(new Set())}
              onCopy={() => {
                if (!selectedIds.size) return;
                const sel = Array.from(selectedIds)
                  .map(id => generatedPlan.plants[Number(id)])
                  .filter((p): p is PlanPlant => !!p && p.lat != null && p.lng != null);
                if (!sel.length) return;
                const aLat = sel.reduce((a, p) => a + p.lat!, 0) / sel.length;
                const aLng = sel.reduce((a, p) => a + p.lng!, 0) / sel.length;
                setCopiedRegion({
                  anchor: { lat: aLat, lng: aLng },
                  plants: sel.map(p => ({
                    offsetLat: p.lat! - aLat, offsetLng: p.lng! - aLng, plant: p,
                  })),
                });
              }}
              onPaste={() => {
                if (!copiedRegion) return;
                setBrush(b => ({ ...b, kind: 'paste' }));
              }}
              onDelete={() => {
                if (!selectedIds.size) return;
                setGeneratedPlan(prev => prev ? {
                  ...prev,
                  plants: prev.plants.filter((_, i) => !selectedIds.has(String(i))),
                } : prev);
                setSelectedIds(new Set());
              }}
              onSwapSelectionTo={(newSlug) => {
                if (!selectedIds.size) return;
                const replacement = allPlantsCache.find((s: any) => s.slug === newSlug);
                if (!replacement) return;
                setGeneratedPlan(prev => prev ? {
                  ...prev,
                  plants: prev.plants.map((p, i) =>
                    selectedIds.has(String(i)) ? mergePlantData(p, replacement) : p,
                  ),
                  species: ensureSpeciesPresent(prev.species, prev.plants, replacement),
                } : prev);
              }}
              planTitle={planTitle}
              setPlanTitle={setPlanTitle}
              speciesCount={preferences.targetSpeciesCount}
              setSpeciesCount={(n) => setPreferences(p => ({ ...p, targetSpeciesCount: n }))}
              onRegenerate={generatePlan}
              regenerating={generating}
              viewControls={
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    onClick={() => setView3D(v => !v)}
                    className={`px-2 py-0.5 rounded ${view3D ? 'bg-amber-500 text-white' : 'bg-stone-700 text-stone-300 hover:bg-stone-600'}`}
                    title="Toggle 3D / top view"
                  >{view3D ? '3D' : 'Top'}</button>
                  <button
                    onClick={() => setPlantRenderMode(plantRenderMode === 'tapestry' ? 'numbered' : 'tapestry')}
                    className="px-2 py-0.5 rounded bg-stone-700 text-stone-300 hover:bg-stone-600"
                    title="Toggle tapestry / numbered render"
                  >{plantRenderMode === 'tapestry' ? 'Tapestry' : 'Numbered'}</button>
                  <button
                    onClick={() => setShowSunlight(s => !s)}
                    className={`px-2 py-0.5 rounded ${showSunlight ? 'bg-amber-500 text-white' : 'bg-stone-700 text-stone-300 hover:bg-stone-600'}`}
                    title="Toggle sun / shadow"
                  >☀ Sun</button>
                </div>
              }
              mapSlot={
            <div className="relative w-full h-full">
              <MapContainer
                center={[location.lat, location.lng]}
                zoom={20}
                pitch={view3D ? 45 : 0}
                style="satellite-streets"
                show3D={true}
                showDrawControls={true}
                editMode={editMode}
                showSunlight={showSunlight}
                showSunGrid={showSunGrid}
                sunGrid={generatedPlan.sunGrid}
                showSearch={false}
                areaOutline={location.areaGeoJson}
                exclusionZones={exclusionZones}
                existingTrees={existingTrees}
                onExclusionZoneCreated={(zone) => {
                  setExclusionZones(prev => [...prev, zone]);
                  setEditMode('none');
                }}
                onExistingTreePlaced={(tree) => {
                  // Auto-derive the outside-bed flag from the click point so
                  // the saved value matches what the user sees on screen.
                  setExistingTrees(prev => [
                    ...prev,
                    { ...tree, outsideProperty: isTreeOutsideBed(tree, location.areaGeoJson) },
                  ]);
                }}
                detectBuildingsRef={detectBuildingsRef}
                computeSunGridRef={computeSunGridRef}
                onBuildingsDetected={mergeDetectedBuildings}
                plantRenderMode={plantRenderMode}
                symbolSet={activeSymbolSet}
                showSymbols={showSymbols}
                plantPlacements={applyPlanFilters(
                  generatedPlan.plants
                    .map((p: PlanPlant, idx: number) => ({ p, idx }))
                    .filter(({ p }) => p.lat && p.lng)
                    .map(({ p, idx }) => {
                      // Look up family + bloom data from the all-plants cache
                      // so we don't have to bake them onto every saved PlanPlant.
                      const cat = allPlantsCache.find((c: { slug: string }) => c.slug === p.plantSlug);
                      return {
                        lat: p.lat!, lng: p.lng!,
                        color: p.bloomColor, name: p.commonName,
                        slug: p.plantSlug, imageUrl: p.imageUrl,
                        spreadInches: p.spreadInches, speciesIndex: p.speciesIndex,
                        plantType: p.plantType,
                        cellGeoJson: p.cellGeoJson,
                        family: cat?.family,
                        tier: p.tier ?? cat?.tier,
                        bloomStartMonth: cat?.bloomStartMonth,
                        bloomEndMonth: cat?.bloomEndMonth,
                        seedHeadInterest: cat?.seedHeadInterest,
                        winterStructure: cat?.winterStructure,
                        // Stable index into generatedPlan.plants — paint/erase
                        // round-trip this through MapboxMap's GeoJSON properties
                        // so a click can target one specific placement.
                        placementIdx: idx,
                      };
                    }),
                  filters,
                )}
                onPlantClick={(slug) => setSelectedPlantSlug(slug === selectedPlantSlug ? null : slug)}
                placementEditMode={brush.kind ?? 'none'}
                onPlantEdit={(idx) => {
                  if (!generatedPlan) return;
                  // Eyedropper: tool 'eyedropper' wins, regardless of brush.kind.
                  if (tool === 'eyedropper') {
                    const plant = generatedPlan.plants[idx];
                    if (!plant) return;
                    setBrush(b => ({ ...b, kind: 'paint', slugs: [plant.plantSlug] }));
                    setTool('brush');
                    return;
                  }
                  // Layer-locked plants are immune to edits regardless of mode.
                  const targetPlant = generatedPlan.plants[idx];
                  if (targetPlant) {
                    const cat = allPlantsCache.find((p: any) => p.slug === targetPlant.plantSlug);
                    const layer = (cat?.oudolfRole ?? 'matrix') as LayerId;
                    if (layers[layer].locked) return;
                  }
                  if (brush.kind === 'erase') {
                    setGeneratedPlan(prev => prev ? {
                      ...prev,
                      plants: prev.plants.filter((_, i) => i !== idx),
                    } : prev);
                    setSelectedIds(prev => { const n = new Set(prev); n.delete(String(idx)); return n; });
                    return;
                  }
                  if (brush.kind === 'paint') {
                    const slug = pickPaintSlug(brush.slugs);
                    if (!slug) return;
                    const replacement = allPlantsCache.find((p: any) => p.slug === slug);
                    if (!replacement) return;
                    setGeneratedPlan(prev => {
                      if (!prev) return prev;
                      const newPlants = prev.plants.map((p, i) => i === idx ? mergePlantData(p, replacement) : p);
                      const newSpecies = ensureSpeciesPresent(prev.species, newPlants, replacement);
                      return { ...prev, plants: newPlants, species: newSpecies };
                    });
                    return;
                  }
                  // Selection (move/marquee/lasso/drag tools): shift-click adds,
                  // alt-click subtracts, plain click replaces selection.
                  if (brush.kind === 'select') {
                    const id = String(idx);
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (shiftKeyRef.current) {
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                      } else if (altKeyRef.current) {
                        next.delete(id);
                      } else {
                        next.clear();
                        next.add(id);
                      }
                      return next;
                    });
                  }
                }}
                onMapPaint={(lat, lng) => {
                  if (!generatedPlan) return;
                  if (brush.kind === 'paint') {
                    const offsets = stampOffsets(brush.pattern);
                    setGeneratedPlan(prev => {
                      if (!prev) return prev;
                      const additions: PlanPlant[] = [];
                      for (const off of offsets) {
                        const slug = pickPaintSlug(brush.slugs);
                        if (!slug) continue;
                        const cat = allPlantsCache.find((p: any) => p.slug === slug);
                        if (!cat) continue;
                        const spread = (cat.spreadMaxInches || 18) / 12; // ft
                        const stepM = spread * 0.3048 * 1.2; // 1.2× spread between stamp points
                        const dLat = (off.dy * stepM) / 111320;
                        const dLng = (off.dx * stepM) / (111320 * Math.cos(lat * Math.PI / 180));
                        additions.push(makeNewPlacement(cat, lat + dLat, lng + dLng, prev));
                      }
                      if (!additions.length) return prev;
                      const newPlants = [...prev.plants, ...additions];
                      let newSpecies = prev.species;
                      for (const a of additions) {
                        const cat = allPlantsCache.find((p: any) => p.slug === a.plantSlug);
                        if (cat) newSpecies = ensureSpeciesPresent(newSpecies, newPlants, cat);
                      }
                      return { ...prev, plants: newPlants, species: newSpecies };
                    });
                    return;
                  }
                  if (brush.kind === 'paste' && copiedRegion) {
                    setGeneratedPlan(prev => {
                      if (!prev) return prev;
                      const additions: PlanPlant[] = copiedRegion.plants.map(({ offsetLat, offsetLng, plant }) => ({
                        ...plant,
                        lat: lat + offsetLat,
                        lng: lng + offsetLng,
                        // New cell positions are no longer valid; clear them
                        // so the renderer falls back to circles/blobs at the
                        // pasted point.
                        cellGeoJson: undefined,
                      }));
                      const newPlants = [...prev.plants, ...additions];
                      let newSpecies = prev.species;
                      for (const a of additions) {
                        const cat = allPlantsCache.find((p: any) => p.slug === a.plantSlug);
                        if (cat) newSpecies = ensureSpeciesPresent(newSpecies, newPlants, cat);
                      }
                      return { ...prev, plants: newPlants, species: newSpecies };
                    });
                  }
                }}
                onRegionSelected={(bounds) => {
                  if (!generatedPlan || brush.kind !== 'select') return;
                  // Marquee → selection (NOT auto-copy). Shift held = add to
                  // existing selection; alt held = subtract. Layer-hidden or
                  // locked plants are excluded.
                  const matched: number[] = [];
                  generatedPlan.plants.forEach((p, i) => {
                    if (p.lat == null || p.lng == null) return;
                    if (p.lat < bounds.minLat || p.lat > bounds.maxLat) return;
                    if (p.lng < bounds.minLng || p.lng > bounds.maxLng) return;
                    const cat = allPlantsCache.find((s: any) => s.slug === p.plantSlug);
                    const layer = (cat?.oudolfRole ?? 'matrix') as LayerId;
                    if (!layers[layer].visible || layers[layer].locked) return;
                    matched.push(i);
                  });
                  setSelectedIds(prev => {
                    const next = shiftKeyRef.current || altKeyRef.current ? new Set(prev) : new Set<string>();
                    for (const i of matched) {
                      if (altKeyRef.current) next.delete(String(i));
                      else next.add(String(i));
                    }
                    return next;
                  });
                }}
                height="100%"
              />
              {/* Unobtrusive plant info card — bottom-left, dismissible. Shows
               *  image, names, bloom window, and height without crowding the
               *  map. Falls back gracefully when the plant isn't in cache
               *  (e.g. immediately after a regen, before /api/plants refreshes). */}
              {selectedPlantSlug && (() => {
                const planEntry = generatedPlan.plants.find(p => p.plantSlug === selectedPlantSlug);
                const cached = allPlantsCache.find((p: any) => p.slug === selectedPlantSlug);
                const plant = { ...(cached || {}), ...(planEntry || {}) };
                if (!plant?.plantSlug && !cached) return null;
                const bloomMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const bloomLabel = plant.bloomStartMonth && plant.bloomEndMonth
                  ? `${bloomMonths[plant.bloomStartMonth - 1]}–${bloomMonths[plant.bloomEndMonth - 1]}`
                  : null;
                const heightLabel = plant.heightMaxInches
                  ? `${Math.round(plant.heightMaxInches)}″`
                  : null;
                return (
                  <div className="absolute bottom-3 left-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-stone-200 max-w-xs overflow-hidden pointer-events-auto">
                    <div className="flex items-start gap-3 p-3">
                      {plant.imageUrl && (
                        <img
                          src={plant.imageUrl}
                          alt={plant.commonName || ''}
                          className="w-16 h-16 object-cover rounded-md flex-shrink-0 bg-stone-100"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">{plant.commonName}</div>
                            <div className="text-xs italic text-muted truncate">{plant.scientificName}</div>
                          </div>
                          <button
                            onClick={() => setSelectedPlantSlug(null)}
                            className="text-stone-400 hover:text-stone-700 -mr-1 -mt-1 p-1 leading-none"
                            aria-label="Close"
                          >×</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5 text-[11px] text-stone-600">
                          {bloomLabel && (
                            <span className="inline-flex items-center gap-1 bg-stone-100 rounded px-1.5 py-0.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: getPlantColor(plant.bloomColor || '') }} />
                              {bloomLabel}
                            </span>
                          )}
                          {heightLabel && (
                            <span className="bg-stone-100 rounded px-1.5 py-0.5">↕ {heightLabel}</span>
                          )}
                          {plant.plantType && (
                            <span className="bg-stone-100 rounded px-1.5 py-0.5 capitalize">{plant.plantType}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
              }
            />

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

            {/* Plant legend now lives in the sidebar's Plants tab. */}

            {/* Email for ownership */}
            <div className="mb-4 p-4 bg-stone-50 rounded-lg border border-stone-200">
              <label className="block text-sm font-medium mb-1">Your email (to edit later)</label>
              <p className="text-xs text-muted mb-2">We&apos;ll use this to let you edit your plan. No account needed.</p>
              <input
                type="email"
                value={authorEmail}
                onChange={(e) => setAuthorEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              />
            </div>

            {/* Visibility */}
            <div className="mb-4 p-4 bg-stone-50 rounded-lg border border-stone-200">
              <div className="text-sm font-medium mb-2">Visibility</div>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    checked={isPublic}
                    onChange={() => setIsPublic(true)}
                    className="mt-0.5 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="text-sm font-medium">Public</span>
                    <span className="block text-xs text-muted">
                      Show this plan on the community map so others can see what&apos;s being planted nearby.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="visibility"
                    checked={!isPublic}
                    onChange={() => setIsPublic(false)}
                    className="mt-0.5 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="text-sm font-medium">Private</span>
                    <span className="block text-xs text-muted">
                      Only you can see this plan. It won&apos;t appear on the public map.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 justify-between">
              <button onClick={() => setStep('design')} className="text-muted hover:text-foreground px-4 py-2 transition-colors">
                ← Adjust design
              </button>
              <button
                onClick={savePlan}
                disabled={saving || !authorEmail.trim()}
                className="bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? 'Saving...' : 'Save Plan'}
              </button>
            </div>

            {/* Catalog picker — shared by the sidebar's "Browse" and "Paint" actions. */}
            <PlantCatalogPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              allPlants={allPlantsCache}
              siteProfile={siteProfile}
              pinnedSlugs={pinnedSlugs}
              paintingSlug={brush.slugs[0] ?? null}
              onPin={(slug) => setPinnedSlugs(s => s.includes(slug) ? s : [...s, slug])}
              onUnpin={(slug) => setPinnedSlugs(s => s.filter(x => x !== slug))}
              onPaint={(slug) => {
                // Empty string = stop painting (clears the brush set).
                if (!slug) {
                  setBrush(b => ({ ...b, kind: b.kind === 'paint' ? null : b.kind, slugs: [] }));
                  return;
                }
                // Single-species paint: replace the brush set. Holding alt
                // would be the natural way to add to a multi-brush set, but
                // the picker doesn't have that hook yet — multi is built up
                // through the sidebar's species chips.
                setBrush(b => ({
                  ...b,
                  kind: 'paint',
                  slugs: b.slugs.includes(slug) ? b.slugs : [...b.slugs, slug],
                }));
              }}
            />
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

/** Pick a slug for the next paint event. Multi-plant brushes get a uniform
 *  random pick — naturalistic mixed drifts read better than round-robin. */
function pickPaintSlug(slugs: string[]): string | null {
  if (!slugs.length) return null;
  if (slugs.length === 1) return slugs[0];
  return slugs[Math.floor(Math.random() * slugs.length)];
}

/** Stamp pattern offsets (unit-circle coordinates that get multiplied by the
 *  plant's spread when the parent computes the lat/lng of each placement).
 *   1 = single
 *   3 = triangle (3 points, 120° apart)
 *   5 = quincunx (4 corners + center)
 *   9 = 3×3 grid
 */
function stampOffsets(pattern: 1 | 3 | 5 | 9): { dx: number; dy: number }[] {
  if (pattern === 1) return [{ dx: 0, dy: 0 }];
  if (pattern === 3) {
    return [0, 120, 240].map(deg => {
      const r = deg * Math.PI / 180;
      return { dx: Math.sin(r), dy: -Math.cos(r) };
    });
  }
  if (pattern === 5) {
    return [
      { dx: 0, dy: 0 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
    ];
  }
  // 9 = 3x3 grid
  const out: { dx: number; dy: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push({ dx, dy });
  return out;
}

/** Merge a plant catalog row into an existing PlanPlant, preserving position
 *  and quantity but swapping the species-identifying fields. */
function mergePlantData(p: PlanPlant, replacement: any): PlanPlant {
  return {
    ...p,
    plantSlug: replacement.slug,
    commonName: replacement.commonName,
    scientificName: replacement.scientificName,
    bloomColor: replacement.bloomColor,
    heightMaxInches: replacement.heightMaxInches,
    spreadInches: replacement.spreadMaxInches ?? p.spreadInches,
    imageUrl: replacement.imageUrl || '',
    plantType: replacement.plantType,
  };
}

/** Construct a fresh PlanPlant at a given lat/lng from a plant catalog row.
 *  Reuses the highest-existing speciesIndex+1 when the species is new to the
 *  plan, otherwise reuses the existing index so legend numbering stays stable. */
function makeNewPlacement(
  cat: any,
  lat: number,
  lng: number,
  prev: { plants: PlanPlant[]; species: any[] },
): PlanPlant {
  const existingIdx = prev.plants.find(pl => pl.plantSlug === cat.slug)?.speciesIndex;
  const speciesIndex = existingIdx ?? (
    Math.max(0, ...prev.plants.map(pl => pl.speciesIndex || 0)) + 1
  );
  return {
    plantSlug: cat.slug,
    commonName: cat.commonName,
    scientificName: cat.scientificName,
    gridX: 0, gridY: 0,
    quantity: 1,
    bloomColor: cat.bloomColor,
    heightMaxInches: cat.heightMaxInches,
    spreadInches: cat.spreadMaxInches,
    notes: '',
    lat, lng,
    imageUrl: cat.imageUrl,
    speciesIndex,
    plantType: cat.plantType,
    tier: cat.tier,
    sociability: cat.sociability,
  };
}

/** Make sure the species manifest contains an entry for `replacement` while
 *  pruning species whose last placement was just removed. */
function ensureSpeciesPresent(species: any[], plants: PlanPlant[], replacement: any): any[] {
  const next = species.some((s: any) => s.slug === replacement.slug)
    ? species
    : [...species, replacement];
  return next.filter((s: any) => plants.some(p => p.plantSlug === s.slug));
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

/** Tile in the design-style picker. One per formula plus a "Classic" tile. */
function FormulaTile({
  name,
  description,
  selected,
  previewCount,
  ratios,
  roleRatios,
  isBuiltIn,
  onClick,
}: {
  name: string;
  description: string;
  selected: boolean;
  previewCount?: number;
  ratios?: Record<string, number>;
  roleRatios?: Record<string, number>;
  isBuiltIn?: boolean;
  onClick: () => void;
}) {
  const ratioParts: string[] = [];
  if (ratios) {
    for (const [k, v] of Object.entries(ratios)) {
      if (typeof v === 'number' && v > 0) ratioParts.push(`${k} ${Math.round(v * 100)}%`);
    }
  }
  const roleParts: string[] = [];
  if (roleRatios) {
    for (const [k, v] of Object.entries(roleRatios)) {
      if (typeof v === 'number' && v > 0) roleParts.push(`${k} ${Math.round(v * 100)}%`);
    }
  }

  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-lg border transition-all ${
        selected
          ? 'border-primary bg-primary/5 ring-2 ring-primary/40'
          : 'border-stone-200 hover:border-stone-300 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-medium">{name}</div>
        {isBuiltIn && (
          <span className="text-[10px] uppercase tracking-wide text-stone-500 bg-stone-100 rounded px-1.5 py-0.5">
            Built-in
          </span>
        )}
      </div>
      <div className="text-sm text-muted mb-3">{description}</div>
      {ratioParts.length > 0 && (
        <div className="text-xs text-stone-600 mb-1">
          <span className="font-medium">Types:</span> {ratioParts.join(' • ')}
        </div>
      )}
      {roleParts.length > 0 && (
        <div className="text-xs text-stone-600 mb-1">
          <span className="font-medium">Roles:</span> {roleParts.join(' • ')}
        </div>
      )}
      {typeof previewCount === 'number' && (
        <div className="text-xs text-stone-500 mt-1">{previewCount} species in preview</div>
      )}
    </button>
  );
}

/** Chip list of the species a formula would pick. Characteristic species get a
 *  pin badge so the formula's signature plants are visible. */
function FormulaPreview({
  species,
  loading,
}: {
  species: PreviewSpecies[] | undefined;
  loading: boolean;
}) {
  if (!species) {
    return (
      <p className="text-sm text-muted">
        {loading ? 'Loading preview…' : 'Select a style above to see the species it would pick.'}
      </p>
    );
  }
  if (species.length === 0) {
    return (
      <p className="text-sm text-muted">
        No species matched the current site + preferences for this formula.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {species.map((s) => (
        <div
          key={s.slug}
          title={`${s.scientificName}${s.oudolfRole ? ` · ${s.oudolfRole}` : ''}`}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${
            s.isCharacteristic
              ? 'border-amber-400 bg-amber-50 text-amber-900'
              : 'border-stone-200 bg-white text-stone-700'
          }`}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: bloomSwatch(s.bloomColor) }}
          />
          <span>{s.commonName}</span>
          {s.isCharacteristic && <span className="text-[10px]">★</span>}
        </div>
      ))}
    </div>
  );
}

/** Small swatch of common bloom colors for the preview chips. */
function bloomSwatch(color: string): string {
  const map: Record<string, string> = {
    purple: '#8b5cf6', blue: '#3b82f6', pink: '#ec4899', red: '#ef4444',
    orange: '#f97316', yellow: '#eab308', white: '#e5e7eb', green: '#22c55e',
  };
  return map[color?.toLowerCase()] || '#9ca3af';
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
