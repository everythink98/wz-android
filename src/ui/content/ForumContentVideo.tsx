import { ActivityIndicator } from 'react-native-paper';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { VideoView, createVideoPlayer, type VideoPlayer } from 'expo-video';
import { useReleasingSharedObjectWithLifecycle } from 'expo-modules-core';
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
import {
  getReadNetworkRuntimeSnapshot,
  useReadNetworkRuntimeSnapshot,
  type ReadNetworkRuntimeSnapshot
} from '@/platform/network/readNetworkRuntime';
import { readerRadii, type ReaderTheme } from '@/ui/theme/tokens';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

const VIDEO_TIME_UPDATE_INTERVAL_SECONDS = 1;
const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9;
const MIN_VIDEO_ASPECT_RATIO = 1 / 2;

function videoAspectRatio(size: { height?: number; width?: number } | null | undefined) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
    ? Math.max(MIN_VIDEO_ASPECT_RATIO, width / height)
    : DEFAULT_VIDEO_ASPECT_RATIO;
}

export type ForumContentMediaAdmission = {
  admitted: boolean;
  attemptId: string;
  failure: 'error' | 'timeout' | null;
  progress: (value: number) => void;
  retry: () => void;
  settle: (outcome: 'displayed' | 'error') => void;
};

const UNMANAGED_MEDIA_ADMISSION: ForumContentMediaAdmission = {
  admitted: true,
  attemptId: 'unmanaged',
  failure: null,
  progress: () => undefined,
  retry: () => undefined,
  settle: () => undefined
};

type ForumContentVideoProps = {
  admission?: ForumContentMediaAdmission;
  boundarySpacing?: StyleProp<ViewStyle>;
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
  theme: ReaderTheme;
};

type ForumMediaPlayerSource = Awaited<ReturnType<typeof forumMediaPlayerSourceFromUrl>>;

type VideoRuntimeLeaseSnapshot = {
  owner: VideoRuntimeLease;
  admissionAttemptId: string;
  generation: number;
  requestKey: string;
} & ({ status: 'acquiring' | 'failed' } | { status: 'retained'; source: ForumMediaPlayerSource });

type PhysicalVideoLease = 'unclaimed' | 'held' | 'release-scheduled' | 'released';

/** The runtime retain survives row recycling until its native fullscreen player is disposed. */
class VideoRuntimeLease {
  private phase: 'acquiring' | 'resolving' | 'retained' | 'failed' | 'retired' = 'acquiring';
  private physicalLease: PhysicalVideoLease = 'unclaimed';
  private handle: MediaPlaybackHandle | null = null;
  private readonly diagnostic: ReturnType<typeof playerLoadDiagnosticAttempt>;

  constructor(
    readonly key: string,
    private generation: number,
    private profile: Pick<ForumContentVideoProps, 'mediaContext' | 'nodeSeekMediaUserAgent' | 'referrerPolicy' | 'src'>,
    private admission: ForumContentMediaAdmission,
    private requestKey: string,
    private publish: (snapshot: VideoRuntimeLeaseSnapshot) => void,
    private retryGeneration: (generation: number) => void
  ) {
    this.diagnostic = playerLoadDiagnosticAttempt(profile.src, 'video', generation);
  }

  private snapshot(value: { status: 'acquiring' | 'failed' } | { status: 'retained'; source: ForumMediaPlayerSource }) {
    this.publish({
      owner: this,
      admissionAttemptId: this.admission.attemptId,
      generation: this.generation,
      requestKey: this.requestKey,
      ...value
    });
  }

  async start() {
    this.diagnostic.stage('runtime-lease');
    this.snapshot({ status: 'acquiring' });
    try {
      const lease = await retainReadNetworkRuntimeGeneration(this.generation);
      if (!lease?.retained) {
        if (this.phase === 'retired') return;
        const currentGeneration = lease?.generation ?? getReadNetworkRuntimeSnapshot().generation;
        if (
          Number.isSafeInteger(currentGeneration) &&
          currentGeneration >= 0 &&
          currentGeneration !== this.generation
        ) {
          this.retryGeneration(currentGeneration);
        } else {
          this.failed();
        }
        return;
      }
      this.physicalLease = 'held';
      if (this.phase === 'retired') {
        this.release();
        return;
      }
      this.phase = 'resolving';
      const source = await forumMediaPlayerSourceFromUrl(this.profile.src, {
        kind: 'video',
        mediaContext: this.profile.mediaContext,
        nodeSeekUserAgent: this.profile.nodeSeekMediaUserAgent,
        referrerPolicy: this.profile.referrerPolicy,
        runtimeGeneration: this.generation
      });
      if (this.isRetired()) return;
      this.phase = 'retained';
      this.diagnostic.stage('player-replace');
      this.snapshot({ status: 'retained', source });
    } catch (error) {
      this.failed(error);
    }
  }

