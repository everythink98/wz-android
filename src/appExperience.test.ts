import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource, readLibraryRuntimeSource, readMoreRuntimeSource, readOptionalProjectFile, readProjectFile, readThemeRuntimeSource, readTopicRuntimeSource } from './sourceTestUtils';

const appConfigSource = readProjectFile('app.json');
const appSource = readAppRuntimeSource();
const globalModalHostSource = readProjectFile('src', 'app', 'GlobalModalHost.tsx');
const linuxDoVerifyModalSource = readProjectFile('src', 'app', 'LinuxDoVerifyModal.tsx');
const hiddenBrowserHostSource = readProjectFile('src', 'app', 'HiddenBrowserHost.tsx');
const hiddenBrowserFetchControllerSource = readProjectFile('src', 'app', 'useHiddenBrowserFetchController.ts');
const htmlRenderingControllerSource = readProjectFile('src', 'app', 'useHtmlRenderingController.tsx');
const imagePreviewControllerSource = readProjectFile('src', 'app', 'useImagePreviewController.ts');
const backupStatusControllerSource = readProjectFile('src', 'app', 'useBackupStatusController.ts');
const feedControllerSource = readProjectFile('src', 'app', 'useFeedController.ts');
const readerDataControllerSource = readProjectFile('src', 'app', 'useReaderDataController.ts');
const searchControllerSource = readProjectFile('src', 'app', 'useSearchController.ts');
const sessionControllerSource = readProjectFile('src', 'app', 'useSessionController.ts');
const verificationControllerSource = readOptionalProjectFile('src', 'app', 'useVerificationController.ts');
const accountControllerSource = readOptionalProjectFile('src', 'app', 'useAccountController.ts');
const topicActionHelpersSource = readOptionalProjectFile('src', 'app', 'topicActionHelpers.ts');
const topicActionsControllerSource = readOptionalProjectFile('src', 'app', 'useTopicActionsController.ts');
const topicControllerSource = readProjectFile('src', 'app', 'useTopicController.ts');
const userControllerSource = readProjectFile('src', 'app', 'useUserController.ts');
const appControlsSource = readProjectFile('src', 'components', 'AppControls.tsx');
const topicCardSource = readProjectFile('src', 'components', 'TopicCard.tsx');
const imagePreviewModalSource = readProjectFile('src', 'components', 'ImagePreviewModal.tsx');
const loginWebViewModalSource = readProjectFile('src', 'components', 'LoginWebViewModal.tsx');
const feedScreenSource = readProjectFile('src', 'screens', 'FeedScreen.tsx');
const searchScreenSource = readProjectFile('src', 'screens', 'SearchScreen.tsx');
const searchListItemsSource = readProjectFile('src', 'searchListItems.ts');
const searchFiltersSource = readProjectFile('src', 'searchFilters.ts');
const libraryScreenSource = readProjectFile('src', 'screens', 'LibraryScreen.tsx');
const libraryItemsSource = readProjectFile('src', 'screens', 'library', 'libraryScreenItems.ts');
const libraryUiSource = readLibraryRuntimeSource();
const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const moreUiSource = readMoreRuntimeSource();
const topicScreenSource = readTopicRuntimeSource();
const topicMenuSource = readProjectFile('src', 'screens', 'topic', 'TopicMenu.tsx');
const userScreenSource = readProjectFile('src', 'screens', 'UserScreen.tsx');
const navBarSource = readProjectFile('src', 'components', 'NavBar.tsx');
const themeSource = readThemeRuntimeSource();
const androidUiSource = [
  appSource,
  appControlsSource,
  topicCardSource,
  imagePreviewModalSource,
  feedScreenSource,
  searchScreenSource,
  libraryUiSource,
  moreUiSource,
  topicScreenSource,
  navBarSource
].join('\n');
const gitIgnoreSource = readProjectFile('.gitignore');
const localLinuxDoSource = readProjectFile('src', 'localLinuxdo.ts');
const loginWebViewScriptsSource = readProjectFile('src', 'loginWebViewScripts.ts');
const linuxDoBridgeSource = readProjectFile('src', 'linuxdoCookieBridge.ts');
const nodeSeekBridgeSource = readProjectFile('src', 'nodeseekCookieBridge.ts');
const forumApiSource = readProjectFile('src', 'forumApi.ts');
const feedLogicSource = readProjectFile('src', 'feedLogic.ts');
const yaohuoApiSource = readProjectFile('src', 'yaohuoApi.ts');
const linuxDoCookiePluginSource = readOptionalProjectFile('plugins', 'withLinuxDoCookieModule.js');
const removedLocalServiceOption = ['server', 'Url'].join('');

