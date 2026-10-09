import { useRef, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

export function TopicCopySurface({
  children,
  onCopy,
  style
}: {
  children: ReactNode;
  onCopy: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <Pressable
      delayLongPress={450}
      style={style}
      onTouchStart={({ nativeEvent }) => {
        start.current = nativeEvent.touches.length === 1 ? { x: nativeEvent.pageX, y: nativeEvent.pageY } : null;
      }}
      onTouchMove={({ nativeEvent }) => {
        const origin = start.current;
        // Match opening selection's 4 dp tolerance, even when a short list cannot take over the drag.
        if (
          origin &&
          (nativeEvent.touches.length !== 1 ||
            Math.hypot(nativeEvent.pageX - origin.x, nativeEvent.pageY - origin.y) > 4)
        )
          start.current = null;
      }}
      onTouchCancel={() => {
        start.current = null;
      }}
      onTouchEnd={() => {
        start.current = null;
      }}
      onLongPress={() => {
        if (start.current) onCopy();
      }}
    >
      {children}
    </Pressable>
  );
}
