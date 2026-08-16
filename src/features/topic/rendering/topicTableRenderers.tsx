import { createContext, type ComponentRef, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  makeMutable,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
  withDecay,
  type SharedValue
} from 'react-native-reanimated';
import { useTopicSplitDisclosureScopeKey } from './TopicSplitDisclosure';

const HORIZONTAL_INTENT_LOCK_DISTANCE = 4;

type TopicTableScrollStore = {
  nativeOffsets: Map<string, number>;
  offsets: Map<string, SharedValue<number>>;
};

const TopicTableScrollContext = createContext<TopicTableScrollStore | null>(null);

export function TopicTableScrollProvider({ children }: { children: ReactNode }) {
  const store = useMemo<TopicTableScrollStore>(() => ({ nativeOffsets: new Map(), offsets: new Map() }), []);
  return <TopicTableScrollContext.Provider value={store}>{children}</TopicTableScrollContext.Provider>;
}

export function useTopicNativeTableScroll(semanticIds: readonly string[]) {
  const scopeKey = useTopicSplitDisclosureScopeKey();
  const store = useContext(TopicTableScrollContext);
  const offsets = useMemo(
    () =>
      Object.fromEntries(
        semanticIds.map((semanticId) => [semanticId, store?.nativeOffsets.get(`${scopeKey}\u0000${semanticId}`) || 0])
      ),
    [scopeKey, semanticIds, store]
  );
  const scrollKeys = useMemo(
    () =>
      Object.fromEntries(semanticIds.map((semanticId) => [semanticId, `${scopeKey || 'unscoped'}\u0000${semanticId}`])),
    [scopeKey, semanticIds]
  );
  const onTableScroll = useCallback(
    (semanticId: string, offset: number) => {
      if (!store || !scopeKey || !semanticId || !Number.isFinite(offset)) return;
      store.nativeOffsets.set(`${scopeKey}\u0000${semanticId}`, Math.max(0, offset));
    },
    [scopeKey, store]
  );
  return { offsets, onTableScroll, scrollKeys };
}

function useTopicHorizontalOffset(semanticId: string) {
  const scopeKey = useTopicSplitDisclosureScopeKey();
  const store = useContext(TopicTableScrollContext);
  const localOffset = useSharedValue(0);
  const syncKey = store && scopeKey && semanticId ? `${scopeKey}\u0000${semanticId}` : '';
  return useMemo(() => {
    if (!store || !syncKey) return localOffset;
    const current = store.offsets.get(syncKey) || makeMutable(0);
    store.offsets.set(syncKey, current);
    return current;
  }, [localOffset, store, syncKey]);
}

export function TopicHorizontalScroll({
  accessibilityHint = '横向滑动查看更多',
  accessibilityLabel,
  children,
  contentContainerStyle,
  contentWidth,
  enabled = true,
  semanticId,
  showsHorizontalScrollIndicator = true,
  style,
  testID,
  viewportWidth
}: {
  accessibilityHint?: string;
  accessibilityLabel: string;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  contentWidth?: number;
  enabled?: boolean;
  semanticId: string;
  showsHorizontalScrollIndicator?: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
  viewportWidth: number;
}) {
  const offset = useTopicHorizontalOffset(semanticId);
  const initialMaximum = contentWidth === undefined ? 0 : Math.max(0, contentWidth - viewportWidth);
  const maximumOffset = useSharedValue(initialMaximum);
  const horizontalPanClaimed = useSharedValue(false);
  const pointerStartX = useSharedValue(0);
  const pointerStartY = useSharedValue(0);
  const gestureStartOffset = useSharedValue(0);
  const scrollViewRef = useAnimatedRef<ComponentRef<typeof Animated.ScrollView>>();
  const nativeContentGesture = useMemo(() => Gesture.Native(), []);

  useAnimatedReaction(
    () => offset.value,
    (currentOffset, previousOffset) => {
      if (currentOffset !== 0 || previousOffset !== null) scrollTo(scrollViewRef, currentOffset, 0, false);
    },
    [offset, scrollViewRef]
  );

  const horizontalPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .manualActivation(true)
        .maxPointers(1)
        .blocksExternalGesture(nativeContentGesture)
        .onTouchesDown((event, state) => {
          'worklet';
          horizontalPanClaimed.value = false;
          const touch = event.allTouches[0];
          if (event.numberOfTouches !== 1 || maximumOffset.value <= 0 || !touch) {
            state.fail();
            return;
          }
          pointerStartX.value = touch.absoluteX;
          pointerStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, state) => {
          'worklet';
          if (event.numberOfTouches !== 1 || maximumOffset.value <= 0) {
            horizontalPanClaimed.value = false;
            state.fail();
            return;
          }
          if (horizontalPanClaimed.value) return;
          const touch = event.allTouches[0];
          if (!touch) {
            state.fail();
            return;
          }
          const deltaX = touch.absoluteX - pointerStartX.value;
          const deltaY = touch.absoluteY - pointerStartY.value;
          if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < HORIZONTAL_INTENT_LOCK_DISTANCE) return;
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            horizontalPanClaimed.value = true;
            state.activate();
            return;
          }
          state.fail();
        })
        .onBegin(() => {
          'worklet';
          cancelAnimation(offset);
          gestureStartOffset.value = offset.value;
        })
        .onUpdate((event) => {
          'worklet';
          offset.value = Math.max(0, Math.min(maximumOffset.value, gestureStartOffset.value - event.translationX));
        })
        .onEnd((event) => {
          'worklet';
          offset.value = withDecay({ clamp: [0, maximumOffset.value], velocity: -event.velocityX });
        }),
    [
      enabled,
      gestureStartOffset,
      horizontalPanClaimed,
      maximumOffset,
      nativeContentGesture,
      offset,
      pointerStartX,
      pointerStartY
    ]
  );
  const handleContentSizeChange = useCallback(
    (width: number) => {
      const maximum = Number.isFinite(width) ? Math.max(0, width - viewportWidth) : 0;
      maximumOffset.value = maximum;
      if (offset.value > maximum) offset.value = maximum;
    },
    [maximumOffset, offset, viewportWidth]
  );
  const handleAccessibilityAction = useCallback(
    ({ nativeEvent }: AccessibilityActionEvent) => {
      const direction = nativeEvent.actionName === 'increment' ? 1 : nativeEvent.actionName === 'decrement' ? -1 : 0;
      if (!direction) return;
      const step = Math.max(48, viewportWidth * 0.8);
      offset.value = Math.max(0, Math.min(maximumOffset.value, offset.value + direction * step));
    },
    [maximumOffset, offset, viewportWidth]
  );
  return (
    <GestureDetector gesture={horizontalPan}>
      <Animated.ScrollView
        ref={scrollViewRef}
        accessibilityActions={
          enabled
            ? [
                { label: '向左滚动', name: 'decrement' },
                { label: '向右滚动', name: 'increment' }
              ]
            : undefined
        }
        accessibilityHint={enabled ? accessibilityHint : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={enabled ? 'adjustable' : undefined}
        contentContainerStyle={contentContainerStyle}
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={enabled && showsHorizontalScrollIndicator}
        style={style}
        testID={testID}
        onAccessibilityAction={handleAccessibilityAction}
        onContentSizeChange={handleContentSizeChange}
      >
        <GestureDetector gesture={nativeContentGesture}>
          <View collapsable={false}>{children}</View>
        </GestureDetector>
      </Animated.ScrollView>
    </GestureDetector>
  );
}
