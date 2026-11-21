import { memo, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, View } from 'react-native';
import { useMappingHelper } from '@shopify/flash-list';
import { Eye, MessageCircle, Pin } from 'lucide-react-native';
import type { Topic } from '@/domain/forum/models';
import { forumAccessRequirementText, sourceLabel, topicListDisplayTimeText } from '@/domain/forum/presentation';
import { highlightTextParts } from '@/ui/text/highlight';
import {
  createReaderFontSizer,
  readerRadii,
  type ReaderStyleSettings,
  sourceBadgeColorStyle,
  topicTagColorStyle,
  alphaColor,
  fontFamilyValue,
  type ReaderTheme
} from '@/ui/theme/tokens';
import type { TopicListItemState } from '@/domain/forum/topicListItemState';
import { Avatar } from '@/ui/avatar/Avatar';
import { ContentLoadingPlaceholder, SkeletonBlock } from '@/ui/controls/ContentLoadingPlaceholder';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { topicKey } from '@/domain/reader/readerData';

const TOPIC_CARD_TAG_LIMIT = 3;
const TOPIC_OPEN_GUARD_MS = 500;

type TopicCardProps = {
  highlightQuery?: string;
  hideReplyCount?: boolean;
  showPinned?: boolean;
  showSource?: boolean;
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
    previous.showPinned === next.showPinned &&
    (previous.showSource ?? true) === (next.showSource ?? true) &&
    previous.renderTrailingAction === next.renderTrailingAction &&
    previous.onOpenTopic === next.onOpenTopic &&
    previous.testID === next.testID &&
    previous.readerState.favorite === next.readerState.favorite &&
    previous.readerState.read === next.readerState.read &&
    previous.readerState.hasNewReplies === next.readerState.hasNewReplies &&
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
  showPinned = false,
  showSource = true,
  renderTrailingAction,
  topic,
  readerState,
  testID,
  onOpenTopic
}: TopicCardProps) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const { getMappingKey } = useMappingHelper();
  const lastOpen = useRef<{ key: string; at: number } | null>(null);
  const openTopicPress = useCallback(() => {
    const now = Date.now();
    const key = topicKey(topic);
    if (lastOpen.current?.key === key && now - lastOpen.current.at < TOPIC_OPEN_GUARD_MS) return;
    lastOpen.current = { key, at: now };
    onOpenTopic(topic);
  }, [onOpenTopic, topic]);
  const authorMeta = [topic.author || '未知作者', topic.authorLevelLabel || '', readerState.favorite ? '已收藏' : '']
    .filter(Boolean)
    .join(' · ');
  const duplicateSourceText = topic.duplicateSources?.length ? `同链：${topic.duplicateSources.join('、')}` : '';
  const category = topic.category?.trim() || '';
  const seenTagLabels = new Set([category.toLowerCase()]);
  const distinctTags = (topic.tags || []).filter((tag) => {
    const label = tag.trim().toLowerCase();
    if (seenTagLabels.has(label)) return false;
    seenTagLabels.add(label);
    return Boolean(label);
  });
  const visibleTopicTags = distinctTags.slice(0, TOPIC_CARD_TAG_LIMIT);
  const hiddenTopicTagCount = distinctTags.length - visibleTopicTags.length;
  const accessRequirementText = forumAccessRequirementText(topic.accessRequirement);
  const time = topicListDisplayTimeText(topic);
  const pinned = showPinned && topic.pinned === true;
  const showMetadata = Boolean(
    showSource || pinned || topic.isAiGenerated || category || accessRequirementText || distinctTags.length
  );
  const showReplyCount = !hideReplyCount && typeof topic.replyCount === 'number';
  const showStats = Boolean(readerState.hasNewReplies || showReplyCount || topic.viewCount);
  const trailingAction = renderTrailingAction?.(topic);
  const footer = (
    <View style={[styles.topicFooterRow, trailingAction ? styles.topicFooterWithAction : undefined]}>
      <View style={styles.topicAuthorChip}>
        <Avatar contentSource={topic.source} name={topic.author} uri={topic.authorAvatar} tiny />
        <View style={styles.topicAuthorTextGroup}>
          <View style={styles.topicByline}>
            <Text style={styles.topicAuthorName} numberOfLines={1}>
              {authorMeta}
            </Text>
            {time ? (
              <Text style={styles.timeText} numberOfLines={1}>
                {time}
              </Text>
            ) : null}
          </View>
          {duplicateSourceText ? (
            <Text style={styles.topicDuplicateSources} numberOfLines={1}>
              {duplicateSourceText}
            </Text>
          ) : null}
        </View>
      </View>
      {showStats ? (
        <View renderToHardwareTextureAndroid style={styles.topicStatGroup}>
          {readerState.hasNewReplies ? (
            <Text style={styles.topicStatText} numberOfLines={1}>
              有新回复
            </Text>
          ) : null}
          {showReplyCount ? (
            <View style={styles.topicStatItem}>
              <MessageCircle size={14} color={theme.muted} strokeWidth={1.9} accessible={false} />
              <Text accessibilityLabel={`回复 ${topic.replyCount}`} style={styles.topicStatText} numberOfLines={1}>
                {topic.replyCount}
              </Text>
            </View>
          ) : null}
          {topic.viewCount ? (
            <View style={styles.topicStatItem}>
              <Eye size={14} color={theme.muted} strokeWidth={1.9} accessible={false} />
              <Text accessibilityLabel={`浏览 ${topic.viewCount}`} style={styles.topicStatText} numberOfLines={1}>
                {topic.viewCount}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={[styles.topicRowShell, styles.topicRowSurface]}>
      <Pressable testID={testID} accessibilityRole="button" style={styles.topicCardPressable} onPress={openTopicPress}>
        <HighlightedText
          style={[styles.cardTitle, readerState.read && styles.cardTitleRead]}
          highlightStyle={styles.highlightText}
          numberOfLines={readerState.listDensity === 'loose' ? 3 : 2}
          text={topic.title}
          query={highlightQuery}
        />
        {showMetadata ? (
          <View style={styles.topicMetadata}>
            {pinned ? (
              <View style={styles.topicPinnedBadge}>
                <Pin size={12} color={styles.topicPinnedLabel.color} strokeWidth={1.9} accessible={false} />
                <Text style={[styles.topicSourceBadge, styles.topicPinnedLabel]}>置顶</Text>
              </View>
            ) : null}
            {showSource ? (
              <Text style={[styles.topicSourceBadge, sourceBadgeColorStyle(topic.source, theme)]} numberOfLines={1}>
                {sourceLabel(topic.source)}
              </Text>
            ) : null}
            {topic.isAiGenerated ? (
              <Text style={styles.topicCategoryBadge} numberOfLines={1}>
                ✦ AI
              </Text>
            ) : null}
            {category ? (
              <Text style={styles.topicCategoryBadge} numberOfLines={1}>
                {category}
              </Text>
            ) : null}
            {accessRequirementText ? <Text style={styles.topicAccessBadge}>{accessRequirementText}</Text> : null}
            {visibleTopicTags.map((tag, index) => {
              const colors = topicTagColorStyle(tag, theme, topic.tags);
              return (
                <View key={getMappingKey(tag, index)} style={[styles.topicTagPill, colors]}>
                  <Text style={[styles.topicTagText, { color: colors.color }]} numberOfLines={1}>
                    {tag.trim()}
                  </Text>
                </View>
              );
            })}
            {hiddenTopicTagCount ? (
              <Text style={styles.topicTagMoreText} numberOfLines={1}>
                +{hiddenTopicTagCount}
              </Text>
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
        {trailingAction ? (
          <View style={styles.topicFooterActionRow}>
            {footer}
            {trailingAction}
          </View>
        ) : (
          footer
        )}
      </Pressable>
    </View>
  );
}

export const MemoizedTopicCard = memo(TopicCard, topicCardPropsAreEqual);

export function TopicListSeparator() {
  const { styles } = useReaderThemeStyles(createStyles);
  return <View testID="topic-list-separator" style={styles.topicListSeparator} />;
}

const placeholderTitleWidths = ['88%', '69%', '93%'] as const;

export function TopicListPlaceholder({
  animating,
  label,
  fillHeight
}: {
  animating: boolean;
  label: string;
  fillHeight?: number;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const rowHeight =
    styles.topicCardPressable.paddingTop +
    styles.topicCardPressable.paddingBottom +
    styles.topicCardPressable.gap * 2 +
    styles.placeholderTitleSlot.height +
    styles.placeholderTag.height +
    styles.placeholderAvatar.height +
    styles.topicListSeparator.height;
  const rowCount =
    fillHeight === undefined ? placeholderTitleWidths.length : Math.max(1, Math.ceil(fillHeight / rowHeight));
  return (
    <ContentLoadingPlaceholder
      key={`${rowCount}:${rowHeight}`}
      animating={animating}
      label={label}
      style={styles.topicRowSurface}
    >
      {Array.from({ length: rowCount }, (_, index) => (
        <View key={index} style={styles.topicRowShell}>
          {index > 0 ? <View style={styles.topicListSeparator} /> : null}
          <View style={styles.topicCardPressable}>
            <View style={styles.placeholderTitleSlot}>
              <SkeletonBlock
                style={[
                  styles.placeholderTitle,
                  { width: placeholderTitleWidths[index % placeholderTitleWidths.length] }
                ]}
              />
            </View>
            <View style={styles.topicMetadata}>
              <SkeletonBlock style={[styles.placeholderTag, { width: 42 }]} />
              <SkeletonBlock style={[styles.placeholderTag, { width: 58 }]} />
              <SkeletonBlock style={[styles.placeholderTag, { width: 36 }]} />
            </View>
            <View style={styles.topicFooterRow}>
              <View style={styles.topicAuthorChip}>
                <SkeletonBlock style={styles.placeholderAvatar} />
                <SkeletonBlock style={[styles.placeholderByline, { width: '40%' }]} />
                <SkeletonBlock style={[styles.placeholderByline, { width: '20%' }]} />
              </View>
              <View style={styles.topicStatGroup}>
                <SkeletonBlock style={[styles.placeholderByline, { width: 30 }]} />
                <SkeletonBlock style={[styles.placeholderByline, { width: 30 }]} />
              </View>
            </View>
          </View>
        </View>
      ))}
    </ContentLoadingPlaceholder>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = createReaderFontSizer(settings);
  const densityPadding = settings.listDensity === 'compact' ? 11 : settings.listDensity === 'loose' ? 16 : 14;
  const densityGap = settings.listDensity === 'compact' ? 6 : settings.listDensity === 'loose' ? 10 : 8;
  return StyleSheet.create({
    topicListSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
    placeholderTitleSlot: { height: fontSize(23), justifyContent: 'center' },
    placeholderTitle: { height: fontSize(14) },
    placeholderTag: { height: fontSize(16) },
    placeholderAvatar: { width: 24, height: 24, borderRadius: 12 },
    placeholderByline: { height: fontSize(9), flexShrink: 1 },
    topicRowShell: { position: 'relative', overflow: 'hidden', width: '100%' },
    topicRowSurface: { backgroundColor: theme.surface },
    topicCardPressable: {
      gap: densityGap,
      paddingHorizontal: 16,
      paddingTop: densityPadding + 2,
      paddingBottom: densityPadding
    },
    topicMetadata: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 8,
      rowGap: 4
    },
    topicSourceBadge: {
      maxWidth: '100%',
      overflow: 'hidden',
      color: theme.ink,
      fontFamily,
      fontSize: fontSize(11),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: fontSize(16)
    },
    topicPinnedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: readerRadii.badge,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.08)
    },
    topicPinnedLabel: { color: theme.dark ? theme.primary : theme.primaryStrong },
    topicCategoryBadge: {
      maxWidth: '100%',
      overflow: 'hidden',
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(11),
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: fontSize(16)
    },
    timeText: {
      flexShrink: 0,
      maxWidth: '65%',
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(17),
      includeFontPadding: false,
      fontVariant: ['tabular-nums']
    },
    cardTitle: {
      color: theme.ink,
      fontFamily,
      fontSize: fontSize(16),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: fontSize(23)
    },
    cardTitleRead: { color: theme.muted, fontWeight: '500' },
    excerpt: { color: theme.muted, fontFamily, fontSize: fontSize(13), lineHeight: fontSize(19) },
    highlightText: { color: theme.dark ? theme.primary : theme.primaryStrong, fontWeight: '700' },
    topicAccessBadge: {
      maxWidth: '100%',
      overflow: 'hidden',
      color: theme.danger,
      fontFamily,
      fontSize: fontSize(11),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: fontSize(16),
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.16 : 0.08),
      borderColor: alphaColor(theme.danger, 0.34),
      borderRadius: readerRadii.badge,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 3,
      textAlignVertical: 'center'
    },
    topicFooterRow: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      columnGap: 10,
      rowGap: 5
    },
    topicFooterWithAction: { flex: 1, minWidth: 0 },
    topicFooterActionRow: { minHeight: 48, alignItems: 'center', flexDirection: 'row', gap: 8 },
    topicAuthorChip: {
      // Keep space for the avatar and a short byline before moving the entire stats row below it.
      flexBasis: 76,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 7
    },
    topicAuthorTextGroup: { flex: 1, minWidth: 0, gap: 2 },
    topicByline: { alignItems: 'baseline', flexDirection: 'row', gap: 8 },
    topicAuthorName: {
      flexShrink: 1,
      minWidth: 0,
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(13),
      lineHeight: fontSize(18),
      fontWeight: '500',
      includeFontPadding: false
    },
    topicDuplicateSources: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(17),
      includeFontPadding: false
    },
    topicStatGroup: {
      flexShrink: 0,
      maxWidth: '100%',
      marginLeft: 'auto',
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10
    },
    topicStatItem: { flexShrink: 1, minWidth: 0, alignItems: 'center', flexDirection: 'row', gap: 4 },
    topicStatText: {
      flexShrink: 1,
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(12),
      fontWeight: '400',
      includeFontPadding: false,
      lineHeight: fontSize(17),
      fontVariant: ['tabular-nums']
    },
    topicTagPill: {
      maxWidth: '100%',
      alignItems: 'center',
      borderRadius: readerRadii.badge,
      justifyContent: 'center',
      paddingHorizontal: 7,
      paddingVertical: 2
    },
    topicTagText: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(11),
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: fontSize(16),
      textAlignVertical: 'center'
    },
    topicTagMoreText: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(11),
      fontWeight: '600',
      includeFontPadding: false,
      lineHeight: fontSize(16),
      textAlignVertical: 'center'
    }
  });
}
