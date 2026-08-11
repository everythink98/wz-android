import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, type StyleProp, type ViewStyle, useWindowDimensions } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';

export function ComposerBottomSheet({
  backgroundStyle,
  children,
  containerStyle,
  contentStyle,
  dark,
  visible,
  onFocusRequest,
  onOpenChange
}: {
  backgroundStyle?: StyleProp<ViewStyle>;
  children: (focusSignal: number) => ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  dark: boolean;
  visible: boolean;
  onFocusRequest?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const bottomSheetRef = useRef<BottomSheet>(null);
  const focusRequestRef = useRef(onFocusRequest);
  useCommitRefValue(focusRequestRef, onFocusRequest);
  const [focusSignal, setFocusSignal] = useState(0);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={dark ? 0.56 : 0.38}
        pressBehavior="close"
      />
    ),
    [dark]
  );
  const close = useCallback(() => {
    Keyboard.dismiss();
    onOpenChange(false);
  }, [onOpenChange]);
  const paddedContentStyle = useMemo(
    () => [contentStyle, { paddingBottom: Math.max(10, insets.bottom + 10) }],
    [contentStyle, insets.bottom]
  );

  useEffect(() => {
    if (visible) return;
    Keyboard.dismiss();
    bottomSheetRef.current?.close();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setFocusSignal((value) => value + 1);
      focusRequestRef.current?.();
    }, 220);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={visible ? 0 : -1}
      backgroundStyle={backgroundStyle}
      backdropComponent={renderBackdrop}
      containerStyle={containerStyle}
      enableDynamicSizing
      enablePanDownToClose
      handleComponent={null}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustPan"
      maxDynamicContentSize={Math.round((height - insets.top) * 0.75)}
      onClose={close}
    >
      <BottomSheetView style={paddedContentStyle}>{children(focusSignal)}</BottomSheetView>
    </BottomSheet>
  );
}
