import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_FILTERS } from '../searchFilters';
import {
  createSearchHistoryWriteQueue,
  enqueueSearchHistoryWrite,
  groupFromRemoteSearchResult,
  hasNextSearchPage,
  linuxDoAiFailureState,
  mergeLinuxDoAiTopics,
  snapshotSearchFilters,
  type RemoteSearchSourceResult
} from '../searchControllerResults';

describe('search controller result helpers', () => {
  it('keeps an undisplayed cached search page reachable and only rejects a repeated page', () => {
    expect(hasNextSearchPage(true, 3, 2)).toBe(true);
    expect(hasNextSearchPage(true, 2, 2)).toBe(false);
    expect(hasNextSearchPage(false, 3, 2)).toBe(false);
  });

  it('projects each remote result into its user-visible group', () => {
    const results: RemoteSearchSourceResult[] = [
      {
        kind: 'success',
        group: {
          source: 'v2ex',
          label: 'V2EX',
          items: [
            {
              source: 'v2ex',
              id: '1',
              title: 'V2EX result',
              author: 'alice',
              url: 'https://www.v2ex.com/t/1',
              createdAt: '2026-06-21T00:00:00.000Z',
              replyCount: 0
            }
          ]
        }
      },
      {
        kind: 'action-required',
        action: { type: 'yaohuo-login', message: '妖火需要登录后使用此功能。' },
        group: {
          source: 'yaohuo',
          label: '妖火',
          items: [],
          error: '妖火需要登录后使用此功能。',
          hasMore: false,
          nextPage: null
        }
      }
    ];

    expect(results.map(groupFromRemoteSearchResult).map((group) => group.source)).toEqual(['v2ex', 'yaohuo']);
  });

  it('serializes search history writes so the latest state wins', async () => {
    const queue = createSearchHistoryWriteQueue();
    const writes: string[] = [];
    const releaseFirstWrite = Promise.withResolvers<void>();
    const first = enqueueSearchHistoryWrite(queue, async () => {
      await releaseFirstWrite.promise;
      writes.push('with A');
    });
    const second = enqueueSearchHistoryWrite(queue, async () => {
      writes.push('without A');
    });

    releaseFirstWrite.resolve();
    await Promise.all([first, second]);

    expect(writes).toEqual(['with A', 'without A']);
  });

  it('REG-SEARCH-001 keeps submitted linux.do candidates independent from later drafts', () => {
    const filters = snapshotSearchFilters(DEFAULT_SEARCH_FILTERS);
    filters.linuxdo.tags.push('人工智能');
    filters.linuxdo.visited.push('seen');
    const submitted = snapshotSearchFilters(filters);

    filters.linuxdo.tags.push('快问快答');
    filters.linuxdo.visited.push('likes');

    expect(submitted.linuxdo.tags).toEqual(['人工智能']);
    expect(submitted.linuxdo.visited).toEqual(['seen']);
  });

  it('appends only new AI topics after standard linux.do results', () => {
    const standard = [
      { source: 'linuxdo' as const, id: '1', title: 'standard one', author: '', url: '', createdAt: '', replyCount: 0 },
      { source: 'linuxdo' as const, id: '2', title: 'standard two', author: '', url: '', createdAt: '', replyCount: 0 }
    ];
    const ai = [
      { ...standard[1], isAiGenerated: true },
      { ...standard[0], id: '3', title: 'AI only', isAiGenerated: true }
    ];

    expect(mergeLinuxDoAiTopics(standard, ai, true).map((topic) => topic.id)).toEqual(['1', '2', '3']);
    expect(mergeLinuxDoAiTopics(standard, ai, false)).toBe(standard);
  });

  it('separates unavailable AI search from retryable failures', () => {
    expect(linuxDoAiFailureState(Object.assign(new Error('forbidden'), { status: 403 }))).toMatchObject({
      status: 'unavailable',
      enabled: false,
      message: '当前不可用'
    });
    expect(linuxDoAiFailureState(Object.assign(new Error('limited'), { status: 429 }))).toMatchObject({
      status: 'error',
      enabled: false,
      message: 'AI 搜索失败，可重试'
    });
  });
});
