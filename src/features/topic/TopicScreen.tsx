import { memo, useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ChevronLeft, MoreHorizontal, Star } from 'lucide-react-native';

import { sourceLabel } from '@/domain/forum/presentation';
import { topicWithAuthorFallback } from '@/domain/forum/userNavigation';
import { isDiscourseSource, type DiscourseSource } from '@/domain/forum/sourceCatalog';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import { replyImageUploadSupported } from '@/sources/imageUpload';
import type { DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { AppButton, EmptyText, IconButton, LoadingState, triggerPressFeedback } from '@/ui/controls/AppControls';
import { useReaderStyles } from '@/ui/theme/ReaderStyleProvider';
import { createTopicStyles } from './styles';
import { ReplyComposerSheet } from './components/ReplyComposerSheet';
import { TopicContentList } from './components/TopicContentList';
import { TopicMenu } from './components/TopicMenu';
import { readableTopicError } from './model/screenHelpers';
import type { TopicScreenPresentation } from './useTopicPresentation';

const EMPTY_DISCOURSE_EMOJI_URLS: DiscourseEmojiUrlMap = {};

export const TopicLoadingState = memo(function TopicLoadingState() {
  const { styles, theme } = useReaderStyles(createTopicStyles);
  return <LoadingState text="正在读取主题..." styles={styles} theme={theme} />;
});

export const TopicScreen = memo(function TopicScreen({ presentation }: { presentation: TopicScreenPresentation }) {
  const {
    chrome,
    composer,
    content,
    content: {
      actions: { busy: actionBusy, decisionFor },
      article: { error: topicError, selectedTopic, topic }
    }
  } = presentation;
  const { styles, theme } = useReaderStyles(createTopicStyles);
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
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const canWrite = decisionFor({ action: 'reply' }).allowed;
  const canUseDiscourseInteractions = Boolean(
    topic && isDiscourseSource(topic.source) && decisionFor({ action: 'like' }).allowed
  );
  const canOpenReplyComposer =
    canWrite ||
    Boolean(
      canUseDiscourseInteractions &&
      composer.editTarget &&
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
              <AppButton label="检查 L 站状态" styles={styles} onPress={chrome.verifyLinuxDo} />
            ) : null}
            {item.source === 'linuxdo' && !chrome.identityBlocked && topicError.kind === 'verification-required' ? (
              <AppButton label="去验证" styles={styles} onPress={chrome.verifyLinuxDo} />
            ) : null}
            {item.source === 'nodeseek' && topicError.kind === 'verification-required' ? (
              <AppButton label="去验证" styles={styles} onPress={chrome.verifyNodeSeek} />
            ) : null}
            <AppButton
              label={chrome.identityBlocked ? '重试检测' : '重试'}
              styles={styles}
              onPress={chrome.refreshTopic}
            />
          </View>
        </View>
      ) : null}
      {topic && chrome.identityChecking ? (
        <LoadingState text="正在确认 L 站访问状态" styles={styles} theme={theme} />
      ) : null}
      {!topic && !topicError ? (
        <LoadingState
          text={chrome.identityChecking ? '正在确认 L 站访问状态' : '正在读取主题...'}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.topicScreenRoot}>
      <View style={styles.topicTopBar}>
        <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={chrome.back} />
        <Text style={styles.topicTopHint} numberOfLines={1}>
          {sourceLabel(item.source)}
          {item.category ? ' · ' + item.category : ''}
        </Text>
        <View style={styles.topicTopActions}>
          <IconButton
            iconOnly
            ghost
            icon={Star}
            label={chrome.favorite ? '已收藏' : '收藏'}
            styles={styles}
            theme={theme}
            active={chrome.favorite}
            activeColor={theme.favorite}
            onPress={chrome.toggleFavorite}
          />
          <IconButton
            iconOnly
            ghost
            icon={MoreHorizontal}
            label="更多操作"
            styles={styles}
            theme={theme}
            active={topicMenuOpen}
            onPress={() => setTopicMenuOpen((value) => !value)}
          />
        </View>
      </View>
      <TopicContentList presentation={content} discourseEmojiUrls={discourseEmojiUrls} headerState={headerState} />
      <TopicMenu
        onOpenOriginal={chrome.openOriginal}
        onOpenReadingSettings={chrome.openReadingSettings}
        onRefreshTopic={chrome.refreshReplies}
        onRefreshWholeTopic={chrome.refreshTopic}
        onRequestClose={() => setTopicMenuOpen(false)}
        onShareTopic={chrome.share}
        runTopicMenuAction={runTopicMenuAction}
        styles={styles}
        theme={theme}
        topicUrl={item.url}
        visible={topicMenuOpen}
      />
      <ReplyComposerSheet
        actionBusy={actionBusy}
        discourseEmojiUrls={discourseEmojiUrls}
        replyContent={composer.content}
        replyFace={composer.face}
        replyEditTarget={composer.editTarget}
        replyTarget={composer.target}
        source={topic?.source}
        styles={styles}
        theme={theme}
        visible={Boolean(canOpenReplyComposer && composer.open)}
        onReplyComposerOpenChange={composer.toggle}
        onReplyContentChange={composer.changeContent}
        onReplyFaceChange={composer.changeFace}
        onSubmitReply={composer.submit}
        onUploadReplyImage={replyImageUploadSupported(topic?.source) ? composer.uploadImage : undefined}
      />
    </View>
  );
});
