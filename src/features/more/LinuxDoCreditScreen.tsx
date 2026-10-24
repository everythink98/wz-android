import { FlatList, StyleSheet, Text, View } from 'react-native';
import {
  formatLinuxDoCreditAmount,
  LinuxDoCreditError,
  linuxDoCreditStatusLabel,
  type LinuxDoCreditAccount,
  type LinuxDoCreditEntry
} from '@/domain/forum/linuxDoCredit';
import { formatDateTime } from '@/domain/forum/presentation';
import { errorMessage } from '@/platform/network/errors';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';

const typeLabels = new Map([
  ['receive', '商户收入'],
  ['payment', '消费'],
  ['transfer', '转移'],
  ['community', '社区划转'],
  ['online', '在线流转'],
  ['distribute', '商户分发'],
  ['test', '测试交易'],
  ['red_envelope_send', '发送红包'],
  ['red_envelope_receive', '领取红包'],
  ['red_envelope_refund', '红包退款']
]);

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const size = (value: number) => Math.round(value * settings.fontScale);
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: theme.surface },
    content: { paddingHorizontal: 20, paddingBottom: 16 },
    header: { gap: 6, paddingTop: 16, paddingBottom: 12 },
    title: { fontFamily, color: theme.ink, fontSize: size(14), fontWeight: '600', lineHeight: size(21) },
    balance: { fontFamily, color: theme.ink, fontSize: size(28), fontWeight: '600', fontVariant: ['tabular-nums'] },
    text: {
      fontFamily,
      color: theme.ink,
      fontSize: size(14),
      lineHeight: size(21),
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: '50%'
    },
    amount: {
      fontFamily,
      color: theme.ink,
      fontSize: size(16),
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      maxWidth: '100%',
      marginLeft: 'auto'
    },
    meta: { fontFamily, color: theme.muted, fontSize: size(12), lineHeight: size(18) },
    error: { fontFamily, color: theme.danger, fontSize: size(13), lineHeight: size(20) },
    entry: { gap: 4, paddingVertical: 12, borderTopColor: theme.line, borderTopWidth: StyleSheet.hairlineWidth },
    row: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      columnGap: 12,
      rowGap: 4
    },
    description: { flexGrow: 1, flexShrink: 1, flexBasis: '50%' },
    status: { textAlign: 'right', marginLeft: 'auto' },
    income: { color: theme.primary },
    footer: { alignItems: 'center', paddingVertical: 20 },
    actions: { alignItems: 'flex-start' },
    recordsTitle: { paddingTop: 18 }
  });
}

export function LinuxDoCreditScreen({
  account,
  entries,
  busy,
  refreshing,
  loaded,
  hasMore,
  error,
  forumVerificationRequired = false,
  onLoadMore,
  onRefresh,
  onConnect
}: {
  account?: LinuxDoCreditAccount;
  entries: LinuxDoCreditEntry[];
  busy: boolean;
  refreshing: boolean;
  loaded: boolean;
  hasMore: boolean;
  error: unknown;
  forumVerificationRequired?: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  onConnect: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const accessError = error instanceof LinuxDoCreditError ? error.kind : undefined;
  const needsConnection = accessError === 'authorization-required' || accessError === 'identity-mismatch';
  const visibleAccount = needsConnection ? undefined : account;
  const visibleEntries = needsConnection ? [] : entries;
  const webAction = forumVerificationRequired || needsConnection || accessError === 'verification-required';
  const connectLabel = forumVerificationRequired
    ? '验证 L 站'
    : accessError === 'identity-mismatch'
      ? '重新连接 LDC'
      : accessError === 'verification-required'
        ? '验证 LDC'
        : '连接 LDC';

  return (
    <FlatList
      overScrollMode="never"
      testID="linuxdo-credit-list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={visibleEntries}
      keyExtractor={(entry) => entry.id}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.meta}>可用余额 · LDC</Text>
          <Text style={styles.balance}>
            {visibleAccount ? formatLinuxDoCreditAmount(visibleAccount.availableBalance) : '—'}
          </Text>
          {visibleAccount ? (
            <Text style={styles.meta}>待到账 {formatLinuxDoCreditAmount(visibleAccount.pendingBalance)} LDC</Text>
          ) : null}
          {error ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {errorMessage(error)}
            </Text>
          ) : null}
          {error && visibleAccount ? <Text style={styles.meta}>保留上次读取结果</Text> : null}
          {forumVerificationRequired || error || (!busy && !loaded && !visibleAccount) ? (
            <View style={styles.actions}>
              <AppButton
                label={webAction || !error ? connectLabel : '重试读取'}
                variant="primary"
                disabled={busy || refreshing}
                onPress={webAction || !error ? onConnect : onRefresh}
              />
            </View>
          ) : null}
          <View style={[styles.row, styles.recordsTitle]}>
            <Text accessibilityRole="header" style={styles.title}>
              收支记录
            </Text>
            <Text style={styles.meta}>单位：LDC</Text>
          </View>
        </View>
      }
      ListEmptyComponent={
        busy ? <LoadingState text="读取 LDC 记录中" /> : !error && loaded ? <EmptyText text="暂无收支记录" /> : null
      }
      renderItem={({ item }) => {
        const direction = item.direction === 'income' ? '收入' : item.direction === 'expense' ? '支出' : '金额';
        const sign = item.direction === 'income' ? '+' : item.direction === 'expense' ? '-' : '';
        const amount = formatLinuxDoCreditAmount(
          item.direction === 'neutral' ? item.amount : item.amount.replace(/^-/, '')
        );
        return (
          <View style={styles.entry}>
            <View style={styles.row}>
              <Text style={styles.text}>{item.title}</Text>
              <Text
                accessibilityLabel={`${direction} ${sign}${amount} LDC`}
                style={[styles.amount, item.direction === 'income' && styles.income]}
              >
                {sign}
                {amount}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={[styles.meta, styles.description]}>
                {typeLabels.get(item.type) || '其他交易'}
                {item.counterparty ? ` · 对方 ${item.counterparty}` : ''}
              </Text>
              <Text style={[styles.meta, styles.status]}>
                {linuxDoCreditStatusLabel(item.status)}
                {item.settlementPending ? ' · 待到账' : ''}
              </Text>
            </View>
            <Text style={styles.meta}>{formatDateTime(item.createdAt)}</Text>
          </View>
        );
      }}
      ListFooterComponent={
        <View style={styles.footer}>
          {hasMore && !needsConnection ? (
            <AppButton
              label={busy || refreshing ? '读取中' : error ? '重试加载更多' : '加载更多记录'}
              variant="ghost"
              disabled={busy || refreshing || webAction}
              onPress={onLoadMore}
            />
          ) : loaded && visibleEntries.length > 0 ? (
            <Text style={styles.meta}>没有更多了</Text>
          ) : null}
        </View>
      }
    />
  );
}
