import { memo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import RenderHTML from 'react-native-render-html';
import { notificationSources, sourceCatalog, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification, NotificationDetail } from '@/domain/notifications/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { NotificationPermissionState } from './useNotificationsRuntime';
import type { NotificationState } from '@/platform/notifications/notificationStore';
import { Avatar } from '@/ui/avatar/Avatar';
import { AppButton } from '@/ui/controls/ButtonControls';
import { PillRail } from '@/ui/controls/SelectionControls';
import { pressWithFeedback } from '@/ui/controls/pressFeedback';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { androidRipple } from '@/ui/theme/tokens';
import {
  notificationAccessibilityLabel,
  notificationActionText,
  notificationTimeText
} from './notificationPresentation';
import { createNotificationStyles } from './styles';

export type NotificationFilterSource = 'all' | NotificationSource;

const sourceItems = [
  { value: 'all', label: '全部' },
  ...notificationSources.map((source) => ({ value: source, label: sourceCatalog[source].label }))
];

function EmptyState({
  action,
  secondaryAction,
  text,
  title
}: {
  action?: { label: string; run: () => void };
  secondaryAction?: { label: string; run: () => void };
  text: string;
  title: string;
}) {
  const { styles } = useReaderThemeStyles(createNotificationStyles);
  return (
    <View style={styles.centeredState} accessible accessibilityLabel={`${title}。${text}`}>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateText}>{text}</Text>
      {action || secondaryAction ? (
        <View style={styles.stateActions}>
          {action ? <AppButton label={action.label} onPress={action.run} /> : null}
          {secondaryAction ? (
            <AppButton variant="ghost" label={secondaryAction.label} onPress={secondaryAction.run} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function NotificationRow({ item, onPress }: { item: ForumNotification; onPress: () => void }) {
  const { styles, theme } = useReaderThemeStyles(createNotificationStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={notificationAccessibilityLabel(item)}
      android_ripple={androidRipple(theme.primarySoft)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => pressWithFeedback(onPress)}
    >
      <Avatar contentSource={item.source} small name={item.actor.name} uri={item.actor.avatarUrl} />
      <View style={styles.rowBody}>
        <View style={styles.actorRow}>
          <Text style={styles.actorText} numberOfLines={1}>
            <Text style={styles.actorName}>{item.actor.name}</Text>
            <Text style={styles.actionText}> {notificationActionText(item.kind)}</Text>
          </Text>
          {item.unread ? <View accessible={false} style={styles.unreadDot} /> : null}
        </View>
        <Text style={[styles.title, item.unread && styles.titleUnread]} numberOfLines={2}>
          {item.title}
          {item.preview ? <Text style={styles.previewInline}> · {item.preview}</Text> : null}
        </Text>
        <Text style={styles.meta}>
          {sourceCatalog[item.source].label} · {notificationTimeText(item)}
        </Text>
      </View>
    </Pressable>
  );
}

export const NotificationsScreen = memo(function NotificationsScreen({
  activeSources,
  errors,
  fetchingMore,
  hasMore,
  items,
  loading,
  markAllBusy,
  refreshing,
  source,
  sourcePending,
  unreadOnly,
  xiaoyinsiNeedsUpgrade,
  onChangeSource,
  onChangeUnreadOnly,
  onItemPress,
  onLoadMore,
  onMarkAll,
  onRefresh,
  onRetrySource,
  onUpgradeXiaoyinsi
}: {
  activeSources: readonly NotificationSource[];
  errors: Partial<Record<NotificationSource, string>>;
  fetchingMore: boolean;
  hasMore: boolean;
  items: ForumNotification[];
  loading: boolean;
  markAllBusy: boolean;
  refreshing: boolean;
  source: NotificationFilterSource;
  sourcePending: boolean;
  unreadOnly: boolean;
  xiaoyinsiNeedsUpgrade: boolean;
  onChangeSource: (source: NotificationFilterSource) => void;
  onChangeUnreadOnly: (value: boolean) => void;
  onItemPress: (item: ForumNotification) => void;
  onLoadMore: () => void;
  onMarkAll: () => void;
  onRefresh: () => void;
  onRetrySource: (source: NotificationSource) => void;
  onUpgradeXiaoyinsi: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createNotificationStyles);
  const errorSources = notificationSources.filter((candidate) => errors[candidate]);
  const sourceAvailable = source === 'all' ? activeSources.length > 0 : activeSources.includes(source);
  const visibleItems = items.filter((item) => activeSources.includes(item.source));
  const needsXiaoyinsiUpgrade = source === 'xiaoyinsi' && xiaoyinsiNeedsUpgrade;
  const emptyTitle = needsXiaoyinsiUpgrade
    ? '需要升级消息授权'
    : sourcePending
      ? '账号确认中'
      : !sourceAvailable
        ? '账号尚未就绪'
        : unreadOnly
          ? '暂无未读消息'
          : '暂无消息';
  const emptyText = !sourceAvailable
    ? needsXiaoyinsiUpgrade
      ? '原有读写授权仍然可用；升级授权后才能读取小隐寺消息。'
      : sourcePending
        ? `正在确认${sourceCatalog[source as NotificationSource].label}账号身份；完成后会自动加载消息。`
        : source === 'all'
          ? '登录任一支持的站点后，就能在这里统一查看消息。'
          : `请先登录 ${sourceCatalog[source].label}，并确认账号身份。`
    : unreadOnly
      ? '切换“只看未读”可查看已读消息。'
      : '原站有新消息时会显示在这里。';
  const showMarkAll = source !== 'all' && source !== 'yaohuo' && sourceAvailable;
  const outcome = loading
    ? undefined
    : !sourceAvailable
      ? 'auth'
      : visibleItems.length > 0
        ? errorSources.length > 0
          ? 'partial'
          : 'data'
        : errorSources.length > 0
          ? 'error'
          : 'empty';
  const header = (
    <View>
      <View style={styles.toolbar}>
        <PillRail
          variant="tabs"
          items={sourceItems}
          value={source}
          testIDPrefix="notification-source"
          onChange={(value) => onChangeSource(value as NotificationFilterSource)}
        />
        <View style={styles.controlRow}>
          <Text style={styles.controlLabel}>只看未读</Text>
          <Switch
            accessibilityLabel="只看未读"
            value={unreadOnly}
            trackColor={{ false: theme.lineStrong, true: theme.primarySoft }}
            thumbColor={unreadOnly ? theme.primary : theme.surface}
            onValueChange={onChangeUnreadOnly}
          />
        </View>
        {showMarkAll ? (
          <View style={styles.controlRow}>
            <Text style={styles.controlMeta}>仅标记 {sourceCatalog[source].label} 的消息</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`将 ${sourceCatalog[source].label} 全部标记为已读`}
              accessibilityState={{ busy: markAllBusy, disabled: markAllBusy }}
              disabled={markAllBusy}
              style={[styles.inlineAction, markAllBusy && styles.disabled]}
              onPress={() => pressWithFeedback(onMarkAll)}
            >
              <Text style={styles.inlineActionText}>{markAllBusy ? '处理中' : '全部已读'}</Text>
            </Pressable>
          </View>
        ) : source === 'yaohuo' && sourceAvailable ? (
          <Text style={styles.controlMeta}>妖火需逐条打开消息，由原站确认已读状态。</Text>
        ) : null}
      </View>
      {errorSources.length ? (
        <View style={styles.sourceNotice}>
          {errorSources.map((candidate) => (
            <View key={candidate} style={styles.sourceErrorRow}>
              <Text style={[styles.errorText, styles.sourceErrorText]}>
                {sourceCatalog[candidate].label}：{errors[candidate]}
              </Text>
              <AppButton
                compact
                label={`重试 ${sourceCatalog[candidate].label}`}
                onPress={() => onRetrySource(candidate)}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
  return (
    <FlashList
      accessibilityLabel="消息列表"
      testID={outcome ? `notification-outcome-${outcome}-${source}` : undefined}
      style={styles.screen}
      contentContainerStyle={styles.listContent}
      data={visibleItems}
      keyExtractor={(item) => `${item.source}:${item.id}`}
      getItemType={(item) => item.source}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      drawDistance={250}
      maintainVisibleContentPosition={{ disabled: true }}
      ListHeaderComponent={header}
      ListEmptyComponent={
        loading ? (
          <View style={styles.centeredState} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.stateText}>正在读取消息</Text>
          </View>
        ) : (
          <EmptyState
            title={emptyTitle}
            text={emptyText}
            action={needsXiaoyinsiUpgrade ? { label: '升级消息授权', run: onUpgradeXiaoyinsi } : undefined}
          />
        )
      }
      ListFooterComponent={
        fetchingMore ? (
          <View style={styles.footer} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.primary} size="small" />
          </View>
        ) : null
      }
      refreshControl={<RefreshControl refreshing={refreshing} colors={[theme.primary]} onRefresh={onRefresh} />}
      renderItem={({ item }) => <NotificationRow item={item} onPress={() => onItemPress(item)} />}
      onEndReached={hasMore && !fetchingMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.4}
    />
  );
});

function sourceSettingStatus(
  source: NotificationSource,
  state: NotificationState,
  sessions: SiteSessionViewModels,
  xiaoyinsiNeedsUpgrade: boolean
) {
  if (source === 'xiaoyinsi' && xiaoyinsiNeedsUpgrade) return '需升级授权；开关意图会保留';
  if (sessions[source].identityTrust === 'pending') {
    return '账号确认中；开关意图会保留';
  }
  if (!sessions[source].isLoggedIn || sessions[source].identityTrust !== 'confirmed') return '未登录；开关意图会保留';
  return state.sources[source].intentEnabled ? '已启用' : '已关闭';
}

export function NotificationSettingsScreen({
  backgroundEnabled,
  backgroundError,
  busy,
  permission,
  sessions,
  state,
  xiaoyinsiNeedsUpgrade,
  onOpenSystemSettings,
  onToggleGlobal,
  onToggleSource,
  onUpgradeXiaoyinsi
}: {
  backgroundEnabled: boolean;
  backgroundError: string;
  busy: boolean;
  permission: NotificationPermissionState;
  sessions: SiteSessionViewModels;
  state: NotificationState;
  xiaoyinsiNeedsUpgrade: boolean;
  onOpenSystemSettings: () => void;
  onToggleGlobal: (enabled: boolean) => void;
  onToggleSource: (source: NotificationSource, enabled: boolean) => void;
  onUpgradeXiaoyinsi: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createNotificationStyles);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.settingsContent}>
      <Text style={styles.settingsIntro}>
        Android 通知默认关闭。启用后，系统会在本机约每 15
        分钟安排一次检查；force-stop、省电策略和系统调度都可能造成延迟。
      </Text>
      <View style={styles.settingsSection}>
        <View style={styles.settingRow}>
          <View style={styles.settingBody}>
            <Text style={styles.settingLabel}>Android 消息通知</Text>
            <Text style={styles.settingMeta}>
              {backgroundEnabled ? '后台检查已启用' : state.globalEnabled ? '已保留意图，后台当前暂停' : '已关闭'}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Android 消息通知"
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            value={state.globalEnabled}
            trackColor={{ false: theme.lineStrong, true: theme.primarySoft }}
            thumbColor={state.globalEnabled ? theme.primary : theme.surface}
            onValueChange={onToggleGlobal}
          />
        </View>
        {notificationSources.map((source) => (
          <View key={source} style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{sourceCatalog[source].label}</Text>
              <Text style={styles.settingMeta}>
                {sourceSettingStatus(source, state, sessions, xiaoyinsiNeedsUpgrade)}
              </Text>
              {source === 'xiaoyinsi' && xiaoyinsiNeedsUpgrade ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="升级小隐寺消息授权"
                  style={styles.inlineAction}
                  onPress={() => pressWithFeedback(onUpgradeXiaoyinsi)}
                >
                  <Text style={styles.inlineActionText}>升级授权</Text>
                </Pressable>
              ) : null}
            </View>
            <Switch
              accessibilityLabel={`${sourceCatalog[source].label} 消息通知`}
              accessibilityState={{ busy, disabled: busy }}
              disabled={busy}
              value={state.sources[source].intentEnabled}
              trackColor={{ false: theme.lineStrong, true: theme.primarySoft }}
              thumbColor={state.sources[source].intentEnabled ? theme.primary : theme.surface}
              onValueChange={(enabled) => onToggleSource(source, enabled)}
            />
          </View>
        ))}
      </View>
      {state.globalEnabled && permission === 'denied' ? (
        <View style={styles.permissionBox} accessibilityLiveRegion="polite">
          <Text style={styles.stateTitle}>系统通知权限未开启</Text>
          <Text style={styles.stateText}>消息中心仍可使用；授权前不会注册后台检查，也不会显示 Android 通知。</Text>
          <AppButton label="打开系统设置" onPress={onOpenSystemSettings} />
        </View>
      ) : null}
      {backgroundError ? (
        <View style={styles.permissionBox} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>后台任务设置失败：{backgroundError}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function DetailHtml({ contentWidth, html }: { contentWidth: number; html: string }) {
  const { styles } = useReaderThemeStyles(createNotificationStyles);
  return <RenderHTML baseStyle={styles.detailBody} contentWidth={contentWidth} source={{ html }} />;
}

export function NotificationDetailScreen({
  canOpenTopic = false,
  canRetry = true,
  contentWidth,
  detail,
  error,
  loading,
  markMessage,
  onOpenTopic,
  onRetry
}: {
  canOpenTopic?: boolean;
  canRetry?: boolean;
  contentWidth: number;
  detail?: NotificationDetail;
  error?: string;
  loading: boolean;
  markMessage?: string;
  onOpenTopic: () => void;
  onRetry: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createNotificationStyles);
  if (loading) {
    return (
      <View style={[styles.screen, styles.centeredState]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.primary} />
        <Text style={styles.stateText}>正在读取消息详情</Text>
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="详情暂不可用"
          text={error || '请稍后重试。'}
          action={
            canOpenTopic
              ? { label: '查看完整主题', run: onOpenTopic }
              : canRetry
                ? { label: '重试', run: onRetry }
                : undefined
          }
          secondaryAction={canOpenTopic && canRetry ? { label: '重试', run: onRetry } : undefined}
        />
      </View>
    );
  }
  const item = detail.notification;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.detailContent}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailTitle}>{detail.title}</Text>
        <Text style={styles.detailMeta}>
          {sourceCatalog[item.source].label} · {item.actor.name} · {notificationTimeText(item)}
        </Text>
      </View>
      {markMessage ? (
        <View style={styles.readFailure} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{markMessage}</Text>
        </View>
      ) : null}
      {detail.contentHtml ? <DetailHtml contentWidth={contentWidth} html={detail.contentHtml} /> : null}
      {detail.contentText ? <Text style={styles.detailBody}>{detail.contentText}</Text> : null}
      {detail.messages?.map((message) => (
        <View key={message.id} style={[styles.message, message.mine && styles.messageMine]}>
          <Text style={styles.messageAuthor}>{message.author}</Text>
          {message.contentHtml ? <DetailHtml contentWidth={contentWidth - 16} html={message.contentHtml} /> : null}
          {message.contentText ? <Text style={styles.detailBody}>{message.contentText}</Text> : null}
        </View>
      ))}
      {canOpenTopic ? <AppButton variant="primary" label="查看完整主题" onPress={onOpenTopic} /> : null}
    </ScrollView>
  );
}
