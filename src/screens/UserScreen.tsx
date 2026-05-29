import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Text, View, type ListRenderItem } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ChevronLeft, ExternalLink, RefreshCw, Star } from 'lucide-react-native';
import type { Topic, UserProfile } from '../types';
import { formatDateTime, sourceLabel } from '../appUtils';
import { loadRemoteAvatarSvgText } from '../avatarImages';
import { imageSourceFromUrl } from '../htmlImages';
import { getTopicListItemState, type NormalizedTopicListStateInput } from '../topicListItemState';
import type { ReaderData } from '../readerData';
import { createStyles, type ReaderTheme } from '../theme';
import { AppButton, EmptyText, IconButton, LoadingState } from '../components/AppControls';
import { MemoizedTopicCard } from '../components/TopicCard';
import { TOPIC_LIST_PERFORMANCE_PROPS } from '../components/listPerformance';

type UserListItem =
  | { type: 'profile'; key: 'profile' }
  | { type: 'topic'; key: string; topic: Topic };

function initial(name?: string) {
  return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
}

function ProfileAvatar({
  name,
  styles,
  uri
}: {
  name?: string;
  styles: ReturnType<typeof createStyles>;
  uri?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [svgXml, setSvgXml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageFailed(false);
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
    <View style={[styles.replyAvatar, styles.topicAvatar]}>
      {svgXml ? (
        <SvgXml
          xml={svgXml}
          width="100%"
          height="100%"
        />
      ) : uri && !imageFailed ? (
        <Image
          source={imageSourceFromUrl(uri)}
          style={[styles.replyAvatarImage, styles.topicAvatar]}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <Text style={styles.replyAvatarText}>{initial(name)}</Text>
      )}
    </View>
  );
}

export function UserScreen({
  busy,
  error,
  followed,
  profile,
  readerData,
  requestedUser,
  styles,
  theme,
  topicListStateInput,
  loadingMoreTopics,
  onBack,
  onLoadMoreTopics,
  onOpenOriginal,
  onOpenTopic,
  onRefresh,
  onToggleFollow
}: {
  busy: boolean;
  error: string;
  followed: boolean;
  profile: UserProfile | null;
  readerData: ReaderData;
  requestedUser: UserProfile | null;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topicListStateInput: NormalizedTopicListStateInput;
  loadingMoreTopics: boolean;
  onBack: () => void;
  onLoadMoreTopics: () => void;
  onOpenOriginal: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onRefresh: () => void;
  onToggleFollow: (user: UserProfile) => void;
}) {
  const user = profile || requestedUser;
  const topics = profile?.topics || [];
  const listItems = useMemo<UserListItem[]>(() => [
    { type: 'profile', key: 'profile' },
    ...topics.map((topic) => ({ type: 'topic' as const, key: `${topic.source}:${topic.id}`, topic }))
  ], [topics]);
  const autoLoadArmedRef = useRef(false);
  const followTarget = profile || requestedUser;
  const armAutoLoad = useCallback(() => {
    autoLoadArmedRef.current = true;
  }, []);
  const handleEndReached = useCallback(() => {
    if (!profile?.hasMoreTopics || busy || loadingMoreTopics || !autoLoadArmedRef.current) {
      return;
    }
    autoLoadArmedRef.current = false;
    onLoadMoreTopics();
  }, [busy, loadingMoreTopics, onLoadMoreTopics, profile?.hasMoreTopics]);
  const renderItem = useCallback<ListRenderItem<UserListItem>>(({ item }) => {
    if (item.type === 'profile') {
      return (
        <View style={styles.article}>
          <View style={styles.topicAuthorRow}>
            <ProfileAvatar name={user?.displayName || user?.username} styles={styles} uri={user?.avatar} />
            <View style={styles.topicAuthorMeta}>
              <Text style={styles.articleTitle}>{user?.displayName || user?.username || '用户'}</Text>
              <Text style={styles.meta}>{user ? `${sourceLabel(user.source)} · ${user.username}` : '用户信息读取中'}</Text>
            </View>
          </View>
          {user?.bio ? <Text style={styles.excerpt}>{user.bio}</Text> : null}
          <View style={styles.actions}>
            {typeof profile?.topicCount === 'number' ? <Text style={styles.meta}>主题 {profile.topicCount}</Text> : null}
            {typeof profile?.replyCount === 'number' ? <Text style={styles.meta}>回复 {profile.replyCount}</Text> : null}
            {typeof profile?.postCount === 'number' ? <Text style={styles.meta}>发言 {profile.postCount}</Text> : null}
            {profile?.joinedAt ? <Text style={styles.meta}>加入 {formatDateTime(profile.joinedAt) || profile.joinedAt}</Text> : null}
          </View>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {busy ? <LoadingState text="正在读取用户主页..." styles={styles} theme={theme} /> : null}
          <View style={styles.actions}>
            {followTarget ? <AppButton label={followed ? '取消关注' : '关注'} styles={styles} onPress={() => onToggleFollow(followTarget)} /> : null}
            {user?.url ? <AppButton label="原站主页" variant="ghost" styles={styles} onPress={() => onOpenOriginal(user.url)} /> : null}
          </View>
          {profile && !topics.length && !busy ? <EmptyText text="这个用户暂时没有可显示的帖子或活动" styles={styles} /> : null}
        </View>
      );
    }
    return (
      <MemoizedTopicCard
        readerState={getTopicListItemState(readerData, item.topic, topicListStateInput)}
        styles={styles}
        theme={theme}
        topic={item.topic}
        hideReplyCount={item.topic.source === 'nodeseek'}
        onOpenTopic={onOpenTopic}
      />
    );
  }, [busy, error, followTarget, followed, onOpenOriginal, onOpenTopic, onToggleFollow, profile, readerData, styles, theme, topicListStateInput, topics.length, user]);

  if (!user) {
    return <EmptyText text="未选择用户" styles={styles} />;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.topicTopBar}>
        <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
        <Text style={styles.topicTopHint} numberOfLines={1}>{sourceLabel(user.source)} · {user.displayName || user.username}</Text>
        <View style={styles.topicTopActions}>
          {followTarget ? <IconButton iconOnly ghost icon={Star} label={followed ? '已关注' : '关注'} active={followed} styles={styles} theme={theme} onPress={() => onToggleFollow(followTarget)} /> : null}
          <IconButton iconOnly ghost icon={RefreshCw} label="刷新" styles={styles} theme={theme} onPress={onRefresh} />
          {user.url ? <IconButton iconOnly ghost icon={ExternalLink} label="原站" styles={styles} theme={theme} onPress={() => onOpenOriginal(user.url)} /> : null}
        </View>
      </View>
      <FlatList
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        data={listItems}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        {...TOPIC_LIST_PERFORMANCE_PROPS}
        ListFooterComponent={profile?.hasMoreTopics ? (
          <View style={styles.actions}>
            <AppButton label={loadingMoreTopics ? '正在加载...' : '加载更多帖子'} styles={styles} disabled={loadingMoreTopics} onPress={onLoadMoreTopics} />
          </View>
        ) : null}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        onScrollBeginDrag={armAutoLoad}
        onMomentumScrollBegin={armAutoLoad}
        renderItem={renderItem}
      />
    </View>
  );
}
