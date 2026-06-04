import { describe, expect, it } from 'vitest';
import { readOptionalProjectFile, readProjectFile } from './sourceTestUtils';

const appConfigSource = readProjectFile('android-app', 'app.json');
const appSource = readProjectFile('android-app', 'App.tsx');
const appControlsSource = readProjectFile('android-app', 'src', 'components', 'AppControls.tsx');
const topicCardSource = readProjectFile('android-app', 'src', 'components', 'TopicCard.tsx');
const imagePreviewModalSource = readProjectFile('android-app', 'src', 'components', 'ImagePreviewModal.tsx');
const feedScreenSource = readProjectFile('android-app', 'src', 'screens', 'FeedScreen.tsx');
const searchScreenSource = readProjectFile('android-app', 'src', 'screens', 'SearchScreen.tsx');
const searchListItemsSource = readProjectFile('android-app', 'src', 'searchListItems.ts');
const libraryScreenSource = readProjectFile('android-app', 'src', 'screens', 'LibraryScreen.tsx');
const moreScreenSource = readProjectFile('android-app', 'src', 'screens', 'MoreScreen.tsx');
const topicScreenSource = readProjectFile('android-app', 'src', 'screens', 'TopicScreen.tsx');
const userScreenSource = readProjectFile('android-app', 'src', 'screens', 'UserScreen.tsx');
const navBarSource = readProjectFile('android-app', 'src', 'components', 'NavBar.tsx');
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
const gitIgnoreSource = readProjectFile('.gitignore');
const localLinuxDoSource = readProjectFile('android-app', 'src', 'localLinuxdo.ts');
const linuxDoBridgeSource = readProjectFile('android-app', 'src', 'linuxdoCookieBridge.ts');
const nodeSeekBridgeSource = readProjectFile('android-app', 'src', 'nodeseekCookieBridge.ts');
const forumApiSource = readProjectFile('android-app', 'src', 'forumApi.ts');
const feedLogicSource = readProjectFile('android-app', 'src', 'feedLogic.ts');
const yaohuoApiSource = readProjectFile('android-app', 'src', 'yaohuoApi.ts');
const linuxDoCookiePluginSource = readOptionalProjectFile('android-app', 'plugins', 'withLinuxDoCookieModule.js');

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
    const topicApiBlock = forumApiSource.match(/export function getTopic\([\s\S]*?\): Promise<TopicDetail>/)?.[0] || '';
    const repliesApiBlock = forumApiSource.match(/export function getReplies\([\s\S]*?\): Promise<RepliesResponse>/)?.[0] || '';
    const replyApiBlock = forumApiSource.match(/export function getReply\([\s\S]*?\): Promise<Reply>/)?.[0] || '';

    expect(forumApiSource).not.toMatch(/export (?:async )?function (?:getFeed|getCategories|getTopic|getReplies|getReply|searchTopics)[\s\S]*?serverUrl\?: string/);
    expect(yaohuoApiSource).not.toMatch(/\bserverUrl\?: string\b/);
    expect(yaohuoApiSource).not.toMatch(/\bserverFetcher\b/);
    expect(topicApiBlock).not.toContain('nocache?: boolean');
    expect(repliesApiBlock).not.toContain('nocache?: boolean');
    expect(replyApiBlock).not.toContain('nocache?: boolean');
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
    expect(imagePreviewModalSource).toContain('imageSourceFromUrl(activeUri)');
    expect(imagePreviewModalSource).toContain('imageSourceFromUrl(url)');
  });

  it('shows the main image preview from the original asset on Android', () => {
    const previewImageBlock = imagePreviewModalSource.match(/<Image[\s\S]*?source=\{imageSourceFromUrl\(activeUri\)\}[\s\S]*?\/>/)?.[0] || '';

    expect(previewImageBlock).toContain('resizeMethod="none"');
    expect(previewImageBlock).toContain('resizeMode="contain"');
  });

  it('lets Android image preview zoom the fitted original image instead of a screen-sized bitmap', () => {
    const previewImageBlock = imagePreviewModalSource.match(/<Image[\s\S]*?source=\{imageSourceFromUrl\(activeUri\)\}[\s\S]*?\/>/)?.[0] || '';

    expect(imagePreviewModalSource).toContain("import { ResumableZoom, fitContainer } from 'react-native-zoom-toolkit';");
    expect(imagePreviewModalSource).toContain('Image.getSizeWithHeaders');
    expect(imagePreviewModalSource).toContain('<ResumableZoom');
    expect(imagePreviewModalSource).toContain('maxScale={imagePreviewMaxScale}');
    expect(previewImageBlock).toContain('style={[styles.imagePreviewImage, imagePreviewSize]}');
    expect(previewImageBlock).not.toContain('{ width, height }');
    expect(imagePreviewModalSource).not.toContain('<Gallery');
  });

  it('shows Android feed rows as unified forum topics instead of source-first reader entries', () => {
    expect(topicCardSource).toContain('styles.topicBadgeRow');
    expect(topicCardSource).toContain('styles.topicSourceBadge');
    expect(topicCardSource).toContain('styles.topicCategoryBadge');
    expect(topicCardSource).toContain('styles.topicStatPill');
    expect(topicCardSource).not.toContain("`${topic.replyCount} 回复`,");
    expect(topicCardSource).not.toContain("{sourceLabel(topic.source)}{topic.category ? ` · ${topic.category}` : ''}");
  });

  it('hides reply counts only for NodeSeek user profile topic rows', () => {
    expect(topicCardSource).toContain('hideReplyCount?: boolean');
    expect(topicCardSource).toContain("hideReplyCount ? '' : `${topic.replyCount} 回复`");
    expect(topicCardSource).toContain('{statParts ? <Text style={styles.topicStatPill}');
    expect(userScreenSource).toContain("hideReplyCount={item.topic.source === 'nodeseek'}");
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

  it('loads one additional feed page per new near-bottom scroll movement', () => {
    expect(feedScreenSource).toContain('shouldLoadMoreFeedFromScroll(event.nativeEvent)');
    expect(feedScreenSource).toContain('requestedFeedPageRef.current === nextPage');
    expect(feedScreenSource).toContain('lastAutoLoadMoreOffsetRef.current');
    expect(feedScreenSource).not.toContain('onEndReached={active ? requestFeedLoadMore : undefined}');
  });

  it('pauses automatic feed load-more retries after a failure until the user drags again', () => {
    expect(appSource).toContain('loadMoreFailureSignal');
    expect(appSource).toContain('markFeedLoadMoreFailed(requestSource);');
    expect(appSource).toContain('加载下一页失败');
    expect(feedScreenSource).toContain('loadMoreFailureSignal');
    expect(feedScreenSource).toContain('autoLoadPausedAfterFailureRef');
    expect(feedScreenSource).toContain('pausedAfterFailure: autoLoadPausedAfterFailureRef.current');
    expect(feedScreenSource).toContain('onScrollBeginDrag={active ? handleScrollBeginDrag : undefined}');
  });

  it('draws consistent separators between Android feed rows at the list level', () => {
    expect(feedScreenSource).toContain('const renderTopicSeparator');
    expect(feedScreenSource).toContain('ItemSeparatorComponent={active ? renderTopicSeparator : undefined}');
    expect(feedScreenSource).toContain('style={styles.topicListSeparator}');
  });

  it('uses lightweight underline states for Android feed, library, and topic secondary tabs', () => {
    expect((feedScreenSource.match(/variant="subtabs"/g) || []).length).toBe(2);
    expect((libraryScreenSource.match(/variant="subtabs"/g) || []).length).toBe(2);
    expect((topicScreenSource.match(/variant="subtabs"/g) || []).length).toBe(1);
    expect(appControlsSource).toContain("variant?: 'pills' | 'tabs' | 'subtabs';");
    expect(searchScreenSource).not.toContain('variant="subtabs"');
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
    const statusBlock = appSource.match(/const checkLocalStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState/)?.[1] || '';

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

  it('ignores stale Android status check results after a newer check starts', () => {
    const statusBlock = appSource.match(/const checkLocalStatus = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState/)?.[1] || '';
    const checksIndex = statusBlock.indexOf('const checks = await Promise.allSettled');
    const staleGuardIndex = statusBlock.indexOf('if (requestId !== statusRequestIdRef.current || controller.signal.aborted) {');
    const resultIndex = statusBlock.indexOf('const result = buildLocalStatusResult');
    const catchBlock = statusBlock.match(/} catch \(error\) \{([\s\S]*?)\n    } finally \{/)?.[1] || '';

    expect(appSource).toContain('const statusRequestIdRef = useRef(0);');
    expect(statusBlock).toContain('const requestId = ++statusRequestIdRef.current;');
    expect(staleGuardIndex).toBeGreaterThan(checksIndex);
    expect(staleGuardIndex).toBeLessThan(resultIndex);
    expect(catchBlock).toContain('requestId === statusRequestIdRef.current');
    expect(catchBlock).toContain('!controller.signal.aborted');
  });

  it('ignores stale Android backup and restore operations after a newer backup action starts', () => {
    const importBlock = appSource.match(/const importBackup = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[backupJson/)?.[1] || '';
    const exportBlock = appSource.match(/const exportBackup = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[notify\]\);/)?.[1] || '';
    const exportFileBlock = appSource.match(/const exportBackupFile = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const importFileBlock = appSource.match(/const importBackupFile = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';

    expect(appSource).toContain('const backupRequestIdRef = useRef(0);');
    for (const block of [importBlock, exportBlock, exportFileBlock, importFileBlock]) {
      expect(block).toContain('const requestId = ++backupRequestIdRef.current;');
      expect(block).toContain('requestId !== backupRequestIdRef.current');
    }
    for (const block of [exportFileBlock, importFileBlock]) {
      expect(block).toContain('if (backupBusy) {');
      expect(block).toContain('setBackupBusy(true);');
      expect(block).toContain('setBackupBusy(false);');
    }
  });

  it('ignores stale Android login checks after a newer login check starts', () => {
    const checkLoginBlock = appSource.match(/const checkLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[notify/)?.[1] || '';
    const checkYaohuoBlock = appSource.match(/const checkYaohuoCookie = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState/)?.[1] || '';
    const checkLinuxDoBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[closeLinuxDoPanel/)?.[1] || '';
    const saveNodeSeekBlock = appSource.match(/const saveNodeSeekCookieHeader = useCallback\(async \([\s\S]*?\n  \}, \[\]\);/)?.[0] || '';
    const rememberNodeSeekBlock = appSource.match(/const rememberCurrentNodeSeekCookies = useCallback\(async[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('const checkingRequestIdRef = useRef(0);');
    for (const block of [checkLoginBlock, checkYaohuoBlock]) {
      expect(block).toContain('const requestId = ++checkingRequestIdRef.current;');
      expect(block).toContain('requestId === checkingRequestIdRef.current');
      expect(block).toContain('if (requestId === checkingRequestIdRef.current) {');
    }
    expect(checkLinuxDoBlock).toContain('const requestId = ++checkingRequestIdRef.current;');
    expect(checkLinuxDoBlock).toContain('const isCurrentLinuxDoCheck = () => {');
    expect(checkLinuxDoBlock).toContain('requestId !== checkingRequestIdRef.current');
    expect(checkLinuxDoBlock).toContain('linuxDoWebViewSession !== linuxDoWebViewSessionRef.current');
    expect(checkLinuxDoBlock).toContain('!showLinuxDoPanelRef.current');
    expect(checkLinuxDoBlock).toContain('if (!isCurrentLinuxDoCheck()) {');
    expect(checkLinuxDoBlock).toContain('if (isCurrentLinuxDoCheck()) {');
    expect(saveNodeSeekBlock).toContain('isCurrent = () => true');
    expect(saveNodeSeekBlock).toContain('if (!isCurrent()) {');
    expect(rememberNodeSeekBlock).toContain('saveNodeSeekCookieHeader(cookies, { verifiedByPage: webLoginDetectedRef.current, isCurrent })');
    expect(checkYaohuoBlock.indexOf('if (requestId !== checkingRequestIdRef.current) {', checkYaohuoBlock.indexOf('await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);'))).toBeGreaterThan(-1);
  });

  it('ignores stale Android write action results after a newer action starts', () => {
    const runNodeSeekBlock = appSource.match(/const runNodeSeekRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const runYaohuoBlock = appSource.match(/const runYaohuoRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const runLinuxDoBlock = appSource.match(/const runLinuxDoRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('const actionRequestIdRef = useRef(0);');
    for (const block of [runNodeSeekBlock, runYaohuoBlock, runLinuxDoBlock]) {
      expect(block).toContain('const requestId = ++actionRequestIdRef.current;');
      expect(block).toContain('requestId !== actionRequestIdRef.current');
      expect(block).toContain('controller.signal.aborted');
      expect(block).toContain('options.isCurrent?.() === false');
      expect(block).toContain('isCanceledRequest(error)');
    }
    expect(runNodeSeekBlock).toContain('userAgent: nodeSeekWebViewUserAgentRef.current');
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
    const cookieIndex = block.indexOf('loadYaohuoCookieForSource(source)');

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
    expect(appSource).toContain('const nextPageState = nextFeedPageState(previous,');
    expect(appSource).toContain('...nextPageState');
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

  it('keeps recent search delete controls easy to tap on Android', () => {
    const recentSearchDeleteBlock = searchScreenSource.match(/accessibilityLabel=\{`删除最近搜索 \$\{item\}`\}[\s\S]*?style=\{styles\.removableChipClose\}/)?.[0] || '';

    expect(recentSearchDeleteBlock).toContain('hitSlop={14}');
  });

  it('keeps long recent searches from stretching the chip row', () => {
    const recentSearchChipBlock = searchScreenSource.match(/<Pressable accessibilityRole="button" style=\{\[styles\.removableChip, styles\.removableChipPadded\]\}[\s\S]*?<\/Pressable>/)?.[0] || '';

    expect(recentSearchChipBlock).toContain('numberOfLines={1}');
    expect(recentSearchChipBlock).toContain('ellipsizeMode="tail"');
    expect(recentSearchChipBlock).toContain('styles.removableChipText');
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

  it('saves current topic scroll progress without re-rendering the visible detail page', () => {
    const block = appSource.match(/const flushPendingProgress = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[persistReaderData\]\);/)?.[1] || '';

    expect(appSource).toContain("const screenRef = useRef<Screen>('feed');");
    expect(appSource).toContain('screenRef.current = screen;');
    expect(appSource).toContain('const readerDataStateRef = useRef<ReaderData>(readerData);');
    expect(appSource).toContain('if (readerDataStateRef.current !== readerData) {');
    expect(block).toContain('readerDataRef.current = next;');
    expect(block).toContain("if (screenRef.current !== 'topic')");
    expect(block).toContain("if (screenRef.current !== 'topic') {\n      setReaderData(next);\n    }");
    expect(block.indexOf('readerDataRef.current = next;')).toBeLessThan(block.indexOf("if (screenRef.current !== 'topic')"));
    expect(block).not.toContain('readerDataRef.current = next;\n    setReaderData(next);');
  });

  it('saves pending topic progress before leaving the topic screen', () => {
    const block = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(block).toContain("if (screen === 'topic' && nextScreen !== 'topic') {");
    expect(block).toContain('screenRef.current = nextScreen;');
    expect(block).toContain('flushPendingProgress();');
    expect(block.indexOf('screenRef.current = nextScreen;')).toBeLessThan(block.indexOf('flushPendingProgress();'));
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
    expect(searchListItemsSource).toContain('searchResultCategoryKey(item)');
    expect(searchScreenSource).toContain('setSearchCategoryFilter');
    expect(searchScreenSource).toContain('filterSearchResultsByCategory');
    expect(searchScreenSource).toContain('filteredSearchResults');
    expect(searchScreenSource).toContain('buildSearchListItems');
    expect(searchScreenSource).toContain('data={listItems}');
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
    const block = searchScreenSource.match(/const renderTopicCard = useCallback\(\(item: Topic\) => \([\s\S]*?\n  \), \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(block).toContain('query');
  });

  it('does not pass press or submit events as search source overrides', () => {
    expect(appSource).toContain('onSearch={() => runSearch()}');
    expect(appSource).not.toContain('onSearch={runSearch}');
  });

  it('shows remote search source groups before recent search chips', () => {
    const groupIndex = searchScreenSource.indexOf('data={listItems}');
    const recentListIndex = searchScreenSource.indexOf('<Text style={styles.meta}>最近搜索</Text>');
    const footerIndex = searchScreenSource.indexOf('ListFooterComponent={footer}');

    expect(groupIndex).toBeGreaterThan(-1);
    expect(recentListIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(-1);
    expect(groupIndex).toBeLessThan(footerIndex);
    expect(footerIndex).toBeGreaterThan(recentListIndex);
  });

  it('does not add a second empty result message below remote search groups', () => {
    const listEmptyBlock = searchScreenSource.match(/ListEmptyComponent=\{[\s\S]*?\}\s*renderItem=\{renderSearchListItem\}/)?.[0] || '';

    expect(listEmptyBlock).toContain('showRemoteGroups ? null : busy && query.trim()');
  });

  it('adds a load-more action to remote search source groups', () => {
    expect(searchListItemsSource).toContain('hasMore?: boolean;');
    expect(searchListItemsSource).toContain('nextPage?: number | null;');
    expect(searchListItemsSource).toContain('loadingMore?: boolean;');
    expect(searchScreenSource).toContain('onLoadMoreSearchSource: (source: Source, page: number) => void;');
    expect(searchScreenSource).toContain("label={item.group.loadingMore ? '加载中...' : `加载更多 ${item.group.label}`}");
    expect(searchListItemsSource).toContain("type: 'groupLoadMore'");
    expect(appSource).toContain('const loadMoreSearchSource = useCallback');
    expect(appSource).toContain('onLoadMoreSearchSource={loadMoreSearchSource}');
  });

  it('clears stale search load-more flags when retrying a source', () => {
    const runSearchBlock = appSource.match(/const runSearch = useCallback\(async \(sourceOverride\?: Source\) => \{([\s\S]*?)\n  \}, \[addRecentSearch/)?.[1] || '';

    expect(runSearchBlock).toContain('const nextGroups = searchGroupsRef.current.map((group) => (');
    expect(runSearchBlock).toContain('group.source === sourceOverride ? { ...group, loading: true, loadingMore: false, error: undefined } : { ...group, loading: false, loadingMore: false }');
    expect(runSearchBlock).toContain('searchGroupsRef.current = nextGroups;');
  });

  it('updates all-source search groups as each source finishes', () => {
    const runSearchBlock = appSource.match(/const runSearch = useCallback\(async \(sourceOverride\?: Source\) => \{([\s\S]*?)\n  \}, \[addRecentSearch/)?.[1] || '';

    expect(runSearchBlock).toContain('activeSources.map(async (source) => {');
    expect(runSearchBlock).toContain('const group = await runRemoteSearchSource(source, query, 1, controller.signal, activeSort);');
    expect(runSearchBlock).toContain('currentGroup.source === source ? { ...group, loading: false } : currentGroup');
    expect(runSearchBlock).toContain('setSearchItems(nextItems);');
    expect(runSearchBlock).not.toContain('const groups = await Promise.all(activeSources.map((source) => runRemoteSearchSource');
  });

  it('clears stale search load-more flags when another source starts loading more', () => {
    const loadMoreSearchBlock = appSource.match(/const loadMoreSearchSource = useCallback\(async \(source: Source, page: number\) => \{([\s\S]*?)\n  \}, \[notify/)?.[1] || '';

    expect(loadMoreSearchBlock).toContain('group.source === source ? { ...group, loadingMore: true, error: undefined } : { ...group, loadingMore: false }');
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
    expect(feedLogicSource).toContain('reset || items.length > previous.items.length');
    expect(feedLogicSource).toContain('Boolean(response.hasMore && (response.nextPage || response.nextCursor) && addedItems)');
  });

  it('removes temporary cache files after exporting backup or markdown text', () => {
    const block = appSource.match(/const shareTextFile = useCallback\(async[\s\S]*?\n  }, \[notify\]\);/)?.[0] || '';

    expect(block).toContain('const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;');
    expect(block).toContain('finally {');
    expect(block).toContain('await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);');
  });

  it('removes the picked backup cache copy after importing it', () => {
    const block = appSource.match(/const importBackupFile = useCallback\(async \(\) => \{[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] || '';

    expect(block).toContain('const pickedUri = result.assets[0].uri;');
    expect(block).toContain('pickedUri.startsWith(FileSystem.cacheDirectory)');
    expect(block).toContain('await FileSystem.deleteAsync(pickedUri, { idempotent: true }).catch(() => undefined);');
  });

  it('confirms before clearing all Android history records', () => {
    expect(libraryScreenSource).toContain('const confirmClearHistory = useCallback');
    expect(libraryScreenSource).toContain("Alert.alert('清空历史？'");
    expect(libraryScreenSource).toContain("onPress: onClearHistory");
    expect(libraryScreenSource).toContain('onPress={confirmClearHistory}');
  });

  it('marks library destructive actions as danger buttons', () => {
    expect(appControlsSource).toContain("variant?: 'default' | 'danger' | 'ghost' | 'primary'");
    expect(libraryScreenSource).toContain('label="删除" variant="danger"');
    expect(libraryScreenSource).toContain('label="取消关注" variant="danger"');
    expect(libraryScreenSource).toContain('label="清空历史" variant="danger"');
    expect(moreScreenSource.match(/label="清除登录" variant="danger"/g)?.length).toBe(3);
    expect(userScreenSource).toContain("variant={followed ? 'danger' : undefined}");
  });

  it('refreshes memoized topic cards when displayed topic fields change', () => {
    const comparator = topicCardSource.match(/export const MemoizedTopicCard = memo\(TopicCard, \([\s\S]*?\)\);/)?.[0] || '';

    expect(comparator).toContain('previous.topic.author === next.topic.author');
    expect(comparator).toContain('previous.topic.authorId === next.topic.authorId');
    expect(comparator).toContain('previous.topic.authorAvatar === next.topic.authorAvatar');
    expect(comparator).toContain('previous.topic.authorUrl === next.topic.authorUrl');
    expect(comparator).toContain('previous.topic.accessRequirement?.label === next.topic.accessRequirement?.label');
    expect(comparator).toContain('stringArrayValuesEqual(previous.topic.duplicateSources, next.topic.duplicateSources)');
    expect(comparator).toContain('stringArrayValuesEqual(previous.topic.tags, next.topic.tags)');
  });

  it('updates all-source feed as each aggregated source finishes', () => {
    const loadFeedBlock = appSource.match(/const loadFeed = useCallback\(async \(\{([\s\S]*?)\n  \}, \[categoryFilter/)?.[1] || '';

    expect(loadFeedBlock).toContain('const applyFeedResponse = (data: FeedResponse) => {');
    expect(loadFeedBlock).toContain('const basePromise = shouldFetchBaseFeed');
    expect(loadFeedBlock).toContain('const yaohuoPromise = getYaohuoFeedDirect');
    expect(loadFeedBlock).toContain('await Promise.allSettled([basePromise, yaohuoPromise]);');
    expect(loadFeedBlock).not.toContain('data = mergeSettledFeedResponses(baseResult, yaohuoResult);');
  });

  it('resets feed scroll position when the source, category, or reading filter changes', () => {
    const block = feedScreenSource;

    expect(block).toContain('pendingScrollTopRef.current[feedSource] = true;');
    expect(block).toContain('scrollFeedToTop(feedSource, false);');
    expect(block).toContain('completePendingFeedScrollReset');
    expect(block).not.toContain('AsyncStorage.getItem(scrollStorageKey)');
  });

  it('keeps source tab scenes populated during pager transitions', () => {
    expect(feedScreenSource).toContain('data={feedItems}');
    expect(feedScreenSource).not.toContain('data={active ? feedItems : []}');
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

  it('stops reply load-more when the next page adds no new replies', () => {
    const block = appSource.match(/const loadMoreReplies = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const staleRequestGuardIndex = block.indexOf('if (currentTopicKeyRef.current !== requestTopicKey || requestId !== repliesRequestIdRef.current) {');
    const currentRepliesIndex = block.indexOf('const currentReplies = topicRepliesRef.current;');

    expect(appSource).toContain('const topicRepliesRef = useRef<Reply[]>(topicReplies);');
    expect(appSource).toContain('topicRepliesRef.current = topicReplies;');
    expect(block).toContain('const currentReplies = topicRepliesRef.current;');
    expect(block).toContain('const previousReplyCount = currentReplies.length;');
    expect(block).toContain('const mergedReplies = mergeReplies(currentReplies, data.items);');
    expect(block).toContain('setReplyHasMore(Boolean(data.hasMore && data.nextPage && mergedReplies.length > previousReplyCount));');
    expect(currentRepliesIndex).toBeGreaterThan(staleRequestGuardIndex);
  });

  it('requires a fresh user scroll before auto-loading another reply page', () => {
    expect(topicScreenSource).toContain('autoLoadRepliesArmedRef');
    expect(topicScreenSource).toContain('const armReplyAutoLoad = useCallback');
    expect(topicScreenSource).toContain('const handleReplyEndReached = useCallback');
    expect(topicScreenSource).toContain('const requestReplyLoadMore = useCallback');
    expect(topicScreenSource).toContain('autoLoadRepliesArmedRef.current = false;');
    expect(topicScreenSource).toMatch(/useEffect\(\(\) => \{\r?\n    setTopicMenuOpen\(false\);\r?\n    autoLoadRepliesArmedRef\.current = false;\r?\n  \}, \[item\?\.id, item\?\.source\]\);/);
    expect(topicScreenSource).toContain('onEndReached={handleReplyEndReached}');
    expect(topicScreenSource).toContain('onPress={requestReplyLoadMore}');
    expect(topicScreenSource).toContain('onScrollBeginDrag={armReplyAutoLoad}');
    expect(topicScreenSource).toContain('onMomentumScrollBegin={armReplyAutoLoad}');
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

  it('does not mark saved yaohuo session cookies as logged in while loading sources', () => {
    const loadCookieBlock = appSource.match(/const loadYaohuoCookieForSource = useCallback\(async \(source: FeedSource \| Source\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(loadCookieBlock).toContain("summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookie || ''))");
    expect(loadCookieBlock).toContain('setHasYaohuoCookie(summary.loggedIn);');
    expect(loadCookieBlock).not.toContain('setHasYaohuoCookie(Boolean(cookie));');
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
    expect(topicCardSource).toContain('forumAccessRequirementText(topic.accessRequirement)');
    expect(androidUiSource).toContain('styles.topicAccessBadge');
    expect(topicScreenSource).toContain('forumAccessRequirementText(item.accessRequirement)');
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
  });

  it('sends linux.do level Cloudflare errors to the verification panel', () => {
    const refreshLevelBlock = appSource.match(/const refreshLinuxDoLevel = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(refreshLevelBlock).toContain('isLinuxDoCloudflareError(error)');
    expect(refreshLevelBlock).toContain("showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证')");
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
    expect(appSource).toContain('rememberVisibleNodeSeekCookies');
    expect(appSource).toContain('onRememberNodeSeekCookies={rememberVisibleNodeSeekCookies}');
    expect(appSource).toContain('showLoginPanelRef.current && nodeSeekLoginPanelRequestRef.current === requestId');
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

  it('ignores stale Android category results after a newer category request starts', () => {
    const categoriesBlock = appSource.match(/const loadCategories = useCallback\(async \(source: FeedSource = 'all'\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const dataIndex = categoriesBlock.indexOf('const data = await getCategories({');
    const staleGuardIndex = categoriesBlock.indexOf('if (requestId !== categoriesRequestIdRef.current || controller.signal.aborted) {');
    const setCategoriesIndex = categoriesBlock.indexOf('setCategories((current) =>');
    const catchBlock = categoriesBlock.match(/} catch \(error\) \{([\s\S]*?)\n    } finally \{/)?.[1] || '';

    expect(appSource).toContain('const categoriesRequestIdRef = useRef(0);');
    expect(categoriesBlock).toContain('const requestId = ++categoriesRequestIdRef.current;');
    expect(staleGuardIndex).toBeGreaterThan(dataIndex);
    expect(staleGuardIndex).toBeLessThan(setCategoriesIndex);
    expect(catchBlock).toContain('requestId === categoriesRequestIdRef.current');
    expect(catchBlock).toContain('!controller.signal.aborted');
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
    expect(appSource).toContain('createNodeSeekWebViewFallbackFetcher');
    expect(appSource).toContain('const nodeSeekFetchWithWebViewFallback = useMemo(() => createNodeSeekWebViewFallbackFetcher({');
    expect(appSource).toContain('defaultFetcher: fetch');
    expect(appSource).toContain('webViewFetcher: nodeSeekFetchWithWebView');
    expect(appSource).toContain('defaultFetcher: nodeSeekFetchWithWebViewFallback');
    expect(appSource).toContain("type: 'nodeseek-browser-fetch'");
    expect(appSource).toContain('fetcher: forumFetchWithWebViewFallback');
    expect(appSource).toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
  });

  it('does not leave hidden NodeSeek browser fetch requests pending after WebView failures', () => {
    expect(appSource).toContain('const failNodeSeekBrowserFetchById = useCallback((requestId: number, message: string) => {');
    expect(appSource).toContain('onHttpError={(event) => {');
    expect(appSource).toContain('if (event.nativeEvent.url !== nodeSeekBrowserFetchRequest.url) {');
    expect(appSource).toContain('if (event.nativeEvent.statusCode === 403) {');
    expect(appSource).toContain('nodeSeekBrowserFetchCurrentRef.current.httpErrorStatus = event.nativeEvent.statusCode;');
    expect(appSource).toContain('NodeSeek 页面返回错误');
    expect(appSource).toContain('onRenderProcessGone={() => {');
    expect(appSource).toContain('NodeSeek 页面读取进程已停止');
    expect(appSource).toContain('renderError={() => <View style={styles.hiddenBrowserWebView} />}');
  });

  it('waits for rendered NodeSeek list or detail content before returning hidden WebView HTML', () => {
    expect(appSource).toContain('const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content, pre"))');
    expect(appSource).toContain('document.body?.innerText');
    expect(appSource).toContain('if ((!isChallengePage() && (hasReadableContent() || hasRestrictedNotice()) && !hasPendingVotePanel()) || Date.now() >= deadline) {');
  });

  it('returns hidden NodeSeek WebView HTML when a restricted notice is rendered without post content', () => {
    expect(appSource).toContain('const hasRestrictedNotice = () => restrictedNoticePattern.test(pageText())');
    expect(appSource).toContain('hasRestrictedNotice()');
    expect(appSource).toContain('if ((!isChallengePage() && (hasReadableContent() || hasRestrictedNotice()) && !hasPendingVotePanel()) || Date.now() >= deadline) {');
  });

  it('lets NodeSeek detail WebView fallback finish before the outer request timeout', () => {
    expect(appSource).toContain('const NODESEEK_DETAIL_TIMEOUT_MS = 30000;');
    expect(appSource).toContain("timeoutMs: topic.source === 'nodeseek' ? NODESEEK_DETAIL_TIMEOUT_MS : undefined");
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

  it('waits for NodeSeek embedded vote panels before returning hidden WebView HTML', () => {
    expect(appSource).toContain('const hasPendingVotePanel = () =>');
    expect(appSource).toContain('.embed-vote .form-mask');
    expect(appSource).toContain('input[name="vote-item"]');
    expect(appSource).toContain('!hasPendingVotePanel()');
  });

  it('stops the hidden NodeSeek browser page after returning fallback HTML', () => {
    const script = appSource.match(/const NODESEEK_BROWSER_FETCH_SCRIPT = `([\s\S]*?)`;/)?.[1] || '';
    const completeBlock = appSource.match(/const completeNodeSeekBrowserFetch = useCallback\(\(data: \{[\s\S]*?\n  \}, \[/)?.[0] || '';

    expect(script).toContain('window.stop();');
    expect(completeBlock).toContain('nodeSeekBrowserWebViewRef.current?.stopLoading();');
  });

  it('stops the linux.do verification spinner when the WebView cannot load', () => {
    expect(moreScreenSource).toContain('linuxDoWebViewError');
    expect(moreScreenSource).toContain('onSetLinuxDoWebViewError');
    expect(moreScreenSource).toContain('onError={(event) =>');
    expect(moreScreenSource).toContain('onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);');
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

  it('does not show reply controls when topic detail failed to load or is restricted', () => {
    const topicListItemsBlock = topicScreenSource.match(/const topicListItems = useMemo<TopicListItem\[\]>\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(topicScreenSource).toContain('const canShowReplies = Boolean(topic && !topicLoading);');
    expect(topicListItemsBlock).toContain('if (canShowReplies && !topicShowsAccessNotice) {');
    expect(topicListItemsBlock).not.toContain('if (!topicLoading) {');
    expect(topicScreenSource).toContain('const canWriteNodeSeek = Boolean(topic && topic.source === \'nodeseek\' && canUseNodeSeekActions);');
  });

  it('keeps successful topic actions local instead of reopening the whole topic', () => {
    const interactBlock = appSource.match(/const interact = useCallback\(async \(type: InteractionType, commentId\?: number\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const bookmarkBlock = appSource.match(/const bookmarkOnLinuxDoSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const nodeSeekCollectionBlock = appSource.match(/const collectOnNodeSeekSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const voteBlock = appSource.match(/const votePoll = useCallback\(async \(poll: TopicPoll, optionIds: string\[\]\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(appSource).toContain('applyInteractionToTopic');
    expect(appSource).toContain('applyInteractionToReplies');
    expect(appSource).toContain('applyBookmarkToTopic');
    expect(appSource).toContain('applyNodeSeekCollectionToTopic');
    expect(appSource).toContain('applyPollVoteToTopic');
    expect(appSource).toMatch(/buildLinuxDoLikeRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(appSource).toMatch(/buildNodeSeekInteractionRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(appSource).toMatch(/buildLinuxDoBookmarkRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(appSource).toMatch(/buildNodeSeekCollectionRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(appSource).toMatch(/buildNodeSeekVoteRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(appSource).toMatch(/buildLinuxDoPollVoteRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(appSource).toMatch(/buildYaohuoVoteRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(interactBlock).toContain('const requestTopicKey = detail ? topicKey(detail) : null;');
    expect(interactBlock).toContain('const active = Boolean(target?.[activeField]);');
    expect(interactBlock).toContain('mode: \'toggle\' as const');
    expect(interactBlock).toContain('isCurrent: () => currentTopicKeyRef.current === requestTopicKey');
    expect(bookmarkBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(bookmarkBlock).toContain('if (currentTopicKeyRef.current !== requestTopicKey) {');
    expect(nodeSeekCollectionBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(nodeSeekCollectionBlock).toContain('applyNodeSeekCollectionToTopic(current, { collected: !collected })');
    expect(voteBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(voteBlock).toContain('if (currentTopicKeyRef.current !== requestTopicKey) {');
    expect(voteBlock).toContain('voteIds: optionIds');
    expect(voteBlock).not.toContain('voteId: optionIds[0]');
  });

  it('updates visible reaction counts before waiting for the write request', () => {
    const interactBlock = appSource.match(/const interact = useCallback\(async \(type: InteractionType, commentId\?: number\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const linuxDoBlock = interactBlock.match(/if \(detail\?\.source === 'linuxdo'\) \{([\s\S]*?)\n    if \(detail\?\.source !== 'nodeseek'\)/)?.[1] || '';
    const nodeSeekBlock = interactBlock.match(/const activeFields: Record<InteractionType[\s\S]*?await runNodeSeekRequest\(/)?.[0] || '';
    const linuxDoPatchIndex = linuxDoBlock.indexOf("const patch = { commentId, type: 'like' as const, mode: 'toggle' as const };");
    const linuxDoRequestIndex = linuxDoBlock.indexOf('await runLinuxDoRequest(');
    const nodeSeekPatchIndex = nodeSeekBlock.indexOf("const patch = { commentId, type, mode: 'toggle' as const };");
    const nodeSeekRequestIndex = nodeSeekBlock.indexOf('await runNodeSeekRequest(');

    expect(linuxDoPatchIndex).toBeGreaterThan(-1);
    expect(linuxDoRequestIndex).toBeGreaterThan(-1);
    expect(linuxDoPatchIndex).toBeLessThan(linuxDoRequestIndex);
    expect(nodeSeekPatchIndex).toBeGreaterThan(-1);
    expect(nodeSeekRequestIndex).toBeGreaterThan(-1);
    expect(nodeSeekPatchIndex).toBeLessThan(nodeSeekRequestIndex);
  });

  it('updates original-site collection buttons before waiting for the write request', () => {
    const nodeSeekCollectionBlock = appSource.match(/const collectOnNodeSeekSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const linuxDoBookmarkBlock = appSource.match(/const bookmarkOnLinuxDoSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const nodeSeekPatchIndex = nodeSeekCollectionBlock.indexOf('setTopicDetail((current) => applyNodeSeekCollectionToTopic(current, { collected: !collected }));');
    const nodeSeekRequestIndex = nodeSeekCollectionBlock.indexOf('await runNodeSeekRequest(');
    const linuxDoPatchIndex = linuxDoBookmarkBlock.indexOf('setTopicDetail((current) => applyBookmarkToTopic(current, {');
    const linuxDoRequestIndex = linuxDoBookmarkBlock.indexOf('const result = await runLinuxDoRequest(');

    expect(nodeSeekPatchIndex).toBeGreaterThan(-1);
    expect(nodeSeekRequestIndex).toBeGreaterThan(-1);
    expect(nodeSeekPatchIndex).toBeLessThan(nodeSeekRequestIndex);
    expect(linuxDoPatchIndex).toBeGreaterThan(-1);
    expect(linuxDoRequestIndex).toBeGreaterThan(-1);
    expect(linuxDoPatchIndex).toBeLessThan(linuxDoRequestIndex);
  });

  it('refreshes topic replies without resetting the topic body or reading state', () => {
    const refreshRepliesBlock = appSource.match(/const refreshTopicReplies = useCallback\(async \(\{ silent = false, afterSubmit = false \}: \{ silent\?: boolean; afterSubmit\?: boolean \} = \{\}\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const refreshTopicBlock = appSource.match(/const refreshTopic = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const refreshWholeTopicBlock = appSource.match(/const refreshWholeTopic = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const submitReplyBlock = appSource.match(/const submitReply = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(refreshRepliesBlock).toContain('getYaohuoRepliesDirect');
    expect(refreshRepliesBlock).toContain('getReplies');
    expect(refreshRepliesBlock).toContain('mergeReplies(data.items, current)');
    expect(appSource).toContain('afterSubmit = false');
    expect(appSource).toContain('replyRefreshTarget');
    expect(refreshRepliesBlock).toContain('const { page: targetPage, offset: targetOffset } = replyRefreshTarget({');
    expect(refreshRepliesBlock).toContain('replyNextPage');
    expect(refreshRepliesBlock).toContain('afterSubmit ? mergeReplies(current, data.items) : mergeReplies(data.items, current)');
    expect(refreshRepliesBlock).toContain('if (!afterSubmit) {');
    expect(refreshRepliesBlock).not.toContain('setTopicDetail(null)');
    expect(refreshRepliesBlock).not.toContain("setCommentQuery('')");
    expect(refreshRepliesBlock).not.toContain("setReplyFilter('all')");
    expect(refreshRepliesBlock).not.toContain('resetQuoteState()');
    expect(appSource).toMatch(/useEffect\(\(\) => \{\s*\n\s*setTopicDetail\(\(current\) => \{[\s\S]*?replies: topicReplies[\s\S]*?\n\s*}, \[topicReplies\]\);/);
    expect(refreshTopicBlock).toContain('void refreshTopicReplies();');
    expect(refreshTopicBlock).not.toContain('openTopic(');
    expect(refreshWholeTopicBlock).toContain('void openTopic(detail, true);');
    expect(submitReplyBlock).toMatch(/buildYaohuoReplyRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(submitReplyBlock).toMatch(/buildLinuxDoReplyRequest[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(submitReplyBlock).toMatch(/buildNodeSeekReplyRequest[\s\S]*?replyTarget[\s\S]*?\{ refreshTopic: false, isCurrent: \(\) => currentTopicKeyRef\.current === requestTopicKey \}/);
    expect(submitReplyBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(submitReplyBlock).toContain('if (currentTopicKeyRef.current !== requestTopicKey) {');
    expect(submitReplyBlock.match(/await refreshTopicReplies\(\{ silent: true, afterSubmit: true \}\);/g) || []).toHaveLength(3);
    expect(topicScreenSource).toContain('onRefreshWholeTopic');
    expect(topicScreenSource).toContain('刷新评论');
    expect(topicScreenSource).toContain('刷新全文');
  });

  it('closes More screen panels when navigating away from More', () => {
    const closePanelsBlock = appSource.match(/const closeMorePanels = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(closePanelsBlock).toContain('changeNodeSeekLoginPanel(false);');
    expect(closePanelsBlock).toContain('closeYaohuoLoginPanel();');
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
    expect(searchScreenSource).toContain('styles.searchGroupHeader');
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
    expect(block).toContain('setReplyTarget(null);');
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
    const block = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(block).toContain('pendingLinuxDoTopicRef.current = null;');
  });

  it('does not let a stale linux.do topic verification reopen after manual close', () => {
    const closeBlock = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const cloudflareBlock = appSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const openTopicBlock = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';

    expect(appSource).toContain('const linuxDoDismissedVerificationTopicKeyRef = useRef<string | null>(null);');
    expect(closeBlock).toContain('if (pendingTopic && !shouldOpenPendingTopic) {');
    expect(closeBlock).toContain('linuxDoDismissedVerificationTopicKeyRef.current = topicKey(pendingTopic);');
    expect(cloudflareBlock).toContain('linuxDoDismissedVerificationTopicKeyRef.current === requestTopicKey');
    expect(cloudflareBlock).toContain('setMountLinuxDoWebView(false);');
    expect(cloudflareBlock).toContain('setLoadingLinuxDoPage(false);');
    expect(openTopicBlock).toContain('if (!reopenExistingTopicScreen) {');
    expect(openTopicBlock).toContain('linuxDoDismissedVerificationTopicKeyRef.current = null;');
  });

  it('returns to the pending linux.do topic only after the verified panel is closed', () => {
    const closeBlock = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const afterCloseBlock = appSource.match(/useEffect\(\(\) => \{\s*if \(showLinuxDoPanel \|\| linuxDoPanelClosingSessionRef\.current === null\) \{[\s\S]*?\n  \}, \[[^\]]*showLinuxDoPanel[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('linuxDoPendingTopicVerifiedRef');
    expect(appSource).toContain('linuxDoVerifiedRetryTopicKeyRef');
    expect(appSource).toContain('linuxDoPendingReopenTopicAfterCloseRef');
    expect(appSource).toContain('openTopicRef');
    expect(closeBlock).toContain('const pendingTopic = pendingLinuxDoTopicRef.current;');
    expect(closeBlock).toContain('linuxDoPendingTopicVerifiedRef.current');
    expect(closeBlock).toContain('linuxDoPendingReopenTopicAfterCloseRef.current = pendingTopic;');
    expect(closeBlock).not.toContain("setScreen('topic');");
    expect(closeBlock).not.toContain('openTopicRef.current?.(pendingTopic, true);');
    expect(appSource).toContain('LINUXDO_PANEL_CLOSE_SETTLE_MS');
    expect(afterCloseBlock).toContain('linuxDoPanelCloseSettleTimerRef');
    expect(afterCloseBlock).toContain('setTimeout(() =>');
    expect(afterCloseBlock).toContain('}, LINUXDO_PANEL_CLOSE_SETTLE_MS);');
    expect(afterCloseBlock).toContain('const pendingTopic = linuxDoPendingReopenTopicAfterCloseRef.current;');
    expect(afterCloseBlock).toContain('linuxDoPanelClosingSessionRef.current = null;');
    expect(afterCloseBlock).toContain('linuxDoPendingReopenTopicAfterCloseRef.current = null;');
    expect(afterCloseBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current = topicKey(pendingTopic);');
    expect(afterCloseBlock).toContain('InteractionManager.runAfterInteractions');
    expect(afterCloseBlock).toContain("setScreen('topic');");
    expect(afterCloseBlock).toContain('openTopicRef.current?.(pendingTopic, true);');
  });

  it('re-renders the topic screen after runtime tiny image detection updates', () => {
    const renderTopicScreenBlock = appSource.match(/const renderTopicScreen = useCallback\(\(\) => \([\s\S]*?\n  \), \[([^\]]*)\]\);/)?.[1] || '';

    expect(appSource).toContain('inlineSizedImageUrls={inlineSizedImageUrls}');
    expect(renderTopicScreenBlock).toContain('inlineSizedImageUrls');
  });

  it('keeps runtime-detected tiny images out of the image-only reply filter', () => {
    const filteredRepliesBlock = appSource.match(/const filteredReplies = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(filteredRepliesBlock).toContain('inlineSizedImageUrls');
    expect(filteredRepliesBlock).toContain('markInlineSizedImageHtml');
    expect(filteredRepliesBlock).toContain('extractImageUrlsFromHtml');
  });

  it('closes the linux.do verification panel automatically after detecting a pending topic', () => {
    const checkLinuxDoBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(checkLinuxDoBlock).toContain('linuxDoPendingTopicVerifiedRef.current = Boolean(pendingLinuxDoTopicRef.current);');
    expect(checkLinuxDoBlock).toContain('if (linuxDoPendingTopicVerifiedRef.current) {');
    expect(checkLinuxDoBlock).toContain('closeLinuxDoPanel();');
  });

  it('does not loop back into linux.do verification when the verified retry is still blocked', () => {
    const openTopicBlock = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const cloudflareBlock = openTopicBlock.match(/if \(isLinuxDoCloudflareError\(error\)\) \{([\s\S]*?)\n        \}/)?.[1] || '';
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(appSource).toContain('const handleLinuxDoCloudflareForTopic = useCallback');
    expect(openTopicBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current && linuxDoVerifiedRetryTopicKeyRef.current !== topicKey(topic)');
    expect(openTopicBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current = null;');
    expect(changeScreenBlock).toContain("if (nextScreen !== 'topic')");
    expect(changeScreenBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current = null;');
    expect(cloudflareBlock).toContain('await handleLinuxDoCloudflareForTopic(topic, message);');
    expect(cloudflareBlock).toContain('return;');
  });

  it('lets Android user profiles load more topic pages', () => {
    expect(userScreenSource).toContain('loadingMoreTopics');
    expect(userScreenSource).toContain('加载更多帖子');
    expect(userScreenSource).toContain('autoLoadArmedRef');
    expect(userScreenSource).toContain('const armAutoLoad = useCallback');
    expect(userScreenSource).toContain('const handleEndReached = useCallback');
    expect(userScreenSource).toContain('const requestUserTopicLoadMore = useCallback');
    expect(userScreenSource).toContain('autoLoadArmedRef.current = false;');
    expect(userScreenSource).toMatch(/useEffect\(\(\) => \{\s*autoLoadArmedRef\.current = false;\s*\}, \[user\?\.id, user\?\.source, user\?\.username\]\);/);
    expect(userScreenSource).toContain('onEndReached={handleEndReached}');
    expect(userScreenSource).toContain('onPress={requestUserTopicLoadMore}');
    expect(userScreenSource).toContain('onEndReachedThreshold={0.5}');
    expect(userScreenSource).toContain('onScrollBeginDrag={armAutoLoad}');
    expect(userScreenSource).toContain('onMomentumScrollBegin={armAutoLoad}');
    expect(appSource).toContain('const loadMoreUserTopics = useCallback(async () => {');
    expect(appSource).toContain('cursor: current.nextTopicsCursor');
    expect(appSource).toContain('const mergedTopics = mergeTopics(previous.topics, nextProfile.topics);');
    expect(appSource).toContain('topics: mergedTopics');
    expect(appSource).toContain('hasMoreTopics: Boolean(nextProfile.hasMoreTopics && nextProfile.nextTopicsCursor && mergedTopics.length > previous.topics.length)');
    expect(appSource).toContain('nextTopicsCursor: mergedTopics.length > previous.topics.length ? nextProfile.nextTopicsCursor : null');
    expect(appSource).toContain('userLoadingMoreCursorRef');
    expect(appSource).toContain('userLoadingMoreCursorRef.current === current.nextTopicsCursor');
  });

  it('does not let the linux.do verification page stay loading forever', () => {
    expect(moreScreenSource).toContain('LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS');
    expect(moreScreenSource).toContain('linux.do 页面打开超时');
    expect(moreScreenSource).toContain('clearTimeout(timeout)');
  });

  it('ignores stale linux.do verification WebView events after closing or refreshing the panel', () => {
    const linuxDoPanelBlock = moreScreenSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';
    const linuxDoMessageBlock = appSource.match(/const handleLinuxDoMessage[\s\S]*?\n  }, \[[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('const linuxDoWebViewSessionRef = useRef(0);');
    expect(appSource).toContain('webViewKey !== linuxDoWebViewSessionRef.current');
    expect(linuxDoMessageBlock).toContain('webViewKey?: number');
    expect(linuxDoMessageBlock).toContain('showLinuxDoPanelRef.current');
    expect(linuxDoPanelBlock).toContain('onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);');
    expect(linuxDoPanelBlock).toContain("onSetLinuxDoWebViewError('', linuxDoWebViewKey);");
    expect(linuxDoPanelBlock).toContain('onHandleLinuxDoMessage(event, linuxDoWebViewKey)');
  });

  it('unmounts the linux.do verification WebView before hiding the modal', () => {
    const linuxDoPanelBlock = moreScreenSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';
    const closeLinuxDoBlock = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('const [mountLinuxDoWebView, setMountLinuxDoWebView] = useState(false);');
    expect(closeLinuxDoBlock.indexOf('setMountLinuxDoWebView(false);')).toBeGreaterThan(-1);
    expect(closeLinuxDoBlock.indexOf('setMountLinuxDoWebView(false);')).toBeLessThan(closeLinuxDoBlock.indexOf('setShowLinuxDoPanel(false);'));
    expect(linuxDoPanelBlock).toContain('mountLinuxDoWebView');
    expect(linuxDoPanelBlock).toContain('showLinuxDoPanel && mountLinuxDoWebView');
  });

  it('does not let a new linux.do verification request cancel an in-flight close', () => {
    const changeLinuxDoBlock = appSource.match(/const changeLinuxDoPanel = useCallback\(\(visible: boolean\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const showLinuxDoBlock = appSource.match(/const showLinuxDoVerification = useCallback\(\(message = 'linux\.do 需要完成 Cloudflare 验证'\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const closeLinuxDoBlock = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const afterCloseBlock = appSource.match(/useEffect\(\(\) => \{\s*if \(showLinuxDoPanel \|\| linuxDoPanelClosingSessionRef\.current === null\) \{[\s\S]*?\n  \}, \[[^\]]*showLinuxDoPanel[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('const linuxDoPanelClosingSessionRef = useRef<number | null>(null);');
    expect(appSource).toContain('const linuxDoPanelCloseSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);');
    expect(closeLinuxDoBlock).toContain('linuxDoPanelClosingSessionRef.current = nextSession;');
    expect(afterCloseBlock).toContain('linuxDoPanelClosingSessionRef.current = null;');
    expect(afterCloseBlock.indexOf('setTimeout(() =>')).toBeGreaterThan(-1);
    expect(afterCloseBlock.indexOf('linuxDoPanelClosingSessionRef.current = null;')).toBeGreaterThan(afterCloseBlock.indexOf('setTimeout(() =>'));
    expect(showLinuxDoBlock).not.toContain('linuxDoPendingReopenTopicAfterCloseRef.current = null;');
    expect(changeLinuxDoBlock).toContain('linuxDoPanelClosingSessionRef.current !== null');
    expect(changeLinuxDoBlock.indexOf('linuxDoPanelClosingSessionRef.current !== null')).toBeLessThan(changeLinuxDoBlock.indexOf('resetLinuxDoWebView();'));
    expect(showLinuxDoBlock).toContain('linuxDoPanelClosingSessionRef.current !== null');
    expect(showLinuxDoBlock).not.toContain("setScreen('more');");
  });

  it('renders linux.do verification as a global modal instead of inside the More tab', () => {
    const linuxDoPanelBlock = moreScreenSource.match(/function LinuxDoVerifyPanel\([\s\S]*?\nconst MemoizedLinuxDoVerifyPanel/)?.[0] || '';
    const linuxDoModalBlock = moreScreenSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';
    const appReturnBlock = appSource.match(/return \(\s*<GestureHandlerRootView[\s\S]*?<NavigationContainer/)?.[0] || '';

    expect(linuxDoPanelBlock).toContain('MenuButton');
    expect(linuxDoPanelBlock).not.toContain('LoginWebViewModal');
    expect(linuxDoModalBlock).toContain('LoginWebViewModal');
    expect(linuxDoModalBlock).toContain('showLinuxDoPanel && mountLinuxDoWebView');
    expect(appReturnBlock).toContain('<MemoizedLinuxDoVerifyModal');
  });

  it('keeps linux.do verified retry failures from remounting the verification WebView', () => {
    const retryBlock = appSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const verifiedRetryBlock = retryBlock.match(/if \(linuxDoVerifiedRetryTopicKeyRef\.current === requestTopicKey\) \{([\s\S]*?)\n    \}/)?.[1] || '';

    expect(retryBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current === requestTopicKey');
    expect(verifiedRetryBlock).toContain('setMountLinuxDoWebView(false);');
    expect(verifiedRetryBlock).toContain('setLoadingLinuxDoPage(false);');
    expect(verifiedRetryBlock).not.toContain('showLinuxDoVerification(message);');
  });

  it('keeps linux.do verified retry failures in reply refreshes from reopening verification', () => {
    const refreshRepliesBlock = appSource.match(/const refreshTopicReplies = useCallback\(async[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const loadMoreRepliesBlock = appSource.match(/const loadMoreReplies = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(refreshRepliesBlock).toContain('await handleLinuxDoCloudflareForTopic(detail, errorMessage(error))');
    expect(loadMoreRepliesBlock).toContain('await handleLinuxDoCloudflareForTopic(detail, errorMessage(error))');
    expect(refreshRepliesBlock).not.toContain('showLinuxDoVerification(errorMessage(error))');
    expect(loadMoreRepliesBlock).not.toContain('showLinuxDoVerification(errorMessage(error))');
  });

  it('cancels in-flight linux.do verification checks when the panel closes or reloads', () => {
    const resetLinuxDoBlock = appSource.match(/const resetLinuxDoWebView = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const closeLinuxDoBlock = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const checkLinuxDoBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const appStateBlock = appSource.match(/AppState\.addEventListener\('change', \(next\) => \{[\s\S]*?\n    \}\);/)?.[0] || '';

    expect(resetLinuxDoBlock).toContain('checkingRequestIdRef.current += 1;');
    expect(resetLinuxDoBlock).toContain('const nextSession = nextLinuxDoWebViewSession();');
    expect(closeLinuxDoBlock).toContain('checkingRequestIdRef.current += 1;');
    expect(closeLinuxDoBlock).toContain('setChecking(false);');
    expect(closeLinuxDoBlock).toContain('nextLinuxDoWebViewSession();');
    expect(checkLinuxDoBlock).toContain('const linuxDoWebViewSession = linuxDoWebViewSessionRef.current;');
    expect(checkLinuxDoBlock).toContain('linuxDoWebViewSession !== linuxDoWebViewSessionRef.current');
    expect(checkLinuxDoBlock).toContain('!showLinuxDoPanelRef.current');
    expect(appStateBlock).toContain('checkingRequestIdRef.current += 1;');
    expect(appStateBlock).toContain('linuxDoWebViewSessionRef.current += 1;');
  });

  it('does not reopen the linux.do verification loading state after the page is visible', () => {
    const linuxDoPanelBlock = moreScreenSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';

    expect(linuxDoPanelBlock).toContain('linuxDoWebViewReadyRef');
    expect(linuxDoPanelBlock).toContain('markLinuxDoPageReady');
    expect(linuxDoPanelBlock).toContain('onLoadProgress');
    expect(linuxDoPanelBlock).toContain('event.nativeEvent.progress >= 0.8');
    expect(linuxDoPanelBlock).toContain('if (!linuxDoWebViewReadyRef.current) {');
    expect(linuxDoPanelBlock).toContain('onSetLoadingLinuxDoPage(true, linuxDoWebViewKey);');
  });

  it('keeps login modal controls usable while a WebView loading badge is visible', () => {
    expect(moreScreenSource).toContain('<View pointerEvents="none" style={styles.loading}>');
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

    expect(linuxDoMessageBlock).toContain("setLinuxDoWebViewErrorForSession('', webViewKey);");
  });

  it('clears stale linux.do verification errors after a successful page load', () => {
    const block = moreScreenSource.match(/onLoadEnd=\{\(event\) => \{[\s\S]*?linuxDoWebViewRef\.current\?\.injectJavaScript\(LINUXDO_WEBVIEW_PROBE_SCRIPT\);[\s\S]*?\}\}/)?.[0] || '';

    expect(block).toContain('markLinuxDoPageReady();');
    expect(block).toContain("if (!('code' in event.nativeEvent)) {");
    expect(block).toContain("onSetLinuxDoWebViewError('', linuxDoWebViewKey);");
  });

  it('keeps linux.do verification WebView failures contained', () => {
    expect(moreScreenSource).toContain('linuxDoWebViewKey');
    expect(moreScreenSource).toContain('onResetLinuxDoWebView');
    expect(moreScreenSource).toContain('key={linuxDoWebViewKey}');
    expect(moreScreenSource).toContain('renderError={() => <View style={styles.webViewErrorPlaceholder} />}');
    expect(moreScreenSource).toContain('onRenderProcessGone={() =>');
    expect(moreScreenSource).toContain('linux.do 验证页面已停止');
  });

  it('keeps the linux.do verification WebView off the emulator GPU path', () => {
    const linuxDoPanelBlock = moreScreenSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';

    expect(linuxDoPanelBlock).toContain('androidLayerType="software"');
  });

  it('stops the linux.do verification WebView before hiding it', () => {
    expect(appSource).toContain('closeLinuxDoPanel');
    expect(appSource).toContain('linuxDoWebViewRef.current?.stopLoading()');
    expect(appSource).toContain('onShowLinuxDoPanelChange={changeLinuxDoPanel}');
    expect(moreScreenSource).toContain('onShowLinuxDoPanelChange={onShowLinuxDoPanelChange}');
  });

  it('clears stale linux.do login cookies after expired write actions while preserving verification', () => {
    const runLinuxDoBlock = appSource.match(/const runLinuxDoRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(runLinuxDoBlock).toContain('const remainingAccess = await clearLinuxDoAccess();');
    expect(runLinuxDoBlock).toContain('setHasLinuxDoClearance(Boolean(remainingAccess?.cookieHeader));');
    expect(runLinuxDoBlock).toContain("summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(remainingAccess?.cookieHeader || '')).names");
  });

  it('resets linux.do verified state when status detection finds no cookie', () => {
    const checkLinuxDoCookieBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const noCookieBlock = checkLinuxDoCookieBlock.match(/if \(!canStoreLinuxDoAccess\(cookies\) \|\| !cookieHeader \|\| !canAcceptLinuxDoAccessUpdate\(cookies, linuxDoClearanceBeforeVerifyRef\.current, linuxDoRequireFreshClearanceRef\.current\)\) \{([\s\S]*?)\n      \}/)?.[1] || '';

    expect(noCookieBlock).toContain('setHasLinuxDoClearance(false);');
    expect(noCookieBlock).toContain('setHasLinuxDoLogin(summary.loggedIn);');
  });

  it('cancels the pending linux.do topic return when verification detection fails', () => {
    const checkLinuxDoCookieBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const noCookieBlock = checkLinuxDoCookieBlock.match(/if \(!canStoreLinuxDoAccess\(cookies\) \|\| !cookieHeader \|\| !canAcceptLinuxDoAccessUpdate\(cookies, linuxDoClearanceBeforeVerifyRef\.current, linuxDoRequireFreshClearanceRef\.current\)\) \{([\s\S]*?)\n      \}/)?.[1] || '';
    const catchBlock = checkLinuxDoCookieBlock.match(/catch \(error\) \{([\s\S]*?)\n    \} finally/)?.[1] || '';
    const closeLinuxDoBlock = appSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

    expect(noCookieBlock).not.toContain('pendingLinuxDoTopicRef.current = null;');
    expect(noCookieBlock).not.toContain('linuxDoDismissedVerificationTopicKeyRef.current = topicKey(pendingTopic);');
    expect(catchBlock).not.toContain('pendingLinuxDoTopicRef.current = null;');
    expect(catchBlock).not.toContain('linuxDoPendingReopenTopicAfterCloseRef.current = null;');
    expect(closeLinuxDoBlock).toContain('linuxDoDismissedVerificationTopicKeyRef.current = topicKey(pendingTopic);');
  });

  it('requires a new linux.do cf_clearance before verification succeeds', () => {
    const checkLinuxDoCookieBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('const linuxDoClearanceBeforeVerifyRef = useRef<string | null>(null);');
    expect(appSource).toContain('const linuxDoRequireFreshClearanceRef = useRef(false);');
    expect(checkLinuxDoCookieBlock).toContain('canAcceptLinuxDoAccessUpdate(cookies, linuxDoClearanceBeforeVerifyRef.current, linuxDoRequireFreshClearanceRef.current)');
    expect(checkLinuxDoCookieBlock).toContain('没有检测到新的 linux.do 验证信息。请完成验证后再试。');
  });

  it('records saved linux.do clearance as the old value on startup', () => {
    const startupBlock = appSource.match(/const linuxDoSummary = linuxDoAccessSummary\(linuxDoAccess\);[\s\S]*?if \(linuxDoAccess\?\.userAgent\)/)?.[0] || '';

    expect(startupBlock).toContain("parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '')");
    expect(startupBlock).toContain('linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(linuxDoCookies) || null;');
  });

  it('requires fresh linux.do clearance only for forced verification flows', () => {
    const changeLinuxDoBlock = appSource.match(/const changeLinuxDoPanel = useCallback\(\(visible: boolean\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const cloudflareHandlerBlock = appSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const verifyFromTopicBlock = appSource.match(/const verifyLinuxDoFromTopic = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const checkLinuxDoCookieBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(changeLinuxDoBlock).toContain('linuxDoRequireFreshClearanceRef.current = false;');
    expect(cloudflareHandlerBlock).toContain('linuxDoRequireFreshClearanceRef.current = true;');
    expect(verifyFromTopicBlock).toContain('linuxDoRequireFreshClearanceRef.current = true;');
    expect(checkLinuxDoCookieBlock).toContain('linuxDoRequireFreshClearanceRef.current = false;');
  });

  it('requires linux.do cf_clearance before saving verification state', () => {
    const checkLinuxDoCookieBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('canStoreLinuxDoAccess');
    expect(checkLinuxDoCookieBlock).toContain('!canStoreLinuxDoAccess(cookies)');
    expect(checkLinuxDoCookieBlock).toContain('没有检测到新的 linux.do 验证信息。请完成验证后再试。');
    expect(checkLinuxDoCookieBlock).not.toContain('if (!cookieHeader) {');
  });

  it('clears saved linux.do access before topic-triggered verification', () => {
    const cloudflareHandlerBlock = appSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const verifyFromTopicBlock = appSource.match(/const verifyLinuxDoFromTopic = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('clearLinuxDoSavedClearance');
    expect(appSource).toContain('const refreshLinuxDoClearanceState = useCallback');
    expect(cloudflareHandlerBlock).toContain('await refreshLinuxDoClearanceState();');
    expect(verifyFromTopicBlock).toContain('await refreshLinuxDoClearanceState();');
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

  it('merges saved linux.do login cookies when detecting refreshed clearance', () => {
    const readCurrentLinuxDoCookiesBlock = appSource.match(/const readCurrentLinuxDoCookies = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(readCurrentLinuxDoCookiesBlock).toContain('loadLinuxDoAccess()');
    expect(readCurrentLinuxDoCookiesBlock).toContain("parseLinuxDoDocumentCookie(savedAccess?.cookieHeader || '')");
    expect(readCurrentLinuxDoCookiesBlock).toContain('mergeLinuxDoCookies(');
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
    const waitBlock = appSource.match(/const waitForLinuxDoClearance = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS');
    expect(appSource).toContain('LINUXDO_CLEARANCE_DETECT_INTERVAL_MS');
    expect(appSource).toContain('const waitForLinuxDoClearance');
    expect(appSource).toContain('while (Date.now() < deadline)');
    expect(appSource).toContain('await new Promise((resolve) => setTimeout(resolve, LINUXDO_CLEARANCE_DETECT_INTERVAL_MS));');
    expect(waitBlock).toContain('canStoreLinuxDoClearance(cookies)');
    expect(waitBlock).not.toContain('canStoreLinuxDoLogin(cookies)');
  });

  it('returns quickly from the hidden linux.do WebView when manual verification is visible', () => {
    const scriptBlock = appSource.match(/const LINUXDO_BROWSER_FETCH_SCRIPT = `[\s\S]*?`;/)?.[0] || '';

    expect(scriptBlock).toContain('isInteractiveChallengePage');
    expect(scriptBlock).toContain('if (isInteractiveChallengePage() || (!isChallengePage() && jsonText()) || Date.now() >= deadline)');
    expect(scriptBlock).toContain('const challenge = isChallengePage() || isInteractiveChallengePage();');
  });

  it('clears stale linux.do WebView clearance before topic-triggered verification', () => {
    const clearSavedBlock = appSource.match(/const refreshLinuxDoClearanceState = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/)?.[0] || '';

    expect(appSource).toContain('clearLinuxDoWebViewClearance');
    expect(clearSavedBlock).toContain('await clearLinuxDoSavedClearance();');
    expect(clearSavedBlock).toContain('await clearLinuxDoWebViewClearance();');
  });

  it('keeps the native linux.do cookie reader in a tracked Expo plugin', () => {
    expect(appConfigSource).toContain('./plugins/withLinuxDoCookieModule');
    expect(linuxDoCookiePluginSource).toContain('LinuxDoCookieModule.kt');
    expect(linuxDoCookiePluginSource).toContain('android.webkit.CookieManager');
    expect(linuxDoCookiePluginSource).toContain('CookieManager.getInstance()');
    expect(linuxDoCookiePluginSource).toContain('cookieManager.getCookie(url)');
    expect(linuxDoCookiePluginSource).toContain('fun clearLinuxDoClearanceCookies(promise: Promise)');
    expect(linuxDoCookiePluginSource).toContain('database.delete(');
    expect(linuxDoCookiePluginSource).toContain('arrayOf("cf_clearance")');
  });

  it('merges native linux.do cookies from CookieManager and WebView database', () => {
    const readHeaderBlock = linuxDoCookiePluginSource.match(/private fun readLinuxDoCookieHeader\(\): String\? \{([\s\S]*?)\n  \}/)?.[1] || '';

    expect(linuxDoCookiePluginSource).toContain('private fun mergeCookieHeaders');
    expect(readHeaderBlock).toContain('val cookieHeaders = mutableListOf<String>()');
    expect(readHeaderBlock).toContain('mergeCookieHeaders(cookieHeaders)');
    expect(readHeaderBlock).not.toContain('return cookieManagerValue');
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
