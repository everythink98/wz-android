import { createUserStyles, type UserStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItem } from '@shopify/flash-list';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ExternalLink from 'lucide-react-native/icons/external-link';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import type { SourceErrorInfo, Topic, UserProfile, UserReference, UserReplyActivity } from '@/domain/forum/models';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import { getTopicListItemStateFromIndex, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { AuthNoticeBox, EmptyText } from '@/ui/controls/FeedbackStates';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { ScreenTopBar, ScreenTopBarActions, ScreenTopBarTitle } from '@/ui/controls/ScreenTopBar';
import { Avatar } from '@/ui/avatar/Avatar';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '@/ui/list/performance';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import {
  createUserListItems,
  userListItemKey,
  userListItemType,
  type UserActivityTab,
  type UserListItem
} from './userScreenItems';

const USER_LIST_POSITION_PROPS = { disabled: true };
const USER_STICKY_HEADER_INDICES = [0];
const USER_STICKY_HEADER_CONFIG = { hideRelatedCell: true };
const EMPTY_TOPICS: Topic[] = [];
const EMPTY_REPLIES: UserReplyActivity[] = [];
const EMPTY_LIST_ITEMS: UserListItem[] = [];
const USER_TABS: { value: UserActivityTab; label: string }[] = [
  { value: 'topics', label: '主题' },
  { value: 'replies', label: '回复' }
];

function UserBio({
  bio,
  expanded,
  styles,
  onToggle
}: {
  bio: string;
  expanded: boolean;
  styles: UserStyles;
  onToggle: () => void;
}) {
  const [hasOverflow, setHasOverflow] = useState(false);
  return (
    <View style={styles.bioSection}>
      <View style={styles.bioTextContainer}>
        <Text
          testID="user-bio-measure"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.bio, styles.bioMeasure]}
          onTextLayout={({ nativeEvent }) => setHasOverflow(nativeEvent.lines.length > 2)}
        >
          {bio}
        </Text>
        <Text testID="user-bio-text" style={styles.bio} numberOfLines={expanded ? undefined : 2}>
          {bio}
        </Text>
      </View>
      {hasOverflow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? '收起简介' : '展开简介'}
          accessibilityState={{ expanded }}
          style={styles.bioToggle}
          onPress={onToggle}
        >
          <Text style={styles.bioToggleText}>{expanded ? '收起' : '展开'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
  const { styles, theme, settings } = useReaderThemeStyles(createUserStyles);
  const { fontScale } = useWindowDimensions();
  const user = profile || requestedUser;
  const topics = profile?.topics || EMPTY_TOPICS;
  const replies = profile?.replies || EMPTY_REPLIES;
  const [userTab, setUserTab] = useState<UserActivityTab>('topics');
  const [bioExpanded, setBioExpanded] = useState(false);
  const userIdentity = user ? `${user.source}:${user.id || user.username}` : '';
  const displayName = user?.displayName || user?.username || user?.id || '用户';
  const userSubtitle = user
    ? [sourceLabel(user.source), user.username && user.username !== displayName ? user.username : '']
        .filter(Boolean)
        .join(' · ')
    : '';
  const profileDetails = [
    profile?.levelLabel,
    profile?.joinedAt ? `${formatDateTime(profile.joinedAt).replace(/ \d{2}:\d{2}$/, '')} 加入` : ''
  ]
    .filter(Boolean)
    .join(' · ');
  const profileStats = useMemo(() => {
    const stats: { label: string; value: string }[] = [];
    if (typeof profile?.topicCount === 'number') {
      stats.push({ label: '主题', value: String(profile.topicCount) });
    }
    if (typeof profile?.replyCount === 'number') {
      stats.push({ label: '回复', value: String(profile.replyCount) });
    }
    if (typeof profile?.postCount === 'number' && profile.source !== 'nodeseek' && profile.source !== 'v2ex') {
      stats.push({ label: '发言', value: String(profile.postCount) });
    }
    return stats;
  }, [profile?.source, profile?.postCount, profile?.replyCount, profile?.topicCount]);
  const topicItems = useMemo(() => createUserListItems('topics', topics, EMPTY_REPLIES), [topics]);
  const replyItems = useMemo(() => createUserListItems('replies', EMPTY_TOPICS, replies), [replies]);
  const listItems = profile ? (userTab === 'topics' ? topicItems : replyItems) : EMPTY_LIST_ITEMS;
  const listRef = useRef<FlashListRef<UserListItem> | null>(null);
  const autoLoadArmedRef = useRef(false);
  const pendingScrollTopRef = useRef(false);
  const userAuthNotice = useMemo(() => (error ? authNoticeForSourceError(error) : null), [error]);
  useEffect(() => {
    setBioExpanded(false);
  }, [userIdentity]);
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
  const profileHeader = useMemo(
    () => (
      <View testID="user-profile-header" style={styles.userProfileHeader}>
        <View style={styles.profileIdentityRow}>
          <View style={styles.topicAuthorRow}>
            <Avatar contentSource={user?.source || null} name={displayName} uri={user?.avatar} />
            <View style={styles.topicAuthorMeta}>
              <Text style={styles.articleTitle}>{displayName}</Text>
              <Text style={styles.meta}>{userSubtitle}</Text>
            </View>
          </View>
          {profile ? (
            <Pressable
              hitSlop={TOUCH_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={followed ? '已关注' : '关注'}
              accessibilityHint={followed ? '再次点击取消本机关注' : '在本机关注这个用户'}
              accessibilityState={{ selected: followed }}
              style={[
                styles.followButton,
                { minWidth: Math.round(88 * settings.fontScale * fontScale) },
                followed && styles.followButtonSelected
              ]}
              onPress={() => onToggleFollow(profile)}
            >
              <Text style={[styles.followButtonText, followed && styles.followButtonTextSelected]}>
                {followed ? '已关注' : '关注'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {profile?.bio ? (
          <UserBio
            key={userIdentity}
            bio={profile.bio}
            expanded={bioExpanded}
            styles={styles}
            onToggle={() => setBioExpanded((value) => !value)}
          />
        ) : null}
        {profileDetails ? <Text style={styles.meta}>{profileDetails}</Text> : null}
        {profileStats.length ? (
          <View style={styles.profileStatRail}>
            {profileStats.map((stat) => (
              <View
                key={stat.label}
                accessible
                accessibilityLabel={`${stat.label} ${stat.value}`}
                style={styles.profileStat}
              >
                <Text style={styles.profileStatValue}>{stat.value}</Text>
                <Text style={styles.profileStatLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {error ? (
          userAuthNotice ? (
            <AuthNoticeBox notice={userAuthNotice}>
              <AppButton compact label="重试" disabled={busy} onPress={onRefresh} />
            </AuthNoticeBox>
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error.message}</Text>
            </View>
          )
        ) : null}
        {busy && !profile ? (
          <View
            accessible
            role="status"
            accessibilityLabel="正在读取用户主页"
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: true }}
            style={styles.initialLoading}
          >
            <ActivityIndicator
              accessible={false}
              size="small"
              color={theme.dark ? theme.primary : theme.primaryStrong}
            />
            <Text accessible={false} style={styles.meta}>
              正在读取用户主页
            </Text>
          </View>
        ) : null}
      </View>
    ),
    [
      bioExpanded,
      busy,
      displayName,
      error,
      followed,
      fontScale,
      onRefresh,
      onToggleFollow,
      profile,
      profileDetails,
      profileStats,
      settings.fontScale,
      styles,
      theme,
      user,
      userAuthNotice,
      userIdentity,
      userSubtitle
    ]
  );

  const renderItem = useCallback<ListRenderItem<UserListItem>>(
    ({ item, index }) => {
      if (item.type === 'tabs') {
        return (
          <View style={styles.activityTabs}>
            {USER_TABS.map((tab) => (
              <Pressable
                key={tab.value}
                accessibilityRole="tab"
                accessibilityLabel={`${tab.label}${userTab === tab.value ? '，已选择' : ''}`}
                accessibilityState={{ selected: userTab === tab.value }}
                style={[styles.activityTab, userTab === tab.value && styles.activityTabSelected]}
                onPress={() => changeUserTab(tab.value)}
              >
                <Text style={[styles.activityTabText, userTab === tab.value && styles.activityTabTextSelected]}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      }
      if (item.type === 'reply') {
        return <UserReplyCard reply={item.reply} styles={styles} onOpenTopic={onOpenTopic} />;
      }
      return (
        <MemoizedTopicCard
          testID={index === 1 ? 'user-topic-first' : undefined}
          readerState={getTopicListItemStateFromIndex(topicStateIndex, item.topic)}
          topic={item.topic}
          hideReplyCount={item.topic.source === 'nodeseek'}
          onOpenTopic={onOpenTopic}
        />
      );
    },
    [changeUserTab, onOpenTopic, styles, topicStateIndex, userTab]
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
          <View style={styles.toolbarAction}>
            <IconButton iconOnly ghost icon={RefreshCw} iconSize={20} label="刷新" loading={busy} onPress={onRefresh} />
          </View>
          {user.url ? (
            <View style={styles.toolbarAction}>
              <IconButton
                iconOnly
                ghost
                icon={ExternalLink}
                iconSize={20}
                label="原站"
                onPress={() => onOpenOriginal(user.url)}
              />
            </View>
          ) : null}
        </ScreenTopBarActions>
      </ScreenTopBar>
      <FlashList
        testID={profile ? 'user-screen-loaded' : undefined}
        key={userIdentity}
        ref={listRef}
        style={styles.content}
        contentContainerStyle={styles.userContentInner}
        data={listItems}
        keyExtractor={userListItemKey}
        getItemType={userListItemType}
        ListHeaderComponent={profileHeader}
        stickyHeaderIndices={profile ? USER_STICKY_HEADER_INDICES : undefined}
        stickyHeaderConfig={USER_STICKY_HEADER_CONFIG}
        keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={USER_LIST_POSITION_PROPS}
        {...TOPIC_LIST_PERFORMANCE_PROPS}
        ListFooterComponent={
          <>
            {profile && !(userTab === 'replies' ? replies.length : topics.length) ? (
              <View style={styles.emptyActivity}>
                <EmptyText
                  text={userTab === 'replies' ? '这个用户暂时没有可显示的回复' : '这个用户暂时没有可显示的主题'}
                />
              </View>
            ) : null}
            {(userTab === 'replies' ? profile?.hasMoreReplies : profile?.hasMoreTopics) ? (
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
            ) : null}
          </>
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
