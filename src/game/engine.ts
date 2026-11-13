import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {
  BIOMES,
  GRAVITY,
  JUMP_VELOCITY,
  LANE_POSITIONS,
  POWERUP_META,
  SLIDE_DURATION,
  TRACK_WIDTH,
  VISIBLE_SEGMENTS_AHEAD,
} from './constants';
import {TempleAudio} from './audio';
import {AdventurerCharacter} from './character';
import {
  computeComboMultiplier,
  computeScoreDelta,
  computeSpeedForDistance,
  evaluateObstacleHit,
  generateSegmentPattern,
  getBiomeForSegment,
  getPowerUpDuration,
} from './rules';
import {createProceduralTextures, ProceduralTextureSet} from './textures';
import type {
  BiomeId,
  GameState,
  LaneIndex,
  PowerUpType,
  QualityLevel,
  RunStats,
  SaveData,
} from './types';
import {ActiveSegment, TempleWorld} from './world';

export interface HudSnapshot {
  score: number;
  distance: number;
  coins: number;
  multiplier: number;
  combo: number;
  comboMult: number;
  surgeCharge: number;
  surgeActive: boolean;
  isSpeedLines: boolean;
  biome: BiomeId;
  activePowerUps: Array<{type: PowerUpType; remaining: number; duration: number}>;
  turnHint: 'none' | 'left' | 'right';
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onBiomeChanged: (biome: BiomeId) => void;
  onCloseCall: (bonusPoints: number) => void;
  onGameOver: (stats: RunStats) => void;
  onPauseToggle: () => void;
  onMuteToggle: () => void;
}

