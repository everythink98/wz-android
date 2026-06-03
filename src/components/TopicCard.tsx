import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, type StyleProp, type TextStyle, View } from 'react-native';
import type { Topic } from '../types';
import { topicKey } from '../readerData';
import { formatRelativeTime, sourceLabel, topicListDisplayTime } from '../appUtils';
import { highlightTextParts } from '../androidFeatureHelpers';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';
import { topicListItemStatesEqual, type TopicListItemState } from '../topicListItemState';

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

function stringArrayValuesEqual(left?: string[], right?: string[]) {
  if (!left?.length && !right?.length) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export function TopicCard({
  highlightQuery = '',
  hideReplyCount = false,
  topic,
  readerState,
  styles,
  theme,
  onOpenTopic
}: {
  highlightQuery?: string;
  hideReplyCount?: boolean;
  topic: Topic;
  readerState: TopicListItemState;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
}) {
  const openTopicPress = useCallback(() => {
    onOpenTopic(topic);
  }, [onOpenTopic, topic]);
  const metaParts = [
    topic.author || '未知作者',
    readerState.favorite ? '已收藏' : '',
    readerState.read ? '已读' : '',
    topic.duplicateSources?.length ? `同链：${topic.duplicateSources.join('、')}` : ''
  ].filter(Boolean).join(' · ');
  const replyText = hideReplyCount ? '' : `${topic.replyCount} 回复`;
  const statParts = [
    replyText,
    topic.viewCount ? `${topic.viewCount} 浏览` : ''
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.topicRowShell}>
      <View style={styles.topicCard}>
        <Pressable accessibilityRole="button" android_ripple={androidRipple(theme.primarySoft)} style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]} onPress={openTopicPress}>
          <View style={styles.topicCardHead}>
            <View style={styles.topicBadgeRow}>
              <Text style={styles.topicSourceBadge} numberOfLines={1}>{sourceLabel(topic.source)}</Text>
              {topic.category ? <Text style={styles.topicCategoryBadge} numberOfLines={1}>{topic.category}</Text> : null}
            </View>
            <Text style={styles.timeText} numberOfLines={1}>{formatRelativeTime(topicListDisplayTime(topic))}</Text>
          </View>
          <HighlightedText style={styles.cardTitle} highlightStyle={styles.highlightText} numberOfLines={readerState.listDensity === 'loose' ? 3 : 2} text={topic.title || '无标题'} query={highlightQuery} />
          {topic.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{topic.accessRequirement.label}</Text> : null}
          {topic.excerpt && readerState.listDensity === 'loose' ? <HighlightedText style={styles.excerpt} highlightStyle={styles.highlightText} numberOfLines={2} text={topic.excerpt} query={highlightQuery} /> : null}
        </Pressable>
        <View style={[styles.topicMetaRow, readerState.read && styles.topicCardRead]}>
          <Text style={[styles.meta, styles.topicMetaText]} numberOfLines={1}>{metaParts}</Text>
          {statParts ? <Text style={styles.topicStatPill} numberOfLines={1}>{statParts}</Text> : null}
        </View>
      </View>
    </View>
  );
}

export const MemoizedTopicCard = memo(TopicCard, (previous, next) => (
  topicKey(previous.topic) === topicKey(next.topic)
  && previous.topic.title === next.topic.title
  && previous.topic.author === next.topic.author
  && previous.topic.authorId === next.topic.authorId
  && previous.topic.authorAvatar === next.topic.authorAvatar
  && previous.topic.authorUrl === next.topic.authorUrl
  && previous.topic.excerpt === next.topic.excerpt
  && previous.topic.category === next.topic.category
  && previous.topic.categoryId === next.topic.categoryId
  && previous.topic.replyCount === next.topic.replyCount
  && previous.topic.viewCount === next.topic.viewCount
  && previous.topic.createdAt === next.topic.createdAt
  && previous.topic.lastReplyAt === next.topic.lastReplyAt
  && previous.topic.accessRequirement?.label === next.topic.accessRequirement?.label
  && stringArrayValuesEqual(previous.topic.duplicateSources, next.topic.duplicateSources)
  && stringArrayValuesEqual(previous.topic.tags, next.topic.tags)
  && previous.styles === next.styles
  && previous.theme === next.theme
  && previous.hideReplyCount === next.hideReplyCount
  && previous.highlightQuery === next.highlightQuery
  && previous.onOpenTopic === next.onOpenTopic
  && topicListItemStatesEqual(previous.readerState, next.readerState)
));
