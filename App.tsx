import 'expo-dev-client';
import { memo, type ComponentProps, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  type ListRenderItem,
  Linking,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  type StyleProp,
  Text,
  TextInput,
  type TextStyle,
  ToastAndroid,
  useColorScheme,
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
import RenderHTML, {
  IMGElement,
  RenderHTMLConfigProvider,
  RenderHTMLSource,
  TRenderEngineProvider,
  useIMGElementProps,
  type CustomBlockRenderer
} from 'react-native-render-html';
import {
  Activity,
  BookMarked,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  Heart,
  Home,
  LayoutGrid,
  List,
  LogIn,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Star,
  ThumbsUp,
  X,
  type LucideIcon
} from 'lucide-react-native';
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
  searchTopics
} from './src/forumApi';
import {
  addSavedSearch,
  categoryKey,
  clearRecords,
  createEmptyReaderData,
  exportFavoritesMarkdown,
  isFavorite,
  isSubscribed,
  recordHistory,
  removeRecords,
  removeSavedSearch,
  restoreRecords,
  sanitizeReaderData,
  toggleFavorite,
  toggleSubscription,
  topicKey,
  updateTopicRecord,
  updateProgress,
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
import type { Category, FeedResponse, FeedSource, Reply, SearchResponse, Source, Topic, TopicDetail } from './src/types';
import { createImagePreviewList, dataImageFileFromUrl, isHttpOrHttpsUrl, isPreviewableImageUrl, type ImagePreviewList } from './src/htmlImages';
import { clearCookieUrls } from './src/cookieCleanup';
import { shouldOpenLoginWebViewUrl } from './src/loginWebViewNavigation';
import { shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from './src/feedFloatingActions';
import { feedCategoryItems, feedReadingFilterItems, feedSourceItems, shouldUseReadingFilter } from './src/feedCategoryRail';
import { getTopicListItemState, topicListItemStatesEqual, type TopicListItemState } from './src/topicListItemState';
import { LIST_SWIPE_ACTION_WIDTH, clampListSwipeTranslate, shouldCaptureListSwipe, shouldOpenListSwipeAction } from './src/listSwipeActions';
import {
  androidRipple,
  contentWidthValue,
  createStyles,
  createTheme,
  fontFamilyValue,
  lineHeightMultiplier,
  type ReaderTheme
} from './src/theme';
import {
  applyFeedFilter,
  mergeCategories,
  mergeReplies,
  mergeSettledFeedResponses,
  mergeTopics,
  searchLocal,
  sortTopics,
  type LibraryTab,
  type ReadingFilter,
  type SearchSort
} from './src/feedLogic';
import {
  appendUnique,
  errorMessage,
  finishAbortableRequest,
  formatDateTime,
  formatRelativeTime,
  isCanceledRequest,
  isLinuxDoCloudflareError,
  isNodeSeekCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError,
  linuxDoExternalSearchItems,
  removeString,
  settingsList,
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
import {
  buildReplyMarkdown,
  filterLibraryRecords,
  filterRepliesByQuery,
  groupLibraryRecordsByTime,
  highlightHtml,
  highlightTextParts,
  readerModeHtml
} from './src/androidFeatureHelpers';

type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
type HtmlAllowedStyles = NonNullable<ComponentProps<typeof RenderHTML>['allowedStyles']>;
type HtmlIgnoredStyles = NonNullable<ComponentProps<typeof RenderHTML>['ignoredStyles']>;
type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
type HtmlTagsStyles = NonNullable<ComponentProps<typeof RenderHTML>['tagsStyles']>;
type LoginNavigationRequest = { url: string };
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
type TopicSwipeActionConfig = {
  kind: 'favorite' | 'delete';
  onPress: (topic: Topic) => void;
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

const NODESEEK_URL = 'https://www.nodeseek.com';
const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_LOGIN_HOSTS = ['nodeseek.com', 'challenges.cloudflare.com'];
const NODESEEK_BROWSER_FETCH_TIMEOUT_MS = 15000;
const PROGRESS_SAVE_DEBOUNCE_MS = 650;
const PROGRESS_SAVE_MAX_PENDING_MS = 2000;
const YAOHUO_URL = 'https://yaohuo.me';
const YAOHUO_LOGIN_URL = `${YAOHUO_URL}/waplogin.aspx?siteid=1000`;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL, 'https://www.yaohuo.me'];
const YAOHUO_LOGIN_HOSTS = ['yaohuo.me'];
const LINUXDO_URL = 'https://linux.do';
const LINUXDO_VERIFY_URL = `${LINUXDO_URL}/latest`;
const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com'];
const LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS = 12000;
const LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS = 5000;
const LINUXDO_CLEARANCE_DETECT_INTERVAL_MS = 500;
const YAOHUO_DEFAULT_CLASS_ID = '177';
const COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
const NODESEEK_USER_AGENT_STORAGE_KEY = 'nodeseek-user-agent';
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
const SEARCH_HISTORY_STORAGE_KEY = 'reader-search-history';
const FEED_SCROLL_STORAGE_PREFIX = 'reader-feed-scroll';
const sources: Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
const TOUCH_HIT_SLOP = { top: 6, right: 6, bottom: 6, left: 6 };
const ANDROID_REMOVE_CLIPPED_SUBVIEWS = Platform.OS === 'android';
const FEED_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 8,
  removeClippedSubviews: ANDROID_REMOVE_CLIPPED_SUBVIEWS,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};
const TOPIC_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 10,
  maxToRenderPerBatch: 8,
  removeClippedSubviews: ANDROID_REMOVE_CLIPPED_SUBVIEWS,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};
const REPLY_LIST_PERFORMANCE_PROPS = {
  initialNumToRender: 6,
  maxToRenderPerBatch: 5,
  removeClippedSubviews: ANDROID_REMOVE_CLIPPED_SUBVIEWS,
  updateCellsBatchingPeriod: 50,
  windowSize: 7
};
const HTML_IGNORED_DOM_TAGS = ['script', 'style', 'iframe', 'noscript'];
const HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = ['fontWeight', 'fontStyle', 'textAlign', 'textDecorationLine'];

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

const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const usernameEl = document.querySelector(".Username");
  const href = usernameEl && (usernameEl.getAttribute("href") || usernameEl.closest("a")?.getAttribute("href"));
  const match = typeof href === "string" ? href.match(/\\/(?:space|user)\\/(\\d+)/) : null;
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    loggedIn: Boolean(match),
    userId: match ? Number(match[1]) : null,
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

const LINUXDO_WEBVIEW_PROBE_SCRIPT = `
(() => {
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "linuxdo-webview",
    userAgent: navigator.userAgent || "",
    cookie: document.cookie || ""
  }));
})();
true;
`;

type Screen = 'feed' | 'search' | 'library' | 'more' | 'topic';
type SearchScope = 'remote' | 'local';
type ReplyFilter = 'all' | 'author' | 'images' | 'newest';
type SearchGroup = {
  source: Source;
  label: string;
  items: Topic[];
  error?: string;
  loading?: boolean;
};
type LibraryUndo = {
  section: LibraryTab;
  records: Record<string, TopicRecord>;
  label: string;
} | null;
type HealthDetail = {
  label: string;
  ok: boolean;
  message: string;
};
type TopicListItem =
  | { type: 'content'; key: string; html: string }
  | { type: 'replyControls'; key: string }
  | { type: 'replyComposer'; key: string }
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number };

interface YaohuoReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
}

function stableTextHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getReplyKey(reply: Reply) {
  if (typeof reply.floor === 'number') {
    return `reply-floor-${reply.floor}`;
  }
  if (typeof reply.commentId === 'number') {
    return `reply-comment-${reply.commentId}`;
  }
  const seed = [
    reply.authorId || '',
    reply.author || '',
    reply.createdAt || '',
    reply.contentHtml || ''
  ].join('|');
  return `reply-${stableTextHash(seed || JSON.stringify(reply))}`;
}

function topicListItemKey(item: TopicListItem) {
  return item.key;
}

function searchResultCategoryKey(item: Topic) {
  const category = item.categoryId || item.category?.replace(/^#/, '');
  return category ? `${item.source}:${category}` : '';
}

function sortedRecords(records: Record<string, TopicRecord>) {
  return Object.values(records).sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

function parseTagsInput(value: string) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of value.split(/[,\s，、]+/)) {
    const clean = part.trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      tags.push(clean);
    }
  }
  return tags;
}

function libraryRecordKey(record: TopicRecord) {
  return topicKey(record.topic);
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

function feedScrollStorageKey(source: FeedSource, category: string, readingFilter: ReadingFilter) {
  return `${FEED_SCROLL_STORAGE_PREFIX}:${source}:${category || 'all'}:${readingFilter}`;
}

function safeFileName(value: string, extension: string) {
  const clean = value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return `${clean || 'forum-reader'}-${Date.now()}.${extension}`;
}

function splitTopicContentHtml(html: string | undefined) {
  const clean = (html || '').trim();
  if (!clean) {
    return [];
  }
  const blockPattern = /[\s\S]*?<\/(?:p|div|blockquote|pre|ul|ol|li|table|h[1-6])>/gi;
  const blocks = clean.match(blockPattern);
  if (!blocks?.length) {
    return [clean];
  }
  const chunks: string[] = [];
  let current = '';
  let consumedLength = 0;
  for (const block of blocks) {
    current += block;
    consumedLength += block.length;
    if (current.length >= 2200) {
      chunks.push(current);
      current = '';
    }
  }
  const remainder = clean.slice(consumedLength).trim();
  if (remainder) {
    current += remainder;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.length ? chunks : [clean];
}

const MemoizedHtmlContent = memo(HtmlContent);

const MemoizedReplyCard = memo(ReplyCard, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.isNew !== next.isNew
    || previous.onInteract !== next.onInteract
    || previous.onCopyReplyMarkdown !== next.onCopyReplyMarkdown
    || previous.onReplyToFloor !== next.onReplyToFloor
    || previous.onToggleQuotedFloor !== next.onToggleQuotedFloor
    || previous.query !== next.query
    || previous.reply !== next.reply
    || previous.replyFloor !== next.replyFloor
    || previous.source !== next.source
    || previous.styles !== next.styles
    || previous.theme !== next.theme
  ) {
    return false;
  }

  const quotedFloors = new Set([...(previous.reply.quotedFloors || []), ...(next.reply.quotedFloors || [])]);
  for (const quotedFloor of quotedFloors) {
    const previousKey = `${previous.replyFloor}:${quotedFloor}`;
    const nextKey = `${next.replyFloor}:${quotedFloor}`;
    if (
      Boolean(previous.expandedQuotes[previousKey]) !== Boolean(next.expandedQuotes[nextKey])
      || Boolean(previous.loadingQuotedFloors[previousKey]) !== Boolean(next.loadingQuotedFloors[nextKey])
      || previous.loadedQuotedReplies[quotedFloor] !== next.loadedQuotedReplies[quotedFloor]
      || previous.repliesByFloor.get(quotedFloor) !== next.repliesByFloor.get(quotedFloor)
    ) {
      return false;
    }
  }

  return true;
});

