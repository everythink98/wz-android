import { createContext, useContext } from 'react';
import type { VideoPlayer } from 'expo-video';
import { recordDiagnosticError } from '@/platform/diagnostics/diagnostics';
import { recordMediaBudgetTimeout } from './mediaPlaybackDiagnostics';

const NO_PROGRESS_TIMEOUT_MS = 30_000;

type PlaybackCallbacks = {
  onIntent?: (playing: boolean) => void;
  onTimeout: () => void;
};

/** Owns playback permission and remembered positions for one reading route. */
export class MediaPlaybackSession {
  private handles = new Set<MediaPlaybackHandle>();
  private positions = new Map<string, number>();
  private active = true;
  private allowFullscreen = true;
  private preparations = new Set<{ arm: () => void; pause: () => void }>();

  prepare(id: string, kind: 'audio' | 'video', onTimeout: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pause = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const cancel = () => {
      pause();
      this.preparations.delete(preparation);
    };
    const preparation = {
      pause,
      arm: () => {
        if (timer !== null) return;
        timer = setTimeout(() => {
          cancel();
          recordMediaBudgetTimeout(id, kind, NO_PROGRESS_TIMEOUT_MS);
          onTimeout();
        }, NO_PROGRESS_TIMEOUT_MS);
      }
    };
    this.preparations.add(preparation);
    if (this.active) preparation.arm();
    return cancel;
  }

  attach(player: VideoPlayer, id: string, kind: 'audio' | 'video', callbacks: PlaybackCallbacks) {
    const handle = new MediaPlaybackHandle(this, player, id, kind, callbacks);
    this.handles.add(handle);
    return handle;
  }

  claim(handle: MediaPlaybackHandle) {
    if (!this.active && !(this.allowFullscreen && handle.isFullscreenActive())) return false;
    for (const other of this.handles) if (other !== handle) other.pause();
    return true;
  }

  updateGate(active: boolean, allowFullscreen = true) {
    if (this.active === active && this.allowFullscreen === allowFullscreen) return;
    this.active = active;
    this.allowFullscreen = allowFullscreen;
    for (const preparation of this.preparations) {
      if (active) preparation.arm();
      else preparation.pause();
    }
    if (!active)
      for (const handle of this.handles) {
        if (!allowFullscreen || !handle.isFullscreenActive()) handle.pause();
      }
  }

  position(id: string) {
    return this.positions.get(id) || 0;
  }

  remember(id: string, position: number) {
    if (Number.isFinite(position) && position >= 0) this.positions.set(id, position);
  }

  remove(handle: MediaPlaybackHandle) {
    this.handles.delete(handle);
  }

  dispose() {
    this.active = false;
    for (const handle of [...this.handles]) handle.dispose();
    this.positions.clear();
    for (const preparation of this.preparations) preparation.pause();
    this.preparations.clear();
  }
}

type PlaybackLifetime =
  { phase: 'attached' } | { phase: 'detached'; releasePlayer: () => void } | { phase: 'disposed' };
type FirstReadiness = { phase: 'waiting'; initialPosition: number } | { phase: 'confirmed' };
type PlaybackIntent = 'idle' | 'playing' | 'suspended';
type BufferingState = 'loading' | 'not-loading' | 'failed';
type FullscreenPresentation = { phase: 'inline' } | { phase: 'fullscreen'; active: boolean };

/** Player callbacks and physical release belong to this attachment, including a recycled fullscreen row. */
export class MediaPlaybackHandle {
  private lifetime: PlaybackLifetime = { phase: 'attached' };
  private readiness: FirstReadiness;
  private playIntent: PlaybackIntent = 'idle';
  private buffering: BufferingState = 'loading';
  private presentation: FullscreenPresentation = { phase: 'inline' };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastBufferedPosition: number | null = null;
  private subscriptions: { remove: () => void }[];
  private disposeCallbacks: (() => void)[] = [];

  constructor(
    private session: MediaPlaybackSession,
    private player: VideoPlayer,
    private id: string,
    private kind: 'audio' | 'video',
    private callbacks: PlaybackCallbacks
  ) {
    this.readiness = { phase: 'waiting', initialPosition: kind === 'video' ? session.position(id) : 0 };
    this.subscriptions = [
      player.addListener('fullscreenChange', ({ fullscreen, active = fullscreen }) => {
        this.presentation = fullscreen ? { phase: 'fullscreen', active } : { phase: 'inline' };
        if (fullscreen && !active) this.pause();
        if (!fullscreen && this.lifetime.phase === 'detached') this.dispose();
      }),
      player.addListener('playWhenReadyChange', ({ playWhenReady }) => this.intent(playWhenReady)),
      player.addListener('playingChange', ({ isPlaying }) => {
        if (isPlaying) this.intent(true);
      }),
      player.addListener('statusChange', ({ status }) => this.status(status)),
      player.addListener('positionDiscontinuity', () => this.seek()),
      player.addListener('timeUpdate', ({ currentTime, bufferedPosition }) => {
        if (this.lifetime.phase === 'disposed') return;
        if (this.readiness.phase === 'confirmed') this.session.remember(id, currentTime);
        this.progress(bufferedPosition);
      }),
      player.addListener('playToEnd', () => {
        if (this.lifetime.phase === 'disposed' || player.duration <= 0) return;
        this.session.remember(id, player.duration);
        if (this.buffering !== 'failed') this.buffering = 'not-loading';
        this.intent(false);
      })
    ];
    this.status(player.status);
  }

