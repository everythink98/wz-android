import { memo, type ComponentProps, type RefObject, useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native';
import RenderHTML, {
  RenderHTMLConfigProvider,
  RenderHTMLSource,
  TRenderEngineProvider
} from 'react-native-render-html';
import { BookMarked, CheckCircle, ChevronLeft, Copy, ExternalLink, Heart, List, MessageCircle, MoreHorizontal, RefreshCw, Star, ThumbsUp, X } from 'lucide-react-native';
import type { ReaderData } from '../readerData';
import { isFavorite } from '../readerData';
import type { Reply, Source, Topic, TopicDetail } from '../types';
import type { ReplyFilter, YaohuoReplyTarget } from '../appTypes';
import { highlightHtml, readerModeHtml } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { splitTopicContentHtml } from '../topicContentSplit';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail } from '../components/AppControls';
import { REPLY_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
type HtmlAllowedStyles = NonNullable<ComponentProps<typeof RenderHTML>['allowedStyles']>;
type HtmlIgnoredStyles = NonNullable<ComponentProps<typeof RenderHTML>['ignoredStyles']>;
type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
type HtmlTagsStyles = NonNullable<ComponentProps<typeof RenderHTML>['tagsStyles']>;

type TopicListContentItem = { type: 'content'; key: string; html: string };
export type TopicListItem =
  | TopicListContentItem
  | { type: 'replyControls'; key: string }
  | { type: 'replyComposer'; key: string }
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number };

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'iframe', 'noscript'];
const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = ['fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine'];

function stableTextHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getReplyKey(reply: Reply) {
  if (typeof reply.floor === 'number') {
    return `reply-floor-${reply.floor}`;
  }
  if (typeof reply.commentId === 'number') {
    return `reply-comment-${reply.commentId}`;
  }
  const seed = [
    reply.authorId || '',
    reply.author || '',
    reply.createdAt || '',
    reply.contentHtml || ''
  ].join('|');
  return `reply-${stableTextHash(seed || JSON.stringify(reply))}`;
}

function topicListItemKey(item: TopicListItem) {
  return item.key;
}

const MemoizedHtmlContent = memo(HtmlContent);

const MemoizedReplyCard = memo(ReplyCard, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.isNew !== next.isNew
    || previous.onInteract !== next.onInteract
    || previous.onCopyReplyMarkdown !== next.onCopyReplyMarkdown
    || previous.onReplyToFloor !== next.onReplyToFloor
    || previous.onToggleQuotedFloor !== next.onToggleQuotedFloor
    || previous.query !== next.query
    || previous.reply !== next.reply
    || previous.replyFloor !== next.replyFloor
    || previous.source !== next.source
    || previous.styles !== next.styles
    || previous.theme !== next.theme
  ) {
    return false;
  }

  const quotedFloors = new Set([...(previous.reply.quotedFloors || []), ...(next.reply.quotedFloors || [])]);
  for (const quotedFloor of quotedFloors) {
    const previousKey = `${previous.replyFloor}:${quotedFloor}`;
    const nextKey = `${next.replyFloor}:${quotedFloor}`;
    if (
      Boolean(previous.expandedQuotes[previousKey]) !== Boolean(next.expandedQuotes[nextKey])
      || Boolean(previous.loadingQuotedFloors[previousKey]) !== Boolean(next.loadingQuotedFloors[nextKey])
      || previous.loadedQuotedReplies[quotedFloor] !== next.loadedQuotedReplies[quotedFloor]
      || previous.repliesByFloor.get(quotedFloor) !== next.repliesByFloor.get(quotedFloor)
    ) {
      return false;
    }
  }

  return true;
});