  private isRetired() {
    return this.phase === 'retired';
  }

  attach(handle: MediaPlaybackHandle) {
    this.handle = handle;
  }

  status(status: string, error?: unknown) {
    if (this.phase !== 'retained') return false;
    if (status === 'readyToPlay') {
      this.diagnostic.ready();
      this.admission.settle('displayed');
    } else if (status === 'error') {
      this.diagnostic.failed(error);
      this.admission.settle('error');
    }
    return true;
  }

  private failed(error?: unknown) {
    if (this.phase === 'retired') return;
    this.phase = 'failed';
    this.diagnostic.failed(error);
    this.snapshot({ status: 'failed' });
    this.admission.settle('error');
  }

  retire() {
    if (this.phase === 'retired') return;
    this.phase = 'retired';
    this.diagnostic.canceled();
    if (this.physicalLease !== 'held') return;
    this.physicalLease = 'release-scheduled';
    if (this.handle) this.handle.afterDispose(() => this.release());
    else this.release();
  }

  private release() {
    if (this.physicalLease !== 'held' && this.physicalLease !== 'release-scheduled') return;
    this.physicalLease = 'released';
    this.handle = null;
    void releaseReadNetworkRuntimeGeneration(this.generation).catch(() => undefined);
  }
}

export function ForumContentVideo({ admission = UNMANAGED_MEDIA_ADMISSION, ...props }: ForumContentVideoProps) {
  return admission.attemptId === 'unmanaged' ? (
    <UnmanagedForumContentVideo admission={admission} {...props} />
  ) : (
    <ForumContentVideoRuntime admission={admission} runtimeSnapshot={null} {...props} />
  );
}

function UnmanagedForumContentVideo({
  admission,
  ...props
}: ForumContentVideoProps & { admission: ForumContentMediaAdmission }) {
  const runtimeSnapshot = useReadNetworkRuntimeSnapshot();
  return <ForumContentVideoRuntime admission={admission} runtimeSnapshot={runtimeSnapshot} {...props} />;
}

