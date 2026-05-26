import { memo, type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  type ListRenderItem,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Image,
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native';
import {
  HTMLContentModel,
  HTMLElementModel,
  RenderHTMLConfigProvider,
  RenderHTMLSource,
  TRenderEngineProvider
} from 'react-native-render-html';
import { SvgXml } from 'react-native-svg';
import { BookMarked, CheckCircle, ChevronLeft, Drumstick, ExternalLink, MessageCircle, RefreshCw, Share2, Star, ThumbsUp, X } from 'lucide-react-native';
import type { ReaderData } from '../readerData';
import { isFavorite } from '../readerData';
import type { Reply, Source, Topic, TopicDetail, UserProfile } from '../types';
import type { HtmlAllowedStyles, HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, ReplyFilter, YaohuoReplyTarget } from '../appTypes';
import { highlightHtml } from '../androidFeatureHelpers';
import { formatDateTime, sourceLabel } from '../appUtils';
import { loadRemoteAvatarSvgText } from '../avatarImages';
import { flowInlineImagesInMixedParagraphs, imageSourceFromUrl, INLINE_FORUM_IMAGE_TAG } from '../htmlImages';
import { splitTopicContentHtml } from '../topicContentSplit';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail } from '../components/AppControls';
import { REPLY_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';
import { topicWithAuthorFallback, userFromReply, userFromTopic } from '../userNavigation';

type TopicListContentItem = { type: 'content'; key: string; html: string };
export type TopicListItem =
  | TopicListContentItem
  | { type: 'topicActions'; key: string }
  | { type: 'replyControls'; key: string }
  | { type: 'replyComposer'; key: string }
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number };

const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'iframe', 'noscript'];
const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = ['fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine'];
const HTML_CUSTOM_ELEMENT_MODELS = {
  [INLINE_FORUM_IMAGE_TAG]: HTMLElementModel.fromCustomModel({
    tagName: INLINE_FORUM_IMAGE_TAG,
    contentModel: HTMLContentModel.textual
  })
};
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

function authorInitial(name: string | undefined) {
  return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
}