const MemoizedTopicCard = memo(TopicCard, (previous, next) => (
  previous.topic === next.topic
  && previous.styles === next.styles
  && previous.theme === next.theme
  && previous.highlightQuery === next.highlightQuery
  && previous.onOpenTopic === next.onOpenTopic
  && previous.swipeAction === next.swipeAction
  && topicListItemStatesEqual(previous.readerState, next.readerState)
));

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
  const backupAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const actionAbortRef = useRef<AbortController | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressMaxSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgressRef = useRef<{ topic: Topic; percent: number; scrollY: number } | null>(null);
  const loadingMoreRepliesRef = useRef(false);
  const repliesAbortRef = useRef<AbortController | null>(null);
  const repliesRequestIdRef = useRef(0);
  const currentTopicKeyRef = useRef<string | null>(null);
  const quotedReplyAbortRefs = useRef<Record<string, AbortController>>({});
  const topicScrollRef = useRef<FlatList<TopicListItem>>(null);
  const topicReturnScreenRef = useRef<Exclude<Screen, 'topic'>>('feed');
  const pendingLinuxDoTopicRef = useRef<Topic | null>(null);
  const nodeSeekWebViewCookieHeaderRef = useRef('');
  const nodeSeekWebViewUserAgentRef = useRef(DEFAULT_NODESEEK_ANDROID_USER_AGENT);
  const nodeSeekBrowserFetchIdRef = useRef(0);
  const nodeSeekBrowserFetchCurrentRef = useRef<PendingNodeSeekBrowserFetchRequest | null>(null);
  const nodeSeekBrowserFetchQueueRef = useRef<PendingNodeSeekBrowserFetchRequest[]>([]);
  const rejectNodeSeekBrowserFetchRef = useRef<((request: PendingNodeSeekBrowserFetchRequest, message: string) => void) | null>(null);
  const linuxDoWebViewCookieHeaderRef = useRef('');
  const linuxDoWebViewUserAgentRef = useRef(DEFAULT_LINUXDO_ANDROID_USER_AGENT);
  const systemScheme = useColorScheme();
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
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const [libraryUndo, setLibraryUndo] = useState<LibraryUndo>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicError, setTopicError] = useState('');
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [commentQuery, setCommentQuery] = useState('');
  const [readerMode, setReaderMode] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
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
  const [showCategoriesPanel, setShowCategoriesPanel] = useState(false);
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
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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
      void AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== query);
      void AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const theme = useMemo(() => createTheme(readerData.settings, systemScheme), [readerData.settings, systemScheme]);
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
    () => sortedRecords(readerData[libraryTab]),
    [libraryTab, readerData]
  );
  const visibleSearchItems = useMemo(() => sortTopics(searchItems, searchSort), [searchItems, searchSort]);
  const filteredReplies = useMemo(() => {
    let base = topicReplies;
    if (replyFilter === 'author') {
      base = topicDetail ? topicReplies.filter((reply) => reply.author === topicDetail.author) : topicReplies;
    } else if (replyFilter === 'images') {
      base = topicReplies.filter((reply) => /<img\b/i.test(reply.contentHtml));
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
        const downloaded = await FileSystem.downloadAsync(uri, target);
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
      return (
        <IMGElement
          {...imageProps}
          onPress={(event) => {
            event.stopPropagation?.();
            openImagePreview(src);
          }}
        />
      );
    };
    return { img: PreviewImageRenderer };
  }, [openImagePreview]);
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
    repliesAbortRef.current?.abort();
    backupAbortRef.current?.abort();
    statusAbortRef.current?.abort();
    actionAbortRef.current?.abort();
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }
    if (progressMaxSaveTimerRef.current) {
      clearTimeout(progressMaxSaveTimerRef.current);
    }
  }, []);

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
    setHasNodeSeekLoginCookie(summary.loggedIn || verifiedByPage);
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

  const failCurrentNodeSeekBrowserFetch = useCallback((message: string) => {
    const current = nodeSeekBrowserFetchCurrentRef.current;
    if (current) {
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
    setShowCategoriesPanel(false);
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

  const showLinuxDoVerification = useCallback((message = 'linux.do 需要完成 Cloudflare 验证') => {
    setScreen('more');
    setShowLoginPanel(false);
    setShowYaohuoLoginPanel(false);
    setShowCategoriesPanel(false);
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
        ? sources
        : [searchSource as Source];
    if (sourceOverride) {
      setSearchGroups((current) => current.map((group) => group.source === sourceOverride ? { ...group, loading: true, error: undefined } : group));
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
        const groups = await Promise.all(activeSources.map(async (source) => {
          try {
            const [yaohuoCookie, nodeSeekCookie] = await Promise.all([
              loadYaohuoCookieForSource(source),
              loadNodeSeekCookieForSource(source)
            ]);
            if (source === 'yaohuo' && !yaohuoCookie) {
              return { source, label: sourceLabel(source), items: [], error: '未登录' };
            }
            const data = source === 'yaohuo'
              ? await searchYaohuoDirect({ query, limit: 30, yaohuoCookie, signal: controller.signal })
              : await searchTopics({
                query,
                source,
                limit: 30,
                fetcher: nodeSeekFetchWithWebView,
                nodeSeekCookie,
                nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current,
                signal: controller.signal
              });
            return {
              source,
              label: sourceLabel(source),
              items: data.items,
              error: data.errors?.[source]
            };
          } catch (error) {
            if (isCanceledRequest(error)) {
              throw error;
            }
            if (source === 'yaohuo' && isYaohuoLoginRequiredError(error)) {
              return { source, label: sourceLabel(source), items: [], error: isYaohuoLoginExpiredError(error) ? '登录已失效' : errorMessage(error) };
            }
            return { source, label: sourceLabel(source), items: [], error: errorMessage(error) };
          }
        }));
        if (requestId !== searchRequestIdRef.current) {
          return;
        }
        const nextGroups = sourceOverride
          ? searchGroupsRef.current.map((group) => {
            const updated = groups.find((item) => item.source === group.source);
            return updated ? { ...updated, loading: false } : group;
          })
          : groups.map((group) => ({ ...group, loading: false }));
        setSearchGroups(nextGroups);
        const mergedItems = nextGroups.reduce<Topic[]>((items, group) => mergeTopics(items, group.items), []);
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
  }, [addRecentSearch, clearYaohuoLoginState, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView, notify, readerData, searchQuery, searchScope, searchSource, showNodeSeekVerification, showYaohuoLogin]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    runSearchRef.current = runSearch;
  }, [runSearch, searchQuery]);

  useEffect(() => {
    if (!searchQueryRef.current.trim()) {
      return;
    }
    void runSearchRef.current?.();
  }, [searchSource, searchScope]);

  const retrySearchSource = useCallback((source: Source) => {
    void runSearch(source);
  }, [runSearch]);

  const openTopic = useCallback(async (topic: Topic, nocache = false) => {
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
    setScreen('topic');
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
        setTimeout(() => topicScrollRef.current?.scrollToOffset({ offset: progress.scrollY, animated: false }), 180);
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
  }, [clearYaohuoLoginState, commitReaderData, loadNodeSeekCookieForSource, loadYaohuoCookieForSource, nodeSeekFetchWithWebView, notify, resetQuoteState, screen, showLinuxDoVerification, showNodeSeekVerification, showYaohuoLogin]);

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

  const copyTopicLink = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail?.url) {
      return;
    }
    await Clipboard.setStringAsync(detail.url);
    notify('链接已复制');
  }, [notify, selectedTopic, topicDetail]);

  const copyReplyMarkdown = useCallback(async (reply: Reply, floor: number) => {
    const detail = topicDetail || selectedTopic;
    if (!detail) {
      return;
    }
    await Clipboard.setStringAsync(buildReplyMarkdown(reply, floor, detail.title, detail.url));
    notify('楼层引用已复制');
  }, [notify, selectedTopic, topicDetail]);

  const verifyLinuxDoFromTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail?.source === 'linuxdo') {
      pendingLinuxDoTopicRef.current = detail;
    }
    showLinuxDoVerification();
  }, [selectedTopic, showLinuxDoVerification, topicDetail]);

  const changeScreen = useCallback((nextScreen: Screen) => {
    if (nextScreen !== 'topic') {
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
    setScreen(nextScreen);
  }, [abortQuotedReplyRequests]);

  const goBackFromTopic = useCallback(() => {
    abortQuotedReplyRequests();
    changeScreen(topicReturnScreenRef.current);
  }, [abortQuotedReplyRequests, changeScreen]);

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
        setHasNodeSeekLoginCookie(true);
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
        notify(summary.loggedIn || webLoginDetectedRef.current ? '已检测到 NodeSeek 登录 Cookie，已保存在本机。' : '已检测到 NodeSeek 验证信息，已保存在本机。');
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
      const loginState = await checkYaohuoLoginDirect({ yaohuoCookie: cookieHeader });
      if (loginState.loginRequired || !loginState.ok) {
        if (loginState.reason === 'expired') {
          await clearYaohuoLoginState();
        }
        notify(loginState.message || '妖火登录已失效，请重新登录。');
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
      type === 'upvote' ? '点赞请求已提交' : '感谢请求已提交'
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

  const exportFavoritesMarkdownFile = useCallback(async () => {
    try {
      await saveQueueRef.current.catch(() => undefined);
      await shareTextFile(safeFileName('forum-reader-favorites', 'md'), exportFavoritesMarkdown(readerDataRef.current), 'text/markdown');
      notify('收藏 Markdown 已生成');
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
        getFeed({ source: 'linuxdo', limit: 1, nocache: true, signal: controller.signal })
      ]);
      const status = {
        nodeseek: checks[0].status === 'fulfilled',
        v2ex: checks[1].status === 'fulfilled',
        linuxdo: checks[2].status === 'fulfilled',
        yaohuo: Boolean(yaohuoCookie)
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
          message: status.yaohuo ? '已保存登录 Cookie' : '未登录'
        },
        {
          label: 'linux.do 验证',
          ok: access.hasClearance,
          message: access.hasClearance ? `已保存 ${access.savedAt || ''}` : '未保存'
        }
      ]);
      const sourceStatus = sources.map((source) => `${sourceLabel(source)} ${status[source] ? '可用' : '不可用'}`).join(' · ');
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
      if (showCategoriesPanel) {
        setShowCategoriesPanel(false);
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
      if (screen !== 'feed') {
        setScreen('feed');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [
    closeImagePreview,
    goBackFromTopic,
    imagePreview,
    screen,
    closeLinuxDoPanel,
    showCategoriesPanel,
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

  const selectCategory = useCallback((category: Category) => {
    setFeedSource(category.source);
    setCategoryFilter(category.id);
    setScreen('feed');
  }, []);

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

  const removeLibraryTopic = useCallback((topic: Topic) => {
    const record = readerDataRef.current[libraryTab][topicKey(topic)];
    if (record) {
      setLibraryUndo({
        section: libraryTab,
        records: { [topicKey(topic)]: record },
        label: `已删除 1 条${libraryTab === 'favorites' ? '收藏' : '历史'}`
      });
    }
    commitReaderData((current) => removeRecords(current, libraryTab, [topic]));
  }, [commitReaderData, libraryTab]);

  const removeManyLibraryTopics = useCallback((topics: Topic[]) => {
    const records = Object.fromEntries(topics
      .map((topic) => [topicKey(topic), readerDataRef.current[libraryTab][topicKey(topic)]] as const)
      .filter(([, record]) => Boolean(record))) as Record<string, TopicRecord>;
    if (Object.keys(records).length) {
      setLibraryUndo({
        section: libraryTab,
        records,
        label: `已删除 ${Object.keys(records).length} 条${libraryTab === 'favorites' ? '收藏' : '历史'}`
      });
    }
    commitReaderData((current) => removeRecords(current, libraryTab, topics));
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
    commitReaderData((current) => updateTopicRecord(current, libraryTab, topic, patch));
  }, [commitReaderData, libraryTab]);

  const toggleCategorySubscription = useCallback((category: Category) => {
    commitReaderData((current) => toggleSubscription(current, category));
  }, [commitReaderData]);

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
              androidLayerType="software"
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
                failCurrentNodeSeekBrowserFetch(event.nativeEvent.description || 'NodeSeek 页面加载失败');
              }}
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
            focusMode={focusMode}
            quoteStateVersion={quoteStateVersion}
            readerData={readerData}
            readerMode={readerMode}
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
            onCopyReplyMarkdown={copyReplyMarkdown}
            onCopyTopicLink={copyTopicLink}
            onInteract={interact}
            onYaohuoFavorite={favoriteOnYaohuoSite}
            onYaohuoVote={voteYaohuo}
            onLoadMoreReplies={loadMoreReplies}
            onOpenOriginal={openExternalUrl}
            onReplyComposerOpenChange={toggleReplyComposer}
            onReplyContentChange={setReplyContent}
            onReplyFilterChange={setReplyFilter}
            onReplyToFloor={replyToFloor}
            onRefreshTopic={refreshTopic}
            onReaderModeChange={setReaderMode}
            onFocusModeChange={setFocusMode}
            onVerifyLinuxDo={verifyLinuxDoFromTopic}
            onSubmitReply={submitReply}
            onTopicScroll={handleTopicScroll}
            onToggleQuotedFloor={toggleQuotedFloor}
            onToggleFavorite={toggleTopicFavorite}
          />
        ) : (
          <>
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
                recentSearches={recentSearches}
                results={visibleSearchItems}
                searchGroups={searchGroups}
                scope={searchScope}
                searchSource={searchSource}
                sort={searchSort}
                styles={styles}
                theme={theme}
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
                libraryTab={libraryTab}
                libraryUndo={libraryUndo}
                records={libraryRecords}
                readerData={readerData}
                styles={styles}
                theme={theme}
                onClearHistory={clearHistory}
                onOpenTopic={openTopic}
                onRemoveMany={removeManyLibraryTopics}
                onRemove={removeLibraryTopic}
                onTabChange={setLibraryTab}
                onUndoDelete={undoLibraryDelete}
                onUpdateRecord={updateLibraryRecord}
              />
            ) : null}
            {screen === 'more' ? (
              <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
                <MemoizedMoreScreen
                  categories={categories}
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
                  readerData={readerData}
                  backupJson={backupJson}
                  showCategoriesPanel={showCategoriesPanel}
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
                  onExportFavoritesMarkdownFile={exportFavoritesMarkdownFile}
                  onRefreshCategories={loadCategories}
                  onSelectCategory={selectCategory}
                  onBackupJsonChange={setBackupJson}
                  onSetLoadingLoginPage={setLoadingLoginPage}
                  onSetLoadingYaohuoLoginPage={setLoadingYaohuoLoginPage}
                  onSetLoadingLinuxDoPage={setLoadingLinuxDoPage}
                  onSetLinuxDoWebViewError={setLinuxDoWebViewError}
                  onResetLinuxDoWebView={resetLinuxDoWebView}
                  onShowCategoriesPanelChange={setShowCategoriesPanel}
                  onShowLoginPanelChange={setShowLoginPanel}
                  onShowYaohuoLoginPanelChange={setShowYaohuoLoginPanel}
                  onShowLinuxDoPanelChange={changeLinuxDoPanel}
                  onShowSettingsPanelChange={setShowSettingsPanel}
                  onToggleSubscription={toggleCategorySubscription}
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

function FeedScreen({
  busy,
  categories,
  categoryFilter,
  feedHasMore,
  feedItems,
  feedPage,
  feedSource,
  loadingMore,
  readerData,
  readingFilter,
  refreshing,
  styles,
  theme,
  onCategoryChange,
  onFeedSourceChange,
  onLoadMore,
  onOpenTopic,
  onReadingFilterChange,
  onRefresh,
  onToggleFavorite
}: {
  busy: boolean;
  categories: Category[];
  categoryFilter: string;
  feedHasMore: boolean;
  feedItems: Topic[];
  feedPage: number;
  feedSource: FeedSource;
  loadingMore: boolean;
  readerData: ReaderData;
  readingFilter: ReadingFilter;
  refreshing: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCategoryChange: (categoryId: string) => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onLoadMore: () => void;
  onOpenTopic: (topic: Topic) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
  onToggleFavorite: (topic: Topic) => void;
}) {
  const listRef = useRef<FlatList<Topic>>(null);
  const requestedFeedPageRef = useRef<number | null>(null);
  const pendingScrollOffsetRef = useRef<number | null>(null);
  const scrollStorageKey = useMemo(() => feedScrollStorageKey(feedSource, categoryFilter, readingFilter), [categoryFilter, feedSource, readingFilter]);
  const [showFloatingActions, setShowFloatingActions] = useState(false);
  const [scrollRestoreReady, setScrollRestoreReady] = useState(false);

  const requestFeedLoadMore = useCallback(() => {
    if (!feedHasMore || busy || loadingMore) {
      return;
    }
    const nextPage = feedPage + 1;
    if (requestedFeedPageRef.current === nextPage) {
      return;
    }
    requestedFeedPageRef.current = nextPage;
    onLoadMore();
  }, [busy, feedHasMore, feedPage, loadingMore, onLoadMore]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextVisible = shouldShowFeedFloatingActions(event.nativeEvent.contentOffset.y);
    setShowFloatingActions((current) => current === nextVisible ? current : nextVisible);
    if (shouldLoadMoreFeedFromScroll(event.nativeEvent)) {
      requestFeedLoadMore();
    }
  }, [requestFeedLoadMore]);

  const saveFeedScrollPosition = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, Math.round(event.nativeEvent.contentOffset.y));
    void AsyncStorage.setItem(scrollStorageKey, String(offset)).catch(() => undefined);
  }, [scrollStorageKey]);

  useEffect(() => {
    if (!busy && !loadingMore) {
      requestedFeedPageRef.current = null;
    }
  }, [busy, loadingMore]);

  useEffect(() => {
    requestedFeedPageRef.current = null;
    setShowFloatingActions(false);
    pendingScrollOffsetRef.current = null;
    setScrollRestoreReady(false);
    let active = true;
    AsyncStorage.getItem(scrollStorageKey)
      .then((value) => {
        if (!active) {
          return;
        }
        const offset = Number(value || 0);
        if (Number.isFinite(offset) && offset > 0) {
          pendingScrollOffsetRef.current = offset;
        }
      })
      .catch(() => undefined)
      .then(() => {
        if (active) {
          setScrollRestoreReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [scrollStorageKey]);

  const restoreFeedScrollPosition = useCallback(() => {
    const offset = pendingScrollOffsetRef.current;
    if (scrollRestoreReady && offset && feedItems.length) {
      pendingScrollOffsetRef.current = null;
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset, animated: false }));
    }
  }, [feedItems.length, scrollRestoreReady]);

  useEffect(() => {
    restoreFeedScrollPosition();
  }, [restoreFeedScrollPosition]);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowFloatingActions(false);
  }, []);
  const favoriteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'favorite',
    onPress: onToggleFavorite
  }), [onToggleFavorite]);

  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ item: topic }) => (
    <MemoizedTopicCard
      readerState={getTopicListItemState(readerData, topic)}
      styles={styles}
      theme={theme}
      topic={topic}
      onOpenTopic={onOpenTopic}
      swipeAction={favoriteSwipeAction}
    />
  ), [favoriteSwipeAction, onOpenTopic, readerData, styles, theme]);
  const categoryItems = useMemo(
    () => feedCategoryItems(categories, feedSource),
    [categories, feedSource]
  );

  const header = (
    <View style={styles.stack}>
      <PillRail
        variant="tabs"
        items={feedSourceItems}
        value={feedSource}
        styles={styles}
        onChange={(value) => onFeedSourceChange(value as FeedSource)}
      />
      {shouldUseReadingFilter(feedSource) ? (
        <PillRail
          items={feedReadingFilterItems}
          value={readingFilter}
          styles={styles}
          onChange={(value) => onReadingFilterChange(value as ReadingFilter)}
        />
      ) : (
        <PillRail
          items={categoryItems}
          value={categoryFilter}
          styles={styles}
          onChange={onCategoryChange}
        />
      )}
    </View>
  );
  const feedEmptyText = readingFilter !== 'all' || Boolean(categoryFilter) || feedSource !== 'all'
    ? '当前筛选没有匹配主题'
    : '暂无主题';

  return (
    <View style={styles.content}>
      <FlatList
        ref={listRef}
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        data={feedItems}
        keyExtractor={topicKey}
        keyboardShouldPersistTaps="handled"
        onScroll={handleScroll}
        scrollEventThrottle={64}
        onMomentumScrollEnd={saveFeedScrollPosition}
        onScrollEndDrag={saveFeedScrollPosition}
        onContentSizeChange={restoreFeedScrollPosition}
        onEndReachedThreshold={0.6}
        onEndReached={requestFeedLoadMore}
        {...FEED_LIST_PERFORMANCE_PROPS}
        ListHeaderComponent={header}
        ListEmptyComponent={busy ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : <EmptyText text={feedEmptyText} styles={styles} />}
        ListFooterComponent={feedHasMore ? (
          <AppButton
            label={loadingMore ? '正在加载...' : `加载第 ${feedPage + 1} 页`}
            styles={styles}
            disabled={busy || loadingMore}
            onPress={requestFeedLoadMore}
          />
        ) : feedItems.length > 0 && !busy ? (
          <Text style={styles.endOfListText}>已经到底了</Text>
        ) : null}
        renderItem={renderTopicItem}
      />
      {showFloatingActions ? (
        <View style={styles.feedFloatingActions}>
          <FloatingIconButton icon={RefreshCw} label="刷新" styles={styles} theme={theme} loading={refreshing} disabled={refreshing} onPress={onRefresh} />
          <FloatingIconButton icon={ChevronUp} label="回到顶部" styles={styles} theme={theme} onPress={scrollToTop} />
        </View>
      ) : null}
    </View>
  );
}

