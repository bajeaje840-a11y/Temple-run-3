import {TempleAudio} from './game/audio';
import {TempleRunEngine} from './game/engine';
import {applyRunToSave, canAffordRevive, getReviveCost} from './game/rules';
import {loadSaveData, persistSaveData} from './game/storage';
import type {GameState, RunStats, SaveData} from './game/types';
import {TempleUI} from './ui/hud';

function bootstrap(): void {
  const mountEl = document.getElementById('game-canvas-mount');
  const uiRootEl = document.getElementById('ui-root');
  if (!mountEl || !uiRootEl) return;

  let saveData: SaveData = loadSaveData();
  let currentState: GameState = 'title';
  let lastCommittedRunStats: RunStats | null = null;

  const audio = new TempleAudio();
  audio.applySettings(
    saveData.settings.musicVolume,
    saveData.settings.sfxVolume,
    saveData.settings.muted
  );

  let engine: TempleRunEngine;
  let ui: TempleUI;

  const setState = (next: GameState) => {
    currentState = next;
    engine.setState(next);
    ui.setState(next);
  };

  const startRun = () => {
    audio.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    lastCommittedRunStats = null;
    currentState = 'playing';
    ui.setState('playing');
    engine.startNewRun();
  };

  ui = new TempleUI(uiRootEl, saveData, {
    onStartGame: startRun,
    onPauseToggle: () => {
      if (currentState === 'playing') {
        setState('paused');
      } else if (currentState === 'paused') {
        if (ui.getActiveSubModal() !== 'none') {
          ui.openSubModal('none');
        } else {
          setState('playing');
        }
      }
    },
    onResumeGame: () => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setState('playing');
    },
    onRestartGame: startRun,
    onReturnToTitle: () => {
      lastCommittedRunStats = null;
      setState('title');
    },
    onTriggerSurge: () => {
      audio.unlock();
      engine.triggerRelicSurge();
    },
    onReviveRun: () => {
      const used = engine.getRevivesUsed();
      const cost = getReviveCost(used);
      if (!canAffordRevive(saveData.coins, used)) return;
      audio.unlock();
      saveData = {...saveData, coins: saveData.coins - cost};
      persistSaveData(saveData);
      engine.syncSaveData(saveData);
      ui.syncSave(saveData);
      currentState = 'playing';
      ui.setState('playing');
      engine.reviveCurrentRun();
    },
    onSaveChanged: (nextSave) => {
      saveData = nextSave;
      persistSaveData(saveData);
      audio.applySettings(
        saveData.settings.musicVolume,
        saveData.settings.sfxVolume,
        saveData.settings.muted
      );
      engine.syncSaveData(saveData);
    },
    onButtonClickSfx: () => {
      audio.playClick();
    },
  });

  engine = new TempleRunEngine(mountEl, audio, saveData, {
    onHudUpdate: (snapshot) => {
      ui.updateHud(snapshot);
    },
    onBiomeChanged: (biome) => {
      ui.showBiomeBanner(biome);
    },
    onCloseCall: (bonusPoints) => {
      ui.showCloseCallToast(bonusPoints);
    },
    onGameOver: (stats) => {
      audio.playGameOver();
      const prev = lastCommittedRunStats;
      const incrementalStats: RunStats = prev
        ? {
            ...stats,
            distance: Math.max(0, stats.distance - prev.distance),
            coins: Math.max(0, stats.coins - prev.coins),
            powerUpsCollected: Math.max(0, stats.powerUpsCollected - prev.powerUpsCollected),
            jumps: Math.max(0, stats.jumps - prev.jumps),
            slides: Math.max(0, stats.slides - prev.slides),
            closeCalls: Math.max(0, stats.closeCalls - prev.closeCalls),
          }
        : stats;

      const prevRunsPlayed = saveData.runsPlayed;
      const result = applyRunToSave(saveData, incrementalStats);
      // Preserve total highScore/bestDistance from full cumulative run and avoid double-counting runsPlayed after a revive
      saveData = {
        ...result.nextSave,
        highScore: Math.max(result.nextSave.highScore, Math.floor(stats.score)),
        bestDistance: Math.max(result.nextSave.bestDistance, Math.floor(stats.distance)),
        runsPlayed: prev ? prevRunsPlayed : result.nextSave.runsPlayed,
      };
      lastCommittedRunStats = stats;

      persistSaveData(saveData);
      engine.syncSaveData(saveData);
      ui.syncSave(saveData);
      ui.setGameOverSummary(
        stats,
        engine.getRevivesUsed(),
        result.newlyCompletedMissions,
        result.newlyUnlockedAchievements,
        result.newlyUnlockedBiomes
      );
      setState('gameover');
    },
    onPauseToggle: () => {
      if (currentState === 'playing') {
        setState('paused');
      } else if (currentState === 'paused') {
        setState('playing');
      }
    },
    onMuteToggle: () => {
      ui.toggleMute();
    },
  });

  // Title/GameOver Enter & Space start handshake
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Enter' && e.code !== 'Space') return;
    if (currentState === 'title' && ui.getActiveSubModal() === 'none') {
      e.preventDefault();
      startRun();
    } else if (currentState === 'gameover') {
      e.preventDefault();
      startRun();
    }
  });

  // Support ?autostart=1 for automated & direct-play entry
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    startRun();
  } else {
    setState('title');
  }

  window.addEventListener('beforeunload', () => {
    engine.dispose();
    audio.dispose();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
