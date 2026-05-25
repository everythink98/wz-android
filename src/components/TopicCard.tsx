import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, Text, type StyleProp, type TextStyle, View } from 'react-native';
import { Star, X } from 'lucide-react-native';
import type { Topic } from '../types';
import { topicKey } from '../readerData';
import { formatRelativeTime, sourceLabel, topicListDisplayTime } from '../appUtils';
import { highlightTextParts } from '../androidFeatureHelpers';
import { LIST_SWIPE_ACTION_WIDTH, clampListSwipeTranslate, shouldCaptureListSwipe, shouldOpenListSwipeAction } from '../listSwipeActions';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';
import { topicListItemStatesEqual, type TopicListItemState } from '../topicListItemState';
import { TOUCH_HIT_SLOP } from './AppControls';

export type TopicSwipeActionConfig = {
  kind: 'favorite' | 'delete';
  onPress: (topic: Topic) => void;
};

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
  topic,
  readerState,
  swipeAction,
  styles,
  theme,
  onOpenTopic,
  swipeOpenKey,
  onSwipeActiveChange,
  onSwipeClose,
  onSwipeOpen
}: {
  highlightQuery?: string;
  topic: Topic;
  readerState: TopicListItemState;
  swipeAction?: TopicSwipeActionConfig;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
  swipeOpenKey?: string;
  onSwipeActiveChange?: (active: boolean) => void;
  onSwipeClose?: () => void;
  onSwipeOpen?: (key: string) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeOpenRef = useRef(false);
  const isSwipeActiveRef = useRef(false);
  const key = topicKey(topic);
  const releaseSwipeActive = useCallback(() => {
    if (isSwipeActiveRef.current) {
      isSwipeActiveRef.current = false;
      onSwipeActiveChange?.(false);
    }
  }, [onSwipeActiveChange]);
  const animateSwipe = useCallback((open: boolean) => {
    isSwipeOpenRef.current = open;
    if (open) {
      onSwipeOpen?.(key);
    } else {
      onSwipeClose?.();
    }
    Animated.spring(translateX, {
      toValue: open ? -LIST_SWIPE_ACTION_WIDTH : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 90
    }).start();
  }, [key, onSwipeClose, onSwipeOpen, translateX]);
  useEffect(() => {
    if (isSwipeOpenRef.current && swipeOpenKey !== key) {
      animateSwipe(false);
    }
  }, [animateSwipe, key, swipeOpenKey]);
  useEffect(() => () => {
    releaseSwipeActive();
  }, [releaseSwipeActive]);
  useEffect(() => {
    if (!swipeAction) {
      releaseSwipeActive();
      if (isSwipeOpenRef.current) {
        animateSwipe(false);
      }
    }
  }, [animateSwipe, releaseSwipeActive, swipeAction]);
  const openTopicPress = useCallback(() => {
    if (isSwipeOpenRef.current) {
      animateSwipe(false);
      return;
    }
    onOpenTopic(topic);
  }, [animateSwipe, onOpenTopic, topic]);
  const runSwipeAction = useCallback(() => {
    swipeAction?.onPress(topic);
    animateSwipe(false);
  }, [animateSwipe, swipeAction, topic]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => {
      if (!swipeAction) {
        return false;
      }
      if (isSwipeOpenRef.current) {
        return Math.abs(gesture.dx) >= 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6;
      }
      return shouldCaptureListSwipe(gesture.dx, gesture.dy);
    },
    onPanResponderGrant: () => {
      isSwipeActiveRef.current = true;
      onSwipeActiveChange?.(true);
    },
    onPanResponderMove: (_event, gesture) => {
      const start = isSwipeOpenRef.current ? -LIST_SWIPE_ACTION_WIDTH : 0;
      translateX.setValue(clampListSwipeTranslate(start + gesture.dx));
    },
    onPanResponderRelease: (_event, gesture) => {
      const start = isSwipeOpenRef.current ? -LIST_SWIPE_ACTION_WIDTH : 0;
      releaseSwipeActive();
      animateSwipe(Boolean(swipeAction) && shouldOpenListSwipeAction(start + gesture.dx, gesture.vx));
    },
    onPanResponderTerminate: () => {
      releaseSwipeActive();
      animateSwipe(isSwipeOpenRef.current);
    }
  }), [animateSwipe, onSwipeActiveChange, releaseSwipeActive, swipeAction, translateX]);
  const ActionIcon = swipeAction?.kind === 'delete' ? X : Star;
  const swipeActionLabel = swipeAction?.kind === 'delete'
    ? '删除'
    : readerState.favorite ? '取消收藏' : '收藏';
  const metaParts = [
    topic.author || '未知作者',
    `${topic.replyCount} 回复`,
    topic.viewCount ? `${topic.viewCount} 浏览` : '',
    readerState.favorite ? '已收藏' : '',
    readerState.read ? '已读' : '',
    readerState.tracked ? '追踪命中' : '',
    topic.duplicateSources?.length ? `同链：${topic.duplicateSources.join('、')}` : ''
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.topicSwipeShell}>
      {swipeAction ? (
        <View style={[styles.topicSwipeAction, swipeAction.kind === 'delete' && styles.topicSwipeActionDanger]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={swipeActionLabel}
            hitSlop={TOUCH_HIT_SLOP}
            android_ripple={androidRipple(theme.primarySoft)}
            style={styles.topicSwipeActionButton}
            onPress={runSwipeAction}
          >
            <ActionIcon size={18} color={swipeAction.kind === 'delete' ? theme.danger : theme.primary} strokeWidth={2} />
            <Text style={[styles.topicSwipeActionText, swipeAction.kind === 'delete' && styles.topicSwipeActionTextDanger]}>{swipeActionLabel}</Text>
          </Pressable>
        </View>
      ) : null}
      <Animated.View
        {...(swipeAction ? panResponder.panHandlers : {})}
        style={[
          styles.topicCard,
          { transform: [{ translateX }] }
        ]}
      >
        <Pressable accessibilityRole="button" android_ripple={androidRipple(theme.primarySoft)} style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]} onPress={openTopicPress}>
          <View style={styles.topicCardHead}>
            <Text style={[styles.sourceText, styles.topicCardSource]} numberOfLines={1}>{sourceLabel(topic.source)}{topic.category ? ` · ${topic.category}` : ''}</Text>
            <Text style={styles.timeText} numberOfLines={1}>{formatRelativeTime(topicListDisplayTime(topic))}</Text>
          </View>
          <HighlightedText style={styles.cardTitle} highlightStyle={styles.highlightText} numberOfLines={readerState.listDensity === 'loose' ? 3 : 2} text={topic.title || '无标题'} query={highlightQuery} />
          {topic.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{topic.accessRequirement.label}</Text> : null}
          {topic.excerpt && readerState.listDensity === 'loose' ? <HighlightedText style={styles.excerpt} highlightStyle={styles.highlightText} numberOfLines={2} text={topic.excerpt} query={highlightQuery} /> : null}
        </Pressable>
        <View style={[styles.topicMetaRow, readerState.read && styles.topicCardRead]}>
          <Text style={[styles.meta, styles.topicMetaText]} numberOfLines={1}>{metaParts}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

export const MemoizedTopicCard = memo(TopicCard, (previous, next) => (
  topicKey(previous.topic) === topicKey(next.topic)
  && previous.topic.title === next.topic.title
  && previous.topic.excerpt === next.topic.excerpt
  && previous.topic.category === next.topic.category
  && previous.topic.categoryId === next.topic.categoryId
  && previous.topic.replyCount === next.topic.replyCount
  && previous.topic.viewCount === next.topic.viewCount
  && previous.topic.createdAt === next.topic.createdAt
  && previous.topic.lastReplyAt === next.topic.lastReplyAt
  && previous.styles === next.styles
  && previous.theme === next.theme
  && previous.highlightQuery === next.highlightQuery
  && previous.onOpenTopic === next.onOpenTopic
  && previous.onSwipeActiveChange === next.onSwipeActiveChange
  && previous.onSwipeClose === next.onSwipeClose
  && previous.onSwipeOpen === next.onSwipeOpen
  && previous.swipeAction === next.swipeAction
  && previous.swipeOpenKey === next.swipeOpenKey
  && topicListItemStatesEqual(previous.readerState, next.readerState)
));
