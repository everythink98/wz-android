import { memo, useCallback, useMemo, type ReactNode } from 'react';
import { Pressable, Text, type StyleProp, type TextStyle, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Eye, MessageCircle } from 'lucide-react-native';
import type { Topic } from '../types';
import { forumAccessRequirementText, sourceLabel, topicListDisplayTimeText } from '../appUtils';
import { highlightTextParts } from '../androidFeatureHelpers';
import { androidRipple, createStyles, sourceBadgeColorStyle, topicTagColorStyle, topicTagTextColorStyle, type ReaderTheme } from '../theme';
import type { TopicListItemState } from '../topicListItemState';
import { Avatar } from './Avatar';

const TOPIC_CARD_TAG_LIMIT = 3;

type TopicCardProps = {
  highlightQuery?: string;
  hideReplyCount?: boolean;
  renderTrailingAction?: (topic: Topic) => ReactNode;
  topic: Topic;
  readerState: TopicListItemState;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
};

function sameStringArray(left: string[] | undefined, right: string[] | undefined) {
  if (!left?.length && !right?.length) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item === right[index]);
}

function sameAccessRequirement(left: Topic['accessRequirement'], right: Topic['accessRequirement']) {
  if (!left || !right) {
    return left === right;
  }
  return left.type === right.type && left.label === right.label && left.detail === right.detail;
}

function sameTopicCardTopic(left: Topic, right: Topic) {
  return left.source === right.source
    && left.id === right.id
    && left.title === right.title
    && left.author === right.author
    && left.authorAvatar === right.authorAvatar
    && left.authorLevelLabel === right.authorLevelLabel
    && left.category === right.category
    && left.createdAt === right.createdAt
    && left.lastReplyAt === right.lastReplyAt
    && left.displayTimeText === right.displayTimeText
    && left.replyCount === right.replyCount
    && left.viewCount === right.viewCount
    && left.excerpt === right.excerpt
    && sameStringArray(left.tags, right.tags)
    && sameStringArray(left.duplicateSources, right.duplicateSources)
    && sameAccessRequirement(left.accessRequirement, right.accessRequirement);
}

export function topicCardPropsAreEqual(previous: TopicCardProps, next: TopicCardProps) {
  return previous.highlightQuery === next.highlightQuery
    && previous.hideReplyCount === next.hideReplyCount
    && previous.renderTrailingAction === next.renderTrailingAction
    && previous.onOpenTopic === next.onOpenTopic
    && previous.styles === next.styles
    && previous.theme === next.theme
    && previous.readerState.favorite === next.readerState.favorite
    && previous.readerState.read === next.readerState.read
    && previous.readerState.listDensity === next.readerState.listDensity
    && sameTopicCardTopic(previous.topic, next.topic);
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
        <Text key={`${part.text}-${index}`} style={part.highlighted ? highlightStyle : undefined}>{part.text}</Text>
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
  ].filter(Boolean).join(' · ');
  const visibleTopicTags = (topic.tags || []).slice(0, TOPIC_CARD_TAG_LIMIT);
  const hiddenTopicTagCount = Math.max((topic.tags?.length || 0) - visibleTopicTags.length, 0);
  const accessRequirementText = forumAccessRequirementText(topic.accessRequirement);
  return (
    <View style={styles.topicRowShell}>
      <Pressable accessibilityRole="button" android_ripple={androidRipple(theme.primarySoft)} style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]} onPress={openTopicPress}>
        <View style={styles.topicCardHead}>
          <View style={styles.topicBadgeRow}>
            <Text style={[styles.topicSourceBadge, sourceBadgeColorStyle(topic.source, theme)]} numberOfLines={1}>{sourceLabel(topic.source)}</Text>
            {topic.category ? <Text style={styles.topicCategoryBadge} numberOfLines={1}>{topic.category}</Text> : null}
          </View>
          <View style={styles.topicCardHeadMeta}>
            <Text style={styles.timeText} numberOfLines={1}>{topicListDisplayTimeText(topic)}</Text>
            {renderTrailingAction ? renderTrailingAction(topic) : null}
          </View>
        </View>
        <HighlightedText style={styles.cardTitle} highlightStyle={styles.highlightText} numberOfLines={readerState.listDensity === 'loose' ? 3 : 2} text={topic.title || '无标题'} query={highlightQuery} />
        {accessRequirementText ? <Text style={styles.topicAccessBadge}>{accessRequirementText}</Text> : null}
        {visibleTopicTags.length ? (
          <View style={styles.topicTagRow}>
            {visibleTopicTags.map((tag, index) => (
              <View key={getMappingKey(tag, index)} style={[styles.topicTagPill, topicTagColorStyle(tag, theme)]}>
                <Text style={[styles.topicTagText, topicTagTextColorStyle(tag, theme)]} numberOfLines={1}>{tag}</Text>
              </View>
            ))}
            {hiddenTopicTagCount ? (
              <View style={[styles.topicTagPill, styles.topicTagMorePill]}>
                <Text style={styles.topicTagMoreText} numberOfLines={1}>+{hiddenTopicTagCount}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {topic.excerpt && readerState.listDensity === 'loose' ? <HighlightedText style={styles.excerpt} highlightStyle={styles.highlightText} numberOfLines={2} text={topic.excerpt} query={highlightQuery} /> : null}
        <View style={[styles.topicFooterRow, readerState.read && styles.topicCardRead]}>
          <View style={styles.topicAuthorChip}>
            <Avatar name={topic.author} uri={topic.authorAvatar} tiny styles={styles} />
            <Text style={styles.topicAuthorName} numberOfLines={1}>{authorMeta}</Text>
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
