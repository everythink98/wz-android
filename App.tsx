import 'expo-dev-client';
import { memo, type ComponentProps, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
  Text,
  TextInput,
  ToastAndroid,
  useColorScheme,
  useWindowDimensions,
  View
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
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
  ExternalLink,
  Heart,
  Home,
  LayoutGrid,
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
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  mergeNodeSeekCookies,
  summarizeNodeSeekCookies,
  type NativeCookie
} from './src/nodeseekCookies';
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
  createEmptyReaderData,
  isFavorite,
  isSubscribed,
  mergeReaderData,
  recordHistory,
  sanitizeReaderData,
  sanitizeReaderDataForSync,
  toggleFavorite,
  toggleSubscription,
  topicKey,
  updateProgress,
  type ReaderData,
  type ReaderSettings
} from './src/readerData';
import { loadReaderData, saveReaderData } from './src/readerDataStore';
import { normalizeServerUrl, readReaderData as pullReaderData, writeReaderData as pushReaderData } from './src/syncClient';
import type { Category, FeedResponse, FeedSource, Reply, SearchResponse, Source, Topic, TopicDetail } from './src/types';
import { createImagePreviewList, isHttpOrHttpsUrl, isPreviewableImageUrl, type ImagePreviewList } from './src/htmlImages';
import { clearCookieUrls } from './src/cookieCleanup';
import { shouldOpenLoginWebViewUrl } from './src/loginWebViewNavigation';
import { shouldLoadMoreFeedFromScroll, shouldShowFeedFloatingActions } from './src/feedFloatingActions';
import { feedCategoryItems, feedReadingFilterItems, feedSourceItems, shouldUseReadingFilter } from './src/feedCategoryRail';
import { getTopicListItemState, topicListItemStatesEqual, type TopicListItemState } from './src/topicListItemState';
import { LIST_SWIPE_ACTION_WIDTH, clampListSwipeTranslate, shouldCaptureListSwipe, shouldOpenListSwipeAction } from './src/listSwipeActions';
import { fetchWithTimeout } from './src/request';
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
  mergeSettledSearchResponses,
  mergeTopics,
  recordsToTopics,
  removeRecord,
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
  isYaohuoLoginRequiredError,
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

type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
type HtmlAllowedStyles = NonNullable<ComponentProps<typeof RenderHTML>['allowedStyles']>;
type HtmlIgnoredStyles = NonNullable<ComponentProps<typeof RenderHTML>['ignoredStyles']>;
type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
type HtmlTagsStyles = NonNullable<ComponentProps<typeof RenderHTML>['tagsStyles']>;
type LoginNavigationRequest = { url: string };
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

const NODESEEK_URL = 'https://www.nodeseek.com';
const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const NODESEEK_LOGIN_HOSTS = ['nodeseek.com'];
const YAOHUO_URL = 'https://yaohuo.me';
const YAOHUO_LOGIN_URL = `${YAOHUO_URL}/waplogin.aspx?siteid=1000`;
const YAOHUO_COOKIE_URLS = [YAOHUO_URL, 'https://www.yaohuo.me'];
const YAOHUO_LOGIN_HOSTS = ['yaohuo.me'];
const YAOHUO_DEFAULT_CLASS_ID = '177';
const COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
const SERVER_URL_STORAGE_KEY = 'server-url';
const SYNC_CODE_STORAGE_KEY = 'sync-code';
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

const NODESEEK_LOGIN_PROBE_SCRIPT = `
(() => {
  const usernameEl = document.querySelector(".Username");
  const href = usernameEl && (usernameEl.getAttribute("href") || usernameEl.closest("a")?.getAttribute("href"));
  const match = typeof href === "string" ? href.match(/\\/(?:space|user)\\/(\\d+)/) : null;
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: "nodeseek-login",
    loggedIn: Boolean(match),
    userId: match ? Number(match[1]) : null
  }));
})();
true;
`;

type Screen = 'feed' | 'search' | 'library' | 'more' | 'topic';
type SearchScope = 'remote' | 'local';
type ReplyFilter = 'all' | 'author' | 'images' | 'newest';

interface YaohuoReplyTarget {
  floor: number;
  author?: string;
  authorId?: string;
}

const MemoizedHtmlContent = memo(HtmlContent);

