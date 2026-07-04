import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Share,
  ToastAndroid,
  View,
  useWindowDimensions
} from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import { DarkTheme, DefaultTheme, StackActions } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '../nodeseekCookies';
import type { TopicRecord } from '../readerData';
import { useReaderDataController } from './useReaderDataController';
import { useReaderDataActionsController } from './useReaderDataActionsController';
import { useReaderSettingsController } from './useReaderSettingsController';
import { useBackupStatusController } from './useBackupStatusController';
import { useAppUpdateController } from './useAppUpdateController';
import { useFeedController } from './useFeedController';
import { useHtmlRenderingController } from './useHtmlRenderingController';
import { useHiddenBrowserFetchController } from './useHiddenBrowserFetchController';
import { AppNavigator, navigateMainTab, navigationRef, type MainTabParamList } from './AppNavigator';
import { useImagePreviewController } from './useImagePreviewController';
import { useSearchController } from './useSearchController';
import { useSessionController } from './useSessionController';
import { useTopicController } from './useTopicController';
import { useTopicNavigationController } from './useTopicNavigationController';
import { useTopicUiStateController } from './useTopicUiStateController';
import { useUserController } from './useUserController';
import { useVerificationController, type DeferredNavigationTask } from './useVerificationController';
import { useAccountController } from './useAccountController';
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
import type { LinuxDoLevelProfile } from '../sources/sourceGateway';
import type { FeedSource, Reply, Source, Topic, TopicDetail, UserProfile } from '../types';
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
  nodeSeekLoginStateLabel,
  type DevAnonymousOverrides,
  type SessionSite
} from '../siteSessionState';
import { clearNodeImageApiKey, loadNodeImageApiKey, saveNodeImageApiKey } from '../nodeimageCredentials';
import { nodeImageApiKeyFromResponse } from '../replyImageUpload';
import { NODEIMAGE_AUTH_URL, NODEIMAGE_URL } from '../appUrls';
import type { NodeImageAuthPayload } from '../loginWebViewScripts';

