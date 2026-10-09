import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { memo, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { ChevronDown } from 'lucide-react-native';
import RenderHTML, {
  HTMLContentModel,
  HTMLElementModel,
  useIMGElementProps,
  type CustomBlockRenderer,
  type CustomTextualRenderer
} from 'react-native-render-html';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { notificationSources, sourceCatalog, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { parseForumTopicDestination } from '@/domain/forum/links';
import type { TopicLocationTarget, SourceErrorInfo, Topic, UserReference } from '@/domain/forum/models';
import type { ForumNotification, NotificationCategory, NotificationDetail } from '@/domain/notifications/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ComposerSnapshot, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import type { NotificationPermissionState } from './useNotificationsRuntime';
import type { NotificationState } from '@/platform/notifications/notificationStore';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { Avatar } from '@/ui/avatar/Avatar';
import { AppButton, FloatingIconButton } from '@/ui/controls/ButtonControls';
import { PillRail } from '@/ui/controls/SelectionControls';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  formatNotificationTime,
  notificationAccessibilityLabel,
  notificationTitleText,
  notificationActionText,
  notificationTimeText,
  notificationErrorAction
} from './notificationPresentation';
import { createNotificationStyles } from './styles';
import { MessageReplyComposerSheet } from './MessageReplyComposerSheet';
import type { LinuxDoTemplate } from '@/sources/linuxdo/templates';
import type { LinuxDoPollCapabilities } from '@/domain/forum/linuxDoPoll';
import {
  INLINE_FORUM_IMAGE_TAG,
  isInlineForumImage,
  normalizeForumStickerMediaHtml
} from '@/domain/forum/forumContentMedia';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { compatibleImageRequestIdentity } from '@/platform/media/compatibleImageSources';
import {
  cachedImageDisplayDimensions,
  rememberImageDisplayDimensions,
  type CachedImageDimensions
} from '@/platform/media/imageDisplayDimensions';
import { inlineForumImageAlignmentStyle, inlineForumImageAttachmentSize } from '@/platform/media/inlineMedia';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import {
  imagePreviewListFromCatalog,
  isPreviewableImageUrl,
  prepareImagePreviewCatalog,
  projectImagePreviewCatalog,
  selectImageDisplaySource,
  type ImagePreviewList
} from '@/platform/media/imagePreviewCatalog';
import { ImagePreviewModal } from '@/ui/media/ImagePreviewModal';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { notificationImagePreviewDescriptors } from './notificationImagePreview';
import { createForumStickerRenderers } from '@/ui/content/ForumStickerContent';
import { FORUM_STICKER_ELEMENT_MODELS } from '@/ui/content/forumStickerElementModels';
import { createConversationAutoScrollController } from './conversationAutoScroll';
import { FORUM_AUDIO_TAG } from '@/domain/forum/html';
import { buildHtmlRenderingStyles, HTML_ALLOWED_INLINE_STYLES } from '@/ui/content/forumHtmlStyles';
import { DiscoursePolicyPanel } from '@/ui/content/DiscoursePolicyPanel';
import { NotificationContactTitle } from './NotificationContactTitle';

const NOTIFICATION_HTML_FONTS = ['sans-serif', 'serif', 'monospace'];

const NOTIFICATION_HTML_VISITORS: ComponentProps<typeof RenderHTML>['domVisitors'] = {
  onElement(element) {
    if (element.name === 'img' && isInlineForumImage(element.attribs)) element.name = INLINE_FORUM_IMAGE_TAG;
  }
};

const NOTIFICATION_HTML_ELEMENT_MODELS = {
  ...FORUM_STICKER_ELEMENT_MODELS,
  [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: INLINE_FORUM_IMAGE_TAG,
    contentModel: HTMLContentModel.textual,
    isOpaque: true
  }),
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
    <View style={styles.centeredState}>
      <Text style={styles.stateTitle} accessibilityRole="header">
        {title}
      </Text>
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
  const title = notificationTitleText(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={notificationAccessibilityLabel(item)}
      style={[styles.row, item.unread && styles.rowUnread]}
      onPress={onPress}
    >
      <Avatar contentSource={item.source} small name={item.actor.name} uri={item.actor.avatarUrl} />
      <View style={styles.rowBody}>
        <View style={styles.actorRow}>
          <Text style={styles.actorText} numberOfLines={1}>
            <Text style={styles.actorName}>{item.actor.name}</Text>
            <Text style={styles.actionText}> {notificationActionText(item.kind)}</Text>
          </Text>
          {item.unread ? <Text style={styles.unreadLabel}>未读</Text> : null}
        </View>
        {title ? (
          <Text style={[styles.title, item.unread && styles.titleUnread]} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {item.preview && item.preview !== title ? (
          <Text style={styles.preview} numberOfLines={2}>
            {item.preview}
          </Text>
        ) : null}
        <Text style={styles.meta}>
          {showSource ? `${sourceCatalog[item.source].label} · ` : ''}
          {notificationTimeText(item)}
        </Text>
      </View>
      <View pointerEvents="none" style={styles.rowSeparator} />
    </Pressable>
  );
}

export const NotificationsScreen = memo(function NotificationsScreen({
  initializationError = '',
  storageReady = true,
  onRetryInitialization,
  activeSources,
  categories = [],
  categoryId = '',
  errors,
  enabledSources,
  fetchingMore,
  hasMore,
  historyNotices = {},
  items,
  loading,
  markAllBusy,
  pagination = {},
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
  onLoginSource,
  onMarkAll,
  onRefresh,
  onRetryAccountStatus,
  onRetrySource
}: {
  initializationError?: string;
  storageReady?: boolean;
  onRetryInitialization?: () => void;
  activeSources: readonly NotificationSource[];
  categories?: readonly NotificationCategory[];
  categoryId?: string;
  errors: Partial<Record<NotificationSource, SourceErrorInfo>>;
  enabledSources: readonly NotificationSource[];
  fetchingMore: boolean;
  hasMore: boolean;
  historyNotices?: Partial<Record<NotificationSource, string>>;
  items: ForumNotification[];
  loading: boolean;
  markAllBusy: boolean;
  pagination?: Partial<Record<NotificationSource, 'more' | 'complete'>>;
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
  onLoginSource: (source: NotificationSource) => void;
  onMarkAll: () => void;
  onRefresh: () => void;
  onRetryAccountStatus: () => void;
  onRetrySource: (source: NotificationSource) => void;
}) {
  const { settings, styles, theme } = useReaderThemeStyles(createNotificationStyles);
  const listRef = useRef<FlashListRef<ForumNotification>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [source, categoryId, unreadOnly]);
  const sourceItems = [
    { value: 'all', label: '全部' },
    ...enabledSources.map((candidate) => ({ value: candidate, label: sourceCatalog[candidate].label }))
  ];
  const errorSources = enabledSources.filter(
    (candidate) => (source === 'all' || source === candidate) && errors[candidate]
  );
  const loginSources = enabledSources.filter(
    (candidate) =>
      (source === 'all' || source === candidate) &&
      !activeSources.includes(candidate) &&
      !errors[candidate] &&
      !sourceUnknown &&
      !sourcePending
  );
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
          : errorSources.length
            ? '消息暂未加载成功'
            : hasMore
              ? '当前页没有匹配消息'
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
      : errorSources.length
        ? '请重试上方读取失败的站点，已有消息会保留。'
        : hasMore
          ? '继续加载，查看更早的消息。'
          : unreadOnly
            ? '当前筛选下没有未读消息，可以查看全部消息。'
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
  const notices = (
    <View>
      {initializationError ? (
        <View style={styles.sourceNotice} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{initializationError}</Text>
          {onRetryInitialization ? <AppButton label="重试通知初始化" onPress={onRetryInitialization} /> : null}
        </View>
      ) : null}
      {source === 'all' && loginSources.length ? (
        <View style={styles.sourceNotice}>
          {loginSources.map((candidate) => (
            <AppButton
              key={candidate}
              compact
              label={`去登录 ${sourceCatalog[candidate].label}`}
              onPress={() => onLoginSource(candidate)}
            />
          ))}
        </View>
      ) : null}
      {enabledSources
        .filter((candidate) => (source === 'all' || source === candidate) && historyNotices[candidate])
        .map((candidate) => (
          <View key={candidate} style={styles.sourceNotice}>
            <Text style={styles.noticeText}>
              {source === 'all' ? `${sourceCatalog[candidate].label}：` : ''}
              {historyNotices[candidate]}
            </Text>
          </View>
        ))}
    </View>
  );
  const toolbar = (
    <View style={styles.toolbar} testID="notification-filters">
      <PillRail
        variant="tabs"
        items={sourceItems}
        value={source}
        testIDPrefix="notification-source"
        onChange={(value) => {
          const nextSource = value === 'all' ? 'all' : enabledSources.find((candidate) => candidate === value);
          if (nextSource && nextSource !== source) onChangeSource(nextSource);
        }}
      />
      {source !== 'all' && categories.length ? (
        <View style={styles.categoryRail}>
          <PillRail
            variant="pills"
            items={categories.map((category) => ({ value: category.id, label: category.label }))}
            resetScrollKey={source}
            value={categoryId}
            testIDPrefix="notification-category"
            onChange={(value) => {
              if (value !== categoryId) onChangeCategory?.(value);
            }}
          />
        </View>
      ) : null}
      <View style={styles.controlRow}>
        <View style={styles.unreadControl}>
          <Text style={styles.controlLabel}>只看未读</Text>
          <Switch
            accessibilityLabel="只看未读"
            accessibilityState={{ checked: unreadOnly }}
            value={unreadOnly}
            trackColor={{ false: theme.lineStrong, true: theme.primarySoft }}
            thumbColor={unreadOnly ? theme.primary : theme.surface}
            onValueChange={onChangeUnreadOnly}
          />
        </View>
        <View style={styles.controlSummary}>
          {visibleItems.length ? (
            <Text style={styles.controlMeta}>
              已加载 {visibleItems.length} 条{unreadOnly ? '未读消息' : '消息'}
            </Text>
          ) : null}
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
    </View>
  );
  const onPageLayout = useStartupPageLayout();
  if (!storageReady)
    return (
      <EmptyState
        title={initializationError ? '通知初始化失败' : '正在恢复通知'}
        text={initializationError || '正在读取本机通知设置和记录。'}
        action={
          initializationError && onRetryInitialization
            ? { label: '重试通知初始化', run: onRetryInitialization }
            : undefined
        }
      />
    );
  return (
    <View style={styles.screen}>
      {toolbar}
      {errorSources.length ? (
        <View style={styles.sourceNotice} accessibilityLiveRegion="polite">
          {errorSources.map((candidate) => (
            <View key={candidate} style={styles.sourceErrorRow}>
              <Text style={[styles.errorText, styles.sourceErrorText]}>
                {sourceCatalog[candidate].label}：{errors[candidate]?.message}
              </Text>
              <AppButton
                compact
                label={`${notificationErrorAction(errors[candidate])} ${sourceCatalog[candidate].label}`}
                onPress={() => onRetrySource(candidate)}
              />
            </View>
          ))}
        </View>
      ) : null}
      <FlashList
        key={`${source}:${categoryId}:${unreadOnly}`}
        ref={listRef}
        onLayout={onPageLayout}
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
        maintainVisibleContentPosition={{ disabled: false }}
        ListHeaderComponent={notices}
        ListEmptyComponent={
          loading || fetchingMore ? (
            <View style={styles.centeredState} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.stateText}>正在读取消息</Text>
            </View>
          ) : (
            <EmptyState
              title={emptyTitle}
              text={emptyText}
              action={
                source !== 'all' && loginSources.includes(source)
                  ? { label: `去登录 ${sourceCatalog[source].label}`, run: () => onLoginSource(source) }
                  : sourceUnknown
                    ? { label: '重试账号核对', run: onRetryAccountStatus }
                    : sourceAvailable && unreadOnly && !errorSources.length
                      ? { label: '查看全部消息', run: () => onChangeUnreadOnly(false) }
                      : undefined
              }
            />
          )
        }
        ListFooterComponent={
          <View>
            {source === 'all' && !loading && (hasMore || errorSources.length > 0) ? (
              <View style={styles.paginationSources}>
                {enabledSources
                  .filter(
                    (candidate) => (pagination[candidate] || errors[candidate]) && activeSources.includes(candidate)
                  )
                  .map((candidate) => (
                    <Text key={candidate} style={styles.controlMeta}>
                      {sourceCatalog[candidate].label} ·{' '}
                      {errors[candidate]
                        ? '读取中断，可重试'
                        : pagination[candidate] === 'more'
                          ? '还有更多消息'
                          : '已到当前末尾'}
                    </Text>
                  ))}
              </View>
            ) : null}
            {fetchingMore ? (
              <View style={styles.footer} accessibilityLiveRegion="polite">
                <ActivityIndicator color={theme.primary} size="small" />
                <Text style={styles.noticeText}>正在加载更多消息</Text>
              </View>
            ) : hasMore && !loading && !refreshing ? (
              <View style={styles.footer}>
                <AppButton variant="ghost" label="继续加载消息" onPress={onLoadMore} />
              </View>
            ) : visibleItems.length > 0 && !loading && !hasMore && !errorSources.length ? (
              <View style={styles.footer}>
                <Text style={styles.noticeText}>
                  {source === 'all' ? '各站当前可提供的消息已加载完成' : '当前可提供的消息已加载完成'}
                </Text>
              </View>
            ) : null}
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} colors={[theme.primary]} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <NotificationRow item={item} showSource={source === 'all'} onPress={() => onItemPress(item)} />
        )}
        onEndReached={hasMore && !fetchingMore && !loading && !refreshing ? onLoadMore : undefined}
        onEndReachedThreshold={0.4}
      />
    </View>
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
  initializationError = '',
  onRetryInitialization,
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
  initializationError?: string;
  onRetryInitialization?: () => void;
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
  const onPageLayout = useStartupPageLayout();
  return (
    <ScrollView
      overScrollMode="never"
      onLayout={onPageLayout}
      style={styles.screen}
      contentContainerStyle={styles.settingsContent}
    >
      {initializationError ? (
        <View style={styles.permissionBox} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{initializationError}</Text>
          {onRetryInitialization ? <AppButton label="重试通知初始化" onPress={onRetryInitialization} /> : null}
        </View>
      ) : null}
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
  mediaContext,
  onOpenImagePreview,
  onOpenExternalUrl,
  onOpenTopic
}: {
  contentWidth: number;
  html: string;
  message?: boolean;
  source: NotificationSource;
  mediaContext: ForumMediaRequestContext;
  onOpenImagePreview: (url: string, referrerPolicy?: MediaReferrerPolicy) => void;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic: Topic, location?: TopicLocationTarget) => void;
}) {
  const { settings, styles, theme } = useReaderThemeStyles(createNotificationStyles);
  const renderableHtml = useMemo(() => normalizeForumStickerMediaHtml(html), [html]);
  const { htmlTagsStyles, htmlClassesStyles, htmlIgnoredStyles } = useMemo(
    () => buildHtmlRenderingStyles({ settings, theme, enableDiscourseCallouts: source === 'linuxdo' }),
    [settings, source, theme]
  );
  const tagsStyles = useMemo(
    () => ({
      ...htmlTagsStyles,
      ...(message
        ? {
            p: { ...htmlTagsStyles.p, marginBottom: 6 },
            img: { ...htmlTagsStyles.img, borderRadius: 8, marginTop: 4, marginBottom: 4 }
          }
        : {}),
      a: styles.detailLink
    }),
    [htmlTagsStyles, message, styles.detailLink]
  );
  const bodyStyle = message ? styles.messageBody : styles.detailBody;
  const renderers = useMemo(() => {
    const PreviewImageRenderer: CustomBlockRenderer = (props) => {
      const imageProps = useIMGElementProps(props);
      const attributes = props.tnode.attributes;
      const display = selectImageDisplaySource(attributes, contentWidth, PixelRatio.get());
      const src = display?.uri || imageProps.source.uri || '';
      const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
      const imageSource = {
        ...imageSourceFromUrl(src, { baseSource: imageProps.source, mediaContext, referrerPolicy }),
        uri: src
      };
      const identity = compatibleImageRequestIdentity(imageSource);
      const currentIdentityRef = useCommittedRef(identity);
      const [loaded, setLoaded] = useState<{ identity: string; dimensions: CachedImageDimensions } | undefined>();
      const [failedIdentity, setFailedIdentity] = useState('');
      const imageStyle = StyleSheet.flatten(imageProps.style);
      const authoredWidth = typeof imageStyle?.width === 'number' ? imageStyle.width : Number(imageProps.width) || 0;
      const authoredHeight =
        typeof imageStyle?.height === 'number' ? imageStyle.height : Number(imageProps.height) || 0;
      const declaredWidth = Number.isFinite(authoredWidth) && authoredWidth > 0 ? authoredWidth : 0;
      const declaredHeight = Number.isFinite(authoredHeight) && authoredHeight > 0 ? authoredHeight : 0;
      const natural = (loaded?.identity === identity ? loaded.dimensions : cachedImageDisplayDimensions(identity)) || {
        width: declaredWidth || contentWidth,
        height: declaredHeight || (declaredWidth || contentWidth) * 0.75
      };
      const ratio =
        declaredWidth > 0 && declaredHeight > 0 ? declaredWidth / declaredHeight : natural.width / natural.height;
      const width = Math.max(
        1,
        Math.min(
          contentWidth,
          declaredWidth || (declaredHeight ? declaredHeight * ratio : natural.width),
          message ? 320 * ratio : Infinity
        )
      );
      const size = { width, height: width / ratio };
      const label = attributes.alt || attributes.title || '图片';
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`预览图片：${label}`}
          style={[imageProps.style, size, { overflow: 'hidden' }]}
          onPress={(event) => {
            event.stopPropagation();
            onOpenImagePreview(src, referrerPolicy);
          }}
        >
          {failedIdentity === identity ? (
            <Text style={bodyStyle}>图片加载失败：{label}</Text>
          ) : (
            <ExpoImage
              key={identity}
              accessibilityLabel={label}
              accessibilityRole="image"
              contentFit="contain"
              source={imageSource}
              recyclingKey={identity}
              style={size}
              onLoad={(event) => {
                if (currentIdentityRef.current !== identity) return;
                const { width, height } = event.source;
                if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
                const dimensions = { width, height };
                rememberImageDisplayDimensions(identity, dimensions);
                setLoaded({ identity, dimensions });
              }}
              onError={() => {
                if (currentIdentityRef.current === identity) setFailedIdentity(identity);
              }}
            />
          )}
        </Pressable>
      );
    };
    const InlineImageRenderer: CustomTextualRenderer = ({ tnode }) => {
      const attributes = tnode.attributes;
      const src = attributes.src || '';
      const identity = `${mediaContext.sessionIdentity}:${src}`;
      const [failedSource, setFailedSource] = useState('');
      const label = attributes.alt || attributes.title || '表情';
      if (!src || failedSource === identity) return <Text style={tnode.styles.nativeTextFlow}>{label}</Text>;
      const size = inlineForumImageAttachmentSize(attributes, settings.fontScale, contentWidth);
      return (
        <View style={[size, inlineForumImageAlignmentStyle(attributes, settings.fontScale, bodyStyle.lineHeight)]}>
          <Image
            accessibilityLabel={label}
            resizeMode="contain"
            source={imageSourceFromUrl(src, {
              mediaContext,
              referrerPolicy: normalizeMediaReferrerPolicy(attributes.referrerpolicy)
            })}
            style={size}
            onError={() => setFailedSource(identity)}
          />
        </View>
      );
    };
    return {
      ...createForumStickerRenderers({
        fontScale: settings.fontScale,
        mediaContext,
        mediaSessionIdentity: mediaContext.sessionIdentity,
        textStyle: bodyStyle,
        renderImage: (props) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`预览图片：${props.accessibilityLabel || '贴纸'}`}
            onPress={(event) => {
              event.stopPropagation();
              onOpenImagePreview(props.src, props.referrerPolicy);
            }}
          >
            <ExpoImage
              {...props}
              source={imageSourceFromUrl(props.src, { mediaContext, referrerPolicy: props.referrerPolicy })}
              contentFit="contain"
            />
          </Pressable>
        )
      }),
      img: PreviewImageRenderer,
      [INLINE_FORUM_IMAGE_TAG]: InlineImageRenderer
    };
  }, [bodyStyle, contentWidth, mediaContext, message, onOpenImagePreview, settings.fontScale]);
  const renderersProps = useMemo(
    () => ({
      a: {
        onPress: (event: { stopPropagation?: () => void }, href: string) => {
          if (isPreviewableImageUrl(href)) {
            event.stopPropagation?.();
            onOpenImagePreview(href);
            return;
          }
          const destination = parseForumTopicDestination(href);
          if (!destination) {
            onOpenExternalUrl(href);
            return;
          }
          event.stopPropagation?.();
          if (destination.location) onOpenTopic(destination.topic, destination.location);
          else onOpenTopic(destination.topic);
        }
      }
    }),
    [onOpenExternalUrl, onOpenImagePreview, onOpenTopic]
  );
  return (
    <RenderHTML
      baseStyle={bodyStyle}
      allowedStyles={HTML_ALLOWED_INLINE_STYLES}
      classesStyles={htmlClassesStyles}
      contentWidth={contentWidth}
      customHTMLElementModels={NOTIFICATION_HTML_ELEMENT_MODELS}
      domVisitors={NOTIFICATION_HTML_VISITORS}
      emSize={bodyStyle.fontSize}
      enableUserAgentStyles
      enableCSSInlineProcessing
      ignoredStyles={htmlIgnoredStyles}
      renderers={renderers}
      renderersProps={renderersProps}
      source={{ html: renderableHtml, baseUrl: mediaContext.referrer?.documentUrl }}
      tagsStyles={tagsStyles}
      systemFonts={NOTIFICATION_HTML_FONTS}
    />
  );
}

