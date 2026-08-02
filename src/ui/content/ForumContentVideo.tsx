import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import { Maximize2, Play } from 'lucide-react-native';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { imageRequestHeadersForUrl } from '@/platform/media/imageRequestSource';

export function ForumContentVideo({
  headers,
  mediaContext,
  src,
  theme
}: {
  headers?: Record<string, string>;
  mediaContext: ForumMediaRequestContext;
  src: string;
  theme: ReaderTheme;
}) {
  const videoRef = useRef<VideoView>(null);
  const requestHeaders = useMemo(
    () => ({
      ...(imageRequestHeadersForUrl(src, { mediaContext }) || {}),
      ...(headers || {})
    }),
    [headers, mediaContext, src]
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
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
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
    <View style={[styles.frame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
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
