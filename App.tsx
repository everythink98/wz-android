import 'expo-dev-client';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@react-native-cookies/cookies';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import RenderHTML, { IMGElement, useIMGElementProps, type CustomBlockRenderer } from 'react-native-render-html';
import {
  Activity,
  BookMarked,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Heart,
  Home,
  LayoutGrid,
  LogIn,
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
  buildCookieHeader,
  canStoreNodeSeekCookieHeader,
  mergeNodeSeekCookies,
  summarizeNodeSeekCookies,
  type NativeCookie
} from './src/nodeseekCookies';
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
  isLater,
  isSubscribed,
  recordHistory,
  sanitizeReaderData,
  toggleFavorite,
  toggleLater,
  toggleSubscription,
  topicKey,
  updateProgress,
  type ReaderData,
  type ReaderSettings
} from './src/readerData';
import { loadReaderData, saveReaderData } from './src/readerDataStore';
import { normalizeServerUrl, readReaderData as pullReaderData, writeReaderData as pushReaderData } from './src/syncClient';
import type { Category, FeedSource, Reply, Source, Topic, TopicDetail } from './src/types';
import { createImagePreviewList, isPreviewableImageUrl, type ImagePreviewList } from './src/htmlImages';

type HtmlBaseStyle = NonNullable<ComponentProps<typeof RenderHTML>['baseStyle']>;
type HtmlIgnoredStyles = NonNullable<ComponentProps<typeof RenderHTML>['ignoredStyles']>;
type HtmlRenderers = NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
type HtmlRenderersProps = NonNullable<ComponentProps<typeof RenderHTML>['renderersProps']>;
type HtmlTagsStyles = NonNullable<ComponentProps<typeof RenderHTML>['tagsStyles']>;

const NODESEEK_URL = 'https://www.nodeseek.com';
const NODESEEK_COOKIE_URLS = [NODESEEK_URL, 'https://nodeseek.com'];
const COOKIE_STORAGE_KEY = 'nodeseek-cookie-header';
const SERVER_URL_STORAGE_KEY = 'server-url';
const SYNC_CODE_STORAGE_KEY = 'sync-code';
const sources: Source[] = ['v2ex', 'linuxdo', 'nodeseek'];

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
type ReadingFilter = 'all' | 'unread' | 'read' | 'favorite' | 'later' | 'subscribed' | 'active' | 'hot';
type SearchScope = 'remote' | 'local';
type SearchSort = 'relevance' | 'time' | 'reply' | 'view';
type LibraryTab = 'favorites' | 'later' | 'history';
type ReplyFilter = 'all' | 'author' | 'images' | 'newest';

interface ReaderTheme {
  dark: boolean;
  background: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;
  ink: string;
  muted: string;
  primary: string;
  primarySoft: string;
  mist: string;
  onPrimary: string;
  danger: string;
  success: string;
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const webLoginDetectedRef = useRef(false);
  const systemScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [loadingLoginPage, setLoadingLoginPage] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [status, setStatus] = useState('填写服务器地址后即可读取三站；NodeSeek Cookie 只保存在本机。');
  const [cookieNames, setCookieNames] = useState<string[]>([]);
  const [hasNodeSeekCookie, setHasNodeSeekCookie] = useState(false);
  const [webLoginUserId, setWebLoginUserId] = useState<number | null>(null);
  const [serverUrl, setServerUrl] = useState('http://10.0.2.2:3000');
  const [syncCode, setSyncCode] = useState('');
  const [readerData, setReaderData] = useState<ReaderData>(() => createEmptyReaderData());
  const [feedSource, setFeedSource] = useState<FeedSource>('all');
  const [feedItems, setFeedItems] = useState<Topic[]>([]);
  const [feedPage, setFeedPage] = useState(1);
  const [feedNextCursor, setFeedNextCursor] = useState<string | undefined>();
  const [feedHasMore, setFeedHasMore] = useState(false);
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
  const [topicReplies, setTopicReplies] = useState<Reply[]>([]);
  const [replyNextPage, setReplyNextPage] = useState<number | null>(null);
  const [replyNextOffset, setReplyNextOffset] = useState<number | null>(null);
  const [replyHasMore, setReplyHasMore] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const [replyContent, setReplyContent] = useState('');
  const [expandedQuotes, setExpandedQuotes] = useState<Record<string, boolean>>({});
  const [loadedQuotedReplies, setLoadedQuotedReplies] = useState<Record<number, Reply>>({});
  const [loadingQuotedFloors, setLoadingQuotedFloors] = useState<Record<string, boolean>>({});
  const [showLoginPanel, setShowLoginPanel] = useState(false);
  const [showCategoriesPanel, setShowCategoriesPanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [healthSummary, setHealthSummary] = useState('');
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);

  const theme = useMemo(() => createTheme(readerData.settings, systemScheme), [readerData.settings, systemScheme]);
  const styles = useMemo(() => createStyles(theme, readerData.settings), [readerData.settings, theme]);
  const htmlBaseStyle = useMemo<HtmlBaseStyle>(() => ({
    color: theme.ink,
    fontSize: Math.round(15 * readerData.settings.fontScale),
    lineHeight: Math.round(15 * readerData.settings.fontScale * lineHeightMultiplier(readerData.settings.lineHeight))
  }), [readerData.settings.fontScale, readerData.settings.lineHeight, theme.ink]);
  const htmlTagsStyles = useMemo<HtmlTagsStyles>(() => ({
    body: {
      color: theme.ink,
      backgroundColor: 'transparent'
    },
    p: {
      color: theme.ink
    },
    div: {
      color: theme.ink
    },
    span: {
      color: theme.ink
    },
    h1: {
      color: theme.ink,
      fontWeight: '700',
      lineHeight: Math.round(26 * readerData.settings.fontScale)
    },
    h2: {
      color: theme.ink,
      fontWeight: '700',
      lineHeight: Math.round(24 * readerData.settings.fontScale)
    },
    h3: {
      color: theme.ink,
      fontWeight: '600',
      lineHeight: Math.round(22 * readerData.settings.fontScale)
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
      color: theme.ink
    },
    ul: {
      color: theme.ink
    },
    ol: {
      color: theme.ink
    },
    blockquote: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderLeftWidth: 2,
      borderLeftColor: theme.lineStrong,
      color: theme.muted,
      paddingHorizontal: 10,
      paddingVertical: 8
    },
    pre: {
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      padding: 10
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
  }), [readerData.settings.fontScale, theme]);
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
  const contentWidth = Math.min(width - 32, contentWidthValue(readerData.settings.contentWidth));

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

