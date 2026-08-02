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

export function useAppRuntime() {
  const lifecycle = useAppLifecycleRuntime();
  const {
    appActive,
    changeScreen,
    getCurrentScreen,
    height,
    notify,
    onReady: handleNavigationReady,
    onScreenChange: handleNavigationScreenChange,
    openUserRoute,
    screen,
    width
  } = lifecycle;
  const { commitReaderData, readerData, readerDataLoaded, readerDataRef, replaceReaderData, waitForReaderDataSave } =
    useReaderRuntime({ notify });

  const { fontScale } = readerData.settings;
  const { appStyles, contentWidth, navigationTheme, readerStyleContext, theme } = useAppTheme(
    readerData.settings,
    width
  );
  const networkRuntime = useNetworkProxyRuntime({ notify });
  const {
    contentReady: networkProxyContentReady,
    ensureNetworkProxyReady,
    networkProxyFetcher,
    proxyState: networkProxyState,
    webViewBlockMessage: networkProxyWebViewBlockMessage
  } = networkRuntime;

  const accountRuntime = useAccountRuntime({
    appActive,
    fetcher: networkProxyFetcher,
    notify,
    openUser: openUserRoute,
    ready: readerDataLoaded,
    screen,
    webViewBlockMessage: networkProxyWebViewBlockMessage
  });
  const updateRuntime = useAppUpdateRuntime({
    autoCheck: true,
    beforeRequest: ensureNetworkProxyReady,
    fetcher: networkProxyFetcher,
    notify
  });
  const {
    accountIdentityChecks,
    accountIdentityPending,
    accountSessionViewModels,
    forumSessionEpochs,
    identityBarriers: accountIdentityBarriers,
    identityReconciliationPending,
    readGateway,
    reconcileAccountStatus,
    retainableIdentityBarriers: retainableAccountIdentityBarriers,
    statusBusy,
    updateLinuxDoSession
  } = accountRuntime.read;
  const { ensureWritableSession, isWritableSessionTicketCurrent, reconcileWritableSession, resetLinuxDoLevelState } =
    accountRuntime.write;
  const {
    nodeImage: {
      key: { ensure: ensureNodeImageApiKey }
    },
    webLoginUserId,
    xiaoyinsiAuth: xiaoyinsiAuthController
  } = accountRuntime.center;
  const {
    closeTopmostSurface: closeTopmostAccountSurface,
    linuxDoWebViewUserAgentRef,
    nodeSeekWebViewUserAgent,
    nodeSeekWebViewUserAgentRef,
    requestNodeSeekVerification,
    showLinuxDoPanel,
    verification: { showLinuxDoVerification },
    showYaohuoLogin
  } = accountRuntime.hosts;
  const effectiveNodeSeekUserId = nodeSeekUserIdForSession(accountSessionViewModels.nodeseek, webLoginUserId);

  const { categories: catalogCategories } = useForumCatalogRuntime({
    active: (screen === 'feed' || screen === 'search') && !showLinuxDoPanel,
    identityBarriers: accountIdentityBarriers,
    identityReconciliationPending,
    notify,
    readGateway,
    retainableIdentityBarriers: retainableAccountIdentityBarriers,
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
        identityBarriers: accountIdentityBarriers,
        identityChecks: accountIdentityChecks,
        beginXiaoyinsiAuthorization: xiaoyinsiAuthController.beginAuthorization,
        sessionEpochs: forumSessionEpochs,
        sessionViewModels: accountSessionViewModels,
        ensureNodeImageApiKey,
        ensureWritableSession,
        isWritableSessionTicketCurrent,
        linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
        linuxDoVerificationVisible: showLinuxDoPanel,
        nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
        nodeSeekUserId: effectiveNodeSeekUserId,
        readGateway,
        reconcileAccountStatus,
        reconcileWritableSession,
        refreshXiaoyinsiAuthorization: xiaoyinsiAuthController.refreshAuthorization,
        requestNodeSeekVerification,
        resetLinuxDoLevelState,
        showLinuxDoVerification,
        showYaohuoLogin,
        updateLinuxDoSession
      },
      appActive,
      contentWidth,
      ensureNetworkProxyReady,
      fetcher: networkProxyFetcher,
      networkProxyWebViewBlockMessage,
      nodeSeekMediaUserAgent: nodeSeekWebViewUserAgent,
      notify,
      reader: {
        commit: commitReaderData,
        data: readerData,
        dataRef: readerDataRef
      },
      readerStyle: readerStyleContext
    }),
    [
      accountIdentityBarriers,
      accountIdentityChecks,
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
      linuxDoWebViewUserAgentRef,
      showLinuxDoPanel,
      networkProxyFetcher,
      networkProxyWebViewBlockMessage,
      nodeSeekWebViewUserAgent,
      nodeSeekWebViewUserAgentRef,
      notify,
      readGateway,
      readerData,
      readerDataRef,
      readerStyleContext,
      reconcileAccountStatus,
      reconcileWritableSession,
      requestNodeSeekVerification,
      resetLinuxDoLevelState,
      showLinuxDoVerification,
      showYaohuoLogin,
      updateLinuxDoSession,
      xiaoyinsiAuthController.beginAuthorization,
      xiaoyinsiAuthController.refreshAuthorization
    ]
  );

  const userRouteRuntime = useMemo<UserRouteRuntimeValue>(
    () => ({
      account: {
        identityBarriers: accountIdentityBarriers,
        identityChecks: accountIdentityChecks,
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
      }
    }),
    [
      accountIdentityBarriers,
      accountIdentityChecks,
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
      showYaohuoLogin
    ]
  );

  const feedRouteRuntime = useMemo<FeedRouteRuntimeValue>(
    () => ({
      account: {
        identityBarriers: accountIdentityBarriers,
        identityChecks: accountIdentityChecks,
        identityReconciliationPending,
        linuxDoVerificationVisible: showLinuxDoPanel,
        readGateway,
        reconcileAccountStatus,
        requestNodeSeekVerification,
        retainableIdentityBarriers: retainableAccountIdentityBarriers,
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
      }
    }),
    [
      accountIdentityBarriers,
      accountIdentityChecks,
      appActive,
      catalogCategories,
      forumSessionEpochs,
      identityReconciliationPending,
      notify,
      readGateway,
      readerData,
      readerDataLoaded,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      retainableAccountIdentityBarriers,
      showLinuxDoPanel,
      showLinuxDoVerification,
      showYaohuoLogin
    ]
  );

  const searchRouteRuntime = useMemo<SearchRouteRuntimeValue>(
    () => ({
      account: {
        identityChecks: accountIdentityChecks,
        identityPending: accountIdentityPending,
        linuxDoVerificationVisible: showLinuxDoPanel,
        readGateway,
        reconcileAccountStatus,
        requestNodeSeekVerification,
        sessionEpochs: forumSessionEpochs,
        sessionViewModels: accountSessionViewModels,
        showLinuxDoVerification,
        showYaohuoLogin
      },
      appActive,
      catalogCategories,
      notify,
      readerData
    }),
    [
      accountIdentityChecks,
      accountIdentityPending,
      accountSessionViewModels,
      appActive,
      catalogCategories,
      forumSessionEpochs,
      notify,
      readGateway,
      readerData,
      reconcileAccountStatus,
      requestNodeSeekVerification,
      showLinuxDoPanel,
      showLinuxDoVerification,
      showYaohuoLogin
    ]
  );

  const libraryRouteRuntime = useMemo<LibraryRouteRuntimeValue>(
    () => ({
      categories: catalogCategories,
      notify,
      reader: {
        commit: commitReaderData,
        data: readerData,
        dataRef: readerDataRef,
        loaded: readerDataLoaded
      }
    }),
    [catalogCategories, commitReaderData, notify, readerData, readerDataLoaded, readerDataRef]
  );

  const moreRouteRuntime = useMemo<MoreRouteRuntimeValue>(
    () => ({
      account: {
        center: accountRuntime.center,
        hosts: accountRuntime.hosts,
        read: accountRuntime.read
      },
      diagnostics: {
        getCurrentScreen,
        metadata: diagnosticMetadata
      },
      loginNavigation: {
        nodeseek: lifecycle.loginNavigation.nodeseek,
        yaohuo: lifecycle.loginNavigation.yaohuo
      },
      notify,
      proxy: networkRuntime,
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
      accountRuntime.hosts,
      accountRuntime.read,
      commitReaderData,
      diagnosticMetadata,
      getCurrentScreen,
      lifecycle.loginNavigation.nodeseek,
      lifecycle.loginNavigation.yaohuo,
      networkRuntime,
      notify,
      readerData,
      readerDataRef,
      replaceReaderData,
      updateRuntime,
      waitForReaderDataSave
    ]
  );
  return {
    accountHosts: {
      blockedMessage: networkProxyWebViewBlockMessage,
      loginNavigation: lifecycle.loginNavigation,
      runtime: accountRuntime,
      styles: appStyles,
      theme
    },
    appStyles,
    readerStyleContext,
    routes: networkProxyContentReady
      ? {
          feedRouteRuntime,
          libraryRouteRuntime,
          moreHasBadge: Boolean(appUpdateInfo),
          moreRouteRuntime,
          navigationTheme,
          onReady: handleNavigationReady,
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
