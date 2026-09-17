import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useAnimatedKeyboard,
  useAnimatedReaction
} from 'react-native-reanimated';
import BottomSheet, {
  BottomSheetView,
  type BottomSheetBackdropProps,
  useBottomSheetInternal
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComposerPresentation } from '@/domain/forum/structuredComposer';

function ComposerBackdrop({
  animatedIndex,
  style,
  visible,
  dark
}: BottomSheetBackdropProps & {
  visible: boolean;
  dark: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.value, [-1, 0], [0, dark ? 0.56 : 0.38], Extrapolation.CLAMP)
  }));
  return (
    <Animated.View
      testID="composer-bottom-sheet-backdrop"
      pointerEvents={visible ? 'auto' : 'none'}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, style, { backgroundColor: 'black' }, animatedStyle]}
    />
  );
}

function ComposerKeyboardViewport() {
  const { animatedLayoutState } = useBottomSheetInternal();
  // Edge-to-edge Android delivers IME insets instead of resizing the window.
  // The native IME animation resizes this viewport; BottomSheet must not offset it again.
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true
  });
  useAnimatedReaction(
    () => {
      const raw = animatedLayoutState.get().rawContainerHeight;
      return raw < 0 ? raw : Math.max(0, raw - keyboard.height.value);
    },
    (height) => {
      if (height < 0 || animatedLayoutState.get().containerHeight === height) return;
      animatedLayoutState.modify((state) => {
        'worklet';
        state.containerHeight = height;
        return state;
      });
    }
  );
  useEffect(
    () => () => {
      animatedLayoutState.modify((state) => {
        'worklet';
        state.containerHeight = state.rawContainerHeight;
        return state;
      });
    },
    [animatedLayoutState]
  );
  return null;
}

export function ComposerBottomSheet({
  backgroundStyle,
  children,
  containerStyle,
  contentStyle,
  dark,
  fixedContent = false,
  presentation = 'sheet',
  visible,
  onOpenChange,
  onPresentationChange
}: {
  backgroundStyle?: StyleProp<ViewStyle>;
  children: (focusSignal: number) => ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  dark: boolean;
  fixedContent?: boolean;
  presentation?: ComposerPresentation;
  visible: boolean;
  onOpenChange: (open: boolean) => void;
  onPresentationChange?: (presentation: ComposerPresentation) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [keyboardActive, setKeyboardActive] = useState(visible);
  const initialFocusPending = useRef(visible);
  useLayoutEffect(() => {
    initialFocusPending.current = visible;
    if (visible) setKeyboardActive(true);
  }, [visible]);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <ComposerBackdrop {...props} visible={visible} dark={dark} />,
    [dark, visible]
  );
  const close = useCallback(() => {
    setKeyboardActive(false);
    Keyboard.dismiss();
    if (visible) onOpenChange(false);
  }, [onOpenChange, visible]);
  const availableContentHeight = Math.max(320, height - insets.top - insets.bottom);
  const fixedSheetContentHeight = Math.min(
    Math.round(availableContentHeight * 0.75),
    Math.max(360, Math.min(480, Math.round(availableContentHeight * 0.52)))
  );
  const fixedSheetHeight = fixedSheetContentHeight + insets.bottom;
  const fullscreenHeight = Math.max(320, height - insets.top);
  const paddedContentStyle = useMemo(() => [contentStyle, { paddingBottom: 8 }], [contentStyle]);
  const fixedContentStyle = useMemo(
    () => [contentStyle, { flex: 1, paddingBottom: insets.bottom }],
    [contentStyle, insets.bottom]
  );
  const resolvedBackgroundStyle = useMemo(
    () => [backgroundStyle, presentation === 'fullscreen' && { borderTopLeftRadius: 0, borderTopRightRadius: 0 }],
    [backgroundStyle, presentation]
  );
  const snapPoints = useMemo(
    () => (fixedContent ? [presentation === 'fullscreen' ? fullscreenHeight : fixedSheetHeight] : undefined),
    [fixedContent, fixedSheetHeight, fullscreenHeight, presentation]
  );
  const index = visible ? 0 : -1;

  useLayoutEffect(() => {
    if (visible) onPresentationChange?.('sheet');
  }, [onPresentationChange, visible]);
  useEffect(() => {
    if (visible) return;
    Keyboard.dismiss();
    bottomSheetRef.current?.close();
  }, [visible]);
  const handleSheetChange = useCallback(
    (nextIndex: number) => {
      if (visible && nextIndex === 0 && initialFocusPending.current) {
        initialFocusPending.current = false;
        setFocusSignal((value) => value + 1);
      }
    },
    [visible]
  );
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!visible) return false;
      if (Keyboard.isVisible()) {
        Keyboard.dismiss();
        return true;
      }
      if (presentation === 'fullscreen') {
        onPresentationChange?.('sheet');
        return true;
      }
      onOpenChange(false);
      return true;
    });
    return () => back.remove();
  }, [onOpenChange, onPresentationChange, presentation, visible]);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={index}
      backgroundStyle={resolvedBackgroundStyle}
      backdropComponent={renderBackdrop}
      bottomInset={fixedContent ? 0 : insets.bottom}
      containerStyle={containerStyle}
      enableDynamicSizing={!fixedContent}
      enableContentPanningGesture={false}
      enablePanDownToClose={false}
      handleComponent={null}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      maxDynamicContentSize={Math.round(availableContentHeight * (presentation === 'fullscreen' ? 1 : 0.75))}
      snapPoints={snapPoints}
      topInset={presentation === 'fullscreen' ? insets.top : 0}
      onChange={handleSheetChange}
      onClose={close}
    >
      {keyboardActive && <ComposerKeyboardViewport />}
      {fixedContent ? (
        <View testID="composer-bottom-sheet-content" style={fixedContentStyle}>
          {children(focusSignal)}
        </View>
      ) : (
        <BottomSheetView testID="composer-bottom-sheet-content" style={paddedContentStyle}>
          {children(focusSignal)}
        </BottomSheetView>
      )}
    </BottomSheet>
  );
}
