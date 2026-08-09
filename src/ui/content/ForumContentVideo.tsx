import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import { Maximize2, Play } from 'lucide-react-native';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { imageRequestHeadersForUrl } from '@/platform/media/imageRequestSource';
import {
  releaseReadNetworkRuntimeGeneration,
  retainReadNetworkRuntimeGeneration
} from '@/platform/network/networkProxy';
import {
  getReadNetworkRuntimeSnapshot,
  useReadNetworkRuntimeSnapshot,
  type ReadNetworkRuntimeSnapshot
} from '@/platform/network/readNetworkRuntime';

const VIDEO_ACCEPT = 'video/webm,video/mp4,video/*,*/*;q=0.8';
const VIDEO_TIME_UPDATE_INTERVAL_SECONDS = 1;
const FORUM_MEDIA_KIND_HEADER = 'X-WZ-Forum-Media-Kind';
const READ_NETWORK_GENERATION_HEADER = 'X-WZ-Read-Network-Generation';

export type ForumContentVideoAdmission = {
  admitted: boolean;
  attemptId: string;
  failure: 'error' | 'timeout' | null;
  progress: (value: number) => void;
  retry: () => void;
  settle: (outcome: 'displayed' | 'error') => void;
};

const UNMANAGED_VIDEO_ADMISSION: ForumContentVideoAdmission = {
  admitted: true,
  attemptId: 'unmanaged',
  failure: null,
  progress: () => undefined,
  retry: () => undefined,
  settle: () => undefined
};

type ForumContentVideoProps = {
  admission?: ForumContentVideoAdmission;
  boundarySpacing?: StyleProp<ViewStyle>;
  headers?: Record<string, string>;
  mediaContext: ForumMediaRequestContext;
  src: string;
  theme: ReaderTheme;
};

export function ForumContentVideo({ admission = UNMANAGED_VIDEO_ADMISSION, ...props }: ForumContentVideoProps) {
  return admission.attemptId === 'unmanaged' ? (
    <UnmanagedForumContentVideo admission={admission} {...props} />
  ) : (
    <ForumContentVideoRuntime admission={admission} runtimeSnapshot={null} {...props} />
  );
}

function UnmanagedForumContentVideo({
  admission,
  ...props
}: ForumContentVideoProps & { admission: ForumContentVideoAdmission }) {
  const runtimeSnapshot = useReadNetworkRuntimeSnapshot();
  return <ForumContentVideoRuntime admission={admission} runtimeSnapshot={runtimeSnapshot} {...props} />;
}

