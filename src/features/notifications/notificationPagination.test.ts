import { describe, expect, it } from 'vitest';
import { resolveNotificationNextPage, type NotificationPageParam } from './notificationPagination';

describe('notification pagination', () => {
  it('stops a source when its cursor cycles back to an already consumed page', () => {
    expect(
      resolveNotificationNextPage({
        source: 'yaohuo',
        hasMore: true,
        nextPage: { sourceCursor: 'A' },
        consumedPages: [{}, { sourceCursor: 'A' }, { sourceCursor: 'B' }]
      })
    ).toEqual({ nextPage: undefined, repeatedSources: ['yaohuo'] });
  });

  it('continues unfinished aggregate sources while stopping a source whose cursor repeats', () => {
    const nextPage: NotificationPageParam = { allCursors: { nodeseek: 'A', linuxdo: '90', yaohuo: null } };
    expect(
      resolveNotificationNextPage({
        source: 'all',
        hasMore: true,
        nextPage,
        consumedPages: [
          {},
          { allCursors: { nodeseek: 'A', linuxdo: '30', yaohuo: null } },
          { allCursors: { nodeseek: 'B', linuxdo: '60', yaohuo: null } }
        ]
      })
    ).toEqual({
      nextPage: { allCursors: { nodeseek: null, linuxdo: '90', yaohuo: null } },
      repeatedSources: ['nodeseek']
    });
    expect(nextPage.allCursors?.nodeseek).toBe('A');
  });

  it('finishes aggregate pagination when every remaining source repeats or has ended', () => {
    expect(
      resolveNotificationNextPage({
        source: 'all',
        hasMore: true,
        nextPage: { allCursors: { nodeseek: 'A', linuxdo: 'B', yaohuo: null } },
        consumedPages: [{ allCursors: { nodeseek: 'A', linuxdo: 'B' } }]
      })
    ).toEqual({ nextPage: undefined, repeatedSources: ['nodeseek', 'linuxdo'] });
  });

  it.each([undefined, null, ''])('does not continue a missing or ended cursor %s', (cursor) => {
    for (const source of ['nodeseek', 'all'] as const) {
      expect(
        resolveNotificationNextPage({
          source,
          hasMore: true,
          nextPage: { sourceCursor: cursor, allCursors: { nodeseek: cursor } },
          consumedPages: [{}]
        })
      ).toEqual({ nextPage: undefined, repeatedSources: [] });
    }
  });

  it('does not confuse equal cursor values belonging to different sources', () => {
    expect(
      resolveNotificationNextPage({
        source: 'all',
        hasMore: true,
        nextPage: { allCursors: { nodeseek: null, linuxdo: 'shared' } },
        consumedPages: [{ allCursors: { nodeseek: 'shared', linuxdo: 'previous' } }]
      })
    ).toEqual({ nextPage: { allCursors: { nodeseek: null, linuxdo: 'shared' } }, repeatedSources: [] });
  });

  it('follows a new single-source cursor and respects the source end marker', () => {
    const nextPage = { sourceCursor: 'next' };
    const consumedPages = [{ sourceCursor: 'previous' }];
    expect(resolveNotificationNextPage({ source: 'nodeseek', hasMore: true, nextPage, consumedPages })).toEqual({
      nextPage,
      repeatedSources: []
    });
    expect(resolveNotificationNextPage({ source: 'nodeseek', hasMore: false, nextPage, consumedPages })).toEqual({
      nextPage: undefined,
      repeatedSources: []
    });
  });
});
