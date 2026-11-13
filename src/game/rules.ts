import {
  ACHIEVEMENTS,
  BASE_SPEED,
  BIOME_ORDER,
  BIOME_SEGMENT_SPAN,
  BIOMES,
  CHARACTERS,
  LANE_POSITIONS,
  MAX_SPEED,
  MISSIONS,
  SEGMENT_LENGTH,
  SHOP_UPGRADES,
} from './constants';
import type {
  BiomeId,
  CharacterId,
  CoinSpec,
  LaneIndex,
  ObstacleSpec,
  ObstacleType,
  PlayerCollisionState,
  PowerUpSpec,
  PowerUpType,
  RunStats,
  SaveData,
  SegmentPattern,
} from './types';

export const REVIVE_BASE_COST = 100;

export function getReviveCost(revivesUsedInRun: number): number {
  return REVIVE_BASE_COST * Math.pow(2, revivesUsedInRun);
}

export function canAffordRevive(coins: number, revivesUsedInRun: number): boolean {
  return coins >= getReviveCost(revivesUsedInRun);
}

export function computeComboMultiplier(streak: number): number {
  if (streak >= 25) return 3;
  if (streak >= 10) return 2;
  return 1;
}

export function computeSpeedForDistance(distance: number, isBoosting: boolean): number {
  const scaled = BASE_SPEED + Math.min(distance * 0.011, MAX_SPEED - BASE_SPEED);
  return isBoosting ? Math.min(scaled * 1.65, 44) : scaled;
}

export function computeScoreDelta(
  distanceDelta: number,
  multiplier: number,
  speedRatio: number
): number {
  return distanceDelta * (10 + speedRatio * 5) * multiplier;
}

export function getBiomeForSegment(
  segmentIndex: number,
  startBiome: BiomeId = 'jungle_temple'
): BiomeId {
  const startIdx = Math.max(0, BIOME_ORDER.indexOf(startBiome));
  const offset = Math.floor(segmentIndex / BIOME_SEGMENT_SPAN);
  return BIOME_ORDER[(startIdx + offset) % BIOME_ORDER.length];
}

export function getPowerUpDuration(type: PowerUpType, save: SaveData): number {
  const def = SHOP_UPGRADES.find((u) => u.id === type);
  if (!def) return 8;
  const level = Math.max(1, save.upgradeLevels[type] ?? 1);
  return def.baseDuration + (level - 1) * def.durationPerLevel;
}

export function getUpgradeCost(type: PowerUpType, currentLevel: number): number {
  const def = SHOP_UPGRADES.find((u) => u.id === type);
  if (!def) return 9999;
  return def.baseCost + (currentLevel - 1) * def.costStep;
}

/**
 * Deterministic-friendly pseudo-random helper so segment generation is testable.
 */
export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Generates a guaranteed-playable segment pattern:
 * - First 2 segments are safe warm-up zones with welcoming coin trails.
 * - Obstacles never block all 3 lanes simultaneously unless jumpable (stone_barrier, spike_trap, broken_bridge)
 *   or slideable (low_branch).
 * - Minimum Z spacing between consecutive obstacle rows scales with speed/segment so landing from a jump
 *   never drops directly into an unavoidable next trap.
 */