function ForumContentVideoRuntime({
  admission,
  boundarySpacing,
  mediaContext,
  nodeSeekMediaUserAgent,
  referrerPolicy,
  runtimeSnapshot,
  src,
  theme
}: Required<Pick<ForumContentVideoProps, 'admission' | 'mediaContext' | 'src' | 'theme'>> &
  Pick<ForumContentVideoProps, 'boundarySpacing' | 'nodeSeekMediaUserAgent' | 'referrerPolicy'> & {
    runtimeSnapshot: ReadNetworkRuntimeSnapshot | null;
  }) {
  const retryRuntimeGeneration =
    runtimeSnapshot?.triggerSource === mediaContext.contentSource ? runtimeSnapshot.generation : 0;
  const [playerGeneration, setPlayerGeneration] = useState(() => getReadNetworkRuntimeSnapshot().generation);
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [runtimeLease, setRuntimeLease] = useState<VideoRuntimeLeaseSnapshot | null>(null);
  const requestKey = JSON.stringify([mediaContext, nodeSeekMediaUserAgent, referrerPolicy, src]);
  const request = useCommittedRef({ mediaContext, nodeSeekMediaUserAgent, referrerPolicy, src });
  const pendingRetryGeneration = useRef(0);
  const acquiredAttempt = useRef(admission.attemptId);
  const hasBeenReady = useRef(false);
  const activeLease = useRef<VideoRuntimeLease | null>(null);
  const leaseKey = JSON.stringify([admission.attemptId, playerGeneration, requestKey]);
  const renderingLease = runtimeLease?.status === 'retained' ? runtimeLease.owner : null;
  const handlePlayer = useCallback(
    (handle: MediaPlaybackHandle) => {
      if (renderingLease && activeLease.current === renderingLease) renderingLease.attach(handle);
    },
    [renderingLease]
  );

  useEffect(() => {
    if (retryRuntimeGeneration > playerGeneration) {
      pendingRetryGeneration.current = Math.max(pendingRetryGeneration.current, retryRuntimeGeneration);
    }
    if (pendingRetryGeneration.current <= playerGeneration) return;
    if (
      playerStatus === 'error' ||
      (!hasBeenReady.current && (playerStatus === 'idle' || playerStatus === 'loading'))
    ) {
      pendingRetryGeneration.current = 0;
      setPlayerStatus('idle');
      setPlayerGeneration(runtimeSnapshot?.generation ?? playerGeneration);
    }
  }, [playerGeneration, playerStatus, retryRuntimeGeneration, runtimeSnapshot?.generation]);

  useEffect(() => {
    if (!admission.admitted) {
      setRuntimeLease(null);
      return undefined;
    }
    if (acquiredAttempt.current !== admission.attemptId) {
      acquiredAttempt.current = admission.attemptId;
      hasBeenReady.current = false;
      const generation = getReadNetworkRuntimeSnapshot().generation;
      if (generation !== playerGeneration) {
        setPlayerGeneration(generation);
        return undefined;
      }
    }
    const owner = new VideoRuntimeLease(
      leaseKey,
      playerGeneration,
      request.current,
      admission,
      requestKey,
      setRuntimeLease,
      setPlayerGeneration
    );
    activeLease.current = owner;
    setPlayerStatus('idle');
    void owner.start();
    return () => {
      if (activeLease.current === owner) activeLease.current = null;
      owner.retire();
    };
  }, [admission.admitted, admission.attemptId, admission.settle, leaseKey, playerGeneration, request, requestKey, src]);

  useEffect(() => {
    if (
      runtimeSnapshot &&
      runtimeLease?.generation === playerGeneration &&
      runtimeLease.status === 'failed' &&
      runtimeSnapshot.generation > playerGeneration
    ) {
      setPlayerGeneration(runtimeSnapshot.generation);
    }
  }, [playerGeneration, runtimeLease, runtimeSnapshot]);

  const handleStatusChange = useCallback(
    (status: string, error?: unknown) => {
      const owner = renderingLease;
      if (!owner || activeLease.current !== owner) return;
      const nextStatus = status || 'idle';
      if (!owner.status(nextStatus, error)) return;
      setPlayerStatus(nextStatus);
      if (nextStatus === 'readyToPlay') hasBeenReady.current = true;
    },
    [renderingLease]
  );

  if (!admission.admitted) {
    return (
      <View
        style={[styles.frame, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
        testID="forum-content-video-frame"
      >
        {admission.failure ? (
          <Pressable
            accessibilityLabel="视频加载失败，点按重试"
            accessibilityRole="button"
            style={styles.videoState}
            onPress={admission.retry}
          >
            <Text style={{ color: theme.muted }}>视频加载失败，点按重试</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (
    runtimeLease?.admissionAttemptId !== admission.attemptId ||
    runtimeLease.requestKey !== requestKey ||
    runtimeLease.generation !== playerGeneration ||
    runtimeLease.status !== 'retained'
  ) {
    const failed = runtimeLease?.generation === playerGeneration && runtimeLease.status === 'failed';
    return (
      <View
        style={[styles.frame, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
        testID="forum-content-video-frame"
      >
        <View style={styles.videoState}>
          {failed ? (
            <Text style={{ color: theme.muted }}>视频加载失败</Text>
          ) : (
            <ActivityIndicator color={theme.primary} />
          )}
        </View>
      </View>
    );
  }

  return (
    <ForumContentVideoPlayer
      key={`${mediaContext.sessionIdentity}:${src}:admission:${admission.attemptId}:runtime:${playerGeneration}`}
      boundarySpacing={boundarySpacing}
      mediaContext={mediaContext}
      source={runtimeLease.source}
      src={src}
      theme={theme}
      onProgress={admission.progress}
      onHandle={handlePlayer}
      onStatusChange={handleStatusChange}
    />
  );
}

function ForumContentVideoPlayer({
  boundarySpacing,
  mediaContext,
  onProgress,
  onHandle,
  onStatusChange,
  source,
  src,
  theme
}: Omit<ForumContentVideoProps, 'admission' | 'nodeSeekMediaUserAgent' | 'referrerPolicy'> & {
  onProgress: (value: number) => void;
  onHandle: (handle: MediaPlaybackHandle) => void;
  onStatusChange: (status: string, error?: unknown) => void;
  source: ForumMediaPlayerSource;
}) {
  const sourceKey = JSON.stringify(source);
  const releaseHandles = useRef(new WeakMap<VideoPlayer, MediaPlaybackHandle>());
  const player = useReleasingSharedObjectWithLifecycle(
    {
      factory: () => {
        const player = createVideoPlayer(null);
        player.timeUpdateEventInterval = VIDEO_TIME_UPDATE_INTERVAL_SECONDS;
        return player;
      },
      release: (player) => {
        const handle = releaseHandles.current.get(player);
        if (handle) handle.detach(() => player.release());
        else player.release();
      }
    },
    [sourceKey]
  );
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [presentation, setPresentation] = useState<{
    player: VideoPlayer;
    layout: 'waiting' | 'measured';
    frame: 'waiting' | 'rendered';
    playback: 'playing-or-paused' | 'ended';
  }>(() => ({ player, layout: 'waiting', frame: 'waiting', playback: 'playing-or-paused' }));
  const currentPlayer = useCommittedRef(player);
  const observePlayer = useCallback(
    (target: VideoPlayer, event: 'layout' | 'frame' | 'playing' | 'ended') => {
      if (currentPlayer.current !== target) return;
      setPresentation((previous) => {
        const snapshot =
          previous.player === target
            ? previous
            : {
                player: target,
                layout: 'waiting' as const,
                frame: 'waiting' as const,
                playback: 'playing-or-paused' as const
              };
        if (event === 'layout') return snapshot.layout === 'measured' ? snapshot : { ...snapshot, layout: 'measured' };
        if (event === 'frame') return snapshot.frame === 'rendered' ? snapshot : { ...snapshot, frame: 'rendered' };
        const playback = event === 'ended' ? 'ended' : 'playing-or-paused';
        return snapshot.playback === playback ? snapshot : { ...snapshot, playback };
      });
    },
    [currentPlayer]
  );
  const laidOut = presentation.player === player && presentation.layout === 'measured';
  useEffect(() => {
    if (!laidOut) return;
    let active = true;
    void player.replaceAsync(sourceRef.current).catch((error) => {
      if (active) statusCallback.current('error', error);
    });
    return () => {
      active = false;
    };
  }, [laidOut, player]);
  const routePlayback = useMediaPlaybackSession();
  const [fallbackPlayback] = useState(() => new MediaPlaybackSession());
  const playback = routePlayback || fallbackPlayback;
  const mediaIdentity = JSON.stringify([mediaContext.sessionIdentity, src, source.headers?.Referer || 'none']);
  useLayoutEffect(() => {
    const handle = playback.attach(player, mediaIdentity, 'video', {
      onTimeout: () => statusCallback.current('error', new Error('Video buffering timed out'))
    });
    releaseHandles.current.set(player, handle);
    onHandle(handle);
    return () => {
      handle.detach(() => undefined);
    };
  }, [mediaIdentity, onHandle, playback, player]);
  const ended = presentation.player === player && presentation.playback === 'ended';
  const hasReadyFrame = presentation.player === player && presentation.frame === 'rendered';
  useEffect(() => {
    const endSubscription = player.addListener('playToEnd', () => {
      if (currentPlayer.current === player && player.duration > 0) observePlayer(player, 'ended');
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) observePlayer(player, 'playing');
    });
    return () => {
      endSubscription.remove();
      playingSubscription.remove();
    };
  }, [currentPlayer, observePlayer, player]);
  const lastBufferedPositionRef = useRef(
    Number.isFinite(player.bufferedPosition) ? Math.max(0, player.bufferedPosition) : 0
  );
  const statusEvent = useEvent(player, 'statusChange', { status: player.status });
  const status = statusEvent.status === 'idle' && ended ? 'ended' : statusEvent.status;
  const videoTrack = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack }).videoTrack;
  const timeUpdate = useEvent(player, 'timeUpdate', {
    bufferedPosition: player.bufferedPosition,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    currentTime: player.currentTime
  });
  useEffect(() => {
    if (
      !Number.isFinite(timeUpdate.bufferedPosition) ||
      timeUpdate.bufferedPosition <= lastBufferedPositionRef.current
    ) {
      return;
    }
    lastBufferedPositionRef.current = timeUpdate.bufferedPosition;
    onProgress(timeUpdate.bufferedPosition);
  }, [onProgress, timeUpdate.bufferedPosition]);
  useEffect(() => onStatusChange(status || 'idle', statusEvent.error), [onStatusChange, status, statusEvent.error]);
  const loadFailed = status === 'error';
  const loading = !loadFailed && (status === 'idle' || status === 'loading' || (!hasReadyFrame && !ended));
  return (
    <View
      style={[
        styles.frame,
        { aspectRatio: videoAspectRatio(videoTrack?.size), borderColor: theme.line, backgroundColor: theme.surface2 },
        boundarySpacing
      ]}
      testID="forum-content-video-frame"
    >
      <VideoView
        key={sourceKey}
        onLayout={({ nativeEvent: { layout } }) => {
          if (layout.width > 0 && layout.height > 0) observePlayer(player, 'layout');
        }}
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        onFirstFrameRender={() => observePlayer(player, 'frame')}
        player={player}
        style={styles.video}
        surfaceType="textureView"
      />
      {loading || loadFailed ? (
        <View pointerEvents="none" style={styles.videoState}>
          {loadFailed ? (
            <Text style={{ color: theme.muted }}>视频加载失败</Text>
          ) : (
            <ActivityIndicator color={theme.primary} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
    borderRadius: readerRadii.content,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    marginTop: 8,
    overflow: 'hidden'
  },
  video: {
    flex: 1
  },
  videoState: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
