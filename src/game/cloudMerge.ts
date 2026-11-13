import {BIOME_ORDER, CHARACTER_ORDER, createDefaultSaveData} from './constants';
import {ensureDailyMissions} from './dailyMissions';
import type {
  BiomeId,
  CharacterId,
  PowerUpType,
  QualityLevel,
  SaveData,
} from './types';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  selectedCharacter: CharacterId;
  highScore: number;
  bestDistance: number;
}

export function clampInt(value: unknown, min: number, max: number, fallback = min): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, num));
}

export function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, num));
}

export function uniqueStringList(items: unknown, maxLen: number, maxItemLen: number): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item === 'string') {
      const clean = item.trim().slice(0, maxItemLen);
      if (clean.length > 0) seen.add(clean);
    }
    if (seen.size >= maxLen) break;
  }
  return Array.from(seen);
}

export function sanitizeDisplayName(rawName: string | null | undefined): string {
  const cleaned = (rawName ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 48);
  return cleaned.length > 0 ? cleaned : 'Temple Explorer';
}

export function sanitizeSaveData(save: Partial<SaveData>): SaveData {
  const defaults = createDefaultSaveData();
  const validChars = new Set<CharacterId>(CHARACTER_ORDER);
  const validBiomes = new Set<BiomeId>(BIOME_ORDER);

  const unlockedChars = uniqueStringList(
    ['aurelia', ...(Array.isArray(save.unlockedCharacters) ? save.unlockedCharacters : [])],
    10,
    32
  ).filter((c): c is CharacterId => validChars.has(c as CharacterId));
  if (unlockedChars.length === 0) unlockedChars.push('aurelia');

  const unlockedBiomes = uniqueStringList(
    ['jungle_temple', ...(Array.isArray(save.unlockedBiomes) ? save.unlockedBiomes : [])],
    10,
    32
  ).filter((b): b is BiomeId => validBiomes.has(b as BiomeId));
  if (unlockedBiomes.length === 0) unlockedBiomes.push('jungle_temple');

  const selectedCharacter =
    save.selectedCharacter && unlockedChars.includes(save.selectedCharacter)
      ? save.selectedCharacter
      : 'aurelia';

  const selectedStartBiome =
    save.selectedStartBiome && unlockedBiomes.includes(save.selectedStartBiome)
      ? save.selectedStartBiome
      : 'jungle_temple';

  const quality: QualityLevel =
    save.settings?.quality === 'low' ||
    save.settings?.quality === 'medium' ||
    save.settings?.quality === 'high'
      ? save.settings.quality
      : defaults.settings.quality;

  const validMetrics = new Set([
    'coins',
    'survivalSeconds',
    'distance',
    'score',
    'jumps',
    'slides',
    'powerups',
    'closeCalls',
  ]);
  const rawDaily = save.dailyMissions;
  const sanitizedDailyList =
    rawDaily && typeof rawDaily.dateKey === 'string' && Array.isArray(rawDaily.missions)
      ? rawDaily.missions
          .slice(0, 5)
          .filter(
            (m) =>
              m &&
              typeof m.id === 'string' &&
              m.id.trim().length > 0 &&
              typeof m.title === 'string' &&
              m.title.trim().length > 0 &&
              typeof m.description === 'string' &&
              m.description.trim().length > 0 &&
              validMetrics.has(m.metric)
          )
          .map((m) => ({
            id: m.id.trim().slice(0, 48),
            title: m.title.trim().slice(0, 80),
            description: m.description.trim().slice(0, 180),
            metric: m.metric,
            target: clampInt(m.target, 1, 1_000_000, 1),
            rewardCoins: clampInt(m.rewardCoins, 0, 100_000, 0),
            progress: clampInt(m.progress, 0, 1_000_000, 0),
            completed: Boolean(m.completed),
          }))
      : [];
  const normalizedDaily = ensureDailyMissions({
    ...defaults,
    dailyMissions:
      rawDaily && typeof rawDaily.dateKey === 'string' && sanitizedDailyList.length === 3
        ? {
            dateKey: rawDaily.dateKey.slice(0, 20),
            missions: sanitizedDailyList,
          }
        : defaults.dailyMissions,
  });

  const upgradeLevels: Record<PowerUpType, number> = {
    magnet: clampInt(save.upgradeLevels?.magnet, 1, 5, 1),
    shield: clampInt(save.upgradeLevels?.shield, 1, 5, 1),
    multiplier: clampInt(save.upgradeLevels?.multiplier, 1, 5, 1),
    boost: clampInt(save.upgradeLevels?.boost, 1, 5, 1),
    invincibility: clampInt(save.upgradeLevels?.invincibility, 1, 5, 1),
  };

  return {
    version: 1,
    highScore: clampInt(save.highScore, 0, 1_000_000_000, 0),
    bestDistance: clampInt(save.bestDistance, 0, 100_000_000, 0),
    coins: clampInt(save.coins, 0, 100_000_000, defaults.coins),
    totalCoinsCollected: clampInt(save.totalCoinsCollected, 0, 1_000_000_000, 0),
    totalDistance: clampInt(save.totalDistance, 0, 1_000_000_000, 0),
    totalJumps: clampInt(save.totalJumps, 0, 100_000_000, 0),
    totalSlides: clampInt(save.totalSlides, 0, 100_000_000, 0),
    totalPowerUps: clampInt(save.totalPowerUps, 0, 100_000_000, 0),
    runsPlayed: clampInt(save.runsPlayed, 0, 10_000_000, 0),
    selectedCharacter,
    unlockedCharacters: unlockedChars,
    selectedStartBiome,
    unlockedBiomes,
    upgradeLevels,
    completedMissions: uniqueStringList(save.completedMissions, 30, 48),
    unlockedAchievements: uniqueStringList(save.unlockedAchievements, 30, 48),
    dailyMissions: normalizedDaily.dailyMissions,
    settings: {
      quality,
      musicVolume: clampFloat(save.settings?.musicVolume, 0, 1, defaults.settings.musicVolume),
      sfxVolume: clampFloat(save.settings?.sfxVolume, 0, 1, defaults.settings.sfxVolume),
      muted: Boolean(save.settings?.muted),
    },
  };
}

