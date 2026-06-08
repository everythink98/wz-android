import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import type { LinuxDoLevelProfile } from '../../sources/sourceGateway';
import type { SiteSessionViewModel } from '../../siteSessionState';
import { androidRipple, createStyles, type ReaderTheme } from '../../theme';
import { AppButton, IconButton } from '../../components/AppControls';

const LINUXDO_LEVEL_TABS = [
  { value: 'progress', label: '等级进度' },
  { value: 'activity', label: '活跃数据' }
] as const;

type LinuxDoLevelTab = typeof LINUXDO_LEVEL_TABS[number]['value'];

function formatChange(value?: number) {
  if (typeof value !== 'number' || value === 0) {
    return '';
  }
  return value > 0 ? `较上次 +${value}` : `较上次 ${value}`;
}

function formatActivitySeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}小时${rest}分` : `${hours}小时`;
  }
  return `${minutes}分`;
}

export function LinuxDoLevelPanel({
  busy,
  error,
  linuxDoSession,
  profile,
  styles,
  theme,
  onOpenLogin,
  onRefresh
}: {
  busy: boolean;
  error: string;
  linuxDoSession: SiteSessionViewModel;
  profile: LinuxDoLevelProfile | null;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenLogin: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<LinuxDoLevelTab>('progress');
  if (!linuxDoSession.canWrite) {
    return (
      <View style={styles.stack}>
        <Text style={styles.meta}>需要先保存 linux.do 登录 Cookie，等级数据只从手机本机读取。</Text>
        <View style={styles.actions}>
          <AppButton label="打开 linux.do 登录 / 验证" styles={styles} onPress={onOpenLogin} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      {profile ? (
        <>
          <View style={styles.levelSummary}>
            <View style={styles.levelSummaryHeader}>
              <View style={styles.levelTitleBlock}>
                <Text style={styles.levelEyebrow}>{profile.username}</Text>
                <Text style={styles.levelTitle}>
                  LV {profile.currentLevel}{profile.targetLevel !== null ? ` → LV ${profile.targetLevel}` : ''}
                </Text>
              </View>
              <IconButton icon={RefreshCw} label={busy ? '读取中' : '刷新等级'} iconOnly styles={styles} theme={theme} disabled={busy} onPress={onRefresh} />
            </View>
            <View style={styles.levelMetaRow}>
              <Text style={styles.levelBadge}>{profile.estimate ? '本机估算' : profile.source === 'connect' ? '官方进度' : '本机数据'}</Text>
              {profile.totalCount ? <Text style={styles.meta}>完成 {profile.achievedCount} / {profile.totalCount} 项</Text> : null}
            </View>
            <Text style={styles.meta}>{profile.note}</Text>
            <Text style={styles.meta}>上次读取 {new Date(profile.fetchedAt).toLocaleString('zh-CN', { hour12: false })}</Text>
          </View>
          <View style={styles.levelTabRail}>
            {LINUXDO_LEVEL_TABS.map((item) => (
              <Pressable
                key={item.value}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === item.value }}
                android_ripple={androidRipple(theme.primarySoft)}
                style={[styles.levelTab, tab === item.value && styles.levelTabActive]}
                onPress={() => setTab(item.value)}
              >
                <Text style={[styles.levelTabText, tab === item.value && styles.levelTabTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {tab === 'progress' ? (
            <View style={styles.levelRequirementList}>
              {profile.requirements.length ? profile.requirements.map((item) => (
                <View key={item.key} style={styles.levelRequirementRow}>
                  <View style={styles.levelRequirementHeader}>
                    <Text style={styles.levelRequirementLabel}>{item.label}</Text>
                    <Text style={[styles.levelRequirementValue, item.met ? styles.statusOk : undefined]}>
                      {item.displayCurrent} / {item.displayRequired}
                    </Text>
                  </View>
                  <View style={styles.levelProgressTrack}>
                    <View style={[styles.levelProgressFill, item.met && styles.levelProgressFillDone, { minWidth: item.ratio > 0 ? 2 : 0, width: item.ratio > 0 ? `${Math.max(2, Math.round(item.ratio * 100))}%` : 0 }]} />
                  </View>
                  <View style={styles.levelRequirementFooter}>
                    <Text style={styles.meta}>{Math.round(item.ratio * 100)}%</Text>
                    {formatChange(item.change) ? <Text style={styles.levelChangeText}>{formatChange(item.change)}</Text> : null}
                  </View>
                </View>
              )) : (
                <Text style={styles.meta}>当前等级不提供自动进度，只显示活跃数据。</Text>
              )}
            </View>
          ) : (
            <View style={styles.levelStatGrid}>
              <LevelStat label="访问天数" value={`${profile.activity.daysVisited}`} styles={styles} />
              <LevelStat label="浏览话题" value={`${profile.activity.topicsEntered}`} styles={styles} />
              <LevelStat label="已读帖子" value={`${profile.activity.postsReadCount}`} styles={styles} />
              <LevelStat label="阅读时长" value={formatActivitySeconds(profile.activity.timeRead)} styles={styles} />
              <LevelStat label="送出赞" value={`${profile.activity.likesGiven}`} styles={styles} />
              <LevelStat label="获赞" value={`${profile.activity.likesReceived}`} styles={styles} />
              <LevelStat label="帖子数量" value={`${profile.activity.postCount}`} styles={styles} />
              <LevelStat label="主题数量" value={`${profile.activity.topicCount}`} styles={styles} />
            </View>
          )}
        </>
      ) : (
        <View style={styles.levelEmptyState}>
          {busy ? <ActivityIndicator color={theme.primary} size="small" /> : null}
          <Text style={styles.meta}>{busy ? '正在读取当前账号统计。' : '点击刷新后读取当前账号统计。'}</Text>
          {!busy ? <IconButton icon={RefreshCw} label="刷新等级" compact styles={styles} theme={theme} onPress={onRefresh} /> : null}
        </View>
      )}
    </View>
  );
}

function LevelStat({
  label,
  value,
  styles
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.levelStatItem}>
      <Text style={styles.levelStatLabel}>{label}</Text>
      <Text style={styles.levelStatValue}>{value}</Text>
    </View>
  );
}
