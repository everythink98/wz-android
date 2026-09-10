import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { memo, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import type { FlashListRef } from '@shopify/flash-list';
import { ChevronLeft, MoreHorizontal, SquarePen, Star } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';

import { sourceLabel } from '@/domain/forum/presentation';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { isDiscourseSource, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { TopicLocationTarget, SourceErrorInfo, Topic, TopicDetail, UserReference } from '@/domain/forum/models';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import { replyImageUploadSupported } from '@/sources/imageUpload';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { forumQueryKeys } from '@/platform/query/serverState';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { AuthNoticeBox, EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { ScreenTopBar, ScreenTopBarActions, ScreenTopBarTitle } from '@/ui/controls/ScreenTopBar';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createTopicStyles } from './styles';
import { ReplyComposerSheet } from './components/ReplyComposerSheet';
import { TopicContentList } from './components/TopicContentList';
import { TopicMenu } from './components/TopicMenu';
import { readableTopicError } from './model/topicError';
import type { TopicActionsController } from './actions/useTopicActionsController';
import type { useHtmlRenderingController } from './rendering/useHtmlRenderingController';
import type { TopicListItem } from './model/topicListModel';
import type { useTopicController } from './useTopicController';
import type { TopicSessionController } from './useTopicSessionController';

const EMPTY_DISCOURSE_EMOJI_URLS: DiscourseEmojiUrlMap = {};
const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

export const TopicScreen = memo(function TopicScreen({
  active = true,
  actions,
  article,
  bodyMediaPaused = false,
  chrome,
  currentNodeSeekUser,
  html,
  nodeSeekUserId,
  onImagePreviewDescriptors,
  read,
  session,
  location,
  locationRequestId,
  topicScrollRef
}: {
  active?: boolean;
  actions: TopicActionsController;
  article: {
    busy: boolean;
    error: SourceErrorInfo | null;
    topic: TopicDetail | null;
    yaohuoBookmarked?: boolean;
  };
  bodyMediaPaused?: boolean;
  chrome: {
    favorite: boolean;
    getDiscourseEmojiUrls: (options: {
      signal?: AbortSignal;
      source: DiscourseSource;
    }) => Promise<DiscourseEmojiUrlMap>;
    back: () => void;
    openOriginal: (url: string) => void;
    openReadingSettings: () => void;
    openTopic: (topic: Topic, location?: TopicLocationTarget) => void;
    openUser: (user: UserReference) => void;
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    refreshReplies: () => void;
    refreshTopic: () => void;
    share: () => void;
    toggleFavorite: () => void;
    verifyLinuxDo: () => void;
    verifyNodeSeek: () => void;
  };
  currentNodeSeekUser: SiteSessionViewModels['nodeseek']['currentUser'];
  html: ReturnType<typeof useHtmlRenderingController> & { contentWidth: number; mediaSessionIdentity: string };
  nodeSeekUserId: number | null;
  onImagePreviewDescriptors: (descriptors: readonly ForumImagePreviewDescriptor[]) => void;
  read: ReturnType<typeof useTopicController>;
  session: TopicSessionController;
  location?: TopicLocationTarget;
  locationRequestId?: number;
  topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const onPageLayout = useStartupPageLayout();
  const { state, commands } = session;
  const { actionBusy, decisionFor } = actions;
  const { error: topicError, topic } = article;
  const selectedTopic = state.selectedTopic;
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const itemSource = topic?.source;
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [replyActionHeight, setReplyActionHeight] = useState(0);
  const [replyActionVisible, setReplyActionVisible] = useState(true);
  const replyScrollRef = useRef<{ offset: number; anchor: number; direction: number } | null>(null);
  const replyComposerIntent = state.replyComposerIntent;
  const replyComposerOpen = replyComposerIntent.kind !== 'closed';
  const replyActionHidden = replyComposerOpen || !active || !replyActionVisible;
  const replyActionAnimation = useAnimatedStyle(() => ({
    opacity: withTiming(replyActionHidden ? 0 : 1, { duration: 160 }),
    transform: [{ translateY: withTiming(replyActionHidden ? 8 : 0, { duration: 160 }) }]
  }));
  const discourseEmojiSource = active && isDiscourseSource(itemSource) ? itemSource : null;
  const { data: discourseEmojiData, refetch: refetchDiscourseEmojiUrls } = useQuery({
    queryKey: forumQueryKeys.emojiUrls(discourseEmojiSource),
    gcTime: Infinity,
    enabled: Boolean(discourseEmojiSource),
    queryFn: ({ signal }) =>
      discourseEmojiSource
        ? chrome.getDiscourseEmojiUrls({ source: discourseEmojiSource, signal })
        : Promise.resolve(EMPTY_DISCOURSE_EMOJI_URLS)
  });
  const discourseEmojiUrls = discourseEmojiSource
    ? discourseEmojiData || EMPTY_DISCOURSE_EMOJI_URLS
    : EMPTY_DISCOURSE_EMOJI_URLS;

  useEffect(() => {
    setTopicMenuOpen(false);
  }, [item?.id, item?.source]);
  useEffect(() => {
    replyScrollRef.current = null;
    setReplyActionVisible(true);
  }, [active, item?.id, item?.source]);

  const updateReplyActionForScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!active || replyComposerOpen) return;
      const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
      const maxOffset = Math.max(0, contentSize.height - layoutMeasurement.height);
      const offset = Math.max(0, Math.min(contentOffset.y, maxOffset));
      const previous = replyScrollRef.current;
      if (!previous) {
        replyScrollRef.current = { offset, anchor: offset, direction: 0 };
        return;
      }
      if (offset === previous.offset) return;
      const direction = Math.sign(offset - previous.offset);
      const anchor = direction === previous.direction ? previous.anchor : previous.offset;
      replyScrollRef.current = { offset, anchor, direction };
      if (offset > 12 && Math.abs(offset - anchor) < 12) return;
      const visible = offset <= 12 || direction < 0;
      if (visible !== replyActionVisible) setReplyActionVisible(visible);
    },
    [active, replyActionVisible, replyComposerOpen]
  );

  const runTopicMenuAction = useCallback((action: () => void) => {
    setTopicMenuOpen(false);
    action();
  }, []);
  const refreshWholeTopic = useCallback(() => {
    chrome.refreshTopic();
    if (discourseEmojiSource) void refetchDiscourseEmojiUrls();
  }, [chrome.refreshTopic, discourseEmojiSource, refetchDiscourseEmojiUrls]);

  if (!item) {
    return (
      <View style={styles.topicScreenRoot} onLayout={onPageLayout}>
        <EmptyText text="未选择主题" />
      </View>
    );
  }

  const canWrite = Boolean(topic && decisionFor({ action: 'reply' }).allowed);
  const canUseDiscourseInteractions = Boolean(
    topic &&
    isDiscourseSource(topic.source) &&
    decisionFor({ action: 'like', interaction: 'like', target: topic }).allowed
  );
  const canOpenReplyComposer =
    canWrite ||
    Boolean(
      canUseDiscourseInteractions &&
      replyComposerIntent.kind === 'edit' &&
      decisionFor({ action: 'edit', objectAllowed: true, targetPresent: true }).allowed
    );
  const topicReadableError = topicError ? readableTopicError(topicError.message) : '';
  const topicAuthNotice = topicError ? authNoticeForSourceError(topicError) : null;
  const topicErrorActions = topicError ? (
    <View style={styles.actions}>
      {item.source === 'linuxdo' && topicError.kind === 'verification-required' ? (
        <AppButton label="去验证" onPress={chrome.verifyLinuxDo} />
      ) : null}
      {item.source === 'nodeseek' && topicError.kind === 'verification-required' ? (
        <AppButton label="去验证" onPress={chrome.verifyNodeSeek} />
      ) : null}
      <AppButton label="重试" onPress={refreshWholeTopic} />
    </View>
  ) : null;
  const headerState = (
    <>
      {topicError ? (
        topicAuthNotice ? (
          <AuthNoticeBox notice={topicAuthNotice}>{topicErrorActions}</AuthNoticeBox>
        ) : (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{topicReadableError}</Text>
            {topicErrorActions}
          </View>
        )
      ) : null}
      {!topic && !topicError ? <LoadingState text="正在读取主题..." /> : null}
    </>
  );

  return (
    <View style={styles.topicScreenRoot} onLayout={onPageLayout}>
      <ScreenTopBar>
        <IconButton icon={ChevronLeft} compact ghost label="返回" onPress={chrome.back} />
        <ScreenTopBarTitle>
          {sourceLabel(item.source)}
          {item.category ? ' · ' + item.category : ''}
        </ScreenTopBarTitle>
        <ScreenTopBarActions>
          <IconButton
            iconOnly
            ghost
            icon={Star}
            label={chrome.favorite ? '已收藏到本机' : '收藏到本机'}
            active={chrome.favorite}
            activeColor={theme.favorite}
            onPress={chrome.toggleFavorite}
          />
          <IconButton
            iconOnly
            ghost
            icon={MoreHorizontal}
            label="更多操作"
            active={topicMenuOpen}
            onPress={() => setTopicMenuOpen((value) => !value)}
          />
        </ScreenTopBarActions>
      </ScreenTopBar>
      <TopicContentList
        active={active}
        actions={actions}
        article={article}
        bodyMediaPaused={bodyMediaPaused}
        bottomContentInset={canWrite ? replyActionHeight + styles.replyActionPosition.bottom + 16 : 0}
        currentNodeSeekUser={currentNodeSeekUser}
        discourseEmojiUrls={discourseEmojiUrls}
        headerState={headerState}
        html={html}
        nodeSeekUserId={nodeSeekUserId}
        onImagePreviewDescriptors={onImagePreviewDescriptors}
        onOpenTopic={chrome.openTopic}
        onOpenUser={chrome.openUser}
        onScroll={chrome.onScroll}
        onScrollProgress={canWrite ? updateReplyActionForScroll : undefined}
        read={read}
        session={session}
        location={location}
        locationRequestId={locationRequestId}
        topicScrollRef={topicScrollRef}
      />
      {canWrite ? (
        <AnimatedSafeAreaView
          edges={['bottom']}
          pointerEvents={replyActionHidden ? 'none' : 'box-none'}
          style={[styles.replyActionPosition, replyActionAnimation]}
          onLayout={(event) => setReplyActionHeight(event.nativeEvent.layout.height)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="写回复"
            accessibilityHint="打开回复编辑器"
            accessibilityState={{ disabled: replyActionHidden }}
            accessibilityElementsHidden={replyActionHidden}
            importantForAccessibility={replyActionHidden ? 'no-hide-descendants' : 'auto'}
            disabled={replyActionHidden}
            style={styles.replyAction}
            onPress={() => commands.composer.toggle(true)}
          >
            <SquarePen size={20} color={theme.onPrimary} strokeWidth={1.8} />
            <Text style={styles.replyActionText}>回复</Text>
          </Pressable>
        </AnimatedSafeAreaView>
      ) : null}
      <TopicMenu
        onOpenOriginal={chrome.openOriginal}
        onOpenReadingSettings={chrome.openReadingSettings}
        onRefreshTopic={chrome.refreshReplies}
        onRefreshWholeTopic={refreshWholeTopic}
        onRequestClose={() => setTopicMenuOpen(false)}
        onShareTopic={chrome.share}
        runTopicMenuAction={runTopicMenuAction}
        styles={styles}
        topicUrl={item.url}
        visible={topicMenuOpen}
      />
      <ReplyComposerSheet
        actionBusy={actionBusy}
        discourseEmojiUrls={discourseEmojiUrls}
        intent={replyComposerIntent}
        nodeSeekMemberId={nodeSeekUserId ? String(nodeSeekUserId) : undefined}
        pendingNodeSeekPolls={state.replyPendingNodeSeekPolls}
        replyContent={state.replyContent}
        replyFace={state.replyFace}
        routeActive={active}
        source={topic?.source}
        styles={styles}
        theme={theme}
        topicId={item.id}
        visible={Boolean(canOpenReplyComposer && replyComposerIntent.kind !== 'closed')}
        onReplyComposerOpenChange={commands.composer.toggle}
        onReplyContentChange={commands.composer.changeContent}
        onReplyFaceChange={commands.composer.changeFace}
        onReplySnapshot={commands.composer.changeSnapshot}
        onSubmitReply={actions.submitReply}
        onLoadLinuxDoPollCapabilities={item.source === 'linuxdo' ? actions.loadLinuxDoPollCapabilities : undefined}
        onLoadLinuxDoTemplates={item.source === 'linuxdo' ? actions.loadLinuxDoTemplates : undefined}
        onUseLinuxDoTemplate={item.source === 'linuxdo' ? actions.useLinuxDoTemplate : undefined}
        onUploadReplyImage={
          replyImageUploadSupported(topic?.source)
            ? topic?.source === 'linuxdo' || topic?.source === 'nodeseek'
              ? actions.uploadReplyImageMarkup
              : actions.uploadReplyImage
            : undefined
        }
      />
    </View>
  );
});
