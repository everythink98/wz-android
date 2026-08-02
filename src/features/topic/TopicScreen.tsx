import { memo, type ComponentProps, useCallback, useEffect, useState } from 'react';
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

const EMPTY_DISCOURSE_EMOJI_URLS: DiscourseEmojiUrlMap = {};

type TopicScreenProps = Omit<ComponentProps<typeof TopicContentList>, 'discourseEmojiUrls' | 'headerState'>;

export const TopicLoadingState = memo(function TopicLoadingState() {
  const { styles, theme } = useReaderStyles(createTopicStyles);
  return <LoadingState text="正在读取主题..." styles={styles} theme={theme} />;
});

export const TopicScreen = memo(function TopicScreen(props: TopicScreenProps) {
  const {
    actionBusy,
    decisionFor,
    getDiscourseEmojiUrls,
    identityBlocked = false,
    identityChecking = false,
    onBack,
    onOpenOriginal,
    onOpenReadingSettings,
    onRefreshTopic,
    onRefreshWholeTopic,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFaceChange,
    onShareTopic,
    onSubmitReply,
    onToggleFavorite,
    onUploadReplyImage,
    onVerifyLinuxDo,
    onVerifyNodeSeek,
    replyComposerOpen,
    replyContent,
    replyEditTarget,
    replyFace,
    replyTarget,
    selectedTopic,
    topic,
    topicError,
    topicFavorite
  } = props;
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
    getDiscourseEmojiUrls({ source: itemSource, signal: controller.signal })
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
  }, [getDiscourseEmojiUrls, itemSource, topic]);

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
      replyEditTarget &&
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
            {item.source === 'linuxdo' && identityBlocked ? (
              <AppButton label="检查 L 站状态" styles={styles} onPress={onVerifyLinuxDo} />
            ) : null}
            {item.source === 'linuxdo' && !identityBlocked && topicError.kind === 'verification-required' ? (
              <AppButton label="去验证" styles={styles} onPress={onVerifyLinuxDo} />
            ) : null}
            {item.source === 'nodeseek' && topicError.kind === 'verification-required' ? (
              <AppButton label="去验证" styles={styles} onPress={onVerifyNodeSeek} />
            ) : null}
            <AppButton label={identityBlocked ? '重试检测' : '重试'} styles={styles} onPress={onRefreshWholeTopic} />
          </View>
        </View>
      ) : null}
      {topic && identityChecking ? <LoadingState text="正在确认 L 站访问状态" styles={styles} theme={theme} /> : null}
      {!topic && !topicError ? (
        <LoadingState
          text={identityChecking ? '正在确认 L 站访问状态' : '正在读取主题...'}
          styles={styles}
          theme={theme}
        />
      ) : null}
    </>
  );

  return (
    <View style={styles.topicScreenRoot}>
      <View style={styles.topicTopBar}>
        <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
        <Text style={styles.topicTopHint} numberOfLines={1}>
          {sourceLabel(item.source)}
          {item.category ? ' · ' + item.category : ''}
        </Text>
        <View style={styles.topicTopActions}>
          <IconButton
            iconOnly
            ghost
            icon={Star}
            label={topicFavorite ? '已收藏' : '收藏'}
            styles={styles}
            theme={theme}
            active={topicFavorite}
            activeColor={theme.favorite}
            onPress={() => onToggleFavorite(item)}
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
      <TopicContentList {...props} discourseEmojiUrls={discourseEmojiUrls} headerState={headerState} />
      <TopicMenu
        onOpenOriginal={onOpenOriginal}
        onOpenReadingSettings={onOpenReadingSettings}
        onRefreshTopic={onRefreshTopic}
        onRefreshWholeTopic={onRefreshWholeTopic}
        onRequestClose={() => setTopicMenuOpen(false)}
        onShareTopic={onShareTopic}
        runTopicMenuAction={runTopicMenuAction}
        styles={styles}
        theme={theme}
        topicUrl={item.url}
        visible={topicMenuOpen}
      />
      <ReplyComposerSheet
        actionBusy={actionBusy}
        discourseEmojiUrls={discourseEmojiUrls}
        replyContent={replyContent}
        replyFace={replyFace}
        replyEditTarget={replyEditTarget}
        replyTarget={replyTarget}
        source={topic?.source}
        styles={styles}
        theme={theme}
        visible={Boolean(canOpenReplyComposer && replyComposerOpen)}
        onReplyComposerOpenChange={onReplyComposerOpenChange}
        onReplyContentChange={onReplyContentChange}
        onReplyFaceChange={onReplyFaceChange}
        onSubmitReply={onSubmitReply}
        onUploadReplyImage={replyImageUploadSupported(topic?.source) ? onUploadReplyImage : undefined}
      />
    </View>
  );
});
