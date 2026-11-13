import {
  ACHIEVEMENTS,
  BIOME_ORDER,
  BIOMES,
  CHARACTER_ORDER,
  CHARACTERS,
  MISSIONS,
  POWERUP_META,
  SHOP_UPGRADES,
} from '../game/constants';
import {
  ensureDailyMissions,
  formatDailyProgressValue,
  getTimeUntilDailyReset,
  type DailyMissionCompletionReward,
} from '../game/dailyMissions';
import {
  canAffordRevive,
  getReviveCost,
  getUpgradeCost,
  purchaseUpgrade,
  selectOrUnlockBiome,
  selectOrUnlockCharacter,
} from '../game/rules';
import type {HudSnapshot} from '../game/engine';
import type {LeaderboardEntry} from '../game/cloudMerge';
import type {
  BiomeId,
  CharacterId,
  GameState,
  PowerUpType,
  QualityLevel,
  RunStats,
  SaveData,
} from '../game/types';
import {createTitleLockupSvg, escapeHtml, svgCoin, svgIcon} from './icons';

export type SubModalType =
  | 'none'
  | 'characters'
  | 'shop'
  | 'missions'
  | 'leaderboard'
  | 'settings';

export interface CloudAccountState {
  signedIn: boolean;
  displayName: string | null;
  uid: string | null;
  syncStatus: 'offline' | 'syncing' | 'synced' | 'error';
  errorMessage: string | null;
  leaderboard: LeaderboardEntry[];
  leaderboardLoading: boolean;
  leaderboardError: string | null;
}

export interface HudActions {
  onStartGame: () => void;
  onPauseToggle: () => void;
  onResumeGame: () => void;
  onRestartGame: () => void;
  onReturnToTitle: () => void;
  onTriggerSurge: () => void;
  onReviveRun: () => void;
  onSaveChanged: (nextSave: SaveData) => void;
  onButtonClickSfx: () => void;
  onSignInGoogle: () => void;
  onSignOutGoogle: () => void;
  onRefreshLeaderboard: () => void;
}

export class TempleUI {
  private gameState: GameState = 'title';
  private activeModal: SubModalType = 'none';
  private save: SaveData;
  private cloudState: CloudAccountState = {
    signedIn: false,
    displayName: null,
    uid: null,
    syncStatus: 'offline',
    errorMessage: null,
    leaderboard: [],
    leaderboardLoading: false,
    leaderboardError: null,
  };
  private lastRunSummary: {
    stats: RunStats;
    revivesUsed: number;
    newMissions: string[];
    newDailyMissions: DailyMissionCompletionReward[];
    newAchievements: string[];
    newBiomes: BiomeId[];
  } | null = null;

  private readonly titleEl: HTMLElement;
  private readonly hudEl: HTMLElement;
  private readonly modalHostEl: HTMLElement;

  private readonly titleBestEl: HTMLElement;
  private readonly titleCoinsEl: HTMLElement;
  private readonly titleDailyCountEl: HTMLElement;
  private readonly cloudAccountSlotEl: HTMLElement;

  private readonly hudScoreEl: HTMLElement;
  private readonly hudDistanceEl: HTMLElement;
  private readonly hudMultiplierEl: HTMLElement;
  private readonly hudComboEl: HTMLElement;
  private readonly hudBiomeEl: HTMLElement;
  private readonly hudCoinsEl: HTMLElement;
  private readonly hudMuteBtn: HTMLButtonElement;
  private readonly hudPowerUpsEl: HTMLElement;
  private readonly surgeBtnEl: HTMLButtonElement;
  private readonly surgeLabelEl: HTMLElement;
  private readonly surgeFillEl: HTMLElement;
  private readonly closeCallToastEl: HTMLElement;
  private readonly speedLinesEl: HTMLElement;
  private readonly biomeBannerEl: HTMLElement;
  private readonly turnHintEl: HTMLElement;
  private biomeBannerTimer: number | null = null;
  private closeCallTimer: number | null = null;

