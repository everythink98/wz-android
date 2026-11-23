import { linuxDoCreditPresentation } from '../linuxDoCreditPresentation';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { formatLinuxDoCreditAmount, type LinuxDoCreditAccount } from '@/domain/forum/linuxDoCredit';
import { errorMessage } from '@/platform/network/errors';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createUiFontSizer,
  fontFamilyValue,
  type ReaderStyleSettings,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.uiFontFamily);
  const size = createUiFontSizer(settings);
  return StyleSheet.create({
    section: { paddingHorizontal: 20, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
    balance: {
      minHeight: 64,
      gap: 4,
      justifyContent: 'center',
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.line
    },
    title: { fontFamily, color: theme.ink, ...textSizeStyle(size(14), size(21)) },
    value: {
      fontFamily,
      color: theme.ink,
      ...textSizeStyle(size(20)),
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      maxWidth: '100%'
    },
    meta: { fontFamily, color: theme.muted, ...textSizeStyle(size(12), size(18)) },
    link: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
    linkText: { fontFamily, color: theme.primary, ...textSizeStyle(size(12), size(18)) },
    error: { fontFamily, color: theme.danger, ...textSizeStyle(size(13), size(20)) },
    actions: { alignItems: 'flex-start' }
  });
}

export function LinuxDoCreditSummary({
  account,
  busy,
  error,
  forumVerificationRequired = false,
  onOpen,
  onConnect,
  onRefresh
}: {
  account?: LinuxDoCreditAccount;
  busy: boolean;
  error: unknown;
  forumVerificationRequired?: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onRefresh: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const { visibleAccount, webAction, connectLabel } = linuxDoCreditPresentation(
    account,
    error,
    forumVerificationRequired
  );

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole={visibleAccount ? 'button' : undefined}
        accessibilityLabel={
          visibleAccount ? `LDC 可用余额 ${formatLinuxDoCreditAmount(visibleAccount.availableBalance)}` : undefined
        }
        accessibilityHint={visibleAccount ? '查看收支记录' : undefined}
        accessibilityState={{ busy }}
        disabled={!visibleAccount}
        style={styles.balance}
        onPress={() => {
          recordUserInteraction();
          onOpen();
        }}
      >
        <View style={styles.row}>
          <Text style={styles.title}>LDC 可用余额</Text>
          <Text style={styles.value}>
            {visibleAccount ? formatLinuxDoCreditAmount(visibleAccount.availableBalance) : '—'}
          </Text>
        </View>
        <View style={styles.row}>
          {visibleAccount ? (
            <Text style={styles.meta}>待到账 {formatLinuxDoCreditAmount(visibleAccount.pendingBalance)} LDC</Text>
          ) : busy ? (
            <Text accessibilityLiveRegion="polite" style={styles.meta}>
              读取余额中
            </Text>
          ) : !error ? (
            <Text style={styles.meta}>连接后查看余额和收支记录</Text>
          ) : null}
          {visibleAccount ? (
            <View style={styles.link}>
              <Text style={styles.linkText}>收支明细</Text>
              <ChevronRight color={theme.primary} size={14} accessible={false} />
            </View>
          ) : null}
        </View>
      </Pressable>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {errorMessage(error)}
        </Text>
      ) : null}
      {visibleAccount && error ? <Text style={styles.meta}>显示上次读取的余额</Text> : null}
      {!busy && (webAction || (!visibleAccount && !error)) ? (
        <View style={styles.actions}>
          <AppButton label={connectLabel} variant="primary" onPress={onConnect} />
        </View>
      ) : !busy && error ? (
        <View style={styles.actions}>
          <AppButton label="重试读取余额" variant="ghost" onPress={onRefresh} />
        </View>
      ) : null}
    </View>
  );
}
