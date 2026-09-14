import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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
import type { ReaderTheme } from '@/ui/theme/tokens';

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
  const [runtimeLease, setRuntimeLease] = useState<{
    admissionAttemptId: string;
    generation: number;
    status: 'acquiring' | 'failed' | 'retained';
  } | null>(null);
  const pendingRetryGeneration = useRef(0);
  const acquiredAttempt = useRef(admission.attemptId);
  const hasBeenReady = useRef(false);
  const loadDiagnosticRef = useRef<ReturnType<typeof playerLoadDiagnosticAttempt> | null>(null);
  const playerHandles = useRef(new Map<string, MediaPlaybackHandle>());
  const leaseKey = `${admission.attemptId}:${playerGeneration}`;
  const handlePlayer = useCallback(
    (handle: MediaPlaybackHandle) => {
      playerHandles.current.set(leaseKey, handle);
    },
    [leaseKey]
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
    let disposed = false;
    let retained = false;
    const diagnostic = playerLoadDiagnosticAttempt(src, 'video', playerGeneration);
    loadDiagnosticRef.current = diagnostic;
    diagnostic.stage('runtime-lease');
    setPlayerStatus('idle');
    setRuntimeLease({ admissionAttemptId: admission.attemptId, generation: playerGeneration, status: 'acquiring' });
    void retainReadNetworkRuntimeGeneration(playerGeneration)
      .then((lease) => {
        if (!lease?.retained) {
          if (!disposed) {
            const currentGeneration = lease?.generation ?? getReadNetworkRuntimeSnapshot().generation;
            if (
              Number.isSafeInteger(currentGeneration) &&
              currentGeneration >= 0 &&
              currentGeneration !== playerGeneration
            ) {
              setPlayerGeneration(currentGeneration);
            } else {
              setRuntimeLease({
                admissionAttemptId: admission.attemptId,
                generation: playerGeneration,
                status: 'failed'
              });
              admission.settle('error');
              diagnostic.failed();
            }
          }
          return;
        }
        if (disposed) {
          void releaseReadNetworkRuntimeGeneration(playerGeneration).catch(() => undefined);
          return;
        }
        retained = true;
        diagnostic.stage('player-replace');
        setRuntimeLease({
          admissionAttemptId: admission.attemptId,
          generation: playerGeneration,
          status: 'retained'
        });
      })
      .catch((error) => {
        if (!disposed) {
          diagnostic.failed(error);
          setRuntimeLease({ admissionAttemptId: admission.attemptId, generation: playerGeneration, status: 'failed' });
          admission.settle('error');
        }
      });
    return () => {
      disposed = true;
      diagnostic.canceled();
      if (retained) {
        const release = () => {
          playerHandles.current.delete(leaseKey);
          void releaseReadNetworkRuntimeGeneration(playerGeneration).catch(() => undefined);
        };
        const handle = playerHandles.current.get(leaseKey);
        if (handle) handle.afterDispose(release);
        else release();
      }
    };
  }, [admission.admitted, admission.attemptId, admission.settle, leaseKey, playerGeneration, src]);

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
      const nextStatus = status || 'idle';
      setPlayerStatus(nextStatus);
      if (nextStatus === 'readyToPlay') {
        hasBeenReady.current = true;
        loadDiagnosticRef.current?.ready();
        admission.settle('displayed');
      } else if (nextStatus === 'error') {
        loadDiagnosticRef.current?.failed(error);
        admission.settle('error');
      }
    },
    [admission.settle]
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
      nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
      referrerPolicy={referrerPolicy}
      runtimeGeneration={playerGeneration}
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
  nodeSeekMediaUserAgent,
  onProgress,
  onHandle,
  onStatusChange,
  referrerPolicy,
  runtimeGeneration,
  src,
  theme
}: Omit<ForumContentVideoProps, 'admission'> & {
  onProgress: (value: number) => void;
  onHandle: (handle: MediaPlaybackHandle) => void;
  onStatusChange: (status: string, error?: unknown) => void;
  runtimeGeneration: number;
}) {
  const source = useMemo(
    () =>
      forumMediaPlayerSourceFromUrl(src, {
        kind: 'video',
        mediaContext,
        nodeSeekUserAgent: nodeSeekMediaUserAgent,
        referrerPolicy,
        runtimeGeneration
      }),
    [mediaContext, nodeSeekMediaUserAgent, referrerPolicy, runtimeGeneration, src]
  );
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
  const [laidOutPlayer, setLaidOutPlayer] = useState<VideoPlayer | null>(null);
  useEffect(() => {
    if (laidOutPlayer !== player) return;
    let active = true;
    void player.replaceAsync(sourceRef.current).catch((error) => {
      if (active) statusCallback.current('error', error);
    });
    return () => {
      active = false;
    };
  }, [laidOutPlayer, player]);
  const routePlayback = useMediaPlaybackSession();
  const [playback] = useState(() => routePlayback || new MediaPlaybackSession());
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
  const [ended, setEnded] = useState(false);
  const [renderedPlayer, setRenderedPlayer] = useState<VideoPlayer | null>(null);
  const hasReadyFrame = renderedPlayer === player;
  useEffect(() => {
    setEnded(false);
    const endSubscription = player.addListener('playToEnd', () => {
      if (player.duration > 0) setEnded(true);
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setEnded(false);
    });
    return () => {
      endSubscription.remove();
      playingSubscription.remove();
    };
  }, [player]);
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
          if (layout.width > 0 && layout.height > 0) setLaidOutPlayer(player);
        }}
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        onFirstFrameRender={() => setRenderedPlayer(player)}
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
    borderRadius: 8,
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