function SearchScreen({
  busy,
  query,
  recentSearches,
  readerData,
  results,
  searchGroups,
  scope,
  searchSource,
  sort,
  styles,
  theme,
  onOpenExternalUrl,
  onOpenTopic,
  onRemoveRecentSearch,
  onRemoveSavedSearch,
  onQueryChange,
  onSaveSearch,
  onRetrySearchSource,
  onScopeChange,
  onSearch,
  onSearchSourceChange,
  onSortChange,
  onToggleFavorite
}: {
  busy: boolean;
  query: string;
  recentSearches: string[];
  readerData: ReaderData;
  results: Topic[];
  searchGroups: SearchGroup[];
  scope: SearchScope;
  searchSource: FeedSource;
  sort: SearchSort;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenExternalUrl: (url: string) => void;
  onOpenTopic: (topic: Topic) => void;
  onRemoveRecentSearch: (query: string) => void;
  onRemoveSavedSearch: (id: string) => void;
  onQueryChange: (value: string) => void;
  onSaveSearch: () => void;
  onRetrySearchSource: (source: Source) => void;
  onScopeChange: (scope: SearchScope) => void;
  onSearch: () => void;
  onSearchSourceChange: (source: FeedSource) => void;
  onSortChange: (sort: SearchSort) => void;
  onToggleFavorite: (topic: Topic) => void;
}) {
  const favoriteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'favorite',
    onPress: onToggleFavorite
  }), [onToggleFavorite]);
  const renderTopicItem = useCallback<ListRenderItem<Topic>>(({ item }) => (
    <MemoizedTopicCard
      highlightQuery={query}
      readerState={getTopicListItemState(readerData, item)}
      styles={styles}
      theme={theme}
      topic={item}
      onOpenTopic={onOpenTopic}
      swipeAction={favoriteSwipeAction}
    />
  ), [favoriteSwipeAction, onOpenTopic, query, readerData, styles, theme]);
  const selectSavedSearch = useCallback((id: string) => {
    const saved = readerData.savedSearches.find((item) => item.id === id);
    if (saved) {
      onQueryChange(saved.query);
      return;
    }
    onQueryChange(id);
  }, [onQueryChange, readerData.savedSearches]);
  const [searchCategoryFilter, setSearchCategoryFilter] = useState('all');
  useEffect(() => {
    setSearchCategoryFilter('all');
  }, [query, scope, searchSource]);
  const searchCategoryOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of results) {
      const key = searchResultCategoryKey(item);
      if (!key || !item.category) {
        continue;
      }
      const current = counts.get(key);
      counts.set(key, {
        label: `${sourceLabel(item.source)} · ${item.category}`,
        count: (current?.count || 0) + 1
      });
    }
    return [...counts.entries()].map(([value, item]) => ({
      value,
      label: `${item.label} ${item.count}`
    }));
  }, [results]);
  useEffect(() => {
    if (searchCategoryFilter !== 'all' && !searchCategoryOptions.some((item) => item.value === searchCategoryFilter)) {
      setSearchCategoryFilter('all');
    }
  }, [searchCategoryFilter, searchCategoryOptions]);
  const filteredSearchResults = useMemo(() => (
    searchCategoryFilter === 'all'
      ? results
      : results.filter((item) => searchResultCategoryKey(item) === searchCategoryFilter)
  ), [results, searchCategoryFilter]);
  const visibleSearchGroups = useMemo(() => searchGroups.map((group) => ({
    ...group,
    items: sortTopics(
      searchCategoryFilter === 'all'
        ? group.items
        : group.items.filter((item) => searchResultCategoryKey(item) === searchCategoryFilter),
      sort
    )
  })), [searchCategoryFilter, searchGroups, sort]);
  const linuxDoExternalItems = useMemo(() => (
    scope === 'remote' && (searchSource === 'all' || searchSource === 'linuxdo')
      ? linuxDoExternalSearchItems(query)
      : []
  ), [query, scope, searchSource]);
  const showRemoteGroups = scope === 'remote' && query.trim().length > 0;

  const header = (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>搜索</Text>
        {busy ? <ActivityIndicator color={theme.primary} /> : null}
      </View>
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={query}
          onChangeText={onQueryChange}
          placeholder="输入关键词"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={onSearch}
        />
        {query ? <IconButton icon={X} label="清空" styles={styles} theme={theme} onPress={() => onQueryChange('')} /> : null}
        <IconButton icon={Search} label="搜索" styles={styles} theme={theme} disabled={busy} onPress={onSearch} />
      </View>
      <PillRail
        items={[
          { value: 'remote', label: '全网' },
          { value: 'local', label: '本地' }
        ]}
        value={scope}
        styles={styles}
        onChange={(value) => onScopeChange(value as SearchScope)}
      />
      <PillRail
        items={[
          { value: 'all', label: '全部' },
          { value: 'v2ex', label: 'V2EX' },
          { value: 'linuxdo', label: 'linux.do' },
          { value: 'nodeseek', label: 'NodeSeek' },
          { value: 'yaohuo', label: '妖火' }
        ]}
        value={searchSource}
        styles={styles}
        onChange={(value) => onSearchSourceChange(value as FeedSource)}
      />
      <PillRail
        items={[
          { value: 'relevance', label: '相关' },
          { value: 'time', label: '按时间' },
          { value: 'reply', label: '按回复' },
          { value: 'view', label: '按浏览' }
        ]}
        value={sort}
        styles={styles}
        onChange={(value) => onSortChange(value as SearchSort)}
      />
      {searchCategoryOptions.length ? (
        <PillRail
          items={[{ value: 'all', label: '分类全部' }, ...searchCategoryOptions]}
          value={searchCategoryFilter}
          styles={styles}
          onChange={setSearchCategoryFilter}
        />
      ) : null}
      {linuxDoExternalItems.length ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>linux.do 老帖</Text>
          <View style={styles.actions}>
            {linuxDoExternalItems.map((item) => (
              <AppButton key={item.url} compact label={item.label} styles={styles} onPress={() => onOpenExternalUrl(item.url)} />
            ))}
          </View>
        </View>
      ) : null}
      {showRemoteGroups ? (
        <View style={styles.stack}>
          {visibleSearchGroups.length ? visibleSearchGroups.map((group) => (
            <View key={group.source} style={styles.group}>
              <View style={styles.sectionHeader}>
                <Text style={styles.panelTitle}>{group.label}</Text>
                <Text style={styles.meta}>{group.loading ? '搜索中' : `${group.items.length} 条`}</Text>
              </View>
              {group.error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{group.error}</Text>
                  <AppButton label={`重试 ${group.label}`} variant="ghost" styles={styles} onPress={() => onRetrySearchSource(group.source)} />
                </View>
              ) : null}
              {group.loading ? <LoadingState text={`${group.label} 搜索中...`} styles={styles} theme={theme} /> : null}
              {group.items.map((item) => (
                <MemoizedTopicCard
                  key={topicKey(item)}
                  highlightQuery={query}
                  readerState={getTopicListItemState(readerData, item)}
                  styles={styles}
                  theme={theme}
                  topic={item}
                  onOpenTopic={onOpenTopic}
                  swipeAction={favoriteSwipeAction}
                />
              ))}
              {!group.loading && !group.error && !group.items.length ? <EmptyText text="这个来源没有结果" styles={styles} /> : null}
            </View>
          )) : <EmptyText text={busy ? '正在搜索...' : '暂无搜索结果'} styles={styles} />}
        </View>
      ) : null}
      <AppButton label="保存搜索" variant="ghost" styles={styles} onPress={onSaveSearch} />
      {readerData.savedSearches.length ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>保存搜索</Text>
          <View style={styles.chipWrap}>
            {readerData.savedSearches.map((item) => (
              <View key={item.id} style={styles.inlineChipGroup}>
                <Pressable accessibilityRole="button" style={styles.removableChip} onPress={() => selectSavedSearch(item.id)}>
                  <Text style={styles.pillText}>{item.query}</Text>
                </Pressable>
                <IconButton tiny ghost icon={X} label="删除保存搜索" styles={styles} theme={theme} onPress={() => onRemoveSavedSearch(item.id)} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {recentSearches.length ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>最近搜索</Text>
          <View style={styles.chipWrap}>
            {recentSearches.map((item) => (
              <View key={item} style={styles.inlineChipGroup}>
                <Pressable accessibilityRole="button" style={styles.removableChip} onPress={() => onQueryChange(item)}>
                  <Text style={styles.pillText}>{item}</Text>
                </Pressable>
                <IconButton tiny ghost icon={X} label="删除最近搜索" styles={styles} theme={theme} onPress={() => onRemoveRecentSearch(item)} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={showRemoteGroups ? [] : filteredSearchResults}
      keyExtractor={topicKey}
      keyboardShouldPersistTaps="handled"
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={showRemoteGroups ? null : busy && query.trim()
        ? <LoadingState text="正在搜索..." styles={styles} theme={theme} />
        : <EmptyText text={query.trim() ? '暂无搜索结果' : '输入关键词后开始搜索'} styles={styles} />}
      renderItem={renderTopicItem}
    />
  );
}

function LibraryScreen({
  libraryTab,
  libraryUndo,
  records,
  readerData,
  styles,
  theme,
  onClearHistory,
  onOpenTopic,
  onRemoveMany,
  onRemove,
  onTabChange,
  onUndoDelete,
  onUpdateRecord
}: {
  libraryTab: LibraryTab;
  libraryUndo: LibraryUndo;
  records: TopicRecord[];
  readerData: ReaderData;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClearHistory: () => void;
  onOpenTopic: (topic: Topic) => void;
  onRemoveMany: (topics: Topic[]) => void;
  onRemove: (topic: Topic) => void;
  onTabChange: (tab: LibraryTab) => void;
  onUndoDelete: () => void;
  onUpdateRecord: (topic: Topic, patch: Pick<TopicRecord, 'tags' | 'note'>) => void;
}) {
  type LibraryListItem = { type: 'section'; key: string; label: string } | { type: 'record'; key: string; record: TopicRecord };
  const [sourceFilter, setSourceFilter] = useState<FeedSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editingKey, setEditingKey] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const deleteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'delete',
    onPress: onRemove
  }), [onRemove]);
  const categories = useMemo(() => Array.from(new Set(records.map((record) => record.topic.category).filter(Boolean) as string[])), [records]);
  const tags = useMemo(() => Array.from(new Set(records.flatMap((record) => record.tags || []))).sort(), [records]);
  const filteredRecords = useMemo(() => filterLibraryRecords(records, {
    source: sourceFilter,
    category: categoryFilter,
    tag: tagFilter
  }), [categoryFilter, records, sourceFilter, tagFilter]);
  const listItems = useMemo<LibraryListItem[]>(() => groupLibraryRecordsByTime(filteredRecords).flatMap((section) => [
    { type: 'section' as const, key: `section:${section.label}`, label: section.label },
    ...section.records.map((record) => ({ type: 'record' as const, key: libraryRecordKey(record), record }))
  ]), [filteredRecords]);
  useEffect(() => {
    setSourceFilter('all');
    setCategoryFilter('all');
    setTagFilter('all');
  }, [libraryTab]);
  useEffect(() => {
    setSelected(new Set());
    setEditingKey('');
  }, [categoryFilter, libraryTab, sourceFilter, tagFilter]);
  const beginEdit = useCallback((record: TopicRecord) => {
    setEditingKey(libraryRecordKey(record));
    setTagInput(record.tags?.join(', ') || '');
    setNoteInput(record.note || '');
  }, []);
  const saveEdit = useCallback((record: TopicRecord) => {
    onUpdateRecord(record.topic, {
      tags: parseTagsInput(tagInput),
      note: noteInput
    });
    setEditingKey('');
  }, [noteInput, onUpdateRecord, tagInput]);
  const toggleSelected = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const removeSelected = useCallback(() => {
    const topics = filteredRecords.filter((record) => selected.has(libraryRecordKey(record))).map((record) => record.topic);
    if (topics.length) {
      onRemoveMany(topics);
      setSelected(new Set());
    }
  }, [filteredRecords, onRemoveMany, selected]);
  const renderLibraryItem = useCallback<ListRenderItem<LibraryListItem>>(({ item }) => {
    if (item.type === 'section') {
      return <Text style={styles.librarySectionTitle}>{item.label}</Text>;
    }
    const record = item.record;
    const key = libraryRecordKey(record);
    const selectedRecord = selected.has(key);
    const editing = editingKey === key;
    return (
      <View style={styles.libraryItem}>
        {bulkMode ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selectedRecord }} style={styles.librarySelectRow} onPress={() => toggleSelected(key)}>
            <Text style={styles.pillText}>{selectedRecord ? '已选' : '选择'}</Text>
          </Pressable>
        ) : null}
      <MemoizedTopicCard
        readerState={getTopicListItemState(readerData, record.topic)}
        styles={styles}
        theme={theme}
        topic={record.topic}
        onOpenTopic={onOpenTopic}
        swipeAction={bulkMode ? undefined : deleteSwipeAction}
      />
        <View style={styles.libraryMetaBlock}>
          <Text style={styles.meta}>保存于 {formatDateTime(record.savedAt) || record.savedAt}{record.visitCount ? ` · ${record.visitCount} 次阅读` : ''}</Text>
          {record.tags?.length ? <Text style={styles.meta}>标签：{record.tags.join(', ')}</Text> : null}
          {record.note ? <Text style={styles.meta}>备注：{record.note}</Text> : null}
        </View>
        {editing ? (
          <View style={styles.stack}>
            <TextInput
              style={styles.input}
              value={tagInput}
              onChangeText={setTagInput}
              placeholder="标签，用逗号分隔"
              placeholderTextColor={theme.muted}
            />
            <TextInput
              style={styles.input}
              value={noteInput}
              onChangeText={setNoteInput}
              placeholder="备注"
              placeholderTextColor={theme.muted}
            />
            <View style={styles.actions}>
              <AppButton compact label="保存" styles={styles} onPress={() => saveEdit(record)} />
              <AppButton compact label="取消" variant="ghost" styles={styles} onPress={() => setEditingKey('')} />
            </View>
          </View>
        ) : (
          <View style={styles.actions}>
            <AppButton compact label={record.tags?.length || record.note ? '编辑标签和备注' : '添加标签和备注'} variant="ghost" styles={styles} onPress={() => beginEdit(record)} />
            {!bulkMode ? <AppButton compact label="删除" variant="ghost" styles={styles} onPress={() => onRemove(record.topic)} /> : null}
          </View>
        )}
      </View>
    );
  }, [beginEdit, bulkMode, deleteSwipeAction, editingKey, noteInput, onOpenTopic, onRemove, readerData, saveEdit, selected, styles, tagInput, theme, toggleSelected]);

  const header = (
    <View style={styles.stack}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>收藏</Text>
        <Text style={styles.meta}>{filteredRecords.length === records.length ? `${records.length} 条` : `${filteredRecords.length} / ${records.length} 条`}</Text>
      </View>
      <PillRail
        items={[
          { value: 'favorites', label: '收藏' },
          { value: 'history', label: '历史' }
        ]}
        value={libraryTab}
        styles={styles}
        onChange={(value) => onTabChange(value as LibraryTab)}
      />
      <PillRail
        items={[
          { value: 'all', label: '来源全部' },
          ...sources.map((source) => ({ value: source, label: sourceLabel(source) }))
        ]}
        value={sourceFilter}
        styles={styles}
        onChange={(value) => setSourceFilter(value as FeedSource)}
      />
      {categories.length ? (
        <PillRail
          items={[{ value: 'all', label: '节点全部' }, ...categories.map((category) => ({ value: category, label: category }))]}
          value={categoryFilter}
          styles={styles}
          onChange={setCategoryFilter}
        />
      ) : null}
      {tags.length ? (
        <PillRail
          items={[{ value: 'all', label: '标签筛选' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
          value={tagFilter}
          styles={styles}
          onChange={setTagFilter}
        />
      ) : null}
      <View style={styles.actions}>
        <AppButton compact label={bulkMode ? '退出批量' : '批量删除'} variant="ghost" styles={styles} onPress={() => setBulkMode((value) => !value)} />
        {bulkMode && selected.size ? <AppButton compact label={`删除选中 ${selected.size}`} styles={styles} onPress={removeSelected} /> : null}
        {libraryTab === 'history' && records.length ? <AppButton compact label="清空历史" variant="ghost" styles={styles} onPress={onClearHistory} /> : null}
      </View>
      {libraryUndo ? (
        <View style={styles.noticeBox}>
          <Text style={styles.meta}>{libraryUndo.label}</Text>
          <AppButton compact label="撤销删除" variant="ghost" styles={styles} onPress={onUndoDelete} />
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={listItems}
      keyExtractor={(item) => item.key}
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyText text="这里还没有内容" styles={styles} />}
      renderItem={renderLibraryItem}
    />
  );
}

function MoreScreen({
  categories,
  checking,
  hasNodeSeekLoginCookie,
  hasYaohuoCookie,
  hasLinuxDoClearance,
  healthDetails,
  healthSummary,
  loginState,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  loadingLinuxDoPage,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewUserAgent,
  nodeSeekWebViewUserAgent,
  readerData,
  backupJson,
  showCategoriesPanel,
  showLoginPanel,
  showYaohuoLoginPanel,
  showLinuxDoPanel,
  showSettingsPanel,
  statusBusy,
  styles,
  syncing,
  theme,
  webViewRef,
  yaohuoLoginState,
  yaohuoWebViewRef,
  linuxDoCookieNames,
  linuxDoWebViewRef,
  onCheckHealth,
  onCheckIn,
  onCheckLogin,
  onRememberNodeSeekCookies,
  onCheckYaohuoLogin,
  onCheckLinuxDoCookie,
  onClearLogin,
  onClearYaohuoLogin,
  onClearLinuxDoCookie,
  handleNodeSeekLoginNavigation,
  handleYaohuoLoginNavigation,
  handleLinuxDoNavigation,
  onHandleLoginMessage,
  onHandleLinuxDoMessage,
  onImportBackup,
  onExportBackup,
  onExportBackupFile,
  onImportBackupFile,
  onExportFavoritesMarkdownFile,
  onRefreshCategories,
  onSelectCategory,
  onBackupJsonChange,
  onSetLoadingLoginPage,
  onSetLoadingYaohuoLoginPage,
  onSetLoadingLinuxDoPage,
  onSetLinuxDoWebViewError,
  onResetLinuxDoWebView,
  onShowCategoriesPanelChange,
  onShowLoginPanelChange,
  onShowYaohuoLoginPanelChange,
  onShowLinuxDoPanelChange,
  onShowSettingsPanelChange,
  onToggleSubscription,
  onUpdateSettings
}: {
  categories: Category[];
  checking: boolean;
  hasNodeSeekLoginCookie: boolean;
  hasYaohuoCookie: boolean;
  hasLinuxDoClearance: boolean;
  healthDetails: HealthDetail[];
  healthSummary: string;
  loginState: string;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  loadingLinuxDoPage: boolean;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewUserAgent: string;
  nodeSeekWebViewUserAgent: string;
  readerData: ReaderData;
  backupJson: string;
  showCategoriesPanel: boolean;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  showLinuxDoPanel: boolean;
  showSettingsPanel: boolean;
  statusBusy: boolean;
  styles: ReturnType<typeof createStyles>;
  syncing: boolean;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  linuxDoCookieNames: string[];
  linuxDoWebViewRef: RefObject<WebView | null>;
  onCheckHealth: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onRememberNodeSeekCookies: (options?: { silent?: boolean }) => Promise<boolean>;
  onCheckYaohuoLogin: () => void;
  onCheckLinuxDoCookie: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  onClearLinuxDoCookie: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent) => void;
  onImportBackup: () => void;
  onExportBackup: () => void;
  onExportBackupFile: () => void;
  onImportBackupFile: () => void;
  onExportFavoritesMarkdownFile: () => void;
  onRefreshCategories: () => void;
  onSelectCategory: (category: Category) => void;
  onBackupJsonChange: (value: string) => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onSetLoadingLinuxDoPage: (value: boolean) => void;
  onSetLinuxDoWebViewError: (value: string) => void;
  onResetLinuxDoWebView: () => void;
  onShowCategoriesPanelChange: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onToggleSubscription: (category: Category) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const favoriteCount = Object.keys(readerData.favorites).length;
  const historyCount = Object.keys(readerData.history).length;
  const grouped = sources.map((source) => ({
    source,
    items: categories.filter((category) => category.source === source)
  }));
  useEffect(() => {
    if (!showLinuxDoPanel || !loadingLinuxDoPage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      onSetLoadingLinuxDoPage(false);
      onSetLinuxDoWebViewError('linux.do 页面打开超时：请检查模拟器网络后刷新页面。');
    }, LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [loadingLinuxDoPage, onSetLinuxDoWebViewError, onSetLoadingLinuxDoPage, showLinuxDoPanel]);

  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>更多</Text>
      <View style={styles.group}>
        <InfoRow icon={Star} label="收藏" value={String(favoriteCount)} styles={styles} theme={theme} />
        <InfoRow icon={List} label="历史" value={String(historyCount)} styles={styles} theme={theme} />
        <InfoRow icon={Activity} label="关于" value="Android 本机阅读器" styles={styles} theme={theme} />
      </View>
      <View style={styles.group}>
        <Text style={styles.panelTitle}>备份 / 恢复</Text>
        <TextInput
          style={styles.input}
          value={backupJson}
          onChangeText={onBackupJsonChange}
          placeholder="粘贴或生成阅读资料 JSON"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <View style={styles.actions}>
          <AppButton label={syncing ? '处理中' : '生成备份'} styles={styles} disabled={syncing} onPress={onExportBackup} />
          <AppButton label={syncing ? '处理中' : '恢复备份'} variant="ghost" styles={styles} disabled={syncing} onPress={onImportBackup} />
          <AppButton label="分享 JSON" variant="ghost" styles={styles} disabled={syncing} onPress={onExportBackupFile} />
          <AppButton label="选择 JSON" variant="ghost" styles={styles} disabled={syncing} onPress={onImportBackupFile} />
          <AppButton label="导出收藏 Markdown" variant="ghost" styles={styles} disabled={syncing} onPress={onExportFavoritesMarkdownFile} />
        </View>
      </View>
      <View style={styles.group}>
        <MenuButton icon={LogIn} label="NodeSeek 登录 / 验证" value={loginState} styles={styles} theme={theme} onPress={() => onShowLoginPanelChange(!showLoginPanel)} />
        {hasNodeSeekLoginCookie ? <MenuButton icon={CheckCircle} label="NodeSeek 签到" value="使用本机登录 Cookie" styles={styles} theme={theme} onPress={onCheckIn} /> : null}
        {showLoginPanel ? (
          <View style={styles.loginPanel}>
            <View style={styles.actions}>
              <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckLogin} />
              <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearLogin} />
              <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => webViewRef.current?.reload()} />
            </View>
            <View style={styles.webViewShell}>
              {loadingLoginPage ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={theme.primary} />
                  <Text style={styles.loadingText}>正在打开 NodeSeek...</Text>
                </View>
              ) : null}
              <WebView
                ref={webViewRef}
                source={{ uri: NODESEEK_URL }}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                userAgent={nodeSeekWebViewUserAgent}
                injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
                onLoadEnd={() => {
                  onSetLoadingLoginPage(false);
                  webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
                  void onRememberNodeSeekCookies({ silent: true });
                }}
                onLoadStart={() => onSetLoadingLoginPage(true)}
                onMessage={onHandleLoginMessage}
                onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}
              />
            </View>
          </View>
        ) : null}
        <MenuButton icon={LogIn} label="妖火登录" value={hasYaohuoCookie ? yaohuoLoginState : '未登录'} styles={styles} theme={theme} onPress={() => onShowYaohuoLoginPanelChange(!showYaohuoLoginPanel)} />
        {showYaohuoLoginPanel ? (
          <View style={styles.loginPanel}>
            <View style={styles.actions}>
              <AppButton label={checking ? '检测中' : '检测登录'} styles={styles} disabled={checking} onPress={onCheckYaohuoLogin} />
              <AppButton label="清除登录" variant="ghost" styles={styles} onPress={onClearYaohuoLogin} />
              <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => yaohuoWebViewRef.current?.reload()} />
            </View>
            <View style={styles.webViewShell}>
              {loadingYaohuoLoginPage ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={theme.primary} />
                  <Text style={styles.loadingText}>正在打开妖火...</Text>
                </View>
              ) : null}
              <WebView
                ref={yaohuoWebViewRef}
                source={{ uri: YAOHUO_LOGIN_URL }}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                onLoadEnd={() => onSetLoadingYaohuoLoginPage(false)}
                onLoadStart={() => onSetLoadingYaohuoLoginPage(true)}
                onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}
              />
            </View>
          </View>
        ) : null}
        <MenuButton icon={LogIn} label="linux.do 验证" value={hasLinuxDoClearance ? `已保存 ${linuxDoCookieNames.join('、') || 'cf_clearance'}` : '未验证'} styles={styles} theme={theme} onPress={() => onShowLinuxDoPanelChange(!showLinuxDoPanel)} />
        {showLinuxDoPanel ? (
          <View style={styles.loginPanel}>
            <View style={styles.actions}>
              <AppButton label={checking ? '检测中' : '检测验证'} styles={styles} disabled={checking} onPress={onCheckLinuxDoCookie} />
              <AppButton label="清除验证" variant="ghost" styles={styles} onPress={onClearLinuxDoCookie} />
              <AppButton
                label="刷新页面"
                variant="ghost"
                styles={styles}
                onPress={onResetLinuxDoWebView}
              />
            </View>
            {linuxDoWebViewError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{linuxDoWebViewError}</Text>
              </View>
            ) : null}
            <View style={styles.webViewShell}>
              {loadingLinuxDoPage ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={theme.primary} />
                  <Text style={styles.loadingText}>正在打开 linux.do...</Text>
                </View>
              ) : null}
              <WebView
                key={linuxDoWebViewKey}
                ref={linuxDoWebViewRef}
                source={{ uri: LINUXDO_VERIFY_URL }}
                javaScriptEnabled
                domStorageEnabled
                cacheEnabled
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                userAgent={linuxDoWebViewUserAgent}
                injectedJavaScript={LINUXDO_WEBVIEW_PROBE_SCRIPT}
                onLoadEnd={(event) => {
                  onSetLoadingLinuxDoPage(false);
                  if (!('code' in event.nativeEvent)) {
                    onSetLinuxDoWebViewError('');
                  }
                  linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
                }}
                onLoadStart={() => {
                  onSetLinuxDoWebViewError('');
                  onSetLoadingLinuxDoPage(true);
                }}
                onMessage={onHandleLinuxDoMessage}
                onError={(event) => {
                  onSetLoadingLinuxDoPage(false);
                  onSetLinuxDoWebViewError(`linux.do 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
                }}
                renderError={() => <View style={styles.webViewErrorPlaceholder} />}
                onRenderProcessGone={() => {
                  onSetLoadingLinuxDoPage(false);
                  onSetLinuxDoWebViewError('linux.do 验证页面已停止，请刷新页面重试。');
                }}
                onShouldStartLoadWithRequest={handleLinuxDoNavigation}
              />
            </View>
          </View>
        ) : null}
      </View>
      <View style={styles.group}>
        <MenuButton icon={LayoutGrid} label="分类节点" value="按来源浏览节点" styles={styles} theme={theme} onPress={() => onShowCategoriesPanelChange(!showCategoriesPanel)} />
        {showCategoriesPanel ? (
          <View style={styles.stack}>
            <AppButton label="刷新分类" styles={styles} onPress={onRefreshCategories} />
            {grouped.map((group) => (
              <View key={group.source} style={styles.categoryGroup}>
                <Text style={styles.panelTitle}>{sourceLabel(group.source)}</Text>
                {group.items.length ? group.items.map((category) => (
                  <View key={categoryKey(category)} style={styles.categoryItem}>
                    <Pressable accessibilityRole="button" style={styles.flex} onPress={() => onSelectCategory(category)}>
                      <Text style={styles.categoryName}>{category.name}</Text>
                      {category.description ? <Text style={styles.meta}>{category.description}</Text> : null}
                      {category.topicCount ? <Text style={styles.meta}>最近 {category.topicCount} 个主题</Text> : null}
                    </Pressable>
                    <AppButton
                      label={isSubscribed(readerData, category) ? '已订阅' : '订阅'}
                      variant="ghost"
                      styles={styles}
                      onPress={() => onToggleSubscription(category)}
                    />
                  </View>
                )) : <EmptyText text="暂无分类" styles={styles} />}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.group}>
        <MenuButton icon={Settings} label="外观设置" value="字号 · 主题 · 配色 · 背景" styles={styles} theme={theme} onPress={() => onShowSettingsPanelChange(!showSettingsPanel)} />
        {showSettingsPanel ? (
          <SettingsPanel readerData={readerData} styles={styles} onUpdateSettings={onUpdateSettings} />
        ) : null}
      </View>
      <View style={styles.group}>
        <MenuButton icon={Activity} label="状态 / 检查" value={statusBusy ? '检查中' : healthSummary || '来源状态'} styles={styles} theme={theme} onPress={onCheckHealth} />
        {healthDetails.length ? (
          <View style={styles.stack}>
            {healthDetails.map((item) => (
              <View key={item.label} style={styles.statusDetailRow}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={[styles.meta, item.ok ? styles.statusOk : styles.statusBad]}>{item.ok ? '可用' : '不可用'} · {item.message}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const MemoizedMoreScreen = memo(MoreScreen, (previous, next) => (
  previous.categories === next.categories
  && previous.checking === next.checking
  && previous.hasNodeSeekLoginCookie === next.hasNodeSeekLoginCookie
  && previous.hasYaohuoCookie === next.hasYaohuoCookie
  && previous.hasLinuxDoClearance === next.hasLinuxDoClearance
  && previous.healthDetails === next.healthDetails
  && previous.healthSummary === next.healthSummary
  && previous.loginState === next.loginState
  && previous.loadingLoginPage === next.loadingLoginPage
  && previous.loadingYaohuoLoginPage === next.loadingYaohuoLoginPage
  && previous.loadingLinuxDoPage === next.loadingLinuxDoPage
  && previous.linuxDoWebViewError === next.linuxDoWebViewError
  && previous.linuxDoWebViewKey === next.linuxDoWebViewKey
  && previous.linuxDoWebViewUserAgent === next.linuxDoWebViewUserAgent
  && previous.nodeSeekWebViewUserAgent === next.nodeSeekWebViewUserAgent
  && previous.readerData.favorites === next.readerData.favorites
  && previous.readerData.history === next.readerData.history
  && previous.readerData.settings === next.readerData.settings
  && previous.readerData.subscriptions === next.readerData.subscriptions
  && previous.backupJson === next.backupJson
  && previous.showCategoriesPanel === next.showCategoriesPanel
  && previous.showLoginPanel === next.showLoginPanel
  && previous.showYaohuoLoginPanel === next.showYaohuoLoginPanel
  && previous.showLinuxDoPanel === next.showLinuxDoPanel
  && previous.showSettingsPanel === next.showSettingsPanel
  && previous.statusBusy === next.statusBusy
  && previous.styles === next.styles
  && previous.syncing === next.syncing
  && previous.theme === next.theme
  && previous.webViewRef === next.webViewRef
  && previous.yaohuoLoginState === next.yaohuoLoginState
  && previous.yaohuoWebViewRef === next.yaohuoWebViewRef
  && previous.linuxDoCookieNames === next.linuxDoCookieNames
  && previous.linuxDoWebViewRef === next.linuxDoWebViewRef
  && previous.onCheckHealth === next.onCheckHealth
  && previous.onCheckIn === next.onCheckIn
  && previous.onCheckLogin === next.onCheckLogin
  && previous.onRememberNodeSeekCookies === next.onRememberNodeSeekCookies
  && previous.onCheckYaohuoLogin === next.onCheckYaohuoLogin
  && previous.onCheckLinuxDoCookie === next.onCheckLinuxDoCookie
  && previous.onClearLogin === next.onClearLogin
  && previous.onClearYaohuoLogin === next.onClearYaohuoLogin
  && previous.onClearLinuxDoCookie === next.onClearLinuxDoCookie
  && previous.handleNodeSeekLoginNavigation === next.handleNodeSeekLoginNavigation
  && previous.handleYaohuoLoginNavigation === next.handleYaohuoLoginNavigation
  && previous.handleLinuxDoNavigation === next.handleLinuxDoNavigation
  && previous.onHandleLoginMessage === next.onHandleLoginMessage
  && previous.onHandleLinuxDoMessage === next.onHandleLinuxDoMessage
  && previous.onImportBackup === next.onImportBackup
  && previous.onExportBackup === next.onExportBackup
  && previous.onExportBackupFile === next.onExportBackupFile
  && previous.onImportBackupFile === next.onImportBackupFile
  && previous.onExportFavoritesMarkdownFile === next.onExportFavoritesMarkdownFile
  && previous.onRefreshCategories === next.onRefreshCategories
  && previous.onSelectCategory === next.onSelectCategory
  && previous.onBackupJsonChange === next.onBackupJsonChange
  && previous.onSetLoadingLoginPage === next.onSetLoadingLoginPage
  && previous.onSetLoadingYaohuoLoginPage === next.onSetLoadingYaohuoLoginPage
  && previous.onSetLoadingLinuxDoPage === next.onSetLoadingLinuxDoPage
  && previous.onSetLinuxDoWebViewError === next.onSetLinuxDoWebViewError
  && previous.onResetLinuxDoWebView === next.onResetLinuxDoWebView
  && previous.onShowCategoriesPanelChange === next.onShowCategoriesPanelChange
  && previous.onShowLoginPanelChange === next.onShowLoginPanelChange
  && previous.onShowYaohuoLoginPanelChange === next.onShowYaohuoLoginPanelChange
  && previous.onShowLinuxDoPanelChange === next.onShowLinuxDoPanelChange
  && previous.onShowSettingsPanelChange === next.onShowSettingsPanelChange
  && previous.onToggleSubscription === next.onToggleSubscription
  && previous.onUpdateSettings === next.onUpdateSettings
));

function SettingsPanel({
  readerData,
  styles,
  onUpdateSettings
}: {
  readerData: ReaderData;
  styles: ReturnType<typeof createStyles>;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const settings = readerData.settings;
  const [trackedKeyword, setTrackedKeyword] = useState('');
  const [blockedKeyword, setBlockedKeyword] = useState('');
  return (
    <View style={styles.stack}>
      <SettingRail title="字号" items={[
        { value: '0.9', label: '小' },
        { value: '1', label: '标准' },
        { value: '1.15', label: '大' },
        { value: '1.25', label: '特大' }
      ]} value={String(settings.fontScale)} styles={styles} onChange={(value) => onUpdateSettings({ fontScale: Number(value) })} />
      <SettingRail title="主题" items={[
        { value: 'system', label: '系统' },
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' }
      ]} value={settings.theme} styles={styles} onChange={(value) => onUpdateSettings({ theme: value as ReaderSettings['theme'] })} />
      <SettingRail title="配色" items={[
        { value: 'sage', label: '豆青' },
        { value: 'coral', label: '赤陶' },
        { value: 'blue', label: '青蓝' },
        { value: 'mint', label: '森绿' },
        { value: 'berry', label: '紫莓' },
        { value: 'noir', label: '墨金' }
      ]} value={settings.palette} styles={styles} onChange={(value) => onUpdateSettings({ palette: value as ReaderSettings['palette'] })} />
      <SettingRail title="背景" items={[
        { value: 'warm', label: '暖白' },
        { value: 'white', label: '豆瓣白' },
        { value: 'gray', label: '浅灰' }
      ]} value={settings.background} styles={styles} onChange={(value) => onUpdateSettings({ background: value as ReaderSettings['background'] })} />
      <SettingRail title="列表密度" items={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
        { value: 'loose', label: '宽松' }
      ]} value={settings.listDensity} styles={styles} onChange={(value) => onUpdateSettings({ listDensity: value as ReaderSettings['listDensity'] })} />
      <SettingRail title="行距" items={[
        { value: 'compact', label: '紧凑' },
        { value: 'standard', label: '标准' },
        { value: 'loose', label: '宽松' }
      ]} value={settings.lineHeight} styles={styles} onChange={(value) => onUpdateSettings({ lineHeight: value as ReaderSettings['lineHeight'] })} />
      <SettingRail title="正文宽度" items={[
        { value: 'narrow', label: '窄' },
        { value: 'standard', label: '标准' },
        { value: 'wide', label: '宽' }
      ]} value={settings.contentWidth} styles={styles} onChange={(value) => onUpdateSettings({ contentWidth: value as ReaderSettings['contentWidth'] })} />
      <SettingRail title="字体" items={[
        { value: 'sans', label: '无衬线' },
        { value: 'serif', label: '衬线' }
      ]} value={settings.fontFamily} styles={styles} onChange={(value) => onUpdateSettings({ fontFamily: value as ReaderSettings['fontFamily'] })} />
      <View style={styles.settingGroup}>
        <Text style={styles.panelTitle}>追踪关键词</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={trackedKeyword}
            onChangeText={setTrackedKeyword}
            placeholder="关键词"
            placeholderTextColor={styles.meta.color}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppButton
            label="添加"
            styles={styles}
            onPress={() => {
              const value = trackedKeyword.trim();
              if (value) {
                onUpdateSettings({ trackedKeywords: appendUnique(settingsList(settings.trackedKeywords), value) });
                setTrackedKeyword('');
              }
            }}
          />
        </View>
        <ChipList items={settings.trackedKeywords} styles={styles} onRemove={(value) => onUpdateSettings({ trackedKeywords: removeString(settingsList(settings.trackedKeywords), value) })} />
      </View>
      <View style={styles.settingGroup}>
        <Text style={styles.panelTitle}>屏蔽关键词</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={[styles.input, styles.flex]}
            value={blockedKeyword}
            onChangeText={setBlockedKeyword}
            placeholder="关键词"
            placeholderTextColor={styles.meta.color}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AppButton
            label="添加"
            styles={styles}
            onPress={() => {
              const value = blockedKeyword.trim();
              if (value) {
                onUpdateSettings({ blockedKeywords: appendUnique(settingsList(settings.blockedKeywords), value) });
                setBlockedKeyword('');
              }
            }}
          />
        </View>
        <ChipList items={settings.blockedKeywords} styles={styles} onRemove={(value) => onUpdateSettings({ blockedKeywords: removeString(settingsList(settings.blockedKeywords), value) })} />
      </View>
      {settings.blockedUsers.length ? (
        <View style={styles.settingGroup}>
          <Text style={styles.panelTitle}>已屏蔽用户</Text>
          <ChipList items={settings.blockedUsers} styles={styles} onRemove={(value) => onUpdateSettings({ blockedUsers: removeString(settingsList(settings.blockedUsers), value) })} />
        </View>
      ) : null}
      {settings.blockedCategories.length ? (
        <View style={styles.settingGroup}>
          <Text style={styles.panelTitle}>已屏蔽节点</Text>
          <ChipList items={settings.blockedCategories} styles={styles} onRemove={(value) => onUpdateSettings({ blockedCategories: removeString(settingsList(settings.blockedCategories), value) })} />
        </View>
      ) : null}
    </View>
  );
}

function ChipList({
  items,
  styles,
  onRemove
}: {
  items: string[];
  styles: ReturnType<typeof createStyles>;
  onRemove: (value: string) => void;
}) {
  if (!items.length) {
    return <Text style={styles.meta}>暂无</Text>;
  }
  return (
    <View style={styles.chipWrap}>
      {items.map((item) => (
        <Pressable accessibilityRole="button" key={item} style={styles.removableChip} onPress={() => onRemove(item)}>
          <Text style={styles.pillText}>{item} ×</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TopicScreen({
  actionBusy,
  canUseNodeSeekActions,
  canUseYaohuoActions,
  contentWidth,
  htmlBaseStyle,
  htmlIgnoredStyles,
  htmlRenderers,
  htmlRenderersProps,
  htmlTagsStyles,
  expandedQuotesRef,
  loadedQuotedRepliesRef,
  loadingMoreReplies,
  loadingQuotedFloorsRef,
  commentQuery,
  focusMode,
  quoteStateVersion,
  readerData,
  readerMode,
  replyComposerOpen,
  replyContent,
  replyFilter,
  replyTarget,
  replyHasMore,
  replies,
  selectedTopic,
  sourceReplies,
  styles,
  theme,
  topic,
  topicBusy,
  topicError,
  topicScrollRef,
  unreadReplyCount,
  onBack,
  onCommentQueryChange,
  onCopyReplyMarkdown,
  onCopyTopicLink,
  onInteract,
  onYaohuoFavorite,
  onYaohuoVote,
  onLoadMoreReplies,
  onOpenOriginal,
  onReplyComposerOpenChange,
  onReplyContentChange,
  onReplyFilterChange,
  onReplyToFloor,
  onRefreshTopic,
  onReaderModeChange,
  onFocusModeChange,
  onVerifyLinuxDo,
  onSubmitReply,
  onTopicScroll,
  onToggleQuotedFloor,
  onToggleFavorite
}: {
  actionBusy: boolean;
  canUseNodeSeekActions: boolean;
  canUseYaohuoActions: boolean;
  contentWidth: number;
  htmlBaseStyle: HtmlBaseStyle;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderers: HtmlRenderers;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  expandedQuotesRef: RefObject<Record<string, boolean>>;
  loadedQuotedRepliesRef: RefObject<Record<number, Reply>>;
  loadingMoreReplies: boolean;
  loadingQuotedFloorsRef: RefObject<Record<string, boolean>>;
  commentQuery: string;
  focusMode: boolean;
  quoteStateVersion: number;
  readerData: ReaderData;
  readerMode: boolean;
  replyComposerOpen: boolean;
  replyContent: string;
  replyFilter: ReplyFilter;
  replyTarget: YaohuoReplyTarget | null;
  replyHasMore: boolean;
  replies: Reply[];
  selectedTopic: Topic | null;
  sourceReplies: Reply[];
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topic: TopicDetail | null;
  topicBusy: boolean;
  topicError: string;
  topicScrollRef: RefObject<FlatList<TopicListItem> | null>;
  unreadReplyCount: number;
  onBack: () => void;
  onCommentQueryChange: (value: string) => void;
  onCopyReplyMarkdown: (reply: Reply, floor: number) => void;
  onCopyTopicLink: () => void;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onYaohuoFavorite: () => void;
  onYaohuoVote: (voteId: string) => void;
  onLoadMoreReplies: () => void;
  onOpenOriginal: (url: string) => void;
  onReplyComposerOpenChange: (open: boolean) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onReplyToFloor: (reply: Reply) => void;
  onRefreshTopic: () => void;
  onReaderModeChange: (value: boolean) => void;
  onFocusModeChange: (value: boolean) => void;
  onVerifyLinuxDo: () => void;
  onSubmitReply: () => void;
  onTopicScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
  onToggleFavorite: (topic: Topic) => void;
}) {
  const item = topic || selectedTopic;
  const topicLoading = topicBusy || (!topic && !topicError);
  const canWriteNodeSeek = Boolean(item && item.source === 'nodeseek' && canUseNodeSeekActions);
  const canWriteYaohuo = Boolean(item && item.source === 'yaohuo' && canUseYaohuoActions);
  const canWrite = canWriteNodeSeek || canWriteYaohuo;
  const itemSource = item?.source;
  const repliesByFloor = useMemo(() => {
    const next = new Map<number, Reply>();
    sourceReplies.forEach((reply) => {
      if (typeof reply.floor === 'number') {
        next.set(reply.floor, reply);
      }
    });
    Object.values(loadedQuotedRepliesRef.current).forEach((reply) => {
      if (reply.floor) {
        next.set(reply.floor, reply);
      }
    });
    return next;
  }, [loadedQuotedRepliesRef, quoteStateVersion, sourceReplies]);
  const [floorOpen, setFloorOpen] = useState(false);
  const newReplyFloorStart = useMemo(() => {
    if (unreadReplyCount <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    const floors = sourceReplies.map((reply) => reply.floor).filter((floor): floor is number => typeof floor === 'number');
    if (!floors.length) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(...floors) - unreadReplyCount + 1;
  }, [sourceReplies, unreadReplyCount]);

  const topicColumnStyle = useMemo(() => ({ width: contentWidth }), [contentWidth]);
  const topicContentHtml = topic ? (readerMode ? readerModeHtml(topic.contentHtml) : topic.contentHtml) : '';
  const topicContentItems = useMemo<TopicListItem[]>(() => (
    topic
      ? splitTopicContentHtml(topicContentHtml).map((html, index) => ({
        type: 'content',
        key: `topic-content-${index}-${stableTextHash(html)}`,
        html
      }))
      : []
  ), [topic, topicContentHtml]);
  const replyItems = useMemo<TopicListItem[]>(() => replies.map((reply) => ({
    type: 'reply',
    key: getReplyKey(reply),
    reply,
    replyFloor: reply.floor ?? 0
  })), [replies]);
  const topicListItems = useMemo<TopicListItem[]>(() => {
    const items = [...topicContentItems];
    if (!topicLoading) {
      items.push({ type: 'replyControls', key: 'reply-controls' });
      if (canWrite && replyComposerOpen) {
        items.push({ type: 'replyComposer', key: 'reply-composer' });
      }
      if (replyItems.length) {
        items.push(...replyItems);
      } else {
        items.push({ type: 'emptyReplies', key: 'empty-replies' });
      }
    }
    return items;
  }, [canWrite, replyComposerOpen, replyItems, topicContentItems, topicLoading]);
  const jumpToFloor = useCallback((floor: number) => {
    const index = topicListItems.findIndex((entry) => entry.type === 'reply' && entry.replyFloor === floor);
    if (index >= 0) {
      topicScrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });
      setFloorOpen(false);
    }
  }, [topicListItems, topicScrollRef]);
  const renderReplyItem = useCallback<ListRenderItem<TopicListItem>>(({ item: listItem }) => {
    if (listItem.type === 'content') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <View style={styles.articleBody}>
            <MemoizedHtmlContent
              contentWidth={contentWidth}
              html={listItem.html}
            />
          </View>
        </View>
      );
    }

    if (listItem.type === 'replyControls') {
      return (
        <View style={[styles.replyHeader, topicColumnStyle]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>回复列表 <Text style={styles.countText}>{sourceReplies.length} 条</Text></Text>
            {canWrite ? (
              <AppButton
                label={replyComposerOpen ? '收起回复' : '写回复'}
                variant={replyComposerOpen ? 'ghost' : 'default'}
                styles={styles}
                onPress={() => onReplyComposerOpenChange(!replyComposerOpen)}
              />
            ) : null}
          </View>
          <PillRail
            items={[
              { value: 'all', label: '全部' },
              { value: 'author', label: '只看楼主' },
              { value: 'images', label: '只看带图' },
              { value: 'newest', label: '倒序' }
            ]}
            value={replyFilter}
            styles={styles}
            onChange={(value) => onReplyFilterChange(value as ReplyFilter)}
          />
          {unreadReplyCount > 0 ? <Text style={styles.noticeText}>新增 {unreadReplyCount} 条回复</Text> : null}
          <View style={styles.searchRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={commentQuery}
              onChangeText={onCommentQueryChange}
              placeholder="评论内查找"
              placeholderTextColor={theme.muted}
            />
            {commentQuery ? <IconButton icon={X} label="清空查找" styles={styles} theme={theme} onPress={() => onCommentQueryChange('')} /> : null}
          </View>
          <View style={styles.actions}>
            <AppButton compact label={floorOpen ? '收起楼层目录' : '楼层目录'} variant="ghost" styles={styles} onPress={() => setFloorOpen((value) => !value)} />
          </View>
          {floorOpen ? (
            <View style={styles.floorIndex}>
              {sourceReplies.map((reply, index) => {
                const floor = reply.floor ?? index + 1;
                return (
                  <Pressable key={`${floor}-${reply.createdAt}`} accessibilityRole="button" style={styles.floorIndexItem} onPress={() => jumpToFloor(floor)}>
                    <Text style={styles.meta}>#{floor} {reply.author || '未知作者'}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      );
    }

    if (listItem.type === 'replyComposer') {
      return (
        <View style={[styles.replyBox, topicColumnStyle]}>
          <Text style={styles.panelTitle}>{replyTarget ? `回复 #${replyTarget.floor}${replyTarget.author ? ` · ${replyTarget.author}` : ''}` : '回复'}</Text>
          <TextInput
            style={[styles.input, styles.replyInput]}
            value={replyContent}
            onChangeText={onReplyContentChange}
            placeholder={replyTarget ? '输入楼层回复内容' : '输入回复内容'}
            placeholderTextColor={theme.muted}
            multiline
          />
          {replyTarget ? <AppButton label="取消楼层回复" variant="ghost" styles={styles} disabled={actionBusy} onPress={() => onReplyComposerOpenChange(false)} /> : null}
          <AppButton label="发送回复" styles={styles} disabled={actionBusy || !replyContent.trim()} onPress={onSubmitReply} />
        </View>
      );
    }

    if (listItem.type === 'emptyReplies') {
      return (
        <View style={[styles.replyListItem, topicColumnStyle]}>
          <EmptyText text="暂无回复" styles={styles} />
        </View>
      );
    }

    return (
      <View style={[styles.replyListItem, topicColumnStyle]}>
        <MemoizedReplyCard
          actionBusy={actionBusy}
          canWrite={canWrite}
          contentWidth={Math.max(240, contentWidth - 28)}
          expandedQuotes={expandedQuotesRef.current}
          loadedQuotedReplies={loadedQuotedRepliesRef.current}
          loadingQuotedFloors={loadingQuotedFloorsRef.current}
          reply={listItem.reply}
          replyFloor={listItem.replyFloor}
          repliesByFloor={repliesByFloor}
          styles={styles}
          theme={theme}
          onInteract={onInteract}
          onCopyReplyMarkdown={onCopyReplyMarkdown}
          onReplyToFloor={onReplyToFloor}
          onToggleQuotedFloor={onToggleQuotedFloor}
          query={commentQuery}
          isNew={typeof listItem.reply.floor === 'number' && listItem.reply.floor >= newReplyFloorStart}
          source={itemSource}
        />
      </View>
    );
  }, [
    actionBusy,
    canWrite,
    commentQuery,
    contentWidth,
    expandedQuotesRef,
    floorOpen,
    jumpToFloor,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    newReplyFloorStart,
    onCommentQueryChange,
    onCopyReplyMarkdown,
    onInteract,
    onReplyComposerOpenChange,
    onReplyContentChange,
    onReplyFilterChange,
    onReplyToFloor,
    onSubmitReply,
    onToggleQuotedFloor,
    quoteStateVersion,
    itemSource,
    replyComposerOpen,
    replyContent,
    replyFilter,
    replyTarget,
    repliesByFloor,
    sourceReplies.length,
    styles,
    theme,
    topicColumnStyle
  ]);

  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }

  const listHeader = (
    <View style={styles.topicHeaderStack}>
      <View style={[styles.article, topicColumnStyle]}>
        {!focusMode ? (
          <View style={styles.topicMetaStack}>
            <Text style={styles.sourceText}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
            <Text style={styles.meta}>{item.author || '未知作者'} · {formatDateTime(item.createdAt)} · {item.replyCount} 回复{item.viewCount ? ` · ${item.viewCount} 浏览` : ''}</Text>
            {item.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{item.accessRequirement.label}</Text> : null}
          </View>
        ) : null}
        <Text style={styles.articleTitle}>{item.title}</Text>
        {canWriteNodeSeek ? (
          <View style={styles.topicPrimaryActions}>
            <IconButton tiny ghost icon={ThumbsUp} label={`点赞 ${topic?.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
            <IconButton tiny ghost icon={Heart} label={`感谢 ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
          </View>
        ) : null}
        {canWriteYaohuo ? (
          <View style={styles.topicPrimaryActions}>
            <IconButton tiny ghost icon={BookMarked} label="原站收藏" styles={styles} theme={theme} disabled={actionBusy} onPress={onYaohuoFavorite} />
            {(topic?.voteOptions || []).map((option) => (
              <IconButton
                key={option.id}
                tiny
                ghost
                icon={CheckCircle}
                label={`投票 ${option.label}${typeof option.count === 'number' ? ` ${option.count}` : ''}`}
                styles={styles}
                theme={theme}
                disabled={actionBusy}
                onPress={() => onYaohuoVote(option.id)}
              />
            ))}
          </View>
        ) : null}
        {topicError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{topicError}</Text>
            <View style={styles.actions}>
              {item.source === 'linuxdo' && topicError.includes('Cloudflare') ? <AppButton label="去验证" styles={styles} onPress={onVerifyLinuxDo} /> : null}
              <AppButton label="重试" styles={styles} onPress={onRefreshTopic} />
            </View>
          </View>
        ) : null}
        {!topic && !topicError ? <LoadingState text="正在读取主题..." styles={styles} theme={theme} /> : null}
      </View>
    </View>
  );

  return (
    <TRenderEngineProvider baseStyle={htmlBaseStyle} allowedStyles={HTML_ALLOWED_INLINE_STYLES} ignoredStyles={htmlIgnoredStyles} tagsStyles={htmlTagsStyles} ignoredDomTags={HTML_IGNORED_DOM_TAGS}>
      <RenderHTMLConfigProvider
        renderers={htmlRenderers}
        renderersProps={htmlRenderersProps}
        enableExperimentalBRCollapsing
        enableExperimentalGhostLinesPrevention
        enableExperimentalMarginCollapsing
      >
        <View style={styles.topicTopBar}>
          <IconButton icon={ChevronLeft} compact ghost label="返回" styles={styles} theme={theme} onPress={onBack} />
          {!focusMode ? (!canWrite ? <Text style={styles.topicTopHint}>只读 · 原站回复</Text> : <Text style={styles.topicTopHint}>{item.source === 'yaohuo' ? '妖火可回复' : 'NodeSeek 可回复'}</Text>) : <Text style={styles.topicTopHint}>专注模式</Text>}
          <ScrollView horizontal style={styles.topicTopActionScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicTopActions}>
            <IconButton icon={Copy} compact ghost iconOnly label="复制链接" styles={styles} theme={theme} onPress={onCopyTopicLink} />
            <IconButton icon={RefreshCw} compact ghost iconOnly label="刷新主题" styles={styles} theme={theme} onPress={onRefreshTopic} />
            <IconButton icon={List} compact ghost iconOnly label="楼层目录" styles={styles} theme={theme} active={floorOpen} onPress={() => setFloorOpen((value) => !value)} />
            <IconButton icon={BookMarked} compact ghost iconOnly label="Reader Mode" styles={styles} theme={theme} active={readerMode} onPress={() => onReaderModeChange(!readerMode)} />
            <IconButton icon={MoreHorizontal} compact ghost iconOnly label="专注模式" styles={styles} theme={theme} active={focusMode} onPress={() => onFocusModeChange(!focusMode)} />
            <IconButton icon={Star} compact ghost iconOnly label={isFavorite(readerData, item) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, item)} onPress={() => onToggleFavorite(item)} />
            <IconButton icon={ExternalLink} compact ghost iconOnly label="原站" styles={styles} theme={theme} onPress={() => onOpenOriginal(item.url)} />
          </ScrollView>
        </View>
        <FlatList
          ref={topicScrollRef}
          style={[styles.content, styles.topicContent]}
          contentContainerStyle={[styles.contentInner, styles.topicContentInner]}
          data={topicListItems}
          keyExtractor={topicListItemKey}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={onTopicScroll}
          onScrollEndDrag={onTopicScroll}
          onEndReachedThreshold={0.55}
          onEndReached={() => {
            if (replyHasMore && !loadingMoreReplies) {
              onLoadMoreReplies();
            }
          }}
          extraData={quoteStateVersion}
          {...REPLY_LIST_PERFORMANCE_PROPS}
          ListHeaderComponent={listHeader}
          ListFooterComponent={replyHasMore ? (
            <View style={[styles.topicFooter, topicColumnStyle]}>
              <AppButton label={loadingMoreReplies ? '正在加载...' : '加载更多回复'} styles={styles} disabled={loadingMoreReplies} onPress={onLoadMoreReplies} />
            </View>
          ) : null}
          renderItem={renderReplyItem}
        />
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
}

