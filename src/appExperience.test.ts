import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appConfigSource = readFileSync(join(process.cwd(), 'android-app', 'app.json'), 'utf8');
const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
const gitIgnoreSource = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
const localLinuxDoSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'localLinuxdo.ts'), 'utf8');
const linuxDoBridgeSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'linuxdoCookieBridge.ts'), 'utf8');
const nodeSeekBridgeSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'nodeseekCookieBridge.ts'), 'utf8');
const forumApiSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'forumApi.ts'), 'utf8');
const yaohuoApiSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'yaohuoApi.ts'), 'utf8');
const readerDataSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'readerData.ts'), 'utf8');
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

  it('keeps saved search creation keyword-only', () => {
    expect(readerDataSource).toContain('export function addSavedSearch(data: ReaderData, query: string): ReaderData');
    expect(readerDataSource).not.toContain('void source');
  });

  it('shows loading and failure states inside image preview', () => {
    expect(appSource).toContain('imagePreviewLoading');
    expect(appSource).toContain('imagePreviewFailed');
    expect(appSource).toContain('onLoadStart={() =>');
    expect(appSource).toContain('onError={() =>');
  });

  it('keeps list item actions behind the swipe gesture instead of showing permanent icons', () => {
    expect(appSource).toContain('topicSwipeActionButton');
    expect(appSource).not.toContain('topicInlineAction');
    expect(appSource).not.toContain('topicMetaPressable');
  });

  it('uses more helpful empty messages for filtered feed lists', () => {
    expect(appSource).toContain('feedEmptyText');
    expect(appSource).toContain('当前筛选没有匹配主题');
  });

  it('loads additional feed pages automatically near the end of the list', () => {
    expect(appSource).toContain('onEndReachedThreshold={0.6}');
    expect(appSource).toContain('onEndReached={requestFeedLoadMore}');
    expect(appSource).toContain('shouldLoadMoreFeedFromScroll(event.nativeEvent)');
    expect(appSource).toContain('requestedFeedPageRef.current === nextPage');
  });

  it('shows loading instead of stale rows when resetting the feed list', () => {
    expect(appSource).toContain('clearItems = reset && !nocache');
    expect(appSource).toContain('if (!isLoadMore && reset && clearItems) {');
    expect(appSource).toContain('setFeedItems([]);');
    expect(appSource).toContain('setFeedHasMore(false);');
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

  it('resets stale feed paging immediately when switching source tabs', () => {
    const block = appSource.match(/const changeFeedSource = useCallback\(\(source: FeedSource\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(block).toContain('setFeedItems([]);');
    expect(block).toContain('setFeedPage(1);');
    expect(block).toContain('setFeedNextCursor(undefined);');
    expect(block).toContain('setFeedHasMore(false);');
  });

  it('cancels stale search requests when the query, source, or scope changes', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*searchRequestIdRef\.current \+= 1;[\s\S]*?\n  \}, \[searchQuery, searchScope, searchSource\]\);/)?.[0] || '';

    expect(block).toContain('searchRequestIdRef.current += 1;');
    expect(block).toContain('searchAbortRef.current?.abort();');
    expect(block).toContain('setSearchItems([]);');
    expect(block).not.toContain('setBusy(false);');
  });

  it('reruns Android search with the current query when switching search tabs', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(!searchQueryRef\.current\.trim\(\)\) \{\s*\n\s*return;\s*\n\s*}\s*\n\s*void runSearchRef\.current\?\.\(\);\s*\n\s*}, \[searchSource, searchScope\]\);/)?.[0] || '';

    expect(appSource).toContain('runSearchRef.current = runSearch;');
    expect(block).toContain('void runSearchRef.current?.();');
  });

  it('keeps recent search callbacks independent from recent search state changes', () => {
    const addBlock = appSource.match(/const addRecentSearch = useCallback\(\(query: string\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';
    const removeBlock = appSource.match(/const removeRecentSearch = useCallback\(\(query: string\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(addBlock).toContain('setRecentSearches((current) =>');
    expect(removeBlock).toContain('setRecentSearches((current) =>');
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

  it('offers linux.do external search shortcuts on the Android search screen', () => {
    expect(appSource).toContain('linuxDoExternalSearchItems(query)');
    expect(appSource).toContain('linux.do 老帖');
    expect(appSource).toContain('linuxDoExternalItems.map');
    expect(appSource).toContain('onOpenExternalUrl(item.url)');
  });

  it('offers category filters for Android search results like the mobile web page', () => {
    expect(appSource).toContain('searchCategoryOptions');
    expect(appSource).toContain('searchResultCategoryKey(item)');
    expect(appSource).toContain('setSearchCategoryFilter');
    expect(appSource).toContain('filteredSearchResults');
    expect(appSource).toContain('data={showRemoteGroups ? [] : filteredSearchResults}');
  });

  it('adds the missing Android-only search management controls', () => {
    expect(appSource).toContain('最近搜索');
    expect(appSource).toContain('onRemoveSavedSearch');
    expect(appSource).toContain('searchGroups');
    expect(appSource).toContain('retrySearchSource');
    expect(appSource).toContain('highlightQuery={query}');
  });

  it('updates local search result highlighting when the query changes', () => {
    const searchScreenSource = appSource.slice(appSource.indexOf('function SearchScreen('), appSource.indexOf('function LibraryScreen('));
    const block = searchScreenSource.match(/const renderTopicItem = useCallback<ListRenderItem<Topic>>\(\([\s\S]*?\n  \), \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(block).toContain('query');
  });

  it('does not pass press or submit events as search source overrides', () => {
    expect(appSource).toContain('onSearch={() => runSearch()}');
    expect(appSource).not.toContain('onSearch={runSearch}');
  });

  it('keeps saved searches keyword-only instead of binding them to a source tab', () => {
    const selectSavedSearchBlock = appSource.match(/const selectSavedSearch = useCallback[\s\S]*?\n  }, \[[^\]]*\]\);/)?.[0] || '';

    expect(selectSavedSearchBlock).toContain('onQueryChange(saved.query);');
    expect(selectSavedSearchBlock).not.toContain('onSearchSourceChange(saved.source);');
    expect(appSource).toContain('<Text style={styles.pillText}>{item.query}</Text>');
    expect(appSource).not.toContain('{item.query} · {sourceLabel(item.source)}');
  });

  it('shows remote search source groups before saved and recent search chips', () => {
    const groupIndex = appSource.indexOf('{showRemoteGroups ? (');
    const saveButtonIndex = appSource.indexOf('<AppButton label="保存搜索"');
    const savedListIndex = appSource.indexOf('<Text style={styles.meta}>保存搜索</Text>');
    const recentListIndex = appSource.indexOf('<Text style={styles.meta}>最近搜索</Text>');

    expect(groupIndex).toBeGreaterThan(-1);
    expect(saveButtonIndex).toBeGreaterThan(-1);
    expect(savedListIndex).toBeGreaterThan(-1);
    expect(recentListIndex).toBeGreaterThan(-1);
    expect(groupIndex).toBeLessThan(saveButtonIndex);
    expect(groupIndex).toBeLessThan(savedListIndex);
    expect(groupIndex).toBeLessThan(recentListIndex);
  });

  it('does not add a second empty result message below remote search groups', () => {
    const searchScreenSource = appSource.slice(appSource.indexOf('function SearchScreen('), appSource.indexOf('function LibraryScreen('));
    const listEmptyBlock = searchScreenSource.match(/ListEmptyComponent=\{[\s\S]*?\}\s*renderItem=\{renderTopicItem\}/)?.[0] || '';

    expect(listEmptyBlock).toContain('showRemoteGroups ? null : busy && query.trim()');
  });

  it('adds Android library management controls for filters, annotations, bulk delete, and undo', () => {
    expect(appSource).toContain('libraryUndo');
    expect(appSource).toContain('onClearHistory');
    expect(appSource).toContain('onRemoveMany');
    expect(appSource).toContain('onUpdateRecord');
    expect(appSource).toContain('撤销删除');
    expect(appSource).toContain('标签筛选');
  });

  it('adds Android topic reading tools for copy, refresh, reader mode, floor index, and comment find', () => {
    expect(appSource).toContain('copyTopicLink');
    expect(appSource).toContain('readerMode');
    expect(appSource).toContain('focusMode');
    expect(appSource).toContain('floorOpen');
    expect(appSource).toContain('commentQuery');
    expect(appSource).toContain('copyReplyMarkdown');
    expect(appSource).toContain('新增');
  });

  it('keeps the floor index aligned with the currently visible replies', () => {
    const topicScreenSource = appSource.slice(appSource.indexOf('function TopicScreen('), appSource.indexOf('function ReplyCard('));
    const floorIndexBlock = topicScreenSource.match(/\{floorOpen \? \([\s\S]*?\n\s*\) : null\}/)?.[0] || '';

    expect(floorIndexBlock).toContain('{replies.map((reply, index) => {');
    expect(floorIndexBlock).not.toContain('{sourceReplies.map((reply, index) => {');
  });

  it('adds image save, thumbnail selection, and backup file actions', () => {
    expect(appSource).toContain('savePreviewImage');
    expect(appSource).toContain('imagePreviewThumbnail');
    expect(appSource).toContain('exportBackupFile');
    expect(appSource).toContain('importBackupFile');
    expect(appSource).toContain('exportFavoritesMarkdownFile');
  });

  it('removes temporary cache files after saving preview images to the gallery', () => {
    const block = appSource.match(/const savePreviewImage = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[imagePreview, notify\]\);/)?.[0] || '';

    expect(block).toContain('shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;');
    expect(block).toContain('let downloadedUri =');
    expect(block).toContain('finally {');
    expect(block).toContain('await FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => undefined);');
  });

  it('keeps feed pagination available when an empty source page still has a next page', () => {
    expect(appSource).toContain('setFeedHasMore(Boolean(data.hasMore && (data.nextPage || data.nextCursor)))');
    expect(appSource).not.toContain('setFeedHasMore(Boolean(data.items.length && data.hasMore && (data.nextPage || data.nextCursor)))');
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
    const block = appSource.slice(appSource.indexOf('function FeedScreen('), appSource.indexOf('function SearchScreen('));

    expect(block).toContain('const [scrollRestoreReady, setScrollRestoreReady] = useState(false);');
    expect(block).toContain('setScrollRestoreReady(false);');
    expect(block).toContain('setScrollRestoreReady(true);');
    expect(block).toContain('if (scrollRestoreReady && offset && feedItems.length) {');
    expect(block).toContain('restoreFeedScrollPosition();');
  });

  it('bypasses feed caches when loading additional feed pages', () => {
    expect(appSource).toContain("onLoadMore={() => loadFeed({ page: feedPage + 1, cursor: feedSource === 'all' ? feedNextCursor : undefined, nocache: true })}");
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
    expect(appSource).toContain("{ value: 'library', label: '收藏', icon: Star }");
    expect(appSource).toContain('<Text style={styles.sectionTitle}>收藏</Text>');
    expect(appSource).not.toContain("{ value: 'library', label: '书架', icon: BookMarked }");
    expect(appSource).not.toContain('<Text style={styles.sectionTitle}>书架</Text>');
  });

  it('shows a filled favorite icon without an active button shell on Android topic details', () => {
    expect(appSource).toContain("fill={active ? theme.primary : 'none'}");
    expect(appSource).toContain('active && !iconOnly && styles.buttonActive');
  });

  it('uses content-like placeholders for shared loading states instead of only a spinner', () => {
    expect(appSource).toContain('loadingPlaceholderStack');
    expect(appSource).toContain('loadingPlaceholderLine');
    expect(appSource).toContain('loadingPlaceholderLineShort');
    expect(appSource).toContain('loadingPlaceholderLineMuted');
    expect(appSource).toContain('Array.from({ length: 3 })');
  });

  it('marks topics with extra access requirements in Android lists and details', () => {
    expect(appSource).toContain('topic.accessRequirement?.label');
    expect(appSource).toContain('styles.topicAccessBadge');
    expect(appSource).toContain('item.accessRequirement?.label');
  });

  it('shows a bottom message when the feed cannot load more', () => {
    expect(appSource).toContain('已经到底了');
    expect(appSource).toContain('styles.endOfListText');
  });

  it('sends linux.do Cloudflare detail errors to the verification panel', () => {
    expect(appSource).toContain('pendingLinuxDoTopicRef');
    expect(appSource).toContain('showLinuxDoVerification');
    expect(appSource).toContain('isLinuxDoCloudflareError(error)');
    expect(appSource).toContain('label="去验证"');
    expect(appSource).toContain('await openTopic(pendingTopic, true);');
  });

  it('sends NodeSeek Cloudflare feed errors to the NodeSeek verification panel', () => {
    expect(appSource).toContain('showNodeSeekVerification');
    expect(appSource).toContain('isNodeSeekCloudflareError(error)');
    expect(appSource).toContain('loadNodeSeekCookieForSource');
    expect(appSource).toContain('nodeSeekCookie');
    expect(appSource).toContain('label="NodeSeek 登录 / 验证"');
    expect(appSource).toContain('userAgent={nodeSeekWebViewUserAgent}');
  });

  it('saves NodeSeek WebView verification cookies before returning to lists', () => {
    expect(appSource).toContain('readNodeSeekCookiesFromWebView');
    expect(appSource).toContain('rememberCurrentNodeSeekCookies');
    expect(appSource).toContain('onRememberNodeSeekCookies={rememberCurrentNodeSeekCookies}');
    expect(appSource).toContain('nodeSeekWebViewCookieHeaderRef');
    expect(appSource).toContain('nodeSeekWebViewUserAgentRef');
    expect(appSource).toContain('sanitizeNodeSeekUserAgent(data.userAgent)');
    expect(appSource).toContain('parseNodeSeekDocumentCookie(nodeSeekDocumentCookieHeader)');
    expect(appSource).toContain('void onRememberNodeSeekCookies({ silent: true });');
  });

  it('preserves saved NodeSeek login cookies when WebView only reports verification cookies', () => {
    const block = appSource.match(/const loadNodeSeekCookieForSource = useCallback\(async \(source: FeedSource \| Source\) => \{([\s\S]*?)\n  \}, \[saveNodeSeekCookieHeader\]\);/)?.[1] || '';

    expect(block).toContain('const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);');
    expect(block).toContain('mergeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie || \'\'), cookies)');
    expect(block.indexOf('const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);')).toBeLessThan(block.indexOf('await saveNodeSeekCookieHeader'));
  });

  it('uses saved NodeSeek verification data for categories and status checks', () => {
    const categoriesBlock = appSource.match(/const loadCategories = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const statusBlock = appSource.match(/const checkLocalStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(categoriesBlock).toContain('loadNodeSeekCookieForSource');
    expect(categoriesBlock).toContain('nodeSeekCookie');
    expect(categoriesBlock).toContain('nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current');
    expect(statusBlock).toContain('loadNodeSeekCookieForSource');
    expect(statusBlock).toContain('nodeSeekCookie');
    expect(statusBlock).toContain('nodeSeekUserAgent: nodeSeekWebViewUserAgentRef.current');
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
    expect(appSource).toContain('hasNodeSeekLoginCookie ? <MenuButton icon={CheckCircle} label="NodeSeek 签到"');
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

  it('waits for rendered NodeSeek list or detail content before returning hidden WebView HTML', () => {
    expect(appSource).toContain('const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content"));');
    expect(appSource).toContain('if ((!isChallengePage() && hasReadableContent()) || Date.now() >= deadline) {');
  });

  it('keeps the hidden NodeSeek browser fetch WebView out of the visible layout', () => {
    expect(appSource).toContain('<View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>');
    expect(appSource).toContain('containerStyle={styles.hiddenBrowserWebView}');
    expect(appSource).toContain('style={styles.hiddenBrowserWebView}');
    expect(appSource).toContain('androidLayerType="software"');
  });

  it('does not mistake regular NodeSeek posts mentioning Cloudflare for verification pages', () => {
    expect(appSource).toContain('const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;');
    expect(appSource).not.toContain('just a moment|cloudflare|cf-turnstile|challenge-platform');
  });

  it('stops the linux.do verification spinner when the WebView cannot load', () => {
    expect(appSource).toContain('linuxDoWebViewError');
    expect(appSource).toContain('onSetLinuxDoWebViewError');
    expect(appSource).toContain('onError={(event) =>');
    expect(appSource).toContain('onSetLoadingLinuxDoPage(false);');
    expect(appSource).toContain('linux.do 页面加载失败');
  });

  it('resets topic loading state when leaving the topic screen', () => {
    const block = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(block).toContain('setTopicBusy(false);');
    expect(block).toContain('setLoadingMoreReplies(false);');
  });

  it('does not show reply controls when topic detail failed to load', () => {
    const topicScreenSource = appSource.slice(appSource.indexOf('function TopicScreen('), appSource.indexOf('function ReplyCard('));
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(topicScreenSource).toContain('const canShowReplies = Boolean(topic && !topicLoading);');
    expect(topicListItemsBlock).toContain('if (canShowReplies) {');
    expect(topicListItemsBlock).not.toContain('if (!topicLoading) {');
    expect(topicScreenSource).toContain('const canWriteNodeSeek = Boolean(topic && topic.source === \'nodeseek\' && canUseNodeSeekActions);');
  });

  it('closes More screen panels when navigating away from More', () => {
    const closePanelsBlock = appSource.match(/const closeMorePanels = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[closeLinuxDoPanel\]\);/)?.[1] || '';
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const selectCategoryBlock = appSource.match(/const selectCategory = useCallback\(\(category: Category\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(closePanelsBlock).toContain('setShowLoginPanel(false);');
    expect(closePanelsBlock).toContain('setShowYaohuoLoginPanel(false);');
    expect(closePanelsBlock).toContain('closeLinuxDoPanel();');
    expect(closePanelsBlock).toContain('setShowCategoriesPanel(false);');
    expect(closePanelsBlock).toContain('setShowSettingsPanel(false);');
    expect(changeScreenBlock).toContain("if (screen === 'more' && nextScreen !== 'more') {");
    expect(changeScreenBlock).toContain('closeMorePanels();');
    expect(selectCategoryBlock).toContain('closeMorePanels();');
  });

  it('closes the reply composer before leaving the topic screen with the Android back button', () => {
    const block = appSource.match(/BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{([\s\S]*?)\n    \}\);/)?.[1] || '';

    expect(block).toContain('if (replyComposerOpen) {');
    expect(block).toContain('setReplyComposerOpen(false);');
    expect(block).toContain('setYaohuoReplyTarget(null);');
  });

  it('resets library filters when switching between favorites and history', () => {
    const block = appSource.match(/useEffect\(\(\) => \{\s*\n\s*setSourceFilter\('all'\);\s*\n\s*setCategoryFilter\('all'\);\s*\n\s*setTagFilter\('all'\);\s*\n\s*}, \[libraryTab\]\);/)?.[0] || '';

    expect(block).toContain("setSourceFilter('all');");
    expect(block).toContain("setCategoryFilter('all');");
    expect(block).toContain("setTagFilter('all');");
  });

  it('clears stale library bulk selections when leaving bulk mode or records change', () => {
    const libraryScreenSource = appSource.slice(appSource.indexOf('function LibraryScreen('), appSource.indexOf('function MoreScreen('));
    const toggleBlock = libraryScreenSource.match(/const toggleBulkMode = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[bulkMode\]\);/)?.[1] || '';

    expect(libraryScreenSource).toContain('const recordKeys = useMemo(() => records.map(libraryRecordKey).join(\'|\'), [records]);');
    expect(libraryScreenSource).toContain('}, [recordKeys]);');
    expect(toggleBlock).toContain('if (bulkMode) {');
    expect(toggleBlock).toContain('setSelected(new Set());');
    expect(toggleBlock).toContain("setEditingKey('');");
    expect(libraryScreenSource).toContain('onPress={toggleBulkMode}');
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
    expect(appSource).toContain('LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS');
    expect(appSource).toContain('linux.do 页面打开超时');
    expect(appSource).toContain('clearTimeout(timeout)');
  });

  it('clears stale linux.do verification errors after the WebView responds again', () => {
    const linuxDoMessageBlock = appSource.match(/const handleLinuxDoMessage[\s\S]*?\n  }, \[[^\]]*\]\);/)?.[0] || '';

    expect(linuxDoMessageBlock).toContain("setLinuxDoWebViewError('');");
  });

  it('clears stale linux.do verification errors after a successful page load', () => {
    expect(appSource).toContain('onLoadEnd={(event) => {\n                  onSetLoadingLinuxDoPage(false);');
    expect(appSource).toContain("if (!('code' in event.nativeEvent)) {\n                    onSetLinuxDoWebViewError('');");
  });

  it('keeps linux.do verification WebView failures contained', () => {
    expect(appSource).toContain('linuxDoWebViewKey');
    expect(appSource).toContain('onResetLinuxDoWebView');
    expect(appSource).toContain('key={linuxDoWebViewKey}');
    expect(appSource).toContain('renderError={() => <View style={styles.webViewErrorPlaceholder} />}');
    expect(appSource).toContain('onRenderProcessGone={() =>');
    expect(appSource).toContain('linux.do 验证页面已停止');
  });

  it('stops the linux.do verification WebView before hiding it', () => {
    expect(appSource).toContain('closeLinuxDoPanel');
    expect(appSource).toContain('linuxDoWebViewRef.current?.stopLoading()');
    expect(appSource).toContain('onShowLinuxDoPanelChange={changeLinuxDoPanel}');
  });

  it('reuses the linux.do verification WebView user agent for local requests', () => {
    expect(appSource).toContain('navigator.userAgent');
    expect(appSource).toContain('linuxDoWebViewUserAgent');
    expect(appSource).toContain('linuxDoWebViewUserAgentRef');
    expect(appSource).toContain('sanitizeLinuxDoUserAgent(data.userAgent)');
    expect(appSource).toContain('userAgent={linuxDoWebViewUserAgent}');
    expect(appSource).toContain('saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || linuxDoWebViewUserAgent || undefined)');
    expect(localLinuxDoSource).toContain("DEFAULT_LINUXDO_ANDROID_USER_AGENT");
    expect(localLinuxDoSource).toContain("'User-Agent': access?.userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT");
  });

  it('can detect linux.do clearance from the visible WebView document cookies', () => {
    expect(appSource).toContain('cookie: document.cookie || ""');
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