type UserReturnTopic = {
  returnScreen: Exclude<Screen, 'topic'>;
  snapshot: TopicSnapshot;
  backStack: TopicSnapshot[];
};
const NODESEEK_LOGIN_HOSTS = ['nodeseek.com', 'challenges.cloudflare.com'];
const NODEIMAGE_LOGIN_HOSTS = ['nodeimage.com', 'nodeseek.com', 'challenges.cloudflare.com'];
const YAOHUO_LOGIN_HOSTS = ['yaohuo.me'];
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
  const loadingMoreRepliesRef = useRef(false);
  const repliesAbortRef = useRef<AbortController | null>(null);
  const repliesRequestIdRef = useRef(0);
  const currentTopicKeyRef = useRef<string | null>(null);
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);
  const topicReturnScreenRef = useRef<Exclude<Screen, 'topic'>>('feed');
  const topicBackStackRef = useRef<TopicSnapshot[]>([]);
  const userReturnScreenRef = useRef<Exclude<Screen, 'user'>>('feed');
  const userReturnTopicRef = useRef<UserReturnTopic | null>(null);
  const reopenExistingTopicScreenRef = useRef(false);
  const skipNextNavigationSyncRef = useRef(false);
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
  const [topicBusy, setTopicBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [optimisticTopicActions, setOptimisticTopicActions] = useState<Record<string, OptimisticActionState>>({});
  const [nodeSeekWebViewUserAgent, setNodeSeekWebViewUserAgent] = useState(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const [nodeImageApiKeySaved, setNodeImageApiKeySaved] = useState(false);
  const [nodeImageApiKeyBusy, setNodeImageApiKeyBusy] = useState(false);
  const [showNodeImageAuthPanel, setShowNodeImageAuthPanel] = useState(false);
  const [nodeImageAuthUrl, setNodeImageAuthUrl] = useState(NODEIMAGE_AUTH_URL);
  const [nodeImageAuthPayload, setNodeImageAuthPayload] = useState<NodeImageAuthPayload | null>(null);
  const [loadingNodeImageAuthPage, setLoadingNodeImageAuthPage] = useState(false);
  const [nodeImageAuthError, setNodeImageAuthError] = useState('');
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
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
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicError, setTopicError] = useState('');
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const topicScrollYRef = useRef(0);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [unreadReplyCount, setUnreadReplyCount] = useState(0);
  const [loadingMoreReplies, setLoadingMoreReplies] = useState(false);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const showLoginPanelRef = useRef(showLoginPanel);
  const [showYaohuoLoginPanel, setShowYaohuoLoginPanel] = useState(false);
  const [yaohuoLoginPrompt, setYaohuoLoginPrompt] = useState('');
  const [showLinuxDoPanel, setShowLinuxDoPanel] = useState(false);
  const showLinuxDoPanelRef = useRef(showLinuxDoPanel);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  screenRef.current = screen;
  showLoginPanelRef.current = showLoginPanel;
  showLinuxDoPanelRef.current = showLinuxDoPanel;
  useEffect(() => {
    setTopicDetail((current) => {
      if (!current || current.replies === topicReplies) {
        return current;
      }
      return {
        ...current,
        replies: topicReplies
      };
    });
  }, [topicReplies]);
  const cancelLinuxDoPendingReopenTask = useCallback(() => {
    linuxDoPendingReopenTaskRef.current?.cancel();
    linuxDoPendingReopenTaskRef.current = null;
  }, []);
  const theme = useMemo(() => createTheme(readerData.settings), [readerData.settings]);
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
  const styles = useMemo(() => createStyles(theme, readerData.settings, height), [height, readerData.settings, theme]);
  const contentWidth = Math.min(width - 40, contentWidthValue(readerData.settings.contentWidth));

  const {
    clearNodeSeekLoginCookiesOnly,
    clearNodeSeekLoginState,
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
    linuxDoBrowserWebViewRef,
    linuxDoClearanceBeforeVerifyRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewUserAgent,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    webLoginDetectedRef,
    webLoginUserId
  });

  const [devAnonymousOverrides, setDevAnonymousOverrides] = useState<DevAnonymousOverrides>({});
  const effectiveSiteSessionStates = useMemo(() => (
    __DEV__ ? applyDevAnonymousOverrides(siteSessionStates, devAnonymousOverrides) : siteSessionStates
  ), [devAnonymousOverrides, siteSessionStates]);
  const siteSessionViewModels = useMemo(() => createSiteSessionViewModels(effectiveSiteSessionStates), [effectiveSiteSessionStates]);
  const loginState = useMemo(() => (
    nodeSeekLoginStateLabel(siteSessionViewModels.nodeseek, __DEV__ && devAnonymousOverrides.nodeseek ? null : webLoginUserId)
  ), [devAnonymousOverrides.nodeseek, siteSessionViewModels.nodeseek, webLoginUserId]);
  const yaohuoLoginState = siteSessionViewModels.yaohuo.summaryLabel;
  useEffect(() => {
    setLinuxDoDevAnonymousOverride(Boolean(__DEV__ && devAnonymousOverrides.linuxdo));
    return () => setLinuxDoDevAnonymousOverride(false);
  }, [devAnonymousOverrides.linuxdo]);
  const toggleDevAnonymousOverride = useCallback((site: SessionSite) => {
    if (!__DEV__) {
      return;
    }
    setDevAnonymousOverrides((current) => ({
      ...current,
      [site]: !current[site]
    }));
  }, []);
  const loadNodeSeekCookieForSource = useCallback((source: FeedSource | Source, options?: Parameters<typeof loadStoredNodeSeekCookieForSource>[1]) => {
    if (__DEV__ && isDevAnonymousSource(source, 'nodeseek', devAnonymousOverrides)) {
      return Promise.resolve(undefined);
    }
    return loadStoredNodeSeekCookieForSource(source, options);
  }, [devAnonymousOverrides.nodeseek, loadStoredNodeSeekCookieForSource]);
  const loadYaohuoCookieForSource = useCallback((source: FeedSource | Source, options?: Parameters<typeof loadStoredYaohuoCookieForSource>[1]) => {
    if (__DEV__ && isDevAnonymousSource(source, 'yaohuo', devAnonymousOverrides)) {
      return Promise.resolve(undefined);
    }
    return loadStoredYaohuoCookieForSource(source, options);
  }, [devAnonymousOverrides.yaohuo, loadStoredYaohuoCookieForSource]);
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
    selectedTopic,
    settings: readerData.settings,
    styles,
    theme,
    topicDetail,
    topicKey: `${selectedTopic?.source || ''}:${selectedTopic?.id || ''}`
  });
  const {
    abortQuotedReplyRequests,
    commentQuery,
    debouncedCommentQuery,
    editReply,
    expandedQuotesRef,
    filteredReplies,
    loadedQuotedReplies,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    quoteStateVersion,
    quotedReplyAbortRefs,
    replyComposerOpen,
    replyContent,
    replyFace,
    replyEditTarget,
    replyFilter,
    replyTarget,
    replyToFloor,
    resetQuoteState,
    setCommentQuery,
    setExpandedQuotes,
    setLoadedQuotedReplies,
    setLoadingQuotedFloors,
    setQuoteStateVersion,
    setReplyComposerOpen,
    setReplyContent,
    setReplyFace,
    setReplyEditTarget,
    setReplyFilter,
    setReplyTarget,
    toggleReplyComposer,
    topicRepliesRef,
    updateExpandedQuotes,
    updateLoadedQuotedReplies,
    updateLoadingQuotedFloors
  } = useTopicUiStateController({
    inlineSizedImageUrls,
    notify,
    topicDetail,
    topicImageDeriver,
    topicReplies
  });
  const nodeSeekCurrentUserForTopicActions = siteSessionViewModels.nodeseek.currentUser || (topicDetail?.source === 'nodeseek' ? topicDetail.currentUser : undefined);
  const displayReplies = useMemo(
    () => markCurrentNodeSeekOwnRepliesUnlikable(filteredReplies, nodeSeekCurrentUserForTopicActions, webLoginUserId),
    [filteredReplies, nodeSeekCurrentUserForTopicActions, webLoginUserId]
  );
  useEffect(() => {
    const currentUser = topicDetail?.source === 'nodeseek' ? topicDetail.currentUser : undefined;
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
  }, [topicDetail?.currentUser, topicDetail?.source, updateNodeSeekSession]);
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
    yaohuoLoginPanelRequestRef.current += 1;
    yaohuoWebViewRef.current?.stopLoading();
    setShowYaohuoLoginPanel(false);
    setYaohuoLoginPrompt('');
    setLoadingYaohuoLoginPage(false);
  }, []);

  const changeYaohuoLoginPanel = useCallback((visible: boolean) => {
    if (visible) {
      const requestId = yaohuoLoginPanelRequestRef.current + 1;
      yaohuoLoginPanelRequestRef.current = requestId;
      setLoadingYaohuoLoginPage(true);
      void restoreSavedYaohuoCookiesToWebView()
        .catch(() => undefined)
        .finally(() => {
          if (yaohuoLoginPanelRequestRef.current !== requestId) {
            return;
          }
          setShowYaohuoLoginPanel(true);
          yaohuoWebViewRef.current?.reload();
        });
      return;
    }
    closeYaohuoLoginPanel();
  }, [closeYaohuoLoginPanel, restoreSavedYaohuoCookiesToWebView]);

  const changeNodeSeekLoginPanel = useCallback((visible: boolean) => {
    nodeSeekLoginPanelRequestRef.current += 1;
    if (!visible) {
      pendingNodeSeekSearchRetryRef.current = null;
      pendingNodeSeekTopicRetryRef.current = null;
    }
    webViewRef.current?.stopLoading();
    setLoadingLoginPage(visible);
    setShowLoginPanel(visible);
  }, []);

  const showYaohuoLogin = useCallback((message = '请先登录妖火。') => {
    setScreen('more');
    setYaohuoLoginPrompt(message);
    changeYaohuoLoginPanel(true);
    notify(message);
  }, [changeYaohuoLoginPanel, notify]);

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
    setScreen,
    setShowLinuxDoPanel,
    setShowSettingsPanel,
    showLinuxDoPanel,
    showLinuxDoPanelRef,
    topicDetail,
    updateLinuxDoSession,
    updateNodeSeekSession
  });

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
    rememberVisibleNodeSeekCookies,
    refreshLinuxDoLevel
  } = useAccountController({
    checkingRequestIdRef,
    clearNodeSeekLoginState,
    clearYaohuoLoginState,
    currentYaohuoCredentialGeneration,
    forumFetchWithWebViewFallback,
    linuxDoLevelRequestIdRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekLoginPanelRequestRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    notify,
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
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession,
    webLoginDetectedRef,
    webViewRef,
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
    setShowSettingsPanel(false);
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeNodeImageAuthPanel, closeYaohuoLoginPanel]);

  const {
    activeFeedState,
    categories,
    categoryFilter,
    changeFeedSource,
    feedAllowsRemotePagination,
    feedBusy,
    feedSource,
    loadFeed,
    readingFilter,
    refreshFeed,
    setCategoryFilter,
    setReadingFilter,
    shownFeedItems
  } = useFeedController({
    clearYaohuoLoginState,
    fetcher: forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    readerData,
    readerDataLoaded,
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
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
    clearYaohuoLoginState,
    fetcher: forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onNodeSeekSearchVerificationRequired: handleNodeSeekSearchVerificationRequired,
    sessionViewModels: siteSessionViewModels,
    showNodeSeekVerification,
    showYaohuoLogin
  });

  const {
    backupBusy,
    exportBackupFile,
    importBackupFile,
    refreshAccountStatus,
    statusBusy
  } = useBackupStatusController({
    clearYaohuoLoginState,
    currentYaohuoCredentialGeneration,
    dispatchSiteSessionEvent,
    fetcher: forumFetchWithWebViewFallback,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    loadNodeSeekCookieForSource: loadStoredNodeSeekCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    readerDataRef,
    replaceReaderData,
    resetLinuxDoLevelState,
    saveNodeSeekCookieHeader,
    waitForReaderDataSave
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
  } = useAppUpdateController({ notify });
  useEffect(() => {
    if (autoAppUpdateCheckedRef.current) {
      return;
    }
    autoAppUpdateCheckedRef.current = true;
    void checkAppUpdate({ silent: true });
  }, [checkAppUpdate]);

  const changeScreen = useCallback((nextScreen: Screen) => {
    const leavingTopicForUser = screen === 'topic' && nextScreen === 'user';
    const shouldInvalidateTopicActions = shouldInvalidateTopicActionsOnScreenChange(screen, nextScreen);
    if (screen === 'more' && nextScreen !== 'more') {
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
      loadingMoreRepliesRef.current = false;
      setLoadingMoreReplies(false);
      setTopicBusy(false);
    }
    if (nextScreen !== 'topic' && !leavingTopicForUser) {
      topicBackStackRef.current = [];
      topicRequestIdRef.current += 1;
      repliesRequestIdRef.current += 1;
      topicAbortRef.current?.abort();
      repliesAbortRef.current?.abort();
      abortQuotedReplyRequests();
      pendingLinuxDoTopicRef.current = null;
      invalidateTopicActionRequests(null);
      currentTopicKeyRef.current = null;
      loadingMoreRepliesRef.current = false;
      setLoadingMoreReplies(false);
      setTopicBusy(false);
    }
    if (nextScreen !== 'user' && nextScreen !== 'topic') {
      userReturnTopicRef.current = null;
    }
    setScreen(nextScreen);
  }, [abortQuotedReplyRequests, closeMorePanels, invalidateTopicActionRequests, screen]);

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

  const { restoreTopicSnapshot, topicSnapshot } = useTopicNavigationController({
    commentQuery,
    currentTopicKeyRef,
    expandedQuotesRef,
    invalidateTopicActionRequests,
    loadedQuotedRepliesRef,
    loadingMoreRepliesRef,
    loadingQuotedFloorsRef,
    replyComposerOpen,
    replyContent,
    replyFace,
    replyEditTarget,
    replyFilter,
    replyHasMore,
    replyNextOffset,
    replyNextPage,
    replyTarget,
    selectedTopic,
    setCommentQuery,
    setExpandedQuotes,
    setLoadedQuotedReplies,
    setLoadingMoreReplies,
    setLoadingQuotedFloors,
    setQuoteStateVersion,
    setReplyComposerOpen,
    setReplyContent,
    setReplyFace,
    setReplyEditTarget,
    setReplyFilter,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setReplyTarget,
    setSelectedTopic,
    setTopicBusy,
    setTopicDetail,
    setTopicError,
    setTopicReplies,
    setUnreadReplyCount,
    topicDetail,
    topicError,
    topicReplies,
    topicScrollYRef,
    unreadReplyCount
  });

  const prepareUserNavigation = useCallback(() => {
    if (screen !== 'user') {
      userReturnScreenRef.current = screen;
    }
    if (screen === 'topic') {
      userReturnTopicRef.current = {
        returnScreen: topicReturnScreenRef.current,
        snapshot: topicSnapshotForUserReturn(
          topicSnapshot(),
          hasPendingOptimisticTopicAction(optimisticTopicActionsRef.current)
        ),
        backStack: [...topicBackStackRef.current]
      };
    } else if (screen !== 'user') {
      userReturnTopicRef.current = null;
    }
    changeScreen('user');
  }, [changeScreen, screen, topicSnapshot]);

  const pushTopicScreen = useCallback(() => {
    if (navigationRef.isReady()) {
      navigationRef.dispatch(StackActions.push('Topic'));
    }
  }, []);

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
    clearYaohuoLoginState,
    fetcher: forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onOpenUserScreen: prepareUserNavigation,
    readerData,
    screen,
    sessionViewModels: siteSessionViewModels,
    showLinuxDoVerification,
    showNodeSeekVerification,
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
    clearYaohuoLoginState,
    commitReaderData,
    currentTopicKeyRef,
    expandedQuotesRef,
    fetcher: forumFetchWithWebViewFallback,
    handleLinuxDoCloudflareForTopic,
    linuxDoDismissedVerificationTopicKeyRef,
    linuxDoPendingTopicVerifiedRef,
    linuxDoVerifiedRetryTopicKeyRef,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loadedQuotedRepliesRef,
    loadingMoreRepliesRef,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    onNodeSeekTopicVerificationRequired: handleNodeSeekTopicVerificationRequired,
    pendingLinuxDoTopicRef,
    pushTopicScreen,
    quotedReplyAbortRefs,
    readerData,
    readerDataRef,
    reopenExistingTopicScreenRef,
    repliesAbortRef,
    repliesRequestIdRef,
    replyNextOffset,
    replyNextPage,
    resetQuoteState,
    screen,
    selectedTopic,
    sessionViewModels: siteSessionViewModels,
    setCommentQuery,
    setLoadedQuotedReplies: updateLoadedQuotedReplies,
    setLoadingMoreReplies,
    setLoadingQuotedFloors: updateLoadingQuotedFloors,
    setReplyComposerOpen,
    setReplyContent,
    setReplyFace,
    setReplyEditTarget,
    setReplyFilter,
    setReplyHasMore,
    setReplyNextOffset,
    setReplyNextPage,
    setReplyTarget,
    setSelectedTopic,
    setTopicBusy,
    setTopicDetail,
    setTopicError,
    setTopicReplies,
    setUnreadReplyCount,
    showYaohuoLogin,
    onTopicContextChange: invalidateTopicActionRequests,
    topicAbortRef,
    topicBackStackRef,
    topicDetail,
    topicReplies,
    topicRepliesRef,
    topicRequestIdRef,
    topicReturnScreenRef,
    topicSnapshot,
    updateExpandedQuotes
  });
  const showLinuxDoLogin = useCallback((message = '匿名可阅读，登录后才能互动。') => {
    setScreen('more');
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    notify(message);
    changeLinuxDoPanel(true);
  }, [changeLinuxDoPanel, changeNodeSeekLoginPanel, closeYaohuoLoginPanel, notify]);

  openTopicRef.current = openTopic;

  const verifyNodeSeekFromTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source !== 'nodeseek') {
      return;
    }
    pendingNodeSeekTopicRetryRef.current = detail;
    showNodeSeekVerification(topicError || 'NodeSeek 需要完成 Cloudflare 验证');
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
    linuxDoWebViewUserAgentRef,
    loadYaohuoCookieForSource,
    nodeSeekWebViewUserAgentRef,
    ensureNodeImageApiKey,
    notify,
    optimisticTopicActionsRef,
    refreshTopicReplies,
    replyContent,
    replyFace,
    replyEditTarget,
    replyTarget,
    resetLinuxDoLevelState,
    selectedTopic,
    setActionBusy,
    setOptimisticTopicActions,
    setReplyComposerOpen,
    setReplyContent,
    setReplyFace,
    setReplyEditTarget,
    setReplyTarget,
    setTopicDetail,
    setTopicReplies,
    showLinuxDoLogin,
    showYaohuoLogin,
    siteSessionStates: effectiveSiteSessionStates,
    topicActionRequestOwnerRef,
    topicDetail,
    topicReplies,
    updateLinuxDoSession
  });

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

  const goBackFromTopic = useCallback(() => {
    abortQuotedReplyRequests();
    cancelDeferredNavigationTask();
    const previousTopic = topicBackStackRef.current.pop();
    const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();
    if (previousTopic) {
      topicRequestIdRef.current += 1;
      repliesRequestIdRef.current += 1;
      topicAbortRef.current?.abort();
      repliesAbortRef.current?.abort();
      restoreTopicSnapshot(previousTopic);
      if (canGoBack) {
        navigationRef.goBack();
      }
      return;
    }
    if (canGoBack) {
      skipNextNavigationSyncRef.current = true;
      navigationRef.goBack();
      runAfterNavigationInteractions(() => changeScreen(topicReturnScreenRef.current));
      return;
    }
    changeScreen(topicReturnScreenRef.current);
  }, [abortQuotedReplyRequests, cancelDeferredNavigationTask, changeScreen, restoreTopicSnapshot, runAfterNavigationInteractions]);

  const goBackFromUser = useCallback(() => {
    cancelDeferredNavigationTask();
    const returnTopic = userReturnScreenRef.current === 'topic' ? userReturnTopicRef.current : null;
    const shouldReloadRestoredTopic = Boolean(returnTopic?.snapshot.selectedTopic && !returnTopic.snapshot.topicDetail && !returnTopic.snapshot.topicError);
    const restoreReturnTopic = () => {
      if (!returnTopic) {
        return;
      }
      topicReturnScreenRef.current = returnTopic.returnScreen;
      topicBackStackRef.current = [...returnTopic.backStack];
      restoreTopicSnapshot(returnTopic.snapshot);
      userReturnTopicRef.current = null;
    };
    const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();
    if (canGoBack) {
      skipNextNavigationSyncRef.current = true;
      navigationRef.goBack();
    }
    changeScreen(userReturnScreenRef.current);
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
      return;
    }
    if (canGoBack && returnTopic) {
      runAfterNavigationInteractions(restoreReturnTopic);
    } else {
      restoreReturnTopic();
    }
  }, [cancelDeferredNavigationTask, changeScreen, openTopic, restoreTopicSnapshot, runAfterNavigationInteractions]);

  const handleTopicScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    topicScrollYRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
  }, []);

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
      if (imagePreview) {
        closeImagePreview();
        return true;
      }
      if (showLoginPanel) {
        changeNodeSeekLoginPanel(false);
        return true;
      }
      if (showNodeImageAuthPanel) {
        closeNodeImageAuthPanel();
        return true;
      }
      if (showYaohuoLoginPanel) {
        closeYaohuoLoginPanel();
        return true;
      }
      if (showLinuxDoPanel) {
        closeLinuxDoPanel();
        return true;
      }
      if (showSettingsPanel) {
        setShowSettingsPanel(false);
        return true;
      }
      if (shouldCloseReplyComposerOnBack(screen, replyComposerOpen)) {
        toggleReplyComposer(false);
        return true;
      }
      if (screen === 'topic') {
        goBackFromTopic();
        return true;
      }
      if (screen === 'user') {
        goBackFromUser();
        return true;
      }
      if (screen !== 'feed') {
        changeScreen('feed');
        return true;
      }
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
    screen,
    closeLinuxDoPanel,
    showLoginPanel,
    showNodeImageAuthPanel,
    showLinuxDoPanel,
    showYaohuoLoginPanel,
    replyComposerOpen,
    showSettingsPanel,
    toggleReplyComposer
  ]);

  const syncNavigationToScreen = useCallback((nextScreen: Screen) => {
    if (!navigationRef.isReady()) {
      return;
    }
    if (nextScreen === 'topic') {
      navigationRef.dispatch(StackActions.push('Topic'));
      return;
    }
    if (nextScreen === 'user') {
      navigationRef.dispatch(StackActions.push('User'));
      return;
    }
    if (nextScreen === 'feed' || nextScreen === 'search' || nextScreen === 'library' || nextScreen === 'more') {
      navigateMainTab(nextScreen);
    }
  }, []);
  useEffect(() => {
    if (skipNextNavigationSyncRef.current) {
      skipNextNavigationSyncRef.current = false;
      return;
    }
    syncNavigationToScreen(screen);
  }, [screen, syncNavigationToScreen]);

  const loadMoreActiveFeed = useCallback(() => {
    if (!feedAllowsRemotePagination) {
      return;
    }
    loadFeed({ page: activeFeedState.page + 1, cursor: feedSource === 'all' ? activeFeedState.nextCursor : undefined, nocache: true });
  }, [activeFeedState.nextCursor, activeFeedState.page, feedAllowsRemotePagination, feedSource, loadFeed]);

  const runCurrentSearch = useCallback(() => {
    void runSearch();
  }, [runSearch]);

  const refreshCurrentUser = useCallback(() => {
    const user = userProfile || selectedUser;
    if (user) {
      void openUser(user, true);
    }
  }, [openUser, selectedUser, userProfile]);

  const feedProps = useMemo(() => ({
      busy: feedBusy || actionBusy,
      categories,
      categoryFilter,
      feedHasMore: activeFeedState.hasMore && feedAllowsRemotePagination,
      feedItems: shownFeedItems,
      feedPage: activeFeedState.page,
      feedSource,
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
    feedSource,
    loadMoreActiveFeed,
    openTopic,
    readingFilter,
    refreshFeed,
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
      loginState,
      loadingLoginPage,
      loadingYaohuoLoginPage,
      linuxDoLevelBusy,
      linuxDoLevelError,
      linuxDoLevelProfile,
      nodeSeekWebViewUserAgent,
      nodeImageApiKeyBusy,
      nodeImageApiKeySaved,
      settings: readerData.settings,
      showLoginPanel,
      showYaohuoLoginPanel,
      showLinuxDoPanel,
      showSettingsPanel,
      statusBusy,
      styles,
      backupBusy,
      theme,
      webViewRef,
      yaohuoLoginState,
      yaohuoLoginPrompt,
      yaohuoWebViewRef,
      sessionViewModels: siteSessionViewModels,
      devAnonymousAvailable: __DEV__,
      devAnonymousOverrides,
      onRefreshAccountStatus: refreshAccountStatus,
      onOpenUser: openUser,
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
      onExportBackupFile: exportBackupFile,
      onImportBackupFile: importBackupFile,
      onSetLoadingLoginPage: setLoadingLoginPage,
      onSetLoadingYaohuoLoginPage: setLoadingYaohuoLoginPage,
      onShowLoginPanelChange: changeNodeSeekLoginPanel,
      onShowYaohuoLoginPanelChange: changeYaohuoLoginPanel,
      onShowLinuxDoPanelChange: changeLinuxDoPanel,
      onShowSettingsPanelChange: setShowSettingsPanel,
      onToggleDevAnonymousOverride: toggleDevAnonymousOverride,
      onUpdateSettings: updateSettings
  }), [
    appUpdateBusy,
    appUpdateDownloading,
    appUpdateDownloadProgress,
    appUpdateInfo,
    appUpdateMessage,
    backupBusy,
    changeLinuxDoPanel,
    changeNodeSeekLoginPanel,
    changeYaohuoLoginPanel,
    checkAppUpdate,
    checkIn,
    checkLogin,
    checkYaohuoCookie,
    checking,
    clearLogin,
    clearYaohuoLogin,
    authorizeNodeImageApiKey,
    devAnonymousOverrides,
    downloadAppUpdate,
    exportBackupFile,
    handleLoginMessage,
    handleNodeSeekLoginNavigation,
    handleYaohuoLoginNavigation,
    importBackupFile,
    linuxDoLevelBusy,
    linuxDoLevelError,
    linuxDoLevelProfile,
    loadingLoginPage,
    loadingYaohuoLoginPage,
    loginState,
    nodeSeekWebViewUserAgent,
    nodeImageApiKeyBusy,
    nodeImageApiKeySaved,
    openUser,
    readerData.settings,
    refreshAccountStatus,
    refreshLinuxDoLevel,
    rememberVisibleNodeSeekCookiesAndRetrySearch,
    saveNodeImageApiKeyInput,
    clearNodeImageApiKeyInput,
    showLinuxDoPanel,
    showLoginPanel,
    showSettingsPanel,
    showYaohuoLoginPanel,
    siteSessionViewModels,
    statusBusy,
    styles,
    theme,
    toggleDevAnonymousOverride,
    updateSettings,
    yaohuoLoginPrompt,
    yaohuoLoginState
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
      expandedQuotesRef,
      loadedQuotedRepliesRef,
      loadingMoreReplies,
      loadingQuotedFloorsRef,
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
      onCommentQueryChange: setCommentQuery,
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
      onReplyContentChange: setReplyContent,
      onReplyFaceChange: setReplyFace,
      onReplyFilterChange: setReplyFilter,
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
    expandedQuotesRef,
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
    loadedQuotedRepliesRef,
    loadingMoreReplies,
    loadingQuotedFloorsRef,
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
    setReplyFace,
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
    <ScrollView ref={moreScrollRef} style={styles.content} contentContainerStyle={styles.moreContentInner} keyboardShouldPersistTaps="handled">
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
    if (screen === targetScreen) {
      requestTabScrollToTop(targetScreen);
    }
    changeScreen(targetScreen);
  }, [changeScreen, requestTabScrollToTop, screen]);

  return (
    <GestureHandlerRootView style={styles.screen}>
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.screen}>
          <SafeAreaView edges={['left', 'right']} style={styles.screen}>
              <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
              <View pointerEvents="none" style={[styles.statusBarScrim, screen === 'topic' && replyComposerOpen && styles.statusBarScrimBelowOverlay]} />
              <HiddenBrowserHost
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
              checkLinuxDoCookie={checkLinuxDoCookie}
              clearLinuxDoCookie={clearLinuxDoCookie}
              closeImagePreview={closeImagePreview}
              handleLinuxDoMessage={handleLinuxDoMessage}
              handleLinuxDoNavigation={handleLinuxDoNavigation}
              handleNodeImageAuthMessage={handleNodeImageAuthMessage}
              handleNodeImageAuthNavigation={handleNodeImageAuthNavigation}
              imagePreview={imagePreview}
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
              changeLinuxDoPanel={changeLinuxDoPanel}
              closeNodeImageAuthPanel={closeNodeImageAuthPanel}
            />
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
              onReady={() => syncNavigationToScreen(screen)}
              onTabPress={handleMainTabPress}
              onTopicClosing={flushDeferredNavigationTask}
              onUserClosing={flushDeferredNavigationTask}
              />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
