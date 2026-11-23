import { ActivityIndicator } from 'react-native-paper';
import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import {
  dispatchFocusedRoute,
  goBackFromFocusedRoute,
  manageContentSourcesAction,
  type FocusedRouteNavigation
} from '@/ui/navigation/appRouteActions';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import type { AuthNotice } from '@/domain/session/siteSessionPrompts';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createUiFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  fontFamilyValue,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';
import { AppButton } from './ButtonControls';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.uiFontFamily);
  const fontSize = createUiFontSizer(settings);
  return StyleSheet.create({
    authNoticeBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    authNoticeText: { fontFamily, ...textSizeStyle(fontSize(13), fontSize(19)) },
    authNoticeDanger: { color: theme.danger },
    authNoticeNeutral: { color: theme.muted },
    authNoticeWarning: { color: theme.warning },
    empty: { color: theme.muted, fontFamily, ...textSizeStyle(fontSize(13)), paddingVertical: 24, textAlign: 'center' },
    recoverableEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 24
    },
    loadingRow: {
      width: '100%',
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      minHeight: 112,
      paddingHorizontal: 16,
      paddingVertical: 28
    },
    loadingRowCompact: {
      minHeight: 48,
      paddingVertical: 12
    },
    indicatorSlot: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center'
    },
    indicatorSpace: { width: 24, height: 24 },
    loadingText: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(13),
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: fontSize(18)
    },
    disabledCard: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      minHeight: 140,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 22
    },
    routeState: { flex: 1, margin: 16, width: undefined },
    stateTitle: {
      color: theme.ink,
      fontFamily,
      ...textSizeStyle(fontSize(17)),
      fontWeight: '600',
      textAlign: 'center'
    },
    text: { color: theme.muted, fontFamily, ...textSizeStyle(fontSize(13), fontSize(19)) },
    centeredText: { textAlign: 'center' },
    actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }
  });
}

export function AuthNoticeBox({ notice, children }: { notice: AuthNotice; children?: ReactNode }) {
  const { styles } = useReaderThemeStyles(createStyles);
  const toneStyle =
    notice.tone === 'danger'
      ? styles.authNoticeDanger
      : notice.tone === 'warning'
        ? styles.authNoticeWarning
        : styles.authNoticeNeutral;
  return (
    <View style={styles.authNoticeBox}>
      <Text style={[styles.authNoticeText, toneStyle]}>{notice.message}</Text>
      {children}
    </View>
  );
}

export function EmptyText({ text }: { text: string }) {
  const { styles } = useReaderThemeStyles(createStyles);
  return <Text style={styles.empty}>{text}</Text>;
}

export function RecoverableEmptyState({
  message,
  actionLabel,
  onAction
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View testID="recoverable-empty-state" style={styles.recoverableEmpty}>
      <Text style={[styles.text, styles.centeredText]}>{message}</Text>
      <AppButton label={actionLabel} variant="primary" onPress={onAction} />
    </View>
  );
}

export function LoadingState({
  text = '加载中',
  animating = true,
  compact = false
}: {
  text?: string;
  animating?: boolean;
  compact?: boolean;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  return (
    <View
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      role="status"
      style={[styles.loadingRow, compact && styles.loadingRowCompact]}
    >
      {animating ? (
        <View style={styles.indicatorSlot}>
          <ActivityIndicator accessible={false} color={theme.primary} size={18} />
        </View>
      ) : (
        <View testID="loading-indicator-space" style={styles.indicatorSpace} />
      )}
      <Text accessible={false} style={styles.loadingText}>
        {text}
      </Text>
    </View>
  );
}

export function ContentSourceDisabledState({
  source,
  navigation
}: {
  source: Source;
  navigation: FocusedRouteNavigation;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const title = `${sourceCatalog[source].label}已停用`;
  const text = '该内容源已停用，启用后才能查看此内容。';
  const onPageLayout = useStartupPageLayout();
  return (
    <View style={[styles.disabledCard, styles.routeState]} onLayout={onPageLayout}>
      <Text accessibilityRole="header" style={styles.stateTitle}>
        {title}
      </Text>
      <Text style={[styles.text, styles.centeredText]}>{text}</Text>
      <View style={styles.actions}>
        <AppButton
          label="管理内容源"
          variant="primary"
          onPress={() => dispatchFocusedRoute(navigation, manageContentSourcesAction())}
        />
        <AppButton label="返回" variant="ghost" onPress={() => goBackFromFocusedRoute(navigation)} />
      </View>
    </View>
  );
}