const MemoizedReplyCard = memo(ReplyCard, (previous, next) => {
  if (
    previous.actionBusy !== next.actionBusy
    || previous.canWrite !== next.canWrite
    || previous.contentWidth !== next.contentWidth
    || previous.onInteract !== next.onInteract
    || previous.onReplyToFloor !== next.onReplyToFloor
    || previous.onToggleQuotedFloor !== next.onToggleQuotedFloor
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
  && previous.onOpenTopic === next.onOpenTopic
  && previous.swipeAction === next.swipeAction
  && topicListItemStatesEqual(previous.readerState, next.readerState)
));

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const yaohuoWebViewRef = useRef<WebView>(null);
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
  const syncAbortRef = useRef<AbortController | null>(null);
  const healthAbortRef = useRef<AbortController | null>(null);
  const actionAbortRef = useRef<AbortController | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingMoreRepliesRef = useRef(false);
  const repliesAbortRef = useRef<AbortController | null>(null);
  const repliesRequestIdRef = useRef(0);
  const currentTopicKeyRef = useRef<string | null>(null);
  const topicScrollRef = useRef<FlatList<Reply>>(null);
  const topicReturnScreenRef = useRef<Exclude<Screen, 'topic'>>('feed');
  const systemScheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [loadingYaohuoLoginPage, setLoadingYaohuoLoginPage] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [cookieNames, setCookieNames] = useState<string[]>([]);
  const [yaohuoCookieNames, setYaohuoCookieNames] = useState<string[]>([]);
  const [hasNodeSeekCookie, setHasNodeSeekCookie] = useState(false);
  const [hasYaohuoCookie, setHasYaohuoCookie] = useState(false);
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
  const [serverUrl, setServerUrl] = useState('http://10.0.2.2:3000');
  const [syncCode, setSyncCode] = useState('');
  const [readerData, setReaderData] = useState<ReaderData>(() => createEmptyReaderData());
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
  const [searchSource, setSearchSource] = useState<FeedSource>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('remote');
  const [searchSort, setSearchSort] = useState<SearchSort>('relevance');
  const [searchItems, setSearchItems] = useState<Topic[]>([]);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicError, setTopicError] = useState('');
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
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
  const [showCategoriesPanel, setShowCategoriesPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [healthSummary, setHealthSummary] = useState('');
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  readerDataRef.current = readerData;
  const currentTopic = topicDetail || selectedTopic;
  currentTopicKeyRef.current = currentTopic ? topicKey(currentTopic) : null;
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
  const resetQuoteState = useCallback(() => {
    expandedQuotesRef.current = {};
    loadedQuotedRepliesRef.current = {};
    loadingQuotedFloorsRef.current = {};
    setExpandedQuotes({});
    setLoadedQuotedReplies({});
    setLoadingQuotedFloors({});
    setQuoteStateVersion((current) => current + 1);
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
      return '未检测到登录 Cookie';
    }
    if (cookieNames.length === 0) {
      return '已保存 NodeSeek Cookie';
    }
    return `已检测 ${cookieNames.length} 个 Cookie：${cookieNames.join(', ')}`;
  }, [cookieNames, hasNodeSeekCookie, webLoginUserId]);

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
  const libraryTopics = useMemo(
    () => recordsToTopics(readerData[libraryTab]),
    [libraryTab, readerData]
  );
  const visibleSearchItems = useMemo(() => sortTopics(searchItems, searchSort), [searchItems, searchSort]);
  const filteredReplies = useMemo(() => {
    if (!topicDetail) {
      return topicReplies;
    }
    if (replyFilter === 'author') {
      return topicReplies.filter((reply) => reply.author === topicDetail.author);
    }
    if (replyFilter === 'images') {
      return topicReplies.filter((reply) => /<img\b/i.test(reply.contentHtml));
    }
    if (replyFilter === 'newest') {
      return [...topicReplies].reverse();
    }
    return topicReplies;
  }, [replyFilter, topicDetail, topicReplies]);
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
      htmlParts: topicHtmlPartsRef.current,
      serverUrl
    });
    if (nextPreview.urls.length > 0) {
      setImagePreview(nextPreview);
    }
  }, [serverUrl]);
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
  const notify = useCallback((message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT);
    }
  }, []);
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
    syncAbortRef.current?.abort();
    healthAbortRef.current?.abort();
    actionAbortRef.current?.abort();
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }
  }, []);

  const commitReaderData = useCallback((updater: (current: ReaderData) => ReaderData) => {
    setReaderData((current) => {
      const next = sanitizeReaderData(updater(readerDataRef.current || current));
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
      return next;
    });
  }, [notify]);

  const replaceReaderData = useCallback((nextValue: ReaderData) => {
    const next = sanitizeReaderData(nextValue);
    readerDataRef.current = next;
    setReaderData(next);
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

  useEffect(() => {
    void (async () => {
      const [savedReaderData, savedServerUrl, savedSyncCode, savedCookie, savedYaohuoCookie] = await Promise.all([
        loadReaderData(),
        SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY),
        SecureStore.getItemAsync(SYNC_CODE_STORAGE_KEY),
        SecureStore.getItemAsync(COOKIE_STORAGE_KEY),
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY)
      ]);
      setReaderData(savedReaderData);
      if (savedServerUrl) {
        setServerUrl(savedServerUrl);
      }
      if (savedSyncCode) {
        setSyncCode(savedSyncCode);
      }
      if (savedCookie) {
        setHasNodeSeekCookie(true);
        notify('已找到本机保存的 NodeSeek Cookie。');
      }
      if (savedYaohuoCookie) {
        setHasYaohuoCookie(true);
        notify('已找到本机保存的妖火 Cookie。');
      }
    })().catch((error) => notify(errorMessage(error)));
  }, [notify]);

  const saveServerSettings = useCallback(async () => {
    try {
      const cleanServerUrl = normalizeServerUrl(serverUrl);
      await SecureStore.setItemAsync(SERVER_URL_STORAGE_KEY, cleanServerUrl);
      await SecureStore.setItemAsync(SYNC_CODE_STORAGE_KEY, syncCode.trim());
      setServerUrl(cleanServerUrl);
      notify('服务器设置已保存');
    } catch (error) {
      notify(errorMessage(error));
    }
  }, [notify, serverUrl, syncCode]);

  const loadYaohuoCookieForSource = useCallback(async (source: FeedSource | Source) => {
    if (source !== 'all' && source !== 'yaohuo') {
      return undefined;
    }
    const cookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    setHasYaohuoCookie(Boolean(cookie));
    return cookie || undefined;
  }, []);

  const showYaohuoLogin = useCallback((message = '请先登录妖火。') => {
    setScreen('more');
    setShowYaohuoLoginPanel(true);
    notify(message);
  }, [notify]);

  const clearStoredYaohuoLoginState = useCallback(async () => {
    await SecureStore.deleteItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
    setHasYaohuoCookie(false);
    setYaohuoCookieNames([]);
  }, []);

  const clearStoredNodeSeekLoginState = useCallback(async () => {
    await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY);
    webLoginDetectedRef.current = false;
    setHasNodeSeekCookie(false);
    setCookieNames([]);
    setWebLoginUserId(null);
  }, []);

  const clearYaohuoLoginState = useCallback(async () => {
    await clearStoredYaohuoLoginState();
    await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);
  }, [clearStoredYaohuoLoginState]);

  const clearNodeSeekLoginState = useCallback(async () => {
    await clearStoredNodeSeekLoginState();
    await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);
  }, [clearStoredNodeSeekLoginState]);

  const loadCategories = useCallback(async () => {
    if (!serverUrl.trim()) {
      return;
    }
    const controller = startAbortableRequest(categoriesAbortRef);
    try {
      const [baseCategoriesResult, yaohuoCategoriesResult] = await Promise.allSettled([
        getCategories({ serverUrl, source: 'all', nocache: true, signal: controller.signal }),
        getCategories({ serverUrl, source: 'yaohuo', nocache: true, signal: controller.signal })
      ]);
      if (
        (baseCategoriesResult.status === 'rejected' && isCanceledRequest(baseCategoriesResult.reason))
        || (yaohuoCategoriesResult.status === 'rejected' && isCanceledRequest(yaohuoCategoriesResult.reason))
      ) {
        return;
      }
      const data = baseCategoriesResult.status === 'fulfilled'
        ? baseCategoriesResult.value
        : { items: [], errors: { all: errorMessage(baseCategoriesResult.reason) } };
      const yaohuoData = yaohuoCategoriesResult.status === 'fulfilled'
        ? yaohuoCategoriesResult.value
        : { items: [], errors: { yaohuo: errorMessage(yaohuoCategoriesResult.reason) } };
      setCategories(mergeCategories(data.items, yaohuoData.items));
      const errors = Object.entries({
        ...(data.errors || {}),
        ...(yaohuoData.errors || {})
      });
      if (errors.length) {
        if (errors.some(([source]) => source === 'yaohuo')) {
          await clearStoredYaohuoLoginState();
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
  }, [clearStoredYaohuoLoginState, notify, serverUrl]);

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
    if (!serverUrl.trim()) {
      notify('请输入服务器地址');
      return;
    }
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
    setBusy(true);
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(source);
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
            serverUrl,
            source,
            page,
            cursor,
            limit: 30,
            category: category || undefined,
            nocache,
            signal: controller.signal
          }),
          getYaohuoFeedDirect({
            serverUrl,
            yaohuoCookie,
            page,
            limit: 30,
            signal: controller.signal
          })
        ]);
        data = mergeSettledFeedResponses(baseResult, yaohuoResult);
      } else if (source === 'yaohuo') {
        data = await getYaohuoFeedDirect({
          serverUrl,
          yaohuoCookie,
          page,
          limit: 30,
          category: category || undefined,
          signal: controller.signal
        });
      } else {
        data = await getFeed({
          serverUrl,
          source,
          page,
          cursor,
          limit: 30,
          category: category || undefined,
          nocache,
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
        if (errors.some(([sourceName]) => sourceName === 'yaohuo')) {
          await clearStoredYaohuoLoginState();
        }
        notify(errors.map(([sourceName, message]) => `${sourceLabel(sourceName as Source)}：${message}`).join('；'));
      } else if (successMessage) {
        notify(successMessage);
      }
    } catch (error) {
      if (requestId === feedRequestIdRef.current) {
        if (isYaohuoLoginRequiredError(error)) {
          await clearYaohuoLoginState();
          showYaohuoLogin('妖火登录已失效，请重新登录。');
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setBusy(false);
        setFeedRefreshing(false);
        setLoadingMoreFeed(false);
        feedLoadingRef.current = false;
      }
      finishAbortableRequest(feedAbortRef, controller);
    }
  }, [categoryFilter, clearStoredYaohuoLoginState, clearYaohuoLoginState, feedSource, loadYaohuoCookieForSource, notify, serverUrl, showYaohuoLogin]);

  useEffect(() => {
    void loadFeed({ reset: true, page: 1, source: feedSource, category: categoryFilter, nocache: true, clearItems: true });
  }, [categoryFilter, feedSource, loadFeed]);

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
    setSearchItems([]);
  }, [searchQuery, searchScope, searchSource]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      notify('请输入搜索词');
      return;
    }
    const controller = startAbortableRequest(searchAbortRef);
    const requestId = ++searchRequestIdRef.current;
    setSearchItems([]);
    setBusy(true);
    try {
      if (searchScope === 'local') {
        if (requestId !== searchRequestIdRef.current) {
          return;
        }
        setSearchItems(searchLocal(readerData, query, searchSource));
        notify('本地搜索完成');
      } else {
        const yaohuoCookie = await loadYaohuoCookieForSource(searchSource);
        if (searchSource === 'yaohuo' && !yaohuoCookie) {
          showYaohuoLogin();
          return;
        }
        let data: SearchResponse;
        if (searchSource === 'all' && yaohuoCookie) {
          const [baseResult, yaohuoResult] = await Promise.allSettled([
            searchTopics({ serverUrl, query, source: searchSource, limit: 30, signal: controller.signal }),
            searchYaohuoDirect({ serverUrl, query, limit: 30, yaohuoCookie, signal: controller.signal })
          ]);
          data = mergeSettledSearchResponses(baseResult, yaohuoResult);
        } else if (searchSource === 'yaohuo') {
          data = await searchYaohuoDirect({ serverUrl, query, limit: 30, yaohuoCookie, signal: controller.signal });
        } else {
          data = await searchTopics({ serverUrl, query, source: searchSource, limit: 30, signal: controller.signal });
        }
        if (requestId !== searchRequestIdRef.current) {
          return;
        }
        setSearchItems(data.items);
        commitReaderData((current) => addSavedSearch(current, query, searchSource));
        const errors = Object.entries(data.errors || {});
        if (errors.some(([sourceName]) => sourceName === 'yaohuo')) {
          await clearStoredYaohuoLoginState();
        }
        notify(errors.length
          ? errors.map(([sourceName, message]) => `${sourceLabel(sourceName as Source)}：${message}`).join('；')
          : `搜索完成：${data.items.length} 条结果`);
      }
    } catch (error) {
      if (requestId === searchRequestIdRef.current) {
        if (isYaohuoLoginRequiredError(error)) {
          await clearYaohuoLoginState();
          showYaohuoLogin('妖火登录已失效，请重新登录。');
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(errorMessage(error));
        }
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setBusy(false);
      }
      finishAbortableRequest(searchAbortRef, controller);
    }
  }, [clearStoredYaohuoLoginState, clearYaohuoLoginState, commitReaderData, loadYaohuoCookieForSource, notify, readerData, searchQuery, searchScope, searchSource, serverUrl, showYaohuoLogin]);

  const openTopic = useCallback(async (topic: Topic, nocache = false) => {
    if (screen !== 'topic') {
      topicReturnScreenRef.current = screen;
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
    setBusy(true);
    const controller = startAbortableRequest(topicAbortRef);
    try {
      const yaohuoCookie = await loadYaohuoCookieForSource(topic.source);
      if (requestId !== topicRequestIdRef.current) {
        return;
      }
      if (topic.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      const detail = topic.source === 'yaohuo'
        ? await getYaohuoTopicDirect({ serverUrl, topic, yaohuoCookie, replyLimit: 30, signal: controller.signal })
        : await getTopic({ serverUrl, source: topic.source, id: topic.id, nocache, signal: controller.signal });
      if (requestId !== topicRequestIdRef.current) {
        return;
      }
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
        if (isYaohuoLoginRequiredError(error)) {
          await clearYaohuoLoginState();
          showYaohuoLogin('妖火登录已失效，请重新登录。');
          return;
        }
        if (!isCanceledRequest(error)) {
          notify(message);
        }
      }
    } finally {
      if (requestId === topicRequestIdRef.current) {
        setBusy(false);
      }
      finishAbortableRequest(topicAbortRef, controller);
    }
  }, [clearYaohuoLoginState, commitReaderData, loadYaohuoCookieForSource, notify, resetQuoteState, screen, serverUrl, showYaohuoLogin]);

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
      if (detail.source === 'yaohuo' && !yaohuoCookie) {
        showYaohuoLogin();
        return;
      }
      controller = startAbortableRequest(repliesAbortRef);
      setBusy(true);
      const data = detail.source === 'yaohuo'
        ? await getYaohuoRepliesDirect({
          serverUrl,
          id: detail.id,
          categoryId: detail.categoryId,
          page: replyNextPage,
          limit: 30,
          yaohuoCookie,
          signal: controller.signal
        })
        : await getReplies({
          serverUrl,
          source: detail.source,
          id: detail.id,
          page: replyNextPage,
          limit: 30,
          offset: replyNextOffset,
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
          await clearYaohuoLoginState();
          showYaohuoLogin('妖火登录已失效，请重新登录。');
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
      if (currentTopicKeyRef.current === requestTopicKey && requestId === repliesRequestIdRef.current) {
        setBusy(false);
      }
      if (controller) {
        finishAbortableRequest(repliesAbortRef, controller);
      }
    }
  }, [clearYaohuoLoginState, loadYaohuoCookieForSource, notify, replyNextOffset, replyNextPage, selectedTopic, serverUrl, showYaohuoLogin, topicDetail]);

  const refreshTopic = useCallback(() => {
    const detail = topicDetail || selectedTopic;
    if (detail) {
      void openTopic(detail, true);
    }
  }, [openTopic, selectedTopic, topicDetail]);

  const goBackFromTopic = useCallback(() => {
    setScreen(topicReturnScreenRef.current);
  }, []);

  const handleTopicScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const detail = topicDetail || selectedTopic;
    if (!detail) {
      return;
    }
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollY = Math.max(0, contentOffset.y);
    const scrollable = Math.max(1, contentSize.height - layoutMeasurement.height);
    const percent = Math.min(100, Math.max(0, Math.round((scrollY / scrollable) * 100)));
    const next = updateProgress(readerDataRef.current, detail, { percent, scrollY });
    readerDataRef.current = next;
    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }
    progressSaveTimerRef.current = setTimeout(() => {
      progressSaveTimerRef.current = null;
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => saveReaderData(readerDataRef.current))
        .then((saved) => {
          readerDataRef.current = saved;
          setReaderData(saved);
        })
        .catch((error) => notify(errorMessage(error)));
    }, 650);
  }, [notify, selectedTopic, topicDetail]);

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
    try {
      const loaded = await getReply({
        serverUrl,
        source: detail.source,
        id: detail.id,
        floor: quotedFloor
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
        notify(errorMessage(error));
      }
    } finally {
      if (currentTopicKeyRef.current === requestTopicKey) {
        updateLoadingQuotedFloors((current) => ({ ...current, [key]: false }));
      }
    }
  }, [notify, selectedTopic, serverUrl, topicDetail, updateExpandedQuotes, updateLoadedQuotedReplies, updateLoadingQuotedFloors]);

  const handleLoginMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        loggedIn?: boolean;
        userId?: number | null;
      };
      if (data.type === 'nodeseek-login' && data.loggedIn && Number.isInteger(data.userId)) {
        webLoginDetectedRef.current = true;
        setWebLoginUserId(data.userId || null);
      } else if (data.type === 'nodeseek-login' && data.loggedIn === false) {
        webLoginDetectedRef.current = false;
        setWebLoginUserId(null);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, []);

  const probeLoginPage = useCallback(async () => {
    webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, []);

  const checkLogin = useCallback(async () => {
    setChecking(true);
    try {
      await probeLoginPage();
      await CookieManager.flush();
      const cookieMaps = await Promise.all(NODESEEK_COOKIE_URLS.map(async (url) => CookieManager.get(url)));
      const typedCookies = mergeNodeSeekCookies(...cookieMaps as Array<Record<string, NativeCookie>>);
      const summary = summarizeNodeSeekCookies(typedCookies);
      const cookieHeader = buildCookieHeader(typedCookies);
      setCookieNames(summary.names);
      if (canStoreNodeSeekCookieHeader(typedCookies, webLoginDetectedRef.current) && cookieHeader) {
        await SecureStore.setItemAsync(COOKIE_STORAGE_KEY, cookieHeader);
        setHasNodeSeekCookie(true);
        notify('已检测到 NodeSeek 登录 Cookie，已保存在本机。');
      } else {
        notify('没有检测到明确的 NodeSeek 登录 Cookie。请确认已经登录后再试。');
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [notify, probeLoginPage]);

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
      const loginState = await checkYaohuoLoginDirect({ serverUrl, yaohuoCookie: cookieHeader });
      if (loginState.loginRequired || !loginState.ok) {
        await clearYaohuoLoginState();
        notify(loginState.message || '妖火登录已失效，请重新登录。');
        return;
      }
      await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);
      setHasYaohuoCookie(true);
      notify('已检测到妖火登录 Cookie，已保存在本机。');
    } catch (error) {
      if (isYaohuoLoginRequiredError(error)) {
        await clearYaohuoLoginState();
        notify('妖火登录已失效，请重新登录。');
        return;
      }
      notify(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [clearYaohuoLoginState, notify, serverUrl]);

  const clearLogin = useCallback(async () => {
    await clearNodeSeekLoginState();
    notify('已清除本机保存的 NodeSeek Cookie。');
  }, [clearNodeSeekLoginState, notify]);

  const clearYaohuoLogin = useCallback(async () => {
    await clearYaohuoLoginState();
    yaohuoWebViewRef.current?.reload();
    notify('已清除本机保存的妖火 Cookie。');
  }, [clearYaohuoLoginState, notify]);

  const runNodeSeekRequest = useCallback(async (
    requestFactory: () => NodeSeekActionRequest,
    success: string,
    options: { refreshTopic?: boolean } = {}
  ) => {
    if (!hasNodeSeekCookie) {
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
        await clearNodeSeekLoginState();
      }
      notify(errorMessage(error));
      return false;
    } finally {
      if (finishAbortableRequest(actionAbortRef, controller)) {
        setActionBusy(false);
      }
    }
  }, [clearNodeSeekLoginState, hasNodeSeekCookie, notify, openTopic, topicDetail]);

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
        await clearYaohuoLoginState();
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

  const pullSync = useCallback(async () => {
    const controller = startAbortableRequest(syncAbortRef);
    setBusy(true);
    setSyncing(true);
    try {
      await saveQueueRef.current.catch(() => undefined);
      const remote = sanitizeReaderDataForSync(await pullReaderData(serverUrl, syncCode, { signal: controller.signal }));
      const merged = mergeReaderData(readerDataRef.current, remote);
      await replaceReaderData(merged);
      notify('同步已更新，本机已合并云端资料');
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(syncAbortRef, controller)) {
        setBusy(false);
        setSyncing(false);
      }
    }
  }, [notify, replaceReaderData, serverUrl, syncCode]);

  const pushSync = useCallback(async () => {
    const controller = startAbortableRequest(syncAbortRef);
    setBusy(true);
    setSyncing(true);
    try {
      await saveQueueRef.current.catch(() => undefined);
      await pushReaderData(serverUrl, syncCode, sanitizeReaderDataForSync(readerDataRef.current), { signal: controller.signal });
      notify('同步已保存');
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(syncAbortRef, controller)) {
        setBusy(false);
        setSyncing(false);
      }
    }
  }, [notify, serverUrl, syncCode]);

  const checkHealth = useCallback(async () => {
    const controller = startAbortableRequest(healthAbortRef);
    setBusy(true);
    try {
      const response = await fetchWithTimeout(`${normalizeServerUrl(serverUrl)}/api/health`, {}, { signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const sourceStatus = sources.map((source) => `${sourceLabel(source)} ${data.sources?.[source]?.ok ? '可用' : '不可用'}`).join(' · ');
      setHealthSummary(sourceStatus);
      notify('状态已更新');
    } catch (error) {
      if (!isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (finishAbortableRequest(healthAbortRef, controller)) {
        setBusy(false);
      }
    }
  }, [notify, serverUrl]);

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
      if (showCategoriesPanel) {
        setShowCategoriesPanel(false);
        return true;
      }
      if (showSettingsPanel) {
        setShowSettingsPanel(false);
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
    showCategoriesPanel,
    showLoginPanel,
    showYaohuoLoginPanel,
    showSettingsPanel
  ]);

  function updateSettings(patch: Partial<ReaderSettings>) {
    commitReaderData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...patch
      }
    }));
  }

  function selectCategory(category: Category) {
    setFeedSource(category.source);
    setCategoryFilter(category.id);
    setScreen('feed');
  }

  const changeFeedSource = useCallback((source: FeedSource) => {
    setFeedSource(source);
    setCategoryFilter('');
  }, []);

  const toggleTopicFavorite = useCallback((topic: Topic) => {
    commitReaderData((current) => toggleFavorite(current, topic));
  }, [commitReaderData]);

  const removeLibraryTopic = useCallback((topic: Topic) => {
    commitReaderData((current) => removeRecord(current, libraryTab, topic));
  }, [commitReaderData, libraryTab]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.screen}>
        <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
        {screen === 'topic' ? (
          <TopicScreen
            actionBusy={actionBusy}
            canUseNodeSeekActions={hasNodeSeekCookie}
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
            topicError={topicError}
            topicScrollRef={topicScrollRef}
            onBack={goBackFromTopic}
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
            onSubmitReply={submitReply}
            onTopicScroll={handleTopicScroll}
            onToggleQuotedFloor={toggleQuotedFloor}
            onToggleFavorite={toggleTopicFavorite}
          />
        ) : (
          <>
            {screen === 'feed' ? (
              <FeedScreen
                busy={busy || actionBusy}
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
                busy={busy}
                query={searchQuery}
                readerData={readerData}
                results={visibleSearchItems}
                scope={searchScope}
                searchSource={searchSource}
                sort={searchSort}
                styles={styles}
                theme={theme}
                onOpenTopic={openTopic}
                onQueryChange={setSearchQuery}
                onSaveSearch={() => commitReaderData((current) => addSavedSearch(current, searchQuery, searchSource))}
                onScopeChange={setSearchScope}
                onSearch={runSearch}
                onSearchSourceChange={setSearchSource}
                onSortChange={setSearchSort}
                onToggleFavorite={toggleTopicFavorite}
              />
            ) : null}
            {screen === 'library' ? (
              <LibraryScreen
                libraryTab={libraryTab}
                readerData={readerData}
                styles={styles}
                theme={theme}
                topics={libraryTopics}
                onOpenTopic={openTopic}
                onRemove={removeLibraryTopic}
                onTabChange={setLibraryTab}
              />
            ) : null}
            {screen === 'more' ? (
              <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} keyboardShouldPersistTaps="handled">
                <MoreScreen
                  categories={categories}
                  checking={checking}
                  hasNodeSeekCookie={hasNodeSeekCookie}
                  hasYaohuoCookie={hasYaohuoCookie}
                  healthSummary={healthSummary}
                  loginState={loginState}
                  loadingLoginPage={loadingLoginPage}
                  loadingYaohuoLoginPage={loadingYaohuoLoginPage}
                  readerData={readerData}
                  serverUrl={serverUrl}
                  showCategoriesPanel={showCategoriesPanel}
                  showLoginPanel={showLoginPanel}
                  showYaohuoLoginPanel={showYaohuoLoginPanel}
                  showSettingsPanel={showSettingsPanel}
                  styles={styles}
                  syncing={syncing}
                  syncCode={syncCode}
                  theme={theme}
                  webViewRef={webViewRef}
                  yaohuoLoginState={yaohuoLoginState}
                  yaohuoWebViewRef={yaohuoWebViewRef}
                  onCheckHealth={checkHealth}
                  onCheckIn={checkIn}
                  onCheckLogin={checkLogin}
                  onCheckYaohuoLogin={checkYaohuoCookie}
                  onClearLogin={clearLogin}
                  onClearYaohuoLogin={clearYaohuoLogin}
                  handleNodeSeekLoginNavigation={handleNodeSeekLoginNavigation}
                  handleYaohuoLoginNavigation={handleYaohuoLoginNavigation}
                  onHandleLoginMessage={handleLoginMessage}
                  onPullSync={pullSync}
                  onPushSync={pushSync}
                  onRefreshCategories={loadCategories}
                  onSaveServerSettings={saveServerSettings}
                  onSelectCategory={selectCategory}
                  onServerUrlChange={setServerUrl}
                  onSetLoadingLoginPage={setLoadingLoginPage}
                  onSetLoadingYaohuoLoginPage={setLoadingYaohuoLoginPage}
                  onShowCategoriesPanelChange={setShowCategoriesPanel}
                  onShowLoginPanelChange={setShowLoginPanel}
                  onShowYaohuoLoginPanelChange={setShowYaohuoLoginPanel}
                  onShowSettingsPanelChange={setShowSettingsPanel}
                  onSyncCodeChange={setSyncCode}
                  onToggleSubscription={(category) => commitReaderData((current) => toggleSubscription(current, category))}
                  onUpdateSettings={updateSettings}
                />
              </ScrollView>
            ) : null}
            <NavBar active={screen} styles={styles} theme={theme} onChange={setScreen} />
          </>
        )}
        <ImagePreviewModal
          preview={imagePreview}
          styles={styles}
          onClose={closeImagePreview}
          onNext={showNextImage}
          onPrevious={showPreviousImage}
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
  const [showFloatingActions, setShowFloatingActions] = useState(false);

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

  useEffect(() => {
    if (!busy && !loadingMore) {
      requestedFeedPageRef.current = null;
    }
  }, [busy, loadingMore]);

  useEffect(() => {
    requestedFeedPageRef.current = null;
    setShowFloatingActions(false);
  }, [categoryFilter, feedSource, readingFilter]);

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
  readerData,
  results,
  scope,
  searchSource,
  sort,
  styles,
  theme,
  onOpenTopic,
  onQueryChange,
  onSaveSearch,
  onScopeChange,
  onSearch,
  onSearchSourceChange,
  onSortChange,
  onToggleFavorite
}: {
  busy: boolean;
  query: string;
  readerData: ReaderData;
  results: Topic[];
  scope: SearchScope;
  searchSource: FeedSource;
  sort: SearchSort;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpenTopic: (topic: Topic) => void;
  onQueryChange: (value: string) => void;
  onSaveSearch: () => void;
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
      readerState={getTopicListItemState(readerData, item)}
      styles={styles}
      theme={theme}
      topic={item}
      onOpenTopic={onOpenTopic}
      swipeAction={favoriteSwipeAction}
    />
  ), [favoriteSwipeAction, onOpenTopic, readerData, styles, theme]);
  const savedSearchItems = useMemo(
    () => readerData.savedSearches.map((item) => ({ value: item.id, label: item.query })),
    [readerData.savedSearches]
  );
  const selectSavedSearch = useCallback((id: string) => {
    const saved = readerData.savedSearches.find((item) => item.id === id);
    onQueryChange(saved?.query || id);
  }, [onQueryChange, readerData.savedSearches]);

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
      <AppButton label="保存搜索" variant="ghost" styles={styles} onPress={onSaveSearch} />
      {readerData.savedSearches.length ? (
        <PillRail
          items={savedSearchItems}
          value=""
          styles={styles}
          onChange={selectSavedSearch}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={results}
      keyExtractor={topicKey}
      keyboardShouldPersistTaps="handled"
      {...TOPIC_LIST_PERFORMANCE_PROPS}
      ListHeaderComponent={header}
      ListEmptyComponent={busy && query.trim()
        ? <LoadingState text="正在搜索..." styles={styles} theme={theme} />
        : <EmptyText text={query.trim() ? '暂无搜索结果' : '输入关键词后开始搜索'} styles={styles} />}
      renderItem={renderTopicItem}
    />
  );
}

