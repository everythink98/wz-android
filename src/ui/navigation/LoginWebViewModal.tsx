import { recordUserInteraction } from '@/platform/network/userPresence';
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { X, type LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createLoginWebViewStyles } from './loginWebViewStyles';

export function LoginWebViewAction({
  label,
  displayLabel = label,
  icon: Icon,
  primary = false,
  danger = false,
  disabled = false,
  testID,
  onPress
}: {
  label: string;
  displayLabel?: string;
  icon: LucideIcon;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  testID?: string;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createLoginWebViewStyles);
  const color = primary ? theme.onPrimary : danger ? theme.danger : theme.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        recordUserInteraction();
        onPress();
      }}
      style={[
        styles.action,
        primary && styles.actionPrimary,
        !displayLabel && styles.actionIcon,
        disabled && styles.actionDimmed
      ]}
    >
      <Icon size={16} strokeWidth={1.8} color={color} accessible={false} />
      {displayLabel ? (
        <Text numberOfLines={1} style={[styles.actionText, { color }]}>
          {displayLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function LoginWebViewModal({
  actions,
  children,
  error,
  loading,
  loadingText,
  title,
  subtitle,
  visible,
  onClose
}: {
  actions?: ReactNode;
  children: ReactNode;
  error?: string;
  loading: boolean;
  loadingText: string;
  title: string;
  subtitle: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createLoginWebViewStyles);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        onTouchStart={recordUserInteraction}
        onTouchMove={recordUserInteraction}
        style={[styles.loginWebViewModal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        <View style={styles.loginWebViewHeader}>
          <View style={styles.loginWebViewTitleBlock}>
            <Text style={styles.loginWebViewTitle}>{title}</Text>
            <Text style={styles.loginWebViewSubtitle}>{subtitle}</Text>
          </View>
          <LoginWebViewAction label="关闭" displayLabel="" icon={X} onPress={onClose} />
        </View>
        {actions ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.loginWebViewToolbar}
            contentContainerStyle={styles.toolbarContent}
          >
            {actions}
          </ScrollView>
        ) : null}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.loginWebViewBody}>
          {loading ? (
            <View pointerEvents="none" style={styles.loading}>
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.loadingText}>{loadingText}</Text>
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}
