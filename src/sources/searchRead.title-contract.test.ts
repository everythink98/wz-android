import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('@/sources/v2ex/search', () => ({
  searchV2ex: vi.fn(async () => ({
    items: [
      {
        source: 'v2ex',
        id: 'blank-title',
        title: '   ',
        author: 'tester',
        url: 'https://www.v2ex.com/t/blank-title',
        createdAt: '2026-08-06T00:00:00.000Z',
        lastReplyAt: '2026-08-06T00:00:00.000Z',
        replyCount: 0
      }
    ],
    errors: {},
    hasMore: false,
    nextPage: null
  }))
}));

import { searchTopics } from './searchRead';

describe('search title contract', () => {
  it('rejects blank titles at the searchRead boundary', async () => {
    await expect(searchTopics({ source: 'v2ex', query: 'codex' })).rejects.toThrow('搜索结果缺少标题');
  });
});
