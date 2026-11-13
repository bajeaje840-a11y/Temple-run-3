export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type BiomeId =
  | 'jungle_temple'
  | 'underground_ruins'
  | 'mountain_cliff'
  | 'suspended_bridges'
  | 'lava_temple'
  | 'golden_kingdom';

export type CharacterId = 'aurelia' | 'cross' | 'kael' | 'solara';

export type PowerUpType =
  | 'magnet'
  | 'shield'
  | 'multiplier'
  | 'boost'
  | 'invincibility';

export type ObstacleType =
  | 'stone_barrier'
  | 'fallen_tree'
  | 'fire_trap'
  | 'rolling_boulder'
  | 'broken_bridge'
  | 'spike_trap'
  | 'moving_block'
  | 'low_branch'
  | 'rotating_gear'
  | 'collapsing_tile';

export type QualityLevel = 'low' | 'medium' | 'high';

export type LaneIndex = 0 | 1 | 2; // 0 = left (-X), 1 = center (0), 2 = right (+X)

export interface BiomeConfig {
  id: BiomeId;
  name: string;
  subtitle: string;
  unlockDistance: number;
  unlockCost: number;
  skyTop: number;
  skyBottom: number;
  fogColor: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  stoneBase: string;
  stoneAccent: string;
  mossColor: string;
  waterColor: number;
  accentEmissive: number;
  hasBridgeDrop: boolean;
  hasLava: boolean;
  isCavern: boolean;
}

export interface CharacterConfig {
  id: CharacterId;
  name: string;
  title: string;
  cost: number;
  primaryColor: number;
  secondaryColor: number;
  skinColor: number;
  hairColor: number;
  accentColor: number;
  hasHat: boolean;
  hasCape: boolean;
}

export interface ShopUpgradeDef {
  id: PowerUpType;
  name: string;
  description: string;
  baseDuration: number;
  durationPerLevel: number;
  maxLevel: number;
  baseCost: number;
  costStep: number;
}

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  metric: 'distance' | 'coins' | 'score' | 'powerups' | 'jumps' | 'slides';
  target: number;
  rewardCoins: number;
  cumulative: boolean;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  metric: 'bestDistance' | 'totalCoins' | 'bestScore' | 'runsPlayed' | 'biomesUnlocked';
  target: number;
  rewardCoins: number;
}

export type DailyMissionMetric =
  | 'coins'
  | 'survivalSeconds'
  | 'distance'
  | 'score'
  | 'jumps'
  | 'slides'
  | 'powerups'
  | 'closeCalls';

export interface DailyMissionTemplate {
  id: string;
  title: string;
  description: string;
  metric: DailyMissionMetric;
  target: number;
  rewardCoins: number;
}

export interface DailyMissionItem extends DailyMissionTemplate {
  progress: number;
  completed: boolean;
}

export interface DailyMissionsState {
  dateKey: string;
  missions: DailyMissionItem[];
}

export interface SaveData {
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
  dailyMissions: DailyMissionsState;
  settings: {
    quality: QualityLevel;
    musicVolume: number;
    sfxVolume: number;
    muted: boolean;
  };
}

export interface ObstacleSpec {
  id: number;
  type: ObstacleType;
  lane: LaneIndex;
  /** Local Z offset within segment (0 .. segmentLength) */
  zOffset: number;
  /** True if obstacle spans all 3 lanes (e.g., full jump barrier, full low branch, or full gap) */
  fullWidth: boolean;
  /** For moving_block or rolling_boulder */
  phase: number;
}

export interface CoinSpec {
  id: number;
  lane: LaneIndex;
  zOffset: number;
  yOffset: number;
  isGem: boolean;
}

export interface PowerUpSpec {
  id: number;
  type: PowerUpType;
  lane: LaneIndex;
  zOffset: number;
}

export interface SegmentPattern {
  segmentIndex: number;
  biome: BiomeId;
  length: number;
  turnDirection: 'none' | 'left' | 'right';
  obstacles: ObstacleSpec[];
  coins: CoinSpec[];
  powerUps: PowerUpSpec[];
}

export interface PlayerCollisionState {
  lane: LaneIndex;
  x: number;
  y: number;
  isJumping: boolean;
  isSliding: boolean;
  hasShield: boolean;
  isInvincible: boolean;
  isBoosting: boolean;
}

export interface RunStats {
  score: number;
  distance: number;
  coins: number;
  survivalSeconds: number;
  multiplier: number;
  powerUpsCollected: number;
  jumps: number;
  slides: number;
  closeCalls: number;
  maxCombo: number;
  currentBiome: BiomeId;
}