export function generateSegmentPattern(
  segmentIndex: number,
  startBiome: BiomeId = 'jungle_temple',
  rng: () => number = Math.random
): SegmentPattern {
  const biome = getBiomeForSegment(segmentIndex, startBiome);
  const length = SEGMENT_LENGTH;
  const obstacles: ObstacleSpec[] = [];
  const coins: CoinSpec[] = [];
  const powerUps: PowerUpSpec[] = [];

  let nextId = segmentIndex * 100;
  let turnDirection: 'none' | 'left' | 'right' = 'none';

  // Safe opening runway (first 2 segments have zero obstacles, rich coin trail)
  if (segmentIndex <= 1) {
    const lane: LaneIndex = segmentIndex === 0 ? 1 : (rng() < 0.5 ? 0 : 2);
    for (let z = 6; z <= length - 4; z += 2.2) {
      coins.push({
        id: nextId++,
        lane,
        zOffset: z,
        yOffset: 0.85,
        isGem: false,
      });
    }
    return {segmentIndex, biome, length, turnDirection, obstacles, coins, powerUps};
  }

  // Every 9th segment is a dramatic 90-degree temple turn junction
  if (segmentIndex >= 6 && segmentIndex % 9 === 0) {
    turnDirection = rng() < 0.5 ? 'left' : 'right';
    for (let z = 4; z <= length - 8; z += 2.2) {
      coins.push({
        id: nextId++,
        lane: 1,
        zOffset: z,
        yOffset: 0.85,
        isGem: z > length - 12,
      });
    }
    return {segmentIndex, biome, length, turnDirection, obstacles, coins, powerUps};
  }

  const difficulty = Math.min(1, segmentIndex / 36);
  const pool: ObstacleType[] = [
    'stone_barrier',
    'fallen_tree',
    'low_branch',
    'spike_trap',
    'fire_trap',
    'rotating_gear',
  ];
  if (segmentIndex >= 3) {
    pool.push('broken_bridge', 'moving_block', 'collapsing_tile');
  }
  if (segmentIndex >= 5) {
    pool.push('rolling_boulder');
  }

  // Up to 2 obstacle rows per 26m segment, separated by at least 11.5m so jumps/slides recover cleanly
  const rowZPositions = difficulty > 0.35 ? [7.5, 19.5] : [13.0];

  for (const zPos of rowZPositions) {
    const pick = pool[Math.floor(rng() * pool.length)];
    const fullWidth =
      (pick === 'broken_bridge' || pick === 'stone_barrier' || pick === 'low_branch') &&
      rng() < 0.42;

    if (fullWidth) {
      obstacles.push({
        id: nextId++,
        type: pick,
        lane: 1,
        zOffset: zPos,
        fullWidth: true,
        phase: rng() * Math.PI * 2,
      });
      // Place an inviting jump or slide coin arc over/under the full-width obstacle
      if (pick === 'low_branch') {
        coins.push({
          id: nextId++,
          lane: 1,
          zOffset: zPos,
          yOffset: 0.45,
          isGem: false,
        });
      } else {
        coins.push({
          id: nextId++,
          lane: 1,
          zOffset: zPos,
          yOffset: 2.3,
          isGem: rng() < 0.25,
        });
      }
    } else {
      // Leave at least 1 guaranteed clear lane
      const clearLane = Math.floor(rng() * 3) as LaneIndex;
      const blockTwoLanes = difficulty > 0.25 && rng() < 0.55;
      const candidateLanes: LaneIndex[] = ([0, 1, 2] as LaneIndex[]).filter(
        (l) => l !== clearLane
      );
      const chosenLanes = blockTwoLanes ? candidateLanes : [candidateLanes[0]];

      for (const lane of chosenLanes) {
        // Avoid spawning moving_block simultaneously with another blocker in the same row
        const typeForLane =
          pick === 'moving_block' && chosenLanes.length > 1 ? 'stone_barrier' : pick;
        obstacles.push({
          id: nextId++,
          type: typeForLane,
          lane,
          zOffset: zPos,
          fullWidth: false,
          phase: rng() * Math.PI * 2,
        });
      }

      // Coin trail guiding through the guaranteed open lane
      for (let dz = -2.2; dz <= 2.2; dz += 2.2) {
        coins.push({
          id: nextId++,
          lane: clearLane,
          zOffset: zPos + dz,
          yOffset: 0.85,
          isGem: dz === 0 && rng() < 0.18,
        });
      }
    }
  }

  // Occasional power-up spawn in a clear lane
  if (segmentIndex % 3 === 2 || rng() < 0.28) {
    const types: PowerUpType[] = [
      'magnet',
      'shield',
      'multiplier',
      'boost',
      'invincibility',
    ];
    const pType = types[Math.floor(rng() * types.length)];
    const pLane = Math.floor(rng() * 3) as LaneIndex;
    const pZ = 13.5;
    // Only place if not overlapping an obstacle in that lane/Z
    const blocked = obstacles.some(
      (o) =>
        Math.abs(o.zOffset - pZ) < 3.5 && (o.fullWidth || o.lane === pLane)
    );
    if (!blocked) {
      powerUps.push({
        id: nextId++,
        type: pType,
        lane: pLane,
        zOffset: pZ,
      });
    }
  }

  return {
    segmentIndex,
    biome,
    length,
    turnDirection,
    obstacles,
    coins,
    powerUps,
  };
}

