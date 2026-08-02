import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Linking, Platform, ToastAndroid, useWindowDimensions } from 'react-native';
import { setDefaultAvatarFetcher } from '@/platform/media/avatarImages';
import { useReaderRuntime } from './useReaderRuntime';
import { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import { useHiddenBrowserFetchController } from '@/features/account/useHiddenBrowserFetchController';
import { isReadingSettingsScreen, navigateAppScreen, pushUserRoute, shouldUpdateAppRootScreen } from './appNavigation';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { networkProxyWebViewBlockMessage as proxyWebViewBlockMessage } from '@/platform/network/networkProxy';
import type { Topic, UserReference } from '@/domain/forum/models';
import { isHttpOrHttpsUrl } from '@/platform/media/htmlImages';
import { LOGIN_WEBVIEW_ALLOWED_HOSTS, shouldOpenLoginWebViewUrl } from '@/platform/network/loginWebViewNavigation';
import { toggleFavorite } from '@/domain/reader/readerData';
import { errorMessage } from '@/platform/network/errors';
import { normalizeUserReference } from '@/domain/forum/userNavigation';
import type { FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import type { LibraryRouteRuntimeValue } from '@/features/library/LibraryRoute';
import type { MoreRouteRuntimeValue } from '@/features/more/MoreRoute';
import type { SearchRouteRuntimeValue } from '@/features/search/SearchRoute';
import type { TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import type { UserRouteRuntimeValue } from '@/features/user/UserRoute';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import type { AccountCenterCommand } from '@/domain/session/accountCenter';
import type { Screen } from '@/ui/navigation/types';
import { setRequestTimeoutsActive } from '@/platform/network/request';
import { focusManager } from '@tanstack/react-query';
import { nodeSeekUserIdForSession } from '@/domain/session/siteSessionState';
import {
  CURRENT_ANDROID_VERSION_CODE,
  CURRENT_APP_VERSION,
  CURRENT_EXPO_VERSION,
  CURRENT_REACT_NATIVE_VERSION
} from '@/platform/update/appUpdate';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { useAppTheme } from './useAppTheme';
import { useForumCatalogRuntime } from './useForumCatalogRuntime';
import { useAppDeepLinkNavigation } from './useAppDeepLinkNavigation';

export function useAppRuntime() {
  const { width, height } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  );
  const screenRef = useRef<Screen>('feed');
  const getCurrentScreen = useCallback(() => screenRef.current, []);
  const changeScreen = useCallback((nextScreen: Screen) => {
    navigateAppScreen(nextScreen);
  }, []);
  const autoAppUpdateCheckedRef = useRef(false);
  const notify = useCallback((message: string) => {
    if (!message) {
      return;
    }
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }, []);
  const openUserRoute = useCallback(
    async (user: UserReference) => {
      const normalized = normalizeUserReference(user);
      if (!normalized) {
        notify('用户信息不完整');
        return 'completed';
      }
      pushUserRoute(normalized);
      return 'completed';
    },
    [notify]
  );
  const handleNavigationReady = useAppDeepLinkNavigation();
  const accountStatusInitialRefreshRef = useRef(false);
  const { commitReaderData, readerData, readerDataLoaded, readerDataRef, replaceReaderData, waitForReaderDataSave } =
    useReaderRuntime({ notify });

  const toggleTopicFavorite = useCallback(
    (topic: Topic) => commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic)),
    [commitReaderData]
  );
  useCommitRefValue(screenRef, screen);
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
    ensureNetworkProxyReady,
    loaded: networkProxyLoaded,
    networkProxyFetcher,
    proxyState: networkProxyState,
    summary: networkProxySummary,
    deleteProxyProfile: deleteNetworkProxyProfile,
    selectProxyProfile: selectNetworkProxyProfile,
    setProxyEnabled: setNetworkProxyEnabled,
    testProxyProfile: testNetworkProxyProfile,
    upsertProxyProfile: upsertNetworkProxyProfile
  } = useNetworkProxyRuntime({ notify });
  useEffect(() => setDefaultAvatarFetcher(networkProxyFetcher), [networkProxyFetcher]);
  const networkProxyWebViewBlockMessage = proxyWebViewBlockMessage({
    applyError: networkProxyApplyError,
    applyStatus: networkProxyApplyStatus,
    enabled: networkProxyState.enabled,
    loaded: networkProxyLoaded
  });
  const [networkProxyContentReady, setNetworkProxyContentReady] = useState(false);
  useEffect(() => {
    if (networkProxyContentReady || !networkProxyLoaded) {
      return;
    }
    if (
      networkProxyState.enabled &&
      (networkProxyApplyStatus === 'loading' || networkProxyApplyStatus === 'applying')
    ) {
      return;
    }
    setNetworkProxyContentReady(true);
  }, [networkProxyApplyStatus, networkProxyContentReady, networkProxyLoaded, networkProxyState.enabled]);

  const accountRuntime = useAccountRuntime({
    fetcher: networkProxyFetcher,
    notify,
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
    refreshAccountStatus,
    retainableIdentityBarriers: retainableAccountIdentityBarriers,
    statusBusy
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
    credentials: {
      credentialFillAttempt,
      credentialLoginSite,
      credentialSummaries,
      handleAccountCenterCommand: handleAccountCenterRuntimeCommand,
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
    closeYaohuoLoginPanel,
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
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewUserAgent,
    nodeSeekWebViewUserAgentRef,
    setLoadingLoginPage,
    setLoadingYaohuoLoginPage,
    setYaohuoLoginPrompt,
    requestNodeSeekVerification,
    showLinuxDoPanel,
    showLoginPanel,
    showYaohuoLoginPanel,
    verification: {
      changeLinuxDoPanel,
      checkLinuxDoCookie,
      closeLinuxDoPanel,
      handleLinuxDoMessage,
      resetLinuxDoWebView,
      setLinuxDoWebViewErrorForSession,
      setLoadingLinuxDoPageForSession,
      showLinuxDoVerification,
      stopLinuxDoVerificationForInactiveApp
    },
    webViewRef,
    yaohuoLoginPrompt,
    yaohuoWebViewRef
  } = accountRuntime.hosts;
  const {
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    updateLinuxDoSession
  } = accountRuntime.session;
  const openExternalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        notify('仅支持打开 http/https 链接。');
        return;
      }
      void Linking.openURL(url).catch((error) => notify(errorMessage(error)));
    },
    [notify]
  );
  const handleLoginNavigation = useCallback(
    (request: LoginNavigationRequest, allowedHosts: readonly string[]) => {
      if (shouldOpenLoginWebViewUrl(request.url, allowedHosts)) {
        return true;
      }
      if (isHttpOrHttpsUrl(request.url)) {
        openExternalUrl(request.url);
      }
      return false;
    },
    [openExternalUrl]
  );
  const handleNodeSeekLoginNavigation = useCallback(
    (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.nodeseek),
    [handleLoginNavigation]
  );
  const handleNodeImageAuthNavigation = useCallback(
    (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.nodeimage),
    [handleLoginNavigation]
  );
  const handleYaohuoLoginNavigation = useCallback(
    (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.yaohuo),
    [handleLoginNavigation]
  );
  const handleLinuxDoNavigation = useCallback(
    (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.linuxdo),
    [handleLoginNavigation]
  );
  const showYaohuoLogin = useCallback(
    (message = '请先登录妖火。') => {
      setYaohuoLoginPrompt(message);
      changeYaohuoLoginPanel(true);
      notify(message);
    },
    [changeYaohuoLoginPanel, notify, setYaohuoLoginPrompt]
  );
  useEffect(() => {
    const initialActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    setRequestTimeoutsActive(initialActive);
    focusManager.setFocused(initialActive);
    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      setRequestTimeoutsActive(active);
      focusManager.setFocused(active);
      if (next !== 'active') {
        stopLinuxDoVerificationForInactiveApp();
      }
    });
    return () => {
      subscription.remove();
      setRequestTimeoutsActive(true);
      focusManager.setFocused(undefined);
    };
  }, [stopLinuxDoVerificationForInactiveApp]);

  const effectiveNodeSeekUserId = nodeSeekUserIdForSession(accountSessionViewModels.nodeseek, webLoginUserId);
  useEffect(() => {
    if (!readerDataLoaded || accountStatusInitialRefreshRef.current) {
      return;
    }
    accountStatusInitialRefreshRef.current = true;
    void refreshAccountStatus({ silent: true });
  }, [readerDataLoaded, refreshAccountStatus]);

  const { categories: catalogCategories } = useForumCatalogRuntime({
    active: (screen === 'feed' || screen === 'search') && !showLinuxDoPanel,
    identityBarriers: accountIdentityBarriers,
    identityReconciliationPending,
    notify,
    readGateway,
    retainableIdentityBarriers: retainableAccountIdentityBarriers,
    sessionEpochs: forumSessionEpochs
  });
  const diagnosticMetadata = useMemo(
    () => ({
      androidApiLevel: typeof Platform.Version === 'number' ? Platform.Version : undefined,
      appVersion: CURRENT_APP_VERSION,
      currentScreen: screen,
      deviceModel: Platform.OS === 'android' ? Platform.constants.Model : undefined,
      expoVersion: CURRENT_EXPO_VERSION,
      fontScale,
      linuxDoSession: accountSessionViewModels.linuxdo.status,
      nodeSeekSession: accountSessionViewModels.nodeseek.status,
      proxyEnabled: networkProxyState.enabled,
      reactNativeVersion: CURRENT_REACT_NATIVE_VERSION,
      screenHeight: height,
      screenWidth: width,
      theme: theme.dark ? ('dark' as const) : ('light' as const),
      versionCode: CURRENT_ANDROID_VERSION_CODE,
      yaohuoSession: accountSessionViewModels.yaohuo.status,
      xiaoyinsiSession: accountSessionViewModels.xiaoyinsi.status
    }),
    [fontScale, height, networkProxyState.enabled, screen, accountSessionViewModels, theme.dark, width]
  );
  const {
    appUpdateBusy,
    appUpdateDownloading,
    appUpdateDownloadProgress,
    appUpdateInfo,
    appUpdateMessage,
    checkAppUpdate,
    downloadAppUpdate
  } = useAppUpdateRuntime({ beforeRequest: ensureNetworkProxyReady, fetcher: networkProxyFetcher, notify });
  useEffect(() => {
    if (autoAppUpdateCheckedRef.current) {
      return;
    }
    autoAppUpdateCheckedRef.current = true;
    void checkAppUpdate({ silent: true });
  }, [checkAppUpdate]);

  const handleNavigationScreenChange = useCallback((nextScreen: Screen, routeKey: string) => {
    const previousScreen = screenRef.current;
    const trace = beginDiagnosticTrace('navigation', 'screen-change', {
      previousState: previousScreen,
      nextState: nextScreen,
      routeKind: routeKey ? 'stack' : 'tab'
    });
    if (previousScreen === nextScreen) {
      finishDiagnosticTrace(trace, 'noop', { state: 'same-screen' });
      return;
    }
    screenRef.current = nextScreen;
    if (shouldUpdateAppRootScreen(previousScreen, nextScreen)) {
      setScreen(nextScreen);
    }
    finishDiagnosticTrace(trace, 'success', { state: 'applied' });
  }, []);

  const pageDiagnosticStateRef = useRef('');
  useEffect(() => {
    const currentScreen = screenRef.current;
    let itemCount = 0;
    let isBusy = false;
    let hasError = false;
    let emptyReason = 'none';
    if (currentScreen === 'more') {
      itemCount = 1;
      isBusy = appUpdateBusy || appUpdateDownloading || statusBusy;
    } else {
      itemCount = 1;
      emptyReason = 'route-owned';
    }
    const stateKey = `${currentScreen}:${isBusy}:${hasError}:${itemCount}:${emptyReason}`;
    if (pageDiagnosticStateRef.current === stateKey) {
      return;
    }
    pageDiagnosticStateRef.current = stateKey;
    const trace = beginDiagnosticTrace('app', 'page-state', {
      screen: currentScreen,
      isBusy,
      hasError,
      itemCount,
      emptyReason
    });
    markDiagnosticStage(trace, 'apply', { state: 'summary' });
    finishDiagnosticTrace(trace, 'success');
  }, [appUpdateBusy, appUpdateDownloading, screen, statusBusy]);

  const { handleLinuxDoBrowserFetchMessage, handleNodeSeekBrowserFetchMessage } = useHiddenBrowserFetchController({
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch
  });

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const currentScreen = screenRef.current;
      const trace = beginDiagnosticTrace('navigation', 'hardware-back', { screen: currentScreen });
      const handled = (state: string) => {
        markDiagnosticStage(trace, 'guard', { state });
        finishDiagnosticTrace(trace, 'success', { state });
        return true;
      };
      if (showLoginPanel) {
        changeNodeSeekLoginPanel(false, 'hardware-back');
        return handled('login-panel-closed');
      }
      if (showNodeImageAuthPanel) {
        closeNodeImageAuthPanel('hardware-back');
        return handled('image-auth-panel-closed');
      }
      if (showYaohuoLoginPanel) {
        closeYaohuoLoginPanel('hardware-back');
        return handled('yaohuo-panel-closed');
      }
      if (showLinuxDoPanel) {
        closeLinuxDoPanel(true, 'hardware-back');
        return handled('linuxdo-panel-closed');
      }
      if (currentScreen === 'topic' || currentScreen === 'user' || isReadingSettingsScreen()) {
        finishDiagnosticTrace(trace, 'noop', { state: 'native-stack-back' });
        return false;
      }
      if (currentScreen !== 'feed') {
        changeScreen('feed');
        return handled('feed-return');
      }
      finishDiagnosticTrace(trace, 'noop', { state: 'system-back' });
      return false;
    });
    return () => subscription.remove();
  }, [
    changeScreen,
    changeNodeSeekLoginPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel,
    closeLinuxDoPanel,
    showLoginPanel,
    showNodeImageAuthPanel,
    showLinuxDoPanel,
    showYaohuoLoginPanel
  ]);

  const handleAccountCenterCommand = useCallback(
    async (command: AccountCenterCommand) => {
      if (command.type === 'open-user') {
        await openUserRoute(command.user);
        return;
      }
      await handleAccountCenterRuntimeCommand(command);
    },
    [handleAccountCenterRuntimeCommand, openUserRoute]
  );

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
        dataRef: readerDataRef,
        toggleTopicFavorite
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
      toggleTopicFavorite,
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
