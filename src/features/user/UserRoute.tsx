import { createContext, type ReactNode, useCallback, useContext } from 'react';
import { Linking } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Topic } from '@/domain/forum/models';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { toggleFollowedUser, type ReaderData, type ReaderDataMutationReason } from '@/domain/reader/readerData';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { errorMessage } from '@/platform/network/errors';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { ContentSourceDisabledState } from '@/ui/controls/FeedbackStates';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { UserScreen } from './UserScreen';
import { useUserController } from './useUserController';

export type UserRouteRuntimeValue = {
  account: {
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery?: LinuxDoReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  appActive: boolean;
  notify: (message: string) => void;
  topicStateIndex: TopicListItemStateIndex;
  reader: {
    commit: (reason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
    data: ReaderData;
  };
};

const UserRouteRuntimeContext = createContext<UserRouteRuntimeValue | null>(null);

export function UserRouteRuntimeProvider({ children, value }: { children: ReactNode; value: UserRouteRuntimeValue }) {
  return <UserRouteRuntimeContext.Provider value={value}>{children}</UserRouteRuntimeContext.Provider>;
}

function useUserRouteRuntime() {
  const runtime = useContext(UserRouteRuntimeContext);
  if (!runtime) throw new Error('UserRouteRuntimeProvider is required');
  return runtime;
}

type UserRouteProps = NativeStackScreenProps<RootStackParamList, 'User'>;

export function UserRoute({ navigation, route }: UserRouteProps) {
  const runtime = useUserRouteRuntime();
  const user = route.params.user;
  const sourceEnabled = projectContentSourcePreferences(
    runtime.reader.data.settings.contentSources
  ).enabledSources.includes(user.source);
  if (!sourceEnabled) {
    return (
      <ContentSourceDisabledState
        source={user.source}
        onBack={navigation.goBack}
        onManage={() => navigation.dispatch(manageContentSourcesAction())}
      />
    );
  }
  return <EnabledUserRoute navigation={navigation} route={route} runtime={runtime} />;
}

function EnabledUserRoute({ navigation, route, runtime }: UserRouteProps & { runtime: UserRouteRuntimeValue }) {
  const active = useIsFocused();
  const controller = useUserController({
    active,
    sessionEpochs: runtime.account.sessionEpochs,
    notify: runtime.notify,
    onRetryIdentityStatus: runtime.account.reconcileAccountStatus,
    readerData: runtime.reader.data,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification: (message, recovery) =>
      runtime.account.requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证', recovery),
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway,
    user: route.params.user
  });
  const openExternalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        runtime.notify('仅支持打开 http/https 链接。');
        return;
      }
      void Linking.openURL(url).catch((error) => runtime.notify(errorMessage(error)));
    },
    [runtime]
  );
  const refreshUser = useCallback(() => {
    void controller.refreshUser();
  }, [controller]);
  const toggleUserFollow = useCallback(
    (user: Parameters<typeof toggleFollowedUser>[1]) => {
      runtime.reader.commit('follow-toggled', (current) => toggleFollowedUser(current, user));
    },
    [runtime.reader]
  );
  const openTopic = useCallback((topic: Topic) => navigation.push('Topic', { topic }), [navigation]);

  return (
    <UserScreen
      busy={controller.userBusy}
      error={controller.userError || null}
      followed={controller.currentUserFollowed}
      profile={controller.userProfile}
      requestedUser={controller.selectedUser}
      topicStateIndex={runtime.topicStateIndex}
      loadingMoreReplies={controller.userLoadingMoreReplies}
      loadingMoreTopics={controller.userLoadingMoreTopics}
      onBack={navigation.goBack}
      onLoadMoreReplies={controller.loadMoreUserReplies}
      onLoadMoreTopics={controller.loadMoreUserTopics}
      onOpenOriginal={openExternalUrl}
      onOpenTopic={openTopic}
      onRefresh={refreshUser}
      onToggleFollow={toggleUserFollow}
    />
  );
}