describe('Android App experience guards', () => {
  it('keeps Android temporary dumps and cookie snapshots out of git', () => {
    expect(gitIgnoreSource).toContain('tmp-*');
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

    expect(forumApiSource).not.toMatch(
      new RegExp(`export (?:async )?function (?:getFeed|getCategories|getTopic|getReplies|getReply|searchTopics)[\\s\\S]*?${removedLocalServiceOption}\\?: string`)
    );
    expect(yaohuoApiSource).not.toMatch(new RegExp(`\\b${removedLocalServiceOption}\\?: string\\b`));
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
    expect(htmlRenderingControllerSource).toContain('imageSourceFromUrl(src, imageProps.source)');
    expect(imagePreviewControllerSource).toContain('imageRequestHeadersForUrl(uri)');
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
    expect(feedControllerSource).toContain('loadMoreFailureSignal');
    expect(feedControllerSource).toContain('markFeedLoadMoreFailed(requestSource);');
    expect(feedControllerSource).toContain('加载下一页失败');
    expect(feedScreenSource).toContain('loadMoreFailureSignal');
    expect(feedScreenSource).toContain('autoLoadPausedAfterFailureRef');
    expect(feedScreenSource).toContain('pausedAfterFailure: autoLoadPausedAfterFailureRef.current');
    expect(feedScreenSource).toContain('onScrollBeginDrag={handleScrollBeginDrag}');
  });

  it('draws consistent separators between Android feed rows at the list level', () => {
    expect(feedScreenSource).toContain('const renderTopicSeparator');
    expect(feedScreenSource).toContain('ItemSeparatorComponent={renderTopicSeparator}');
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
    expect(feedScreenSource).toContain('refreshControl={(');
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
    expect(feedControllerSource).toContain('shouldAllowFeedRemotePagination');
    expect(feedControllerSource).toContain('const feedAllowsRemotePagination = shouldAllowFeedRemotePagination(feedSource, readingFilter);');
    expect(appSource).toContain('feedHasMore: activeFeedState.hasMore && feedAllowsRemotePagination');
    expect(appSource).toContain('if (!feedAllowsRemotePagination) {');
  });

  it('shows loading instead of stale rows when resetting the feed list', () => {
    expect(feedControllerSource).toContain('clearItems = reset && !nocache');
    expect(feedControllerSource).toContain('if (!isLoadMore && reset && clearItems) {');
    expect(feedControllerSource).toContain('setFeedStates((current) => ({');
    expect(feedControllerSource).toContain('items: [],');
    expect(feedControllerSource).toContain('hasMore: false');
  });

  it('uses separate busy states for feed, search, topic, and status work', () => {
    expect(feedControllerSource).toContain('const [feedBusy, setFeedBusy] = useState(false);');
    expect(searchControllerSource).toContain('const [searchBusy, setSearchBusy] = useState(false);');
    expect(appSource).toContain('const [topicBusy, setTopicBusy] = useState(false);');
    expect(backupStatusControllerSource).toContain('const [statusBusy, setStatusBusy] = useState(false);');
    expect(appSource).not.toContain('const [busy, setBusy] = useState(false);');

    const loadFeedBlock = feedControllerSource.match(/const loadFeed = useCallback[\s\S]*?\n\n  const loadFeedRef/)?.[0] || '';
    const runSearchBlock = searchControllerSource.match(/const runSearch = useCallback[\s\S]*?\n\n  const loadMoreSearchSource/)?.[0] || '';
    const openTopicBlock = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';
    const loadMoreRepliesBlock = topicControllerSource.match(/const loadMoreReplies = useCallback[\s\S]*?\n\n  const refreshTopic/)?.[0] || '';
    const statusBlock = backupStatusControllerSource.match(/const checkLocalStatus = useCallback[\s\S]*?\n\n  const abortBackupStatusRequests/)?.[0] || '';

    expect(loadFeedBlock).toContain('setFeedBusy(true);');
    expect(loadFeedBlock).toContain('setFeedBusy(false);');
    expect(runSearchBlock).toContain('setSearchBusy(true);');
    expect(runSearchBlock).toContain('setSearchBusy(false);');
    expect(openTopicBlock).toContain('setTopicBusy(true);');
    expect(openTopicBlock).toContain('setTopicBusy(false);');
    expect(loadMoreRepliesBlock).not.toContain('setBusy(');
    expect(statusBlock).toContain('setStatusBusy(true);');
    expect(statusBlock).toContain('setStatusBusy(false);');
    expect(appSource).toContain('busy: feedBusy || actionBusy');
    expect(appSource).toContain('busy: searchBusy');
    expect(appSource).toContain('topicBusy,');
  });

  it('ignores stale Android status check results after a newer check starts', () => {
    const statusBlock = backupStatusControllerSource.match(/const checkLocalStatus = useCallback[\s\S]*?\n\n  const abortBackupStatusRequests/)?.[0] || '';
    const checksIndex = statusBlock.indexOf('const checks = await queryClient.fetchQuery');
    const staleGuardIndex = statusBlock.indexOf('if (!isCurrentStatusRequest() || controller.signal.aborted) {');
    const resultIndex = statusBlock.indexOf('const result = buildLocalStatusResult');
    const catchBlock = statusBlock.match(/} catch \(error\) \{([\s\S]*?)\n    } finally \{/)?.[1] || '';

    expect(backupStatusControllerSource).toContain('const statusRequestIdRef = useRef(0);');
    expect(backupStatusControllerSource).toContain('const statusBusyRef = useRef(false);');
    expect(statusBlock).toContain('if (statusBusyRef.current) {');
    expect(statusBlock).toContain('statusBusyRef.current = true;');
    expect(statusBlock).toContain('const requestId = ++statusRequestIdRef.current;');
    expect(statusBlock).toContain('const requestOwner = startOwnedRequest(statusRequestOwnerRef, \'status:local\');');
    expect(statusBlock).toContain('const isCurrentStatusRequest = () => isCurrentOwnedRequest(requestOwner, statusRequestOwnerRef) && requestId === statusRequestIdRef.current;');
    expect(staleGuardIndex).toBeGreaterThan(checksIndex);
    expect(staleGuardIndex).toBeLessThan(resultIndex);
    expect(catchBlock).toContain('isCurrentStatusRequest()');
    expect(catchBlock).toContain('!controller.signal.aborted');
    expect(statusBlock).toContain('statusBusyRef.current = false;');
  });

  it('ignores stale Android backup and restore operations after a newer backup action starts', () => {
    const importBlock = backupStatusControllerSource.match(/const importBackup = useCallback[\s\S]*?\n\n  const exportBackup/)?.[0] || '';
    const exportBlock = backupStatusControllerSource.match(/const exportBackup = useCallback[\s\S]*?\n\n  const shareTextFile/)?.[0] || '';
    const exportFileBlock = backupStatusControllerSource.match(/const exportBackupFile = useCallback[\s\S]*?\n\n  const importBackupFile/)?.[0] || '';
    const importFileBlock = backupStatusControllerSource.match(/const importBackupFile = useCallback[\s\S]*?\n\n  const checkLocalStatus/)?.[0] || '';

    expect(backupStatusControllerSource).toContain('const backupRequestIdRef = useRef(0);');
    expect(backupStatusControllerSource).toContain('const backupBusyRef = useRef(false);');
    expect(backupStatusControllerSource).toContain('const statusBusyRef = useRef(false);');
    for (const block of [importBlock, exportBlock, exportFileBlock, importFileBlock]) {
      expect(block).toContain('if (backupBusyRef.current) {');
      expect(block).toContain('backupBusyRef.current = true;');
      expect(block).toContain('const requestId = ++backupRequestIdRef.current;');
      expect(block).toContain('const requestOwner = startOwnedRequest(backupRequestOwnerRef');
      expect(block).toContain('const isCurrentBackupRequest = () => isCurrentOwnedRequest(requestOwner, backupRequestOwnerRef) && requestId === backupRequestIdRef.current;');
      expect(block).toContain('!isCurrentBackupRequest()');
    }
    for (const block of [importBlock, exportBlock, exportFileBlock, importFileBlock]) {
      expect(block).toContain('setBackupBusy(true);');
      expect(block).toContain('backupBusyRef.current = false;');
      expect(block).toContain('setBackupBusy(false);');
    }
  });

  it('ignores stale Android login checks after a newer login check starts', () => {
    const checkLoginBlock = accountControllerSource.match(/const checkLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const checkYaohuoBlock = accountControllerSource.match(/const checkYaohuoCookie = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const checkLinuxDoBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const saveNodeSeekBlock = sessionControllerSource.match(/const saveNodeSeekCookieHeader = useCallback[\s\S]*?\n\n  const loadNodeSeekCookieForSource/)?.[0] || '';
    const rememberNodeSeekBlock = accountControllerSource.match(/const rememberCurrentNodeSeekCookies = useCallback\(async[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

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
    const runNodeSeekBlock = topicActionsControllerSource.match(/const runNodeSeekRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const runYaohuoBlock = topicActionsControllerSource.match(/const runYaohuoRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const runLinuxDoBlock = topicActionsControllerSource.match(/const runLinuxDoRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('const actionRequestIdRef = useRef(0);');
    expect(topicActionsControllerSource).toContain("createRequestOwner('topic-action')");
    for (const block of [runNodeSeekBlock, runYaohuoBlock, runLinuxDoBlock]) {
      expect(block).toContain('const requestId = ++actionRequestIdRef.current;');
      expect(block).toContain('const requestOwner = options.owner || startTopicActionRequest(options.key || success);');
      expect(block).toContain('requestId !== actionRequestIdRef.current');
      expect(block).toContain('controller.signal.aborted');
      expect(block).toContain('!isCurrentTopicActionRequest(requestOwner)');
      expect(block).toContain('isCanceledRequest(error)');
    }
    expect(runNodeSeekBlock).toContain('userAgent: nodeSeekWebViewUserAgentRef.current');
  });

  it('clears search loading when search parameters cancel the active request', () => {
    const block = searchControllerSource.match(/const clearSearchResults = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/)?.[0] || '';

    expect(block).toContain('searchRequestIdRef.current += 1;');
    expect(block).toContain('searchAbortRef.current?.abort();');
    expect(block).toContain('setSearchItems([]);');
    expect(block).toContain('setSearchGroups([]);');
    expect(block).toContain('setSearchBusy(false);');
  });

  it('marks feed loading before reading cookies to avoid duplicate feed requests', () => {
    const block = feedControllerSource.match(/const loadFeed = useCallback[\s\S]*?\n\n  const loadFeedRef/)?.[0] || '';
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
    expect(feedControllerSource).toContain('source: feedSource, category: categoryFilter, nocache: true, clearItems: true');
  });

  it('keeps independent feed paging state for each source tab', () => {
    expect(feedControllerSource).toContain('type FeedSourceState = {');
    expect(feedControllerSource).toContain('const [feedStates, setFeedStates]');
    expect(feedControllerSource).toContain('const feedStatesRef = useRef(feedStates);');
    expect(feedControllerSource).toContain('if (feedStatesRef.current !== feedStates) {');
    expect(feedControllerSource).toContain('feedStatesRef.current = feedStates;');
    expect(feedControllerSource).toContain('[requestSource]: {');
    expect(feedControllerSource).toContain('const requestBaseState = feedStatesRef.current[requestSource];');
    expect(feedControllerSource).toContain('const nextPageState = nextFeedPageState(requestBaseState,');
    expect(feedControllerSource).toContain('...nextPageState');
  });

  it('clears stale per-source feed loading flags after a superseded request ends', () => {
    const loadFeedBlock = feedControllerSource.match(/const loadFeed = useCallback[\s\S]*?\n\n  const loadFeedRef/)?.[0] || '';

    expect(feedControllerSource).toContain('const feedSourceRequestIdRef = useRef<Partial<Record<FeedSource, number>>>({});');
    expect(loadFeedBlock).toContain('feedSourceRequestIdRef.current[requestSource] = requestId;');
    expect(loadFeedBlock).toContain('const isLatestForFeedSource = feedSourceRequestIdRef.current[requestSource] === requestId;');
    expect(loadFeedBlock).toContain('if (isLatestForFeedSource) {');
    expect(loadFeedBlock).toContain('loadingMore: false');
    expect(loadFeedBlock).toContain('refreshing: false');
  });

  it('cancels stale search requests when the draft query changes to a new term', () => {
    const block = searchControllerSource.match(/useEffect\(\(\) => \{\s*\n\s*const cleanQuery = searchQuery\.trim\(\);[\s\S]*?\n  \}, \[clearSearchResults, searchQuery\]\);/)?.[0] || '';

    expect(block).toContain('if (cleanQuery && cleanQuery === submittedSearchQueryRef.current) {');
    expect(block).toContain('clearSearchResults();');
    expect(block).toContain("submittedSearchQueryRef.current = '';");
    expect(block).toContain("setSubmittedSearchQuery('');");
    expect(block).not.toContain('setBusy(false);');
  });

  it('reruns Android search on source changes only for the submitted query', () => {
    const block = searchControllerSource.match(/useEffect\(\(\) => \{\s*\n\s*const cleanQuery = searchQueryRef\.current\.trim\(\);[\s\S]*?\n  \}, \[searchSource\]\);/)?.[0] || '';

    expect(searchControllerSource).toContain('const [submittedSearchQuery, setSubmittedSearchQuery] = useState');
    expect(searchControllerSource).toContain('const submittedSearchQueryRef = useRef');
    expect(searchControllerSource).toContain('runSearchRef.current = runSearch;');
    expect(block).toContain('if (!cleanQuery || cleanQuery !== submittedSearchQueryRef.current) {');
    expect(block).toContain('void runSearchRef.current?.();');
    expect(searchControllerSource).not.toContain('setSearchSort');
  });

  it('treats search filter confirmation as an explicit search action', () => {
    const block = searchControllerSource.match(/const applySearchFilter = useCallback\(\(source: Source, filter: SourceSearchFilter\) => \{[\s\S]*?\n  \}, \[searchSource\]\);/)?.[0] || '';

    expect(block).toContain('const cleanQuery = searchQueryRef.current.trim();');
    expect(block).toContain('if (searchSource === source && cleanQuery) {');
    expect(block).toContain('void runSearchRef.current?.();');
    expect(block).not.toContain('cleanQuery === submittedSearchQueryRef.current');
  });

  it('keeps recent search callbacks independent from recent search state changes', () => {
    const addBlock = searchControllerSource.match(/const addRecentSearch = useCallback\(\(query: string\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';
    const removeBlock = searchControllerSource.match(/const removeRecentSearch = useCallback\(\(query: string\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

    expect(addBlock).toContain('setRecentSearches((current) =>');
    expect(removeBlock).toContain('setRecentSearches((current) =>');
    expect(addBlock).not.toContain('AsyncStorage.setItem');
    expect(removeBlock).not.toContain('AsyncStorage.setItem');
    expect(searchControllerSource).toContain('recentSearchesLoaded');
    expect(searchControllerSource).toContain('AsyncStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(recentSearches))');
    expect(searchControllerSource).not.toContain('}, [recentSearches, writeRecentSearches]);');
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
    const block = feedControllerSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(!readerDataLoaded\) \{\s*\n\s*return;\s*\n\s*}\s*\n\s*void loadFeedRef\.current\(\{[\s\S]*?\n\s*}, \[categoryFilter, feedSource, readerDataLoaded\]\);/)?.[0] || '';

    expect(readerDataControllerSource).toContain('const [readerDataLoaded, setReaderDataLoaded] = useState(false);');
    expect(feedControllerSource).toContain('loadFeedRef.current = loadFeed;');
    expect(block).toContain('source: feedSource, category: categoryFilter, nocache: true, clearItems: true');
    expect(block).not.toContain('loadFeed]');
  });

  it('saves pending topic progress when the app leaves the foreground', () => {
    expect(appSource).toContain('AppState.addEventListener');
    expect(appSource).toContain("if (next !== 'active') {");
    expect(appSource).toContain('flushPendingProgress();');
    expect(readerDataControllerSource).toContain('PROGRESS_SAVE_MAX_PENDING_MS');
  });

  it('saves current topic scroll progress without re-rendering the visible detail page', () => {
    const block = readerDataControllerSource.match(/const flushPendingProgress = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[persistReaderData, screenRef\]\);/)?.[1] || '';

    expect(appSource).toContain("const screenRef = useRef<Screen>('feed');");
    expect(appSource).toContain('screenRef.current = screen;');
    expect(readerDataControllerSource).toContain('const readerDataStateRef = useRef<ReaderData>(readerData);');
    expect(readerDataControllerSource).toContain('if (readerDataStateRef.current !== readerData) {');
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
    const openTopicBlock = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';

    expect(appSource).toContain('topicScrollRestoreTimerRef');
    expect(openTopicBlock).toContain('clearTopicScrollRestoreTimer();');
    expect(openTopicBlock).toContain('const restoreTopicKey = topicKey(displayDetail);');
    expect(openTopicBlock).toContain('currentTopicKeyRef.current !== restoreTopicKey');
    expect(openTopicBlock).toContain("notify(`已恢复到上次阅读位置 ${progress.percent}%`);");
  });

  it('offers linux.do external search shortcuts on the Android search screen', () => {
    expect(searchScreenSource).toContain('linuxDoExternalSearchItems(searchTerm)');
    expect(searchScreenSource).toContain('hasSubmittedQuery && (searchSource === \'all\' || searchSource === \'linuxdo\')');
    expect(searchScreenSource).toContain('linux.do 老帖');
    expect(searchScreenSource).toContain('linuxDoExternalItems.map');
    expect(searchScreenSource).toContain('onOpenExternalUrl(item.url)');
  });

  it('keeps four-site topic links inside the Android topic detail flow', () => {
    const htmlLinkBlock = htmlRenderingControllerSource.match(/const htmlRenderersProps = useMemo<HtmlRenderersProps>\(\(\) => \(\{[\s\S]*?\n  \}\), \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderingControllerSource).toContain('parseForumTopicLink');
    expect(htmlLinkBlock).toContain('const appTopic = parseForumTopicLink(href, selectedTopic?.url || topicDetail?.url);');
    expect(htmlLinkBlock).toContain('onOpenTopic(appTopic);');
    expect(htmlLinkBlock).toContain('onOpenExternalUrl(href);');
  });

  it('replaces Android search result categories with per-site filters', () => {
    expect(searchScreenSource).toContain('function SearchFilterSheet({');
    expect(searchScreenSource).toContain('function SearchFilterEntry({');
    expect(searchScreenSource).toContain("searchSource !== 'all' ? (");
    expect(searchScreenSource).toContain('onSearchFilterApply');
    expect(searchScreenSource).toContain('searchFilterSummary(searchSource as Source');
    expect(searchScreenSource).toContain('horizontal={linuxDoCategoryItems.length > 8}');
    expect(searchScreenSource).toContain('horizontal={yaohuoCategoryItems.length > 8}');
    expect(searchScreenSource).not.toContain('searchCategoryOptions');
    expect(searchScreenSource).not.toContain('setSearchCategoryFilter');
    expect(searchScreenSource).not.toContain('filterSearchGroupsByCategory');
    expect(searchScreenSource).not.toContain('分类全部');
  });

  it('moves V2EX sorting into the site filter sheet instead of a second top rail', () => {
    const sheetBlock = searchScreenSource.match(/function SearchFilterSheet\([\s\S]*?\n}\n\nfunction SearchFilterEntry/)?.[0] || '';

    expect(sheetBlock).toContain("source === 'v2ex'");
    expect(sheetBlock).toContain("label: '相关'");
    expect(sheetBlock).toContain("label: '按时间'");
    expect(sheetBlock).toContain("label: '全部关键词'");
    expect(sheetBlock).toContain("label: '任一关键词'");
    expect(sheetBlock).toContain('更多筛选');
    expect(sheetBlock.indexOf('更多筛选')).toBeGreaterThan(sheetBlock.indexOf('label="节点"'));
    expect(sheetBlock.indexOf('label="作者"')).toBeGreaterThan(sheetBlock.indexOf('更多筛选'));
    expect(sheetBlock.indexOf('title="关键词关系"')).toBeGreaterThan(sheetBlock.indexOf('更多筛选'));
    expect(searchScreenSource).not.toContain('const showSearchSort');
    expect(searchScreenSource).not.toContain('{showSearchSort ? (');
    expect(searchControllerSource).toContain('function remoteSearchSort(searchSource: FeedSource, searchFilters: SearchFilterState)');
  });

  it('keeps site filter fields aligned with the real site pages', () => {
    const sheetBlock = searchScreenSource.match(/function SearchFilterSheet\([\s\S]*?\n}\n\nfunction SearchFilterEntry/)?.[0] || '';
    const nodeSeekBlock = sheetBlock.match(/\{draftFilter\.source === 'nodeseek' \? \([\s\S]*?\n            \) : null\}/)?.[0] || '';
    const yaohuoBlock = sheetBlock.match(/\{draftFilter\.source === 'yaohuo' \? \([\s\S]*?\n            \) : null\}/)?.[0] || '';
    const linuxDoBlock = sheetBlock.match(/\{draftFilter\.source === 'linuxdo' \? \([\s\S]*?\n            \) : null\}/)?.[0] || '';

    expect(nodeSeekBlock).toContain('title="排序"');
    expect(nodeSeekBlock).toContain('title="分类"');
    expect(nodeSeekBlock).toContain("label: '新评论'");
    expect(nodeSeekBlock).toContain("label: '新帖子'");
    expect(nodeSeekBlock).not.toContain('title="搜索范围"');
    expect(nodeSeekBlock).not.toContain("label: '全文'");
    expect(nodeSeekBlock).not.toContain("label: '标题'");
    expect(sheetBlock).toContain('KeyboardAvoidingView');
    expect(sheetBlock).toContain("behavior={Platform.OS === 'android' ? 'height' : 'padding'}");
    expect(yaohuoBlock).toContain('title="版块"');
    expect(yaohuoBlock).not.toContain('title="时间"');
    expect(yaohuoBlock).not.toContain('title="排序"');
    expect(linuxDoBlock).toContain('label="标签"');
    const nodeSeekFilterType = searchFiltersSource.match(/export type NodeSeekSearchFilter = \{[\s\S]*?\n\};/)?.[0] || '';
    expect(nodeSeekFilterType).toContain("source: 'nodeseek'");
    expect(nodeSeekFilterType).toContain('category: string');
    expect(nodeSeekFilterType).toContain('sort: NodeSeekSearchSort');
    expect(searchFiltersSource).toContain("tags: ''");
    expect(searchFiltersSource).toContain("parts.push(`tags:${tags}`);");
  });

  it('keeps Android search filters per site and applies them through the controller', () => {
    expect(searchControllerSource).toContain('const [searchFilters, setSearchFilters] = useState<SearchFilterState>');
    expect(searchControllerSource).toContain('const searchFiltersRef = useRef<SearchFilterState>');
    expect(searchControllerSource).toContain('const applySearchFilter = useCallback');
    expect(searchControllerSource).toContain('searchFiltersRef.current = nextFilters;');
    expect(searchControllerSource).toContain("const requestFilter = searchSource === 'all' ? undefined : activeFilter;");
    expect(searchControllerSource).toContain("category: activeFilter?.source === 'yaohuo' ? activeFilter.category : undefined");
    expect(appSource).toContain('categories,');
    expect(appSource).toContain('searchFilters,');
    expect(appSource).toContain('onSearchFilterApply: applySearchFilter');
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
    const recentSearchBlock = searchScreenSource.match(/\{showIdleRecentSearches \? \([\s\S]*?\n      \) : null\}/)?.[0] || '';

    expect(recentSearchBlock).toContain('styles.removableChipShell');
    expect(recentSearchBlock).toContain('styles.removableChipClose');
    expect(recentSearchBlock).toContain('accessibilityLabel={`删除最近搜索 ${item}`}');
    expect(recentSearchBlock).not.toContain('IconButton tiny ghost icon={X} label="删除最近搜索"');
  });

  it('keeps Android search actions inside the input field', () => {
    const searchInputBlock = searchScreenSource.match(/function SearchInputField\([\s\S]*?\n}\n\nfunction FilterChoiceGroup/)?.[0] || '';

    expect(searchScreenSource).toContain('function SearchInputField({');
    expect(searchInputBlock).toContain('returnKeyType="search"');
    expect(searchInputBlock).toContain('onSubmitEditing={onSearch}');
    expect(searchInputBlock).toContain('style={styles.searchInputIcon}');
    expect(searchInputBlock).toContain('accessibilityLabel="提交搜索"');
    expect(searchInputBlock).toContain('onPress={onSearch}');
    expect(searchInputBlock).toContain('accessibilityLabel="清空搜索关键词"');
    expect(searchScreenSource).not.toContain('<IconButton icon={X} label="清空"');
    expect(searchScreenSource).not.toContain('<IconButton icon={Search} label="搜索"');
    expect(searchScreenSource).not.toContain('clearButtonMode=');
  });

  it('keeps the Android search screen using the private search input field', () => {
    const headerBlock = searchScreenSource.match(/const header = \([\s\S]*?\n  \);/)?.[0] || '';

    expect(headerBlock).toContain('<SearchInputField');
    expect(headerBlock).toContain('query={query}');
    expect(headerBlock).toContain('onQueryChange={onQueryChange}');
    expect(headerBlock).toContain('onSearch={onSearch}');
  });

  it('updates search result highlighting when the query changes', () => {
    const block = searchScreenSource.match(/const renderTopicCard = useCallback\(\(item: Topic\) => \([\s\S]*?\n  \), \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(block).toContain('query');
  });

  it('does not expose local search mode on the Android search screen', () => {
    expect(searchScreenSource).not.toContain("export type SearchScope");
    expect(searchScreenSource).not.toContain("label: '全网'");
    expect(searchScreenSource).not.toContain("label: '本地'");
    expect(searchScreenSource).not.toContain('onScopeChange');
    expect(searchControllerSource).not.toContain('searchScope');
    expect(searchControllerSource).not.toContain('setSearchScope');
    expect(searchControllerSource).not.toContain('searchLocal');
    expect(appSource).not.toContain('setSearchScope');
  });

  it('does not pass press or submit events as search source overrides', () => {
    expect(appSource).toContain('onSearch: () => runSearch()');
    expect(appSource).not.toContain('onSearch: runSearch');
  });

  it('shows recent searches only before a query is entered', () => {
    const recentSearchBlock = searchScreenSource.match(/\{showIdleRecentSearches \? \([\s\S]*?\n      \) : null\}/)?.[0] || '';

    expect(searchScreenSource).toContain('const hasInputValue = query.length > 0;');
    expect(searchScreenSource).toContain('const hasSearchTerm = searchTerm.length > 0;');
    expect(searchScreenSource).toContain('const showIdleRecentSearches = !hasInputValue && recentSearches.length > 0;');
    expect(recentSearchBlock).toContain('<Text style={styles.meta}>最近搜索</Text>');
    expect(searchScreenSource).toContain('ListFooterComponent={null}');
  });

  it('keeps linux.do old-post shortcuts out of the unsubmitted draft state', () => {
    const linuxDoExternalBlock = searchScreenSource.match(/const linuxDoExternalItems = useMemo[\s\S]*?\n  \), \[[^\]]+\]\);/)?.[0] || '';

    expect(searchScreenSource).toContain('const hasSubmittedQuery = hasSearchTerm && submittedQuery === searchTerm;');
    expect(linuxDoExternalBlock).toContain('hasSubmittedQuery');
    expect(linuxDoExternalBlock).toContain('linuxDoExternalSearchItems(searchTerm)');
    expect(linuxDoExternalBlock).not.toContain('linuxDoExternalSearchItems(query)');
  });

  it('uses precise Android search empty states', () => {
    const listEmptyBlock = searchScreenSource.match(/ListEmptyComponent=\{[\s\S]*?\}\s*renderItem=\{renderSearchListItem\}/)?.[0] || '';

    expect(listEmptyBlock).toContain('showSearchGroups ? null');
    expect(listEmptyBlock).toContain("!hasInputValue ? (showIdleRecentSearches ? null : <EmptyText text=\"输入关键词后开始搜索\" styles={styles} />)");
    expect(listEmptyBlock).toContain("!hasSearchTerm ? <EmptyText text=\"输入关键词后开始搜索\" styles={styles} />");
    expect(listEmptyBlock).toContain("<EmptyText text=\"按键盘上的搜索键开始\" styles={styles} />");
    expect(listEmptyBlock).toContain("<EmptyText text=\"暂无搜索结果\" styles={styles} />");
    expect(listEmptyBlock).not.toContain("query.trim() ? '暂无搜索结果' : '输入关键词后开始搜索'");
  });

  it('adds a load-more action to remote search source groups', () => {
    expect(searchListItemsSource).toContain('hasMore?: boolean;');
    expect(searchListItemsSource).toContain('nextPage?: number | null;');
    expect(searchListItemsSource).toContain('loadingMore?: boolean;');
    expect(searchScreenSource).toContain('onLoadMoreSearchSource: (source: Source, page: number) => void;');
    expect(searchScreenSource).toContain("label={item.group.loadingMore ? '加载中...' : `加载更多 ${item.group.label}`}");
    expect(searchListItemsSource).toContain("type: 'groupLoadMore'");
    expect(searchControllerSource).toContain('const loadMoreSearchSource = useCallback');
    expect(appSource).toContain('onLoadMoreSearchSource: loadMoreSearchSource');
  });

  it('clears stale search load-more flags when retrying a source', () => {
    const runSearchBlock = searchControllerSource.match(/const runSearch = useCallback[\s\S]*?\n\n  const loadMoreSearchSource/)?.[0] || '';

    expect(runSearchBlock).toContain('const nextGroups = searchGroupsRef.current.map((group) => (');
    expect(runSearchBlock).toContain('group.source === sourceOverride ? { ...group, loading: true, loadingMore: false, error: undefined } : { ...group, loading: false, loadingMore: false }');
    expect(runSearchBlock).toContain('searchGroupsRef.current = nextGroups;');
  });

  it('disables per-source search retry while another remote search is still running', () => {
    expect(searchScreenSource).toContain('label={`重试 ${item.group.label}`}');
    expect(searchScreenSource).toContain('disabled={busy}');
  });

  it('updates all-source search groups as each source finishes', () => {
    const runSearchBlock = searchControllerSource.match(/const runSearch = useCallback[\s\S]*?\n\n  const loadMoreSearchSource/)?.[0] || '';

    expect(runSearchBlock).toContain('activeSources.map(async (source) => {');
    expect(runSearchBlock).toContain('const group = await runRemoteSearchSource(source, query, 1, controller.signal, activeSort, requestFilter, { isCurrent: () => isCurrentSearchRequest() });');
    expect(runSearchBlock).toContain('currentGroup.source === source ? { ...group, loading: false } : currentGroup');
    expect(runSearchBlock).toContain('setSearchItems(mergeSearchGroupsToItems(nextGroups, searchSource));');
    expect(runSearchBlock).not.toContain('const groups = await Promise.all(activeSources.map((source) => runRemoteSearchSource');
  });

  it('clears stale search load-more flags when another source starts loading more', () => {
    const loadMoreSearchBlock = searchControllerSource.match(/const loadMoreSearchSource = useCallback[\s\S]*?\n\n  useEffect\(\(\) => \{/)?.[0] || '';

    expect(loadMoreSearchBlock).toContain('group.source === source ? { ...group, loadingMore: true, error: undefined } : { ...group, loadingMore: false }');
  });

  it('keeps Android favorites as a simple list with confirmed unfavorite actions', () => {
    expect(appSource).not.toContain('libraryUndo');
    expect(libraryScreenSource).toContain('Alert.alert');
    expect(libraryScreenSource).toContain('确定取消收藏吗？');
    expect(libraryScreenSource).toContain('label="取消收藏"');
    expect(libraryScreenSource).toContain('<LibraryIconAction filled icon={Star} label="取消收藏"');
    expect(libraryScreenSource).toContain('renderTrailingAction={renderTopicTrailingAction}');
    expect(libraryScreenSource).toContain('event.stopPropagation?.();');
    expect(libraryScreenSource).toContain('triggerPressFeedback();');
    expect(libraryScreenSource).not.toContain('保存于');
    expect(libraryScreenSource).not.toContain('收藏于');
    expect(libraryScreenSource).not.toContain('浏览于');
    expect(libraryScreenSource).not.toContain('IconButton iconOnly ghost active');
    expect(libraryScreenSource).not.toContain('styles.libraryTopicRow');
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
    expect(topicActionsControllerSource).toContain('加鸡腿请求已提交');
    expect(topicActionsControllerSource).not.toContain('感谢请求已提交');
    expect(topicScreenSource).toContain('新增');
  });

  it('keeps the floor index aligned with the currently visible replies', () => {
    const floorIndexBlock = topicScreenSource.match(/\{floorOpen \? \([\s\S]*?\n\s*\) : null\}/)?.[0] || '';

    expect(floorIndexBlock).toContain('{replies.map((reply, index) => {');
    expect(floorIndexBlock).not.toContain('{sourceReplies.map((reply, index) => {');
  });

  it('adds image save, thumbnail selection, and backup file actions', () => {
    expect(imagePreviewControllerSource).toContain('savePreviewImage');
    expect(imagePreviewModalSource).toContain('imagePreviewThumbnail');
    expect(appSource).toContain('exportBackupFile');
    expect(appSource).toContain('importBackupFile');
  });

  it('removes temporary cache files after saving preview images to the gallery', () => {
    const block = imagePreviewControllerSource.match(/const savePreviewImage = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[imagePreview, notify\]\);/)?.[0] || '';

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
    const block = backupStatusControllerSource.match(/const shareTextFile = useCallback\(async[\s\S]*?\n  }, \[notify\]\);/)?.[0] || '';

    expect(block).toContain('const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;');
    expect(block).toContain('finally {');
    expect(block).toContain('await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);');
  });

  it('removes the picked backup cache copy after importing it', () => {
    const block = backupStatusControllerSource.match(/const importBackupFile = useCallback[\s\S]*?\n\n  const checkLocalStatus/)?.[0] || '';

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

  it('does not leave an empty actions row under library filters', () => {
    const headerBlock = libraryScreenSource.match(/const header = \([\s\S]*?\n  \);/)?.[0] || '';

    expect(headerBlock).toContain("libraryTab === 'history' && records.length ? (");
    expect(headerBlock).toContain('<View style={styles.actions}>');
    expect(headerBlock).toContain('label="清空历史" variant="danger"');
    expect(headerBlock).not.toMatch(/<View style=\{styles\.actions\}>\s*\{libraryTab === 'history' && records\.length \?/);
  });

  it('keeps the first library section title close to the filter tabs', () => {
    expect(libraryItemsSource).toContain('first: index === 0');
    expect(libraryScreenSource).toContain('item.first && styles.libraryFirstSectionTitle');
    expect(libraryScreenSource).toContain('contentContainerStyle={styles.libraryContentInner}');
    expect(themeSource).toContain('libraryContentInner');
    expect(themeSource).toContain('libraryFirstSectionTitle');
    expect(themeSource).toContain('borderBottomColor: theme.line');
  });

  it('marks library destructive actions clearly', () => {
    expect(appControlsSource).toContain("variant?: 'default' | 'danger' | 'ghost' | 'primary'");
    expect(libraryScreenSource).toContain('<LibraryIconAction filled icon={Star} label="取消收藏"');
    expect(libraryScreenSource).toContain('<LibraryIconAction icon={Trash2} label="删除"');
    expect(libraryScreenSource).toContain('<LibraryRowAction label="取消关注"');
    expect(themeSource).toContain('libraryInlineActionText');
    expect(themeSource).toContain('libraryIconAction');
    expect(libraryScreenSource).toContain('label="清空历史" variant="danger"');
    expect([moreUiSource, linuxDoVerifyModalSource].join('\n').match(/label="清除登录" variant="danger"/g)?.length).toBe(3);
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
    expect(comparator).toContain('previous.renderTrailingAction === next.renderTrailingAction');
  });

  it('updates all-source feed as each aggregated source finishes', () => {
    const loadFeedBlock = feedControllerSource.match(/const loadFeed = useCallback[\s\S]*?\n\n  const loadFeedRef/)?.[0] || '';

    expect(loadFeedBlock).toContain('const applyFeedResponse = (data: FeedResponse) => {');
    expect(loadFeedBlock).toContain('const basePromise = shouldFetchBaseFeed');
    expect(loadFeedBlock).toContain('const yaohuoPromise = getYaohuoFeedDirect');
    expect(loadFeedBlock).toContain('await Promise.allSettled([basePromise, yaohuoPromise]);');
    expect(loadFeedBlock).toContain('const requestBaseState = feedStatesRef.current[requestSource];');
    expect(loadFeedBlock).toContain('nextFeedPageState(requestBaseState, appliedFeedResponse as FeedResponse');
    expect(loadFeedBlock).not.toContain('data = mergeSettledFeedResponses(baseResult, yaohuoResult);');
  });

  it('resets feed scroll position when the source, category, or reading filter changes', () => {
    const block = feedScreenSource;

    expect(block).toContain('pendingScrollTopRef.current = true;');
    expect(block).toContain('scrollFeedToTop(false);');
    expect(block).toContain('completePendingFeedScrollReset');
    expect(block).not.toContain('AsyncStorage.getItem(scrollStorageKey)');
  });

  it('keeps source switching on the active feed list instead of cached pager routes', () => {
    expect(appSource).not.toContain('const feedItemsBySource = useMemo');
    expect(feedScreenSource).not.toContain('feedItemsBySource');
    expect(feedScreenSource).not.toContain('routeFeedItems');
    expect(feedScreenSource).not.toContain('routeSource');
    expect(feedScreenSource).not.toContain('renderFeedList');
    expect(feedScreenSource).toContain('data={feedItems}');
    expect(feedScreenSource).not.toContain('data={active ? feedItems : []}');
  });

  it('bypasses feed caches when loading additional feed pages', () => {
    const block = appSource.match(/onLoadMore: \(\) => \{([\s\S]*?)\n      \},/)?.[1] || '';

    expect(block).toContain('loadFeed({ page: activeFeedState.page + 1, cursor: feedSource === \'all\' ? activeFeedState.nextCursor : undefined, nocache: true });');
  });

  it('allows reset feed requests to replace stale loads when switching source tabs or categories', () => {
    expect(feedControllerSource).toContain('if (feedLoadingRef.current && !reset) {');
    expect(feedControllerSource).not.toContain('feedLoadingRef.current && (!reset || nocache)');
  });

  it('marks reply page loading before reading cookies to avoid duplicate load-more requests', () => {
    const block = topicControllerSource.match(/const loadMoreReplies = useCallback[\s\S]*?\n\n  const refreshTopic/)?.[0] || '';
    const guardIndex = block.indexOf('loadingMoreRepliesRef.current = true;');
    const cookieIndex = block.indexOf('await loadYaohuoCookieForSource(detail.source)');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(cookieIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(cookieIndex);
  });

  it('stops reply load-more when the next page adds no new replies', () => {
    const block = topicControllerSource.match(/const loadMoreReplies = useCallback[\s\S]*?\n\n  const refreshTopic/)?.[0] || '';
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
    const nodeSeekBlock = sessionControllerSource.match(/const clearNodeSeekLoginState = useCallback[\s\S]*?\n\n  const clearNodeSeekLoginCookiesOnly/)?.[0] || '';
    const yaohuoBlock = sessionControllerSource.match(/const clearYaohuoLoginState = useCallback[\s\S]*?\n\n  const clearNodeSeekLoginState/)?.[0] || '';

    expect(nodeSeekBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
    expect(yaohuoBlock).toContain('await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);');
  });

  it('does not clear yaohuo cookies for aggregated source errors', () => {
    const directStoredClears = sessionControllerSource.match(/await clearStoredYaohuoLoginState\(\);/g) || [];

    expect(directStoredClears).toHaveLength(1);
  });

  it('clears yaohuo cookies only for expired login errors, not access verification', () => {
    expect(accountControllerSource).toContain('isYaohuoLoginExpiredError(error)');
    expect(accountControllerSource).toContain('await clearYaohuoLoginState();');
    expect(topicActionsControllerSource).toContain("if ((error as { reason?: unknown }).reason === 'expired') {");
    expect(topicActionsControllerSource).toContain('showYaohuoLogin(errorMessage(error));');
  });

  it('clears expired yaohuo login state from aggregated feed errors', () => {
    const loadFeedBlock = feedControllerSource.match(/const loadFeed = useCallback[\s\S]*?\n\n  const loadFeedRef/)?.[0] || '';
    const aggregatedFeedBlock = loadFeedBlock.match(/if \(source === 'all' && yaohuoCookie\) \{[\s\S]*?\n      \} else if \(source === 'yaohuo'\)/)?.[0] || '';

    expect(aggregatedFeedBlock).toContain("yaohuoResult.status === 'rejected' && isYaohuoLoginRequiredError(yaohuoResult.reason)");
    expect(aggregatedFeedBlock).toContain('await clearYaohuoLoginState();');
  });

  it('clears expired yaohuo login state from remote search group errors', () => {
    const remoteSearchBlock = searchControllerSource.match(/const runRemoteSearchSource = useCallback[\s\S]*?\n\n  const runSearch/)?.[0] || '';
    const dependencyBlock = searchControllerSource.match(/const runRemoteSearchSource = useCallback[\s\S]*?\}, \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(remoteSearchBlock).toContain('await clearYaohuoLoginState();');
    expect(remoteSearchBlock).toContain("return { source, label: sourceLabel(source), items: [], error: '登录已失效'");
    expect(dependencyBlock).toContain('clearYaohuoLoginState');
  });

  it('uses the official linux.do search page size for remote search groups', () => {
    const remoteSearchBlock = searchControllerSource.match(/const runRemoteSearchSource = useCallback[\s\S]*?\n\n  const runSearch/)?.[0] || '';

    expect(remoteSearchBlock).toContain("const searchLimit = source === 'linuxdo' ? 50 : 30;");
    expect(remoteSearchBlock).toContain('limit: searchLimit');
  });

  it('clears expired yaohuo login state from user profile requests', () => {
    const openUserBlock = userControllerSource.match(/const openUser = useCallback[\s\S]*?\n\n  const loadMoreUserTopics/)?.[0] || '';
    const loadMoreUserBlock = userControllerSource.match(/const loadMoreUserTopics = useCallback[\s\S]*?\n\n  return \{/)?.[0] || '';
    const userControllerArgs = appSource.match(/useUserController\(\{([\s\S]*?)\n  \}\);/)?.[1] || '';

    expect(userControllerSource).toContain('clearYaohuoLoginState: () => Promise<void>;');
    expect(userControllerArgs).toContain('clearYaohuoLoginState');
    expect(openUserBlock).toContain('await clearYaohuoLoginState();');
    expect(openUserBlock).toContain("showYaohuoLogin('妖火登录已失效，请重新登录。');");
    expect(loadMoreUserBlock).toContain('await clearYaohuoLoginState();');
    expect(loadMoreUserBlock).toContain("showYaohuoLogin('妖火登录已失效，请重新登录。');");
  });

  it('rehydrates saved yaohuo cookies into WebView before opening the login page', () => {
    expect(appSource).toContain('restoreSavedYaohuoCookiesToWebView');
    expect(appSource).toContain('void restoreSavedYaohuoCookiesToWebView()');
    expect(appSource).toContain('setShowYaohuoLoginPanel(true);');
    expect(sessionControllerSource).toContain('buildYaohuoSetCookieHeaders(cookieHeader)');
    expect(sessionControllerSource).toContain('await CookieManager.setFromResponse(url, header)');
    expect(sessionControllerSource).not.toContain('setYaohuoLoginCookieHeader');
    expect(appSource).toContain('onShowYaohuoLoginPanelChange: changeYaohuoLoginPanel');
    expect(moreUiSource).not.toContain('yaohuoLoginCookieHeader');
    expect(moreUiSource).not.toContain('headers: yaohuoLoginCookieHeader ? { Cookie: yaohuoLoginCookieHeader } : undefined');
  });

  it('does not mark saved yaohuo session cookies as logged in while loading sources', () => {
    const loadCookieBlock = sessionControllerSource.match(/const loadYaohuoCookieForSource = useCallback[\s\S]*?\n\n  const saveNodeSeekCookieHeader/)?.[0] || '';

    expect(loadCookieBlock).toContain("summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookie || ''))");
    expect(loadCookieBlock).toContain("updateYaohuoSession(siteEventWithCookieFacts('yaohuo', summary.names, false, summary.loggedIn));");
    expect(loadCookieBlock).not.toContain('setHasYaohuoCookie(Boolean(cookie));');
  });

  it('opens the yaohuo signed-in page instead of the login form when cookies are saved', () => {
    expect(moreUiSource).toContain("const YAOHUO_SESSION_URL = YAOHUO_URL + '/wapindex.aspx?sid=-2';");
    expect(moreUiSource).toContain('uri: yaohuoSession.canWrite ? YAOHUO_SESSION_URL : YAOHUO_LOGIN_URL');
  });

  it('shows yaohuo login detail instead of hiding detected cookies behind a generic state', () => {
    const yaohuoLoginStateBlock = sessionControllerSource.match(/const yaohuoLoginState = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(yaohuoLoginStateBlock).toContain("return '未登录';");
    expect(yaohuoLoginStateBlock).toContain("return yaohuoSession.cookieSummary.length ? `已登录：${yaohuoSession.cookieSummary.join(', ')}` : '已登录';");
    expect(yaohuoLoginStateBlock).toContain("return `未登录，已检测 ${yaohuoSession.cookieSummary.length} 个 Cookie：${yaohuoSession.cookieSummary.join(', ')}`;");
    expect(moreUiSource).toContain('value={yaohuoLoginState}');
    expect(moreUiSource).toContain('subtitle={yaohuoLoginState}');
    expect(moreUiSource).not.toContain("yaohuoSession.canWrite ? yaohuoLoginState : '未登录'");
  });

  it('reads and clears yaohuo cookies across http, https, root, and www hosts', () => {
    const match = accountControllerSource.match(/const YAOHUO_COOKIE_URLS = \[([\s\S]*?)\];/);
    const cookieUrls = match?.[1] || '';

    expect(cookieUrls).toContain('YAOHUO_URL');
    expect(cookieUrls).toContain("'https://www.yaohuo.me'");
    expect(cookieUrls).toContain("'http://yaohuo.me'");
    expect(cookieUrls).toContain("'http://www.yaohuo.me'");
  });

  it('uses concise update wording for refresh and backup feedback', () => {
    expect(feedControllerSource).toContain("notify('正在更新列表')");
    expect(feedControllerSource).toContain("successMessage: '列表已更新'");
    expect(topicControllerSource).toContain("notify('主题已更新')");
    expect(backupStatusControllerSource).toContain("notify('备份已恢复，本机资料已合并')");
    expect(backupStatusControllerSource).toContain("notify('备份 JSON 已生成')");
    expect(backupStatusControllerSource).toContain("notify('状态已更新')");
    expect(appSource).not.toContain('正在刷新，请稍候');
    expect(appSource).not.toContain('正在刷新主题');
    expect(appSource).not.toContain('主题已读取');
    expect(appSource).not.toContain('同步读取成功');
    expect(appSource).not.toContain('同步保存成功');
    expect(appSource).not.toContain('状态检查完成');
  });

  it('keeps the scrolled feed helper as a higher back-to-top action only', () => {
    expect(feedScreenSource).toContain('FloatingIconButton');
    expect(feedScreenSource).toContain('shouldShowFeedFloatingActions');
    expect(feedScreenSource).toContain('label="回到顶部"');
    expect(feedScreenSource).not.toContain('label="刷新"');
    expect(feedScreenSource).not.toContain('RefreshCw');
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
    expect(topicControllerSource).toContain('isLinuxDoCloudflareError(error)');
    expect(topicScreenSource).toContain('label="去验证"');
  });

  it('keeps linux.do and NodeSeek verification flow inside the verification controller', () => {
    expect(appSource).toContain('useVerificationController');
    expect(verificationControllerSource).toContain('export function useVerificationController');
    expect(appSource).not.toContain('const showNodeSeekVerification = useCallback');
    expect(appSource).not.toContain('const showLinuxDoVerification = useCallback');
    expect(appSource).not.toContain('const handleLinuxDoMessage = useCallback');
    expect(appSource).not.toContain('const checkLinuxDoCookie = useCallback');
    expect(appSource).not.toContain('const handleLinuxDoCloudflareForTopic = useCallback');
    expect(appSource).not.toContain('const verifyLinuxDoFromTopic = useCallback');
    expect(verificationControllerSource).toContain('webViewKey !== linuxDoWebViewSessionRef.current');
    expect(verificationControllerSource).toContain('!showLinuxDoPanelRef.current');
    expect(verificationControllerSource).toContain('linuxDoPendingTopicVerifiedRef.current = Boolean(pendingLinuxDoTopicRef.current);');
    expect(verificationControllerSource).toContain('canAcceptLinuxDoAccessUpdate(cookies, linuxDoClearanceBeforeVerifyRef.current, linuxDoRequireFreshClearanceRef.current)');
  });

  it('sends linux.do level Cloudflare errors to the verification panel', () => {
    const refreshLevelBlock = accountControllerSource.match(/const refreshLinuxDoLevel = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(refreshLevelBlock).toContain('isLinuxDoCloudflareError(error)');
    expect(refreshLevelBlock).toContain("showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证')");
  });

  it('sends NodeSeek Cloudflare feed errors to the NodeSeek verification panel', () => {
    expect(appSource).toContain('showNodeSeekVerification');
    expect(feedControllerSource).toContain('isNodeSeekCloudflareError(error)');
    expect(feedControllerSource).toContain('loadNodeSeekCookieForSource');
    expect(feedControllerSource).toContain('nodeSeekCookie');
    expect(moreUiSource).toContain('label="NodeSeek 登录 / 验证"');
    expect(moreUiSource).toContain('userAgent={nodeSeekWebViewUserAgent}');
  });

  it('retries the pending NodeSeek search after verification cookies are saved', () => {
    const runSearchBlock = searchControllerSource.match(/const runSearch = useCallback[\s\S]*?\n\n  const loadMoreSearchSource/)?.[0] || '';
    const rememberAndRetryBlock = appSource.match(/const rememberVisibleNodeSeekCookiesAndRetrySearch = useCallback\(async[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const nodeSeekPanelToggleBlock = appSource.match(/const changeNodeSeekLoginPanel = useCallback\(\(visible: boolean\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const renderMoreBlock = appSource.match(/moreProps: \{[\s\S]*?\n    \},\n    moreScrollRef/)?.[0] || '';

    expect(appSource).toContain('const pendingNodeSeekSearchRetryRef = useRef<(() => void) | null>(null);');
    expect(searchControllerSource).toContain('onNodeSeekSearchVerificationRequired');
    expect(runSearchBlock).toContain("requireNodeSeekSearchVerification(nodeSeekError, () => { void runSearchRef.current?.('nodeseek'); });");
    expect(rememberAndRetryBlock).toContain('const retryPendingNodeSeekSearch = pendingNodeSeekSearchRetryRef.current;');
    expect(rememberAndRetryBlock).toContain('pendingNodeSeekSearchRetryRef.current = null;');
    expect(rememberAndRetryBlock).toContain('changeNodeSeekLoginPanel(false);');
    expect(rememberAndRetryBlock).toContain("changeScreen('search');");
    expect(rememberAndRetryBlock).toContain('retryPendingNodeSeekSearch();');
    expect(nodeSeekPanelToggleBlock).toContain('if (!visible) {');
    expect(nodeSeekPanelToggleBlock).toContain('pendingNodeSeekSearchRetryRef.current = null;');
    expect(renderMoreBlock).toContain('onRememberNodeSeekCookies: rememberVisibleNodeSeekCookiesAndRetrySearch');
  });

  it('saves NodeSeek WebView verification cookies before returning to lists', () => {
    expect(accountControllerSource).toContain('readNodeSeekCookiesFromWebView');
    expect(accountControllerSource).toContain('rememberCurrentNodeSeekCookies');
    expect(appSource).toContain('rememberVisibleNodeSeekCookies');
    expect(appSource).toContain('onRememberNodeSeekCookies: rememberVisibleNodeSeekCookiesAndRetrySearch');
    expect(accountControllerSource).toContain('showLoginPanelRef.current && nodeSeekLoginPanelRequestRef.current === requestId');
    expect(appSource).toContain('nodeSeekWebViewCookieHeaderRef');
    expect(appSource).toContain('nodeSeekWebViewUserAgentRef');
    expect(accountControllerSource).toContain('sanitizeNodeSeekUserAgent(data.userAgent)');
    expect(accountControllerSource).toContain('parseNodeSeekDocumentCookie(nodeSeekDocumentCookieHeader)');
    expect(moreUiSource).toContain('void onRememberNodeSeekCookies({ silent: true });');
    expect(loginWebViewScriptsSource).toContain('type: "nodeseek-login"');
    expect(loginWebViewScriptsSource).not.toContain('nodeseek-login-probe');
  });

  it('preserves saved NodeSeek login cookies when WebView only reports verification cookies', () => {
    const block = sessionControllerSource.match(/const loadNodeSeekCookieForSource = useCallback[\s\S]*?\n\n  const startNextNodeSeekBrowserFetch/)?.[0] || '';

    expect(block).toContain('const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);');
    expect(block).toContain('mergeNodeSeekCookies(parseNodeSeekDocumentCookie(savedCookie || \'\'), cookies)');
    expect(block.indexOf('const savedCookie = await SecureStore.getItemAsync(COOKIE_STORAGE_KEY);')).toBeLessThan(block.indexOf('await saveNodeSeekCookieHeader'));
  });

  it('uses saved NodeSeek verification data for categories and status checks', () => {
    const categoriesBlock = feedControllerSource.match(/const loadCategories = useCallback[\s\S]*?\n\n  const markFeedLoadMoreFailed/)?.[0] || '';
    const statusBlock = backupStatusControllerSource.match(/const checkLocalStatus = useCallback[\s\S]*?\n\n  const abortBackupStatusRequests/)?.[0] || '';

    expect(categoriesBlock).toContain('loadNodeSeekCookieForSource');
    expect(categoriesBlock).toContain('nodeSeekCookie');
    expect(categoriesBlock).toContain('nodeSeekUserAgent: nodeSeekUserAgentRef.current');
    expect(statusBlock).toContain('loadNodeSeekCookieForSource');
    expect(statusBlock).toContain('nodeSeekCookie');
    expect(statusBlock).toContain('nodeSeekUserAgent: nodeSeekUserAgentRef.current');
  });

  it('ignores stale Android category results after a newer category request starts', () => {
    const categoriesBlock = feedControllerSource.match(/const loadCategories = useCallback[\s\S]*?\n\n  const markFeedLoadMoreFailed/)?.[0] || '';
    const dataIndex = categoriesBlock.indexOf('const data = await queryClient.fetchQuery');
    const staleGuardIndex = categoriesBlock.indexOf('if (requestId !== categoriesRequestIdRef.current || controller.signal.aborted) {');
    const setCategoriesIndex = categoriesBlock.indexOf('setCategories((current) =>');
    const catchBlock = categoriesBlock.match(/} catch \(error\) \{([\s\S]*?)\n    } finally \{/)?.[1] || '';

    expect(feedControllerSource).toContain('const categoriesRequestIdRef = useRef(0);');
    expect(categoriesBlock).toContain('const requestId = ++categoriesRequestIdRef.current;');
    expect(staleGuardIndex).toBeGreaterThan(dataIndex);
    expect(staleGuardIndex).toBeLessThan(setCategoriesIndex);
    expect(catchBlock).toContain('requestId === categoriesRequestIdRef.current');
    expect(catchBlock).toContain('!controller.signal.aborted');
  });

  it('reloads a single source category list only when that source is missing categories', () => {
    const block = feedControllerSource.match(/useEffect\(\(\) => \{\s*\n\s*if \(shouldLoadCategoriesForSource\(categories, feedSource\)\) \{[\s\S]*?\n\s*}, \[categories, feedSource, loadCategories\]\);/)?.[0] || '';

    expect(feedControllerSource).toContain('shouldLoadCategoriesForSource');
    expect(block).toContain('void loadCategories(feedSource);');
  });

  it('checks whether saved yaohuo cookies are still usable in local status', () => {
    const statusBlock = backupStatusControllerSource.match(/const checkLocalStatus = useCallback[\s\S]*?\n\n  const abortBackupStatusRequests/)?.[0] || '';

    expect(statusBlock).toContain('checkYaohuoLoginDirect({');
    expect(statusBlock).toContain('yaohuoCookie');
    expect(statusBlock).not.toContain('yaohuo: Boolean(yaohuoCookie)');
  });

  it('does not treat Cloudflare-only NodeSeek verification as logged-in actions', () => {
    expect(topicActionsControllerSource).toContain('const canUseNodeSeekActions = isSiteLoggedIn(siteSessionStates.nodeseek);');
    expect(appSource).toContain('canUseNodeSeekActions,');
    expect(moreUiSource).toContain('nodeSeekSession.canWrite ? <MenuButton icon={CheckCircle} label="NodeSeek 签到"');
    expect(sessionControllerSource).toContain('removeNodeSeekLoginCookies');
  });

  it('passes MoreScreen one canonical session view model instead of login booleans', () => {
    const moreScreenSignature = moreScreenSource.match(/function MoreScreen\(\{[\s\S]*?\}: \{([\s\S]*?)\}\) \{/)?.[1] || '';
    const renderMoreBlock = appSource.match(/moreProps: \{[\s\S]*?\n    \},\n    moreScrollRef/)?.[0] || '';

    expect(moreScreenSignature).toContain('sessionViewModels: SiteSessionViewModels;');
    expect(moreScreenSignature).not.toContain('hasNodeSeekLoginCookie: boolean;');
    expect(moreScreenSignature).not.toContain('hasYaohuoCookie: boolean;');
    expect(moreScreenSignature).not.toContain('hasLinuxDoClearance: boolean;');
    expect(moreScreenSignature).not.toContain('hasLinuxDoLogin: boolean;');
    expect(renderMoreBlock).toContain('sessionViewModels: siteSessionViewModels');
    expect(renderMoreBlock).not.toContain('hasNodeSeekLoginCookie');
    expect(renderMoreBlock).not.toContain('hasYaohuoCookie');
    expect(renderMoreBlock).not.toContain('hasLinuxDoClearance');
    expect(renderMoreBlock).not.toContain('hasLinuxDoLogin');
  });

  it('requires a real NodeSeek login cookie before enabling login-only actions', () => {
    const saveCookieBlock = sessionControllerSource.match(/const saveNodeSeekCookieHeader = useCallback[\s\S]*?\n\n  const loadNodeSeekCookieForSource/)?.[0] || '';
    const rememberBlock = accountControllerSource.match(/const rememberCurrentNodeSeekCookies = useCallback\(async[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const loginMessageBlock = accountControllerSource.match(/const handleLoginMessage = useCallback\(.*?=> \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';

    expect(saveCookieBlock).toContain("updateNodeSeekSession(siteEventWithCookieFacts('nodeseek', summary.names, true, summary.loggedIn));");
    expect(saveCookieBlock).not.toContain('setHasNodeSeekLoginCookie(summary.loggedIn || verifiedByPage);');
    expect(rememberBlock).toContain("notify(summary.loggedIn ? '已检测到 NodeSeek 登录 Cookie，已保存在本机。' : '已检测到 NodeSeek 验证信息，已保存在本机。');");
    expect(rememberBlock).not.toContain('summary.loggedIn || webLoginDetectedRef.current');
    expect(loginMessageBlock).not.toContain('setHasNodeSeekLoginCookie(true);');
  });

  it('keeps detail reading settings reachable from the topic menu', () => {
    expect(topicMenuSource).toContain('accessibilityLabel="阅读设置"');
    expect(topicMenuSource).toContain('onOpenReadingSettings');
    expect(appSource).toContain('openReadingSettingsFromTopic');
    expect(appSource).toContain('onOpenReadingSettings: openReadingSettingsFromTopic');
  });

  it('names the followed-user library tab explicitly', () => {
    expect(libraryScreenSource).toContain("{ value: 'users', label: '关注用户' }");
    expect(libraryScreenSource).not.toContain("{ value: 'users', label: '用户' }");
    expect(libraryScreenSource).toContain("libraryTab === 'users' ? <View style={styles.libraryUserListSpacer} /> : null");
    expect(themeSource).toContain('libraryUserListSpacer');
  });

  it('prevents expired NodeSeek WebView login cookies from being restored', () => {
    const clearLoginOnlyBlock = sessionControllerSource.match(/const clearNodeSeekLoginCookiesOnly = useCallback[\s\S]*?\n\n  return \{/)?.[0] || '';

    expect(clearLoginOnlyBlock).toContain('nodeSeekWebViewCookieHeaderRef.current = verificationHeader;');
    expect(clearLoginOnlyBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
  });

  it('uses a hidden WebView to read NodeSeek pages when normal fetch is blocked by Cloudflare', () => {
    expect(hiddenBrowserFetchControllerSource).toContain('NODESEEK_BROWSER_FETCH_SCRIPT');
    expect(sessionControllerSource).toContain('nodeSeekFetchWithWebView');
    expect(sessionControllerSource).toContain('createNodeSeekWebViewFallbackFetcher');
    expect(sessionControllerSource).toContain('const nodeSeekFetchWithWebViewFallback = useMemo(() => createNodeSeekWebViewFallbackFetcher({');
    expect(sessionControllerSource).toContain('defaultFetcher: fetch');
    expect(sessionControllerSource).toContain('webViewFetcher: nodeSeekFetchWithWebView');
    expect(sessionControllerSource).toContain('defaultFetcher: nodeSeekFetchWithWebViewFallback');
    expect(hiddenBrowserFetchControllerSource).toContain("type: 'nodeseek-browser-fetch'");
    expect(appSource).toContain('fetcher: forumFetchWithWebViewFallback');
    expect(appSource).toContain('<HiddenBrowserHost');
    expect(hiddenBrowserHostSource).toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
  });

  it('does not leave hidden NodeSeek browser fetch requests pending after WebView failures', () => {
    expect(sessionControllerSource).toContain('const failNodeSeekBrowserFetchById = useCallback((requestId: number, message: string) => {');
    expect(hiddenBrowserHostSource).toContain('onHttpError={(event) => {');
    expect(hiddenBrowserHostSource).toContain('if (event.nativeEvent.url !== nodeSeekBrowserFetchRequest.url) {');
    expect(hiddenBrowserHostSource).toContain('if (event.nativeEvent.statusCode === 403) {');
    expect(appSource).toContain('nodeSeekBrowserFetchCurrentRef.current.httpErrorStatus = statusCode;');
    expect(hiddenBrowserHostSource).toContain('NodeSeek 页面返回错误');
    expect(hiddenBrowserHostSource).toContain('onRenderProcessGone={() => {');
    expect(hiddenBrowserHostSource).toContain('NodeSeek 页面读取进程已停止');
    expect(hiddenBrowserHostSource).toContain('renderError={() => <View style={styles.hiddenBrowserWebView} />}');
  });

  it('waits for rendered NodeSeek list or detail content before returning hidden WebView HTML', () => {
    expect(hiddenBrowserFetchControllerSource).toContain('const hasReadableContent = () => Boolean(document.querySelector(".post-list-item, .content-item .post-content, article.post-content, .post-detail .post-content, pre"))');
    expect(hiddenBrowserFetchControllerSource).toContain('document.body?.innerText');
    expect(hiddenBrowserFetchControllerSource).toContain('if ((!isChallengePage() && (hasReadableContent() || hasRestrictedNotice() || hasSearchPageContent()) && !hasPendingVotePanel()) || Date.now() >= deadline) {');
    expect(hiddenBrowserFetchControllerSource).toContain('const hasSearchPageContent = () => /\\\\/search\\\\/?$/i.test(location.pathname || "")');
  });

  it('returns hidden NodeSeek WebView HTML when a restricted notice is rendered without post content', () => {
    expect(hiddenBrowserFetchControllerSource).toContain('const hasRestrictedNotice = () => restrictedNoticePattern.test(pageText())');
    expect(hiddenBrowserFetchControllerSource).toContain('hasRestrictedNotice()');
    expect(hiddenBrowserFetchControllerSource).toContain('if ((!isChallengePage() && (hasReadableContent() || hasRestrictedNotice() || hasSearchPageContent()) && !hasPendingVotePanel()) || Date.now() >= deadline) {');
  });

  it('lets NodeSeek detail WebView fallback finish before the outer request timeout', () => {
    expect(topicControllerSource).toContain('const NODESEEK_DETAIL_TIMEOUT_MS = 30000;');
    expect(topicControllerSource).toContain("topic.source === 'nodeseek' ? NODESEEK_DETAIL_TIMEOUT_MS");
  });

  it('lets linux.do detail WebView fallback finish before the outer request timeout', () => {
    expect(topicControllerSource).toContain('const LINUXDO_DETAIL_TIMEOUT_MS = 30000;');
    expect(topicControllerSource).toContain("timeoutMs: topic.source === 'nodeseek' ? NODESEEK_DETAIL_TIMEOUT_MS : topic.source === 'linuxdo' ? LINUXDO_DETAIL_TIMEOUT_MS : undefined");
  });

  it('keeps the hidden NodeSeek browser fetch WebView out of the visible layout', () => {
    expect(appSource).toContain('<HiddenBrowserHost');
    expect(hiddenBrowserHostSource).toContain('<View pointerEvents="none" style={styles.hiddenBrowserWebViewHost}>');
    expect(hiddenBrowserHostSource).toContain('containerStyle={styles.hiddenBrowserWebView}');
    expect(hiddenBrowserHostSource).toContain('style={styles.hiddenBrowserWebView}');
    expect(hiddenBrowserHostSource).toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
    expect(hiddenBrowserHostSource).not.toContain('androidLayerType="software"');
  });

  it('does not mistake regular NodeSeek posts mentioning Cloudflare for verification pages', () => {
    expect(hiddenBrowserFetchControllerSource).toContain('const challengePattern = /just a moment|请稍候|正在进行安全验证|安全服务防护恶意自动程序|cf-turnstile|challenge-platform/i;');
    expect(hiddenBrowserFetchControllerSource).not.toContain('just a moment|cloudflare|cf-turnstile|challenge-platform');
  });

  it('waits for NodeSeek embedded vote panels before returning hidden WebView HTML', () => {
    expect(hiddenBrowserFetchControllerSource).toContain('const hasPendingVotePanel = () =>');
    expect(hiddenBrowserFetchControllerSource).toContain('.embed-vote .form-mask');
    expect(hiddenBrowserFetchControllerSource).toContain('input[name="vote-item"]');
    expect(hiddenBrowserFetchControllerSource).toContain('!hasPendingVotePanel()');
  });

  it('stops the hidden NodeSeek browser page after returning fallback HTML', () => {
    const script = hiddenBrowserFetchControllerSource.match(/const NODESEEK_BROWSER_FETCH_SCRIPT = `([\s\S]*?)`;/)?.[1] || '';
    const completeBlock = sessionControllerSource.match(/const completeNodeSeekBrowserFetch = useCallback\(async \(data: \{[\s\S]*?\n  \}, \[/)?.[0] || '';

    expect(script).toContain('window.stop();');
    expect(completeBlock).toContain('nodeSeekBrowserWebViewRef.current?.stopLoading();');
  });

  it('stops the linux.do verification spinner when the WebView cannot load', () => {
    expect(linuxDoVerifyModalSource).toContain('linuxDoWebViewError');
    expect(linuxDoVerifyModalSource).toContain('onSetLinuxDoWebViewError');
    expect(linuxDoVerifyModalSource).toContain('onError={(event) =>');
    expect(linuxDoVerifyModalSource).toContain('onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);');
    expect(linuxDoVerifyModalSource).toContain('linux.do 页面加载失败');
  });

  it('resets topic loading state when leaving the topic screen', () => {
    const block = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(block).toContain('setTopicBusy(false);');
    expect(block).toContain('setLoadingMoreReplies(false);');
  });

  it('opens user pages through the shared navigation cleanup path', () => {
    const block = userControllerSource.match(/const openUser = useCallback[\s\S]*?\n\n  const loadMoreUserTopics/)?.[0] || '';

    expect(block).toContain('onOpenUserScreen();');
    expect(block).not.toContain("setScreen('user');");
  });

  it('opens topic pages through the shared navigation cleanup path', () => {
    const block = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';

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
    const interactBlock = topicActionsControllerSource.match(/const interact = useCallback\(async \(type: InteractionType, commentId\?: number\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const bookmarkBlock = topicActionsControllerSource.match(/const bookmarkOnLinuxDoSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const nodeSeekCollectionBlock = topicActionsControllerSource.match(/const collectOnNodeSeekSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const voteBlock = topicActionsControllerSource.match(/const votePoll = useCallback\(async \(poll: TopicPoll, optionIds: string\[\]\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(topicActionsControllerSource).toContain('applyInteractionToTopic');
    expect(topicActionsControllerSource).toContain('applyInteractionToReplies');
    expect(topicActionsControllerSource).toContain('applyBookmarkToTopic');
    expect(topicActionsControllerSource).toContain('applyNodeSeekCollectionToTopic');
    expect(topicActionsControllerSource).toContain('applyPollVoteToTopic');
    expect(topicActionsControllerSource).toContain('beginOptimisticTopicAction');
    expect(topicActionsControllerSource).toContain('runOptimisticActionQueueHelper');
    expect(topicActionHelpersSource).toContain('beginOptimisticAction');
    expect(topicActionHelpersSource).toContain('completeOptimisticAction');
    expect(topicActionHelpersSource).toContain('try {\n      succeeded = await sendDesired(desiredActive);');
    expect(topicActionHelpersSource).toContain('applyDisplayed(completed.state.confirmed);');
    expect(topicActionHelpersSource).toContain('if (!isCurrentRequest(requestOwner)) {\n    return;\n  }\n  const transition = beginOptimisticAction');
    expect(topicActionsControllerSource).toMatch(/buildLinuxDoLikeRequest[\s\S]*?desiredActive/);
    expect(topicActionsControllerSource).toMatch(/buildNodeSeekInteractionRequest[\s\S]*?desiredActive/);
    expect(topicActionsControllerSource).toMatch(/buildLinuxDoBookmarkRequest[\s\S]*?desiredActive/);
    expect(topicActionsControllerSource).toMatch(/buildNodeSeekCollectionRequest[\s\S]*?desiredActive/);
    expect(topicActionsControllerSource).toMatch(/buildNodeSeekVoteRequest[\s\S]*?\{ refreshTopic: false, owner: requestOwner \}/);
    expect(topicActionsControllerSource).toMatch(/buildLinuxDoPollVoteRequest[\s\S]*?\{ refreshTopic: false, owner: requestOwner \}/);
    expect(topicActionsControllerSource).toMatch(/buildYaohuoVoteRequest[\s\S]*?\{ refreshTopic: false, owner: requestOwner \}/);
    expect(interactBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(interactBlock).toContain('startOptimisticTopicAction({');
    expect(interactBlock).toContain("mode: desiredActive ? 'add' as const : 'remove' as const");
    expect(interactBlock).toContain('const requestOwner = startTopicActionRequest(requestTopicKey);');
    expect(interactBlock).toContain('owner: requestOwner');
    expect(bookmarkBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(bookmarkBlock).toContain('startOptimisticTopicAction({');
    expect(bookmarkBlock).toContain('optimisticTopicActionsRef.current[actionKey]?.desired === true');
    expect(bookmarkBlock).toContain('bookmarkId = undefined;');
    expect(nodeSeekCollectionBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(nodeSeekCollectionBlock).toContain('startOptimisticTopicAction({');
    expect(voteBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(voteBlock).toContain('const requestOwner = startTopicActionRequest(requestTopicKey);');
    expect(voteBlock).toContain('if (!isCurrentTopicActionRequest(requestOwner)) {');
    expect(voteBlock).toContain('voteIds: optionIds');
    expect(voteBlock).not.toContain('voteId: optionIds[0]');
  });

  it('uses request ownership for stale Android write operations', () => {
    const writeActionBlock = topicActionsControllerSource.match(/const runNodeSeekRequest = useCallback[\s\S]*?\n  const toggleReplyComposer/)?.[0] || topicActionsControllerSource;

    expect(topicActionsControllerSource).toContain("createRequestOwner('topic-action')");
    expect(topicActionsControllerSource).toContain('startTopicActionRequest');
    expect(topicActionsControllerSource).toContain('isCurrentTopicActionRequest');
    expect(writeActionBlock).toContain('const requestOwner = options.owner || startTopicActionRequest(options.key || success);');
    expect(writeActionBlock).toContain('isCurrentTopicActionRequest(requestOwner)');
    expect(writeActionBlock).not.toContain('currentTopicKeyRef.current === requestTopicKey');
    expect(writeActionBlock).not.toContain('currentTopicKeyRef.current !== requestTopicKey');
  });

  it('updates visible reaction counts through optimistic desired states', () => {
    const interactBlock = topicActionsControllerSource.match(/const interact = useCallback\(async \(type: InteractionType, commentId\?: number\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const linuxDoBlock = interactBlock.match(/if \(isLinuxDoActionTopic\(detail\)\) \{([\s\S]*?)\n    if \(!isNodeSeekActionTopic\(detail\)\)/)?.[1] || '';
    const nodeSeekBlock = interactBlock;
    const linuxDoPatchIndex = linuxDoBlock.indexOf("mode: desiredActive ? 'add' as const : 'remove' as const");
    const linuxDoRequestIndex = linuxDoBlock.indexOf('buildLinuxDoLikeRequest');
    const nodeSeekPatchIndex = nodeSeekBlock.indexOf("mode: desiredActive ? 'add' as const : 'remove' as const");
    const nodeSeekRequestIndex = nodeSeekBlock.indexOf('buildNodeSeekInteractionRequest');

    expect(linuxDoPatchIndex).toBeGreaterThan(-1);
    expect(linuxDoRequestIndex).toBeGreaterThan(-1);
    expect(linuxDoPatchIndex).toBeLessThan(linuxDoRequestIndex);
    expect(nodeSeekPatchIndex).toBeGreaterThan(-1);
    expect(nodeSeekRequestIndex).toBeGreaterThan(-1);
    expect(nodeSeekPatchIndex).toBeLessThan(nodeSeekRequestIndex);
  });

  it('updates original-site collection buttons before waiting for the write request', () => {
    const nodeSeekCollectionBlock = topicActionsControllerSource.match(/const collectOnNodeSeekSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const linuxDoBookmarkBlock = topicActionsControllerSource.match(/const bookmarkOnLinuxDoSite = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';
    const nodeSeekPatchIndex = nodeSeekCollectionBlock.indexOf('applyDisplayed: (desiredActive) =>');
    const nodeSeekRequestIndex = nodeSeekCollectionBlock.indexOf('buildNodeSeekCollectionRequest');
    const linuxDoPatchIndex = linuxDoBookmarkBlock.indexOf('applyDisplayed: (desiredActive) =>');
    const linuxDoRequestIndex = linuxDoBookmarkBlock.indexOf('buildLinuxDoBookmarkRequest');

    expect(nodeSeekPatchIndex).toBeGreaterThan(-1);
    expect(nodeSeekRequestIndex).toBeGreaterThan(-1);
    expect(nodeSeekPatchIndex).toBeLessThan(nodeSeekRequestIndex);
    expect(linuxDoPatchIndex).toBeGreaterThan(-1);
    expect(linuxDoRequestIndex).toBeGreaterThan(-1);
    expect(linuxDoPatchIndex).toBeLessThan(linuxDoRequestIndex);
  });

  it('refreshes topic replies without resetting the topic body or reading state', () => {
    const refreshRepliesBlock = topicControllerSource.match(/const refreshTopicReplies = useCallback[\s\S]*?\n\n  const loadMoreReplies/)?.[0] || '';
    const refreshTopicBlock = topicControllerSource.match(/const refreshTopic = useCallback[\s\S]*?\n\n  const refreshWholeTopic/)?.[0] || '';
    const refreshWholeTopicBlock = topicControllerSource.match(/const refreshWholeTopic = useCallback[\s\S]*?\n\n  const toggleQuotedFloor/)?.[0] || '';
    const submitReplyBlock = topicActionsControllerSource.match(/const submitReply = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(refreshRepliesBlock).toContain('getYaohuoRepliesDirect');
    expect(refreshRepliesBlock).toContain('getReplies');
    expect(refreshRepliesBlock).toContain('mergeReplies(data.items, current)');
    expect(topicControllerSource).toContain('afterSubmit = false');
    expect(topicControllerSource).toContain('replyRefreshTarget');
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
    expect(submitReplyBlock).toMatch(/buildYaohuoReplyRequest[\s\S]*?\{ refreshTopic: false, owner: requestOwner \}/);
    expect(submitReplyBlock).toMatch(/buildLinuxDoReplyRequest[\s\S]*?\{ refreshTopic: false, owner: requestOwner \}/);
    expect(submitReplyBlock).toMatch(/buildNodeSeekReplyRequest[\s\S]*?replyTarget[\s\S]*?\{ refreshTopic: false, owner: requestOwner \}/);
    expect(submitReplyBlock).toContain('const requestTopicKey = topicKey(detail);');
    expect(submitReplyBlock).toContain('const requestOwner = startTopicActionRequest(requestTopicKey);');
    expect(submitReplyBlock).toContain('if (!isCurrentTopicActionRequest(requestOwner)) {');
    expect(submitReplyBlock.match(/await refreshTopicReplies\(\{ silent: true, afterSubmit: true \}\);/g) || []).toHaveLength(3);
    expect(topicScreenSource).toContain('onRefreshWholeTopic');
    expect(topicMenuSource).toContain('刷新评论');
    expect(topicMenuSource).toContain('刷新全文');
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

    expect(moreUiSource).not.toContain('label="收藏"');
    expect(moreUiSource).not.toContain('label="历史"');
    expect(moreUiSource).not.toContain('label="分类节点"');
    expect(moreUiSource).not.toContain('订阅');
    expect(moreUiSource).not.toContain('导出收藏 Markdown');
    expect(moreScreenSignature).not.toContain('favoriteCount');
    expect(moreScreenSignature).not.toContain('historyCount');
    expect(moreScreenSignature).not.toContain('showCategoriesPanel');
    expect(moreScreenSignature).not.toContain('subscriptions');
    expect(appSource).not.toContain('showCategoriesPanel');
    expect(appSource).not.toContain('exportFavoritesMarkdownFile');
    expect(appSource).not.toContain('toggleCategorySubscription');
  });

  it('keeps Android appearance settings to light or dark with fixed forest green and Douban white', () => {
    const settingsPanelStart = morePanelsSource.indexOf('export function SettingsPanel(');
    const settingsPanelBlock = settingsPanelStart >= 0
      ? morePanelsSource.slice(settingsPanelStart)
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

  it('remounts the library list when switching to history so old scroll offsets are not reused', () => {
    const listBlock = libraryScreenSource.match(/<FlashList\s[\s\S]*?renderItem=/)?.[0] || '';

    expect(listBlock).toContain('key={libraryTab}');
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
    expect(themeSource).not.toContain('libraryTopicRow');
  });

  it('keeps the current topic key active only while the topic screen is visible', () => {
    expect(topicControllerSource).toContain("const currentTopicKey = screen === 'topic' && currentTopic ? topicKey(currentTopic) : null;");
  });

  it('does not retry a stale linux.do topic after another topic is opened', () => {
    const block = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';

    expect(block).toContain('pendingLinuxDoTopicRef.current && topicKey(pendingLinuxDoTopicRef.current) !== topicKey(topic)');
    expect(block).toContain('pendingLinuxDoTopicRef.current = null;');
  });

  it('clears stale pending linux.do topics when closing the verification panel', () => {
    const block = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';

    expect(block).toContain('pendingLinuxDoTopicRef.current = null;');
  });

  it('does not let a stale linux.do topic verification reopen after manual close', () => {
    const closeBlock = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const cloudflareBlock = verificationControllerSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const openTopicBlock = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';

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
    const closeBlock = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/)?.[1] || '';
    const afterCloseBlock = verificationControllerSource.match(/useEffect\(\(\) => \{\s*if \(showLinuxDoPanel \|\| linuxDoPanelClosingSessionRef\.current === null\) \{[\s\S]*?\n  \}, \[[^\]]*showLinuxDoPanel[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('linuxDoPendingTopicVerifiedRef');
    expect(appSource).toContain('linuxDoVerifiedRetryTopicKeyRef');
    expect(appSource).toContain('linuxDoPendingReopenTopicAfterCloseRef');
    expect(appSource).toContain('openTopicRef');
    expect(closeBlock).toContain('const pendingTopic = pendingLinuxDoTopicRef.current;');
    expect(closeBlock).toContain('linuxDoPendingTopicVerifiedRef.current');
    expect(closeBlock).toContain('linuxDoPendingReopenTopicAfterCloseRef.current = pendingTopic;');
    expect(closeBlock).not.toContain("setScreen('topic');");
    expect(closeBlock).not.toContain('openTopicRef.current?.(pendingTopic, true);');
    expect(verificationControllerSource).toContain('LINUXDO_PANEL_CLOSE_SETTLE_MS');
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
    const topicPropsBlock = appSource.match(/topicProps: \{[\s\S]*?\n    \},\n    userProps/)?.[0] || '';

    expect(topicPropsBlock).toContain('inlineSizedImageUrls,');
  });

  it('keeps runtime-detected tiny images out of the image-only reply filter', () => {
    const filteredRepliesBlock = appSource.match(/const filteredReplies = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(filteredRepliesBlock).toContain('inlineSizedImageUrls');
    expect(filteredRepliesBlock).toContain('filterRepliesWithImages');
    expect(appSource).not.toContain('extractImageUrlsFromHtml(reply.html)');
  });

  it('closes the linux.do verification panel automatically after detecting a pending topic', () => {
    const checkLinuxDoBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(checkLinuxDoBlock).toContain('linuxDoPendingTopicVerifiedRef.current = Boolean(pendingLinuxDoTopicRef.current);');
    expect(checkLinuxDoBlock).toContain('if (linuxDoPendingTopicVerifiedRef.current) {');
    expect(checkLinuxDoBlock).toContain('closeLinuxDoPanel();');
  });

  it('does not loop back into linux.do verification when the verified retry is still blocked', () => {
    const openTopicBlock = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';
    const cloudflareBlock = openTopicBlock.match(/if \(isLinuxDoCloudflareError\(error\)\) \{([\s\S]*?)\n        \}/)?.[1] || '';
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || '';

    expect(verificationControllerSource).toContain('const handleLinuxDoCloudflareForTopic = useCallback');
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
    expect(userScreenSource).toContain('disabled={busy || loadingMoreTopics}');
    expect(userScreenSource).toContain('onEndReachedThreshold={0.5}');
    expect(userScreenSource).toContain('onScrollBeginDrag={armAutoLoad}');
    expect(userScreenSource).toContain('onMomentumScrollBegin={armAutoLoad}');
    expect(userControllerSource).toContain('const loadMoreUserTopics = useCallback(async () => {');
    expect(userControllerSource).toContain('cursor: current.nextTopicsCursor');
    expect(userControllerSource).toContain('const mergedTopics = mergeTopics(previous.topics, nextProfile.topics);');
    expect(userControllerSource).toContain('topics: mergedTopics');
    expect(userControllerSource).toContain('hasMoreTopics: Boolean(nextProfile.hasMoreTopics && nextProfile.nextTopicsCursor && mergedTopics.length > previous.topics.length)');
    expect(userControllerSource).toContain('nextTopicsCursor: mergedTopics.length > previous.topics.length ? nextProfile.nextTopicsCursor : null');
    expect(userControllerSource).toContain('userLoadingMoreCursorRef');
    expect(userControllerSource).toContain('userLoadingMoreCursorRef.current === current.nextTopicsCursor');
  });

  it('does not let the linux.do verification page stay loading forever', () => {
    expect(linuxDoVerifyModalSource).toContain('LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS');
    expect(linuxDoVerifyModalSource).toContain('linux.do 页面打开超时');
    expect(linuxDoVerifyModalSource).toContain('clearTimeout(timeout)');
  });

  it('ignores stale linux.do verification WebView events after closing or refreshing the panel', () => {
    const linuxDoPanelBlock = linuxDoVerifyModalSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';
    const linuxDoMessageBlock = verificationControllerSource.match(/const handleLinuxDoMessage[\s\S]*?\n  }, \[[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('const linuxDoWebViewSessionRef = useRef(0);');
    expect(verificationControllerSource).toContain('webViewKey !== linuxDoWebViewSessionRef.current');
    expect(linuxDoMessageBlock).toContain('webViewKey?: number');
    expect(linuxDoMessageBlock).toContain('showLinuxDoPanelRef.current');
    expect(linuxDoPanelBlock).toContain('onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);');
    expect(linuxDoPanelBlock).toContain("onSetLinuxDoWebViewError('', linuxDoWebViewKey);");
    expect(linuxDoPanelBlock).toContain('onHandleLinuxDoMessage(event, linuxDoWebViewKey)');
  });

  it('unmounts the linux.do verification WebView before hiding the modal', () => {
    const linuxDoPanelBlock = linuxDoVerifyModalSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';
    const closeLinuxDoBlock = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

    expect(appSource).toContain('const [mountLinuxDoWebView, setMountLinuxDoWebView] = useState(false);');
    expect(closeLinuxDoBlock.indexOf('setMountLinuxDoWebView(false);')).toBeGreaterThan(-1);
    expect(closeLinuxDoBlock.indexOf('setMountLinuxDoWebView(false);')).toBeLessThan(closeLinuxDoBlock.indexOf('setShowLinuxDoPanel(false);'));
    expect(linuxDoPanelBlock).toContain('mountLinuxDoWebView');
    expect(linuxDoPanelBlock).toContain('showLinuxDoPanel && mountLinuxDoWebView');
  });

  it('does not let a new linux.do verification request cancel an in-flight close', () => {
    const changeLinuxDoBlock = verificationControllerSource.match(/const changeLinuxDoPanel = useCallback\(\(visible: boolean\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const showLinuxDoBlock = verificationControllerSource.match(/const showLinuxDoVerification = useCallback\(\(message = 'linux\.do 需要完成 Cloudflare 验证'\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const closeLinuxDoBlock = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const afterCloseBlock = verificationControllerSource.match(/useEffect\(\(\) => \{\s*if \(showLinuxDoPanel \|\| linuxDoPanelClosingSessionRef\.current === null\) \{[\s\S]*?\n  \}, \[[^\]]*showLinuxDoPanel[^\]]*\]\);/)?.[0] || '';

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

  it('keeps linux.do verified retry failures from remounting the verification WebView', () => {
    const retryBlock = verificationControllerSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{([\s\S]*?)\n  \}, \[[^\]]+\]\);/)?.[1] || '';
    const verifiedRetryBlock = retryBlock.match(/if \(linuxDoVerifiedRetryTopicKeyRef\.current === requestTopicKey\) \{([\s\S]*?)\n    \}/)?.[1] || '';

    expect(retryBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current === requestTopicKey');
    expect(verifiedRetryBlock).toContain('setMountLinuxDoWebView(false);');
    expect(verifiedRetryBlock).toContain('setLoadingLinuxDoPage(false);');
    expect(verifiedRetryBlock).not.toContain('showLinuxDoVerification(message);');
  });

  it('keeps linux.do verified retry failures in reply refreshes from reopening verification', () => {
    const refreshRepliesBlock = topicControllerSource.match(/const refreshTopicReplies = useCallback[\s\S]*?\n\n  const loadMoreReplies/)?.[0] || '';
    const loadMoreRepliesBlock = topicControllerSource.match(/const loadMoreReplies = useCallback[\s\S]*?\n\n  const refreshTopic/)?.[0] || '';

    expect(refreshRepliesBlock).toContain('await handleLinuxDoCloudflareForTopic(detail, errorMessage(error))');
    expect(loadMoreRepliesBlock).toContain('await handleLinuxDoCloudflareForTopic(detail, errorMessage(error))');
    expect(refreshRepliesBlock).not.toContain('showLinuxDoVerification(errorMessage(error))');
    expect(loadMoreRepliesBlock).not.toContain('showLinuxDoVerification(errorMessage(error))');
  });

  it('cancels in-flight linux.do verification checks when the panel closes or reloads', () => {
    const resetLinuxDoBlock = verificationControllerSource.match(/const resetLinuxDoWebView = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const closeLinuxDoBlock = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const checkLinuxDoBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const appStateBlock = verificationControllerSource.match(/const stopLinuxDoVerificationForInactiveApp = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

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
    const linuxDoPanelBlock = linuxDoVerifyModalSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';

    expect(linuxDoPanelBlock).toContain('linuxDoWebViewReadyRef');
    expect(linuxDoPanelBlock).toContain('markLinuxDoPageReady');
    expect(linuxDoPanelBlock).toContain('onLoadProgress');
    expect(linuxDoPanelBlock).toContain('event.nativeEvent.progress >= 0.8');
    expect(linuxDoPanelBlock).toContain('if (!linuxDoWebViewReadyRef.current) {');
    expect(linuxDoPanelBlock).toContain('onSetLoadingLinuxDoPage(true, linuxDoWebViewKey);');
  });

  it('keeps login modal controls usable while a WebView loading badge is visible', () => {
    expect(loginWebViewModalSource).toContain('<View pointerEvents="none" style={styles.loading}>');
  });

  it('opens external login and verification pages as full-screen WebView modals', () => {
    expect(morePanelsSource).toContain('LoginWebViewModal');
    expect(linuxDoVerifyModalSource).toContain('LoginWebViewModal');
    expect(morePanelsSource).toContain('visible={showLoginPanel}');
    expect(morePanelsSource).toContain('visible={showYaohuoLoginPanel}');
    expect(linuxDoVerifyModalSource).toContain('visible={showLinuxDoPanel}');
    expect(loginWebViewModalSource).toContain('styles.loginWebViewModal');
    expect(loginWebViewModalSource).toContain('styles.loginWebViewBody');
  });

  it('keeps full-screen login modal controls below the Android status bar', () => {
    expect(loginWebViewModalSource).toContain("import { useSafeAreaInsets } from 'react-native-safe-area-context';");
    expect(loginWebViewModalSource).toContain('const insets = useSafeAreaInsets();');
    expect(loginWebViewModalSource).toContain('paddingTop: insets.top');
    expect(loginWebViewModalSource).toContain('paddingBottom: insets.bottom');
    expect(loginWebViewModalSource).not.toContain('<SafeAreaView');
  });

  it('clears stale linux.do verification errors after the WebView responds again', () => {
    const linuxDoMessageBlock = verificationControllerSource.match(/const handleLinuxDoMessage[\s\S]*?\n  }, \[[^\]]*\]\);/)?.[0] || '';

    expect(linuxDoMessageBlock).toContain("setLinuxDoWebViewErrorForSession('', webViewKey);");
  });

  it('clears stale linux.do verification errors after a successful page load', () => {
    const block = linuxDoVerifyModalSource.match(/onLoadEnd=\{\(event\) => \{[\s\S]*?linuxDoWebViewRef\.current\?\.injectJavaScript\(LINUXDO_WEBVIEW_PROBE_SCRIPT\);[\s\S]*?\}\}/)?.[0] || '';

    expect(block).toContain('markLinuxDoPageReady();');
    expect(block).toContain("if (!('code' in event.nativeEvent)) {");
    expect(block).toContain("onSetLinuxDoWebViewError('', linuxDoWebViewKey);");
  });

  it('keeps linux.do verification WebView failures contained', () => {
    expect(linuxDoVerifyModalSource).toContain('linuxDoWebViewKey');
    expect(linuxDoVerifyModalSource).toContain('onResetLinuxDoWebView');
    expect(linuxDoVerifyModalSource).toContain('key={linuxDoWebViewKey}');
    expect(linuxDoVerifyModalSource).toContain('renderError={() => <View style={styles.webViewErrorPlaceholder} />}');
    expect(linuxDoVerifyModalSource).toContain('onRenderProcessGone={() =>');
    expect(linuxDoVerifyModalSource).toContain('linux.do 验证页面已停止');
  });

  it('keeps visible login WebView renderer failures recoverable', () => {
    const nodeSeekLoginBlock = morePanelsSource.match(/export function NodeSeekLoginPanel\([\s\S]*?\nexport const MemoizedNodeSeekLoginPanel/)?.[0] || '';
    const yaohuoLoginBlock = morePanelsSource.match(/export function YaohuoLoginPanel\([\s\S]*?\nexport const MemoizedYaohuoLoginPanel/)?.[0] || '';

    expect(nodeSeekLoginBlock).toContain('onRenderProcessGone={() =>');
    expect(nodeSeekLoginBlock).toContain('NodeSeek 登录页面已停止，请刷新页面重试。');
    expect(nodeSeekLoginBlock).toContain('key={`nodeseek-login-${webViewKey}`}');
    expect(nodeSeekLoginBlock).toContain('setWebViewNeedsRemount(true);');
    expect(yaohuoLoginBlock).toContain('onRenderProcessGone={() =>');
    expect(yaohuoLoginBlock).toContain('妖火登录页面已停止，请刷新页面重试。');
    expect(yaohuoLoginBlock).toContain('key={`yaohuo-login-${webViewKey}`}');
    expect(yaohuoLoginBlock).toContain('setWebViewNeedsRemount(true);');
  });

  it('keeps visible login WebView refresh on the current page unless remount is needed', () => {
    const nodeSeekLoginBlock = morePanelsSource.match(/export function NodeSeekLoginPanel\([\s\S]*?\nexport const MemoizedNodeSeekLoginPanel/)?.[0] || '';
    const yaohuoLoginBlock = morePanelsSource.match(/export function YaohuoLoginPanel\([\s\S]*?\nexport const MemoizedYaohuoLoginPanel/)?.[0] || '';

    expect(nodeSeekLoginBlock).toContain('if (webViewNeedsRemount) {');
    expect(nodeSeekLoginBlock).toContain('setWebViewKey((current) => current + 1);');
    expect(nodeSeekLoginBlock).toContain('webViewRef.current?.reload();');
    expect(yaohuoLoginBlock).toContain('if (webViewNeedsRemount) {');
    expect(yaohuoLoginBlock).toContain('setWebViewKey((current) => current + 1);');
    expect(yaohuoLoginBlock).toContain('yaohuoWebViewRef.current?.reload();');
  });

  it('keeps visible login WebView load failures visible after load end', () => {
    const nodeSeekLoginBlock = morePanelsSource.match(/export function NodeSeekLoginPanel\([\s\S]*?\nexport const MemoizedNodeSeekLoginPanel/)?.[0] || '';
    const yaohuoLoginBlock = morePanelsSource.match(/export function YaohuoLoginPanel\([\s\S]*?\nexport const MemoizedYaohuoLoginPanel/)?.[0] || '';

    expect(nodeSeekLoginBlock).toContain("if ('code' in event.nativeEvent) {");
    expect(nodeSeekLoginBlock).toContain('return;');
    expect(nodeSeekLoginBlock).toContain('webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);');
    expect(yaohuoLoginBlock).toContain("if ('code' in event.nativeEvent) {");
    expect(yaohuoLoginBlock).toContain('return;');
  });

  it('keeps the linux.do verification WebView off the emulator GPU path', () => {
    const linuxDoPanelBlock = linuxDoVerifyModalSource.match(/export function LinuxDoVerifyModal\([\s\S]*?\nexport const MemoizedLinuxDoVerifyModal/)?.[0] || '';

    expect(linuxDoPanelBlock).toContain('androidLayerType="software"');
  });

  it('stops the linux.do verification WebView before hiding it', () => {
    expect(appSource).toContain('closeLinuxDoPanel');
    expect(verificationControllerSource).toContain('linuxDoWebViewRef.current?.stopLoading()');
    expect(appSource).toContain('onShowLinuxDoPanelChange: changeLinuxDoPanel');
    expect(moreScreenSource).toContain('onShowLinuxDoPanelChange={onShowLinuxDoPanelChange}');
  });

  it('clears stale linux.do login cookies after expired write actions while preserving verification', () => {
    const runLinuxDoBlock = topicActionsControllerSource.match(/const runLinuxDoRequest = useCallback\(async \([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(runLinuxDoBlock).toContain('await clearExpiredLinuxDoLogin({ error, resetLinuxDoLevelState, updateLinuxDoSession });');
    expect(topicActionHelpersSource).toContain('const remainingAccess = await clearLinuxDoAccess();');
    expect(topicActionHelpersSource).toContain('updateLinuxDoSession(remainingAccess?.cookieHeader');
    expect(topicActionHelpersSource).toContain("type: 'verification-succeeded'");
    expect(topicActionHelpersSource).toContain("type: 'login-expired'");
  });

  it('resets linux.do verified state when status detection finds no cookie', () => {
    const checkLinuxDoCookieBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const noCookieBlock = checkLinuxDoCookieBlock.match(/if \(!canStoreLinuxDoAccess\(cookies\) \|\| !cookieHeader \|\| !canAcceptLinuxDoAccessUpdate\(cookies, linuxDoClearanceBeforeVerifyRef\.current, linuxDoRequireFreshClearanceRef\.current\)\) \{([\s\S]*?)\n      \}/)?.[1] || '';

    expect(noCookieBlock).toContain('updateLinuxDoSession({');
    expect(noCookieBlock).toContain("type: 'verification-required'");
  });

  it('cancels the pending linux.do topic return when verification detection fails', () => {
    const checkLinuxDoCookieBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const noCookieBlock = checkLinuxDoCookieBlock.match(/if \(!canStoreLinuxDoAccess\(cookies\) \|\| !cookieHeader \|\| !canAcceptLinuxDoAccessUpdate\(cookies, linuxDoClearanceBeforeVerifyRef\.current, linuxDoRequireFreshClearanceRef\.current\)\) \{([\s\S]*?)\n      \}/)?.[1] || '';
    const catchBlock = checkLinuxDoCookieBlock.match(/catch \(error\) \{([\s\S]*?)\n    \} finally/)?.[1] || '';
    const closeLinuxDoBlock = verificationControllerSource.match(/const closeLinuxDoPanel = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';

    expect(noCookieBlock).not.toContain('pendingLinuxDoTopicRef.current = null;');
    expect(noCookieBlock).not.toContain('linuxDoDismissedVerificationTopicKeyRef.current = topicKey(pendingTopic);');
    expect(catchBlock).not.toContain('pendingLinuxDoTopicRef.current = null;');
    expect(catchBlock).not.toContain('linuxDoPendingReopenTopicAfterCloseRef.current = null;');
    expect(closeLinuxDoBlock).toContain('linuxDoDismissedVerificationTopicKeyRef.current = topicKey(pendingTopic);');
  });

  it('requires a new linux.do cf_clearance before verification succeeds', () => {
    const checkLinuxDoCookieBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('const linuxDoClearanceBeforeVerifyRef = useRef<string | null>(null);');
    expect(appSource).toContain('const linuxDoRequireFreshClearanceRef = useRef(false);');
    expect(checkLinuxDoCookieBlock).toContain('canAcceptLinuxDoAccessUpdate(cookies, linuxDoClearanceBeforeVerifyRef.current, linuxDoRequireFreshClearanceRef.current)');
    expect(checkLinuxDoCookieBlock).toContain('没有检测到新的 linux.do 验证信息。请完成验证后再试。');
  });

  it('records saved linux.do clearance as the old value on startup', () => {
    const startupBlock = sessionControllerSource.match(/const linuxDoSummary = linuxDoAccessSummary\(linuxDoAccess\);[\s\S]*?if \(linuxDoAccess\?\.userAgent\)/)?.[0] || '';

    expect(startupBlock).toContain("parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '')");
    expect(startupBlock).toContain('linuxDoClearanceBeforeVerifyRef.current = linuxDoClearanceValue(linuxDoCookies) || null;');
  });

  it('requires fresh linux.do clearance only for forced verification flows', () => {
    const changeLinuxDoBlock = verificationControllerSource.match(/const changeLinuxDoPanel = useCallback\(\(visible: boolean\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] || '';
    const cloudflareHandlerBlock = verificationControllerSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const verifyFromTopicBlock = verificationControllerSource.match(/const verifyLinuxDoFromTopic = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const checkLinuxDoCookieBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(changeLinuxDoBlock).toContain('linuxDoRequireFreshClearanceRef.current = false;');
    expect(cloudflareHandlerBlock).toContain('linuxDoRequireFreshClearanceRef.current = true;');
    expect(verifyFromTopicBlock).toContain('linuxDoRequireFreshClearanceRef.current = true;');
    expect(checkLinuxDoCookieBlock).toContain('linuxDoRequireFreshClearanceRef.current = false;');
  });

  it('requires linux.do cf_clearance before saving verification state', () => {
    const checkLinuxDoCookieBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(verificationControllerSource).toContain('canStoreLinuxDoAccess');
    expect(checkLinuxDoCookieBlock).toContain('!canStoreLinuxDoAccess(cookies)');
    expect(checkLinuxDoCookieBlock).toContain('没有检测到新的 linux.do 验证信息。请完成验证后再试。');
    expect(checkLinuxDoCookieBlock).not.toContain('if (!cookieHeader) {');
  });

  it('clears saved linux.do access before topic-triggered verification', () => {
    const cloudflareHandlerBlock = verificationControllerSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const verifyFromTopicBlock = verificationControllerSource.match(/const verifyLinuxDoFromTopic = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(verificationControllerSource).toContain('clearLinuxDoSavedClearance');
    expect(verificationControllerSource).toContain('const refreshLinuxDoClearanceState = useCallback');
    expect(cloudflareHandlerBlock).toContain('await refreshLinuxDoClearanceState();');
    expect(verifyFromTopicBlock).toContain('await refreshLinuxDoClearanceState();');
  });

  it('reuses the linux.do verification WebView user agent for local requests', () => {
    expect(loginWebViewScriptsSource).toContain('navigator.userAgent');
    expect(appSource).toContain('linuxDoWebViewUserAgent');
    expect(appSource).toContain('linuxDoWebViewUserAgentRef');
    expect(verificationControllerSource).toContain('sanitizeLinuxDoUserAgent(data.userAgent)');
    expect(linuxDoVerifyModalSource).toContain('userAgent={linuxDoWebViewUserAgent}');
    expect(verificationControllerSource).toContain('saveLinuxDoAccess(cookieHeader, linuxDoWebViewUserAgentRef.current || linuxDoWebViewUserAgent || undefined)');
    expect(localLinuxDoSource).toContain("DEFAULT_LINUXDO_ANDROID_USER_AGENT");
    expect(localLinuxDoSource).toContain("'User-Agent': access?.userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT");
  });

  it('can detect linux.do clearance from the visible WebView document cookies', () => {
    expect(loginWebViewScriptsSource).toContain('cookie: document.cookie || ""');
    expect(appSource).toContain('linuxDoWebViewCookieHeader');
    expect(appSource).toContain('linuxDoWebViewCookieHeaderRef');
    expect(verificationControllerSource).toContain('parseLinuxDoDocumentCookie(linuxDoDocumentCookieHeader)');
    expect(verificationControllerSource).toContain('await probeLinuxDoPage();');
  });

  it('merges saved linux.do login cookies when detecting refreshed clearance', () => {
    const readCurrentLinuxDoCookiesBlock = verificationControllerSource.match(/const readCurrentLinuxDoCookies = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

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
    const waitBlock = verificationControllerSource.match(/const waitForLinuxDoClearance = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(verificationControllerSource).toContain('LINUXDO_CLEARANCE_DETECT_TIMEOUT_MS');
    expect(verificationControllerSource).toContain('LINUXDO_CLEARANCE_DETECT_INTERVAL_MS');
    expect(verificationControllerSource).toContain('const waitForLinuxDoClearance');
    expect(verificationControllerSource).toContain('while (Date.now() < deadline)');
    expect(verificationControllerSource).toContain('await new Promise((resolve) => setTimeout(resolve, LINUXDO_CLEARANCE_DETECT_INTERVAL_MS));');
    expect(waitBlock).toContain('canStoreLinuxDoClearance(cookies)');
    expect(waitBlock).not.toContain('canStoreLinuxDoLogin(cookies)');
  });

  it('returns quickly from the hidden linux.do WebView when manual verification is visible', () => {
    const scriptBlock = hiddenBrowserFetchControllerSource.match(/const LINUXDO_BROWSER_FETCH_SCRIPT = `[\s\S]*?`;/)?.[0] || '';

    expect(scriptBlock).toContain('isInteractiveChallengePage');
    expect(scriptBlock).toContain('if (isInteractiveChallengePage() || (!isChallengePage() && jsonText()) || Date.now() >= deadline)');
    expect(scriptBlock).toContain('const challenge = isChallengePage() || isInteractiveChallengePage();');
  });

  it('persists linux.do cookies after a successful hidden WebView fallback read', () => {
    const completeBlock = sessionControllerSource.match(/const completeLinuxDoBrowserFetch = useCallback\(async \(data: \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(completeBlock).toContain('if (!data.challenge && typeof data.cookie === \'string\')');
    expect(completeBlock).toContain('readLinuxDoCookiesFromWebView()');
    expect(completeBlock).toContain('mergeLinuxDoCookies(');
    expect(completeBlock).toContain('saveLinuxDoAccess(cookieHeader');
  });

  it('saves linux.do hidden WebView cookies before resolving the fallback response', () => {
    const completeBlock = sessionControllerSource.match(/const completeLinuxDoBrowserFetch = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const saveIndex = completeBlock.indexOf('await saveLinuxDoAccess(cookieHeader');
    const resolveIndex = completeBlock.indexOf('current.resolve(linuxDoBrowserResponse');

    expect(completeBlock).toContain('const completeLinuxDoBrowserFetch = useCallback(async');
    expect(saveIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(saveIndex);
  });

  it('stops the hidden linux.do WebView after a fallback read finishes', () => {
    const completeBlock = sessionControllerSource.match(/const completeLinuxDoBrowserFetch = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(completeBlock).toContain('linuxDoBrowserWebViewRef.current?.stopLoading();');
  });

  it('still resolves linux.do hidden fallback responses when no storable cookie is found', () => {
    const completeBlock = sessionControllerSource.match(/const completeLinuxDoBrowserFetch = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const unusableCookieBlock = completeBlock.match(/if \(!canStoreLinuxDoAccess\(cookies\) \|\| !cookieHeader\) \{([\s\S]*?)\n        \}/)?.[1] || '';

    expect(completeBlock).toContain('if (canStoreLinuxDoAccess(cookies) && cookieHeader) {');
    expect(unusableCookieBlock).not.toContain('return;');
    expect(completeBlock).toContain('current.resolve(linuxDoBrowserResponse');
  });

  it('saves NodeSeek hidden WebView cookies before resolving the fallback response', () => {
    const completeBlock = sessionControllerSource.match(/const completeNodeSeekBrowserFetch = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const saveIndex = completeBlock.indexOf('await saveNodeSeekCookieHeader(');
    const resolveIndex = completeBlock.indexOf('current.resolve(nodeSeekBrowserResponse');

    expect(completeBlock).toContain('const completeNodeSeekBrowserFetch = useCallback(async');
    expect(saveIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(saveIndex);
  });

  it('clears stale linux.do WebView clearance before topic-triggered verification', () => {
    const clearSavedBlock = verificationControllerSource.match(/const refreshLinuxDoClearanceState = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(verificationControllerSource).toContain('clearLinuxDoWebViewClearance');
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
    const resetBlock = verificationControllerSource.match(/const resetLinuxDoWebView[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] || '';

    expect(resetBlock).toContain("linuxDoWebViewCookieHeaderRef.current = '';");
    expect(resetBlock).toContain("setLinuxDoWebViewCookieHeader('');");
  });

  it('allows the linux.do verification WebView to keep Cloudflare challenge traffic inside the page', () => {
    expect(appSource).toContain("const LINUXDO_LOGIN_HOSTS = ['linux.do', 'challenges.cloudflare.com']");
  });

});
