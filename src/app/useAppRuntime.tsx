import { useMemo } from 'react';
import { useReaderRuntime } from './useReaderRuntime';
import { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import type { LibraryRouteRuntimeValue } from '@/features/library/LibraryRouteRuntime';
import type { MoreRouteRuntimeValue } from '@/features/more/MoreRouteRuntime';
import type { SearchRouteRuntimeValue } from '@/features/search/SearchRouteRuntime';
import type { TopicRouteRuntimeValue } from '@/features/topic/TopicRouteRuntime';
import type { TopicComposerRouteRuntimeValue } from '@/features/topic-composer/TopicComposerRouteRuntime';
import type { UserRouteRuntimeValue } from '@/features/user/UserRouteRuntime';
import { nodeSeekUserIdForSession } from '@/domain/session/siteSessionState';
import { useAppTheme } from './useAppTheme';
import { useForumCatalogRuntime } from './useForumCatalogRuntime';
import { useAppBackHandler } from './useAppBackHandler';
import { useAppDiagnosticsRuntime } from './useAppDiagnosticsRuntime';
import { useAppLifecycleRuntime } from './useAppLifecycleRuntime';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import type { NotificationRouteRuntimeValue } from '@/features/notifications/NotificationRouteRuntime';
import { moreBadgeState as notificationMoreBadgeState } from '@/ui/navigation/moreBadge';
import { navigateAppScreen, openNodeSeekCreditsRoute, openNotificationsRoute } from './appNavigation';
import { canonicalEnabledSourcesKey, projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { useContentSourceQueryCleanup } from './useContentSourceQueryCleanup';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { useDiscourseVisited } from '@/platform/query/useDiscourseVisited';
import { withLinuxDoPresence } from '@/sources/linuxdo/presence';

export function useAppRuntime() {
  const lifecycle = useAppLifecycleRuntime();
  const {
    appActive,
    changeScreen,
    getCurrentScreen,
    height,
    feedContentReady,
    initialForegroundReady,
    notify,
    onCatalogSettled,
    onFeedInitialContentReady,
    onReady: handleNavigationReady,
    onScreenChange: handleNavigationScreenChange,
    openUserRoute,
    screen,
    width
  } = lifecycle;
  const { commitReaderData, readerData, readerDataLoaded, readerStatus, readerDataRef, importBackup, exportBackup } =
    useReaderRuntime({ notify });

  const { favorites, history, followedUsers, settings } = readerData;
  const readerView = useMemo(
    () => ({ favorites, history, followedUsers, settings }),
    [favorites, history, followedUsers, settings]
  );
  const { fontScale, listDensity } = readerData.settings;
  const { appStyles, contentWidth, navigationTheme, readerStyleContext, theme } = useAppTheme(
    readerData.settings,
    width
  );
  const baseFetcher = useMemo(() => withLinuxDoPresence(fetch), []);
  const networkRuntime = useNetworkProxyRuntime({ notify, baseFetcher });
  const {
    ensureNetworkProxyReady,
    networkProxyFetcher,
    proxyState: networkProxyState,
    webViewBlockMessage: networkProxyWebViewBlockMessage
  } = networkRuntime;
  const settingsTrusted = readerStatus === 'ready';
  const contentSourceProjection = useMemo(
    () => projectContentSourcePreferences(readerData.settings.contentSources, settingsTrusted),
    [readerData.settings.contentSources, settingsTrusted]
  );
  const {
    enabledSources,
    notificationSources: enabledNotificationSources,
    sessionSources: enabledSessionSources
  } = contentSourceProjection;
  const enabledFeedSources = enabledSources;
  const enabledSourcesKey = settingsTrusted ? canonicalEnabledSourcesKey(readerData.settings.contentSources) : '';
  useContentSourceQueryCleanup(enabledSources, enabledSourcesKey);

  const accountRuntime = useAccountRuntime({
    appActive,
    enabledSources,
    fetcher: networkProxyFetcher,
    loginNavigation: lifecycle.loginNavigation,
    notify,
    nodeSeekRecoveryThreshold: readerData.settings.nodeSeekRecoveryThreshold,
    openUser: openUserRoute,
    ready: readerDataLoaded,
    screen,
    webViewBlockMessage: networkProxyWebViewBlockMessage
  });
  const updateRuntime = useAppUpdateRuntime({
    autoCheck: initialForegroundReady,
    beforeRequest: ensureNetworkProxyReady,
    fetcher: networkProxyFetcher,
    notify
  });
  const readingState = useDiscourseVisited(accountRuntime.read.readGateway.reading?.scope());
  const topicStateIndex = useMemo(
    () => createTopicListItemStateIndex({ favorites, history, settings: { listDensity }, reading: readingState }),
    [favorites, history, listDensity, readingState]
  );
  const {
    accountSessionViewModels,
    forumSessionEpochs,
    getLinuxDoUserAgent,
    getNodeSeekUserAgent,
    notificationPrivateAccessAllowed,
    readGateway,
    reconcileAccountStatus,
    sessionsReady,
    statusBusy
  } = accountRuntime.read;
  const {
    ensureNodeImageApiKey,
    ensureWritableSession,
    isWritableSessionTicketCurrent,
    onSessionExpired,
    requestAccountRecheck
  } = accountRuntime.write;
  const {
    closeTopmostSurface: closeTopmostAccountSurface,
    linuxDoVerificationVisible: showLinuxDoPanel,
    requestNodeSeekVerification,
    showLinuxDoVerification,
    showYaohuoLogin
  } = accountRuntime.hosts;
  const nodeSeekMediaUserAgent = getNodeSeekUserAgent();
  const effectiveNodeSeekUserId = nodeSeekUserIdForSession(accountSessionViewModels.nodeseek);
  const notificationsRuntime = useNotificationsRuntime({
    appActive,
    contentSourcesReady: settingsTrusted,
    enabledNotificationSources,
    fetcher: networkProxyFetcher,
    getLinuxDoUserAgent,
    getNodeSeekUserAgent,
    onSessionExpired,
    openSource: openNotificationsRoute,
    privateAccessAllowed: notificationPrivateAccessAllowed,
    remoteReady: initialForegroundReady && sessionsReady,
    sessionEpochs: forumSessionEpochs,
    sessions: accountSessionViewModels
  });
  const notificationRouteRuntime = useMemo<NotificationRouteRuntimeValue>(
    () => ({
      ...notificationsRuntime,
      composer: {
        ensureNodeImageApiKey,
        ensureWritableSession,
        getDiscourseEmojiUrls: readGateway.getEmojiUrls,
        isWritableSessionTicketCurrent
      },
      contentWidth,
      notify,
      reconcileAccountStatus,
      openAccountSurface: async (source, message, recovery) => {
        if (source === 'linuxdo') await showLinuxDoVerification(message, recovery);
        else if (source === 'nodeseek') requestNodeSeekVerification(message, recovery);
        else showYaohuoLogin(message);
      }
    }),
    [
      contentWidth,
      ensureNodeImageApiKey,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      notificationsRuntime,
      notify,
      readGateway.getEmojiUrls,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      showLinuxDoVerification,
      showYaohuoLogin
    ]
  );
  const { onNavigationReady: handleNotificationNavigationReady } = notificationsRuntime;
  const onNavigationReady = useMemo(
    () => () => {
      handleNotificationNavigationReady();
      handleNavigationReady();
    },
    [handleNavigationReady, handleNotificationNavigationReady]
  );

  const { categories: catalogCategories } = useForumCatalogRuntime({
    active: settingsTrusted && sessionsReady && (screen === 'feed' || screen === 'search') && !showLinuxDoPanel,
    deferSecondary: screen === 'feed' && !feedContentReady,
    enabledFeedSources,
    onSettled: readerDataLoaded && sessionsReady ? onCatalogSettled : undefined,
    readGateway,
    sessionEpochs: forumSessionEpochs
  });
  const { appUpdateBusy, appUpdateDownloading, appUpdateInfo } = updateRuntime;
  const { metadata: diagnosticMetadata } = useAppDiagnosticsRuntime({
    accountSessionViewModels,
    appUpdateBusy,
    appUpdateDownloading,
    dimensions: { height, width },
    fontScale,
    proxyEnabled: networkProxyState.enabled,
    screen,
    statusBusy,
    themeDark: theme.dark
  });

  useAppBackHandler({ changeScreen, closeTopmostAccountSurface, getCurrentScreen });

  const topicRouteRuntime = useMemo<TopicRouteRuntimeValue>(
    () => ({
      enabledSources,
      account: {
        sessionEpochs: forumSessionEpochs,
        sessionViewModels: accountSessionViewModels,
        ensureNodeImageApiKey,
        ensureWritableSession,
        isWritableSessionTicketCurrent,
        getLinuxDoUserAgent,
        linuxDoVerificationVisible: showLinuxDoPanel,
        getNodeSeekUserAgent,
        nodeSeekUserId: effectiveNodeSeekUserId,
        onSessionExpired,
        requestAccountRecheck,
        readGateway,
        reconcileAccountStatus,
        requestNodeSeekVerification,
        showLinuxDoVerification,
        showYaohuoLogin
      },
      appActive,
      contentWidth,
      ensureNetworkProxyReady,
      fetcher: networkProxyFetcher,
      networkProxyWebViewBlockMessage,
      nodeSeekMediaUserAgent,
      notify,
      reader: {
        commit: commitReaderData,
        data: readerView,
        dataRef: readerDataRef
      },
      readerStyle: readerStyleContext
    }),
    [
      enabledSources,
      accountSessionViewModels,
      appActive,
      commitReaderData,
      contentWidth,
      effectiveNodeSeekUserId,
      ensureNetworkProxyReady,
      ensureNodeImageApiKey,
      ensureWritableSession,
      forumSessionEpochs,
      isWritableSessionTicketCurrent,
      getLinuxDoUserAgent,
      showLinuxDoPanel,
      networkProxyFetcher,
      networkProxyWebViewBlockMessage,
      nodeSeekMediaUserAgent,
      getNodeSeekUserAgent,
      notify,
      onSessionExpired,
      readGateway,
      requestAccountRecheck,
      readerView,
      readerDataRef,
      readerStyleContext,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      showLinuxDoVerification,
      showYaohuoLogin
    ]
  );

  const topicComposerRouteRuntime = useMemo<TopicComposerRouteRuntimeValue>(
    () => ({
      enabledSources,
      sessions: accountSessionViewModels,
      sessionEpochs: forumSessionEpochs,
      appActive,
      fetcher: networkProxyFetcher,
      ensureNetworkProxyReady,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      ensureNodeImageApiKey,
      getUserAgent: (source) => (source === 'nodeseek' ? getNodeSeekUserAgent() : getLinuxDoUserAgent()),
      getEmojiUrls: readGateway.getEmojiUrls,
      getLinuxDoTopicCreationContext: readGateway.getLinuxDoTopicCreationContext,
      getTopicEditContext: readGateway.getTopicEditContext,
      getTopic: readGateway.getTopic,
      openAccount: (source, message, recovery) => {
        if (source === 'linuxdo') return showLinuxDoVerification(message, recovery);
        else if (source === 'nodeseek') requestNodeSeekVerification(message || '请登录 NodeSeek');
        else showYaohuoLogin(message);
      },
      notify
    }),
    [
      enabledSources,
      accountSessionViewModels,
      forumSessionEpochs,
      appActive,
      networkProxyFetcher,
      ensureNetworkProxyReady,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      ensureNodeImageApiKey,
      getNodeSeekUserAgent,
      getLinuxDoUserAgent,
      readGateway.getEmojiUrls,
      readGateway.getLinuxDoTopicCreationContext,
      readGateway.getTopicEditContext,
      readGateway.getTopic,
      showLinuxDoVerification,
      requestNodeSeekVerification,
      showYaohuoLogin,
      notify
    ]
  );

  const userRouteRuntime = useMemo<UserRouteRuntimeValue>(
    () => ({
      enabledSources,
      account: {
        linuxDoVerificationVisible: showLinuxDoPanel,
        readGateway,
        reconcileAccountStatus,
        requestNodeSeekVerification,
        sessionEpochs: forumSessionEpochs,
        showLinuxDoVerification,
        showYaohuoLogin
      },
      appActive,
      nodeSeekMessaging: {
        identityKey: notificationsRuntime.identityKeys.nodeseek,
        available: notificationsRuntime.activeSources.includes('nodeseek')
      },
      notify,
      reader: {
        commit: commitReaderData,
        data: readerView,
        dataRef: readerDataRef
      },
      topicStateIndex
    }),
    [
      enabledSources,
      appActive,
      commitReaderData,
      forumSessionEpochs,
      notificationsRuntime.identityKeys.nodeseek,
      notificationsRuntime.activeSources,
      notify,
      readGateway,
      readerView,
      readerDataRef,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      showLinuxDoPanel,
      showLinuxDoVerification,
      showYaohuoLogin,
      topicStateIndex
    ]
  );

  const feedRouteRuntime = useMemo<FeedRouteRuntimeValue>(
    () => ({
      enabledSources,
      enabledSourcesKey,
      account: {
        linuxDoVerificationVisible: showLinuxDoPanel,
        readGateway,
        requestNodeSeekVerification,
        sessionEpochs: forumSessionEpochs,
        showLinuxDoVerification,
        showYaohuoLogin
      },
      appActive,
      catalogCategories,
      notify,
      reader: {
        data: readerView,
        loaded: readerDataLoaded
      },
      onInitialContentReady: onFeedInitialContentReady,
      topicStateIndex
    }),
    [
      enabledSources,
      enabledSourcesKey,
      appActive,
      catalogCategories,
      forumSessionEpochs,
      onFeedInitialContentReady,
      notify,
      readGateway,
      readerView,
      readerDataLoaded,
      requestNodeSeekVerification,
      showLinuxDoPanel,
      showLinuxDoVerification,
      showYaohuoLogin,
      topicStateIndex
    ]
  );

  const searchRouteRuntime = useMemo<SearchRouteRuntimeValue>(
    () => ({
      enabledSources,
      account: {
        linuxDoVerificationVisible: showLinuxDoPanel,
        readGateway,
        reconcileAccountStatus,
        requestNodeSeekVerification,
        sessionEpochs: forumSessionEpochs,
        sessionViewModels: accountSessionViewModels,
        showLinuxDoVerification,
        showYaohuoLogin
      },
      catalogCategories,
      notify,
      readerData: readerView,
      topicStateIndex
    }),
    [
      enabledSources,
      accountSessionViewModels,
      catalogCategories,
      forumSessionEpochs,
      notify,
      readGateway,
      readerView,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      showLinuxDoPanel,
      showLinuxDoVerification,
      showYaohuoLogin,
      topicStateIndex
    ]
  );

  const libraryRouteRuntime = useMemo<LibraryRouteRuntimeValue>(
    () => ({
      readingGateway: readGateway,
      enabledSources,
      notify,
      reader: {
        commit: commitReaderData,
        data: readerData,
        dataRef: readerDataRef,
        loaded: readerDataLoaded
      },
      topicStateIndex
    }),
    [
      readGateway,
      commitReaderData,
      enabledSources,
      notify,
      readerData,
      readerDataLoaded,
      readerDataRef,
      topicStateIndex
    ]
  );

  const moreRouteRuntime = useMemo<MoreRouteRuntimeValue>(
    () => ({
      account: {
        active: appActive,
        enabledSessionSources,
        read: {
          gateway: readGateway,
          sessionEpochs: forumSessionEpochs,
          sessions: accountRuntime.read.accountSessionViewModels,
          statusBusy: accountRuntime.read.statusBusy
        },
        center: {
          openCredits: (currency) => {
            const user = accountRuntime.read.accountSessionViewModels.nodeseek.currentUser;
            if (user && accountRuntime.read.accountSessionViewModels.nodeseek.canWrite) {
              openNodeSeekCreditsRoute({ identityKey: `nodeseek:${user.id}`, userId: user.id, currency });
            }
          },
          command: accountRuntime.center.handleAccountCenterCommand,
          credentials: {
            summaries: accountRuntime.center.credentials.credentialSummaries,
            pendingFillSite: accountRuntime.center.credentials.pendingCredentialFillSite
          },
          linuxDoLevel: {
            busy: accountRuntime.center.account.linuxDoLevelBusy,
            error: accountRuntime.center.account.linuxDoLevelError,
            profile: accountRuntime.center.account.linuxDoLevelProfile,
            refresh: accountRuntime.center.account.refreshLinuxDoLevel
          },
          nodeImageKey: {
            authorize: accountRuntime.center.nodeImage.key.authorize,
            busy: accountRuntime.center.nodeImage.key.busy,
            clear: accountRuntime.center.nodeImage.key.clear,
            save: accountRuntime.center.nodeImage.key.save,
            saved: accountRuntime.center.nodeImage.key.saved
          },
          nodeSeek: accountRuntime.center.nodeSeek
        },
        surfaces: {
          closeAll: accountRuntime.hosts.closePanels,
          linuxdo: accountRuntime.hosts.surfaces.linuxdo,
          nodeseek: accountRuntime.hosts.surfaces.nodeseek,
          yaohuo: accountRuntime.hosts.surfaces.yaohuo
        }
      },
      diagnostics: {
        getCurrentScreen,
        metadata: diagnosticMetadata
      },
      notify,
      library: {
        open: () => {
          navigateAppScreen('library');
        }
      },
      proxy: {
        activeProfile: networkRuntime.activeProfile,
        applyError: networkRuntime.applyError,
        applyStatus: networkRuntime.applyStatus,
        proxyState: networkRuntime.proxyState,
        summary: networkRuntime.summary,
        deleteProxyProfile: networkRuntime.deleteProxyProfile,
        selectProxyProfile: networkRuntime.selectProxyProfile,
        setProxyEnabled: networkRuntime.setProxyEnabled,
        testProxyProfile: networkRuntime.testProxyProfile,
        upsertProxyProfile: networkRuntime.upsertProxyProfile
      },
      reader: {
        commit: commitReaderData,
        data: readerData,
        dataRef: readerDataRef,
        status: readerStatus,
        importBackup,
        exportBackup
      },
      update: updateRuntime
    }),
    [
      accountRuntime.center,
      accountRuntime.hosts.closePanels,
      accountRuntime.hosts.surfaces.linuxdo,
      accountRuntime.hosts.surfaces.nodeseek,
      accountRuntime.hosts.surfaces.yaohuo,
      accountRuntime.read.accountSessionViewModels,
      accountRuntime.read.statusBusy,
      appActive,
      forumSessionEpochs,
      readGateway,
      commitReaderData,
      diagnosticMetadata,
      enabledSessionSources,
      getCurrentScreen,
      networkRuntime.activeProfile,
      networkRuntime.applyError,
      networkRuntime.applyStatus,
      networkRuntime.deleteProxyProfile,
      networkRuntime.proxyState,
      networkRuntime.selectProxyProfile,
      networkRuntime.setProxyEnabled,
      networkRuntime.summary,
      networkRuntime.testProxyProfile,
      networkRuntime.upsertProxyProfile,
      notify,
      readerData,
      readerDataRef,
      importBackup,
      readerStatus,
      updateRuntime,
      exportBackup
    ]
  );
  return {
    accountHost: accountRuntime.hosts.element,
    onUserInteraction: lifecycle.onUserInteraction,
    appStyles,
    mediaTransportIdentity: networkRuntime.applyStatus,
    readerStyleContext,
    routes:
      readerDataLoaded && sessionsReady
        ? {
            topicComposerRouteRuntime,
            feedRouteRuntime,
            libraryRouteRuntime,
            moreBadgeState: notificationMoreBadgeState(
              Boolean(appUpdateInfo || updateRuntime.artifact),
              notificationsRuntime.unreadTotal > 0
            ),
            moreRouteRuntime,
            navigationTheme,
            notificationRouteRuntime,
            onReady: onNavigationReady,
            onScreenChange: handleNavigationScreenChange,
            searchRouteRuntime,
            styles: appStyles,
            theme,
            topicRouteRuntime,
            userRouteRuntime
          }
        : null,
    sessionEpochs: forumSessionEpochs,
    theme
  };
}