function AuthorAvatar({
  name,
  small,
  styles,
  uri
}: {
  name?: string;
  small?: boolean;
  styles: ReturnType<typeof createStyles>;
  uri?: string;
}) {
  const [svgXml, setSvgXml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvgXml(null);
    if (!uri) {
      return () => {
        cancelled = true;
      };
    }
    loadRemoteAvatarSvgText(uri).then((xml) => {
      if (!cancelled) {
        setSvgXml(xml);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return (
    <View style={[styles.replyAvatar, small ? styles.replyAvatarSmall : styles.topicAvatar]}>
      {svgXml ? (
        <SvgXml
          xml={svgXml}
          width="100%"
          height="100%"
        />
      ) : uri ? (
        <Image
          source={imageSourceFromUrl(uri)}
          style={[styles.replyAvatarImage, small ? styles.replyAvatarSmall : styles.topicAvatar]}
        />
      ) : (
        <Text style={[styles.replyAvatarText, small && styles.replyAvatarSmallText]}>{authorInitial(name)}</Text>
      )}
    </View>
  );
}

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
  quoteStateVersion,
  readerData,
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
  onInteract,
  onShareTopic,
  onYaohuoFavorite,
  onYaohuoVote,
  onLoadMoreReplies,
  onOpenOriginal,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFilterChange,
  onReplyToFloor,
  onRefreshTopic,
  onVerifyLinuxDo,
  onSubmitReply,
  onTopicScroll,
  onToggleQuotedFloor,
  onToggleFavorite,
  onOpenUser
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
  quoteStateVersion: number;
  readerData: ReaderData;
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
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onShareTopic: () => void;
  onYaohuoFavorite: () => void;
  onYaohuoVote: (voteId: string) => void;
  onLoadMoreReplies: () => void;
  onOpenOriginal: (url: string) => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onReplyToFloor: (reply: Reply) => void;
  onRefreshTopic: () => void;
  onVerifyLinuxDo: () => void;
  onSubmitReply: () => void;
  onTopicScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
  onToggleFavorite: (topic: Topic) => void;
  onOpenUser: (user: UserProfile) => void;
}) {
  const item = topicWithAuthorFallback(topic, selectedTopic) || selectedTopic;
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
  const topicContentHtml = topic?.contentHtml || '';
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
    if (topic) {
      items.push({ type: 'topicActions', key: 'topic-actions' });
    }
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
  }, [canShowReplies, canWrite, replyComposerOpen, replyItems, topic, topicContentItems]);
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

    if (listItem.type === 'topicActions') {
      return (
        <View style={[styles.topicPostActionArea, topicColumnStyle]}>
          {canWriteNodeSeek ? (
            <View style={styles.topicPrimaryActions}>
              <IconButton tiny icon={ThumbsUp} label={`点赞 ${topic?.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
              <IconButton tiny icon={Drumstick} label={`加鸡腿 ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
            </View>
          ) : null}
          {canWriteYaohuo ? (
            <View style={styles.topicPrimaryActions}>
              <IconButton tiny icon={BookMarked} label="原站收藏" styles={styles} theme={theme} disabled={actionBusy} onPress={onYaohuoFavorite} />
              {(topic?.voteOptions || []).map((option) => (
                <IconButton
                  key={option.id}
                  tiny
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
          <AppButton label="发送回复" variant="primary" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
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
          onReplyToFloor={onReplyToFloor}
          onToggleQuotedFloor={onToggleQuotedFloor}
          query={commentQuery}
          isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
          source={itemSource}
          onOpenUser={onOpenUser}
        />
      </View>
    );
  }, [
    actionBusy,
    canWrite,
    canWriteNodeSeek,
    canWriteYaohuo,
    commentQuery,
    contentWidth,
    expandedQuotesRef,
    floorOpen,
    jumpToFloor,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    newReplyFloorStart,
    onCommentQueryChange,
    onInteract,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFilterChange,
    onReplyToFloor,
    onSubmitReply,
    onToggleQuotedFloor,
    onOpenUser,
    onYaohuoFavorite,
    onYaohuoVote,
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
    topic,
    topicColumnStyle
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const listHeader = (
    <View style={styles.topicHeaderStack}>
      <View style={[styles.article, topicColumnStyle]}>
        <View style={styles.topicMetaStack}>
          <Text style={styles.sourceText}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <Text selectable style={styles.articleTitle}>{item.title}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!userFromTopic(item)}
            style={styles.topicAuthorRow}
            onPress={() => {
              const user = userFromTopic(item);
              if (user) {
                onOpenUser(user);
              }
            }}
          >
            <AuthorAvatar name={item.author} uri={item.authorAvatar} styles={styles} />
            <View style={styles.topicAuthorMeta}>
              <Text style={styles.replyAuthor} numberOfLines={1}>{item.author || '未知作者'}</Text>
              <Text style={styles.meta}>{formatDateTime(item.createdAt)} · {item.replyCount} 回复{item.viewCount ? ` · ${item.viewCount} 浏览` : ''}</Text>
            </View>
          </Pressable>
          {item.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{item.accessRequirement.label}</Text> : null}
        </View>
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
    <TRenderEngineProvider baseStyle={htmlBaseStyle} allowedStyles={HTML_ALLOWED_INLINE_STYLES} customHTMLElementModels={HTML_CUSTOM_ELEMENT_MODELS} ignoredStyles={htmlIgnoredStyles} tagsStyles={htmlTagsStyles} ignoredDomTags={HTML_IGNORED_DOM_TAGS}>
      <RenderHTMLConfigProvider
        renderers={htmlRenderers}
        renderersProps={htmlRenderersProps}
        defaultTextProps={{ selectable: true }}
        enableExperimentalBRCollapsing
        enableExperimentalGhostLinesPrevention
        enableExperimentalMarginCollapsing
      >
        <View style={styles.topicTopBar}>
          <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
          <Text style={styles.topicTopHint} numberOfLines={1}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <View style={styles.topicTopActions}>
            <IconButton iconOnly ghost icon={Star} label={isFavorite(readerData, item) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, item)} onPress={() => onToggleFavorite(item)} />
            <IconButton iconOnly ghost icon={Share2} label="分享" styles={styles} theme={theme} onPress={onShareTopic} />
            <IconButton iconOnly ghost icon={RefreshCw} label="刷新" styles={styles} theme={theme} onPress={onRefreshTopic} />
            <IconButton iconOnly ghost icon={ExternalLink} label="原站" styles={styles} theme={theme} onPress={() => onOpenOriginal(item.url)} />
          </View>
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
  const source = useMemo(() => ({ html: flowInlineImagesInMixedParagraphs(html || '<p></p>') }), [html]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

const MemoizedHtmlContent = memo(HtmlContent);

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
  onOpenUser,
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
  onOpenUser: (user: UserProfile) => void;
  onReplyToFloor: (reply: Reply) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  const replyContentWidth = Math.max(220, contentWidth - 42);
  const replyUser = userFromReply(reply, source);
  return (
    <View style={styles.replyCard}>
      <Pressable
        accessibilityRole="button"
        disabled={!replyUser}
        style={styles.replyHead}
        onPress={() => {
          if (replyUser) {
            onOpenUser(replyUser);
          }
        }}
      >
        <AuthorAvatar small name={reply.author} uri={reply.authorAvatar} styles={styles} />
        <View style={styles.replyAuthorBlock}>
          <Text style={styles.replyAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
          <Text style={styles.replyTime}>{formatDateTime(reply.createdAt)}</Text>
        </View>
        <View style={styles.replyFloorBadge}>
          <Text style={styles.replyFloorText}>#{reply.floor ?? '-'}</Text>
        </View>
        {isNew ? <Text style={styles.replyNewBadge}>新增</Text> : null}
      </Pressable>
      <View style={styles.replyContentArea}>
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
                      <Pressable
                        accessibilityRole="button"
                        disabled={!userFromReply(quotedReply, source)}
                        style={styles.quoteAuthorRow}
                        onPress={() => {
                          const user = userFromReply(quotedReply, source);
                          if (user) {
                            onOpenUser(user);
                          }
                        }}
                      >
                        <AuthorAvatar small name={quotedReply.author} uri={quotedReply.authorAvatar} styles={styles} />
                        <Text style={styles.replyMeta}>引用 #{quotedFloor} · {quotedReply.author || '未知作者'}</Text>
                      </Pressable>
                      <MemoizedHtmlContent
                        contentWidth={Math.max(220, replyContentWidth - 24)}
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
            contentWidth={replyContentWidth}
            html={highlightedHtml}
          />
        </View>
        {canWrite && source === 'nodeseek' ? (
          <View style={styles.replyActionRow}>
            <IconButton tiny icon={ThumbsUp} label={`点赞 ${reply.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
            <IconButton tiny icon={Drumstick} label={`加鸡腿 ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
          </View>
        ) : null}
        {canWrite && source === 'yaohuo' ? (
          <View style={styles.replyActionRow}>
            <IconButton tiny icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const MemoizedReplyCard = memo(ReplyCard, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.isNew !== next.isNew
    || previous.onInteract !== next.onInteract
    || previous.onOpenUser !== next.onOpenUser
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