  constructor(
    private readonly rootEl: HTMLElement,
    initialSave: SaveData,
    private readonly actions: HudActions
  ) {
    this.save = initialSave;

    this.rootEl.innerHTML = `
      <section class="title-screen" data-testid="title-screen">
        <div class="title-top-bar">
          <div class="currency-cluster">
            <div class="stat-chip">
              <span class="stat-chip-label">Best Score</span>
              <span class="stat-chip-value" data-ref="title-best">0</span>
            </div>
            <div class="stat-chip">
              ${svgCoin(20)}
              <span class="stat-chip-value" data-ref="title-coins">0</span>
            </div>
          </div>
          <div class="title-top-actions">
            <div class="cloud-account-slot" data-ref="cloud-account-slot"></div>
            <button type="button" class="hud-icon-btn" data-action="toggle-mute" aria-label="Toggle Sound">
              ${svgIcon('volume', 20)}
            </button>
          </div>
        </div>

        <div class="title-main-area">
          <div class="title-logo-wrap">${createTitleLockupSvg()}</div>
          <div class="title-cta-group">
            <button type="button" class="btn-temple-primary" data-start="true" data-action="play">
              ${svgIcon('play', 22)}
              <span>Run Now</span>
            </button>
            <div class="menu-secondary-grid">
              <button type="button" class="btn-temple-secondary" data-action="open-characters">
                ${svgIcon('character', 17)}
                <span>Heroes</span>
              </button>
              <button type="button" class="btn-temple-secondary" data-action="open-shop">
                ${svgIcon('shop', 17)}
                <span>Upgrades</span>
              </button>
              <button type="button" class="btn-temple-secondary" data-action="open-missions">
                ${svgIcon('mission', 17)}
                <span>Missions</span>
                <span class="daily-count-pill" data-ref="title-daily-count" data-testid="daily-badge">0/3</span>
              </button>
              <button type="button" class="btn-temple-secondary" data-action="open-settings">
                ${svgIcon('settings', 17)}
                <span>Settings</span>
              </button>
            </div>
            <button type="button" class="btn-temple-secondary leaderboard-cta-btn" data-action="open-leaderboard" data-testid="open-leaderboard-btn">
              ${svgIcon('trophy', 17)}
              <span>Global Leaderboard</span>
            </button>
          </div>
        </div>

        <div class="control-hint-line">
          ← → / A D Lane &amp; Turn · ↑ / Space Jump · ↓ / S Slide · E Relic Surge · Esc Pause
        </div>
      </section>

      <section class="hud-layer hidden" data-testid="gameplay-hud">
        <div class="speed-lines-overlay" data-ref="speed-lines"></div>
        <div class="hud-top-row">
          <div class="hud-score-cluster">
            <span class="hud-kicker" data-ref="hud-biome">Ancient Jungle Temple</span>
            <span class="hud-hero-num tabular" data-ref="hud-score" data-testid="hud-score">0</span>
            <div class="hud-sub-metrics tabular">
              <span data-ref="hud-distance">0 m</span>
              <span data-ref="hud-multiplier" class="hidden" style="color:#2fd69d">2X</span>
              <span data-ref="hud-combo" class="hidden" style="color:#ffd95a">STREAK 0</span>
            </div>
          </div>

          <div class="hud-right-cluster">
            <div class="hud-coin-box tabular">
              ${svgCoin(20)}
              <span data-ref="hud-coins">0</span>
            </div>
            <button type="button" class="hud-icon-btn" tabindex="-1" data-action="hud-mute" aria-label="Toggle Mute">
              ${svgIcon('volume', 20)}
            </button>
            <button type="button" class="hud-icon-btn" tabindex="-1" data-action="hud-pause" aria-label="Pause Game">
              ${svgIcon('pause', 20)}
            </button>
          </div>
        </div>

        <div class="biome-banner" data-ref="biome-banner"></div>
        <div class="turn-prompt-badge hidden" data-ref="turn-hint"></div>
        <div class="close-call-toast" data-ref="close-call-toast">CLOSE CALL +50</div>

        <div class="hud-bottom-row">
          <div class="hud-powerups" data-ref="hud-powerups"></div>
          <button type="button" class="surge-btn" tabindex="-1" data-action="trigger-surge" data-ref="surge-btn" aria-label="Activate Relic Surge">
            <div class="surge-btn-head">
              <span>${svgIcon('boost', 16)}</span>
              <span data-ref="surge-label">SURGE 0%</span>
            </div>
            <div class="surge-bar-track">
              <div class="surge-bar-fill" data-ref="surge-fill" style="transform:scaleX(0)"></div>
            </div>
          </button>
        </div>
      </section>

      <div class="modal-backdrop hidden" data-ref="modal-host"></div>
    `;

    this.titleEl = this.rootEl.querySelector('[data-testid="title-screen"]')!;
    this.hudEl = this.rootEl.querySelector('[data-testid="gameplay-hud"]')!;
    this.modalHostEl = this.rootEl.querySelector('[data-ref="modal-host"]')!;

    this.titleBestEl = this.rootEl.querySelector('[data-ref="title-best"]')!;
    this.titleCoinsEl = this.rootEl.querySelector('[data-ref="title-coins"]')!;
    this.titleDailyCountEl = this.rootEl.querySelector('[data-ref="title-daily-count"]')!;
    this.cloudAccountSlotEl = this.rootEl.querySelector('[data-ref="cloud-account-slot"]')!;

    this.hudScoreEl = this.rootEl.querySelector('[data-ref="hud-score"]')!;
    this.hudDistanceEl = this.rootEl.querySelector('[data-ref="hud-distance"]')!;
    this.hudMultiplierEl = this.rootEl.querySelector('[data-ref="hud-multiplier"]')!;
    this.hudComboEl = this.rootEl.querySelector('[data-ref="hud-combo"]')!;
    this.hudBiomeEl = this.rootEl.querySelector('[data-ref="hud-biome"]')!;
    this.hudCoinsEl = this.rootEl.querySelector('[data-ref="hud-coins"]')!;
    this.hudMuteBtn = this.rootEl.querySelector('[data-action="hud-mute"]')!;
    this.hudPowerUpsEl = this.rootEl.querySelector('[data-ref="hud-powerups"]')!;
    this.surgeBtnEl = this.rootEl.querySelector('[data-ref="surge-btn"]')!;
    this.surgeLabelEl = this.rootEl.querySelector('[data-ref="surge-label"]')!;
    this.surgeFillEl = this.rootEl.querySelector('[data-ref="surge-fill"]')!;
    this.closeCallToastEl = this.rootEl.querySelector('[data-ref="close-call-toast"]')!;
    this.speedLinesEl = this.rootEl.querySelector('[data-ref="speed-lines"]')!;
    this.biomeBannerEl = this.rootEl.querySelector('[data-ref="biome-banner"]')!;
    this.turnHintEl = this.rootEl.querySelector('[data-ref="turn-hint"]')!;

    this.bindRootEvents();
    this.refreshTitleStats();
    this.refreshCloudAccountSlot();
    this.syncMuteIcons();
  }

