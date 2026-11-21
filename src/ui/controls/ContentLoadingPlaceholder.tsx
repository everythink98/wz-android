import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import SkeletonLoading from 'expo-skeleton-loading';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
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
      {animating && !reduceMotion ? (
        <SkeletonLoading background={theme.line} highlight={theme.dark ? theme.lineStrong : theme.surface2}>
          <View collapsable={false}>{children}</View>
        </SkeletonLoading>
      ) : (
        children
      )}
    </View>
  );
}

export function SkeletonBlock({ style }: { style: StyleProp<ViewStyle> }) {
  const { styles } = useReaderThemeStyles(createStyles);
  return <View style={[styles.block, style]} />;
}

function createStyles(theme: ReaderTheme) {
  return StyleSheet.create({ block: { borderRadius: readerRadii.badge, backgroundColor: theme.line } });
}
