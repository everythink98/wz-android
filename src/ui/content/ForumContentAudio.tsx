import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import type { ReaderTheme } from '@/ui/theme/tokens';

export type ForumContentAudioStatus = 'error' | 'idle' | 'loading' | 'ready';

export function ForumContentAudio({
  boundarySpacing,
  duration,
  error,
  playing,
  position,
  status,
  theme,
  onPause,
  onPlay,
  onRetry,
  onSeek
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  duration: number;
  error: string | null;
  playing: boolean;
  position: number;
  status: ForumContentAudioStatus;
  theme: ReaderTheme;
  onPause: () => void;
  onPlay: () => void;
  onRetry: () => void;
  onSeek: (position: number) => void;
}) {
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const safePosition = Math.min(
    safeDuration || Number.POSITIVE_INFINITY,
    Math.max(0, Number.isFinite(position) ? position : 0)
  );
  const displayedPosition = dragPosition ?? safePosition;
  const loading = status === 'loading';
  const failed = status === 'error';
  const sliderDisabled = loading || failed || safeDuration <= 0;
  const buttonLabel = failed ? '音频加载失败，点按重试' : playing ? '暂停音频' : '播放音频';

  return (
    <View
      style={[styles.frame, { backgroundColor: theme.surface2, borderColor: theme.line }, boundarySpacing]}
      testID="forum-content-audio-frame"
    >
      <Pressable
        accessibilityLabel={buttonLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading }}
        disabled={loading}
        onPress={failed ? onRetry : playing ? onPause : onPlay}
        style={styles.playButton}
      >
        <View
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.playGlyph, { backgroundColor: failed ? theme.danger : theme.primary }]}
          testID="forum-content-audio-play-glyph"
        >
          {loading ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : failed ? (
            <RotateCcw color={theme.onPrimary} size={18} strokeWidth={2} />
          ) : playing ? (
            <Pause color={theme.onPrimary} fill={theme.onPrimary} size={18} strokeWidth={1.8} />
          ) : (
            <Play color={theme.onPrimary} fill={theme.onPrimary} size={18} strokeWidth={1.8} />
          )}
        </View>
      </Pressable>
      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: failed ? theme.danger : theme.ink }]}>
            {failed ? error || '音频加载失败' : '音频'}
          </Text>
          <Text style={[styles.time, { color: theme.muted }]}>
            {formatMediaTime(displayedPosition)} / {safeDuration > 0 ? formatMediaTime(safeDuration) : '--:--'}
          </Text>
        </View>
        <Slider
          accessibilityLabel="音频进度"
          accessibilityRole="adjustable"
          accessibilityState={{ disabled: sliderDisabled }}
          accessibilityValue={{
            max: Math.round(safeDuration),
            min: 0,
            now: Math.round(displayedPosition),
            text: `${formatMediaTime(displayedPosition)} / ${safeDuration > 0 ? formatMediaTime(safeDuration) : '--:--'}`
          }}
          disabled={sliderDisabled}
          maximumTrackTintColor={theme.lineStrong}
          maximumValue={Math.max(1, safeDuration)}
          minimumTrackTintColor={theme.primary}
          minimumValue={0}
          step={0}
          style={styles.slider}
          testID="forum-content-audio-progress"
          thumbTintColor={sliderDisabled ? theme.muted : theme.primaryStrong}
          value={displayedPosition}
          onSlidingStart={(value) => setDragPosition(value)}
          onValueChange={setDragPosition}
          onSlidingComplete={(value) => {
            onSeek(value);
            setDragPosition(null);
          }}
        />
      </View>
    </View>
  );
}

function formatMediaTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    marginTop: 8,
    minHeight: 82,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  playButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48
  },
  playGlyph: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 0
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between'
  },
  title: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18
  },
  time: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 17
  },
  slider: {
    height: 48,
    marginHorizontal: -4
  }
});
