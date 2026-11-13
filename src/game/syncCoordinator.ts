import type {SaveData} from './types';

export interface SyncStatusUpdate {
  syncStatus: 'offline' | 'syncing' | 'synced' | 'error';
  errorMessage: string | null;
  leaderboardError?: string | null;
}

export function extractRawErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as {error?: unknown; path?: unknown};
      const inner = typeof parsed.error === 'string' ? parsed.error : raw;
      const path = typeof parsed.path === 'string' ? ` (${parsed.path})` : '';
      return `${inner}${path}`;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function formatCloudErrorMessage(err: unknown): string {
  const msg = extractRawErrorText(err);
  const lower = msg.toLowerCase();

  if (lower.includes('popup-closed-by-user') || lower.includes('cancelled-popup-request')) {
    return 'Sign-in cancelled.';
  }
  if (lower.includes('popup-blocked')) {
    return 'Pop-up was blocked. Allow pop-ups and try again.';
  }
  if (lower.includes('unauthorized-domain')) {
    return 'This preview domain is not authorized in Firebase Auth.';
  }
  if (lower.includes('permission') || lower.includes('permission_denied')) {
    return 'Cloud permission denied. Refresh or verify your account.';
  }
  if (lower.includes('resource-exhausted') || lower.includes('quota')) {
    return 'Cloud sync quota reached temporarily. Local save is safe.';
  }
  if (
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('unavailable') ||
    lower.includes('failed to fetch') ||
    lower.includes('deadline-exceeded')
  ) {
    return 'Network unavailable. Saved locally — tap Retry when online.';
  }
  return msg.length > 0 && msg.length <= 120 ? msg : 'Could not reach Firebase right now.';
}

export function isTransientCloudError(err: unknown): boolean {
  const lower = extractRawErrorText(err).toLowerCase();
  if (lower.includes('permission') || lower.includes('unauthenticated')) {
    return false;
  }
  return (
    lower.includes('unavailable') ||
    lower.includes('aborted') ||
    lower.includes('deadline') ||
    lower.includes('network') ||
    lower.includes('offline') ||
    lower.includes('internal') ||
    lower.includes('failed to fetch')
  );
}

export interface SyncUserIdentity {
  uid: string;
  emailVerified: boolean;
}

export interface SyncTransport {
  persistSave: (user: SyncUserIdentity, save: SaveData) => Promise<void>;
  upsertLeaderboard: (user: SyncUserIdentity, save: SaveData) => Promise<void>;
  onStatus: (update: SyncStatusUpdate) => void;
  debounceMs?: number;
  retryDelayMs?: number;
}

/**
 * Serializes and coalesces cloud save & leaderboard writes so rapid UI mutations
 * (e.g. volume slider drags) never race or spam Firestore, and transient glitches
 * recover cleanly.
 */
export class CloudSyncCoordinator {
  private readonly debounceMs: number;
  private readonly retryDelayMs: number;

  private activeUser: SyncUserIdentity | null = null;
  private pendingSave: SaveData | null = null;
  private pendingLeaderboard = false;
  private dirty = false;
  private inFlight = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private waitResolvers: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly transport: SyncTransport) {
    this.debounceMs = transport.debounceMs ?? 650;
    this.retryDelayMs = transport.retryDelayMs ?? 900;
  }

  public setUser(user: SyncUserIdentity | null): void {
    if (this.activeUser?.uid === user?.uid && this.activeUser?.emailVerified === user?.emailVerified) {
      return;
    }
    this.clearDebounce();
    this.activeUser = user;
    if (!user) {
      this.pendingSave = null;
      this.pendingLeaderboard = false;
      this.dirty = false;
      this.transport.onStatus({syncStatus: 'offline', errorMessage: null, leaderboardError: null});
      return;
    }
    if (!user.emailVerified) {
      this.transport.onStatus({
        syncStatus: 'error',
        errorMessage: 'Verify your Google account email to enable cloud sync.',
      });
    }
  }

  public isDirty(): boolean {
    return this.dirty;
  }

  public scheduleSave(save: SaveData, options: {immediate?: boolean; updateLeaderboard?: boolean} = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const user = this.activeUser;
    if (!user) return Promise.resolve();
    if (!user.emailVerified) {
      this.transport.onStatus({
        syncStatus: 'error',
        errorMessage: 'Verify your Google account email to enable cloud sync.',
      });
      return Promise.resolve();
    }

    this.pendingSave = save;
    this.dirty = true;
    if (options.updateLeaderboard && save.highScore > 0) {
      this.pendingLeaderboard = true;
    }

    const p = new Promise<void>((resolve) => {
      this.waitResolvers.push(resolve);
    });

    if (options.immediate) {
      this.clearDebounce();
      void this.drainQueue();
    } else {
      this.clearDebounce();
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.drainQueue();
      }, this.debounceMs);
    }

    return p;
  }

  public retryIfDirty(save: SaveData, updateLeaderboard = true): Promise<void> {
    if (!this.activeUser || !this.activeUser.emailVerified) return Promise.resolve();
    return this.scheduleSave(save, {immediate: true, updateLeaderboard});
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private resolveAllWaiters(): void {
    if (this.waitResolvers.length === 0) return;
    const resolvers = this.waitResolvers.splice(0);
    for (const r of resolvers) r();
  }

  private async drainQueue(): Promise<void> {
    if (this.inFlight || this.disposed) return;
    const user = this.activeUser;
    if (!user || !user.emailVerified || !this.pendingSave) {
      this.resolveAllWaiters();
      return;
    }

    this.inFlight = true;
    let saveSucceeded = false;
    let lastSaveErr: unknown = null;
    let leaderboardErr: unknown = null;

    try {
      while (!this.disposed && this.activeUser?.uid === user.uid && this.pendingSave) {
        const saveSnapshot = this.pendingSave;
        const doLeaderboard = this.pendingLeaderboard && saveSnapshot.highScore > 0;
        this.pendingSave = null;
        this.pendingLeaderboard = false;

        this.transport.onStatus({syncStatus: 'syncing', errorMessage: null});

        saveSucceeded = false;
        lastSaveErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await this.transport.persistSave(user, saveSnapshot);
            saveSucceeded = true;
            this.dirty = this.pendingSave !== null;
            break;
          } catch (err) {
            lastSaveErr = err;
            if (attempt === 0 && isTransientCloudError(err) && !this.disposed) {
              await new Promise((r) => setTimeout(r, this.retryDelayMs));
              continue;
            }
            break;
          }
        }

        if (!saveSucceeded) {
          this.dirty = true;
          this.pendingSave = this.pendingSave ?? saveSnapshot;
          if (doLeaderboard) this.pendingLeaderboard = true;
          break;
        }

        if (doLeaderboard) {
          try {
            await this.transport.upsertLeaderboard(user, saveSnapshot);
            leaderboardErr = null;
          } catch (err) {
            leaderboardErr = err;
          }
        }
      }

      if (this.disposed || this.activeUser?.uid !== user.uid) return;

      if (saveSucceeded) {
        this.transport.onStatus({
          syncStatus: 'synced',
          errorMessage: null,
          ...(leaderboardErr ? {leaderboardError: formatCloudErrorMessage(leaderboardErr)} : {}),
        });
      } else if (lastSaveErr) {
        this.transport.onStatus({
          syncStatus: 'error',
          errorMessage: formatCloudErrorMessage(lastSaveErr),
        });
      }
    } finally {
      this.inFlight = false;
      this.resolveAllWaiters();
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.clearDebounce();
    this.resolveAllWaiters();
  }
}
