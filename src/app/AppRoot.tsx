import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Share,
  ToastAndroid,
  View,
  useWindowDimensions
} from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '../nodeseekSession';
import { setDefaultAvatarFetcher } from '../avatarImages';
import type { TopicRecord } from '../readerData';
import { useReaderDataController } from './useReaderDataController';
import { useReaderDataActionsController } from './useReaderDataActionsController';
import { useReaderSettingsController } from './useReaderSettingsController';
import { useBackupStatusController } from './useBackupStatusController';
import { useDiagnosticLogController } from './useDiagnosticLogController';
import {
  useAccountStatusController,
  type AccountReconcileResult
} from './useAccountStatusController';
import { useAppUpdateController } from './useAppUpdateController';
import { useFeedController } from './useFeedController';
import { useHtmlRenderingController } from './useHtmlRenderingController';
import { useHiddenBrowserFetchController } from './useHiddenBrowserFetchController';
import { AppNavigator, currentTopicRouteKey, isReadingSettingsScreen, navigateAppScreen, navigationRef, openReadingSettingsFromCurrentTopic, previousTopicRouteKey, pushTopicRoute, shouldUpdateAppRootScreen, type MainTabParamList } from './AppNavigator';
import { useImagePreviewController } from './useImagePreviewController';
import { useSearchController } from './useSearchController';
import { useSessionController } from './useSessionController';
import { useNetworkProxyController } from './useNetworkProxyController';
import { useTopicController } from './useTopicController';
import { filterTopicSessionReplies, useTopicSessionController } from './useTopicSessionController';
import { useUserController } from './useUserController';
import {
  useLinuxDoIdentityVerificationPrompt,
  useVerificationController,
  type LinuxDoReadRecovery,
  type LinuxDoReadResumeOutcome
} from './useVerificationController';
import { useAccountController } from './useAccountController';
import { useAccountCredentialController } from './useAccountCredentialController';
import { useTopicActionsController } from './useTopicActionsController';
import { useXiaoyinsiAuthController } from './useXiaoyinsiAuthController';
import { useNodeImageAuthController } from './useNodeImageAuthController';
import {
  takeNodeSeekVerificationRetry,
  type NodeSeekVerificationRetry
} from './sessionControllerHelpers';
import { markCurrentNodeSeekOwnRepliesUnlikable } from './topicActionControllerHelpers';
import { shareTopicWithClipboardFallback } from './topicActionHelpers';
import { useMainTabScrollToTop } from './useMainTabScrollToTop';
import { useDeferredNavigationTask } from './useDeferredNavigationTask';
import { useCommitRefValue } from './useCommittedRef';
import { GlobalModalHost } from './GlobalModalHost';
import { HiddenBrowserHost } from './HiddenBrowserHost';
import {
  executeTopicReturnStrategy,
  executeUserReturnStrategy,
  selectTopicReturnStrategy,
  shouldCloseReplyComposerOnBack
} from './backHandlerHelpers';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '../linuxdoSession';
import { sourceErrorFromUnknown } from '../sourceErrors';
import { createSourceGateway } from '../sources/sourceGateway';
import { networkProxyWebViewBlockMessage as proxyWebViewBlockMessage } from '../networkProxy';
import type { Topic, TopicDetail, UserProfile, UserReference } from '../types';
import { isHttpOrHttpsUrl, type ImageDisplaySize } from '../htmlImages';
import { shouldOpenLoginWebViewUrl } from '../loginWebViewNavigation';
import { createTopicListItemStateIndex } from '../topicListItemState';
import { replyHtmlWithSignature } from '../topicDerivedData';
import {
  contentWidthValue,
  createStyles,
  createTheme
} from '../theme';
import type { LibraryTab } from '../feedLogic';
import { errorMessage, parseInternalTopicOpenLink } from '../appUtils';
import { FeedScreen } from '../screens/FeedScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { AppearancePanel } from '../screens/more/MorePanels';
import { SearchScreen } from '../screens/SearchScreen';
import { TopicScreen, YaohuoFavoriteStateProvider } from '../screens/TopicScreen';
import { hasSameYaohuoTopicLayout } from '../screens/topic/topicScreenHelpers';
import { UserScreen } from '../screens/UserScreen';
import type { TopicListItem } from '../screens/TopicScreen';
import type { LoginNavigationRequest, Screen, TopicSnapshot } from '../appTypes';
import { setRequestTimeoutsActive } from '../request';
import { focusManager } from '@tanstack/react-query';
import {
  appQueryClient,
  initialForumSessionEpochs,
  forumQueryKeys,
  type ForumIdentityBarrierSource,
  type ForumSessionEpochs
} from './serverState';
import {
  createSiteSessionViewModels,
  nodeSeekUserIdForSession,
  sessionSources,
  type SessionSite
} from '../siteSessionState';
import type { LoginWebViewFailureReason } from './accountCredentialDiagnostics';
import type { CredentialSite } from '../credentialVault';
import { currentXiaoyinsiCredentialGeneration, loadXiaoyinsiCredentials } from '../xiaoyinsiAuth';
import {
  CURRENT_ANDROID_VERSION_CODE,
  CURRENT_APP_VERSION,
  CURRENT_EXPO_VERSION,
  CURRENT_REACT_NATIVE_VERSION
} from '../appUpdate';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  type DiagnosticTrace
} from '../diagnostics';
import {
  beginAuthSurface,
  closeOtherAuthSurfaces,
  createAuthSurfaceRegistry,
  finishAuthSurface,
  hasOpenAuthSurfaceForSource,
  type AuthSurface,
  type AuthSurfaceCloseReason
} from '../authSurfaceCoordinator';
import {
  ensureWritableSessionTicket,
  validateWritableSessionTicket,
  type SessionRuntimeSnapshot,
  type WritableSessionSnapshot,
  type WritableSessionTicket
} from '../writableSessionGate';
import {
  ForumSessionEpochProvider,
  mediaSessionIdentityForSource
} from '../mediaSessionEpoch';

type UserReturnTopic = {
  returnScreen: Exclude<Screen, 'topic'>;
  snapshot: TopicSnapshot;
  backStack: TopicSnapshot[];
};

function useStableTopicLayoutDetail(topicDetail: TopicDetail | null) {
  const stableDetailRef = useRef(topicDetail);
  const stableDetail = hasSameYaohuoTopicLayout(stableDetailRef.current, topicDetail)
    ? stableDetailRef.current
    : topicDetail;
  useLayoutEffect(() => {
    stableDetailRef.current = stableDetail;
  }, [stableDetail]);
  return stableDetail;
}

function useLatestCallback<Arguments extends unknown[], Result>(callback: (...args: Arguments) => Result) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Arguments) => callbackRef.current(...args), []);
}

