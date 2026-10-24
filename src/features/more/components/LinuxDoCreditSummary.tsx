import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { formatLinuxDoCreditAmount, LinuxDoCreditError, type LinuxDoCreditAccount } from '@/domain/forum/linuxDoCredit';
import { errorMessage } from '@/platform/network/errors';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { AppButton } from '@/ui/controls/ButtonControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const size = (value: number) => Math.round(value * settings.fontScale);
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
    title: { fontFamily, color: theme.ink, fontSize: size(14), lineHeight: size(21) },
    value: {
      fontFamily,
      color: theme.ink,
      fontSize: size(20),
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      maxWidth: '100%'
    },
    meta: { fontFamily, color: theme.muted, fontSize: size(12), lineHeight: size(18) },
    link: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
    linkText: { fontFamily, color: theme.primary, fontSize: size(12), lineHeight: size(18) },
    error: { fontFamily, color: theme.danger, fontSize: size(13), lineHeight: size(20) },
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
  const accessError = error instanceof LinuxDoCreditError ? error.kind : undefined;
  const needsConnection = accessError === 'authorization-required' || accessError === 'identity-mismatch';
  const visibleAccount = needsConnection ? undefined : account;
  const connectLabel = forumVerificationRequired
    ? '验证 L 站'
    : accessError === 'identity-mismatch'
      ? '重新连接 LDC'
      : accessError === 'verification-required'
        ? '验证 LDC'
        : '连接 LDC';

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
      {!busy &&
      (forumVerificationRequired ||
        needsConnection ||
        accessError === 'verification-required' ||
        (!visibleAccount && !error)) ? (
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
