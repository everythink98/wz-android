import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import { ChevronLeft, ExternalLink, RefreshCw, Star } from 'lucide-react-native';
import type { SourceErrorInfo, Topic, UserProfile, UserReference, UserReplyActivity } from '@/domain/forum/models';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { androidRipple, createStyles, type ReaderTheme } from '@/theme';
import { AppButton, EmptyText, IconButton, LoadingState, PillRail } from '@/components/AppControls';
import { Avatar } from '@/components/Avatar';
import { MemoizedTopicCard } from '@/components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/components/listPerformance';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import {
  createUserListItems,
  userListInstanceKey,
  userListItemKey,
  userListItemType,
  type UserActivityTab,
  type UserListItem
} from '@/screens/user/userScreenItems';

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
  theme,
  onOpenTopic
}: {
  reply: UserReplyActivity;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
}) {
  const openTopicPress = useCallback(() => {
    onOpenTopic(topicFromUserReply(reply));
  }, [onOpenTopic, reply]);
  const timeText = reply.displayTimeText || (reply.createdAt ? formatDateTime(reply.createdAt) : '');
  const meta = [reply.author || '', reply.floor ? `#${reply.floor}` : '', timeText].filter(Boolean).join(' · ');
  return (
    <View style={styles.topicRowShell}>
      <Pressable
        accessibilityRole="button"
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.topicCardPressable}
        onPress={openTopicPress}
      >
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
  identityBlocked = false,
  identityChecking = false,
  profile,
  requestedUser,
  styles,
  theme,
  topicStateIndex,
  loadingMoreReplies,
  loadingMoreTopics,
  onBack,
  onLoadMoreReplies,
  onLoadMoreTopics,
  onCheckLinuxDoStatus,
  onOpenOriginal,
  onOpenTopic,
  onRefresh,
  onToggleFollow
}: {
  busy: boolean;
  error: SourceErrorInfo | null;
  followed: boolean;
  identityBlocked?: boolean;
  identityChecking?: boolean;
  profile: UserProfile | null;
  requestedUser: UserReference | null;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicStateIndex: TopicListItemStateIndex;
  loadingMoreReplies: boolean;
  loadingMoreTopics: boolean;
  onBack: () => void;
  onLoadMoreReplies: () => void;
  onLoadMoreTopics: () => void;
  onCheckLinuxDoStatus?: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onRefresh: () => void;
  onToggleFollow: (user: UserProfile) => void;
}) {
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
  const userAuthNoticeBoxStyle =
    userAuthNotice?.tone === 'danger'
      ? styles.authNoticeBoxDanger
      : userAuthNotice?.tone === 'warning'
        ? styles.authNoticeBoxWarning
        : styles.authNoticeBoxNeutral;
  const userAuthNoticeTextStyle =
    userAuthNotice?.tone === 'danger'
      ? styles.authNoticeTextDanger
      : userAuthNotice?.tone === 'warning'
        ? styles.authNoticeTextWarning
        : styles.authNoticeTextNeutral;
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
            styles={styles}
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
          <View style={userAuthNotice ? [styles.authNoticeBox, userAuthNoticeBoxStyle] : styles.errorBox}>
            <Text style={userAuthNotice ? [styles.authNoticeText, userAuthNoticeTextStyle] : styles.errorText}>
              {userAuthNotice?.message || error.message}
            </Text>
            {identityBlocked ? (
              <View style={styles.actions}>
                <AppButton label="重试检测" styles={styles} onPress={onRefresh} />
                {user?.source === 'linuxdo' && onCheckLinuxDoStatus ? (
                  <AppButton label="检查 L 站状态" variant="ghost" styles={styles} onPress={onCheckLinuxDoStatus} />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {busy ? (
          <LoadingState
            text={identityChecking ? '正在确认 L 站访问状态' : '正在读取用户主页...'}
            styles={styles}
            theme={theme}
          />
        ) : null}
        <View style={styles.actions}>
          {followTarget ? (
            <AppButton
              label={followed ? '取消关注' : '关注'}
              variant={followed ? 'danger' : undefined}
              styles={styles}
              onPress={() => onToggleFollow(followTarget)}
            />
          ) : null}
          {user?.url ? (
            <AppButton label="原站主页" variant="ghost" styles={styles} onPress={() => onOpenOriginal(user.url)} />
          ) : null}
        </View>
        {profile ? (
          <PillRail
            items={[
              { value: 'topics', label: '主题' },
              { value: 'replies', label: '回复' }
            ]}
            value={userTab}
            variant="tabs"
            styles={styles}
            onChange={changeUserTab}
          />
        ) : null}
        {profile && userTab === 'topics' && !topics.length && !busy ? (
          <EmptyText text="这个用户暂时没有可显示的主题" styles={styles} />
        ) : null}
        {profile && userTab === 'replies' && !replies.length && !busy ? (
          <EmptyText text="这个用户暂时没有可显示的回复" styles={styles} />
        ) : null}
      </View>
    ),
    [
      busy,
      changeUserTab,
      error,
      followTarget,
      followed,
      identityBlocked,
      identityChecking,
      onCheckLinuxDoStatus,
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
      userAuthNoticeBoxStyle,
      userAuthNoticeTextStyle,
      userTab
    ]
  );

  const renderItem = useCallback<ListRenderItem<UserListItem>>(
    ({ item, index }) => {
      if (item.type === 'reply') {
        return <UserReplyCard reply={item.reply} styles={styles} theme={theme} onOpenTopic={onOpenTopic} />;
      }
      return (
        <MemoizedTopicCard
          testID={index === 0 ? 'user-topic-first' : undefined}
          readerState={getTopicListItemStateFromIndex(topicStateIndex, item.topic)}
          styles={styles}
          theme={theme}
          topic={item.topic}
          hideReplyCount={item.topic.source === 'nodeseek'}
          onOpenTopic={onOpenTopic}
        />
      );
    },
    [onOpenTopic, styles, theme, topicStateIndex]
  );

  if (!user) {
    return <EmptyText text="未选择用户" styles={styles} />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topicTopBar}>
        <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
        <Text style={styles.topicTopHint} numberOfLines={1}>
          {sourceLabel(user.source)} · {user.displayName || user.username || user.id}
        </Text>
        <View style={styles.topicTopActions}>
          {followTarget ? (
            <IconButton
              iconOnly
              ghost
              icon={Star}
              label={followed ? '已关注' : '关注'}
              active={followed}
              activeColor={theme.favorite}
              styles={styles}
              theme={theme}
              onPress={() => onToggleFollow(followTarget)}
            />
          ) : null}
          <IconButton iconOnly ghost icon={RefreshCw} label="刷新" styles={styles} theme={theme} onPress={onRefresh} />
          {user.url ? (
            <IconButton
              iconOnly
              ghost
              icon={ExternalLink}
              label="原站"
              styles={styles}
              theme={theme}
              onPress={() => onOpenOriginal(user.url)}
            />
          ) : null}
        </View>
      </View>
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
                styles={styles}
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
