import { memo, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import RenderHTML, { HTMLContentModel, HTMLElementModel } from 'react-native-render-html';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { notificationSources, sourceCatalog, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { parseForumTopicDestination } from '@/domain/forum/links';
import type { ReplyLocationTarget, Topic } from '@/domain/forum/models';
import type { ForumNotification, NotificationCategory, NotificationDetail } from '@/domain/notifications/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ComposerSnapshot, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import type { NotificationPermissionState } from './useNotificationsRuntime';
import type { NotificationState } from '@/platform/notifications/notificationStore';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { Avatar } from '@/ui/avatar/Avatar';
import { AppButton } from '@/ui/controls/ButtonControls';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  formatNotificationTime,
  notificationAccessibilityLabel,
  notificationActionText,
  notificationTimeText
} from './notificationPresentation';
import { createNotificationStyles } from './styles';
import { MessageReplyComposerSheet } from './MessageReplyComposerSheet';
import type { LinuxDoTemplate } from '@/sources/linuxdo/templates';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';
import { normalizeForumStickerMediaHtml } from '@/domain/forum/forumContentMedia';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import { createForumStickerRenderers } from '@/ui/content/ForumStickerContent';
import { FORUM_STICKER_ELEMENT_MODELS } from '@/ui/content/forumStickerElementModels';
import { createConversationAutoScrollController } from './conversationAutoScroll';
import { FORUM_AUDIO_TAG } from '@/domain/forum/html';

const NOTIFICATION_HTML_ELEMENT_MODELS = {
  ...FORUM_STICKER_ELEMENT_MODELS,
  [FORUM_AUDIO_TAG]: HTMLElementModel.fromCustomModel({
    tagName: FORUM_AUDIO_TAG,
    contentModel: HTMLContentModel.mixed,
    isOpaque: false
  })
};

export type NotificationFilterSource = 'all' | NotificationSource;

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

function NotificationRow({
  item,
  showSource,
  onPress
}: {
  item: ForumNotification;
  showSource: boolean;
  onPress: () => void;
}) {
  const { styles } = useReaderThemeStyles(createNotificationStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={notificationAccessibilityLabel(item)}
      style={styles.row}
      onPress={onPress}
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
          {showSource ? `${sourceCatalog[item.source].label} · ` : ''}
          {notificationTimeText(item)}
        </Text>
      </View>
    </Pressable>
  );
}

export const NotificationsScreen = memo(function NotificationsScreen({
  activeSources,
  categories = [],
  categoryId = '',
  errors,
  enabledSources,
  fetchingMore,
  hasMore,
  items,
  loading,
  markAllBusy,
  refreshing,
  source,
  sourcePending,
  sourceUnknown = false,
  unreadOnly,
  onChangeCategory,
  onChangeSource,
  onChangeUnreadOnly,
  onItemPress,
  onLoadMore,
  onMarkAll,
  onRefresh,
  onRetryAccountStatus,
  onRetrySource
}: {
  activeSources: readonly NotificationSource[];
  categories?: readonly NotificationCategory[];
  categoryId?: string;
  errors: Partial<Record<NotificationSource, string>>;
  enabledSources: readonly NotificationSource[];
  fetchingMore: boolean;
  hasMore: boolean;
  items: ForumNotification[];
  loading: boolean;
  markAllBusy: boolean;
  refreshing: boolean;
  source: NotificationFilterSource;
  sourcePending: boolean;
  sourceUnknown?: boolean;
  unreadOnly: boolean;
  onChangeCategory?: (categoryId: string) => void;
  onChangeSource: (source: NotificationFilterSource) => void;
  onChangeUnreadOnly: (value: boolean) => void;
  onItemPress: (item: ForumNotification) => void;
  onLoadMore: () => void;
  onMarkAll: () => void;
  onRefresh: () => void;
  onRetryAccountStatus: () => void;
  onRetrySource: (source: NotificationSource) => void;
}) {
  const { settings, styles, theme } = useReaderThemeStyles(createNotificationStyles);
  const sourceItems = [
    { value: 'all', label: '全部' },
    ...enabledSources.map((candidate) => ({ value: candidate, label: sourceCatalog[candidate].label }))
  ];
  const errorSources = enabledSources.filter((candidate) => errors[candidate]);
  const sourceAvailable = source === 'all' ? activeSources.length > 0 : activeSources.includes(source);
  const visibleSourceKey = notificationSources
    .filter((candidate) => enabledSources.includes(candidate) && activeSources.includes(candidate))
    .join('|');
  const visibleItems = useMemo(() => {
    const visibleSources = new Set(visibleSourceKey.split('|'));
    return items.filter((item) => visibleSources.has(item.source));
  }, [items, visibleSourceKey]);
  const noEnabledSources = enabledSources.length === 0;
  const emptyTitle = noEnabledSources
    ? '尚未启用内容源'
    : sourcePending
      ? '账号确认中'
      : sourceUnknown
        ? '账号状态暂不可确认'
        : !sourceAvailable
          ? '账号尚未就绪'
          : unreadOnly
            ? '暂无未读消息'
            : '暂无消息';
  const emptyText = noEnabledSources
    ? '请前往“更多”中的“内容源”面板启用想看的站点。'
    : !sourceAvailable
      ? sourcePending
        ? source === 'all'
          ? '正在确认已启用站点的账号身份；完成后会自动加载可用消息。'
          : `正在确认${sourceCatalog[source].label}账号身份；完成后会自动加载消息。`
        : sourceUnknown
          ? '本次账号核对失败；消息请求已暂停，可在账号中心重试核对。'
          : source === 'all'
            ? '登录任一支持的站点后，就能在这里统一查看消息。'
            : `请先登录 ${sourceCatalog[source].label}，并确认账号身份。`
      : unreadOnly
        ? '切换“只看未读”可查看已读消息。'
        : '原站有新消息时会显示在这里。';
  const showMarkAll = source !== 'all' && source !== 'yaohuo' && sourceAvailable && categoryId === categories[0]?.id;
  const outcome = loading
    ? undefined
    : noEnabledSources
      ? 'sources'
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
        {source !== 'all' && categories.length ? (
          <View style={styles.categoryRail}>
            <PillRail
              variant="pills"
              items={categories.map((category) => ({ value: category.id, label: category.label }))}
              resetScrollKey={source}
              value={categoryId}
              testIDPrefix="notification-category"
              onChange={(value) => onChangeCategory?.(String(value))}
            />
          </View>
        ) : null}
        <View style={styles.controlRow}>
          <View style={styles.unreadControl}>
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`将 ${sourceCatalog[source].label} 全部标记为已读`}
              accessibilityState={{ busy: markAllBusy, disabled: markAllBusy }}
              disabled={markAllBusy}
              style={[styles.inlineAction, markAllBusy && styles.disabled]}
              onPress={onMarkAll}
            >
              <Text style={styles.inlineActionText}>{markAllBusy ? '处理中' : '全部已读'}</Text>
            </Pressable>
          ) : source === 'yaohuo' && sourceAvailable ? (
            <Text style={styles.controlMeta}>逐条打开后已读</Text>
          ) : null}
        </View>
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
      nestedScrollEnabled={false}
      accessibilityLabel="消息列表"
      testID={outcome ? `notification-outcome-${outcome}-${source}` : undefined}
      style={styles.screen}
      contentContainerStyle={styles.listContent}
      data={visibleItems}
      extraData={settings}
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
            action={sourceUnknown ? { label: '重试账号核对', run: onRetryAccountStatus } : undefined}
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
      renderItem={({ item }) => (
        <NotificationRow item={item} showSource={source === 'all'} onPress={() => onItemPress(item)} />
      )}
      onEndReached={hasMore && !fetchingMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.4}
    />
  );
});

