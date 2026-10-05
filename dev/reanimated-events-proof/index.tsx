import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';

// The global-handler native proof uses an internal runtime entry; its published
// declarations avoid pulling Reanimated's implementation into the app typecheck.
const { registerEventHandler, unregisterEventHandler } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- This internal runtime entry uses its published declarations above.
  require('react-native-reanimated/src/core') as typeof import('react-native-reanimated/lib/typescript/core');

// Private device entry. Does not mount account/runtime stores or access a network.
function Proof() {
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [batch, setBatch] = useState(0);
  const [globalCalls, setGlobalCalls] = useState(0);
  const [scrollCalls, setScrollCalls] = useState(0);
  const [framesDone, setFramesDone] = useState(false);
  const globalCounter = useSharedValue(0);
  const scrollCounter = useSharedValue(0);
  const frameCounter = useSharedValue(0);
  const y = useSharedValue(0);
  const raf = useFrameCallback(() => {
    'worklet';
    frameCounter.value += 1;
    if (frameCounter.value === 10) scheduleOnRN(setFramesDone, true);
  });
  useEffect(() => {
    if (framesDone) raf.setActive(false);
  }, [framesDone, raf]);
  useEffect(() => {
    if (!globalEnabled) return;
    const id = registerEventHandler(() => {
      'worklet';
      globalCounter.value += 1;
      scheduleOnRN(setGlobalCalls, globalCounter.value);
    }, 'onSvgLayout');
    // Registration is scheduled on UI; mount the fixture after that task is queued.
    const timer = setTimeout(() => setBatch((n) => n + 1), 300);
    return () => {
      clearTimeout(timer);
      unregisterEventHandler(id);
    };
  }, [globalEnabled, globalCounter]);
  const onScroll = useAnimatedScrollHandler(() => {
    'worklet';
    scrollCounter.value += 1;
    y.value = scrollCounter.value % 40;
    scheduleOnRN(setScrollCalls, scrollCounter.value);
  });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: y.value }] }));
  return (
    <View style={{ flex: 1, padding: 20, paddingTop: 60, backgroundColor: '#fff' }}>
      <Text
        testID="native-events-receipt"
        accessibilityLabel={`scroll=${scrollCalls} global=${globalCalls} frames=${framesDone ? 10 : 0} enabled=${globalEnabled} batch=${batch}`}
      >
        {`scroll=${scrollCalls} global=${globalCalls} frames=${framesDone ? 10 : 0} enabled=${globalEnabled} batch=${batch}`}
      </Text>
      <Pressable
        testID="toggle-global"
        accessibilityRole="button"
        accessibilityLabel="toggle global"
        onPress={() => setGlobalEnabled((v) => !v)}
        style={{ padding: 20 }}
      >
        <Text>Toggle global SVG handler</Text>
      </Pressable>
      <Pressable
        testID="remount-svg"
        accessibilityRole="button"
        accessibilityLabel="remount SVG"
        onPress={() => setBatch((n) => n + 1)}
        style={{ padding: 20 }}
      >
        <Text>Remount SVG after unregister</Text>
      </Pressable>
      <Animated.View style={[{ height: 10, width: 40, backgroundColor: '#086' }, style]} />
      <View key={batch} style={{ flexDirection: 'row', height: 30 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Svg key={i} width={20} height={20}>
            <Path d="M2 2L18 18M18 2L2 18" stroke="#222" strokeWidth={2} />
          </Svg>
        ))}
      </View>
      <Animated.ScrollView
        testID="native-scroll-fixture"
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      >
        {Array.from({ length: 60 }, (_, i) => (
          <Text key={i} style={{ height: 60 }}>{`Native scroll row ${i}`}</Text>
        ))}
      </Animated.ScrollView>
    </View>
  );
}
registerRootComponent(Proof);
