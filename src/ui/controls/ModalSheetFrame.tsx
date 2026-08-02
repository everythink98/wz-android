import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
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
      ...StyleSheet.absoluteFillObject,
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
        <KeyboardAvoidingView behavior="height" enabled={keyboardAvoidingEnabled} style={styles.root}>
          {sheet}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.root}>{sheet}</View>
      )}
    </Modal>
  );
}
