import type { SharedStyles } from '../theme/sharedStyles';
import { memo, useCallback, useMemo, type ReactNode } from 'react';
import { Pressable, Text, type StyleProp, type TextStyle, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Eye, MessageCircle } from 'lucide-react-native';
import type { Topic } from '@/domain/forum/models';
import { forumAccessRequirementText, sourceLabel, topicListDisplayTimeText } from '@/domain/forum/presentation';
import { highlightTextParts } from '../text/highlight';
import {
  androidRipple,
  sourceBadgeColorStyle,
  topicTagColorStyle,
  topicTagTextColorStyle,
  type ReaderTheme
} from '../theme/tokens';
import type { TopicListItemState } from '@/domain/forum/topicListItemState';
import { Avatar } from '../avatar/Avatar';

const TOPIC_CARD_TAG_LIMIT = 3;

type TopicCardProps = {
  highlightQuery?: string;
  hideReplyCount?: boolean;
  renderTrailingAction?: (topic: Topic) => ReactNode;
  topic: Topic;
  readerState: TopicListItemState;
  styles: SharedStyles;
  testID?: string;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
};

function topicCardPropsAreEqual(previous: TopicCardProps, next: TopicCardProps) {
  return (
    previous.highlightQuery === next.highlightQuery &&
    previous.hideReplyCount === next.hideReplyCount &&
    previous.renderTrailingAction === next.renderTrailingAction &&
    previous.onOpenTopic === next.onOpenTopic &&
    previous.styles === next.styles &&
    previous.testID === next.testID &&
    previous.theme === next.theme &&
    previous.readerState.favorite === next.readerState.favorite &&
    previous.readerState.read === next.readerState.read &&
    previous.readerState.listDensity === next.readerState.listDensity &&
    previous.topic === next.topic
  );
}

function HighlightedText({
  highlightStyle,
  numberOfLines,
  query,
  style,
  text
}: {
  highlightStyle: StyleProp<TextStyle>;
  numberOfLines?: number;
  query: string;
  style: StyleProp<TextStyle>;
  text: string;
}) {
  const parts = useMemo(() => highlightTextParts(text, query), [query, text]);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) => (
        <Text key={`${part.text}-${index}`} style={part.highlighted ? highlightStyle : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

export function TopicCard({
  highlightQuery = '',
  hideReplyCount = false,
  renderTrailingAction,
  topic,
  readerState,
  styles,
  testID,
  theme,
  onOpenTopic
}: TopicCardProps) {
  const { getMappingKey } = useMappingHelper();
  const openTopicPress = useCallback(() => {
    onOpenTopic(topic);
  }, [onOpenTopic, topic]);
  const authorMeta = [
    topic.author || '未知作者',
    topic.authorLevelLabel || '',
    readerState.favorite ? '已收藏' : '',
    topic.duplicateSources?.length ? `同链：${topic.duplicateSources.join('、')}` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  const visibleTopicTags = (topic.tags || []).slice(0, TOPIC_CARD_TAG_LIMIT);
  const hiddenTopicTagCount = Math.max((topic.tags?.length || 0) - visibleTopicTags.length, 0);
  const accessRequirementText = forumAccessRequirementText(topic.accessRequirement);
  return (
    <View style={styles.topicRowShell}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        android_ripple={androidRipple(theme.primarySoft)}
        style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]}
        onPress={openTopicPress}
      >
        <View style={styles.topicCardHead}>
          <View style={styles.topicBadgeRow}>
            <Text style={[styles.topicSourceBadge, sourceBadgeColorStyle(topic.source, theme)]} numberOfLines={1}>
              {sourceLabel(topic.source)}
            </Text>
            {topic.isAiGenerated ? (
              <Text style={styles.topicCategoryBadge} numberOfLines={1}>
                ✦ AI
              </Text>
            ) : null}
            {topic.category ? (
              <Text style={styles.topicCategoryBadge} numberOfLines={1}>
                {topic.category}
              </Text>
            ) : null}
          </View>
          <View style={styles.topicCardHeadMeta}>
            <Text style={styles.timeText} numberOfLines={1}>
              {topicListDisplayTimeText(topic)}
            </Text>
            {renderTrailingAction ? renderTrailingAction(topic) : null}
          </View>
        </View>
        <HighlightedText
          style={styles.cardTitle}
          highlightStyle={styles.highlightText}
          numberOfLines={readerState.listDensity === 'loose' ? 3 : 2}
          text={topic.title || '无标题'}
          query={highlightQuery}
        />
        {accessRequirementText ? <Text style={styles.topicAccessBadge}>{accessRequirementText}</Text> : null}
        {visibleTopicTags.length ? (
          <View style={styles.topicTagRow}>
            {visibleTopicTags.map((tag, index) => (
              <View key={getMappingKey(tag, index)} style={[styles.topicTagPill, topicTagColorStyle(tag, theme)]}>
                <Text style={[styles.topicTagText, topicTagTextColorStyle(tag, theme)]} numberOfLines={1}>
                  {tag}
                </Text>
              </View>
            ))}
            {hiddenTopicTagCount ? (
              <View style={[styles.topicTagPill, styles.topicTagMorePill]}>
                <Text style={styles.topicTagMoreText} numberOfLines={1}>
                  +{hiddenTopicTagCount}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {topic.excerpt && readerState.listDensity === 'loose' ? (
          <HighlightedText
            style={styles.excerpt}
            highlightStyle={styles.highlightText}
            numberOfLines={2}
            text={topic.excerpt}
            query={highlightQuery}
          />
        ) : null}
        <View style={[styles.topicFooterRow, readerState.read && styles.topicCardRead]}>
          <View style={styles.topicAuthorChip}>
            <Avatar contentSource={topic.source} name={topic.author} uri={topic.authorAvatar} tiny styles={styles} />
            <Text style={styles.topicAuthorName} numberOfLines={1}>
              {authorMeta}
            </Text>
          </View>
          <View style={styles.topicStatGroup}>
            {!hideReplyCount ? (
              <View style={styles.topicStatItem}>
                <MessageCircle size={14} color={theme.muted} strokeWidth={1.9} />
                <Text style={styles.topicStatText}>{topic.replyCount}</Text>
              </View>
            ) : null}
            {topic.viewCount ? (
              <View style={styles.topicStatItem}>
                <Eye size={14} color={theme.muted} strokeWidth={1.9} />
                <Text style={styles.topicStatText}>{topic.viewCount}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

export const MemoizedTopicCard = memo(TopicCard, topicCardPropsAreEqual);