/**
 * Evaluates collision between the player and an obstacle at segment-local Z.
 * Returns 'none' | 'hit' | 'smash' (when boosting/invincible smashes obstacles).
 */
export function evaluateObstacleHit(
  player: PlayerCollisionState,
  obstacle: ObstacleSpec,
  playerLocalZ: number,
  timeSeconds: number
): 'none' | 'hit' | 'smash' {
  // Check Z proximity first
  const zHalf =
    obstacle.type === 'broken_bridge'
      ? 1.55
      : obstacle.type === 'rolling_boulder'
        ? 1.05
        : 0.72;

  let obstacleZ = obstacle.zOffset;
  if (obstacle.type === 'rolling_boulder') {
    // Boulder rolls steadily toward the approaching runner
    const rollOffset = ((timeSeconds * 4.5 + obstacle.phase) % 8) - 4;
    obstacleZ = obstacle.zOffset - rollOffset;
  }

  if (Math.abs(playerLocalZ - obstacleZ) > zHalf) {
    return 'none';
  }

  // Check lateral X overlap
  let obstacleX = LANE_POSITIONS[obstacle.lane];
  let halfWidth = 0.85;
  if (obstacle.fullWidth) {
    obstacleX = 0;
    halfWidth = 3.35;
  } else if (obstacle.type === 'moving_block') {
    obstacleX = Math.sin(timeSeconds * 2.2 + obstacle.phase) * 2.15;
    halfWidth = 0.88;
  }

  if (Math.abs(player.x - obstacleX) > halfWidth + 0.34) {
    return 'none';
  }

  // Invincible / Boost auto-bridges gaps and smashes obstacles!
  if (player.isBoosting || player.isInvincible) {
    if (obstacle.type === 'broken_bridge') {
      return 'none';
    }
    return 'smash';
  }

  // Height / posture clearance checks per obstacle type
  switch (obstacle.type) {
    case 'broken_bridge':
      // Player clears gap if airborne above threshold
      return player.y > 0.45 ? 'none' : 'hit';

    case 'stone_barrier':
    case 'fallen_tree':
    case 'spike_trap':
    case 'fire_trap':
    case 'collapsing_tile':
      return player.y > 0.85 ? 'none' : 'hit';

    case 'low_branch':
      // Slide under OR leap high above if perched
      return player.isSliding || player.y > 2.25 ? 'none' : 'hit';

    case 'rotating_gear': {
      // Sweeping blade: safe if sliding or jumping high
      return player.isSliding || player.y > 1.35 ? 'none' : 'hit';
    }

    case 'rolling_boulder':
    case 'moving_block':
      return player.y > 1.9 ? 'none' : 'hit';

    default:
      return 'hit';
  }
}

