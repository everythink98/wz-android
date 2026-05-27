import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appConfigSource = readFileSync(join(process.cwd(), 'android-app', 'app.json'), 'utf8');
const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
const appControlsSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'components', 'AppControls.tsx'), 'utf8');
const topicCardSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'components', 'TopicCard.tsx'), 'utf8');
const imagePreviewModalSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'components', 'ImagePreviewModal.tsx'), 'utf8');
const feedScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'FeedScreen.tsx'), 'utf8');
const searchScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'SearchScreen.tsx'), 'utf8');
const libraryScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'LibraryScreen.tsx'), 'utf8');
const moreScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'MoreScreen.tsx'), 'utf8');
const topicScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'TopicScreen.tsx'), 'utf8');
const navBarSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'components', 'NavBar.tsx'), 'utf8');
const androidUiSource = [
  appSource,
  appControlsSource,
  topicCardSource,
  imagePreviewModalSource,
  feedScreenSource,
  searchScreenSource,
  libraryScreenSource,
  moreScreenSource,
  topicScreenSource,
  navBarSource
].join('\n');
const gitIgnoreSource = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
const localLinuxDoSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'localLinuxdo.ts'), 'utf8');
const linuxDoBridgeSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'linuxdoCookieBridge.ts'), 'utf8');
const nodeSeekBridgeSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'nodeseekCookieBridge.ts'), 'utf8');
const forumApiSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'forumApi.ts'), 'utf8');
const yaohuoApiSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'yaohuoApi.ts'), 'utf8');
const linuxDoCookiePluginPath = join(process.cwd(), 'android-app', 'plugins', 'withLinuxDoCookieModule.js');
const linuxDoCookiePluginSource = existsSync(linuxDoCookiePluginPath) ? readFileSync(linuxDoCookiePluginPath, 'utf8') : '';

