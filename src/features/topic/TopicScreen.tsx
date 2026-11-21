import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { memo, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { useScrollActionVisibility } from '@/ui/hooks/useScrollActionVisibility';
import type { FlashListRef } from '@shopify/flash-list';
import { ChevronDown, ChevronLeft, MoreHorizontal, SquarePen, Star } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { sourceLabel } from '@/domain/forum/presentation';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { isDiscourseSource, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import type {
  ReplyLocationTarget,
  TopicLocationTarget,
  SourceErrorInfo,
  Topic,
  TopicDetail,
  UserReference
} from '@/domain/forum/models';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import { replyImageUploadSupported } from '@/sources/imageUpload';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { retryEmojiCatalog } from '@/sources/discourse/retryEmojiCatalog';
import { forumQueryKeys } from '@/platform/query/serverState';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { AuthNoticeBox, EmptyText } from '@/ui/controls/FeedbackStates';
import { ScreenTopBar, ScreenTopBarActions, ScreenTopBarTitle } from '@/ui/controls/ScreenTopBar';
import { NavigationBackdropProvider, NavigationBackdropTarget, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createTopicStyles } from './styles';
import { ReplyComposerSheet } from './components/ReplyComposerSheet';
import { ReplyFloorMenu } from './components/ReplyFloorMenu';
import { TopicContentList } from './components/TopicContentList';
import { TopicMenu } from './components/TopicMenu';
import { LinuxDoPostInteractionsProvider } from './components/LinuxDoPostInteractions';
import { readableTopicError } from './model/topicError';
import { isTopicAccessNotice } from './model/topicOpeningPresentation';
import type { TopicActionsController } from './actions/useTopicActionsController';
import type { useHtmlRenderingController } from './rendering/useHtmlRenderingController';
import type { TopicListItem, TopicViewportFloor } from './model/topicListModel';
import type { useTopicController } from './useTopicController';
import type { TopicSessionController } from './useTopicSessionController';

const EMPTY_DISCOURSE_EMOJI_URLS: DiscourseEmojiUrlMap = {};
const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

export const TopicScreen = memo(function TopicScreen({
  active = true,
  composerRouteFocused = active,
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
  composerRouteFocused?: boolean;
  actions: TopicActionsController;
  article: {
    busy: boolean;
    error: SourceErrorInfo | null;
    topic: TopicDetail | null;
    yaohuoBookmarked?: boolean;
  };
  bodyMediaPaused?: boolean;
  chrome: {
    editTopic?: () => void;
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
    refreshReplies: () => void | Promise<unknown>;
    refreshTopic: () => void | Promise<unknown>;
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
  const queryClient = useQueryClient();
  const onPageLayout = useStartupPageLayout();
  const { state, commands } = session;
  const { actionBusy, decisionFor } = actions;
  const { error: topicError, topic } = article;
  const canRefreshReplies = Boolean(topic && !isTopicAccessNotice(topic));
  const canJumpToReply = Boolean(
    canRefreshReplies &&
    ((topic?.replyCount ?? 0) > 0 || read.topicReplies.length || read.replyHasMore || read.replyHasPrevious)
  );
  const selectedTopic = state.selectedTopic;
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const itemSource = topic?.source;
  const topicKey = `${item?.source}:${item?.id}`;
  const [refresh, setRefresh] = useState<{ section: 'topic' | 'replies' } | null>(null);
  const refreshFlight = useRef<typeof refresh>(null);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [topBarHeight, setTopBarHeight] = useState(0);
  const [replyActionHeight, setReplyActionHeight] = useState(0);
  const [jumpAnchor, setJumpAnchor] = useState<{ x: number; top: number; width: number } | null>(null);
  const [viewportFloor, setViewportFloor] = useState<{ topicKey: string; floor: TopicViewportFloor }>();
  const jumpTrigger = useRef<View>(null);
  const jumpRequest = useRef(0);
  const replyLocationRef = useRef<((target: ReplyLocationTarget) => void) | null>(null);
  const [commentSearchFocused, setCommentSearchFocused] = useState(false);
  const replyComposerIntent = state.replyComposerIntent;
  const replyComposerOpen = replyComposerIntent.kind !== 'closed';
  const entryPositionReady = read.readingEntry?.ready !== false && read.readingEntry?.positionReady !== false;
  const showReplyJump = active && entryPositionReady && canJumpToReply && jumpAnchor !== null && !replyComposerOpen;
  const currentFloor = entryPositionReady && viewportFloor?.topicKey === topicKey ? viewportFloor.floor : undefined;
  const floorLabel =
    currentFloor === 'opening' ? '主楼' : currentFloor === undefined ? '楼层' : `第 ${currentFloor} 楼`;
  const {
    hidden: replyActionHidden,
    animatedStyle: replyActionAnimation,
    onScroll: updateReplyActionForScroll
  } = useScrollActionVisibility({
    active,
    paused: replyComposerOpen,
    resetKey: topicKey
  });
  const onViewportFloorChange = useCallback((key: string, floor: TopicViewportFloor) => {
    setViewportFloor((current) =>
      current?.topicKey === key && current.floor === floor ? current : { topicKey: key, floor }
    );
  }, []);
  const closeReplyJump = useCallback(() => {
    jumpRequest.current += 1;
    setJumpAnchor(null);
  }, []);
  const openReplyJump = useCallback(() => {
    const request = ++jumpRequest.current;
    jumpTrigger.current?.measureInWindow((x, y, width, height) => {
      if (request === jumpRequest.current && width > 0 && height > 0) {
        setJumpAnchor({ x, top: y, width });
      }
    });
  }, []);
  const discourseEmojiSource = active && isDiscourseSource(itemSource) ? itemSource : null;
  const { data: discourseEmojiData, refetch: refetchDiscourseEmojiUrls } = useQuery({
    queryKey: forumQueryKeys.emojiUrls(discourseEmojiSource),
    gcTime: Infinity,
    enabled: Boolean(discourseEmojiSource),
    queryFn: ({ signal }) =>
      discourseEmojiSource
        ? retryEmojiCatalog(() => chrome.getDiscourseEmojiUrls({ source: discourseEmojiSource, signal }), signal)
        : Promise.resolve(EMPTY_DISCOURSE_EMOJI_URLS)
  });
  const discourseEmojiUrls = discourseEmojiSource
    ? discourseEmojiData || EMPTY_DISCOURSE_EMOJI_URLS
    : EMPTY_DISCOURSE_EMOJI_URLS;

  useEffect(() => {
    setTopicMenuOpen(false);
  }, [active, item?.id, item?.source]);
  useLayoutEffect(() => {
    closeReplyJump();
    return () => {
      jumpRequest.current += 1;
    };
  }, [
    active,
    canJumpToReply,
    closeReplyJump,
    entryPositionReady,
    html.mediaSessionIdentity,
    replyComposerOpen,
    topicKey
  ]);

  const runTopicMenuAction = useCallback((action: () => void) => {
    setTopicMenuOpen(false);
    action();
  }, []);
  useLayoutEffect(() => {
    setRefresh(null);
    return () => {
      refreshFlight.current = null;
    };
  }, [active, html.mediaSessionIdentity, item?.id, item?.source, state.replyOrder]);
  const refreshSection = useCallback(
    async (section: 'topic' | 'replies') => {
      if (!active || refreshFlight.current) return;
      const flight = { section };
      refreshFlight.current = flight;
      setRefresh(flight);
      try {
        const request = section === 'topic' ? chrome.refreshTopic() : chrome.refreshReplies();
        if (section === 'topic' && discourseEmojiSource) {
          void queryClient.cancelQueries({ queryKey: forumQueryKeys.emojiUrls(discourseEmojiSource), exact: true });
          void refetchDiscourseEmojiUrls();
        }
        await request;
      } finally {
        if (refreshFlight.current === flight) {
          refreshFlight.current = null;
          setRefresh(null);
        }
      }
    },
    [active, chrome.refreshTopic, chrome.refreshReplies, discourseEmojiSource, queryClient, refetchDiscourseEmojiUrls]
  );

  if (!item) {
    return (
      <View style={styles.topicScreenRoot} onLayout={onPageLayout}>
        <EmptyText text="未选择主题" />
      </View>
    );
  }

  const canWrite = Boolean(topic && decisionFor({ action: 'reply' }).allowed);
  const showReplyActions = canJumpToReply || canWrite;
  const canOpenReplyComposer =
    canWrite ||
    Boolean(
      isDiscourseSource(topic?.source) &&
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
      <AppButton label="重试" loading={refresh?.section === 'topic'} onPress={() => void refreshSection('topic')} />
    </View>
  ) : null;
  const headerError = topicError ? (
    topicAuthNotice ? (
      <AuthNoticeBox notice={topicAuthNotice}>{topicErrorActions}</AuthNoticeBox>
    ) : (
      <View style={styles.errorBox}>
        <Text style={styles.errorText}>{topicReadableError}</Text>
        {topicErrorActions}
      </View>
    )
  ) : null;

  const content = (
    <View style={styles.topicScreenRoot} onLayout={onPageLayout}>
      <ScreenTopBar onLayout={(event) => setTopBarHeight(event.nativeEvent.layout.height)}>
        <IconButton icon={ChevronLeft} iconSize={24} iconOnly ghost label="返回" onPress={chrome.back} />
        <ScreenTopBarTitle>
          {sourceLabel(item.source)}
          {item.category ? ' · ' + item.category : ''}
        </ScreenTopBarTitle>
        <ScreenTopBarActions>
          {topic && refresh ? (
            <ActivityIndicator
              accessible
              accessibilityLabel={refresh.section === 'topic' ? '正在刷新全文' : '正在刷新评论'}
              accessibilityState={{ busy: true }}
              accessibilityLiveRegion="polite"
              role="status"
              size={18}
              color={theme.primary}
            />
          ) : null}
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
      <KeyboardAvoidingView
        testID="topic-keyboard-viewport"
        behavior="height"
        enabled={active && commentSearchFocused && !replyComposerOpen}
        style={styles.flex}
      >
        <NavigationBackdropTarget active={active} testID="topic-glass-content" topInset={topBarHeight}>
          <TopicContentList
            active={active}
            actions={actions}
            article={article}
            bodyMediaPaused={bodyMediaPaused}
            readingPaused={topicMenuOpen || replyComposerOpen || showReplyJump}
            bottomContentInset={showReplyActions ? replyActionHeight + styles.replyActionPosition.bottom + 16 : 0}
            commentSearchFocused={commentSearchFocused}
            currentNodeSeekUser={currentNodeSeekUser}
            discourseEmojiUrls={discourseEmojiUrls}
            headerError={headerError}
            html={html}
            nodeSeekUserId={nodeSeekUserId}
            onImagePreviewDescriptors={onImagePreviewDescriptors}
            onCommentSearchFocusChange={setCommentSearchFocused}
            onOpenTopic={chrome.openTopic}
            onOpenUser={chrome.openUser}
            onScrollProgress={showReplyActions ? updateReplyActionForScroll : undefined}
            onViewportFloorChange={canJumpToReply ? onViewportFloorChange : undefined}
            read={read}
            replyLocationRef={replyLocationRef}
            session={session}
            location={location}
            locationRequestId={locationRequestId}
            topicScrollRef={topicScrollRef}
          />
        </NavigationBackdropTarget>
      </KeyboardAvoidingView>
      {showReplyActions ? (
        <AnimatedSafeAreaView
          testID="topic-reply-actions"
          edges={['bottom']}
          needsOffscreenAlphaCompositing
          pointerEvents={replyActionHidden ? 'none' : 'box-none'}
          style={[styles.replyActionPosition, replyActionAnimation]}
          onLayout={(event) => setReplyActionHeight(event.nativeEvent.layout.height)}
        >
          {canJumpToReply ? (
            <View ref={jumpTrigger} collapsable={false}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="跳到楼层"
                accessibilityValue={{ text: floorLabel }}
                accessibilityState={{ disabled: replyActionHidden || !entryPositionReady, expanded: showReplyJump }}
                accessibilityElementsHidden={replyActionHidden}
                importantForAccessibility={replyActionHidden ? 'no-hide-descendants' : 'auto'}
                disabled={replyActionHidden || !entryPositionReady}
                style={[styles.replyAction, styles.replyJumpAction]}
                onPress={openReplyJump}
              >
                <NavigationGlass variant="control" />
                <Text numberOfLines={1} style={[styles.replyActionText, styles.replyJumpActionText]}>
                  {floorLabel}
                </Text>
                <ChevronDown size={14} color={theme.muted} strokeWidth={1.8} accessible={false} />
              </Pressable>
            </View>
          ) : null}
          {canWrite ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="写回复"
              accessibilityHint="打开回复编辑器"
              accessibilityState={{ disabled: replyActionHidden }}
              accessibilityElementsHidden={replyActionHidden}
              importantForAccessibility={replyActionHidden ? 'no-hide-descendants' : 'auto'}
              disabled={replyActionHidden}
              style={[styles.replyAction, styles.replyWriteAction]}
              onPress={() => commands.composer.toggle(true)}
            >
              <NavigationGlass accent />
              <SquarePen size={20} color={theme.dark ? theme.primary : theme.primaryStrong} strokeWidth={1.8} />
              <Text style={styles.replyActionText}>回复</Text>
            </Pressable>
          ) : null}
        </AnimatedSafeAreaView>
      ) : null}
      {showReplyJump && topic ? (
        <ReplyFloorMenu
          anchor={jumpAnchor}
          currentFloor={typeof currentFloor === 'number' ? currentFloor : undefined}
          topic={topic}
          replies={read.topicReplies}
          onClose={closeReplyJump}
          onJump={(floor) => {
            closeReplyJump();
            replyLocationRef.current?.({ floor });
          }}
        />
      ) : null}
      <TopicMenu
        onEditTopic={chrome.editTopic}
        onOpenOpening={() => chrome.openTopic(item, { kind: 'opening' })}
        onOpenOriginal={chrome.openOriginal}
        onOpenReadingSettings={chrome.openReadingSettings}
        refreshing={refresh !== null}
        onRefreshTopic={canRefreshReplies ? () => void refreshSection('replies') : undefined}
        onRefreshWholeTopic={() => void refreshSection('topic')}
        onRequestClose={() => setTopicMenuOpen(false)}
        onShareTopic={chrome.share}
        runTopicMenuAction={runTopicMenuAction}
        styles={styles}
        topicUrl={item.url}
        visible={active && topicMenuOpen}
      />
      <ReplyComposerSheet
        actionBusy={actionBusy}
        uploadingImage={actions.replyImageUploading}
        discourseEmojiUrls={discourseEmojiUrls}
        intent={replyComposerIntent}
        nodeSeekMemberId={nodeSeekUserId ? String(nodeSeekUserId) : undefined}
        pendingNodeSeekPolls={state.replyPendingNodeSeekPolls}
        replyContent={state.replyContent}
        replyFace={state.replyFace}
        routeActive={composerRouteFocused}
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
        onResolveLinuxDoUpload={item.source === 'linuxdo' ? actions.resolveLinuxDoUpload : undefined}
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
  return (
    <NavigationBackdropProvider>
      <LinuxDoPostInteractionsProvider
        active={active}
        scopeKey={`${html.mediaSessionIdentity}:${item.id}`}
        topic={topic}
        replies={read.topicReplies}
        actions={actions}
        emojiUrls={discourseEmojiUrls}
        onOpenUser={chrome.openUser}
      >
        {content}
      </LinuxDoPostInteractionsProvider>
    </NavigationBackdropProvider>
  );
});
