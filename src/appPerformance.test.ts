import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');

describe('Android App performance guards', () => {
  it('cancels stale feed, search, topic, and sync requests before starting newer ones', () => {
    expect(appSource).toContain('feedAbortRef.current?.abort()');
    expect(appSource).toContain('searchAbortRef.current?.abort()');
    expect(appSource).toContain('topicAbortRef.current?.abort()');
    expect(appSource).toContain('syncAbortRef.current?.abort()');
    expect(appSource).toContain('signal: controller.signal');
  });

  it('loads yaohuo and the server aggregate in parallel for combined feed and search screens', () => {
    expect(appSource).toContain('Promise.allSettled');
    expect(appSource).toContain('mergeSettledFeedResponses');
    expect(appSource).toContain('mergeSettledSearchResponses');
  });

  it('loads server and Android-only categories in parallel', () => {
    expect(appSource).toContain('const [baseCategoriesResult, yaohuoCategoriesResult] = await Promise.allSettled');
  });

  it('bypasses stale category caches when refreshing category metadata', () => {
    expect(appSource).toContain("getCategories({ serverUrl, source: 'all', nocache: true, signal: controller.signal })");
    expect(appSource).toContain("getCategories({ serverUrl, source: 'yaohuo', nocache: true, signal: controller.signal })");
  });

  it('debounces reading progress persistence while scrolling long topics', () => {
    expect(appSource).toContain('progressSaveTimerRef');
    expect(appSource).toContain('setTimeout(() => {');
    expect(appSource).toContain('saveReaderData(readerDataRef.current)');
    expect(appSource).toContain('setReaderData(saved);');
    expect(appSource).toContain('const next = updateProgress(readerDataRef.current, detail, { percent, scrollY })');
    expect(appSource).not.toContain('sanitizeReaderData(updateProgress');
  });

  it('keeps reply render callbacks independent from global quote maps', () => {
    const renderReplyDeps = appSource.match(/const renderReplyItem = useCallback[\s\S]*?\), \[([\s\S]*?)\]\);/)?.[1] || '';

    expect(appSource).toContain('expandedQuotesRef');
    expect(appSource).toContain('loadedQuotedRepliesRef');
    expect(appSource).toContain('loadingQuotedFloorsRef');
    expect(renderReplyDeps).not.toMatch(/\bexpandedQuotes\b/);
    expect(renderReplyDeps).not.toMatch(/\bloadedQuotedReplies\b/);
    expect(renderReplyDeps).not.toMatch(/\bloadingQuotedFloors\b/);
  });

  it('keeps server URL typing separate from the saved active server URL', () => {
    expect(appSource).toContain('const [draftServerUrl, setDraftServerUrl] = useState');
    expect(appSource).toContain('normalizeServerUrl(draftServerUrl)');
    expect(appSource).toContain('setDraftServerUrl(savedServerUrl);');
    expect(appSource).toContain('draftServerUrl={draftServerUrl}');
    expect(appSource).toContain('onServerUrlChange={setDraftServerUrl}');
    expect(appSource).not.toContain('onServerUrlChange={setServerUrl}');
  });

  it('cancels stale quoted floor requests when switching or leaving topics', () => {
    expect(appSource).toContain('quotedReplyAbortRefs');
    expect(appSource).toContain('abortQuotedReplyRequests();');
    expect(appSource).toContain('quotedReplyAbortRefs.current[key] = controller;');
    expect(appSource).toContain('signal: controller.signal');
  });

  it('uses stable reply identifiers without falling back to list positions', () => {
    expect(appSource).toContain('function getReplyKey(reply: Reply)');
    expect(appSource).toContain('keyExtractor={topicListItemKey}');
    expect(appSource).not.toContain('keyExtractor={(reply, index) => `${reply.floor ?? index}-${reply.createdAt}`}');
  });

  it('renders long topic bodies as batched list items with replies', () => {
    expect(appSource).toContain('type TopicListItem');
    expect(appSource).toContain('function splitTopicContentHtml');
    expect(appSource).toContain("type: 'content'");
    expect(appSource).toContain('data={topicListItems}');
  });

  it('does not keep unused status state for toast-only notifications', () => {
    expect(appSource).not.toContain('setStatus(message)');
    expect(appSource).not.toContain('const [, setStatus] = useState');
  });
});
