import { useMemo } from 'react';
import { ScrollView, useWindowDimensions, type ScrollViewProps } from 'react-native';

export function viewportBoundedScrollHeight(windowHeight: number) {
  return Math.max(320, Math.round(windowHeight * 0.58));
}

export function ViewportBoundedScrollView({ style, ...props }: ScrollViewProps) {
  const { height } = useWindowDimensions();
  const viewportStyle = useMemo(() => ({
    maxHeight: viewportBoundedScrollHeight(height)
  }), [height]);

  return <ScrollView {...props} style={[style, viewportStyle]} />;
}
