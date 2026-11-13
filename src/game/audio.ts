import type {PowerUpType} from './types';

export class TempleAudio {
  private ctx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicActive = false;
  private pendingMusic = false;
  private beatStep = 0;
  private coinStreak = 0;
  private lastCoinAt = 0;

  public musicVolume = 0.55;
  public sfxVolume = 0.75;
  public muted = false;

  public applySettings(musicVolume: number, sfxVolume: number, muted: boolean): void {
    this.musicVolume = musicVolume;
    this.sfxVolume = sfxVolume;
    this.muted = muted;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(
        muted ? 0 : musicVolume * 0.28,
        this.ctx.currentTime,
        0.05
      );
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(
        muted ? 0 : sfxVolume * 0.65,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.ctx.destination);
      this.sfxGain.connect(this.ctx.destination);
      this.applySettings(this.musicVolume, this.sfxVolume, this.muted);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.pendingMusic && !this.musicActive) {
      this.pendingMusic = false;
      this.startMusic();
    }
  }

  public startMusic(): void {
    if (!this.ctx) {
      this.pendingMusic = true;
      return;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.musicActive) return;
    this.musicActive = true;
    this.beatStep = 0;

    // Procedural tribal percussion & temple marimba pulse
    const scale = [220, 261.63, 293.66, 329.63, 392.0, 440, 523.25];
    const pattern = [0, 2, 4, 2, 5, 4, 3, 1];

    const scheduleStep = () => {
      if (!this.musicActive || !this.ctx || !this.musicGain) return;
      if (this.ctx.state === 'running' && !this.muted && this.musicVolume > 0.01) {
        const now = this.ctx.currentTime;
        const step = this.beatStep % 16;

        // Deep temple frame drum on downbeats & syncopation
        if (step % 4 === 0 || step === 6 || step === 14) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          const baseFreq = step % 8 === 0 ? 92 : 76;
          osc.frequency.setValueAtTime(baseFreq * 1.45, now);
          osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.6, now + 0.16);
          gain.gain.setValueAtTime(0.55, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.connect(gain);
          gain.connect(this.musicGain);
          osc.start(now);
          osc.stop(now + 0.24);
        }

        // Crisp wooden shaker / rim tap
        if (step % 2 === 1) {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(step % 4 === 3 ? 1120 : 860, now);
          osc.frequency.exponentialRampToValueAtTime(340, now + 0.045);
          gain.gain.setValueAtTime(0.14, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
          osc.connect(gain);
          gain.connect(this.musicGain);
          osc.start(now);
          osc.stop(now + 0.06);
        }

        // Temple marimba / flute motif every 2 steps
        if (step % 2 === 0) {
          const noteIdx = pattern[(step / 2) % pattern.length];
          const freq = scale[noteIdx];
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          gain.gain.setValueAtTime(0.22, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
          osc.connect(gain);
          gain.connect(this.musicGain);
          osc.start(now);
          osc.stop(now + 0.3);
        }
      }

      this.beatStep++;
      this.musicTimer = window.setTimeout(scheduleStep, 165);
    };

    scheduleStep();
  }

  public stopMusic(): void {
    this.musicActive = false;
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainVal = 0.25,
    delay = 0
  ): void {
    if (!this.ctx || !this.sfxGain || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), now + duration);
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playFootstep(): void {
    const jitter = 0.92 + Math.random() * 0.16;
    this.playTone(130 * jitter, 58 * jitter, 0.065, 'triangle', 0.16);
  }

  public playCoin(isGem = false): void {
    const now = performance.now();
    if (now - this.lastCoinAt < 420) {
      this.coinStreak = Math.min(this.coinStreak + 1, 10);
    } else {
      this.coinStreak = 0;
    }
    this.lastCoinAt = now;

    const pitchScale = 1 + this.coinStreak * 0.045;
    if (isGem) {
      this.playTone(880 * pitchScale, 1320 * pitchScale, 0.14, 'sine', 0.28);
      this.playTone(1320 * pitchScale, 1760 * pitchScale, 0.18, 'triangle', 0.22, 0.06);
    } else {
      this.playTone(987.77 * pitchScale, 1318.5 * pitchScale, 0.11, 'sine', 0.24);
    }
  }

  public playJump(): void {
    this.playTone(230, 540, 0.16, 'sine', 0.26);
  }

  public playLand(): void {
    this.playTone(150, 55, 0.11, 'triangle', 0.28);
  }

  public playSlide(): void {
    this.playTone(360, 120, 0.22, 'sawtooth', 0.14);
  }

  public playLaneSwitch(): void {
    this.playTone(320, 460, 0.075, 'sine', 0.14);
  }

  public playPowerUp(type: PowerUpType): void {
    const base =
      type === 'invincibility' || type === 'boost'
        ? 523.25
        : type === 'shield'
          ? 440
          : 493.88;
    this.playTone(base, base * 1.25, 0.12, 'triangle', 0.28, 0);
    this.playTone(base * 1.25, base * 1.5, 0.14, 'triangle', 0.26, 0.08);
    this.playTone(base * 1.5, base * 2, 0.22, 'sine', 0.3, 0.16);
  }

  public playShieldBreak(): void {
    this.playTone(620, 140, 0.26, 'sawtooth', 0.35);
    this.playTone(420, 90, 0.28, 'triangle', 0.3, 0.04);
  }

  public playSmash(): void {
    this.playTone(240, 65, 0.18, 'square', 0.22);
  }

  public playCollision(): void {
    this.playTone(170, 42, 0.32, 'sawtooth', 0.42);
    this.playTone(110, 34, 0.4, 'triangle', 0.36, 0.03);
  }

  public playGameOver(): void {
    this.playTone(392, 349.23, 0.22, 'triangle', 0.3, 0);
    this.playTone(349.23, 293.66, 0.24, 'triangle', 0.3, 0.2);
    this.playTone(261.63, 174.61, 0.46, 'sawtooth', 0.28, 0.42);
  }

  public playClick(): void {
    this.unlock();
    this.playTone(620, 820, 0.05, 'sine', 0.15);
  }

  public playCloseCall(): void {
    this.playTone(740, 1180, 0.12, 'triangle', 0.22);
    this.playTone(1180, 1480, 0.14, 'sine', 0.18, 0.05);
  }

  public playRelicSurge(): void {
    this.playTone(180, 880, 0.35, 'sawtooth', 0.24);
    this.playTone(440, 880, 0.28, 'triangle', 0.26, 0.04);
    this.playTone(659.25, 1318.5, 0.35, 'sine', 0.28, 0.1);
  }

  public playRevive(): void {
    this.playTone(392, 523.25, 0.16, 'triangle', 0.26, 0);
    this.playTone(523.25, 783.99, 0.22, 'sine', 0.28, 0.09);
    this.playTone(783.99, 1046.5, 0.3, 'triangle', 0.26, 0.18);
  }

  public dispose(): void {
    this.stopMusic();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
