import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useAnimatedStyle, withTiming } from 'react-native-reanimated';

/** Keep the primary action available while reading up, without reacting to edge bounce. */
export function useScrollActionVisibility({
  active = true,
  paused = false,
  resetKey
}: {
  active?: boolean;
  paused?: boolean;
  resetKey: string;
}) {
  const [visible, setVisible] = useState(true);
  const scrollRef = useRef<{
    offset: number;
    anchor: number;
    direction: number;
    contentHeight: number;
    viewportHeight: number;
  } | null>(null);
  const reset = useCallback(() => {
    scrollRef.current = null;
    setVisible(true);
  }, []);
  useEffect(reset, [active, reset, resetKey]);
  const onScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!active || paused) return;
      const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
      const maxOffset = Math.max(0, contentSize.height - layoutMeasurement.height);
      const offset = Math.max(0, Math.min(contentOffset.y, maxOffset));
      if (!Number.isFinite(offset)) return;
      const previous = scrollRef.current;
      const contentHeight = contentSize.height;
      const viewportHeight = layoutMeasurement.height;
      if (!previous || previous.contentHeight !== contentHeight || previous.viewportHeight !== viewportHeight) {
        // List measurement and viewport corrections are not a change in reading direction.
        scrollRef.current = { offset, anchor: offset, direction: 0, contentHeight, viewportHeight };
        if (contentOffset.y <= 12) setVisible(true);
        return;
      }
      if (offset === previous.offset) return;
      const direction = Math.sign(offset - previous.offset);
      const anchor = direction === previous.direction ? previous.anchor : previous.offset;
      scrollRef.current = { ...previous, offset, anchor, direction };
      if (offset > 12 && Math.abs(offset - anchor) < 12) return;
      const nextVisible = offset <= 12 || direction < 0;
      if (nextVisible !== visible) setVisible(nextVisible);
    },
    [active, paused, visible]
  );
  const hidden = !active || paused || !visible;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(hidden ? 0 : 1, { duration: 160 })
  }));
  return { hidden, onScroll, animatedStyle, reset };
}
