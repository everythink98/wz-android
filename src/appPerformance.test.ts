import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('android-app', 'App.tsx');
const backupStatusControllerSource = readProjectFile('android-app', 'src', 'app', 'useBackupStatusController.ts');
const feedControllerSource = readProjectFile('android-app', 'src', 'app', 'useFeedController.ts');
const readerDataControllerSource = readProjectFile('android-app', 'src', 'app', 'useReaderDataController.ts');
const searchControllerSource = readProjectFile('android-app', 'src', 'app', 'useSearchController.ts');
const sessionControllerSource = readProjectFile('android-app', 'src', 'app', 'useSessionController.ts');
const topicControllerSource = readProjectFile('android-app', 'src', 'app', 'useTopicController.ts');
const userControllerSource = readProjectFile('android-app', 'src', 'app', 'useUserController.ts');
const feedScreenSource = readProjectFile('android-app', 'src', 'screens', 'FeedScreen.tsx');
const libraryScreenSource = readProjectFile('android-app', 'src', 'screens', 'LibraryScreen.tsx');
const moreScreenSource = readProjectFile('android-app', 'src', 'screens', 'MoreScreen.tsx');
const searchScreenSource = readProjectFile('android-app', 'src', 'screens', 'SearchScreen.tsx');
const topicScreenSource = readProjectFile('android-app', 'src', 'screens', 'TopicScreen.tsx');
const topicContentSplitSource = readProjectFile('android-app', 'src', 'topicContentSplit.ts');
const userScreenSource = readProjectFile('android-app', 'src', 'screens', 'UserScreen.tsx');

