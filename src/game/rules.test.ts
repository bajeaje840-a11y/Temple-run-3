import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRunToSave,
  canAffordRevive,
  computeComboMultiplier,
  computeScoreDelta,
  computeSpeedForDistance,
  evaluateObstacleHit,
  generateSegmentPattern,
  getBiomeForSegment,
  getReviveCost,
  purchaseUpgrade,
  seededRandom,
  selectOrUnlockBiome,
  selectOrUnlockCharacter,
} from './rules';
import {createDefaultSaveData, LANE_POSITIONS} from './constants';
import {
  createDailyMissionsState,
  ensureDailyMissions,
  formatDailyProgressValue,
  generateDailyMissions,
} from './dailyMissions';

test('first two segments are safe warm-up runways with coins', () => {
  const seg0 = generateSegmentPattern(0, 'jungle_temple', seededRandom(11));
  const seg1 = generateSegmentPattern(1, 'jungle_temple', seededRandom(22));
  assert.equal(seg0.obstacles.length, 0);
  assert.equal(seg1.obstacles.length, 0);
  assert.ok(seg0.coins.length > 0);
  assert.ok(seg1.coins.length > 0);
});

test('procedural obstacle generation never creates an impossible 3-lane unjumpable wall', () => {
  const rng = seededRandom(42);
  for (let i = 2; i < 200; i++) {
    const seg = generateSegmentPattern(i, 'jungle_temple', rng);
    // Group obstacles by row zOffset
    const rows = new Map<number, typeof seg.obstacles>();
    for (const obs of seg.obstacles) {
      const key = Math.round(obs.zOffset);
      const list = rows.get(key) ?? [];
      list.push(obs);
      rows.set(key, list);
    }

    for (const row of rows.values()) {
      const hasFull = row.some((o) => o.fullWidth);
      if (hasFull) {
        assert.equal(row.length, 1);
        const type = row[0].type;
        assert.ok(
          type === 'broken_bridge' || type === 'stone_barrier' || type === 'low_branch',
          `Full-width obstacle ${type} must be jumpable or slideable`
        );
      } else {
        const occupied = new Set(row.map((o) => o.lane));
        assert.ok(occupied.size <= 2, 'At least one lane must remain clear in partial rows');
      }
    }
  }
});

test('collision detection respects jump, slide, shield/boost, and lane separation', () => {
  const basePlayer = {
    lane: 1 as const,
    x: LANE_POSITIONS[1],
    y: 0,
    isJumping: false,
    isSliding: false,
    hasShield: false,
    isInvincible: false,
    isBoosting: false,
  };

  const barrier = {
    id: 1,
    type: 'stone_barrier' as const,
    lane: 1 as const,
    zOffset: 10,
    fullWidth: false,
    phase: 0,
  };

  assert.equal(evaluateObstacleHit(basePlayer, barrier, 10, 0), 'hit');
  assert.equal(
    evaluateObstacleHit({...basePlayer, y: 1.1, isJumping: true}, barrier, 10, 0),
    'none'
  );
  assert.equal(
    evaluateObstacleHit({...basePlayer, x: LANE_POSITIONS[0], lane: 0}, barrier, 10, 0),
    'none'
  );
  assert.equal(
    evaluateObstacleHit({...basePlayer, isBoosting: true}, barrier, 10, 0),
    'smash'
  );

  const branch = {
    id: 2,
    type: 'low_branch' as const,
    lane: 1 as const,
    zOffset: 12,
    fullWidth: true,
    phase: 0,
  };
  assert.equal(evaluateObstacleHit(basePlayer, branch, 12, 0), 'hit');
  assert.equal(
    evaluateObstacleHit({...basePlayer, isSliding: true}, branch, 12, 0),
    'none'
  );
});

