import {createDefaultSaveData} from './constants';
import type {SaveData} from './types';

const STORAGE_KEY = 'temple_run_3_lost_kingdom_save_v1';

export function loadSaveData(): SaveData {
  const defaults = createDefaultSaveData();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      ...defaults,
      ...parsed,
      upgradeLevels: {
        ...defaults.upgradeLevels,
        ...(parsed.upgradeLevels ?? {}),
      },
      settings: {
        ...defaults.settings,
        ...(parsed.settings ?? {}),
      },
      unlockedCharacters:
        Array.isArray(parsed.unlockedCharacters) && parsed.unlockedCharacters.length > 0
          ? parsed.unlockedCharacters
          : defaults.unlockedCharacters,
      unlockedBiomes:
        Array.isArray(parsed.unlockedBiomes) && parsed.unlockedBiomes.length > 0
          ? parsed.unlockedBiomes
          : defaults.unlockedBiomes,
      completedMissions: Array.isArray(parsed.completedMissions)
        ? parsed.completedMissions
        : defaults.completedMissions,
      unlockedAchievements: Array.isArray(parsed.unlockedAchievements)
        ? parsed.unlockedAchievements
        : defaults.unlockedAchievements,
    };
  } catch {
    return defaults;
  }
}

export function persistSaveData(data: SaveData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors in restricted environments
  }
}
