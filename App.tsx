import 'react-native-gesture-handler';
import 'expo-dev-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  FlatList,
  Image,
  InteractionManager,
  KeyboardAvoidingView,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  SafeAreaView,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  useWindowDimensions,
  View
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient } from '@tanstack/react-query';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { CommonActions, DarkTheme, DefaultTheme, NavigationContainer, StackActions, createNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  useIMGElementProps,
  useIMGElementState,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from './src/nodeseekCookies';
import {
  clearRecords,
  removeFollowedUsers,
  removeRecords,
  toggleFavorite,
  toggleFollowedUser,
  topicKey,
  type ReaderSettings,
  type TopicRecord
} from './src/readerData';
import { useReaderDataController } from './src/app/useReaderDataController';
import { useBackupStatusController } from './src/app/useBackupStatusController';
import { useFeedController } from './src/app/useFeedController';
import { useHtmlRenderingController } from './src/app/useHtmlRenderingController';
import { useSearchController } from './src/app/useSearchController';
import { useSessionController, type LinuxDoBrowserFetchRequest, type NodeSeekBrowserFetchRequest } from './src/app/useSessionController';
import { useTopicController } from './src/app/useTopicController';
import { useUserController } from './src/app/useUserController';
import { useVerificationController } from './src/app/useVerificationController';
import { useAccountController } from './src/app/useAccountController';
import { createTopicActionRequestOwner, invalidateTopicActionRequestOwner, useTopicActionsController } from './src/app/useTopicActionsController';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from './src/linuxdoCookieBridge';
import type { Reply, Topic, TopicDetail, UserProfile } from './src/types';
import type { OptimisticActionState } from './src/topicActionState';
import { createImagePreviewList, dataImageFileFromUrl, imageRequestHeadersForUrl, imageSourceFromUrl, inlineForumImageAlignmentStyle, inlineForumImageDisplaySize, INLINE_FORUM_IMAGE_TAG, isForumInlineSizedImage, isHttpOrHttpsUrl, isInlineForumImage, isPreviewableImageUrl, normalizeImagePreviewUrl, type ImagePreviewList, withForumImageDimensions } from './src/htmlImages';
import { filterRepliesWithImages } from './src/topicDerivedData';
import { createEmptyTopicSession, pushTopicSession, snapshotFromTopicSession, topicSessionFromSnapshot } from './src/topicSessionState';
import { shouldOpenLoginWebViewUrl } from './src/loginWebViewNavigation';
import { createTopicListItemStateIndex } from './src/topicListItemState';
import {
  contentWidthValue,
  createStyles,
  createTheme,
  fontFamilyValue,
  lineHeightMultiplier
} from './src/theme';
import type { LibraryTab } from './src/feedLogic';
import {
  errorMessage,
  parseForumTopicLink
} from './src/appUtils';
import type { LinuxDoLevelProfile } from './src/linuxdoLevel';
import { filterRepliesByQuery } from './src/androidFeatureHelpers';
import { safeFileName } from './src/backupFiles';
import { TabBarIcon, tabNavItems } from './src/components/NavBar';
import { triggerPressFeedback } from './src/components/AppControls';
import { ImagePreviewModal } from './src/components/ImagePreviewModal';
import { FeedScreen } from './src/screens/FeedScreen';
import { MemoizedLinuxDoVerifyModal, MemoizedMoreScreen } from './src/screens/MoreScreen';
import { TopicScreen, type TopicListItem } from './src/screens/TopicScreen';
import type { HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, LoginNavigationRequest, ReplyFilter, ReplyTarget, Screen, TopicSnapshot } from './src/appTypes';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import { UserScreen } from './src/screens/UserScreen';

type PendingNodeSeekBrowserFetchRequest = NodeSeekBrowserFetchRequest & {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  httpErrorStatus?: number;
};
type PendingLinuxDoBrowserFetchRequest = LinuxDoBrowserFetchRequest & {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
  httpErrorStatus?: number;
};
type UserReturnTopic = {
  returnScreen: Exclude<Screen, 'topic'>;
  snapshot: TopicSnapshot;
  backStack: TopicSnapshot[];
};
type DeferredNavigationTask = ReturnType<typeof InteractionManager.runAfterInteractions>;
type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Topic: undefined;
  User: undefined;
};
type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: undefined;
};

const NODESEEK_LOGIN_HOSTS = ['nodeseek.com', 'challenges.cloudflare.com'];
const NAVIGATION_DEFERRED_TASK_FALLBACK_MS = 420;
const YAOHUO_LOGIN_HOSTS = ['yaohuo.me'];
const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com'];
const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const NODESEEK_BROWSER_FETCH_SCRIPT = `
(() => {
  const requestId = __NODESEEK_BROWSER_FETCH_ID__;
  const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;
  const isChallengePage = () => {
    const challengeText = [document.title || "", document.documentElement?.innerHTML || ""].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const pageText = () => (document.body?.innerText || document.documentElement?.innerText || "").trim();
  const restrictedNoticePattern = /权限不足|权限不够|没有权限|暂无权限|无权限|无权(?:查看|访问|阅读)|无访问权限|需要等级|requires?[^.]{0,40}(?:trust\\s+level|level\\s*(?:of\\s+|[:：#-]\\s*)?\\d+)|minimum (?:trust\\s+level|level\\s*(?:of\\s+|[:：#-]\\s*)?\\d+)|must be (?:at least )?(?:trust\\s+level|level\\s*(?:of\\s+|[:：#-]\\s*)?\\d+)|登录后才能|请登录|permission denied|forbidden|private topic|not authorized|you do not have permission|you don't have permission/i;
  const hasRestrictedNotice = () => restrictedNoticePattern.test(pageText());
  const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content, pre"))
    || /^\\s*[{[]/.test(pageText());
  const hasPendingVotePanel = () => {
    const visibleMasks = Array.from(document.querySelectorAll(".embed-vote .form-mask")).some((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") !== 0;
    });
    if (visibleMasks) {
      return true;
    }
    return Array.from(document.querySelectorAll('input[name="vote-item"]')).some((input) => {
      const inputId = input.getAttribute("id") || "";
      const label = inputId ? document.querySelector('label[for="' + inputId.replace(/"/g, '\\"') + '"]') : null;
      const labelText = (label?.querySelector(".vote-item-text")?.textContent || label?.textContent || "").trim();
      return !(input.getAttribute("value") || "").trim() || !labelText;
    });
  };
  const postResult = () => {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'nodeseek-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge: isChallengePage(),
      html: document.documentElement ? document.documentElement.outerHTML : "",
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    }));
    try {
      window.stop();
    } catch {}
  };
  const deadline = Date.now() + 15000;
  const waitForReadablePage = () => {
    if ((!isChallengePage() && (hasReadableContent() || hasRestrictedNotice()) && !hasPendingVotePanel()) || Date.now() >= deadline) {
      postResult();
      return;
    }
    setTimeout(waitForReadablePage, 500);
  };
  waitForReadablePage();
})();
true;
`;

const LINUXDO_BROWSER_FETCH_SCRIPT = `
(() => {
  const requestId = __LINUXDO_BROWSER_FETCH_ID__;
  const challengePattern = /just a moment|checking your browser|cf-browser-verification|challenge-running|challenge-platform|cf-turnstile|cf_chl_|attention required|enable javascript and cookies|请稍候|正在检查/i;
  const pageText = () => (document.body?.innerText || document.documentElement?.innerText || "").trim();
  const pageHtml = () => document.documentElement ? document.documentElement.outerHTML : "";
  const isChallengePage = () => {
    const challengeText = [document.title || "", pageText(), pageHtml()].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const isInteractiveChallengePage = () => {
    const challengeText = [document.title || "", pageText(), pageHtml()].join(" ");
    return Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response']"))
      || /cf-turnstile|attention required|verify you are human|请完成验证|正在进行安全验证/i.test(challengeText);
  };
  const jsonText = () => {
    const text = pageText();
    return /^\\s*[{[]/.test(text) ? text : "";
  };
  const postResult = () => {
    const json = jsonText();
    const challenge = isChallengePage() || isInteractiveChallengePage();
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'linuxdo-browser-fetch',
      id: requestId,
      url: location.href,
      title: document.title || "",
      challenge,
      body: json || pageHtml(),
      userAgent: navigator.userAgent || "",
      cookie: document.cookie || ""
    }));
  };
  const deadline = Date.now() + 8000;
  const waitForReadablePage = () => {
    if (isInteractiveChallengePage() || (!isChallengePage() && jsonText()) || Date.now() >= deadline) {
      postResult();
      return;
    }
    setTimeout(waitForReadablePage, 500);
  };
  waitForReadablePage();
})();
true;
`;