export function mergeCloudAndLocalSave(localRaw: SaveData, cloudRaw: Partial<SaveData>): SaveData {
  const local = sanitizeSaveData(localRaw);
  const cloud = sanitizeSaveData(cloudRaw);

  let mergedDaily = local.dailyMissions;
  if (cloud.dailyMissions.dateKey === local.dailyMissions.dateKey) {
    const cloudById = new Map(cloud.dailyMissions.missions.map((m) => [m.id, m]));
    mergedDaily = {
      dateKey: local.dailyMissions.dateKey,
      missions: local.dailyMissions.missions.map((lm) => {
        const cm = cloudById.get(lm.id);
        if (!cm) return lm;
        const progress = Math.min(lm.target, Math.max(lm.progress, cm.progress));
        const completed = lm.completed || cm.completed || progress >= lm.target;
        return {
          ...lm,
          progress: completed ? lm.target : progress,
          completed,
        };
      }),
    };
  } else if (cloud.dailyMissions.dateKey > local.dailyMissions.dateKey) {
    mergedDaily = cloud.dailyMissions;
  }

  const unlockedChars = uniqueStringList(
    [...local.unlockedCharacters, ...cloud.unlockedCharacters],
    10,
    32
  ).filter((c): c is CharacterId => CHARACTER_ORDER.includes(c as CharacterId));

  const unlockedBiomes = uniqueStringList(
    [...local.unlockedBiomes, ...cloud.unlockedBiomes],
    10,
    32
  ).filter((b): b is BiomeId => BIOME_ORDER.includes(b as BiomeId));

  return sanitizeSaveData({
    version: 1,
    highScore: Math.max(local.highScore, cloud.highScore),
    bestDistance: Math.max(local.bestDistance, cloud.bestDistance),
    coins: Math.max(local.coins, cloud.coins),
    totalCoinsCollected: Math.max(local.totalCoinsCollected, cloud.totalCoinsCollected),
    totalDistance: Math.max(local.totalDistance, cloud.totalDistance),
    totalJumps: Math.max(local.totalJumps, cloud.totalJumps),
    totalSlides: Math.max(local.totalSlides, cloud.totalSlides),
    totalPowerUps: Math.max(local.totalPowerUps, cloud.totalPowerUps),
    runsPlayed: Math.max(local.runsPlayed, cloud.runsPlayed),
    selectedCharacter: unlockedChars.includes(local.selectedCharacter)
      ? local.selectedCharacter
      : cloud.selectedCharacter,
    unlockedCharacters: unlockedChars,
    selectedStartBiome: unlockedBiomes.includes(local.selectedStartBiome)
      ? local.selectedStartBiome
      : cloud.selectedStartBiome,
    unlockedBiomes,
    upgradeLevels: {
      magnet: Math.max(local.upgradeLevels.magnet, cloud.upgradeLevels.magnet),
      shield: Math.max(local.upgradeLevels.shield, cloud.upgradeLevels.shield),
      multiplier: Math.max(local.upgradeLevels.multiplier, cloud.upgradeLevels.multiplier),
      boost: Math.max(local.upgradeLevels.boost, cloud.upgradeLevels.boost),
      invincibility: Math.max(local.upgradeLevels.invincibility, cloud.upgradeLevels.invincibility),
    },
    completedMissions: uniqueStringList(
      [...local.completedMissions, ...cloud.completedMissions],
      30,
      48
    ),
    unlockedAchievements: uniqueStringList(
      [...local.unlockedAchievements, ...cloud.unlockedAchievements],
      30,
      48
    ),
    dailyMissions: mergedDaily,
    settings: local.settings,
  });
}
