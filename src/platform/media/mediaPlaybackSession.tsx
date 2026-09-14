import { createContext, useContext } from 'react';
import type { VideoPlayer } from 'expo-video';
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

/** Player callbacks are scoped to this attachment, never to a recycled row. */
export class MediaPlaybackHandle {
  private desired = false;
  private ready = false;
  private readonly initialPosition: number;
  private loading = true;
  private failed = false;
  private suspended = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastBufferedPosition: number | null = null;
  private subscriptions: { remove: () => void }[];
  private fullscreen = false;
  private fullscreenActive = false;
  private detached = false;
  private releasePlayer: (() => void) | null = null;
  private disposeCallbacks: (() => void)[] = [];

  constructor(
    private session: MediaPlaybackSession,
    private player: VideoPlayer,
    private id: string,
    private kind: 'audio' | 'video',
    private callbacks: PlaybackCallbacks
  ) {
    this.initialPosition = kind === 'video' ? session.position(id) : 0;
    this.subscriptions = [
      player.addListener('fullscreenChange', ({ fullscreen, active = fullscreen }) => {
        this.fullscreen = fullscreen;
        this.fullscreenActive = fullscreen && active;
        if (fullscreen && !active) this.pause();
        if (!fullscreen && this.detached) this.dispose();
      }),
      player.addListener('playWhenReadyChange', ({ playWhenReady }) => this.intent(playWhenReady)),
      player.addListener('playingChange', ({ isPlaying }) => {
        if (isPlaying) this.intent(true);
      }),
      player.addListener('statusChange', ({ status }) => this.status(status)),
      player.addListener('positionDiscontinuity', () => this.seek()),
      player.addListener('timeUpdate', ({ currentTime, bufferedPosition }) => {
        if (this.disposed) return;
        if (this.ready) this.session.remember(id, currentTime);
        this.progress(bufferedPosition);
      }),
      player.addListener('playToEnd', () => {
        if (this.disposed || player.duration <= 0) return;
        this.session.remember(id, player.duration);
        this.loading = false;
        this.intent(false);
      })
    ];
    this.status(player.status);
  }

  intent(playing: boolean) {
    if (this.disposed) return;
    if (playing && (this.failed || !this.session.claim(this))) {
      this.pause();
      return;
    }
    if (playing) this.suspended = false;
    if (this.desired !== playing) {
      this.desired = playing;
      this.callbacks.onIntent?.(playing);
    }
    this.schedule();
  }

  isFullscreenActive() {
    return this.fullscreenActive;
  }

  pause() {
    if (this.disposed) return;
    this.suspended = true;
    this.intent(false);
    this.player.pause();
    this.clearTimer();
  }

  status(status: string) {
    if (this.disposed || this.failed) return;
    this.loading = status === 'loading' || status === 'idle';
    if (status === 'readyToPlay' && !this.ready) {
      this.ready = true;
      if (this.initialPosition > 0) this.player.currentTime = this.initialPosition;
    }
    if (status === 'error') this.failed = true;
    this.schedule();
  }

  seek() {
    if (this.disposed) return;
    this.lastBufferedPosition = null;
    this.clearTimer();
    this.schedule();
  }

  progress(bufferedPosition: number) {
    if (this.disposed || !Number.isFinite(bufferedPosition) || bufferedPosition < 0) return;
    const advanced = this.lastBufferedPosition !== null && bufferedPosition > this.lastBufferedPosition;
    this.lastBufferedPosition = bufferedPosition;
    if (advanced) {
      this.clearTimer();
      this.schedule();
    }
  }

  dispose() {
    if (this.disposed) return;
    if (this.ready) this.session.remember(this.id, this.player.currentTime);
    this.pause();
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.remove();
    this.clearTimer();
    this.session.remove(this);
    this.releasePlayer?.();
    this.releasePlayer = null;
    for (const callback of this.disposeCallbacks) callback();
    this.disposeCallbacks = [];
  }

  detach(releasePlayer: () => void) {
    if (this.disposed) {
      releasePlayer();
      return;
    }
    this.detached = true;
    this.releasePlayer = releasePlayer;
    if (!this.fullscreen) this.dispose();
  }

  afterDispose(callback: () => void) {
    if (this.disposed) callback();
    else this.disposeCallbacks.push(callback);
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.suspended || this.failed || !this.loading || (this.ready && !this.desired)) {
      this.clearTimer();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.failed = true;
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
