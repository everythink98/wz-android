import 'expo-dev-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  SafeAreaView,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  useWindowDimensions,
  View
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  IMGElement,
  useIMGElementProps,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import {
  buildNodeSeekAttendanceRequest,
  buildNodeSeekInteractionRequest,
  buildNodeSeekReplyRequest,
  type NodeSeekActionRequest
} from './src/nodeseekActions';
import { runNodeSeekAction } from './src/nodeseekActionClient';
import {
  buildYaohuoFavoriteRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest,
  extractYaohuoSid,
  type YaohuoActionRequest
} from './src/yaohuoActions';
import { runYaohuoAction } from './src/yaohuoActionClient';
import {
  DEFAULT_NODESEEK_ANDROID_USER_AGENT,
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  mergeNodeSeekCookies,
  parseNodeSeekDocumentCookie,
  removeNodeSeekLoginCookies,
  sanitizeNodeSeekUserAgent,
  summarizeNodeSeekCookies
} from './src/nodeseekCookies';
import { readNodeSeekCookiesFromWebView } from './src/nodeseekCookieBridge';
import {
  buildYaohuoCookieHeader,
  canStoreYaohuoCookieHeader,
  mergeYaohuoCookies,
  summarizeYaohuoCookies,
  type YaohuoNativeCookie
} from './src/yaohuoCookies';
import {
  getCategories,
  getFeed,
  getReply,
  getReplies,
  getTopic,
  getUserProfile,
  searchTopics
} from './src/forumApi';
import {
  addSavedSearch,
  clearRecords,
  createEmptyReaderData,
  recordHistory,
  removeFollowedUsers,
  removeRecords,
  removeSavedSearch,
  restoreRecords,
  sanitizeReaderData,
  toggleFavorite,
  toggleFollowedUser,
  isUserFollowed,
  topicKey,
  updateTopicRecord,
  updateProgress,
  type FollowedUserRecord,
  type ReaderData,
  type ReaderSettings,
  type TopicRecord
} from './src/readerData';
import { loadReaderData, saveReaderData } from './src/readerDataStore';
import { exportReaderBackupJson, importReaderBackupJson } from './src/readerBackup';
import {
  DEFAULT_LINUXDO_ANDROID_USER_AGENT,
  buildLinuxDoCookieHeader,
  canStoreLinuxDoClearance,
  clearLinuxDoAccess,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  mergeLinuxDoCookies,
  parseLinuxDoDocumentCookie,
  readLinuxDoCookiesFromWebView,
  saveLinuxDoAccess,
  sanitizeLinuxDoUserAgent,
  summarizeLinuxDoCookies
} from './src/linuxdoCookieBridge';
import type { Category, FeedResponse, FeedSource, Reply, Source, Topic, TopicDetail, UserProfile } from './src/types';
import { createImagePreviewList, dataImageFileFromUrl, extractImageUrlsFromHtml, imageRequestHeadersForUrl, imageSourceFromUrl, INLINE_FORUM_IMAGE_TAG, isHttpOrHttpsUrl, isInlineForumImage, isPreviewableImageUrl, type ImagePreviewList } from './src/htmlImages';
import { clearCookieUrls } from './src/cookieCleanup';
import { shouldOpenLoginWebViewUrl } from './src/loginWebViewNavigation';
import { NODESEEK_URL, YAOHUO_URL } from './src/appUrls';
import { feedSources, shouldUseReadingFilter } from './src/feedCategoryRail';
import { normalizeTrackedKeywords, type NormalizedTopicListStateInput } from './src/topicListItemState';
import {
  contentWidthValue,
  createStyles,
  createTheme,
  fontFamilyValue,
  lineHeightMultiplier
} from './src/theme';
import {
  applyFeedFilter,
  mergeCategories,
  mergeReplies,
  mergeSettledFeedResponses,
  mergeTopics,
  searchLocal,
  sortTopicsByCreatedAt,
  type LibraryTab,
  type ReadingFilter,
  type SearchSort
} from './src/feedLogic';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isNodeSeekCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  sourceLabel,
  startAbortableRequest
} from './src/appUtils';
import {
  checkYaohuoLoginDirect,
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from './src/yaohuoApi';
import type { Fetcher } from './src/request';
import { filterRepliesByQuery } from './src/androidFeatureHelpers';
import { NavBar } from './src/components/NavBar';
import { ImagePreviewModal } from './src/components/ImagePreviewModal';
import { FeedScreen } from './src/screens/FeedScreen';
import { NODESEEK_LOGIN_PROBE_SCRIPT, LINUXDO_WEBVIEW_PROBE_SCRIPT, MemoizedMoreScreen } from './src/screens/MoreScreen';
import { TopicScreen, type TopicListItem } from './src/screens/TopicScreen';
import type { HealthDetail, HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles, LoginNavigationRequest, ReplyFilter, Screen, YaohuoReplyTarget } from './src/appTypes';
import { LibraryScreen, type LibraryUndo } from './src/screens/LibraryScreen';
import { SearchScreen, type SearchGroup, type SearchScope } from './src/screens/SearchScreen';
import { UserScreen } from './src/screens/UserScreen';

type NodeSeekBrowserFetchRequest = {
  id: number;
  url: string;
  cookie?: string;
  userAgent?: string;
};
type PendingNodeSeekBrowserFetchRequest = NodeSeekBrowserFetchRequest & {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abortSignal?: AbortSignal;
  abortHandler?: () => void;
};

function isNodeSeekLoginRequiredError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { source?: unknown }).source === 'nodeseek'
    && (error as { loginRequired?: unknown }).loginRequired
  );
}
function isNodeSeekRequestUrl(input: string) {
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
  } catch {
    return false;
  }
}
function requestHeaderValue(headers: HeadersInit | undefined, name: string) {
  const target = name.toLowerCase();
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) || undefined;
  }
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === target);
    return pair ? String(pair[1]) : undefined;
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
  return typeof value === 'string' ? value : undefined;
}

function nodeSeekBrowserResponse(html: string, challenge: boolean) {
  const status = challenge ? 403 : 200;
  const headerValues: Record<string, string> = {
    'content-type': 'text/html'
  };
  if (challenge) {
    headerValues['cf-mitigated'] = 'challenge';
  }
  if (typeof Response !== 'undefined') {
    return new Response(html, {
      status,
      headers: headerValues
    });
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headerValues[name.toLowerCase()] || null
    },
    text: () => Promise.resolve(html)
  } as Response;
}

function cleanupNodeSeekBrowserFetchRequest(request: PendingNodeSeekBrowserFetchRequest) {
  if (request.timeout) {
    clearTimeout(request.timeout);
    request.timeout = undefined;
  }
  if (request.abortSignal && request.abortHandler) {
    request.abortSignal.removeEventListener('abort', request.abortHandler);
  }
}

const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_LOGIN_HOSTS = ['nodeseek.com', 'challenges.cloudflare.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const PROGRESS_SAVE_DEBOUNCE_MS = 650;
const PROGRESS_SAVE_MAX_PENDING_MS = 2000;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL, 'https://www.yaohuo.me'];
const YAOHUO_LOGIN_HOSTS = ['yaohuo.me'];
const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com'];
const LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS = 5000;
const LINUXDO_CLEARANCE_DETECT_INTERVAL_MS = 500;
const YAOHUO_DEFAULT_CLASS_ID = '177';
const COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';

