import type {User} from 'firebase/auth';
import {signInWithGoogle, signOutExplorer, subscribeToAuth} from './firebase';
import {TempleAudio} from './game/audio';
import {mergeCloudAndLocalSave} from './game/cloudMerge';
import {
  fetchTopLeaderboard,
  loadCloudSave,
  persistCloudSave,
  sanitizeDisplayName,
  upsertLeaderboardEntry,
} from './game/cloudSync';
import {ensureDailyMissions} from './game/dailyMissions';
import {TempleRunEngine} from './game/engine';
import {applyRunToSave, canAffordRevive, getReviveCost} from './game/rules';
import {loadSaveData, persistSaveData} from './game/storage';
import type {GameState, RunStats, SaveData} from './game/types';
import {TempleUI, type CloudAccountState} from './ui/hud';

function formatCloudErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('popup-closed-by-user')) return 'Sign-in cancelled.';
  if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
    return 'Permission error while syncing cloud data.';
  }
  return 'Could not reach Firebase right now.';
}

function bootstrap(): void {
  const mountEl = document.getElementById('game-canvas-mount');
  const uiRootEl = document.getElementById('ui-root');
  if (!mountEl || !uiRootEl) return;

  let saveData: SaveData = loadSaveData();
  let currentState: GameState = 'title';
  let lastCommittedRunStats: RunStats | null = null;
  let currentUser: User | null = null;
  let cloudState: CloudAccountState = {
    signedIn: false,
    displayName: null,
    uid: null,
    syncStatus: 'offline',
    errorMessage: null,
    leaderboard: [],
    leaderboardLoading: false,
    leaderboardError: null,
  };

  const audio = new TempleAudio();
  audio.applySettings(
    saveData.settings.musicVolume,
    saveData.settings.sfxVolume,
    saveData.settings.muted
  );

  let engine: TempleRunEngine;
  let ui: TempleUI;

  const updateCloudState = (patch: Partial<CloudAccountState>) => {
    cloudState = {...cloudState, ...patch};
    ui.setCloudState(cloudState);
  };

  const syncCloudProgress = async (updateLeaderboard: boolean) => {
    const user = currentUser;
    if (!user || !user.emailVerified) return;
    updateCloudState({syncStatus: 'syncing', errorMessage: null});
    try {
      await persistCloudSave(user, saveData);
      if (updateLeaderboard && saveData.highScore > 0) {
        await upsertLeaderboardEntry(user, saveData);
      }
      updateCloudState({syncStatus: 'synced', errorMessage: null});
    } catch (err) {
      updateCloudState({
        syncStatus: 'error',
        errorMessage: formatCloudErrorMessage(err),
      });
    }
  };

  const refreshLeaderboard = async () => {
    if (!currentUser) return;
    updateCloudState({leaderboardLoading: true, leaderboardError: null});
    try {
      const entries = await fetchTopLeaderboard(20);
      updateCloudState({
        leaderboard: entries,
        leaderboardLoading: false,
        leaderboardError: null,
      });
    } catch (err) {
      updateCloudState({
        leaderboardLoading: false,
        leaderboardError: formatCloudErrorMessage(err),
      });
    }
  };

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
    const rolledSave = ensureDailyMissions(saveData);
    if (rolledSave !== saveData) {
      saveData = rolledSave;
      persistSaveData(saveData);
      engine.syncSaveData(saveData);
      ui.syncSave(saveData);
      void syncCloudProgress(false);
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
      void syncCloudProgress(false);
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
      void syncCloudProgress(false);
    },
    onButtonClickSfx: () => {
      audio.playClick();
    },
    onSignInGoogle: () => {
      void (async () => {
        try {
          updateCloudState({syncStatus: 'syncing', errorMessage: null});
          await signInWithGoogle();
        } catch (err) {
          updateCloudState({
            syncStatus: currentUser ? 'error' : 'offline',
            errorMessage: formatCloudErrorMessage(err),
          });
        }
      })();
    },
    onSignOutGoogle: () => {
      void signOutExplorer();
    },
    onRefreshLeaderboard: () => {
      void refreshLeaderboard();
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
            survivalSeconds: Math.max(0, stats.survivalSeconds - prev.survivalSeconds),
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
      void syncCloudProgress(true);
      ui.setGameOverSummary(
        stats,
        engine.getRevivesUsed(),
        result.newlyCompletedMissions,
        result.newlyCompletedDailyMissions,
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

  const unsubscribeAuth = subscribeToAuth((user) => {
    currentUser = user;
    if (!user) {
      updateCloudState({
        signedIn: false,
        displayName: null,
        uid: null,
        syncStatus: 'offline',
        errorMessage: null,
        leaderboard: [],
        leaderboardLoading: false,
        leaderboardError: null,
      });
      return;
    }

    updateCloudState({
      signedIn: true,
      displayName: sanitizeDisplayName(user.displayName),
      uid: user.uid,
      syncStatus: 'syncing',
      errorMessage: null,
    });

    void (async () => {
      try {
        const cloudSave = await loadCloudSave(user);
        if (cloudSave) {
          saveData = mergeCloudAndLocalSave(saveData, cloudSave);
          persistSaveData(saveData);
          audio.applySettings(
            saveData.settings.musicVolume,
            saveData.settings.sfxVolume,
            saveData.settings.muted
          );
          engine.syncSaveData(saveData);
          ui.syncSave(saveData);
        }
        await syncCloudProgress(true);
        if (ui.getActiveSubModal() === 'leaderboard') {
          await refreshLeaderboard();
        }
      } catch (err) {
        updateCloudState({
          syncStatus: 'error',
          errorMessage: formatCloudErrorMessage(err),
        });
      }
    })();
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
    unsubscribeAuth();
    engine.dispose();
    audio.dispose();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
