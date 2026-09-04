import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { forumMediaPlayerSourceFromUrl } from '@/platform/media/imageRequestSource';
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

function configureVideoPlayer(player: VideoPlayer) {
  player.timeUpdateEventInterval = VIDEO_TIME_UPDATE_INTERVAL_SECONDS;
}

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
  poster?: ReactNode;
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
  poster,
  referrerPolicy,
  runtimeSnapshot,
  src,
  theme
}: Required<Pick<ForumContentVideoProps, 'admission' | 'mediaContext' | 'src' | 'theme'>> &
  Pick<ForumContentVideoProps, 'boundarySpacing' | 'nodeSeekMediaUserAgent' | 'poster' | 'referrerPolicy'> & {
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

  useEffect(() => {
    if (retryRuntimeGeneration > playerGeneration) {
      pendingRetryGeneration.current = Math.max(pendingRetryGeneration.current, retryRuntimeGeneration);
    }
    if (pendingRetryGeneration.current <= playerGeneration) return;
    if (playerStatus === 'idle' || playerStatus === 'loading' || playerStatus === 'error') {
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
    let disposed = false;
    let retained = false;
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
            }
          }
          return;
        }
        if (disposed) {
          void releaseReadNetworkRuntimeGeneration(playerGeneration).catch(() => undefined);
          return;
        }
        retained = true;
        setRuntimeLease({
          admissionAttemptId: admission.attemptId,
          generation: playerGeneration,
          status: 'retained'
        });
      })
      .catch(() => {
        if (!disposed) {
          setRuntimeLease({ admissionAttemptId: admission.attemptId, generation: playerGeneration, status: 'failed' });
          admission.settle('error');
        }
      });
    return () => {
      disposed = true;
      if (retained) void releaseReadNetworkRuntimeGeneration(playerGeneration).catch(() => undefined);
    };
  }, [admission.admitted, admission.attemptId, admission.settle, playerGeneration, runtimeSnapshot]);

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
    (status: string) => {
      const nextStatus = status || 'idle';
      setPlayerStatus(nextStatus);
      if (nextStatus === 'readyToPlay') admission.settle('displayed');
      else if (nextStatus === 'error') admission.settle('error');
    },
    [admission.settle]
  );

  if (!admission.admitted) {
    return (
      <View
        style={[styles.frame, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
        testID="forum-content-video-frame"
      >
        <VideoPosterLayer poster={poster} />
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
        <VideoPosterLayer poster={poster} />
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
      poster={poster}
      referrerPolicy={referrerPolicy}
      runtimeGeneration={playerGeneration}
      src={src}
      theme={theme}
      onProgress={admission.progress}
      onStatusChange={handleStatusChange}
    />
  );
}

function ForumContentVideoPlayer({
  boundarySpacing,
  mediaContext,
  nodeSeekMediaUserAgent,
  onProgress,
  onStatusChange,
  poster,
  referrerPolicy,
  runtimeGeneration,
  src,
  theme
}: Omit<ForumContentVideoProps, 'admission'> & {
  onProgress: (value: number) => void;
  onStatusChange: (status: string) => void;
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
  const player = useVideoPlayer(source, configureVideoPlayer);
  const lastBufferedPositionRef = useRef(
    Number.isFinite(player.bufferedPosition) ? Math.max(0, player.bufferedPosition) : 0
  );
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
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
  useEffect(() => onStatusChange(status || 'idle'), [onStatusChange, status]);
  const loadFailed = status === 'error';
  const loading = status === 'idle' || status === 'loading';
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
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        player={player}
        style={styles.video}
        surfaceType="textureView"
      />
      {loading ? <VideoPosterLayer poster={poster} /> : null}
      {loading || loadFailed ? (
        <View style={styles.videoState}>
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

function VideoPosterLayer({ poster }: { poster?: ReactNode }) {
  return poster ? (
    <View
      accessibilityElementsHidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.poster}
    >
      {poster}
    </View>
  ) : null;
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
  poster: {
    ...StyleSheet.absoluteFill
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
