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
  loading = false,
  testID,
  onPress
}: {
  label: string;
  displayLabel?: string;
  icon: LucideIcon;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  loading?: boolean;
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
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={() => {
        recordUserInteraction();
        onPress();
      }}
      style={[
        styles.action,
        primary && styles.actionPrimary,
        !displayLabel && styles.actionIcon,
        (disabled || loading) && styles.actionDimmed
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} accessible={false} style={styles.actionIndicator} />
      ) : (
        <Icon size={16} strokeWidth={1.8} color={color} accessible={false} />
      )}
      {displayLabel ? <Text style={[styles.actionText, { color }]}>{displayLabel}</Text> : null}
    </Pressable>
  );
}

export function LoginWebViewModal({
  actions,
  children,
  error,
  footer,
  loading,
  loadingText,
  primaryAction,
  refreshAction,
  title,
  subtitle,
  visible,
  onClose
}: {
  actions?: ReactNode;
  children: ReactNode;
  error?: string;
  footer?: ReactNode;
  loading: boolean;
  loadingText: string;
  primaryAction?: ReactNode;
  refreshAction?: ReactNode;
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
            overScrollMode="never"
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.loginWebViewToolbar}
            contentContainerStyle={styles.toolbarContent}
          >
            <View style={styles.actions}>{actions}</View>
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
        {footer || primaryAction || refreshAction ? (
          <View style={styles.loginWebViewFooter}>
            {footer}
            {primaryAction || refreshAction ? (
              <View style={styles.footerActions}>
                {primaryAction ? <View style={styles.primaryAction}>{primaryAction}</View> : null}
                {refreshAction}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
