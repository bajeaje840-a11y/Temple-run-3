import {DAILY_MISSION_POOL} from './constants';
import type {
  DailyMissionItem,
  DailyMissionMetric,
  DailyMissionsState,
  RunStats,
  SaveData,
} from './types';

export const DAILY_MISSION_COUNT = 3;

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTimeUntilDailyReset(now: Date = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const diffMs = Math.max(0, tomorrow.getTime() - now.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export function hashDateKey(dateKey: string): number {
  let hash = 2166136261;
  for (let i = 0; i < dateKey.length; i++) {
    hash ^= dateKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createDailyRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Generates 3 randomized daily challenges with distinct metrics for the given dateKey.
 */
export function generateDailyMissions(
  dateKey: string,
  rng: () => number = createDailyRng(hashDateKey(dateKey))
): DailyMissionItem[] {
  const pool = [...DAILY_MISSION_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const picked: DailyMissionItem[] = [];
  const usedMetrics = new Set<DailyMissionMetric>();

  for (const tpl of pool) {
    if (usedMetrics.has(tpl.metric)) continue;
    usedMetrics.add(tpl.metric);
    picked.push({
      ...tpl,
      progress: 0,
      completed: false,
    });
    if (picked.length === DAILY_MISSION_COUNT) break;
  }

  return picked;
}

export function createDailyMissionsState(
  dateKey: string = getLocalDateKey(),
  rng?: () => number
): DailyMissionsState {
  return {
    dateKey,
    missions: generateDailyMissions(dateKey, rng),
  };
}

export function ensureDailyMissions(
  save: SaveData,
  dateKey: string = getLocalDateKey()
): SaveData {
  const current = save.dailyMissions;
  if (
    current &&
    current.dateKey === dateKey &&
    Array.isArray(current.missions) &&
    current.missions.length === DAILY_MISSION_COUNT
  ) {
    return save;
  }

  return {
    ...save,
    dailyMissions: createDailyMissionsState(dateKey),
  };
}

function getRunMetricIncrement(metric: DailyMissionMetric, run: RunStats): number {
  switch (metric) {
    case 'coins':
      return Math.max(0, Math.floor(run.coins));
    case 'survivalSeconds':
      return Math.max(0, Math.floor(run.survivalSeconds));
    case 'distance':
      return Math.max(0, Math.floor(run.distance));
    case 'score':
      return Math.max(0, Math.floor(run.score));
    case 'jumps':
      return Math.max(0, Math.floor(run.jumps));
    case 'slides':
      return Math.max(0, Math.floor(run.slides));
    case 'powerups':
      return Math.max(0, Math.floor(run.powerUpsCollected));
    case 'closeCalls':
      return Math.max(0, Math.floor(run.closeCalls));
  }
}

export interface DailyMissionCompletionReward {
  id: string;
  title: string;
  rewardCoins: number;
}

export function applyRunToDailyMissions(
  state: DailyMissionsState | undefined,
  run: RunStats,
  dateKey: string = getLocalDateKey()
): {
  nextState: DailyMissionsState;
  newlyCompleted: DailyMissionCompletionReward[];
  bonusCoinsEarned: number;
} {
  const baseState =
    state &&
    state.dateKey === dateKey &&
    Array.isArray(state.missions) &&
    state.missions.length === DAILY_MISSION_COUNT
      ? state
      : createDailyMissionsState(dateKey);

  const newlyCompleted: DailyMissionCompletionReward[] = [];
  let bonusCoinsEarned = 0;

  const nextMissions = baseState.missions.map((mission) => {
    if (mission.completed) {
      return {...mission};
    }
    const increment = getRunMetricIncrement(mission.metric, run);
    const nextProgress = Math.min(mission.target, mission.progress + increment);
    const completed = nextProgress >= mission.target;

    if (completed) {
      bonusCoinsEarned += mission.rewardCoins;
      newlyCompleted.push({
        id: mission.id,
        title: mission.title,
        rewardCoins: mission.rewardCoins,
      });
    }

    return {
      ...mission,
      progress: nextProgress,
      completed,
    };
  });

  return {
    nextState: {
      dateKey,
      missions: nextMissions,
    },
    newlyCompleted,
    bonusCoinsEarned,
  };
}

export function formatDailyProgressValue(
  metric: DailyMissionMetric,
  value: number
): string {
  const clamped = Math.max(0, Math.floor(value));
  if (metric === 'survivalSeconds') {
    const mins = Math.floor(clamped / 60);
    const secs = clamped % 60;
    return mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
  }
  if (metric === 'distance') {
    return `${clamped.toLocaleString()}m`;
  }
  return clamped.toLocaleString();
}
