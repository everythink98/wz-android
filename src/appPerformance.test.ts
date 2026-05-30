import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('android-app', 'App.tsx');
const moreScreenSource = readProjectFile('android-app', 'src', 'screens', 'MoreScreen.tsx');
const topicScreenSource = readProjectFile('android-app', 'src', 'screens', 'TopicScreen.tsx');
const topicContentSplitSource = readProjectFile('android-app', 'src', 'topicContentSplit.ts');

describe('Android App performance guards', () => {
  it('cancels stale feed, search, topic, and backup/status requests before starting newer ones', () => {
    expect(appSource).toContain('feedAbortRef.current?.abort()');
    expect(appSource).toContain('searchAbortRef.current?.abort()');
    expect(appSource).toContain('topicAbortRef.current?.abort()');
    expect(appSource).toContain('backupAbortRef.current?.abort()');
    expect(appSource).toContain('statusAbortRef.current?.abort()');
    expect(appSource).toContain('signal: controller.signal');
  });

  it('loads combined feed and grouped search without the project server', () => {
    expect(appSource).toContain('Promise.allSettled');
    expect(appSource).toContain('mergeSettledFeedResponses');
    expect(appSource).toContain('activeSources.map');
    expect(appSource).toContain('setSearchGroups');
    expect(appSource).toContain('onRetrySearchSource');
  });

  it('loads local categories without the project server', () => {
    expect(appSource).toContain('const data = await getCategories({');
    expect(appSource).toContain("source: FeedSource = 'all'");
    expect(appSource).toContain('source,');
    expect(appSource).toContain('nocache: true');
    expect(appSource).toContain('signal: controller.signal');
    expect(appSource).not.toContain('baseCategoriesResult');
  });

  it('bypasses stale category caches when refreshing category metadata', () => {
    expect(appSource).toContain('const data = await getCategories({');
    expect(appSource).toContain('nocache: true');
    expect(appSource).not.toContain("getCategories({ serverUrl");
  });

  it('debounces reading progress persistence while scrolling long topics', () => {
    expect(appSource).toContain('pendingProgressRef');
    expect(appSource).toContain('progressSaveTimerRef');
    expect(appSource).toContain('setTimeout(() => {');
    expect(appSource).toContain('const next = updateProgress(readerDataRef.current, pending.topic, {');
    expect(appSource).toContain('saveReaderData(next)');
    expect(appSource).toContain('void persistReaderData(next);');
    expect(appSource).not.toContain('const next = updateProgress(readerDataRef.current, detail, { percent, scrollY })');
    expect(appSource).not.toContain('sanitizeReaderData(updateProgress');
  });

  it('keeps reader data save queue handling in one shared path', () => {
    expect(appSource).toContain('const persistReaderData = useCallback((next: ReaderData) => {');
    expect(appSource.match(/saveReaderData\(next\)/g) || []).toHaveLength(1);
  });

  it('keeps reader data commits outside React state updaters', () => {
    const block = appSource.match(/const commitReaderData = useCallback\(\(updater: \(current: ReaderData\) => ReaderData\) => \{([\s\S]*?)\n  \}, \[persistReaderData\]\);/)?.[1] || '';

    expect(block).toContain('const next = sanitizeReaderData(updater(readerDataRef.current));');
    expect(block).toContain('setReaderData(next);');
    expect(block).toContain('void persistReaderData(next);');
    expect(block).not.toContain('setReaderData((current)');
  });

  it('starts NodeSeek hidden WebView timeout only when a queued request starts', () => {
    const startBlock = appSource.match(/const startNextNodeSeekBrowserFetch = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';
    const fetchBlock = appSource.match(/const nodeSeekFetchWithWebView: Fetcher = useCallback\(\(input, init\) => \{([\s\S]*?)\n  \}, \[rejectNodeSeekBrowserFetch, startNextNodeSeekBrowserFetch\]\);/)?.[1] || '';

    expect(startBlock).toContain('next.timeout = setTimeout(() => {');
    expect(fetchBlock).not.toContain('setTimeout(() =>');
  });

  it('drops aborted NodeSeek hidden WebView requests before starting the next queued request', () => {
    const startBlock = appSource.match(/const startNextNodeSeekBrowserFetch = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/)?.[1] || '';

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
    expect(appSource).toContain('backupBusy={backupBusy}');
    expect(appSource).toContain('backupJson={backupJson}');
    expect(appSource).toContain('onBackupJsonChange={setBackupJson}');
  });

  it('cancels stale quoted floor requests when switching or leaving topics', () => {
    expect(appSource).toContain('quotedReplyAbortRefs');
    expect(appSource).toContain('abortQuotedReplyRequests();');
    expect(appSource).toContain('quotedReplyAbortRefs.current[key] = controller;');
    expect(appSource).toContain('signal: controller.signal');
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