function sourceSettingStatus(source: NotificationSource, state: NotificationState, sessions: SiteSessionViewModels) {
  if (sessions[source].identityTrust === 'unknown') {
    return '账号状态暂不可确认；开关意图会保留，可重试核对';
  }
  if (!sessions[source].isLoggedIn || sessions[source].identityTrust !== 'confirmed') return '未登录；开关意图会保留';
  return state.sources[source].intentEnabled ? '已启用' : '已关闭';
}

export function NotificationSettingsScreen({
  backgroundEnabled,
  backgroundError,
  busy,
  enabledSources,
  permission,
  sessions,
  state,
  onOpenSystemSettings,
  onToggleGlobal,
  onToggleSource
}: {
  backgroundEnabled: boolean;
  backgroundError: string;
  busy: boolean;
  enabledSources: readonly NotificationSource[];
  permission: NotificationPermissionState;
  sessions: SiteSessionViewModels;
  state: NotificationState;
  onOpenSystemSettings: () => void;
  onToggleGlobal: (enabled: boolean) => void;
  onToggleSource: (source: NotificationSource, enabled: boolean) => void;
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
        {enabledSources.map((source) => (
          <View key={source} style={styles.settingRow}>
            <View style={styles.settingBody}>
              <Text style={styles.settingLabel}>{sourceCatalog[source].label}</Text>
              <Text style={styles.settingMeta}>{sourceSettingStatus(source, state, sessions)}</Text>
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
        {!enabledSources.length ? <Text style={styles.settingMeta}>尚未启用内容源；通知开关意图会保留。</Text> : null}
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

function DetailHtml({
  contentWidth,
  html,
  message = false,
  source,
  onOpenExternalUrl,
  onOpenTopic
}: {
  contentWidth: number;
  html: string;
  message?: boolean;
  source: NotificationSource;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic: Topic, targetReply?: ReplyLocationTarget) => void;
}) {
  const { settings, styles } = useReaderThemeStyles(createNotificationStyles);
  const mediaContext = useForumMediaRequestContext(source);
  const renderableHtml = useMemo(() => normalizeForumStickerMediaHtml(html), [html]);
  const tagsStyles = useMemo(() => ({ a: styles.detailLink }), [styles.detailLink]);
  const renderers = useMemo(
    () =>
      createForumStickerRenderers({
        fontScale: settings.fontScale,
        mediaContext,
        mediaSessionIdentity: mediaContext.sessionIdentity,
        textStyle: message ? styles.messageBody : styles.detailBody
      }),
    [mediaContext, message, settings.fontScale, styles.detailBody, styles.messageBody]
  );
  const renderersProps = useMemo(
    () => ({
      a: {
        onPress: (event: { stopPropagation?: () => void }, href: string) => {
          const destination = parseForumTopicDestination(href);
          if (!destination) {
            onOpenExternalUrl(href);
            return;
          }
          event.stopPropagation?.();
          if (destination.targetReply) onOpenTopic(destination.topic, destination.targetReply);
          else onOpenTopic(destination.topic);
        }
      }
    }),
    [onOpenExternalUrl, onOpenTopic]
  );
  return (
    <RenderHTML
      baseStyle={message ? styles.messageBody : styles.detailBody}
      contentWidth={contentWidth}
      customHTMLElementModels={NOTIFICATION_HTML_ELEMENT_MODELS}
      renderers={renderers}
      renderersProps={renderersProps}
      source={{ html: renderableHtml }}
      tagsStyles={tagsStyles}
    />
  );
}

export function NotificationDetailScreen({
  canOpenTopic = false,
  canRetry = true,
  contentWidth,
  detail,
  discourseEmojiUrls,
  error,
  loading,
  markMessage,
  nodeSeekMemberId,
  replyBusy = false,
  replyContent = '',
  replyPendingNodeSeekPolls = [],
  replyError,
  replyStatus,
  replyVisible = false,
  routeActive = true,
  topicReplyAction = false,
  onOpenExternalUrl,
  onOpenTopic,
  onOpenReply = () => undefined,
  onReplyClose = () => undefined,
  onReplyContentChange = () => undefined,
  onReplySnapshot,
  onRetry,
  onSubmitReply = () => undefined,
  onLoadLinuxDoPollCapabilities,
  onLoadLinuxDoTemplates,
  onUseLinuxDoTemplate,
  onUploadReplyImage
}: {
  canOpenTopic?: boolean;
  canRetry?: boolean;
  contentWidth: number;
  detail?: NotificationDetail;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  error?: string;
  loading: boolean;
  markMessage?: string;
  nodeSeekMemberId?: string;
  replyBusy?: boolean;
  replyContent?: string;
  replyPendingNodeSeekPolls?: PendingNodeSeekPoll[];
  replyError?: string;
  replyStatus?: string;
  replyVisible?: boolean;
  routeActive?: boolean;
  topicReplyAction?: boolean;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic?: Topic, targetReply?: ReplyLocationTarget) => void;
  onOpenReply?: () => void;
  onReplyClose?: () => void;
  onReplyContentChange?: (content: string) => void;
  onReplySnapshot?: (snapshot: ComposerSnapshot) => void;
  onRetry: () => void;
  onSubmitReply?: (snapshot?: ComposerSnapshot) => unknown;
  onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
  onLoadLinuxDoTemplates?: () => Promise<LinuxDoTemplate[]>;
  onUseLinuxDoTemplate?: (id: string) => Promise<void>;
  onUploadReplyImage?: () => unknown;
}) {
  const { styles, theme } = useReaderThemeStyles(createNotificationStyles);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const conversationAutoScroll = useRef(createConversationAutoScrollController()).current;
  const dockSafeAreaStyle = { paddingBottom: Math.max(9, insets.bottom + 9) };
  const replyToTopic =
    topicReplyAction || detail?.notification.kind === 'mention' || detail?.notification.kind === 'reply';
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
              ? { label: replyToTopic ? '前往主题回复' : '查看完整主题', run: onOpenTopic }
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
  const conversation = Boolean(detail.messages);
  const emptyConversation = item.source === 'nodeseek' && detail.messages?.length === 0;
  const readOnlyText =
    item.kind === 'system' ? '系统通知由原站提供为只读。' : '原站没有为这条通知提供可回复的会话或主题。';
  const conversationKey = detail.messages?.map((message) => message.id).join(':') || '';
  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        testID="notification-detail-scroll"
        style={[styles.screen, conversation && styles.conversationScreen]}
        contentContainerStyle={conversation ? styles.conversationContent : styles.detailContent}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!conversationAutoScroll.contentChanged(conversationKey)) return;
          requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
        }}
        onScrollBeginDrag={() => {
          if (conversation) conversationAutoScroll.userScrolled();
        }}
      >
        {conversation ? (
          <View style={styles.conversationContext}>
            <Text style={styles.conversationContextText}>
              {sourceCatalog[item.source].label} · 私信会话
              {item.createdAt || item.displayTime ? ` · ${notificationTimeText(item)}` : ''}
            </Text>
            {canOpenTopic ? (
              <AppButton tiny variant="ghost" label="查看完整主题" onPress={() => onOpenTopic()} />
            ) : null}
          </View>
        ) : (
          <View style={styles.detailHeader}>
            <View style={styles.detailActorRow}>
              <Avatar contentSource={item.source} small name={item.actor.name} uri={item.actor.avatarUrl} />
              <View style={styles.detailActorBody}>
                <Text style={styles.detailActorName}>
                  {item.actor.name} <Text style={styles.actionText}>{notificationActionText(item.kind)}</Text>
                </Text>
                <Text style={styles.detailMeta}>
                  {sourceCatalog[item.source].label} · {notificationTimeText(item)}
                </Text>
              </View>
            </View>
            <Text style={styles.detailTitle}>{detail.title}</Text>
          </View>
        )}
        {markMessage ? (
          <View style={styles.readFailure} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{markMessage}</Text>
          </View>
        ) : null}
        {conversation && (detail.contentHtml || detail.contentText) ? (
          <View style={styles.conversationOriginal}>
            <Text style={styles.conversationOriginalLabel}>原消息</Text>
            {detail.contentHtml ? (
              <DetailHtml
                contentWidth={contentWidth - 50}
                html={detail.contentHtml}
                source={item.source}
                onOpenExternalUrl={onOpenExternalUrl}
                onOpenTopic={onOpenTopic}
              />
            ) : null}
            {detail.contentText ? <Text style={styles.detailBody}>{detail.contentText}</Text> : null}
          </View>
        ) : null}
        {conversation ? (
          <View testID="notification-conversation-messages" style={styles.conversationMessageList}>
            {emptyConversation ? (
              <Text style={styles.conversationNotice}>还没有私信，点击下方输入区开始聊天。</Text>
            ) : null}
            {detail.historyNotice ? <Text style={styles.conversationNotice}>{detail.historyNotice}</Text> : null}
            {detail.messages?.map((message) => (
              <View
                key={message.id}
                testID={`notification-message-${message.id}`}
                style={[styles.messageRow, message.mine && styles.messageRowMine]}
              >
                <View style={[styles.messageMetaRow, message.mine && styles.messageMetaMine]}>
                  <Text style={styles.messageAuthor}>{message.author}</Text>
                </View>
                <View style={[styles.messageBubble, message.mine && styles.messageBubbleMine]}>
                  {message.contentHtml ? (
                    <DetailHtml
                      message
                      contentWidth={Math.round(contentWidth * 0.72)}
                      html={message.contentHtml}
                      source={item.source}
                      onOpenExternalUrl={onOpenExternalUrl}
                      onOpenTopic={onOpenTopic}
                    />
                  ) : null}
                  {message.contentText ? <Text style={styles.messageBody}>{message.contentText}</Text> : null}
                </View>
                {message.createdAt ? (
                  <Text style={styles.messageTime}>{formatNotificationTime(message.createdAt)}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <>
            {detail.contentHtml ? (
              <DetailHtml
                contentWidth={contentWidth}
                html={detail.contentHtml}
                source={item.source}
                onOpenExternalUrl={onOpenExternalUrl}
                onOpenTopic={onOpenTopic}
              />
            ) : null}
            {detail.contentText ? <Text style={styles.detailBody}>{detail.contentText}</Text> : null}
            {!canOpenTopic ? (
              <View style={styles.readOnlyNotice}>
                <Text style={styles.noticeText}>{readOnlyText}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {!conversation && canOpenTopic ? (
        <View testID="notification-topic-action-dock" style={[styles.topicActionDock, dockSafeAreaStyle]}>
          <Pressable accessibilityRole="button" style={styles.topicActionButton} onPress={() => onOpenTopic()}>
            <Text style={styles.topicActionText}>{replyToTopic ? '前往主题回复' : '查看相关主题'}</Text>
          </Pressable>
        </View>
      ) : null}
      {detail.reply ? (
        <View testID="notification-reply-dock" style={[styles.replyDock, dockSafeAreaStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={emptyConversation ? '发私信' : '回复私信'}
            accessibilityState={{ disabled: replyBusy || Boolean(detail.reply.disabledReason) }}
            disabled={replyBusy || Boolean(detail.reply.disabledReason)}
            style={[styles.replyLauncher, (replyBusy || Boolean(detail.reply?.disabledReason)) && styles.disabled]}
            onPress={onOpenReply}
          >
            <View style={styles.replyLauncherBody}>
              <Text numberOfLines={1} style={styles.replyLauncherTitle}>
                {replyBusy
                  ? '正在发送…'
                  : emptyConversation
                    ? `发私信给 ${item.actor.name}…`
                    : `回复 ${item.actor.name}…`}
              </Text>
              <Text numberOfLines={1} style={styles.replyLauncherHint}>
                {detail.reply.format === 'markdown' ? 'Markdown' : '纯文本'}
              </Text>
            </View>
          </Pressable>
          {detail.reply.disabledReason ? (
            <Text style={styles.replyDisabledReason}>{detail.reply.disabledReason}</Text>
          ) : null}
        </View>
      ) : null}
      {detail.reply ? (
        <MessageReplyComposerSheet
          busy={replyBusy}
          content={replyContent}
          conversationId={item.id}
          disabledReason={detail.reply.disabledReason}
          discourseEmojiUrls={discourseEmojiUrls}
          error={replyError}
          format={detail.reply.format}
          nodeSeekMemberId={nodeSeekMemberId}
          pendingNodeSeekPolls={replyPendingNodeSeekPolls}
          routeActive={routeActive}
          source={item.source}
          status={replyStatus}
          visible={replyVisible}
          onChangeContent={onReplyContentChange}
          onClose={onReplyClose}
          onSnapshot={onReplySnapshot}
          onSubmit={onSubmitReply}
          onLoadLinuxDoPollCapabilities={onLoadLinuxDoPollCapabilities}
          onLoadLinuxDoTemplates={onLoadLinuxDoTemplates}
          onUseLinuxDoTemplate={onUseLinuxDoTemplate}
          onUploadImage={detail.reply.format === 'markdown' ? onUploadReplyImage : undefined}
        />
      ) : null}
    </View>
  );
}
