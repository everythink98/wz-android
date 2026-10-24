import { recordUserInteraction } from '@/platform/network/userPresence';
import { type ReactNode } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { ActivityIndicator, Button, IconButton } from 'react-native-paper';
import { CircleAlert, X, type LucideIcon } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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
  const actionColor = displayLabel ? (theme.dark ? theme.primary : theme.primaryStrong) : theme.ink;
  const color = primary ? theme.onPrimary : danger ? theme.danger : actionColor;
  const handlePress = () => {
    recordUserInteraction();
    onPress();
  };
  if (!displayLabel) {
    return (
      <IconButton
        testID={testID}
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        disabled={disabled || loading}
        loading={loading}
        icon={({ color, size }) => <Icon size={size} strokeWidth={1.8} color={color} accessible={false} />}
        iconColor={color}
        size={20}
        style={styles.iconAction}
        onPress={handlePress}
      />
    );
  }
  return (
    <Button
      testID={testID}
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      loading={loading}
      mode={primary ? 'contained' : 'text'}
      compact
      icon={({ color }) => <Icon size={16} strokeWidth={1.8} color={color} accessible={false} />}
      textColor={color}
      style={[styles.action, primary && styles.actionPrimary]}
      contentStyle={styles.actionContent}
      labelStyle={[styles.actionLabel, { color }]}
      onPress={handlePress}
    >
      {displayLabel}
    </Button>
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

  return (
    <Modal
      visible={visible}
      backdropColor={theme.surface}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaProvider style={styles.loginWebViewModal}>
        <SafeAreaView
          onTouchStart={recordUserInteraction}
          onTouchMove={recordUserInteraction}
          style={styles.loginWebViewModal}
        >
          <View style={styles.loginWebViewChrome}>
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
              <View style={styles.errorBox} accessibilityLiveRegion="polite">
                <CircleAlert size={18} strokeWidth={1.8} color={theme.danger} accessible={false} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.loginWebViewBody} testID="login-webview-content">
            {loading ? (
              <View pointerEvents="none" style={styles.loading} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={theme.primary} accessible={false} />
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
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
