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
  return plants.filter(plant => {
    // Effort level filter
    if (prefs.effortLevel === 'low' && plant.effortLevel === 'high') return false;
    if (prefs.effortLevel === 'medium' && plant.effortLevel === 'high') return false;

    // Height restriction
    if (prefs.maxHeightInches && plant.heightMaxInches > prefs.maxHeightInches) return false;

    // Avoid list
    if (prefs.avoidSlugs.includes(plant.slug)) return false;

    // Habitat goal boost (don't exclude, but filter out plants with NO overlap if user specified goals)
    if (prefs.habitatGoals.length > 0) {
      const hasRelevantWildlife = plant.wildlifeValue.some(w => prefs.habitatGoals.includes(w));
      const hasRelevantHabitat = plant.nativeHabitats.some(h => prefs.habitatGoals.includes(h));
      // Don't hard-exclude, just prefer matches (handled in scoring)
    }

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
