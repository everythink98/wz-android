import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, type StyleProp, type ViewStyle, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Portal } from '@gorhom/portal';
import type { ComposerPresentation } from '@/domain/forum/structuredComposer';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useKeyboardHandoff } from '@/ui/hooks/useKeyboardHandoff';
import type { ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';
import { FixedComposerPanel } from './FixedComposerPanel';

export function ComposerBottomSheet({
  active = true,
  backgroundStyle,
  backdropDismissLabel,
  children,
  containerStyle,
  contentStyle,
  dark,
  fixedContent = false,
  presentation = 'sheet',
  releaseAfterClose = false,
  visible,
  onBackDuringClose,
  onClosed,
  onOpenChange,
  onPresentationChange
}: {
  active?: boolean;
  backgroundStyle?: StyleProp<ViewStyle>;
  backdropDismissLabel?: string;
  children: (focusSignal: number, awaitKeyboardSettled: () => Promise<void>) => ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  dark: boolean;
  fixedContent?: boolean;
  presentation?: ComposerPresentation;
  releaseAfterClose?: boolean;
  visible: boolean;
  onBackDuringClose?: () => boolean;
  onClosed?: () => void;
  onOpenChange: (open: boolean) => void;
  onPresentationChange?: (presentation: ComposerPresentation) => void;
}) {
  const insets = useSafeAreaInsets();
  const presented = visible && active;
  const [hasPresented, setHasPresented] = useState(presented);
  useEffect(() => {
    if (presented) setHasPresented(true);
  }, [presented]);
  const { height } = useWindowDimensions();
  const committedVisible = useCommittedRef(presented);
  const wantedOpen = useCommittedRef(visible);
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
    // A late animation cannot release a reopened editor's keyboard subscription.
    if (committedVisible.current) return;
    setKeyboardActive(false);
    if (wantedOpen.current) return;
    if (releaseAfterClose) setHasPresented(false);
    onClosed?.();
  }, [committedVisible, onClosed, releaseAfterClose, wantedOpen]);
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
      if (onBackDuringClose?.()) return true;
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
  }, [awaitKeyboardSettled, onBackDuringClose, onOpenChange, onPresentationChange, presentation, presented]);

  if (!presented && !hasPresented) return null;
  return (
    <Portal>
      <FixedComposerPanel
        backdropAction={
          backdropDismissLabel ? { label: backdropDismissLabel, onPress: () => onOpenChange(false) } : undefined
        }
        backgroundStyle={resolvedBackgroundStyle}
        containerStyle={containerStyle}
        contentStyle={fixedContent ? contentStyle : paddedContentStyle}
        dark={dark}
        height={height}
        insets={insets}
        keyboardActive={keyboardActive}
        keyboardHostRef={keyboardHost}
        maxDynamicContentHeight={
          fixedContent ? undefined : Math.round(availableContentHeight * (presentation === 'fullscreen' ? 1 : 0.75))
        }
        pickerReady={pickerReady}
        presentation={presentation}
        presented={presented}
        sheetHeight={fixedSheetHeight}
        onClose={close}
        onImeBack={onBackDuringClose}
        onOpenReady={handleSheetChange}
      >
        {children(focusSignal, awaitKeyboardSettled)}
      </FixedComposerPanel>
    </Portal>
  );
}
