import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { Linking } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SourceErrorInfo, Topic } from '@/domain/forum/models';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { toggleFollowedUser, type ReaderData, type ReaderDataMutationReason } from '@/domain/reader/readerData';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { errorMessage } from '@/platform/network/errors';
import type { ForumIdentityBarrierSource } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { useIdentityVerificationPrompt } from '@/ui/hooks/useIdentityVerificationPrompt';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { UserScreen } from './UserScreen';
import { useUserController } from './useUserController';

type IdentityCheck = {
  checking: boolean;
  pending: boolean;
  error?: SourceErrorInfo;
};

export type UserRouteRuntimeValue = {
  account: {
    identityBarriers: readonly ForumIdentityBarrierSource[];
    identityChecks: Record<SessionSource, IdentityCheck>;
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

export function UserRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'User'>) {
  const runtime = useUserRouteRuntime();
  const active = useIsFocused();
  const controller = useUserController({
    active,
    identityBarriers: runtime.account.identityBarriers,
    sessionEpochs: runtime.account.sessionEpochs,
    notify: runtime.notify,
    readerData: runtime.reader.data,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification: (message, recovery) =>
      runtime.account.requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证', recovery),
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway,
    user: route.params.user
  });
  const identityCheck =
    controller.selectedUser?.source === 'linuxdo' ? runtime.account.identityChecks.linuxdo : undefined;
  const identityError = identityCheck?.pending ? identityCheck.error : undefined;
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(runtime.reader.data), [runtime.reader.data]);
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
    if (identityError && controller.selectedUser?.source === 'linuxdo') {
      void runtime.account.reconcileAccountStatus('linuxdo');
      return;
    }
    void controller.refreshUser();
  }, [controller, identityError, runtime]);
  const toggleUserFollow = useCallback(
    (user: Parameters<typeof toggleFollowedUser>[1]) => {
      runtime.reader.commit('follow-toggled', (current) => toggleFollowedUser(current, user));
    },
    [runtime.reader]
  );
  const openTopic = useCallback((topic: Topic) => navigation.push('Topic', { topic }), [navigation]);

  useIdentityVerificationPrompt({
    enabled: active && runtime.appActive && !runtime.account.linuxDoVerificationVisible && !controller.userProfile,
    error: identityCheck?.error,
    identityPending: Boolean(identityCheck?.pending),
    intentKey:
      active && runtime.appActive && controller.selectedUser?.source === 'linuxdo'
        ? `user:${controller.selectedUser.id || controller.selectedUser.username || ''}`
        : null,
    showVerification: runtime.account.showLinuxDoVerification
  });

  return (
    <UserScreen
      busy={(controller.userBusy && !identityError) || Boolean(identityCheck?.checking)}
      error={identityError || controller.userError || null}
      followed={controller.currentUserFollowed}
      identityBlocked={Boolean(identityCheck?.pending)}
      identityChecking={Boolean(identityCheck?.checking)}
      profile={controller.userProfile}
      requestedUser={controller.selectedUser}
      topicStateIndex={topicStateIndex}
      loadingMoreReplies={controller.userLoadingMoreReplies}
      loadingMoreTopics={controller.userLoadingMoreTopics}
      onBack={navigation.goBack}
      onLoadMoreReplies={controller.loadMoreUserReplies}
      onLoadMoreTopics={controller.loadMoreUserTopics}
      onCheckLinuxDoStatus={() => {
        void runtime.account.showLinuxDoVerification();
      }}
      onOpenOriginal={openExternalUrl}
      onOpenTopic={openTopic}
      onRefresh={refreshUser}
      onToggleFollow={toggleUserFollow}
    />
  );
}
