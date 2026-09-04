import { createUserStyles, type UserStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react-native';
import type { SourceErrorInfo, Topic, UserProfile, UserReference, UserReplyActivity } from '@/domain/forum/models';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { AuthNoticeBox, EmptyText, LoadingState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { ScreenTopBar, ScreenTopBarActions, ScreenTopBarTitle } from '@/ui/controls/ScreenTopBar';
import { Avatar } from '@/ui/avatar/Avatar';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import {
  createUserListItems,
  userListInstanceKey,
  userListItemKey,
  userListItemType,
  type UserActivityTab,
  type UserListItem
} from './userScreenItems';

const USER_LIST_POSITION_PROPS = { disabled: true };

function topicFromUserReply(reply: UserReplyActivity): Topic {
  return {
    source: reply.source,
    id: reply.topicId,
    title: reply.topicTitle || '查看原帖',
    author: reply.author || '',
    authorId: reply.authorId,
    authorAvatar: reply.authorAvatar,
    authorUrl: reply.authorUrl,
    categoryId: reply.categoryId,
    category: reply.category,
    url: reply.topicUrl || reply.url,
    createdAt: reply.createdAt || '',
    lastReplyAt: reply.createdAt || '',
    displayTimeText: reply.displayTimeText,
    replyCount: reply.floor || 0,
    excerpt: reply.excerpt
  };
}

function UserReplyCard({
  reply,
  styles,
  onOpenTopic
}: {
  reply: UserReplyActivity;
  styles: UserStyles;
  onOpenTopic: (topic: Topic) => void;
}) {
  const openTopicPress = useCallback(() => {
    onOpenTopic(topicFromUserReply(reply));
  }, [onOpenTopic, reply]);
  const timeText = reply.displayTimeText || (reply.createdAt ? formatDateTime(reply.createdAt) : '');
  const meta = [reply.author || '', reply.floor ? `#${reply.floor}` : '', timeText].filter(Boolean).join(' · ');
  return (
    <View style={styles.topicRowShell}>
      <Pressable accessibilityRole="button" style={styles.topicCardPressable} onPress={openTopicPress}>
        <View style={styles.topicCardHead}>
          <View style={styles.topicBadgeRow}>
            <Text style={styles.topicSourceBadge} numberOfLines={1}>
              {sourceLabel(reply.source)}
            </Text>
            {reply.category ? (
              <Text style={styles.topicCategoryBadge} numberOfLines={1}>
                {reply.category}
              </Text>
            ) : null}
          </View>
          {meta ? (
            <Text style={styles.timeText} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {reply.topicTitle || '查看原帖'}
        </Text>
        {reply.excerpt ? (
          <Text style={styles.excerpt} numberOfLines={2}>
            {reply.excerpt}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export const UserScreen = memo(function UserScreen({
  busy,
  error,
  followed,
  profile,
  requestedUser,
  topicStateIndex,
  loadingMoreReplies,
  loadingMoreTopics,
  onBack,
  onLoadMoreReplies,
  onLoadMoreTopics,
  onOpenOriginal,
  onOpenTopic,
  onRefresh,
  onToggleFollow
}: {
  busy: boolean;
  error: SourceErrorInfo | null;
  followed: boolean;
  profile: UserProfile | null;
  requestedUser: UserReference | null;
  topicStateIndex: TopicListItemStateIndex;
  loadingMoreReplies: boolean;
  loadingMoreTopics: boolean;
  onBack: () => void;
  onLoadMoreReplies: () => void;
  onLoadMoreTopics: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onRefresh: () => void;
  onToggleFollow: (user: UserProfile) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createUserStyles);
  const user = profile || requestedUser;
  const topics = profile?.topics || [];
  const replies = profile?.replies || [];
  const [userTab, setUserTab] = useState<UserActivityTab>('topics');
  const levelLabel = profile?.levelLabel;
  const profileStats = useMemo(() => {
    const stats: { label: string; value: string }[] = [];
    if (levelLabel) {
      stats.push({ label: '等级', value: levelLabel });
    }
    if (typeof profile?.topicCount === 'number') {
      stats.push({ label: '主题', value: String(profile.topicCount) });
    }
    if (typeof profile?.replyCount === 'number') {
      stats.push({ label: '回复', value: String(profile.replyCount) });
    }
    if (typeof profile?.postCount === 'number') {
      stats.push({ label: '发言', value: String(profile.postCount) });
    }
    if (profile?.joinedAt) {
      stats.push({ label: '加入', value: formatDateTime(profile.joinedAt) || profile.joinedAt });
    }
    return stats;
  }, [levelLabel, profile?.joinedAt, profile?.postCount, profile?.replyCount, profile?.topicCount]);
  const listItems = useMemo<UserListItem[]>(
    () => createUserListItems(userTab, topics, replies),
    [replies, topics, userTab]
  );
  const listInstanceKey = user ? userListInstanceKey(user, userTab) : userTab;
  const listRef = useRef<FlashListRef<UserListItem> | null>(null);
  const autoLoadArmedRef = useRef(false);
  const pendingScrollTopRef = useRef(false);
  const followTarget = profile;
  const userAuthNotice = error ? authNoticeForSourceError(error) : null;
  useEffect(() => {
    autoLoadArmedRef.current = false;
    setUserTab('topics');
  }, [user?.id, user?.source, user?.username]);
  const scrollListToTop = useCallback(() => {
    if (!listRef.current) {
      pendingScrollTopRef.current = true;
      return;
    }
    listRef.current.scrollToOffset({ offset: 0, animated: false });
    pendingScrollTopRef.current = false;
  }, []);
  const completePendingScrollReset = useCallback(() => {
    if (pendingScrollTopRef.current) {
      scrollListToTop();
    }
  }, [scrollListToTop]);
  useEffect(() => {
    autoLoadArmedRef.current = false;
    pendingScrollTopRef.current = true;
    const frame = requestAnimationFrame(scrollListToTop);
    const timer = setTimeout(scrollListToTop, 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [scrollListToTop, user?.id, user?.source, user?.username, userTab]);
  const armAutoLoad = useCallback(() => {
    autoLoadArmedRef.current = true;
  }, []);
  const changeUserTab = useCallback(
    (value: string) => {
      const nextTab: UserActivityTab = value === 'replies' ? 'replies' : 'topics';
      if (nextTab === userTab) {
        return;
      }
      autoLoadArmedRef.current = false;
      pendingScrollTopRef.current = true;
      setUserTab(nextTab);
    },
    [userTab]
  );
  const handleEndReached = useCallback(() => {
    const hasMore = userTab === 'replies' ? profile?.hasMoreReplies : profile?.hasMoreTopics;
    const loadingMore = userTab === 'replies' ? loadingMoreReplies : loadingMoreTopics;
    if (!hasMore || busy || loadingMore || !autoLoadArmedRef.current) {
      return;
    }
    autoLoadArmedRef.current = false;
    if (userTab === 'replies') {
      onLoadMoreReplies();
    } else {
      onLoadMoreTopics();
    }
  }, [
    busy,
    loadingMoreReplies,
    loadingMoreTopics,
    onLoadMoreReplies,
    onLoadMoreTopics,
    profile?.hasMoreReplies,
    profile?.hasMoreTopics,
    userTab
  ]);
  const requestUserTopicLoadMore = useCallback(() => {
    autoLoadArmedRef.current = false;
    if (userTab === 'replies') {
      onLoadMoreReplies();
    } else {
      onLoadMoreTopics();
    }
  }, [onLoadMoreReplies, onLoadMoreTopics, userTab]);
  const renderProfileHeader = useCallback(
    () => (
      <View style={styles.userProfileHeader}>
        <View style={styles.topicAuthorRow}>
          <Avatar
            contentSource={user?.source || null}
            name={user?.displayName || user?.username || user?.id}
            uri={user?.avatar}
          />
          <View style={styles.topicAuthorMeta}>
            <Text style={styles.articleTitle}>{user?.displayName || user?.username || user?.id || '用户'}</Text>
            <Text style={styles.meta}>
              {user ? `${sourceLabel(user.source)} · ${user.username || user.id || ''}` : '用户信息读取中'}
            </Text>
          </View>
        </View>
        {profile?.bio ? <Text style={styles.excerpt}>{profile.bio}</Text> : null}
        {profileStats.length ? (
          <View style={styles.profileStatRail}>
            {profileStats.map((stat) => (
              <View key={stat.label} style={styles.profileStatPill}>
                <Text style={styles.profileStatLabel}>{stat.label}</Text>
                <Text style={styles.profileStatValue} numberOfLines={1}>
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {error ? (
          userAuthNotice ? (
            <AuthNoticeBox notice={userAuthNotice}>
              <AppButton compact label="重试" onPress={onRefresh} />
            </AuthNoticeBox>
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error.message}</Text>
            </View>
          )
        ) : null}
        {busy ? <LoadingState text="正在读取用户主页..." /> : null}
        <View style={styles.actions}>
          {followTarget ? (
            <AppButton
              label={followed ? '取消关注' : '关注'}
              variant={followed ? 'danger' : undefined}
              onPress={() => onToggleFollow(followTarget)}
            />
          ) : null}
          {user?.url ? <AppButton label="原站主页" variant="ghost" onPress={() => onOpenOriginal(user.url)} /> : null}
        </View>
        {profile ? (
          <PillRail
            items={[
              { value: 'topics', label: '主题' },
              { value: 'replies', label: '回复' }
            ]}
            value={userTab}
            variant="tabs"
            onChange={changeUserTab}
          />
        ) : null}
        {profile && userTab === 'topics' && !topics.length && !busy ? (
          <EmptyText text="这个用户暂时没有可显示的主题" />
        ) : null}
        {profile && userTab === 'replies' && !replies.length && !busy ? (
          <EmptyText text="这个用户暂时没有可显示的回复" />
        ) : null}
      </View>
    ),
    [
      busy,
      changeUserTab,
      error,
      followTarget,
      followed,
      onOpenOriginal,
      onRefresh,
      onToggleFollow,
      profile,
      profileStats,
      replies.length,
      styles,
      theme,
      topics.length,
      user,
      userAuthNotice,
      userTab
    ]
  );

  const renderItem = useCallback<ListRenderItem<UserListItem>>(
    ({ item, index }) => {
      if (item.type === 'reply') {
        return <UserReplyCard reply={item.reply} styles={styles} onOpenTopic={onOpenTopic} />;
      }
      return (
        <MemoizedTopicCard
          testID={index === 0 ? 'user-topic-first' : undefined}
          readerState={getTopicListItemStateFromIndex(topicStateIndex, item.topic)}
          topic={item.topic}
          hideReplyCount={item.topic.source === 'nodeseek'}
          onOpenTopic={onOpenTopic}
        />
      );
    },
    [onOpenTopic, styles, topicStateIndex]
  );

  if (!user) {
    return <EmptyText text="未选择用户" />;
  }

  return (
    <View style={styles.screen}>
      <ScreenTopBar>
        <IconButton icon={ChevronLeft} compact ghost label="返回" onPress={onBack} />
        <ScreenTopBarTitle>
          {sourceLabel(user.source)} · {user.displayName || user.username || user.id}
        </ScreenTopBarTitle>
        <ScreenTopBarActions>
          <IconButton iconOnly ghost icon={RefreshCw} label="刷新" onPress={onRefresh} />
          {user.url ? (
            <IconButton iconOnly ghost icon={ExternalLink} label="原站" onPress={() => onOpenOriginal(user.url)} />
          ) : null}
        </ScreenTopBarActions>
      </ScreenTopBar>
      {renderProfileHeader()}
      <FlashList
        testID={profile && !busy ? 'user-screen-loaded' : undefined}
        key={listInstanceKey}
        ref={listRef}
        style={styles.content}
        contentContainerStyle={styles.userContentInner}
        data={listItems}
        keyExtractor={userListItemKey}
        getItemType={userListItemType}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={USER_LIST_POSITION_PROPS}
        {...TOPIC_LIST_PERFORMANCE_PROPS}
        ListFooterComponent={
          (userTab === 'replies' ? profile?.hasMoreReplies : profile?.hasMoreTopics) ? (
            <View style={styles.actions}>
              <AppButton
                label={
                  (userTab === 'replies' ? loadingMoreReplies : loadingMoreTopics)
                    ? '正在加载...'
                    : userTab === 'replies'
                      ? '加载更多回复'
                      : '加载更多主题'
                }
                disabled={busy || (userTab === 'replies' ? loadingMoreReplies : loadingMoreTopics)}
                onPress={requestUserTopicLoadMore}
              />
            </View>
          ) : null
        }
        onContentSizeChange={completePendingScrollReset}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onMomentumScrollBegin={armAutoLoad}
        onScrollBeginDrag={armAutoLoad}
        renderItem={renderItem}
      />
    </View>
  );
});
