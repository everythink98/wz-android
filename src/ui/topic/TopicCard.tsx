import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Eye, MessageCircle } from 'lucide-react-native';
import type { Topic } from '@/domain/forum/models';
import { forumAccessRequirementText, sourceLabel, topicListDisplayTimeText } from '@/domain/forum/presentation';
import { highlightTextParts } from '@/ui/text/highlight';
import {
  androidRipple,
  sourceBadgeColorStyle,
  topicTagColorStyle,
  topicTagTextColorStyle,
  alphaColor,
  fontFamilyValue,
  type ReaderTheme
} from '@/ui/theme/tokens';
import type { TopicListItemState } from '@/domain/forum/topicListItemState';
import { Avatar } from '@/ui/avatar/Avatar';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';

const TOPIC_CARD_TAG_LIMIT = 3;
const TOPIC_OPEN_GUARD_MS = 500;

type TopicCardProps = {
  highlightQuery?: string;
  hideReplyCount?: boolean;
  renderTrailingAction?: (topic: Topic) => ReactNode;
  topic: Topic;
  readerState: TopicListItemState;
  testID?: string;
  onOpenTopic: (topic: Topic) => void;
};

function topicCardPropsAreEqual(previous: TopicCardProps, next: TopicCardProps) {
  return (
    previous.highlightQuery === next.highlightQuery &&
    previous.hideReplyCount === next.hideReplyCount &&
    previous.renderTrailingAction === next.renderTrailingAction &&
    previous.onOpenTopic === next.onOpenTopic &&
    previous.testID === next.testID &&
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
  testID,
  onOpenTopic
}: TopicCardProps) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const { getMappingKey } = useMappingHelper();
  const lastOpenAt = useRef(Number.NEGATIVE_INFINITY);
  const openTopicPress = useCallback(() => {
    const now = Date.now();
    if (now - lastOpenAt.current < TOPIC_OPEN_GUARD_MS) return;
    lastOpenAt.current = now;
    onOpenTopic(topic);
  }, [onOpenTopic, topic]);
  const authorMeta = [topic.author || '未知作者', topic.authorLevelLabel || '', readerState.favorite ? '已收藏' : '']
    .filter(Boolean)
    .join(' · ');
  const duplicateSourceText = topic.duplicateSources?.length ? `同链：${topic.duplicateSources.join('、')}` : '';
  const visibleTopicTags = (topic.tags || []).slice(0, TOPIC_CARD_TAG_LIMIT);
  const hiddenTopicTagCount = Math.max((topic.tags?.length || 0) - visibleTopicTags.length, 0);
  const accessRequirementText = forumAccessRequirementText(topic.accessRequirement);
  return (
    <View style={styles.topicRowShell}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.topicCardPressable}
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
          style={[styles.cardTitle, readerState.read && styles.cardTitleRead]}
          highlightStyle={styles.highlightText}
          numberOfLines={readerState.listDensity === 'loose' ? 3 : 2}
          text={topic.title}
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
        <View style={styles.topicFooterRow}>
          <View style={styles.topicAuthorChip}>
            <Avatar contentSource={topic.source} name={topic.author} uri={topic.authorAvatar} tiny />
            <View style={styles.topicAuthorTextGroup}>
              <Text style={styles.topicAuthorName} numberOfLines={1}>
                {authorMeta}
              </Text>
              {duplicateSourceText ? (
                <Text style={styles.topicDuplicateSources} numberOfLines={1}>
                  {duplicateSourceText}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.topicStatGroup}>
            {!hideReplyCount && typeof topic.replyCount === 'number' ? (
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

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const listFontScale = Math.max(0.9, Math.min(settings.fontScale, 1.08) * 0.96);
  const densityPadding = settings.listDensity === 'compact' ? 11 : settings.listDensity === 'loose' ? 16 : 14;
  return StyleSheet.create({
    topicRowShell: { position: 'relative', overflow: 'hidden', width: '100%', backgroundColor: theme.surface },
    topicCardPressable: {
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: densityPadding + 2,
      paddingBottom: 14
    },
    topicCardHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    topicCardHeadMeta: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: 4 },
    topicBadgeRow: { flex: 1, minWidth: 0, alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    topicSourceBadge: {
      overflow: 'hidden',
      color: theme.ink,
      fontFamily,
      fontSize: 11,
      fontWeight: '700',
      includeFontPadding: false,
      lineHeight: 16,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    topicCategoryBadge: {
      overflow: 'hidden',
      color: theme.muted,
      fontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      backgroundColor: 'transparent',
      borderColor: theme.line,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    timeText: { flexShrink: 0, color: theme.muted, fontFamily, fontSize: 12 },
    cardTitle: {
      color: theme.ink,
      fontFamily,
      fontSize: Math.round(17 * listFontScale),
      fontWeight: '600',
      letterSpacing: 0,
      lineHeight: Math.round(24 * listFontScale)
    },
    cardTitleRead: { color: theme.muted, fontWeight: '500' },
    excerpt: { color: theme.muted, fontFamily, fontSize: 12, lineHeight: 18 },
    highlightText: { color: theme.dark ? theme.primary : theme.primaryStrong, fontWeight: '700' },
    topicAccessBadge: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      color: theme.danger,
      fontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34),
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    topicFooterRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 4
    },
    topicAuthorChip: { flex: 1, minWidth: 0, alignItems: 'center', flexDirection: 'row', gap: 7 },
    topicAuthorTextGroup: { flex: 1, minWidth: 0, gap: 2 },
    topicAuthorName: {
      flexShrink: 1,
      color: theme.muted,
      fontFamily,
      fontSize: 13,
      fontWeight: '500',
      includeFontPadding: false
    },
    topicDuplicateSources: {
      color: theme.muted,
      fontFamily,
      fontSize: 12,
      includeFontPadding: false
    },
    topicStatGroup: { flexShrink: 0, alignItems: 'center', flexDirection: 'row', gap: 14 },
    topicStatItem: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    topicStatText: {
      color: theme.muted,
      fontFamily,
      fontSize: 13,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16
    },
    topicTagRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 },
    topicTagPill: {
      alignItems: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 6,
      borderWidth: 0,
      justifyContent: 'center',
      minHeight: 20,
      paddingHorizontal: 5,
      paddingVertical: 1
    },
    topicTagText: {
      color: theme.muted,
      fontFamily,
      fontSize: 11,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 14,
      textAlignVertical: 'center'
    },
    topicTagMorePill: { backgroundColor: 'transparent', borderColor: 'transparent' },
    topicTagMoreText: {
      color: theme.muted,
      fontFamily,
      fontSize: 12,
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: 16,
      textAlignVertical: 'center'
    }
  });
}
