import type { Plant, SunRequirement, MoistureRequirement } from '@/types/plant';
import type { SiteProfile } from '@/types/analysis';
import type { UserPreferences } from '@/types/plan';
import { sunHoursToCategory } from '@/lib/analysis/sun';

export function filterPlantsBySite(plants: Plant[], profile: SiteProfile): Plant[] {
  const sunCat = sunHoursToCategory(profile.effectiveSunHours.average);
  const moisture = profile.moistureCategory;

  return plants.filter(plant => {
    // Sun compatibility: plant must tolerate the site's sun level
    if (!isSunCompatible(plant.sun, sunCat)) return false;

    // Moisture compatibility
    if (!isMoistureCompatible(plant.moisture, moisture)) return false;

    // Soil compatibility (loose matching - most native plants tolerate Chicago soils)
    if (plant.soilTypes.length > 0 && !plant.soilTypes.includes('any')) {
      const siteType = profile.soilType.replace('_', ' ');
      const match = plant.soilTypes.some(s =>
        siteType.includes(s) || s === 'loam' || s === 'clay'
      );
      if (!match && !plant.soilTypes.includes('clay') && !plant.soilTypes.includes('loam')) {
        // Only exclude if the plant really can't handle the soil
        return false;
      }
    }

    return true;
  });
}

export function filterPlantsByPreferences(plants: Plant[], prefs: UserPreferences): Plant[] {
  // Default both structural toggles to true when the prefs object was built
  // before those fields existed (older plan documents, preview defaults).
  const includeTrees = prefs.includeTrees !== false;
  const includeShrubs = prefs.includeShrubs !== false;

  return plants.filter(plant => {
    // Structural toggles — hard filters. Users with a small bed usually don't
    // want 30ft trees in their plan even if they're site-compatible.
    if (!includeTrees && plant.plantType === 'tree') return false;
    if (!includeShrubs && plant.plantType === 'shrub') return false;

    // Effort level filter — 'low' is strict, everything else is permissive.
    // Legacy 'medium'/'high' values land in the permissive branch; the new
    // 'normal' does too, so the app-facing UI only has to offer two tiers.
    if (prefs.effortLevel === 'low' && plant.effortLevel === 'high') return false;

    // Height restriction
    if (prefs.maxHeightInches && plant.heightMaxInches > prefs.maxHeightInches) return false;

    // Avoid list
    if (prefs.avoidSlugs.includes(plant.slug)) return false;

    // habitatGoals is a soft signal handled in scoring (scorePlant); we never
    // hard-exclude on it because users expect habitat preferences to influence
    // ranking, not eliminate otherwise-valid species.

    return true;
  });
}

function isSunCompatible(plantSun: SunRequirement[], siteSun: SunRequirement): boolean {
  if (plantSun.includes(siteSun)) return true;

  // Allow adjacent sun levels
  const sunOrder: SunRequirement[] = ['full_sun', 'part_sun', 'part_shade', 'full_shade'];
  const siteIdx = sunOrder.indexOf(siteSun);

  return plantSun.some(ps => {
    const plantIdx = sunOrder.indexOf(ps);
    return Math.abs(plantIdx - siteIdx) <= 1;
  });
}

function isMoistureCompatible(plantMoisture: MoistureRequirement[], siteMoisture: MoistureRequirement): boolean {
  if (plantMoisture.includes(siteMoisture)) return true;

  // Allow adjacent moisture levels
  const moistureOrder: MoistureRequirement[] = ['dry', 'medium', 'wet'];
  const siteIdx = moistureOrder.indexOf(siteMoisture);

  return plantMoisture.some(pm => {
    const plantIdx = moistureOrder.indexOf(pm);
    return Math.abs(plantIdx - siteIdx) <= 1;
  });
}