function ForumContentVideoRuntime({
  admission,
  boundarySpacing,
  headers,
  mediaContext,
  runtimeSnapshot,
  src,
  theme
}: Required<Pick<ForumContentVideoProps, 'admission' | 'mediaContext' | 'src' | 'theme'>> &
  Pick<ForumContentVideoProps, 'boundarySpacing' | 'headers'> & {
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
    if (pendingRetryGeneration.current <= playerGeneration) {
      return;
    }
    if (playerStatus === 'idle' || playerStatus === 'loading' || playerStatus === 'error') {
      pendingRetryGeneration.current = 0;
      setPlayerStatus('idle');
      setPlayerGeneration(runtimeSnapshot?.generation ?? playerGeneration);
    }
  }, [admission.progress, playerGeneration, playerStatus, retryRuntimeGeneration, runtimeSnapshot?.generation]);

  useEffect(() => {
    if (!admission.admitted) {
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
          setRuntimeLease({
            admissionAttemptId: admission.attemptId,
            generation: playerGeneration,
            status: 'failed'
          });
          admission.settle('error');
        }
      });
    return () => {
      disposed = true;
      if (retained) {
        void releaseReadNetworkRuntimeGeneration(playerGeneration).catch(() => undefined);
      }
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
      if (nextStatus === 'readyToPlay') {
        admission.settle('displayed');
      } else if (nextStatus === 'error') {
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
      headers={headers}
      mediaContext={mediaContext}
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
  headers,
  mediaContext,
  onProgress,
  onStatusChange,
  runtimeGeneration,
  src,
  theme
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  headers?: Record<string, string>;
  mediaContext: ForumMediaRequestContext;
  onProgress: (value: number) => void;
  onStatusChange: (status: string) => void;
  runtimeGeneration: number;
  src: string;
  theme: ReaderTheme;
}) {
  const videoRef = useRef<VideoView>(null);
  const requestHeaders = useMemo(
    () => ({
      ...(imageRequestHeadersForUrl(src, { mediaContext }) || {}),
      Accept: VIDEO_ACCEPT,
      ...(headers || {}),
      [FORUM_MEDIA_KIND_HEADER]: 'video',
      [READ_NETWORK_GENERATION_HEADER]: String(runtimeGeneration)
    }),
    [headers, mediaContext, runtimeGeneration, src]
  );
  const source = useMemo<VideoSource>(
    () => ({
      uri: src,
      ...(Object.keys(requestHeaders).length ? { headers: requestHeaders } : {}),
      contentType: 'progressive'
    }),
    [mediaContext.sessionIdentity, requestHeaders, src]
  );
  const player = useVideoPlayer(source);
  const lastBufferedPositionRef = useRef(
    Number.isFinite(player.bufferedPosition) ? Math.max(0, player.bufferedPosition) : 0
  );
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  const bufferedPosition = useEvent(player, 'timeUpdate', {
    bufferedPosition: player.bufferedPosition,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    currentTime: player.currentTime
  }).bufferedPosition;
  useEffect(() => {
    player.timeUpdateEventInterval = VIDEO_TIME_UPDATE_INTERVAL_SECONDS;
    return () => {
      player.timeUpdateEventInterval = 0;
    };
  }, [player]);
  useEffect(() => {
    if (!Number.isFinite(bufferedPosition) || bufferedPosition <= lastBufferedPositionRef.current) {
      return;
    }
    lastBufferedPositionRef.current = bufferedPosition;
    onProgress(bufferedPosition);
  }, [bufferedPosition, onProgress]);
  useEffect(() => onStatusChange(status || 'idle'), [onStatusChange, status]);
  const loadFailed = status === 'error';
  const loading = status === 'idle' || status === 'loading';
  const togglePlayback = useCallback(() => {
    if (loadFailed) {
      return;
    }
    if (isPlaying) {
      player.pause();
      return;
    }
    player.play();
  }, [isPlaying, loadFailed, player]);
  const enterFullscreen = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    void videoRef.current?.enterFullscreen();
  }, []);
  return (
    <View
      style={[styles.frame, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
      testID="forum-content-video-frame"
    >
      <VideoView
        allowsFullscreen
        contentFit="contain"
        nativeControls={false}
        player={player}
        ref={videoRef}
        style={styles.video}
        surfaceType="textureView"
      />
      {loading || loadFailed ? (
        <View style={styles.videoState}>
          {loadFailed ? (
            <Text style={{ color: theme.muted }}>视频加载失败</Text>
          ) : (
            <ActivityIndicator color={theme.primary} />
          )}
        </View>
      ) : null}
      <Pressable
        accessibilityLabel={isPlaying ? '暂停视频' : '播放视频'}
        accessibilityRole="button"
        onPress={togglePlayback}
        style={styles.touchLayer}
      >
        {!loadFailed && !isPlaying ? (
          <View style={[styles.centerButton, { backgroundColor: theme.surface }]}>
            <Play size={34} color={theme.ink} fill={theme.ink} strokeWidth={1.8} />
          </View>
        ) : null}
      </Pressable>
      {!loadFailed ? (
        <Pressable
          accessibilityLabel="全屏播放"
          accessibilityRole="button"
          onPress={enterFullscreen}
          style={styles.fullscreenButton}
        >
          <Maximize2 size={24} color="#fff" strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    aspectRatio: 16 / 9,
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
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center'
  },
  touchLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  centerButton: {
    alignItems: 'center',
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    opacity: 0.94,
    width: 68
  },
  fullscreenButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    borderRadius: 22,
    bottom: 18,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 18,
    width: 44
  }
});
