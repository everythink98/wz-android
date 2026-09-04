import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderTheme } from '@/ui/theme/tokens';

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
  visible,
  onRequestClose
}: {
  backdropLabel: string;
  bottomInset?: number;
  children: ReactNode;
  keyboardAvoiding?: boolean;
  keyboardAvoidingEnabled?: boolean;
  visible: boolean;
  onRequestClose: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  // Android KAV can retain a positive internal bottom after keyboardDidHide; remount to drop its fixed-height frame.
  const [androidKeyboardResetKey, setAndroidKeyboardResetKey] = useState(0);
  const [androidKeyboardVisible, setAndroidKeyboardVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible || !keyboardAvoiding) {
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
  }, [keyboardAvoiding, visible]);
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

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onRequestClose}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          key={Platform.OS === 'android' ? `${visible}-${androidKeyboardResetKey}` : undefined}
          behavior="height"
          enabled={keyboardAvoidingEnabled && visible && (Platform.OS !== 'android' || androidKeyboardVisible)}
          style={styles.root}
        >
          {sheet}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.root}>{sheet}</View>
      )}
    </Modal>
  );
}