describe('Android App experience guards', () => {
  it('keeps Android temporary dumps and cookie snapshots out of git', () => {
    expect(gitIgnoreSource).toContain('android-app/tmp-*');
  });

  it('does not use string-built dynamic imports in Android cookie bridges', () => {
    expect(linuxDoBridgeSource).not.toContain('new Function');
    expect(linuxDoBridgeSource).not.toContain('dynamicImport');
    expect(nodeSeekBridgeSource).not.toContain('new Function');
    expect(nodeSeekBridgeSource).not.toContain('dynamicImport');
  });

  it('does not keep unused server transport parameters in local Android APIs', () => {
    expect(forumApiSource).not.toMatch(/export (?:async )?function (?:getFeed|getCategories|getTopic|getReplies|getReply|searchTopics)[\s\S]*?serverUrl\?: string/);
    expect(yaohuoApiSource).not.toMatch(/\bserverUrl\?: string\b/);
    expect(yaohuoApiSource).not.toMatch(/\bserverFetcher\b/);
  });

  it('shows loading and failure states inside image preview', () => {
    expect(imagePreviewModalSource).toContain('imagePreviewLoading');
    expect(imagePreviewModalSource).toContain('imagePreviewFailed');
    expect(imagePreviewModalSource).toContain('onLoadStart={() =>');
    expect(imagePreviewModalSource).toContain('onError={() =>');
  });

  it('uses browser-like headers for Android reader images and image preview', () => {
    expect(appSource).toContain('imageSourceFromUrl(src, imageProps.source)');
    expect(appSource).toContain('imageRequestHeadersForUrl(uri)');
    expect(imagePreviewModalSource).toContain('imageSourceFromUrl(uri)');
    expect(imagePreviewModalSource).toContain('imageSourceFromUrl(url)');
  });

  it('keeps topic list rows free of swipe action controls', () => {
    expect(topicCardSource).not.toContain('topicSwipeActionButton');
    expect(androidUiSource).not.toContain('swipeAction=');
    expect(androidUiSource).not.toContain('TopicSwipeActionConfig');
    expect(androidUiSource).not.toContain('topicInlineAction');
    expect(androidUiSource).not.toContain('topicMetaPressable');
  });

  it('shows Android feed rows as unified forum topics instead of source-first reader entries', () => {
    expect(topicCardSource).toContain('styles.topicBadgeRow');
    expect(topicCardSource).toContain('styles.topicSourceBadge');
    expect(topicCardSource).toContain('styles.topicCategoryBadge');
    expect(topicCardSource).toContain('styles.topicStatPill');
    expect(topicCardSource).not.toContain("`${topic.replyCount} 回复`,");
    expect(topicCardSource).not.toContain("{sourceLabel(topic.source)}{topic.category ? ` · ${topic.category}` : ''}");
  });

  it('switches Android feed sources through a page-level horizontal gesture', () => {
    expect(feedScreenSource).toContain("from 'react-native-tab-view'");
    expect(feedScreenSource).toContain('renderTabBar={() => null}');
    expect(feedScreenSource).toContain('onIndexChange={handleFeedPageChange}');
    expect(feedScreenSource).not.toContain('PanResponder');
    expect(feedScreenSource).not.toContain('feedSourceSwipeDirection');
    expect(feedScreenSource).not.toContain('shouldCaptureFeedSourceSwipe');
  });

  it('uses more helpful empty messages for filtered feed lists', () => {
    expect(feedScreenSource).toContain('feedEmptyText');
    expect(feedScreenSource).toContain('当前筛选没有匹配主题');
  });

  it('loads additional feed pages automatically near the end of the list', () => {
    expect(feedScreenSource).toContain('onEndReachedThreshold={0.6}');
    expect(feedScreenSource).toContain('onEndReached={active ? requestFeedLoadMore : undefined}');
    expect(feedScreenSource).toContain('shouldLoadMoreFeedFromScroll(event.nativeEvent)');
    expect(feedScreenSource).toContain('requestedFeedPageRef.current === nextPage');
  });

  it('draws consistent separators between Android feed rows at the list level', () => {
    expect(feedScreenSource).toContain('const renderTopicSeparator');
    expect(feedScreenSource).toContain('ItemSeparatorComponent={active ? renderTopicSeparator : undefined}');
    expect(feedScreenSource).toContain('style={styles.topicListSeparator}');
  });

  it('uses lightweight underline states for Android feed and topic secondary tabs', () => {
    expect((feedScreenSource.match(/variant="subtabs"/g) || []).length).toBe(2);
    expect((topicScreenSource.match(/variant="subtabs"/g) || []).length).toBe(1);
    expect(appControlsSource).toContain("variant?: 'pills' | 'tabs' | 'subtabs';");
    expect(searchScreenSource).not.toContain('variant="subtabs"');
    expect(libraryScreenSource).not.toContain('variant="subtabs"');
  });

  it('supports native pull-to-refresh on the Android feed list', () => {
    expect(feedScreenSource).toContain('RefreshControl');
    expect(feedScreenSource).toContain('refreshControl={active ? (');
    expect(feedScreenSource).toContain('refreshing={refreshing}');
    expect(feedScreenSource).toContain('onRefresh={onRefresh}');
  });

  it('scrolls the active bottom tab back to the top when it is pressed again', () => {
    expect(appSource).toContain('const [tabScrollToTopSignals, setTabScrollToTopSignals]');
    expect(appSource).toContain('const requestTabScrollToTop = useCallback((target: keyof MainTabParamList) => {');
    expect(appSource).toContain('if (screen === targetScreen) {');
    expect(appSource).toContain('requestTabScrollToTop(targetScreen);');
    expect(feedScreenSource).toContain('scrollToTopSignal');
    expect(searchScreenSource).toContain('scrollToTopSignal');
    expect(libraryScreenSource).toContain('scrollToTopSignal');
    expect(appSource).toContain('moreScrollRef.current?.scrollTo({ y: 0, animated: true });');
  });

  it('resets the secondary feed rail scroll when the primary source tab changes', () => {
    expect(feedScreenSource).toContain('const secondaryRailResetKey = feedSource;');
    expect(feedScreenSource).toContain('resetScrollKey={secondaryRailResetKey}');
    expect(appControlsSource).toContain('resetScrollKey');
    expect(appControlsSource).toContain('scrollRef.current?.scrollTo({ x: 0, animated: false });');
  });

  it('keeps all-feed reading filters from reusing the remote feed paginator', () => {
    expect(appSource).toContain('shouldAllowFeedRemotePagination');
    expect(appSource).toContain('const feedAllowsRemotePagination = shouldAllowFeedRemotePagination(feedSource, readingFilter);');
    expect(appSource).toContain('feedHasMore={activeFeedState.hasMore && feedAllowsRemotePagination}');
    expect(appSource).toContain('if (!feedAllowsRemotePagination) {');
  });

  it('shows loading instead of stale rows when resetting the feed list', () => {
    expect(appSource).toContain('clearItems = reset && !nocache');
    expect(appSource).toContain('if (!isLoadMore && reset && clearItems) {');
    expect(appSource).toContain('setFeedStates((current) => ({');
    expect(appSource).toContain('items: [],');
    expect(appSource).toContain('hasMore: false');
  });

  it('uses separate busy states for feed, search, topic, and status work', () => {
    expect(appSource).toContain('const [feedBusy, setFeedBusy] = useState(false);');
    expect(appSource).toContain('const [searchBusy, setSearchBusy] = useState(false);');
    expect(appSource).toContain('const [topicBusy, setTopicBusy] = useState(false);');
    expect(appSource).toContain('const [statusBusy, setStatusBusy] = useState(false);');
    expect(appSource).not.toContain('const [busy, setBusy] = useState(false);');

    const loadFeedBlock = appSource.match(/const loadFeed = useCallback\(async \(\{([\s\S]*?)\n  \}, \[categoryFilter/)?.[1] || '';
    const runSearchBlock = appSource.match(/const runSearch = useCallback\(async \(sourceOverride\?: Source\) => \{([\s\S]*?)\n  \}, \[addRecentSearch/)?.[1] || '';
    const openTopicBlock = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState/)?.[1] || '';
    const loadMoreRepliesBlock = appSource.match(/const loadMoreReplies = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState/)?.[1] || '';
    const statusBlock = appSource.match(/const checkLocalStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[loadNodeSeekCookieForSource/)?.[1] || '';

    expect(loadFeedBlock).toContain('setFeedBusy(true);');
    expect(loadFeedBlock).toContain('setFeedBusy(false);');
    expect(runSearchBlock).toContain('setSearchBusy(true);');
    expect(runSearchBlock).toContain('setSearchBusy(false);');
    expect(openTopicBlock).toContain('setTopicBusy(true);');
    expect(openTopicBlock).toContain('setTopicBusy(false);');
    expect(loadMoreRepliesBlock).not.toContain('setBusy(');
    expect(statusBlock).toContain('setStatusBusy(true);');
    expect(statusBlock).toContain('setStatusBusy(false);');
    expect(appSource).toContain('busy={feedBusy || actionBusy}');
    expect(appSource).toContain('busy={searchBusy}');
    expect(appSource).toContain('topicBusy={topicBusy}');
  });

  it('clears search loading when search parameters cancel the active request', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*searchRequestIdRef\.current \+= 1;[\s\S]*?\n  \}, \[searchQuery, searchScope, searchSource\]\);/)?.[0] || '';

    expect(block).toContain('searchRequestIdRef.current += 1;');
    expect(block).toContain('searchAbortRef.current?.abort();');
    expect(block).toContain('setSearchBusy(false);');
  });

  it('marks feed loading before reading cookies to avoid duplicate feed requests', () => {
    const block = appSource.match(/const loadFeed = useCallback\(async \(\{([\s\S]*?)\n  \}, \[categoryFilter/)?.[1] || '';
    const guardIndex = block.indexOf('if (feedLoadingRef.current && !reset)');
    const markIndex = block.indexOf('feedLoadingRef.current = true;');
    const cookieIndex = block.indexOf('await loadYaohuoCookieForSource(source)');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(markIndex).toBeGreaterThan(-1);
    expect(cookieIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(markIndex);
    expect(markIndex).toBeLessThan(cookieIndex);
  });

  it('bypasses feed caches when switching source tabs or categories', () => {
    expect(appSource).toContain('source: feedSource, category: categoryFilter, nocache: true, clearItems: true');
  });

  it('keeps independent feed paging state for each source tab', () => {
    expect(appSource).toContain('type FeedSourceState = {');
    expect(appSource).toContain('const [feedStates, setFeedStates]');
    expect(appSource).toContain('[requestSource]: {');
    expect(appSource).toContain('items: reset ? data.items : mergeTopics(previous.items, data.items)');
  });

  it('clears stale per-source feed loading flags after a superseded request ends', () => {
    const loadFeedBlock = appSource.match(/const loadFeed = useCallback\(async \(\{([\s\S]*?)\n  \}, \[categoryFilter/)?.[1] || '';

    expect(appSource).toContain('const feedSourceRequestIdRef = useRef<Partial<Record<FeedSource, number>>>({});');
    expect(loadFeedBlock).toContain('feedSourceRequestIdRef.current[requestSource] = requestId;');
    expect(loadFeedBlock).toContain('const isLatestForFeedSource = feedSourceRequestIdRef.current[requestSource] === requestId;');
    expect(loadFeedBlock).toContain('if (isLatestForFeedSource) {');
    expect(loadFeedBlock).toContain('loadingMore: false');
    expect(loadFeedBlock).toContain('refreshing: false');
  });

  it('cancels stale search requests when the query, source, or scope changes', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*searchRequestIdRef\.current \+= 1;[\s\S]*?\n  \}, \[searchQuery, searchScope, searchSource\]\);/)?.[0] || '';

    expect(block).toContain('searchRequestIdRef.current += 1;');
    expect(block).toContain('searchAbortRef.current?.abort();');
    expect(block).toContain('setSearchItems([]);');
    expect(block).not.toContain('setBusy(false);');
  });

  it('reruns Android search with the current query when switching search tabs', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(!searchQueryRef\.current\.trim\(\)\) \{\s*\n\s*return;\s*\n\s*}\s*\n\s*void runSearchRef\.current\?\.\(\);\s*\n\s*}, \[searchSource, searchScope, searchSort\]\);/)?.[0] || '';

    expect(appSource).toContain('runSearchRef.current = runSearch;');
    expect(block).toContain('void runSearchRef.current?.();');
  });

  it('keeps recent search callbacks independent from recent search state changes', () => {
    const addBlock = appSource.match(/const addRecentSearch = useCallback\(\(query: string\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';
    const removeBlock = appSource.match(/const removeRecentSearch = useCallback\(\(query: string\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(addBlock).toContain('setRecentSearches((current) =>');
    expect(removeBlock).toContain('setRecentSearches((current) =>');
    expect(addBlock).not.toContain('AsyncStorage.setItem');
    expect(removeBlock).not.toContain('AsyncStorage.setItem');
    expect(appSource).toContain('recentSearchesLoaded');
    expect(appSource).toContain('AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(recentSearches))');
    expect(appSource).not.toContain('}, [recentSearches, writeRecentSearches]);');
  });

  it('loads the feed after reader data is ready and only when feed parameters change', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(!readerDataLoaded\) \{\s*\n\s*return;\s*\n\s*}\s*\n\s*void loadFeedRef\.current\(\{[\s\S]*?\n\s*}, \[categoryFilter, feedSource, readerDataLoaded\]\);/)?.[0] || '';

    expect(appSource).toContain('const [readerDataLoaded, setReaderDataLoaded] = useState(false);');
    expect(appSource).toContain('loadFeedRef.current = loadFeed;');
    expect(block).toContain('source: feedSource, category: categoryFilter, nocache: true, clearItems: true');
    expect(block).not.toContain('loadFeed]');
  });

  it('saves pending topic progress when the app leaves the foreground', () => {
    expect(appSource).toContain('AppState.addEventListener');
    expect(appSource).toContain("if (next !== 'active') {");
    expect(appSource).toContain('flushPendingProgress();');
    expect(appSource).toContain('PROGRESS_SAVE_MAX_PENDING_MS');
  });

  it('saves pending topic progress before leaving the topic screen', () => {
    const block = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(block).toContain("if (screen === 'topic' && nextScreen !== 'topic') {");
    expect(block).toContain('flushPendingProgress();');
  });

  it('guards delayed topic scroll restoration against stale topics', () => {
    const openTopicBlock = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(appSource).toContain('topicScrollRestoreTimerRef');
    expect(openTopicBlock).toContain('clearTopicScrollRestoreTimer();');
    expect(openTopicBlock).toContain('const restoreTopicKey = topicKey(displayDetail);');
    expect(openTopicBlock).toContain('currentTopicKeyRef.current !== restoreTopicKey');
    expect(openTopicBlock).toContain("notify(`已恢复到上次阅读位置 ${progress.percent}%`);");
  });

  it('offers linux.do external search shortcuts on the Android search screen', () => {
    expect(searchScreenSource).toContain('linuxDoExternalSearchItems(query)');
    expect(searchScreenSource).toContain('linux.do 老帖');
    expect(searchScreenSource).toContain('linuxDoExternalItems.map');
    expect(searchScreenSource).toContain('onOpenExternalUrl(item.url)');
  });

  it('keeps four-site topic links inside the Android topic detail flow', () => {
    const htmlLinkBlock = appSource.match(/const htmlRenderersProps = useMemo<HtmlRenderersProps>\(\(\) => \(\{[\s\S]*?\n  \}\), \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('parseForumTopicLink');
    expect(htmlLinkBlock).toContain('const appTopic = parseForumTopicLink(href, selectedTopic?.url || topicDetail?.url);');
    expect(htmlLinkBlock).toContain('openTopic(appTopic);');
    expect(htmlLinkBlock).toContain('openExternalUrl(href);');
  });

  it('offers category filters for Android search results like the mobile web page', () => {
    expect(searchScreenSource).toContain('searchCategoryOptions');
    expect(searchScreenSource).toContain('searchResultCategoryKey(item)');
    expect(searchScreenSource).toContain('setSearchCategoryFilter');
    expect(searchScreenSource).toContain('filteredSearchResults');
    expect(searchScreenSource).toContain('data={showRemoteGroups ? [] : filteredSearchResults}');
  });

  it('resets Android search category filters when the search context changes', () => {
    const block = searchScreenSource.match(/useEffect\(\(\) => \{\s*\n\s*setSearchCategoryFilter\('all'\);[\s\S]*?\n\s*}, \[query, scope, searchSource, sort\]\);/)?.[0] || '';

    expect(block).toContain("setSearchCategoryFilter('all');");
    expect(searchScreenSource).not.toContain('setSwipeOpenKey');
    expect(searchScreenSource).not.toContain('setRowSwipeActive');
  });

  it('only shows Android search sort filters for sources with real request parameters', () => {
    expect(searchScreenSource).toContain("const showSearchSort = scope === 'remote' && searchSource === 'v2ex';");
    expect(searchScreenSource).toContain('{showSearchSort ? (');
    expect(searchScreenSource).toContain("label: '相关'");
    expect(searchScreenSource).toContain("label: '按时间'");
    expect(searchScreenSource).not.toContain("label: '按回复'");
    expect(searchScreenSource).not.toContain("label: '按浏览'");
    expect(appSource).toContain("const activeSort = searchSource === 'all'");
    expect(appSource).toContain("? 'time'");
    expect(appSource).toContain('searchSort === \'time\'');
  });

  it('uses recent searches and source groups instead of saved-search management', () => {
    expect(searchScreenSource).toContain('最近搜索');
    expect(searchScreenSource).toContain('searchGroups');
    expect(appSource).toContain('retrySearchSource');
    expect(searchScreenSource).toContain('highlightQuery={query}');
    expect(searchScreenSource).not.toContain('onSaveSearch');
    expect(searchScreenSource).not.toContain('onRemoveSavedSearch');
    expect(searchScreenSource).not.toContain('保存搜索');
    expect(searchScreenSource).not.toContain('删除保存搜索');
  });

  it('keeps recent search removal attached to the search chip instead of a separate button', () => {
    const recentSearchBlock = searchScreenSource.match(/\{recentSearches\.length \? \([\s\S]*?\n      \) : null\}/)?.[0] || '';

    expect(recentSearchBlock).toContain('styles.removableChipShell');
    expect(recentSearchBlock).toContain('styles.removableChipClose');
    expect(recentSearchBlock).toContain('accessibilityLabel={`删除最近搜索 ${item}`}');
    expect(recentSearchBlock).not.toContain('IconButton tiny ghost icon={X} label="删除最近搜索"');
  });

  it('updates local search result highlighting when the query changes', () => {
    const block = searchScreenSource.match(/const renderTopicItem = useCallback<ListRenderItem<Topic>>\(\([\s\S]*?\n  \), \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(block).toContain('query');
  });

  it('does not pass press or submit events as search source overrides', () => {
    expect(appSource).toContain('onSearch={() => runSearch()}');
    expect(appSource).not.toContain('onSearch={runSearch}');
  });

  it('shows remote search source groups before recent search chips', () => {
    const groupIndex = searchScreenSource.indexOf('{showRemoteGroups ? (');
    const recentListIndex = searchScreenSource.indexOf('<Text style={styles.meta}>最近搜索</Text>');

    expect(groupIndex).toBeGreaterThan(-1);
    expect(recentListIndex).toBeGreaterThan(-1);
    expect(groupIndex).toBeLessThan(recentListIndex);
  });

  it('does not add a second empty result message below remote search groups', () => {
    const listEmptyBlock = searchScreenSource.match(/ListEmptyComponent=\{[\s\S]*?\}\s*renderItem=\{renderTopicItem\}/)?.[0] || '';

    expect(listEmptyBlock).toContain('showRemoteGroups ? null : busy && query.trim()');
  });

  it('adds a load-more action to remote search source groups', () => {
    expect(searchScreenSource).toContain('hasMore?: boolean;');
    expect(searchScreenSource).toContain('nextPage?: number | null;');
    expect(searchScreenSource).toContain('loadingMore?: boolean;');
    expect(searchScreenSource).toContain('onLoadMoreSearchSource: (source: Source, page: number) => void;');
    expect(searchScreenSource).toContain("label={group.loadingMore ? '加载中...' : `加载更多 ${group.label}`}");
    expect(appSource).toContain('const loadMoreSearchSource = useCallback');
    expect(appSource).toContain('onLoadMoreSearchSource={loadMoreSearchSource}');
  });

  it('keeps Android favorites as a simple list with confirmed unfavorite actions', () => {
    expect(appSource).not.toContain('libraryUndo');
    expect(libraryScreenSource).toContain('Alert.alert');
    expect(libraryScreenSource).toContain('确定取消收藏吗？');
    expect(libraryScreenSource).toContain('label="取消收藏"');
    expect(libraryScreenSource).toContain('active');
    expect(libraryScreenSource).not.toContain('撤销删除');
    expect(libraryScreenSource).not.toContain('批量删除');
    expect(libraryScreenSource).not.toContain('退出批量');
    expect(libraryScreenSource).not.toContain('删除选中');
    expect(libraryScreenSource).not.toContain('标签筛选');
    expect(libraryScreenSource).not.toContain('添加标签和备注');
    expect(libraryScreenSource).not.toContain('编辑标签和备注');
    expect(libraryScreenSource).not.toContain('备注：');
    expect(libraryScreenSource).not.toContain('标签：');
    expect(libraryScreenSource).not.toContain('来源全部');
    expect(libraryScreenSource).not.toContain('节点全部');
  });

  it('keeps Android topic reading tools content-first without reader or focus toggles', () => {
    expect(appSource).toContain('shareTopic');
    expect(appSource).toContain('Share.share');
    expect(appSource).not.toContain('readerMode');
    expect(appSource).not.toContain('focusMode');
    expect(topicScreenSource).toContain('topicTopActions');
    expect(topicScreenSource).toContain('topicPostActionArea');
    expect(topicScreenSource).not.toContain('Reader Mode');
    expect(topicScreenSource).not.toContain('专注模式');
    expect(topicScreenSource).toContain('floorOpen');
    expect(topicScreenSource).toContain('commentQuery');
    expect(appSource).not.toContain('copyReplyMarkdown');
    expect(appSource).not.toContain('buildReplyMarkdown');
    expect(appSource).toContain('加鸡腿请求已提交');
    expect(appSource).not.toContain('感谢请求已提交');
    expect(topicScreenSource).toContain('新增');
  });

  it('keeps the floor index aligned with the currently visible replies', () => {
    const floorIndexBlock = topicScreenSource.match(/\{floorOpen \? \([\s\S]*?\n\s*\) : null\}/)?.[0] || '';

    expect(floorIndexBlock).toContain('{replies.map((reply, index) => {');
    expect(floorIndexBlock).not.toContain('{sourceReplies.map((reply, index) => {');
  });

  it('adds image save, thumbnail selection, and backup file actions', () => {
    expect(appSource).toContain('savePreviewImage');
    expect(imagePreviewModalSource).toContain('imagePreviewThumbnail');
    expect(appSource).toContain('exportBackupFile');
    expect(appSource).toContain('importBackupFile');
  });

  it('removes temporary cache files after saving preview images to the gallery', () => {
    const block = appSource.match(/const savePreviewImage = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[imagePreview, notify\]\);/)?.[0] || '';

    expect(block).toContain('shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;');
    expect(block).toContain('let downloadedUri =');
    expect(block).toContain('finally {');
    expect(block).toContain('await FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => undefined);');
  });

  it('keeps feed pagination available when an empty source page still has a next page', () => {
    expect(appSource).toContain('hasMore: Boolean(data.hasMore && (data.nextPage || data.nextCursor))');
    expect(appSource).not.toContain('hasMore: Boolean(data.items.length && data.hasMore && (data.nextPage || data.nextCursor))');
  });

  it('removes temporary cache files after exporting backup or markdown text', () => {
    const block = appSource.match(/const shareTextFile = useCallback\(async[\s\S]*?\n  }, \[notify\]\);/)?.[0] || '';

    expect(block).toContain('const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;');
    expect(block).toContain('finally {');
    expect(block).toContain('await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);');
  });

  it('removes the picked backup cache copy after importing it', () => {
    const block = appSource.match(/const importBackupFile = useCallback\(async \(\) => \{[\s\S]*?\n  }, \[notify, replaceReaderData\]\);/)?.[0] || '';

    expect(block).toContain('const pickedUri = result.assets[0].uri;');
    expect(block).toContain('pickedUri.startsWith(FileSystem.cacheDirectory)');
    expect(block).toContain('await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);');
  });

  it('restores feed scroll position after both storage and list content are ready', () => {
    const block = feedScreenSource;

    expect(block).toContain('const [scrollRestoreReady, setScrollRestoreReady] = useState(false);');
    expect(block).toContain('setScrollRestoreReady(false);');
    expect(block).toContain('setScrollRestoreReady(true);');
    expect(block).toContain('if (scrollRestoreReady && offset && feedItems.length) {');
    expect(block).toContain('restoreFeedScrollPosition();');
  });

  it('bypasses feed caches when loading additional feed pages', () => {
    const block = appSource.match(/onLoadMore=\{\(\) => \{([\s\S]*?)\n      \}\}/)?.[1] || '';

    expect(block).toContain('loadFeed({ page: activeFeedState.page + 1, cursor: feedSource === \'all\' ? activeFeedState.nextCursor : undefined, nocache: true });');
  });

  it('allows reset feed requests to replace stale loads when switching source tabs or categories', () => {
    expect(appSource).toContain('if (feedLoadingRef.current && !reset) {');
    expect(appSource).not.toContain('feedLoadingRef.current && (!reset || nocache)');
  });

  it('marks reply page loading before reading cookies to avoid duplicate load-more requests', () => {
    const block = appSource.match(/const loadMoreReplies = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const guardIndex = block.indexOf('loadingMoreRepliesRef.current = true;');
    const cookieIndex = block.indexOf('await loadYaohuoCookieForSource(detail.source)');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(cookieIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(cookieIndex);
  });

  it('clears stale WebView cookies when stored login state is invalidated', () => {
    const nodeSeekBlock = appSource.match(/const clearNodeSeekLoginState = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearStoredNodeSeekLoginState\]\);/)?.[1] || '';
    const yaohuoBlock = appSource.match(/const clearYaohuoLoginState = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearStoredYaohuoLoginState\]\);/)?.[1] || '';

    expect(nodeSeekBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
    expect(yaohuoBlock).toContain('await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);');
  });

  it('does not clear yaohuo cookies for aggregated source errors', () => {
    const directStoredClears = appSource.match(/await clearStoredYaohuoLoginState\(\);/g) || [];

    expect(directStoredClears).toHaveLength(1);
  });

  it('clears yaohuo cookies only for expired login errors, not access verification', () => {
    expect(appSource).toContain('isYaohuoLoginExpiredError(error)');
    expect(appSource).toContain('showYaohuoLogin(errorMessage(error))');
  });

  it('rehydrates saved yaohuo cookies into WebView before opening the login page', () => {
    expect(appSource).toContain('restoreSavedYaohuoCookiesToWebView');
    expect(appSource).toContain('buildYaohuoSetCookieHeaders(cookieHeader)');
    expect(appSource).toContain('await CookieManager.setFromResponse(url, header)');
    expect(appSource).toContain('setYaohuoLoginCookieHeader(cookieHeader)');
    expect(appSource).toContain('onShowYaohuoLoginPanelChange={changeYaohuoLoginPanel}');
    expect(moreScreenSource).toContain('headers: yaohuoLoginCookieHeader ? { Cookie: yaohuoLoginCookieHeader } : undefined');
  });

  it('opens the yaohuo signed-in page instead of the login form when cookies are saved', () => {
    expect(moreScreenSource).toContain("const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';");
    expect(moreScreenSource).toContain('uri: hasYaohuoCookie ? YAOHUO_SESSION_URL : YAOHUO_LOGIN_URL');
  });

  it('shows yaohuo login detail instead of hiding detected cookies behind a generic state', () => {
    const yaohuoLoginStateBlock = appSource.match(/const yaohuoLoginState = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(yaohuoLoginStateBlock).toContain("return '未登录';");
    expect(yaohuoLoginStateBlock).toContain("return yaohuoCookieNames.length ? `已登录：${yaohuoCookieNames.join(', ')}` : '已登录';");
    expect(yaohuoLoginStateBlock).toContain("return `未登录，已检测 ${yaohuoCookieNames.length} 个 Cookie：${yaohuoCookieNames.join(', ')}`;");
    expect(moreScreenSource).toContain('value={yaohuoLoginState}');
    expect(moreScreenSource).toContain('subtitle={yaohuoLoginState}');
    expect(moreScreenSource).not.toContain("hasYaohuoCookie ? yaohuoLoginState : '未登录'");
  });

  it('reads and clears yaohuo cookies across http, https, root, and www hosts', () => {
    const match = appSource.match(/const YAOHUO_COOKIE_URLS = \[([\s\S]*?)\];/);
    const cookieUrls = match?.[1] || '';

    expect(cookieUrls).toContain('YAOHUO_URL');
    expect(cookieUrls).toContain("'https://www.yaohuo.me'");
    expect(cookieUrls).toContain("'http://yaohuo.me'");
    expect(cookieUrls).toContain("'http://www.yaohuo.me'");
  });

  it('uses concise update wording for refresh and backup feedback', () => {
    expect(appSource).toContain("notify('正在更新列表')");
    expect(appSource).toContain("successMessage: '列表已更新'");
    expect(appSource).toContain("notify('主题已更新')");
    expect(appSource).toContain("notify('备份已恢复，本机资料已合并')");
    expect(appSource).toContain("notify('备份 JSON 已生成')");
    expect(appSource).toContain("notify('状态已更新')");
    expect(appSource).not.toContain('正在刷新，请稍候');
    expect(appSource).not.toContain('正在刷新主题');
    expect(appSource).not.toContain('主题已读取');
    expect(appSource).not.toContain('同步读取成功');
    expect(appSource).not.toContain('同步保存成功');
    expect(appSource).not.toContain('状态检查完成');
  });

  it('labels the saved-topics area as favorites in the bottom navigation and screen title', () => {
    expect(navBarSource).toContain("{ value: 'library', label: '收藏', icon: Star }");
    expect(libraryScreenSource).toContain('<Text style={styles.sectionTitle}>收藏</Text>');
    expect(navBarSource).not.toContain("{ value: 'library', label: '书架', icon: BookMarked }");
    expect(androidUiSource).not.toContain('<Text style={styles.sectionTitle}>书架</Text>');
  });

  it('shows a filled favorite icon without an active button shell on Android topic details', () => {
    expect(appControlsSource).toContain("fill={active ? theme.primary : 'none'}");
    expect(appControlsSource).toContain('active && !iconOnly && styles.buttonActive');
  });

  it('uses content-like placeholders for shared loading states instead of only a spinner', () => {
    expect(appControlsSource).toContain('loadingPlaceholderStack');
    expect(appControlsSource).toContain('loadingPlaceholderLine');
    expect(appControlsSource).toContain('loadingPlaceholderLineShort');
    expect(appControlsSource).toContain('loadingPlaceholderLineMuted');
    expect(appControlsSource).toContain('Array.from({ length: 3 })');
  });

  it('marks topics with extra access requirements in Android lists and details', () => {
    expect(topicCardSource).toContain('topic.accessRequirement?.label');
    expect(androidUiSource).toContain('styles.topicAccessBadge');
    expect(topicScreenSource).toContain('item.accessRequirement?.label');
  });

  it('shows a bottom message when the feed cannot load more', () => {
    expect(feedScreenSource).toContain('已经到底了');
    expect(feedScreenSource).toContain('styles.endOfListText');
  });

  it('sends linux.do Cloudflare detail errors to the verification panel', () => {
    expect(appSource).toContain('pendingLinuxDoTopicRef');
    expect(appSource).toContain('showLinuxDoVerification');
    expect(appSource).toContain('isLinuxDoCloudflareError(error)');
    expect(topicScreenSource).toContain('label="去验证"');
    expect(appSource).toContain('await openTopic(pendingTopic, true);');
  });

  it('sends NodeSeek Cloudflare feed errors to the NodeSeek verification panel', () => {
    expect(appSource).toContain('showNodeSeekVerification');
    expect(appSource).toContain('isNodeSeekCloudflareError(error)');
    expect(appSource).toContain('loadNodeSeekCookieForSource');
    expect(appSource).toContain('nodeSeekCookie');
    expect(moreScreenSource).toContain('label="NodeSeek 登录 / 验证"');
    expect(moreScreenSource).toContain('userAgent={nodeSeekWebViewUserAgent}');
  });

  it('saves NodeSeek WebView verification cookies before returning to lists', () => {
    expect(appSource).toContain('readNodeSeekCookiesFromWebView');
    expect(appSource).toContain('rememberCurrentNodeSeekCookies');
    expect(appSource).toContain('onRememberNodeSeekCookies={rememberCurrentNodeSeekCookies}');
    expect(appSource).toContain('nodeSeekWebViewCookieHeaderRef');
    expect(appSource).toContain('nodeSeekWebViewUserAgentRef');
    expect(appSource).toContain('sanitizeNodeSeekUserAgent(data.userAgent)');
    expect(appSource).toContain('parseNodeSeekDocumentCookie(nodeSeekDocumentCookieHeader)');
    expect(moreScreenSource).toContain('void onRememberNodeSeekCookies({ silent: true });');
    expect(moreScreenSource).toContain('type: "nodeseek-login"');
    expect(moreScreenSource).not.toContain('nodeseek-login-probe');
  });

  it('preserves saved NodeSeek login cookies when WebView only reports verification cookies', () => {
    const block = appSource.match(/const loadNodeSeekCookieForSource = useCallback\(async \(source: FeedSource \| Source\) => \{([\s\S]*?)\n  \}, \[saveNodeSeekCookieHeader\]\);/)?.[1] || '';

    expect(block).toContain('const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);');
    expect(block).toContain('mergeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie || \'\'), cookies)');
    expect(block.indexOf('const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);')).toBeLessThan(block.indexOf('await saveNodeSeekCookieHeader'));
  });

  it('uses saved NodeSeek verification data for categories and status checks', () => {
    const categoriesBlock = appSource.match(/const loadCategories = useCallback\(async \(source: FeedSource = 'all'\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const statusBlock = appSource.match(/const checkLocalStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(categoriesBlock).toContain('loadNodeSeekCookieForSource');
    expect(categoriesBlock).toContain('nodeSeekCookie');
    expect(categoriesBlock).toContain('nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current');
    expect(statusBlock).toContain('loadNodeSeekCookieForSource');
    expect(statusBlock).toContain('nodeSeekCookie');
    expect(statusBlock).toContain('nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current');
  });

  it('reloads a single source category list only when that source is missing categories', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(shouldLoadCategoriesForSource\(categories, feedSource\)\) \{[\s\S]*?\n\s*}, \[categories, feedSource, loadCategories\]\);/)?.[0] || '';

    expect(appSource).toContain('shouldLoadCategoriesForSource');
    expect(block).toContain('void loadCategories(feedSource);');
  });

  it('checks whether saved yaohuo cookies are still usable in local status', () => {
    const statusBlock = appSource.match(/const checkLocalStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(statusBlock).toContain('checkYaohuoLoginDirect({');
    expect(statusBlock).toContain('yaohuoCookie');
    expect(statusBlock).not.toContain('yaohuo: Boolean(yaohuoCookie)');
  });

  it('does not treat Cloudflare-only NodeSeek verification as logged-in actions', () => {
    expect(appSource).toContain('hasNodeSeekLoginCookie');
    expect(appSource).toContain('canUseNodeSeekActions={hasNodeSeekLoginCookie}');
    expect(moreScreenSource).toContain('hasNodeSeekLoginCookie ? <MenuButton icon={CheckCircle} label="NodeSeek 签到"');
    expect(appSource).toContain('removeNodeSeekLoginCookies');
  });

  it('requires a real NodeSeek login cookie before enabling login-only actions', () => {
    const saveCookieBlock = appSource.match(/const saveNodeSeekCookieHeader = useCallback\(async \([\s\S]*?\n  \}, \[\]\);/)?.[0] || '';
    const rememberBlock = appSource.match(/const rememberCurrentNodeSeekCookies = useCallback\(async[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const loginMessageBlock = appSource.match(/const handleLoginMessage = useCallback\(.*?=> \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(saveCookieBlock).toContain('setHasNodeSeekLoginCookie(summary.loggedIn);');
    expect(saveCookieBlock).not.toContain('setHasNodeSeekLoginCookie(summary.loggedIn || verifiedByPage);');
    expect(rememberBlock).toContain("notify(summary.loggedIn ? '已检测到 NodeSeek 登录 Cookie，已保存在本机。' : '已检测到 NodeSeek 验证信息，已保存在本机。');");
    expect(rememberBlock).not.toContain('summary.loggedIn || webLoginDetectedRef.current');
    expect(loginMessageBlock).not.toContain('setHasNodeSeekLoginCookie(true);');
  });

  it('keeps detail reading settings reachable from the topic menu', () => {
    expect(topicScreenSource).toContain('accessibilityLabel="阅读设置"');
    expect(topicScreenSource).toContain('onOpenReadingSettings');
    expect(appSource).toContain('openReadingSettingsFromTopic');
    expect(appSource).toContain('onOpenReadingSettings={openReadingSettingsFromTopic}');
  });

  it('names the followed-user library tab explicitly', () => {
    expect(libraryScreenSource).toContain("{ value: 'users', label: '关注用户' }");
    expect(libraryScreenSource).not.toContain("{ value: 'users', label: '用户' }");
  });

  it('prevents expired NodeSeek WebView login cookies from being restored', () => {
    const clearLoginOnlyBlock = appSource.match(/const clearNodeSeekLoginCookiesOnly = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearNodeSeekLoginState\]\);/)?.[1] || '';

    expect(clearLoginOnlyBlock).toContain('nodeSeekWebViewCookieHeaderRef.current = verificationHeader;');
    expect(clearLoginOnlyBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
  });

  it('uses a hidden WebView to read NodeSeek pages when normal fetch is blocked by Cloudflare', () => {
    expect(appSource).toContain('NODESEEK_BROWSER_FETCH_SCRIPT');
    expect(appSource).toContain('nodeSeekFetchWithWebView');
    expect(appSource).toContain("type: 'nodeseek-browser-fetch'");
    expect(appSource).toContain('fetcher: nodeSeekFetchWithWebView');
    expect(appSource).toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
  });

  it('does not leave hidden NodeSeek browser fetch requests pending after WebView failures', () => {
    expect(appSource).toContain('const failNodeSeekBrowserFetchById = useCallback((requestId: number, message: string) => {');
    expect(appSource).toContain('onHttpError={(event) => {');
    expect(appSource).toContain('if (event.nativeEvent.url !== nodeSeekBrowserFetchRequest.url) {');
    expect(appSource).toContain('NodeSeek 页面返回错误');
    expect(appSource).toContain('onRenderProcessGone={() => {');
    expect(appSource).toContain('NodeSeek 页面读取进程已停止');
    expect(appSource).toContain('renderError={() => <View style={styles.hiddenBrowserWebView} />}');
  });

  it('waits for rendered NodeSeek list or detail content before returning hidden WebView HTML', () => {
    expect(appSource).toContain('const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content, pre"))');
    expect(appSource).toContain('document.body?.innerText');
    expect(appSource).toContain('if ((!isChallengePage() && hasReadableContent()) || Date.now() >= deadline) {');
  });

  it('keeps the hidden NodeSeek browser fetch WebView out of the visible layout', () => {
    expect(appSource).toContain('<View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>');
    expect(appSource).toContain('containerStyle={styles.hiddenBrowserWebView}');
    expect(appSource).toContain('style={styles.hiddenBrowserWebView}');
    expect(appSource).toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
    expect(appSource).not.toContain('androidLayerType="software"');
  });

  it('does not mistake regular NodeSeek posts mentioning Cloudflare for verification pages', () => {
    expect(appSource).toContain('const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;');
    expect(appSource).not.toContain('just a moment|cloudflare|cf-turnstile|challenge-platform');
  });

  it('stops the linux.do verification spinner when the WebView cannot load', () => {
    expect(moreScreenSource).toContain('linuxDoWebViewError');
    expect(moreScreenSource).toContain('onSetLinuxDoWebViewError');
    expect(moreScreenSource).toContain('onError={(event) =>');
    expect(moreScreenSource).toContain('onSetLoadingLinuxDoPage(false);');
    expect(moreScreenSource).toContain('linux.do 页面加载失败');
  });

  it('resets topic loading state when leaving the topic screen', () => {
    const block = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(block).toContain('setTopicBusy(false);');
    expect(block).toContain('setLoadingMoreReplies(false);');
  });

  it('opens user pages through the shared navigation cleanup path', () => {
    const block = appSource.match(/const openUser = useCallback\(async \(user: UserProfile, nocache = false\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(block).toContain("changeScreen('user');");
    expect(block).not.toContain("setScreen('user');");
  });

  it('opens topic pages through the shared navigation cleanup path', () => {
    const block = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(block).toContain("changeScreen('topic');");
    expect(block).not.toContain("setScreen('topic');");
  });

  it('does not show reply controls when topic detail failed to load', () => {
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(topicScreenSource).toContain('const canShowReplies = Boolean(topic && !topicLoading);');
    expect(topicListItemsBlock).toContain('if (canShowReplies) {');
    expect(topicListItemsBlock).not.toContain('if (!topicLoading) {');
    expect(topicScreenSource).toContain('const canWriteNodeSeek = Boolean(topic && topic.source === \'nodeseek\' && canUseNodeSeekActions);');
  });

  it('keeps successful topic actions local instead of reopening the whole topic', () => {
    expect(appSource).toContain('applyInteractionToTopic');
    expect(appSource).toContain('applyInteractionToReplies');
    expect(appSource).toContain('applyBookmarkToTopic');
    expect(appSource).toContain('applyVoteOptionToTopic');
    expect(appSource).toMatch(/buildLinuxDoLikeRequest[\s\S]*?\{ refreshTopic: false \}/);
    expect(appSource).toMatch(/buildNodeSeekInteractionRequest[\s\S]*?\{ refreshTopic: false \}/);
    expect(appSource).toMatch(/buildLinuxDoBookmarkRequest[\s\S]*?\{ refreshTopic: false \}/);
    expect(appSource).toMatch(/buildYaohuoVoteRequest[\s\S]*?\{ refreshTopic: false \}/);
  });

  it('refreshes topic replies without resetting the topic body or reading state', () => {
    const refreshRepliesBlock = appSource.match(/const refreshTopicReplies = useCallback\(async \(\{ silent = false \}: \{ silent\?: boolean \} = \{\}\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const refreshTopicBlock = appSource.match(/const refreshTopic = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const refreshWholeTopicBlock = appSource.match(/const refreshWholeTopic = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const submitReplyBlock = appSource.match(/const submitReply = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(refreshRepliesBlock).toContain('getYaohuoRepliesDirect');
    expect(refreshRepliesBlock).toContain('getReplies');
    expect(refreshRepliesBlock).toContain('setTopicReplies((current) => mergeReplies(data.items, current));');
    expect(refreshRepliesBlock).not.toContain('setTopicDetail(null)');
    expect(refreshRepliesBlock).not.toContain("setCommentQuery('')");
    expect(refreshRepliesBlock).not.toContain("setReplyFilter('all')");
    expect(refreshRepliesBlock).not.toContain('resetQuoteState()');
    expect(appSource).toMatch(/useEffect\(\(\) => \{\s*\n\s*setTopicDetail\(\(current\) => \{[\s\S]*?replies: topicReplies[\s\S]*?\n\s*}, \[topicReplies\]\);/);
    expect(refreshTopicBlock).toContain('void refreshTopicReplies();');
    expect(refreshTopicBlock).not.toContain('openTopic(');
    expect(refreshWholeTopicBlock).toContain('void openTopic(detail, true);');
    expect(submitReplyBlock).toMatch(/buildYaohuoReplyRequest[\s\S]*?\{ refreshTopic: false \}/);
    expect(submitReplyBlock).toMatch(/buildLinuxDoReplyRequest[\s\S]*?\{ refreshTopic: false \}/);
    expect(submitReplyBlock).toMatch(/buildNodeSeekReplyRequest[\s\S]*?\{ refreshTopic: false \}/);
    expect(submitReplyBlock).toContain('await refreshTopicReplies({ silent: true });');
    expect(topicScreenSource).toContain('onRefreshWholeTopic');
    expect(topicScreenSource).toContain('刷新评论');
    expect(topicScreenSource).toContain('刷新全文');
  });

  it('closes More screen panels when navigating away from More', () => {
    const closePanelsBlock = appSource.match(/const closeMorePanels = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[closeLinuxDoPanel\]\);/)?.[1] || '';
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(closePanelsBlock).toContain('setShowLoginPanel(false);');
    expect(closePanelsBlock).toContain('setShowYaohuoLoginPanel(false);');
    expect(closePanelsBlock).toContain('closeLinuxDoPanel();');
    expect(closePanelsBlock).toContain('setShowSettingsPanel(false);');
    expect(changeScreenBlock).toContain("if (screen === 'more' && nextScreen !== 'more') {");
    expect(changeScreenBlock).toContain('closeMorePanels();');
  });

  it('keeps unused collection, history, category, and subscription entries out of More', () => {
    const moreScreenSignature = moreScreenSource.match(/function MoreScreen\(\{[\s\S]*?\}: \{[\s\S]*?\}\) \{/)?.[0] || '';

    expect(moreScreenSource).not.toContain('label="收藏"');
    expect(moreScreenSource).not.toContain('label="历史"');
    expect(moreScreenSource).not.toContain('label="分类节点"');
    expect(moreScreenSource).not.toContain('订阅');
    expect(moreScreenSource).not.toContain('导出收藏 Markdown');
    expect(moreScreenSignature).not.toContain('favoriteCount');
    expect(moreScreenSignature).not.toContain('historyCount');
    expect(moreScreenSignature).not.toContain('showCategoriesPanel');
    expect(moreScreenSignature).not.toContain('subscriptions');
    expect(appSource).not.toContain('showCategoriesPanel');
    expect(appSource).not.toContain('exportFavoritesMarkdownFile');
    expect(appSource).not.toContain('toggleCategorySubscription');
  });

  it('keeps Android appearance settings to light or dark with fixed forest green and Douban white', () => {
    const settingsPanelStart = moreScreenSource.indexOf('function SettingsPanel(');
    const settingsPanelBlock = settingsPanelStart >= 0
      ? moreScreenSource.slice(settingsPanelStart)
      : '';

    expect(moreScreenSource).toContain('meta="字号 · 白天/黑夜 · 阅读调节"');
    expect(settingsPanelBlock).toContain("{ value: 'light', label: '浅色' }");
    expect(settingsPanelBlock).toContain("{ value: 'dark', label: '深色' }");
    expect(settingsPanelBlock).not.toContain("{ value: 'system', label: '系统' }");
    expect(settingsPanelBlock).not.toContain('title="配色"');
    expect(settingsPanelBlock).not.toContain('title="背景"');
    expect(settingsPanelBlock).not.toContain('豆青');
    expect(settingsPanelBlock).not.toContain('森绿');
    expect(appConfigSource).toContain('"userInterfaceStyle": "light"');
    expect(appConfigSource).toContain('"backgroundColor": "#ffffff"');
  });

  it('shows explicit expand and collapse state icons on foldable panels', () => {
    expect(appControlsSource).toContain('ChevronUp');
    expect(appControlsSource).toContain('const StateIcon = panelExpanded ? ChevronUp : ChevronDown;');
    expect(appControlsSource).toContain('accessibilityLabel={panelExpanded ? `收起${title}` : `展开${title}`}');
    expect(appControlsSource).toContain('styles.expandableStateIcon');
    expect(searchScreenSource).toContain('<ExpandablePanel');
    expect(moreScreenSource).toContain('<ExpandablePanel');
  });

  it('opens the account panel when a login or verification child panel is requested', () => {
    const moreScreenBlock = moreScreenSource.match(/function MoreScreen\(\{[\s\S]*?\n  return \(/)?.[0] || '';

    expect(moreScreenBlock).toContain('if (showLoginPanel || showYaohuoLoginPanel || showLinuxDoPanel) {');
    expect(moreScreenBlock).toContain('setAccountExpanded(true);');
  });

  it('uses the shared settings panel state for the appearance foldout', () => {
    expect(moreScreenSource).toContain('expanded={showSettingsPanel}');
    expect(moreScreenSource).toContain('showSettingsPanel={showSettingsPanel}');
    expect(moreScreenSource).not.toContain('appearanceExpanded || showSettingsPanel');
  });

  it('closes the reply composer before leaving the topic screen with the Android back button', () => {
    const block = appSource.match(/BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{([\s\S]*?)\n    \}\);/)?.[1] || '';

    expect(block).toContain('if (replyComposerOpen) {');
    expect(block).toContain('setReplyComposerOpen(false);');
    expect(block).toContain('setYaohuoReplyTarget(null);');
  });

  it('resets library filters when switching between favorites and history', () => {
    const block = libraryScreenSource.match(/useEffect\(\(\) => \{\s*\n\s*setSourceFilter\('all'\);\s*\n\s*setCategoryFilter\('all'\);[\s\S]*?\n\s*}, \[libraryTab\]\);/)?.[0] || '';

    expect(block).toContain("setSourceFilter('all');");
    expect(block).toContain("setCategoryFilter('all');");
    expect(block).not.toContain("setTagFilter('all');");
    expect(libraryScreenSource).not.toContain('setSwipeOpenKey');
  });

  it('clears stale library category filters after switching sources', () => {
    expect(libraryScreenSource).toContain("categoryFilter !== 'all' && !categoryItems.some((item) => item.value === categoryFilter)");
    expect(libraryScreenSource).toContain("setCategoryFilter('all');");
    expect(libraryScreenSource).toContain('}, [categoryFilter, categoryItems]);');
  });

  it('does not show Android library tag and note management controls', () => {
    expect(libraryScreenSource).not.toContain('tagFilter');
    expect(libraryScreenSource).not.toContain('tagInput');
    expect(libraryScreenSource).not.toContain('noteInput');
    expect(libraryScreenSource).not.toContain('TextInput');
    expect(libraryScreenSource).not.toContain('onUpdateRecord');
  });

  it('does not keep Android library bulk selection state', () => {
    expect(libraryScreenSource).not.toContain('bulkMode');
    expect(libraryScreenSource).not.toContain('selected');
    expect(libraryScreenSource).not.toContain('toggleBulkMode');
    expect(libraryScreenSource).not.toContain('removeSelected');
    expect(libraryScreenSource).not.toContain('librarySelectRow');
  });

  it('keeps the current topic key active only while the topic screen is visible', () => {
    expect(appSource).toContain("currentTopicKeyRef.current = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;");
  });

  it('does not retry a stale linux.do topic after another topic is opened', () => {
    const block = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(block).toContain('pendingLinuxDoTopicRef.current && topicKey(pendingLinuxDoTopicRef.current) !== topicKey(topic)');
    expect(block).toContain('pendingLinuxDoTopicRef.current = null;');
  });

  it('clears stale pending linux.do topics when closing the verification panel', () => {
    const block = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(block).toContain('pendingLinuxDoTopicRef.current = null;');
  });

  it('does not let the linux.do verification page stay loading forever', () => {
    expect(moreScreenSource).toContain('LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS');
    expect(moreScreenSource).toContain('linux.do 页面打开超时');
    expect(moreScreenSource).toContain('clearTimeout(timeout)');
  });

  it('opens external login and verification pages as full-screen WebView modals', () => {
    expect(moreScreenSource).toContain('LoginWebViewModal');
    expect(moreScreenSource).toContain('visible={showLoginPanel}');
    expect(moreScreenSource).toContain('visible={showYaohuoLoginPanel}');
    expect(moreScreenSource).toContain('visible={showLinuxDoPanel}');
    expect(moreScreenSource).toContain('styles.loginWebViewModal');
    expect(moreScreenSource).toContain('styles.loginWebViewBody');
  });

  it('keeps full-screen login modal controls below the Android status bar', () => {
    expect(moreScreenSource).toContain("import { useSafeAreaInsets } from 'react-native-safe-area-context';");
    expect(moreScreenSource).toContain('const insets = useSafeAreaInsets();');
    expect(moreScreenSource).toContain('paddingTop: insets.top');
    expect(moreScreenSource).toContain('paddingBottom: insets.bottom');
    expect(moreScreenSource).not.toContain('<SafeAreaView');
  });

  it('clears stale linux.do verification errors after the WebView responds again', () => {
    const linuxDoMessageBlock = appSource.match(/const handleLinuxDoMessage[\s\S]*?\n  }, \[[^\]]*\]\);/)?.[0] || '';

    expect(linuxDoMessageBlock).toContain("setLinuxDoWebViewError('');");
  });

  it('clears stale linux.do verification errors after a successful page load', () => {
    const block = moreScreenSource.match(/onLoadEnd=\{\(event\) => \{[\s\S]*?linuxDoWebViewRef\.current\?\.injectJavaScript\(LINUXDO_WEBVIEW_PROBE_SCRIPT\);[\s\S]*?\}\}/)?.[0] || '';

    expect(block).toContain('onSetLoadingLinuxDoPage(false);');
    expect(block).toContain("if (!('code' in event.nativeEvent)) {");
    expect(block).toContain("onSetLinuxDoWebViewError('');");
  });

  it('keeps linux.do verification WebView failures contained', () => {
    expect(moreScreenSource).toContain('linuxDoWebViewKey');
    expect(moreScreenSource).toContain('onResetLinuxDoWebView');
    expect(moreScreenSource).toContain('key={linuxDoWebViewKey}');
    expect(moreScreenSource).toContain('renderError={() => <View style={styles.webViewErrorPlaceholder} />}');
    expect(moreScreenSource).toContain('onRenderProcessGone={() =>');
    expect(moreScreenSource).toContain('linux.do 验证页面已停止');
  });

  it('stops the linux.do verification WebView before hiding it', () => {
    expect(appSource).toContain('closeLinuxDoPanel');
    expect(appSource).toContain('linuxDoWebViewRef.current?.stopLoading()');
    expect(appSource).toContain('onShowLinuxDoPanelChange={changeLinuxDoPanel}');
    expect(moreScreenSource).toContain('onShowLinuxDoPanelChange={onShowLinuxDoPanelChange}');
  });

  it('reuses the linux.do verification WebView user agent for local requests', () => {
    expect(moreScreenSource).toContain('navigator.userAgent');
    expect(appSource).toContain('linuxDoWebViewUserAgent');
    expect(appSource).toContain('linuxDoWebViewUserAgentRef');
    expect(appSource).toContain('sanitizeLinuxDoUserAgent(data.userAgent)');
    expect(moreScreenSource).toContain('userAgent={linuxDoWebViewUserAgent}');
    expect(appSource).toContain('saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || linuxDoWebViewUserAgent || undefined)');
    expect(localLinuxDoSource).toContain("DEFAULT_LINUXDO_ANDROID_USER_AGENT");
    expect(localLinuxDoSource).toContain("'User-Agent': access?.userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT");
  });

  it('can detect linux.do clearance from the visible WebView document cookies', () => {
    expect(moreScreenSource).toContain('cookie: document.cookie || ""');
    expect(appSource).toContain('linuxDoWebViewCookieHeader');
    expect(appSource).toContain('linuxDoWebViewCookieHeaderRef');
    expect(appSource).toContain('parseLinuxDoDocumentCookie(linuxDoDocumentCookieHeader)');
    expect(appSource).toContain('await probeLinuxDoPage();');
  });

  it('can detect HttpOnly linux.do clearance from the Android WebView cookie store', () => {
    expect(linuxDoBridgeSource).toContain('LinuxDoCookieModule');
    expect(linuxDoBridgeSource).toContain('readLinuxDoClearanceFromAndroidWebViewStore');
    expect(linuxDoBridgeSource).toContain('linuxDoClearanceCookieFromValue(value)');
  });

  it('checks linux.do latest URLs when reading WebView cookies from JS fallback', () => {
    expect(linuxDoBridgeSource).toContain("'https://linux.do/latest'");
    expect(linuxDoBridgeSource).toContain("'https://www.linux.do/latest'");
  });

  it('waits briefly for linux.do clearance after Cloudflare verification finishes', () => {
    expect(appSource).toContain('LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS');
    expect(appSource).toContain('LINUXDO_CLEARANCE_DETECT_INTERVAL_MS');
    expect(appSource).toContain('const waitForLinuxDoClearance');
    expect(appSource).toContain('while (Date.now() < deadline)');
    expect(appSource).toContain('await new Promise((resolve) => setTimeout(resolve, LINUXDO_CLEARANCE_DETECT_INTERVAL_MS));');
  });

  it('keeps the native linux.do cookie reader in a tracked Expo plugin', () => {
    expect(appConfigSource).toContain('./plugins/withLinuxDoCookieModule');
    expect(linuxDoCookiePluginSource).toContain('LinuxDoCookieModule.kt');
    expect(linuxDoCookiePluginSource).toContain('android.webkit.CookieManager');
    expect(linuxDoCookiePluginSource).toContain('CookieManager.getInstance()');
    expect(linuxDoCookiePluginSource).toContain('cookieManager.getCookie(url)');
  });

  it('does not reuse stale linux.do WebView cookies after reset or clear', () => {
    const resetBlock = appSource.match(/const resetLinuxDoWebView[\s\S]*?\n  }, \[\]\);/)?.[0] || '';

    expect(resetBlock).toContain("linuxDoWebViewCookieHeaderRef.current = '';");
    expect(resetBlock).toContain("setLinuxDoWebViewCookieHeader('');");
  });

  it('allows the linux.do verification WebView to keep Cloudflare challenge traffic inside the page', () => {
    expect(appSource).toContain("const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com']");
  });

});
