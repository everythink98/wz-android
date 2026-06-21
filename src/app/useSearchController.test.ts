import { describe, expect, it } from 'vitest';
import {
  createSearchHistoryWriteQueue,
  enqueueSearchHistoryWrite,
  firstRemoteSearchAction,
  groupFromRemoteSearchResult,
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
        action: { type: 'yaohuo-login', message: '请先登录妖火后再搜索。' },
        group: { source: 'yaohuo', label: '妖火', items: [], error: '请先登录妖火后再搜索。', hasMore: false, nextPage: null }
      }
    ];

    expect(results.map(groupFromRemoteSearchResult).map((group) => group.source)).toEqual(['v2ex', 'yaohuo']);
    expect(firstRemoteSearchAction(results)).toEqual({ type: 'yaohuo-login', message: '请先登录妖火后再搜索。' });
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
});
