import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, View, type StyleProp, type ViewStyle, useWindowDimensions } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
  useBottomSheetInternal
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComposerPresentation } from '@/domain/forum/structuredComposer';

const COMPOSER_KEYBOARD_TARGET = -2147483648;

function ComposerKeyboardCoordinator() {
  const { animatedKeyboardState } = useBottomSheetInternal();

  useEffect(() => {
    // WebView owns the editable element, so BottomSheet never receives a BottomSheetTextInput focus target.
    animatedKeyboardState.set((state) => ({ ...state, target: COMPOSER_KEYBOARD_TARGET }));
    return () => {
      animatedKeyboardState.set((state) =>
        state.target === COMPOSER_KEYBOARD_TARGET ? { ...state, target: undefined } : state
      );
    };
  }, [animatedKeyboardState]);

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
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={dark ? 0.56 : 0.38}
        pressBehavior="none"
      />
    ),
    [dark]
  );
  const close = useCallback(() => {
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
      if (visible && nextIndex === 0) setFocusSignal((value) => value + 1);
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
      android_keyboardInputMode="adjustPan"
      maxDynamicContentSize={Math.round(availableContentHeight * (presentation === 'fullscreen' ? 1 : 0.75))}
      snapPoints={snapPoints}
      topInset={presentation === 'fullscreen' ? insets.top : 0}
      onChange={handleSheetChange}
      onClose={close}
    >
      <ComposerKeyboardCoordinator />
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
