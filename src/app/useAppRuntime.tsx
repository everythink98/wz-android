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
    loginNavigation: lifecycle.loginNavigation,
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
    getLinuxDoUserAgent,
    getNodeSeekUserAgent,
    identityBarriers: accountIdentityBarriers,
    identityReconciliationPending,
    readGateway,
    reconcileAccountStatus,
    retainableIdentityBarriers: retainableAccountIdentityBarriers,
    statusBusy
  } = accountRuntime.read;
  const { ensureNodeImageApiKey, ensureWritableSession, isWritableSessionTicketCurrent, reconcileWritableSession } =
    accountRuntime.write;
  const { webLoginUserId, xiaoyinsiAuth: xiaoyinsiAuthController } = accountRuntime.center;
  const {
    closeTopmostSurface: closeTopmostAccountSurface,
    linuxDoVerificationVisible: showLinuxDoPanel,
    requestNodeSeekVerification,
    showLinuxDoVerification,
    showYaohuoLogin
  } = accountRuntime.hosts;
  const nodeSeekMediaUserAgent = getNodeSeekUserAgent();
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
        getLinuxDoUserAgent,
        linuxDoVerificationVisible: showLinuxDoPanel,
        getNodeSeekUserAgent,
        nodeSeekUserId: effectiveNodeSeekUserId,
        readGateway,
        reconcileAccountStatus,
        reconcileWritableSession,
        refreshXiaoyinsiAuthorization: xiaoyinsiAuthController.refreshAuthorization,
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
      getLinuxDoUserAgent,
      showLinuxDoPanel,
      networkProxyFetcher,
      networkProxyWebViewBlockMessage,
      nodeSeekMediaUserAgent,
      getNodeSeekUserAgent,
      notify,
      readGateway,
      readerData,
      readerDataRef,
      readerStyleContext,
      reconcileAccountStatus,
      reconcileWritableSession,
      requestNodeSeekVerification,
      showLinuxDoVerification,
      showYaohuoLogin,
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
            checkIn: accountRuntime.center.checkIn,
            webLoginUserId: accountRuntime.center.webLoginUserId
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
      replaceReaderData,
      updateRuntime,
      waitForReaderDataSave
    ]
  );
  return {
    accountHost: accountRuntime.hosts.element,
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
