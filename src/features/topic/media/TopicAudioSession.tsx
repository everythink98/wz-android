import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from 'react';
import {
  createVideoPlayer,
  type PlayingChangeEventPayload,
  type SourceLoadEventPayload,
  type StatusChangeEventPayload,
  type TimeUpdateEventPayload,
  type VideoPlayer
} from 'expo-video';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { forumMediaPlayerSourceFromUrl } from '@/platform/media/imageRequestSource';
import { playerLoadDiagnosticAttempt } from '@/platform/media/mediaPlaybackDiagnostics';
import {
  MediaPlaybackSession,
  type MediaPlaybackHandle,
  useMediaPlaybackSession
} from '@/platform/media/mediaPlaybackSession';
import {
  releaseReadNetworkRuntimeGeneration,
  retainReadNetworkRuntimeGeneration
} from '@/platform/network/networkProxy';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

const AUDIO_TIME_UPDATE_INTERVAL_SECONDS = 1;

export type TopicAudioAdmission = {
  admitted: boolean;
  attachmentKey: string;
  attemptId: string;
  failure: 'error' | 'timeout' | null;
  progress: (value: number) => void;
  retry: () => void;
  settle: (outcome: 'displayed' | 'error') => void;
};

export type TopicAudioSnapshot = Readonly<{
  duration: number;
  error: string | null;
  playing: boolean;
  playWhenReady: boolean;
  position: number;
  status: 'error' | 'idle' | 'loading' | 'buffering' | 'ready';
}>;

type TopicAudioDescriptor = {
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
};

type TopicAudioAttachment = {
  admission: TopicAudioAdmission;
};

const IDLE_AUDIO_SNAPSHOT: TopicAudioSnapshot = Object.freeze({
  duration: 0,
  error: null,
  playing: false,
  playWhenReady: false,
  position: 0,
  status: 'idle'
});

function safeMediaTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function sameSnapshot(left: TopicAudioSnapshot, right: TopicAudioSnapshot) {
  return (
    left.duration === right.duration &&
    left.error === right.error &&
    left.playing === right.playing &&
    left.playWhenReady === right.playWhenReady &&
    left.position === right.position &&
    left.status === right.status
  );
}

type AudioLoadRun = {
  id: string;
  descriptor: TopicAudioDescriptor;
  restorePosition: number;
  pendingPlay: boolean;
  cancelPreparation: (() => void) | null;
  diagnostic: ReturnType<typeof playerLoadDiagnosticAttempt>;
};

type AudioSourceState =
  | { phase: 'idle' }
  | { phase: 'replacing'; run: AudioLoadRun }
  | { phase: 'active'; run: AudioLoadRun; handle: MediaPlaybackHandle }
  | { phase: 'failed'; run: AudioLoadRun; handle: MediaPlaybackHandle | null }
  | { phase: 'disposed' };

class TopicAudioSession {
  private sourceState: AudioSourceState = { phase: 'idle' };
  private active: boolean;
  private attachments = new Map<string, Map<string, TopicAudioAttachment>>();
  private listeners = new Map<string, Set<() => void>>();
  private paused: boolean;
  private player: VideoPlayer | null = null;
  private playerSubscriptions: { remove: () => void }[] = [];
  private replaceQueue: Promise<void> = Promise.resolve();
  private retainedGeneration: number | null = null;
  private retryRequested = new Set<string>();
  private runtimeGeneration: number;
  private snapshots = new Map<string, TopicAudioSnapshot>();
  private sources = new Map<string, TopicAudioDescriptor>();

  constructor(
    { active, paused, runtimeGeneration }: { active: boolean; paused: boolean; runtimeGeneration: number },
    private playback: MediaPlaybackSession
  ) {
    this.active = active;
    this.paused = paused;
    this.runtimeGeneration = runtimeGeneration;
  }

  private get currentRun() {
    return 'run' in this.sourceState ? this.sourceState.run : null;
  }

  private get activeId() {
    return this.currentRun?.id ?? null;
  }

  private get playbackHandle() {
    return 'handle' in this.sourceState ? this.sourceState.handle : null;
  }

