import { useMemo } from 'react';
import { useReaderRuntime } from './useReaderRuntime';
import { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import type { LibraryRouteRuntimeValue } from '@/features/library/LibraryRoute';
import type { MoreRouteRuntimeValue } from '@/features/more/MoreRoute';
import type { SearchRouteRuntimeValue } from '@/features/search/SearchRoute';
import type { TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import type { UserRouteRuntimeValue } from '@/features/user/UserRoute';
import { nodeSeekUserIdForSession } from '@/domain/session/siteSessionState';
import { useAppTheme } from './useAppTheme';
import { useForumCatalogRuntime } from './useForumCatalogRuntime';
import { useAppBackHandler } from './useAppBackHandler';
import { useAppDiagnosticsRuntime } from './useAppDiagnosticsRuntime';
import { useAppLifecycleRuntime } from './useAppLifecycleRuntime';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import type { NotificationRouteRuntimeValue } from '@/features/notifications/NotificationRoute';
import { moreBadgeState as notificationMoreBadgeState } from '@/ui/navigation/moreBadge';
import { openNotificationsRoute, openXiaoyinsiAuthorization } from './appNavigation';
import { canonicalEnabledSourcesKey, projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { useContentSourceQueryCleanup } from './useContentSourceQueryCleanup';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';

export function useAppRuntime() {
  const lifecycle = useAppLifecycleRuntime();
  const {
    appActive,
    changeScreen,
    getCurrentScreen,
    height,
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
  const { commitReaderData, readerData, readerDataLoaded, readerDataRef, replaceReaderData, waitForReaderDataSave } =
    useReaderRuntime({ notify });

  const { favorites, history } = readerData;
  const { fontScale, listDensity } = readerData.settings;
  const topicStateIndex = useMemo(
    () => createTopicListItemStateIndex({ favorites, history, settings: { listDensity } }),
    [favorites, history, listDensity]
  );
  const { appStyles, contentWidth, navigationTheme, readerStyleContext, theme } = useAppTheme(
    readerData.settings,
    width
  );
  const networkRuntime = useNetworkProxyRuntime({ notify });
  const {
    ensureNetworkProxyReady,
    networkProxyFetcher,
    proxyState: networkProxyState,
    webViewBlockMessage: networkProxyWebViewBlockMessage
  } = networkRuntime;
  const contentSourceProjection = projectContentSourcePreferences(readerData.settings.contentSources, readerDataLoaded);
  const {
    enabledSources,
    feedSources: enabledFeedSources,
    notificationSources: enabledNotificationSources,
    sessionSources: enabledSessionSources
  } = contentSourceProjection;
  const enabledSourcesKey = readerDataLoaded ? canonicalEnabledSourcesKey(readerData.settings.contentSources) : '';
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
  const { ensureNodeImageApiKey, ensureWritableSession, isWritableSessionTicketCurrent, onSessionExpired } =
    accountRuntime.write;
  const { xiaoyinsiAuth: xiaoyinsiAuthController } = accountRuntime.center;
  const {
    closeTopmostSurface: closeTopmostAccountSurface,
    linuxDoVerificationVisible: showLinuxDoPanel,
    requestNodeSeekVerification,
    showLinuxDoVerification,
    showYaohuoLogin
  } = accountRuntime.hosts;
  const beginXiaoyinsiAuthorization = useMemo(
    () => () => openXiaoyinsiAuthorization(xiaoyinsiAuthController.beginAuthorization),
    [xiaoyinsiAuthController.beginAuthorization]
  );
  const nodeSeekMediaUserAgent = getNodeSeekUserAgent();
  const effectiveNodeSeekUserId = nodeSeekUserIdForSession(accountSessionViewModels.nodeseek);
  const notificationsRuntime = useNotificationsRuntime({
    appActive,
    authorizationRevision: xiaoyinsiAuthController.phase,
    beginXiaoyinsiAuthorization,
    contentSourcesReady: readerDataLoaded,
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
      notify
    }),
    [
      contentWidth,
      ensureNodeImageApiKey,
      ensureWritableSession,
      isWritableSessionTicketCurrent,
      notificationsRuntime,
      notify,
      readGateway.getEmojiUrls
    ]
  );
  const notificationSummary = `${notificationsRuntime.unreadTotal ? '有未读' : '暂无未读'} · ${
    notificationsRuntime.backgroundEnabled ? '后台通知已开启' : '后台通知未开启'
  }${notificationsRuntime.partialUnavailable ? ' · 部分站点暂不可用' : ''}`;
  const { onNavigationReady: handleNotificationNavigationReady } = notificationsRuntime;
  const onNavigationReady = useMemo(
    () => () => {
      handleNotificationNavigationReady();
      handleNavigationReady();
    },
    [handleNavigationReady, handleNotificationNavigationReady]
  );

  const { categories: catalogCategories } = useForumCatalogRuntime({
    active: readerDataLoaded && sessionsReady && (screen === 'feed' || screen === 'search') && !showLinuxDoPanel,
    enabledFeedSources,
    enabledSourcesKey,
    notify,
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
      account: {
        beginXiaoyinsiAuthorization,
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
        data: readerData,
        dataRef: readerDataRef
      },
      readerStyle: readerStyleContext
    }),
    [
      accountSessionViewModels,
      appActive,
      beginXiaoyinsiAuthorization,
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
      readerData,
      readerDataRef,
      readerStyleContext,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      showLinuxDoVerification,
      showYaohuoLogin
    ]
  );

  const userRouteRuntime = useMemo<UserRouteRuntimeValue>(
    () => ({
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
      notify,
      reader: {
        commit: commitReaderData,
        data: readerData
      },
      topicStateIndex
    }),
    [
      appActive,
      commitReaderData,
      forumSessionEpochs,
      notify,
      readGateway,
      readerData,
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
        data: readerData,
        loaded: readerDataLoaded
      },
      onInitialContentReady: onFeedInitialContentReady,
      topicStateIndex
    }),
    [
      appActive,
      catalogCategories,
      forumSessionEpochs,
      onFeedInitialContentReady,
      notify,
      readGateway,
      readerData,
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
      readerData,
      topicStateIndex
    }),
    [
      accountSessionViewModels,
      catalogCategories,
      forumSessionEpochs,
      notify,
      readGateway,
      readerData,
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
      categories: catalogCategories,
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
      catalogCategories,
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
        enabledSessionSources,
        read: {
          sessions: accountRuntime.read.accountSessionViewModels,
          statusBusy: accountRuntime.read.statusBusy
        },
        center: {
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
          nodeSeek: {
            checkIn: accountRuntime.center.checkIn
          },
          xiaoyinsiAuth: {
            begin: accountRuntime.center.xiaoyinsiAuth.beginAuthorization,
            cancel: accountRuntime.center.xiaoyinsiAuth.cancelAuthorization,
            message: accountRuntime.center.xiaoyinsiAuth.message,
            openBrowser: accountRuntime.center.xiaoyinsiAuth.openAuthorizationBrowser,
            pending: accountRuntime.center.xiaoyinsiAuth.pending,
            phase: accountRuntime.center.xiaoyinsiAuth.phase,
            revoke: accountRuntime.center.xiaoyinsiAuth.revokeAuthorization,
            secondsRemaining: accountRuntime.center.xiaoyinsiAuth.secondsRemaining
          },
          xiaoyinsiLevel: {
            busy: accountRuntime.center.xiaoyinsiLevel.levelBusy,
            error: accountRuntime.center.xiaoyinsiLevel.levelError,
            profile: accountRuntime.center.xiaoyinsiLevel.levelProfile,
            refresh: accountRuntime.center.xiaoyinsiLevel.refreshLevel
          }
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
      notifications: {
        hasUnread: notificationsRuntime.unreadTotal > 0,
        open: () => {
          openNotificationsRoute();
        },
        summary: notificationSummary
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
        replace: replaceReaderData,
        waitForSave: waitForReaderDataSave
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
      notificationSummary,
      notificationsRuntime.unreadTotal,
      notify,
      readerData,
      readerDataRef,
      replaceReaderData,
      updateRuntime,
      waitForReaderDataSave
    ]
  );
  return {
    accountHost: accountRuntime.hosts.element,
    appStyles,
    mediaTransportIdentity: networkRuntime.applyStatus,
    readerStyleContext,
    routes:
      readerDataLoaded && sessionsReady
        ? {
            feedRouteRuntime,
            libraryRouteRuntime,
            moreBadgeState: notificationMoreBadgeState(Boolean(appUpdateInfo), notificationsRuntime.unreadTotal > 0),
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
