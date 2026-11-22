import { recordUserInteraction } from '@/platform/network/userPresence';
import { type ReactNode } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';
import { ActivityIndicator } from 'react-native-paper';
import { CircleAlert, X, type LucideIcon } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
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
  if (!displayLabel) {
    return (
      <IconButton
        testID={testID}
        iconOnly
        label={label}
        disabled={disabled}
        loading={loading}
        icon={Icon}
        onPress={onPress}
      />
    );
  }
  return (
    <AppButton
      testID={testID}
      accessibilityLabel={label}
      label={displayLabel}
      disabled={disabled}
      loading={loading}
      size="lg"
      style={[{ minHeight: 48, justifyContent: 'center' }, !primary && { backgroundColor: 'transparent' }]}
      icon={Icon}
      variant={primary ? 'solid' : danger ? 'danger' : 'primary'}
      onPress={onPress}
    />
  );
}

export function LoginWebViewModal({
  actions,
  children,
  error,
  footer,
  loading,
  loadingText,
  showContentWhileLoading = false,
  primaryAction,
  refreshAction,
  title,
  subtitle = '',
  visible,
  onClose
}: {
  actions?: ReactNode;
  children: ReactNode;
  error?: string;
  footer?: ReactNode;
  loading: boolean;
  loadingText: string;
  showContentWhileLoading?: boolean;
  primaryAction?: ReactNode;
  refreshAction?: ReactNode;
  title: string;
  subtitle?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createLoginWebViewStyles);

  const loadingBackground = loading && showContentWhileLoading ? { backgroundColor: 'transparent' } : undefined;
  return (
    <Modal
      visible={visible}
      transparent={showContentWhileLoading}
      backdropColor={showContentWhileLoading ? undefined : theme.surface}
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaProvider style={[styles.loginWebViewModal, loadingBackground]}>
        <SafeAreaView
          onTouchStart={recordUserInteraction}
          onTouchMove={recordUserInteraction}
          style={[styles.loginWebViewModal, loadingBackground]}
        >
          <View style={styles.loginWebViewChrome}>
            <View style={styles.loginWebViewHeader}>
              <View style={styles.loginWebViewTitleBlock}>
                <Text style={styles.loginWebViewTitle}>{title}</Text>
                {subtitle ? <Text style={styles.loginWebViewSubtitle}>{subtitle}</Text> : null}
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
          <View style={[styles.loginWebViewBody, loadingBackground]} testID="login-webview-content">
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