  private owns(run: AudioLoadRun) {
    return (
      (this.sourceState.phase === 'replacing' || this.sourceState.phase === 'active') && this.sourceState.run === run
    );
  }

  private finishPreparation(run: AudioLoadRun) {
    const cancel = run.cancelPreparation;
    run.cancelPreparation = null;
    cancel?.();
  }

  private retireSource() {
    if (this.sourceState.phase === 'disposed') return false;
    const owner = this.sourceState;
    const run = this.currentRun;
    this.playbackHandle?.dispose();
    if (run) {
      this.finishPreparation(run);
      run.diagnostic.canceled();
    }
    if (this.sourceState !== owner) return false;
    this.sourceState = { phase: 'idle' };
    return true;
  }

  getSnapshot = (id: string) => this.snapshots.get(id) || IDLE_AUDIO_SNAPSHOT;

  subscribe = (id: string, listener: () => void) => {
    const listeners = this.listeners.get(id) || new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(id);
    };
  };

  attach(id: string, key: string, descriptor: TopicAudioDescriptor, admission: TopicAudioAdmission) {
    const previous = this.activeId ? this.sources.get(this.activeId) : null;
    if (
      previous &&
      previous.mediaContext.contentSource === descriptor.mediaContext.contentSource &&
      previous.mediaContext.sessionIdentity !== descriptor.mediaContext.sessionIdentity
    ) {
      this.pauseActive();
      this.retireSource();
    }
    const attachments = this.attachments.get(id) || new Map<string, TopicAudioAttachment>();
    attachments.set(key, { admission });
    this.attachments.set(id, attachments);
    this.sources.set(id, descriptor);
    if (admission.admitted) {
      const snapshot = this.getSnapshot(id);
      if (snapshot.status === 'error') {
        if (this.retryRequested.delete(id)) {
          this.load(id, false);
        } else {
          admission.settle('error');
        }
      } else if (this.activeId === id) {
        if (snapshot.status === 'ready') admission.settle('displayed');
        else if (snapshot.status === 'idle') this.load(id, false);
      } else if (this.activeId === null) {
        this.load(id, false);
      } else {
        admission.settle('displayed');
      }
    }
    return () => {
      const current = this.attachments.get(id);
      current?.delete(key);
      if (current && !current.size) this.attachments.delete(id);
    };
  }

  updateGate({ active, paused, runtimeGeneration }: { active: boolean; paused: boolean; runtimeGeneration: number }) {
    const becameInactive = (!active || paused) && this.active && !this.paused;
    this.active = active;
    this.paused = paused;
    if (becameInactive) this.pauseActive();
    if (runtimeGeneration > this.runtimeGeneration) {
      this.runtimeGeneration = runtimeGeneration;
      if (this.activeId && this.getSnapshot(this.activeId).status === 'loading') this.load(this.activeId, false);
    }
  }

  play(id: string) {
    if (!this.active || this.paused) return;
    const snapshot = this.getSnapshot(id);
    if (this.activeId === id && (snapshot.status === 'ready' || snapshot.status === 'buffering') && this.player) {
      this.playbackHandle?.intent(true);
      if (this.currentRun) this.currentRun.pendingPlay = false;
      if (snapshot.duration > 0 && snapshot.position >= snapshot.duration) {
        this.player.replay();
        this.updateSnapshot(id, { position: 0 });
      } else {
        this.player.play();
      }
      this.updateSnapshot(id, { playWhenReady: true });
      return;
    }
    if (snapshot.status !== 'error') this.load(id, true);
  }

  pause(id: string) {
    if (this.activeId !== id) return;
    this.pauseActive();
  }

  seek(id: string, position: number) {
    const snapshot = this.getSnapshot(id);
    const nextPosition = Math.min(snapshot.duration || Number.POSITIVE_INFINITY, safeMediaTime(position));
    if (this.activeId === id && this.player) {
      this.playbackHandle?.seek();
      this.player.currentTime = nextPosition;
    }
    this.updateSnapshot(id, { position: nextPosition });
  }

  requestRetry(id: string) {
    this.retryRequested.add(id);
  }

  dispose() {
    if (this.sourceState.phase === 'disposed') return;
    const run = this.currentRun;
    const handle = this.playbackHandle;
    this.sourceState = { phase: 'disposed' };
    if (run) {
      this.finishPreparation(run);
      run.diagnostic.canceled();
      run.pendingPlay = false;
    }
    handle?.dispose();
    for (const subscription of this.playerSubscriptions) subscription.remove();
    this.playerSubscriptions = [];
    try {
      this.player?.pause();
      this.player?.release();
    } catch {
      // Native media teardown is best-effort after the owning Topic has gone away.
    }
    this.player = null;
    const generation = this.retainedGeneration;
    this.retainedGeneration = null;
    if (generation !== null) void releaseReadNetworkRuntimeGeneration(generation).catch(() => undefined);
    this.attachments.clear();
    this.listeners.clear();
    this.retryRequested.clear();
    this.snapshots.clear();
    this.sources.clear();
  }

  isDisposed() {
    return this.sourceState.phase === 'disposed';
  }

  private load(id: string, playWhenReady: boolean) {
    const descriptor = this.sources.get(id);
    if (!descriptor || this.isDisposed()) return;
    if (this.activeId) this.rememberActivePosition();
    if (!this.retireSource()) return;
    const generation = this.runtimeGeneration;
    const run: AudioLoadRun = {
      id,
      descriptor,
      restorePosition: this.getSnapshot(id).position,
      pendingPlay: playWhenReady && this.active && !this.paused,
      cancelPreparation: null,
      diagnostic: playerLoadDiagnosticAttempt(descriptor.src, 'audio', generation)
    };
    this.sourceState = { phase: 'replacing', run };
    run.cancelPreparation = this.playback.prepare(id, 'audio', () => this.fail(run));
    this.updateSnapshot(id, { error: null, playing: false, playWhenReady: run.pendingPlay, status: 'loading' });
    this.replaceQueue = this.replaceQueue.catch(() => undefined).then(() => this.replaceSource(run, generation));
  }

  private async replaceSource(run: AudioLoadRun, targetGeneration: number): Promise<void> {
    if (!this.owns(run)) return;
    let previousGeneration = this.retainedGeneration;
    if (previousGeneration !== targetGeneration) {
      run.diagnostic.stage('runtime-lease');
      const lease = await retainReadNetworkRuntimeGeneration(targetGeneration).catch(() => null);
      if (!this.owns(run)) {
        if (lease?.retained) void releaseReadNetworkRuntimeGeneration(targetGeneration).catch(() => undefined);
        return;
      }
      if (!lease?.retained) {
        const currentGeneration = lease?.generation;
        if (
          Number.isSafeInteger(currentGeneration) &&
          typeof currentGeneration === 'number' &&
          currentGeneration >= 0 &&
          currentGeneration !== targetGeneration
        ) {
          this.runtimeGeneration = Math.max(this.runtimeGeneration, currentGeneration);
          return this.replaceSource(run, currentGeneration);
        }
        this.fail(run);
        return;
      }
      this.retainedGeneration = targetGeneration;
    } else {
      previousGeneration = null;
    }
    try {
      const source = await forumMediaPlayerSourceFromUrl(run.descriptor.src, {
        kind: 'audio',
        mediaContext: run.descriptor.mediaContext,
        nodeSeekUserAgent: run.descriptor.nodeSeekMediaUserAgent,
        referrerPolicy: run.descriptor.referrerPolicy,
        runtimeGeneration: targetGeneration
      });
      if (!this.owns(run)) return;
      run.diagnostic.stage('player-replace');
      const player = this.ensurePlayer();
      await player.replaceAsync(source);
      if (!this.owns(run)) return;
      player.currentTime = run.restorePosition;
      this.finishPreparation(run);
      const handle = this.playback.attach(player, run.id, 'audio', {
        onIntent: (playWhenReady) => {
          if (!this.owns(run)) return;
          if (!playWhenReady) run.pendingPlay = false;
          this.updateSnapshot(run.id, { playWhenReady });
        },
        onTimeout: () => this.fail(run)
      });
      this.sourceState = { phase: 'active', run, handle };
      this.applyStatus({ status: player.status });
    } catch (error) {
      this.fail(run, error);
    } finally {
      if (previousGeneration !== null) {
        void releaseReadNetworkRuntimeGeneration(previousGeneration).catch(() => undefined);
      }
    }
  }

  private ensurePlayer() {
    if (this.player) return this.player;
    const player = createVideoPlayer(null);
    player.timeUpdateEventInterval = AUDIO_TIME_UPDATE_INTERVAL_SECONDS;
    player.staysActiveInBackground = false;
    this.playerSubscriptions = [
      player.addListener('statusChange', (event) => this.applyStatus(event)),
      player.addListener('playingChange', (event) => this.applyPlaying(event)),
      player.addListener('timeUpdate', (event) => this.applyTime(event)),
      player.addListener('sourceLoad', (event) => this.applySourceLoad(event)),
      player.addListener('playToEnd', () => this.applyPlayToEnd())
    ];
    this.player = player;
    return player;
  }

  private applyStatus({ status, error }: Pick<StatusChangeEventPayload, 'status' | 'error'>) {
    const state = this.sourceState;
    if (state.phase !== 'active') return;
    const { run } = state;
    const id = run.id;
    if (status === 'error') {
      this.fail(run, error);
      return;
    }
    if (status !== 'readyToPlay') {
      const snapshot = this.getSnapshot(id);
      if (
        status === 'idle' &&
        snapshot.status === 'ready' &&
        snapshot.duration > 0 &&
        snapshot.position >= snapshot.duration
      ) {
        return;
      }
      this.updateSnapshot(id, { status: snapshot.duration > 0 ? 'buffering' : 'loading' });
      return;
    }
    const player = this.player;
    const duration = safeMediaTime(player?.duration || this.getSnapshot(id).duration);
    const position = Math.min(duration || Number.POSITIVE_INFINITY, safeMediaTime(player?.currentTime || 0));
    this.updateSnapshot(id, { duration, error: null, position, status: 'ready' });
    run.diagnostic.ready();
    this.settleAttachments(id, 'displayed');
    if (run.pendingPlay && this.active && !this.paused && player) {
      run.pendingPlay = false;
      this.playbackHandle?.intent(true);
      player.play();
      this.updateSnapshot(id, { playWhenReady: true });
    }
  }

  private applyPlaying({ isPlaying }: PlayingChangeEventPayload) {
    if (this.sourceState.phase === 'active') this.updateSnapshot(this.sourceState.run.id, { playing: isPlaying });
  }

  private applyTime({ bufferedPosition, currentTime }: TimeUpdateEventPayload) {
    if (this.sourceState.phase !== 'active') return;
    const id = this.sourceState.run.id;
    const snapshot = this.getSnapshot(id);
    const position = Math.min(snapshot.duration || Number.POSITIVE_INFINITY, safeMediaTime(currentTime));
    this.updateSnapshot(id, { position });
    if (Number.isFinite(bufferedPosition) && bufferedPosition >= 0) {
      for (const { admission } of this.attachments.get(id)?.values() || []) admission.progress(bufferedPosition);
    }
  }

  private applySourceLoad({ duration }: Pick<SourceLoadEventPayload, 'duration'>) {
    if (this.sourceState.phase === 'active') {
      this.updateSnapshot(this.sourceState.run.id, { duration: safeMediaTime(duration) });
    }
  }

  private applyPlayToEnd() {
    if (this.sourceState.phase !== 'active') return;
    const id = this.sourceState.run.id;
    const duration = this.getSnapshot(id).duration;
    this.updateSnapshot(id, { playing: false, playWhenReady: false, position: duration });
  }

  private pauseActive() {
    if (this.currentRun) this.currentRun.pendingPlay = false;
    this.playbackHandle?.pause();
    try {
      this.player?.pause();
    } catch {
      // A route deactivation must still complete if native playback has already ended.
    }
    if (this.activeId) this.updateSnapshot(this.activeId, { playing: false, playWhenReady: false });
  }

  private rememberActivePosition() {
    const id = this.activeId;
    if (!id || !this.player) return;
    const duration = safeMediaTime(this.player.duration || this.getSnapshot(id).duration);
    const position = Math.min(duration || Number.POSITIVE_INFINITY, safeMediaTime(this.player.currentTime));
    this.player.pause();
    this.updateSnapshot(id, { duration, playing: false, playWhenReady: false, position });
  }

  private fail(run: AudioLoadRun, error?: unknown) {
    if (!this.owns(run)) return;
    const id = run.id;
    const handle = this.playbackHandle;
    this.finishPreparation(run);
    run.diagnostic.failed(error);
    run.pendingPlay = false;
    this.sourceState = { phase: 'failed', run, handle };
    handle?.pause();
    this.updateSnapshot(id, { error: '音频加载失败', playing: false, playWhenReady: false, status: 'error' });
    this.settleAttachments(id, 'error');
  }

  private settleAttachments(id: string, outcome: 'displayed' | 'error') {
    for (const { admission } of this.attachments.get(id)?.values() || []) {
      if (admission.admitted) admission.settle(outcome);
    }
  }

  private updateSnapshot(id: string, patch: Partial<TopicAudioSnapshot>) {
    const current = this.getSnapshot(id);
    const next = Object.freeze({ ...current, ...patch });
    if (sameSnapshot(current, next)) return;
    this.snapshots.set(id, next);
    for (const listener of this.listeners.get(id) || []) listener();
  }
}