test('speed, biome progression, combo, revive, and shop/character progression work properly', () => {
  assert.ok(computeSpeedForDistance(500, false) > computeSpeedForDistance(0, false));
  assert.ok(computeSpeedForDistance(200, true) > computeSpeedForDistance(200, false));
  assert.equal(getBiomeForSegment(0, 'jungle_temple'), 'jungle_temple');
  assert.equal(getBiomeForSegment(10, 'jungle_temple'), 'suspended_bridges');
  assert.ok(computeScoreDelta(10, 2, 0.5) > computeScoreDelta(10, 1, 0.5));
  assert.equal(computeComboMultiplier(0), 1);
  assert.equal(computeComboMultiplier(12), 2);
  assert.equal(computeComboMultiplier(30), 3);
  assert.equal(getReviveCost(0), 100);
  assert.equal(getReviveCost(1), 200);
  assert.equal(canAffordRevive(150, 0), true);
  assert.equal(canAffordRevive(150, 1), false);

  let save = createDefaultSaveData();
  save.coins = 500;

  const upgraded = purchaseUpgrade(save, 'magnet');
  assert.ok(upgraded !== null);
  assert.equal(upgraded.upgradeLevels.magnet, 2);
  assert.equal(upgraded.coins, 400);

  const unlockedChar = selectOrUnlockCharacter(upgraded, 'cross');
  assert.ok(unlockedChar !== null);
  assert.equal(unlockedChar.selectedCharacter, 'cross');
  assert.ok(unlockedChar.unlockedCharacters.includes('cross'));

  const unlockedBiome = selectOrUnlockBiome(unlockedChar, 'suspended_bridges');
  assert.ok(unlockedBiome !== null);
  assert.equal(unlockedBiome.selectedStartBiome, 'suspended_bridges');

  const afterRun = applyRunToSave(unlockedBiome, {
    score: 6200,
    distance: 520,
    coins: 45,
    survivalSeconds: 48,
    multiplier: 1,
    powerUpsCollected: 2,
    jumps: 16,
    slides: 12,
    closeCalls: 3,
    maxCombo: 15,
    currentBiome: 'suspended_bridges',
  });
  assert.equal(afterRun.nextSave.highScore, 6200);
  assert.equal(afterRun.nextSave.bestDistance, 520);
  assert.ok(afterRun.newlyCompletedMissions.length >= 3);
  assert.ok(afterRun.newlyUnlockedAchievements.length >= 2);
});

