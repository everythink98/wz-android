import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import {
  AppState,
  Keyboard,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import Animated, {
  cancelAnimation,
  KeyboardState,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue
} from 'react-native-reanimated';
import type { ComposerPresentation } from '@/domain/forum/structuredComposer';
import { ComposerKeyboardHost, type ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';

type KeyboardSource = ReturnType<typeof useAnimatedKeyboard>;

function ComposerKeyboardSource({ publish }: { publish: Dispatch<SetStateAction<KeyboardSource | null>> }) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true
  });
  useLayoutEffect(() => {
    publish(keyboard);
    return () => publish((current) => (current === keyboard ? null : current));
  }, [keyboard, publish]);
  return null;
}

export function FixedComposerPanel({
  backgroundStyle,
  children,
  containerStyle,
  contentStyle,
  dark,
  height,
  insets,
  keyboardActive,
  keyboardHostRef,
  maxDynamicContentHeight,
  pickerReady,
  presentation,
  presented,
  sheetHeight,
  onClose,
  onOpenReady
}: {
  backgroundStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  dark: boolean;
  height: number;
  insets: { top: number; bottom: number };
  keyboardActive: boolean;
  keyboardHostRef: RefObject<ComposerKeyboardHostHandle | null>;
  maxDynamicContentHeight?: number;
  pickerReady: SharedValue<boolean>;
  presentation: ComposerPresentation;
  presented: boolean;
  sheetHeight: number;
  onClose: () => void;
  onOpenReady: (index: number) => void;
}) {
  const [keyboard, setKeyboard] = useState<KeyboardSource | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const dynamicContent = maxDynamicContentHeight !== undefined;
  const contentReady = !dynamicContent || contentHeight > 0;
  const desiredHeight =
    maxDynamicContentHeight === undefined
      ? sheetHeight
      : Math.min(contentHeight, maxDynamicContentHeight) + insets.bottom;
  // The native host acknowledges the settled panel, independently of intermediate
  // IME frames and the sheet/fullscreen presentation animation.
  const hiddenLayoutHeight =
    !contentReady || height <= 0
      ? undefined
      : dynamicContent
        ? desiredHeight
        : presentation === 'fullscreen'
          ? height
          : Math.min(height, desiredHeight);
  const measureContent = useCallback((event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height);
  }, []);
  const openProgress = useSharedValue(0);
  const fullscreenProgress = useSharedValue(presentation === 'fullscreen' ? 1 : 0);
  const foreground = useSharedValue(true);
  const ignoreOldKeyboard = useSharedValue(false);
  const animationGeneration = useRef(0);
  const finish = useCallback(
    (generation: number, opened: boolean) => {
      if (animationGeneration.current !== generation) return;
      if (opened) onOpenReady(0);
      else onClose();
    },
    [onClose, onOpenReady]
  );
  useLayoutEffect(() => {
    // Publishing a new keyboard source happens once per subscription. The
    // editor remains mounted beside that source, including while it is absent.
    if (!keyboard || (presented && !contentReady)) return;
    const generation = ++animationGeneration.current;
    openProgress.set(
      withTiming(presented ? 1 : 0, { duration: 220 }, (finished) => {
        if (finished) runOnJS(finish)(generation, presented);
      })
    );
    return () => {
      animationGeneration.current += 1;
      cancelAnimation(openProgress);
    };
  }, [contentReady, finish, keyboard, openProgress, presented]);
  useLayoutEffect(() => {
    fullscreenProgress.set(withTiming(presentation === 'fullscreen' ? 1 : 0, { duration: 220 }));
    return () => cancelAnimation(fullscreenProgress);
  }, [fullscreenProgress, presentation]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      foreground.set(state === 'active');
      if (!Keyboard.isVisible()) ignoreOldKeyboard.set(true);
    });
    return () => subscription.remove();
  }, [foreground, ignoreOldKeyboard]);
  useAnimatedReaction(
    () => keyboard?.state.value,
    (state, previous) => {
      if (foreground.value && state === KeyboardState.OPENING && previous !== KeyboardState.OPENING) {
        ignoreOldKeyboard.set(false);
      }
    }
  );
  useAnimatedReaction(
    () =>
      presented &&
      foreground.value &&
      keyboard !== null &&
      contentReady &&
      keyboard.height.value === 0 &&
      (keyboard.state.value === KeyboardState.CLOSED || keyboard.state.value === KeyboardState.UNKNOWN) &&
      height > 0 &&
      openProgress.value === 1 &&
      fullscreenProgress.value === (presentation === 'fullscreen' ? 1 : 0),
    (ready) => pickerReady.set(ready)
  );
  useEffect(() => () => pickerReady.set(false), [pickerReady]);

  // Read the native IME frame in the drawing mapper itself. Copying its height
  // through reactions/layout/detents lets the panel draw an older keyboard frame.
  const panelStyle = useAnimatedStyle(() => {
    const keyboardHeight =
      ignoreOldKeyboard.value && keyboard?.state.value !== KeyboardState.OPENING ? 0 : (keyboard?.height.value ?? 0);
    // The panel keeps its navigation padding/background while the IME overlaps it.
    // Offset only the excess IME height so the footer stays above both insets.
    const keyboardOverlap = Math.max(0, keyboardHeight - insets.bottom);
    const viewportHeight = Math.max(0, height - keyboardOverlap);
    // Measurements determine animation travel only. Native layout resizes a
    // dynamic panel with its children, without waiting for the onLayout commit.
    const sheetPanelHeight = dynamicContent ? desiredHeight : Math.min(viewportHeight, desiredHeight);
    const panelHeight = dynamicContent
      ? sheetPanelHeight
      : sheetPanelHeight + (viewportHeight - sheetPanelHeight) * fullscreenProgress.value;
    return {
      // A transparent hardware WebView still draws; hide it after the close
      // animation while retaining the editor and its document for reopening.
      display: !presented && openProgress.value === 0 ? 'none' : 'flex',
      bottom: 0,
      height: dynamicContent ? undefined : panelHeight,
      maxHeight: maxDynamicContentHeight === undefined ? undefined : maxDynamicContentHeight + insets.bottom,
      // Keep the IME edge anchored even when Fabric applies the new height later.
      transform: [{ translateY: -keyboardOverlap + panelHeight * (1 - openProgress.value) }],
      paddingBottom: insets.bottom,
      paddingTop: dynamicContent ? 0 : insets.top * fullscreenProgress.value,
      opacity: openProgress.value === 0 ? 0 : 1
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: openProgress.value * (dark ? 0.56 : 0.38) }));
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, containerStyle]}>
      {keyboardActive && <ComposerKeyboardSource publish={setKeyboard} />}
      <Animated.View
        testID="composer-bottom-sheet-backdrop"
        pointerEvents={presented ? 'auto' : 'none'}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, { backgroundColor: 'black' }, backdropStyle]}
      />
      <ComposerKeyboardHost
        key="fixed-composer-panel"
        ref={keyboardHostRef}
        enabled={presented}
        hiddenLayoutHeight={hiddenLayoutHeight}
        testID="composer-bottom-sheet"
        pointerEvents={presented ? 'auto' : 'none'}
        accessibilityElementsHidden={!presented}
        importantForAccessibility={presented ? 'auto' : 'no-hide-descendants'}
        style={[styles.panel, backgroundStyle, panelStyle]}
      >
        <View
          testID="composer-bottom-sheet-content"
          onLayout={dynamicContent ? measureContent : undefined}
          style={[dynamicContent ? styles.dynamicContent : styles.content, contentStyle]}
        >
          {children}
        </View>
      </ComposerKeyboardHost>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  content: { flex: 1 },
  dynamicContent: { flexGrow: 0, flexShrink: 0 }
});
