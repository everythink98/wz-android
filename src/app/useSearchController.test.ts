import { describe, expect, it } from 'vitest';
import { DEFAULT_SEARCH_FILTERS } from '../searchFilters';
import {
  createNodeSeekRetrySearchOptions,
  createSearchMoreRequestSnapshot,
  createSearchHistoryWriteQueue,
  enqueueSearchHistoryWrite,
  firstRemoteSearchAction,
  groupFromRemoteSearchResult,
  linuxDoAiFailureState,
  mergeLinuxDoAiTopics,
  remoteSearchActionForSource,
  snapshotSearchFilters,
  type RemoteSearchSourceResult
} from '../searchControllerResults';

describe('search controller result helpers', () => {
  it('keeps successful groups while surfacing the first required action', () => {
    const results: RemoteSearchSourceResult[] = [
      {
        kind: 'success',
        group: { source: 'v2ex', label: 'V2EX', items: [{ source: 'v2ex', id: '1', title: 'V2EX result', author: 'alice', url: 'https://www.v2ex.com/t/1', createdAt: '2026-06-21T00:00:00.000Z', replyCount: 0 }] }
      },
      {
        kind: 'action-required',
        action: { type: 'yaohuo-login', message: '妖火需要登录后使用此功能。' },
        group: { source: 'yaohuo', label: '妖火', items: [], error: '妖火需要登录后使用此功能。', hasMore: false, nextPage: null }
      }
    ];

    expect(results.map(groupFromRemoteSearchResult).map((group) => group.source)).toEqual(['v2ex', 'yaohuo']);
    expect(firstRemoteSearchAction(results)).toEqual({ type: 'yaohuo-login', message: '妖火需要登录后使用此功能。' });
  });

  it('does not auto-open login or verification panels for aggregated search', () => {
    const results: RemoteSearchSourceResult[] = [
      {
        kind: 'action-required',
        action: { type: 'nodeseek-verification', message: 'NodeSeek 需要验证' },
        group: { source: 'nodeseek', label: 'NodeSeek', items: [], error: 'NodeSeek 需要验证', hasMore: false, nextPage: null }
      }
    ];

    expect(remoteSearchActionForSource('all', results)).toBeUndefined();
    expect(remoteSearchActionForSource('nodeseek', results)).toEqual({ type: 'nodeseek-verification', message: 'NodeSeek 需要验证' });
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

  it('snapshots NodeSeek verification retry search inputs', () => {
    const filters = {
      v2ex: { source: 'v2ex' as const, sort: 'relevance' as const, timeRange: 'all' as const, node: '', username: '', operator: 'or' as const },
      linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo },
      nodeseek: { source: 'nodeseek' as const, category: 'tech', sort: 'replyTime' as const },
      yaohuo: { source: 'yaohuo' as const, category: '0' }
    };

    const retry = createNodeSeekRetrySearchOptions({
      filters,
      query: 'codex',
      searchSource: 'nodeseek'
    });
    filters.nodeseek.category = 'changed';

    expect(retry).toEqual({
      filters: {
        ...filters,
        nodeseek: { source: 'nodeseek', category: 'tech', sort: 'replyTime' }
      },
      query: 'codex',
      source: 'nodeseek',
      sourceOverride: 'nodeseek'
    });
  });

  it('uses the submitted query for search pagination', () => {
    const filters = {
      v2ex: { source: 'v2ex' as const, sort: 'relevance' as const, timeRange: 'all' as const, node: '', username: '', operator: 'or' as const },
      linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo },
      nodeseek: { source: 'nodeseek' as const, category: 'tech', sort: 'replyTime' as const },
      yaohuo: { source: 'yaohuo' as const, category: '0' }
    };

    expect(createSearchMoreRequestSnapshot({
      filters,
      page: 2,
      searchSource: 'nodeseek',
      source: 'nodeseek',
      submittedQuery: ' codex '
    })).toEqual({
      activeFilter: { source: 'nodeseek', category: 'tech', sort: 'replyTime' },
      ownerKey: 'search-more:nodeseek:codex:2:{"source":"nodeseek","category":"tech","sort":"replyTime"}',
      query: 'codex',
      sort: 'relevance',
      visitedKey: 'nodeseek:codex:{"source":"nodeseek","category":"tech","sort":"replyTime"}'
    });
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
    expect(linuxDoAiFailureState(Object.assign(new Error('forbidden'), { status: 403 }))).toEqual({
      status: 'unavailable',
      enabled: false,
      count: 0,
      message: '当前不可用'
    });
    expect(linuxDoAiFailureState(Object.assign(new Error('not found'), { statusCode: 404 }))).toEqual({
      status: 'unavailable',
      enabled: false,
      count: 0,
      message: '当前不可用'
    });
    expect(linuxDoAiFailureState(Object.assign(new Error('limited'), { status: 429 }))).toEqual({
      status: 'error',
      enabled: false,
      count: 0,
      message: 'AI 搜索失败，可重试'
    });
  });
});
