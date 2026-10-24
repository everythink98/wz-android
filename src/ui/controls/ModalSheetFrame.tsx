import { recordUserInteraction } from '@/platform/network/userPresence';
import { useContext, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { IconButton } from './ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { NavigationGlass } from '@/ui/navigation/NavigationGlass';
import { fontFamilyValue, readerRadii, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';
import {
  ComposerKeyboardHost,
  type ComposerKeyboardHostHandle,
  type ComposerImeInsetsEvent
} from '@/ui/composer/ComposerKeyboardHost';
import Animated, { useAnimatedStyle, useEvent, useSharedValue } from 'react-native-reanimated';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
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
      overflow: 'hidden',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopLeftRadius: readerRadii.sheet,
      borderTopRightRadius: readerRadii.sheet,
      paddingHorizontal: 16,
      paddingTop: 9
    },
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: readerRadii.pill,
      backgroundColor: theme.lineStrong
    },
    header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerCopy: { flex: 1, minWidth: 0, gap: 2 },
    title: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(17 * settings.fontScale),
      lineHeight: Math.round(22 * settings.fontScale),
      includeFontPadding: false,
      fontWeight: '600'
    },
    subtitle: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(12 * settings.fontScale),
      lineHeight: Math.round(17 * settings.fontScale),
      includeFontPadding: false
    }
  });
}

export function ModalSheetHeader({
  title,
  subtitle,
  closeLabel,
  closeTestID,
  closeDisabled = false,
  onClose
}: {
  title: string;
  subtitle?: string;
  closeLabel: string;
  closeTestID?: string;
  closeDisabled?: boolean;
  onClose: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View testID="modal-sheet-header" style={styles.header}>
      <View style={styles.headerCopy}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <IconButton
        icon={X}
        iconOnly
        label={closeLabel}
        testID={closeTestID}
        disabled={closeDisabled}
        onPress={onClose}
      />
    </View>
  );
}

export function ModalSheetFrame({
  backdropLabel,
  bottomInset = 0,
  children,
  keyboardAvoiding = true,
  keyboardAvoidingEnabled = true,
  keyboardHostRef,
  autoShowIme = false,
  visible,
  onRequestClose
}: {
  backdropLabel: string;
  bottomInset?: number;
  children: ReactNode;
  keyboardAvoiding?: boolean;
  keyboardAvoidingEnabled?: boolean;
  keyboardHostRef?: RefObject<ComposerKeyboardHostHandle | null>;
  autoShowIme?: boolean;
  visible: boolean;
  onRequestClose: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const safeAreaInsets = useContext(SafeAreaInsetsContext);
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
      <View
        testID="modal-sheet"
        style={[
          styles.sheet,
          { paddingBottom: Math.max(18, safeAreaInsets?.bottom ?? 0) },
          bottomInset ? { marginBottom: bottomInset } : null
        ]}
      >
        <NavigationGlass variant="surface" />
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
          autoShowIme={autoShowIme && visible}
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
