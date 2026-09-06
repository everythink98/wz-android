import { memo, type RefObject, useCallback, useEffect, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Text, View } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import MoreHorizontal from 'lucide-react-native/icons/ellipsis';
import Star from 'lucide-react-native/icons/star';
import { useQuery } from '@tanstack/react-query';

import { sourceLabel } from '@/domain/forum/presentation';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { isDiscourseSource, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { ReplyLocationTarget, SourceErrorInfo, Topic, TopicDetail, UserReference } from '@/domain/forum/models';
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
  targetReply,
  targetReplyRequestId,
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
    openTopic: (topic: Topic, targetReply?: ReplyLocationTarget) => void;
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
  targetReply?: ReplyLocationTarget;
  targetReplyRequestId?: number;
  topicScrollRef: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const { state, commands } = session;
  const { actionBusy, decisionFor } = actions;
  const { error: topicError, topic } = article;
  const selectedTopic = state.selectedTopic;
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
  const itemSource = topic?.source;
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
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

  const runTopicMenuAction = useCallback((action: () => void) => {
    setTopicMenuOpen(false);
    action();
  }, []);
  const refreshWholeTopic = useCallback(() => {
    chrome.refreshTopic();
    if (discourseEmojiSource) void refetchDiscourseEmojiUrls();
  }, [chrome.refreshTopic, discourseEmojiSource, refetchDiscourseEmojiUrls]);

  if (!item) {
    return <EmptyText text="未选择主题" />;
  }

  const canWrite = decisionFor({ action: 'reply' }).allowed;
  const replyComposerIntent = state.replyComposerIntent;
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
    <View style={styles.topicScreenRoot}>
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
        currentNodeSeekUser={currentNodeSeekUser}
        discourseEmojiUrls={discourseEmojiUrls}
        headerState={headerState}
        html={html}
        nodeSeekUserId={nodeSeekUserId}
        onImagePreviewDescriptors={onImagePreviewDescriptors}
        onOpenTopic={chrome.openTopic}
        onOpenUser={chrome.openUser}
        onScroll={chrome.onScroll}
        read={read}
        session={session}
        targetReply={targetReply}
        targetReplyRequestId={targetReplyRequestId}
        topicScrollRef={topicScrollRef}
      />
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