export function TopicScreen({
  actionBusy,
  canUseNodeSeekActions,
  canUseYaohuoActions,
  contentWidth,
  htmlBaseStyle,
  htmlIgnoredStyles,
  htmlRenderers,
  htmlRenderersProps,
  htmlTagsStyles,
  expandedQuotesRef,
  loadedQuotedRepliesRef,
  loadingMoreReplies,
  loadingQuotedFloorsRef,
  commentQuery,
  focusMode,
  quoteStateVersion,
  readerData,
  readerMode,
  replyComposerOpen,
  replyContent,
  replyFilter,
  replyTarget,
  replyHasMore,
  replies,
  selectedTopic,
  sourceReplies,
  styles,
  theme,
  topic,
  topicBusy,
  topicError,
  topicScrollRef,
  unreadReplyCount,
  onBack,
  onCommentQueryChange,
  onCopyReplyMarkdown,
  onCopyTopicLink,
  onInteract,
  onYaohuoFavorite,
  onYaohuoVote,
  onLoadMoreReplies,
  onOpenOriginal,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFilterChange,
  onReplyToFloor,
  onRefreshTopic,
  onReaderModeChange,
  onFocusModeChange,
  onVerifyLinuxDo,
  onSubmitReply,
  onTopicScroll,
  onToggleQuotedFloor,
  onToggleFavorite
}: {
  actionBusy: boolean;
  canUseNodeSeekActions: boolean;
  canUseYaohuoActions: boolean;
  contentWidth: number;
  htmlBaseStyle: HtmlBaseStyle;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderers: HtmlRenderers;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  expandedQuotesRef: RefObject<Record<string, boolean>>;
  loadedQuotedRepliesRef: RefObject<Record<number, Reply>>;
  loadingMoreReplies: boolean;
  loadingQuotedFloorsRef: RefObject<Record<string, boolean>>;
  commentQuery: string;
  focusMode: boolean;
  quoteStateVersion: number;
  readerData: ReaderData;
  readerMode: boolean;
  replyComposerOpen: boolean;
  replyContent: string;
  replyFilter: ReplyFilter;
  replyTarget: YaohuoReplyTarget | null;
  replyHasMore: boolean;
  replies: Reply[];
  selectedTopic: Topic | null;
  sourceReplies: Reply[];
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topic: TopicDetail | null;
  topicBusy: boolean;
  topicError: string;
  topicScrollRef: RefObject<FlatList<TopicListItem> | null>;
  unreadReplyCount: number;
  onBack: () => void;
  onCommentQueryChange: (value: string) => void;
  onCopyReplyMarkdown: (reply: Reply, floor: number) => void;
  onCopyTopicLink: () => void;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onYaohuoFavorite: () => void;
  onYaohuoVote: (voteId: string) => void;
  onLoadMoreReplies: () => void;
  onOpenOriginal: (url: string) => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onReplyToFloor: (reply: Reply) => void;
  onRefreshTopic: () => void;
  onReaderModeChange: (value: boolean) => void;
  onFocusModeChange: (value: boolean) => void;
  onVerifyLinuxDo: () => void;
  onSubmitReply: () => void;
  onTopicScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
  onToggleFavorite: (topic: Topic) => void;
}) {
  const item = topic || selectedTopic;
  const topicLoading = topicBusy || (!topic && !topicError);
  const canShowReplies = Boolean(topic && !topicLoading);
  const canWriteNodeSeek = Boolean(topic && topic.source === 'nodeseek' && canUseNodeSeekActions);
  const canWriteYaohuo = Boolean(topic && topic.source === 'yaohuo' && canUseYaohuoActions);
  const canWrite = canWriteNodeSeek || canWriteYaohuo;
  const itemSource = topic?.source;
  const repliesByFloor = useMemo(() => {
    const next = new Map<number, Reply>();
    sourceReplies.forEach((reply) => {
      if (typeof reply.floor === 'number') {
        next.set(reply.floor, reply);
      }
    });
    Object.values(loadedQuotedRepliesRef.current).forEach((reply) => {
      if (reply.floor) {
        next.set(reply.floor, reply);
      }
    });
    return next;
  }, [loadedQuotedRepliesRef, quoteStateVersion, sourceReplies]);
  const [floorOpen, setFloorOpen] = useState(false);
  const newReplyFloorStart = useMemo(() => {
    if (unreadReplyCount <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const floors = sourceReplies.map((reply) => reply.floor).filter((floor): floor is number => typeof floor === 'number');
    if (!floors.length) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(...floors) - unreadReplyCount + 1;
  }, [sourceReplies, unreadReplyCount]);

  const topicColumnStyle = useMemo(() => ({ width: contentWidth }), [contentWidth]);
  const topicContentHtml = topic ? (readerMode ? readerModeHtml(topic.contentHtml) : topic.contentHtml) : '';
  const topicContentItems = useMemo<TopicListItem[]>(() => (
    topic
      ? splitTopicContentHtml(topicContentHtml).map((html, index) => ({
        type: 'content',
        key: `topic-content-${index}-${stableTextHash(html)}`,
        html
      }))
      : []
  ), [topic, topicContentHtml]);
  const replyItems = useMemo<TopicListItem[]>(() => replies.map((reply) => ({
    type: 'reply',
    key: getReplyKey(reply),
    reply,
    replyFloor: reply.floor ?? 0
  })), [replies]);
  const topicListItems = useMemo<TopicListItem[]>(() => {
    const items = [...topicContentItems];
    if (canShowReplies) {
      items.push({ type: 'replyControls', key: 'reply-controls' });
      if (canWrite && replyComposerOpen) {
        items.push({ type: 'replyComposer', key: 'reply-composer' });
      }
      if (replyItems.length) {
        items.push(...replyItems);
      } else {
        items.push({ type: 'emptyReplies', key: 'empty-replies' });
      }
    }
    return items;
  }, [canShowReplies, canWrite, replyComposerOpen, replyItems, topicContentItems]);
  const jumpToFloor = useCallback((floor: number) => {
    const index = topicListItems.findIndex((entry) => entry.type === 'reply' && entry.replyFloor === floor);
    if (index >= 0) {
      topicScrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });
      setFloorOpen(false);
    }
  }, [topicListItems, topicScrollRef]);
  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(({ item: listItem }) => {
    if (listItem.type === 'content') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <MemoizedHtmlContent
              contentWidth={contentWidth}
              html={listItem.html}
            />
          </View>
        </View>
      );
    }

    if (listItem.type === 'replyControls') {
      return (
        <View style={[styles.replyHeader, topicColumnStyle]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>回复列表 <Text style={styles.countText}>{sourceReplies.length} 条</Text></Text>
            {canWrite ? (
              <AppButton
                label={replyComposerOpen ? '收起回复' : '写回复'}
                variant={replyComposerOpen ? 'ghost' : 'default'}
                styles={styles}
                onPress={() => onReplyComposerOpenChange(!replyComposerOpen)}
              />
            ) : null}
          </View>
          <PillRail
            items={[
              { value: 'all', label: '全部' },
              { value: 'author', label: '只看楼主' },
              { value: 'images', label: '只看带图' },
              { value: 'newest', label: '倒序' }
            ]}
            value={replyFilter}
            styles={styles}
            onChange={(value) => onReplyFilterChange(value as ReplyFilter)}
          />
          {unreadReplyCount > 0 ? <Text style={styles.noticeText}>新增 {unreadReplyCount} 条回复</Text> : null}
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={commentQuery}
              onChangeText={onCommentQueryChange}
              placeholder="评论内查找"
              placeholderTextColor={theme.muted}
            />
            {commentQuery ? <IconButton icon={X} label="清空查找" styles={styles} theme={theme} onPress={() => onCommentQueryChange('')} /> : null}
          </View>
          <View style={styles.actions}>
            <AppButton compact label={floorOpen ? '收起楼层目录' : '楼层目录'} variant="ghost" styles={styles} onPress={() => setFloorOpen((value) => !value)} />
          </View>
          {floorOpen ? (
            <View style={styles.floorIndex}>
              {replies.map((reply, index) => {
                const floor = reply.floor ?? index + 1;
                return (
                  <Pressable key={`${floor}-${reply.createdAt}`} accessibilityRole="button" style={styles.floorIndexItem} onPress={() => jumpToFloor(floor)}>
                    <Text style={styles.meta}>#{floor} {reply.author || '未知作者'}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      );
    }

    if (listItem.type === 'replyComposer') {
      return (
        <View style={[styles.replyBox, topicColumnStyle]}>
          <Text style={styles.panelTitle}>{replyTarget ? `回复 #${replyTarget.floor}${replyTarget.author ? ` · ${replyTarget.author}` : ''}` : '回复'}</Text>
          <TextInput
            style={[styles.input, styles.replyInput]}
            value={replyContent}
            onChangeText={onReplyContentChange}
            placeholder={replyTarget ? '输入楼层回复内容' : '输入回复内容'}
            placeholderTextColor={theme.muted}
            multiline
          />
          {replyTarget ? <AppButton label="取消楼层回复" variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} /> : null}
          <AppButton label="发送回复" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
        </View>
      );
    }

    if (listItem.type === 'emptyReplies') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <EmptyText text="暂无回复" styles={styles} />
        </View>
      );
    }

    return (
      <View style={[styles.replyListItem, topicColumnStyle]}>
        <MemoizedReplyCard
          actionBusy={actionBusy}
          canWrite={canWrite}
          contentWidth={Math.max(240, contentWidth - 28)}
          expandedQuotes={expandedQuotesRef.current}
          loadedQuotedReplies={loadedQuotedRepliesRef.current}
          loadingQuotedFloors={loadingQuotedFloorsRef.current}
          reply={listItem.reply}
          replyFloor={listItem.replyFloor}
          repliesByFloor={repliesByFloor}
          styles={styles}
          theme={theme}
          onInteract={onInteract}
          onCopyReplyMarkdown={onCopyReplyMarkdown}
          onReplyToFloor={onReplyToFloor}
          onToggleQuotedFloor={onToggleQuotedFloor}
          query={commentQuery}
          isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
          source={itemSource}
        />
      </View>
    );
  }, [
    actionBusy,
    canWrite,
    commentQuery,
    contentWidth,
    expandedQuotesRef,
    floorOpen,
    jumpToFloor,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    newReplyFloorStart,
    onCommentQueryChange,
    onCopyReplyMarkdown,
    onInteract,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFilterChange,
    onReplyToFloor,
    onSubmitReply,
    onToggleQuotedFloor,
    quoteStateVersion,
    itemSource,
    replyComposerOpen,
    replyContent,
    replyFilter,
    replyTarget,
    repliesByFloor,
    sourceReplies.length,
    styles,
    theme,
    topicColumnStyle
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const topicTopHint = focusMode
    ? '专注模式'
    : canWrite
      ? item.source === 'yaohuo' ? '妖火可回复' : 'NodeSeek 可回复'
      : '只读 · 原站回复';

  const listHeader = (
    <View style={styles.topicHeaderStack}>
      <View style={[styles.article, topicColumnStyle]}>
        {!focusMode ? (
          <View style={styles.topicMetaStack}>
            <Text style={styles.sourceText}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
            <Text style={styles.meta}>{item.author || '未知作者'} · {formatDateTime(item.createdAt)} · {item.replyCount} 回复{item.viewCount ? ` · ${item.viewCount} 浏览` : ''}</Text>
            {item.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{item.accessRequirement.label}</Text> : null}
          </View>
        ) : null}
        <Text style={styles.articleTitle}>{item.title}</Text>
        {canWriteNodeSeek ? (
          <View style={styles.topicPrimaryActions}>
            <IconButton tiny ghost icon={ThumbsUp} label={`点赞 ${topic?.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
            <IconButton tiny ghost icon={Heart} label={`感谢 ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
          </View>
        ) : null}
        {canWriteYaohuo ? (
          <View style={styles.topicPrimaryActions}>
            <IconButton tiny ghost icon={BookMarked} label="原站收藏" styles={styles} theme={theme} disabled={actionBusy} onPress={onYaohuoFavorite} />
            {(topic?.voteOptions || []).map((option) => (
              <IconButton
                key={option.id}
                tiny
                ghost
                icon={CheckCircle}
                label={`投票 ${option.label}${typeof option.count === 'number' ? ` ${option.count}` : ''}`}
                styles={styles}
                theme={theme}
                disabled={actionBusy}
                onPress={() => onYaohuoVote(option.id)}
              />
            ))}
          </View>
        ) : null}
        {topicError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{topicError}</Text>
            <View style={styles.actions}>
              {item.source === 'linuxdo' && topicError.includes('Cloudflare') ? <AppButton label="去验证" styles={styles} onPress={onVerifyLinuxDo} /> : null}
              <AppButton label="重试" styles={styles} onPress={onRefreshTopic} />
            </View>
          </View>
        ) : null}
        {!topic && !topicError ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : null}
      </View>
    </View>
  );

  return (
    <TRenderEngineProvider baseStyle={htmlBaseStyle} allowedStyles={HTML_ALLOWED_INLINE_STYLES} ignoredStyles={htmlIgnoredStyles} tagsStyles={htmlTagsStyles} ignoredDomTags={HTML_IGNORED_DOM_TAGS}>
      <RenderHTMLConfigProvider
        renderers={htmlRenderers}
        renderersProps={htmlRenderersProps}
        enableExperimentalBRCollapsing
        enableExperimentalGhostLinesPrevention
        enableExperimentalMarginCollapsing
      >
        <View style={styles.topicTopBar}>
          <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
          <Text style={styles.topicTopHint}>{topicTopHint}</Text>
          <ScrollView horizontal style={styles.topicTopActionScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicTopActions}>
            <IconButton icon={Copy} compact ghost iconOnly label="复制链接" styles={styles} theme={theme} onPress={onCopyTopicLink} />
            <IconButton icon={RefreshCw} compact ghost iconOnly label="刷新主题" styles={styles} theme={theme} onPress={onRefreshTopic} />
            <IconButton icon={List} compact ghost iconOnly label="楼层目录" styles={styles} theme={theme} active={floorOpen} onPress={() => setFloorOpen((value) => !value)} />
            <IconButton icon={BookMarked} compact ghost iconOnly label="Reader Mode" styles={styles} theme={theme} active={readerMode} onPress={() => onReaderModeChange(!readerMode)} />
            <IconButton icon={MoreHorizontal} compact ghost iconOnly label="专注模式" styles={styles} theme={theme} active={focusMode} onPress={() => onFocusModeChange(!focusMode)} />
            <IconButton icon={Star} compact ghost iconOnly label={isFavorite(readerData, item) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, item)} onPress={() => onToggleFavorite(item)} />
            <IconButton icon={ExternalLink} compact ghost iconOnly label="原站" styles={styles} theme={theme} onPress={() => onOpenOriginal(item.url)} />
          </ScrollView>
        </View>
        <FlatList
          ref={topicScrollRef}
          style={[styles.content, styles.topicContent]}
          contentContainerStyle={[styles.contentInner, styles.topicContentInner]}
          data={topicListItems}
          keyExtractor={topicListItemKey}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={onTopicScroll}
          onScrollEndDrag={onTopicScroll}
          onEndReachedThreshold={0.55}
          onEndReached={() => {
            if (replyHasMore && !loadingMoreReplies) {
              onLoadMoreReplies();
            }
          }}
          extraData={quoteStateVersion}
          {...REPLY_LIST_PERFORMANCE_PROPS}
          ListHeaderComponent={listHeader}
          ListFooterComponent={canShowReplies && replyHasMore ? (
            <View style={[styles.topicFooter, topicColumnStyle]}>
              <AppButton label={loadingMoreReplies ? '正在加载...' : '加载更多回复'} styles={styles} disabled={loadingMoreReplies} onPress={onLoadMoreReplies} />
            </View>
          ) : null}
          renderItem={renderReplyItem}
        />
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
}

function HtmlContent({
  contentWidth,
  html
}: {
  contentWidth: number;
  html: string | undefined;
}) {
  const source = useMemo(() => ({ html: html || '<p></p>' }), [html]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

function ReplyCard({
  actionBusy,
  canWrite,
  contentWidth,
  expandedQuotes,
  isNew,
  loadedQuotedReplies,
  loadingQuotedFloors,
  query,
  reply,
  replyFloor,
  repliesByFloor,
  source,
  styles,
  theme,
  onInteract,
  onCopyReplyMarkdown,
  onReplyToFloor,
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  isNew?: boolean;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  query: string;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onCopyReplyMarkdown: (reply: Reply, floor: number) => void;
  onReplyToFloor: (reply: Reply) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  return (
    <View style={styles.replyCard}>
      <View style={styles.replyHead}>
        <View style={styles.replyFloorBadge}>
          <Text style={styles.replyFloorText}>#{reply.floor ?? '-'}</Text>
        </View>
        <View style={styles.replyAuthorBlock}>
          <Text style={styles.replyAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
          <Text style={styles.replyTime}>{formatDateTime(reply.createdAt)}</Text>
        </View>
        {isNew ? <Text style={styles.topicAccessBadge}>新增</Text> : null}
      </View>
      {quotedFloors.length ? (
        <View style={styles.quoteStack}>
          {quotedFloors.map((quotedFloor) => {
            const key = `${replyFloor}:${quotedFloor}`;
            const quotedReply = repliesByFloor.get(quotedFloor) || loadedQuotedReplies[quotedFloor];
            const expanded = Boolean(expandedQuotes[key]);
            const loading = Boolean(loadingQuotedFloors[key]);
            return (
              <View key={key} style={styles.quoteBox}>
                <View style={styles.actions}>
                  <AppButton
                    label={loading ? '读取引用' : expanded ? `收起引用 #${quotedFloor}` : `展开引用 #${quotedFloor}`}
                    variant="ghost"
                    styles={styles}
                    disabled={loading}
                    onPress={() => onToggleQuotedFloor({ replyFloor, quotedFloor, quotedReply })}
                  />
                  {quotedReply ? <Text style={styles.meta}>已加载</Text> : <Text style={styles.meta}>引用楼层未加载</Text>}
                </View>
                {expanded && quotedReply ? (
                  <View style={styles.quoteBody}>
                    <Text style={styles.replyMeta}>引用 #{quotedFloor} · {quotedReply.author || '未知作者'}</Text>
                    <MemoizedHtmlContent
                      contentWidth={Math.max(240, contentWidth - 44)}
                      html={quotedReply.contentHtml}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      <View style={styles.replyBody}>
        <MemoizedHtmlContent
          contentWidth={contentWidth}
          html={highlightedHtml}
        />
      </View>
      <View style={styles.replyActionRow}>
        <IconButton tiny ghost icon={Copy} label="复制楼层引用" styles={styles} theme={theme} onPress={() => onCopyReplyMarkdown(reply, reply.floor ?? replyFloor)} />
      </View>
      {canWrite && source === 'nodeseek' ? (
        <View style={styles.replyActionRow}>
          <IconButton tiny ghost icon={ThumbsUp} label={`点赞 ${reply.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
          <IconButton tiny ghost icon={Heart} label={`感谢 ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
        </View>
      ) : null}
      {canWrite && source === 'yaohuo' ? (
        <View style={styles.replyActionRow}>
          <IconButton tiny ghost icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
        </View>
      ) : null}
    </View>
  );
}
