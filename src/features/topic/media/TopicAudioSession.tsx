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
import {
  releaseReadNetworkRuntimeGeneration,
  retainReadNetworkRuntimeGeneration
} from '@/platform/network/networkProxy';

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
  position: number;
  status: 'error' | 'idle' | 'loading' | 'ready';
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
    left.position === right.position &&
    left.status === right.status
  );
}

class TopicAudioSession {
  private acceptPlayerEvents = false;
  private active: boolean;
  private activeId: string | null = null;
  private attachments = new Map<string, Map<string, TopicAudioAttachment>>();
  private disposed = false;
  private listeners = new Map<string, Set<() => void>>();
  private loadRevision = 0;
  private paused: boolean;
  private pendingPlay = false;
  private player: VideoPlayer | null = null;
  private playerSubscriptions: { remove: () => void }[] = [];
  private replaceQueue: Promise<void> = Promise.resolve();
  private retainedGeneration: number | null = null;
  private retryRequested = new Set<string>();
  private runtimeGeneration: number;
  private snapshots = new Map<string, TopicAudioSnapshot>();
  private sources = new Map<string, TopicAudioDescriptor>();

  constructor({ active, paused, runtimeGeneration }: { active: boolean; paused: boolean; runtimeGeneration: number }) {
    this.active = active;
    this.paused = paused;
    this.runtimeGeneration = runtimeGeneration;
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
      if (this.activeId) this.load(this.activeId, false);
    }
  }

  play(id: string) {
    if (!this.active || this.paused) return;
    const snapshot = this.getSnapshot(id);
    if (this.activeId === id && snapshot.status === 'ready' && this.player) {
      this.pendingPlay = false;
      if (snapshot.duration > 0 && snapshot.position >= snapshot.duration) {
        this.player.replay();
        this.updateSnapshot(id, { position: 0 });
      } else {
        this.player.play();
      }
      this.updateSnapshot(id, { playing: true });
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
    if (this.activeId === id && this.player) this.player.currentTime = nextPosition;
    this.updateSnapshot(id, { position: nextPosition });
  }

  requestRetry(id: string) {
    this.retryRequested.add(id);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadRevision += 1;
    this.pendingPlay = false;
    this.acceptPlayerEvents = false;
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

  private load(id: string, playWhenReady: boolean) {
    const descriptor = this.sources.get(id);
    if (!descriptor || this.disposed) return;
    if (this.activeId) this.rememberActivePosition();
    this.activeId = id;
    this.pendingPlay = playWhenReady && this.active && !this.paused;
    const revision = ++this.loadRevision;
    const generation = this.runtimeGeneration;
    const restorePosition = this.getSnapshot(id).position;
    this.updateSnapshot(id, { error: null, playing: false, status: 'loading' });
    this.replaceQueue = this.replaceQueue
      .catch(() => undefined)
      .then(() => this.replaceSource({ descriptor, generation, id, restorePosition, revision }));
  }

  private async replaceSource({
    descriptor,
    generation,
    id,
    restorePosition,
    revision
  }: {
    descriptor: TopicAudioDescriptor;
    generation: number;
    id: string;
    restorePosition: number;
    revision: number;
  }): Promise<void> {
    if (this.disposed || revision !== this.loadRevision) return;
    const targetGeneration = generation;
    let previousGeneration = this.retainedGeneration;
    if (previousGeneration !== targetGeneration) {
      const lease = await retainReadNetworkRuntimeGeneration(targetGeneration).catch(() => null);
      if (this.disposed || revision !== this.loadRevision) {
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
          return this.replaceSource({ descriptor, generation: currentGeneration, id, restorePosition, revision });
        }
        this.fail(id);
        return;
      }
      this.retainedGeneration = targetGeneration;
    } else {
      previousGeneration = null;
    }
    try {
      const player = this.ensurePlayer();
      this.acceptPlayerEvents = false;
      await player.replaceAsync(
        forumMediaPlayerSourceFromUrl(descriptor.src, {
          kind: 'audio',
          mediaContext: descriptor.mediaContext,
          nodeSeekUserAgent: descriptor.nodeSeekMediaUserAgent,
          referrerPolicy: descriptor.referrerPolicy,
          runtimeGeneration: targetGeneration
        })
      );
      if (previousGeneration !== null) {
        void releaseReadNetworkRuntimeGeneration(previousGeneration).catch(() => undefined);
      }
      if (this.disposed || revision !== this.loadRevision || this.activeId !== id) return;
      player.currentTime = restorePosition;
      this.acceptPlayerEvents = true;
      this.applyStatus({ status: player.status });
    } catch {
      if (previousGeneration !== null) {
        void releaseReadNetworkRuntimeGeneration(previousGeneration).catch(() => undefined);
      }
      if (!this.disposed && revision === this.loadRevision && this.activeId === id) this.fail(id);
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

  private applyStatus({ status }: Pick<StatusChangeEventPayload, 'status'>) {
    const id = this.activeId;
    if (!id || !this.acceptPlayerEvents) return;
    if (status === 'error') {
      this.fail(id);
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
      this.updateSnapshot(id, { status: 'loading' });
      return;
    }
    const player = this.player;
    const duration = safeMediaTime(player?.duration || this.getSnapshot(id).duration);
    const position = Math.min(duration || Number.POSITIVE_INFINITY, safeMediaTime(player?.currentTime || 0));
    this.updateSnapshot(id, { duration, error: null, position, status: 'ready' });
    this.settleAttachments(id, 'displayed');
    if (this.pendingPlay && this.active && !this.paused && player) {
      this.pendingPlay = false;
      player.play();
      this.updateSnapshot(id, { playing: true });
    }
  }

  private applyPlaying({ isPlaying }: PlayingChangeEventPayload) {
    if (this.activeId && this.acceptPlayerEvents) this.updateSnapshot(this.activeId, { playing: isPlaying });
  }

  private applyTime({ bufferedPosition, currentTime }: TimeUpdateEventPayload) {
    const id = this.activeId;
    if (!id || !this.acceptPlayerEvents) return;
    const snapshot = this.getSnapshot(id);
    const position = Math.min(snapshot.duration || Number.POSITIVE_INFINITY, safeMediaTime(currentTime));
    this.updateSnapshot(id, { position });
    if (Number.isFinite(bufferedPosition) && bufferedPosition >= 0) {
      for (const { admission } of this.attachments.get(id)?.values() || []) admission.progress(bufferedPosition);
    }
  }

  private applySourceLoad({ duration }: Pick<SourceLoadEventPayload, 'duration'>) {
    if (this.activeId && this.acceptPlayerEvents) {
      this.updateSnapshot(this.activeId, { duration: safeMediaTime(duration) });
    }
  }

  private applyPlayToEnd() {
    const id = this.activeId;
    if (!id || !this.acceptPlayerEvents) return;
    const duration = this.getSnapshot(id).duration;
    this.updateSnapshot(id, { playing: false, position: duration });
  }

  private pauseActive() {
    this.pendingPlay = false;
    try {
      this.player?.pause();
    } catch {
      // A route deactivation must still complete if native playback has already ended.
    }
    if (this.activeId) this.updateSnapshot(this.activeId, { playing: false });
  }

  private rememberActivePosition() {
    const id = this.activeId;
    if (!id || !this.player) return;
    const duration = safeMediaTime(this.player.duration || this.getSnapshot(id).duration);
    const position = Math.min(duration || Number.POSITIVE_INFINITY, safeMediaTime(this.player.currentTime));
    this.player.pause();
    this.updateSnapshot(id, { duration, playing: false, position });
  }

  private fail(id: string) {
    this.pendingPlay = false;
    this.updateSnapshot(id, { error: '音频加载失败', playing: false, status: 'error' });
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
  const [session] = useState(() => new TopicAudioSession({ active, paused, runtimeGeneration }));
  useLayoutEffect(() => {
    session.updateGate({ active, paused, runtimeGeneration });
  }, [active, paused, runtimeGeneration, session]);
  useEffect(() => () => session.dispose(), [session]);
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