  const shownFeedItems = useMemo(
    () => applyFeedFilter(feedItems, readerData, readingFilter),
    [feedItems, readerData, readingFilter]
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
  const openImagePreview = useCallback((url: string) => {
    const nextPreview = createImagePreviewList({
      tappedUrl: url,
      htmlParts: topicHtmlParts,
      serverUrl
    });
    if (nextPreview.urls.length > 0) {
      setImagePreview(nextPreview);
    }
  }, [serverUrl, topicHtmlParts]);
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
        void Linking.openURL(href);
      }
    },
    img: {
      enableExperimentalPercentWidth: true
    }
  }), [openImagePreview]);

  const commitReaderData = useCallback((updater: (current: ReaderData) => ReaderData) => {
    setReaderData((current) => {
      const next = sanitizeReaderData(updater(current));
      void saveReaderData(next).catch((error) => setStatus(errorMessage(error)));
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      const [savedReaderData, savedServerUrl, savedSyncCode, savedCookie] = await Promise.all([
        loadReaderData(),
        SecureStore.getItemAsync(SERVER_URL_STORAGE_KEY),
        SecureStore.getItemAsync(SYNC_CODE_STORAGE_KEY),
        SecureStore.getItemAsync(COOKIE_STORAGE_KEY)
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
        setStatus('已找到本机保存的 NodeSeek Cookie。');
      }
    })();
  }, []);

  const saveServerSettings = useCallback(async () => {
    try {
      const cleanServerUrl = normalizeServerUrl(serverUrl);
      await SecureStore.setItemAsync(SERVER_URL_STORAGE_KEY, cleanServerUrl);
      await SecureStore.setItemAsync(SYNC_CODE_STORAGE_KEY, syncCode.trim());
      setServerUrl(cleanServerUrl);
      setStatus('服务器地址和同步码已保存在本机。');
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [serverUrl, syncCode]);

  const loadCategories = useCallback(async () => {
    if (!serverUrl.trim()) {
      return;
    }
    try {
      const data = await getCategories({ serverUrl, source: 'all' });
      setCategories(data.items);
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
        setStatus(errors.map(([source, message]) => `${sourceLabel(source as Source)}：${message}`).join('；'));
      }
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }, [serverUrl]);

  const loadFeed = useCallback(async ({
    page = 1,
    cursor,
    reset = false,
    source = feedSource,
    category = categoryFilter,
    nocache = false
  }: {
    page?: number;
    cursor?: string;
    reset?: boolean;
    source?: FeedSource;
    category?: string;
    nocache?: boolean;
  } = {}) => {
    if (!serverUrl.trim()) {
      setStatus('请输入服务器地址');
      return;
    }
    setBusy(true);
    try {
      const data = await getFeed({
        serverUrl,
        source,
        page,
        cursor,
        limit: 30,
        category: category || undefined,
        nocache
      });
      setFeedItems((current) => reset ? data.items : mergeTopics(current, data.items));
      setFeedPage(page);
      setFeedNextCursor(data.nextCursor ?? undefined);
      setFeedHasMore(Boolean(data.hasMore && data.nextPage));
      const errors = Object.entries(data.errors || {});
      if (errors.length) {
        setStatus(errors.map(([sourceName, message]) => `${sourceLabel(sourceName as Source)}：${message}`).join('；'));
      } else {
        setStatus(category ? `已读取 ${sourceLabel(source)}「${category}」` : `已读取 ${sourceLabel(source)}主题`);
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [categoryFilter, feedSource, serverUrl]);

  useEffect(() => {
    void loadFeed({ reset: true, page: 1, source: feedSource, category: categoryFilter });
  }, [categoryFilter, feedSource, loadFeed]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const refreshFeed = useCallback(() => {
    void loadFeed({ reset: true, page: 1, nocache: true });
    void loadCategories();
  }, [loadCategories, loadFeed]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) {
      setStatus('请输入搜索词');
      return;
    }
    setBusy(true);
    try {
      if (searchScope === 'local') {
        setSearchItems(searchLocal(readerData, query, searchSource));
        setStatus('本地搜索完成');
      } else {
        const data = await searchTopics({ serverUrl, query, source: searchSource, limit: 30 });
        setSearchItems(data.items);
        commitReaderData((current) => addSavedSearch(current, query, searchSource));
        const errors = Object.entries(data.errors || {});
        setStatus(errors.length
          ? errors.map(([sourceName, message]) => `${sourceLabel(sourceName as Source)}：${message}`).join('；')
          : `搜索完成：${data.items.length} 条结果`);
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [commitReaderData, readerData, searchQuery, searchScope, searchSource, serverUrl]);

  const openTopic = useCallback(async (topic: Topic, nocache = false) => {
    setSelectedTopic(topic);
    setTopicDetail(null);
    setTopicReplies([]);
    setReplyContent('');
    setReplyFilter('all');
    setExpandedQuotes({});
    setLoadedQuotedReplies({});
    setLoadingQuotedFloors({});
    setScreen('topic');
    setBusy(true);
    try {
      const detail = await getTopic({ serverUrl, source: topic.source, id: topic.id, nocache });
      setTopicDetail(detail);
      setTopicReplies(detail.replies || []);
      setReplyHasMore(Boolean(detail.replyHasMore && detail.replyNextPage));
      setReplyNextPage(detail.replyNextPage ?? null);
      setReplyNextOffset(detail.replyNextOffset ?? null);
      commitReaderData((current) => recordHistory(current, detail));
      setStatus('主题已读取');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [commitReaderData, serverUrl]);

  const loadMoreReplies = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail || !replyNextPage) {
      return;
    }
    setBusy(true);
    try {
      const data = await getReplies({
        serverUrl,
        source: detail.source,
        id: detail.id,
        page: replyNextPage,
        limit: 30,
        offset: replyNextOffset
      });
      setTopicReplies((current) => [...current, ...data.items]);
      setReplyHasMore(Boolean(data.hasMore && data.nextPage));
      setReplyNextPage(data.nextPage ?? null);
      setReplyNextOffset(data.nextOffset ?? null);
      setStatus(`已加载 ${data.items.length} 条回复`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [replyNextOffset, replyNextPage, selectedTopic, serverUrl, topicDetail]);

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
    if (expandedQuotes[key]) {
      setExpandedQuotes((current) => ({ ...current, [key]: false }));
      return;
    }

    if (quotedReply || loadedQuotedReplies[quotedFloor]) {
      setExpandedQuotes((current) => ({ ...current, [key]: true }));
      return;
    }

    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'linuxdo') {
      setStatus('引用楼层未加载');
      setExpandedQuotes((current) => ({ ...current, [key]: true }));
      return;
    }

    setLoadingQuotedFloors((current) => ({ ...current, [key]: true }));
    try {
      const loaded = await getReply({
        serverUrl,
        source: detail.source,
        id: detail.id,
        floor: quotedFloor
      });
      if (loaded.floor) {
        setLoadedQuotedReplies((current) => ({ ...current, [loaded.floor as number]: loaded }));
      }
      setExpandedQuotes((current) => ({ ...current, [key]: true }));
      setStatus(`已读取引用 #${quotedFloor}`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoadingQuotedFloors((current) => ({ ...current, [key]: false }));
    }
  }, [expandedQuotes, loadedQuotedReplies, selectedTopic, serverUrl, topicDetail]);

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
        setStatus('已检测到 NodeSeek 登录 Cookie，已保存在本机。');
      } else {
        setStatus('没有检测到明确的 NodeSeek 登录 Cookie。请确认已经登录后再试。');
      }
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }, [probeLoginPage]);

  const clearLogin = useCallback(async () => {
    await SecureStore.deleteItemAsync(COOKIE_STORAGE_KEY);
    setHasNodeSeekCookie(false);
    setCookieNames([]);
    setWebLoginUserId(null);
    setStatus('已清除本机保存的 NodeSeek Cookie。');
  }, []);

  const runNodeSeekRequest = useCallback(async (requestFactory: () => NodeSeekActionRequest, success: string) => {
    if (!hasNodeSeekCookie) {
      setStatus('请先在“更多”里登录并检测 NodeSeek Cookie。');
      return false;
    }
    setActionBusy(true);
    try {
      const cookieHeader = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);
      await runNodeSeekAction({
        cookieHeader: cookieHeader || '',
        request: requestFactory()
      });
      setStatus(success);
      if (topicDetail?.source === 'nodeseek') {
        await openTopic(topicDetail, true);
      }
      return true;
    } catch (error) {
      setStatus(errorMessage(error));
      return false;
    } finally {
      setActionBusy(false);
    }
  }, [hasNodeSeekCookie, openTopic, topicDetail]);

  const submitReply = useCallback(async () => {
    const detail = topicDetail || selectedTopic;
    if (!detail || detail.source !== 'nodeseek') {
      return;
    }
    const submitted = await runNodeSeekRequest(
      () => buildNodeSeekReplyRequest({ postId: detail.id, content: replyContent }),
      '回复已提交'
    );
    if (submitted) {
      setReplyContent('');
    }
  }, [replyContent, runNodeSeekRequest, selectedTopic, topicDetail]);

  const checkIn = useCallback(async () => {
    await runNodeSeekRequest(
      () => buildNodeSeekAttendanceRequest({ random: false }),
      '签到请求已提交'
    );
  }, [runNodeSeekRequest]);

  const interact = useCallback(async (type: 'upvote' | 'like', commentId?: number) => {
    if (!commentId) {
      setStatus('当前内容缺少评论 id，刷新主题后再试。');
      return;
    }
    await runNodeSeekRequest(
      () => buildNodeSeekInteractionRequest({ type, commentId }),
      type === 'upvote' ? '点赞请求已提交' : '感谢请求已提交'
    );
  }, [runNodeSeekRequest]);

  const pullSync = useCallback(async () => {
    setBusy(true);
    try {
      const data = sanitizeReaderData(await pullReaderData(serverUrl, syncCode));
      setReaderData(await saveReaderData(data));
      setStatus('同步读取成功。');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [serverUrl, syncCode]);

  const pushSync = useCallback(async () => {
    setBusy(true);
    try {
      await pushReaderData(serverUrl, syncCode, sanitizeReaderData(readerData));
      setStatus('同步保存成功。');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [readerData, serverUrl, syncCode]);

  const checkHealth = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/health`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const sourceStatus = sources.map((source) => `${sourceLabel(source)} ${data.sources?.[source]?.ok ? '可用' : '不可用'}`).join(' · ');
      setHealthSummary(sourceStatus);
      setStatus('状态检查完成。');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [serverUrl]);

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

  return (
    <SafeAreaView style={styles.screen}>
      <ExpoStatusBar style={theme.dark ? 'light' : 'dark'} />
      {screen === 'topic' ? (
        <TopicScreen
          actionBusy={actionBusy}
          canUseNodeSeekActions={hasNodeSeekCookie}
          contentWidth={contentWidth}
          htmlBaseStyle={htmlBaseStyle}
          htmlIgnoredStyles={htmlIgnoredStyles}
          htmlRenderers={htmlRenderers}
          htmlRenderersProps={htmlRenderersProps}
          htmlTagsStyles={htmlTagsStyles}
          expandedQuotes={expandedQuotes}
          loadedQuotedReplies={loadedQuotedReplies}
          loadingQuotedFloors={loadingQuotedFloors}
          readerData={readerData}
          replyContent={replyContent}
          replyFilter={replyFilter}
          replyHasMore={replyHasMore}
          replies={filteredReplies}
          selectedTopic={selectedTopic}
          sourceReplies={topicReplies}
          styles={styles}
          theme={theme}
          topic={topicDetail}
          onBack={() => setScreen('feed')}
          onInteract={interact}
          onLoadMoreReplies={loadMoreReplies}
          onOpenOriginal={(url) => void Linking.openURL(url)}
          onReplyContentChange={setReplyContent}
          onReplyFilterChange={setReplyFilter}
          onSubmitReply={submitReply}
          onToggleQuotedFloor={toggleQuotedFloor}
          onBlockAuthor={(author) => updateSettings({ blockedUsers: appendUnique(settingsList(readerData.settings.blockedUsers), author) })}
          onBlockCategory={(category) => {
            const source = topicDetail?.source || selectedTopic?.source;
            if (source) {
              updateSettings({ blockedCategories: appendUnique(settingsList(readerData.settings.blockedCategories), `${source}:${category.replace(/^#/, '')}`) });
            }
          }}
          onToggleFavorite={(topic) => commitReaderData((current) => toggleFavorite(current, topic))}
          onToggleLater={(topic) => commitReaderData((current) => toggleLater(current, topic))}
        />
      ) : (
        <>
          <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
            {screen === 'feed' ? (
              <FeedScreen
                busy={busy || actionBusy}
                categoryFilter={categoryFilter}
                feedHasMore={feedHasMore}
                feedItems={shownFeedItems}
                feedPage={feedPage}
                feedSource={feedSource}
                readerData={readerData}
                readingFilter={readingFilter}
                status={status}
                styles={styles}
                theme={theme}
                onCategoryClear={() => setCategoryFilter('')}
                onFeedSourceChange={(source) => {
                  setFeedSource(source);
                  setCategoryFilter('');
                }}
                onLoadMore={() => loadFeed({ page: feedPage + 1, cursor: feedSource === 'all' ? feedNextCursor : undefined })}
                onOpenTopic={openTopic}
                onReadingFilterChange={setReadingFilter}
                onRefresh={refreshFeed}
                onToggleFavorite={(topic) => commitReaderData((current) => toggleFavorite(current, topic))}
                onToggleLater={(topic) => commitReaderData((current) => toggleLater(current, topic))}
              />
            ) : null}
            {screen === 'search' ? (
              <SearchScreen
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
                onRemove={(topic) => commitReaderData((current) => removeRecord(current, libraryTab, topic))}
                onTabChange={setLibraryTab}
              />
            ) : null}
            {screen === 'more' ? (
              <MoreScreen
                categories={categories}
                checking={checking}
                hasNodeSeekCookie={hasNodeSeekCookie}
                healthSummary={healthSummary}
                loginState={loginState}
                loadingLoginPage={loadingLoginPage}
                readerData={readerData}
                serverUrl={serverUrl}
                showCategoriesPanel={showCategoriesPanel}
                showLoginPanel={showLoginPanel}
                showSettingsPanel={showSettingsPanel}
                styles={styles}
                syncCode={syncCode}
                theme={theme}
                webViewRef={webViewRef}
                onCheckHealth={checkHealth}
                onCheckIn={checkIn}
                onCheckLogin={checkLogin}
                onClearLogin={clearLogin}
                onHandleLoginMessage={handleLoginMessage}
                onPullSync={pullSync}
                onPushSync={pushSync}
                onRefreshCategories={loadCategories}
                onSaveServerSettings={saveServerSettings}
                onSelectCategory={selectCategory}
                onServerUrlChange={setServerUrl}
                onSetLoadingLoginPage={setLoadingLoginPage}
                onShowCategoriesPanelChange={setShowCategoriesPanel}
                onShowLoginPanelChange={setShowLoginPanel}
                onShowSettingsPanelChange={setShowSettingsPanel}
                onSyncCodeChange={setSyncCode}
                onToggleSubscription={(category) => commitReaderData((current) => toggleSubscription(current, category))}
                onUpdateSettings={updateSettings}
              />
            ) : null}
          </ScrollView>
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
  );
}

function FeedScreen({
  busy,
  categoryFilter,
  feedHasMore,
  feedItems,
  feedPage,
  feedSource,
  readerData,
  readingFilter,
  status,
  styles,
  theme,
  onCategoryClear,
  onFeedSourceChange,
  onLoadMore,
  onOpenTopic,
  onReadingFilterChange,
  onRefresh,
  onToggleFavorite,
  onToggleLater
}: {
  busy: boolean;
  categoryFilter: string;
  feedHasMore: boolean;
  feedItems: Topic[];
  feedPage: number;
  feedSource: FeedSource;
  readerData: ReaderData;
  readingFilter: ReadingFilter;
  status: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCategoryClear: () => void;
  onFeedSourceChange: (source: FeedSource) => void;
  onLoadMore: () => void;
  onOpenTopic: (topic: Topic) => void;
  onReadingFilterChange: (filter: ReadingFilter) => void;
  onRefresh: () => void;
  onToggleFavorite: (topic: Topic) => void;
  onToggleLater: (topic: Topic) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.homeHeader}>
        <View style={styles.flex}>
          <View style={styles.homeTitleRow}>
            <Text style={styles.homeTitle}>{categoryFilter ? `节点：${categoryFilter}` : '阅坛'}</Text>
            {busy ? <ActivityIndicator color={theme.primary} /> : null}
          </View>
          <Text style={styles.status}>{status}</Text>
        </View>
        <IconButton icon={RefreshCw} label="刷新" styles={styles} theme={theme} onPress={onRefresh} />
      </View>
      <PillRail
        variant="tabs"
        items={[
          { value: 'all', label: '全部' },
          { value: 'v2ex', label: 'V2EX' },
          { value: 'linuxdo', label: 'linux.do' },
          { value: 'nodeseek', label: 'NodeSeek' }
        ]}
        value={feedSource}
        styles={styles}
        onChange={(value) => onFeedSourceChange(value as FeedSource)}
      />
      <PillRail
        items={[
          { value: 'all', label: '全部' },
          { value: 'unread', label: '未读' },
          { value: 'read', label: '已读' },
          { value: 'favorite', label: '收藏' },
          { value: 'later', label: '稍后读' },
          { value: 'subscribed', label: '我的订阅' },
          { value: 'active', label: '最近活跃' },
          { value: 'hot', label: '热门' }
        ]}
        value={readingFilter}
        styles={styles}
        onChange={(value) => onReadingFilterChange(value as ReadingFilter)}
      />
      {categoryFilter ? <AppButton label="清除节点筛选" variant="ghost" styles={styles} onPress={onCategoryClear} /> : null}
      <View style={styles.feedList}>
        {feedItems.length ? feedItems.map((topic) => (
          <TopicCard
            key={topicKey(topic)}
            readerData={readerData}
            styles={styles}
            theme={theme}
            topic={topic}
            onOpen={() => onOpenTopic(topic)}
            onToggleFavorite={() => onToggleFavorite(topic)}
            onToggleLater={() => onToggleLater(topic)}
          />
        )) : <EmptyText text="暂无主题" styles={styles} />}
      </View>
      {feedHasMore ? <AppButton label={`加载第 ${feedPage + 1} 页`} styles={styles} onPress={onLoadMore} /> : null}
    </View>
  );
}

function SearchScreen({
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
  onSortChange
}: {
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
}) {
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>搜索</Text>
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
        <IconButton icon={Search} label="搜索" styles={styles} theme={theme} onPress={onSearch} />
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
          { value: 'nodeseek', label: 'NodeSeek' }
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
          items={readerData.savedSearches.map((item) => ({ value: item.query, label: item.query }))}
          value=""
          styles={styles}
          onChange={onQueryChange}
        />
      ) : null}
      <View style={styles.feedList}>
        {results.length ? results.map((topic) => (
          <TopicCard key={topicKey(topic)} topic={topic} readerData={readerData} styles={styles} theme={theme} onOpen={() => onOpenTopic(topic)} />
        )) : <EmptyText text={query.trim() ? '暂无搜索结果' : '输入关键词后开始搜索'} styles={styles} />}
      </View>
    </View>
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
  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>书架</Text>
      <PillRail
        items={[
          { value: 'favorites', label: '收藏' },
          { value: 'later', label: '稍后读' },
          { value: 'history', label: '历史' }
        ]}
        value={libraryTab}
        styles={styles}
        onChange={(value) => onTabChange(value as LibraryTab)}
      />
      <View style={styles.feedList}>
        {topics.length ? topics.map((topic) => (
          <View key={topicKey(topic)} style={styles.libraryItem}>
            <TopicCard topic={topic} readerData={readerData} styles={styles} theme={theme} onOpen={() => onOpenTopic(topic)} />
            <AppButton label={libraryTab === 'later' ? '完成' : '删除'} variant="ghost" styles={styles} onPress={() => onRemove(topic)} />
          </View>
        )) : <EmptyText text="这里还没有内容" styles={styles} />}
      </View>
    </View>
  );
}

function MoreScreen({
  categories,
  checking,
  hasNodeSeekCookie,
  healthSummary,
  loginState,
  loadingLoginPage,
  readerData,
  serverUrl,
  showCategoriesPanel,
  showLoginPanel,
  showSettingsPanel,
  styles,
  syncCode,
  theme,
  webViewRef,
  onCheckHealth,
  onCheckIn,
  onCheckLogin,
  onClearLogin,
  onHandleLoginMessage,
  onPullSync,
  onPushSync,
  onRefreshCategories,
  onSaveServerSettings,
  onSelectCategory,
  onServerUrlChange,
  onSetLoadingLoginPage,
  onShowCategoriesPanelChange,
  onShowLoginPanelChange,
  onShowSettingsPanelChange,
  onSyncCodeChange,
  onToggleSubscription,
  onUpdateSettings
}: {
  categories: Category[];
  checking: boolean;
  hasNodeSeekCookie: boolean;
  healthSummary: string;
  loginState: string;
  loadingLoginPage: boolean;
  readerData: ReaderData;
  serverUrl: string;
  showCategoriesPanel: boolean;
  showLoginPanel: boolean;
  showSettingsPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  syncCode: string;
  theme: ReaderTheme;
  webViewRef: React.RefObject<WebView | null>;
  onCheckHealth: () => void;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onClearLogin: () => void;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onPullSync: () => void;
  onPushSync: () => void;
  onRefreshCategories: () => void;
  onSaveServerSettings: () => void;
  onSelectCategory: (category: Category) => void;
  onServerUrlChange: (value: string) => void;
  onSetLoadingLoginPage: (value: boolean) => void;
  onShowCategoriesPanelChange: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
  onShowSettingsPanelChange: (value: boolean) => void;
  onSyncCodeChange: (value: string) => void;
  onToggleSubscription: (category: Category) => void;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
}) {
  const favoriteCount = Object.keys(readerData.favorites).length;
  const laterCount = Object.keys(readerData.later).length;
  const grouped = sources.map((source) => ({
    source,
    items: categories.filter((category) => category.source === source)
  }));

  return (
    <View style={styles.stack}>
      <Text style={styles.sectionTitle}>更多</Text>
      <View style={styles.group}>
        <InfoRow icon={Star} label="收藏" value={String(favoriteCount)} styles={styles} theme={theme} />
        <InfoRow icon={Clock3} label="稍后读" value={String(laterCount)} styles={styles} theme={theme} />
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
          <AppButton label="读取同步" variant="ghost" styles={styles} onPress={onPullSync} />
          <AppButton label="保存同步" variant="ghost" styles={styles} onPress={onPushSync} />
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
                    <Pressable style={styles.flex} onPress={() => onSelectCategory(category)}>
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
        <Pressable key={item} style={styles.removableChip} onPress={() => onRemove(item)}>
          <Text style={styles.pillText}>{item} ×</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TopicScreen({
  actionBusy,
  canUseNodeSeekActions,
  contentWidth,
  htmlBaseStyle,
  htmlIgnoredStyles,
  htmlRenderers,
  htmlRenderersProps,
  htmlTagsStyles,
  expandedQuotes,
  loadedQuotedReplies,
  loadingQuotedFloors,
  readerData,
  replyContent,
  replyFilter,
  replyHasMore,
  replies,
  selectedTopic,
  sourceReplies,
  styles,
  theme,
  topic,
  onBack,
  onInteract,
  onLoadMoreReplies,
  onOpenOriginal,
  onReplyContentChange,
  onReplyFilterChange,
  onSubmitReply,
  onToggleQuotedFloor,
  onBlockAuthor,
  onBlockCategory,
  onToggleFavorite,
  onToggleLater
}: {
  actionBusy: boolean;
  canUseNodeSeekActions: boolean;
  contentWidth: number;
  htmlBaseStyle: HtmlBaseStyle;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderers: HtmlRenderers;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  readerData: ReaderData;
  replyContent: string;
  replyFilter: ReplyFilter;
  replyHasMore: boolean;
  replies: Reply[];
  selectedTopic: Topic | null;
  sourceReplies: Reply[];
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  topic: TopicDetail | null;
  onBack: () => void;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onLoadMoreReplies: () => void;
  onOpenOriginal: (url: string) => void;
  onReplyContentChange: (value: string) => void;
  onReplyFilterChange: (filter: ReplyFilter) => void;
  onSubmitReply: () => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
  onBlockAuthor: (author: string) => void;
  onBlockCategory: (category: string) => void;
  onToggleFavorite: (topic: Topic) => void;
  onToggleLater: (topic: Topic) => void;
}) {
  const item = topic || selectedTopic;
  if (!item) {
    return <EmptyText text="未选择主题" styles={styles} />;
  }
  const canWrite = item.source === 'nodeseek' && canUseNodeSeekActions;
  const repliesByFloor = new Map<number, Reply>();
  sourceReplies.forEach((reply, index) => {
    repliesByFloor.set(reply.floor ?? index + 1, reply);
  });
  Object.values(loadedQuotedReplies).forEach((reply) => {
    if (reply.floor) {
      repliesByFloor.set(reply.floor, reply);
    }
  });

  return (
    <>
      <View style={styles.topicTopBar}>
        <IconButton icon={ChevronLeft} compact label="返回" styles={styles} theme={theme} onPress={onBack} />
        <View style={styles.topicTopActions}>
          <IconButton icon={Star} compact label={isFavorite(readerData, item) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, item)} onPress={() => onToggleFavorite(item)} />
          <IconButton icon={ExternalLink} compact label="原站" styles={styles} theme={theme} onPress={() => onOpenOriginal(item.url)} />
        </View>
      </View>
      <ScrollView style={[styles.content, styles.topicContent]} contentContainerStyle={[styles.contentInner, styles.topicContentInner]}>
        <View style={[styles.article, { maxWidth: contentWidth }]}>
          <Text style={styles.sourceText}>{sourceLabel(item.source)}{item.category ? ` · ${item.category}` : ''}</Text>
          <Text style={styles.articleTitle}>{item.title}</Text>
          <Text style={styles.meta}>{item.author || '未知作者'} · {formatDateTime(item.createdAt)}</Text>
          <Text style={styles.meta}>{item.replyCount} 回复{item.viewCount ? ` · ${item.viewCount} 浏览` : ''}</Text>
          <View style={styles.actions}>
            <AppButton label={isLater(readerData, item) ? '取消稍后读' : '稍后读'} variant="ghost" styles={styles} onPress={() => onToggleLater(item)} />
            {item.author ? <AppButton label="屏蔽作者" variant="ghost" styles={styles} onPress={() => onBlockAuthor(item.author)} /> : null}
            {item.category ? <AppButton label="屏蔽节点" variant="ghost" styles={styles} onPress={() => onBlockCategory(item.category as string)} /> : null}
            {canWrite ? (
              <>
                <IconButton icon={ThumbsUp} label={`点赞 ${topic?.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', topic?.commentId)} />
                <IconButton icon={Heart} label={`感谢 ${topic?.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', topic?.commentId)} />
              </>
            ) : null}
          </View>
          {!canWrite ? <Text style={styles.readonlyNote}>本地只读，回复请到原站</Text> : null}
          {topic ? (
            <RenderHTML
              contentWidth={contentWidth}
              source={{ html: topic.contentHtml || '<p></p>' }}
              baseStyle={htmlBaseStyle}
              ignoredStyles={htmlIgnoredStyles}
              renderers={htmlRenderers}
              renderersProps={htmlRenderersProps}
              tagsStyles={htmlTagsStyles}
            />
          ) : <ActivityIndicator color={theme.primary} />}
        </View>
        {canWrite ? (
          <View style={[styles.replyBox, { maxWidth: contentWidth }]}>
            <Text style={styles.panelTitle}>回复</Text>
            <TextInput
              style={[styles.input, styles.replyInput]}
              value={replyContent}
              onChangeText={onReplyContentChange}
              placeholder="输入回复内容"
              placeholderTextColor={theme.muted}
              multiline
            />
            <AppButton label="发送回复" styles={styles} disabled={actionBusy} onPress={onSubmitReply} />
          </View>
        ) : null}
        <View style={[styles.replyHeader, { maxWidth: contentWidth }]}>
          <Text style={styles.sectionTitle}>回复列表 <Text style={styles.countText}>{sourceReplies.length} 条</Text></Text>
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
        <View style={[styles.replyList, { maxWidth: contentWidth }]}>
          {replies.length ? replies.map((reply, index) => (
            <ReplyCard
              key={`${reply.floor ?? index}-${reply.createdAt}`}
              actionBusy={actionBusy}
              canWrite={canWrite}
              contentWidth={contentWidth}
              expandedQuotes={expandedQuotes}
              htmlBaseStyle={htmlBaseStyle}
              htmlIgnoredStyles={htmlIgnoredStyles}
              htmlRenderers={htmlRenderers}
              htmlRenderersProps={htmlRenderersProps}
              htmlTagsStyles={htmlTagsStyles}
              loadedQuotedReplies={loadedQuotedReplies}
              loadingQuotedFloors={loadingQuotedFloors}
              reply={reply}
              replyFloor={reply.floor ?? index + 1}
              repliesByFloor={repliesByFloor}
              styles={styles}
              theme={theme}
              onInteract={onInteract}
              onToggleQuotedFloor={onToggleQuotedFloor}
            />
          )) : <EmptyText text="暂无回复" styles={styles} />}
        </View>
        {replyHasMore ? <AppButton label="加载更多回复" styles={styles} onPress={onLoadMoreReplies} /> : null}
      </ScrollView>
    </>
  );
}

function ReplyCard({
  actionBusy,
  canWrite,
  contentWidth,
  expandedQuotes,
  htmlBaseStyle,
  htmlIgnoredStyles,
  htmlRenderers,
  htmlRenderersProps,
  htmlTagsStyles,
  loadedQuotedReplies,
  loadingQuotedFloors,
  reply,
  replyFloor,
  repliesByFloor,
  styles,
  theme,
  onInteract,
  onToggleQuotedFloor
}: {
  actionBusy: boolean;
  canWrite: boolean;
  contentWidth: number;
  expandedQuotes: Record<string, boolean>;
  htmlBaseStyle: HtmlBaseStyle;
  htmlIgnoredStyles: HtmlIgnoredStyles;
  htmlRenderers: HtmlRenderers;
  htmlRenderersProps: HtmlRenderersProps;
  htmlTagsStyles: HtmlTagsStyles;
  loadedQuotedReplies: Record<number, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  reply: Reply;
  replyFloor: number;
  repliesByFloor: Map<number, Reply>;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onInteract: (type: 'upvote' | 'like', commentId?: number) => void;
  onToggleQuotedFloor: (options: { replyFloor: number; quotedFloor: number; quotedReply?: Reply }) => void;
}) {
  const quotedFloors = Array.from(new Set(reply.quotedFloors || []));
  return (
    <View style={styles.replyCard}>
      <Text style={styles.replyMeta}>#{reply.floor ?? '-'} {reply.author || '未知作者'} · {formatDateTime(reply.createdAt)}</Text>
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
                    <RenderHTML
                      contentWidth={Math.max(240, contentWidth - 44)}
                      source={{ html: quotedReply.contentHtml || '<p></p>' }}
                      baseStyle={htmlBaseStyle}
                      ignoredStyles={htmlIgnoredStyles}
                      renderers={htmlRenderers}
                      renderersProps={htmlRenderersProps}
                      tagsStyles={htmlTagsStyles}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      <RenderHTML
        contentWidth={contentWidth}
        source={{ html: reply.contentHtml || '<p></p>' }}
        baseStyle={htmlBaseStyle}
        ignoredStyles={htmlIgnoredStyles}
        renderers={htmlRenderers}
        renderersProps={htmlRenderersProps}
        tagsStyles={htmlTagsStyles}
      />
      {canWrite ? (
        <View style={styles.actions}>
          <IconButton icon={ThumbsUp} label={`点赞 ${reply.upvoteCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('upvote', reply.commentId)} />
          <IconButton icon={Heart} label={`感谢 ${reply.likeCount ?? ''}`} styles={styles} theme={theme} disabled={actionBusy} onPress={() => onInteract('like', reply.commentId)} />
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
  if (!preview || preview.urls.length === 0) {
    return null;
  }
  const uri = preview.urls[preview.index] || preview.urls[0];
  const hasMany = preview.urls.length > 1;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.imagePreviewOverlay}>
        <View style={styles.imagePreviewTopBar}>
          <Text style={styles.imagePreviewCount}>{preview.index + 1} / {preview.urls.length}</Text>
          <Pressable accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
            <X size={22} color="#ffffff" strokeWidth={1.8} />
          </Pressable>
        </View>
        <Image source={{ uri }} style={styles.imagePreviewImage} resizeMode="contain" />
        {hasMany ? (
          <View style={styles.imagePreviewControls}>
            <Pressable accessibilityLabel="上一张图片" style={styles.imagePreviewControl} onPress={onPrevious}>
              <ChevronLeft size={25} color="#ffffff" strokeWidth={1.8} />
            </Pressable>
            <Pressable accessibilityLabel="下一张图片" style={styles.imagePreviewControl} onPress={onNext}>
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
  readerData,
  styles,
  theme,
  onOpen,
  onToggleFavorite,
  onToggleLater
}: {
  topic: Topic;
  readerData: ReaderData;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onOpen: () => void;
  onToggleFavorite?: () => void;
  onToggleLater?: () => void;
}) {
  const read = Boolean(readerData.history[topicKey(topic)]);
  const tracked = includesAnyKeyword(topicText(topic), readerData.settings.trackedKeywords);
  return (
    <View style={[styles.topicCard, read && styles.topicCardRead, tracked && styles.topicCardTracked]}>
      <Pressable onPress={onOpen}>
        <View style={styles.topicCardHead}>
          <Text style={styles.sourceText}>{sourceLabel(topic.source)}{topic.category ? ` · ${topic.category}` : ''}</Text>
          <Text style={styles.timeText}>{formatRelativeTime(topic.lastReplyAt || topic.createdAt)}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={readerData.settings.listDensity === 'loose' ? 3 : 2}>{topic.title || '无标题'}</Text>
        {topic.excerpt && readerData.settings.listDensity !== 'compact' ? <Text style={styles.excerpt} numberOfLines={2}>{topic.excerpt}</Text> : null}
        {tracked ? <Text style={styles.trackedText}>追踪命中</Text> : null}
      </Pressable>
      <View style={styles.topicMetaRow}>
        <Pressable style={styles.flex} onPress={onOpen}>
          <Text style={styles.meta}>{topic.author || '未知作者'} · {topic.replyCount} 回复{topic.viewCount ? ` · ${topic.viewCount} 浏览` : ''}</Text>
        </Pressable>
        <View style={styles.topicMarks}>
          {onToggleFavorite ? <IconButton icon={Star} compact iconOnly label={isFavorite(readerData, topic) ? '已收藏' : '收藏'} styles={styles} theme={theme} active={isFavorite(readerData, topic)} onPress={onToggleFavorite} /> : null}
          {onToggleLater ? <IconButton icon={Clock3} compact iconOnly label={isLater(readerData, topic) ? '已稍后读' : '稍后读'} styles={styles} theme={theme} active={isLater(readerData, topic)} onPress={onToggleLater} /> : null}
        </View>
      </View>
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
    { value: 'library', label: '书架', icon: BookMarked },
    { value: 'more', label: '更多', icon: MoreHorizontal }
  ];
  return (
    <View style={styles.nav}>
      {items.map((item) => {
        const Icon = item.icon;
        const selected = active === item.value;
        return (
          <Pressable key={item.value} style={[styles.navItem, selected && styles.navItemActive]} onPress={() => onChange(item.value)}>
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
          key={`${item.value}-${item.label}`}
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
    <Pressable style={styles.menuButton} onPress={onPress}>
      <View style={styles.menuIcon}>
        <Icon size={19} color={theme.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.meta}>{value}</Text>
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
      <Text style={styles.meta}>{value}</Text>
    </View>
  );
}

function IconButton({
  active = false,
  compact = false,
  disabled = false,
  iconOnly = false,
  icon,
  label,
  styles,
  theme,
  onPress
}: {
  active?: boolean;
  compact?: boolean;
  disabled?: boolean;
  iconOnly?: boolean;
  icon: LucideIcon;
  label: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const iconSize = iconOnly ? 14 : compact ? 15 : 17;
  return (
    <Pressable
      accessibilityLabel={label}
      style={[styles.button, compact && styles.buttonCompact, iconOnly && styles.buttonIconOnly, active && styles.buttonActive, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Icon size={iconSize} color={active ? theme.primary : theme.ink} strokeWidth={1.8} />
      {iconOnly ? null : <Text style={[styles.buttonText, active && styles.buttonTextActive]}>{label}</Text>}
    </Pressable>
  );
}

function AppButton({
  disabled = false,
  label,
  variant = 'default',
  styles,
  onPress
}: {
  disabled?: boolean;
  label: string;
  variant?: 'default' | 'ghost';
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.button, variant === 'ghost' && styles.buttonGhost, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function EmptyText({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function applyFeedFilter(items: Topic[], data: ReaderData, filter: ReadingFilter) {
  const visible = items.filter((topic) => {
    const text = topicText(topic);
    const category = topic.category ? `${topic.source}:${topic.category.replace(/^#/, '')}`.toLowerCase() : '';
    return !includesAnyKeyword(text, data.settings.blockedKeywords)
      && !data.settings.blockedUsers.some((user) => topic.author?.toLowerCase() === user.toLowerCase())
      && !data.settings.blockedCategories.some((blocked) => blocked.toLowerCase() === category);
  });

  if (filter === 'unread') {
    return visible.filter((topic) => !data.history[topicKey(topic)]);
  }
  if (filter === 'read') {
    return visible.filter((topic) => Boolean(data.history[topicKey(topic)]));
  }
  if (filter === 'favorite') {
    return visible.filter((topic) => Boolean(data.favorites[topicKey(topic)]));
  }
  if (filter === 'later') {
    return visible.filter((topic) => Boolean(data.later[topicKey(topic)]));
  }
  if (filter === 'subscribed') {
    return visible.filter((topic) => topic.category && Object.values(data.subscriptions).some((subscription) => (
      subscription.source === topic.source
      && [subscription.id, subscription.name].includes(topic.category!.replace(/^#/, ''))
    )));
  }
  if (filter === 'active') {
    return [...visible].sort((left, right) => dateTime(right.lastReplyAt || right.createdAt) - dateTime(left.lastReplyAt || left.createdAt));
  }
  if (filter === 'hot') {
    return [...visible].sort((left, right) => (right.replyCount + (right.viewCount || 0) / 100) - (left.replyCount + (left.viewCount || 0) / 100));
  }
  return visible;
}

function searchLocal(data: ReaderData, query: string, source: FeedSource) {
  const records = [
    ...Object.values(data.favorites),
    ...Object.values(data.history),
    ...Object.values(data.later)
  ];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  return records
    .filter((record) => {
      const topic = record.topic;
      const key = topicKey(topic);
      if (seen.has(key) || (source !== 'all' && topic.source !== source)) {
        return false;
      }
      const text = `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''} ${record.tags?.join(' ') || ''} ${record.note || ''}`.toLowerCase();
      const matched = terms.every((term) => text.includes(term));
      if (matched) {
        seen.add(key);
      }
      return matched;
    })
    .map((record) => record.topic);
}

function sortTopics(items: Topic[], sort: SearchSort) {
  if (sort === 'reply') {
    return [...items].sort((left, right) => right.replyCount - left.replyCount);
  }
  if (sort === 'view') {
    return [...items].sort((left, right) => (right.viewCount || 0) - (left.viewCount || 0));
  }
  if (sort === 'time') {
    return [...items].sort((left, right) => dateTime(right.lastReplyAt || right.createdAt) - dateTime(left.lastReplyAt || left.createdAt));
  }
  return items;
}

function mergeTopics(current: Topic[], incoming: Topic[]) {
  const seen = new Set(current.map((topic) => topicKey(topic)));
  const next = [...current];
  for (const topic of incoming) {
    const key = topicKey(topic);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(topic);
    }
  }
  return next;
}

function recordsToTopics(records: Record<string, { topic: Topic; savedAt: string }>) {
  return Object.values(records)
    .sort((left, right) => dateTime(right.savedAt) - dateTime(left.savedAt))
    .map((record) => record.topic);
}

function removeRecord(data: ReaderData, section: LibraryTab, topic: Topic) {
  const next = { ...data[section] };
  delete next[topicKey(topic)];
  return { ...data, [section]: next };
}

function topicText(topic: Topic) {
  return `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''}`.toLowerCase();
}

function includesAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function sourceLabel(source: Source | FeedSource) {
  if (source === 'all') {
    return '全部';
  }
  if (source === 'linuxdo') {
    return 'linux.do';
  }
  if (source === 'nodeseek') {
    return 'NodeSeek';
  }
  return 'V2EX';
}

function formatDateTime(value?: string) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatRelativeTime(value?: string) {
  const time = dateTime(value);
  if (!time) {
    return '';
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 60 * 60_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return `${Math.floor(diff / (24 * 60 * 60_000))} 天前`;
}

function dateTime(value?: string) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败';
}

function lineHeightMultiplier(value: ReaderSettings['lineHeight']) {
  if (value === 'compact') {
    return 1.45;
  }
  if (value === 'loose') {
    return 1.82;
  }
  return 1.62;
}

function contentWidthValue(value: ReaderSettings['contentWidth']) {
  if (value === 'narrow') {
    return 640;
  }
  if (value === 'wide') {
    return 820;
  }
  return 720;
}

function settingsList(value: string[]) {
  return Array.isArray(value) ? value : [];
}

function appendUnique(items: string[], value: string) {
  const clean = value.trim();
  if (!clean) {
    return items;
  }
  return [clean, ...items.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 100);
}

function removeString(items: string[], value: string) {
  return items.filter((item) => item !== value);
}

function alphaColor(hex: string, alpha: number) {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function createTheme(settings: ReaderSettings, systemScheme: 'light' | 'dark' | null | undefined): ReaderTheme {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemScheme === 'dark');
  const palette = {
    sage: { light: '#016826', dark: '#6dc17b', lightOn: '#fbfbf9', darkOn: '#0b100c' },
    coral: { light: '#94563e', dark: '#d39780', lightOn: '#fdfaf8', darkOn: '#130d0a' },
    blue: { light: '#326893', dark: '#80b1da', lightOn: '#f8fbfd', darkOn: '#0a0f13' },
    mint: { light: '#1f6954', dark: '#72b8a0', lightOn: '#f8fbfa', darkOn: '#09100d' },
    berry: { light: '#80557c', dark: '#c899c3', lightOn: '#fcf9fc', darkOn: '#110d11' },
    noir: { light: '#3f3723', dark: '#c4af7e', lightOn: '#f1ebdc', darkOn: '#110e08' }
  }[settings.palette];
  const backgrounds = {
    warm: { background: '#f7f7f2', surface2: '#f6f6f1', line: '#e8e8e2', lineStrong: '#d7d7cf' },
    white: { background: '#ffffff', surface2: '#f7f7f7', line: '#e5e5e5', lineStrong: '#d8d8d8' },
    gray: { background: '#f5f5f5', surface2: '#f7f7f7', line: '#e6e6e6', lineStrong: '#d9d9d9' }
  };
  const background = backgrounds[settings.background];
  if (dark) {
    return {
      dark: true,
      background: '#151713',
      surface: '#1b1d18',
      surface2: '#22251f',
      line: '#31342d',
      lineStrong: '#45493f',
      ink: '#eeeeea',
      muted: '#aaa79f',
      primary: palette.dark,
      primarySoft: alphaColor(palette.dark, 0.16),
      mist: '#203026',
      onPrimary: palette.darkOn,
      danger: '#da8378',
      success: palette.dark
    };
  }
  return {
    dark: false,
    background: background.background,
    surface: '#ffffff',
    surface2: background.surface2,
    line: background.line,
    lineStrong: background.lineStrong,
    ink: '#191919',
    muted: '#666666',
    primary: palette.light,
    primarySoft: alphaColor(palette.light, 0.07),
    mist: '#f2f8f2',
    onPrimary: palette.lightOn,
    danger: '#ad5349',
    success: palette.light
  };
}

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontScale = settings.fontScale;
  const listFontScale = Math.max(0.88, settings.fontScale * 0.93);
  const densityPadding = settings.listDensity === 'compact' ? 8 : settings.listDensity === 'loose' ? 14 : 11;
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background
    },
    homeHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10,
      paddingBottom: 2
    },
    homeTitleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    homeTitle: {
      color: theme.ink,
      fontSize: 21,
      fontWeight: '700'
    },
    status: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18
    },
    content: {
      flex: 1
    },
    topicContent: {
      backgroundColor: theme.surface
    },
    contentInner: {
      gap: 12,
      padding: 16,
      paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 4 : 14,
      paddingBottom: Platform.OS === 'android' ? 112 : 94
    },
    topicContentInner: {
      alignItems: 'center',
      paddingTop: 14
    },
    stack: {
      gap: 12,
      width: '100%'
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    sectionTitle: {
      color: theme.ink,
      fontSize: 18,
      fontWeight: '700'
    },
    countText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '500'
    },
    panelTitle: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '700'
    },
    feedList: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth
    },
    topicCard: {
      gap: 5,
      paddingVertical: densityPadding,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.background
    },
    topicCardRead: {
      opacity: 0.62
    },
    topicCardTracked: {
      backgroundColor: theme.primarySoft
    },
    topicCardHead: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
    },
    sourceText: {
      color: theme.primary,
      fontSize: 11,
      fontWeight: '600'
    },
    timeText: {
      color: theme.muted,
      fontSize: 11
    },
    cardTitle: {
      color: theme.ink,
      fontSize: Math.round(16 * listFontScale),
      fontWeight: '600',
      lineHeight: Math.round(22 * listFontScale)
    },
    excerpt: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18
    },
    meta: {
      color: theme.muted,
      fontSize: 11,
      lineHeight: 16
    },
    trackedText: {
      color: theme.primary,
      fontSize: 12,
      fontWeight: '700'
    },
    topicMarks: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 5
    },
    topicMetaRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    pillRail: {
      gap: 8,
      paddingVertical: 1
    },
    pill: {
      minHeight: 28,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4
    },
    pillActive: {
      backgroundColor: theme.mist
    },
    pillText: {
      color: theme.ink,
      fontSize: 11,
      fontWeight: '500'
    },
    pillTextActive: {
      color: theme.primary,
      fontWeight: '700'
    },
    tabRail: {
      gap: 16,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    tab: {
      minHeight: 31,
      justifyContent: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingBottom: 6
    },
    tabActive: {
      borderBottomColor: theme.primary
    },
    tabText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: '500'
    },
    tabTextActive: {
      color: theme.primary,
      fontWeight: '700'
    },
    input: {
      minHeight: 42,
      backgroundColor: theme.surface,
      borderColor: theme.lineStrong,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.ink,
      fontSize: 14,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    replyInput: {
      minHeight: 92,
      textAlignVertical: 'top'
    },
    searchRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8
    },
    flex: {
      flex: 1
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    button: {
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 11,
      paddingVertical: 7
    },
    buttonCompact: {
      minHeight: 26,
      paddingHorizontal: 7,
      paddingVertical: 4
    },
    buttonIconOnly: {
      width: 24,
      minHeight: 24,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    buttonGhost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    buttonActive: {
      backgroundColor: theme.mist,
      borderColor: 'transparent'
    },
    buttonDisabled: {
      opacity: 0.45
    },
    buttonText: {
      color: theme.ink,
      fontSize: 12,
      fontWeight: '700'
    },
    buttonTextActive: {
      color: theme.primary
    },
    empty: {
      color: theme.muted,
      fontSize: 13,
      paddingVertical: 24,
      textAlign: 'center'
    },
    group: {
      gap: 10,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    menuButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 10,
      minHeight: 44
    },
    menuIcon: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      borderRadius: 8,
      backgroundColor: theme.surface2
    },
    menuLabel: {
      color: theme.ink,
      fontSize: 15,
      fontWeight: '600'
    },
    categoryGroup: {
      gap: 8,
      paddingTop: 4
    },
    categoryItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 8,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 10
    },
    categoryName: {
      color: theme.ink,
      fontSize: 14,
      fontWeight: '600'
    },
    settingGroup: {
      gap: 7
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8
    },
    removableChip: {
      minHeight: 32,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 11,
      paddingVertical: 6
    },
    loginPanel: {
      gap: 10
    },
    webViewShell: {
      height: 480,
      overflow: 'hidden',
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: '#ffffff'
    },
    loading: {
      position: 'absolute',
      zIndex: 1,
      top: 14,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: theme.surface,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    loadingText: {
      color: theme.muted,
      fontSize: 12
    },
    libraryItem: {
      gap: 6
    },
    topicTopBar: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 4 : 10,
      paddingBottom: 6,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    topicTopActions: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6
    },
    article: {
      width: '100%',
      gap: 9,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      padding: 0
    },
    articleTitle: {
      color: theme.ink,
      fontSize: Math.round(20 * fontScale),
      fontWeight: '700',
      lineHeight: Math.round(28 * fontScale)
    },
    readonlyNote: {
      color: theme.muted,
      fontSize: 13,
      lineHeight: 20,
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 10
    },
    replyBox: {
      width: '100%',
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12
    },
    replyHeader: {
      width: '100%',
      gap: 8
    },
    replyList: {
      width: '100%',
      overflow: 'hidden',
      borderColor: 'transparent',
      borderRadius: 0,
      borderWidth: 0,
      backgroundColor: 'transparent'
    },
    replyCard: {
      gap: 8,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: 'transparent',
      padding: 14
    },
    quoteStack: {
      gap: 8
    },
    quoteBox: {
      gap: 6,
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 9
    },
    quoteBody: {
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingTop: 8
    },
    replyMeta: {
      color: theme.muted,
      fontSize: 12,
      lineHeight: 18
    },
    nav: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      left: 0,
      flexDirection: 'row',
      borderTopColor: theme.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      paddingBottom: Platform.OS === 'android' ? 18 : 8,
      paddingHorizontal: 10,
      paddingTop: 4
    },
    navItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
      minHeight: 48,
      borderRadius: 6
    },
    navItemActive: {
      backgroundColor: 'transparent'
    },
    navText: {
      color: theme.muted,
      fontSize: 10,
      fontWeight: '600'
    },
    navTextActive: {
      color: theme.primary
    },
    imagePreviewOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.94)'
    },
    imagePreviewTopBar: {
      position: 'absolute',
      top: Platform.OS === 'android' ? (NativeStatusBar.currentHeight ?? 0) + 10 : 18,
      right: 14,
      left: 14,
      zIndex: 2,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewCount: {
      color: '#ffffff',
      fontSize: 13,
      fontWeight: '600'
    },
    imagePreviewClose: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewImage: {
      width: '100%',
      height: '100%'
    },
    imagePreviewControls: {
      position: 'absolute',
      right: 18,
      bottom: Platform.OS === 'android' ? 30 : 24,
      left: 18,
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewControl: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    }
  });
}