test('daily mission system generates 3 randomized distinct-metric challenges, awards bonus currency once, and resets on a new day', () => {
  const day1 = generateDailyMissions('2026-11-13');
  const day2 = generateDailyMissions('2026-11-14');
  assert.equal(day1.length, 3);
  assert.equal(day2.length, 3);

  // All 3 daily missions on a day must have distinct metrics
  assert.equal(new Set(day1.map((m) => m.metric)).size, 3);
  assert.equal(new Set(day2.map((m) => m.metric)).size, 3);

  // Deterministic for same date, varied across different dates
  assert.deepEqual(
    day1.map((m) => m.id),
    generateDailyMissions('2026-11-13').map((m) => m.id)
  );
  assert.notDeepEqual(
    day1.map((m) => m.id),
    day2.map((m) => m.id)
  );

  // Explicit test with known coin + survival challenges matching prompt examples
  const baseSave = {
    ...createDefaultSaveData(),
    coins: 100,
    dailyMissions: {
      dateKey: '2026-11-13',
      missions: [
        {
          id: 'dm_coins_500',
          title: 'Collect 500 coins',
          description: 'Gather 500 coins across expeditions today.',
          metric: 'coins' as const,
          target: 500,
          rewardCoins: 250,
          progress: 0,
          completed: false,
        },
        {
          id: 'dm_survive_120',
          title: 'Survive for 2 minutes',
          description: 'Stay alive for 2 minutes total in runs today.',
          metric: 'survivalSeconds' as const,
          target: 120,
          rewardCoins: 240,
          progress: 0,
          completed: false,
        },
        {
          id: 'dm_jumps_30',
          title: 'Jump 30 times',
          description: 'Leap over 30 hazards today.',
          metric: 'jumps' as const,
          target: 30,
          rewardCoins: 170,
          progress: 0,
          completed: false,
        },
      ],
    },
  };

  // Run 1: partial progress (300 coins, 90s survival, 30 jumps -> completes Jumps)
  const run1 = applyRunToSave(
    baseSave,
    {
      score: 1200,
      distance: 180,
      coins: 300,
      survivalSeconds: 90,
      multiplier: 1,
      powerUpsCollected: 0,
      jumps: 30,
      slides: 0,
      closeCalls: 0,
      maxCombo: 5,
      currentBiome: 'jungle_temple',
    },
    '2026-11-13'
  );
  assert.equal(run1.newlyCompletedDailyMissions.length, 1);
  assert.equal(run1.newlyCompletedDailyMissions[0].id, 'dm_jumps_30');
  assert.equal(run1.nextSave.dailyMissions.missions[0].progress, 300);
  assert.equal(run1.nextSave.dailyMissions.missions[1].progress, 90);
  assert.equal(run1.nextSave.dailyMissions.missions[2].completed, true);
  // 100 starting + 300 run coins + 170 daily bonus + career mission bonuses (coins/jumps)
  assert.ok(run1.nextSave.coins >= 100 + 300 + 170);

  const coinsBeforeRun2 = run1.nextSave.coins;
  // Run 2: finishes both remaining daily challenges, does NOT re-award Jumps bonus
  const run2 = applyRunToSave(
    run1.nextSave,
    {
      score: 1500,
      distance: 150,
      coins: 250,
      survivalSeconds: 45,
      multiplier: 1,
      powerUpsCollected: 0,
      jumps: 10,
      slides: 0,
      closeCalls: 0,
      maxCombo: 4,
      currentBiome: 'jungle_temple',
    },
    '2026-11-13'
  );
  assert.equal(run2.newlyCompletedDailyMissions.length, 2);
  assert.equal(run2.nextSave.dailyMissions.missions[0].progress, 500);
  assert.equal(run2.nextSave.dailyMissions.missions[0].completed, true);
  assert.equal(run2.nextSave.dailyMissions.missions[1].progress, 120);
  assert.equal(run2.nextSave.dailyMissions.missions[1].completed, true);
  assert.ok(run2.nextSave.coins >= coinsBeforeRun2 + 250 + 250 + 240);

  // Run 3 on same day awards 0 additional daily bonuses
  const coinsBeforeRun3 = run2.nextSave.coins;
  const run3 = applyRunToSave(
    run2.nextSave,
    {
      score: 100,
      distance: 20,
      coins: 10,
      survivalSeconds: 5,
      multiplier: 1,
      powerUpsCollected: 0,
      jumps: 1,
      slides: 0,
      closeCalls: 0,
      maxCombo: 1,
      currentBiome: 'jungle_temple',
    },
    '2026-11-13'
  );
  assert.equal(run3.newlyCompletedDailyMissions.length, 0);
  assert.equal(run3.nextSave.coins, coinsBeforeRun3 + 10);

  // Next calendar day rolls over cleanly to 3 fresh uncompleted challenges
  const nextDay = ensureDailyMissions(run3.nextSave, '2026-11-14');
  assert.equal(nextDay.dailyMissions.dateKey, '2026-11-14');
  assert.equal(nextDay.dailyMissions.missions.length, 3);
  assert.ok(nextDay.dailyMissions.missions.every((m) => !m.completed && m.progress === 0));

  assert.equal(formatDailyProgressValue('survivalSeconds', 120), '2m 00s');
  assert.equal(formatDailyProgressValue('survivalSeconds', 45), '45s');
  assert.equal(createDailyMissionsState('2026-11-15').missions.length, 3);
});

import {getLocalDateKey} from './dailyMissions';
import {mergeCloudAndLocalSave, sanitizeDisplayName} from './cloudMerge';

