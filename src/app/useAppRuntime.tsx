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
    loginNavigation: {
      linuxdo: handleLinuxDoNavigation,
      nodeimage: handleNodeImageAuthNavigation,
      nodeseek: handleNodeSeekLoginNavigation,
      yaohuo: handleYaohuoLoginNavigation
    },
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
    width,
    height
  );
  const {
    activeProfile: networkProxyActiveProfile,
    applyError: networkProxyApplyError,
    applyStatus: networkProxyApplyStatus,
    contentReady: networkProxyContentReady,
    ensureNetworkProxyReady,
    networkProxyFetcher,
    proxyState: networkProxyState,
    summary: networkProxySummary,
    webViewBlockMessage: networkProxyWebViewBlockMessage,
    deleteProxyProfile: deleteNetworkProxyProfile,
    selectProxyProfile: selectNetworkProxyProfile,
    setProxyEnabled: setNetworkProxyEnabled,
    testProxyProfile: testNetworkProxyProfile,
    upsertProxyProfile: upsertNetworkProxyProfile
  } = useNetworkProxyRuntime({ notify });

  const accountRuntime = useAccountRuntime({
    appActive,
    fetcher: networkProxyFetcher,
    notify,
    openUser: openUserRoute,
    ready: readerDataLoaded,
    screen,
    webViewBlockMessage: networkProxyWebViewBlockMessage
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
    account: {
      checkYaohuoCookie,
      clearLinuxDoCookie,
      clearLogin,
      clearYaohuoLogin,
      handleLoginMessage,
      linuxDoLevelBusy,
      linuxDoLevelError,
      linuxDoLevelProfile,
      recordNodeSeekLoginWebViewState,
      recordYaohuoLoginWebViewState,
      refreshLinuxDoLevel
    },
    checkIn,
    checking,
    handleAccountCenterCommand,
    credentials: {
      credentialFillAttempt,
      credentialLoginSite,
      credentialSummaries,
      handleCredentialLoginFormMessage,
      openAccountLogin,
      pendingCredentialFillSite
    },
    nodeImage: {
      key: {
        authorize: authorizeNodeImageApiKey,
        busy: nodeImageApiKeyBusy,
        clear: clearNodeImageApiKeyInput,
        ensure: ensureNodeImageApiKey,
        save: saveNodeImageApiKeyInput,
        saved: nodeImageApiKeySaved
      },
      panel: {
        close: closeNodeImageAuthPanel,
        document: nodeImageAuthDocument,
        error: nodeImageAuthError,
        fail: reportNodeImageAuthFailure,
        handleMessage: handleNodeImageAuthMessage,
        loading: loadingNodeImageAuthPage,
        setLoading: setLoadingNodeImageAuthPage,
        visible: showNodeImageAuthPanel,
        webViewRef: nodeImageAuthWebViewRef
      }
    },
    webLoginUserId,
    xiaoyinsiAuth: xiaoyinsiAuthController,
    xiaoyinsiLevel: xiaoyinsiLevelController
  } = accountRuntime.center;
  const {
    changeNodeSeekLoginPanel,
    checkNodeSeekLoginAndRetry,
    changeYaohuoLoginPanel,
    closePanels: closeAccountPanels,
    closeTopmostSurface: closeTopmostAccountSurface,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    handleLinuxDoBrowserFetchMessage,
    handleNodeSeekBrowserFetchMessage,
    hiddenBrowserFetchRequests,
    linuxDoBrowserWebViewRef,
    linuxDoWebViewError,
    linuxDoWebViewKey,
    linuxDoWebViewRef,
    linuxDoWebViewUserAgent,
    linuxDoWebViewUserAgentRef,
    loadingLinuxDoPage,
    loadingLoginPage,
    loadingYaohuoLoginPage,
    mountLinuxDoWebView,
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewUserAgent,
    nodeSeekWebViewUserAgentRef,
    setLoadingLoginPage,
    setLoadingYaohuoLoginPage,
    requestNodeSeekVerification,
    showLinuxDoPanel,
    showLoginPanel,
    showYaohuoLoginPanel,
    verification: {
      changeLinuxDoPanel,
      checkLinuxDoCookie,
      handleLinuxDoMessage,
      resetLinuxDoWebView,
      setLinuxDoWebViewErrorForSession,
      setLoadingLinuxDoPageForSession,
      showLinuxDoVerification
    },
    webViewRef,
    showYaohuoLogin,
    yaohuoLoginPrompt,
    yaohuoWebViewRef
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
  const {
    appUpdateBusy,
    appUpdateDownloading,
    appUpdateDownloadProgress,
    appUpdateInfo,
    appUpdateMessage,
    checkAppUpdate,
    downloadAppUpdate
  } = useAppUpdateRuntime({
    autoCheck: true,
    beforeRequest: ensureNetworkProxyReady,
    fetcher: networkProxyFetcher,
    notify
  });
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

  const moreProps = useMemo(
    () => ({
      checking,
      appUpdateBusy,
      appUpdateDownloading,
      appUpdateDownloadProgress,
      appUpdateInfo,
      appUpdateMessage,
      credentialFillAttempt,
      credentialLoginSite,
      credentialSummaries,
      loadingLoginPage,
      loadingYaohuoLoginPage,
      linuxDoLevelBusy,
      linuxDoLevelError,
      linuxDoLevelProfile,
      xiaoyinsiLevelBusy: xiaoyinsiLevelController.levelBusy,
      xiaoyinsiLevelError: xiaoyinsiLevelController.levelError,
      xiaoyinsiLevelProfile: xiaoyinsiLevelController.levelProfile,
      nodeSeekUserId: effectiveNodeSeekUserId,
      nodeImageApiKeyBusy,
      nodeImageApiKeySaved,
      settings: readerData.settings,
      showLoginPanel,
      showYaohuoLoginPanel,
      showLinuxDoPanel,
      statusBusy,
      webViewRef,
      pendingCredentialFillSite,
      yaohuoLoginPrompt,
      yaohuoWebViewRef,
      sessionViewModels: accountSessionViewModels,
      networkProxyActiveProfile,
      networkProxyApplyError,
      networkProxyApplyStatus,
      networkProxyState,
      networkProxySummary,
      webViewBlockMessage: networkProxyWebViewBlockMessage,
      xiaoyinsiAuth: {
        message: xiaoyinsiAuthController.message,
        pending: xiaoyinsiAuthController.pending,
        phase: xiaoyinsiAuthController.phase,
        secondsRemaining: xiaoyinsiAuthController.secondsRemaining,
        onBegin: () => {
          void xiaoyinsiAuthController.beginAuthorization();
        },
        onCancel: () => {
          void xiaoyinsiAuthController.cancelAuthorization();
        },
        onOpenBrowser: () => {
          void xiaoyinsiAuthController.openAuthorizationBrowser();
        },
        onRevoke: () => {
          void xiaoyinsiAuthController.revokeAuthorization();
        }
      },
      onAccountCenterCommand: handleAccountCenterCommand,
      onCheckAppUpdate: checkAppUpdate,
      onDownloadAppUpdate: downloadAppUpdate,
      onCheckIn: checkIn,
      onCheckLogin: () => {
        void checkNodeSeekLoginAndRetry();
      },
      onAuthorizeNodeImageApiKey: authorizeNodeImageApiKey,
      onSaveNodeImageApiKey: saveNodeImageApiKeyInput,
      onClearNodeImageApiKey: clearNodeImageApiKeyInput,
      onCheckYaohuoLogin: () => {
        void checkYaohuoCookie();
      },
      onRefreshLinuxDoLevel: () => {
        void refreshLinuxDoLevel();
      },
      onRefreshXiaoyinsiLevel: () => {
        void xiaoyinsiLevelController.refreshLevel();
      },
      onClearLogin: () => {
        void clearLogin();
      },
      onClearYaohuoLogin: () => {
        void clearYaohuoLogin();
      },
      handleNodeSeekLoginNavigation,
      handleYaohuoLoginNavigation,
      onHandleLoginMessage: handleLoginMessage,
      onNodeSeekLoginWebViewState: recordNodeSeekLoginWebViewState,
      onYaohuoLoginWebViewState: recordYaohuoLoginWebViewState,
      onSetLoadingLoginPage: setLoadingLoginPage,
      onSetLoadingYaohuoLoginPage: setLoadingYaohuoLoginPage,
      onShowLoginPanelChange: changeNodeSeekLoginPanel,
      onShowYaohuoLoginPanelChange: changeYaohuoLoginPanel,
      onLoginFormMessage: handleCredentialLoginFormMessage,
      onDeleteNetworkProxyProfile: deleteNetworkProxyProfile,
      onSelectNetworkProxyProfile: selectNetworkProxyProfile,
      onSetNetworkProxyEnabled: setNetworkProxyEnabled,
      onTestNetworkProxyProfile: testNetworkProxyProfile,
      onUpsertNetworkProxyProfile: upsertNetworkProxyProfile
    }),
    [
      appUpdateBusy,
      appUpdateDownloading,
      appUpdateDownloadProgress,
      appUpdateInfo,
      appUpdateMessage,
      changeNodeSeekLoginPanel,
      changeYaohuoLoginPanel,
      checkAppUpdate,
      checkIn,
      checkNodeSeekLoginAndRetry,
      checkYaohuoCookie,
      checking,
      clearLogin,
      clearYaohuoLogin,
      credentialFillAttempt,
      credentialLoginSite,
      credentialSummaries,
      authorizeNodeImageApiKey,
      deleteNetworkProxyProfile,
      downloadAppUpdate,
      handleLoginMessage,
      handleAccountCenterCommand,
      handleCredentialLoginFormMessage,
      handleNodeSeekLoginNavigation,
      handleYaohuoLoginNavigation,
      linuxDoLevelBusy,
      linuxDoLevelError,
      linuxDoLevelProfile,
      effectiveNodeSeekUserId,
      accountSessionViewModels,
      loadingLoginPage,
      loadingYaohuoLoginPage,
      nodeImageApiKeyBusy,
      nodeImageApiKeySaved,
      networkProxyActiveProfile,
      networkProxyApplyError,
      networkProxyApplyStatus,
      networkProxyState,
      networkProxySummary,
      networkProxyWebViewBlockMessage,
      pendingCredentialFillSite,
      recordNodeSeekLoginWebViewState,
      recordYaohuoLoginWebViewState,
      readerData.settings,
      refreshLinuxDoLevel,
      saveNodeImageApiKeyInput,
      clearNodeImageApiKeyInput,
      selectNetworkProxyProfile,
      setLoadingLoginPage,
      setLoadingYaohuoLoginPage,
      setNetworkProxyEnabled,
      showLinuxDoPanel,
      showLoginPanel,
      showYaohuoLoginPanel,
      statusBusy,
      testNetworkProxyProfile,
      upsertNetworkProxyProfile,
      webViewRef,
      yaohuoLoginPrompt,
      yaohuoWebViewRef,
      xiaoyinsiAuthController,
      xiaoyinsiLevelController
    ]
  );

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
      closeAccountPanels,
      diagnostics: {
        getCurrentScreen,
        metadata: diagnosticMetadata
      },
      notify,
      reader: {
        commit: commitReaderData,
        dataRef: readerDataRef,
        replace: replaceReaderData,
        waitForSave: waitForReaderDataSave
      },
      screen: moreProps
    }),
    [
      closeAccountPanels,
      commitReaderData,
      diagnosticMetadata,
      getCurrentScreen,
      moreProps,
      notify,
      readerDataRef,
      replaceReaderData,
      waitForReaderDataSave
    ]
  );
  return {
    accountHost: {
      checking,
      credentialFillAttempt: credentialFillAttempt?.site === 'linuxdo' ? credentialFillAttempt.attempt : 0,
      credentialFillPending: pendingCredentialFillSite === 'linuxdo',
      checkLinuxDoCookie,
      clearLinuxDoCookie: () => {
        void clearLinuxDoCookie();
      },
      handleLinuxDoMessage,
      handleLinuxDoNavigation,
      handleCredentialLoginFormMessage,
      handleNodeImageAuthMessage,
      handleNodeImageAuthNavigation,
      linuxDoCredentialSaved: credentialSummaries.linuxdo.hasCredential,
      linuxDoLoginFormMode: credentialLoginSite === 'linuxdo',
      linuxDoSession: accountSessionViewModels.linuxdo,
      linuxDoWebViewError,
      linuxDoWebViewKey,
      linuxDoWebViewRef,
      loadingLinuxDoPage,
      loadingNodeImageAuthPage,
      mountLinuxDoWebView,
      nodeImageAuthDocument,
      nodeImageAuthError,
      nodeImageAuthWebViewRef,
      resetLinuxDoWebView,
      setLinuxDoWebViewErrorForSession,
      setLoadingLinuxDoPageForSession,
      setLoadingNodeImageAuthPage,
      setNodeImageAuthError: reportNodeImageAuthFailure,
      showLinuxDoPanel,
      showNodeImageAuthPanel,
      styles: appStyles,
      theme,
      webViewBlockMessage: networkProxyWebViewBlockMessage,
      changeLinuxDoPanel,
      requestLinuxDoCredentialFill: () => {
        openAccountLogin('linuxdo', true);
      },
      closeNodeImageAuthPanel
    },
    appStyles,
    hiddenBrowserHost: {
      blockedMessage: networkProxyWebViewBlockMessage,
      failLinuxDoBrowserFetchById,
      failNodeSeekBrowserFetchById,
      handleLinuxDoBrowserFetchMessage,
      handleNodeSeekBrowserFetchMessage,
      linuxDoBrowserWebViewRef,
      nodeSeekBrowserWebViewRef,
      state: {
        linuxDo: {
          request: hiddenBrowserFetchRequests.linuxDo,
          userAgent: linuxDoWebViewUserAgent
        },
        nodeSeek: {
          request: hiddenBrowserFetchRequests.nodeSeek,
          userAgent: nodeSeekWebViewUserAgent
        }
      },
      styles: appStyles,
      onLinuxDoHttpErrorStatus: markLinuxDoBrowserFetchHttpError,
      onNodeSeekHttpErrorStatus: markNodeSeekBrowserFetchHttpError
    },
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