function LibraryScreen({
  libraryTab,
  readerData,
  styles,
  theme,
  topics,
  onOpenTopic,
  onRemove,
  onTabChange
}: {
  libraryTab: LibraryTab;
  readerData: ReaderData;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topics: Topic[];
  onOpenTopic: (topic: Topic) => void;
  onRemove: (topic: Topic) => void;
  onTabChange: (tab: LibraryTab) => void;
}) {
  const deleteSwipeAction = useMemo<TopicSwipeActionConfig>(() => ({
    kind: 'delete',
    onPress: onRemove
  }), [onRemove]);
  const renderLibraryItem = useCallback<ListRenderItem<Topic>>(({ item }) => (
    <View style={styles.libraryItem}>
      <MemoizedTopicCard
        readerState={getTopicListItemState(readerData, item)}
        styles={styles}
        theme={theme}
        topic={item}
        onOpenTopic={onOpenTopic}
        swipeAction={deleteSwipeAction}
      />
    </View>
  ), [deleteSwipeAction, onOpenTopic, readerData, styles, theme]);

  const header = (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>收藏</Text>
      <PillRail
        items={[
          { value: 'favorites', label: '收藏' },
          { value: 'history', label: '历史' }
        ]}
        value={libraryTab}
        styles={styles}
        onChange={(value) => onTabChange(value as LibraryTab)}
      />
    </View>
  );

  return (
    <FlatList
      style={styles.content}
      contentContainerStyle={styles.contentInner}
      data={topics}
      keyExtractor={topicKey}
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
  hasNodeSeekCookie,
  hasYaohuoCookie,
  healthSummary,
  loginState,
  loadingLoginPage,
  loadingYaohuoLoginPage,
  readerData,
  serverUrl,
  showCategoriesPanel,
  showLoginPanel,
  showYaohuoLoginPanel,
  showSettingsPanel,
  styles,
  syncing,
  syncCode,
  theme,
  webViewRef,
  yaohuoLoginState,
  yaohuoWebViewRef,
  onCheckHealth,
  onCheckIn,
  onCheckLogin,
  onCheckYaohuoLogin,
  onClearLogin,
  onClearYaohuoLogin,
  handleNodeSeekLoginNavigation,
  handleYaohuoLoginNavigation,
  onHandleLoginMessage,
  onPullSync,
  onPushSync,
  onRefreshCategories,
  onSaveServerSettings,
  onSelectCategory,
  onServerUrlChange,
  onSetLoadingLoginPage,
  onSetLoadingYaohuoLoginPage,
  onShowCategoriesPanelChange,
  onShowLoginPanelChange,
  onShowYaohuoLoginPanelChange,
  onShowSettingsPanelChange,
  onSyncCodeChange,
  onToggleSubscription,
  onUpdateSettings
}: {
  categories: Category[];
  checking: boolean;
  hasNodeSeekCookie: boolean;
  hasYaohuoCookie: boolean;
  healthSummary: string;
  loginState: string;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  readerData: ReaderData;
  serverUrl: string;
  showCategoriesPanel: boolean;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  showSettingsPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  syncing: boolean;
  syncCode: string;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  yaohuoLoginState: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
  onCheckHealth: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onCheckYaohuoLogin: () => void;
  onClearLogin: () => void;
  onClearYaohuoLogin: () => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  handleYaohuoLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onPullSync: () => void;
  onPushSync: () => void;
  onRefreshCategories: () => void;
  onSaveServerSettings: () => void;
  onSelectCategory: (category: Category) => void;
  onServerUrlChange: (value: string) => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onSetLoadingYaohuoLoginPage: (value: boolean) => void;
  onShowCategoriesPanelChange: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowYaohuoLoginPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onSyncCodeChange: (value: string) => void;
  onToggleSubscription: (category: Category) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const favoriteCount = Object.keys(readerData.favorites).length;
  const grouped = sources.map((source) => ({
    source,
    items: categories.filter((category) => category.source === source)
  }));

  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>更多</Text>
      <View style={styles.group}>
        <InfoRow icon={Star} label="收藏" value={String(favoriteCount)} styles={styles} theme={theme} />
      </View>
      <View style={styles.group}>
        <Text style={styles.panelTitle}>服务器与同步</Text>
        <TextInput
          style={styles.input}
          value={serverUrl}
          onChangeText={onServerUrlChange}
          placeholder="服务器地址，例如 http://192.168.1.23:3000"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={syncCode}
          onChangeText={onSyncCodeChange}
          placeholder="同步码"
          placeholderTextColor={theme.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={styles.actions}>
          <AppButton label="保存" styles={styles} onPress={onSaveServerSettings} />
          <AppButton label={syncing ? '同步中' : '读取同步'} variant="ghost" styles={styles} disabled={syncing} onPress={onPullSync} />
          <AppButton label={syncing ? '同步中' : '保存同步'} variant="ghost" styles={styles} disabled={syncing} onPress={onPushSync} />
        </View>
      </View>
      <View style={styles.group}>
        <MenuButton icon={LogIn} label="NodeSeek 登录" value={loginState} styles={styles} theme={theme} onPress={() => onShowLoginPanelChange(!showLoginPanel)} />
        {hasNodeSeekCookie ? <MenuButton icon={CheckCircle} label="NodeSeek 签到" value="使用本机 Cookie" styles={styles} theme={theme} onPress={onCheckIn} /> : null}
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
                injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
                onLoadEnd={() => {
                  onSetLoadingLoginPage(false);
                  webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
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
        <MenuButton icon={Activity} label="状态 / 检查" value={healthSummary || '来源状态'} styles={styles} theme={theme} onPress={onCheckHealth} />
      </View>
    </View>
  );
}

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
  quoteStateVersion,
  readerData,
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
  topicError,
  topicScrollRef,
  onBack,
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
  quoteStateVersion: number;
  readerData: ReaderData;
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
  topicError: string;
  topicScrollRef: RefObject<FlatList<Reply> | null>;
  onBack: () => void;
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
  onSubmitReply: () => void;
  onTopicScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
  onToggleFavorite: (topic: Topic) => void;
}) {
  const item = topic || selectedTopic;
  const topicLoading = !topic && !topicError;
  const canWriteNodeSeek = Boolean(item && item.source === 'nodeseek' && canUseNodeSeekActions);
  const canWriteYaohuo = Boolean(item && item.source === 'yaohuo' && canUseYaohuoActions);
  const canWrite = canWriteNodeSeek || canWriteYaohuo;
  const itemSource = item?.source;
  const repliesByFloor = useMemo(() => {
    const next = new Map<number, Reply>();
    sourceReplies.forEach((reply, index) => {
      next.set(reply.floor ?? index + 1, reply);
    });
    Object.values(loadedQuotedRepliesRef.current).forEach((reply) => {
      if (reply.floor) {
        next.set(reply.floor, reply);
      }
    });
    return next;
  }, [loadedQuotedRepliesRef, quoteStateVersion, sourceReplies]);

  const topicColumnStyle = useMemo(() => ({ width: contentWidth }), [contentWidth]);
  const renderReplyItem = useCallback<ListRenderItem<Reply>>(({ item: reply, index }) => (
    <View style={[styles.replyListItem, topicColumnStyle]}>
      <MemoizedReplyCard
        actionBusy={actionBusy}
        canWrite={canWrite}
        contentWidth={Math.max(240, contentWidth - 28)}
        expandedQuotes={expandedQuotesRef.current}
        loadedQuotedReplies={loadedQuotedRepliesRef.current}
        loadingQuotedFloors={loadingQuotedFloorsRef.current}
        reply={reply}
        replyFloor={reply.floor ?? index + 1}
        repliesByFloor={repliesByFloor}
        styles={styles}
        theme={theme}
        onInteract={onInteract}
        onReplyToFloor={onReplyToFloor}
        onToggleQuotedFloor={onToggleQuotedFloor}
        source={itemSource}
      />
    </View>
  ), [
    actionBusy,
    canWrite,
    contentWidth,
    expandedQuotesRef,
    loadedQuotedRepliesRef,
    loadingQuotedFloorsRef,
    onInteract,
    onReplyToFloor,
    onToggleQuotedFloor,
    quoteStateVersion,
    itemSource,
    repliesByFloor,
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
        <View style={styles.topicMetaStack}>
          <Text style={styles.sourceText}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <Text style={styles.meta}>{item.author || '未知作者'} · {formatDateTime(item.createdAt)} · {item.replyCount} 回复{item.viewCount ? ` · ${item.viewCount} 浏览` : ''}</Text>
          {item.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{item.accessRequirement.label}</Text> : null}
        </View>
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
            <AppButton label="重试" styles={styles} onPress={onRefreshTopic} />
          </View>
        ) : null}
        {topic ? (
          <View style={styles.articleBody}>
            <MemoizedHtmlContent
              contentWidth={contentWidth}
              html={topic.contentHtml}
            />
          </View>
        ) : topicError ? null : <LoadingState text="正在读取主题..." styles={styles} theme={theme} />}
      </View>
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
      </View>
      {canWrite && replyComposerOpen ? (
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
      ) : null}
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
          {!canWrite ? <Text style={styles.topicTopHint}>只读 · 原站回复</Text> : <Text style={styles.topicTopHint}>{item.source === 'yaohuo' ? '妖火可回复' : 'NodeSeek 可回复'}</Text>}
          <View style={styles.topicTopActions}>
            <IconButton icon={Star} compact ghost iconOnly label={isFavorite(readerData, item) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, item)} onPress={() => onToggleFavorite(item)} />
            <IconButton icon={ExternalLink} compact ghost iconOnly label="原站" styles={styles} theme={theme} onPress={() => onOpenOriginal(item.url)} />
          </View>
        </View>
        <FlatList
          ref={topicScrollRef}
          style={[styles.content, styles.topicContent]}
          contentContainerStyle={[styles.contentInner, styles.topicContentInner]}
          data={replies}
          keyExtractor={(reply, index) => `${reply.floor ?? index}-${reply.createdAt}`}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={onTopicScroll}
          onScrollEndDrag={onTopicScroll}
          extraData={quoteStateVersion}
          {...REPLY_LIST_PERFORMANCE_PROPS}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={topicLoading ? null : (
            <View style={[styles.replyListItem, topicColumnStyle]}>
              <EmptyText text="暂无回复" styles={styles} />
            </View>
          )}
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
  loadedQuotedReplies,
  loadingQuotedFloors,
  reply,
  replyFloor,
  repliesByFloor,
  source,
  styles,
  theme,
  onInteract,
  onReplyToFloor,
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  source?: Source;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onReplyToFloor: (reply: Reply) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = useMemo(() => Array.from(new Set(reply.quotedFloors || [])), [reply.quotedFloors]);
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
          html={reply.contentHtml}
        />
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
  onPrevious
}: {
  preview: ImagePreviewList | null;
  styles: ReturnType<typeof createStyles>;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [zoomed, setZoomed] = useState(false);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
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

function TopicCard({
  topic,
  readerState,
  swipeAction,
  styles,
  theme,
  onOpenTopic
}: {
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
    readerState.tracked ? '追踪命中' : ''
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
          <Text style={styles.cardTitle} numberOfLines={readerState.listDensity === 'loose' ? 3 : 2}>{topic.title || '无标题'}</Text>
          {topic.accessRequirement?.label ? <Text style={styles.topicAccessBadge}>{topic.accessRequirement.label}</Text> : null}
          {topic.excerpt && readerState.listDensity === 'loose' ? <Text style={styles.excerpt} numberOfLines={2}>{topic.excerpt}</Text> : null}
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
