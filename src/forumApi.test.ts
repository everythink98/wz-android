import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import { getCategories, getFeed, getReply, parseYaohuoFeedHtml, parseYaohuoLoginHtml, searchTopics } from './forumApi';

const nodeSeekPayload = Buffer.from(JSON.stringify({
  rotateTopics: [{ postId: 1, titleText: 'NodeSeek', titleLink: '/post-1-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:00:00.000Z' } }],
  allCategory: [{ key: 'tech', cn_text: '技术' }]
})).toString('base64');

describe('Android local forum facade', () => {
  it('routes feed and categories to public source sites, not the project server', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPayload}</script>`);
      }
      return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
        headers: { 'content-type': 'application/json' }
      });
    });

    await getFeed({ source: 'nodeseek', page: 2, category: 'tech', fetcher });
    await getCategories({ source: 'all', fetcher });

    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/categories/tech/page-2');
    expect(calls).not.toMatch(/127\.0\.0\.1:3000|10\.0\.2\.2|\/api\/feed|\/api\/categories/);
  });

  it('uses local yaohuo HTML parsing without posting HTML to a parser endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    const result = await parseYaohuoFeedHtml({
      html: '<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>',
      category: '177',
      page: 1,
      fetcher
    });
    const login = await parseYaohuoLoginHtml({ html: '<html>首页</html>', url: 'https://yaohuo.me/wapindex.aspx?sid=-2', fetcher });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
    expect(login.loginRequired).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps yaohuo verification and login-expired detection local', async () => {
    await expect(parseYaohuoFeedHtml({
      html: '<script>window.CAPTCHA_CONFIG={}</script>',
      url: 'https://yaohuo.me/bbs/book_list.aspx'
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });

  it('keeps single quoted-floor reads on linux.do public JSON endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/42.json')) {
        return new Response(JSON.stringify({
          id: 42,
          title: 'linux.do',
          created_at: '2026-05-20T00:00:00.000Z',
          post_stream: {
            stream: [100, 101],
            posts: [{ id: 101, post_number: 2, username: 'bob', cooked: '<p>quoted</p>', created_at: '2026-05-20T00:01:00.000Z' }]
          }
        }));
      }
      return new Response(JSON.stringify({ post_stream: { posts: [] } }));
    });

    const reply = await getReply({ source: 'linuxdo', id: '42', floor: 2, fetcher });

    expect(reply).toMatchObject({ author: 'bob', floor: 2 });
    expect(fetcher.mock.calls[0][0]).toBe('https://linux.do/t/42.json');
  });

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

  it('balances all-source Android search across local source adapters without using the project search endpoint', async () => {
    const manyNodeSeekTopics = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 4 }, (_, index) => ({
        postId: 100 + index,
        titleText: `match NodeSeek ${index}`,
        titleLink: `/post-${100 + index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
      }))
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do/search.json')) {
        return new Response(JSON.stringify({
          topics: [{
            id: 201,
            title: 'match linux.do',
            created_at: '2026-05-19T00:00:00.000Z',
            posts_count: 1
          }],
          posts: []
        }));
      }
      if (input.includes('sov2ex.com')) {
        return new Response(JSON.stringify({
          hits: [{
            _source: {
              id: 301,
              title: 'match V2EX',
              member: 'neo',
              created: '2026-05-18T00:00:00.000Z',
              replies: 0
            }
          }]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await searchTopics({ source: 'all', query: 'match', limit: 3, fetcher });

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'linuxdo', 'v2ex']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).not.toMatch(/127\.0\.0\.1(?::3000)?\/api\/search|10\.0\.2\.2(?::3000)?\/api\/search|localhost(?::3000)?\/api\/search/);
    expect(calls).not.toMatch(/127\.0\.0\.1(?::3000)?\/api\/yaohuo\/parse\/search|10\.0\.2\.2(?::3000)?\/api\/yaohuo\/parse\/search|localhost(?::3000)?\/api\/yaohuo\/parse\/search/);
  });

  it('keeps overflow items available when paginating the aggregated Android feed', async () => {
    const manyNodeSeekTopics = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 4 }, (_, index) => ({
        postId: 100 + index,
        titleText: `NodeSeek ${index + 1}`,
        titleLink: `/post-${100 + index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
      }))
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/page-2')) {
        return new Response('<script></script>');
      }
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' }
      });
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['103', '102']);
    expect(second.items.map((item) => item.id)).toEqual(['101', '100']);
    expect(second.items.every((item) => item.source === 'nodeseek')).toBe(true);
  });
});
