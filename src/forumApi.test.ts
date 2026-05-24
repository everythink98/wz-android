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
import { clearV2exCacheForTest } from './localV2ex';

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
    expect(calls).toContain('https://www.nodeseek.com/categories/tech/page-2?sortBy=postTime');
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

  it('keeps all-source Android feed balanced across local source adapters', async () => {
    clearV2exCacheForTest();
    const manyNodeSeekTopics = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 4 }, (_, index) => ({
        postId: 200 + index,
        titleText: `NodeSeek ${index}`,
        titleLink: `/post-${200 + index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
      }))
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({
          topic_list: {
            topics: [{
              id: 301,
              title: 'linux.do topic',
              slug: 'linux-topic',
              created_at: '2026-05-19T00:00:00.000Z',
              bumped_at: '2026-05-19T00:00:00.000Z',
              posts_count: 1
            }]
          },
          users: []
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(JSON.stringify([{
          id: 401,
          title: 'V2EX topic',
          url: 'https://www.v2ex.com/t/401',
          created: '2026-05-18T00:00:00.000Z',
          replies: 0,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo' }
        }]), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/recent?p=1')) {
        return new Response('');
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await getFeed({ source: 'all', limit: 3, fetcher });

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'linuxdo', 'v2ex']);
  });

  it('keeps yaohuo facade fallbacks local without fetching', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });

    const feed = await getFeed({ source: 'yaohuo', fetcher });
    const categories = await getCategories({ source: 'yaohuo', fetcher });
    const search = await searchTopics({ source: 'yaohuo', query: 'test', fetcher });

    expect(feed).toMatchObject({ items: [], hasMore: false, nextPage: null });
    expect(feed.errors.yaohuo).toBe('请先登录妖火');
    expect(categories.items[0]).toMatchObject({ source: 'yaohuo' });
    expect(search).toMatchObject({ items: [] });
    expect(search.errors.yaohuo).toBe('请先登录妖火');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps overflow items available when paginating the aggregated Android feed', async () => {
    clearV2exCacheForTest();
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

  it('keeps NodeSeek next pages available in the aggregated Android feed when the first source page is shorter than the aggregate fetch window', async () => {
    clearV2exCacheForTest();
    const pageOne = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 201, titleText: 'NodeSeek page 1 newer', titleLink: '/post-201-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:01:00.000Z' } },
        { postId: 200, titleText: 'NodeSeek page 1 older', titleLink: '/post-200-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:00:00.000Z' } }
      ]
    })).toString('base64');
    const pageTwo = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 199, titleText: 'NodeSeek page 2 newer', titleLink: '/post-199-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:01:00.000Z' } },
        { postId: 198, titleText: 'NodeSeek page 2 older', titleLink: '/post-198-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:00:00.000Z' } }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/page-2')) {
        return new Response(`<script>${pageTwo}</script>`);
      }
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${pageOne}</script><a href="/page-2">下一页</a>`);
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

    expect(first.items.map((item) => item.id)).toEqual(['201', '200']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['199', '198']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.nodeseek.com/page-2');
  });

  it('keeps V2EX next pages available in the aggregated Android feed when latest JSON exactly fills one app page', async () => {
    clearV2exCacheForTest();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response('<script></script>');
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(JSON.stringify([
          { id: 301, title: 'V2EX latest newer', url: 'https://www.v2ex.com/t/301', created: 1780000100, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } },
          { id: 300, title: 'V2EX latest older', url: 'https://www.v2ex.com/t/300', created: 1780000000, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } }
        ]));
      }
      if (input.includes('/recent?p=1')) {
        return new Response(`
          <div class="cell"><a class="topic-link" href="/t/301#reply1">V2EX latest newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:01:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/300#reply1">V2EX latest older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:00:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/299#reply1">V2EX html newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-19 00:01:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/298#reply1">V2EX html older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-19 00:00:00"></span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['301', '300']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['299', '298']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('refills an exhausted source in the aggregated Android feed even when other source buffers can fill the page', async () => {
    clearV2exCacheForTest();
    const nodeSeekPage = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 400, titleText: 'NodeSeek newest', titleLink: '/post-400-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:04:30.000Z' } },
        { postId: 399, titleText: 'NodeSeek buffered newer', titleLink: '/post-399-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:03:00.000Z' } },
        { postId: 398, titleText: 'NodeSeek buffered older', titleLink: '/post-398-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:01:00.000Z' } },
        { postId: 397, titleText: 'NodeSeek buffered oldest', titleLink: '/post-397-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:00:00.000Z' } }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(JSON.stringify([
          { id: 501, title: 'V2EX latest newest', url: 'https://www.v2ex.com/t/501', created: 1780000500, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } },
          { id: 500, title: 'V2EX latest older', url: 'https://www.v2ex.com/t/500', created: 1780000400, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } }
        ]));
      }
      if (input.includes('/recent?p=1')) {
        return new Response(`
          <div class="cell"><a class="topic-link" href="/t/501#reply1">V2EX latest newest</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:05:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/500#reply1">V2EX latest older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:04:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/499#reply1">V2EX html newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:03:30"></span></div>
          <div class="cell"><a class="topic-link" href="/t/498#reply1">V2EX html older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:02:00"></span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:501', 'nodeseek:400']);
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:500', 'nodeseek:399']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });
});