function HtmlContent({
  contentWidth,
  html
}: {
  contentWidth: number;
  html: string | undefined;
}) {
  const source = useMemo(() => ({ html: html || '<p></p>' }), [html]);
  return (
    <RenderHTMLSource
      contentWidth={contentWidth}
      source={source}
    />
  );
}

function ReplyCard({
  actionBusy,
  canWrite,
  contentWidth,
  expandedQuotes,
  isNew,
  loadedQuotedReplies,
  loadingQuotedFloors,
  query,
  reply,
  replyFloor,
  repliesByFloor,
  source,
  styles,
  theme,
  onInteract,
  onCopyReplyMarkdown,
  onReplyToFloor,
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  isNew?: boolean;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  query: string;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onCopyReplyMarkdown: (reply: Reply, floor: number) => void;
  onReplyToFloor: (reply: Reply) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
  const highlightedHtml = useMemo(() => highlightHtml(reply.contentHtml, query), [query, reply.contentHtml]);
  return (
    <View style={styles.replyCard}>
      <View style={styles.replyHead}>
        <View style={styles.replyFloorBadge}>
          <Text style={styles.replyFloorText}>#{reply.floor ?? '-'}</Text>
        </View>
        <View style={styles.replyAuthorBlock}>
          <Text style={styles.replyAuthor} numberOfLines={1}>{reply.author || '未知作者'}</Text>
          <Text style={styles.replyTime}>{formatDateTime(reply.createdAt)}</Text>
        </View>
        {isNew ? <Text style={styles.topicAccessBadge}>新增</Text> : null}
      </View>
      {quotedFloors.length ? (
        <View style={styles.quoteStack}>
          {quotedFloors.map((quotedFloor) => {
            const key = `${replyFloor}:${quotedFloor}`;
            const quotedReply = repliesByFloor.get(quotedFloor) || loadedQuotedReplies[quotedFloor];
            const expanded = Boolean(expandedQuotes[key]);
            const loading = Boolean(loadingQuotedFloors[key]);
            return (
              <View key={key} style={styles.quoteBox}>
                <View style={styles.actions}>
                  <AppButton
                    label={loading ? '读取引用' : expanded ? `收起引用 #${quotedFloor}` : `展开引用 #${quotedFloor}`}
                    variant="ghost"
                    styles={styles}
                    disabled={loading}
                    onPress={() => onToggleQuotedFloor({ replyFloor, quotedFloor, quotedReply })}
                  />
                  {quotedReply ? <Text style={styles.meta}>已加载</Text> : <Text style={styles.meta}>引用楼层未加载</Text>}
                </View>
                {expanded && quotedReply ? (
                  <View style={styles.quoteBody}>
                    <Text style={styles.replyMeta}>引用 #{quotedFloor} · {quotedReply.author || '未知作者'}</Text>
                    <MemoizedHtmlContent
                      contentWidth={Math.max(240, contentWidth - 44)}
                      html={quotedReply.contentHtml}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      <View style={styles.replyBody}>
        <MemoizedHtmlContent
          contentWidth={contentWidth}
          html={highlightedHtml}
        />
      </View>
      <View style={styles.replyActionRow}>
        <IconButton tiny ghost icon={Copy} label="复制楼层引用" styles={styles} theme={theme} onPress={() => onCopyReplyMarkdown(reply, reply.floor ?? replyFloor)} />
      </View>
      {canWrite && source === 'nodeseek' ? (
        <View style={styles.replyActionRow}>
          <IconButton tiny ghost icon={ThumbsUp} label={`点赞 ${reply.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
          <IconButton tiny ghost icon={Heart} label={`感谢 ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
        </View>
      ) : null}
      {canWrite && source === 'yaohuo' ? (
        <View style={styles.replyActionRow}>
          <IconButton tiny ghost icon={MessageCircle} label="回复" styles={styles} theme={theme} disabled={actionBusy} onPress={() => onReplyToFloor(reply)} />
        </View>
      ) : null}
    </View>
  );
}

function ImagePreviewModal({
  preview,
  styles,
  onClose,
  onNext,
  onPrevious,
  onSave,
  onSelect
}: {
  preview: ImagePreviewList | null;
  styles: ReturnType<typeof createStyles>;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
}) {
  const { width, height } = useWindowDimensions();
  const [zoomed, setZoomed] = useState(false);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const lastTapRef = useRef(0);
  const previewKey = preview ? `${preview.index}:${preview.urls.join('|')}` : '';
  useEffect(() => {
    setZoomed(false);
    setImagePreviewLoading(Boolean(preview));
    setImagePreviewFailed(false);
  }, [previewKey]);

  if (!preview || preview.urls.length === 0) {
    return null;
  }
  const uri = preview.urls[preview.index] || preview.urls[0];
  const hasMany = preview.urls.length > 1;
  const imageWidth = zoomed ? width * 1.8 : width;
  const imageHeight = zoomed ? height * 1.8 : height;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.imagePreviewOverlay}>
        <View style={styles.imagePreviewTopBar}>
          <Text style={styles.imagePreviewCount}>{preview.index + 1} / {preview.urls.length}</Text>
          <View style={styles.imagePreviewTopActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={zoomed ? '还原图片' : '放大图片'} style={styles.imagePreviewTextButton} onPress={() => setZoomed((current) => !current)}>
              <Text style={styles.imagePreviewButtonText}>{zoomed ? '还原' : '放大'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="保存图片" style={styles.imagePreviewTextButton} onPress={onSave}>
              <Text style={styles.imagePreviewButtonText}>保存</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
              <X size={22} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>
        <ScrollView
          horizontal
          style={styles.imagePreviewScroll}
          contentContainerStyle={styles.imagePreviewScrollContent}
          showsHorizontalScrollIndicator={false}
        >
          <ScrollView
            style={[styles.imagePreviewVerticalScroll, { width: imageWidth }]}
            contentContainerStyle={[styles.imagePreviewVerticalContent, { minHeight: imageHeight }]}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={() => {
                const now = Date.now();
                if (now - lastTapRef.current < 280) {
                  setZoomed((current) => !current);
                }
                lastTapRef.current = now;
              }}
            >
              <Image
                source={{ uri }}
                style={[styles.imagePreviewImage, { width: imageWidth, height: imageHeight }]}
                resizeMode="contain"
                onLoadStart={() => {
                  setImagePreviewLoading(true);
                  setImagePreviewFailed(false);
                }}
                onLoadEnd={() => setImagePreviewLoading(false)}
                onError={() => {
                  setImagePreviewLoading(false);
                  setImagePreviewFailed(true);
                }}
              />
            </Pressable>
            {imagePreviewLoading ? (
              <View style={styles.imagePreviewState}>
                <ActivityIndicator color="#ffffff" />
                <Text style={styles.imagePreviewStateText}>图片加载中...</Text>
              </View>
            ) : null}
            {imagePreviewFailed ? (
              <View style={styles.imagePreviewState}>
                <Text style={styles.imagePreviewStateText}>图片加载失败</Text>
              </View>
            ) : null}
          </ScrollView>
        </ScrollView>
        {hasMany ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewThumbnailRail} contentContainerStyle={styles.imagePreviewThumbnailContent}>
            {preview.urls.map((url, index) => (
              <Pressable key={`${url}-${index}`} accessibilityRole="button" accessibilityLabel={`查看第 ${index + 1} 张图片`} style={[styles.imagePreviewThumbnail, index === preview.index && styles.imagePreviewThumbnailActive]} onPress={() => onSelect(index)}>
                <Image source={{ uri: url }} style={styles.imagePreviewThumbnailImage} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {hasMany ? (
          <View style={styles.imagePreviewControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一张图片" style={styles.imagePreviewControl} onPress={onPrevious}>
              <ChevronLeft size={25} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="下一张图片" style={styles.imagePreviewControl} onPress={onNext}>
              <ChevronRight size={25} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function HighlightedText({
  highlightStyle,
  numberOfLines,
  query,
  style,
  text
}: {
  highlightStyle: StyleProp<TextStyle>;
  numberOfLines?: number;
  query: string;
  style: StyleProp<TextStyle>;
  text: string;
}) {
  const parts = useMemo(() => highlightTextParts(text, query), [query, text]);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) => (
        <Text key={`${part.text}-${index}`} style={part.highlighted ? highlightStyle : undefined}>{part.text}</Text>
      ))}
    </Text>
  );
}

function TopicCard({
  highlightQuery = '',
  topic,
  readerState,
  swipeAction,
  styles,
  theme,
  onOpenTopic
}: {
  highlightQuery?: string;
  topic: Topic;
  readerState: TopicListItemState;
  swipeAction?: TopicSwipeActionConfig;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isSwipeOpenRef = useRef(false);
  const animateSwipe = useCallback((open: boolean) => {
    isSwipeOpenRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -LIST_SWIPE_ACTION_WIDTH : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 90
    }).start();
  }, [translateX]);
  const openTopicPress = useCallback(() => {
    if (isSwipeOpenRef.current) {
      animateSwipe(false);
      return;
    }
    onOpenTopic(topic);
  }, [animateSwipe, onOpenTopic, topic]);
  const runSwipeAction = useCallback(() => {
    swipeAction?.onPress(topic);
    animateSwipe(false);
  }, [animateSwipe, swipeAction, topic]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Boolean(swipeAction) && shouldCaptureListSwipe(gesture.dx, gesture.dy),
    onPanResponderMove: (_event, gesture) => {
      const start = isSwipeOpenRef.current ? -LIST_SWIPE_ACTION_WIDTH : 0;
      translateX.setValue(clampListSwipeTranslate(start + gesture.dx));
    },
    onPanResponderRelease: (_event, gesture) => {
      const start = isSwipeOpenRef.current ? -LIST_SWIPE_ACTION_WIDTH : 0;
      animateSwipe(Boolean(swipeAction) && shouldOpenListSwipeAction(start + gesture.dx, gesture.vx));
    },
    onPanResponderTerminate: () => animateSwipe(isSwipeOpenRef.current)
  }), [animateSwipe, swipeAction, translateX]);
  const ActionIcon = swipeAction?.kind === 'delete' ? X : Star;
  const swipeActionLabel = swipeAction?.kind === 'delete'
    ? '删除'
    : readerState.favorite ? '取消收藏' : '收藏';
  const metaParts = [
    topic.author || '未知作者',
    `${topic.replyCount} 回复`,
    topic.viewCount ? `${topic.viewCount} 浏览` : '',
    readerState.favorite ? '已收藏' : '',
    readerState.read ? '已读' : '',
    readerState.tracked ? '追踪命中' : '',
    topic.duplicateSources?.length ? `同链：${topic.duplicateSources.join('、')}` : ''
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.topicSwipeShell}>
      {swipeAction ? (
        <View style={[styles.topicSwipeAction, swipeAction.kind === 'delete' && styles.topicSwipeActionDanger]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={swipeActionLabel}
            android_ripple={androidRipple(theme.primarySoft)}
            style={styles.topicSwipeActionButton}
            onPress={runSwipeAction}
          >
            <ActionIcon size={18} color={swipeAction.kind === 'delete' ? theme.danger : theme.primary} strokeWidth={2} />
            <Text style={[styles.topicSwipeActionText, swipeAction.kind === 'delete' && styles.topicSwipeActionTextDanger]}>{swipeActionLabel}</Text>
          </Pressable>
        </View>
      ) : null}
      <Animated.View
        {...(swipeAction ? panResponder.panHandlers : {})}
        style={[
          styles.topicCard,
          readerState.tracked && styles.topicCardTracked,
          { transform: [{ translateX }] }
        ]}
      >
        <Pressable accessibilityRole="button" android_ripple={androidRipple(theme.primarySoft)} style={[styles.topicCardPressable, readerState.read && styles.topicCardRead]} onPress={openTopicPress}>
          <View style={styles.topicCardHead}>
            <Text style={[styles.sourceText, styles.topicCardSource]} numberOfLines={1}>{sourceLabel(topic.source)}{topic.category ? ` · ${topic.category}` : ''}</Text>
            <Text style={styles.timeText} numberOfLines={1}>{formatRelativeTime(topic.lastReplyAt || topic.createdAt)}</Text>
          </View>
          <HighlightedText style={styles.cardTitle} highlightStyle={styles.highlightText} numberOfLines={readerState.listDensity === 'loose' ? 3 : 2} text={topic.title || '无标题'} query={highlightQuery} />
          {topic.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{topic.accessRequirement.label}</Text> : null}
          {topic.excerpt && readerState.listDensity === 'loose' ? <HighlightedText style={styles.excerpt} highlightStyle={styles.highlightText} numberOfLines={2} text={topic.excerpt} query={highlightQuery} /> : null}
        </Pressable>
        <View style={[styles.topicMetaRow, readerState.read && styles.topicCardRead]}>
          <Text style={[styles.meta, styles.topicMetaText]} numberOfLines={1}>{metaParts}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

function NavBar({
  active,
  styles,
  theme,
  onChange
}: {
  active: Screen;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onChange: (screen: Screen) => void;
}) {
  const items: Array<{ value: Screen; label: string; icon: LucideIcon }> = [
    { value: 'feed', label: '首页', icon: Home },
    { value: 'search', label: '搜索', icon: Search },
    { value: 'library', label: '收藏', icon: Star },
    { value: 'more', label: '更多', icon: MoreHorizontal }
  ];
  return (
    <View style={styles.nav}>
      {items.map((item) => {
        const Icon = item.icon;
        const selected = active === item.value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            android_ripple={androidRipple(theme.primarySoft)}
            style={[styles.navItem, selected && styles.navItemActive]}
            onPress={() => onChange(item.value)}
          >
            <Icon size={21} color={selected ? theme.primary : theme.muted} strokeWidth={1.8} />
            <Text style={[styles.navText, selected && styles.navTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PillRail({
  items,
  variant = 'pills',
  value,
  styles,
  onChange
}: {
  items: Array<{ value: string; label: string }>;
  variant?: 'pills' | 'tabs';
  value: string;
  styles: ReturnType<typeof createStyles>;
  onChange: (value: string) => void;
}) {
  const isTabs = variant === 'tabs';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={isTabs ? styles.tabRail : styles.pillRail}>
      {items.map((item) => (
        <Pressable
          hitSlop={TOUCH_HIT_SLOP}
          key={`${item.value}-${item.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item.value }}
          style={isTabs ? [styles.tab, value === item.value && styles.tabActive] : [styles.pill, value === item.value && styles.pillActive]}
          onPress={() => onChange(item.value)}
        >
          <Text style={isTabs ? [styles.tabText, value === item.value && styles.tabTextActive] : [styles.pillText, value === item.value && styles.pillTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SettingRail({
  title,
  items,
  value,
  styles,
  onChange
}: {
  title: string;
  items: Array<{ value: string; label: string }>;
  value: string;
  styles: ReturnType<typeof createStyles>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.settingGroup}>
      <Text style={styles.panelTitle}>{title}</Text>
      <PillRail items={items} value={value} styles={styles} onChange={onChange} />
    </View>
  );
}

function MenuButton({
  icon,
  label,
  value,
  styles,
  theme,
  onPress
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  return (
    <Pressable accessibilityRole="button" style={styles.menuButton} onPress={onPress}>
      <View style={styles.menuIcon}>
        <Icon size={19} color={theme.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.meta} numberOfLines={2}>{value}</Text>
      </View>
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
  styles,
  theme
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
}) {
  const Icon = icon;
  return (
    <View style={styles.menuButton}>
      <View style={styles.menuIcon}>
        <Icon size={19} color={theme.primary} strokeWidth={1.8} />
      </View>
      <Text style={[styles.menuLabel, styles.flex]}>{label}</Text>
      <Text style={styles.meta} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function FloatingIconButton({
  disabled = false,
  icon,
  label,
  loading = false,
  styles,
  theme,
  onPress
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      android_ripple={androidRipple(theme.primarySoft, true)}
      disabled={disabled}
      style={[styles.floatingIconButton, disabled && styles.buttonDisabled]}
      onPress={onPress}
    >
      {loading ? <ActivityIndicator color={theme.primary} size="small" /> : <Icon size={20} color={theme.primary} strokeWidth={1.9} />}
    </Pressable>
  );
}

function IconButton({
  active = false,
  compact = false,
  disabled = false,
  ghost = false,
  iconOnly = false,
  icon,
  label,
  styles,
  tiny = false,
  theme,
  onPress
}: {
  active?: boolean;
  compact?: boolean;
  disabled?: boolean;
  ghost?: boolean;
  iconOnly?: boolean;
  icon: LucideIcon;
  label: string;
  styles: ReturnType<typeof createStyles>;
  tiny?: boolean;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const iconSize = tiny ? 13 : iconOnly ? 14 : compact ? 14 : 17;
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      android_ripple={androidRipple(theme.primarySoft, iconOnly || tiny)}
      style={[styles.button, ghost && styles.buttonGhost, compact && styles.buttonCompact, iconOnly && styles.buttonIconOnly, tiny && styles.buttonTiny, active && !iconOnly && styles.buttonActive, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Icon size={iconSize} color={active ? theme.primary : theme.ink} fill={active ? theme.primary : 'none'} strokeWidth={1.8} />
      {iconOnly ? null : <Text style={[styles.buttonText, compact && styles.buttonTextCompact, tiny && styles.buttonTextTiny, active && styles.buttonTextActive]}>{label}</Text>}
    </Pressable>
  );
}

function AppButton({
  compact = false,
  disabled = false,
  label,
  variant = 'default',
  styles,
  onPress
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  variant?: 'default' | 'ghost';
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.button, compact && styles.buttonCompact, variant === 'ghost' && styles.buttonGhost, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact]}>{label}</Text>
    </Pressable>
  );
}

function EmptyText({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function LoadingState({ text, styles, theme }: { text: string; styles: ReturnType<typeof createStyles>; theme: ReaderTheme }) {
  return (
    <View style={styles.loadingState}>
      <View style={styles.loadingStateHeader}>
        <ActivityIndicator color={theme.primary} size="small" />
        <Text style={styles.loadingStateText}>{text}</Text>
      </View>
      <View style={styles.loadingPlaceholderStack}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.loadingPlaceholderLine,
              index === 0 && styles.loadingPlaceholderLineShort,
              index === 2 && styles.loadingPlaceholderLineMuted
            ]}
          />
        ))}
      </View>
    </View>
  );
}
