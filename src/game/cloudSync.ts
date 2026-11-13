import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type FieldValue,
} from 'firebase/firestore';
import type {User} from 'firebase/auth';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {CHARACTER_ORDER} from './constants';
import {
  clampInt,
  mergeCloudAndLocalSave,
  sanitizeDisplayName,
  sanitizeSaveData,
  type LeaderboardEntry,
} from './cloudMerge';
import type {
  BiomeId,
  CharacterId,
  DailyMissionItem,
  PowerUpType,
  QualityLevel,
  SaveData,
} from './types';

export {mergeCloudAndLocalSave, sanitizeDisplayName, sanitizeSaveData};
export type {LeaderboardEntry};

interface CloudSavePayload {
  ownerId: string;
  version: number;
  highScore: number;
  bestDistance: number;
  coins: number;
  totalCoinsCollected: number;
  totalDistance: number;
  totalJumps: number;
  totalSlides: number;
  totalPowerUps: number;
  runsPlayed: number;
  selectedCharacter: CharacterId;
  unlockedCharacters: CharacterId[];
  selectedStartBiome: BiomeId;
  unlockedBiomes: BiomeId[];
  upgradeLevels: Record<PowerUpType, number>;
  completedMissions: string[];
  unlockedAchievements: string[];
  dailyMissions: {
    dateKey: string;
    missions: DailyMissionItem[];
  };
  settings: {
    quality: QualityLevel;
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
  };
  updatedAt: FieldValue;
}

interface LeaderboardPayload {
  uid: string;
  displayName: string;
  selectedCharacter: CharacterId;
  highScore: number;
  bestDistance: number;
  updatedAt: FieldValue;
}

export function buildCloudSavePayload(ownerId: string, rawSave: SaveData): CloudSavePayload {
  const clean = sanitizeSaveData(rawSave);
  return {
    ownerId,
    version: 1,
    highScore: clean.highScore,
    bestDistance: clean.bestDistance,
    coins: clean.coins,
    totalCoinsCollected: clean.totalCoinsCollected,
    totalDistance: clean.totalDistance,
    totalJumps: clean.totalJumps,
    totalSlides: clean.totalSlides,
    totalPowerUps: clean.totalPowerUps,
    runsPlayed: clean.runsPlayed,
    selectedCharacter: clean.selectedCharacter,
    unlockedCharacters: clean.unlockedCharacters,
    selectedStartBiome: clean.selectedStartBiome,
    unlockedBiomes: clean.unlockedBiomes,
    upgradeLevels: clean.upgradeLevels,
    completedMissions: clean.completedMissions,
    unlockedAchievements: clean.unlockedAchievements,
    dailyMissions: clean.dailyMissions,
    settings: clean.settings,
    updatedAt: serverTimestamp(),
  };
}

export function buildLeaderboardPayload(
  user: {uid: string; displayName: string | null},
  rawSave: SaveData
): LeaderboardPayload {
  const clean = sanitizeSaveData(rawSave);
  return {
    uid: user.uid,
    displayName: sanitizeDisplayName(user.displayName),
    selectedCharacter: clean.selectedCharacter,
    highScore: clean.highScore,
    bestDistance: clean.bestDistance,
    updatedAt: serverTimestamp(),
  };
}

export async function loadCloudSave(user: User): Promise<Partial<SaveData> | null> {
  const path = `saves/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'saves', user.uid));
    if (!snap.exists()) return null;
    return snap.data() as Partial<SaveData>;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function persistCloudSave(user: User, save: SaveData): Promise<void> {
  if (!user.emailVerified) return;
  const path = `saves/${user.uid}`;
  try {
    await setDoc(doc(db, 'saves', user.uid), buildCloudSavePayload(user.uid, save));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertLeaderboardEntry(user: User, save: SaveData): Promise<void> {
  if (!user.emailVerified || save.highScore <= 0) return;
  const path = `leaderboard/${user.uid}`;
  try {
    const ref = doc(db, 'leaderboard', user.uid);
    let existingData: Partial<LeaderboardEntry> | null = null;
    try {
      const existingSnap = await getDoc(ref);
      if (existingSnap.exists()) {
        existingData = existingSnap.data() as Partial<LeaderboardEntry>;
      }
    } catch {
      existingData = null;
    }
    const effectiveSave: SaveData = existingData
      ? {
          ...save,
          highScore: Math.max(
            save.highScore,
            clampInt(existingData.highScore, 0, 1_000_000_000, 0)
          ),
          bestDistance: Math.max(
            save.bestDistance,
            clampInt(existingData.bestDistance, 0, 100_000_000, 0)
          ),
        }
      : save;
    await setDoc(ref, buildLeaderboardPayload(user, effectiveSave));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchTopLeaderboard(maxEntries = 20): Promise<LeaderboardEntry[]> {
  const path = 'leaderboard';
  try {
    const q = query(
      collection(db, 'leaderboard'),
      where('highScore', '>=', 0),
      orderBy('highScore', 'desc'),
      limit(maxEntries)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as Partial<LeaderboardEntry>;
      return {
        uid: String(data.uid ?? d.id),
        displayName: sanitizeDisplayName(data.displayName),
        selectedCharacter: CHARACTER_ORDER.includes(data.selectedCharacter as CharacterId)
          ? (data.selectedCharacter as CharacterId)
          : 'aurelia',
        highScore: clampInt(data.highScore, 0, 1_000_000_000, 0),
        bestDistance: clampInt(data.bestDistance, 0, 100_000_000, 0),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
