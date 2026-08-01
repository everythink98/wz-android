import type { AccountStyles } from '@/features/account/styles';
import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from '@/ui/controls/AppControls';

export function LoginWebViewModal({
  actions,
  children,
  error,
  loading,
  loadingText,
  styles,
  theme,
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
  styles: AccountStyles;
  theme: ReaderTheme;
  title: string;
  subtitle: string;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.loginWebViewModal, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.loginWebViewHeader}>
          <View style={styles.loginWebViewTitleBlock}>
            <Text style={styles.loginWebViewTitle}>{title}</Text>
            <Text style={styles.loginWebViewSubtitle}>{subtitle}</Text>
          </View>
          <AppButton label="关闭" variant="ghost" styles={styles} onPress={onClose} />
        </View>
        {actions ? <View style={styles.loginWebViewToolbar}>{actions}</View> : null}
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
