import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, StyleSheet, type StyleProp, type ViewStyle, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Portal } from '@gorhom/portal';
import type { ComposerPresentation } from '@/domain/forum/structuredComposer';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useKeyboardHandoff } from '@/ui/hooks/useKeyboardHandoff';
import { ComposerKeyboardHost, type ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';
import { FixedComposerPanel } from './FixedComposerPanel';

export function ComposerBottomSheet({
  active = true,
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
  active?: boolean;
  backgroundStyle?: StyleProp<ViewStyle>;
  children: (focusSignal: number, awaitKeyboardSettled: () => Promise<void>) => ReactNode;
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
  const presented = visible && active;
  const { height } = useWindowDimensions();
  const committedVisible = useCommittedRef(presented);
  const [focusSignal, setFocusSignal] = useState(0);
  const [keyboardActive, setKeyboardActive] = useState(presented);
  const pickerReady = useSharedValue(false);
  const keyboardHost = useRef<ComposerKeyboardHostHandle>(null);
  const awaitKeyboardSettled = useKeyboardHandoff(pickerReady, presented, keyboardHost);
  const initialFocusPending = useRef(visible);
  useLayoutEffect(() => {
    initialFocusPending.current = visible;
  }, [visible]);
  useLayoutEffect(() => {
    if (presented) setKeyboardActive(true);
  }, [presented]);
  const close = useCallback(() => {
    // This controlled sheet has no close gesture. An old animation must not
    // dismiss a newly opened editor or release its keyboard subscription.
    if (committedVisible.current) return;
    setKeyboardActive(false);
    Keyboard.dismiss();
  }, [committedVisible]);
  const availableContentHeight = Math.max(320, height - insets.top - insets.bottom);
  const fixedSheetContentHeight = Math.min(
    Math.round(availableContentHeight * 0.75),
    Math.max(360, Math.min(480, Math.round(availableContentHeight * 0.52)))
  );
  const fixedSheetHeight = fixedSheetContentHeight + insets.bottom;
  const paddedContentStyle = useMemo(() => [contentStyle, { paddingBottom: 8 }], [contentStyle]);
  const resolvedBackgroundStyle = useMemo(
    () => [backgroundStyle, presentation === 'fullscreen' && { borderTopLeftRadius: 0, borderTopRightRadius: 0 }],
    [backgroundStyle, presentation]
  );

  useLayoutEffect(() => {
    if (visible) onPresentationChange?.('sheet');
  }, [onPresentationChange, visible]);
  useEffect(() => {
    if (presented) return;
    Keyboard.dismiss();
  }, [presented]);
  const handleSheetChange = useCallback(
    (nextIndex: number) => {
      if (committedVisible.current && nextIndex === 0 && initialFocusPending.current) {
        initialFocusPending.current = false;
        setFocusSignal((value) => value + 1);
      }
    },
    [committedVisible]
  );
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!presented) return false;
      if (Keyboard.isVisible()) {
        void awaitKeyboardSettled().catch(() => undefined);
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
  }, [awaitKeyboardSettled, onOpenChange, onPresentationChange, presentation, presented]);

  return (
    <Portal>
      <ComposerKeyboardHost
        ref={keyboardHost}
        enabled={presented}
        pointerEvents="box-none"
        style={StyleSheet.absoluteFill}
      >
        <FixedComposerPanel
          backgroundStyle={resolvedBackgroundStyle}
          containerStyle={containerStyle}
          contentStyle={fixedContent ? contentStyle : paddedContentStyle}
          dark={dark}
          height={height}
          insets={insets}
          keyboardActive={keyboardActive}
          maxDynamicContentHeight={
            fixedContent ? undefined : Math.round(availableContentHeight * (presentation === 'fullscreen' ? 1 : 0.75))
          }
          pickerReady={pickerReady}
          presentation={presentation}
          presented={presented}
          sheetHeight={fixedSheetHeight}
          onClose={close}
          onOpenReady={handleSheetChange}
        >
          {children(focusSignal, awaitKeyboardSettled)}
        </FixedComposerPanel>
      </ComposerKeyboardHost>
    </Portal>
  );
}