  private bindRootEvents(): void {
    this.rootEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!target) return;
      target.blur();
      this.actions.onButtonClickSfx();
      const action = target.dataset.action;

      switch (action) {
        case 'play':
          this.actions.onStartGame();
          break;
        case 'open-characters':
          this.openSubModal('characters');
          break;
        case 'open-shop':
          this.openSubModal('shop');
          break;
        case 'open-missions':
          this.openSubModal('missions');
          break;
        case 'open-leaderboard':
          this.openSubModal('leaderboard');
          break;
        case 'open-settings':
          this.openSubModal('settings');
          break;
        case 'google-signin':
          this.actions.onSignInGoogle();
          break;
        case 'google-signout':
          this.actions.onSignOutGoogle();
          break;
        case 'refresh-leaderboard':
          this.actions.onRefreshLeaderboard();
          break;
        case 'close-modal':
          this.openSubModal('none');
          break;
        case 'toggle-mute':
        case 'hud-mute':
          this.toggleMute();
          break;
        case 'hud-pause':
          this.actions.onPauseToggle();
          break;
        case 'trigger-surge':
          this.actions.onTriggerSurge();
          break;
        case 'revive':
          this.actions.onReviveRun();
          break;
        case 'resume':
          this.actions.onResumeGame();
          break;
        case 'restart':
          this.actions.onRestartGame();
          break;
        case 'main-menu':
          this.actions.onReturnToTitle();
          break;
        case 'select-char': {
          const charId = target.dataset.char as CharacterId;
          const next = selectOrUnlockCharacter(this.save, charId);
          if (next) {
            this.save = next;
            this.actions.onSaveChanged(next);
            this.refreshTitleStats();
            this.renderModal();
          }
          break;
        }
        case 'buy-upgrade': {
          const upgId = target.dataset.upgrade as PowerUpType;
          const next = purchaseUpgrade(this.save, upgId);
          if (next) {
            this.save = next;
            this.actions.onSaveChanged(next);
            this.refreshTitleStats();
            this.renderModal();
          }
          break;
        }
        case 'select-biome': {
          const biomeId = target.dataset.biome as BiomeId;
          const next = selectOrUnlockBiome(this.save, biomeId);
          if (next) {
            this.save = next;
            this.actions.onSaveChanged(next);
            this.refreshTitleStats();
            this.renderModal();
          }
          break;
        }
        case 'set-quality': {
          const q = target.dataset.quality as QualityLevel;
          const next: SaveData = {
            ...this.save,
            settings: {...this.save.settings, quality: q},
          };
          this.save = next;
          this.actions.onSaveChanged(next);
          this.renderModal();
          break;
        }
      }
    });

    this.rootEl.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.setting === 'music') {
        const next: SaveData = {
          ...this.save,
          settings: {...this.save.settings, musicVolume: Number(input.value)},
        };
        this.save = next;
        this.actions.onSaveChanged(next);
      } else if (input.dataset.setting === 'sfx') {
        const next: SaveData = {
          ...this.save,
          settings: {...this.save.settings, sfxVolume: Number(input.value)},
        };
        this.save = next;
        this.actions.onSaveChanged(next);
      }
    });
  }

  public toggleMute(): void {
    const next: SaveData = {
      ...this.save,
      settings: {...this.save.settings, muted: !this.save.settings.muted},
    };
    this.save = next;
    this.actions.onSaveChanged(next);
    this.syncMuteIcons();
    if (this.activeModal === 'settings') this.renderModal();
  }

  private syncMuteIcons(): void {
    const icon = this.save.settings.muted ? svgIcon('mute', 20) : svgIcon('volume', 20);
    const titleMute = this.rootEl.querySelector('[data-action="toggle-mute"]');
    if (titleMute) titleMute.innerHTML = icon;
    this.hudMuteBtn.innerHTML = icon;
  }

  public syncSave(save: SaveData): void {
    this.save = save;
    this.refreshTitleStats();
    this.syncMuteIcons();
  }

  public setCloudState(next: CloudAccountState): void {
    this.cloudState = next;
    this.refreshCloudAccountSlot();
    if (this.activeModal === 'leaderboard' || this.activeModal === 'settings') {
      this.renderModal();
    }
  }

  private refreshCloudAccountSlot(): void {
    if (!this.cloudState.signedIn) {
      this.cloudAccountSlotEl.innerHTML = `
        <button type="button" class="btn-temple-secondary cloud-signin-btn" data-action="google-signin" data-testid="auth-signin-btn">
          ${svgIcon('cloud', 16)}
          <span>Sign In</span>
        </button>
      `;
      return;
    }

    const name = escapeHtml(this.cloudState.displayName || 'Explorer');
    const statusText =
      this.cloudState.syncStatus === 'syncing'
        ? 'Syncing…'
        : this.cloudState.syncStatus === 'error'
          ? 'Sync Error'
          : 'Cloud Synced';
    const statusColor =
      this.cloudState.syncStatus === 'error'
        ? '#f05a46'
        : this.cloudState.syncStatus === 'syncing'
          ? '#ffd95a'
          : '#2fd69d';

    this.cloudAccountSlotEl.innerHTML = `
      <div class="account-chip" data-testid="account-chip">
        <span style="color:${statusColor}; display:flex">${svgIcon('cloud', 16)}</span>
        <div class="account-chip-meta">
          <span class="account-name">${name}</span>
          <span class="account-sync-status" style="color:${statusColor}">${statusText}</span>
        </div>
        <button type="button" class="account-signout-btn" data-action="google-signout" aria-label="Sign Out">
          Sign Out
        </button>
      </div>
    `;
  }

  public setState(state: GameState): void {
    this.gameState = state;
    document.body.dataset.state = state;

    this.titleEl.classList.toggle('hidden', state !== 'title');
    this.hudEl.classList.toggle('hidden', state !== 'playing');

    if (state === 'playing') {
      this.activeModal = 'none';
      this.turnHintEl.classList.add('hidden');
      this.modalHostEl.classList.add('hidden');
    } else if (state === 'paused' || state === 'gameover') {
      this.activeModal = 'none';
      this.speedLinesEl.classList.remove('active');
      this.renderModal();
    } else if (state === 'title') {
      this.speedLinesEl.classList.remove('active');
      this.refreshTitleStats();
      this.renderModal();
    }
  }

  public openSubModal(modal: SubModalType): void {
    if (modal === 'missions') {
      const updated = ensureDailyMissions(this.save);
      if (updated !== this.save) {
        this.save = updated;
        this.actions.onSaveChanged(updated);
        this.refreshTitleStats();
      }
    }
    this.activeModal = modal;
    if (modal === 'leaderboard' && this.cloudState.signedIn) {
      this.actions.onRefreshLeaderboard();
    }
    this.renderModal();
  }

  public getActiveSubModal(): SubModalType {
    return this.activeModal;
  }

  public setGameOverSummary(
    stats: RunStats,
    revivesUsed: number,
    newMissions: string[],
    newDailyMissions: DailyMissionCompletionReward[],
    newAchievements: string[],
    newBiomes: BiomeId[]
  ): void {
    this.lastRunSummary = {
      stats,
      revivesUsed,
      newMissions,
      newDailyMissions,
      newAchievements,
      newBiomes,
    };
  }

  public showBiomeBanner(biomeId: BiomeId): void {
    const biome = BIOMES[biomeId];
    this.biomeBannerEl.textContent = `${biome.name} — ${biome.subtitle}`;
    this.biomeBannerEl.classList.add('visible');
    if (this.biomeBannerTimer !== null) {
      window.clearTimeout(this.biomeBannerTimer);
    }
    this.biomeBannerTimer = window.setTimeout(() => {
      this.biomeBannerEl.classList.remove('visible');
    }, 2600);
  }

  public showCloseCallToast(bonusPoints: number): void {
    this.closeCallToastEl.textContent = `CLOSE CALL +${bonusPoints}`;
    this.closeCallToastEl.classList.add('visible');
    if (this.closeCallTimer !== null) {
      window.clearTimeout(this.closeCallTimer);
    }
    this.closeCallTimer = window.setTimeout(() => {
      this.closeCallToastEl.classList.remove('visible');
    }, 1150);
  }

  public updateHud(snapshot: HudSnapshot): void {
    this.hudScoreEl.textContent = snapshot.score.toLocaleString();
    this.hudDistanceEl.textContent = `${snapshot.distance} m`;
    this.hudCoinsEl.textContent = snapshot.coins.toString();
    this.hudBiomeEl.textContent = BIOMES[snapshot.biome].name;

    this.hudMultiplierEl.textContent = `${snapshot.multiplier}X`;
    this.hudMultiplierEl.classList.toggle('hidden', snapshot.multiplier <= 1);

    this.hudComboEl.textContent = `STREAK ${snapshot.combo}`;
    this.hudComboEl.classList.toggle('hidden', snapshot.combo < 3);

    this.speedLinesEl.classList.toggle('active', snapshot.isSpeedLines);

    const surgeRatio = Math.max(0, Math.min(1, snapshot.surgeCharge / 100));
    this.surgeFillEl.style.transform = `scaleX(${snapshot.surgeActive ? 1 : surgeRatio})`;
    this.surgeBtnEl.classList.toggle('ready', snapshot.surgeCharge >= 100 && !snapshot.surgeActive);
    this.surgeBtnEl.classList.toggle('surging', snapshot.surgeActive);
    this.surgeLabelEl.textContent = snapshot.surgeActive
      ? 'SURGING!'
      : snapshot.surgeCharge >= 100
        ? 'SURGE [E]'
        : `SURGE ${snapshot.surgeCharge}%`;

    if (snapshot.turnHint === 'none') {
      this.turnHintEl.classList.add('hidden');
    } else {
      this.turnHintEl.textContent =
        snapshot.turnHint === 'left' ? '← TURN LEFT' : 'TURN RIGHT →';
      this.turnHintEl.classList.remove('hidden');
    }

    if (snapshot.activePowerUps.length === 0) {
      if (this.hudPowerUpsEl.childElementCount > 0) {
        this.hudPowerUpsEl.innerHTML = '';
      }
      return;
    }

    this.hudPowerUpsEl.innerHTML = snapshot.activePowerUps
      .map((p) => {
        const meta = POWERUP_META[p.type];
        const ratio = Math.max(0, Math.min(1, p.remaining / Math.max(1, p.duration)));
        return `
          <div class="powerup-pill" style="border-color: ${meta.color}">
            <span style="color:${meta.color}; display:flex">${svgIcon(p.type, 18)}</span>
            <div class="powerup-pill-info">
              <div class="powerup-pill-head">
                <span>${meta.label}</span>
                <span class="tabular">${p.remaining.toFixed(1)}s</span>
              </div>
              <div class="powerup-bar-track">
                <div class="powerup-bar-fill" style="background:${meta.color}; transform:scaleX(${ratio})"></div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private refreshTitleStats(): void {
    this.titleBestEl.textContent = this.save.highScore.toLocaleString();
    this.titleCoinsEl.textContent = this.save.coins.toLocaleString();
    const dailyList = this.save.dailyMissions?.missions ?? [];
    const dailyDone = dailyList.filter((m) => m.completed).length;
    this.titleDailyCountEl.textContent = `${dailyDone}/${dailyList.length || 3}`;
    this.titleDailyCountEl.classList.toggle(
      'complete',
      dailyList.length > 0 && dailyDone === dailyList.length
    );
  }

  private renderModal(): void {
    if (this.gameState === 'paused' && this.activeModal === 'none') {
      this.modalHostEl.classList.remove('hidden');
      this.modalHostEl.innerHTML = `
        <div class="temple-modal" role="dialog" aria-label="Game Paused">
          <div class="modal-header">
            <h2 class="modal-title">Expedition Paused</h2>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-temple-primary" data-action="resume">
              ${svgIcon('play', 20)}
              <span>Resume Run</span>
            </button>
            <button type="button" class="btn-temple-secondary" data-action="restart">Restart Run</button>
            <button type="button" class="btn-temple-secondary" data-action="open-settings">Settings</button>
            <button type="button" class="btn-temple-secondary" data-action="main-menu">Main Menu</button>
          </div>
        </div>
      `;
      return;
    }

    if (this.gameState === 'gameover' && this.lastRunSummary) {
      const {stats, revivesUsed, newMissions, newDailyMissions, newAchievements, newBiomes} =
        this.lastRunSummary;
      const reviveCost = getReviveCost(revivesUsed);
      const affordRevive = canAffordRevive(this.save.coins, revivesUsed);

      const totalUnlocks =
        newMissions.length +
        newDailyMissions.length +
        newAchievements.length +
        newBiomes.length;
      const unlocksHtml =
        totalUnlocks > 0
          ? `<div class="stat-tile" style="border-color:#2fd69d">
              <span class="stat-tile-label" style="color:#2fd69d">New Unlocks &amp; Bonus Rewards</span>
              <div class="catalog-desc" style="color:#f8f2e2">
                ${[
                  ...newDailyMissions.map(
                    (d) => `Daily: ${d.title} (+${d.rewardCoins} Coins)`
                  ),
                  ...newMissions.map((m) => `Mission: ${m}`),
                  ...newAchievements.map((a) => `Achievement: ${a}`),
                  ...newBiomes.map((b) => `Biome: ${BIOMES[b].name}`),
                ].join(' · ')}
              </div>
            </div>`
          : '';

      const dailyList = this.save.dailyMissions?.missions ?? [];
      const dailySummaryHtml =
        dailyList.length > 0
          ? `<div class="daily-gameover-strip" data-testid="gameover-daily-strip">
              <div class="daily-section-head">
                <span class="stat-chip-label" style="color:#ffd95a">Daily Challenges</span>
                <span class="stat-chip-label">${dailyList.filter((m) => m.completed).length}/3 Done</span>
              </div>
              <div class="daily-mini-grid">
                ${dailyList
                  .map((m) => {
                    const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100));
                    return `
                      <div class="daily-mini-item ${m.completed ? 'done' : ''}">
                        <div class="daily-mini-top">
                          <span>${m.title}</span>
                          <span class="tabular" style="color:${m.completed ? '#2fd69d' : '#ffd95a'}">
                            ${m.completed ? `+${m.rewardCoins}` : `${formatDailyProgressValue(m.metric, m.progress)}/${formatDailyProgressValue(m.metric, m.target)}`}
                          </span>
                        </div>
                        <div class="daily-progress-track">
                          <div class="daily-progress-fill" style="transform:scaleX(${pct / 100})"></div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>`
          : '';

      this.modalHostEl.classList.remove('hidden');
      this.modalHostEl.innerHTML = `
        <div class="temple-modal" role="dialog" aria-label="Game Over">
          <div class="modal-header">
            <h2 class="modal-title">Run Ended</h2>
            <span class="stat-chip-label">${BIOMES[stats.currentBiome].name}</span>
          </div>
          <div class="stats-grid">
            <div class="stat-tile">
              <span class="stat-tile-label">Final Score</span>
              <span class="stat-tile-val" data-testid="gameover-score">${stats.score.toLocaleString()}</span>
            </div>
            <div class="stat-tile">
              <span class="stat-tile-label">Best Score</span>
              <span class="stat-tile-val" style="color:#ffd95a">${this.save.highScore.toLocaleString()}</span>
            </div>
            <div class="stat-tile">
              <span class="stat-tile-label">Distance</span>
              <span class="stat-tile-val">${stats.distance} m</span>
            </div>
            <div class="stat-tile">
              <span class="stat-tile-label">Coins Collected</span>
              <span class="stat-tile-val" style="color:#ffd95a">${stats.coins}</span>
            </div>
            <div class="stat-tile">
              <span class="stat-tile-label">Max Streak</span>
              <span class="stat-tile-val" style="color:#2fd69d">${stats.maxCombo}</span>
            </div>
            <div class="stat-tile">
              <span class="stat-tile-label">Close Calls</span>
              <span class="stat-tile-val">${stats.closeCalls}</span>
            </div>
          </div>
          ${unlocksHtml}
          ${dailySummaryHtml}
          <div class="modal-actions">
            <button type="button" class="btn-temple-secondary" data-action="revive" ${affordRevive ? '' : 'disabled'} style="border-color:#2fd69d; color:#2fd69d">
              ${svgIcon('shield', 18)}
              <span>Revive Now · ${reviveCost} Coins (Have ${this.save.coins})</span>
            </button>
            <button type="button" class="btn-temple-primary" data-start="true" data-action="restart">
              ${svgIcon('play', 20)}
              <span>Run Again</span>
            </button>
            <button type="button" class="btn-temple-secondary" data-action="main-menu">Main Menu</button>
          </div>
        </div>
      `;
      return;
    }

    if (this.activeModal === 'none') {
      this.modalHostEl.classList.add('hidden');
      this.modalHostEl.innerHTML = '';
      return;
    }

    this.modalHostEl.classList.remove('hidden');

    if (this.activeModal === 'characters') {
      const items = CHARACTER_ORDER.map((id) => {
        const c = CHARACTERS[id];
        const owned = this.save.unlockedCharacters.includes(id);
        const selected = this.save.selectedCharacter === id;
        const canAfford = this.save.coins >= c.cost;
        const btnLabel = selected ? 'Selected' : owned ? 'Select' : `Unlock · ${c.cost}`;
        const disabled = selected || (!owned && !canAfford);
        return `
          <div class="catalog-card ${selected ? 'active' : ''}">
            <div class="catalog-meta">
              <span class="catalog-name">${c.name}</span>
              <span class="catalog-desc">${c.title}</span>
            </div>
            <button type="button" class="btn-temple-secondary" data-action="select-char" data-char="${id}" ${disabled ? 'disabled' : ''}>
              ${btnLabel}
            </button>
          </div>
        `;
      }).join('');

      this.modalHostEl.innerHTML = this.wrapModal(`Heroes · ${this.save.coins} Coins`, `<div class="catalog-list">${items}</div>`);
      return;
    }

    if (this.activeModal === 'shop') {
      const items = SHOP_UPGRADES.map((u) => {
        const level = this.save.upgradeLevels[u.id] ?? 1;
        const isMax = level >= u.maxLevel;
        const cost = getUpgradeCost(u.id, level);
        const canAfford = this.save.coins >= cost;
        const duration = (u.baseDuration + (level - 1) * u.durationPerLevel).toFixed(1);
        return `
          <div class="catalog-card">
            <div class="catalog-meta">
              <span class="catalog-name">${u.name} (Lv ${level}/${u.maxLevel})</span>
              <span class="catalog-desc">${u.description} Current: ${duration}s</span>
            </div>
            <button type="button" class="btn-temple-secondary" data-action="buy-upgrade" data-upgrade="${u.id}" ${isMax || !canAfford ? 'disabled' : ''}>
              ${isMax ? 'Maxed' : `Upgrade · ${cost}`}
            </button>
          </div>
        `;
      }).join('');

      this.modalHostEl.innerHTML = this.wrapModal(`Temple Shop · ${this.save.coins} Coins`, `<div class="catalog-list">${items}</div>`);
      return;
    }

    if (this.activeModal === 'missions') {
      const dailyList = this.save.dailyMissions?.missions ?? [];
      const dailyDone = dailyList.filter((m) => m.completed).length;
      const resetIn = getTimeUntilDailyReset();

      const dailyItems = dailyList
        .map((m) => {
          const pct = Math.min(100, Math.round((m.progress / Math.max(1, m.target)) * 100));
          const progressText = `${formatDailyProgressValue(m.metric, m.progress)} / ${formatDailyProgressValue(m.metric, m.target)}`;
          return `
            <div class="catalog-card daily-card ${m.completed ? 'active' : ''}" data-testid="daily-mission-card">
              <div class="catalog-meta" style="flex:1">
                <div class="daily-card-top">
                  <span class="catalog-name">${m.title}</span>
                  <span class="stat-chip-label" style="color:${m.completed ? '#2fd69d' : '#ffd95a'}">
                    ${m.completed ? `Completed · +${m.rewardCoins}` : `+${m.rewardCoins} Coins`}
                  </span>
                </div>
                <span class="catalog-desc">${m.description}</span>
                <div class="daily-progress-row">
                  <div class="daily-progress-track">
                    <div class="daily-progress-fill" style="transform:scaleX(${pct / 100})"></div>
                  </div>
                  <span class="daily-progress-text tabular">${progressText}</span>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      const missionItems = MISSIONS.map((m) => {
        const done = this.save.completedMissions.includes(m.id);
        return `
          <div class="catalog-card ${done ? 'active' : ''}">
            <div class="catalog-meta">
              <span class="catalog-name">${m.title}</span>
              <span class="catalog-desc">${m.description}</span>
            </div>
            <span class="stat-chip-label" style="color:${done ? '#2fd69d' : '#ffd95a'}">
              ${done ? 'Completed' : `+${m.rewardCoins} Coins`}
            </span>
          </div>
        `;
      }).join('');

      const achItems = ACHIEVEMENTS.map((a) => {
        const done = this.save.unlockedAchievements.includes(a.id);
        return `
          <div class="catalog-card ${done ? 'active' : ''}">
            <div class="catalog-meta">
              <span class="catalog-name">${a.title}</span>
              <span class="catalog-desc">${a.description}</span>
            </div>
            <span class="stat-chip-label" style="color:${done ? '#2fd69d' : '#ffd95a'}">
              ${done ? 'Unlocked' : `+${a.rewardCoins} Coins`}
            </span>
          </div>
        `;
      }).join('');

      this.modalHostEl.innerHTML = this.wrapModal(
        'Daily & Career Missions',
        `
          <div class="catalog-list">
            <div class="daily-section-head">
              <span class="stat-chip-label" style="color:#ffd95a">Daily Challenges (${dailyDone}/3)</span>
              <span class="stat-chip-label">Resets in ${resetIn}</span>
            </div>
            ${dailyItems}
            <div class="stat-chip-label" style="margin-top:8px">Expedition Milestones</div>
            ${missionItems}
            <div class="stat-chip-label" style="margin-top:8px">Achievements</div>
            ${achItems}
          </div>
        `
      );
      return;
    }

    if (this.activeModal === 'leaderboard') {
      const personalHero = CHARACTERS[this.save.selectedCharacter]?.name ?? 'Aurelia Vance';
      const personalSummary = `
        <div class="stat-tile" style="border-color:rgba(255,217,90,0.5)">
          <span class="stat-chip-label" style="color:#ffd95a">Your Personal Record</span>
          <div class="leaderboard-personal-row">
            <span class="catalog-name tabular">${this.save.highScore.toLocaleString()} pts</span>
            <span class="catalog-desc tabular">${this.save.bestDistance.toLocaleString()} m · ${escapeHtml(personalHero)}</span>
          </div>
        </div>
      `;

      let boardBody = '';
      if (!this.cloudState.signedIn) {
        boardBody = `
          <div class="catalog-card" data-testid="leaderboard-signin-prompt">
            <div class="catalog-meta">
              <span class="catalog-name">Cloud Sync &amp; Global Rankings</span>
              <span class="catalog-desc">Sign in with Google to save your progress in the cloud and post scores to the Global Hall of Explorers.</span>
            </div>
            <button type="button" class="btn-temple-secondary" data-action="google-signin">
              ${svgIcon('cloud', 16)}
              <span>Sign In</span>
            </button>
          </div>
        `;
      } else if (this.cloudState.leaderboardLoading) {
        boardBody = `
          <div class="catalog-card">
            <span class="catalog-desc">Loading Global Hall of Explorers…</span>
          </div>
        `;
      } else if (this.cloudState.leaderboardError) {
        boardBody = `
          <div class="catalog-card" style="border-color:#f05a46">
            <div class="catalog-meta">
              <span class="catalog-name" style="color:#f05a46">Could not load rankings</span>
              <span class="catalog-desc">${escapeHtml(this.cloudState.leaderboardError)}</span>
            </div>
            <button type="button" class="btn-temple-secondary" data-action="refresh-leaderboard">Retry</button>
          </div>
        `;
      } else if (this.cloudState.leaderboard.length === 0) {
        boardBody = `
          <div class="catalog-card">
            <div class="catalog-meta">
              <span class="catalog-name">No scores recorded yet</span>
              <span class="catalog-desc">Complete an expedition while signed in to claim Rank #1!</span>
            </div>
            <button type="button" class="btn-temple-secondary" data-action="refresh-leaderboard">Refresh</button>
          </div>
        `;
      } else {
        const rowsHtml = this.cloudState.leaderboard
          .map((entry, idx) => {
            const isSelf = entry.uid === this.cloudState.uid;
            const heroName = CHARACTERS[entry.selectedCharacter]?.name ?? 'Aurelia Vance';
            return `
              <div class="catalog-card leaderboard-row ${isSelf ? 'active' : ''}">
                <div class="leaderboard-rank tabular">#${idx + 1}</div>
                <div class="catalog-meta" style="flex:1">
                  <span class="catalog-name">${escapeHtml(entry.displayName)}${isSelf ? ' (You)' : ''}</span>
                  <span class="catalog-desc">${escapeHtml(heroName)} · ${entry.bestDistance.toLocaleString()} m</span>
                </div>
                <span class="stat-chip-value tabular" style="font-size:16px">${entry.highScore.toLocaleString()}</span>
              </div>
            `;
          })
          .join('');
        boardBody = `
          <div class="daily-section-head">
            <span class="stat-chip-label" style="color:#ffd95a">Top Explorers</span>
            <button type="button" class="account-signout-btn" data-action="refresh-leaderboard">Refresh</button>
          </div>
          ${rowsHtml}
        `;
      }

      this.modalHostEl.innerHTML = this.wrapModal(
        'Hall of Explorers',
        `<div class="catalog-list">${personalSummary}${boardBody}</div>`
      );
      return;
    }

    if (this.activeModal === 'settings') {
      const q = this.save.settings.quality;
      const cloudStatusCopy = this.cloudState.signedIn
        ? `Signed in as ${escapeHtml(this.cloudState.displayName || 'Explorer')} (${this.cloudState.syncStatus})`
        : 'Playing locally (guest mode). Sign in to sync progress across devices.';
      const cloudRow = `
        <div class="settings-row">
          <div class="catalog-meta">
            <span class="catalog-name">Cloud Save (Firebase)</span>
            <span class="catalog-desc">${cloudStatusCopy}${this.cloudState.errorMessage ? ` · ${escapeHtml(this.cloudState.errorMessage)}` : ''}</span>
          </div>
          ${
            this.cloudState.signedIn
              ? `<button type="button" class="btn-temple-secondary" data-action="google-signout">Sign Out</button>`
              : `<button type="button" class="btn-temple-secondary" data-action="google-signin">${svgIcon('cloud', 16)}<span>Sign In</span></button>`
          }
        </div>
      `;

      const biomeButtons = BIOME_ORDER.map((bId) => {
        const b = BIOMES[bId];
        const unlocked = this.save.unlockedBiomes.includes(bId);
        const selected = this.save.selectedStartBiome === bId;
        const canAfford = this.save.coins >= b.unlockCost;
        const label = selected ? 'Active' : unlocked ? 'Select' : `Unlock · ${b.unlockCost}`;
        return `
          <div class="catalog-card ${selected ? 'active' : ''}">
            <div class="catalog-meta">
              <span class="catalog-name">${b.name}</span>
              <span class="catalog-desc">${b.subtitle}${!unlocked ? ` · Auto-unlocks at ${b.unlockDistance}m` : ''}</span>
            </div>
            <button type="button" class="btn-temple-secondary" data-action="select-biome" data-biome="${bId}" ${selected || (!unlocked && !canAfford) ? 'disabled' : ''}>
              ${label}
            </button>
          </div>
        `;
      }).join('');

      this.modalHostEl.innerHTML = this.wrapModal(
        'Settings & Biomes',
        `
          <div class="catalog-list">
            ${cloudRow}
            <div class="settings-row">
              <span class="catalog-name">Graphics Quality</span>
              <div class="segmented-group">
                ${(['low', 'medium', 'high'] as QualityLevel[])
                  .map(
                    (level) =>
                      `<button type="button" class="seg-btn ${q === level ? 'selected' : ''}" data-action="set-quality" data-quality="${level}">${level.toUpperCase()}</button>`
                  )
                  .join('')}
              </div>
            </div>
            <div class="settings-row">
              <span class="catalog-name">Music Volume</span>
              <input class="temple-range" type="range" min="0" max="1" step="0.05" value="${this.save.settings.musicVolume}" data-setting="music" aria-label="Music Volume" />
            </div>
            <div class="settings-row">
              <span class="catalog-name">SFX Volume</span>
              <input class="temple-range" type="range" min="0" max="1" step="0.05" value="${this.save.settings.sfxVolume}" data-setting="sfx" aria-label="SFX Volume" />
            </div>
            <div class="settings-row">
              <span class="catalog-name">Audio Mute</span>
              <button type="button" class="btn-temple-secondary" data-action="toggle-mute">
                ${this.save.settings.muted ? 'Unmute' : 'Mute'}
              </button>
            </div>
            <div class="stat-chip-label" style="margin-top:6px">Starting Biome</div>
            ${biomeButtons}
          </div>
        `
      );
    }
  }

  private wrapModal(title: string, bodyHtml: string): string {
    return `
      <div class="temple-modal" role="dialog" aria-label="${title}">
        <div class="modal-header">
          <h2 class="modal-title">${title}</h2>
          <button type="button" class="hud-icon-btn" data-action="close-modal" aria-label="Close Dialog">
            ${svgIcon('close', 18)}
          </button>
        </div>
        ${bodyHtml}
      </div>
    `;
  }
}
