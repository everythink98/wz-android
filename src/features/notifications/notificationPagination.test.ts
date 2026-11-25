import { describe, expect, it } from 'vitest';
import type { ForumNotification } from '@/domain/notifications/models';
import {
  commitNotificationSourceRetry,
  findNotificationSourceRetryTarget,
  resolveNotificationNextPage,
  retainNotificationSourceChains,
  type NotificationListPage,
  type NotificationPageParam
} from './notificationPagination';

describe('notification pagination', () => {
  it.each(['refresh', 'partial retry', 'complete retry'] as const)(
    'keeps a newer row when %s overlaps a retained page',
    (read) => {
      const old: ForumNotification = {
        source: 'linuxdo',
        id: 'moved',
        kind: 'reply',
        actor: { name: 'author' },
        title: 'old',
        createdAt: null,
        unread: true,
        target: { type: 'information' }
      };
      const updated = { ...old, title: 'new', unread: false };
      const other = { ...old, source: 'nodeseek' as const };
      const retained = { ...old, id: 'retained' };
      const error = { kind: 'ordinary' as const, message: '部分消息内容无法解析' };
      const failure = { pageIndex: 0, error, seq: 1 };
      const cached = {
        pages: [
          {
            items: [other],
            errors: { linuxdo: error },
            hasMore: true,
            nextPage: { allCursors: { linuxdo: '20' } },
            retryTargets: { linuxdo: { seq: 1 } }
          },
          {
            items: [old, retained],
            errors: {},
            hasMore: true,
            nextPage: { allCursors: { linuxdo: '40' } }
          }
        ],
        pageParams: [{}, { allCursors: { linuxdo: '20' } }]
      };
      const result =
        read === 'refresh'
          ? retainNotificationSourceChains(
              cached,
              { pages: [{ ...cached.pages[0]!, items: [updated, other] }], pageParams: [{}] },
              new Map([['linuxdo', 0]]),
              new Map([['linuxdo', failure]])
            )
          : commitNotificationSourceRetry(cached, findNotificationSourceRetryTarget(cached, 'all', 'linuxdo'), {
              page: {
                items: [updated],
                cursor: '20',
                hasMore: true,
                quality: read === 'partial retry' ? 'partial' : 'complete'
              },
              ...(read === 'partial retry' ? { error } : {})
            });

      expect(result?.pages[0]?.items).toHaveLength(2);
      expect(result?.pages[0]?.items).toEqual(expect.arrayContaining([updated, other]));
      expect(result?.pages[1]?.items).toEqual([retained]);
      expect(result?.pages[1]?.nextPage.allCursors?.linuxdo).toBe('40');
      expect(result?.pageParams).toEqual(cached.pageParams);
    }
  );

  it('merges another partial source page without losing valid messages or advancing that source', () => {
    const item = (source: ForumNotification['source'], id: string): ForumNotification => ({
      source,
      id,
      kind: 'reply',
      actor: { name: 'author' },
      title: id,
      createdAt: null,
      unread: true,
      target: { type: 'information' }
    });
    const known = item('linuxdo', 'known');
    const next = item('linuxdo', 'new');
    const other = item('nodeseek', 'other');
    const error = { kind: 'ordinary' as const, message: '部分消息内容无法解析', retryable: true };
    const cached = {
      pages: [
        {
          items: [known, other],
          errors: { linuxdo: error },
          hasMore: true,
          nextPage: { allCursors: { linuxdo: null, nodeseek: '30' } }
        }
      ],
      pageParams: [{}]
    };
    const target = findNotificationSourceRetryTarget(cached, 'all', 'linuxdo');
    const result = commitNotificationSourceRetry(cached, target, {
      page: { items: [next], cursor: '24', hasMore: true, quality: 'partial' },
      error
    });

    expect(result?.pages[0]?.items).toEqual(expect.arrayContaining([known, next, other]));
    expect(result?.pages[0]?.items).toHaveLength(3);
    expect(result?.pages[0]?.nextPage).toEqual(cached.pages[0]?.nextPage);
    expect(findNotificationSourceRetryTarget(result, 'all', 'linuxdo')).toEqual(target);
  });

  it('preserves the actual failed refreshed cursor independently of retained rows', () => {
    const page = (allCursors: NotificationPageParam['allCursors']): NotificationListPage => ({
      items: [],
      errors: {},
      hasMore: Object.values(allCursors ?? {}).some((cursor) => cursor != null),
      nextPage: { allCursors }
    });
    const error = { kind: 'ordinary' as const, message: 'linux.do unreadable page' };
    const result = retainNotificationSourceChains(
      {
        pages: [page({ linuxdo: null, nodeseek: 'ns:old2' }), page({ linuxdo: null, nodeseek: null })],
        pageParams: [{}, { allCursors: { linuxdo: null, nodeseek: 'ns:old2' } }]
      },
      {
        pages: [page({ linuxdo: 'ld:new2', nodeseek: 'ns:new2' }), page({ nodeseek: 'ns:new3' })],
        pageParams: [{}, { allCursors: { linuxdo: 'ld:new2', nodeseek: 'ns:new2' } }]
      },
      new Map([['linuxdo', 0]]),
      new Map([['linuxdo', { pageIndex: 1, error, cursor: 'ld:new2', seq: 1 }]])
    );

    expect(result.pages[0]?.errors.linuxdo).toBeUndefined();
    expect(result.pages[1]?.errors.linuxdo).toBe(error);
    expect(result.pages[1]?.retryTargets?.linuxdo).toEqual({ cursor: 'ld:new2', seq: 1 });
    expect(result.pages[1]?.nextPage.allCursors).toEqual({ linuxdo: null, nodeseek: 'ns:new3' });
    expect(result.pageParams[1]?.allCursors).toEqual({ linuxdo: null, nodeseek: 'ns:new2' });
  });

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
