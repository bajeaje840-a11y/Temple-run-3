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
  canAffordRevive,
  getReviveCost,
  getUpgradeCost,
  purchaseUpgrade,
  selectOrUnlockBiome,
  selectOrUnlockCharacter,
} from '../game/rules';
import type {HudSnapshot} from '../game/engine';
import type {
  BiomeId,
  CharacterId,
  GameState,
  PowerUpType,
  QualityLevel,
  RunStats,
  SaveData,
} from '../game/types';
import {createTitleLockupSvg, svgCoin, svgIcon} from './icons';

export type SubModalType = 'none' | 'characters' | 'shop' | 'missions' | 'settings';

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
}

export class TempleUI {
  private gameState: GameState = 'title';
  private activeModal: SubModalType = 'none';
  private save: SaveData;
  private lastRunSummary: {
    stats: RunStats;
    revivesUsed: number;
    newMissions: string[];
    newAchievements: string[];
    newBiomes: BiomeId[];
  } | null = null;

  private readonly titleEl: HTMLElement;
  private readonly hudEl: HTMLElement;
  private readonly modalHostEl: HTMLElement;

  private readonly titleBestEl: HTMLElement;
  private readonly titleCoinsEl: HTMLElement;

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
          <button type="button" class="hud-icon-btn" data-action="toggle-mute" aria-label="Toggle Sound">
            ${svgIcon('volume', 20)}
          </button>
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
              </button>
              <button type="button" class="btn-temple-secondary" data-action="open-settings">
                ${svgIcon('settings', 17)}
                <span>Settings</span>
              </button>
            </div>
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
        case 'open-settings':
          this.openSubModal('settings');
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
    this.activeModal = modal;
    this.renderModal();
  }

  public getActiveSubModal(): SubModalType {
    return this.activeModal;
  }

  public setGameOverSummary(
    stats: RunStats,
    revivesUsed: number,
    newMissions: string[],
    newAchievements: string[],
    newBiomes: BiomeId[]
  ): void {
    this.lastRunSummary = {stats, revivesUsed, newMissions, newAchievements, newBiomes};
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
      const {stats, revivesUsed, newMissions, newAchievements, newBiomes} = this.lastRunSummary;
      const reviveCost = getReviveCost(revivesUsed);
      const affordRevive = canAffordRevive(this.save.coins, revivesUsed);

      const unlocksHtml =
        newMissions.length + newAchievements.length + newBiomes.length > 0
          ? `<div class="stat-tile" style="border-color:#2fd69d">
              <span class="stat-tile-label" style="color:#2fd69d">New Unlocks &amp; Rewards</span>
              <div class="catalog-desc" style="color:#f8f2e2">
                ${[
                  ...newMissions.map((m) => `Mission: ${m}`),
                  ...newAchievements.map((a) => `Achievement: ${a}`),
                  ...newBiomes.map((b) => `Biome: ${BIOMES[b].name}`),
                ].join(' · ')}
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
        'Missions & Achievements',
        `<div class="catalog-list">${missionItems}${achItems}</div>`
      );
      return;
    }

    if (this.activeModal === 'settings') {
      const q = this.save.settings.quality;
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