export function applyRunToSave(save: SaveData, run: RunStats): {
  nextSave: SaveData;
  newlyCompletedMissions: string[];
  newlyUnlockedAchievements: string[];
  newlyUnlockedBiomes: BiomeId[];
} {
  const next: SaveData = {
    ...save,
    upgradeLevels: {...save.upgradeLevels},
    unlockedCharacters: [...save.unlockedCharacters],
    unlockedBiomes: [...save.unlockedBiomes],
    completedMissions: [...save.completedMissions],
    unlockedAchievements: [...save.unlockedAchievements],
    settings: {...save.settings},
  };

  const roundedDist = Math.floor(run.distance);
  const roundedScore = Math.floor(run.score);

  next.highScore = Math.max(next.highScore, roundedScore);
  next.bestDistance = Math.max(next.bestDistance, roundedDist);
  next.coins += run.coins;
  next.totalCoinsCollected += run.coins;
  next.totalDistance += roundedDist;
  next.totalJumps += run.jumps;
  next.totalSlides += run.slides;
  next.totalPowerUps += run.powerUpsCollected;
  next.runsPlayed += 1;

  // Unlock biomes by distance milestones
  const newlyUnlockedBiomes: BiomeId[] = [];
  for (const biomeId of BIOME_ORDER) {
    if (
      !next.unlockedBiomes.includes(biomeId) &&
      roundedDist >= BIOMES[biomeId].unlockDistance
    ) {
      next.unlockedBiomes.push(biomeId);
      newlyUnlockedBiomes.push(biomeId);
    }
  }

  // Evaluate missions
  const newlyCompletedMissions: string[] = [];
  for (const m of MISSIONS) {
    if (next.completedMissions.includes(m.id)) continue;
    let currentVal = 0;
    if (m.cumulative) {
      if (m.metric === 'jumps') currentVal = next.totalJumps;
      else if (m.metric === 'slides') currentVal = next.totalSlides;
      else if (m.metric === 'powerups') currentVal = next.totalPowerUps;
      else if (m.metric === 'coins') currentVal = next.totalCoinsCollected;
      else if (m.metric === 'distance') currentVal = next.totalDistance;
      else if (m.metric === 'score') currentVal = next.highScore;
    } else {
      if (m.metric === 'distance') currentVal = roundedDist;
      else if (m.metric === 'coins') currentVal = run.coins;
      else if (m.metric === 'score') currentVal = roundedScore;
      else if (m.metric === 'jumps') currentVal = run.jumps;
      else if (m.metric === 'slides') currentVal = run.slides;
      else if (m.metric === 'powerups') currentVal = run.powerUpsCollected;
    }

    if (currentVal >= m.target) {
      next.completedMissions.push(m.id);
      next.coins += m.rewardCoins;
      newlyCompletedMissions.push(m.title);
    }
  }

  // Evaluate achievements
  const newlyUnlockedAchievements: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (next.unlockedAchievements.includes(a.id)) continue;
    let val = 0;
    if (a.metric === 'runsPlayed') val = next.runsPlayed;
    else if (a.metric === 'bestDistance') val = next.bestDistance;
    else if (a.metric === 'totalCoins') val = next.totalCoinsCollected;
    else if (a.metric === 'bestScore') val = next.highScore;
    else if (a.metric === 'biomesUnlocked') val = next.unlockedBiomes.length;

    if (val >= a.target) {
      next.unlockedAchievements.push(a.id);
      next.coins += a.rewardCoins;
      newlyUnlockedAchievements.push(a.title);
    }
  }

  return {
    nextSave: next,
    newlyCompletedMissions,
    newlyUnlockedAchievements,
    newlyUnlockedBiomes,
  };
}

export function purchaseUpgrade(save: SaveData, type: PowerUpType): SaveData | null {
  const def = SHOP_UPGRADES.find((u) => u.id === type);
  if (!def) return null;
  const level = save.upgradeLevels[type] ?? 1;
  if (level >= def.maxLevel) return null;
  const cost = getUpgradeCost(type, level);
  if (save.coins < cost) return null;

  return {
    ...save,
    coins: save.coins - cost,
    upgradeLevels: {
      ...save.upgradeLevels,
      [type]: level + 1,
    },
  };
}

export function selectOrUnlockCharacter(
  save: SaveData,
  characterId: CharacterId
): SaveData | null {
  if (save.unlockedCharacters.includes(characterId)) {
    return {...save, selectedCharacter: characterId};
  }
  const cfg = CHARACTERS[characterId];
  if (save.coins < cfg.cost) return null;
  return {
    ...save,
    coins: save.coins - cfg.cost,
    unlockedCharacters: [...save.unlockedCharacters, characterId],
    selectedCharacter: characterId,
  };
}

export function selectOrUnlockBiome(save: SaveData, biomeId: BiomeId): SaveData | null {
  if (save.unlockedBiomes.includes(biomeId)) {
    return {...save, selectedStartBiome: biomeId};
  }
  const cfg = BIOMES[biomeId];
  if (save.coins < cfg.unlockCost) return null;
  return {
    ...save,
    coins: save.coins - cfg.unlockCost,
    unlockedBiomes: [...save.unlockedBiomes, biomeId],
    selectedStartBiome: biomeId,
  };
}
