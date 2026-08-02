import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ToastAndroid,
  View,
  useWindowDimensions
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { setDefaultAvatarFetcher } from '@/platform/media/avatarImages';
import { useReaderRuntime } from './useReaderRuntime';
import { useReaderDataActionsController } from '@/features/library/useReaderDataActionsController';
import { useReaderSettingsController } from '@/features/more/useReaderSettingsController';
import { useBackupStatusController } from '@/features/more/useBackupStatusController';
import { useDiagnosticLogController } from '@/features/more/useDiagnosticLogController';
import type { LinuxDoReadResumeOutcome } from '@/domain/session/sessionContracts';
import { useAppUpdateRuntime } from '@/platform/update/useAppUpdateRuntime';
import { useFeedController } from '@/features/feed/useFeedController';
import { useHiddenBrowserFetchController } from './useHiddenBrowserFetchController';
import {
  AppNavigator,
  isReadingSettingsScreen,
  navigateAppScreen,
  navigationRef,
  pushTopicRoute,
  pushUserRoute,
  shouldUpdateAppRootScreen
} from './AppNavigator';
import type { MainTabParamList } from '@/ui/navigation/appRouteTypes';
import { useSearchController } from '@/features/search/useSearchController';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import { useUserController } from '@/features/user/useUserController';
import { useIdentityVerificationPrompt } from '@/ui/hooks/useIdentityVerificationPrompt';
import { useMainTabScrollToTop } from './useMainTabScrollToTop';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { GlobalModalHost } from './GlobalModalHost';
import { HiddenBrowserHost } from './HiddenBrowserHost';
import { networkProxyWebViewBlockMessage as proxyWebViewBlockMessage } from '@/platform/network/networkProxy';
import type { Topic, UserReference } from '@/domain/forum/models';
import { isHttpOrHttpsUrl } from '@/platform/media/htmlImages';
import { LOGIN_WEBVIEW_ALLOWED_HOSTS, shouldOpenLoginWebViewUrl } from '@/platform/network/loginWebViewNavigation';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { LibraryTab } from '@/domain/forum/feed';
import { errorMessage } from '@/platform/network/errors';
import { parseInternalTopicOpenLink } from '@/domain/forum/links';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { EMPTY_LIBRARY_RECORDS, sortLibraryRecords } from '@/features/library/model/libraryFilters';
import { MoreScreen, ReadingSettingsScreen } from '@/features/more/MoreScreen';
import { SearchScreen } from '@/features/search/SearchScreen';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { UserScreen } from '@/features/user/UserScreen';
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
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { useAppTheme } from './useAppTheme';
import { useForumCatalogRuntime } from './useForumCatalogRuntime';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';

