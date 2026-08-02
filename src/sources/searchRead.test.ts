import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { searchTopics } from './searchRead';

const nodeSeekPayload = Buffer.from(
  JSON.stringify({
    rotateTopics: [
      {
        postId: 1,
        titleText: 'NodeSeek',
        titleLink: '/post-1-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-20T00:00:00.000Z' }
      }
    ],
    allCategory: [{ key: 'tech', cn_text: '技术' }]
  })
).toString('base64');

describe('search read', () => {
  it('returns per-source errors for aggregated search instead of failing other sources', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPayload}</script>`);
      }
      throw new Error('upstream down');
    });

    const result = await searchTopics({ source: 'all', query: 'NodeSeek', fetcher });

    expect(result.items[0]).toMatchObject({ source: 'nodeseek', id: '1' });
    expect(result.errors.linuxdo).toBeTruthy();
    expect(result.errors.v2ex).toBeTruthy();
  });

  it('includes the registered yaohuo adapter in authenticated aggregate search', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('yaohuo.me')) {
        return new Response(
          '<div class="listdata"><a href="/bbs-321.html">妖火聚合结果</a>/alice/阅1/05-20 10:00</div>'
        );
      }
      throw new Error('other source unavailable');
    });

    const result = await searchTopics({
      source: 'all',
      query: '妖火聚合',
      fetcher
    });

    expect(result.items).toEqual([expect.objectContaining({ source: 'yaohuo', id: '321', title: '妖火聚合结果' })]);
  });

  it('orders all-source Android search by time without using the project search endpoint', async () => {
    const manyNodeSeekTopics = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 4 }, (_, index) => ({
          postId: 100 + index,
          titleText: `match NodeSeek ${index}`,
          titleLink: `/post-${100 + index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
        }))
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do/session/csrf.json')) {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }));
      }
      if (input.includes('linux.do/search?')) {
        return new Response(
          JSON.stringify({
            topics: [
              {
                id: 201,
                title: 'match linux.do',
                created_at: '2026-05-19T00:00:00.000Z',
                posts_count: 1
              }
            ],
            posts: []
          })
        );
      }
      if (input.includes('sov2ex.com')) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                _source: {
                  id: 301,
                  title: 'match V2EX',
                  member: 'neo',
                  created: '2026-05-18T00:00:00.000Z',
                  replies: 0
                }
              }
            ]
          })
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await searchTopics({
      source: 'all',
      query: 'match',
      limit: 6,
      fetcher,
      discourseAuth: {
        linuxdo: {
          authenticated: true,
          userAgent: 'LinuxDo WebView UA'
        }
      },
      linuxDoAuthenticated: true
    });

    expect(result.items.map((item) => item.source)).toEqual([
      'nodeseek',
      'nodeseek',
      'nodeseek',
      'nodeseek',
      'linuxdo',
      'v2ex'
    ]);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).not.toMatch(
      /127\.0\.0\.1(?::3000)?\/api\/search|10\.0\.2\.2(?::3000)?\/api\/search|localhost(?::3000)?\/api\/search/
    );
    expect(calls).not.toMatch(
      /127\.0\.0\.1(?::3000)?\/api\/yaohuo\/parse\/search|10\.0\.2\.2(?::3000)?\/api\/yaohuo\/parse\/search|localhost(?::3000)?\/api\/yaohuo\/parse\/search/
    );
  });

  it('orders all-source Android search by topic creation time newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(
          `<script>${Buffer.from(
            JSON.stringify({
              rotateTopics: [
                {
                  postId: 100,
                  titleText: 'match NodeSeek older',
                  titleLink: '/post-100-1',
                  op: { name: 'alice' },
                  time: { createdDate: '2026-05-19T00:00:00.000Z' }
                }
              ]
            })
          ).toString('base64')}</script>`
        );
      }
      if (input.includes('linux.do/session/csrf.json')) {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }));
      }
      if (input.includes('linux.do/search?')) {
        return new Response(
          JSON.stringify({
            topics: [
              {
                id: 201,
                title: 'match linux.do newest',
                created_at: '2026-05-21T00:00:00.000Z',
                bumped_at: '2026-05-18T00:00:00.000Z',
                posts_count: 1
              }
            ],
            posts: []
          })
        );
      }
      if (input.includes('sov2ex.com')) {
        return new Response(
          JSON.stringify({
            hits: [
              {
                _source: {
                  id: 301,
                  title: 'match V2EX middle',
                  member: 'neo',
                  created: '2026-05-20T00:00:00.000Z',
                  replies: 0
                }
              }
            ]
          })
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await searchTopics({
      source: 'all',
      query: 'match',
      limit: 3,
      fetcher,
      discourseAuth: {
        linuxdo: {
          authenticated: true,
          userAgent: 'LinuxDo WebView UA'
        }
      },
      linuxDoAuthenticated: true
    });

    expect(result.items.map((item) => item.source)).toEqual(['linuxdo', 'v2ex', 'nodeseek']);
  });
});