const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _playerWorldPos = new THREE.Vector3();
const _coinWorldPos = new THREE.Vector3();
const _powerWorldPos = new THREE.Vector3();
const _skyColor = new THREE.Color();
const _targetSkyColor = new THREE.Color();
const _fogColor = new THREE.Color();
const _targetFogColor = new THREE.Color();
const _sunColor = new THREE.Color();
const _targetSunColor = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class TempleRunEngine {
  public readonly isSoftwareGl = detectSoftwareWebGL();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly textures: ProceduralTextureSet;
  private readonly world: TempleWorld;
  private readonly character: AdventurerCharacter;

  private save: SaveData;
  private gameState: GameState = 'title';
  private frameId = 0;
  private lastFrameMs = 0;
  private elapsedSeconds = 0;
  private disposed = false;

  // Player run state
  private activeSegIdx = 0;
  private nextSegGenIndex = 0;
  private nextSegOrigin = new THREE.Vector3(0, 0, 0);
  private nextSegHeading = 0;
  private localZ = 3;
  private lane: LaneIndex = 1;
  private localX = LANE_POSITIONS[1];
  private laneBank = 0;
  private playerY = 0;
  private verticalVel = 0;
  private isJumping = false;
  private isSliding = false;
  private slideTimer = 0;
  private coyoteTimer = 0;
  private bufferedAction: 'jump' | 'slide' | null = null;
  private bufferedActionTimer = 0;
  private bufferedTurn: 'left' | 'right' | null = null;
  private bufferedTurnTimer = 0;

  private playerYaw = 0;
  private cameraYaw = 0;
  private cameraTrauma = 0;
  private hitstopTimer = 0;
  private collectAnimTimer = 0;
  private isDead = false;
  private deathTimer = 0;
  private gameOverDispatched = false;

  private runDistance = 0;
  private runScore = 0;
  private runCoins = 0;
  private runPowerUps = 0;
  private runJumps = 0;
  private runSlides = 0;
  private runCloseCalls = 0;
  private coinCombo = 0;
  private comboTimer = 0;
  private maxCombo = 0;
  private surgeCharge = 0;
  private surgeTimer = 0;
  private revivesUsedInRun = 0;
  private currentBiome: BiomeId = 'jungle_temple';

  private powerUpTimers: Record<PowerUpType, number> = {
    magnet: 0,
    shield: 0,
    multiplier: 0,
    boost: 0,
    invincibility: 0,
  };
  private powerUpDurations: Record<PowerUpType, number> = {
    magnet: 8,
    shield: 12,
    multiplier: 9,
    boost: 5,
    invincibility: 6,
  };

  // Input tracking
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeActive = false;
  private swipeConsumed = false;
  private lastHudPushAt = 0;

  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly mountEl: HTMLElement,
    private readonly audio: TempleAudio,
    initialSave: SaveData,
    private readonly callbacks: EngineCallbacks
  ) {
    this.save = initialSave;
    this.currentBiome = initialSave.selectedStartBiome;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.isSoftwareGl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.applyQuality(initialSave.settings.quality);

    const width = Math.max(1, mountEl.clientWidth || window.innerWidth);
    const height = Math.max(1, mountEl.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height);
    mountEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const biome = BIOMES[this.currentBiome];
    _skyColor.setHex(biome.skyBottom);
    _fogColor.setHex(biome.fogColor);
    this.scene.background = _skyColor.clone();
    this.scene.fog = new THREE.FogExp2(_fogColor.getHex(), biome.fogDensity);

    // Mandatory studio environment reflection (RoomEnvironment + PMREMGenerator)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.2, 260);
    this.camera.position.set(0, 3.6, 5.2);

    // Warm directional key sun + cool hemisphere fill + crisp backlight rim
    this.hemiLight = new THREE.HemisphereLight(biome.hemiSky, biome.hemiGround, 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(biome.sunColor, biome.sunIntensity);
    this.sunLight.position.set(16, 26, 14);
    this.sunLight.castShadow = !this.isSoftwareGl && initialSave.settings.quality !== 'low';
    this.sunLight.shadow.mapSize.set(
      initialSave.settings.quality === 'high' ? 2048 : 1024,
      initialSave.settings.quality === 'high' ? 2048 : 1024
    );
    const d = 18;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 75;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0x9ad8ff, 0.95);
    this.rimLight.position.set(-14, 12, -16);
    this.rimLight.castShadow = false;
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.world = new TempleWorld(this.textures);
    this.world.setQuality(initialSave.settings.quality);
    this.scene.add(this.world.root);

    this.character = new AdventurerCharacter(
      initialSave.selectedCharacter,
      this.textures.shadowDisc
    );
    this.scene.add(this.character.root);

    this.resetWorldToStart(true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(mountEl);

    this.bindInputs();
    this.lastFrameMs = performance.now();
    this.stepTitleVista(0.016);
    this.camera.position.set(
      _playerWorldPos.x - 1.3,
      _playerWorldPos.y + 3.15,
      _playerWorldPos.z + 5.6
    );
    this.camera.lookAt(_playerWorldPos.x + 0.7, _playerWorldPos.y + 1.35, _playerWorldPos.z - 8);
    this.renderer.render(this.scene, this.camera);
    this.tick();
  }

  public getRevivesUsed(): number {
    return this.revivesUsedInRun;
  }

  public syncSaveData(nextSave: SaveData): void {
    const charChanged = nextSave.selectedCharacter !== this.save.selectedCharacter;
    const qualityChanged = nextSave.settings.quality !== this.save.settings.quality;
    const biomeChanged =
      this.gameState === 'title' &&
      nextSave.selectedStartBiome !== this.save.selectedStartBiome;

    this.save = nextSave;
    if (charChanged) {
      this.character.setCharacter(nextSave.selectedCharacter);
    }
    if (qualityChanged) {
      this.applyQuality(nextSave.settings.quality);
      this.world.setQuality(nextSave.settings.quality);
    }
    if (biomeChanged) {
      this.currentBiome = nextSave.selectedStartBiome;
      this.resetWorldToStart(true);
    }
  }

  public applyQuality(q: QualityLevel): void {
    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      if (this.sunLight) this.sunLight.castShadow = false;
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    if (q === 'low') {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      if (this.sunLight) this.sunLight.castShadow = false;
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5));
      this.renderer.shadowMap.enabled = true;
      if (this.sunLight) this.sunLight.castShadow = true;
    } else {
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.shadowMap.enabled = true;
      if (this.sunLight) this.sunLight.castShadow = true;
    }
  }

  public setState(nextState: GameState): void {
    this.gameState = nextState;
    if (nextState === 'playing') {
      this.lastFrameMs = performance.now();
      this.audio.startMusic();
    } else if (nextState === 'paused' || nextState === 'gameover' || nextState === 'title') {
      this.audio.stopMusic();
    }
    if (nextState === 'title') {
      this.resetWorldToStart(true);
    }
  }

  public startNewRun(): void {
    this.resetWorldToStart(false);
    this.setState('playing');
    this.pushHud(true);
  }

  public reviveCurrentRun(): void {
    this.isDead = false;
    this.deathTimer = 0;
    this.gameOverDispatched = false;
    this.revivesUsedInRun++;
    this.playerY = 0;
    this.verticalVel = 0;
    this.isJumping = false;
    this.isSliding = false;
    this.slideTimer = 0;
    this.lane = 1;
    this.localX = LANE_POSITIONS[1];
    this.laneBank = 0;

    // Safely recover from turn-wall or broken-bridge drop
    const activeSeg = this.world.segments[this.activeSegIdx];
    if (activeSeg) {
      if (
        activeSeg.pattern.turnDirection !== 'none' &&
        !activeSeg.turnHandled &&
        this.localZ >= activeSeg.pattern.length - 5.5
      ) {
        this.localZ = activeSeg.pattern.length - 2.5;
        this.tryExecuteTurn(activeSeg.pattern.turnDirection);
      }
      // Smash obstacles within safety zone ahead so player lands cleanly
      for (const seg of [
        this.world.segments[this.activeSegIdx],
        this.world.segments[this.activeSegIdx + 1],
      ]) {
        if (!seg) continue;
        for (const obs of seg.obstacles) {
          if (seg === activeSeg && obs.spec.zOffset < this.localZ - 2) continue;
          if (seg === activeSeg && obs.spec.zOffset <= this.localZ + 18) {
            obs.smashed = true;
            obs.mesh.visible = false;
          } else if (seg !== activeSeg && obs.spec.zOffset <= 12) {
            obs.smashed = true;
            obs.mesh.visible = false;
          }
        }
      }
    }

    this.powerUpTimers.invincibility = Math.max(this.powerUpTimers.invincibility, 2.8);
    this.powerUpDurations.invincibility = Math.max(this.powerUpDurations.invincibility, 2.8);
    this.syncCharacterWorldTransform();
    this.character.root.getWorldPosition(_playerWorldPos);
    this.world.particles.emit(_playerWorldPos, 28, 0xffd95a, 7.2, 1.35, 3.8);
    this.audio.playRevive();
    this.setState('playing');
    this.pushHud(true);
  }

  private resetWorldToStart(isTitlePreview: boolean): void {
    this.world.clearAllSegments();
    this.activeSegIdx = 0;
    this.nextSegGenIndex = 0;
    this.nextSegOrigin.set(0, 0, 0);
    this.nextSegHeading = 0;
    this.localZ = 3.5;
    this.lane = 1;
    this.localX = LANE_POSITIONS[1];
    this.laneBank = 0;
    this.playerY = 0;
    this.verticalVel = 0;
    this.isJumping = false;
    this.isSliding = false;
    this.slideTimer = 0;
    this.coyoteTimer = 0;
    this.bufferedAction = null;
    this.bufferedActionTimer = 0;
    this.bufferedTurn = null;
    this.bufferedTurnTimer = 0;
    this.playerYaw = 0;
    this.cameraYaw = 0;
    this.cameraTrauma = 0;
    this.hitstopTimer = 0;
    this.collectAnimTimer = 0;
    this.isDead = false;
    this.deathTimer = 0;
    this.gameOverDispatched = false;

    this.runDistance = 0;
    this.runScore = 0;
    this.runCoins = 0;
    this.runPowerUps = 0;
    this.runJumps = 0;
    this.runSlides = 0;
    this.runCloseCalls = 0;
    this.coinCombo = 0;
    this.comboTimer = 0;
    this.maxCombo = 0;
    this.surgeCharge = 0;
    this.surgeTimer = 0;
    this.revivesUsedInRun = 0;
    this.currentBiome = this.save.selectedStartBiome;

    for (const key of Object.keys(this.powerUpTimers) as PowerUpType[]) {
      this.powerUpTimers[key] = 0;
    }

    const startBiome = BIOMES[this.currentBiome];
    (this.scene.background as THREE.Color).setHex(startBiome.skyBottom);
    (this.scene.fog as THREE.FogExp2).color.setHex(startBiome.fogColor);
    (this.scene.fog as THREE.FogExp2).density = startBiome.fogDensity;
    this.sunLight.color.setHex(startBiome.sunColor);
    this.sunLight.intensity = startBiome.sunIntensity;
    this.hemiLight.color.setHex(startBiome.hemiSky);
    this.hemiLight.groundColor.setHex(startBiome.hemiGround);

    for (let i = 0; i < VISIBLE_SEGMENTS_AHEAD; i++) {
      this.appendNextSegment(isTitlePreview);
    }

    this.syncCharacterWorldTransform();
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
  }

  private appendNextSegment(safePreview = false): void {
    const idx = this.nextSegGenIndex++;
    const pattern = generateSegmentPattern(
      safePreview ? idx % 2 : idx,
      this.save.selectedStartBiome
    );
    const seg = this.world.spawnSegment(pattern, this.nextSegOrigin, this.nextSegHeading);

    if (pattern.turnDirection === 'none') {
      this.nextSegOrigin.addScaledVector(seg.forward, pattern.length);
    } else {
      const sideSign = pattern.turnDirection === 'left' ? -1 : 1;
      const turnCenterDist = pattern.length - 3.0;
      this.nextSegOrigin.addScaledVector(seg.forward, turnCenterDist);
      this.nextSegOrigin.addScaledVector(seg.right, sideSign * (TRACK_WIDTH / 2));
      this.nextSegHeading += pattern.turnDirection === 'left' ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.mountEl.clientWidth || window.innerWidth);
    const height = Math.max(1, this.mountEl.clientHeight || window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  }

  private bindInputs(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const dom = this.renderer.domElement;
    dom.addEventListener('touchstart', this.onTouchStart, {passive: false});
    dom.addEventListener('touchmove', this.onTouchMove, {passive: false});
    dom.addEventListener('touchend', this.onTouchEnd, {passive: true});
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  }

  private readonly onWindowBlur = (): void => {
    this.swipeActive = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.swipeActive = false;
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyM') {
      this.callbacks.onMuteToggle();
      return;
    }

    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.gameState === 'playing' || this.gameState === 'paused') {
        e.preventDefault();
        this.callbacks.onPauseToggle();
      }
      return;
    }

    if (this.gameState !== 'playing' || this.isDead) return;

    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault();
      this.triggerLeft();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault();
      this.triggerRight();
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
      e.preventDefault();
      this.triggerJump();
    } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      this.triggerSlide();
    } else if (e.code === 'KeyE') {
      e.preventDefault();
      this.triggerRelicSurge();
    }
  };

  private readonly onTouchStart = (e: TouchEvent): void => {
    this.audio.unlock();
    if (this.gameState !== 'playing' || this.isDead || e.touches.length === 0) return;
    this.swipeStartX = e.touches[0].clientX;
    this.swipeStartY = e.touches[0].clientY;
    this.swipeActive = true;
    this.swipeConsumed = false;
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    if (!this.swipeActive || this.swipeConsumed || e.touches.length === 0) return;
    e.preventDefault();
    this.evaluateSwipeDelta(
      e.touches[0].clientX - this.swipeStartX,
      e.touches[0].clientY - this.swipeStartY
    );
  };

  private readonly onTouchEnd = (): void => {
    this.swipeActive = false;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    this.audio.unlock();
    if (this.gameState !== 'playing' || this.isDead) return;
    this.swipeStartX = e.clientX;
    this.swipeStartY = e.clientY;
    this.swipeActive = true;
    this.swipeConsumed = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.swipeActive || this.swipeConsumed) return;
    this.evaluateSwipeDelta(e.clientX - this.swipeStartX, e.clientY - this.swipeStartY);
  };

  private readonly onMouseUp = (): void => {
    this.swipeActive = false;
  };

  private evaluateSwipeDelta(dx: number, dy: number): void {
    const threshold = 28;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    this.swipeConsumed = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) this.triggerLeft();
      else this.triggerRight();
    } else {
      if (dy < 0) this.triggerJump();
      else this.triggerSlide();
    }
  }

  public triggerRelicSurge(): boolean {
    if (this.gameState !== 'playing' || this.isDead) return false;
    if (this.surgeCharge < 100 || this.surgeTimer > 0) return false;
    this.surgeCharge = 0;
    this.surgeTimer = 4.5;
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
    this.audio.playRelicSurge();
    this.character.root.getWorldPosition(_playerWorldPos);
    this.world.particles.emit(_playerWorldPos, 28, 0xffd95a, 8.0, 1.35, 3.6);
    this.pushHud(true);
    return true;
  }

  public triggerLeft(): void {
    const seg = this.world.segments[this.activeSegIdx];
    if (seg && seg.pattern.turnDirection === 'left') {
      if (this.tryExecuteTurn('left')) return;
      if (this.localZ > seg.pattern.length - 10) {
        this.bufferedTurn = 'left';
        this.bufferedTurnTimer = 0.55;
        return;
      }
    }
    if (this.lane > 0) {
      this.lane = (this.lane - 1) as LaneIndex;
      this.laneBank = -1;
      this.audio.playLaneSwitch();
    }
  }

  public triggerRight(): void {
    const seg = this.world.segments[this.activeSegIdx];
    if (seg && seg.pattern.turnDirection === 'right') {
      if (this.tryExecuteTurn('right')) return;
      if (this.localZ > seg.pattern.length - 10) {
        this.bufferedTurn = 'right';
        this.bufferedTurnTimer = 0.55;
        return;
      }
    }
    if (this.lane < 2) {
      this.lane = (this.lane + 1) as LaneIndex;
      this.laneBank = 1;
      this.audio.playLaneSwitch();
    }
  }

  public triggerJump(): void {
    if (!this.isJumping || this.coyoteTimer > 0) {
      this.executeJump();
    } else {
      this.bufferedAction = 'jump';
      this.bufferedActionTimer = 0.14;
    }
  }

  public triggerSlide(): void {
    if (this.isJumping) {
      this.verticalVel = Math.min(this.verticalVel, -18);
      this.bufferedAction = 'slide';
      this.bufferedActionTimer = 0.18;
      return;
    }
    if (!this.isSliding) {
      this.executeSlide();
    } else {
      this.bufferedAction = 'slide';
      this.bufferedActionTimer = 0.14;
    }
  }

  private executeJump(): void {
    this.isJumping = true;
    this.isSliding = false;
    this.slideTimer = 0;
    this.coyoteTimer = 0;
    this.verticalVel = JUMP_VELOCITY;
    this.runJumps++;
    this.character.triggerJumpSquash();
    this.audio.playJump();
    this.world.particles.emit(this.character.root.position, 5, 0xd9cbb3, 2.2, 0.75, 1.8);
  }

  private executeSlide(): void {
    this.isSliding = true;
    this.slideTimer = SLIDE_DURATION;
    this.runSlides++;
    this.audio.playSlide();
    this.world.particles.emit(this.character.root.position, 5, 0xd9cbb3, 2.5, 0.7, 1.0);
  }

  private tryExecuteTurn(dir: 'left' | 'right'): boolean {
    const seg = this.world.segments[this.activeSegIdx];
    const nextSeg = this.world.segments[this.activeSegIdx + 1];
    if (!seg || !nextSeg || seg.turnHandled) return false;
    if (seg.pattern.turnDirection !== dir) return false;

    const turnStart = seg.pattern.length - 6.6;
    const turnEnd = seg.pattern.length + 0.4;
    if (this.localZ < turnStart || this.localZ > turnEnd) return false;

    seg.turnHandled = true;
    this.bufferedTurn = null;
    this.bufferedTurnTimer = 0;
    this.activeSegIdx++;
    this.localZ = 1.6;
    this.lane = 1;
    this.localX = LANE_POSITIONS[1];
    this.laneBank = dir === 'left' ? -1.1 : 1.1;
    this.playerYaw = nextSeg.headingRad;
    this.audio.playLaneSwitch();
    return true;
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.step(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private step(dt: number): void {
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);

    if (this.gameState === 'paused') {
      return;
    }

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.updateCamera(dt);
      return;
    }

    this.elapsedSeconds += dt;

    if (this.gameState === 'title') {
      this.stepTitleVista(dt);
      return;
    }

    if (this.gameState === 'gameover') {
      this.world.particles.update(dt);
      this.updateCamera(dt);
      return;
    }

    // Playing state
    if (this.isDead) {
      this.deathTimer += dt;
      if (this.playerY > -8) {
        this.verticalVel += GRAVITY * dt;
        this.playerY += this.verticalVel * dt;
      }
      this.syncCharacterWorldTransform();
      this.character.update(dt, {
        distance: this.runDistance,
        speed: 0,
        isJumping: false,
        verticalVel: 0,
        isSliding: false,
        isDead: true,
        deathElapsed: this.deathTimer,
        laneBank: this.laneBank,
        collectTimer: 0,
        hasShield: false,
        hasMagnet: false,
        isInvincible: false,
        isBoosting: false,
        groundY: 0,
        playerY: this.playerY,
      });
      this.world.particles.update(dt);
      this.updateCamera(dt);

      if (this.deathTimer >= 0.55 && !this.gameOverDispatched) {
        this.gameOverDispatched = true;
        const totalMult =
          (this.powerUpTimers.multiplier > 0 ? 2 : 1) * computeComboMultiplier(this.coinCombo);
        this.callbacks.onGameOver({
          score: Math.floor(this.runScore),
          distance: Math.floor(this.runDistance),
          coins: this.runCoins,
          multiplier: totalMult,
          powerUpsCollected: this.runPowerUps,
          jumps: this.runJumps,
          slides: this.runSlides,
          closeCalls: this.runCloseCalls,
          maxCombo: this.maxCombo,
          currentBiome: this.currentBiome,
        });
      }
      return;
    }

    // Tick power-ups, combo timer, & Relic Surge
    for (const p of Object.keys(this.powerUpTimers) as PowerUpType[]) {
      if (this.powerUpTimers[p] > 0) {
        this.powerUpTimers[p] = Math.max(0, this.powerUpTimers[p] - dt);
      }
    }
    if (this.surgeTimer > 0) {
      this.surgeTimer = Math.max(0, this.surgeTimer - dt);
    }
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) {
        this.coinCombo = 0;
      }
    }

    const isBoosting = this.powerUpTimers.boost > 0 || this.surgeTimer > 0;
    const isInvincible = this.powerUpTimers.invincibility > 0 || this.surgeTimer > 0;
    const hasMagnet = this.powerUpTimers.magnet > 0 || this.surgeTimer > 0;
    const hasShield = this.powerUpTimers.shield > 0;
    const comboMult = computeComboMultiplier(this.coinCombo);
    const relicMult = this.powerUpTimers.multiplier > 0 ? 2 : 1;
    const totalMult = relicMult * comboMult;

    const speed = computeSpeedForDistance(this.runDistance, isBoosting);
    const dz = speed * dt;
    this.localZ += dz;
    this.runDistance += dz;
    this.runScore += computeScoreDelta(dz, totalMult, Math.min(1, this.runDistance / 1500));

    // Smooth lateral lane movement
    const targetX = LANE_POSITIONS[this.lane];
    const laneDamp = 1 - Math.exp(-16 * dt);
    this.localX = THREE.MathUtils.lerp(this.localX, targetX, laneDamp);
    this.laneBank = THREE.MathUtils.lerp(this.laneBank, 0, 1 - Math.exp(-10 * dt));

    // Jump / gravity / slide / buffers
    if (this.bufferedActionTimer > 0) {
      this.bufferedActionTimer -= dt;
      if (this.bufferedActionTimer <= 0) this.bufferedAction = null;
    }
    if (this.bufferedTurnTimer > 0) {
      this.bufferedTurnTimer -= dt;
      if (this.bufferedTurnTimer <= 0) this.bufferedTurn = null;
    }

    if (this.isSliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.isSliding = false;
      }
    }

    if (this.isJumping) {
      this.verticalVel += GRAVITY * dt;
      this.playerY += this.verticalVel * dt;
      if (this.playerY <= 0) {
        this.playerY = 0;
        this.verticalVel = 0;
        this.isJumping = false;
        this.character.triggerLandSquash();
        this.audio.playLand();
        this.world.particles.emit(this.character.root.position, 4, 0xcab89d, 2.0, 0.7, 1.4);
        if (this.bufferedAction === 'slide') {
          this.bufferedAction = null;
          this.executeSlide();
        } else if (this.bufferedAction === 'jump') {
          this.bufferedAction = null;
          this.executeJump();
        }
      }
    } else {
      this.coyoteTimer = 0.09;
      if (this.bufferedAction === 'jump') {
        this.bufferedAction = null;
        this.executeJump();
      }
    }

    if (this.collectAnimTimer > 0) {
      this.collectAnimTimer = Math.max(0, this.collectAnimTimer - dt);
    }

    // Check segment advancement & buffered turns
    let currentSeg = this.world.segments[this.activeSegIdx];
    if (currentSeg) {
      if (
        currentSeg.pattern.turnDirection !== 'none' &&
        !currentSeg.turnHandled &&
        this.bufferedTurn === currentSeg.pattern.turnDirection
      ) {
        this.tryExecuteTurn(this.bufferedTurn);
        currentSeg = this.world.segments[this.activeSegIdx];
      }

      if (currentSeg && currentSeg.pattern.turnDirection === 'none') {
        if (this.localZ >= currentSeg.pattern.length) {
          this.localZ -= currentSeg.pattern.length;
          this.activeSegIdx++;
          currentSeg = this.world.segments[this.activeSegIdx];
        }
      } else if (
        currentSeg &&
        currentSeg.pattern.turnDirection !== 'none' &&
        !currentSeg.turnHandled &&
        this.localZ >= currentSeg.pattern.length - 0.8
      ) {
        if (isBoosting || isInvincible || hasShield) {
          if (hasShield && !isBoosting && !isInvincible) {
            this.consumeShield();
          }
          this.localZ = currentSeg.pattern.length - 2.5;
          this.tryExecuteTurn(currentSeg.pattern.turnDirection);
          currentSeg = this.world.segments[this.activeSegIdx];
        } else {
          this.triggerDeath(false);
          return;
        }
      }
    }

    // Recycle old segments behind and generate ahead
    while (this.activeSegIdx > 1) {
      this.world.removeSegment(this.world.segments[0]);
      this.activeSegIdx--;
    }
    while (this.world.segments.length - this.activeSegIdx < VISIBLE_SEGMENTS_AHEAD) {
      this.appendNextSegment(false);
    }

    // Track biome transition
    if (currentSeg) {
      const nextBiome = getBiomeForSegment(
        currentSeg.pattern.segmentIndex,
        this.save.selectedStartBiome
      );
      if (nextBiome !== this.currentBiome) {
        this.currentBiome = nextBiome;
        this.callbacks.onBiomeChanged(nextBiome);
      }
    }

    this.syncCharacterWorldTransform();
    this.character.root.getWorldPosition(_playerWorldPos);

    this.world.updateSegmentsAnimation(dt, this.elapsedSeconds, _playerWorldPos, hasMagnet);
    this.world.updateBackdrop(_playerWorldPos, this.playerYaw, this.currentBiome, dt);

    // Check collisions, coins, power-ups, and close calls
    this.processInteractions(dt, isBoosting, isInvincible, hasShield, totalMult);

    const stepped = this.character.update(dt, {
      distance: this.runDistance,
      speed,
      isJumping: this.isJumping,
      verticalVel: this.verticalVel,
      isSliding: this.isSliding,
      isDead: false,
      deathElapsed: 0,
      laneBank: this.laneBank,
      collectTimer: this.collectAnimTimer,
      hasShield,
      hasMagnet,
      isInvincible,
      isBoosting,
      groundY: 0,
      playerY: this.playerY,
    });
    if (stepped) {
      this.audio.playFootstep();
    }

    this.updateAtmosphere(dt);
    this.updateCamera(dt, isBoosting);
    this.updateSunShadowTarget();
    this.pushHud(false);
  }

  private stepTitleVista(dt: number): void {
    const speed = 8.5;
    this.localZ += speed * dt;
    this.runDistance += speed * dt;

    const currentSeg = this.world.segments[this.activeSegIdx];
    if (currentSeg && this.localZ >= currentSeg.pattern.length) {
      this.localZ -= currentSeg.pattern.length;
      this.activeSegIdx++;
    }
    while (this.activeSegIdx > 1) {
      this.world.removeSegment(this.world.segments[0]);
      this.activeSegIdx--;
    }
    while (this.world.segments.length - this.activeSegIdx < VISIBLE_SEGMENTS_AHEAD) {
      this.appendNextSegment(true);
    }

    this.syncCharacterWorldTransform();
    this.character.root.getWorldPosition(_playerWorldPos);
    this.world.updateSegmentsAnimation(dt, this.elapsedSeconds, _playerWorldPos, false);
    this.world.updateBackdrop(_playerWorldPos, this.playerYaw, this.currentBiome, dt);

    this.character.update(dt, {
      distance: this.runDistance,
      speed,
      isJumping: false,
      verticalVel: 0,
      isSliding: false,
      isDead: false,
      deathElapsed: 0,
      laneBank: 0,
      collectTimer: 0,
      hasShield: false,
      hasMagnet: false,
      isInvincible: false,
      isBoosting: false,
      groundY: 0,
      playerY: 0,
    });

    const sway = Math.sin(this.elapsedSeconds * 0.45) * 0.85;
    _camTargetPos.set(
      _playerWorldPos.x - 1.3 + sway,
      _playerWorldPos.y + 3.15,
      _playerWorldPos.z + 5.6
    );
    _camLookAt.set(_playerWorldPos.x + 0.7, _playerWorldPos.y + 1.35, _playerWorldPos.z - 8);
    this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(_camLookAt);
    this.updateSunShadowTarget();
  }

  private syncCharacterWorldTransform(): void {
    const seg = this.world.segments[this.activeSegIdx];
    if (!seg) return;
    this.playerYaw = seg.headingRad;
    this.character.root.position
      .copy(seg.origin)
      .addScaledVector(seg.forward, this.localZ)
      .addScaledVector(seg.right, this.localX);
    this.character.root.position.y = this.playerY;
    this.character.root.rotation.y = this.playerYaw;
  }

  private processInteractions(
    _dt: number,
    isBoosting: boolean,
    isInvincible: boolean,
    hasShield: boolean,
    totalMult: number
  ): void {
    const segsToCheck: ActiveSegment[] = [];
    if (this.world.segments[this.activeSegIdx]) {
      segsToCheck.push(this.world.segments[this.activeSegIdx]);
    }
    if (this.world.segments[this.activeSegIdx + 1]) {
      segsToCheck.push(this.world.segments[this.activeSegIdx + 1]);
    }

    for (const seg of segsToCheck) {
      // Coin collection & Combo Streak + Surge Charge
      for (const coin of seg.coins) {
        if (coin.collected) continue;
        coin.mesh.getWorldPosition(_coinWorldPos);
        const dx = _coinWorldPos.x - _playerWorldPos.x;
        const dy = _coinWorldPos.y - (_playerWorldPos.y + (this.isSliding ? 0.55 : 0.95));
        const dz = _coinWorldPos.z - _playerWorldPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < (coin.magnetized ? 2.2 : 1.45)) {
          coin.collected = true;
          coin.mesh.visible = false;
          const value = coin.spec.isGem ? 5 : 1;
          this.coinCombo += coin.spec.isGem ? 3 : 1;
          this.comboTimer = 2.6;
          this.maxCombo = Math.max(this.maxCombo, this.coinCombo);
          if (this.surgeTimer <= 0) {
            this.surgeCharge = Math.min(100, this.surgeCharge + (coin.spec.isGem ? 12 : 4));
          }
          const updatedMult =
            (this.powerUpTimers.multiplier > 0 ? 2 : 1) * computeComboMultiplier(this.coinCombo);
          this.runCoins += value;
          this.runScore += value * 25 * updatedMult;
          this.collectAnimTimer = 0.25;
          this.audio.playCoin(coin.spec.isGem);
          this.world.particles.emit(
            _coinWorldPos,
            coin.spec.isGem ? 10 : 5,
            coin.spec.isGem ? 0x38bdf8 : 0xffd95a,
            3.8,
            0.85,
            2.4
          );
        }
      }

      // Power-up collection
      for (const p of seg.powerUps) {
        if (p.collected) continue;
        p.mesh.getWorldPosition(_powerWorldPos);
        const dx = _powerWorldPos.x - _playerWorldPos.x;
        const dy = _powerWorldPos.y - (_playerWorldPos.y + 1.0);
        const dz = _powerWorldPos.z - _playerWorldPos.z;
        if (dx * dx + dy * dy + dz * dz < 1.85) {
          p.collected = true;
          p.mesh.visible = false;
          this.activatePowerUp(p.spec.type);
          this.world.particles.emit(
            _powerWorldPos,
            16,
            POWERUP_META[p.spec.type].hex,
            5.0,
            1.1,
            3.0
          );
        }
      }
    }

    // Obstacle collisions & Close-Call bonuses on active segment
    const activeSeg = this.world.segments[this.activeSegIdx];
    if (!activeSeg) return;

    const playerState = {
      lane: this.lane,
      x: this.localX,
      y: this.playerY,
      isJumping: this.isJumping,
      isSliding: this.isSliding,
      hasShield,
      isInvincible,
      isBoosting,
    };

    for (const obs of activeSeg.obstacles) {
      if (obs.smashed) continue;

      if (
        obs.spec.type === 'collapsing_tile' &&
        !obs.collapsingStarted &&
        this.localZ >= obs.spec.zOffset - 5.5
      ) {
        obs.collapsingStarted = true;
      }

      const result = evaluateObstacleHit(
        playerState,
        obs.spec,
        this.localZ,
        this.elapsedSeconds
      );

      if (result === 'none') {
        // Close-Call bonus when passing safely right beside, over, or under an obstacle
        if (!obs.nearMissAwarded && this.localZ > obs.spec.zOffset + 0.7 && this.localZ < obs.spec.zOffset + 2.0) {
          const obsX = obs.spec.fullWidth ? this.localX : LANE_POSITIONS[obs.spec.lane];
          const tightPass =
            obs.spec.fullWidth || Math.abs(this.localX - obsX) < 2.35;
          if (tightPass) {
            obs.nearMissAwarded = true;
            const bonus = 50 * totalMult;
            this.runCloseCalls++;
            this.runScore += bonus;
            if (this.surgeTimer <= 0) {
              this.surgeCharge = Math.min(100, this.surgeCharge + 15);
            }
            this.audio.playCloseCall();
            this.callbacks.onCloseCall(bonus);
          }
        }
        continue;
      }

      if (result === 'smash') {
        obs.smashed = true;
        obs.mesh.visible = false;
        this.hitstopTimer = 0.035;
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.45);
        this.audio.playSmash();
        obs.mesh.getWorldPosition(_coinWorldPos);
        this.world.particles.emit(_coinWorldPos, 18, 0xd8c9a8, 6.5, 1.35, 3.8);
        continue;
      }

      if (result === 'hit') {
        if (hasShield) {
          obs.smashed = true;
          obs.mesh.visible = false;
          this.consumeShield();
          continue;
        }
        this.triggerDeath(obs.spec.type === 'broken_bridge');
        return;
      }
    }
  }

  private activatePowerUp(type: PowerUpType): void {
    const duration = getPowerUpDuration(type, this.save);
    this.powerUpDurations[type] = duration;
    this.powerUpTimers[type] = duration;
    this.runPowerUps++;
    this.audio.playPowerUp(type);
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
    this.pushHud(true);
  }

  private consumeShield(): void {
    this.powerUpTimers.shield = 0;
    this.hitstopTimer = 0.05;
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.65);
    this.audio.playShieldBreak();
    this.world.particles.emit(_playerWorldPos, 22, 0x2fd69d, 6.2, 1.25, 3.2);
    this.pushHud(true);
  }

  private triggerDeath(fallIntoRavine: boolean): void {
    this.isDead = true;
    this.deathTimer = 0;
    if (fallIntoRavine) {
      this.verticalVel = -6.5;
    }
    this.hitstopTimer = 0.06;
    this.cameraTrauma = 1.0;
    this.audio.stopMusic();
    this.audio.playCollision();
    this.world.particles.emit(_playerWorldPos, 24, 0xf05a46, 6.0, 1.25, 3.5);
  }

  private updateAtmosphere(dt: number): void {
    const biome = BIOMES[this.currentBiome];
    const t = 1 - Math.exp(-1.5 * dt);
    _targetSkyColor.setHex(biome.skyBottom);
    _targetFogColor.setHex(biome.fogColor);
    _targetSunColor.setHex(biome.sunColor);

    (this.scene.background as THREE.Color).lerp(_targetSkyColor, t);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.lerp(_targetFogColor, t);
    fog.density = THREE.MathUtils.lerp(fog.density, biome.fogDensity, t);
    this.sunLight.color.lerp(_targetSunColor, t);
    this.sunLight.intensity = THREE.MathUtils.lerp(
      this.sunLight.intensity,
      biome.sunIntensity,
      t
    );
  }

  private updateCamera(dt: number, isBoosting = false): void {
    let diff = this.playerYaw - this.cameraYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.cameraYaw += diff * (1 - Math.exp(-9.5 * dt));

    const fwdX = -Math.sin(this.cameraYaw);
    const fwdZ = -Math.cos(this.cameraYaw);
    const rightX = Math.cos(this.cameraYaw);
    const rightZ = -Math.sin(this.cameraYaw);

    const distBack = isBoosting ? 6.1 : 5.3;
    const height = 3.25 + this.playerY * 0.45 - (this.isSliding ? 0.35 : 0);

    _camTargetPos.set(
      _playerWorldPos.x - fwdX * distBack + rightX * (this.localX * 0.14),
      height,
      _playerWorldPos.z - fwdZ * distBack + rightZ * (this.localX * 0.14)
    );

    const posDamp = 1 - Math.exp(-12 * dt);
    this.camera.position.lerp(_camTargetPos, posDamp);

    _camLookAt.set(
      _playerWorldPos.x + fwdX * 7.5,
      1.35 + this.playerY * 0.55,
      _playerWorldPos.z + fwdZ * 7.5
    );
    this.camera.lookAt(_camLookAt);

    if (this.cameraTrauma > 0.001) {
      const shake = this.cameraTrauma * this.cameraTrauma;
      this.camera.rotation.z += (Math.random() - 0.5) * 0.09 * shake;
      this.camera.rotation.x += (Math.random() - 0.5) * 0.06 * shake;
    }

    const targetFov = isBoosting ? 71 : 60;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(
        this.camera.fov,
        targetFov,
        1 - Math.exp(-8 * dt)
      );
      this.camera.updateProjectionMatrix();
    }
  }

  private updateSunShadowTarget(): void {
    this.sunLight.position.set(
      _playerWorldPos.x + 14,
      _playerWorldPos.y + 24,
      _playerWorldPos.z + 12
    );
    this.sunLight.target.position.copy(_playerWorldPos);
    this.sunLight.target.updateMatrixWorld();

    this.rimLight.position.set(
      _playerWorldPos.x - 12,
      _playerWorldPos.y + 10,
      _playerWorldPos.z - 14
    );
    this.rimLight.target.position.copy(_playerWorldPos);
    this.rimLight.target.updateMatrixWorld();
  }

  private pushHud(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastHudPushAt < 80) return;
    this.lastHudPushAt = now;

    const seg = this.world.segments[this.activeSegIdx];
    const showTurn =
      seg &&
      seg.pattern.turnDirection !== 'none' &&
      !seg.turnHandled &&
      this.localZ >= seg.pattern.length - 13
        ? seg.pattern.turnDirection
        : 'none';

    const activePowerUps: HudSnapshot['activePowerUps'] = [];
    for (const type of Object.keys(this.powerUpTimers) as PowerUpType[]) {
      const rem = this.powerUpTimers[type];
      if (rem > 0) {
        activePowerUps.push({
          type,
          remaining: rem,
          duration: this.powerUpDurations[type],
        });
      }
    }

    const comboMult = computeComboMultiplier(this.coinCombo);
    const totalMult = (this.powerUpTimers.multiplier > 0 ? 2 : 1) * comboMult;
    const isSpeedLines = this.powerUpTimers.boost > 0 || this.surgeTimer > 0;

    this.callbacks.onHudUpdate({
      score: Math.floor(this.runScore),
      distance: Math.floor(this.runDistance),
      coins: this.runCoins,
      multiplier: totalMult,
      combo: this.coinCombo,
      comboMult,
      surgeCharge: Math.floor(this.surgeCharge),
      surgeActive: this.surgeTimer > 0,
      isSpeedLines,
      biome: this.currentBiome,
      activePowerUps,
      turnHint: showTurn,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);

    const dom = this.renderer.domElement;
    dom.removeEventListener('touchstart', this.onTouchStart);
    dom.removeEventListener('touchmove', this.onTouchMove);
    dom.removeEventListener('touchend', this.onTouchEnd);
    dom.removeEventListener('mousedown', this.onMouseDown);

    this.world.dispose();
    this.character.dispose();
    this.textures.dispose();
    this.renderer.dispose();
    if (dom.parentElement === this.mountEl) {
      this.mountEl.removeChild(dom);
    }
  }
}
