import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { AuthNotice } from '@/domain/session/siteSessionPrompts';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from './ButtonControls';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    authNoticeBox: {
      gap: 8,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    authNoticeText: { fontFamily, fontSize: 13, lineHeight: 19 },
    authNoticeDanger: { color: theme.danger },
    authNoticeNeutral: { color: theme.muted },
    authNoticeWarning: { color: theme.warning },
    empty: { color: theme.muted, fontFamily, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
    recoverableEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 24
    },
    state: {
      width: '100%',
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: 12,
      minHeight: 156,
      backgroundColor: alphaColor(theme.primary, 0.035),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.2 : 0.12),
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 22
    },
    routeState: { flex: 1, margin: 16 },
    header: { alignItems: 'center', flexDirection: 'row', gap: 9 },
    stateTitle: { color: theme.ink, fontFamily, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    text: { color: theme.muted, fontFamily, fontSize: 13 },
    centeredText: { textAlign: 'center' },
    actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
    placeholders: { gap: 8 },
    line: { alignSelf: 'stretch', height: 10, borderRadius: 999, backgroundColor: theme.line },
    shortLine: { width: '42%' },
    mutedLine: { width: '68%' }
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

export function LoadingState({ text }: { text: string }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  return (
    <View
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      role="status"
      style={styles.state}
    >
      <View style={styles.header}>
        <ActivityIndicator accessible={false} color={theme.primary} size="small" />
        <Text accessible={false} style={styles.text}>
          {text}
        </Text>
      </View>
      <View style={styles.placeholders}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={[styles.line, index === 0 && styles.shortLine, index === 2 && styles.mutedLine]} />
        ))}
      </View>
    </View>
  );
}

export function ContentSourceDisabledState({
  source,
  onBack,
  onManage
}: {
  source: Source;
  onBack: () => void;
  onManage: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const title = `${sourceCatalog[source].label}已停用`;
  const text = '该内容源已停用，启用后才能查看此内容。';
  return (
    <View style={[styles.state, styles.routeState]}>
      <Text accessibilityRole="header" style={styles.stateTitle}>
        {title}
      </Text>
      <Text style={[styles.text, styles.centeredText]}>{text}</Text>
      <View style={styles.actions}>
        <AppButton label="管理内容源" variant="primary" onPress={onManage} />
        <AppButton label="返回" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}