function sortedRecords(records: Record<string, TopicRecord>) {
  return Object.values(records).sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const yaohuoWebViewRef = useRef<WebView>(null);
  const linuxDoWebViewRef = useRef<WebView>(null);
  const nodeSeekBrowserWebViewRef = useRef<WebView>(null);
  const linuxDoBrowserWebViewRef = useRef<WebView>(null);
  const queryClientRef = useRef(new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 5 * 60 * 1000,
        retry: false,
        staleTime: 0
      }
    }
  }));
  const nodeSeekLoginPanelRequestRef = useRef(0);
  const yaohuoLoginPanelRequestRef = useRef(0);
  const webLoginDetectedRef = useRef(false);
  const topicRequestIdRef = useRef(0);
  const topicAbortRef = useRef<AbortController | null>(null);
  const checkingRequestIdRef = useRef(0);
  const actionRequestIdRef = useRef(0);
  const topicActionRequestOwnerRef = useRef(createTopicActionRequestOwner());
  const actionAbortRef = useRef<AbortController | null>(null);
  const topicScrollRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationTransitionTaskRef = useRef<(() => void) | null>(null);
  const navigationTransitionFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationInteractionTaskRef = useRef<DeferredNavigationTask | null>(null);
  const navigationInteractionTaskIdRef = useRef(0);
  const loadingMoreRepliesRef = useRef(false);
  const repliesAbortRef = useRef<AbortController | null>(null);
  const repliesRequestIdRef = useRef(0);
  const currentTopicKeyRef = useRef<string | null>(null);
  const quotedReplyAbortRefs = useRef<Record<string, AbortController>>({});
  const topicScrollRef = useRef<FlatList<TopicListItem> | null>(null);
  const moreScrollRef = useRef<ScrollView>(null);
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
  const nodeSeekWebViewCookieHeaderRef = useRef('');
  const nodeSeekWebViewUserAgentRef = useRef(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const nodeSeekBrowserFetchIdRef = useRef(0);
  const nodeSeekBrowserFetchCurrentRef = useRef<PendingNodeSeekBrowserFetchRequest | null>(null);
  const nodeSeekBrowserFetchQueueRef = useRef<PendingNodeSeekBrowserFetchRequest[]>([]);
  const rejectNodeSeekBrowserFetchRef = useRef<((request: PendingNodeSeekBrowserFetchRequest, message: string) => void) | null>(null);
  const linuxDoWebViewCookieHeaderRef = useRef('');
  const linuxDoWebViewUserAgentRef = useRef(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const linuxDoClearanceBeforeVerifyRef = useRef<string | null>(null);
  const linuxDoRequireFreshClearanceRef = useRef(false);
  const linuxDoBrowserFetchIdRef = useRef(0);
  const linuxDoBrowserFetchCurrentRef = useRef<PendingLinuxDoBrowserFetchRequest | null>(null);
  const linuxDoBrowserFetchQueueRef = useRef<PendingLinuxDoBrowserFetchRequest[]>([]);
  const rejectLinuxDoBrowserFetchRef = useRef<((request: PendingLinuxDoBrowserFetchRequest, message: string) => void) | null>(null);
  const linuxDoLevelRequestIdRef = useRef(0);
  const { width, height } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const screenRef = useRef<Screen>('feed');
  const notify = useCallback((message: string) => {
    if (!message) {
      return;
    }
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    } else {
      console.log(message);
    }
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
  const [yaohuoLoginCookieHeader, setYaohuoLoginCookieHeader] = useState('');
  const [nodeSeekWebViewUserAgent, setNodeSeekWebViewUserAgent] = useState(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const [nodeSeekBrowserFetchRequest, setNodeSeekBrowserFetchRequest] = useState<NodeSeekBrowserFetchRequest | null>(null);
  const [linuxDoBrowserFetchRequest, setLinuxDoBrowserFetchRequest] = useState<LinuxDoBrowserFetchRequest | null>(null);
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
  const invalidateTopicActionRequests = useCallback((nextTopicKey: string | null) => {
    invalidateTopicActionRequestOwner(topicActionRequestOwnerRef, nextTopicKey);
  }, []);
  const {
    clearReaderDataTimers,
    commitReaderData,
    flushPendingProgress,
    queueProgressSave,
    readerData,
    readerDataLoaded,
    readerDataRef,
    replaceReaderData,
    waitForReaderDataSave
  } = useReaderDataController({ notify, screenRef });

  const resetLinuxDoLevelState = useCallback(() => {
    linuxDoLevelRequestIdRef.current += 1;
    setLinuxDoLevelProfile(null);
    setLinuxDoLevelError('');
    setLinuxDoLevelBusy(false);
  }, []);

  const optimisticTopicActionsRef = useRef<Record<string, OptimisticActionState>>({});
  const [tabScrollToTopSignals, setTabScrollToTopSignals] = useState<Record<keyof MainTabParamList, number>>({
    feed: 0,
    search: 0,
    library: 0,
    more: 0
  });
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicError, setTopicError] = useState('');
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const topicRepliesRef = useRef<Reply[]>(topicReplies);
  const topicScrollYRef = useRef(0);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [unreadReplyCount, setUnreadReplyCount] = useState(0);
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [loadingMoreReplies, setLoadingMoreReplies] = useState(false);
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [loadedQuotedReplies, setLoadedQuotedReplies] = useState<Record<number, Reply>>({});
  const [loadingQuotedFloors, setLoadingQuotedFloors] = useState<Record<string, boolean>>({});
  const expandedQuotesRef = useRef(expandedQuotes);
  const loadedQuotedRepliesRef = useRef(loadedQuotedReplies);
  const loadingQuotedFloorsRef = useRef(loadingQuotedFloors);
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const showLoginPanelRef = useRef(showLoginPanel);
  const [showYaohuoLoginPanel, setShowYaohuoLoginPanel] = useState(false);
  const [showLinuxDoPanel, setShowLinuxDoPanel] = useState(false);
  const showLinuxDoPanelRef = useRef(showLinuxDoPanel);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  screenRef.current = screen;
  topicRepliesRef.current = topicReplies;
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
  const updateExpandedQuotes = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    const next = updater(expandedQuotesRef.current);
    expandedQuotesRef.current = next;
    setExpandedQuotes(next);
    setQuoteStateVersion((current) => current + 1);
  }, []);
  const updateLoadedQuotedReplies = useCallback((updater: (current: Record<number, Reply>) => Record<number, Reply>) => {
    const next = updater(loadedQuotedRepliesRef.current);
    loadedQuotedRepliesRef.current = next;
    setLoadedQuotedReplies(next);
    setQuoteStateVersion((current) => current + 1);
  }, []);
  const updateLoadingQuotedFloors = useCallback((updater: (current: Record<string, boolean>) => Record<string, boolean>) => {
    const next = updater(loadingQuotedFloorsRef.current);
    loadingQuotedFloorsRef.current = next;
    setLoadingQuotedFloors(next);
    setQuoteStateVersion((current) => current + 1);
  }, []);
  const abortQuotedReplyRequests = useCallback(() => {
    Object.values(quotedReplyAbortRefs.current).forEach((controller) => controller.abort());
    quotedReplyAbortRefs.current = {};
  }, []);
  const clearTopicScrollRestoreTimer = useCallback(() => {
    if (topicScrollRestoreTimerRef.current) {
      clearTimeout(topicScrollRestoreTimerRef.current);
      topicScrollRestoreTimerRef.current = null;
    }
  }, []);
  const cancelDeferredNavigationTask = useCallback(() => {
    navigationInteractionTaskIdRef.current += 1;
    navigationTransitionTaskRef.current = null;
    if (navigationTransitionFallbackTimerRef.current) {
      clearTimeout(navigationTransitionFallbackTimerRef.current);
      navigationTransitionFallbackTimerRef.current = null;
    }
    navigationInteractionTaskRef.current?.cancel();
    navigationInteractionTaskRef.current = null;
  }, []);
  const cancelLinuxDoPendingReopenTask = useCallback(() => {
    linuxDoPendingReopenTaskRef.current?.cancel();
    linuxDoPendingReopenTaskRef.current = null;
  }, []);
  const flushDeferredNavigationTask = useCallback(() => {
    const task = navigationTransitionTaskRef.current;
    if (!task) {
      return;
    }
    navigationTransitionTaskRef.current = null;
    if (navigationTransitionFallbackTimerRef.current) {
      clearTimeout(navigationTransitionFallbackTimerRef.current);
      navigationTransitionFallbackTimerRef.current = null;
    }
    navigationInteractionTaskRef.current?.cancel();
    const taskId = ++navigationInteractionTaskIdRef.current;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (navigationInteractionTaskIdRef.current !== taskId) {
        return;
      }
      navigationInteractionTaskRef.current = null;
      task();
    });
    navigationInteractionTaskRef.current = handle;
  }, []);
  const runAfterNavigationInteractions = useCallback((task: () => void) => {
    cancelDeferredNavigationTask();
    navigationTransitionTaskRef.current = task;
    navigationTransitionFallbackTimerRef.current = setTimeout(flushDeferredNavigationTask, NAVIGATION_DEFERRED_TASK_FALLBACK_MS);
  }, [cancelDeferredNavigationTask, flushDeferredNavigationTask]);
  const resetQuoteState = useCallback(() => {
    abortQuotedReplyRequests();
    expandedQuotesRef.current = {};
    loadedQuotedRepliesRef.current = {};
    loadingQuotedFloorsRef.current = {};
    setExpandedQuotes({});
    setLoadedQuotedReplies({});
    setLoadingQuotedFloors({});
    setQuoteStateVersion((current) => current + 1);
  }, [abortQuotedReplyRequests]);

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
  const htmlBaseStyle = useMemo<HtmlBaseStyle>(() => ({
    color: theme.ink,
    fontFamily: fontFamilyValue(readerData.settings.fontFamily),
    fontSize: Math.round(16 * readerData.settings.fontScale),
    lineHeight: Math.round(16 * readerData.settings.fontScale * lineHeightMultiplier(readerData.settings.lineHeight))
  }), [readerData.settings.fontFamily, readerData.settings.fontScale, readerData.settings.lineHeight, theme.ink]);
  const htmlTagsStyles = useMemo<HtmlTagsStyles>(() => {
    const htmlParagraph = {
      color: theme.ink,
      marginBottom: 10,
      marginTop: 6
    };
    return {
    body: {
      color: theme.ink,
      backgroundColor: 'transparent'
    },
    p: htmlParagraph,
    div: {
      color: theme.ink
    },
    span: {
      color: theme.ink
    },
    h1: {
      color: theme.ink,
      fontWeight: '700',
      lineHeight: Math.round(28 * readerData.settings.fontScale),
      marginBottom: 8,
      marginTop: 18
    },
    h2: {
      color: theme.ink,
      fontWeight: '700',
      lineHeight: Math.round(26 * readerData.settings.fontScale),
      marginBottom: 8,
      marginTop: 18
    },
    h3: {
      color: theme.ink,
      fontWeight: '600',
      lineHeight: Math.round(24 * readerData.settings.fontScale),
      marginBottom: 6,
      marginTop: 16
    },
    h4: {
      color: theme.ink,
      fontWeight: '600'
    },
    h5: {
      color: theme.ink,
      fontWeight: '600'
    },
    h6: {
      color: theme.muted,
      fontWeight: '600'
    },
    a: {
      color: theme.primary,
      textDecorationColor: theme.primary,
      textDecorationLine: 'underline'
    },
    img: { borderRadius: 8 },
    strong: {
      color: theme.ink
    },
    b: {
      color: theme.ink
    },
    em: {
      color: theme.ink
    },
    li: {
      color: theme.ink,
      marginBottom: 4
    },
    ul: {
      color: theme.ink,
      marginBottom: 10,
      marginTop: 8
    },
    ol: {
      color: theme.ink,
      marginBottom: 10,
      marginTop: 8
    },
    blockquote: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.muted,
      marginBottom: 12,
      marginTop: 12,
      paddingHorizontal: 13,
      paddingVertical: 11
    },
    pre: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      marginBottom: 12,
      marginTop: 12,
      padding: 12
    },
    code: {
      backgroundColor: 'transparent',
      color: theme.ink
    },
    mark: {
      backgroundColor: theme.surface2,
      color: theme.ink
    },
    table: {
      backgroundColor: 'transparent',
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth
    },
    th: {
      color: theme.ink,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 7
    },
    td: {
      color: theme.ink,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 7
    }
    };
  }, [readerData.settings.fontScale, theme]);
  const htmlIgnoredStyles = useMemo<HtmlIgnoredStyles>(() => [
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'color',
    'outlineColor',
    'textDecorationColor'
  ], []);
  const contentWidth = Math.min(width - 40, contentWidthValue(readerData.settings.contentWidth));

  const {
    clearNodeSeekLoginCookiesOnly,
    clearNodeSeekLoginState,
    clearYaohuoLoginState,
    completeLinuxDoBrowserFetch,
    completeNodeSeekBrowserFetch,
    failLinuxDoBrowserFetchById,
    failNodeSeekBrowserFetchById,
    dispatchSiteSessionEvent,
    forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    loginState,
    restoreSavedYaohuoCookiesToWebView,
    saveNodeSeekCookieHeader,
    siteSessionStates,
    siteSessionViewModels,
    updateLinuxDoSession,
    updateNodeSeekSession,
    updateYaohuoSession,
    yaohuoLoginState
  } = useSessionController({
    linuxDoBrowserFetchCurrentRef,
    linuxDoBrowserFetchIdRef,
    linuxDoBrowserFetchQueueRef,
    linuxDoBrowserWebViewRef,
    linuxDoClearanceBeforeVerifyRef,
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewUserAgentRef,
    nodeSeekBrowserFetchCurrentRef,
    nodeSeekBrowserFetchIdRef,
    nodeSeekBrowserFetchQueueRef,
    nodeSeekBrowserWebViewRef,
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    notify,
    rejectLinuxDoBrowserFetchRef,
    rejectNodeSeekBrowserFetchRef,
    setLinuxDoBrowserFetchRequest,
    setLinuxDoWebViewCookieHeader,
    setLinuxDoWebViewUserAgent,
    setNodeSeekBrowserFetchRequest,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    setYaohuoLoginCookieHeader,
    webLoginDetectedRef,
    webLoginUserId
  });
  const libraryRecords = useMemo(
    () => sortedRecords(libraryTab === 'history' ? readerData.history : readerData.favorites),
    [libraryTab, readerData.favorites, readerData.history]
  );
  const [inlineSizedImageUrls, setInlineSizedImageUrls] = useState<Record<string, true>>({});
  const inlineSizedImageUrlsRef = useRef(inlineSizedImageUrls);
  inlineSizedImageUrlsRef.current = inlineSizedImageUrls;
  useEffect(() => {
    setInlineSizedImageUrls({});
  }, [selectedTopic?.id, selectedTopic?.source]);
  const { topicImageDeriver } = useHtmlRenderingController(`${selectedTopic?.source || ''}:${selectedTopic?.id || ''}`);
  const filteredReplies = useMemo(() => {
    let base = topicReplies;
    if (replyFilter === 'author') {
      base = topicDetail ? topicReplies.filter((reply) => reply.author === topicDetail.author) : topicReplies;
    } else if (replyFilter === 'images') {
      base = filterRepliesWithImages(topicReplies, inlineSizedImageUrls, topicImageDeriver);
    } else if (replyFilter === 'newest') {
      base = [...topicReplies].reverse();
    }
    return filterRepliesByQuery(base, commentQuery);
  }, [commentQuery, inlineSizedImageUrls, replyFilter, topicDetail, topicImageDeriver, topicReplies]);
  const topicHtmlParts = useMemo(() => [
    topicDetail?.contentHtml || '',
    ...topicReplies.map((reply) => reply.contentHtml || ''),
    ...Object.values(loadedQuotedReplies).map((reply) => reply.contentHtml || '')
  ].filter(Boolean), [loadedQuotedReplies, topicDetail?.contentHtml, topicReplies]);
  const topicHtmlPreviewParts = useMemo(() => (
    topicHtmlParts.map((html) => topicImageDeriver.markInlineSizedImages(html, inlineSizedImageUrls))
  ), [inlineSizedImageUrls, topicHtmlParts, topicImageDeriver]);
  const topicHtmlPartsRef = useRef<string[]>(topicHtmlParts);
  topicHtmlPartsRef.current = topicHtmlPreviewParts;
  const markImageInlineSized = useCallback((url: string) => {
    const clean = normalizeImageCacheKey(url);
    if (!clean || inlineSizedImageUrlsRef.current[clean]) {
      return;
    }
    setInlineSizedImageUrls((current) => current[clean] ? current : { ...current, [clean]: true });
  }, []);
  const openImagePreview = useCallback((url: string) => {
    const clean = normalizeImageCacheKey(url);
    if (clean && inlineSizedImageUrlsRef.current[clean]) {
      return;
    }
    const nextPreview = createImagePreviewList({
      tappedUrl: url,
      htmlParts: topicHtmlPartsRef.current
    });
    if (nextPreview.urls.length > 0) {
      setImagePreview(nextPreview);
    }
  }, []);
  const closeImagePreview = useCallback(() => setImagePreview(null), []);
  const showPreviousImage = useCallback(() => {
    setImagePreview((current) => current && current.urls.length > 1 ? {
      ...current,
      index: (current.index + current.urls.length - 1) % current.urls.length
    } : current);
  }, []);
  const showNextImage = useCallback(() => {
    setImagePreview((current) => current && current.urls.length > 1 ? {
      ...current,
      index: (current.index + 1) % current.urls.length
    } : current);
  }, []);
  const selectPreviewImage = useCallback((index: number) => {
    setImagePreview((current) => current ? {
      ...current,
      index: Math.max(0, Math.min(index, current.urls.length - 1))
    } : current);
  }, []);
  const savePreviewImage = useCallback(async () => {
    if (!imagePreview?.urls.length) {
      return;
    }
    let downloadedUri = '';
    let shouldDeleteFile = false;
    try {
      const uri = imagePreview.urls[imagePreview.index] || imagePreview.urls[0];
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        notify('没有图片保存权限');
        return;
      }
      const extension = uri.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1]?.replace('jpeg', 'jpg') || 'jpg';
      const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDirectory) {
        notify('无法创建图片文件');
        return;
      }
      shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
      const dataImage = dataImageFileFromUrl(uri);
      const target = `${baseDirectory}${safeFileName('forum-image', dataImage?.extension || extension)}`;
      if (dataImage) {
        await FileSystem.writeAsStringAsync(target, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
        downloadedUri = target;
      } else {
        const headers = imageRequestHeadersForUrl(uri);
        const downloaded = await FileSystem.downloadAsync(uri, target, headers ? { headers } : undefined);
        downloadedUri = downloaded.uri;
      }
      await MediaLibrary.saveToLibraryAsync(downloadedUri);
      notify('图片已保存');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      if (shouldDeleteFile && downloadedUri) {
        await FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => undefined);
      }
    }
  }, [imagePreview, notify]);
  const openExternalUrl = useCallback((url: string) => {
    if (!isHttpOrHttpsUrl(url)) {
      notify('仅支持打开 http/https 链接。');
      return;
    }
    void Linking.openURL(url).catch((error) => notify(errorMessage(error)));
  }, [notify]);
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
  const handleYaohuoLoginNavigation = useCallback((request: LoginNavigationRequest) => (
    handleLoginNavigation(request, YAOHUO_LOGIN_HOSTS)
  ), [handleLoginNavigation]);
  const handleLinuxDoNavigation = useCallback((request: LoginNavigationRequest) => (
    handleLoginNavigation(request, LINUXDO_LOGIN_HOSTS)
  ), [handleLoginNavigation]);
  const htmlRenderers = useMemo<HtmlRenderers>(() => {
    const PreviewImageRenderer: CustomBlockRenderer = (props) => {
      const imageProps = useIMGElementProps(props);
      const src = props.tnode.attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
      const imageSource = imageSourceFromUrl(src, imageProps.source);
      const imageState = useIMGElementState({
        ...imageProps,
        source: imageSource,
        style: [imageProps.style, { resizeMode: 'contain' }]
      });
      const sizedAttributes = withForumImageDimensions(props.tnode.attributes, imageState.type === 'success' ? imageState.dimensions : null);
      const runtimeInlineSized = !isInlineForumImage(props.tnode.attributes) && isForumInlineSizedImage(imageState.type === 'success' ? imageState.dimensions : null);
      useEffect(() => {
        if (runtimeInlineSized) {
          markImageInlineSized(src);
        }
      }, [markImageInlineSized, runtimeInlineSized, src]);
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{props.tnode.attributes.alt || props.tnode.attributes.title || ''}</Text>;
      }
      if (isInlineForumImage(sizedAttributes)) {
        return <Image source={imageSourceFromUrl(src)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(sizedAttributes, readerData.settings.fontScale), inlineForumImageAlignmentStyle(sizedAttributes, readerData.settings.fontScale, htmlBaseStyle.lineHeight)]} />;
      }
      const { width: _width, height: _height, ...containerStyle } = StyleSheet.flatten(imageState.containerStyle) || {};
      const sharedContainerStyle = [{ flexDirection: 'row' as const, alignSelf: 'stretch' as const, justifyContent: 'center' as const }, containerStyle];
      const content = imageState.type === 'success' ? (
        <Image
          source={imageState.source}
          style={[{ resizeMode: 'contain' as const }, imageState.dimensions, imageState.imageStyle]}
          resizeMethod="none"
          onError={(event) => imageState.onError(event.nativeEvent.error as unknown as Error)}
        />
      ) : imageState.type === 'loading' ? (
        <View style={imageState.dimensions} />
      ) : (
        <View style={[{ borderColor: theme.line, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' as const, overflow: 'hidden' as const }, imageState.dimensions]}>
          <Text numberOfLines={2} style={styles.inlineForumImageText}>{imageState.alt || '图片加载失败'}</Text>
        </View>
      );
      return (
        <Pressable
          accessibilityLabel={imageState.alt || '查看图片'}
          accessibilityRole="button"
          style={sharedContainerStyle}
          onPress={(event) => {
            event.stopPropagation?.();
            openImagePreview(src);
          }}
        >
          {content}
        </Pressable>
      );
    };
    const InlineForumImageRenderer: CustomMixedRenderer = (props) => {
      const attributes = ((props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {});
      const src = attributes.src || '';
      const label = attributes.alt || attributes.title || '';
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{label}</Text>;
      }
      const isInlineImage = isInlineForumImage(attributes);
      if (isInlineImage) {
        return <Image source={imageSourceFromUrl(src)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(attributes, readerData.settings.fontScale), inlineForumImageAlignmentStyle(attributes, readerData.settings.fontScale, htmlBaseStyle.lineHeight)]} />;
      }
      return <Text style={styles.inlineForumImageText}>{label || src}</Text>;
    };
    return { img: PreviewImageRenderer, [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer };
  }, [htmlBaseStyle.lineHeight, markImageInlineSized, openImagePreview, readerData.settings.fontScale, styles.inlineForumImage, styles.inlineForumImageText, theme.line]);
  useEffect(() => () => {
    topicAbortRef.current?.abort();
    repliesAbortRef.current?.abort();
    actionAbortRef.current?.abort();
    clearTopicScrollRestoreTimer();
    clearReaderDataTimers();
    cancelDeferredNavigationTask();
  }, [cancelDeferredNavigationTask, clearReaderDataTimers, clearTopicScrollRestoreTimer]);
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(readerData), [
    readerData.favorites,
    readerData.history,
    readerData.settings.listDensity
  ]);
  const closeYaohuoLoginPanel = useCallback(() => {
    yaohuoLoginPanelRequestRef.current += 1;
    yaohuoWebViewRef.current?.stopLoading();
    setShowYaohuoLoginPanel(false);
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
    webViewRef.current?.stopLoading();
    setLoadingLoginPage(visible);
    setShowLoginPanel(visible);
  }, []);

  const showYaohuoLogin = useCallback((message = '请先登录妖火。') => {
    setScreen('more');
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
    setChecking,
    setLinuxDoLevelBusy,
    setLinuxDoLevelError,
    setLinuxDoLevelProfile,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    setYaohuoLoginCookieHeader,
    showLinuxDoPanelRef,
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
        flushPendingProgress();
        stopLinuxDoVerificationForInactiveApp();
      }
    });
    return () => subscription.remove();
  }, [flushPendingProgress, stopLinuxDoVerificationForInactiveApp]);

  const closeMorePanels = useCallback(() => {
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    closeLinuxDoPanel();
    setShowSettingsPanel(false);
  }, [changeNodeSeekLoginPanel, closeLinuxDoPanel, closeYaohuoLoginPanel]);

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
    queryClient: queryClientRef.current,
    readerData,
    readerDataLoaded,
    showNodeSeekVerification,
    showYaohuoLogin
  });

  const {
    loadMoreSearchSource,
    recentSearches,
    removeRecentSearch,
    retrySearchSource,
    runSearch,
    searchBusy,
    searchGroups,
    searchQuery,
    searchScope,
    searchSort,
    searchSource,
    setSearchQuery,
    setSearchScope,
    setSearchSort,
    setSearchSource,
    visibleSearchItems
  } = useSearchController({
    clearYaohuoLoginState,
    fetcher: forumFetchWithWebViewFallback,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    readerData,
    showNodeSeekVerification,
    showYaohuoLogin
  });

  const {
    backupBusy,
    backupJson,
    checkLocalStatus,
    exportBackup,
    exportBackupFile,
    healthDetails,
    healthSummary,
    importBackup,
    importBackupFile,
    setBackupJson,
    statusBusy
  } = useBackupStatusController({
    clearYaohuoLoginState,
    dispatchSiteSessionEvent,
    fetcher: forumFetchWithWebViewFallback,
    linuxDoUserAgentRef: linuxDoWebViewUserAgentRef,
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef: nodeSeekWebViewUserAgentRef,
    notify,
    queryClient: queryClientRef.current,
    readerDataRef,
    replaceReaderData,
    resetLinuxDoLevelState,
    setYaohuoLoginCookieHeader,
    waitForReaderDataSave
  });

  const changeScreen = useCallback((nextScreen: Screen) => {
    const leavingTopicForUser = screen === 'topic' && nextScreen === 'user';
    if (screen === 'more' && nextScreen !== 'more') {
      closeMorePanels();
    }
    if (screen === 'topic' && nextScreen !== 'topic') {
      screenRef.current = nextScreen;
      flushPendingProgress();
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
      loadingMoreRepliesRef.current = false;
      setLoadingMoreReplies(false);
      setTopicBusy(false);
    }
    if (nextScreen !== 'topic' && !leavingTopicForUser) {
      clearTopicScrollRestoreTimer();
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
  }, [abortQuotedReplyRequests, clearTopicScrollRestoreTimer, closeMorePanels, flushPendingProgress, invalidateTopicActionRequests, screen]);

  const topicSnapshot = useCallback((): TopicSnapshot => {
    const currentTopic = topicDetail || selectedTopic;
    const session = currentTopic ? {
      ...createEmptyTopicSession(currentTopic),
      selectedTopic,
      topicDetail,
      topicReplies,
      topicError,
      replyHasMore,
      replyNextPage,
      replyNextOffset,
      unreadReplyCount,
      commentQuery,
      replyFilter,
      replyContent,
      replyComposerOpen,
      replyTarget,
      expandedQuotes: expandedQuotesRef.current,
      loadedQuotedReplies: loadedQuotedRepliesRef.current,
      loadingQuotedFloors: {},
      scrollY: topicScrollYRef.current
    } : createEmptyTopicSession({
      source: 'nodeseek',
      id: '',
      title: '',
      author: '',
      url: '',
      createdAt: '',
      replyCount: 0
    });
    return snapshotFromTopicSession(session);
  }, [commentQuery, expandedQuotesRef, loadedQuotedRepliesRef, replyComposerOpen, replyContent, replyFilter, replyHasMore, replyNextOffset, replyNextPage, replyTarget, selectedTopic, topicDetail, topicError, topicReplies, unreadReplyCount]);

  const restoreTopicSnapshot = useCallback((snapshot: TopicSnapshot) => {
    const session = topicSessionFromSnapshot(snapshot);
    clearTopicScrollRestoreTimer();
    setSelectedTopic(session.selectedTopic);
    setTopicDetail(session.topicDetail);
    setTopicReplies(session.topicReplies);
    setTopicError(session.topicError);
    setReplyHasMore(session.replyHasMore);
    setReplyNextPage(session.replyNextPage);
    setReplyNextOffset(session.replyNextOffset);
    setUnreadReplyCount(session.unreadReplyCount);
    setCommentQuery(session.commentQuery);
    setReplyFilter(session.replyFilter);
    setReplyContent(session.replyContent);
    setReplyComposerOpen(session.replyComposerOpen);
    setReplyTarget(session.replyTarget);
    expandedQuotesRef.current = session.expandedQuotes;
    loadedQuotedRepliesRef.current = session.loadedQuotedReplies;
    loadingQuotedFloorsRef.current = {};
    topicScrollYRef.current = session.scrollY;
    setExpandedQuotes(session.expandedQuotes);
    setLoadedQuotedReplies(session.loadedQuotedReplies);
    setLoadingQuotedFloors({});
    setQuoteStateVersion((current) => current + 1);
    setTopicBusy(false);
    setLoadingMoreReplies(false);
    loadingMoreRepliesRef.current = false;
    const restoredTopic = session.topicDetail || session.selectedTopic;
    invalidateTopicActionRequests(restoredTopic ? topicKey(restoredTopic) : null);
    currentTopicKeyRef.current = restoredTopic ? topicKey(restoredTopic) : null;
  }, [clearTopicScrollRestoreTimer, invalidateTopicActionRequests]);

  const prepareUserNavigation = useCallback(() => {
    if (screen !== 'user') {
      userReturnScreenRef.current = screen;
    }
    if (screen === 'topic') {
      userReturnTopicRef.current = {
        returnScreen: topicReturnScreenRef.current,
        snapshot: topicSnapshot(),
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
    loadMoreUserTopics,
    openUser,
    selectedUser,
    userBusy,
    userError,
    userLoadingMore,
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
    showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin
  });

  const {
    loadMoreReplies,
    openTopic,
    refreshTopic,
    refreshTopicReplies,
    refreshWholeTopic,
    toggleQuotedFloor,
    topicFavorite
  } = useTopicController({
    changeScreen,
    clearTopicScrollRestoreTimer,
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
    setCommentQuery,
    setLoadedQuotedReplies: updateLoadedQuotedReplies,
    setLoadingMoreReplies,
    setLoadingQuotedFloors: updateLoadingQuotedFloors,
    setReplyComposerOpen,
    setReplyContent,
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
    showNodeSeekVerification,
    showYaohuoLogin,
    onTopicContextChange: invalidateTopicActionRequests,
    topicAbortRef,
    topicBackStackRef,
    topicDetail,
    topicReplies,
    topicRepliesRef,
    topicRequestIdRef,
    topicReturnScreenRef,
    topicScrollRef,
    topicScrollRestoreTimerRef,
    topicSnapshot,
    updateExpandedQuotes
  });
  const showLinuxDoLogin = useCallback((message = 'linux.do 登录后才能操作，匿名仍可阅读。') => {
    setScreen('more');
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    setShowSettingsPanel(false);
    notify(message);
    changeLinuxDoPanel(true);
  }, [changeLinuxDoPanel, changeNodeSeekLoginPanel, closeYaohuoLoginPanel, notify]);

  openTopicRef.current = openTopic;

  const {
    bookmarkOnLinuxDoSite,
    canUseLinuxDoActions,
    canUseNodeSeekActions,
    canUseYaohuoActions,
    checkIn,
    collectOnNodeSeekSite,
    favoriteOnYaohuoSite,
    interact,
    submitReply,
    votePoll
  } = useTopicActionsController({
    actionAbortRef,
    actionRequestIdRef,
    clearNodeSeekLoginCookiesOnly,
    clearYaohuoLoginState,
    linuxDoWebViewUserAgentRef,
    loadYaohuoCookieForSource,
    nodeSeekWebViewUserAgentRef,
    notify,
    openTopic,
    optimisticTopicActionsRef,
    refreshTopicReplies,
    replyContent,
    replyTarget,
    resetLinuxDoLevelState,
    selectedTopic,
    setActionBusy,
    setOptimisticTopicActions,
    setReplyComposerOpen,
    setReplyContent,
    setReplyTarget,
    setTopicDetail,
    setTopicReplies,
    showLinuxDoLogin,
    showYaohuoLogin,
    siteSessionStates,
    topicActionRequestOwnerRef,
    topicDetail,
    topicReplies,
    updateLinuxDoSession
  });

  const htmlRenderersProps = useMemo<HtmlRenderersProps>(() => ({
    a: {
      onPress: (event, href) => {
        if (isPreviewableImageUrl(href)) {
          event.stopPropagation?.();
          openImagePreview(href);
          return;
        }
        const appTopic = parseForumTopicLink(href, selectedTopic?.url || topicDetail?.url);
        if (appTopic) {
          event.stopPropagation?.();
          openTopic(appTopic);
          return;
        }
        openExternalUrl(href);
      }
    },
    img: {
      enableExperimentalPercentWidth: true
    }
  }), [openExternalUrl, openImagePreview, openTopic, selectedTopic?.url, topicDetail?.url]);

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
    const detail = topicDetail || selectedTopic;
    if (!detail) {
      return;
    }
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollY = Math.max(0, contentOffset.y);
    topicScrollYRef.current = scrollY;
    const scrollable = Math.max(1, contentSize.height - layoutMeasurement.height);
    const percent = Math.min(100, Math.max(0, Math.round((scrollY / scrollable) * 100)));
    queueProgressSave(detail, { percent, scrollY });
  }, [queueProgressSave, selectedTopic, topicDetail]);

  const handleNodeSeekBrowserFetchMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        id?: number;
        html?: string;
        cookie?: string;
        userAgent?: string;
        challenge?: boolean;
      };
      if (data.type === 'nodeseek-browser-fetch') {
        completeNodeSeekBrowserFetch(data);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [completeNodeSeekBrowserFetch]);

  const handleLinuxDoBrowserFetchMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        id?: number;
        body?: string;
        cookie?: string;
        userAgent?: string;
        challenge?: boolean;
      };
      if (data.type === 'linuxdo-browser-fetch') {
        completeLinuxDoBrowserFetch(data);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [completeLinuxDoBrowserFetch]);

  const openReadingSettingsFromTopic = useCallback(() => {
    changeNodeSeekLoginPanel(false);
    closeYaohuoLoginPanel();
    closeLinuxDoPanel();
    setShowSettingsPanel(true);
    changeScreen('more');
  }, [changeNodeSeekLoginPanel, changeScreen, closeLinuxDoPanel, closeYaohuoLoginPanel]);
  const toggleReplyComposer = useCallback((open: boolean) => {
    setReplyComposerOpen(open);
    if (!open) {
      setReplyTarget(null);
    }
  }, []);

  const replyToFloor = useCallback((reply: Reply) => {
    if (!reply.floor) {
      notify('当前楼层信息不完整，刷新主题后再试。');
      return;
    }
    setReplyTarget({
      floor: reply.floor,
      author: reply.author,
      authorId: reply.authorId,
      commentId: reply.commentId
    });
    setReplyComposerOpen(true);
  }, [notify]);

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
      if (replyComposerOpen) {
        setReplyComposerOpen(false);
        setReplyTarget(null);
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
    closeYaohuoLoginPanel,
    goBackFromTopic,
    goBackFromUser,
    imagePreview,
    screen,
    closeLinuxDoPanel,
    showLoginPanel,
    showLinuxDoPanel,
    showYaohuoLoginPanel,
    replyComposerOpen,
    showSettingsPanel
  ]);

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    commitReaderData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...patch
      }
    }));
  }, [commitReaderData]);

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
      navigationRef.dispatch(CommonActions.navigate({
        name: 'MainTabs',
        params: {
          screen: nextScreen
        }
      }));
    }
  }, []);
  useEffect(() => {
    if (skipNextNavigationSyncRef.current) {
      skipNextNavigationSyncRef.current = false;
      return;
    }
    syncNavigationToScreen(screen);
  }, [screen, syncNavigationToScreen]);

  const toggleTopicFavorite = useCallback((topic: Topic) => {
    commitReaderData((current) => toggleFavorite(current, topic));
  }, [commitReaderData]);

  const toggleUserFollow = useCallback((user: UserProfile) => {
    commitReaderData((current) => toggleFollowedUser(current, user));
  }, [commitReaderData]);

  const removeFollowedUser = useCallback((user: UserProfile) => {
    commitReaderData((current) => removeFollowedUsers(current, [user]));
  }, [commitReaderData]);

  const removeLibraryTopic = useCallback((topic: Topic) => {
    const section = libraryTab === 'history' ? 'history' : 'favorites';
    commitReaderData((current) => removeRecords(current, section, [topic]));
  }, [commitReaderData, libraryTab]);

  const clearHistory = useCallback(() => {
    const records = readerDataRef.current.history;
    if (!Object.keys(records).length) {
      return;
    }
    commitReaderData((current) => clearRecords(current, 'history'));
  }, [commitReaderData]);

  const requestTabScrollToTop = useCallback((target: keyof MainTabParamList) => {
    if (target === 'more') {
      moreScrollRef.current?.scrollTo({ y: 0, animated: true });
    }
    setTabScrollToTopSignals((current) => ({
      ...current,
      [target]: current[target] + 1
    }));
  }, []);

  const renderFeedTab = useCallback(() => (
    <FeedScreen
      busy={feedBusy || actionBusy}
      categories={categories}
      categoryFilter={categoryFilter}
      feedHasMore={activeFeedState.hasMore && feedAllowsRemotePagination}
      feedItems={shownFeedItems}
      feedPage={activeFeedState.page}
      feedSource={feedSource}
      loadMoreFailureSignal={activeFeedState.loadMoreFailureSignal}
      loadingMore={activeFeedState.loadingMore}
      topicStateIndex={topicStateIndex}
      readingFilter={readingFilter}
      refreshing={activeFeedState.refreshing}
      scrollToTopSignal={tabScrollToTopSignals.feed}
      styles={styles}
      theme={theme}
      onCategoryChange={setCategoryFilter}
      onFeedSourceChange={changeFeedSource}
      onLoadMore={() => {
        if (!feedAllowsRemotePagination) {
          return;
        }
        loadFeed({ page: activeFeedState.page + 1, cursor: feedSource === 'all' ? activeFeedState.nextCursor : undefined, nocache: true });
      }}
      onOpenTopic={openTopic}
      onReadingFilterChange={setReadingFilter}
      onRefresh={refreshFeed}
    />
  ), [actionBusy, activeFeedState, categories, categoryFilter, changeFeedSource, feedAllowsRemotePagination, feedBusy, feedSource, loadFeed, openTopic, readingFilter, refreshFeed, shownFeedItems, styles, tabScrollToTopSignals.feed, theme, topicStateIndex]);

  const renderSearchTab = useCallback(() => (
    <SearchScreen
      busy={searchBusy}
      query={searchQuery}
      topicStateIndex={topicStateIndex}
      recentSearches={recentSearches}
      results={visibleSearchItems}
      searchGroups={searchGroups}
      scope={searchScope}
      searchSource={searchSource}
      sort={searchSort}
      scrollToTopSignal={tabScrollToTopSignals.search}
      styles={styles}
      theme={theme}
      onLoadMoreSearchSource={loadMoreSearchSource}
      onOpenExternalUrl={openExternalUrl}
      onOpenTopic={openTopic}
      onRemoveRecentSearch={removeRecentSearch}
      onQueryChange={setSearchQuery}
      onScopeChange={setSearchScope}
      onSearch={() => runSearch()}
      onSearchSourceChange={setSearchSource}
      onSortChange={setSearchSort}
      onRetrySearchSource={retrySearchSource}
    />
  ), [loadMoreSearchSource, openExternalUrl, openTopic, recentSearches, removeRecentSearch, retrySearchSource, runSearch, searchBusy, searchGroups, searchQuery, searchScope, searchSort, searchSource, styles, tabScrollToTopSignals.search, theme, topicStateIndex, visibleSearchItems]);

  const renderLibraryTab = useCallback(() => (
    <LibraryScreen
      categories={categories}
      followedUsers={followedUserRecords}
      libraryTab={libraryTab}
      records={libraryRecords}
      scrollToTopSignal={tabScrollToTopSignals.library}
      topicStateIndex={topicStateIndex}
      styles={styles}
      theme={theme}
      onClearHistory={clearHistory}
      onOpenTopic={openTopic}
      onOpenUser={openUser}
      onRemove={removeLibraryTopic}
      onRemoveUser={removeFollowedUser}
      onTabChange={setLibraryTab}
    />
  ), [categories, clearHistory, followedUserRecords, libraryRecords, libraryTab, openTopic, openUser, removeFollowedUser, removeLibraryTopic, styles, tabScrollToTopSignals.library, theme, topicStateIndex]);

  const renderMoreTab = useCallback(() => (
    <ScrollView ref={moreScrollRef} style={styles.content} contentContainerStyle={styles.moreContentInner} keyboardShouldPersistTaps="handled">
      <MemoizedMoreScreen
        checking={checking}
        healthDetails={healthDetails}
        healthSummary={healthSummary}
        loginState={loginState}
        loadingLoginPage={loadingLoginPage}
        loadingYaohuoLoginPage={loadingYaohuoLoginPage}
        loadingLinuxDoPage={loadingLinuxDoPage}
        linuxDoWebViewError={linuxDoWebViewError}
        linuxDoWebViewKey={linuxDoWebViewKey}
        linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
        linuxDoLevelBusy={linuxDoLevelBusy}
        linuxDoLevelError={linuxDoLevelError}
        linuxDoLevelProfile={linuxDoLevelProfile}
        mountLinuxDoWebView={mountLinuxDoWebView}
        nodeSeekWebViewUserAgent={nodeSeekWebViewUserAgent}
        settings={readerData.settings}
        backupJson={backupJson}
        showLoginPanel={showLoginPanel}
        showYaohuoLoginPanel={showYaohuoLoginPanel}
        showLinuxDoPanel={showLinuxDoPanel}
        showSettingsPanel={showSettingsPanel}
        statusBusy={statusBusy}
        styles={styles}
        backupBusy={backupBusy}
        theme={theme}
        webViewRef={webViewRef}
        yaohuoLoginCookieHeader={yaohuoLoginCookieHeader}
        yaohuoLoginState={yaohuoLoginState}
        yaohuoWebViewRef={yaohuoWebViewRef}
        sessionViewModels={siteSessionViewModels}
        linuxDoWebViewRef={linuxDoWebViewRef}
        onCheckHealth={checkLocalStatus}
        onCheckIn={checkIn}
        onCheckLogin={checkLogin}
        onRememberNodeSeekCookies={rememberVisibleNodeSeekCookies}
        onCheckYaohuoLogin={checkYaohuoCookie}
        onCheckLinuxDoCookie={checkLinuxDoCookie}
        onRefreshLinuxDoLevel={refreshLinuxDoLevel}
        onClearLogin={clearLogin}
        onClearYaohuoLogin={clearYaohuoLogin}
        onClearLinuxDoCookie={clearLinuxDoCookie}
        handleNodeSeekLoginNavigation={handleNodeSeekLoginNavigation}
        handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
        handleLinuxDoNavigation={handleLinuxDoNavigation}
        onHandleLoginMessage={handleLoginMessage}
        onHandleLinuxDoMessage={handleLinuxDoMessage}
        onImportBackup={importBackup}
        onExportBackup={exportBackup}
        onExportBackupFile={exportBackupFile}
        onImportBackupFile={importBackupFile}
        onBackupJsonChange={setBackupJson}
        onSetLoadingLoginPage={setLoadingLoginPage}
        onSetLoadingYaohuoLoginPage={setLoadingYaohuoLoginPage}
        onSetLoadingLinuxDoPage={setLoadingLinuxDoPageForSession}
        onSetLinuxDoWebViewError={setLinuxDoWebViewErrorForSession}
        onResetLinuxDoWebView={resetLinuxDoWebView}
        onShowLoginPanelChange={changeNodeSeekLoginPanel}
        onShowYaohuoLoginPanelChange={changeYaohuoLoginPanel}
        onShowLinuxDoPanelChange={changeLinuxDoPanel}
        onShowSettingsPanelChange={setShowSettingsPanel}
        onUpdateSettings={updateSettings}
      />
    </ScrollView>
  ), [backupBusy, backupJson, changeLinuxDoPanel, changeNodeSeekLoginPanel, changeYaohuoLoginPanel, checkIn, checkLinuxDoCookie, checkLocalStatus, checkLogin, checkYaohuoCookie, checking, clearLinuxDoCookie, clearLogin, clearYaohuoLogin, exportBackup, exportBackupFile, handleLinuxDoMessage, handleLinuxDoNavigation, handleLoginMessage, handleNodeSeekLoginNavigation, handleYaohuoLoginNavigation, healthDetails, healthSummary, importBackup, importBackupFile, linuxDoLevelBusy, linuxDoLevelError, linuxDoLevelProfile, linuxDoWebViewError, linuxDoWebViewKey, linuxDoWebViewUserAgent, loadingLinuxDoPage, loadingLoginPage, loadingYaohuoLoginPage, loginState, mountLinuxDoWebView, nodeSeekWebViewUserAgent, readerData.settings, refreshLinuxDoLevel, rememberVisibleNodeSeekCookies, resetLinuxDoWebView, setLinuxDoWebViewErrorForSession, setLoadingLinuxDoPageForSession, showLinuxDoPanel, showLoginPanel, showSettingsPanel, showYaohuoLoginPanel, siteSessionViewModels, statusBusy, styles, theme, updateSettings, yaohuoLoginCookieHeader, yaohuoLoginState]);

  const renderTopicScreen = useCallback(() => (
    <TopicScreen
      actionBusy={actionBusy}
      canUseLinuxDoActions={canUseLinuxDoActions}
      canUseNodeSeekActions={canUseNodeSeekActions}
      canUseYaohuoActions={canUseYaohuoActions}
      contentWidth={contentWidth}
      htmlBaseStyle={htmlBaseStyle}
      htmlIgnoredStyles={htmlIgnoredStyles}
      htmlRenderers={htmlRenderers}
      htmlRenderersProps={htmlRenderersProps}
      htmlTagsStyles={htmlTagsStyles}
      inlineSizedImageUrls={inlineSizedImageUrls}
      expandedQuotesRef={expandedQuotesRef}
      loadedQuotedRepliesRef={loadedQuotedRepliesRef}
      loadingMoreReplies={loadingMoreReplies}
      loadingQuotedFloorsRef={loadingQuotedFloorsRef}
      commentQuery={commentQuery}
      quoteStateVersion={quoteStateVersion}
      topicFavorite={topicFavorite}
      replyComposerOpen={replyComposerOpen}
      replyContent={replyContent}
      replyFilter={replyFilter}
      replyTarget={replyTarget}
      replyHasMore={replyHasMore}
      replies={filteredReplies}
      selectedTopic={selectedTopic}
      sourceReplies={topicReplies}
      styles={styles}
      theme={theme}
      topic={topicDetail}
      topicBusy={topicBusy}
      topicError={topicError}
      topicScrollRef={topicScrollRef}
      unreadReplyCount={unreadReplyCount}
      onBack={goBackFromTopic}
      onCommentQueryChange={setCommentQuery}
      optimisticActions={optimisticTopicActions}
      onInteract={interact}
      onLinuxDoBookmark={bookmarkOnLinuxDoSite}
      onNodeSeekCollection={collectOnNodeSeekSite}
      onShareTopic={shareTopic}
      onYaohuoFavorite={favoriteOnYaohuoSite}
      onVotePoll={votePoll}
      onLoadMoreReplies={loadMoreReplies}
      onOpenOriginal={openExternalUrl}
      onOpenReadingSettings={openReadingSettingsFromTopic}
      onReplyComposerOpenChange={toggleReplyComposer}
      onReplyContentChange={setReplyContent}
      onReplyFilterChange={setReplyFilter}
      onReplyToFloor={replyToFloor}
      onRefreshTopic={refreshTopic}
      onRefreshWholeTopic={refreshWholeTopic}
      onVerifyLinuxDo={verifyLinuxDoFromTopic}
      onSubmitReply={submitReply}
      onTopicScroll={handleTopicScroll}
      onToggleQuotedFloor={toggleQuotedFloor}
      onToggleFavorite={toggleTopicFavorite}
      onOpenUser={openUser}
    />
  ), [actionBusy, bookmarkOnLinuxDoSite, canUseLinuxDoActions, canUseNodeSeekActions, canUseYaohuoActions, collectOnNodeSeekSite, commentQuery, contentWidth, expandedQuotesRef, favoriteOnYaohuoSite, filteredReplies, goBackFromTopic, handleTopicScroll, htmlBaseStyle, htmlIgnoredStyles, htmlRenderers, htmlRenderersProps, htmlTagsStyles, inlineSizedImageUrls, interact, loadedQuotedRepliesRef, loadMoreReplies, loadingMoreReplies, loadingQuotedFloorsRef, openExternalUrl, openReadingSettingsFromTopic, openUser, optimisticTopicActions, quoteStateVersion, refreshTopic, refreshWholeTopic, replyComposerOpen, replyContent, replyFilter, replyHasMore, replyToFloor, replyTarget, selectedTopic, shareTopic, submitReply, styles, theme, toggleQuotedFloor, toggleReplyComposer, toggleTopicFavorite, topicBusy, topicDetail, topicError, topicFavorite, topicReplies, unreadReplyCount, verifyLinuxDoFromTopic, votePoll]);

  const renderUserScreen = useCallback(() => (
    <UserScreen
      busy={userBusy}
      error={userError}
      followed={currentUserFollowed}
      profile={userProfile}
      requestedUser={selectedUser}
      styles={styles}
      theme={theme}
      topicStateIndex={topicStateIndex}
      loadingMoreTopics={userLoadingMore}
      onBack={goBackFromUser}
      onLoadMoreTopics={loadMoreUserTopics}
      onOpenOriginal={openExternalUrl}
      onOpenTopic={openTopic}
      onRefresh={() => {
        const user = userProfile || selectedUser;
        if (user) {
          void openUser(user, true);
        }
      }}
      onToggleFollow={toggleUserFollow}
    />
  ), [currentUserFollowed, goBackFromUser, loadMoreUserTopics, openExternalUrl, openTopic, openUser, selectedUser, styles, theme, toggleUserFollow, topicStateIndex, userBusy, userError, userLoadingMore, userProfile]);

  const renderMainTabs = useCallback(() => (
    <Tab.Navigator
      initialRouteName="feed"
      screenOptions={({ route }) => {
        const item = tabNavItems.find((entry) => entry.value === route.name) || tabNavItems[0];
        return {
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: styles.nav,
          tabBarItemStyle: styles.navItem,
          tabBarIcon: ({ focused }: { focused: boolean }) => (
            <TabBarIcon focused={focused} icon={item.icon} label={item.label} styles={styles} theme={theme} />
          )
        };
      }}
      screenListeners={({ route }) => ({
        tabPress: () => {
          triggerPressFeedback();
          const targetScreen = route.name as keyof MainTabParamList;
          if (screen === targetScreen) {
            requestTabScrollToTop(targetScreen);
          }
          changeScreen(targetScreen);
        }
      })}
    >
      <Tab.Screen name="feed" options={{ title: '首页' }}>
        {renderFeedTab}
      </Tab.Screen>
      <Tab.Screen name="search" options={{ title: '搜索' }}>
        {renderSearchTab}
      </Tab.Screen>
      <Tab.Screen name="library" options={{ title: '收藏' }}>
        {renderLibraryTab}
      </Tab.Screen>
      <Tab.Screen name="more" options={{ title: '更多' }}>
        {renderMoreTab}
      </Tab.Screen>
    </Tab.Navigator>
  ), [changeScreen, renderFeedTab, renderLibraryTab, renderMoreTab, renderSearchTab, requestTabScrollToTop, screen, styles, theme]);

  return (
    <GestureHandlerRootView style={styles.screen}>
      <SafeAreaProvider>
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <SafeAreaView style={styles.screen}>
        <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
        <View pointerEvents="none" style={styles.statusBarScrim} />
        {nodeSeekBrowserFetchRequest ? (
          <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
            <WebView
              key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}
              ref={nodeSeekBrowserWebViewRef}
              source={{
                uri: nodeSeekBrowserFetchRequest.url,
                headers: nodeSeekBrowserFetchRequest.cookie ? { Cookie: nodeSeekBrowserFetchRequest.cookie } : undefined
              }}
              javaScriptEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={nodeSeekBrowserFetchRequest.userAgent || nodeSeekWebViewUserAgent}
              containerStyle={styles.hiddenBrowserWebView}
              style={styles.hiddenBrowserWebView}
              onLoadEnd={() => {
                nodeSeekBrowserWebViewRef.current?.injectJavaScript(
                  NODESEEK_BROWSER_FETCH_SCRIPT.replace('__NODESEEK_BROWSER_FETCH_ID__', String(nodeSeekBrowserFetchRequest.id))
                );
              }}
              onMessage={handleNodeSeekBrowserFetchMessage}
              onError={(event) => {
                failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, event.nativeEvent.description || 'NodeSeek 页面加载失败');
              }}
              onHttpError={(event) => {
                if (event.nativeEvent.url !== nodeSeekBrowserFetchRequest.url) {
                  return;
                }
                if (event.nativeEvent.statusCode === 403) {
                  if (nodeSeekBrowserFetchCurrentRef.current?.id === nodeSeekBrowserFetchRequest.id) {
                    nodeSeekBrowserFetchCurrentRef.current.httpErrorStatus = event.nativeEvent.statusCode;
                  }
                  return;
                }
                failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, `NodeSeek 页面返回错误 ${event.nativeEvent.statusCode}`);
              }}
              onRenderProcessGone={() => {
                failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面读取进程已停止');
              }}
              renderError={() => <View style={styles.hiddenBrowserWebView} />}
            />
          </View>
        ) : null}
        {linuxDoBrowserFetchRequest ? (
          <View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>
            <WebView
              key={`linuxdo-browser-fetch-${linuxDoBrowserFetchRequest.id}`}
              ref={linuxDoBrowserWebViewRef}
              source={{
                uri: linuxDoBrowserFetchRequest.url,
                headers: linuxDoBrowserFetchRequest.cookie ? { Cookie: linuxDoBrowserFetchRequest.cookie } : undefined
              }}
              javaScriptEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              userAgent={linuxDoBrowserFetchRequest.userAgent || linuxDoWebViewUserAgent}
              containerStyle={styles.hiddenBrowserWebView}
              style={styles.hiddenBrowserWebView}
              onLoadEnd={() => {
                linuxDoBrowserWebViewRef.current?.injectJavaScript(
                  LINUXDO_BROWSER_FETCH_SCRIPT.replace('__LINUXDO_BROWSER_FETCH_ID__', String(linuxDoBrowserFetchRequest.id))
                );
              }}
              onMessage={handleLinuxDoBrowserFetchMessage}
              onError={(event) => {
                failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, event.nativeEvent.description || 'linux.do 页面加载失败');
              }}
              onHttpError={(event) => {
                if (event.nativeEvent.url !== linuxDoBrowserFetchRequest.url) {
                  return;
                }
                if (event.nativeEvent.statusCode === 403) {
                  if (linuxDoBrowserFetchCurrentRef.current?.id === linuxDoBrowserFetchRequest.id) {
                    linuxDoBrowserFetchCurrentRef.current.httpErrorStatus = event.nativeEvent.statusCode;
                  }
                  return;
                }
                failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, `linux.do 页面返回错误 ${event.nativeEvent.statusCode}`);
              }}
              onRenderProcessGone={() => {
                failLinuxDoBrowserFetchById(linuxDoBrowserFetchRequest.id, 'linux.do 页面读取进程已停止');
              }}
              renderError={() => <View style={styles.hiddenBrowserWebView} />}
            />
          </View>
        ) : null}
        <MemoizedLinuxDoVerifyModal
          checking={checking}
          linuxDoSession={siteSessionViewModels.linuxdo}
          linuxDoWebViewError={linuxDoWebViewError}
          linuxDoWebViewKey={linuxDoWebViewKey}
          linuxDoWebViewRef={linuxDoWebViewRef}
          linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
          mountLinuxDoWebView={mountLinuxDoWebView}
          loadingLinuxDoPage={loadingLinuxDoPage}
          showLinuxDoPanel={showLinuxDoPanel}
          styles={styles}
          theme={theme}
          onCheckLinuxDoCookie={checkLinuxDoCookie}
          onClearLinuxDoCookie={clearLinuxDoCookie}
          handleLinuxDoNavigation={handleLinuxDoNavigation}
          onHandleLinuxDoMessage={handleLinuxDoMessage}
          onResetLinuxDoWebView={resetLinuxDoWebView}
          onSetLinuxDoWebViewError={setLinuxDoWebViewErrorForSession}
          onSetLoadingLinuxDoPage={setLoadingLinuxDoPageForSession}
          onShowLinuxDoPanelChange={changeLinuxDoPanel}
        />
        <NavigationContainer ref={navigationRef} theme={navigationTheme} onReady={() => syncNavigationToScreen(screen)}>
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', freezeOnBlur: true, contentStyle: { backgroundColor: theme.background } }}>
            <Stack.Screen name="MainTabs">
              {renderMainTabs}
            </Stack.Screen>
            <Stack.Screen name="Topic" listeners={{ transitionEnd: (event) => {
              if (event.data.closing) {
                flushDeferredNavigationTask();
              }
            } }}>
              {renderTopicScreen}
            </Stack.Screen>
            <Stack.Screen name="User" listeners={{ transitionEnd: (event) => {
              if (event.data.closing) {
                flushDeferredNavigationTask();
              }
            } }}>
              {renderUserScreen}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
        <ImagePreviewModal
          preview={imagePreview}
          styles={styles}
          onClose={closeImagePreview}
          onNext={showNextImage}
          onPrevious={showPreviousImage}
          onSave={savePreviewImage}
          onSelect={selectPreviewImage}
        />
          </SafeAreaView>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
