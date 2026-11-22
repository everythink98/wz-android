import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { readerRadii, type ReaderTheme } from '@/ui/theme/tokens';

const REVEAL_MS = 160;

export function LoadingCover({
  active,
  visible,
  children,
  style
}: {
  active: boolean;
  visible: boolean;
  children: ReactNode;
  style: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  const [retained, setRetained] = useState(visible);
  const shownAt = useRef(0);
  useLayoutEffect(() => {
    if (visible) {
      shownAt.current = Date.now();
      opacity.setValue(1);
      setRetained(true);
      return;
    }
    if (!retained) return;
    if (!active || reduceMotion || Date.now() - shownAt.current < REVEAL_MS) {
      setRetained(false);
      return;
    }
    const fade = Animated.timing(opacity, { toValue: 0, duration: REVEAL_MS, useNativeDriver: true });
    fade.start(({ finished }) => {
      if (finished) setRetained(false);
    });
    return () => fade.stop();
  }, [active, opacity, reduceMotion, retained, visible]);

  if (!visible && !retained) return null;
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style, { opacity }]}
      needsOffscreenAlphaCompositing
      renderToHardwareTextureAndroid={!visible}
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </Animated.View>
  );
}

export function ContentLoadingPlaceholder({
  animating,
  children,
  label,
  style
}: {
  animating: boolean;
  children: ReactNode;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useReaderThemeStyles(createStyles);
  const reduceMotion = useReducedMotion();

  return (
    <View
      testID="content-loading-placeholder"
      style={style}
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      role="status"
    >
      {children}
      {animating && !reduceMotion && (
        <SkeletonHighlight color={theme.dark ? theme.lineStrong : theme.surface2}>{children}</SkeletonHighlight>
      )}
    </View>
  );
}

function SkeletonHighlight({ children, color }: { children: ReactNode; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withRepeat(withTiming(1, { duration: 1000 }), -1, false));
    return () => cancelAnimation(progress);
  }, [progress]);
  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: `${progress.get() * 200 - 100}%` as const }]
  }));
  const transparent = `${color}00`;
  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
      maskElement={<View collapsable={false}>{children}</View>}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Reanimated.View style={[StyleSheet.absoluteFill, sweep]}>
        <LinearGradient
          style={StyleSheet.absoluteFill}
          colors={[transparent, color, transparent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        />
      </Reanimated.View>
    </MaskedView>
  );
}

export function SkeletonBlock({ style }: { style: StyleProp<ViewStyle> }) {
  const { styles } = useReaderThemeStyles(createStyles);
  return <View style={[styles.block, style]} />;
}

function createStyles(theme: ReaderTheme) {
  return StyleSheet.create({ block: { borderRadius: readerRadii.badge, backgroundColor: theme.line } });
}
