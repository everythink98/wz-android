import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { VideoView, useVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import { Maximize2, Pause, Play } from 'lucide-react-native';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
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
const AUDIO_ACCEPT = 'audio/mpeg,audio/*,*/*;q=0.8';
const VIDEO_TIME_UPDATE_INTERVAL_SECONDS = 1;
const FORUM_MEDIA_KIND_HEADER = 'X-WZ-Forum-Media-Kind';
const READ_NETWORK_GENERATION_HEADER = 'X-WZ-Read-Network-Generation';
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

type ForumContentMediaKind = 'audio' | 'video';

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

type ForumContentMediaProps = {
  admission?: ForumContentMediaAdmission;
  boundarySpacing?: StyleProp<ViewStyle>;
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
  theme: ReaderTheme;
};

type ForumContentVideoProps = ForumContentMediaProps & { poster?: ReactNode };

export function ForumContentVideo(props: ForumContentVideoProps) {
  return <ForumContentMedia mediaKind="video" {...props} />;
}

export function ForumContentAudio(props: ForumContentMediaProps) {
  return <ForumContentMedia mediaKind="audio" {...props} />;
}

function ForumContentMedia({
  admission = UNMANAGED_MEDIA_ADMISSION,
  mediaKind,
  ...props
}: ForumContentVideoProps & { mediaKind: ForumContentMediaKind }) {
  return admission.attemptId === 'unmanaged' ? (
    <UnmanagedForumContentMedia admission={admission} mediaKind={mediaKind} {...props} />
  ) : (
    <ForumContentMediaRuntime admission={admission} mediaKind={mediaKind} runtimeSnapshot={null} {...props} />
  );
}

function UnmanagedForumContentMedia({
  admission,
  ...props
}: ForumContentVideoProps & { admission: ForumContentMediaAdmission; mediaKind: ForumContentMediaKind }) {
  const runtimeSnapshot = useReadNetworkRuntimeSnapshot();
  return <ForumContentMediaRuntime admission={admission} runtimeSnapshot={runtimeSnapshot} {...props} />;
}

function ForumContentMediaRuntime({
  admission,
  boundarySpacing,
  mediaContext,
  mediaKind,
  nodeSeekMediaUserAgent,
  poster,
  referrerPolicy,
  runtimeSnapshot,
  src,
  theme
}: Required<Pick<ForumContentVideoProps, 'admission' | 'mediaContext' | 'src' | 'theme'>> &
  Pick<ForumContentVideoProps, 'boundarySpacing' | 'nodeSeekMediaUserAgent' | 'poster' | 'referrerPolicy'> & {
    mediaKind: ForumContentMediaKind;
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
  const frameStyle = mediaKind === 'audio' ? styles.audioFrame : styles.frame;
  const mediaLabel = mediaKind === 'audio' ? '音频' : '视频';
  const frameTestId = `forum-content-${mediaKind}-frame`;

  if (!admission.admitted) {
    return (
      <View
        style={[frameStyle, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
        testID={frameTestId}
      >
        <VideoPosterLayer poster={poster} />
        {admission.failure ? (
          <Pressable
            accessibilityLabel={`${mediaLabel}加载失败，点按重试`}
            accessibilityRole="button"
            style={styles.videoState}
            onPress={admission.retry}
          >
            <Text style={{ color: theme.muted }}>{mediaLabel}加载失败，点按重试</Text>
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
        style={[frameStyle, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
        testID={frameTestId}
      >
        <VideoPosterLayer poster={poster} />
        <View style={styles.videoState}>
          {failed ? (
            <Text style={{ color: theme.muted }}>{mediaLabel}加载失败</Text>
          ) : (
            <ActivityIndicator color={theme.primary} />
          )}
        </View>
      </View>
    );
  }

  return (
    <ForumContentMediaPlayer
      key={`${mediaContext.sessionIdentity}:${src}:admission:${admission.attemptId}:runtime:${playerGeneration}`}
      boundarySpacing={boundarySpacing}
      mediaContext={mediaContext}
      mediaKind={mediaKind}
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

function ForumContentMediaPlayer({
  boundarySpacing,
  mediaContext,
  mediaKind,
  nodeSeekMediaUserAgent,
  onProgress,
  onStatusChange,
  poster,
  referrerPolicy,
  runtimeGeneration,
  src,
  theme
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  mediaContext: ForumMediaRequestContext;
  mediaKind: ForumContentMediaKind;
  nodeSeekMediaUserAgent?: string;
  onProgress: (value: number) => void;
  onStatusChange: (status: string) => void;
  poster?: ReactNode;
  referrerPolicy?: MediaReferrerPolicy;
  runtimeGeneration: number;
  src: string;
  theme: ReaderTheme;
}) {
  const videoRef = useRef<VideoView>(null);
  const requestHeaders = useMemo(
    () => ({
      ...(imageRequestHeadersForUrl(src, {
        mediaContext,
        nodeSeekUserAgent: nodeSeekMediaUserAgent,
        referrerPolicy
      }) || {}),
      Accept: mediaKind === 'audio' ? AUDIO_ACCEPT : VIDEO_ACCEPT,
      [FORUM_MEDIA_KIND_HEADER]: 'video',
      [READ_NETWORK_GENERATION_HEADER]: String(runtimeGeneration)
    }),
    [mediaContext, mediaKind, nodeSeekMediaUserAgent, referrerPolicy, runtimeGeneration, src]
  );
  const source = useMemo<VideoSource>(
    () => ({
      uri: src,
      ...(Object.keys(requestHeaders).length ? { headers: requestHeaders } : {}),
      contentType: 'progressive'
    }),
    [mediaContext.sessionIdentity, requestHeaders, src]
  );
  const player = useVideoPlayer(source, configureVideoPlayer);
  const [hasPlayed, setHasPlayed] = useState(false);
  const lastBufferedPositionRef = useRef(
    Number.isFinite(player.bufferedPosition) ? Math.max(0, player.bufferedPosition) : 0
  );
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  const videoTrack = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack }).videoTrack;
  const timeUpdate = useEvent(player, 'timeUpdate', {
    bufferedPosition: player.bufferedPosition,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    currentTime: player.currentTime
  });
  const bufferedPosition = timeUpdate.bufferedPosition;
  useEffect(() => {
    if (!Number.isFinite(bufferedPosition) || bufferedPosition <= lastBufferedPositionRef.current) {
      return;
    }
    lastBufferedPositionRef.current = bufferedPosition;
    onProgress(bufferedPosition);
  }, [bufferedPosition, onProgress]);
  useEffect(() => onStatusChange(status || 'idle'), [onStatusChange, status]);
  useEffect(() => {
    if (mediaKind === 'video' && isPlaying) setHasPlayed(true);
  }, [isPlaying, mediaKind]);
  const loadFailed = status === 'error';
  const loading = status === 'idle' || status === 'loading';
  const interactionDisabled = loading || loadFailed;
  const duration = Number.isFinite(player.duration) ? Math.max(0, player.duration) : 0;
  const currentTime = Number.isFinite(timeUpdate.currentTime)
    ? Math.min(duration || Number.POSITIVE_INFINITY, Math.max(0, timeUpdate.currentTime))
    : 0;
  const progressWidthRef = useRef(0);
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
  const seekTo = useCallback(
    (seconds: number) => {
      if (interactionDisabled || duration <= 0) return;
      player.currentTime = Math.min(duration, Math.max(0, seconds));
    },
    [duration, interactionDisabled, player]
  );
  const seekFromPress = useCallback(
    (event: GestureResponderEvent) => {
      const width = progressWidthRef.current;
      if (width > 0) seekTo((event.nativeEvent.locationX / width) * duration);
    },
    [duration, seekTo]
  );
  const enterFullscreen = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    void videoRef.current?.enterFullscreen();
  }, []);
  if (mediaKind === 'audio') {
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
    return (
      <View
        style={[styles.audioFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
        testID="forum-content-audio-frame"
      >
        <Pressable
          accessibilityLabel={isPlaying ? '暂停音频' : '播放音频'}
          accessibilityRole="button"
          accessibilityState={{ disabled: interactionDisabled }}
          disabled={interactionDisabled}
          onPress={togglePlayback}
          style={({ pressed }) => [
            styles.audioPlayButton,
            pressed && !interactionDisabled && styles.audioButtonPressed
          ]}
        >
          <View
            accessibilityElementsHidden
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[styles.audioPlayGlyph, { backgroundColor: theme.primary }]}
            testID="forum-content-audio-play-glyph"
          >
            {loading ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : isPlaying ? (
              <Pause color={theme.onPrimary} fill={theme.onPrimary} size={18} strokeWidth={1.8} />
            ) : (
              <Play color={theme.onPrimary} fill={theme.onPrimary} size={18} strokeWidth={1.8} />
            )}
          </View>
        </Pressable>
        <Pressable
          accessibilityActions={[
            { name: 'increment', label: '快进 10 秒' },
            { name: 'decrement', label: '后退 10 秒' }
          ]}
          accessibilityLabel="音频进度"
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: interactionDisabled }}
          accessibilityValue={{
            max: Math.round(duration),
            min: 0,
            now: Math.round(currentTime),
            text: `${formatMediaTime(currentTime)} / ${formatMediaTime(duration)}`
          }}
          disabled={interactionDisabled}
          onAccessibilityAction={({ nativeEvent }) =>
            seekTo(currentTime + (nativeEvent.actionName === 'increment' ? 10 : -10))
          }
          onLayout={({ nativeEvent }) => {
            progressWidthRef.current = nativeEvent.layout.width;
          }}
          onPress={seekFromPress}
          style={styles.audioBody}
          testID="forum-content-audio-progress"
        >
          <View pointerEvents="none" style={styles.audioHeader}>
            <Text style={[styles.audioTitle, { color: loadFailed ? theme.danger : theme.ink }]}>
              {loadFailed ? '音频加载失败' : '音频'}
            </Text>
            <Text style={[styles.audioTime, { color: theme.muted }]}>
              {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
            </Text>
          </View>
          <View pointerEvents="none" style={[styles.audioProgressTrack, { backgroundColor: theme.line }]}>
            <View style={[styles.audioProgressFill, { backgroundColor: theme.primary, width: `${progress * 100}%` }]} />
          </View>
        </Pressable>
      </View>
    );
  }
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
        nativeControls={false}
        player={player}
        ref={videoRef}
        style={styles.video}
        surfaceType="textureView"
      />
      {!hasPlayed ? <VideoPosterLayer poster={poster} /> : null}
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
        accessibilityState={{ disabled: interactionDisabled }}
        disabled={interactionDisabled}
        onPress={togglePlayback}
        style={({ pressed }) => [styles.touchLayer, pressed && !interactionDisabled && styles.touchLayerPressed]}
      >
        {!loading && !loadFailed && !isPlaying ? (
          <View style={styles.centerButton} testID="forum-content-video-play-button">
            <Play size={28} color="#fff" fill="#fff" strokeWidth={1.6} />
          </View>
        ) : null}
      </Pressable>
      {!loading && !loadFailed ? (
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

function formatMediaTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  audioFrame: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    marginTop: 8,
    minHeight: 64,
    padding: 8,
    overflow: 'hidden'
  },
  audioPlayButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48
  },
  audioButtonPressed: {
    opacity: 0.68
  },
  audioPlayGlyph: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  audioBody: {
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 0
  },
  audioHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between'
  },
  audioTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18
  },
  audioProgressTrack: {
    borderRadius: 2,
    height: 3,
    overflow: 'hidden'
  },
  audioProgressFill: {
    height: '100%'
  },
  audioTime: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 17
  },
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
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
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
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    borderRadius: 28,
    elevation: 3,
    height: 56,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 4,
    width: 56
  },
  fullscreenButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    borderRadius: 24,
    bottom: 12,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    width: 48
  },
  poster: {
    ...StyleSheet.absoluteFillObject
  },
  touchLayerPressed: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)'
  }
});
