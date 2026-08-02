import type { TopicStyles } from '../styles';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckCircle, ChevronDown, ChevronRight, ChevronUp } from 'lucide-react-native';
import type { Reply, Source } from '@/domain/forum/models';
import { formatDateTime } from '@/domain/forum/presentation';
import { quotedPostReferenceKey } from '@/domain/forum/quotedPosts';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { triggerPressFeedback } from '@/ui/controls/pressFeedback';
import { Avatar } from '@/ui/avatar/Avatar';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import type { TopicImageDeriver } from '../model/topicDerivedData';
import { stableTextHash } from '../model/contentIdentity';
import { MemoizedTopicContentBlock } from './TopicContentBlock';
import { TopicPolls } from './TopicPolls';

export function AcceptedAnswerPreview({
  contentSource,
  contentWidth,
  floor,
  inlineSizedImageUrls,
  loading,
  onLoad,
  onReadMore,
  reply,
  styles,
  theme,
  topicBaseUrl,
  topicImageDeriver
}: {
  contentSource: Source;
  contentWidth: number;
  floor: number;
  inlineSizedImageUrls: Record<string, true>;
  loading: boolean;
  onLoad?: () => void;
  onReadMore?: () => void;
  reply?: Reply;
  styles: TopicStyles;
  theme: ReaderTheme;
  topicBaseUrl?: string;
  topicImageDeriver: TopicImageDeriver;
}) {
  const [expanded, setExpanded] = useState(true);
  const [fullAnswerVisible, setFullAnswerVisible] = useState(false);
  const contentParts = useMemo(() => (reply ? splitDiscourseContentHtml(reply.contentHtml, reply.polls) : []), [reply]);
  const quotedPosts = reply?.quotedPosts || [];
  const ToggleIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <View style={styles.topicAcceptedAnswer} testID="topic-accepted-answer">
      <Pressable
        accessibilityLabel={expanded ? '收起已采纳答案' : '展开已采纳答案'}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.topicAcceptedAnswerHeader}
        onPress={() => {
          triggerPressFeedback();
          setExpanded((current) => !current);
        }}
      >
        <View style={styles.topicAcceptedAnswerHeaderLead}>
          <CheckCircle color={theme.primary} size={18} strokeWidth={2.2} />
          <Text style={styles.topicAcceptedAnswerTitle}>已采纳答案</Text>
        </View>
        <View style={styles.topicAcceptedAnswerToggle}>
          <Text style={styles.topicAcceptedAnswerToggleText}>{expanded ? '收起' : '展开'}</Text>
          <ToggleIcon color={theme.primary} size={16} strokeWidth={2.2} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.topicAcceptedAnswerBody}>
          {reply ? (
            <>
              <View style={styles.topicAcceptedAnswerAuthorRow}>
                <Avatar contentSource={contentSource} small name={reply.author} uri={reply.authorAvatar} />
                <View style={styles.topicAcceptedAnswerAuthorMeta}>
                  <Text style={styles.topicAcceptedAnswerAuthor} numberOfLines={1}>
                    {reply.author || '未知作者'}
                  </Text>
                  <Text style={styles.topicAcceptedAnswerTime}>
                    {formatDateTime(reply.createdAt)}
                    {floor ? ` · #${floor}` : ''}
                  </Text>
                </View>
              </View>
              <View style={!fullAnswerVisible ? styles.topicAcceptedAnswerPreview : undefined}>
                {quotedPosts.length ? (
                  <View style={styles.quoteStack}>
                    {quotedPosts.map((quote) => (
                      <View
                        key={`accepted-quote-${quotedPostReferenceKey(quote.reference)}`}
                        style={[styles.quoteBox, styles.replyQuoteBox]}
                      >
                        <View style={styles.quoteHeader}>
                          <View style={styles.quoteAuthorSummary}>
                            <View style={styles.quoteAuthorTextBlock}>
                              <Text style={styles.quoteAuthorText} numberOfLines={1}>
                                {quote.author?.label || '引用内容'}
                              </Text>
                              <Text style={styles.replyMeta}>引用 #{quote.reference.postNumber}</Text>
                            </View>
                          </View>
                        </View>
                        {quote.preview ? <Text style={styles.quotePreviewText}>{quote.preview}</Text> : null}
                      </View>
                    ))}
                  </View>
                ) : null}
                {contentParts.map((part) =>
                  part.type === 'poll' ? (
                    <TopicPolls
                      actionBusy={false}
                      embeddedInArticle
                      key={`accepted-poll-${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`}
                      keyPrefix={`accepted-answer-${floor}`}
                      onTogglePollSelection={() => undefined}
                      onVotePoll={() => undefined}
                      pollSelections={{}}
                      polls={[part.poll]}
                      styles={styles}
                      theme={theme}
                    />
                  ) : (
                    <MemoizedTopicContentBlock
                      key={`accepted-html-${stableTextHash(part.html)}`}
                      baseUrl={topicBaseUrl}
                      compact
                      contentWidth={Math.max(220, contentWidth - 24)}
                      inlineSizedImageUrls={inlineSizedImageUrls}
                      html={part.html}
                      trimTrailingBlockSpacing
                      topicImageDeriver={topicImageDeriver}
                    />
                  )
                )}
              </View>
            </>
          ) : (
            <View accessibilityLiveRegion="polite" style={styles.topicAcceptedAnswerAuthorMeta}>
              <Text style={styles.topicAcceptedAnswerAuthor}>
                {loading ? '正在读取解决方案' : '解决方案正文暂未载入'}
              </Text>
              <Text style={styles.topicAcceptedAnswerTime}>采纳答案位于第 {floor} 楼</Text>
            </View>
          )}
          {reply && floor && (onReadMore || !fullAnswerVisible) ? (
            <Pressable
              accessibilityLabel={`查看完整解决方案，第 ${floor} 楼`}
              accessibilityRole="button"
              android_ripple={androidRipple(theme.primarySoft)}
              style={styles.topicAcceptedAnswerReadMore}
              onPress={() => {
                triggerPressFeedback();
                if (onReadMore) {
                  onReadMore();
                } else {
                  setFullAnswerVisible(true);
                }
              }}
            >
              <Text style={styles.topicAcceptedAnswerReadMoreText}>查看完整答案 · #{floor}</Text>
              <ChevronRight color={theme.primary} size={17} strokeWidth={2.2} />
            </Pressable>
          ) : !reply && onLoad && !loading ? (
            <Pressable
              accessibilityLabel={`读取已采纳答案，第 ${floor} 楼`}
              accessibilityRole="button"
              android_ripple={androidRipple(theme.primarySoft)}
              style={styles.topicAcceptedAnswerReadMore}
              onPress={() => {
                triggerPressFeedback();
                onLoad();
              }}
            >
              <Text style={styles.topicAcceptedAnswerReadMoreText}>读取答案 · #{floor}</Text>
              <ChevronRight color={theme.primary} size={17} strokeWidth={2.2} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
