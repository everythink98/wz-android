import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { useEvent } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Maximize2, Play } from 'lucide-react-native';
import type { ReaderTheme } from '../theme';
import { useForumMediaPlaybackActive } from '../forumMediaPlayback';

export function ForumContentVideo({ src, theme }: { src: string; theme: ReaderTheme }) {
  const videoRef = useRef<VideoView>(null);
  const player = useVideoPlayer({ uri: src });
  const playbackActive = useForumMediaPlaybackActive();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useEffect(() => {
    if (!playbackActive) {
      player.pause();
    }
  }, [playbackActive, player]);
  const togglePlayback = useCallback(() => {
    if (!playbackActive) {
      return;
    }
    if (isPlaying) {
      player.pause();
      return;
    }
    player.play();
  }, [isPlaying, playbackActive, player]);
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
      <Pressable
        accessibilityLabel={isPlaying ? '暂停视频' : '播放视频'}
        accessibilityRole="button"
        onPress={togglePlayback}
        style={styles.touchLayer}
      >
        {!isPlaying ? (
          <View style={[styles.centerButton, { backgroundColor: theme.surface }]}>
            <Play size={34} color={theme.ink} fill={theme.ink} strokeWidth={1.8} />
          </View>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityLabel="全屏播放"
        accessibilityRole="button"
        onPress={enterFullscreen}
        style={styles.fullscreenButton}
      >
        <Maximize2 size={24} color="#fff" strokeWidth={2.2} />
      </Pressable>
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