export function AppRoot() {
  const pendingNavigationScreenRef = useRef<Screen | null>(null);
  const pendingTopicNavigationRef = useRef<Topic | null>(null);
  const { width, height } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  );
  const screenRef = useRef<Screen>('feed');
  const getCurrentScreen = useCallback(() => screenRef.current, []);
  const changeScreen = useCallback((nextScreen: Screen) => {
    if (!navigateAppScreen(nextScreen)) {
      pendingNavigationScreenRef.current = nextScreen;
    }
  }, []);
  const autoAppUpdateCheckedRef = useRef(false);
  const notify = useCallback((message: string) => {
    if (!message) {
      return;
    }
    ToastAndroid.show(message, ToastAndroid.SHORT);
  }, []);
  const openTopic = useCallback(async (topic: Topic): Promise<LinuxDoReadResumeOutcome> => {
    if (!pushTopicRoute(topic)) pendingTopicNavigationRef.current = topic;
    return 'completed';
  }, []);
  const accountStatusInitialRefreshRef = useRef(false);
  const { commitReaderData, readerData, readerDataLoaded, readerDataRef, replaceReaderData, waitForReaderDataSave } =
    useReaderRuntime({ notify });

  const { moreScrollRef, requestTabScrollToTop, tabScrollToTopSignals } = useMainTabScrollToTop();
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const { clearHistory, removeFollowedUser, removeLibraryTopic, toggleTopicFavorite, toggleUserFollow } =
    useReaderDataActionsController({
      commitReaderData,
      libraryTab,
      readerDataRef
    });
  const { updateSettings } = useReaderSettingsController({ commitReaderData });
  const [showNetworkProxyPanel, setShowNetworkProxyPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
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
  const selectedLibraryRecords =
    libraryTab === 'history'
      ? readerData.history
      : libraryTab === 'favorites'
        ? readerData.favorites
        : EMPTY_LIBRARY_RECORDS;
  const libraryRecords = useMemo(() => sortLibraryRecords(selectedLibraryRecords), [selectedLibraryRecords]);
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
  const topicStateIndex = useMemo(
    () => createTopicListItemStateIndex(readerData),
    [readerData.favorites, readerData.history, readerData.settings.listDensity]
  );
  const showYaohuoLogin = useCallback(
    (message = '请先登录妖火。') => {
      setYaohuoLoginPrompt(message);
      changeYaohuoLoginPanel(true);
      notify(message);
    },
    [changeYaohuoLoginPanel, notify]
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

  const closeMorePanels = useCallback(() => {
    closeAccountPanels();
    setShowNetworkProxyPanel(false);
    setShowSettingsPanel(false);
  }, [closeAccountPanels]);

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
  const {
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy,
    feedCategories,
    feedFilter,
    feedFilters,
    feedOutcomeKind,
    feedSource,
    loadFeed,
    readingFilter,
    refreshFeed,
    setCategoryFilter,
    setFeedFilter,
    setReadingFilter,
    shownFeedItems
  } = useFeedController({
    catalogCategories,
    identityBarriers: accountIdentityBarriers,
    identityReconciliationPending,
    retainableIdentityBarriers: retainableAccountIdentityBarriers,
    sessionEpochs: forumSessionEpochs,
    linuxDoVerificationActive: showLinuxDoPanel,
    notify,
    readerData,
    readerDataLoaded,
    screen,
    showLinuxDoVerification,
    showNodeSeekVerification: requestNodeSeekVerification,
    showYaohuoLogin,
    readGateway
  });
  const feedIdentityCheck = feedSource === 'linuxdo' ? accountIdentityChecks.linuxdo : undefined;
  const feedIdentityError = feedIdentityCheck?.pending ? feedIdentityCheck.error : undefined;

  const {
    applySearchFilter,
    loadMoreSearchSource,
    recentSearches,
    removeRecentSearch,
    retryLinuxDoAiSearch,
    retrySearchSource,
    runSearch,
    searchBusy,
    searchFilters,
    searchGroups,
    searchDiscourseTags,
    searchDiscourseUsers,
    linuxDoAiState,
    linuxDoAiVisible,
    searchSessionNotices,
    searchQuery,
    searchSource,
    submittedSearchQuery,
    setSearchQuery,
    setSearchSource,
    toggleLinuxDoAiSearch
  } = useSearchController({
    categories,
    sessionEpochs: forumSessionEpochs,
    linuxDoVerificationActive: showLinuxDoPanel,
    notify,
    onNodeSeekSearchVerificationRequired: requestNodeSeekVerification,
    screen,
    sessionViewModels: accountSessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification: requestNodeSeekVerification,
    showYaohuoLogin,
    readGateway
  });
  const searchIdentityCheck = searchSource === 'linuxdo' ? accountIdentityChecks.linuxdo : undefined;
  const searchIdentityError = searchIdentityCheck?.pending ? searchIdentityCheck.error : undefined;

  const { backupBusy, exportBackupFile, importBackupFile } = useBackupStatusController({
    notify,
    readerDataRef,
    replaceReaderData,
    waitForReaderDataSave
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
  const { diagnosticBusy, exportDiagnosticLogFile } = useDiagnosticLogController({
    getCurrentScreen,
    metadata: diagnosticMetadata,
    notify
  });
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

  const handleNavigationScreenChange = useCallback(
    (nextScreen: Screen, routeKey: string) => {
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
      if (previousScreen === 'more' && nextScreen !== 'more') {
        closeMorePanels();
      }
      screenRef.current = nextScreen;
      if (shouldUpdateAppRootScreen(previousScreen, nextScreen)) {
        setScreen(nextScreen);
      }
      finishDiagnosticTrace(trace, 'success', { state: 'applied' });
    },
    [closeMorePanels]
  );

  const prepareUserNavigation = useCallback((user: UserReference) => {
    pushUserRoute(user);
  }, []);

  const {
    currentUserFollowed,
    followedUserRecords,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openUser,
    refreshUser,
    selectedUser,
    userBusy,
    userError,
    userLoadingMoreReplies,
    userLoadingMoreTopics,
    userProfile
  } = useUserController({
    identityBarriers: accountIdentityBarriers,
    sessionEpochs: forumSessionEpochs,
    notify,
    onOpenUserScreen: prepareUserNavigation,
    readerData,
    screen,
    showLinuxDoVerification,
    showNodeSeekVerification: requestNodeSeekVerification,
    readGateway,
    showYaohuoLogin
  });
  const selectedUserIdentityCheck = selectedUser?.source === 'linuxdo' ? accountIdentityChecks.linuxdo : undefined;
  const userIdentityError = selectedUserIdentityCheck?.pending ? selectedUserIdentityCheck.error : undefined;
  const linuxDoForegroundReadIntent = useMemo(() => {
    if (screen === 'feed' && feedSource === 'linuxdo') {
      return `feed:${categoryFilter}:${feedFilter || ''}`;
    }
    if (screen === 'search' && searchSource === 'linuxdo' && submittedSearchQuery) {
      return `search:${submittedSearchQuery}:${JSON.stringify(searchFilters.linuxdo)}`;
    }
    if (screen === 'user' && selectedUser?.source === 'linuxdo') {
      return `user:${selectedUser.id || selectedUser.username || ''}`;
    }
    return null;
  }, [
    categoryFilter,
    feedFilter,
    feedSource,
    screen,
    searchFilters.linuxdo,
    searchSource,
    selectedUser,
    submittedSearchQuery
  ]);
  const linuxDoForegroundReadBlocked =
    screen === 'feed'
      ? shownFeedItems.length === 0
      : screen === 'search'
        ? !searchGroups.some((group) => group.source === 'linuxdo' && group.items.length > 0)
        : screen === 'user'
          ? !userProfile
          : false;

  useEffect(() => {
    const openInternalTopic = (url: string | null) => {
      const topic = url ? parseInternalTopicOpenLink(url) : null;
      if (topic) {
        void openTopic(topic);
      }
    };
    const subscription = Linking.addEventListener('url', ({ url }) => openInternalTopic(url));
    void Linking.getInitialURL()
      .then(openInternalTopic)
      .catch(() => undefined);
    return () => subscription.remove();
  }, [openTopic]);

  useIdentityVerificationPrompt({
    enabled: appActive && !linuxDoAiVisible && linuxDoForegroundReadBlocked,
    error: accountIdentityChecks.linuxdo.error,
    identityPending: accountIdentityChecks.linuxdo.pending,
    intentKey: linuxDoForegroundReadIntent,
    showVerification: showLinuxDoVerification
  });

  const pageDiagnosticStateRef = useRef('');
  useEffect(() => {
    const currentScreen = screenRef.current;
    let itemCount = 0;
    let isBusy = false;
    let hasError = false;
    let emptyReason = 'none';
    if (currentScreen === 'feed') {
      itemCount = shownFeedItems.length;
      isBusy = feedBusy || activeFeedState.loadingMore || activeFeedState.refreshing;
      emptyReason = isBusy ? 'loading' : itemCount ? 'none' : 'no-items';
    } else if (currentScreen === 'search') {
      itemCount = searchGroups.reduce((count, group) => count + group.items.length, 0);
      isBusy = searchBusy || searchGroups.some((group) => group.loading || group.loadingMore);
      hasError = searchGroups.some((group) => Boolean(group.error));
      emptyReason = !submittedSearchQuery
        ? 'not-started'
        : isBusy
          ? 'loading'
          : hasError && !itemCount
            ? 'source-error'
            : itemCount
              ? 'none'
              : 'no-results';
    } else if (currentScreen === 'library') {
      itemCount = libraryTab === 'users' ? followedUserRecords.length : libraryRecords.length;
      isBusy = !readerDataLoaded;
      emptyReason = isBusy ? 'not-loaded' : itemCount ? 'none' : 'no-items';
    } else if (currentScreen === 'more') {
      itemCount = 1;
      isBusy = backupBusy || diagnosticBusy || appUpdateBusy || appUpdateDownloading || statusBusy;
    } else if (currentScreen === 'topic') {
      itemCount = 1;
      emptyReason = 'route-owned';
    } else {
      itemCount = (userProfile?.topics?.length || 0) + (userProfile?.replies?.length || 0);
      isBusy = userBusy || userLoadingMoreTopics || userLoadingMoreReplies;
      hasError = Boolean(userError);
      emptyReason = isBusy
        ? 'loading'
        : hasError
          ? 'load-failed'
          : userProfile
            ? itemCount
              ? 'none'
              : 'no-items'
            : 'no-user';
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
  }, [
    activeFeedState.loadingMore,
    activeFeedState.refreshing,
    appUpdateBusy,
    appUpdateDownloading,
    backupBusy,
    diagnosticBusy,
    feedBusy,
    followedUserRecords.length,
    libraryRecords.length,
    libraryTab,
    readerDataLoaded,
    screen,
    searchBusy,
    searchGroups,
    shownFeedItems.length,
    statusBusy,
    submittedSearchQuery,
    userBusy,
    userError,
    userLoadingMoreReplies,
    userLoadingMoreTopics,
    userProfile
  ]);

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
      if (showSettingsPanel) {
        setShowSettingsPanel(false);
        return handled('settings-panel-closed');
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
    showYaohuoLoginPanel,
    showSettingsPanel
  ]);

  const handleNavigationReady = useCallback(() => {
    const pendingTopic = pendingTopicNavigationRef.current;
    if (pendingTopic) {
      pendingTopicNavigationRef.current = null;
      pushTopicRoute(pendingTopic);
    }
    const pendingScreen = pendingNavigationScreenRef.current;
    if (!pendingScreen) {
      return;
    }
    pendingNavigationScreenRef.current = null;
    navigateAppScreen(pendingScreen);
  }, []);

  const loadMoreActiveFeed = useCallback(() => {
    if (!feedAllowsRemotePagination) {
      return;
    }
    void loadFeed();
  }, [feedAllowsRemotePagination, loadFeed]);

  const runCurrentSearch = useCallback(
    (queryOverride?: string) => {
      void runSearch(queryOverride === undefined ? undefined : { query: queryOverride });
    },
    [runSearch]
  );

  const checkLinuxDoStatus = useCallback(() => {
    void showLinuxDoVerification();
  }, [showLinuxDoVerification]);
  const retryFeedIdentity = useCallback(() => {
    if (feedSource === 'linuxdo') {
      void reconcileAccountStatus('linuxdo');
    }
  }, [feedSource, reconcileAccountStatus]);
  const retrySearchIdentity = useCallback(() => {
    if (searchSource === 'linuxdo') {
      void reconcileAccountStatus('linuxdo');
    }
  }, [reconcileAccountStatus, searchSource]);
  const refreshCurrentUser = useCallback(() => {
    if (userIdentityError && selectedUser?.source === 'linuxdo') {
      void reconcileAccountStatus('linuxdo');
      return;
    }
    void refreshUser();
  }, [reconcileAccountStatus, refreshUser, selectedUser, userIdentityError]);

  const handleAccountCenterCommand = useCallback(
    async (command: AccountCenterCommand) => {
      if (command.type === 'open-user') {
        await openUser(command.user);
        return;
      }
      await handleAccountCenterRuntimeCommand(command);
    },
    [handleAccountCenterRuntimeCommand, openUser]
  );

  const feedProps = useMemo(
    () => ({
      busy: feedBusy && !feedIdentityError,
      categories: feedCategories,
      categoryFilter,
      feedHasMore: activeFeedState.hasMore && feedAllowsRemotePagination,
      feedItems: shownFeedItems,
      feedOutcomeKind: feedIdentityError
        ? feedIdentityError.kind === 'ordinary'
          ? ('error' as const)
          : ('auth' as const)
        : feedOutcomeKind,
      feedPage: activeFeedState.page,
      feedSource,
      feedFilter,
      feedFilters,
      identityChecking: Boolean(feedIdentityCheck?.checking),
      identityError: feedIdentityError,
      loadMoreFailureSignal: activeFeedState.loadMoreFailureSignal,
      loadingMore: activeFeedState.loadingMore,
      topicStateIndex,
      readingFilter,
      refreshing: activeFeedState.refreshing,
      scrollToTopSignal: tabScrollToTopSignals.feed,
      onCategoryChange: setCategoryFilter,
      onFeedSourceChange: changeFeedSource,
      onFeedFilterChange: setFeedFilter,
      onLoadMore: loadMoreActiveFeed,
      onCheckLinuxDoStatus: checkLinuxDoStatus,
      onOpenTopic: openTopic,
      onRetryIdentity: retryFeedIdentity,
      onReadingFilterChange: setReadingFilter,
      onRefresh: feedIdentityError ? retryFeedIdentity : refreshFeed
    }),
    [
      activeFeedState.hasMore,
      activeFeedState.loadMoreFailureSignal,
      activeFeedState.loadingMore,
      activeFeedState.page,
      activeFeedState.refreshing,
      categoryFilter,
      changeFeedSource,
      feedAllowsRemotePagination,
      feedBusy,
      feedCategories,
      feedFilter,
      feedFilters,
      feedIdentityCheck?.checking,
      feedIdentityError,
      feedOutcomeKind,
      feedSource,
      loadMoreActiveFeed,
      checkLinuxDoStatus,
      openTopic,
      readingFilter,
      refreshFeed,
      retryFeedIdentity,
      setCategoryFilter,
      setFeedFilter,
      setReadingFilter,
      shownFeedItems,
      tabScrollToTopSignals.feed,
      topicStateIndex
    ]
  );

  const searchProps = useMemo(
    () => ({
      busy: searchBusy,
      categories,
      sessionEpochs: forumSessionEpochs,
      requestsEnabled:
        screen === 'search' &&
        !showLinuxDoPanel &&
        (searchSource === 'all' || searchSource === 'v2ex' || !accountIdentityPending[searchSource]),
      query: searchQuery,
      topicStateIndex,
      recentSearches,
      searchFilters,
      searchGroups,
      linuxDoAiState,
      linuxDoAiVisible,
      identityChecking: Boolean(searchIdentityCheck?.checking),
      identityError: searchIdentityError,
      searchSessionNotices: searchIdentityCheck?.pending ? [] : searchSessionNotices,
      searchSource,
      submittedQuery: submittedSearchQuery,
      scrollToTopSignal: tabScrollToTopSignals.search,
      onLoadMoreSearchSource: loadMoreSearchSource,
      onCheckLinuxDoStatus: checkLinuxDoStatus,
      onOpenTopic: openTopic,
      onRemoveRecentSearch: removeRecentSearch,
      onQueryChange: setSearchQuery,
      onRetryLinuxDoAiSearch: retryLinuxDoAiSearch,
      onRetryIdentity: retrySearchIdentity,
      onSearch: runCurrentSearch,
      onSearchFilterApply: applySearchFilter,
      onSearchDiscourseTags: searchDiscourseTags,
      onSearchDiscourseUsers: searchDiscourseUsers,
      onSearchSourceChange: setSearchSource,
      onRetrySearchSource: retrySearchSource,
      onToggleLinuxDoAiSearch: toggleLinuxDoAiSearch
    }),
    [
      applySearchFilter,
      accountIdentityPending,
      categories,
      checkLinuxDoStatus,
      forumSessionEpochs,
      loadMoreSearchSource,
      openTopic,
      recentSearches,
      removeRecentSearch,
      retryLinuxDoAiSearch,
      retrySearchIdentity,
      retrySearchSource,
      runCurrentSearch,
      searchBusy,
      searchFilters,
      searchGroups,
      searchDiscourseTags,
      searchDiscourseUsers,
      linuxDoAiState,
      linuxDoAiVisible,
      searchQuery,
      searchSessionNotices,
      searchIdentityCheck?.checking,
      searchIdentityCheck?.pending,
      searchIdentityError,
      searchSource,
      screen,
      setSearchQuery,
      setSearchSource,
      showLinuxDoPanel,
      submittedSearchQuery,
      tabScrollToTopSignals.search,
      toggleLinuxDoAiSearch,
      topicStateIndex
    ]
  );

  const libraryProps = useMemo(
    () => ({
      categories,
      followedUsers: followedUserRecords,
      libraryTab,
      loaded: readerDataLoaded,
      records: libraryRecords,
      scrollToTopSignal: tabScrollToTopSignals.library,
      topicStateIndex,
      onClearHistory: clearHistory,
      onOpenTopic: openTopic,
      onOpenUser: openUser,
      onRemove: removeLibraryTopic,
      onRemoveUser: removeFollowedUser,
      onTabChange: setLibraryTab
    }),
    [
      categories,
      clearHistory,
      followedUserRecords,
      libraryRecords,
      libraryTab,
      openTopic,
      openUser,
      readerDataLoaded,
      removeFollowedUser,
      removeLibraryTopic,
      tabScrollToTopSignals.library,
      topicStateIndex
    ]
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
      showNetworkProxyPanel,
      showSettingsPanel,
      statusBusy,
      backupBusy,
      diagnosticBusy,
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
      onExportBackupFile: exportBackupFile,
      onExportDiagnosticLog: exportDiagnosticLogFile,
      onImportBackupFile: importBackupFile,
      onSetLoadingLoginPage: setLoadingLoginPage,
      onSetLoadingYaohuoLoginPage: setLoadingYaohuoLoginPage,
      onShowLoginPanelChange: changeNodeSeekLoginPanel,
      onShowYaohuoLoginPanelChange: changeYaohuoLoginPanel,
      onLoginFormMessage: handleCredentialLoginFormMessage,
      onShowNetworkProxyPanelChange: setShowNetworkProxyPanel,
      onShowSettingsPanelChange: setShowSettingsPanel,
      onDeleteNetworkProxyProfile: deleteNetworkProxyProfile,
      onSelectNetworkProxyProfile: selectNetworkProxyProfile,
      onSetNetworkProxyEnabled: setNetworkProxyEnabled,
      onTestNetworkProxyProfile: testNetworkProxyProfile,
      onUpsertNetworkProxyProfile: upsertNetworkProxyProfile,
      onUpdateSettings: updateSettings
    }),
    [
      appUpdateBusy,
      appUpdateDownloading,
      appUpdateDownloadProgress,
      appUpdateInfo,
      appUpdateMessage,
      backupBusy,
      diagnosticBusy,
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
      exportBackupFile,
      exportDiagnosticLogFile,
      handleLoginMessage,
      handleAccountCenterCommand,
      handleCredentialLoginFormMessage,
      handleNodeSeekLoginNavigation,
      handleYaohuoLoginNavigation,
      importBackupFile,
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
      setNetworkProxyEnabled,
      showLinuxDoPanel,
      showLoginPanel,
      showNetworkProxyPanel,
      showSettingsPanel,
      showYaohuoLoginPanel,
      statusBusy,
      testNetworkProxyProfile,
      upsertNetworkProxyProfile,
      updateSettings,
      yaohuoLoginPrompt,
      xiaoyinsiAuthController
    ]
  );

  const userProps = useMemo(
    () => ({
      busy: (userBusy && !userIdentityError) || Boolean(selectedUserIdentityCheck?.checking),
      error: userIdentityError || userError || null,
      followed: currentUserFollowed,
      identityBlocked: Boolean(selectedUserIdentityCheck?.pending),
      identityChecking: Boolean(selectedUserIdentityCheck?.checking),
      profile: userProfile,
      requestedUser: selectedUser,
      topicStateIndex,
      loadingMoreReplies: userLoadingMoreReplies,
      loadingMoreTopics: userLoadingMoreTopics,
      onBack: () => navigationRef.goBack(),
      onLoadMoreReplies: loadMoreUserReplies,
      onLoadMoreTopics: loadMoreUserTopics,
      onCheckLinuxDoStatus: checkLinuxDoStatus,
      onOpenOriginal: openExternalUrl,
      onOpenTopic: openTopic,
      onRefresh: refreshCurrentUser,
      onToggleFollow: toggleUserFollow
    }),
    [
      checkLinuxDoStatus,
      currentUserFollowed,
      loadMoreUserReplies,
      loadMoreUserTopics,
      openExternalUrl,
      openTopic,
      refreshCurrentUser,
      selectedUser,
      selectedUserIdentityCheck?.checking,
      selectedUserIdentityCheck?.pending,
      toggleUserFollow,
      topicStateIndex,
      userBusy,
      userError,
      userIdentityError,
      userLoadingMoreReplies,
      userLoadingMoreTopics,
      userProfile
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

  const renderFeedTab = useCallback(() => <FeedScreen {...feedProps} />, [feedProps]);
  const renderSearchTab = useCallback(() => <SearchScreen {...searchProps} />, [searchProps]);
  const renderLibraryTab = useCallback(() => <LibraryScreen {...libraryProps} />, [libraryProps]);
  const renderMoreTab = useCallback(() => <MoreScreen {...moreProps} scrollRef={moreScrollRef} />, [moreProps]);
  const renderReadingSettingsScreen = useCallback(
    () => <ReadingSettingsScreen settings={readerData.settings} onUpdateSettings={updateSettings} />,
    [readerData.settings, updateSettings]
  );
  const renderUserScreen = useCallback(() => <UserScreen {...userProps} />, [userProps]);

  const handleMainTabPress = useCallback(
    (targetScreen: keyof MainTabParamList) => {
      if (screen === targetScreen) {
        requestTabScrollToTop(targetScreen);
      }
      changeScreen(targetScreen);
    },
    [changeScreen, requestTabScrollToTop, screen]
  );

  return (
    <ReaderStyleProvider value={readerStyleContext}>
      <ForumSessionEpochProvider sessionEpochs={forumSessionEpochs}>
        <GestureHandlerRootView style={appStyles.screen}>
          <SafeAreaProvider>
            <KeyboardAvoidingView style={appStyles.screen}>
              <SafeAreaView edges={['left', 'right']} style={appStyles.screen}>
                <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
                <View pointerEvents="none" style={appStyles.statusBarScrim} />
                <HiddenBrowserHost
                  blockedMessage={networkProxyWebViewBlockMessage}
                  failLinuxDoBrowserFetchById={failLinuxDoBrowserFetchById}
                  failNodeSeekBrowserFetchById={failNodeSeekBrowserFetchById}
                  handleLinuxDoBrowserFetchMessage={handleLinuxDoBrowserFetchMessage}
                  handleNodeSeekBrowserFetchMessage={handleNodeSeekBrowserFetchMessage}
                  linuxDoBrowserWebViewRef={linuxDoBrowserWebViewRef}
                  nodeSeekBrowserWebViewRef={nodeSeekBrowserWebViewRef}
                  state={{
                    linuxDo: {
                      request: hiddenBrowserFetchRequests.linuxDo,
                      userAgent: linuxDoWebViewUserAgent
                    },
                    nodeSeek: {
                      request: hiddenBrowserFetchRequests.nodeSeek,
                      userAgent: nodeSeekWebViewUserAgent
                    }
                  }}
                  styles={appStyles}
                  onLinuxDoHttpErrorStatus={markLinuxDoBrowserFetchHttpError}
                  onNodeSeekHttpErrorStatus={markNodeSeekBrowserFetchHttpError}
                />
                <GlobalModalHost
                  checking={checking}
                  credentialFillAttempt={credentialFillAttempt?.site === 'linuxdo' ? credentialFillAttempt.attempt : 0}
                  credentialFillPending={pendingCredentialFillSite === 'linuxdo'}
                  checkLinuxDoCookie={checkLinuxDoCookie}
                  clearLinuxDoCookie={() => {
                    void clearLinuxDoCookie();
                  }}
                  handleLinuxDoMessage={handleLinuxDoMessage}
                  handleLinuxDoNavigation={handleLinuxDoNavigation}
                  handleCredentialLoginFormMessage={handleCredentialLoginFormMessage}
                  handleNodeImageAuthMessage={handleNodeImageAuthMessage}
                  handleNodeImageAuthNavigation={handleNodeImageAuthNavigation}
                  linuxDoCredentialSaved={credentialSummaries.linuxdo.hasCredential}
                  linuxDoLoginFormMode={credentialLoginSite === 'linuxdo'}
                  linuxDoSession={accountSessionViewModels.linuxdo}
                  linuxDoWebViewError={linuxDoWebViewError}
                  linuxDoWebViewKey={linuxDoWebViewKey}
                  linuxDoWebViewRef={linuxDoWebViewRef}
                  loadingLinuxDoPage={loadingLinuxDoPage}
                  loadingNodeImageAuthPage={loadingNodeImageAuthPage}
                  mountLinuxDoWebView={mountLinuxDoWebView}
                  nodeImageAuthDocument={nodeImageAuthDocument}
                  nodeImageAuthError={nodeImageAuthError}
                  nodeImageAuthWebViewRef={nodeImageAuthWebViewRef}
                  resetLinuxDoWebView={resetLinuxDoWebView}
                  setLinuxDoWebViewErrorForSession={setLinuxDoWebViewErrorForSession}
                  setLoadingLinuxDoPageForSession={setLoadingLinuxDoPageForSession}
                  setLoadingNodeImageAuthPage={setLoadingNodeImageAuthPage}
                  setNodeImageAuthError={reportNodeImageAuthFailure}
                  showLinuxDoPanel={showLinuxDoPanel}
                  showNodeImageAuthPanel={showNodeImageAuthPanel}
                  styles={appStyles}
                  theme={theme}
                  webViewBlockMessage={networkProxyWebViewBlockMessage}
                  changeLinuxDoPanel={changeLinuxDoPanel}
                  requestLinuxDoCredentialFill={() => {
                    openAccountLogin('linuxdo', true);
                  }}
                  closeNodeImageAuthPanel={closeNodeImageAuthPanel}
                />
                {networkProxyContentReady ? (
                  <TopicRouteRuntimeProvider value={topicRouteRuntime}>
                    <AppNavigator
                      moreHasBadge={Boolean(appUpdateInfo)}
                      navigationTheme={navigationTheme}
                      renderFeedTab={renderFeedTab}
                      renderLibraryTab={renderLibraryTab}
                      renderMoreTab={renderMoreTab}
                      renderReadingSettingsScreen={renderReadingSettingsScreen}
                      renderSearchTab={renderSearchTab}
                      TopicRouteComponent={TopicRoute}
                      renderUserScreen={renderUserScreen}
                      styles={appStyles}
                      theme={theme}
                      onReady={handleNavigationReady}
                      onScreenChange={handleNavigationScreenChange}
                      onTabPress={handleMainTabPress}
                    />
                  </TopicRouteRuntimeProvider>
                ) : null}
              </SafeAreaView>
            </KeyboardAvoidingView>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ForumSessionEpochProvider>
    </ReaderStyleProvider>
  );
}
