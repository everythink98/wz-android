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

  it('does not keep unused status state for toast-only notifications', () => {
    expect(appSource).not.toContain('setStatus(message)');
    expect(appSource).not.toContain('const [, setStatus] = useState');
  });
});
