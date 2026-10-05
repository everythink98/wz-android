import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import type { UserIdentity } from '@/domain/forum/models';
import { formatDateTime } from '@/domain/forum/presentation';
import type { NodeSeekCreditCurrency } from '@/domain/forum/accountData';
import { AppButton } from '@/ui/controls/ButtonControls';
import { DisclosureChevron, ExpandableContent } from '@/ui/controls/ExpandableControls';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { ReaderStyleSettings, ReaderTheme } from '@/ui/theme/tokens';
import type { MoreScreenStyles } from '../styles';
import type { useAccountOverview } from '../useAccountOverview';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    section: { gap: 4 },
    stats: { flexDirection: 'row', flexWrap: 'wrap' },
    stat: { justifyContent: 'center', minHeight: 56, paddingVertical: 4, paddingRight: 4, width: '25%' },
    statWide: { width: '50%' },
    value: { fontSize: Math.round(18 * settings.fontScale), fontWeight: '700' },
    placeholder: { color: theme.muted, fontWeight: '400' },
    label: { fontSize: Math.round(12 * settings.fontScale), lineHeight: Math.round(17 * settings.fontScale) },
    labelRow: { alignItems: 'center', flexDirection: 'row', gap: 2 },
    linkedLabel: { color: theme.primary },
    details: { gap: 4, paddingBottom: 4 },
    detailsToggle: {
      alignItems: 'center',
      borderRadius: 8,
      flexDirection: 'row',
      gap: 4,
      minHeight: 48,
      paddingHorizontal: 10
    },
    error: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 4 }
  });
}

