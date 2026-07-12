import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '../nodeseekCookies';
import { setDefaultAvatarFetcher } from '../avatarImages';
import type { TopicRecord } from '../readerData';
import { useReaderDataController } from './useReaderDataController';
import { useReaderDataActionsController } from './useReaderDataActionsController';
import { useReaderSettingsController } from './useReaderSettingsController';
import { useBackupStatusController } from './useBackupStatusController';
import { useDiagnosticLogController } from './useDiagnosticLogController';
import { useAccountStatusController } from './useAccountStatusController';
import { useAppUpdateController } from './useAppUpdateController';
import { useFeedController } from './useFeedController';
import { useHtmlRenderingController } from './useHtmlRenderingController';
import { useHiddenBrowserFetchController } from './useHiddenBrowserFetchController';
import { AppNavigator, currentTopicRouteKey, navigateAppScreen, navigationRef, previousTopicRouteKey, pushTopicRoute, shouldUpdateAppRootScreen, type MainTabParamList } from './AppNavigator';
import { useImagePreviewController } from './useImagePreviewController';
import { useSearchController } from './useSearchController';
import { useSessionController } from './useSessionController';
import { useNetworkProxyController } from './useNetworkProxyController';
import { useTopicController } from './useTopicController';
import { filterTopicSessionReplies, useTopicSessionController } from './useTopicSessionController';
import { useUserController } from './useUserController';
import { useVerificationController, type DeferredNavigationTask } from './useVerificationController';
import { useAccountController } from './useAccountController';
import { useAccountCredentialController } from './useAccountCredentialController';
import { useTopicActionsController } from './useTopicActionsController';
import { takeNodeSeekVerificationRetry } from './sessionControllerHelpers';
import {
  hasPendingOptimisticTopicAction,
  markCurrentNodeSeekOwnRepliesUnlikable,
  shouldInvalidateTopicActionsOnScreenChange,
  topicSnapshotForUserReturn
} from './topicActionControllerHelpers';
import { useMainTabScrollToTop } from './useMainTabScrollToTop';
import { useDeferredNavigationTask } from './useDeferredNavigationTask';
import { GlobalModalHost } from './GlobalModalHost';
import { HiddenBrowserHost } from './HiddenBrowserHost';
import { shouldCloseReplyComposerOnBack } from './backHandlerHelpers';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT, setLinuxDoDevAnonymousOverride } from '../linuxdoCookieBridge';
import { createSourceGateway, type LinuxDoLevelProfile } from '../sources/sourceGateway';
import type { FeedSource, Source, Topic, UserProfile } from '../types';
import type { OptimisticActionState } from '../topicActionState';
import { isHttpOrHttpsUrl } from '../htmlImages';
import { shouldOpenLoginWebViewUrl } from '../loginWebViewNavigation';
import { createTopicListItemStateIndex } from '../topicListItemState';
import { replyHtmlWithSignature } from '../topicDerivedData';
import {
  contentWidthValue,
  createStyles,
  createTheme
} from '../theme';
import type { LibraryTab } from '../feedLogic';
import { errorMessage } from '../appUtils';
import { FeedScreen } from '../screens/FeedScreen';
import { LibraryScreen } from '../screens/LibraryScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { TopicScreen } from '../screens/TopicScreen';
import { UserScreen } from '../screens/UserScreen';
import type { TopicListItem } from '../screens/TopicScreen';
import type { LoginNavigationRequest, Screen, TopicSnapshot } from '../appTypes';
import { createRequestOwner, startOwnedRequest } from '../requestOwnership';
import {
  applyDevAnonymousOverrides,
  createSiteSessionViewModels,
  isDevAnonymousSource,
  nodeSeekTopicCurrentUserForSession,
  nodeSeekUserIdForSession,
  type DevAnonymousOverrides,
  type SessionSite
} from '../siteSessionState';
import type { LoginWebViewFailureReason } from './accountCredentialDiagnostics';
import { clearNodeImageApiKey, loadNodeImageApiKey, saveNodeImageApiKey } from '../nodeimageCredentials';
import { nodeImageApiKeyFromResponse } from '../replyImageUpload';
import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '../appUrls';
import type { NodeImageAuthPayload } from '../loginWebViewScripts';
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

