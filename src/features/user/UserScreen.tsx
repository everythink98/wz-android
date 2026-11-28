import { createUserListInteraction } from './userListInteraction';
import { useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import { createUserStyles, type UserStyles } from './styles';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, Text, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import { ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react-native';
import type { SourceErrorInfo, Topic, UserReference, UserReplyActivity } from '@/domain/forum/models';
import { formatDateTime, sourceLabel } from '@/domain/forum/presentation';
import type { TopicListItemStateSource } from '@/domain/forum/topicListItemState';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { DisclosureChevron } from '@/ui/controls/ExpandableControls';
import { AuthNoticeBox, EmptyText } from '@/ui/controls/FeedbackStates';
import { ContentLoadingPlaceholder, SkeletonBlock } from '@/ui/controls/ContentLoadingPlaceholder';
import { TOUCH_HIT_SLOP } from '@/ui/controls/touchTarget';
import { ScreenTopBar, ScreenTopBarActions, ScreenTopBarTitle } from '@/ui/controls/ScreenTopBar';
import { NavigationBackdropProvider, NavigationBackdropTarget } from '@/ui/navigation/NavigationGlass';
import { Avatar } from '@/ui/avatar/Avatar';
import { TopicListCard, TopicListPlaceholder } from '@/ui/topic/TopicCard';
import { authNoticeForSourceError } from '@/domain/session/siteSessionPrompts';
import {
  createUserListItems,
  userListItemKey,
  type UserActivityTab,
  type UserListItem,
  type UserProfileView
} from './userScreenItems';

// The profile is child 0. Keep the activity rail itself mounted and translated
// by the native scroll animation, without handing off to a JS-selected copy.
const USER_STICKY_HEADER_INDICES = [1];
const USER_ACTIVITY_LIST_WINDOW = Platform.select({
  android: { windowSize: 7, initialNumToRender: 8, maxToRenderPerBatch: 8 }
});
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
  themeColor,
  onToggle
}: {
  bio: string;
  expanded: boolean;
  styles: UserStyles;
  themeColor: string;
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
          hitSlop={TOUCH_HIT_SLOP}
          style={styles.bioToggle}
          onPress={onToggle}
        >
          <Text style={styles.bioToggleText}>{expanded ? '收起' : '展开'}</Text>
          <DisclosureChevron expanded={expanded} color={themeColor} size={14} />
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
    author: '',
    categoryId: reply.categoryId,
    category: reply.category,
    url: reply.topicUrl || reply.url,
    createdAt: ''
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
  const meta = [reply.category, reply.author, reply.floor ? `#${reply.floor}` : '', timeText]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.topicRowShell, styles.topicRowSurface]}>
      <Pressable accessibilityRole="button" style={styles.topicCardPressable} onPress={openTopicPress}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {reply.topicTitle || '查看原帖'}
        </Text>
        {reply.excerpt ? (
          <Text style={styles.excerpt} numberOfLines={2}>
            {reply.excerpt}
          </Text>
        ) : null}
        {meta ? (
          <Text style={styles.replyMeta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export const UserScreen = memo(function UserScreen({
  active = true,
  initialTab = 'topics',
  busy,
  error,
  topicsError,
  repliesError,
  topicsBusy = false,
  repliesBusy = false,
  onRetryTopics,
  onRetryReplies,
  onRetryProfile,
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
  onPrivateMessage,
  onRefresh,
  onToggleFollow
}: {
  active?: boolean;
  initialTab?: UserActivityTab;
  busy: boolean;
  error: SourceErrorInfo | null;
  topicsError?: SourceErrorInfo | null;
  repliesError?: SourceErrorInfo | null;
  topicsBusy?: boolean;
  repliesBusy?: boolean;
  onRetryTopics?: () => void;
  onRetryReplies?: () => void;
  onRetryProfile?: () => void;
  followed: boolean;
  profile: UserProfileView | null;
  requestedUser: UserReference | null;
  topicStateIndex: TopicListItemStateSource;
  loadingMoreReplies: boolean;
  loadingMoreTopics: boolean;
  onBack: () => void;
  onLoadMoreReplies: () => void;
  onLoadMoreTopics: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onPrivateMessage?: () => void;
  onRefresh: () => void;
  onToggleFollow: (user: UserProfileView) => void;
}) {
  const onPageLayout = useStartupPageLayout();
  const { styles, theme, settings } = useReaderThemeStyles(createUserStyles);
  const { fontScale } = useWindowDimensions();
  const user = profile || requestedUser;
  const topics = profile?.topics || EMPTY_TOPICS;
  const replies = profile?.replies || EMPTY_REPLIES;
  const [userTab, setUserTab] = useState<UserActivityTab>(initialTab);
  const activityError = userTab === 'topics' ? topicsError : repliesError;
  const activityBusy = userTab === 'topics' ? topicsBusy : repliesBusy;
  const activityData = userTab === 'topics' ? profile?.topics : profile?.replies;
  const activityHasMore = userTab === 'topics' ? profile?.hasMoreTopics : profile?.hasMoreReplies;
  const loadingMoreActivity = userTab === 'topics' ? loadingMoreTopics : loadingMoreReplies;
  const retryActivity = userTab === 'topics' ? onRetryTopics : onRetryReplies;
  const [bioExpanded, setBioExpanded] = useState(false);
  const [topBarHeight, setTopBarHeight] = useState(56);
  const routeUser = requestedUser || profile;
  const userIdentity = routeUser ? `${routeUser.source}:${routeUser.id || routeUser.username}` : '';
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
  const listRef = useRef<FlatList<UserListItem> | null>(null);
  const [listInteraction] = useState(createUserListInteraction);
  const userAuthNotice = useMemo(() => (error ? authNoticeForSourceError(error) : null), [error]);
  useEffect(() => {
    setBioExpanded(false);
  }, [userIdentity]);
  useEffect(() => {
    listInteraction.disarm();
    setUserTab(initialTab);
  }, [initialTab, userIdentity, listInteraction]);
  const scrollListToTop = useCallback(() => {
    if (!listRef.current) {
      listInteraction.requestReset();
      return;
    }
    listRef.current.scrollToOffset({ offset: 0, animated: false });
    listInteraction.resetCompleted();
  }, [listInteraction]);
  const completePendingScrollReset = useCallback(() => {
    if (listInteraction.needsReset) {
      scrollListToTop();
    }
  }, [scrollListToTop, listInteraction]);
  useEffect(() => {
    listInteraction.requestReset();
    const frame = requestAnimationFrame(completePendingScrollReset);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [completePendingScrollReset, userIdentity, userTab, listInteraction]);
  const armAutoLoad = useCallback(() => {
    listInteraction.dragged();
  }, [listInteraction]);
  const changeUserTab = useCallback(
    (value: string) => {
      const nextTab: UserActivityTab = value === 'replies' ? 'replies' : 'topics';
      if (nextTab === userTab) {
        return;
      }
      listInteraction.requestReset();
      setUserTab(nextTab);
    },
    [userTab, listInteraction]
  );
  const handleEndReached = useCallback(() => {
    if (!activityHasMore || activityError || activityBusy || busy || loadingMoreActivity) {
      return;
    }
    if (!listInteraction.consumePage()) return;
    if (userTab === 'replies') {
      onLoadMoreReplies();
    } else {
      onLoadMoreTopics();
    }
  }, [
    activityBusy,
    activityError,
    activityHasMore,
    busy,
    loadingMoreActivity,
    onLoadMoreReplies,
    onLoadMoreTopics,
    userTab,
    listInteraction
  ]);
  const requestUserTopicLoadMore = useCallback(() => {
    listInteraction.disarm();
    if (userTab === 'replies') {
      onLoadMoreReplies();
    } else {
      onLoadMoreTopics();
    }
  }, [onLoadMoreReplies, onLoadMoreTopics, userTab, listInteraction]);
  const profileHeader = useMemo(() => {
    const isNodeSeek = user?.source === 'nodeseek';
    const actionMinWidth = Math.round((isNodeSeek ? 72 : 88) * settings.uiFontScale * fontScale);
    const actions = profile ? (
      <View style={styles.profileActions}>
        {onPrivateMessage ? (
          <View style={[styles.followTouchSlot, isNodeSeek && { minWidth: actionMinWidth }]}>
            <AppButton minWidth={isNodeSeek ? actionMinWidth : 48} label="私信" onPress={onPrivateMessage} />
          </View>
        ) : null}
        <View style={[styles.followTouchSlot, { minWidth: actionMinWidth }]}>
          <AppButton
            minWidth={actionMinWidth}
            label={followed ? '已关注' : '关注'}
            accessibilityHint={followed ? '再次点击取消本机关注' : '在本机关注这个用户'}
            selected={followed}
            variant={followed ? 'default' : 'solid'}
            onPress={() => onToggleFollow(profile)}
          />
        </View>
      </View>
    ) : null;
    const stats = profileStats.length ? (
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
    ) : null;
    return (
      <View testID="user-profile-header" style={styles.userProfileHeader}>
        <View style={styles.profileIdentityRow}>
          <View style={styles.topicAuthorRow}>
            <Avatar contentSource={user?.source || null} name={displayName} uri={user?.avatar} />
            <View style={styles.topicAuthorMeta}>
              <Text style={styles.articleTitle}>{displayName}</Text>
              <Text style={styles.meta}>{userSubtitle}</Text>
            </View>
          </View>
          {!isNodeSeek ? actions : null}
        </View>
        {profile?.bio ? (
          <UserBio
            key={userIdentity}
            bio={profile.bio}
            expanded={bioExpanded}
            styles={styles}
            themeColor={theme.dark ? theme.primary : theme.primaryStrong}
            onToggle={() => setBioExpanded((value) => !value)}
          />
        ) : null}
        {profileDetails ? <Text style={styles.meta}>{profileDetails}</Text> : null}
        {isNodeSeek ? (
          <View style={styles.profileFooter}>
            {stats}
            {actions}
          </View>
        ) : (
          stats
        )}
        {error ? (
          userAuthNotice ? (
            <AuthNoticeBox notice={userAuthNotice}>
              <AppButton compact label="重试" disabled={busy} onPress={onRetryProfile || onRefresh} />
            </AuthNoticeBox>
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error.message}</Text>
              <AppButton compact label="重试资料" disabled={busy} onPress={onRetryProfile || onRefresh} />
            </View>
          )
        ) : null}
        {busy && !profile && !error ? (
          <ContentLoadingPlaceholder label="加载中" animating={active}>
            <View style={[styles.profileStatRail, { minHeight: styles.profileStatValue.lineHeight }]}>
              {[28, 34].map((width) => (
                <View key={width} style={styles.profileStat}>
                  <SkeletonBlock style={{ width, height: styles.profileStatValue.fontSize }} />
                  <SkeletonBlock style={{ width: 24, height: styles.profileStatLabel.fontSize }} />
                </View>
              ))}
            </View>
          </ContentLoadingPlaceholder>
        ) : null}
      </View>
    );
  }, [
    active,
    bioExpanded,
    busy,
    displayName,
    error,
    followed,
    fontScale,
    onRefresh,
    onRetryProfile,
    onPrivateMessage,
    onToggleFollow,
    profile,
    profileDetails,
    profileStats,
    settings.uiFontScale,
    styles,
    theme,
    user,
    userAuthNotice,
    userIdentity,
    userSubtitle
  ]);

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
        <TopicListCard
          testID={index === 1 ? 'user-topic-first' : undefined}
          topicStateIndex={topicStateIndex}
          showSource={false}
          topic={item.topic}
          hideReplyCount={item.topic.source === 'nodeseek'}
          onOpenTopic={onOpenTopic}
        />
      );
    },
    [changeUserTab, onOpenTopic, styles, topicStateIndex, userTab]
  );

  if (!user) {
    return (
      <View style={styles.screen} onLayout={onPageLayout}>
        <EmptyText text="未选择用户" />
      </View>
    );
  }

  return (
    <NavigationBackdropProvider>
      <View style={styles.screen} onLayout={onPageLayout}>
        <ScreenTopBar onLayout={(event) => setTopBarHeight(event.nativeEvent.layout.height)}>
          <IconButton icon={ChevronLeft} iconSize={24} iconOnly ghost label="返回" onPress={onBack} />
          <ScreenTopBarTitle>
            {sourceLabel(user.source)} · {user.displayName || user.username || user.id}
          </ScreenTopBarTitle>
          <ScreenTopBarActions>
            <View style={styles.toolbarAction}>
              <IconButton
                iconOnly
                ghost
                icon={RefreshCw}
                iconSize={20}
                label="刷新"
                disabled={busy}
                loading={busy && Boolean(profile)}
                onPress={onRefresh}
              />
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
        <NavigationBackdropTarget active testID="user-glass-content" topInset={topBarHeight}>
          <FlatList
            {...USER_ACTIVITY_LIST_WINDOW}
            overScrollMode="never"
            testID={profile ? 'user-screen-loaded' : undefined}
            key={userIdentity}
            ref={listRef}
            style={styles.content}
            contentContainerStyle={styles.userContentInner}
            data={listItems}
            keyExtractor={userListItemKey}
            ListHeaderComponent={profileHeader}
            stickyHeaderIndices={profile ? USER_STICKY_HEADER_INDICES : undefined}
            // Keep native clipping disabled before the async profile adds its sticky rail.
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              <>
                {profile && activityError && !loadingMoreActivity ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{activityError.message}</Text>
                    {retryActivity ? (
                      <AppButton
                        label={userTab === 'topics' ? '重试主题' : '重试回复'}
                        disabled={activityBusy}
                        loading={activityBusy}
                        onPress={retryActivity}
                      />
                    ) : null}
                  </View>
                ) : profile && activityBusy && !activityData ? (
                  userTab === 'topics' ? (
                    <TopicListPlaceholder label="正在读取主题" animating={active} />
                  ) : (
                    <ContentLoadingPlaceholder label="正在读取回复" animating={active} style={styles.topicRowSurface}>
                      {(['89%', '66%'] as const).map((width) => (
                        <View key={width} style={[styles.topicRowShell, styles.topicCardPressable]}>
                          <SkeletonBlock style={{ width, height: styles.cardTitle.fontSize }} />
                          <SkeletonBlock style={{ width: '96%', height: styles.excerpt.fontSize }} />
                          <SkeletonBlock style={{ width: '29%', height: styles.replyMeta.fontSize }} />
                        </View>
                      ))}
                    </ContentLoadingPlaceholder>
                  )
                ) : profile && activityData && !activityData.length && !activityHasMore ? (
                  <View style={styles.emptyActivity}>
                    <EmptyText text={userTab === 'replies' ? '暂无回复' : '暂无主题'} />
                  </View>
                ) : null}
                {activityHasMore && (!activityError || loadingMoreActivity || !retryActivity) ? (
                  <View style={styles.actions}>
                    <AppButton
                      compact
                      variant="ghost"
                      loading={loadingMoreActivity}
                      label={loadingMoreActivity ? '加载中' : userTab === 'replies' ? '加载更多回复' : '加载更多主题'}
                      disabled={busy || activityBusy || loadingMoreActivity}
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
        </NavigationBackdropTarget>
      </View>
    </NavigationBackdropProvider>
  );
});
