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