  private commitIntent(next: PlaybackIntent) {
    const playing = this.playIntent === 'playing';
    this.playIntent = next;
    if (playing !== (next === 'playing')) this.callbacks.onIntent?.(next === 'playing');
  }

  intent(playing: boolean) {
    if (this.lifetime.phase === 'disposed') return;
    if (playing && (this.buffering === 'failed' || !this.session.claim(this))) {
      this.pause();
      return;
    }
    this.commitIntent(playing ? 'playing' : this.playIntent === 'suspended' ? 'suspended' : 'idle');
    this.schedule();
  }

  isFullscreenActive() {
    return this.presentation.phase === 'fullscreen' && this.presentation.active;
  }

  pause() {
    if (this.lifetime.phase === 'disposed') return;
    this.commitIntent('suspended');
    this.schedule();
    this.player.pause();
    this.clearTimer();
  }

  status(status: string) {
    if (this.lifetime.phase === 'disposed' || this.buffering === 'failed') return;
    this.buffering =
      status === 'error' ? 'failed' : status === 'loading' || status === 'idle' ? 'loading' : 'not-loading';
    if (status === 'readyToPlay' && this.readiness.phase === 'waiting') {
      const position = this.readiness.initialPosition;
      this.readiness = { phase: 'confirmed' };
      if (position > 0) this.player.currentTime = position;
    }
    this.schedule();
  }

  seek() {
    if (this.lifetime.phase === 'disposed') return;
    this.lastBufferedPosition = null;
    this.clearTimer();
    this.schedule();
  }

  progress(bufferedPosition: number) {
    if (this.lifetime.phase === 'disposed' || !Number.isFinite(bufferedPosition) || bufferedPosition < 0) return;
    const advanced = this.lastBufferedPosition !== null && bufferedPosition > this.lastBufferedPosition;
    this.lastBufferedPosition = bufferedPosition;
    if (advanced) {
      this.clearTimer();
      this.schedule();
    }
  }

  dispose() {
    if (this.lifetime.phase === 'disposed') return;
    const releasePlayer = this.lifetime.phase === 'detached' ? this.lifetime.releasePlayer : null;
    this.lifetime = { phase: 'disposed' };
    this.clearTimer();
    this.session.remove(this);
    this.commitIntent('suspended');
    // An externally released Expo player can reject native reads, pause and listener removal independently.
    const release = (action: () => void) => {
      try {
        action();
      } catch (error) {
        recordDiagnosticError('media', 'player-error', error, { mediaKind: this.kind });
      }
    };
    if (this.readiness.phase === 'confirmed') release(() => this.session.remember(this.id, this.player.currentTime));
    release(() => this.player.pause());
    for (const subscription of this.subscriptions) release(() => subscription.remove());
    if (releasePlayer) release(releasePlayer);
    for (const callback of this.disposeCallbacks) callback();
    this.disposeCallbacks = [];
  }

  detach(releasePlayer: () => void) {
    if (this.lifetime.phase === 'disposed') {
      releasePlayer();
      return;
    }
    this.lifetime = { phase: 'detached', releasePlayer };
    if (this.presentation.phase === 'inline') this.dispose();
  }

  afterDispose(callback: () => void) {
    if (this.lifetime.phase === 'disposed') callback();
    else this.disposeCallbacks.push(callback);
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (
      this.playIntent === 'suspended' ||
      this.buffering !== 'loading' ||
      (this.readiness.phase === 'confirmed' && this.playIntent !== 'playing')
    ) {
      this.clearTimer();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.buffering = 'failed';
      this.pause();
      recordMediaBudgetTimeout(this.id, this.kind, NO_PROGRESS_TIMEOUT_MS);
      this.callbacks.onTimeout();
    }, NO_PROGRESS_TIMEOUT_MS);
  }
}

export const MediaPlaybackSessionContext = createContext<MediaPlaybackSession | null>(null);
export function useMediaPlaybackSession() {
  return useContext(MediaPlaybackSessionContext);
}