const TopicAudioSessionContext = createContext<TopicAudioSession | null>(null);

export function TopicAudioSessionProvider({
  active,
  children,
  paused,
  runtimeGeneration
}: {
  active: boolean;
  children: ReactNode;
  paused: boolean;
  runtimeGeneration: number;
}) {
  const playback = useMediaPlaybackSession();
  const createSession = useCallback(
    () => new TopicAudioSession({ active, paused, runtimeGeneration }, playback || new MediaPlaybackSession()),
    [active, paused, playback, runtimeGeneration]
  );
  const createSessionRef = useCommittedRef(createSession);
  const [session, setSession] = useState(createSession);
  useLayoutEffect(() => {
    if (session.isDisposed()) {
      setSession(createSessionRef.current());
      return;
    }
    return () => session.dispose();
  }, [createSessionRef, playback, session]);
  useLayoutEffect(() => {
    session.updateGate({ active, paused, runtimeGeneration });
  }, [active, paused, runtimeGeneration, session]);
  return <TopicAudioSessionContext.Provider value={session}>{children}</TopicAudioSessionContext.Provider>;
}

export function useTopicAudioControl({
  admission,
  id,
  mediaContext,
  nodeSeekMediaUserAgent,
  referrerPolicy,
  src
}: TopicAudioDescriptor & { admission: TopicAudioAdmission; id: string }) {
  const session = useContext(TopicAudioSessionContext);
  if (!session) throw new Error('TopicAudioSessionProvider is required');
  const { failure, retry } = admission;
  const subscribe = useCallback((listener: () => void) => session.subscribe(id, listener), [id, session]);
  const getSnapshot = useCallback(() => session.getSnapshot(id), [id, session]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(
    () =>
      session.attach(
        id,
        admission.attachmentKey,
        { mediaContext, nodeSeekMediaUserAgent, referrerPolicy, src },
        admission
      ),
    [admission, admission.attachmentKey, id, mediaContext, nodeSeekMediaUserAgent, referrerPolicy, session, src]
  );
  return useMemo(
    () => ({
      ...snapshot,
      status: failure ? ('error' as const) : snapshot.status,
      onPause: () => session.pause(id),
      onPlay: () => session.play(id),
      onRetry: () => {
        session.requestRetry(id);
        retry();
      },
      onSeek: (position: number) => session.seek(id, position)
    }),
    [failure, id, retry, session, snapshot]
  );
}
