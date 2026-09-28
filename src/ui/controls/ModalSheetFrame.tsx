import { recordUserInteraction } from '@/platform/network/userPresence';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderTheme } from '@/ui/theme/tokens';
import {
  ComposerKeyboardHost,
  type ComposerKeyboardHostHandle,
  type ComposerImeInsetsEvent
} from '@/ui/composer/ComposerKeyboardHost';
import Animated, { useAnimatedStyle, useEvent, useSharedValue } from 'react-native-reanimated';

function createStyles(theme: ReaderTheme, _settings: ReaderSettings) {
  return StyleSheet.create({
    root: {
      flex: 1,
      justifyContent: 'flex-end'
    },
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.32)'
    },
    sheet: {
      maxHeight: '82%',
      gap: 12,
      backgroundColor: theme.surface,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingHorizontal: 16,
      paddingTop: 9,
      paddingBottom: 18
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: theme.lineStrong
    }
  });
}

export function ModalSheetFrame({
  backdropLabel,
  bottomInset = 0,
  children,
  keyboardAvoiding = true,
  keyboardAvoidingEnabled = true,
  keyboardHostRef,
  visible,
  onRequestClose
}: {
  backdropLabel: string;
  bottomInset?: number;
  children: ReactNode;
  keyboardAvoiding?: boolean;
  keyboardAvoidingEnabled?: boolean;
  keyboardHostRef?: RefObject<ComposerKeyboardHostHandle | null>;
  visible: boolean;
  onRequestClose: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const localImeInsets = Platform.OS === 'android' && Number(Platform.Version) >= 30 && !!keyboardHostRef;
  const trackImeInsets = localImeInsets && keyboardAvoiding && keyboardAvoidingEnabled && visible;
  const imeBottom = useSharedValue(0);
  const onImeInsets = useEvent<ComposerImeInsetsEvent>(
    (event) => {
      'worklet';
      imeBottom.set(event.bottom);
    },
    ['onImeInsets']
  );
  const imeStyle = useAnimatedStyle(() => ({ paddingBottom: trackImeInsets ? imeBottom.value : 0 }));
  // Legacy windows keep their existing KAV fallback. The local animated window
  // follows native Insets instead of keyboardDidHide's early target visibility.
  const [androidKeyboardResetKey, setAndroidKeyboardResetKey] = useState(0);
  const [androidKeyboardVisible, setAndroidKeyboardVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible || !keyboardAvoiding || localImeInsets) {
      setAndroidKeyboardVisible(false);
      return;
    }
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setAndroidKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardVisible(false);
      setAndroidKeyboardResetKey((current) => current + 1);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardAvoiding, localImeInsets, visible]);
  const sheet = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backdropLabel}
        style={styles.backdrop}
        onPress={onRequestClose}
      />
      <View style={[styles.sheet, bottomInset ? { marginBottom: bottomInset } : null]}>
        <View style={styles.handle} />
        {children}
      </View>
    </>
  );

  const content = localImeInsets ? (
    <Animated.View
      onTouchStart={recordUserInteraction}
      onTouchMove={recordUserInteraction}
      style={[styles.root, imeStyle]}
    >
      {sheet}
    </Animated.View>
  ) : keyboardAvoiding ? (
    <KeyboardAvoidingView
      onTouchStart={recordUserInteraction}
      onTouchMove={recordUserInteraction}
      key={Platform.OS === 'android' && !keyboardHostRef ? `${visible}-${androidKeyboardResetKey}` : undefined}
      behavior={keyboardHostRef ? 'padding' : 'height'}
      enabled={keyboardAvoidingEnabled && visible && (Platform.OS !== 'android' || androidKeyboardVisible)}
      style={styles.root}
    >
      {sheet}
    </KeyboardAvoidingView>
  ) : (
    <View style={styles.root} onTouchStart={recordUserInteraction} onTouchMove={recordUserInteraction}>
      {sheet}
    </View>
  );
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onRequestClose}>
      {keyboardHostRef ? (
        <ComposerKeyboardHost
          ref={keyboardHostRef}
          enabled={visible}
          trackImeInsets={trackImeInsets}
          onImeInsets={trackImeInsets ? onImeInsets : undefined}
          testID="composer-modal-keyboard-host"
          style={{ flex: 1 }}
        >
          {content}
        </ComposerKeyboardHost>
      ) : (
        content
      )}
    </Modal>
  );
}
