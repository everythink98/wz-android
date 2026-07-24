import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';
import { Maximize2, Play } from 'lucide-react-native';
import type { ReaderTheme } from '../theme';
import { readMediaCookieHeader } from '../managedCookies';

export function ForumContentVideo({
  headers,
  mediaSessionIdentity,
  src,
  theme
}: {
  headers?: Record<string, string>;
  mediaSessionIdentity: string;
  src: string;
  theme: ReaderTheme;
}) {
  const videoRef = useRef<VideoView>(null);
  const [cookieState, setCookieState] = useState<
    | { identity: string; status: 'failed'; url: string }
    | { identity: string; status: 'ready'; url: string; value: string }
    | null
  >(null);
  const cookieReady = cookieState?.identity === mediaSessionIdentity
    && cookieState.url === src
    && cookieState.status === 'ready';
  const cookieFailed = cookieState?.identity === mediaSessionIdentity
    && cookieState.url === src
    && cookieState.status === 'failed';
  const cookieHeader = cookieReady ? cookieState.value : '';
  const source = useMemo<VideoSource>(() => cookieReady ? ({
    uri: src,
    headers: {
      ...(headers || {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    contentType: 'progressive'
  }) : null, [cookieHeader, cookieReady, headers, src]);
  const player = useVideoPlayer(source);
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useEffect(() => {
    let active = true;
    setCookieState(null);
    void readMediaCookieHeader(src).then(
      (value) => {
        if (active) {
          setCookieState({
            identity: mediaSessionIdentity,
            status: 'ready',
            url: src,
            value
          });
        }
      },
      () => {
        if (active) {
          setCookieState({
            identity: mediaSessionIdentity,
            status: 'failed',
            url: src
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [mediaSessionIdentity, src]);
  const togglePlayback = useCallback(() => {
    if (!cookieReady) {
      return;
    }
    if (isPlaying) {
      player.pause();
      return;
    }
    player.play();
  }, [cookieReady, isPlaying, player]);
  const enterFullscreen = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
    void videoRef.current?.enterFullscreen();
  }, []);
  return (
    <View style={[styles.frame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
      {cookieReady ? (
        <VideoView
          allowsFullscreen
          contentFit="contain"
          nativeControls={false}
          player={player}
          ref={videoRef}
          style={styles.video}
          surfaceType="textureView"
        />
      ) : (
        <View style={styles.videoState}>
          {cookieFailed ? (
            <Text style={{ color: theme.muted }}>视频加载失败</Text>
          ) : (
            <ActivityIndicator color={theme.primary} />
          )}
        </View>
      )}
      <Pressable
        accessibilityLabel={isPlaying ? '暂停视频' : '播放视频'}
        accessibilityRole="button"
        onPress={togglePlayback}
        style={styles.touchLayer}
      >
        {cookieReady && !isPlaying ? (
          <View style={[styles.centerButton, { backgroundColor: theme.surface }]}>
            <Play size={34} color={theme.ink} fill={theme.ink} strokeWidth={1.8} />
          </View>
        ) : null}
      </Pressable>
      {cookieReady ? (
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