export function NotificationDetailScreen({
  actorUser,
  actorInHeader = false,
  canOpenTopic = false,
  canRetry = true,
  contentWidth,
  detail,
  discourseEmojiUrls,
  error,
  loading,
  markMessage,
  markBusy = false,
  onRetryMark,
  nodeSeekMemberId,
  replyBusy = false,
  replyContent = '',
  replyPendingNodeSeekPolls = [],
  replyError,
  replyStatus,
  replyVisible = false,
  historyBusy = false,
  historyError,
  onLoadEarlierMessages,
  onResetMessageHistory,
  policyBusy = false,
  policyDisabled = false,
  policyError,
  policyStatus,
  routeActive = true,
  topicReplyAction = false,
  onOpenExternalUrl,
  onOpenTopic,
  onOpenActor,
  onSetPolicyAcceptance,
  onOpenReply = () => undefined,
  onReplyClose = () => undefined,
  onReplyContentChange = () => undefined,
  onReplySnapshot,
  onRetry,
  onSubmitReply = () => undefined,
  onLoadLinuxDoPollCapabilities,
  onResolveLinuxDoUpload,
  onLoadLinuxDoTemplates,
  onUseLinuxDoTemplate,
  onUploadReplyImage
}: {
  actorUser?: UserReference;
  actorInHeader?: boolean;
  canOpenTopic?: boolean;
  canRetry?: boolean;
  contentWidth: number;
  detail?: NotificationDetail;
  discourseEmojiUrls?: DiscourseEmojiUrlMap;
  error?: string;
  loading: boolean;
  markMessage?: string;
  markBusy?: boolean;
  onRetryMark?: () => void;
  nodeSeekMemberId?: string;
  replyBusy?: boolean;
  replyContent?: string;
  replyPendingNodeSeekPolls?: PendingNodeSeekPoll[];
  replyError?: string;
  replyStatus?: string;
  replyVisible?: boolean;
  historyBusy?: boolean;
  historyError?: string;
  onLoadEarlierMessages?: () => void;
  onResetMessageHistory?: () => void;
  policyBusy?: boolean;
  policyDisabled?: boolean;
  policyError?: string;
  policyStatus?: string;
  routeActive?: boolean;
  topicReplyAction?: boolean;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic?: Topic, location?: TopicLocationTarget) => void;
  onOpenActor?: (user: UserReference) => void;
  onSetPolicyAcceptance?: (accepted: boolean) => void;
  onOpenReply?: () => void;
  onReplyClose?: () => void;
  onReplyContentChange?: (content: string) => void;
  onReplySnapshot?: (snapshot: ComposerSnapshot) => void;
  onRetry: () => void;
  onSubmitReply?: (snapshot?: ComposerSnapshot) => unknown;
  onLoadLinuxDoPollCapabilities?: () => Promise<LinuxDoPollCapabilities>;
  onResolveLinuxDoUpload?: (shortUrl: string) => Promise<string>;
  onLoadLinuxDoTemplates?: () => Promise<LinuxDoTemplate[]>;
  onUseLinuxDoTemplate?: (id: string) => Promise<void>;
  onUploadReplyImage?: () => unknown;
}) {
  const onPageLayout = useStartupPageLayout();
  const { styles, theme } = useReaderThemeStyles(createNotificationStyles);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const conversationIdentity = detail ? `${detail.notification.source}:${detail.notification.id}` : '';
  const sessionMediaContext = useForumMediaRequestContext(detail?.notification.source);
  const target = detail?.notification.target;
  const documentUrl =
    detail?.topic?.url ||
    (target && 'url' in target ? target.url : detail ? sourceCatalog[detail.notification.source].baseUrl : '');
  const mediaContext = useMemo(
    () => ({ ...sessionMediaContext, referrer: { documentUrl } }),
    [documentUrl, sessionMediaContext]
  );
  const previewScope = `${conversationIdentity}:${mediaContext.sessionIdentity}`;
  const [imagePreview, setImagePreview] = useState<{ scope: string; gallery: ImagePreviewList } | null>(null);
  const automaticScrollAllowedRef = useCommittedRef(routeActive && imagePreview?.scope !== previewScope);
  const imageCatalog = useMemo(
    () =>
      projectImagePreviewCatalog(
        prepareImagePreviewCatalog(
          notificationImagePreviewDescriptors(detail, documentUrl),
          contentWidth,
          PixelRatio.get()
        ),
        mediaContext
      ),
    [contentWidth, detail, documentUrl, mediaContext]
  );
  const openImagePreview = useLatestCallback((url: string, referrerPolicy?: MediaReferrerPolicy) => {
    if (!routeActive || !detail) return;
    const gallery = imagePreviewListFromCatalog(
      imageCatalog,
      url,
      detail.notification.source,
      undefined,
      referrerPolicy
    );
    if (gallery.items.length) setImagePreview({ scope: previewScope, gallery });
  });
  useEffect(() => {
    setImagePreview(null);
  }, [previewScope, routeActive]);
  const conversationAutoScroll = useRef(createConversationAutoScrollController()).current;
  const userScrolledRef = useRef(false);
  const [showLatestMessage, setShowLatestMessage] = useState(false);
  useEffect(() => {
    conversationAutoScroll.viewportChanged(0);
    userScrolledRef.current = false;
    setShowLatestMessage(false);
  }, [conversationAutoScroll, conversationIdentity]);
  const dockSafeAreaStyle = { paddingBottom: Math.max(9, insets.bottom + 9) };
  const replyToTopic =
    topicReplyAction || detail?.notification.kind === 'mention' || detail?.notification.kind === 'reply';
  if (loading && !detail) {
    return (
      <View style={[styles.screen, styles.centeredState]} onLayout={onPageLayout} accessibilityLiveRegion="polite">
        <ActivityIndicator color={theme.primary} />
        <Text style={styles.stateText}>正在读取消息详情</Text>
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={styles.screen} onLayout={onPageLayout}>
        <EmptyState
          title="详情暂不可用"
          text={error || '请稍后重试。'}
          action={
            canOpenTopic
              ? { label: replyToTopic ? '前往主题回复' : '查看完整主题', run: () => onOpenTopic() }
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
  const hasDraft = Boolean(replyContent.trim());
  return (
    <View style={styles.screen} onLayout={onPageLayout}>
      <View style={styles.detailViewport}>
        <ScrollView
          overScrollMode="never"
          ref={scrollRef}
          testID="notification-detail-scroll"
          style={[styles.screen, conversation ? styles.conversationScreen : styles.documentScreen]}
          contentContainerStyle={conversation ? styles.conversationContent : styles.detailContent}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={conversation ? { minIndexForVisible: 2 } : undefined}
          onContentSizeChange={() => {
            if (!automaticScrollAllowedRef.current || !conversationAutoScroll.contentChanged(conversationKey)) return;
            requestAnimationFrame(() => {
              if (automaticScrollAllowedRef.current && conversationAutoScroll.contentChanged(conversationKey))
                scrollRef.current?.scrollToEnd({ animated: false });
            });
          }}
          onScrollBeginDrag={() => {
            if (conversation) {
              userScrolledRef.current = true;
              conversationAutoScroll.userScrolled();
            }
          }}
          scrollEventThrottle={32}
          onScroll={({ nativeEvent }) => {
            if (!conversation || !userScrolledRef.current) return;
            const distance =
              nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
            conversationAutoScroll.viewportChanged(distance);
            setShowLatestMessage(distance > 80);
          }}
        >
          <View key="header" collapsable={false} style={styles.detailHeaderContent}>
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
                <Text style={styles.detailTitle} accessibilityRole="header">
                  {detail.title}
                </Text>
                <Pressable
                  style={styles.detailActorRow}
                  accessible={Boolean(actorUser && onOpenActor)}
                  accessibilityRole={actorUser && onOpenActor ? 'button' : undefined}
                  accessibilityLabel={actorUser ? `查看 ${item.actor.name} 的主页` : undefined}
                  disabled={!actorUser || !onOpenActor}
                  onPress={() => {
                    if (actorUser) onOpenActor?.(actorUser);
                  }}
                >
                  <Avatar contentSource={item.source} small name={item.actor.name} uri={item.actor.avatarUrl} />
                  <View style={styles.detailActorBody}>
                    <Text style={styles.detailActorName}>
                      {item.actor.name} <Text style={styles.actionText}>{notificationActionText(item.kind)}</Text>
                    </Text>
                    <Text style={styles.detailMeta}>
                      {sourceCatalog[item.source].label} · {notificationTimeText(item)}
                    </Text>
                  </View>
                </Pressable>
              </View>
            )}
            {conversation && actorUser && onOpenActor && !actorInHeader ? (
              <NotificationContactTitle user={actorUser} onPress={() => onOpenActor(actorUser)} />
            ) : null}
            {markMessage ? (
              <View style={styles.readFailure} accessibilityLiveRegion="polite">
                <Text style={styles.errorText}>{markMessage}</Text>
                {onRetryMark ? <AppButton label="重试已读状态" disabled={markBusy} onPress={onRetryMark} /> : null}
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
                    mediaContext={mediaContext}
                    onOpenImagePreview={openImagePreview}
                    onOpenExternalUrl={onOpenExternalUrl}
                    onOpenTopic={onOpenTopic}
                  />
                ) : null}
                {detail.contentText ? (
                  <Text selectable style={styles.detailBody}>
                    {detail.contentText}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {conversation && emptyConversation ? (
              <Text style={styles.conversationNotice}>还没有私信，点击下方输入区开始聊天。</Text>
            ) : null}
            {conversation && detail.historyNotice ? (
              <Text style={styles.conversationNotice}>{detail.historyNotice}</Text>
            ) : null}
            {conversation && detail.messageHistory ? (
              <View style={styles.conversationHistory} accessibilityLiveRegion="polite">
                {detail.messageHistory.olderCursor && onLoadEarlierMessages ? (
                  <AppButton
                    variant="ghost"
                    label={historyBusy ? '正在加载更早消息…' : '加载更早消息'}
                    accessibilityLabel="加载更早消息"
                    disabled={historyBusy || !routeActive}
                    onPress={() => {
                      userScrolledRef.current = true;
                      conversationAutoScroll.userScrolled();
                      onLoadEarlierMessages();
                    }}
                  />
                ) : detail.messageHistory.olderCursor === null && !historyError ? (
                  <Text style={styles.conversationNotice}>已到最早消息</Text>
                ) : null}
                {historyError ? (
                  <>
                    <Text style={styles.errorText}>{historyError}</Text>
                    {onResetMessageHistory ? (
                      <AppButton
                        compact
                        variant="ghost"
                        label="重新读取会话"
                        disabled={historyBusy || !routeActive}
                        onPress={onResetMessageHistory}
                      />
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
          {conversation ? (
            <>
              <View key="spacer" collapsable={false} style={styles.conversationSpacer} />
              {detail.messages?.map((message) => (
                <View
                  key={message.id}
                  testID={`notification-message-${message.id}`}
                  style={[styles.messageRow, message.mine && styles.messageRowMine]}
                >
                  <View style={[styles.messageMetaRow, message.mine && styles.messageMetaMine]}>
                    <Text style={styles.messageAuthor} numberOfLines={1}>
                      {message.author}
                    </Text>
                    {message.createdAt ? (
                      <Text style={styles.messageTime}>{formatNotificationTime(message.createdAt)}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.messageBubble, message.mine && styles.messageBubbleMine]}>
                    {message.contentHtml ? (
                      <DetailHtml
                        message
                        contentWidth={Math.round(contentWidth * 0.72)}
                        html={message.contentHtml}
                        source={item.source}
                        mediaContext={mediaContext}
                        onOpenImagePreview={openImagePreview}
                        onOpenExternalUrl={onOpenExternalUrl}
                        onOpenTopic={onOpenTopic}
                      />
                    ) : null}
                    {message.contentText ? (
                      <Text selectable style={styles.messageBody}>
                        {message.contentText}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </>
          ) : (
            <>
              {detail.contentHtml ? (
                <DetailHtml
                  contentWidth={contentWidth}
                  html={detail.contentHtml}
                  source={item.source}
                  mediaContext={mediaContext}
                  onOpenImagePreview={openImagePreview}
                  onOpenExternalUrl={onOpenExternalUrl}
                  onOpenTopic={onOpenTopic}
                />
              ) : null}
              {detail.contentText ? (
                <Text selectable style={styles.detailBody}>
                  {detail.contentText}
                </Text>
              ) : null}
              {!canOpenTopic && !detail.policy ? (
                <View style={styles.readOnlyNotice}>
                  <Text style={styles.noticeText}>{readOnlyText}</Text>
                </View>
              ) : null}
            </>
          )}
          {detail.policy && onSetPolicyAcceptance ? (
            <DiscoursePolicyPanel
              policy={detail.policy}
              busy={policyBusy}
              disabled={policyDisabled || !routeActive}
              error={policyError}
              status={policyStatus}
              onSetAcceptance={onSetPolicyAcceptance}
            />
          ) : null}
        </ScrollView>
        {conversation && showLatestMessage ? (
          <View testID="notification-latest-message-action" pointerEvents="box-none" style={styles.latestMessageAction}>
            <FloatingIconButton
              icon={ChevronDown}
              label="回到最新消息"
              onPress={() => {
                conversationAutoScroll.viewportChanged(0);
                userScrolledRef.current = false;
                setShowLatestMessage(false);
                scrollRef.current?.scrollToEnd({ animated: true });
              }}
            />
          </View>
        ) : null}
      </View>
      {error ? (
        <View style={styles.detailRecovery} accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, styles.sourceErrorText]}>{error}</Text>
          {canRetry ? <AppButton compact label="重试读取消息" onPress={onRetry} /> : null}
        </View>
      ) : null}
      {!conversation && canOpenTopic ? (
        <View testID="notification-topic-action-dock" style={[styles.topicActionDock, dockSafeAreaStyle]}>
          <Pressable
            accessibilityRole="button"
            style={[styles.topicActionButton, detail.policy && styles.topicActionSecondary]}
            onPress={() => onOpenTopic()}
          >
            <Text style={[styles.topicActionText, detail.policy && styles.topicActionSecondaryText]}>
              {replyToTopic ? '前往主题回复' : '查看相关主题'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {detail.reply ? (
        <View testID="notification-reply-dock" style={[styles.replyDock, dockSafeAreaStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hasDraft ? '继续编辑私信草稿' : emptyConversation ? '发私信' : '回复私信'}
            accessibilityState={{ disabled: replyBusy || Boolean(detail.reply.disabledReason) }}
            disabled={replyBusy || Boolean(detail.reply.disabledReason)}
            style={[styles.replyLauncher, (replyBusy || Boolean(detail.reply?.disabledReason)) && styles.disabled]}
            onPress={onOpenReply}
          >
            <View style={styles.replyLauncherBody}>
              {hasDraft ? <Text style={styles.replyLauncherHint}>草稿</Text> : null}
              <Text numberOfLines={1} style={styles.replyLauncherTitle}>
                {replyBusy
                  ? '正在发送…'
                  : hasDraft
                    ? replyContent.replace(/\s+/g, ' ').trim()
                    : emptyConversation
                      ? `发私信给 ${item.actor.name}…`
                      : `回复 ${item.actor.name}…`}
              </Text>
              <Text numberOfLines={1} style={styles.replyLauncherHint}>
                {hasDraft ? '继续编辑' : '写回复'}
              </Text>
            </View>
          </Pressable>
          {!replyVisible && (replyError || replyStatus) ? (
            <Text style={replyError ? styles.errorText : styles.noticeText} accessibilityLiveRegion="polite">
              {replyError || replyStatus}
            </Text>
          ) : null}
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
          onResolveLinuxDoUpload={onResolveLinuxDoUpload}
          onLoadLinuxDoTemplates={onLoadLinuxDoTemplates}
          onUseLinuxDoTemplate={onUseLinuxDoTemplate}
          onUploadImage={detail.reply.format === 'markdown' ? onUploadReplyImage : undefined}
        />
      ) : null}
      <ImagePreviewModal
        preview={routeActive && imagePreview?.scope === previewScope ? imagePreview.gallery : null}
        onClose={() => setImagePreview(null)}
        onSelect={(index) =>
          setImagePreview((current) => (current ? { ...current, gallery: { ...current.gallery, index } } : null))
        }
      />
    </View>
  );
}