type UserReturnTopic = {
  returnScreen: Exclude<Screen, 'topic'>;
  snapshot: TopicSnapshot;
  backStack: TopicSnapshot[];
};
const NODESEEK_LOGIN_HOSTS = ['nodeseek.com', 'challenges.cloudflare.com'];
const NODEIMAGE_LOGIN_HOSTS = ['nodeimage.com', 'nodeseek.com', 'challenges.cloudflare.com'];
const YAOHUO_LOGIN_HOSTS = ['www.yaohuo.me'];
const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com'];
function sortedRecords(records: Record<string, TopicRecord>) {
  return Object.values(records).sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

export function AppRoot() {
  const webViewRef = useRef<WebView>(null);
  const nodeImageAuthWebViewRef = useRef<WebView>(null);
  const yaohuoWebViewRef = useRef<WebView>(null);
  const linuxDoWebViewRef = useRef<WebView>(null);
  const nodeSeekBrowserWebViewRef = useRef<WebView>(null);
  const linuxDoBrowserWebViewRef = useRef<WebView>(null);
  const nodeSeekLoginPanelRequestRef = useRef(0);
  const nodeImageAuthResolverRef = useRef<((apiKey: string | null) => void) | null>(null);
  const nodeImageAuthPromiseRef = useRef<Promise<string | null> | null>(null);
  const yaohuoLoginPanelRequestRef = useRef(0);
  const webLoginDetectedRef = useRef(false);
  const topicRequestIdRef = useRef(0);
  const topicAbortRef = useRef<AbortController | null>(null);
  const checkingRequestIdRef = useRef(0);
  const topicActionRequestOwnerRef = useRef(createRequestOwner('topic-action'));
  const actionAbortRef = useRef<{ abort: () => void; abortAll: () => void } | null>(null);
  const repliesAbortRef = useRef<AbortController | null>(null);
  const repliesRequestIdRef = useRef(0);
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);
  const topicReturnScreenRef = useRef<Exclude<Screen, 'topic'>>('feed');
  const userReturnScreenRef = useRef<Exclude<Screen, 'user'>>('feed');
  const userReturnTopicRef = useRef<UserReturnTopic | null>(null);
  const reopenExistingTopicScreenRef = useRef(false);
  const pendingNavigationScreenRef = useRef<Screen | null>(null);
  const pendingLinuxDoTopicRef = useRef<Topic | null>(null);
  const linuxDoPendingTopicVerifiedRef = useRef(false);
  const linuxDoPendingReopenTopicAfterCloseRef = useRef<Topic | null>(null);
  const linuxDoDismissedVerificationTopicKeyRef = useRef<string | null>(null);
  const linuxDoVerifiedRetryTopicKeyRef = useRef<string | null>(null);
  const linuxDoWebViewSessionRef = useRef(0);
  const linuxDoPanelClosingSessionRef = useRef<number | null>(null);
  const linuxDoWebViewMountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linuxDoPanelCloseSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linuxDoPendingReopenTaskRef = useRef<DeferredNavigationTask | null>(null);
  const openTopicRef = useRef<((topic: Topic, nocache?: boolean) => Promise<void>) | null>(null);
  const openUserRef = useRef<((user: UserProfile, nocache?: boolean) => Promise<void>) | null>(null);
  const openImagePreviewRef = useRef<(url: string) => void>(() => undefined);
  const pendingNodeSeekSearchRetryRef = useRef<(() => void) | null>(null);
  const pendingNodeSeekTopicRetryRef = useRef<Topic | null>(null);
  const nodeSeekWebViewCookieHeaderRef = useRef('');
  const nodeSeekWebViewUserAgentRef = useRef(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const linuxDoWebViewCookieHeaderRef = useRef('');
  const linuxDoWebViewUserAgentRef = useRef(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const linuxDoClearanceBeforeVerifyRef = useRef<string | null>(null);
  const linuxDoRequireFreshClearanceRef = useRef(false);
  const linuxDoLevelRequestIdRef = useRef(0);
  const {
    cancelDeferredNavigationTask,
    flushDeferredNavigationTask,
    runAfterNavigationInteractions
  } = useDeferredNavigationTask();
  const { width, height } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
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
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [loadingYaohuoLoginPage, setLoadingYaohuoLoginPage] = useState(true);
  const [loadingLinuxDoPage, setLoadingLinuxDoPage] = useState(true);
  const [linuxDoWebViewError, setLinuxDoWebViewError] = useState('');
  const [linuxDoWebViewKey, setLinuxDoWebViewKey] = useState(0);
  const [linuxDoWebViewUserAgent, setLinuxDoWebViewUserAgent] = useState(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const [linuxDoWebViewCookieHeader, setLinuxDoWebViewCookieHeader] = useState('');
  const [linuxDoLevelProfile, setLinuxDoLevelProfile] = useState<LinuxDoLevelProfile | null>(null);
  const [linuxDoLevelBusy, setLinuxDoLevelBusy] = useState(false);
  const [linuxDoLevelError, setLinuxDoLevelError] = useState('');
  const [mountLinuxDoWebView, setMountLinuxDoWebView] = useState(false);
  const [checking, setChecking] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [optimisticTopicActions, setOptimisticTopicActions] = useState<Record<string, OptimisticActionState>>({});
  const [nodeSeekWebViewUserAgent, setNodeSeekWebViewUserAgent] = useState(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const [nodeSeekMediaCookieHeader, setNodeSeekMediaCookieHeader] = useState('');
  const [nodeImageApiKeySaved, setNodeImageApiKeySaved] = useState(false);
  const [nodeImageApiKeyBusy, setNodeImageApiKeyBusy] = useState(false);
  const [showNodeImageAuthPanel, setShowNodeImageAuthPanel] = useState(false);
  const [nodeImageAuthUrl, setNodeImageAuthUrl] = useState(NODEIMAGE_AUTH_URL);
  const [nodeImageAuthPayload, setNodeImageAuthPayload] = useState<NodeImageAuthPayload | null>(null);
  const [loadingNodeImageAuthPage, setLoadingNodeImageAuthPage] = useState(false);
  const [nodeImageAuthError, setNodeImageAuthError] = useState('');
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
  const credentialFailureHandlerRef = useRef<(
    site: SessionSite,
    attempt: number,
    reason: LoginWebViewFailureReason
  ) => void>(() => undefined);
  const handleCredentialLoginWebViewFailure = useCallback((
    site: SessionSite,
    attempt: number,
    reason: LoginWebViewFailureReason
  ) => credentialFailureHandlerRef.current(site, attempt, reason), []);
  const credentialClearIntentHandlerRef = useRef<(site: SessionSite) => void>(() => undefined);
  const handleClearCredentialLoginIntent = useCallback((site: SessionSite) => {
    credentialClearIntentHandlerRef.current(site);
  }, []);
  const accountStatusInitialRefreshRef = useRef(false);
  const invalidateTopicActionRequests = useCallback((nextTopicKey: string | null) => {
    startOwnedRequest(topicActionRequestOwnerRef, `topic-action-context:${nextTopicKey || 'none'}`);
    actionAbortRef.current?.abort();
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
    linuxDoLevelRequestIdRef.current += 1;
    setLinuxDoLevelProfile(null);
    setLinuxDoLevelError('');
    setLinuxDoLevelBusy(false);
  }, []);

  const optimisticTopicActionsRef = useRef<Record<string, OptimisticActionState>>({});
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
  useEffect(() => {
    let active = true;
    loadNodeImageApiKey()
      .then((apiKey) => {
        if (active) {
          setNodeImageApiKeySaved(Boolean(apiKey));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const saveNodeImageApiKeyInput = useCallback(async (value: string) => {
    if (nodeImageApiKeyBusy) {
      return;
    }
    setNodeImageApiKeyBusy(true);
    try {
      await saveNodeImageApiKey(value);
      setNodeImageApiKeySaved(true);
      notify('NodeImage API Key 已保存');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setNodeImageApiKeyBusy(false);
    }
  }, [nodeImageApiKeyBusy, notify]);
  const clearNodeImageApiKeyInput = useCallback(async () => {
    if (nodeImageApiKeyBusy) {
      return;
    }
    setNodeImageApiKeyBusy(true);
    try {
      await clearNodeImageApiKey();
      setNodeImageApiKeySaved(false);
      notify('NodeImage API Key 已清除');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setNodeImageApiKeyBusy(false);
    }
  }, [nodeImageApiKeyBusy, notify]);
  const finishNodeImageAuth = useCallback((apiKey: string | null) => {
    nodeImageAuthWebViewRef.current?.stopLoading();
    setShowNodeImageAuthPanel(false);
    setNodeImageAuthPayload(null);
    setLoadingNodeImageAuthPage(false);
    if (apiKey) {
      setNodeImageAuthError('');
    }
    const resolve = nodeImageAuthResolverRef.current;
    nodeImageAuthResolverRef.current = null;
    nodeImageAuthPromiseRef.current = null;
    resolve?.(apiKey);
  }, []);
  const closeNodeImageAuthPanel = useCallback(() => {
    finishNodeImageAuth(null);
  }, [finishNodeImageAuth]);
  const openNodeImageAuthPanel = useCallback(() => {
    if (nodeImageAuthPromiseRef.current) {
      return nodeImageAuthPromiseRef.current;
    }
    setNodeImageAuthUrl(NODEIMAGE_AUTH_URL);
    setNodeImageAuthPayload(null);
    setNodeImageAuthError('');
    setLoadingNodeImageAuthPage(true);
    setShowNodeImageAuthPanel(true);
    const promise = new Promise<string | null>((resolve) => {
      nodeImageAuthResolverRef.current = resolve;
    });
    nodeImageAuthPromiseRef.current = promise;
    return promise;
  }, []);
  const ensureNodeImageApiKey = useCallback(async (options?: { forceRefresh?: boolean; clearOnCancel?: boolean }) => {
    if (!options?.forceRefresh) {
      const apiKey = await loadNodeImageApiKey();
      if (apiKey) {
        setNodeImageApiKeySaved(true);
        return apiKey;
      }
    }
    const apiKey = await openNodeImageAuthPanel();
    if (!apiKey && options?.clearOnCancel) {
      await clearNodeImageApiKey();
      setNodeImageApiKeySaved(false);
    }
    return apiKey;
  }, [openNodeImageAuthPanel]);
  const authorizeNodeImageApiKey = useCallback(() => {
    void ensureNodeImageApiKey({ forceRefresh: true });
  }, [ensureNodeImageApiKey]);
  const handleNodeImageAuthMessage = useCallback((event: WebViewMessageEvent) => {
    void (async () => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as Record<string, unknown>;
        if (data.type !== 'nodeimage-api-key') {
          if (data.type === 'nodeimage-auth-data') {
            const payload = {
              data: data.data,
              wtf: data.wtf,
              sign: data.sign
            };
            if (payload.data == null || !payload.wtf || !payload.sign) {
              setNodeImageAuthError('NodeSeek 授权返回缺少必要信息。');
              return;
            }
            setNodeImageAuthPayload(payload);
            setNodeImageAuthError('');
            setLoadingNodeImageAuthPage(true);
            setNodeImageAuthUrl(NODEIMAGE_URL);
            return;
          }
          if (data.type === 'nodeimage-auth-error') {
            setNodeImageAuthError(String(data.error || 'NodeSeek 授权失败'));
          }
          return;
        }
        const apiKey = nodeImageApiKeyFromResponse(data);
        if (!apiKey) {
          setNodeImageAuthError(String(data.error || '需要完成 NodeSeek 授权后才能自动获取 NodeImage Key。'));
          return;
        }
        await saveNodeImageApiKey(apiKey);
        setNodeImageApiKeySaved(true);
        notify('NodeImage API Key 已保存');
        finishNodeImageAuth(apiKey);
      } catch (error) {
        setNodeImageAuthError(errorMessage(error));
      }
    })();
  }, [finishNodeImageAuth, notify]);
  const topicSession = useTopicSessionController({ invalidateTopicActionRequests, notify });
  const {
    state: {
      commentQuery,
      debouncedCommentQuery,
      expandedQuotes,
      loadedQuotedReplies,
      loadingMoreReplies,
      loadingQuotedFloors,
      quoteStateVersion,
      replyComposerOpen,
      replyContent,
      replyEditTarget,
      replyFace,
      replyFilter,
      replyHasMore,
      replyTarget,
      selectedTopic,
      topicBusy,
      topicDetail,
      topicError,
      topicReplies,
      unreadReplyCount
    },
    commands: {
      composer: topicComposer,
      navigation: topicNavigation,
      quotes: topicQuotes,
      topic: topicLifecycle,
      view: topicView
    },
    restore: restoreTopicSnapshot,
    snapshot: topicSnapshot
  } = topicSession;
  const abortQuotedReplyRequests = topicQuotes.abortRequests;
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
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const showLoginPanelRef = useRef(showLoginPanel);
  const [showYaohuoLoginPanel, setShowYaohuoLoginPanel] = useState(false);
  const [yaohuoLoginPrompt, setYaohuoLoginPrompt] = useState('');
  const [showLinuxDoPanel, setShowLinuxDoPanel] = useState(false);
  const [showNetworkProxyPanel, setShowNetworkProxyPanel] = useState(false);
  const showLinuxDoPanelRef = useRef(showLinuxDoPanel);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  showLoginPanelRef.current = showLoginPanel;
  showLinuxDoPanelRef.current = showLinuxDoPanel;
  const cancelLinuxDoPendingReopenTask = useCallback(() => {
    linuxDoPendingReopenTaskRef.current?.cancel();
    linuxDoPendingReopenTaskRef.current = null;
  }, []);
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
    recoverNodeSeekNetwork,
    summary: networkProxySummary,
    deleteProxyProfile: deleteNetworkProxyProfile,
    selectProxyProfile: selectNetworkProxyProfile,
    setProxyEnabled: setNetworkProxyEnabled,
    testProxyProfile: testNetworkProxyProfile,
    upsertProxyProfile: upsertNetworkProxyProfile
  } = useNetworkProxyController({ notify });
  useEffect(() => setDefaultAvatarFetcher(networkProxyFetcher), [networkProxyFetcher]);
  const networkProxyWebViewBlockMessage = !networkProxyLoaded
    ? '代理状态读取中。'
    : (networkProxyApplyStatus === 'failed'
      ? networkProxyApplyError || '代理状态不确定，请重新应用代理设置。'
      : networkProxyState.enabled && networkProxyApplyStatus !== 'applied'
      ? networkProxyApplyError || '代理未生效。'
      : '');
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
    clearNodeSeekLoginCookiesOnly: clearStoredNodeSeekLoginCookiesOnly,
    clearNodeSeekLoginState: clearStoredNodeSeekLoginState,
    clearYaohuoLoginState,
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumFetchWithWebViewFallback,
    hiddenBrowserFetchRequests,
    loadNodeSeekCookieForSource: loadStoredNodeSeekCookieForSource,
    loadYaohuoCookieForSource: loadStoredYaohuoCookieForSource,
    restoreSavedYaohuoCookiesToWebView,
    saveNodeSeekCookieHeader,
    saveYaohuoCookieHeader,
    siteSessionStates,
    markLinuxDoBrowserFetchHttpError,
    markNodeSeekBrowserFetchHttpError,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession
  } = useSessionController({
    defaultFetcher: networkProxyFetcher,
    linuxDoBrowserWebViewRef,
    linuxDoClearanceBeforeVerifyRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    recoverNodeSeekNetwork,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    webLoginDetectedRef
  });

  const [devAnonymousOverrides, setDevAnonymousOverrides] = useState<DevAnonymousOverrides>({});
  const yaohuoCredentialSuppressedRef = useRef(Boolean(__DEV__ && devAnonymousOverrides.yaohuo));
  yaohuoCredentialSuppressedRef.current = Boolean(__DEV__ && devAnonymousOverrides.yaohuo);
  const effectiveSiteSessionStates = useMemo(() => (
    __DEV__ ? applyDevAnonymousOverrides(siteSessionStates, devAnonymousOverrides) : siteSessionStates
  ), [devAnonymousOverrides, siteSessionStates]);
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(effectiveSiteSessionStates), [effectiveSiteSessionStates]);
  const effectiveNodeSeekUserId = nodeSeekUserIdForSession(siteSessionViewModels.nodeseek, webLoginUserId);
  useEffect(() => {
    setLinuxDoDevAnonymousOverride(Boolean(__DEV__ && devAnonymousOverrides.linuxdo));
    return () => setLinuxDoDevAnonymousOverride(false);
  }, [devAnonymousOverrides.linuxdo]);
  const toggleDevAnonymousOverride = useCallback((site: SessionSite) => {
    if (!__DEV__) {
      return;
    }
    if (site === 'yaohuo') {
      const enabled = !yaohuoCredentialSuppressedRef.current;
      yaohuoCredentialSuppressedRef.current = enabled;
      if (enabled) {
        yaohuoLoginPanelRequestRef.current += 1;
        checkingRequestIdRef.current += 1;
        yaohuoWebViewRef.current?.stopLoading();
      }
      setDevAnonymousOverrides((current) => ({ ...current, yaohuo: enabled }));
      return;
    }
    setDevAnonymousOverrides((current) => ({
      ...current,
      [site]: !current[site]
    }));
  }, []);
  const loadNodeSeekCookieForSource = useCallback(async (source: FeedSource | Source, options?: Parameters<typeof loadStoredNodeSeekCookieForSource>[1]) => {
    const isNodeSeekSource = source === 'all' || source === 'nodeseek';
    if (__DEV__ && isDevAnonymousSource(source, 'nodeseek', devAnonymousOverrides)) {
      if (isNodeSeekSource) {
        setNodeSeekMediaCookieHeader('');
      }
      return undefined;
    }
    const cookieHeader = await loadStoredNodeSeekCookieForSource(source, options);
    if (isNodeSeekSource) {
      if (cookieHeader) {
        nodeSeekWebViewCookieHeaderRef.current = cookieHeader;
      }
      setNodeSeekMediaCookieHeader((current) => current === cookieHeader ? current : cookieHeader || '');
    }
    return cookieHeader;
  }, [devAnonymousOverrides.nodeseek, loadStoredNodeSeekCookieForSource]);
  const clearNodeSeekLoginState = useCallback(async () => {
    setNodeSeekMediaCookieHeader('');
    const cleared = await clearStoredNodeSeekLoginState();
    if (!cleared && nodeSeekWebViewCookieHeaderRef.current) {
      setNodeSeekMediaCookieHeader(nodeSeekWebViewCookieHeaderRef.current);
    }
    return cleared;
  }, [clearStoredNodeSeekLoginState]);
  const clearNodeSeekLoginCookiesOnly = useCallback(async (options?: Parameters<typeof clearStoredNodeSeekLoginCookiesOnly>[0]) => {
    setNodeSeekMediaCookieHeader('');
    const result = await clearStoredNodeSeekLoginCookiesOnly(options);
    const cookieHeader = nodeSeekWebViewCookieHeaderRef.current;
    if (cookieHeader) {
      setNodeSeekMediaCookieHeader(cookieHeader);
    }
    return result;
  }, [clearStoredNodeSeekLoginCookiesOnly]);
  const loadYaohuoCookieForSource = useCallback(async (source: FeedSource | Source, options?: Parameters<typeof loadStoredYaohuoCookieForSource>[1]) => {
    if (__DEV__ && isDevAnonymousSource(source, 'yaohuo', { yaohuo: yaohuoCredentialSuppressedRef.current })) {
      return undefined;
    }
    const cookie = await loadStoredYaohuoCookieForSource(source, options);
    return yaohuoCredentialSuppressedRef.current ? undefined : cookie;
  }, [loadStoredYaohuoCookieForSource]);
  const libraryRecords = useMemo(
    () => sortedRecords(libraryTab === 'history' ? readerData.history : readerData.favorites),
    [libraryTab, readerData.favorites, readerData.history]
  );
  const openExternalUrl = useCallback((url: string) => {
    if (!isHttpOrHttpsUrl(url)) {
      notify('仅支持打开 http/https 链接。');
      return;
    }
    void Linking.openURL(url).catch((error) => notify(errorMessage(error)));
  }, [notify]);
  const openImagePreviewFromRenderer = useCallback((url: string) => {
    openImagePreviewRef.current(url);
  }, []);
  const openTopicFromHtml = useCallback((topic: Topic) => {
    void openTopicRef.current?.(topic);
  }, []);
  const openUserFromHtml = useCallback((user: UserProfile) => {
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
    onOpenExternalUrl: openExternalUrl,
    onOpenImagePreview: openImagePreviewFromRenderer,
    onOpenTopic: openTopicFromHtml,
    onOpenUser: openUserFromHtml,
    nodeSeekMediaCookieHeader,
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
    topicDetail,
    topicImageDeriver,
    topicReplies
  }), [debouncedCommentQuery, inlineSizedImageUrls, replyFilter, topicDetail, topicImageDeriver, topicReplies]);
  const nodeSeekTopicCurrentUser = nodeSeekTopicCurrentUserForSession(
    siteSessionViewModels.nodeseek,
    topicDetail?.source === 'nodeseek' ? topicDetail.currentUser : undefined
  );
  const nodeSeekCurrentUserForTopicActions = siteSessionViewModels.nodeseek.currentUser || nodeSeekTopicCurrentUser;
  const displayReplies = useMemo(
    () => markCurrentNodeSeekOwnRepliesUnlikable(filteredReplies, nodeSeekCurrentUserForTopicActions, effectiveNodeSeekUserId),
    [effectiveNodeSeekUserId, filteredReplies, nodeSeekCurrentUserForTopicActions]
  );
  useEffect(() => {
    const currentUser = nodeSeekTopicCurrentUser;
    const userId = Number(currentUser?.id);
    if (!currentUser || !Number.isInteger(userId) || userId <= 0) {
      return;
    }
    setWebLoginUserId(userId);
    updateNodeSeekSession({
      type: 'cookie-loaded',
      hasVerification: true,
      loggedIn: true,
      currentUser,
      at: new Date().toISOString()
    });
  }, [nodeSeekTopicCurrentUser, updateNodeSeekSession]);
  useEffect(() => {
    if (topicDetail?.source !== 'nodeseek') {
      return;
    }
    const cookieHeader = nodeSeekWebViewCookieHeaderRef.current;
    setNodeSeekMediaCookieHeader((current) => current === cookieHeader ? current : cookieHeader);
  }, [topicDetail?.id, topicDetail?.source]);
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
    selectPreviewImage,
    showNextImage,
    showPreviousImage
  } = useImagePreviewController({
    beforeSave: ensureNetworkProxyReady,
    fetcher: networkProxyFetcher,
    htmlParts: getTopicHtmlParts,
    inlineSizedImageUrls,
    notify,
    topicImageDeriver
  });
  openImagePreviewRef.current = openImagePreview;
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
    topicAbortRef.current?.abort();
    repliesAbortRef.current?.abort();
    actionAbortRef.current?.abortAll();
    const resolveNodeImageAuth = nodeImageAuthResolverRef.current;
    nodeImageAuthResolverRef.current = null;
    nodeImageAuthPromiseRef.current = null;
    resolveNodeImageAuth?.(null);
    cancelDeferredNavigationTask();
  }, [cancelDeferredNavigationTask]);
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(readerData), [
    readerData.favorites,
    readerData.history,
    readerData.settings.listDensity
  ]);
  const closeYaohuoLoginPanel = useCallback(() => {
    handleClearCredentialLoginIntent('yaohuo');
    yaohuoLoginPanelRequestRef.current += 1;
    yaohuoWebViewRef.current?.stopLoading();
    setShowYaohuoLoginPanel(false);
    setYaohuoLoginPrompt('');
    setLoadingYaohuoLoginPage(false);
  }, [handleClearCredentialLoginIntent]);

  const changeYaohuoLoginPanel = useCallback((visible: boolean) => {
    if (visible && yaohuoCredentialSuppressedRef.current) {
      notify('妖火临时匿名测试已开启，请关闭测试后再打开登录页。');
      return false;
    }
    if (visible) {
      const requestId = yaohuoLoginPanelRequestRef.current + 1;
      yaohuoLoginPanelRequestRef.current = requestId;
      setLoadingYaohuoLoginPage(true);
      void restoreSavedYaohuoCookiesToWebView({
        isCurrent: () => yaohuoLoginPanelRequestRef.current === requestId
          && !yaohuoCredentialSuppressedRef.current
      })
        .catch(() => undefined)
        .finally(() => {
          if (yaohuoLoginPanelRequestRef.current !== requestId) {
            return;
          }
          setShowYaohuoLoginPanel(true);
          yaohuoWebViewRef.current?.reload();
        });
      return true;
    }
    closeYaohuoLoginPanel();
    return true;
  }, [closeYaohuoLoginPanel, notify, restoreSavedYaohuoCookiesToWebView]);

  useEffect(() => {
    if (__DEV__ && devAnonymousOverrides.yaohuo && showYaohuoLoginPanel) {
      closeYaohuoLoginPanel();
    }
  }, [closeYaohuoLoginPanel, devAnonymousOverrides.yaohuo, showYaohuoLoginPanel]);

  const changeNodeSeekLoginPanel = useCallback((visible: boolean) => {
    nodeSeekLoginPanelRequestRef.current += 1;
    if (!visible) {
      handleClearCredentialLoginIntent('nodeseek');
      pendingNodeSeekSearchRetryRef.current = null;
      pendingNodeSeekTopicRetryRef.current = null;
    }
    webViewRef.current?.stopLoading();
    setLoadingLoginPage(visible);
    setShowLoginPanel(visible);
  }, [handleClearCredentialLoginIntent]);

  const showYaohuoLogin = useCallback((message = '请先登录妖火。') => {
    changeScreen('more');
    setYaohuoLoginPrompt(message);
    changeYaohuoLoginPanel(true);
    notify(message);
  }, [changeScreen, changeYaohuoLoginPanel, notify]);

  const {
    changeLinuxDoPanel,
    checkLinuxDoCookie,
    closeLinuxDoPanel,
    handleLinuxDoCloudflareForTopic,
    handleLinuxDoMessage,
    resetLinuxDoWebView,
    setLinuxDoWebViewErrorForSession,
    setLoadingLinuxDoPageForSession,
    showLinuxDoVerification,
    showNodeSeekVerification,
    stopLinuxDoVerificationForInactiveApp,
    verifyLinuxDoFromTopic
  } = useVerificationController({
    cancelLinuxDoPendingReopenTask,
    changeNodeSeekLoginPanel,
    checkingRequestIdRef,
    closeYaohuoLoginPanel,
    fetcher: forumFetchWithWebViewFallback,
    linuxDoClearanceBeforeVerifyRef,
    linuxDoDismissedVerificationTopicKeyRef,
    linuxDoPanelClosingSessionRef,
    linuxDoPanelCloseSettleTimerRef,
    linuxDoPendingReopenTaskRef,
    linuxDoPendingReopenTopicAfterCloseRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoRequireFreshClearanceRef,
    linuxDoVerifiedRetryTopicKeyRef,
    linuxDoWebViewCookieHeader,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewMountTimerRef,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent,
    linuxDoWebViewUserAgentRef,
    notify,
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    openTopicRef,
    pendingLinuxDoTopicRef,
    reopenExistingTopicScreenRef,
    resetLinuxDoLevelState,
    selectedTopic,
    setChecking,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewError,
    setLinuxDoWebViewKey,
    setLinuxDoWebViewUserAgent,
    setLoadingLinuxDoPage,
    setMountLinuxDoWebView,
    changeScreen,
    setShowLinuxDoPanel,
    setShowSettingsPanel,
    showLinuxDoPanel,
    showLinuxDoPanelRef,
    topicDetail,
    updateLinuxDoSession,
    updateNodeSeekSession
  });
  const previousLinuxDoPanelVisibleRef = useRef(showLinuxDoPanel);
  useEffect(() => {
    if (previousLinuxDoPanelVisibleRef.current && !showLinuxDoPanel) {
      handleClearCredentialLoginIntent('linuxdo');
    }
    previousLinuxDoPanelVisibleRef.current = showLinuxDoPanel;
  }, [handleClearCredentialLoginIntent, showLinuxDoPanel]);

  const handleNodeSeekSearchVerificationRequired = useCallback((message: string, retry: () => void) => {
    pendingNodeSeekSearchRetryRef.current = retry;
    showNodeSeekVerification(message);
  }, [showNodeSeekVerification]);

  const handleNodeSeekTopicVerificationRequired = useCallback((message: string) => {
    updateNodeSeekSession({ type: 'verification-required', message });
  }, [updateNodeSeekSession]);

  const {
    checkLogin,
    checkYaohuoCookie,
    clearLinuxDoCookie,
    clearLogin,
    clearYaohuoLogin,
    handleLoginMessage,
    recordNodeSeekLoginWebViewState,
    recordYaohuoLoginWebViewState,
    rememberVisibleNodeSeekCookies,
    refreshLinuxDoLevel
  } = useAccountController({
    checkingRequestIdRef,
    clearNodeSeekLoginCookiesOnly,
    clearNodeSeekLoginState,
    clearYaohuoLoginState,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    forumFetchWithWebViewFallback,
    linuxDoLevelRequestIdRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekLoginPanelRequestRef,
    nodeSeekCurrentUserId: siteSessionViewModels.nodeseek.currentUser?.id ?? null,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    onLoginWebViewFailure: handleCredentialLoginWebViewFailure,
    resetLinuxDoLevelState,
    resetLinuxDoWebView,
    saveNodeSeekCookieHeader,
    saveYaohuoCookieHeader,
    setChecking,
    setLinuxDoLevelBusy,
    setLinuxDoLevelError,
    setLinuxDoLevelProfile,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    showLinuxDoVerification,
    showLoginPanelRef,
    showYaohuoLoginPanel,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession,
    webLoginDetectedRef,
    webViewRef,
    yaohuoCredentialSuppressedRef,
    yaohuoLoginPanelRequestRef,
    yaohuoWebViewRef
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        stopLinuxDoVerificationForInactiveApp();
      }
    });
    return () => subscription.remove();
  }, [stopLinuxDoVerificationForInactiveApp]);

  const closeMorePanels = useCallback(() => {
    changeNodeSeekLoginPanel(false);
    closeNodeImageAuthPanel();
    closeYaohuoLoginPanel();
    closeLinuxDoPanel();
    setShowNetworkProxyPanel(false);
    setShowSettingsPanel(false);
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]);

  const sourceGateway = useMemo(() => createSourceGateway({
    clearYaohuoLoginState,
    fetcher: forumFetchWithWebViewFallback,
    isYaohuoCredentialSuppressed: () => yaohuoCredentialSuppressedRef.current,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgent: () => nodeSeekWebViewUserAgentRef.current
  }), [
    clearYaohuoLoginState,
    forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource
  ]);

  const {
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy,
    feedFilter,
    feedSource,
    loadFeed,
    readingFilter,
    refreshFeed,
    setCategoryFilter,
    setFeedFilter,
    setReadingFilter,
    shownFeedItems
  } = useFeedController({
    notify,
    readerData,
    readerDataLoaded,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin,
    sourceGateway,
    yaohuoCredentialSuppressed: Boolean(__DEV__ && devAnonymousOverrides.yaohuo)
  });

  const {
    applySearchFilter,
    loadMoreSearchSource,
    recentSearches,
    removeRecentSearch,
    retrySearchSource,
    runSearch,
    searchBusy,
    searchFilters,
    searchGroups,
    searchSessionNotices,
    searchQuery,
    searchSource,
    submittedSearchQuery,
    setSearchQuery,
    setSearchSource
  } = useSearchController({
    categories,
    notify,
    onNodeSeekSearchVerificationRequired: handleNodeSeekSearchVerificationRequired,
    sessionViewModels: siteSessionViewModels,
    showNodeSeekVerification,
    showYaohuoLogin,
    sourceGateway
  });

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
    linuxDoSession: siteSessionViewModels.linuxdo.status,
    nodeSeekSession: siteSessionViewModels.nodeseek.status,
    proxyEnabled: networkProxyState.enabled,
    reactNativeVersion: CURRENT_REACT_NATIVE_VERSION,
    screenHeight: height,
    screenWidth: width,
    theme: theme.dark ? 'dark' as const : 'light' as const,
    versionCode: CURRENT_ANDROID_VERSION_CODE,
    yaohuoSession: siteSessionViewModels.yaohuo.status
  }), [
    fontScale,
    height,
    networkProxyState.enabled,
    screen,
    siteSessionViewModels,
    theme.dark,
    width
  ]);
  const {
    diagnosticBusy,
    exportDiagnosticLogFile
  } = useDiagnosticLogController({ getCurrentScreen, metadata: diagnosticMetadata, notify });
  const {
    refreshAccountStatus,
    statusBusy
  } = useAccountStatusController({
    clearNodeSeekLoginCookiesOnly,
    clearYaohuoLoginState,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    dispatchSiteSessionEvent,
    fetcher: forumFetchWithWebViewFallback,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    loadNodeSeekCookieForSource: loadStoredNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    resetLinuxDoLevelState,
    saveNodeSeekCookieHeader,
    yaohuoCredentialSuppressed: Boolean(__DEV__ && devAnonymousOverrides.yaohuo),
    yaohuoCredentialSuppressedRef
  });
  useEffect(() => {
    if (!readerDataLoaded || accountStatusInitialRefreshRef.current) {
      return;
    }
    accountStatusInitialRefreshRef.current = true;
    void refreshAccountStatus({ silent: true });
  }, [readerDataLoaded, refreshAccountStatus]);
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
    const shouldInvalidateTopicActions = shouldInvalidateTopicActionsOnScreenChange(previousScreen, nextScreen);
    if (previousScreen === 'more' && nextScreen !== 'more') {
      closeMorePanels();
    }
    if (nextScreen !== 'topic') {
      linuxDoVerifiedRetryTopicKeyRef.current = null;
    }
    if (leavingTopicForUser) {
      topicRequestIdRef.current += 1;
      repliesRequestIdRef.current += 1;
      topicAbortRef.current?.abort();
      repliesAbortRef.current?.abort();
      abortQuotedReplyRequests();
      if (shouldInvalidateTopicActions) {
        invalidateTopicActionRequests(null);
      }
      stopTopicWork();
    }
    if (nextScreen !== 'topic' && !leavingTopicForUser) {
      clearTopicBackStack();
      clearTopicRoutes();
      topicRequestIdRef.current += 1;
      repliesRequestIdRef.current += 1;
      topicAbortRef.current?.abort();
      repliesAbortRef.current?.abort();
      abortQuotedReplyRequests();
      pendingLinuxDoTopicRef.current = null;
      invalidateTopicActionRequests(null);
      stopTopicWork(true);
    }
    if (nextScreen !== 'user' && nextScreen !== 'topic') {
      userReturnTopicRef.current = null;
    }
    screenRef.current = nextScreen;
    if (shouldUpdateAppRootScreen(previousScreen, nextScreen)) {
      setScreen(nextScreen);
    }
    finishDiagnosticTrace(trace, 'success', { state: 'applied' });
  }, [abortQuotedReplyRequests, activateTopicRoute, clearTopicBackStack, clearTopicRoutes, closeMorePanels, invalidateTopicActionRequests, restoreTopicRoute, stopTopicWork]);

  const rememberVisibleNodeSeekCookiesAndRetrySearch = useCallback(async (options?: { silent?: boolean }) => {
    const saved = await rememberVisibleNodeSeekCookies(options);
    if (!saved) {
      return false;
    }
    const retry = takeNodeSeekVerificationRetry(pendingNodeSeekSearchRetryRef, pendingNodeSeekTopicRetryRef);
    if (retry?.type === 'search') {
      changeNodeSeekLoginPanel(false);
      changeScreen('search');
      retry.retry();
    } else if (retry?.type === 'topic') {
      reopenExistingTopicScreenRef.current = true;
      changeNodeSeekLoginPanel(false);
      changeScreen('topic');
      void openTopicRef.current?.(retry.topic, true);
    }
    return true;
  }, [changeNodeSeekLoginPanel, changeScreen, rememberVisibleNodeSeekCookies]);

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
        snapshot: topicSnapshotForUserReturn(
          topicSnapshot(),
          hasPendingOptimisticTopicAction(optimisticTopicActionsRef.current)
        ),
        backStack: readTopicBackStack()
      };
    } else if (currentScreen !== 'user') {
      userReturnTopicRef.current = null;
    }
    changeScreen('user');
  }, [changeScreen, readTopicBackStack, saveTopicRoute, topicSnapshot]);

  const pushTopicScreen = useCallback(() => {
    const routeKey = currentTopicRouteKey();
    if (routeKey) {
      saveTopicRoute(routeKey);
    }
    pushTopicRoute();
  }, [saveTopicRoute]);

  const {
    currentUserFollowed,
    followedUserRecords,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openUser,
    selectedUser,
    userBusy,
    userError,
    userLoadingMoreReplies,
    userLoadingMoreTopics,
    userProfile
  } = useUserController({
    notify,
    onOpenUserScreen: prepareUserNavigation,
    readerData,
    screen,
    sessionViewModels: siteSessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification,
    sourceGateway,
    showYaohuoLogin
  });
  openUserRef.current = openUser;

  const {
    loadMoreReplies,
    openTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    toggleQuotedFloor,
    topicFavorite
  } = useTopicController({
    changeScreen,
    commitReaderData,
    handleLinuxDoCloudflareForTopic,
    linuxDoDismissedVerificationTopicKeyRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoVerifiedRetryTopicKeyRef,
    notify,
    onNodeSeekTopicVerificationRequired: handleNodeSeekTopicVerificationRequired,
    pendingLinuxDoTopicRef,
    pushTopicScreen,
    readerData,
    readerDataRef,
    reopenExistingTopicScreenRef,
    repliesAbortRef,
    repliesRequestIdRef,
    getCurrentScreen,
    screen,
    showYaohuoLogin,
    sourceGateway,
    topicAbortRef,
    topicRequestIdRef,
    topicReturnScreenRef,
    topicSession
  });
  const showLinuxDoLogin = useCallback((message = '匿名可阅读，登录后才能互动。') => {
    changeScreen('more');
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    notify(message);
    changeLinuxDoPanel(true);
  }, [changeLinuxDoPanel, changeNodeSeekLoginPanel, changeScreen, closeYaohuoLoginPanel, notify]);

  openTopicRef.current = openTopic;

  const verifyNodeSeekFromTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source !== 'nodeseek') {
      return;
    }
    pendingNodeSeekTopicRetryRef.current = detail;
    showNodeSeekVerification(topicError?.message || 'NodeSeek 需要完成 Cloudflare 验证');
  }, [selectedTopic, showNodeSeekVerification, topicDetail, topicError]);

  const {
    bookmarkOnLinuxDoSite,
    canUseLinuxDoActions,
    canUseNodeSeekActions,
    canUseYaohuoActions,
    checkIn,
    collectOnNodeSeekSite,
    deleteReply,
    favoriteOnYaohuoSite,
    interact,
    submitReply,
    uploadReplyImage,
    votePoll
  } = useTopicActionsController({
    actionAbortRef,
    clearNodeSeekLoginCookiesOnly,
    clearYaohuoLoginState,
    currentNodeSeekCredentialGeneration,
    fetcher: networkProxyFetcher,
    linuxDoWebViewUserAgentRef,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekWebViewUserAgentRef,
    ensureNodeImageApiKey,
    notify,
    optimisticTopicActionsRef,
    refreshTopicReplies,
    resetLinuxDoLevelState,
    setActionBusy,
    setOptimisticTopicActions,
    showLinuxDoLogin,
    showYaohuoLogin,
    siteSessionStates: effectiveSiteSessionStates,
    topicActionRequestOwnerRef,
    topicSession,
    updateLinuxDoSession,
    yaohuoCredentialSuppressedRef
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
    try {
      await Share.share({
        title: detail.title,
        message: `${detail.title}\n${detail.url}`,
        url: detail.url
      });
    } catch {
      await Clipboard.setStringAsync(detail.url);
      notify('链接已复制');
    }
  }, [notify, selectedTopic, topicDetail]);

  const goBackFromTopic = useCallback((parentTrace?: DiagnosticTrace) => {
    const trace = parentTrace || beginDiagnosticTrace('navigation', 'topic-back');
    abortQuotedReplyRequests();
    cancelDeferredNavigationTask();
    const closingRouteKey = currentTopicRouteKey();
    const returningRouteKey = previousTopicRouteKey();
    const previousTopic = popTopicBackStack();
    const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();
    markDiagnosticStage(trace, 'guard', {
      canGoBack,
      hasRoute: Boolean(returningRouteKey),
      hasSnapshot: Boolean(previousTopic)
    });
    if (returningRouteKey || previousTopic) {
      topicRequestIdRef.current += 1;
      repliesRequestIdRef.current += 1;
      topicAbortRef.current?.abort();
      repliesAbortRef.current?.abort();
      const restoredByRoute = returningRouteKey ? restoreTopicRoute(returningRouteKey) : false;
      if (!restoredByRoute && previousTopic) {
        restoreTopicSnapshot(previousTopic);
      }
      if (closingRouteKey) {
        forgetTopicRoute(closingRouteKey);
      }
      if (canGoBack) {
        navigationRef.goBack();
      }
      finishDiagnosticTrace(trace, 'success', {
        state: restoredByRoute ? 'route-restored' : 'snapshot-restored'
      });
      return;
    }
    if (closingRouteKey) {
      forgetTopicRoute(closingRouteKey);
    }
    if (canGoBack) {
      navigationRef.goBack();
      finishDiagnosticTrace(trace, 'success', { state: 'native-back' });
      return;
    }
    changeScreen(topicReturnScreenRef.current);
    finishDiagnosticTrace(trace, 'success', { state: 'return-screen' });
  }, [abortQuotedReplyRequests, cancelDeferredNavigationTask, changeScreen, forgetTopicRoute, popTopicBackStack, restoreTopicRoute, restoreTopicSnapshot]);

  const goBackFromUser = useCallback((parentTrace?: DiagnosticTrace) => {
    const trace = parentTrace || beginDiagnosticTrace('navigation', 'user-back');
    cancelDeferredNavigationTask();
    const returnTopic = userReturnScreenRef.current === 'topic' ? userReturnTopicRef.current : null;
    const shouldReloadRestoredTopic = Boolean(returnTopic?.snapshot.selectedTopic && !returnTopic.snapshot.topicDetail && !returnTopic.snapshot.topicError);
    const restoreReturnTopic = () => {
      if (!returnTopic) {
        return;
      }
      topicReturnScreenRef.current = returnTopic.returnScreen;
      replaceTopicBackStack(returnTopic.backStack);
      restoreTopicSnapshot(returnTopic.snapshot);
      userReturnTopicRef.current = null;
    };
    const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();
    markDiagnosticStage(trace, 'guard', {
      canGoBack,
      hasSnapshot: Boolean(returnTopic),
      shouldReload: shouldReloadRestoredTopic
    });
    if (canGoBack) {
      navigationRef.goBack();
    } else {
      changeScreen(userReturnScreenRef.current);
    }
    if (returnTopic?.snapshot.selectedTopic && shouldReloadRestoredTopic) {
      const selectedReturnTopic = returnTopic.snapshot.selectedTopic;
      const reloadRestoredTopic = () => {
        reopenExistingTopicScreenRef.current = true;
        void openTopic(selectedReturnTopic);
      };
      if (canGoBack) {
        runAfterNavigationInteractions(() => {
          restoreReturnTopic();
          reloadRestoredTopic();
        });
      } else {
        restoreReturnTopic();
        reloadRestoredTopic();
      }
      finishDiagnosticTrace(trace, canGoBack ? 'partial' : 'success', { state: 'topic-reload-scheduled' });
      return;
    }
    if (canGoBack && returnTopic) {
      runAfterNavigationInteractions(restoreReturnTopic);
      finishDiagnosticTrace(trace, 'partial', { state: 'topic-restore-scheduled' });
      return;
    } else {
      restoreReturnTopic();
    }
    finishDiagnosticTrace(trace, 'success', {
      state: returnTopic ? 'topic-restored' : 'return-screen'
    });
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
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    closeLinuxDoPanel();
    setShowSettingsPanel(true);
    changeScreen('more');
  }, [changeNodeSeekLoginPanel, changeScreen, closeLinuxDoPanel, closeYaohuoLoginPanel]);

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
        changeNodeSeekLoginPanel(false);
        return handled('login-panel-closed');
      }
      if (showNodeImageAuthPanel) {
        closeNodeImageAuthPanel();
        return handled('image-auth-panel-closed');
      }
      if (showYaohuoLoginPanel) {
        closeYaohuoLoginPanel();
        return handled('yaohuo-panel-closed');
      }
      if (showLinuxDoPanel) {
        closeLinuxDoPanel();
        return handled('linuxdo-panel-closed');
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
    loadFeed({ page: activeFeedState.page + 1, cursor: activeFeedState.nextCursor, nocache: true });
  }, [activeFeedState.nextCursor, activeFeedState.page, feedAllowsRemotePagination, loadFeed]);

  const runCurrentSearch = useCallback(() => {
    void runSearch();
  }, [runSearch]);

  const refreshCurrentUser = useCallback(() => {
    const user = userProfile || selectedUser;
    if (user) {
      void openUser(user, true);
    }
  }, [openUser, selectedUser, userProfile]);

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
    openUser,
    refreshAccountStatus,
    setYaohuoLoginPrompt,
    webViewRef,
    webViewBlockMessage: networkProxyWebViewBlockMessage,
    yaohuoWebViewRef
  });
  credentialFailureHandlerRef.current = finishCredentialFillForLoginFailure;
  credentialClearIntentHandlerRef.current = clearCredentialLoginIntent;

  const feedProps = useMemo(() => ({
      busy: feedBusy || actionBusy,
      categories,
      categoryFilter,
      feedHasMore: activeFeedState.hasMore && feedAllowsRemotePagination,
      feedItems: shownFeedItems,
      feedPage: activeFeedState.page,
      feedSource,
      feedFilter,
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
      onOpenTopic: openTopic,
      onReadingFilterChange: setReadingFilter,
      onRefresh: refreshFeed
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
    feedSource,
    loadMoreActiveFeed,
    openTopic,
    readingFilter,
    refreshFeed,
    setFeedFilter,
    shownFeedItems,
    styles,
    tabScrollToTopSignals.feed,
    theme,
    topicStateIndex
  ]);

  const searchProps = useMemo(() => ({
      busy: searchBusy,
      categories,
      query: searchQuery,
      topicStateIndex,
      recentSearches,
      searchFilters,
      searchGroups,
      searchSessionNotices,
      searchSource,
      submittedQuery: submittedSearchQuery,
      scrollToTopSignal: tabScrollToTopSignals.search,
      styles,
      theme,
      onLoadMoreSearchSource: loadMoreSearchSource,
      onOpenTopic: openTopic,
      onRemoveRecentSearch: removeRecentSearch,
      onQueryChange: setSearchQuery,
      onSearch: runCurrentSearch,
      onSearchFilterApply: applySearchFilter,
      onSearchSourceChange: setSearchSource,
      onRetrySearchSource: retrySearchSource
  }), [
    applySearchFilter,
    categories,
    loadMoreSearchSource,
    openTopic,
    recentSearches,
    removeRecentSearch,
    retrySearchSource,
    runCurrentSearch,
    searchBusy,
    searchFilters,
    searchGroups,
    searchQuery,
    searchSessionNotices,
    searchSource,
    styles,
    submittedSearchQuery,
    tabScrollToTopSignals.search,
    theme,
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
      nodeSeekUserId: effectiveNodeSeekUserId,
      nodeSeekWebViewUserAgent,
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
      sessionViewModels: siteSessionViewModels,
      devAnonymousAvailable: __DEV__,
      devAnonymousOverrides,
      networkProxyActiveProfile,
      networkProxyApplyError,
      networkProxyApplyStatus,
      networkProxyState,
      networkProxySummary,
      webViewBlockMessage: networkProxyWebViewBlockMessage,
      onAccountCenterCommand: handleAccountCenterCommand,
      onCheckAppUpdate: checkAppUpdate,
      onDownloadAppUpdate: downloadAppUpdate,
      onCheckIn: checkIn,
      onCheckLogin: checkLogin,
      onRememberNodeSeekCookies: rememberVisibleNodeSeekCookiesAndRetrySearch,
      onAuthorizeNodeImageApiKey: authorizeNodeImageApiKey,
      onSaveNodeImageApiKey: saveNodeImageApiKeyInput,
      onClearNodeImageApiKey: clearNodeImageApiKeyInput,
      onCheckYaohuoLogin: checkYaohuoCookie,
      onRefreshLinuxDoLevel: refreshLinuxDoLevel,
      onClearLogin: clearLogin,
      onClearYaohuoLogin: clearYaohuoLogin,
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
      onToggleDevAnonymousOverride: toggleDevAnonymousOverride,
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
    checkLogin,
    checkYaohuoCookie,
    checking,
    clearLogin,
    clearYaohuoLogin,
    credentialFillAttempt,
    credentialLoginSite,
    credentialSummaries,
    authorizeNodeImageApiKey,
    deleteNetworkProxyProfile,
    devAnonymousOverrides,
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
    loadingLoginPage,
    loadingYaohuoLoginPage,
    nodeSeekWebViewUserAgent,
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
    rememberVisibleNodeSeekCookiesAndRetrySearch,
    saveNodeImageApiKeyInput,
    clearNodeImageApiKeyInput,
    selectNetworkProxyProfile,
    setNetworkProxyEnabled,
    showLinuxDoPanel,
    showLoginPanel,
    showNetworkProxyPanel,
    showSettingsPanel,
    showYaohuoLoginPanel,
    siteSessionViewModels,
    statusBusy,
    styles,
    testNetworkProxyProfile,
    theme,
    toggleDevAnonymousOverride,
    upsertNetworkProxyProfile,
    updateSettings,
    yaohuoLoginPrompt
  ]);

  const topicProps = useMemo(() => ({
      actionBusy,
      canUseLinuxDoActions,
      canUseNodeSeekActions,
      canUseYaohuoActions,
      contentWidth,
      htmlBaseStyle,
      htmlClassesStyles,
      htmlIgnoredStyles,
      htmlRenderers,
      htmlRenderersProps,
      htmlTagsStyles,
      inlineSizedImageUrls,
      topicImageDeriver,
      expandedQuotes,
      loadedQuotedReplies,
      loadingMoreReplies,
      loadingQuotedFloors,
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
      topic: topicDetail,
      topicBusy,
      topicError,
      topicScrollRef,
      unreadReplyCount,
      onBack: goBackFromTopic,
      onCommentQueryChange: changeCommentQuery,
      optimisticActions: optimisticTopicActions,
      onDeleteReply: deleteReply,
      onEditReply: editReply,
      onInteract: interact,
      onLinuxDoBookmark: bookmarkOnLinuxDoSite,
      onNodeSeekCollection: collectOnNodeSeekSite,
      onShareTopic: shareTopic,
      onYaohuoFavorite: favoriteOnYaohuoSite,
      onVotePoll: votePoll,
      onLoadMoreReplies: loadMoreReplies,
      onOpenOriginal: openExternalUrl,
      onOpenReadingSettings: openReadingSettingsFromTopic,
      onReplyComposerOpenChange: toggleReplyComposer,
      onReplyContentChange: changeReplyContent,
      onReplyFaceChange: changeReplyFace,
      onReplyFilterChange: changeReplyFilter,
      onReplyToFloor: replyToFloor,
      onRefreshTopic: refreshTopicReplies,
      onRefreshWholeTopic: refreshWholeTopic,
      onVerifyLinuxDo: verifyLinuxDoFromTopic,
      onVerifyNodeSeek: verifyNodeSeekFromTopic,
      onSubmitReply: submitReply,
      onUploadReplyImage: uploadReplyImage,
      onTopicScroll: handleTopicScroll,
      onToggleQuotedFloor: toggleQuotedFloor,
      onToggleFavorite: toggleTopicFavorite,
      onOpenUser: openUser
  }), [
    actionBusy,
    bookmarkOnLinuxDoSite,
    canUseLinuxDoActions,
    canUseNodeSeekActions,
    canUseYaohuoActions,
    collectOnNodeSeekSite,
    commentQuery,
    deleteReply,
    editReply,
    contentWidth,
    debouncedCommentQuery,
    expandedQuotes,
    favoriteOnYaohuoSite,
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
    interact,
    loadMoreReplies,
    loadedQuotedReplies,
    loadingMoreReplies,
    loadingQuotedFloors,
    openExternalUrl,
    openReadingSettingsFromTopic,
    openUser,
    optimisticTopicActions,
    quoteStateVersion,
    refreshTopicReplies,
    refreshWholeTopic,
    replyComposerOpen,
    replyContent,
    replyFace,
    replyEditTarget,
    replyFilter,
    replyHasMore,
    replyTarget,
    replyToFloor,
    changeReplyFace,
    selectedTopic,
    shareTopic,
    styles,
    submitReply,
    theme,
    toggleReplyComposer,
    toggleTopicFavorite,
    toggleQuotedFloor,
    topicBusy,
    topicDetail,
    topicError,
    topicFavorite,
    topicImageDeriver,
    topicReplies,
    topicScrollRef,
    unreadReplyCount,
    verifyNodeSeekFromTopic,
    verifyLinuxDoFromTopic,
    uploadReplyImage,
    votePoll
  ]);

  const userProps = useMemo(() => ({
      busy: userBusy,
      error: userError,
      followed: currentUserFollowed,
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
      onOpenOriginal: openExternalUrl,
      onOpenTopic: openTopic,
      onRefresh: refreshCurrentUser,
      onToggleFollow: toggleUserFollow
  }), [
    currentUserFollowed,
    goBackFromUser,
    loadMoreUserReplies,
    loadMoreUserTopics,
    openExternalUrl,
    openTopic,
    refreshCurrentUser,
    selectedUser,
    styles,
    theme,
    toggleUserFollow,
    topicStateIndex,
    userBusy,
    userError,
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
  const renderTopicScreen = useCallback(() => (
    <TopicScreen {...topicProps} />
  ), [topicProps]);
  const renderUserScreen = useCallback(() => (
    <UserScreen {...userProps} />
  ), [userProps]);

  const handleMainTabPress = useCallback((targetScreen: keyof MainTabParamList) => {
    if (screenRef.current === targetScreen) {
      requestTabScrollToTop(targetScreen);
    }
    changeScreen(targetScreen);
  }, [changeScreen, requestTabScrollToTop]);

  return (
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
              clearLinuxDoCookie={clearLinuxDoCookie}
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
              linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
              loadingLinuxDoPage={loadingLinuxDoPage}
              loadingNodeImageAuthPage={loadingNodeImageAuthPage}
              mountLinuxDoWebView={mountLinuxDoWebView}
              nodeImageAuthError={nodeImageAuthError}
              nodeImageAuthPayload={nodeImageAuthPayload}
              nodeImageAuthUrl={nodeImageAuthUrl}
              nodeImageAuthWebViewRef={nodeImageAuthWebViewRef}
              nodeSeekWebViewUserAgent={nodeSeekWebViewUserAgent}
              resetLinuxDoWebView={resetLinuxDoWebView}
              savePreviewImage={savePreviewImage}
              selectPreviewImage={selectPreviewImage}
              setLinuxDoWebViewErrorForSession={setLinuxDoWebViewErrorForSession}
              setLoadingLinuxDoPageForSession={setLoadingLinuxDoPageForSession}
              setLoadingNodeImageAuthPage={setLoadingNodeImageAuthPage}
              setNodeImageAuthError={setNodeImageAuthError}
              showLinuxDoPanel={showLinuxDoPanel}
              showNodeImageAuthPanel={showNodeImageAuthPanel}
              showNextImage={showNextImage}
              showPreviousImage={showPreviousImage}
              styles={styles}
              theme={theme}
              webViewBlockMessage={networkProxyWebViewBlockMessage}
              changeLinuxDoPanel={changeLinuxDoPanel}
              requestLinuxDoCredentialFill={() => openAccountLogin('linuxdo', true)}
              closeNodeImageAuthPanel={closeNodeImageAuthPanel}
            />
              {networkProxyContentReady ? (
              <AppNavigator
              moreHasBadge={Boolean(appUpdateInfo)}
              navigationTheme={navigationTheme}
              renderFeedTab={renderFeedTab}
              renderLibraryTab={renderLibraryTab}
              renderMoreTab={renderMoreTab}
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
              ) : null}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
