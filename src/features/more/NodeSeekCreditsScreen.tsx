import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NodeSeekCreditEntry } from '@/domain/forum/accountData';
import { formatDateTime } from '@/domain/forum/presentation';
import { errorMessage } from '@/platform/network/errors';
import { AppButton } from '@/ui/controls/ButtonControls';
import { EmptyText } from '@/ui/controls/FeedbackStates';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import type { CreditDay } from './nodeSeekCredits';
import type { useNodeSeekCredits } from './useNodeSeekCredits';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const size = (value: number) => Math.round(value * settings.fontScale);
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 16, paddingBottom: 16 },
    header: {
      gap: 12,
      paddingVertical: 20,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    title: { fontFamily, color: theme.ink, fontSize: size(14), fontWeight: '600' },
    total: { fontFamily, color: theme.ink, fontSize: size(32), fontWeight: '700', fontVariant: ['tabular-nums'] },
    value: { fontFamily, color: theme.ink, fontSize: size(16), fontWeight: '600', fontVariant: ['tabular-nums'] },
    text: { fontFamily, color: theme.ink, fontSize: size(14), lineHeight: size(21), flexShrink: 1 },
    meta: { fontFamily, color: theme.muted, fontSize: size(12), lineHeight: size(18) },
    error: { fontFamily, color: theme.danger, fontSize: size(13), lineHeight: size(19) },
    day: { gap: 4, paddingTop: 24, paddingBottom: 8 },
    entry: { gap: 6, paddingVertical: 14, borderBottomColor: theme.line, borderBottomWidth: StyleSheet.hairlineWidth },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' },
    breakdown: { flexDirection: 'row', gap: 24, flexWrap: 'wrap' },
    income: { color: theme.primary },
    expense: { color: theme.danger },
    footer: { alignItems: 'center', paddingVertical: 20 }
  });
}

type CreditRow =
  { kind: 'day'; key: string; day: CreditDay } | { kind: 'entry'; key: string; entry: NodeSeekCreditEntry };
function totals(day: CreditDay) {
  return `收入 ${day.income} · 支出 ${day.expense} · 净变化 ${day.net > 0 ? '+' : ''}${day.net}`;
}

export function NodeSeekCreditsScreen({
  currency,
  summary,
  error,
  busy,
  refreshing,
  loaded,
  hasMore,
  loadMore,
  refresh
}: ReturnType<typeof useNodeSeekCredits>) {
  const { styles } = useReaderThemeStyles(createStyles);
  const currencyLabel = currency === 'coin' ? '鸡腿' : '星辰';
  const rows = useMemo(
    () =>
      summary.days.flatMap<CreditRow>((day) => [
        { kind: 'day', key: `day:${day.day}`, day },
        ...day.entries.map((entry, index) => ({ kind: 'entry' as const, key: `${day.day}:${index}`, entry }))
      ]),
    [summary.days]
  );
  return (
    <FlatList
      testID="nodeseek-credits-list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(row) => row.key}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.row}>
            <Text style={styles.title}>今日净变化</Text>
            {currency === 'coin' ? (
              <Text style={styles.meta}>
                {summary.today.complete
                  ? `签到 ${summary.today.attendanceIncome > 0 ? '+' : ''}${summary.today.attendanceIncome}`
                  : busy
                    ? '签到收益统计中'
                    : '签到收益待补齐'}
              </Text>
            ) : null}
          </View>
          <Text testID="credits-today-summary" style={summary.today.complete ? styles.total : styles.text}>
            {summary.today.complete
              ? `${summary.today.net > 0 ? '+' : ''}${summary.today.net}`
              : busy
                ? '统计中'
                : '待补齐'}
          </Text>
          {summary.today.complete ? (
            <View style={styles.breakdown}>
              <Text style={styles.meta}>收入 {summary.today.income}</Text>
              <Text style={styles.meta}>支出 {summary.today.expense}</Text>
            </View>
          ) : null}
          {!summary.consistent ? <Text style={styles.meta}>流水有更新，请刷新后统计</Text> : null}
          {!summary.ordered && hasMore ? <Text style={styles.meta}>记录待补齐</Text> : null}
          {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyText
          text={busy ? `读取${currencyLabel}流水中` : loaded ? `暂无${currencyLabel}流水` : '流水未读取，请刷新重试'}
        />
      }
      renderItem={({ item }) =>
        item.kind === 'day' ? (
          <View style={styles.day}>
            <View style={styles.row}>
              <Text style={styles.title}>{item.day.day}</Text>
              {currency === 'coin' && item.day.complete && item.day.attendanceIncome > 0 ? (
                <Text style={styles.meta}>签到 +{item.day.attendanceIncome}</Text>
              ) : null}
            </View>
            <Text style={styles.meta}>{item.day.complete ? totals(item.day) : '当日记录待补齐'}</Text>
          </View>
        ) : (
          <View style={styles.entry}>
            <View style={styles.row}>
              <Text style={styles.text}>{item.entry.reason}</Text>
              <Text style={[styles.value, item.entry.change >= 0 ? styles.income : styles.expense]}>
                {item.entry.change > 0 ? '+' : ''}
                {item.entry.change}
              </Text>
            </View>
            <View style={styles.row}>
              <Text accessibilityLabel={formatDateTime(item.entry.createdAt)} style={styles.meta}>
                {formatDateTime(item.entry.createdAt).slice(11)}
              </Text>
              <Text style={styles.meta}>余额 {item.entry.balance}</Text>
            </View>
          </View>
        )
      }
      ListFooterComponent={
        <View style={styles.footer}>
          {hasMore ? (
            <AppButton
              compact
              variant="ghost"
              label={busy || refreshing ? '读取中' : error ? '重试加载更多' : '加载更多流水'}
              disabled={busy || refreshing}
              onPress={loadMore}
            />
          ) : loaded ? (
            <Text style={styles.meta}>没有更多了</Text>
          ) : null}
        </View>
      }
    />
  );
}