export function AccountOverviewPanel({
  data,
  site,
  user,
  styles,
  onCommand,
  onOpenCredits
}: {
  data: ReturnType<typeof useAccountOverview>;
  site: SessionSite;
  user: UserIdentity;
  styles: MoreScreenStyles;
  onCommand: (command: AccountCenterCommand) => void | Promise<void>;
  onOpenCredits: (currency: NodeSeekCreditCurrency) => void;
}) {
  const detailsOwner = `${site}:${user.id}`;
  const [detailsState, setDetailsState] = useState<{
    owner: string;
    phase: 'unopened' | 'expanded' | 'collapsed';
  }>({ owner: detailsOwner, phase: 'unopened' });
  if (detailsState.owner !== detailsOwner && detailsState.phase !== 'unopened') {
    setDetailsState({ owner: detailsOwner, phase: 'unopened' });
  }
  const detailsExpanded = detailsState.owner === detailsOwner && detailsState.phase === 'expanded';
  const detailsVisited = detailsState.owner === detailsOwner && detailsState.phase !== 'unopened';
  const { width, fontScale } = useWindowDimensions();
  const { styles: localStyles, theme, settings } = useReaderThemeStyles(createStyles);
  const largeText = settings.fontScale * fontScale >= 1.35 || width < 360;
  const profile = data.profile;
  const overview = data.overview;
  const ns = overview?.source === 'nodeseek' ? overview : undefined;
  const yh = overview?.source === 'yaohuo' ? overview : undefined;
  const topicLabel = site === 'yaohuo' ? '帖子' : '主题';
  const stats: {
    label: string;
    value: number | string | undefined;
    action?: 'topics' | 'replies' | NodeSeekCreditCurrency;
  }[] = [
    { label: topicLabel, value: profile?.topicCount, action: 'topics' },
    { label: '回复', value: profile?.replyCount, action: 'replies' },
    ...(site === 'nodeseek'
      ? [
          { label: '鸡腿', value: ns?.coin, action: 'coin' as const },
          { label: '星辰', value: ns?.stardust, action: 'stardust' as const }
        ]
      : site === 'linuxdo'
        ? [
            { label: '获赞', value: profile?.likesReceived },
            {
              label: '阅读时长',
              value: profile?.timeRead === undefined ? undefined : `${Math.floor(profile.timeRead / 60)} 分`
            }
          ]
        : [
            { label: '妖晶', value: yh?.crystals },
            { label: '经验', value: yh?.experience }
          ])
  ];
  const details = [
    profile?.bio,
    profile?.joinedAt ? `加入日期 · ${formatDateTime(profile.joinedAt).replace(/ \d{2}:\d{2}$/, '')}` : undefined,
    ns?.fans === undefined ? undefined : `粉丝 · ${ns.fans}`,
    ns?.collectionCount === undefined ? undefined : `原站收藏 · ${ns.collectionCount}`,
    profile?.daysVisited === undefined ? undefined : `访问天数 · ${profile.daysVisited}`,
    profile?.topicsEntered === undefined ? undefined : `浏览话题 · ${profile.topicsEntered}`,
    profile?.postsReadCount === undefined ? undefined : `已读帖子 · ${profile.postsReadCount}`,
    profile?.likesGiven === undefined ? undefined : `送赞 · ${profile.likesGiven}`
  ].filter((value): value is string => Boolean(value));

  return (
    <View style={localStyles.section}>
      <View style={localStyles.stats}>
        {stats.map((stat, index) => (
          <Pressable
            key={index}
            accessibilityRole={stat.action ? 'button' : undefined}
            accessibilityLabel={`${stat.label} ${stat.value ?? (data.busy ? '加载中' : '暂无数据')}`}
            accessibilityState={{ busy: stat.value === undefined && data.busy }}
            accessibilityHint={
              stat.action === 'coin' ? '查看鸡腿流水' : stat.action === 'stardust' ? '查看星辰流水' : undefined
            }
            disabled={!stat.action}
            style={[localStyles.stat, largeText && localStyles.statWide]}
            onPress={() => {
              if (stat.action === 'coin' || stat.action === 'stardust') onOpenCredits(stat.action);
              else if (stat.action) void onCommand({ type: 'open-user', user, initialTab: stat.action });
            }}
          >
            <Text style={[styles.menuLabel, localStyles.value, stat.value === undefined && localStyles.placeholder]}>
              {stat.value ?? '—'}
            </Text>
            <View style={localStyles.labelRow}>
              <Text style={[styles.meta, localStyles.label, stat.action && localStyles.linkedLabel]}>{stat.label}</Text>
              {stat.action ? <ChevronRight size={12} color={theme.primary} strokeWidth={1.8} /> : null}
            </View>
          </Pressable>
        ))}
      </View>
      {yh?.memberLabel ? (
        <Text style={styles.meta}>
          {yh.memberLabel}
          {yh.memberExpiresAt ? ` · 有效期 ${yh.memberExpiresAt}` : ''}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {details.length ? (
          <Pressable
            accessibilityLabel={detailsExpanded ? '收起资料' : '更多资料'}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsExpanded }}
            style={localStyles.detailsToggle}
            onPress={() =>
              setDetailsState((state) => ({
                owner: detailsOwner,
                phase: state.owner === detailsOwner && state.phase === 'expanded' ? 'collapsed' : 'expanded'
              }))
            }
          >
            <Text style={styles.meta}>{detailsExpanded ? '收起资料' : '更多资料'}</Text>
            <DisclosureChevron expanded={detailsExpanded} color={theme.muted} size={14} />
          </Pressable>
        ) : null}
      </View>
      {data.error ? (
        <View style={localStyles.error}>
          <Text style={styles.errorText}>部分资料读取失败。</Text>
          <AppButton
            compact
            variant="ghost"
            label="重试资料"
            disabled={data.busy}
            onPress={() => void data.retryOverview()}
          />
        </View>
      ) : null}
      {details.length && detailsVisited ? (
        <ExpandableContent expanded={detailsExpanded} style={localStyles.details}>
          {details.map((detail) => (
            <Text key={detail} style={styles.meta}>
              {detail}
            </Text>
          ))}
        </ExpandableContent>
      ) : null}
    </View>
  );
}