const NODESEEK_LOGIN_HOSTS = ['nodeseek.com', 'challenges.cloudflare.com'];
const NODEIMAGE_LOGIN_HOSTS = ['nodeimage.com', 'nodeseek.com', 'challenges.cloudflare.com'];
const YAOHUO_LOGIN_HOSTS = ['www.yaohuo.me'];
const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com'];
function sortedRecords(records: Record<string, TopicRecord>) {
  return Object.values(records).sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

const EMPTY_LIBRARY_RECORDS: Record<string, TopicRecord> = {};

function accountIdentityKey(view: {
  site: SessionSite;
  status: string;
  currentUser?: UserProfile;
}) {
  return view.status === 'logged-in' && view.currentUser?.id
    ? `${view.site}:${view.currentUser.id}`
    : `${view.site}:anonymous`;
}

export function AppRoot() {
  const webViewRef = useRef<WebView>(null);
  const yaohuoWebViewRef = useRef<WebView>(null);
  const linuxDoWebViewRef = useRef<WebView>(null);
  const nodeSeekBrowserWebViewRef = useRef<WebView>(null);
  const linuxDoBrowserWebViewRef = useRef<WebView>(null);
  const nodeSeekLoginPanelRequestRef = useRef(0);
  const yaohuoLoginPanelRequestRef = useRef(0);
  const webLoginDetectedRef = useRef(false);
  const checkingRequestIdRef = useRef(0);
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);
  const topicReturnScreenRef = useRef<Exclude<Screen, 'topic'>>('feed');
  const userReturnScreenRef = useRef<Exclude<Screen, 'user'>>('feed');
  const userReturnTopicRef = useRef<UserReturnTopic | null>(null);
  const reopenExistingTopicScreenRef = useRef(false);
  const pendingNavigationScreenRef = useRef<Screen | null>(null);
  const linuxDoWebViewSessionRef = useRef(0);
  const linuxDoPanelClosingSessionRef = useRef<number | null>(null);
  const linuxDoWebViewMountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linuxDoPanelCloseSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTopicRef = useRef<((topic: Topic, refresh?: boolean) => Promise<unknown>) | null>(null);
  const openUserRef = useRef<((user: UserReference) => Promise<unknown>) | null>(null);
  const openImagePreviewRef = useRef<(url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => void>(() => undefined);
  const pendingNodeSeekVerificationRetryRef = useRef<NodeSeekVerificationRetry | null>(null);
  const nodeSeekWebViewUserAgentRef = useRef(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const linuxDoWebViewUserAgentRef = useRef(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const cancelTopicQueriesRef = useRef<() => void>(() => undefined);
  const authSurfaceRegistryRef = useRef(createAuthSurfaceRegistry());
  const linuxDoRecoveryBarrierRef = useRef(false);
  const [authBarrierRevision, setAuthBarrierRevision] = useState(0);
  const [linuxDoRecoveryBarrier, setLinuxDoRecoveryBarrierState] = useState(false);
  const prepareAuthSurfaceOpenRef = useRef<(surface: AuthSurface) => void>(() => undefined);
  const accountIdentityKeysRef = useRef<Record<SessionSite, string>>({
    linuxdo: 'linuxdo:anonymous',
    nodeseek: 'nodeseek:anonymous',
    xiaoyinsi: 'xiaoyinsi:anonymous',
    yaohuo: 'yaohuo:anonymous'
  });
  const accountIdentityPendingRef = useRef<Record<SessionSite, boolean>>({
    ...Object.fromEntries(sessionSources.map((source) => [source, true]))
  } as Record<SessionSite, boolean>);
  const accountIdentityEstablishedRef = useRef<Record<SessionSite, boolean>>({
    ...Object.fromEntries(sessionSources.map((source) => [source, false]))
  } as Record<SessionSite, boolean>);
  const commitAccountIdentityRuntime = useCallback((
    source: SessionSite,
    update: { identityKey?: string; pending: boolean }
  ) => {
    accountIdentityPendingRef.current[source] = update.pending;
    if (update.identityKey) {
      accountIdentityKeysRef.current[source] = update.identityKey;
      if (!update.pending) {
        accountIdentityEstablishedRef.current[source] = true;
      }
    }
  }, []);
  const readSessionRuntimeSnapshot = useCallback((
    source: SessionSite
  ): SessionRuntimeSnapshot => {
    const identityKey = accountIdentityKeysRef.current[source];
    const pending = accountIdentityPendingRef.current[source];
    return {
      source,
      authenticated: identityKey !== `${source}:anonymous`,
      authSurfaceOpen: (
        hasOpenAuthSurfaceForSource(authSurfaceRegistryRef.current, source)
        || (source === 'linuxdo' && linuxDoRecoveryBarrierRef.current)
      ),
      identityKey,
      identityTrust: pending
        ? 'pending'
        : identityKey === `${source}:anonymous`
          ? 'none'
          : 'confirmed',
      sessionEpoch: forumSessionEpochsRef.current[source]
    };
  }, []);
  const forumSessionEpochsRef = useRef<ForumSessionEpochs>(initialForumSessionEpochs);
  const beginAccountIdentityCheckRef = useRef<(
    source: SessionSite,
    surfaceGeneration?: number
  ) => void>(() => undefined);
  const reconcileAccountStatusRef = useRef<(source: SessionSite, options?: {
    surfaceGeneration?: number;
  }) => Promise<AccountReconcileResult>>(async () => ({ status: 'stale' }));
  const showLinuxDoVerificationForTopicRef = useRef<(
    message?: string,
    recovery?: LinuxDoReadRecovery
  ) => void | boolean | Promise<void | boolean>>(() => undefined);
  const showYaohuoLoginForTopicRef = useRef<(message?: string) => void>(() => undefined);
  const nodeSeekTopicVerificationRequiredRef = useRef<(
    message: string,
    recovery: LinuxDoReadRecovery
  ) => void>(() => undefined);
  const showLinuxDoVerificationForTopic = useCallback((message?: string, recovery?: LinuxDoReadRecovery) => (
    showLinuxDoVerificationForTopicRef.current(message, recovery)
  ), []);
  const showYaohuoLoginForTopic = useCallback((message?: string) => showYaohuoLoginForTopicRef.current(message), []);
  const nodeSeekTopicVerificationRequired = useCallback((message: string, recovery: LinuxDoReadRecovery) => (
    nodeSeekTopicVerificationRequiredRef.current(message, recovery)
  ), []);
  const {
    cancelDeferredNavigationTask,
    flushDeferredNavigationTask,
    runAfterNavigationInteractions
  } = useDeferredNavigationTask();
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
  const updateLinuxDoRecoveryBarrier = useCallback((active: boolean) => {
    linuxDoRecoveryBarrierRef.current = active;
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- This is an event callback; the ref must change synchronously before the render signal.
    setLinuxDoRecoveryBarrierState(active);
  }, []);
  const beginAuthSurfaceTicket = useCallback((
    surface: AuthSurface,
    source: SessionSite,
    beginIdentityCheck = true
  ) => {
    const wasOpen = Boolean(authSurfaceRegistryRef.current.active[surface]);
    const ticket = beginAuthSurface(authSurfaceRegistryRef.current, {
      source,
      surface,
      identityKey: accountIdentityKeysRef.current[source],
      sessionEpoch: forumSessionEpochsRef.current[source]
    });
    if (!wasOpen) {
      setAuthBarrierRevision((current) => current + 1);
    }
    if (beginIdentityCheck) {
      beginAccountIdentityCheckRef.current(source, ticket.generation);
    }
    return ticket;
  }, []);
  const finishAuthSurfaceTicket = useCallback((
    surface: AuthSurface,
    reason: AuthSurfaceCloseReason
  ) => {
    const ticket = finishAuthSurface(authSurfaceRegistryRef.current, surface, reason);
    if (ticket) {
      setAuthBarrierRevision((current) => current + 1);
    }
    if (!ticket || !ticket.shouldReconcile) {
      return null;
    }
    const reconciliation = reconcileAccountStatusRef.current(ticket.source, {
      surfaceGeneration: ticket.generation
    }).catch((error): AccountReconcileResult => ({
      status: 'unknown',
      error: errorMessage(error),
      errorInfo: sourceErrorFromUnknown(ticket.source, error)
    }));
    void reconciliation.then((result) => {
      if (result.status === 'changed') {
        const username = result.session?.currentUser?.displayName
          || result.session?.currentUser?.username
          || '新账号';
        notify(`已切换为 ${username}，正在刷新该站数据`);
      } else if (result.status === 'anonymous') {
        notify('已退出登录，已切换为匿名模式');
      } else if (result.status === 'unknown') {
        notify('登录状态待确认；已暂停该站写入，请稍后重试');
      }
    });
    return reconciliation;
  }, [notify]);
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [loadingYaohuoLoginPage, setLoadingYaohuoLoginPage] = useState(true);
  const [loadingLinuxDoPage, setLoadingLinuxDoPage] = useState(true);
  const [linuxDoWebViewError, setLinuxDoWebViewError] = useState('');
  const [linuxDoWebViewKey, setLinuxDoWebViewKey] = useState(0);
  const [linuxDoWebViewUserAgent, setLinuxDoWebViewUserAgent] = useState(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const [mountLinuxDoWebView, setMountLinuxDoWebView] = useState(false);
  const [checking, setChecking] = useState(false);
  const [nodeSeekWebViewUserAgent, setNodeSeekWebViewUserAgent] = useState(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const beginNodeImageAuthSurface = useCallback(() => (
    beginAuthSurfaceTicket('nodeimage-auth', 'nodeseek', false)
  ), [beginAuthSurfaceTicket]);
  const finishNodeImageAuthSurface = useCallback((reason: AuthSurfaceCloseReason) => (
    finishAuthSurfaceTicket('nodeimage-auth', reason)
  ), [finishAuthSurfaceTicket]);
  const prepareNodeImageAuthSurfaceOpen = useCallback(() => {
    prepareAuthSurfaceOpenRef.current('nodeimage-auth');
  }, []);
  const readNodeImageRuntime = useCallback(() => (
    readSessionRuntimeSnapshot('nodeseek')
  ), [readSessionRuntimeSnapshot]);
  const reconcileNodeImageAccount = useCallback((surfaceGeneration: number) => (
    reconcileAccountStatusRef.current('nodeseek', { surfaceGeneration })
  ), []);
  const {
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
  } = useNodeImageAuthController({
    beginSurface: beginNodeImageAuthSurface,
    finishSurface: finishNodeImageAuthSurface,
    notify,
    prepareSurfaceOpen: prepareNodeImageAuthSurfaceOpen,
    readRuntime: readNodeImageRuntime,
    reconcileAccountStatus: reconcileNodeImageAccount
  });
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
  const credentialFailureHandlerRef = useRef<(
    site: CredentialSite,
    attempt: number,
    reason: LoginWebViewFailureReason
  ) => void>(() => undefined);
  const handleCredentialLoginWebViewFailure = useCallback((
    site: CredentialSite,
    attempt: number,
    reason: LoginWebViewFailureReason
  ) => credentialFailureHandlerRef.current(site, attempt, reason), []);
  const credentialClearIntentHandlerRef = useRef<(site: CredentialSite) => void>(() => undefined);
  const handleClearCredentialLoginIntent = useCallback((site: CredentialSite) => {
    credentialClearIntentHandlerRef.current(site);
  }, []);
  const accountStatusInitialRefreshRef = useRef(false);
  const abortTopicReadRequests = useCallback(() => {
    cancelTopicQueriesRef.current();
  }, []);
  const {
    commitReaderData,
    readerData,
    readerDataLoaded,
    readerDataRef,
    replaceReaderData,
    waitForReaderDataSave
  } = useReaderDataController({ notify });

  const resetLinuxDoLevelState = useCallback(() => {
    void appQueryClient.cancelQueries({ queryKey: forumQueryKeys.level('linuxdo') });
    appQueryClient.removeQueries({ queryKey: forumQueryKeys.level('linuxdo') });
  }, []);

  const {
    moreScrollRef,
    requestTabScrollToTop,
    tabScrollToTopSignals
  } = useMainTabScrollToTop();
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const {
    clearHistory,
    removeFollowedUser,
    removeLibraryTopic,
    toggleTopicFavorite,
    toggleUserFollow
  } = useReaderDataActionsController({
    commitReaderData,
    libraryTab,
    readerDataRef
  });
  const { updateSettings } = useReaderSettingsController({ commitReaderData });
  const topicSession = useTopicSessionController({ notify });
  const {
    state: {
      commentQuery,
      debouncedCommentQuery,
      expandedQuotes,
      quoteStateVersion,
      replyComposerOpen,
      replyContent,
      replyEditTarget,
      replyFace,
      replyFilter,
      replyTarget,
      selectedTopic
    },
    commands: {
      composer: topicComposer,
      navigation: topicNavigation,
      topic: topicLifecycle,
      view: topicView
    },
    restore: restoreTopicSnapshot,
    snapshot: topicSnapshot
  } = topicSession;
  const activateTopicRoute = topicNavigation.activateRoute;
  const changeCommentQuery = topicView.changeCommentQuery;
  const changeReplyContent = topicComposer.changeContent;
  const changeReplyFace = topicComposer.changeFace;
  const changeReplyFilter = topicView.changeReplyFilter;
  const clearTopicBackStack = topicNavigation.clearBackStack;
  const clearTopicRoutes = topicNavigation.clearRoutes;
  const editReply = topicComposer.editReply;
  const forgetTopicRoute = topicNavigation.forgetRoute;
  const popTopicBackStack = topicNavigation.popBackStack;
  const readTopicBackStack = topicNavigation.readBackStack;
  const rememberScrollY = topicView.rememberScrollY;
  const replaceTopicBackStack = topicNavigation.replaceBackStack;
  const replyToFloor = topicComposer.replyToFloor;
  const restoreTopicRoute = topicNavigation.restoreRoute;
  const saveTopicRoute = topicNavigation.saveRoute;
  const stopTopicWork = topicLifecycle.stopWork;
  const toggleReplyComposer = topicComposer.toggle;
  const pushTopicScreen = useCallback(() => {
    const routeKey = currentTopicRouteKey();
    if (routeKey) {
      saveTopicRoute(routeKey);
    }
    pushTopicRoute();
  }, [saveTopicRoute]);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const showLoginPanelRef = useRef(showLoginPanel);
  const [showYaohuoLoginPanel, setShowYaohuoLoginPanel] = useState(false);
  const showYaohuoLoginPanelRef = useRef(showYaohuoLoginPanel);
  const [yaohuoLoginPrompt, setYaohuoLoginPrompt] = useState('');
  const [showLinuxDoPanel, setShowLinuxDoPanel] = useState(false);
  const [showNetworkProxyPanel, setShowNetworkProxyPanel] = useState(false);
  const showLinuxDoPanelRef = useRef(showLinuxDoPanel);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  useCommitRefValue(screenRef, screen);
  useCommitRefValue(showLoginPanelRef, showLoginPanel);
  useCommitRefValue(showYaohuoLoginPanelRef, showYaohuoLoginPanel);
  useCommitRefValue(showLinuxDoPanelRef, showLinuxDoPanel);
  const {
    fontFamily,
    fontScale,
    listDensity
  } = readerData.settings;
  const deferredFontScale = useDeferredValue(fontScale);
  const theme = useMemo(() => createTheme(readerData.settings), [readerData.settings.theme]);
  const navigationTheme = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.dark,
      colors: {
        ...base.colors,
        primary: theme.primary,
        background: theme.background,
        card: theme.surface,
        text: theme.ink,
        border: theme.line,
        notification: theme.primary
      }
    };
  }, [theme]);
  const styles = useMemo(
    () => createStyles(theme, { ...readerData.settings, fontScale: deferredFontScale }, height),
    [deferredFontScale, fontFamily, height, listDensity, theme]
  );
  const contentWidth = Math.min(width - 40, contentWidthValue(readerData.settings.contentWidth));
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
  } = useNetworkProxyController({ notify });
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
    if (networkProxyState.enabled && (networkProxyApplyStatus === 'loading' || networkProxyApplyStatus === 'applying')) {
      return;
    }
    setNetworkProxyContentReady(true);
  }, [networkProxyApplyStatus, networkProxyContentReady, networkProxyLoaded, networkProxyState.enabled]);

  const {
    clearLinuxDoLoginState,
    clearNodeSeekLoginState,
    clearYaohuoLoginState,
    commitAccountStatusChange,
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumSessionEpochs,
    forumFetchWithWebViewFallback,
    hiddenBrowserFetchRequests,
    siteSessionStates,
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    updateLinuxDoSession,
    updateNodeSeekSession
  } = useSessionController({
    defaultFetcher: networkProxyFetcher,
    forumSessionEpochsRef,
    linuxDoBrowserWebViewRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    webLoginDetectedRef
  });

  const refreshXiaoyinsiAuthorizationRef = useRef<((
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<boolean | null>) | null>(null);

  const siteSessionViewModels = useMemo(
    () => createSiteSessionViewModels(siteSessionStates),
    [siteSessionStates]
  );
  const sourceGateway = useMemo(() => createSourceGateway({
    currentSessionEpoch: (source) => forumSessionEpochsRef.current[source],
    currentXiaoyinsiCredentialGeneration,
    fetcher: forumFetchWithWebViewFallback,
    isSourceAuthenticated: (source) => readSessionRuntimeSnapshot(source).authenticated,
    isSourceReadBlocked: (source) => {
      const runtime = readSessionRuntimeSnapshot(source);
      return runtime.identityTrust === 'pending' || runtime.authSurfaceOpen;
    },
    linuxDoUserAgent: () => linuxDoWebViewUserAgentRef.current,
    loadXiaoyinsiCredentialsForSource: async (_source, options) => {
      const generation = currentXiaoyinsiCredentialGeneration();
      options?.captureGeneration?.(generation);
      const credentials = await loadXiaoyinsiCredentials();
      return generation === currentXiaoyinsiCredentialGeneration() ? credentials : undefined;
    },
    nodeSeekUserAgent: () => nodeSeekWebViewUserAgentRef.current,
    refreshXiaoyinsiAuthorization: (trace) => refreshXiaoyinsiAuthorizationRef.current?.(trace) ?? Promise.resolve(null)
  }), [
    forumFetchWithWebViewFallback,
    readSessionRuntimeSnapshot
  ]);
  const xiaoyinsiAuthController = useXiaoyinsiAuthController({
    sessionEpochs: forumSessionEpochs,
    dispatchSiteSessionEvent,
    fetcher: networkProxyFetcher,
    isIdentityPending: () => accountIdentityPendingRef.current.xiaoyinsi,
    notify,
    sourceGateway
  });
  useEffect(() => {
    refreshXiaoyinsiAuthorizationRef.current = xiaoyinsiAuthController.refreshAuthorization;
    return () => {
      refreshXiaoyinsiAuthorizationRef.current = null;
    };
  }, [xiaoyinsiAuthController.refreshAuthorization]);

  const {
    accountIdentityChecks,
    accountSessionViewModels,
    beginAccountIdentityCheck,
    identityReconciliationPending,
    reconcileAccountStatus,
    refreshAccountStatus,
    statusBusy
  } = useAccountStatusController({
    sessionEpochs: forumSessionEpochs,
    fetcher: forumFetchWithWebViewFallback,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onAccountIdentityRuntimeChanged: commitAccountIdentityRuntime,
    onAccountStatusChanged: (source, recoveryQueryKey) => {
      commitAccountStatusChange(source, recoveryQueryKey);
    },
    readXiaoyinsiAuthorization: xiaoyinsiAuthController.readAuthorization,
    sessionViewModels: siteSessionViewModels
  });
  useCommitRefValue(beginAccountIdentityCheckRef, beginAccountIdentityCheck);
  useCommitRefValue(reconcileAccountStatusRef, reconcileAccountStatus);
  const accountIdentityKeys = useMemo<Record<SessionSite, string>>(() => ({
    linuxdo: accountIdentityKey(accountSessionViewModels.linuxdo),
    nodeseek: accountIdentityKey(accountSessionViewModels.nodeseek),
    xiaoyinsi: accountIdentityKey(accountSessionViewModels.xiaoyinsi),
    yaohuo: accountIdentityKey(accountSessionViewModels.yaohuo)
  }), [accountSessionViewModels]);
  useCommitRefValue(accountIdentityKeysRef, accountIdentityKeys);
  const accountIdentityPending = useMemo<Record<SessionSite, boolean>>(() => ({
    linuxdo: accountSessionViewModels.linuxdo.identityTrust === 'pending',
    nodeseek: accountSessionViewModels.nodeseek.identityTrust === 'pending',
    xiaoyinsi: accountSessionViewModels.xiaoyinsi.identityTrust === 'pending',
    yaohuo: accountSessionViewModels.yaohuo.identityTrust === 'pending'
  }), [accountSessionViewModels]);
  useCommitRefValue(accountIdentityPendingRef, accountIdentityPending);
  const accountIdentityBarriers = useMemo<ForumIdentityBarrierSource[]>(
    () => sessionSources.filter((source) => {
      const runtime = readSessionRuntimeSnapshot(source);
      return runtime.identityTrust === 'pending' || runtime.authSurfaceOpen;
    }),
    [
      accountIdentityPending,
      authBarrierRevision,
      linuxDoRecoveryBarrier,
      readSessionRuntimeSnapshot
    ]
  );
  const retainableAccountIdentityBarriers = useMemo(
    () => accountIdentityBarriers.filter((source) => accountIdentityEstablishedRef.current[source]),
    [accountIdentityBarriers]
  );
  const {
    cancelTopicQueries,
    loadMoreReplies,
    loadedQuotedReplies,
    loadingMoreReplies,
    loadingQuotedFloors,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    replyHasMore,
    toggleReplyQuote,
    toggleTopicBodyQuote,
    topicBusy,
    topicDetail,
    topicError,
    topicFavorite,
    topicQueryKey,
    topicReplies,
    unreadReplyCount
  } = useTopicController({
    changeScreen,
    commitReaderData,
    identityBarriers: accountIdentityBarriers,
    sessionEpochs: forumSessionEpochs,
    getCurrentScreen,
    notify,
    onNodeSeekTopicVerificationRequired: nodeSeekTopicVerificationRequired,
    pushTopicScreen,
    readerData,
    readerDataRef,
    reopenExistingTopicScreenRef,
    screen,
    showLinuxDoVerification: showLinuxDoVerificationForTopic,
    showYaohuoLogin: showYaohuoLoginForTopic,
    sourceGateway,
    topicReturnScreenRef,
    topicSession
  });
  const selectedTopicIdentityCheck = selectedTopic?.source === 'linuxdo'
    ? accountIdentityChecks.linuxdo
    : undefined;
  const topicIdentityError = selectedTopicIdentityCheck?.pending
    ? selectedTopicIdentityCheck.error
    : undefined;
  useCommitRefValue(cancelTopicQueriesRef, cancelTopicQueries);
  const topicLayoutDetail = useStableTopicLayoutDetail(topicDetail);
  const mediaSessionIdentity = mediaSessionIdentityForSource(
    selectedTopic?.source,
    forumSessionEpochs
  );
  const selectedLibraryRecords = libraryTab === 'history'
    ? readerData.history
    : libraryTab === 'favorites'
      ? readerData.favorites
      : EMPTY_LIBRARY_RECORDS;
  const libraryRecords = useMemo(() => sortedRecords(selectedLibraryRecords), [selectedLibraryRecords]);
  const openExternalUrl = useCallback((url: string) => {
    if (!isHttpOrHttpsUrl(url)) {
      notify('仅支持打开 http/https 链接。');
      return;
    }
    void Linking.openURL(url).catch((error) => notify(errorMessage(error)));
  }, [notify]);
  const openImagePreviewFromRenderer = useCallback((url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => {
    openImagePreviewRef.current(url, displaySize, renderedPosterUri);
  }, []);
  const openTopicFromHtml = useCallback((topic: Topic) => {
    void openTopicRef.current?.(topic);
  }, []);
  const openUserFromHtml = useCallback((user: UserReference) => {
    void openUserRef.current?.(user);
  }, []);
  const {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    topicImageDeriver
  } = useHtmlRenderingController({
    mediaSessionIdentity,
    onOpenExternalUrl: openExternalUrl,
    onOpenImagePreview: openImagePreviewFromRenderer,
    onOpenTopic: openTopicFromHtml,
    onOpenUser: openUserFromHtml,
    nodeSeekMediaUserAgent: nodeSeekWebViewUserAgent,
    selectedTopic,
    settings: readerData.settings,
    styles,
    theme,
    topicDetail,
    topicKey: `${selectedTopic?.source || ''}:${selectedTopic?.id || ''}`,
    webViewBlockMessage: networkProxyWebViewBlockMessage
  });
  const filteredReplies = useMemo(() => filterTopicSessionReplies({
    commentQuery: debouncedCommentQuery,
    inlineSizedImageUrls,
    replyFilter,
    topicDetail: topicLayoutDetail,
    topicImageDeriver,
    topicReplies
  }), [debouncedCommentQuery, inlineSizedImageUrls, replyFilter, topicImageDeriver, topicLayoutDetail, topicReplies]);
  const getTopicHtmlParts = useCallback(() => [
    topicDetail?.contentHtml || '',
    ...topicReplies.map(replyHtmlWithSignature),
    ...Object.values(loadedQuotedReplies).map(replyHtmlWithSignature)
  ].filter(Boolean), [loadedQuotedReplies, topicDetail?.contentHtml, topicReplies]);
  const {
    closeImagePreview,
    imagePreview,
    openImagePreview,
    savePreviewImage,
    selectPreviewImage
  } = useImagePreviewController({
    beforeSave: ensureNetworkProxyReady,
    contentSource: selectedTopic?.source || null,
    contentWidth,
    fetcher: networkProxyFetcher,
    htmlParts: getTopicHtmlParts,
    inlineSizedImageUrls,
    nodeSeekMediaUserAgent: nodeSeekWebViewUserAgent,
    notify,
    topicImageDeriver
  });
  useCommitRefValue(openImagePreviewRef, openImagePreview);
  const handleLoginNavigation = useCallback((request: LoginNavigationRequest, allowedHosts: string[]) => {
    if (shouldOpenLoginWebViewUrl(request.url, allowedHosts)) {
      return true;
    }
    if (isHttpOrHttpsUrl(request.url)) {
      openExternalUrl(request.url);
    }
    return false;
  }, [openExternalUrl]);
  const handleNodeSeekLoginNavigation = useCallback((request: LoginNavigationRequest) => (
    handleLoginNavigation(request, NODESEEK_LOGIN_HOSTS)
  ), [handleLoginNavigation]);
  const handleNodeImageAuthNavigation = useCallback((request: LoginNavigationRequest) => (
    handleLoginNavigation(request, NODEIMAGE_LOGIN_HOSTS)
  ), [handleLoginNavigation]);
  const handleYaohuoLoginNavigation = useCallback((request: LoginNavigationRequest) => (
    handleLoginNavigation(request, YAOHUO_LOGIN_HOSTS)
  ), [handleLoginNavigation]);
  const handleLinuxDoNavigation = useCallback((request: LoginNavigationRequest) => (
    handleLoginNavigation(request, LINUXDO_LOGIN_HOSTS)
  ), [handleLoginNavigation]);
  useEffect(() => () => {
    abortTopicReadRequests();
    cancelDeferredNavigationTask();
  }, [abortTopicReadRequests, cancelDeferredNavigationTask]);
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(readerData), [
    readerData.favorites,
    readerData.history,
    readerData.settings.listDensity
  ]);
  const closeYaohuoLoginPanel = useCallback((
    reason: AuthSurfaceCloseReason = 'close-button'
  ) => {
    if (!showYaohuoLoginPanelRef.current) {
      return;
    }
    showYaohuoLoginPanelRef.current = false;
    handleClearCredentialLoginIntent('yaohuo');
    yaohuoLoginPanelRequestRef.current += 1;
    yaohuoWebViewRef.current?.stopLoading();
    setShowYaohuoLoginPanel(false);
    setYaohuoLoginPrompt('');
    setLoadingYaohuoLoginPage(false);
    finishAuthSurfaceTicket('yaohuo-login', reason);
  }, [finishAuthSurfaceTicket, handleClearCredentialLoginIntent]);

  const changeYaohuoLoginPanel = useCallback((
    visible: boolean,
    closeReason: AuthSurfaceCloseReason = 'close-button'
  ) => {
    if (visible) {
      if (showYaohuoLoginPanelRef.current) {
        return;
      }
      prepareAuthSurfaceOpenRef.current('yaohuo-login');
      showYaohuoLoginPanelRef.current = true;
      beginAuthSurfaceTicket('yaohuo-login', 'yaohuo');
      yaohuoLoginPanelRequestRef.current += 1;
      setLoadingYaohuoLoginPage(true);
      setShowYaohuoLoginPanel(true);
      yaohuoWebViewRef.current?.reload();
      return;
    }
    closeYaohuoLoginPanel(closeReason);
  }, [beginAuthSurfaceTicket, closeYaohuoLoginPanel]);

  const changeNodeSeekLoginPanel = useCallback((
    visible: boolean,
    closeReason: AuthSurfaceCloseReason = 'close-button'
  ) => {
    const wasVisible = showLoginPanelRef.current;
    if (visible === wasVisible) {
      return;
    }
    if (visible) {
      prepareAuthSurfaceOpenRef.current('nodeseek-login');
    }
    showLoginPanelRef.current = visible;
    nodeSeekLoginPanelRequestRef.current += 1;
    if (visible) {
      beginAuthSurfaceTicket('nodeseek-login', 'nodeseek');
    } else {
      handleClearCredentialLoginIntent('nodeseek');
      pendingNodeSeekVerificationRetryRef.current = null;
    }
    webViewRef.current?.stopLoading();
    setLoadingLoginPage(visible);
    setShowLoginPanel(visible);
    if (!visible) {
      finishAuthSurfaceTicket('nodeseek-login', closeReason);
    }
  }, [beginAuthSurfaceTicket, finishAuthSurfaceTicket, handleClearCredentialLoginIntent]);

  const showYaohuoLogin = useCallback((message = '请先登录妖火。') => {
    changeScreen('more');
    setYaohuoLoginPrompt(message);
    changeYaohuoLoginPanel(true);
    notify(message);
  }, [changeScreen, changeYaohuoLoginPanel, notify]);
  useCommitRefValue(showYaohuoLoginForTopicRef, showYaohuoLogin);

  const {
    changeLinuxDoPanel,
    checkLinuxDoCookie,
    closeLinuxDoPanel,
    handleLinuxDoMessage,
    resetLinuxDoWebView,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    showLinuxDoVerification,
    showNodeSeekVerification,
    stopLinuxDoVerificationForInactiveApp,
    verifyLinuxDoFromTopic
  } = useVerificationController({
    changeNodeSeekLoginPanel,
    checkingRequestIdRef,
    closeYaohuoLoginPanel,
    linuxDoPanelClosingSessionRef,
    linuxDoPanelCloseSettleTimerRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    linuxDoIdentityPending: accountIdentityChecks.linuxdo.pending,
    notify,
    onBeforeLinuxDoSurfaceOpened: () => {
      prepareAuthSurfaceOpenRef.current('linuxdo-login');
    },
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    onLinuxDoRecoveryBarrierChanged: updateLinuxDoRecoveryBarrier,
    onLinuxDoSurfaceClosed: ({ authoritativeResult, reason }) => {
      finishAuthSurfaceTicket(
        'linuxdo-login',
        authoritativeResult ? 'authoritative-recovery' : reason
      );
    },
    onLinuxDoSurfaceOpened: () => {
      beginAuthSurfaceTicket('linuxdo-login', 'linuxdo');
    },
    openTopicRef,
    reconcileAccountStatus: (source) => reconcileAccountStatusRef.current(source),
    selectedTopic,
    setChecking,
    setLinuxDoWebViewError,
    setLinuxDoWebViewKey,
    setLinuxDoWebViewUserAgent,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    changeScreen,
    setShowLinuxDoPanel,
    setShowSettingsPanel,
    showLinuxDoPanelRef,
    topicDetail,
    updateLinuxDoSession,
    updateNodeSeekSession
  });
  const prepareAuthSurfaceOpen = useCallback((openingSurface: AuthSurface) => {
    closeOtherAuthSurfaces(openingSurface, {
      'linuxdo-login': (reason) => closeLinuxDoPanel(true, reason),
      'nodeimage-auth': closeNodeImageAuthPanel,
      'nodeseek-login': (reason) => changeNodeSeekLoginPanel(false, reason),
      'yaohuo-login': closeYaohuoLoginPanel
    });
  }, [
    changeNodeSeekLoginPanel,
    closeLinuxDoPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel
  ]);
  useCommitRefValue(prepareAuthSurfaceOpenRef, prepareAuthSurfaceOpen);
  useCommitRefValue(showLinuxDoVerificationForTopicRef, showLinuxDoVerification);
  const previousLinuxDoPanelVisibleRef = useRef(showLinuxDoPanel);
  useEffect(() => {
    if (previousLinuxDoPanelVisibleRef.current && !showLinuxDoPanel) {
      handleClearCredentialLoginIntent('linuxdo');
    }
    previousLinuxDoPanelVisibleRef.current = showLinuxDoPanel;
  }, [handleClearCredentialLoginIntent, showLinuxDoPanel]);

  const handleNodeSeekSearchVerificationRequired = useCallback((message: string, recovery: LinuxDoReadRecovery) => {
    pendingNodeSeekVerificationRetryRef.current = { type: 'search', recovery };
    showNodeSeekVerification(message);
  }, [showNodeSeekVerification]);

  const handleNodeSeekTopicVerificationRequired = useCallback((message: string, recovery: LinuxDoReadRecovery) => {
    pendingNodeSeekVerificationRetryRef.current = {
      type: 'topic',
      recovery
    };
    updateNodeSeekSession({ type: 'verification-required', message });
  }, [updateNodeSeekSession]);
  useCommitRefValue(nodeSeekTopicVerificationRequiredRef, handleNodeSeekTopicVerificationRequired);

  const handleNodeSeekUserVerificationRequired = useCallback((message = 'NodeSeek 需要完成 Cloudflare 验证', recovery?: LinuxDoReadRecovery) => {
    if (recovery) {
      pendingNodeSeekVerificationRetryRef.current = { type: 'user', recovery };
    }
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater
    showNodeSeekVerification(message);
  }, [showNodeSeekVerification]);

  const {
    checkNodeSeekAccount,
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
  } = useAccountController({
    checkingRequestIdRef,
    clearLinuxDoLoginState,
    clearNodeSeekLoginState,
    clearYaohuoLoginState,
    sessionEpochs: forumSessionEpochs,
    nodeSeekLoginPanelRequestRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    linuxDoVerificationActive: showLinuxDoPanel,
    linuxDoIdentityPending: accountIdentityPending.linuxdo,
    resetLinuxDoLevelState,
    resetLinuxDoWebView,
    reconcileAccountStatus: (source) => reconcileAccountStatusRef.current(source),
    setChecking,
    setNodeSeekWebViewUserAgent,
    screen,
    showLinuxDoVerification,
    sourceGateway,
    showLoginPanelRef,
    showYaohuoLoginPanel,
    webViewRef,
    yaohuoLoginPanelRequestRef,
    yaohuoWebViewRef
  });

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
    changeNodeSeekLoginPanel(false, 'navigation-away');
    closeNodeImageAuthPanel('navigation-away');
    closeYaohuoLoginPanel('navigation-away');
    closeLinuxDoPanel(true, 'navigation-away');
    setShowNetworkProxyPanel(false);
    setShowSettingsPanel(false);
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]);

  const effectiveNodeSeekUserId = nodeSeekUserIdForSession(
    accountSessionViewModels.nodeseek,
    webLoginUserId
  );
  const nodeSeekCurrentUserForTopicActions = accountSessionViewModels.nodeseek.currentUser;
  const readWritableSessionSnapshot = useCallback((
    source: SessionSite
  ): WritableSessionSnapshot => readSessionRuntimeSnapshot(source), [readSessionRuntimeSnapshot]);
  const reconcileWritableSession = useCallback(async (source: SessionSite) => {
    return reconcileAccountStatusRef.current(source);
  }, []);
  const ensureWritableSession = useCallback((source: SessionSite) => (
    ensureWritableSessionTicket(
      () => readWritableSessionSnapshot(source),
      () => reconcileWritableSession(source)
    )
  ), [readWritableSessionSnapshot, reconcileWritableSession]);
  const isWritableSessionTicketCurrent = useCallback((ticket: WritableSessionTicket) => (
    validateWritableSessionTicket(ticket, readWritableSessionSnapshot(ticket.source))
  ), [readWritableSessionSnapshot]);
  const displayReplies = useMemo(
    () => markCurrentNodeSeekOwnRepliesUnlikable(filteredReplies, nodeSeekCurrentUserForTopicActions, effectiveNodeSeekUserId),
    [effectiveNodeSeekUserId, filteredReplies, nodeSeekCurrentUserForTopicActions]
  );
  useEffect(() => {
    if (!readerDataLoaded || accountStatusInitialRefreshRef.current) {
      return;
    }
    accountStatusInitialRefreshRef.current = true;
    void refreshAccountStatus({ silent: true });
  }, [readerDataLoaded, refreshAccountStatus]);

  const {
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy,
    feedFilter,
    feedOutcomeKind,
    feedScenePreviews,
    feedSource,
    loadFeed,
    readingFilter,
    refreshFeed,
    setCategoryFilter,
    setFeedFilter,
    setReadingFilter,
    shownFeedItems
  } = useFeedController({
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
    showNodeSeekVerification,
    showYaohuoLogin,
    sourceGateway
  });
  const feedIdentityCheck = feedSource === 'linuxdo'
    ? accountIdentityChecks.linuxdo
    : undefined;
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
    onNodeSeekSearchVerificationRequired: handleNodeSeekSearchVerificationRequired,
    screen,
    sessionViewModels: accountSessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin,
    sourceGateway
  });
  const searchIdentityCheck = searchSource === 'linuxdo'
    ? accountIdentityChecks.linuxdo
    : undefined;
  const searchIdentityError = searchIdentityCheck?.pending ? searchIdentityCheck.error : undefined;

  const {
    backupBusy,
    exportBackupFile,
    importBackupFile
  } = useBackupStatusController({
    notify,
    readerDataRef,
    replaceReaderData,
    waitForReaderDataSave
  });
  const diagnosticMetadata = useMemo(() => ({
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
    theme: theme.dark ? 'dark' as const : 'light' as const,
    versionCode: CURRENT_ANDROID_VERSION_CODE,
    yaohuoSession: accountSessionViewModels.yaohuo.status,
    xiaoyinsiSession: accountSessionViewModels.xiaoyinsi.status
  }), [
    fontScale,
    height,
    networkProxyState.enabled,
    screen,
    accountSessionViewModels,
    theme.dark,
    width
  ]);
  const {
    diagnosticBusy,
    exportDiagnosticLogFile
  } = useDiagnosticLogController({ getCurrentScreen, metadata: diagnosticMetadata, notify });
  const {
    appUpdateBusy,
    appUpdateDownloading,
    appUpdateDownloadProgress,
    appUpdateInfo,
    appUpdateMessage,
    checkAppUpdate,
    downloadAppUpdate
  } = useAppUpdateController({ beforeRequest: ensureNetworkProxyReady, fetcher: networkProxyFetcher, notify });
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
    if (nextScreen === 'topic' && routeKey) {
      if (!restoreTopicRoute(routeKey)) {
        activateTopicRoute(routeKey);
        markDiagnosticStage(trace, 'apply', { state: 'topic-route-activated' });
      } else {
        markDiagnosticStage(trace, 'apply', { state: 'topic-route-restored' });
      }
    }
    if (previousScreen === nextScreen) {
      finishDiagnosticTrace(trace, 'noop', { state: 'same-screen' });
      return;
    }
    const leavingTopicForUser = previousScreen === 'topic' && nextScreen === 'user';
    if (previousScreen === 'more' && nextScreen !== 'more') {
      closeMorePanels();
    }
    if (leavingTopicForUser) {
      abortTopicReadRequests();
      stopTopicWork();
    }
    if (nextScreen !== 'topic' && !leavingTopicForUser) {
      clearTopicBackStack();
      clearTopicRoutes();
      abortTopicReadRequests();
      stopTopicWork();
    }
    if (nextScreen !== 'user' && nextScreen !== 'topic') {
      userReturnTopicRef.current = null;
    }
    screenRef.current = nextScreen;
    if (shouldUpdateAppRootScreen(previousScreen, nextScreen)) {
      setScreen(nextScreen);
    }
    finishDiagnosticTrace(trace, 'success', { state: 'applied' });
  }, [abortTopicReadRequests, activateTopicRoute, clearTopicBackStack, clearTopicRoutes, closeMorePanels, restoreTopicRoute, stopTopicWork]);

  const checkNodeSeekLoginAndRetry = useCallback(async () => {
    const checkRequest = nodeSeekLoginPanelRequestRef.current;
    const accountResult = await checkNodeSeekAccount();
    if (nodeSeekLoginPanelRequestRef.current !== checkRequest) {
      return false;
    }
    if (accountResult.status === 'changed') {
      const retry = takeNodeSeekVerificationRetry(pendingNodeSeekVerificationRetryRef);
      changeNodeSeekLoginPanel(false, 'authoritative-recovery');
      if (retry) {
        changeScreen(retry.type);
      }
      return false;
    }
    if (accountResult.status !== 'same') {
      return false;
    }
    const retry = takeNodeSeekVerificationRetry(pendingNodeSeekVerificationRetryRef);
    changeNodeSeekLoginPanel(false, 'authoritative-recovery');
    if (!retry) {
      return true;
    }
    const recoveryRequest = nodeSeekLoginPanelRequestRef.current;
    setChecking(true);
    let outcome: LinuxDoReadResumeOutcome = 'failed';
    try {
      outcome = await retry.recovery.resume();
    } catch (error) {
      if (nodeSeekLoginPanelRequestRef.current === recoveryRequest) {
        notify(`NodeSeek 身份已确认，但原页面恢复失败：${errorMessage(error)}`);
      }
    } finally {
      if (nodeSeekLoginPanelRequestRef.current === recoveryRequest) {
        setChecking(false);
      }
    }
    if (nodeSeekLoginPanelRequestRef.current !== recoveryRequest) {
      return false;
    }
    if (outcome === 'verification-required') {
      const queryIsActive = appQueryClient.getQueryCache().find({
        queryKey: retry.recovery.queryKey,
        exact: true
      })?.isActive() === true;
      if (queryIsActive && !pendingNodeSeekVerificationRetryRef.current) {
        pendingNodeSeekVerificationRetryRef.current = retry;
        showNodeSeekVerification('NodeSeek 验证仍未生效，请继续验证后再次检测。');
      }
      updateNodeSeekSession({
        type: 'verification-required',
        message: 'NodeSeek 验证仍未生效，请继续验证后再次检测。'
      });
      return false;
    }
    if (outcome !== 'completed') {
      if (outcome === 'failed') {
        notify('NodeSeek 身份已确认，但原页面恢复失败，请返回原页面重试。');
      }
      changeScreen(retry.type);
      return false;
    }
    changeScreen(retry.type);
    return true;
  }, [
    changeNodeSeekLoginPanel,
    changeScreen,
    checkNodeSeekAccount,
    notify,
    setChecking,
    showNodeSeekVerification,
    updateNodeSeekSession
  ]);

  const prepareUserNavigation = useCallback(() => {
    const currentScreen = screenRef.current;
    const routeKey = currentTopicRouteKey();
    if (routeKey) {
      saveTopicRoute(routeKey);
    }
    if (currentScreen !== 'user') {
      userReturnScreenRef.current = currentScreen;
    }
    if (currentScreen === 'topic') {
      userReturnTopicRef.current = {
        returnScreen: topicReturnScreenRef.current,
        snapshot: topicSnapshot(),
        backStack: readTopicBackStack()
      };
    } else if (currentScreen !== 'user') {
      userReturnTopicRef.current = null;
    }
    changeScreen('user');
  }, [changeScreen, readTopicBackStack, saveTopicRoute, topicSnapshot]);

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
    showNodeSeekVerification: handleNodeSeekUserVerificationRequired,
    sourceGateway,
    showYaohuoLogin
  });
  const selectedUserIdentityCheck = selectedUser?.source === 'linuxdo'
    ? accountIdentityChecks.linuxdo
    : undefined;
  const userIdentityError = selectedUserIdentityCheck?.pending
    ? selectedUserIdentityCheck.error
    : undefined;
  const linuxDoForegroundReadIntent = useMemo(() => {
    if (screen === 'topic' && selectedTopic?.source === 'linuxdo') {
      return `topic:${selectedTopic.id}`;
    }
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
  }, [categoryFilter, feedFilter, feedSource, screen, searchFilters.linuxdo, searchSource, selectedTopic, selectedUser, submittedSearchQuery]);
  const linuxDoForegroundReadBlocked = screen === 'topic'
    ? !(topicDetail?.source === 'linuxdo' && topicDetail.id === selectedTopic?.id)
    : screen === 'feed'
      ? shownFeedItems.length === 0
      : screen === 'search'
        ? !searchGroups.some((group) => group.source === 'linuxdo' && group.items.length > 0)
        : screen === 'user'
          ? !userProfile
          : false;
  useCommitRefValue(openUserRef, openUser);

  const showLinuxDoLogin = useCallback((message = '匿名可阅读，登录后才能互动。') => {
    changeScreen('more');
    setShowSettingsPanel(false);
    notify(message);
    changeLinuxDoPanel(true);
  }, [changeLinuxDoPanel, changeScreen, notify]);
  const showXiaoyinsiLogin = useCallback((message = '匿名可阅读，授权后才能互动。') => {
    changeScreen('more');
    changeNodeSeekLoginPanel(false, 'switch-surface');
    closeNodeImageAuthPanel('switch-surface');
    closeYaohuoLoginPanel('switch-surface');
    closeLinuxDoPanel(true, 'switch-surface');
    setShowSettingsPanel(false);
    notify(message);
    void xiaoyinsiAuthController.beginAuthorization();
  }, [
    changeNodeSeekLoginPanel,
    changeScreen,
    closeLinuxDoPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel,
    notify,
    xiaoyinsiAuthController
  ]);

  useCommitRefValue(openTopicRef, openTopic);

  useEffect(() => {
    const openInternalTopic = (url: string | null) => {
      const topic = url ? parseInternalTopicOpenLink(url) : null;
      if (topic) {
        void openTopicRef.current?.(topic);
      }
    };
    const subscription = Linking.addEventListener('url', ({ url }) => openInternalTopic(url));
    void Linking.getInitialURL().then(openInternalTopic).catch(() => undefined);
    return () => subscription.remove();
  }, []);

  const verifyNodeSeekFromTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source !== 'nodeseek') {
      return;
    }
    if (pendingNodeSeekVerificationRetryRef.current?.type !== 'topic') {
      pendingNodeSeekVerificationRetryRef.current = {
        type: 'topic',
        recovery: {
          queryKey: topicQueryKey,
          resume: refreshWholeTopic
        }
      };
    }
    showNodeSeekVerification(topicError?.message || 'NodeSeek 需要完成 Cloudflare 验证');
  }, [refreshWholeTopic, selectedTopic, showNodeSeekVerification, topicDetail, topicError, topicQueryKey]);

  const discourseActionRuntimeDependencies = useMemo(() => ({
    linuxDoUserAgent: () => linuxDoWebViewUserAgentRef.current,
    refreshXiaoyinsiAuthorization: xiaoyinsiAuthController.refreshAuthorization,
    resetLinuxDoLevelState,
    updateLinuxDoSession
  }), [resetLinuxDoLevelState, updateLinuxDoSession, xiaoyinsiAuthController.refreshAuthorization]);
  const discourseLoginPrompts = useMemo(() => ({
    linuxdo: showLinuxDoLogin,
    xiaoyinsi: showXiaoyinsiLogin
  }), [showLinuxDoLogin, showXiaoyinsiLogin]);

  const {
    actionBusy,
    bookmarkOnDiscourseSite,
    checkIn,
    collectOnNodeSeekSite,
    deleteReply,
    favoriteOnYaohuoSite,
    interact,
    optimisticTopicActions,
    sourceActionAvailability,
    submitReply,
    uploadReplyImage,
    votePoll
  } = useTopicActionsController({
    sessionEpochs: forumSessionEpochs,
    discourseActionRuntimeDependencies,
    discourseLoginPrompts,
    ensureWritableSession,
    fetcher: networkProxyFetcher,
    isWritableSessionTicketCurrent,
    nodeSeekWebViewUserAgentRef,
    ensureNodeImageApiKey,
    notify,
    reconcileWritableSession,
    refreshTopicReplies,
    siteSessionViewModels: accountSessionViewModels,
    topicDetail,
    topicReplies,
    topicSession
  });
  useLinuxDoIdentityVerificationPrompt({
    enabled: appActive && !actionBusy && !linuxDoAiVisible && linuxDoForegroundReadBlocked,
    error: accountIdentityChecks.linuxdo.error,
    identityPending: accountIdentityChecks.linuxdo.pending,
    intentKey: linuxDoForegroundReadIntent,
    showLinuxDoVerification
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
      emptyReason = !submittedSearchQuery ? 'not-started' : isBusy ? 'loading' : hasError && !itemCount ? 'source-error' : itemCount ? 'none' : 'no-results';
    } else if (currentScreen === 'library') {
      itemCount = libraryTab === 'users' ? followedUserRecords.length : libraryRecords.length;
      isBusy = !readerDataLoaded;
      emptyReason = isBusy ? 'not-loaded' : itemCount ? 'none' : 'no-items';
    } else if (currentScreen === 'more') {
      itemCount = 1;
      isBusy = backupBusy || diagnosticBusy || appUpdateBusy || appUpdateDownloading || statusBusy;
    } else if (currentScreen === 'topic') {
      itemCount = topicReplies.length;
      isBusy = topicBusy || loadingMoreReplies;
      hasError = Boolean(topicError);
      emptyReason = isBusy ? 'loading' : hasError ? 'load-failed' : topicDetail ? (itemCount ? 'none' : 'no-replies') : 'no-topic';
    } else {
      itemCount = (userProfile?.topics?.length || 0) + (userProfile?.replies?.length || 0);
      isBusy = userBusy || userLoadingMoreTopics || userLoadingMoreReplies;
      hasError = Boolean(userError);
      emptyReason = isBusy ? 'loading' : hasError ? 'load-failed' : userProfile ? (itemCount ? 'none' : 'no-items') : 'no-user';
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
    loadingMoreReplies,
    readerDataLoaded,
    screen,
    searchBusy,
    searchGroups,
    shownFeedItems.length,
    statusBusy,
    submittedSearchQuery,
    topicBusy,
    topicDetail,
    topicError,
    topicReplies.length,
    userBusy,
    userError,
    userLoadingMoreReplies,
    userLoadingMoreTopics,
    userProfile
  ]);

  const shareTopic = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail?.url) {
      return;
    }
    await shareTopicWithClipboardFallback({
      copy: async () => { await Clipboard.setStringAsync(detail.url); },
      notify,
      share: async () => {
        await Share.share({
          title: detail.title,
          message: `${detail.title}\n${detail.url}`,
          url: detail.url
        });
      }
    });
  }, [notify, selectedTopic, topicDetail]);

  const goBackFromTopic = useCallback((parentTrace?: DiagnosticTrace) => {
    const trace = parentTrace || beginDiagnosticTrace('navigation', 'topic-back');
    cancelDeferredNavigationTask();
    const closingRouteKey = currentTopicRouteKey();
    const returningRouteKey = previousTopicRouteKey();
    const previousTopic = popTopicBackStack();
    const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();
    const strategy = selectTopicReturnStrategy({
      canGoBack,
      hasReturningTopicRoute: Boolean(returningRouteKey),
      hasSnapshot: Boolean(previousTopic)
    });
    markDiagnosticStage(trace, 'guard', {
      canGoBack,
      hasRoute: Boolean(returningRouteKey),
      hasSnapshot: Boolean(previousTopic),
      strategy
    });
    abortTopicReadRequests();
    if (closingRouteKey) {
      forgetTopicRoute(closingRouteKey);
    }
    const state = executeTopicReturnStrategy({
      canGoBack,
      strategy,
      goBack: () => navigationRef.goBack(),
      restoreSnapshot: () => {
        if (previousTopic) restoreTopicSnapshot(previousTopic);
      },
      returnToScreen: () => changeScreen(topicReturnScreenRef.current)
    });
    finishDiagnosticTrace(trace, 'success', { state });
  }, [abortTopicReadRequests, cancelDeferredNavigationTask, changeScreen, forgetTopicRoute, popTopicBackStack, restoreTopicSnapshot]);

  const goBackFromUser = useCallback((parentTrace?: DiagnosticTrace) => {
    const trace = parentTrace || beginDiagnosticTrace('navigation', 'user-back');
    cancelDeferredNavigationTask();
    const returnTopic = userReturnScreenRef.current === 'topic' ? userReturnTopicRef.current : null;
    const returningRouteKey = previousTopicRouteKey();
    const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();
    const strategy = selectTopicReturnStrategy({
      canGoBack,
      hasReturningTopicRoute: Boolean(returningRouteKey),
      hasSnapshot: Boolean(returnTopic)
    });
    const restoreReturnTopicMetadata = () => {
      if (!returnTopic) {
        return;
      }
      topicReturnScreenRef.current = returnTopic.returnScreen;
      replaceTopicBackStack(returnTopic.backStack);
      userReturnTopicRef.current = null;
    };
    const restoreReturnTopicFallback = () => {
      if (!returnTopic) {
        return;
      }
      restoreReturnTopicMetadata();
      restoreTopicSnapshot(returnTopic.snapshot);
    };
    markDiagnosticStage(trace, 'guard', {
      canGoBack,
      hasRoute: Boolean(returningRouteKey),
      hasSnapshot: Boolean(returnTopic),
      strategy
    });
    const restoreFallback = () => {
      if (returnTopic) {
        restoreReturnTopicFallback();
        const selectedReturnTopic = returnTopic.snapshot.selectedTopic;
        if (!selectedReturnTopic) return;
        reopenExistingTopicScreenRef.current = true;
        void openTopic(selectedReturnTopic);
      }
    };
    const state = executeUserReturnStrategy({
      canGoBack,
      strategy,
      goBack: () => navigationRef.goBack(),
      restoreFallback,
      returnToScreen: () => changeScreen(userReturnScreenRef.current),
      scheduleFallbackRestore: () => runAfterNavigationInteractions(restoreFallback),
      scheduleMetadataRestore: () => runAfterNavigationInteractions(restoreReturnTopicMetadata)
    });
    const isDeferred = strategy === 'route-pop' || (strategy === 'snapshot-fallback' && canGoBack);
    finishDiagnosticTrace(trace, isDeferred ? 'partial' : 'success', { state });
  }, [cancelDeferredNavigationTask, changeScreen, openTopic, replaceTopicBackStack, restoreTopicSnapshot, runAfterNavigationInteractions]);

  const handleTopicScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    rememberScrollY(event.nativeEvent.contentOffset.y);
  }, [rememberScrollY]);

  const {
    handleLinuxDoBrowserFetchMessage,
    handleNodeSeekBrowserFetchMessage
  } = useHiddenBrowserFetchController({
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch
  });

  const openReadingSettingsFromTopic = useCallback(() => {
    changeNodeSeekLoginPanel(false, 'navigation-away');
    closeYaohuoLoginPanel('navigation-away');
    closeLinuxDoPanel(true, 'navigation-away');
    openReadingSettingsFromCurrentTopic(saveTopicRoute);
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeYaohuoLoginPanel, saveTopicRoute]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const currentScreen = screenRef.current;
      const trace = beginDiagnosticTrace('navigation', 'hardware-back', { screen: currentScreen });
      const handled = (state: string) => {
        markDiagnosticStage(trace, 'guard', { state });
        finishDiagnosticTrace(trace, 'success', { state });
        return true;
      };
      if (imagePreview) {
        closeImagePreview();
        return handled('image-preview-closed');
      }
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
      if (isReadingSettingsScreen()) {
        navigationRef.goBack();
        return handled('reading-settings-closed');
      }
      if (showSettingsPanel) {
        setShowSettingsPanel(false);
        return handled('settings-panel-closed');
      }
      if (shouldCloseReplyComposerOnBack(currentScreen, replyComposerOpen)) {
        toggleReplyComposer(false);
        return handled('reply-composer-closed');
      }
      if (currentScreen === 'topic') {
        markDiagnosticStage(trace, 'guard', { state: 'topic-back' });
        goBackFromTopic(trace);
        return true;
      }
      if (currentScreen === 'user') {
        markDiagnosticStage(trace, 'guard', { state: 'user-back' });
        goBackFromUser(trace);
        return true;
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
    closeImagePreview,
    changeScreen,
    changeNodeSeekLoginPanel,
    closeNodeImageAuthPanel,
    closeYaohuoLoginPanel,
    goBackFromTopic,
    goBackFromUser,
    imagePreview,
    closeLinuxDoPanel,
    showLoginPanel,
    showNodeImageAuthPanel,
    showLinuxDoPanel,
    showYaohuoLoginPanel,
    replyComposerOpen,
    showSettingsPanel,
    toggleReplyComposer
  ]);

  const handleNavigationReady = useCallback(() => {
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

  const runCurrentSearch = useCallback((queryOverride?: string) => {
    void runSearch(queryOverride === undefined ? undefined : { query: queryOverride });
  }, [runSearch]);

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
  const refreshCurrentTopic = useCallback(() => {
    if (topicIdentityError && selectedTopic?.source === 'linuxdo') {
      void reconcileAccountStatus('linuxdo');
      return;
    }
    void refreshWholeTopic();
  }, [reconcileAccountStatus, refreshWholeTopic, selectedTopic, topicIdentityError]);
  const refreshCurrentUser = useCallback(() => {
    if (userIdentityError && selectedUser?.source === 'linuxdo') {
      void reconcileAccountStatus('linuxdo');
      return;
    }
    void refreshUser();
  }, [reconcileAccountStatus, refreshUser, selectedUser, userIdentityError]);

  const {
    clearCredentialLoginIntent,
    credentialFillAttempt,
    credentialLoginSite,
    credentialSummaries,
    finishCredentialFillForLoginFailure,
    handleAccountCenterCommand,
    handleCredentialLoginFormMessage,
    openAccountLogin,
    pendingCredentialFillSite
  } = useAccountCredentialController({
    changeLinuxDoPanel,
    changeNodeSeekLoginPanel,
    changeScreen,
    changeYaohuoLoginPanel,
    linuxDoWebViewRef,
    notify,
    onOpenXiaoyinsiAuthorization: () => {
      void xiaoyinsiAuthController.beginAuthorization();
    },
    openUser,
    refreshAccountStatus,
    setYaohuoLoginPrompt,
    webViewRef,
    webViewBlockMessage: networkProxyWebViewBlockMessage,
    yaohuoWebViewRef
  });
  useCommitRefValue(credentialFailureHandlerRef, finishCredentialFillForLoginFailure);
  useCommitRefValue(credentialClearIntentHandlerRef, clearCredentialLoginIntent);

  const feedProps = useMemo(() => ({
      busy: (feedBusy && !feedIdentityError) || actionBusy,
      categories,
      categoryFilter,
      feedHasMore: activeFeedState.hasMore && feedAllowsRemotePagination,
      feedItems: shownFeedItems,
      feedOutcomeKind: feedIdentityError
        ? feedIdentityError.kind === 'ordinary' ? 'error' as const : 'auth' as const
        : feedOutcomeKind,
      feedPage: activeFeedState.page,
      feedScenePreviews,
      feedSource,
      feedFilter,
      identityChecking: Boolean(feedIdentityCheck?.checking),
      identityError: feedIdentityError,
      loadMoreFailureSignal: activeFeedState.loadMoreFailureSignal,
      loadingMore: activeFeedState.loadingMore,
      topicStateIndex,
      readingFilter,
      refreshing: activeFeedState.refreshing,
      scrollToTopSignal: tabScrollToTopSignals.feed,
      styles,
      theme,
      onCategoryChange: setCategoryFilter,
      onFeedSourceChange: changeFeedSource,
      onFeedFilterChange: setFeedFilter,
      onLoadMore: loadMoreActiveFeed,
      onCheckLinuxDoStatus: checkLinuxDoStatus,
      onOpenTopic: openTopic,
      onRetryIdentity: retryFeedIdentity,
      onReadingFilterChange: setReadingFilter,
      onRefresh: feedIdentityError ? retryFeedIdentity : refreshFeed
  }), [
    actionBusy,
    activeFeedState.hasMore,
    activeFeedState.loadMoreFailureSignal,
    activeFeedState.loadingMore,
    activeFeedState.page,
    activeFeedState.refreshing,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy,
    feedFilter,
    feedIdentityCheck?.checking,
    feedIdentityError,
    feedOutcomeKind,
    feedScenePreviews,
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
    styles,
    tabScrollToTopSignals.feed,
    theme,
    topicStateIndex
  ]);

  const searchProps = useMemo(() => ({
      busy: searchBusy,
      categories,
      sessionEpochs: forumSessionEpochs,
      requestsEnabled: screen === 'search'
        && !showLinuxDoPanel
        && (
          searchSource === 'all'
          || searchSource === 'v2ex'
          || !accountIdentityPending[searchSource]
        ),
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
      styles,
      theme,
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
  }), [
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
    styles,
    submittedSearchQuery,
    tabScrollToTopSignals.search,
    theme,
    toggleLinuxDoAiSearch,
    topicStateIndex
  ]);

  const libraryProps = useMemo(() => ({
      categories,
      followedUsers: followedUserRecords,
      libraryTab,
      loaded: readerDataLoaded,
      records: libraryRecords,
      scrollToTopSignal: tabScrollToTopSignals.library,
      topicStateIndex,
      styles,
      theme,
      onClearHistory: clearHistory,
      onOpenTopic: openTopic,
      onOpenUser: openUser,
      onRemove: removeLibraryTopic,
      onRemoveUser: removeFollowedUser,
      onTabChange: setLibraryTab
  }), [
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
    styles,
    tabScrollToTopSignals.library,
    theme,
    topicStateIndex
  ]);

  const moreProps = useMemo(() => ({
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
      xiaoyinsiLevelBusy: xiaoyinsiAuthController.levelBusy,
      xiaoyinsiLevelError: xiaoyinsiAuthController.levelError,
      xiaoyinsiLevelProfile: xiaoyinsiAuthController.levelProfile,
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
      styles,
      backupBusy,
      diagnosticBusy,
      theme,
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
        onCancel: () => { void xiaoyinsiAuthController.cancelAuthorization(); },
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
      onCheckLogin: () => { void checkNodeSeekLoginAndRetry(); },
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
        void xiaoyinsiAuthController.refreshLevel();
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
  }), [
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
    styles,
    testNetworkProxyProfile,
    theme,
    upsertNetworkProxyProfile,
    updateSettings,
    yaohuoLoginPrompt,
    xiaoyinsiAuthController
  ]);

  const stableBookmarkOnDiscourseSite = useLatestCallback(bookmarkOnDiscourseSite);
  const stableCollectOnNodeSeekSite = useLatestCallback(collectOnNodeSeekSite);
  const stableDeleteReply = useLatestCallback(deleteReply);
  const stableFavoriteOnYaohuoSite = useLatestCallback(favoriteOnYaohuoSite);
  const stableInteract = useLatestCallback(interact);
  const stableLoadMoreReplies = useLatestCallback(loadMoreReplies);
  const stableOpenUser = useLatestCallback(openUser);
  const stableRefreshTopicReplies = useLatestCallback(refreshTopicReplies);
  const stableRefreshWholeTopic = useLatestCallback(refreshCurrentTopic);
  const stableShareTopic = useLatestCallback(shareTopic);
  const stableSubmitReply = useLatestCallback(submitReply);
  const stableToggleReplyQuote = useLatestCallback(toggleReplyQuote);
  const stableToggleTopicBodyQuote = useLatestCallback(toggleTopicBodyQuote);
  const stableUploadReplyImage = useLatestCallback(uploadReplyImage);
  const stableVerifyLinuxDoFromTopic = useLatestCallback(verifyLinuxDoFromTopic);
  const stableVerifyNodeSeekFromTopic = useLatestCallback(verifyNodeSeekFromTopic);
  const stableVotePoll = useLatestCallback(votePoll);
  const topicProps = useMemo(() => ({
      actionBusy,
      sourceActionAvailability,
      contentWidth,
      htmlBaseStyle,
      htmlClassesStyles,
      htmlIgnoredStyles,
      htmlRenderers,
      htmlRenderersProps,
      htmlTagsStyles,
      getDiscourseEmojiUrls: sourceGateway.getEmojiUrls,
      inlineSizedImageUrls,
      topicImageDeriver,
      expandedQuotes,
      loadedQuotedReplies,
      loadingMoreReplies,
      loadingQuotedFloors,
      mediaSessionIdentity,
      commentQuery,
      replyHighlightQuery: debouncedCommentQuery,
      quoteStateVersion,
      topicFavorite,
      replyComposerOpen,
      replyContent,
      replyFace,
      replyEditTarget,
      replyFilter,
      replyTarget,
      replyHasMore,
      replies: displayReplies,
      selectedTopic,
      sourceReplies: topicReplies,
      styles,
      theme,
      topic: topicLayoutDetail,
      topicBusy: topicBusy && !topicIdentityError,
      topicError: topicIdentityError || topicError || null,
      identityBlocked: Boolean(selectedTopicIdentityCheck?.pending),
      identityChecking: Boolean(selectedTopicIdentityCheck?.checking),
      topicScrollRef,
      unreadReplyCount,
      onBack: goBackFromTopic,
      onCommentQueryChange: changeCommentQuery,
      optimisticActions: optimisticTopicActions,
      onDeleteReply: stableDeleteReply,
      onEditReply: editReply,
      onInteract: stableInteract,
      onDiscourseBookmark: stableBookmarkOnDiscourseSite,
      onNodeSeekCollection: stableCollectOnNodeSeekSite,
      onShareTopic: stableShareTopic,
      onVotePoll: stableVotePoll,
      onLoadMoreReplies: stableLoadMoreReplies,
      onOpenOriginal: openExternalUrl,
      onOpenReadingSettings: openReadingSettingsFromTopic,
      onReplyComposerOpenChange: toggleReplyComposer,
      onReplyContentChange: changeReplyContent,
      onReplyFaceChange: changeReplyFace,
      onReplyFilterChange: changeReplyFilter,
      onReplyToFloor: replyToFloor,
      onRefreshTopic: stableRefreshTopicReplies,
      onRefreshWholeTopic: stableRefreshWholeTopic,
      onVerifyLinuxDo: stableVerifyLinuxDoFromTopic,
      onVerifyNodeSeek: stableVerifyNodeSeekFromTopic,
      onSubmitReply: stableSubmitReply,
      onUploadReplyImage: stableUploadReplyImage,
      onTopicScroll: handleTopicScroll,
      onToggleReplyQuote: stableToggleReplyQuote,
      onToggleTopicBodyQuote: stableToggleTopicBodyQuote,
      onToggleFavorite: toggleTopicFavorite,
      onOpenUser: stableOpenUser
  }), [
    actionBusy,
    changeCommentQuery,
    changeReplyContent,
    commentQuery,
    editReply,
    contentWidth,
    debouncedCommentQuery,
    expandedQuotes,
    displayReplies,
    goBackFromTopic,
    handleTopicScroll,
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    loadedQuotedReplies,
    loadingMoreReplies,
    loadingQuotedFloors,
    mediaSessionIdentity,
    openExternalUrl,
    openReadingSettingsFromTopic,
    optimisticTopicActions,
    quoteStateVersion,
    replyComposerOpen,
    replyContent,
    replyFace,
    replyEditTarget,
    replyFilter,
    replyHasMore,
    replyTarget,
    replyToFloor,
    changeReplyFace,
    changeReplyFilter,
    selectedTopic,
    sourceGateway,
    stableBookmarkOnDiscourseSite,
    stableCollectOnNodeSeekSite,
    stableDeleteReply,
    stableInteract,
    stableLoadMoreReplies,
    stableOpenUser,
    stableRefreshTopicReplies,
    stableRefreshWholeTopic,
    stableShareTopic,
    stableSubmitReply,
    stableToggleReplyQuote,
    stableToggleTopicBodyQuote,
    stableUploadReplyImage,
    stableVerifyLinuxDoFromTopic,
    stableVerifyNodeSeekFromTopic,
    stableVotePoll,
    styles,
    sourceActionAvailability,
    theme,
    toggleReplyComposer,
    toggleTopicFavorite,
    topicBusy,
    topicLayoutDetail,
    topicError,
    topicIdentityError,
    selectedTopicIdentityCheck?.checking,
    selectedTopicIdentityCheck?.pending,
    topicFavorite,
    topicImageDeriver,
    topicReplies,
    topicScrollRef,
    unreadReplyCount
  ]);

  const userProps = useMemo(() => ({
      busy: (userBusy && !userIdentityError) || Boolean(selectedUserIdentityCheck?.checking),
      error: userIdentityError || userError || null,
      followed: currentUserFollowed,
      identityBlocked: Boolean(selectedUserIdentityCheck?.pending),
      identityChecking: Boolean(selectedUserIdentityCheck?.checking),
      profile: userProfile,
      requestedUser: selectedUser,
      styles,
      theme,
      topicStateIndex,
      loadingMoreReplies: userLoadingMoreReplies,
      loadingMoreTopics: userLoadingMoreTopics,
      onBack: goBackFromUser,
      onLoadMoreReplies: loadMoreUserReplies,
      onLoadMoreTopics: loadMoreUserTopics,
      onCheckLinuxDoStatus: checkLinuxDoStatus,
      onOpenOriginal: openExternalUrl,
      onOpenTopic: openTopic,
      onRefresh: refreshCurrentUser,
      onToggleFollow: toggleUserFollow
  }), [
    checkLinuxDoStatus,
    currentUserFollowed,
    goBackFromUser,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openExternalUrl,
    openTopic,
    refreshCurrentUser,
    selectedUser,
    selectedUserIdentityCheck?.checking,
    selectedUserIdentityCheck?.pending,
    styles,
    theme,
    toggleUserFollow,
    topicStateIndex,
    userBusy,
    userError,
    userIdentityError,
    userLoadingMoreReplies,
    userLoadingMoreTopics,
    userProfile
  ]);

  const renderFeedTab = useCallback(() => (
    <FeedScreen {...feedProps} />
  ), [feedProps]);
  const renderSearchTab = useCallback(() => (
    <SearchScreen {...searchProps} />
  ), [searchProps]);
  const renderLibraryTab = useCallback(() => (
    <LibraryScreen {...libraryProps} />
  ), [libraryProps]);
  const renderMoreTab = useCallback(() => (
    <ScrollView ref={moreScrollRef} style={styles.content} contentContainerStyle={styles.moreContentInner} keyboardShouldPersistTaps="always">
      <MoreScreen {...moreProps} />
    </ScrollView>
  ), [moreProps, styles]);
  const renderReadingSettingsScreen = useCallback(() => (
    <ScrollView style={styles.content} contentContainerStyle={styles.moreContentInner} keyboardShouldPersistTaps="handled">
      <AppearancePanel settings={readerData.settings} showSettingsPanel styles={styles} onUpdateSettings={updateSettings} />
    </ScrollView>
  ), [readerData.settings, styles, updateSettings]);
  const renderTopicScreen = useCallback(() => (
    <TopicScreen {...topicProps} />
  ), [topicProps]);
  const renderUserScreen = useCallback(() => (
    <UserScreen {...userProps} />
  ), [userProps]);

  const handleMainTabPress = useCallback((targetScreen: keyof MainTabParamList) => {
    if (screen === targetScreen) {
      requestTabScrollToTop(targetScreen);
    }
    changeScreen(targetScreen);
  }, [changeScreen, requestTabScrollToTop, screen]);

  return (
    <ForumSessionEpochProvider sessionEpochs={forumSessionEpochs}>
      <GestureHandlerRootView style={styles.screen}>
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.screen}>
          <SafeAreaView edges={['left', 'right']} style={styles.screen}>
              <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
              <View pointerEvents="none" style={[styles.statusBarScrim, screen === 'topic' && replyComposerOpen && styles.statusBarScrimBelowOverlay]} />
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
              styles={styles}
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
              closeImagePreview={closeImagePreview}
              handleLinuxDoMessage={handleLinuxDoMessage}
              handleLinuxDoNavigation={handleLinuxDoNavigation}
              handleCredentialLoginFormMessage={handleCredentialLoginFormMessage}
              handleNodeImageAuthMessage={handleNodeImageAuthMessage}
              handleNodeImageAuthNavigation={handleNodeImageAuthNavigation}
              imagePreview={imagePreview}
              linuxDoCredentialSaved={credentialSummaries.linuxdo.hasCredential}
              linuxDoLoginFormMode={credentialLoginSite === 'linuxdo'}
              linuxDoSession={siteSessionViewModels.linuxdo}
              linuxDoWebViewError={linuxDoWebViewError}
              linuxDoWebViewKey={linuxDoWebViewKey}
              linuxDoWebViewRef={linuxDoWebViewRef}
              loadingLinuxDoPage={loadingLinuxDoPage}
              loadingNodeImageAuthPage={loadingNodeImageAuthPage}
              mountLinuxDoWebView={mountLinuxDoWebView}
              nodeImageAuthDocument={nodeImageAuthDocument}
              nodeImageAuthError={nodeImageAuthError}
              nodeImageAuthWebViewRef={nodeImageAuthWebViewRef}
              nodeSeekMediaUserAgent={nodeSeekWebViewUserAgent}
              resetLinuxDoWebView={resetLinuxDoWebView}
              savePreviewImage={savePreviewImage}
              selectPreviewImage={selectPreviewImage}
              setLinuxDoWebViewErrorForSession={setLinuxDoWebViewErrorForSession}
              setLoadingLinuxDoPageForSession={setLoadingLinuxDoPageForSession}
              setLoadingNodeImageAuthPage={setLoadingNodeImageAuthPage}
              setNodeImageAuthError={reportNodeImageAuthFailure}
              showLinuxDoPanel={showLinuxDoPanel}
              showNodeImageAuthPanel={showNodeImageAuthPanel}
              styles={styles}
              theme={theme}
              webViewBlockMessage={networkProxyWebViewBlockMessage}
              changeLinuxDoPanel={changeLinuxDoPanel}
              requestLinuxDoCredentialFill={() => {
                openAccountLogin('linuxdo', true);
              }}
              closeNodeImageAuthPanel={closeNodeImageAuthPanel}
            />
              {networkProxyContentReady ? (
              <YaohuoFavoriteStateProvider
                bookmarked={topicDetail?.source === 'yaohuo' ? topicDetail.bookmarked : undefined}
                onPress={stableFavoriteOnYaohuoSite}
                topicKey={topicDetail?.source === 'yaohuo' ? `${topicDetail.source}:${topicDetail.id}` : ''}
              >
                <AppNavigator
                moreHasBadge={Boolean(appUpdateInfo)}
                navigationTheme={navigationTheme}
                renderFeedTab={renderFeedTab}
                renderLibraryTab={renderLibraryTab}
                renderMoreTab={renderMoreTab}
                renderReadingSettingsScreen={renderReadingSettingsScreen}
                renderSearchTab={renderSearchTab}
                renderTopicScreen={renderTopicScreen}
                renderUserScreen={renderUserScreen}
                styles={styles}
                theme={theme}
                onReady={handleNavigationReady}
                onScreenChange={handleNavigationScreenChange}
                onTabPress={handleMainTabPress}
                onTopicClosing={flushDeferredNavigationTask}
                onUserClosing={flushDeferredNavigationTask}
                />
              </YaohuoFavoriteStateProvider>
              ) : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
      </GestureHandlerRootView>
    </ForumSessionEpochProvider>
  );
}
