import { memo, type RefObject, useCallback, useEffect, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Text, View } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import { ChevronLeft, MoreHorizontal, Star } from 'lucide-react-native';

import { sourceLabel } from '@/domain/forum/presentation';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { isDiscourseSource, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { ReplyLocationTarget, SourceErrorInfo, Topic, TopicDetail, UserReference } from '@/domain/forum/models';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import { replyImageUploadSupported } from '@/sources/imageUpload';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { triggerPressFeedback } from '@/ui/controls/pressFeedback';
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

export const TopicLoadingState = memo(function TopicLoadingState() {
  return <LoadingState text="正在读取主题..." />;
});

export const TopicScreen = memo(function TopicScreen({
  active = true,
  actions,
  article,
  bodyMediaPaused = false,
  chrome,
  currentNodeSeekUser,
  html,
  nodeSeekUserId,
  read,
  session,
  targetReply,
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
    identityBlocked: boolean;
    identityChecking: boolean;
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
  read: ReturnType<typeof useTopicController>;
  session: TopicSessionController;
  targetReply?: ReplyLocationTarget;
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
  const [discourseEmojiCatalog, setDiscourseEmojiCatalog] = useState<{
    source: DiscourseSource;
    urls: DiscourseEmojiUrlMap;
  } | null>(null);
  const discourseEmojiUrls =
    discourseEmojiCatalog && discourseEmojiCatalog.source === itemSource
      ? discourseEmojiCatalog.urls
      : EMPTY_DISCOURSE_EMOJI_URLS;

  useEffect(() => {
    setTopicMenuOpen(false);
  }, [item?.id, item?.source]);

  useEffect(() => {
    if (!isDiscourseSource(itemSource)) {
      setDiscourseEmojiCatalog(null);
      return undefined;
    }
    const controller = new AbortController();
    chrome
      .getDiscourseEmojiUrls({ source: itemSource, signal: controller.signal })
      .then((urls) => {
        if (!controller.signal.aborted) {
          setDiscourseEmojiCatalog({ source: itemSource, urls });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDiscourseEmojiCatalog(null);
        }
      });
    return () => controller.abort();
  }, [chrome.getDiscourseEmojiUrls, itemSource, topic]);

  const runTopicMenuAction = useCallback((action: () => void) => {
    triggerPressFeedback();
    setTopicMenuOpen(false);
    action();
  }, []);

  if (!item) {
    return <EmptyText text="未选择主题" />;
  }

  const canWrite = decisionFor({ action: 'reply' }).allowed;
  const canUseDiscourseInteractions = Boolean(
    topic &&
    isDiscourseSource(topic.source) &&
    decisionFor({ action: 'like', interaction: 'like', target: topic }).allowed
  );
  const canOpenReplyComposer =
    canWrite ||
    Boolean(
      canUseDiscourseInteractions &&
      state.replyEditTarget &&
      decisionFor({ action: 'edit', objectAllowed: true, targetPresent: true }).allowed
    );
  const topicReadableError = topicError ? readableTopicError(topicError.message) : '';
  const topicAuthNotice = topicError ? authNoticeForSourceError(topicError) : null;
  const topicAuthNoticeBoxStyle =
    topicAuthNotice?.tone === 'danger'
      ? styles.authNoticeBoxDanger
      : topicAuthNotice?.tone === 'warning'
        ? styles.authNoticeBoxWarning
        : styles.authNoticeBoxNeutral;
  const topicAuthNoticeTextStyle =
    topicAuthNotice?.tone === 'danger'
      ? styles.authNoticeTextDanger
      : topicAuthNotice?.tone === 'warning'
        ? styles.authNoticeTextWarning
        : styles.authNoticeTextNeutral;
  const headerState = (
    <>
      {topicError ? (
        <View style={topicAuthNotice ? [styles.authNoticeBox, topicAuthNoticeBoxStyle] : styles.errorBox}>
          <Text style={topicAuthNotice ? [styles.authNoticeText, topicAuthNoticeTextStyle] : styles.errorText}>
            {topicAuthNotice?.message || topicReadableError}
          </Text>
          <View style={styles.actions}>
            {item.source === 'linuxdo' && chrome.identityBlocked ? (
              <AppButton label="检查 L 站状态" onPress={chrome.verifyLinuxDo} />
            ) : null}
            {item.source === 'linuxdo' && !chrome.identityBlocked && topicError.kind === 'verification-required' ? (
              <AppButton label="去验证" onPress={chrome.verifyLinuxDo} />
            ) : null}
            {item.source === 'nodeseek' && topicError.kind === 'verification-required' ? (
              <AppButton label="去验证" onPress={chrome.verifyNodeSeek} />
            ) : null}
            <AppButton label={chrome.identityBlocked ? '重试检测' : '重试'} onPress={chrome.refreshTopic} />
          </View>
        </View>
      ) : null}
      {topic && chrome.identityChecking ? <LoadingState text="正在确认 L 站访问状态" /> : null}
      {!topic && !topicError ? (
        <LoadingState text={chrome.identityChecking ? '正在确认 L 站访问状态' : '正在读取主题...'} />
      ) : null}
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
            label={chrome.favorite ? '已收藏' : '收藏'}
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
        onOpenTopic={chrome.openTopic}
        onOpenUser={chrome.openUser}
        onScroll={chrome.onScroll}
        read={read}
        session={session}
        targetReply={targetReply}
        topicScrollRef={topicScrollRef}
      />
      <TopicMenu
        onOpenOriginal={chrome.openOriginal}
        onOpenReadingSettings={chrome.openReadingSettings}
        onRefreshTopic={chrome.refreshReplies}
        onRefreshWholeTopic={chrome.refreshTopic}
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
        replyContent={state.replyContent}
        replyFace={state.replyFace}
        replyEditTarget={state.replyEditTarget}
        replyTarget={state.replyTarget}
        source={topic?.source}
        styles={styles}
        theme={theme}
        visible={Boolean(canOpenReplyComposer && state.replyComposerOpen)}
        onReplyComposerOpenChange={commands.composer.toggle}
        onReplyContentChange={commands.composer.changeContent}
        onReplyFaceChange={commands.composer.changeFace}
        onSubmitReply={actions.submitReply}
        onUploadReplyImage={replyImageUploadSupported(topic?.source) ? actions.uploadReplyImage : undefined}
      />
    </View>
  );
});