const NODESEEK_BROWSER_FETCH_SCRIPT = `
(() => {
  const requestId = __NODESEEK_BROWSER_FETCH_ID__;
  const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;
  const isChallengePage = () => {
    const challengeText = [document.title || "", document.documentElement?.innerHTML || ""].join(" ");
    return challengePattern.test(challengeText) || Boolean(document.querySelector(".cf-turnstile, [name='cf-turnstile-response'], script[src*='challenge-platform']"));
  };
  const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content"));
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
  };
  const deadline = Date.now() + 8000;
  const waitForReadablePage = () => {
    if ((!isChallengePage() && hasReadableContent()) || Date.now() >= deadline) {
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

function searchHistoryFromRaw(raw: string | null) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function safeFileName(value: string, extension: string) {
  const clean = value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return `${clean || 'forum-reader'}-${Date.now()}.${extension}`;
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const yaohuoWebViewRef = useRef<WebView>(null);
  const linuxDoWebViewRef = useRef<WebView>(null);
  const nodeSeekBrowserWebViewRef = useRef<WebView>(null);
  const webLoginDetectedRef = useRef(false);
  const saveQueueRef = useRef(Promise.resolve());
  const feedRequestIdRef = useRef(0);
  const feedLoadingRef = useRef(false);
  const feedAbortRef = useRef<AbortController | null>(null);
  const categoriesAbortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const topicRequestIdRef = useRef(0);
  const topicAbortRef = useRef<AbortController | null>(null);
  const userRequestIdRef = useRef(0);
  const userAbortRef = useRef<AbortController | null>(null);
  const backupAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const actionAbortRef = useRef<AbortController | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressMaxSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topicScrollRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<{ topic: Topic; percent: number; scrollY: number } | null>(null);
  const loadingMoreRepliesRef = useRef(false);
  const repliesAbortRef = useRef<AbortController | null>(null);
  const repliesRequestIdRef = useRef(0);
  const currentTopicKeyRef = useRef<string | null>(null);
  const quotedReplyAbortRefs = useRef<Record<string, AbortController>>({});
  const topicScrollRef = useRef<FlatList<TopicListItem>>(null);
  const topicReturnScreenRef = useRef<Exclude<Screen, 'topic'>>('feed');
  const userReturnScreenRef = useRef<Exclude<Screen, 'user'>>('feed');
  const pendingLinuxDoTopicRef = useRef<Topic | null>(null);
  const nodeSeekWebViewCookieHeaderRef = useRef('');
  const nodeSeekWebViewUserAgentRef = useRef(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const nodeSeekBrowserFetchIdRef = useRef(0);
  const nodeSeekBrowserFetchCurrentRef = useRef<PendingNodeSeekBrowserFetchRequest | null>(null);
  const nodeSeekBrowserFetchQueueRef = useRef<PendingNodeSeekBrowserFetchRequest[]>([]);
  const rejectNodeSeekBrowserFetchRef = useRef<((request: PendingNodeSeekBrowserFetchRequest, message: string) => void) | null>(null);
  const linuxDoWebViewCookieHeaderRef = useRef('');
  const linuxDoWebViewUserAgentRef = useRef(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const { width, height } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [loadingYaohuoLoginPage, setLoadingYaohuoLoginPage] = useState(true);
  const [loadingLinuxDoPage, setLoadingLinuxDoPage] = useState(true);
  const [linuxDoWebViewError, setLinuxDoWebViewError] = useState('');
  const [linuxDoWebViewKey, setLinuxDoWebViewKey] = useState(0);
  const [linuxDoWebViewUserAgent, setLinuxDoWebViewUserAgent] = useState(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const [linuxDoWebViewCookieHeader, setLinuxDoWebViewCookieHeader] = useState('');
  const [checking, setChecking] = useState(false);
  const [feedBusy, setFeedBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [topicBusy, setTopicBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [cookieNames, setCookieNames] = useState<string[]>([]);
  const [yaohuoCookieNames, setYaohuoCookieNames] = useState<string[]>([]);
  const [linuxDoCookieNames, setLinuxDoCookieNames] = useState<string[]>([]);
  const [hasNodeSeekCookie, setHasNodeSeekCookie] = useState(false);
  const [hasNodeSeekLoginCookie, setHasNodeSeekLoginCookie] = useState(false);
  const [hasYaohuoCookie, setHasYaohuoCookie] = useState(false);
  const [hasLinuxDoClearance, setHasLinuxDoClearance] = useState(false);
  const [nodeSeekWebViewUserAgent, setNodeSeekWebViewUserAgent] = useState(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const [nodeSeekBrowserFetchRequest, setNodeSeekBrowserFetchRequest] = useState<NodeSeekBrowserFetchRequest | null>(null);
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
  const [backupJson, setBackupJson] = useState('');
  const [readerData, setReaderData] = useState<ReaderData>(() => createEmptyReaderData());
  const [readerDataLoaded, setReaderDataLoaded] = useState(false);
  const readerDataRef = useRef<ReaderData>(readerData);
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [feedItems, setFeedItems] = useState<Topic[]>([]);
  const [feedPage, setFeedPage] = useState(1);
  const [feedNextCursor, setFeedNextCursor] = useState<string | undefined>();
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [loadingMoreFeed, setLoadingMoreFeed] = useState(false);
  const [readingFilter, setReadingFilter] = useState<ReadingFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const searchQueryRef = useRef(searchQuery);
  const [searchSource, setSearchSource] = useState<FeedSource>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('remote');
  const runSearchRef = useRef<((sourceOverride?: Source) => Promise<void>) | null>(null);
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance');
  const [searchItems, setSearchItems] = useState<Topic[]>([]);
  const [searchGroups, setSearchGroups] = useState<SearchGroup[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentSearchesLoaded, setRecentSearchesLoaded] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const [libraryUndo, setLibraryUndo] = useState<LibraryUndo>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicError, setTopicError] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userError, setUserError] = useState('');
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [unreadReplyCount, setUnreadReplyCount] = useState(0);
  const [replyComposerOpen, setReplyComposerOpen] = useState(false);
  const [yaohuoReplyTarget, setYaohuoReplyTarget] = useState<YaohuoReplyTarget | null>(null);
  const [loadingMoreReplies, setLoadingMoreReplies] = useState(false);
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [loadedQuotedReplies, setLoadedQuotedReplies] = useState<Record<number, Reply>>({});
  const [loadingQuotedFloors, setLoadingQuotedFloors] = useState<Record<string, boolean>>({});
  const expandedQuotesRef = useRef(expandedQuotes);
  const loadedQuotedRepliesRef = useRef(loadedQuotedReplies);
  const loadingQuotedFloorsRef = useRef(loadingQuotedFloors);
  const [quoteStateVersion, setQuoteStateVersion] = useState(0);
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const [showYaohuoLoginPanel, setShowYaohuoLoginPanel] = useState(false);
  const [showLinuxDoPanel, setShowLinuxDoPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [healthSummary, setHealthSummary] = useState('');
  const [healthDetails, setHealthDetails] = useState<HealthDetail[]>([]);
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  readerDataRef.current = readerData;
  const searchGroupsRef = useRef<SearchGroup[]>(searchGroups);
  searchGroupsRef.current = searchGroups;
  const currentTopic = topicDetail || selectedTopic;
  currentTopicKeyRef.current = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;
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

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
      .then((raw) => {
        if (active) {
          setRecentSearches(searchHistoryFromRaw(raw));
          setRecentSearchesLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setRecentSearchesLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!recentSearchesLoaded) {
      return;
    }
    void AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(recentSearches)).catch(() => undefined);
  }, [recentSearches, recentSearchesLoaded]);

  const addRecentSearch = useCallback((query: string) => {
    const clean = query.trim();
    if (!clean) {
      return;
    }
    setRecentSearches((current) => {
      const next = [
        clean,
        ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())
      ].slice(0, 20);
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== query);
      return next;
    });
  }, []);

  const theme = useMemo(() => createTheme(readerData.settings), [readerData.settings]);
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
      borderColor: theme.line
    },
    th: {
      color: theme.ink,
      backgroundColor: theme.surface2,
      borderColor: theme.line
    },
    td: {
      color: theme.ink,
      borderColor: theme.line
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

  const loginState = useMemo(() => {
    if (webLoginUserId) {
      return `网页已确认登录：用户 ${webLoginUserId}`;
    }
    if (!hasNodeSeekCookie && cookieNames.length === 0) {
      return '未检测到 NodeSeek 验证信息';
    }
    if (hasNodeSeekLoginCookie) {
      return cookieNames.length === 0 ? '已保存 NodeSeek 登录 Cookie' : `已检测登录 Cookie：${cookieNames.join(', ')}`;
    }
    if (cookieNames.length === 0) {
      return '已保存 NodeSeek 验证信息';
    }
    return `已检测验证 Cookie：${cookieNames.join(', ')}`;
  }, [cookieNames, hasNodeSeekCookie, hasNodeSeekLoginCookie, webLoginUserId]);

  const yaohuoLoginState = useMemo(() => {
    if (!hasYaohuoCookie && yaohuoCookieNames.length === 0) {
      return '未检测到登录 Cookie';
    }
    if (yaohuoCookieNames.length === 0) {
      return '已保存妖火 Cookie';
    }
    return `已检测 ${yaohuoCookieNames.length} 个 Cookie：${yaohuoCookieNames.join(', ')}`;
  }, [hasYaohuoCookie, yaohuoCookieNames]);

  const shownFeedItems = useMemo(
    () => applyFeedFilter(feedItems, readerData, shouldUseReadingFilter(feedSource) ? readingFilter : 'all'),
    [feedItems, feedSource, readerData, readingFilter]
  );
  const libraryRecords = useMemo(
    () => sortedRecords(libraryTab === 'history' ? readerData.history : readerData.favorites),
    [libraryTab, readerData.favorites, readerData.history]
  );
  const followedUserRecords = useMemo<FollowedUserRecord[]>(
    () => Object.values(readerData.followedUsers).sort((left, right) => Date.parse(right.followedAt) - Date.parse(left.followedAt)),
    [readerData.followedUsers]
  );
  const currentUserFollowed = Boolean((userProfile || selectedUser) && isUserFollowed(readerData, (userProfile || selectedUser) as UserProfile));
  const visibleSearchItems = useMemo(() => searchItems, [searchItems]);
  const filteredReplies = useMemo(() => {
    let base = topicReplies;
    if (replyFilter === 'author') {
      base = topicDetail ? topicReplies.filter((reply) => reply.author === topicDetail.author) : topicReplies;
    } else if (replyFilter === 'images') {
      base = topicReplies.filter((reply) => extractImageUrlsFromHtml(reply.contentHtml).length > 0);
    } else if (replyFilter === 'newest') {
      base = [...topicReplies].reverse();
    }
    return filterRepliesByQuery(base, commentQuery);
  }, [commentQuery, replyFilter, topicDetail, topicReplies]);
  const topicHtmlParts = useMemo(() => [
    topicDetail?.contentHtml || '',
    ...topicReplies.map((reply) => reply.contentHtml || ''),
    ...Object.values(loadedQuotedReplies).map((reply) => reply.contentHtml || '')
  ].filter(Boolean), [loadedQuotedReplies, topicDetail?.contentHtml, topicReplies]);
  const topicHtmlPartsRef = useRef<string[]>(topicHtmlParts);
  topicHtmlPartsRef.current = topicHtmlParts;
  const openImagePreview = useCallback((url: string) => {
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
  const notify = useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
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
      if (isInlineForumImage(props.tnode.attributes)) {
        return <Text style={styles.inlineForumImageText}>{props.tnode.attributes.alt || props.tnode.attributes.title || ''}</Text>;
      }
      return (
        <IMGElement
          {...imageProps}
          source={imageSourceFromUrl(src, imageProps.source)}
          onPress={(event) => {
            event.stopPropagation?.();
            openImagePreview(src);
          }}
        />
      );
    };
    const InlineForumImageRenderer: CustomMixedRenderer = (props) => {
      const attributes = ((props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {});
      const src = attributes.src || '';
      const label = attributes.alt || attributes.title || '';
      if (!src || isInlineForumImage(attributes)) {
        return <Text style={styles.inlineForumImageText}>{label}</Text>;
      }
      return (
        <Text
          onPress={isPreviewableImageUrl(src) ? () => openImagePreview(src) : undefined}
          style={styles.inlineForumImageText}
        >
          <Image
            source={imageSourceFromUrl(src)}
            style={styles.inlineForumImage}
          />
        </Text>
      );
    };
    return { img: PreviewImageRenderer, [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer };
  }, [openImagePreview, styles.inlineForumImage, styles.inlineForumImageText]);
  const htmlRenderersProps = useMemo<HtmlRenderersProps>(() => ({
    a: {
      onPress: (event, href) => {
        if (isPreviewableImageUrl(href)) {
          event.stopPropagation?.();
          openImagePreview(href);
          return;
        }
        openExternalUrl(href);
      }
    },
    img: {
      enableExperimentalPercentWidth: true
    }
  }), [openExternalUrl, openImagePreview]);

  useEffect(() => () => {
    feedAbortRef.current?.abort();
    categoriesAbortRef.current?.abort();
    searchAbortRef.current?.abort();
    topicAbortRef.current?.abort();
    userAbortRef.current?.abort();
    repliesAbortRef.current?.abort();
    backupAbortRef.current?.abort();
    statusAbortRef.current?.abort();
    actionAbortRef.current?.abort();
    clearTopicScrollRestoreTimer();
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }
    if (progressMaxSaveTimerRef.current) {
      clearTimeout(progressMaxSaveTimerRef.current);
    }
  }, [clearTopicScrollRestoreTimer]);

  const persistReaderData = useCallback((next: ReaderData) => {
    readerDataRef.current = next;
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => saveReaderData(next))
      .then((saved) => {
        setReaderData((latest) => {
          if (latest !== next) {
            return latest;
          }
          readerDataRef.current = saved;
          return saved;
        });
      })
      .catch((error) => notify(errorMessage(error)));
    return saveQueueRef.current;
  }, [notify]);

  const commitReaderData = useCallback((updater: (current: ReaderData) => ReaderData) => {
    const next = sanitizeReaderData(updater(readerDataRef.current));
    setReaderData(next);
    void persistReaderData(next);
  }, [persistReaderData]);

  const replaceReaderData = useCallback((nextValue: ReaderData) => {
    const next = sanitizeReaderData(nextValue);
    setReaderData(next);
    return persistReaderData(next);
  }, [persistReaderData]);

  const flushPendingProgress = useCallback(() => {
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    if (progressMaxSaveTimerRef.current) {
      clearTimeout(progressMaxSaveTimerRef.current);
      progressMaxSaveTimerRef.current = null;
    }
    const pending = pendingProgressRef.current;
    pendingProgressRef.current = null;
    if (!pending) {
      return;
    }
    const next = updateProgress(readerDataRef.current, pending.topic, {
      percent: pending.percent,
      scrollY: pending.scrollY
    });
    setReaderData(next);
    void persistReaderData(next);
  }, [persistReaderData]);
  const topicListStateInput = useMemo<NormalizedTopicListStateInput>(() => ({
    trackedKeywords: normalizeTrackedKeywords(readerData.settings.trackedKeywords)
  }), [readerData.settings.trackedKeywords]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        flushPendingProgress();
      }
    });
    return () => subscription.remove();
  }, [flushPendingProgress]);

  useEffect(() => {
    void (async () => {
      const [savedReaderData, savedCookie, savedNodeSeekUserAgent, savedYaohuoCookie, linuxDoAccess] = await Promise.all([
        loadReaderData(),
        SecureStore.getItemAsync(COOKIE_STORAGE_KEY),
        SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY),
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        loadLinuxDoAccess()
      ]);
      setReaderData(savedReaderData);
      if (savedNodeSeekUserAgent) {
        const userAgent = sanitizeNodeSeekUserAgent(savedNodeSeekUserAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (savedCookie) {
        const summary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie));
        setHasNodeSeekCookie(true);
        setHasNodeSeekLoginCookie(summary.loggedIn);
        setCookieNames(summary.names);
        notify(summary.loggedIn ? '已找到本机保存的 NodeSeek 登录 Cookie。' : '已找到本机保存的 NodeSeek 验证信息。');
      }
      if (savedYaohuoCookie) {
        setHasYaohuoCookie(true);
        notify('已找到本机保存的妖火 Cookie。');
      }
      setHasLinuxDoClearance(Boolean(linuxDoAccess?.cookieHeader));
      if (linuxDoAccess?.cookieHeader) {
        setLinuxDoCookieNames(['cf_clearance']);
      }
      if (linuxDoAccess?.userAgent) {
        const userAgent = sanitizeLinuxDoUserAgent(linuxDoAccess.userAgent);
        if (userAgent) {
          linuxDoWebViewUserAgentRef.current = userAgent;
          setLinuxDoWebViewUserAgent(userAgent);
        }
      }
    })()
      .catch((error) => notify(errorMessage(error)))
      .finally(() => setReaderDataLoaded(true));
  }, [notify]);

  const loadYaohuoCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'yaohuo') {
      return undefined;
    }
    const cookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    setHasYaohuoCookie(Boolean(cookie));
    return cookie || undefined;
  }, []);

  const saveNodeSeekCookieHeader = useCallback(async (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    { verifiedByPage = false }: { verifiedByPage?: boolean } = {}
  ) => {
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = buildCookieHeader(cookies);
    setCookieNames(summary.names);
    setHasNodeSeekLoginCookie(summary.loggedIn);
    if (canStoreNodeSeekCookieHeader(cookies, verifiedByPage) && cookieHeader) {
      await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, cookieHeader);
      await SecureStore.setItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY, nodeSeekWebViewUserAgentRef.current || DEFAULT_NODESEEK_ANDROID_USER_AGENT);
      setHasNodeSeekCookie(true);
      return cookieHeader;
    }
    return '';
  }, []);

  const loadNodeSeekCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'nodeseek') {
      return undefined;
    }
    const cookies = await readNodeSeekCookiesFromWebView();
    const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
    const webViewCookieHeader = await saveNodeSeekCookieHeader(mergeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie || ''), cookies));
    if (webViewCookieHeader) {
      return webViewCookieHeader;
    }
    if (savedCookie) {
      const savedCookies = parseNodeSeekDocumentCookie(savedCookie);
      const summary = summarizeNodeSeekCookies(savedCookies);
      setCookieNames(summary.names);
      setHasNodeSeekCookie(true);
      setHasNodeSeekLoginCookie(summary.loggedIn);
      return savedCookie;
    }
    setHasNodeSeekCookie(false);
    setHasNodeSeekLoginCookie(false);
    return undefined;
  }, [saveNodeSeekCookieHeader]);

  const startNextNodeSeekBrowserFetch = useCallback(() => {
    if (nodeSeekBrowserFetchCurrentRef.current) {
      return;
    }
    let next: PendingNodeSeekBrowserFetchRequest | null = null;
    while (nodeSeekBrowserFetchQueueRef.current.length) {
      const candidate = nodeSeekBrowserFetchQueueRef.current.shift() || null;
      if (!candidate) {
        continue;
      }
      if (candidate.abortSignal?.aborted) {
        cleanupNodeSeekBrowserFetchRequest(candidate);
        candidate.reject(new Error('请求已取消'));
        continue;
      }
      next = candidate;
      break;
    }
    if (next) {
      next.timeout = setTimeout(() => {
        rejectNodeSeekBrowserFetchRef.current?.(next, 'NodeSeek 页面读取超时');
      }, NODESEEK_BROWSER_FETCH_TIMEOUT_MS);
    }
    nodeSeekBrowserFetchCurrentRef.current = next;
    setNodeSeekBrowserFetchRequest(next ? {
      id: next.id,
      url: next.url,
      cookie: next.cookie,
      userAgent: next.userAgent
    } : null);
  }, []);

  const rejectNodeSeekBrowserFetch = useCallback((request: PendingNodeSeekBrowserFetchRequest, message: string) => {
    const queuedIndex = nodeSeekBrowserFetchQueueRef.current.findIndex((item) => item.id === request.id);
    if (queuedIndex >= 0) {
      nodeSeekBrowserFetchQueueRef.current.splice(queuedIndex, 1);
    }
    if (nodeSeekBrowserFetchCurrentRef.current?.id === request.id) {
      nodeSeekBrowserWebViewRef.current?.stopLoading();
      nodeSeekBrowserFetchCurrentRef.current = null;
      setNodeSeekBrowserFetchRequest(null);
    }
    cleanupNodeSeekBrowserFetchRequest(request);
    request.reject(new Error(message));
    startNextNodeSeekBrowserFetch();
  }, [startNextNodeSeekBrowserFetch]);
  rejectNodeSeekBrowserFetchRef.current = rejectNodeSeekBrowserFetch;

  const nodeSeekFetchWithWebView: Fetcher = useCallback((input, init) => {
    const url = String(input);
    if (!isNodeSeekRequestUrl(url)) {
      return fetch(input, init);
    }
    return new Promise<Response>((resolve, reject) => {
      let request: PendingNodeSeekBrowserFetchRequest;
      const id = ++nodeSeekBrowserFetchIdRef.current;
      const cookie = requestHeaderValue(init?.headers, 'cookie');
      const userAgent = requestHeaderValue(init?.headers, 'User-Agent');
      request = {
        id,
        url,
        cookie,
        userAgent,
        resolve,
        reject,
        abortSignal: init?.signal || undefined
      };
      request.abortHandler = () => {
        rejectNodeSeekBrowserFetch(request, '请求已取消');
      };
      if (request.abortSignal) {
        if (request.abortSignal.aborted) {
          rejectNodeSeekBrowserFetch(request, '请求已取消');
          return;
        }
        request.abortSignal.addEventListener('abort', request.abortHandler, { once: true });
      }
      nodeSeekBrowserFetchQueueRef.current.push(request);
      startNextNodeSeekBrowserFetch();
    });
  }, [rejectNodeSeekBrowserFetch, startNextNodeSeekBrowserFetch]);

  const completeNodeSeekBrowserFetch = useCallback((data: {
    id?: number;
    html?: string;
    cookie?: string;
    userAgent?: string;
    challenge?: boolean;
  }) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (!current || data.id !== current.id) {
      return;
    }
    cleanupNodeSeekBrowserFetchRequest(current);
    nodeSeekBrowserFetchCurrentRef.current = null;
    setNodeSeekBrowserFetchRequest(null);
    const userAgent = sanitizeNodeSeekUserAgent(data.userAgent);
    if (userAgent) {
      nodeSeekWebViewUserAgentRef.current = userAgent;
      setNodeSeekWebViewUserAgent(userAgent);
    }
    if (typeof data.cookie === 'string') {
      nodeSeekWebViewCookieHeaderRef.current = data.cookie;
      void CookieManager.flush().then(async () => {
        const nativeCookies = await readNodeSeekCookiesFromWebView();
        await saveNodeSeekCookieHeader(mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(data.cookie || '')));
      }).catch(() => undefined);
    }
    current.resolve(nodeSeekBrowserResponse(data.html || '', Boolean(data.challenge)));
    startNextNodeSeekBrowserFetch();
  }, [saveNodeSeekCookieHeader, startNextNodeSeekBrowserFetch]);

  const failNodeSeekBrowserFetchById = useCallback((requestId: number, message: string) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (current?.id === requestId) {
      rejectNodeSeekBrowserFetch(current, message);
    }
  }, [rejectNodeSeekBrowserFetch]);

  const showYaohuoLogin = useCallback((message = '请先登录妖火。') => {
    setScreen('more');
    setShowYaohuoLoginPanel(true);
    notify(message);
  }, [notify]);

  const showNodeSeekVerification = useCallback((message = 'NodeSeek 需要完成 Cloudflare 验证') => {
    setScreen('more');
    setShowLoginPanel(true);
    setShowYaohuoLoginPanel(false);
    setShowLinuxDoPanel(false);
    setShowSettingsPanel(false);
    setHasNodeSeekCookie(false);
    setHasNodeSeekLoginCookie(false);
    notify(message);
  }, [notify]);

  const resetLinuxDoWebView = useCallback(() => {
    linuxDoWebViewRef.current?.stopLoading();
    linuxDoWebViewCookieHeaderRef.current = '';
    setLinuxDoWebViewCookieHeader('');
    setLoadingLinuxDoPage(true);
    setLinuxDoWebViewError('');
    setLinuxDoWebViewKey((current) => current + 1);
  }, []);

  const closeLinuxDoPanel = useCallback(() => {
    linuxDoWebViewRef.current?.stopLoading();
    pendingLinuxDoTopicRef.current = null;
    setShowLinuxDoPanel(false);
    setLoadingLinuxDoPage(false);
  }, []);

  const changeLinuxDoPanel = useCallback((visible: boolean) => {
    if (visible) {
      setShowLinuxDoPanel(true);
      resetLinuxDoWebView();
      return;
    }
    closeLinuxDoPanel();
  }, [closeLinuxDoPanel, resetLinuxDoWebView]);

  const closeMorePanels = useCallback(() => {
    setShowLoginPanel(false);
    setShowYaohuoLoginPanel(false);
    closeLinuxDoPanel();
    setShowSettingsPanel(false);
  }, [closeLinuxDoPanel]);

  const showLinuxDoVerification = useCallback((message = 'linux.do 需要完成 Cloudflare 验证') => {
    setScreen('more');
    setShowLoginPanel(false);
    setShowYaohuoLoginPanel(false);
    setShowSettingsPanel(false);
    changeLinuxDoPanel(true);
    setHasLinuxDoClearance(false);
    notify(message);
  }, [changeLinuxDoPanel, notify]);

  const clearStoredYaohuoLoginState = useCallback(async () => {
    await SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    setHasYaohuoCookie(false);
    setYaohuoCookieNames([]);
  }, []);

  const clearStoredNodeSeekLoginState = useCallback(async () => {
    await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY);
    await SecureStore.deleteItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY);
    webLoginDetectedRef.current = false;
    nodeSeekWebViewCookieHeaderRef.current = '';
    setHasNodeSeekCookie(false);
    setHasNodeSeekLoginCookie(false);
    setCookieNames([]);
    setWebLoginUserId(null);
    nodeSeekWebViewUserAgentRef.current = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
    setNodeSeekWebViewUserAgent(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  }, []);

  const clearYaohuoLoginState = useCallback(async () => {
    await clearStoredYaohuoLoginState();
    await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);
  }, [clearStoredYaohuoLoginState]);

  const clearNodeSeekLoginState = useCallback(async () => {
    await clearStoredNodeSeekLoginState();
    await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
  }, [clearStoredNodeSeekLoginState]);

  const clearNodeSeekLoginCookiesOnly = useCallback(async () => {
    const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
    const verificationCookies = removeNodeSeekLoginCookies(parseNodeSeekDocumentCookie(cookieHeader || ''));
    const verificationHeader = buildCookieHeader(verificationCookies);
    webLoginDetectedRef.current = false;
    setWebLoginUserId(null);
    setHasNodeSeekLoginCookie(false);
    if (canStoreNodeSeekCookieHeader(verificationCookies) && verificationHeader) {
      await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, verificationHeader);
      nodeSeekWebViewCookieHeaderRef.current = verificationHeader;
      await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
      setHasNodeSeekCookie(true);
      setCookieNames(summarizeNodeSeekCookies(verificationCookies).names);
      return;
    }
    await clearNodeSeekLoginState();
  }, [clearNodeSeekLoginState]);

  const loadCategories = useCallback(async () => {
    const controller = startAbortableRequest(categoriesAbortRef);
    try {
      const nodeSeekCookie = await loadNodeSeekCookieForSource('nodeseek');
      const data = await getCategories({
        source: 'all',
        nocache: true,
        fetcher: nodeSeekFetchWithWebView,
        nodeSeekCookie,
        nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
        signal: controller.signal
      });
      setCategories(mergeCategories(data.items, []));
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
        if (errors.some(([sourceName, message]) => sourceName === 'nodeseek' && /Cloudflare|验证/.test(message))) {
          showNodeSeekVerification(data.errors.nodeseek || 'NodeSeek 需要完成 Cloudflare 验证');
          return;
        }
        notify(errors.map(([source, message]) => `${sourceLabel(source as Source)}：${message}`).join('；'));
      }
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      finishAbortableRequest(categoriesAbortRef, controller);
    }
  }, [loadNodeSeekCookieForSource, nodeSeekFetchWithWebView, notify, showNodeSeekVerification]);

  const loadFeed = useCallback(async ({
    page = 1,
    cursor,
    reset = false,
    source = feedSource,
    category = categoryFilter,
    nocache = false,
    clearItems = reset && !nocache,
    successMessage
  }: {
    page?: number;
    cursor?: string;
    reset?: boolean;
    source?: FeedSource;
    category?: string;
    nocache?: boolean;
    clearItems?: boolean;
    successMessage?: string;
  } = {}) => {
    if (feedLoadingRef.current && !reset) {
      return;
    }
    feedLoadingRef.current = true;
    const controller = startAbortableRequest(feedAbortRef);
    const requestId = ++feedRequestIdRef.current;
    const isLoadMore = !reset && page > 1;
    if (!isLoadMore && reset && clearItems) {
      setFeedItems([]);
      setFeedPage(1);
      setFeedNextCursor(undefined);
      setFeedHasMore(false);
    }
    if (isLoadMore) {
      setLoadingMoreFeed(true);
    } else if (nocache) {
      setFeedRefreshing(true);
    }
    setFeedBusy(true);
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(source);
      const nodeSeekCookie = await loadNodeSeekCookieForSource(source);
      if (requestId !== feedRequestIdRef.current) {
        return;
      }
      if (source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      let data: FeedResponse;
      if (source === 'all' && yaohuoCookie) {
        const [baseResult, yaohuoResult] = await Promise.allSettled([
          getFeed({
            source,
            page,
            cursor,
            limit: 30,
            category: category || undefined,
            nocache,
            fetcher: nodeSeekFetchWithWebView,
            nodeSeekCookie,
            nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
            signal: controller.signal
          }),
          getYaohuoFeedDirect({
            yaohuoCookie,
            page,
            limit: 30,
            signal: controller.signal
          })
        ]);
        data = mergeSettledFeedResponses(baseResult, yaohuoResult);
      } else if (source === 'yaohuo') {
        data = await getYaohuoFeedDirect({
          yaohuoCookie,
          page,
          limit: 30,
          category: category || undefined,
          signal: controller.signal
        });
      } else {
        data = await getFeed({
          source,
          page,
          cursor,
          limit: 30,
          category: category || undefined,
          nocache,
          fetcher: nodeSeekFetchWithWebView,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
          signal: controller.signal
        });
      }
      if (requestId !== feedRequestIdRef.current) {
        return;
      }
      setFeedItems((current) => reset ? data.items : mergeTopics(current, data.items));
      setFeedPage(data.nextPage ? data.nextPage - 1 : page);
      setFeedNextCursor(data.nextCursor ?? undefined);
      setFeedHasMore(Boolean(data.hasMore && (data.nextPage || data.nextCursor)));
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
        if (errors.some(([sourceName, message]) => sourceName === 'nodeseek' && /Cloudflare|验证/.test(message))) {
          showNodeSeekVerification(data.errors.nodeseek || 'NodeSeek 需要完成 Cloudflare 验证');
          return;
        }
        notify(errors.map(([sourceName, message]) => `${sourceLabel(sourceName as Source)}：${message}`).join('；'));
      } else if (successMessage) {
        notify(successMessage);
      }
    } catch (error) {
      if (requestId === feedRequestIdRef.current) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(errorMessage(error));
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setFeedBusy(false);
        setFeedRefreshing(false);
        setLoadingMoreFeed(false);
        feedLoadingRef.current = false;
      }
      finishAbortableRequest(feedAbortRef, controller);
    }
  }, [categoryFilter, clearYaohuoLoginState, feedSource, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView, notify, showNodeSeekVerification, showYaohuoLogin]);

  const loadFeedRef = useRef(loadFeed);
  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    if (!readerDataLoaded) {
      return;
    }
    void loadFeedRef.current({ reset: true, page: 1, source: feedSource, category: categoryFilter, nocache: true, clearItems: true });
  }, [categoryFilter, feedSource, readerDataLoaded]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const refreshFeed = useCallback(() => {
    if (feedLoadingRef.current) {
      notify('列表正在更新');
      return;
    }
    notify('正在更新列表');
    void loadFeed({ reset: true, page: 1, nocache: true, successMessage: '列表已更新' });
    void loadCategories();
  }, [loadCategories, loadFeed, notify]);

  useEffect(() => {
    searchRequestIdRef.current += 1;
    searchAbortRef.current?.abort();
    setSearchItems([]);
    setSearchGroups([]);
    setSearchBusy(false);
  }, [searchQuery, searchScope, searchSource]);

  const runRemoteSearchSource = useCallback(async (source: Source, query: string, page: number, signal: AbortSignal, sort: SearchSort = 'relevance'): Promise<SearchGroup> => {
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(source),
        loadNodeSeekCookieForSource(source)
      ]);
      if (source === 'yaohuo' && !yaohuoCookie) {
        return { source, label: sourceLabel(source), items: [], error: '未登录', hasMore: false, nextPage: null };
      }
      const data = source === 'yaohuo'
        ? await searchYaohuoDirect({ query, page, limit: 30, yaohuoCookie, signal })
        : await searchTopics({
          query,
          source,
          page,
          limit: 30,
          fetcher: nodeSeekFetchWithWebView,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
          sort: source === 'v2ex' ? sort : 'relevance',
          signal
        });
      return {
        source,
        label: sourceLabel(source),
        items: data.items,
        error: data.errors?.[source],
        hasMore: Boolean(data.hasMore && data.nextPage),
        nextPage: data.nextPage ?? null
      };
    } catch (error) {
      if (isCanceledRequest(error)) {
        throw error;
      }
      if (source === 'yaohuo' && isYaohuoLoginRequiredError(error)) {
        return { source, label: sourceLabel(source), items: [], error: isYaohuoLoginExpiredError(error) ? '登录已失效' : errorMessage(error), hasMore: false, nextPage: null };
      }
      return { source, label: sourceLabel(source), items: [], error: errorMessage(error), hasMore: false, nextPage: null };
    }
  }, [loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView]);

  const runSearch = useCallback(async (sourceOverride?: Source) => {
    const query = searchQuery.trim();
    if (!query) {
      notify('请输入搜索词');
      return;
    }
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    const activeSources = sourceOverride
      ? [sourceOverride]
      : searchSource === 'all'
        ? feedSources
        : [searchSource as Source];
    const activeSort = searchSource === 'all'
      ? 'time'
      : searchSource === 'v2ex' && searchSort === 'time'
        ? searchSort
        : 'relevance';
    if (sourceOverride) {
      setSearchGroups((current) => current.map((group) => group.source === sourceOverride ? { ...group, loading: true, loadingMore: false, error: undefined } : group));
    } else {
      setSearchItems([]);
      setSearchGroups(searchScope === 'remote'
        ? activeSources.map((source) => ({ source, label: sourceLabel(source), items: [], loading: true }))
        : []);
    }
    setSearchBusy(true);
    try {
      addRecentSearch(query);
      if (searchScope === 'local') {
        if (requestId !== searchRequestIdRef.current) {
          return;
        }
        setSearchItems(searchLocal(readerData, query, searchSource));
        notify('本地搜索完成');
      } else {
        const groups = await Promise.all(activeSources.map((source) => runRemoteSearchSource(source, query, 1, controller.signal, activeSort)));
        if (requestId !== searchRequestIdRef.current) {
          return;
        }
        const nextGroups = sourceOverride
          ? searchGroupsRef.current.map((group) => {
            const updated = groups.find((item) => item.source === group.source);
            return updated ? { ...updated, loading: false } : group;
          })
          : groups.map((group) => ({ ...group, loading: false }));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
        const mergedItems = searchSource === 'all'
          ? sortTopicsByCreatedAt(nextGroups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []))
          : nextGroups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
        setSearchItems(mergedItems);
        const nodeSeekError = nextGroups.find((group) => group.source === 'nodeseek')?.error;
        if (nodeSeekError && /Cloudflare|验证/.test(nodeSeekError)) {
          showNodeSeekVerification(nodeSeekError);
          return;
        }
        const errors = nextGroups.filter((group) => group.error);
        notify(errors.length
          ? errors.map((group) => `${group.label}：${group.error}`).join('；')
          : `搜索完成：${mergedItems.length} 条结果`);
      }
    } catch (error) {
      if (requestId === searchRequestIdRef.current) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(errorMessage(error));
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearchBusy(false);
      }
      finishAbortableRequest(searchAbortRef, controller);
    }
  }, [addRecentSearch, clearYaohuoLoginState, notify, readerData, runRemoteSearchSource, searchQuery, searchScope, searchSort, searchSource, showNodeSeekVerification, showYaohuoLogin]);

  const loadMoreSearchSource = useCallback(async (source: Source, page: number) => {
    const query = searchQuery.trim();
    if (!query || searchScope !== 'remote') {
      return;
    }
    const currentGroup = searchGroupsRef.current.find((group) => group.source === source);
    if (!currentGroup || currentGroup.loading || currentGroup.loadingMore || !currentGroup.hasMore) {
      return;
    }
    const markedGroups = searchGroupsRef.current.map((group) => (
      group.source === source ? { ...group, loadingMore: true, error: undefined } : group
    ));
    searchGroupsRef.current = markedGroups;
    setSearchGroups(markedGroups);
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    setSearchBusy(true);
    try {
      const activeSort = searchSource === 'all'
        ? 'time'
        : searchSource === 'v2ex' && searchSort === 'time'
          ? searchSort
          : 'relevance';
      const data = await runRemoteSearchSource(source, query, page, controller.signal, activeSort);
      if (requestId !== searchRequestIdRef.current) {
        return;
      }
      const nextGroups = searchGroupsRef.current.map((group) => {
        if (group.source !== source) {
          return group;
        }
        const mergedItems = mergeTopics(group.items, data.items);
        return {
          ...data,
          items: mergedItems,
          loading: false,
          loadingMore: false,
          hasMore: Boolean(data.hasMore && data.nextPage && mergedItems.length > group.items.length)
        };
      });
      searchGroupsRef.current = nextGroups;
      setSearchGroups(nextGroups);
      const mergedSearchItems = searchSource === 'all'
        ? sortTopicsByCreatedAt(nextGroups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []))
        : nextGroups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
      setSearchItems(mergedSearchItems);
      const updated = nextGroups.find((group) => group.source === source);
      if (updated?.error && source === 'nodeseek' && /Cloudflare|验证/.test(updated.error)) {
        showNodeSeekVerification(updated.error);
        return;
      }
      notify(updated?.error ? `${updated.label}：${updated.error}` : `${sourceLabel(source)} 已加载更多`);
    } catch (error) {
      if (requestId === searchRequestIdRef.current && !isCanceledRequest(error)) {
        const nextGroups = searchGroupsRef.current.map((group) => (
          group.source === source ? { ...group, loadingMore: false, error: errorMessage(error) } : group
        ));
        searchGroupsRef.current = nextGroups;
        setSearchGroups(nextGroups);
        notify(errorMessage(error));
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearchBusy(false);
      }
      finishAbortableRequest(searchAbortRef, controller);
    }
  }, [notify, runRemoteSearchSource, searchQuery, searchScope, searchSort, searchSource, showNodeSeekVerification]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    runSearchRef.current = runSearch;
  }, [runSearch, searchQuery]);

  useEffect(() => {
    if (searchSource !== 'v2ex' || searchScope !== 'remote') {
      setSearchSort('relevance');
    }
  }, [searchScope, searchSource]);

  useEffect(() => {
    if (!searchQueryRef.current.trim()) {
      return;
    }
    void runSearchRef.current?.();
  }, [searchSource, searchScope, searchSort]);

  const retrySearchSource = useCallback((source: Source) => {
    void runSearch(source);
  }, [runSearch]);

  const changeScreen = useCallback((nextScreen: Screen) => {
    if (screen === 'more' && nextScreen !== 'more') {
      closeMorePanels();
    }
    if (screen === 'topic' && nextScreen !== 'topic') {
      flushPendingProgress();
    }
    if (nextScreen !== 'topic') {
      clearTopicScrollRestoreTimer();
      topicRequestIdRef.current += 1;
      repliesRequestIdRef.current += 1;
      topicAbortRef.current?.abort();
      repliesAbortRef.current?.abort();
      abortQuotedReplyRequests();
      pendingLinuxDoTopicRef.current = null;
      currentTopicKeyRef.current = null;
      loadingMoreRepliesRef.current = false;
      setLoadingMoreReplies(false);
      setTopicBusy(false);
    }
    if (nextScreen !== 'user') {
      userRequestIdRef.current += 1;
      userAbortRef.current?.abort();
      setUserBusy(false);
    }
    setScreen(nextScreen);
  }, [abortQuotedReplyRequests, clearTopicScrollRestoreTimer, closeMorePanels, flushPendingProgress, screen]);

  const openTopic = useCallback(async (topic: Topic, nocache = false) => {
    clearTopicScrollRestoreTimer();
    if (screen !== 'topic') {
      topicReturnScreenRef.current = screen;
    }
    if (pendingLinuxDoTopicRef.current && topicKey(pendingLinuxDoTopicRef.current) !== topicKey(topic)) {
      pendingLinuxDoTopicRef.current = null;
    }
    const requestId = ++topicRequestIdRef.current;
    repliesRequestIdRef.current += 1;
    repliesAbortRef.current?.abort();
    loadingMoreRepliesRef.current = false;
    currentTopicKeyRef.current = topicKey(topic);
    setSelectedTopic(topic);
    setTopicDetail(null);
    setTopicError('');
    setTopicReplies([]);
    setCommentQuery('');
    setUnreadReplyCount(0);
    setReplyHasMore(false);
    setReplyNextPage(null);
    setReplyNextOffset(null);
    setLoadingMoreReplies(false);
    setReplyContent('');
    setReplyComposerOpen(false);
    setYaohuoReplyTarget(null);
    setReplyFilter('all');
    resetQuoteState();
    changeScreen('topic');
    setTopicBusy(true);
    const controller = startAbortableRequest(topicAbortRef);
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(topic.source),
        loadNodeSeekCookieForSource(topic.source)
      ]);
      if (requestId !== topicRequestIdRef.current) {
        return;
      }
      if (topic.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      const detail = topic.source === 'yaohuo'
        ? await getYaohuoTopicDirect({ topic, yaohuoCookie, replyLimit: 30, signal: controller.signal })
        : await getTopic({
          source: topic.source,
          id: topic.id,
          nocache,
          fetcher: nodeSeekFetchWithWebView,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
          signal: controller.signal
        });
      if (requestId !== topicRequestIdRef.current) {
        return;
      }
      const previousReplyCount = readerDataRef.current.history[topicKey(detail)]?.topic.replyCount;
      setUnreadReplyCount(typeof previousReplyCount === 'number' && detail.replyCount > previousReplyCount ? detail.replyCount - previousReplyCount : 0);
      setTopicDetail(detail);
      setTopicReplies(detail.replies || []);
      setReplyHasMore(Boolean(detail.replyHasMore && detail.replyNextPage));
      setReplyNextPage(detail.replyNextPage ?? null);
      setReplyNextOffset(detail.replyNextOffset ?? null);
      commitReaderData((current) => recordHistory(current, detail));
      const progress = readerDataRef.current.progress[topicKey(detail)];
      if (progress?.scrollY) {
        const restoreTopicKey = topicKey(detail);
        topicScrollRestoreTimerRef.current = setTimeout(() => {
          topicScrollRestoreTimerRef.current = null;
          if (currentTopicKeyRef.current !== restoreTopicKey) {
            return;
          }
          topicScrollRef.current?.scrollToOffset({ offset: progress.scrollY, animated: false });
        }, 180);
      }
      if (nocache) {
        notify('主题已更新');
      }
    } catch (error) {
      if (requestId === topicRequestIdRef.current) {
        const message = errorMessage(error);
        setTopicError(message);
        if (isLinuxDoCloudflareError(error)) {
          pendingLinuxDoTopicRef.current = topic;
          setLinuxDoCookieNames([]);
          showLinuxDoVerification(message);
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(message);
        }
      }
    } finally {
      if (requestId === topicRequestIdRef.current) {
        setTopicBusy(false);
      }
      finishAbortableRequest(topicAbortRef, controller);
    }
  }, [changeScreen, clearTopicScrollRestoreTimer, clearYaohuoLoginState, commitReaderData, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView, notify, resetQuoteState, screen, showLinuxDoVerification, showNodeSeekVerification, showYaohuoLogin]);

  const loadMoreReplies = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail || !replyNextPage || loadingMoreRepliesRef.current) {
      return;
    }
    const requestTopicKey = topicKey(detail);
    const requestId = ++repliesRequestIdRef.current;
    loadingMoreRepliesRef.current = true;
    let controller: AbortController | null = null;
    setLoadingMoreReplies(true);
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(detail.source);
      const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);
      if (detail.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      controller = startAbortableRequest(repliesAbortRef);
      const data = detail.source === 'yaohuo'
        ? await getYaohuoRepliesDirect({
          id: detail.id,
          categoryId: detail.categoryId,
          page: replyNextPage,
          limit: 30,
          yaohuoCookie,
          signal: controller.signal
        })
        : await getReplies({
          source: detail.source,
          id: detail.id,
          page: replyNextPage,
          limit: 30,
          offset: replyNextOffset,
          fetcher: nodeSeekFetchWithWebView,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
          signal: controller.signal
        });
      if (currentTopicKeyRef.current !== requestTopicKey || requestId !== repliesRequestIdRef.current) {
        return;
      }
      setTopicReplies((current) => mergeReplies(current, data.items));
      setReplyHasMore(Boolean(data.hasMore && data.nextPage));
      setReplyNextPage(data.nextPage ?? null);
      setReplyNextOffset(data.nextOffset ?? null);
      notify(`已加载 ${data.items.length} 条回复`);
    } catch (error) {
      if (currentTopicKeyRef.current === requestTopicKey && requestId === repliesRequestIdRef.current) {
        if (isYaohuoLoginRequiredError(error)) {
          if (isYaohuoLoginExpiredError(error)) {
            await clearYaohuoLoginState();
            showYaohuoLogin('妖火登录已失效，请重新登录。');
          } else {
            showYaohuoLogin(errorMessage(error));
          }
          return;
        }
        if (isLinuxDoCloudflareError(error)) {
          pendingLinuxDoTopicRef.current = detail;
          setLinuxDoCookieNames([]);
          showLinuxDoVerification(errorMessage(error));
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(errorMessage(error));
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (requestId === repliesRequestIdRef.current) {
        loadingMoreRepliesRef.current = false;
        setLoadingMoreReplies(false);
      }
      if (controller) {
        finishAbortableRequest(repliesAbortRef, controller);
      }
    }
  }, [clearYaohuoLoginState, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView, notify, replyNextOffset, replyNextPage, selectedTopic, showLinuxDoVerification, showNodeSeekVerification, showYaohuoLogin, topicDetail]);

  const refreshTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail) {
      void openTopic(detail, true);
    }
  }, [openTopic, selectedTopic, topicDetail]);

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

  const verifyLinuxDoFromTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source === 'linuxdo') {
      pendingLinuxDoTopicRef.current = detail;
    }
    showLinuxDoVerification();
  }, [selectedTopic, showLinuxDoVerification, topicDetail]);

  const goBackFromTopic = useCallback(() => {
    abortQuotedReplyRequests();
    changeScreen(topicReturnScreenRef.current);
  }, [abortQuotedReplyRequests, changeScreen]);

  const openUser = useCallback(async (user: UserProfile, nocache = false) => {
    if (!user.id && !user.username) {
      notify('用户信息不完整');
      return;
    }
    if (screen !== 'user') {
      userReturnScreenRef.current = screen;
    }
    const requestUser = {
      ...user,
      id: user.id || user.username,
      username: user.username || user.displayName || user.id,
      url: user.url || '',
      topics: user.topics || []
    };
    const requestId = ++userRequestIdRef.current;
    setSelectedUser(requestUser);
    setUserProfile(null);
    setUserError('');
    setUserBusy(true);
    changeScreen('user');
    const controller = startAbortableRequest(userAbortRef);
    try {
      const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
        loadYaohuoCookieForSource(requestUser.source),
        loadNodeSeekCookieForSource(requestUser.source)
      ]);
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      if (requestUser.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        setUserError('请先登录妖火后再查看用户主页');
        return;
      }
      const profile = await getUserProfile({
        source: requestUser.source,
        id: requestUser.id,
        username: requestUser.username,
        fetcher: nodeSeekFetchWithWebView,
        nodeSeekCookie,
        nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
        yaohuoCookie,
        signal: controller.signal
      });
      if (requestId !== userRequestIdRef.current) {
        return;
      }
      setUserProfile(profile);
      if (nocache) {
        notify('用户主页已更新');
      }
    } catch (error) {
      if (requestId === userRequestIdRef.current) {
        const message = errorMessage(error);
        setUserError(message);
        if (isLinuxDoCloudflareError(error)) {
          showLinuxDoVerification(message);
          return;
        }
        if (isNodeSeekCloudflareError(error)) {
          showNodeSeekVerification(message);
          return;
        }
        if (isYaohuoLoginRequiredError(error)) {
          showYaohuoLogin(message);
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(message);
        }
      }
    } finally {
      if (requestId === userRequestIdRef.current) {
        setUserBusy(false);
      }
      finishAbortableRequest(userAbortRef, controller);
    }
  }, [changeScreen, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView, notify, screen, showLinuxDoVerification, showNodeSeekVerification, showYaohuoLogin]);

  const goBackFromUser = useCallback(() => {
    changeScreen(userReturnScreenRef.current);
  }, [changeScreen]);

  const handleTopicScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const detail = topicDetail || selectedTopic;
    if (!detail) {
      return;
    }
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollY = Math.max(0, contentOffset.y);
    const scrollable = Math.max(1, contentSize.height - layoutMeasurement.height);
    const percent = Math.min(100, Math.max(0, Math.round((scrollY / scrollable) * 100)));
    pendingProgressRef.current = { topic: detail, percent, scrollY };
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }
    if (!progressMaxSaveTimerRef.current) {
      progressMaxSaveTimerRef.current = setTimeout(() => {
        flushPendingProgress();
      }, PROGRESS_SAVE_MAX_PENDING_MS);
    }
    progressSaveTimerRef.current = setTimeout(() => {
      flushPendingProgress();
    }, PROGRESS_SAVE_DEBOUNCE_MS);
  }, [flushPendingProgress, selectedTopic, topicDetail]);

  const toggleQuotedFloor = useCallback(async ({
    replyFloor,
    quotedFloor,
    quotedReply
  }: {
    replyFloor: number;
    quotedFloor: number;
    quotedReply?: Reply;
  }) => {
    const key = `${replyFloor}:${quotedFloor}`;
    if (expandedQuotesRef.current[key]) {
      updateExpandedQuotes((current) => ({ ...current, [key]: false }));
      return;
    }

    if (quotedReply || loadedQuotedRepliesRef.current[quotedFloor]) {
      updateExpandedQuotes((current) => ({ ...current, [key]: true }));
      return;
    }

    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'linuxdo') {
      notify('引用楼层未加载');
      updateExpandedQuotes((current) => ({ ...current, [key]: true }));
      return;
    }
    const requestTopicKey = topicKey(detail);

    updateLoadingQuotedFloors((current) => ({ ...current, [key]: true }));
    quotedReplyAbortRefs.current[key]?.abort();
    const controller = new AbortController();
    quotedReplyAbortRefs.current[key] = controller;
    try {
      const loaded = await getReply({
        source: detail.source,
        id: detail.id,
        floor: quotedFloor,
        signal: controller.signal
      });
      if (currentTopicKeyRef.current !== requestTopicKey) {
        return;
      }
      if (loaded.floor) {
        updateLoadedQuotedReplies((current) => ({ ...current, [loaded.floor as number]: loaded }));
      }
      updateExpandedQuotes((current) => ({ ...current, [key]: true }));
      notify(`引用已展开 #${quotedFloor}`);
    } catch (error) {
      if (currentTopicKeyRef.current === requestTopicKey) {
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (quotedReplyAbortRefs.current[key] === controller) {
        delete quotedReplyAbortRefs.current[key];
      }
      if (currentTopicKeyRef.current === requestTopicKey) {
        updateLoadingQuotedFloors((current) => ({ ...current, [key]: false }));
      }
    }
  }, [notify, selectedTopic, topicDetail, updateExpandedQuotes, updateLoadedQuotedReplies, updateLoadingQuotedFloors]);

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

  const handleLoginMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        loggedIn?: boolean;
        userId?: number | null;
        userAgent?: string;
        cookie?: string;
      };
      if (data.type === 'nodeseek-login' && typeof data.userAgent === 'string') {
        const userAgent = sanitizeNodeSeekUserAgent(data.userAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (data.type === 'nodeseek-login' && typeof data.cookie === 'string') {
        nodeSeekWebViewCookieHeaderRef.current = data.cookie;
      }
      if (data.type === 'nodeseek-login' && data.loggedIn && Number.isInteger(data.userId)) {
        webLoginDetectedRef.current = true;
        setWebLoginUserId(data.userId || null);
      } else if (data.type === 'nodeseek-login' && data.loggedIn === false) {
        webLoginDetectedRef.current = false;
        setHasNodeSeekLoginCookie(false);
        setWebLoginUserId(null);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, []);

  const handleLinuxDoMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        userAgent?: string;
        cookie?: string;
      };
      if (data.type === 'linuxdo-webview') {
        setLinuxDoWebViewError('');
      }
      if (data.type === 'linuxdo-webview' && typeof data.userAgent === 'string') {
        const userAgent = sanitizeLinuxDoUserAgent(data.userAgent);
        if (userAgent) {
          linuxDoWebViewUserAgentRef.current = userAgent;
          setLinuxDoWebViewUserAgent(userAgent);
        }
      }
      if (data.type === 'linuxdo-webview' && typeof data.cookie === 'string') {
        linuxDoWebViewCookieHeaderRef.current = data.cookie;
        setLinuxDoWebViewCookieHeader(data.cookie);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, []);

  const probeLoginPage = useCallback(async () => {
    webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, []);

  const readCurrentNodeSeekCookies = useCallback(async () => {
    await probeLoginPage();
    await CookieManager.flush();
    const nativeCookies = await readNodeSeekCookiesFromWebView();
    const nodeSeekDocumentCookieHeader = nodeSeekWebViewCookieHeaderRef.current;
    return mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(nodeSeekDocumentCookieHeader));
  }, [probeLoginPage]);

  const rememberCurrentNodeSeekCookies = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const cookies = await readCurrentNodeSeekCookies();
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = await saveNodeSeekCookieHeader(cookies, { verifiedByPage: webLoginDetectedRef.current });
    if (cookieHeader) {
      if (!silent) {
        notify(summary.loggedIn ? '已检测到 NodeSeek 登录 Cookie，已保存在本机。' : '已检测到 NodeSeek 验证信息，已保存在本机。');
      }
      return true;
    }
    if (!silent) {
      notify('没有检测到明确的 NodeSeek Cookie。请完成验证或登录后再试。');
    }
    return false;
  }, [notify, readCurrentNodeSeekCookies, saveNodeSeekCookieHeader]);

  const probeLinuxDoPage = useCallback(async () => {
    linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, []);

  const checkLogin = useCallback(async () => {
    setChecking(true);
    try {
      await rememberCurrentNodeSeekCookies();
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [notify, rememberCurrentNodeSeekCookies]);

  const checkYaohuoCookie = useCallback(async () => {
    setChecking(true);
    try {
      await CookieManager.flush();
      const cookieMaps = await Promise.all(YAOHUO_COOKIE_URLS.map(async (url) => CookieManager.get(url)));
      const typedCookies = mergeYaohuoCookies(...cookieMaps as Array<Record<string, YaohuoNativeCookie>>);
      const summary = summarizeYaohuoCookies(typedCookies);
      const cookieHeader = buildYaohuoCookieHeader(typedCookies);
      setYaohuoCookieNames(summary.names);
      if (!canStoreYaohuoCookieHeader(typedCookies) || !cookieHeader) {
        notify('没有检测到明确的妖火登录 Cookie。请确认已经登录后再试。');
        return;
      }
      const yaohuoLoginCheck = await checkYaohuoLoginDirect({ yaohuoCookie: cookieHeader });
      if (yaohuoLoginCheck.loginRequired || !yaohuoLoginCheck.ok) {
        if (yaohuoLoginCheck.reason === 'expired') {
          await clearYaohuoLoginState();
        }
        notify(yaohuoLoginCheck.message || '妖火登录已失效，请重新登录。');
        return;
      }
      await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);
      setHasYaohuoCookie(true);
      notify('已检测到妖火登录 Cookie，已保存在本机。');
    } catch (error) {
      if (isYaohuoLoginRequiredError(error)) {
        if (isYaohuoLoginExpiredError(error)) {
          await clearYaohuoLoginState();
          notify('妖火登录已失效，请重新登录。');
        } else {
          notify(errorMessage(error));
        }
        return;
      }
      notify(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [clearYaohuoLoginState, notify]);

  const readCurrentLinuxDoCookies = useCallback(async () => {
    await probeLinuxDoPage();
    const nativeCookies = await readLinuxDoCookiesFromWebView();
    const linuxDoDocumentCookieHeader = linuxDoWebViewCookieHeaderRef.current || linuxDoWebViewCookieHeader;
    return mergeLinuxDoCookies(nativeCookies, parseLinuxDoDocumentCookie(linuxDoDocumentCookieHeader));
  }, [linuxDoWebViewCookieHeader, probeLinuxDoPage]);

  const waitForLinuxDoClearance = useCallback(async () => {
    const deadline = Date.now() + LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS;
    let cookies = await readCurrentLinuxDoCookies();
    while (Date.now() < deadline) {
      if (canStoreLinuxDoClearance(cookies)) {
        return cookies;
      }
      await new Promise((resolve) => setTimeout(resolve, LINUXDO_CLEARANCE_DETECT_INTERVAL_MS));
      cookies = await readCurrentLinuxDoCookies();
    }
    return cookies;
  }, [readCurrentLinuxDoCookies]);

  const checkLinuxDoCookie = useCallback(async () => {
    setChecking(true);
    setLinuxDoWebViewError('');
    try {
      const cookies = await waitForLinuxDoClearance();
      const summary = summarizeLinuxDoCookies(cookies);
      const cookieHeader = buildLinuxDoCookieHeader(cookies);
      setLinuxDoCookieNames(summary.names);
      if (!canStoreLinuxDoClearance(cookies) || !cookieHeader) {
        notify('没有检测到 linux.do 公开访问验证 Cookie。请完成验证后再试。');
        return;
      }
      await saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || linuxDoWebViewUserAgent || undefined);
      setHasLinuxDoClearance(true);
      setLinuxDoWebViewError('');
      notify('linux.do 验证信息已保存在本机。');
      const pendingTopic = pendingLinuxDoTopicRef.current;
      pendingLinuxDoTopicRef.current = null;
      if (pendingTopic) {
        const returnScreen = topicReturnScreenRef.current;
        await openTopic(pendingTopic, true);
        topicReturnScreenRef.current = returnScreen;
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [linuxDoWebViewUserAgent, notify, openTopic, waitForLinuxDoClearance]);

  const clearLogin = useCallback(async () => {
    await clearNodeSeekLoginState();
    notify('已清除本机保存的 NodeSeek Cookie。');
  }, [clearNodeSeekLoginState, notify]);

  const clearYaohuoLogin = useCallback(async () => {
    await clearYaohuoLoginState();
    yaohuoWebViewRef.current?.reload();
    notify('已清除本机保存的妖火 Cookie。');
  }, [clearYaohuoLoginState, notify]);

  const clearLinuxDoCookie = useCallback(async () => {
    await clearLinuxDoAccess();
    setHasLinuxDoClearance(false);
    setLinuxDoCookieNames([]);
    resetLinuxDoWebView();
    notify('已清除本机保存的 linux.do 验证信息。');
  }, [notify, resetLinuxDoWebView]);

  const runNodeSeekRequest = useCallback(async (
    requestFactory: () => NodeSeekActionRequest,
    success: string,
    options: { refreshTopic?: boolean } = {}
  ) => {
    if (!hasNodeSeekLoginCookie) {
      notify('请先在“更多”里登录并检测 NodeSeek Cookie。');
      return false;
    }
    const controller = startAbortableRequest(actionAbortRef);
    setActionBusy(true);
    try {
      const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
      await runNodeSeekAction({
        cookieHeader: cookieHeader || '',
        request: requestFactory(),
        signal: controller.signal
      });
      notify(success);
      if (options.refreshTopic !== false && topicDetail?.source === 'nodeseek') {
        await openTopic(topicDetail, true);
      }
      return true;
    } catch (error) {
      if (isNodeSeekLoginRequiredError(error)) {
        await clearNodeSeekLoginCookiesOnly();
      }
      notify(errorMessage(error));
      return false;
    } finally {
      if (finishAbortableRequest(actionAbortRef, controller)) {
        setActionBusy(false);
      }
    }
  }, [clearNodeSeekLoginCookiesOnly, hasNodeSeekLoginCookie, notify, openTopic, topicDetail]);

  const runYaohuoRequest = useCallback(async (
    requestFactory: (cookieHeader: string) => YaohuoActionRequest,
    success: string,
    options: { refreshTopic?: boolean } = {}
  ) => {
    const cookieHeader = await loadYaohuoCookieForSource('yaohuo');
    if (!cookieHeader) {
      showYaohuoLogin();
      return false;
    }
    const controller = startAbortableRequest(actionAbortRef);
    setActionBusy(true);
    try {
      const result = await runYaohuoAction({
        cookieHeader,
        request: requestFactory(cookieHeader),
        signal: controller.signal
      });
      notify(result.message === '操作已提交' ? success : result.message);
      if (options.refreshTopic !== false && topicDetail?.source === 'yaohuo') {
        await openTopic(topicDetail, true);
      }
      return true;
    } catch (error) {
      if (isYaohuoLoginRequiredError(error)) {
        if (isYaohuoLoginExpiredError(error)) {
          await clearYaohuoLoginState();
        }
        showYaohuoLogin(errorMessage(error));
        return false;
      }
      notify(errorMessage(error));
      return false;
    } finally {
      if (finishAbortableRequest(actionAbortRef, controller)) {
        setActionBusy(false);
      }
    }
  }, [clearYaohuoLoginState, loadYaohuoCookieForSource, notify, openTopic, showYaohuoLogin, topicDetail]);

  const submitReply = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail || (detail.source !== 'nodeseek' && detail.source !== 'yaohuo')) {
      return;
    }
    if (!replyContent.trim()) {
      notify('请输入回复内容');
      return;
    }
    if (detail.source === 'yaohuo') {
      if (yaohuoReplyTarget && !yaohuoReplyTarget.authorId) {
        notify('当前楼层缺少用户 id，刷新主题后再试。');
        return;
      }
      const submitted = await runYaohuoRequest(
        (cookieHeader) => buildYaohuoReplyRequest({
          topicId: detail.id,
          classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
          content: replyContent,
          sid: extractYaohuoSid(cookieHeader),
          replyFloor: yaohuoReplyTarget?.floor,
          toUserId: yaohuoReplyTarget?.authorId
        }),
        '回复已提交'
      );
      if (submitted) {
        setReplyContent('');
        setReplyComposerOpen(false);
        setYaohuoReplyTarget(null);
      }
      return;
    }
    const submitted = await runNodeSeekRequest(
      () => buildNodeSeekReplyRequest({ postId: detail.id, content: replyContent }),
      '回复已提交'
    );
    if (submitted) {
      setReplyContent('');
      setReplyComposerOpen(false);
    }
  }, [notify, replyContent, runNodeSeekRequest, runYaohuoRequest, selectedTopic, topicDetail, yaohuoReplyTarget]);

  const toggleReplyComposer = useCallback((open: boolean) => {
    setReplyComposerOpen(open);
    if (!open) {
      setYaohuoReplyTarget(null);
    }
  }, []);

  const replyToFloor = useCallback((reply: Reply) => {
    if (!reply.floor) {
      notify('当前楼层信息不完整，刷新主题后再试。');
      return;
    }
    setYaohuoReplyTarget({
      floor: reply.floor,
      author: reply.author,
      authorId: reply.authorId
    });
    setReplyComposerOpen(true);
  }, [notify]);

  const checkIn = useCallback(async () => {
    await runNodeSeekRequest(
      () => buildNodeSeekAttendanceRequest({ random: false }),
      '签到请求已提交',
      { refreshTopic: false }
    );
  }, [runNodeSeekRequest]);

  const interact = useCallback(async (type: 'upvote' | 'like', commentId?: number) => {
    if (!commentId) {
      notify('当前内容缺少评论 id，刷新主题后再试。');
      return;
    }
    await runNodeSeekRequest(
      () => buildNodeSeekInteractionRequest({ type, commentId }),
      type === 'upvote' ? '点赞请求已提交' : '加鸡腿请求已提交'
    );
  }, [notify, runNodeSeekRequest]);

  const favoriteOnYaohuoSite = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'yaohuo') {
      return;
    }
    await runYaohuoRequest(
      () => buildYaohuoFavoriteRequest({
        topicId: detail.id,
        classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID
      }),
      '原站收藏已提交',
      { refreshTopic: false }
    );
  }, [runYaohuoRequest, selectedTopic, topicDetail]);

  const voteYaohuo = useCallback(async (voteId: string) => {
    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'yaohuo') {
      return;
    }
    await runYaohuoRequest(
      () => buildYaohuoVoteRequest({
        topicId: detail.id,
        classId: detail.categoryId || YAOHUO_DEFAULT_CLASS_ID,
        voteId
      }),
      '投票已提交'
    );
  }, [runYaohuoRequest, selectedTopic, topicDetail]);

  const importBackup = useCallback(async () => {
    const controller = startAbortableRequest(backupAbortRef);
    setSyncing(true);
    try {
      await saveQueueRef.current.catch(() => undefined);
      if (!backupJson.trim()) {
        notify('请先粘贴备份 JSON');
        return;
      }
      const merged = importReaderBackupJson(readerDataRef.current, backupJson);
      await replaceReaderData(merged);
      notify('备份已恢复，本机资料已合并');
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(backupAbortRef, controller)) {
        setSyncing(false);
      }
    }
  }, [backupJson, notify, replaceReaderData]);

  const exportBackup = useCallback(async () => {
    const controller = startAbortableRequest(backupAbortRef);
    setSyncing(true);
    try {
      await saveQueueRef.current.catch(() => undefined);
      setBackupJson(exportReaderBackupJson(readerDataRef.current));
      notify('备份 JSON 已生成');
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(backupAbortRef, controller)) {
        setSyncing(false);
      }
    }
  }, [notify]);

  const shareTextFile = useCallback(async (fileName: string, content: string, mimeType: string) => {
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      await Clipboard.setStringAsync(content);
      notify('内容已复制');
      return;
    }
    const uri = `${baseDirectory}${fileName}`;
    const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
    try {
      await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType });
      } else {
        await Clipboard.setStringAsync(content);
        notify('内容已复制');
      }
    } finally {
      if (shouldDeleteFile) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    }
  }, [notify]);

  const exportBackupFile = useCallback(async () => {
    try {
      await saveQueueRef.current.catch(() => undefined);
      const content = exportReaderBackupJson(readerDataRef.current);
      setBackupJson(content);
      await shareTextFile(safeFileName('forum-reader-backup', 'json'), content, 'application/json');
      notify('备份文件已生成');
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [notify, shareTextFile]);

  const importBackupFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ['application/json', 'text/json', '*/*']
      });
      if (result.canceled || !result.assets?.[0]?.uri) {
        return;
      }
      const pickedUri = result.assets[0].uri;
      try {
        const content = await FileSystem.readAsStringAsync(pickedUri, { encoding: FileSystem.EncodingType.UTF8 });
        setBackupJson(content);
        const merged = importReaderBackupJson(readerDataRef.current, content);
        await replaceReaderData(merged);
        notify('备份已恢复，本机资料已合并');
      } finally {
        if (FileSystem.cacheDirectory && pickedUri.startsWith(FileSystem.cacheDirectory)) {
          await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);
        }
      }
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [notify, replaceReaderData]);

  const checkLocalStatus = useCallback(async () => {
    const controller = startAbortableRequest(statusAbortRef);
    setStatusBusy(true);
    try {
      const yaohuoCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      const nodeSeekCookie = await loadNodeSeekCookieForSource('nodeseek');
      const linuxDoAccess = await loadLinuxDoAccess();
      setHasLinuxDoClearance(Boolean(linuxDoAccess?.cookieHeader));
      const yaohuoStatusPromise = yaohuoCookie
        ? checkYaohuoLoginDirect({ yaohuoCookie, signal: controller.signal })
        : Promise.resolve({ ok: false, loginRequired: true, message: '未登录' });
      const checks = await Promise.allSettled([
        getFeed({
          source: 'nodeseek',
          limit: 1,
          nocache: true,
          fetcher: nodeSeekFetchWithWebView,
          nodeSeekCookie,
          nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
          signal: controller.signal
        }),
        getFeed({ source: 'v2ex', limit: 1, nocache: true, signal: controller.signal }),
        getFeed({ source: 'linuxdo', limit: 1, nocache: true, signal: controller.signal }),
        yaohuoStatusPromise
      ] as const);
      const yaohuoCheck = checks[3];
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      const yaohuoMessage = yaohuoCheck.status === 'fulfilled'
        ? (yaohuoOk ? '登录可用' : yaohuoCheck.value.message || '未登录')
        : errorMessage(yaohuoCheck.reason);
      const status = {
        nodeseek: checks[0].status === 'fulfilled',
        v2ex: checks[1].status === 'fulfilled',
        linuxdo: checks[2].status === 'fulfilled',
        yaohuo: yaohuoOk
      };
      const access = linuxDoAccessSummary(linuxDoAccess);
      setHealthDetails([
        {
          label: 'NodeSeek',
          ok: status.nodeseek,
          message: checks[0].status === 'fulfilled' ? '列表可读取' : errorMessage(checks[0].reason)
        },
        {
          label: 'V2EX',
          ok: status.v2ex,
          message: checks[1].status === 'fulfilled' ? '列表可读取' : errorMessage(checks[1].reason)
        },
        {
          label: 'linux.do',
          ok: status.linuxdo,
          message: checks[2].status === 'fulfilled' ? '列表可读取' : errorMessage(checks[2].reason)
        },
        {
          label: '妖火',
          ok: status.yaohuo,
          message: yaohuoMessage
        },
        {
          label: 'linux.do 验证',
          ok: access.hasClearance,
          message: access.hasClearance ? `已保存 ${access.savedAt || ''}` : '未保存'
        }
      ]);
      const sourceStatus = feedSources.map((source) => `${sourceLabel(source)} ${status[source] ? '可用' : '不可用'}`).join(' · ');
      const linuxDoText = access.hasClearance ? `linux.do 验证：已保存 ${access.savedAt || ''}` : 'linux.do 验证：未保存';
      setHealthSummary(`${sourceStatus} · ${linuxDoText}`);
      notify('状态已更新');
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(statusAbortRef, controller)) {
        setStatusBusy(false);
      }
    }
  }, [loadNodeSeekCookieForSource, nodeSeekFetchWithWebView, notify]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (imagePreview) {
        closeImagePreview();
        return true;
      }
      if (showLoginPanel) {
        setShowLoginPanel(false);
        return true;
      }
      if (showYaohuoLoginPanel) {
        setShowYaohuoLoginPanel(false);
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
        setYaohuoReplyTarget(null);
        return true;
      }
      if (screen === 'topic') {
        goBackFromTopic();
        return true;
      }
      if (screen === 'user') {
        changeScreen(userReturnScreenRef.current);
        return true;
      }
      if (screen !== 'feed') {
        setScreen('feed');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [
    closeImagePreview,
    changeScreen,
    goBackFromTopic,
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

  const changeFeedSource = useCallback((source: FeedSource) => {
    setFeedItems([]);
    setFeedPage(1);
    setFeedNextCursor(undefined);
    setFeedHasMore(false);
    setFeedSource(source);
    setCategoryFilter('');
  }, []);

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
    const record = readerDataRef.current[section][topicKey(topic)];
    if (record) {
      setLibraryUndo({
        section,
        records: { [topicKey(topic)]: record },
        label: `已删除 1 条${section === 'favorites' ? '收藏' : '历史'}`
      });
    }
    commitReaderData((current) => removeRecords(current, section, [topic]));
  }, [commitReaderData, libraryTab]);

  const removeManyLibraryTopics = useCallback((topics: Topic[]) => {
    const section = libraryTab === 'history' ? 'history' : 'favorites';
    const records = Object.fromEntries(topics
      .map((topic) => [topicKey(topic), readerDataRef.current[section][topicKey(topic)]] as const)
      .filter(([, record]) => Boolean(record))) as Record<string, TopicRecord>;
    if (Object.keys(records).length) {
      setLibraryUndo({
        section,
        records,
        label: `已删除 ${Object.keys(records).length} 条${section === 'favorites' ? '收藏' : '历史'}`
      });
    }
    commitReaderData((current) => removeRecords(current, section, topics));
  }, [commitReaderData, libraryTab]);

  const clearHistory = useCallback(() => {
    const records = readerDataRef.current.history;
    if (!Object.keys(records).length) {
      return;
    }
    setLibraryUndo({
      section: 'history',
      records,
      label: `已清空 ${Object.keys(records).length} 条历史`
    });
    commitReaderData((current) => clearRecords(current, 'history'));
  }, [commitReaderData]);

  const undoLibraryDelete = useCallback(() => {
    if (!libraryUndo) {
      return;
    }
    commitReaderData((current) => restoreRecords(current, libraryUndo.section, libraryUndo.records));
    setLibraryUndo(null);
  }, [commitReaderData, libraryUndo]);

  const updateLibraryRecord = useCallback((topic: Topic, patch: Pick<TopicRecord, 'tags' | 'note'>) => {
    const section = libraryTab === 'history' ? 'history' : 'favorites';
    commitReaderData((current) => updateTopicRecord(current, section, topic, patch));
  }, [commitReaderData, libraryTab]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.screen}>
        <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
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
                failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, `NodeSeek 页面返回错误 ${event.nativeEvent.statusCode}`);
              }}
              onRenderProcessGone={() => {
                failNodeSeekBrowserFetchById(nodeSeekBrowserFetchRequest.id, 'NodeSeek 页面读取进程已停止');
              }}
              renderError={() => <View style={styles.hiddenBrowserWebView} />}
            />
          </View>
        ) : null}
        {screen === 'topic' ? (
          <TopicScreen
            actionBusy={actionBusy}
            canUseNodeSeekActions={hasNodeSeekLoginCookie}
            canUseYaohuoActions={hasYaohuoCookie}
            contentWidth={contentWidth}
            htmlBaseStyle={htmlBaseStyle}
            htmlIgnoredStyles={htmlIgnoredStyles}
            htmlRenderers={htmlRenderers}
            htmlRenderersProps={htmlRenderersProps}
            htmlTagsStyles={htmlTagsStyles}
            expandedQuotesRef={expandedQuotesRef}
            loadedQuotedRepliesRef={loadedQuotedRepliesRef}
            loadingMoreReplies={loadingMoreReplies}
            loadingQuotedFloorsRef={loadingQuotedFloorsRef}
            commentQuery={commentQuery}
            quoteStateVersion={quoteStateVersion}
            readerData={readerData}
            replyComposerOpen={replyComposerOpen}
            replyContent={replyContent}
            replyFilter={replyFilter}
            replyTarget={yaohuoReplyTarget}
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
            onInteract={interact}
            onShareTopic={shareTopic}
            onYaohuoFavorite={favoriteOnYaohuoSite}
            onYaohuoVote={voteYaohuo}
            onLoadMoreReplies={loadMoreReplies}
            onOpenOriginal={openExternalUrl}
            onReplyComposerOpenChange={toggleReplyComposer}
            onReplyContentChange={setReplyContent}
            onReplyFilterChange={setReplyFilter}
            onReplyToFloor={replyToFloor}
            onRefreshTopic={refreshTopic}
            onVerifyLinuxDo={verifyLinuxDoFromTopic}
            onSubmitReply={submitReply}
            onTopicScroll={handleTopicScroll}
            onToggleQuotedFloor={toggleQuotedFloor}
            onToggleFavorite={toggleTopicFavorite}
            onOpenUser={openUser}
          />
        ) : (
          <>
            {screen === 'user' ? (
              <UserScreen
                busy={userBusy}
                error={userError}
                followed={currentUserFollowed}
                profile={userProfile}
                readerData={readerData}
                requestedUser={selectedUser}
                styles={styles}
                theme={theme}
                topicListStateInput={topicListStateInput}
                onBack={goBackFromUser}
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
            ) : null}
            {screen === 'feed' ? (
              <FeedScreen
                busy={feedBusy || actionBusy}
                categories={categories}
                categoryFilter={categoryFilter}
                feedHasMore={feedHasMore}
                feedItems={shownFeedItems}
                feedPage={feedPage}
                feedSource={feedSource}
                loadingMore={loadingMoreFeed}
                readerData={readerData}
                topicListStateInput={topicListStateInput}
                readingFilter={readingFilter}
                refreshing={feedRefreshing}
                styles={styles}
                theme={theme}
                onCategoryChange={setCategoryFilter}
                onFeedSourceChange={changeFeedSource}
                onLoadMore={() => loadFeed({ page: feedPage + 1, cursor: feedSource === 'all' ? feedNextCursor : undefined, nocache: true })}
                onOpenTopic={openTopic}
                onReadingFilterChange={setReadingFilter}
                onRefresh={refreshFeed}
                onToggleFavorite={toggleTopicFavorite}
              />
            ) : null}
            {screen === 'search' ? (
              <SearchScreen
                busy={searchBusy}
                query={searchQuery}
                readerData={readerData}
                topicListStateInput={topicListStateInput}
                recentSearches={recentSearches}
                results={visibleSearchItems}
                searchGroups={searchGroups}
                scope={searchScope}
                searchSource={searchSource}
                sort={searchSort}
                styles={styles}
                theme={theme}
                onLoadMoreSearchSource={loadMoreSearchSource}
                onOpenExternalUrl={openExternalUrl}
                onOpenTopic={openTopic}
                onRemoveRecentSearch={removeRecentSearch}
                onRemoveSavedSearch={(id) => commitReaderData((current) => removeSavedSearch(current, id))}
                onQueryChange={setSearchQuery}
                onSaveSearch={() => commitReaderData((current) => addSavedSearch(current, searchQuery))}
                onScopeChange={setSearchScope}
                onSearch={() => runSearch()}
                onSearchSourceChange={setSearchSource}
                onSortChange={setSearchSort}
                onRetrySearchSource={retrySearchSource}
                onToggleFavorite={toggleTopicFavorite}
              />
            ) : null}
            {screen === 'library' ? (
              <LibraryScreen
                categories={categories}
                followedUsers={followedUserRecords}
                libraryTab={libraryTab}
                libraryUndo={libraryUndo}
                records={libraryRecords}
                readerData={readerData}
                topicListStateInput={topicListStateInput}
                styles={styles}
                theme={theme}
                onClearHistory={clearHistory}
                onOpenTopic={openTopic}
                onOpenUser={openUser}
                onRemoveMany={removeManyLibraryTopics}
                onRemove={removeLibraryTopic}
                onRemoveUser={removeFollowedUser}
                onTabChange={setLibraryTab}
                onUndoDelete={undoLibraryDelete}
                onUpdateRecord={updateLibraryRecord}
              />
            ) : null}
            {screen === 'more' ? (
              <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
                <MemoizedMoreScreen
                  checking={checking}
                  hasNodeSeekLoginCookie={hasNodeSeekLoginCookie}
                  hasYaohuoCookie={hasYaohuoCookie}
                  hasLinuxDoClearance={hasLinuxDoClearance}
                  healthDetails={healthDetails}
                  healthSummary={healthSummary}
                  loginState={loginState}
                  loadingLoginPage={loadingLoginPage}
                  loadingYaohuoLoginPage={loadingYaohuoLoginPage}
                  loadingLinuxDoPage={loadingLinuxDoPage}
                  linuxDoWebViewError={linuxDoWebViewError}
                  linuxDoWebViewKey={linuxDoWebViewKey}
                  linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
                  nodeSeekWebViewUserAgent={nodeSeekWebViewUserAgent}
                  settings={readerData.settings}
                  backupJson={backupJson}
                  showLoginPanel={showLoginPanel}
                  showYaohuoLoginPanel={showYaohuoLoginPanel}
                  showLinuxDoPanel={showLinuxDoPanel}
                  showSettingsPanel={showSettingsPanel}
                  statusBusy={statusBusy}
                  styles={styles}
                  syncing={syncing}
                  theme={theme}
                  webViewRef={webViewRef}
                  yaohuoLoginState={yaohuoLoginState}
                  yaohuoWebViewRef={yaohuoWebViewRef}
                  linuxDoCookieNames={linuxDoCookieNames}
                  linuxDoWebViewRef={linuxDoWebViewRef}
                  onCheckHealth={checkLocalStatus}
                  onCheckIn={checkIn}
                  onCheckLogin={checkLogin}
                  onRememberNodeSeekCookies={rememberCurrentNodeSeekCookies}
                  onCheckYaohuoLogin={checkYaohuoCookie}
                  onCheckLinuxDoCookie={checkLinuxDoCookie}
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
                  onSetLoadingLinuxDoPage={setLoadingLinuxDoPage}
                  onSetLinuxDoWebViewError={setLinuxDoWebViewError}
                  onResetLinuxDoWebView={resetLinuxDoWebView}
                  onShowLoginPanelChange={setShowLoginPanel}
                  onShowYaohuoLoginPanelChange={setShowYaohuoLoginPanel}
                  onShowLinuxDoPanelChange={changeLinuxDoPanel}
                  onShowSettingsPanelChange={setShowSettingsPanel}
                  onUpdateSettings={updateSettings}
                />
              </ScrollView>
            ) : null}
            <NavBar active={screen} styles={styles} theme={theme} onChange={changeScreen} />
          </>
        )}
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
  );
}