test('cloud and local save merge preserves highest progress, unions unlocks, and sanitizes display names', () => {
  const todayKey = getLocalDateKey();
  const baseDaily = generateDailyMissions(todayKey);
  const local = {
    ...createDefaultSaveData(),
    highScore: 4200,
    bestDistance: 310,
    coins: 120,
    unlockedCharacters: ['aurelia' as const],
    unlockedBiomes: ['jungle_temple' as const],
    upgradeLevels: {
      magnet: 3,
      shield: 1,
      multiplier: 1,
      boost: 1,
      invincibility: 1,
    },
    completedMissions: ['m_dist_200'],
    dailyMissions: {
      dateKey: todayKey,
      missions: baseDaily.map((m, idx) =>
        idx === 0 ? {...m, progress: Math.min(m.target, 10), completed: false} : m
      ),
    },
  };

  const cloud = {
    highScore: 8900,
    bestDistance: 640,
    coins: 480,
    unlockedCharacters: ['aurelia' as const, 'cross' as const],
    unlockedBiomes: ['jungle_temple' as const, 'suspended_bridges' as const],
    upgradeLevels: {
      magnet: 2,
      shield: 4,
      multiplier: 1,
      boost: 1,
      invincibility: 1,
    },
    completedMissions: ['m_score_5000'],
    unlockedAchievements: ['a_first_run'],
    dailyMissions: {
      dateKey: todayKey,
      missions: baseDaily.map((m, idx) =>
        idx === 0 ? {...m, progress: m.target, completed: true} : m
      ),
    },
  };

  const merged = mergeCloudAndLocalSave(local, cloud);
  assert.equal(merged.highScore, 8900);
  assert.equal(merged.bestDistance, 640);
  assert.equal(merged.coins, 480);
  assert.equal(merged.upgradeLevels.magnet, 3);
  assert.equal(merged.upgradeLevels.shield, 4);
  assert.deepEqual(merged.unlockedCharacters.sort(), ['aurelia', 'cross']);
  assert.deepEqual(merged.unlockedBiomes.sort(), ['jungle_temple', 'suspended_bridges']);
  assert.deepEqual(merged.completedMissions.sort(), ['m_dist_200', 'm_score_5000']);
  assert.deepEqual(merged.unlockedAchievements, ['a_first_run']);
  assert.equal(merged.dailyMissions.missions[0].completed, true);
  assert.equal(merged.dailyMissions.missions[0].progress, baseDaily[0].target);

  assert.equal(sanitizeDisplayName('   '), 'Temple Explorer');
  assert.equal(sanitizeDisplayName('A'.repeat(64)).length, 48);
});

import {
  CloudSyncCoordinator,
  formatCloudErrorMessage,
  isTransientCloudError,
} from './syncCoordinator';

test('CloudSyncCoordinator coalesces rapid saves, retries transient errors once, and isolates leaderboard errors', async () => {
  const statuses: string[] = [];
  let persistCalls = 0;
  let lastSavedCoins = -1;
  let failFirstAttempt = true;

  const coord = new CloudSyncCoordinator({
    debounceMs: 25,
    retryDelayMs: 5,
    persistSave: async (_user, save) => {
      persistCalls++;
      if (failFirstAttempt) {
        failFirstAttempt = false;
        throw new Error('The service is currently unavailable.');
      }
      lastSavedCoins = save.coins;
    },
    upsertLeaderboard: async () => {
      throw new Error(
        JSON.stringify({
          error: 'Missing or insufficient permissions.',
          path: 'leaderboard/alice',
        })
      );
    },
    onStatus: (update) => {
      statuses.push(update.syncStatus);
    },
  });

  coord.setUser({uid: 'alice', emailVerified: true});
  const base = createDefaultSaveData();

  // Rapid debounced writes coalesce to the latest snapshot
  const p1 = coord.scheduleSave({...base, coins: 200}, {immediate: false});
  const p2 = coord.scheduleSave({...base, coins: 350}, {immediate: false});
  const p3 = coord.scheduleSave({...base, coins: 500}, {immediate: true, updateLeaderboard: true});

  await Promise.all([p1, p2, p3]);
  assert.equal(persistCalls, 2); // 1 transient failure + 1 automatic retry
  assert.equal(lastSavedCoins, 500);
  assert.equal(statuses[statuses.length - 1], 'synced');
  assert.equal(coord.isDirty(), false);

  assert.equal(isTransientCloudError(new Error('network unavailable')), true);
  assert.equal(isTransientCloudError(new Error('PERMISSION_DENIED')), false);
  assert.ok(
    formatCloudErrorMessage(
      new Error(JSON.stringify({error: 'Missing or insufficient permissions.', path: 'saves/alice'}))
    ).includes('permission')
  );
  coord.dispose();
});