describe('Android App performance guards', () => {
  it('cancels stale feed, search, topic, and backup/status requests before starting newer ones', () => {
    expect(feedControllerSource).toContain('feedAbortRef.current?.abort()');
    expect(searchControllerSource).toContain('searchAbortRef.current?.abort()');
    expect(appSource).toContain('topicAbortRef.current?.abort()');
    expect(backupStatusControllerSource).toContain('backupAbortRef.current?.abort()');
    expect(backupStatusControllerSource).toContain('statusAbortRef.current?.abort()');
    expect([
      appSource,
      feedControllerSource,
      searchControllerSource,
      backupStatusControllerSource,
      userControllerSource,
      topicControllerSource
    ].join('\n')).toContain('signal: controller.signal');
  });

  it('loads combined feed and grouped search without the project server', () => {
    expect(feedControllerSource).toContain('Promise.allSettled');
    expect(feedControllerSource).toContain('const applyFeedResponse = (data: FeedResponse) => {');
    expect(searchControllerSource).toContain('activeSources.map');
    expect(searchControllerSource).toContain('setSearchGroups');
    expect(appSource).toContain('onRetrySearchSource');
    expect(appSource).not.toContain('const loadFeed = useCallback');
    expect(appSource).not.toContain('const runSearch = useCallback');
  });

  it('loads local categories without the project server', () => {
    expect(feedControllerSource).toContain('return getCategories({');
    expect(feedControllerSource).toContain("source: FeedSource = 'all'");
    expect(feedControllerSource).toContain('source,');
    expect(feedControllerSource).toContain('nocache: true');
    expect(feedControllerSource).toContain('signal: controller.signal');
    expect(feedControllerSource).not.toContain('baseCategoriesResult');
  });

  it('bypasses stale category caches when refreshing category metadata', () => {
    expect(feedControllerSource).toContain('return getCategories({');
    expect(feedControllerSource).toContain('nocache: true');
    expect(feedControllerSource).not.toContain("getCategories({ serverUrl");
  });

  it('debounces reading progress persistence while scrolling long topics', () => {
    expect(readerDataControllerSource).toContain('pendingProgressRef');
    expect(readerDataControllerSource).toContain('progressSaveTimerRef');
    expect(readerDataControllerSource).toContain('setTimeout(() => {');
    expect(readerDataControllerSource).toContain('const next = updateProgress(readerDataRef.current, pending.topic, {');
    expect(readerDataControllerSource).toContain('saveReaderData(next)');
    expect(readerDataControllerSource).toContain('void persistReaderData(next);');
    expect(appSource).toContain('queueProgressSave(detail, { percent, scrollY });');
    expect(appSource).not.toContain('const next = updateProgress(readerDataRef.current, detail, { percent, scrollY })');
    expect(appSource).not.toContain('sanitizeReaderData(updateProgress');
  });

  it('keeps reader data save queue handling in one shared path', () => {
    expect(readerDataControllerSource).toContain('const persistReaderData = useCallback((next: ReaderData) => {');
    expect(readerDataControllerSource.match(/saveReaderData\(next\)/g) || []).toHaveLength(1);
    expect(appSource).not.toContain('saveReaderData(next)');
  });

  it('keeps reader data commits outside React state updaters', () => {
    const block = readerDataControllerSource.match(/const commitReaderData = useCallback\(\(updater: \(current: ReaderData\) => ReaderData\) => \{([\s\S]*?)\n  \}, \[persistReaderData\]\);/)?.[1] || '';

    expect(block).toContain('const next = sanitizeReaderData(updater(readerDataRef.current));');
    expect(block).toContain('setReaderData(next);');
    expect(block).toContain('void persistReaderData(next);');
    expect(block).not.toContain('setReaderData((current)');
  });

  it('keeps list screens independent from the full reader data object', () => {
    for (const source of [feedScreenSource, searchScreenSource, libraryScreenSource, userScreenSource]) {
      expect(source).not.toContain('readerData: ReaderData');
      expect(source).not.toContain('getTopicListItemState(readerData');
    }
    expect(feedScreenSource).toContain('topicStateIndex');
    expect(searchScreenSource).toContain('topicStateIndex');
    expect(libraryScreenSource).toContain('topicStateIndex');
    expect(userScreenSource).toContain('topicStateIndex');
  });

  it('keeps topic screen favorite state primitive instead of passing full reader data', () => {
    expect(topicScreenSource).not.toContain('readerData: ReaderData');
    expect(topicScreenSource).not.toContain('isFavorite(readerData');
    expect(topicScreenSource).toContain('topicFavorite');
  });

  it('keeps memoized search tab rendering bound to the current query', () => {
    const renderSearchTabBlock = appSource.match(/const renderSearchTab = useCallback\(\(\) => \([\s\S]*?\n  \), \[[^\]]+\]\);/)?.[0] || '';

    expect(renderSearchTabBlock).toContain('query={searchQuery}');
    expect(renderSearchTabBlock).toMatch(/\[[^\]]*\bsearchQuery\b[^\]]*\]/);
  });

  it('refreshes the HTML image renderer when the theme border color changes', () => {
    const htmlRenderersBlock = appSource.match(/const htmlRenderers = useMemo<HtmlRenderers>\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(htmlRenderersBlock).toContain('borderColor: theme.line');
    expect(htmlRenderersBlock).toMatch(/\[[^\]]*\btheme\.line\b[^\]]*\]/);
  });

  it('uses app controller modules for split Android state', () => {
    for (const moduleName of [
      'useReaderDataController',
      'useSessionController',
      'useFeedController',
      'useSearchController',
      'useTopicController',
      'useUserController',
      'useBackupStatusController',
      'useHtmlRenderingController'
    ]) {
      expect(appSource).toContain(`./src/app/${moduleName}`);
    }
  });

  it('keeps user, backup, and status workflows outside the app shell', () => {
    expect(userControllerSource).toContain('const openUser = useCallback');
    expect(userControllerSource).toContain('const loadMoreUserTopics = useCallback');
    expect(backupStatusControllerSource).toContain('const importBackup = useCallback');
    expect(backupStatusControllerSource).toContain('const exportBackupFile = useCallback');
    expect(backupStatusControllerSource).toContain('const checkLocalStatus = useCallback');
    expect(appSource).not.toContain('const openUser = useCallback');
    expect(appSource).not.toContain('const loadMoreUserTopics = useCallback');
    expect(appSource).not.toContain('const importBackup = useCallback');
    expect(appSource).not.toContain('const checkLocalStatus = useCallback');
    expect(topicControllerSource).toContain('const openTopic = useCallback');
    expect(topicControllerSource).toContain('const refreshTopicReplies = useCallback');
    expect(topicControllerSource).toContain('const loadMoreReplies = useCallback');
    expect(appSource).not.toContain('const openTopic = useCallback');
    expect(appSource).not.toContain('const refreshTopicReplies = useCallback');
    expect(appSource).not.toContain('const loadMoreReplies = useCallback');
  });


  it('starts NodeSeek hidden WebView timeout only when a queued request starts', () => {
    const startBlock = sessionControllerSource.match(/const startNextNodeSeekBrowserFetch = useCallback[\s\S]*?\n\n  const rejectNodeSeekBrowserFetch/)?.[0] || '';
    const fetchBlock = sessionControllerSource.match(/const nodeSeekFetchWithWebView: Fetcher = useCallback[\s\S]*?\n\n  const completeNodeSeekBrowserFetch/)?.[0] || '';

    expect(startBlock).toContain('next.timeout = setTimeout(() => {');
    expect(fetchBlock).not.toContain('setTimeout(() =>');
  });

  it('drops aborted NodeSeek hidden WebView requests before starting the next queued request', () => {
    const startBlock = sessionControllerSource.match(/const startNextNodeSeekBrowserFetch = useCallback[\s\S]*?\n\n  const rejectNodeSeekBrowserFetch/)?.[0] || '';

    expect(startBlock).toContain('while (nodeSeekBrowserFetchQueueRef.current.length) {');
    expect(startBlock).toContain('if (candidate.abortSignal?.aborted) {');
    expect(startBlock).toContain("candidate.reject(new Error('请求已取消'));");
    expect(startBlock).toContain('continue;');
  });

  it('memoizes the Android More screen against reader data changes it does not display', () => {
    expect(moreScreenSource).toContain('export const MemoizedMoreScreen = memo(MoreScreen);');
    expect(moreScreenSource).toContain('const MemoizedBackupRestorePanel = memo(BackupRestorePanel);');
    expect(moreScreenSource).toContain('const MemoizedNodeSeekLoginPanel = memo(NodeSeekLoginPanel);');
    expect(moreScreenSource).toContain('const MemoizedYaohuoLoginPanel = memo(YaohuoLoginPanel);');
    expect(moreScreenSource).toContain('const MemoizedLinuxDoVerifyPanel = memo(LinuxDoVerifyPanel);');
    expect(moreScreenSource).not.toContain('CategorySubscriptionPanel');
    expect(moreScreenSource).toContain('const MemoizedAppearancePanel = memo(AppearancePanel);');
    expect(moreScreenSource).toContain('const MemoizedStatusCheckPanel = memo(StatusCheckPanel);');
    expect(moreScreenSource).not.toContain('previous.settings === next.settings');
    expect(moreScreenSource).not.toContain('previous.subscriptions === next.subscriptions');
    expect(moreScreenSource).not.toContain('previous.favoriteCount === next.favoriteCount');
    expect(moreScreenSource).not.toContain('previous.historyCount === next.historyCount');
    expect(moreScreenSource).not.toContain('previous.readerData');
    expect(moreScreenSource).not.toContain('previous.readerData.progress');
    expect(appSource).not.toContain('<MoreScreen');
    expect(appSource).toContain('<MemoizedMoreScreen');
  });

  it('keeps reply render callbacks independent from global quote maps', () => {
    const renderReplyDeps = topicScreenSource.match(/const renderReplyItem = useCallback[\s\S]*?\), \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(topicScreenSource).toContain('expandedQuotesRef');
    expect(topicScreenSource).toContain('loadedQuotedRepliesRef');
    expect(topicScreenSource).toContain('loadingQuotedFloorsRef');
    expect(renderReplyDeps).not.toMatch(/\bexpandedQuotes\b/);
    expect(renderReplyDeps).not.toMatch(/\bloadedQuotedReplies\b/);
    expect(renderReplyDeps).not.toMatch(/\bloadingQuotedFloors\b/);
  });

  it('does not keep server URL settings in the Android app', () => {
    expect(appSource).not.toContain('draftServerUrl');
    expect(appSource).not.toContain('normalizeServerUrl');
    expect(appSource).not.toContain('setServerUrl');
    expect(appSource).not.toContain('syncing');
    expect(moreScreenSource).not.toContain('syncing');
    expect(appSource).toContain('statusBusy={statusBusy}');
    expect(appSource).toContain('backupBusy={backupBusy}');
    expect(appSource).toContain('backupJson={backupJson}');
    expect(appSource).toContain('onBackupJsonChange={setBackupJson}');
  });

  it('cancels stale quoted floor requests when switching or leaving topics', () => {
    expect(appSource).toContain('quotedReplyAbortRefs');
    expect(appSource).toContain('abortQuotedReplyRequests();');
    expect(topicControllerSource).toContain('quotedReplyAbortRefs.current[key] = controller;');
    expect(topicControllerSource).toContain('signal: controller.signal');
  });

  it('does not start stale reply requests after topic changes during cookie loading', () => {
    const refreshRepliesBlock = topicControllerSource.match(/const refreshTopicReplies = useCallback[\s\S]*?\n\n  const loadMoreReplies/)?.[0] || '';
    const loadMoreRepliesBlock = topicControllerSource.match(/const loadMoreReplies = useCallback[\s\S]*?\n\n  const refreshTopic = useCallback/)?.[0] || '';
    const staleTopicGuard = 'currentTopicKeyRef.current !== requestTopicKey || requestId !== repliesRequestIdRef.current';

    expect(refreshRepliesBlock.indexOf(staleTopicGuard)).toBeGreaterThan(refreshRepliesBlock.indexOf('const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);'));
    expect(refreshRepliesBlock.indexOf(staleTopicGuard)).toBeLessThan(refreshRepliesBlock.indexOf('controller = startAbortableRequest(repliesAbortRef);'));
    expect(loadMoreRepliesBlock.indexOf(staleTopicGuard)).toBeGreaterThan(loadMoreRepliesBlock.indexOf('const nodeSeekCookie = await loadNodeSeekCookieForSource(detail.source);'));
    expect(loadMoreRepliesBlock.indexOf(staleTopicGuard)).toBeLessThan(loadMoreRepliesBlock.indexOf('controller = startAbortableRequest(repliesAbortRef);'));
  });

  it('uses stable reply identifiers without falling back to list positions', () => {
    expect(topicScreenSource).toContain('function getReplyKey(reply: Reply)');
    expect(topicScreenSource).toContain('keyExtractor={topicListItemKey}');
    expect(topicScreenSource).not.toContain('keyExtractor={(reply, index) => `${reply.floor ?? index}-${reply.createdAt}`}');
  });

  it('renders long topic bodies as batched list items with replies', () => {
    expect(topicScreenSource).toContain('type TopicListItem');
    expect(topicScreenSource).toContain('splitTopicContentHtml(topicContentHtml)');
    expect(topicContentSplitSource).toContain('export function splitTopicContentHtml');
    expect(topicScreenSource).toContain("type: 'content'");
    expect(topicScreenSource).toContain('data={topicListItems}');
  });

  it('does not keep unused status state for toast-only notifications', () => {
    expect(appSource).not.toContain('setStatus(message)');
    expect(appSource).not.toContain('const [, setStatus] = useState');
  });
});
