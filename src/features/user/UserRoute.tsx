import { useCallback } from 'react';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Topic } from '@/domain/forum/models';
import type { ReadRecovery } from '@/platform/query/readRecovery';

import { userKey } from '@/domain/reader/readerData';

import { openHttpUrl } from '@/ui/navigation/openHttpUrl';

import { ContentSourceDisabledState } from '@/ui/controls/FeedbackStates';
import { dispatchTopicRoute, goBackFromFocusedRoute } from '@/ui/navigation/appRouteActions';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { UserScreen } from './UserScreen';
import { useUserController } from './useUserController';
import { useUserRouteRuntime, type UserRouteRuntimeValue } from './UserRouteRuntime';

type UserRouteProps = NativeStackScreenProps<RootStackParamList, 'User'>;

export function UserRoute({ navigation, route }: UserRouteProps) {
  const runtime = useUserRouteRuntime();
  const user = route.params.user;
  const sourceEnabled = runtime.enabledSources.includes(user.source);
  if (!sourceEnabled) {
    return <ContentSourceDisabledState source={user.source} navigation={navigation} />;
  }
  return <EnabledUserRoute navigation={navigation} route={route} runtime={runtime} />;
}

function EnabledUserRoute({ navigation, route, runtime }: UserRouteProps & { runtime: UserRouteRuntimeValue }) {
  const active = useIsFocused();
  const requestNodeSeekVerification = runtime.account.requestNodeSeekVerification;
  const showNodeSeekVerification = useCallback(
    (message?: string, recovery?: ReadRecovery) =>
      requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证', recovery),
    [requestNodeSeekVerification]
  );
  const controller = useUserController({
    active,
    sessionEpochs: runtime.account.sessionEpochs,
    notify: runtime.notify,
    onRetryIdentityStatus: runtime.account.reconcileAccountStatus,
    readerData: runtime.reader.data,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway,
    user: route.params.user
  });
  const openExternalUrl = useCallback(
    (url: string) => {
      if (navigation.isFocused()) openHttpUrl(url, runtime.notify);
    },
    [navigation, runtime.notify]
  );
  const refreshUser = useCallback(() => {
    void controller.refreshUser();
  }, [controller]);
  const toggleUserFollow = useCallback(
    (user: import('./userScreenItems').UserProfileView) => {
      if (!navigation.isFocused()) return;
      runtime.reader.commit({
        type: 'follow',
        user,
        enabled: !runtime.reader.dataRef.current.followedUsers[userKey(user)],
        at: new Date().toISOString()
      });
    },
    [navigation, runtime.reader]
  );
  const openTopic = useCallback(
    (topic: Topic) => {
      if (navigation.isFocused()) dispatchTopicRoute(() => navigation.push('Topic', { topic }));
    },
    [navigation]
  );
  const profile = controller.userProfile;
  const recipientId = profile?.id || '';
  const canMessage =
    profile?.source === 'nodeseek' &&
    /^\d+$/.test(recipientId) &&
    Number.isSafeInteger(Number(recipientId)) &&
    Number(recipientId) > 0 &&
    runtime.nodeSeekMessaging.identityKey !== `nodeseek:${Number(recipientId)}`;
  const openPrivateMessage = useCallback(() => {
    if (!navigation.isFocused() || !canMessage || !profile) return;
    const { identityKey, available } = runtime.nodeSeekMessaging;
    if (!available || !identityKey) {
      runtime.account.requestNodeSeekVerification('登录 NodeSeek 后可发送私信');
      return;
    }
    const uid = String(Number(recipientId));
    const name = profile.displayName || profile.username || uid;
    navigation.push('NotificationDetail', {
      identityKey,
      notification: {
        source: 'nodeseek',
        id: `conversation:${uid}`,
        kind: 'private-message',
        actor: { id: uid, name, avatarUrl: profile.avatar },
        title: name,
        createdAt: null,
        unread: false,
        target: { type: 'private-conversation', conversationId: uid }
      }
    });
  }, [canMessage, navigation, profile, recipientId, runtime.account, runtime.nodeSeekMessaging]);

  return (
    <UserScreen
      active={active}
      initialTab={route.params.initialTab}
      busy={controller.userBusy}
      error={controller.userError || null}
      topicsError={controller.userTopicsError}
      repliesError={controller.userRepliesError}
      topicsBusy={controller.userTopicsBusy}
      repliesBusy={controller.userRepliesBusy}
      onRetryTopics={controller.retryUserTopics}
      onRetryReplies={controller.retryUserReplies}
      onRetryProfile={controller.retryUserProfile}
      followed={controller.currentUserFollowed}
      profile={controller.userProfile}
      requestedUser={controller.selectedUser}
      topicStateIndex={runtime.topicStateIndex}
      loadingMoreReplies={controller.userLoadingMoreReplies}
      loadingMoreTopics={controller.userLoadingMoreTopics}
      onBack={() => goBackFromFocusedRoute(navigation)}
      onLoadMoreReplies={controller.loadMoreUserReplies}
      onLoadMoreTopics={controller.loadMoreUserTopics}
      onOpenOriginal={openExternalUrl}
      onOpenTopic={openTopic}
      onPrivateMessage={canMessage ? openPrivateMessage : undefined}
      onRefresh={refreshUser}
      onToggleFollow={toggleUserFollow}
    />
  );
}
