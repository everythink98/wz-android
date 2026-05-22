import { describe, expect, it, vi } from 'vitest';
import {
  getCategories,
  getFeed,
  getReply,
  getReplies,
  getTopic,
  parseYaohuoFeedHtml,
  parseYaohuoLoginHtml,
  parseYaohuoRepliesHtml,
  parseYaohuoSearchHtml,
  parseYaohuoTopicHtml,
  searchTopics
} from './forumApi';

describe('Android forum API client', () => {
  const topicDetail = {
    source: 'nodeseek',
    id: '723704',
    title: 'NodeSeek topic',
    author: 'alice',
    url: 'https://www.nodeseek.com/post-723704-1',
    createdAt: '2026-05-20T00:00:00.000Z',
    replyCount: 0,
    accessRequirement: {
      type: 'level',
      label: '需等级'
    },
    contentHtml: '<p>body</p>',
    replies: []
  };

  function endpointResponse(input: string) {
    if (input.includes('/api/topic/') && !input.includes('/replies')) {
      return topicDetail;
    }
    if (input.includes('/replies')) {
      return { items: [], hasMore: false, nextPage: null };
    }
    return { items: [], errors: {} };
  }

  function expectFetchCall(fetcher: ReturnType<typeof vi.fn>, index: number, url: string, init?: Partial<RequestInit>) {
    expect(fetcher.mock.calls[index - 1]?.[0]).toBe(url);
    if (init) {
      expect(fetcher.mock.calls[index - 1]?.[1]).toEqual(expect.objectContaining(init));
    }
    expect(fetcher.mock.calls[index - 1]?.[1]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal)
    }));
  }

  it('calls the server NodeSeek feed endpoint with pagination and category', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    await getFeed({
      serverUrl: ' http://192.168.1.23:3000/ ',
      source: 'nodeseek',
      page: 2,
      limit: 20,
      category: '日常',
      fetcher
    });

    expectFetchCall(fetcher, 1, 'http://192.168.1.23:3000/api/feed?source=nodeseek&limit=20&page=2&category=%E6%97%A5%E5%B8%B8');
  });

  it('passes caller cancellation signals to server requests', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({ items: [], errors: {} })));

    await getFeed({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      signal: controller.signal,
      fetcher
    });

    expect(fetcher.mock.calls[0][1]?.signal).toEqual(expect.any(AbortSignal));
  });

  it('calls categories, topic, replies, and search endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => new Response(JSON.stringify(endpointResponse(input))));

    await getCategories({ serverUrl: 'http://127.0.0.1:3000', source: 'nodeseek', fetcher });
    await getTopic({ serverUrl: 'http://127.0.0.1:3000', source: 'nodeseek', id: '723704', fetcher });
    await getReplies({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'nodeseek',
      id: '723704',
      page: 2,
      limit: 20,
      offset: 10,
      fetcher
    });
    await searchTopics({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'nodeseek',
      query: 'VPS',
      limit: 10,
      fetcher
    });

    expectFetchCall(fetcher, 1, 'http://127.0.0.1:3000/api/categories?source=nodeseek');
    expectFetchCall(fetcher, 2, 'http://127.0.0.1:3000/api/topic/nodeseek/723704');
    expectFetchCall(fetcher, 3, 'http://127.0.0.1:3000/api/topic/nodeseek/723704/replies?page=2&limit=20&offset=10');
    expectFetchCall(fetcher, 4, 'http://127.0.0.1:3000/api/search?q=VPS&source=nodeseek&limit=10');
  });

  it('can bypass cached category responses', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    await getCategories({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'nodeseek',
      nocache: true,
      fetcher
    });

    expectFetchCall(fetcher, 1, 'http://127.0.0.1:3000/api/categories?source=nodeseek&nocache=1');
  });

  it('calls generic three-source feed endpoints with page and cursor pagination', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    await getFeed({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      limit: 30,
      page: 3,
      cursor: 'v2ex:abc',
      fetcher
    });

    await getFeed({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      limit: 20,
      page: 2,
      category: 'dev',
      nocache: true,
      fetcher
    });

    expectFetchCall(fetcher, 1, 'http://127.0.0.1:3000/api/feed?source=all&limit=30&page=3&cursor=v2ex%3Aabc');
    expectFetchCall(fetcher, 2, 'http://127.0.0.1:3000/api/feed?source=linuxdo&limit=20&page=2&category=dev&nocache=1');
  });

  it('calls generic categories, topic, replies, and search endpoints for any source', async () => {
    const fetcher = vi.fn(async (input: string) => new Response(JSON.stringify(endpointResponse(input))));

    await getCategories({ serverUrl: 'http://127.0.0.1:3000', source: 'all', fetcher });
    await getTopic({ serverUrl: 'http://127.0.0.1:3000', source: 'v2ex', id: '1212603', nocache: true, fetcher });
    await getReplies({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      id: '42',
      page: 4,
      limit: 30,
      offset: 60,
      nocache: true,
      fetcher
    });
    await searchTopics({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      query: '  VPS  ',
      limit: 30,
      fetcher
    });

    expectFetchCall(fetcher, 1, 'http://127.0.0.1:3000/api/categories?source=all');
    expectFetchCall(fetcher, 2, 'http://127.0.0.1:3000/api/topic/v2ex/1212603?nocache=1');
    expectFetchCall(fetcher, 3, 'http://127.0.0.1:3000/api/topic/linuxdo/42/replies?page=4&limit=30&offset=60&nocache=1');
    expectFetchCall(fetcher, 4, 'http://127.0.0.1:3000/api/search?q=VPS&source=all&limit=30');
  });

  it('accepts topic access requirement metadata from the server', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(topicDetail)));

    const result = await getTopic({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'nodeseek',
      id: '723704',
      fetcher
    });

    expect(result.accessRequirement).toEqual({
      type: 'level',
      label: '需等级'
    });
  });

  it('posts yaohuo html to parser endpoints without sending cookies to the server', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    await parseYaohuoFeedHtml({
      serverUrl: 'http://127.0.0.1:3000',
      html: '<div class="listdata">妖火</div>',
      category: '177',
      url: 'https://yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&sid=-2&sidyaohuo=secret&sessionid=abc',
      page: 2,
      limit: 30,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/yaohuo/parse/feed', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html: '<div class="listdata">妖火</div>',
        category: '177',
        url: 'https://yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2',
        page: 2,
        limit: 30
      })
    }));
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain('sidyaohuo');
  });

  it('checks yaohuo login state from Android-fetched html without sending cookies to the server', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      source: 'yaohuo',
      ok: true,
      loginRequired: false,
      loginUrl: 'https://yaohuo.me/waplogin.aspx?siteid=1000'
    })));

    await parseYaohuoLoginHtml({
      serverUrl: 'http://127.0.0.1:3000',
      html: '<html>已登录</html>',
      url: 'https://yaohuo.me/wapindex.aspx?siteid=1000&sid=-2&sidyaohuo=secret',
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/yaohuo/parse/check-login', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        html: '<html>已登录</html>',
        url: 'https://yaohuo.me/wapindex.aspx?siteid=1000'
      })
    }));
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain('sidyaohuo');
  });

  it('strips yaohuo session URL parameters before every parser request', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.endsWith('/parse/topic')) {
        return new Response(JSON.stringify(topicDetail));
      }
      if (input.endsWith('/parse/replies')) {
        return new Response(JSON.stringify({ items: [], hasMore: false, nextPage: null }));
      }
      if (input.endsWith('/parse/check-login')) {
        return new Response(JSON.stringify({
          source: 'yaohuo',
          ok: true,
          loginRequired: false,
          loginUrl: 'https://yaohuo.me/waplogin.aspx?siteid=1000'
        }));
      }
      return new Response(JSON.stringify({ items: [], errors: {}, hasMore: false, nextPage: null }));
    });
    const url = 'https://yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&sid=-2&sidyaohuo=secret&session=abc&token=def';

    await parseYaohuoSearchHtml({ serverUrl: 'http://127.0.0.1:3000', html: '<html>search</html>', url, page: 1, fetcher });
    await parseYaohuoTopicHtml({ serverUrl: 'http://127.0.0.1:3000', html: '<html>topic</html>', id: '723704', url, fetcher });
    await parseYaohuoRepliesHtml({ serverUrl: 'http://127.0.0.1:3000', html: '<html>replies</html>', url, page: 1, fetcher });
    await parseYaohuoLoginHtml({ serverUrl: 'http://127.0.0.1:3000', html: '<html>login</html>', url, fetcher });

    for (const call of fetcher.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.url).toBe('https://yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000');
    }
  });

  it('does not send malformed yaohuo parser URLs that may contain session values', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({ items: [], errors: {} })));

    await parseYaohuoFeedHtml({
      serverUrl: 'http://127.0.0.1:3000',
      html: '<html>feed</html>',
      url: 'not a url?sidyaohuo=secret',
      page: 1,
      fetcher
    });

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));

    expect(body).not.toHaveProperty('url');
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain('sidyaohuo');
  });

  it('calls the single-reply endpoint for quoted floors', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      floor: 5,
      author: 'neo',
      contentHtml: '<p>quoted</p>',
      createdAt: '2026-05-20T00:00:00.000Z'
    })));

    await getReply({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      id: '2162836',
      floor: 5,
      nocache: true,
      fetcher
    });

    expectFetchCall(fetcher, 1, 'http://127.0.0.1:3000/api/topic/linuxdo/2162836/replies/5?nocache=1');
  });

  it('rejects malformed feed responses before the UI renders them', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: {} })));

    await expect(getFeed({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      fetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
  });

  it('rejects malformed feed metadata fields before the UI renders them', async () => {
    const invalidResponses = [
      { items: [], errors: [] },
      { items: [], errors: { nodeseek: 42 } },
      { items: [], errors: {}, hasMore: 'false' },
      { items: [], errors: {}, nextPage: '2' },
      { items: [], errors: {}, nextCursor: 3 }
    ];

    for (const body of invalidResponses) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(body)));
      await expect(getFeed({
        serverUrl: 'http://127.0.0.1:3000',
        source: 'all',
        fetcher
      })).rejects.toThrow('服务器返回数据格式不正确');
    }
  });

  it('rejects malformed topic and reply responses before the UI renders them', async () => {
    const topicFetcher = vi.fn(async () => new Response(JSON.stringify({
      id: '42',
      source: 'linuxdo',
      title: 'bad topic'
    })));
    const repliesFetcher = vi.fn(async () => new Response(JSON.stringify({
      hasMore: true,
      nextPage: 2
    })));

    await expect(getTopic({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      id: '42',
      fetcher: topicFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');

    await expect(getReplies({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      id: '42',
      page: 2,
      fetcher: repliesFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
  });

  it('rejects malformed topic and reply pagination metadata before the UI renders it', async () => {
    const topicFetcher = vi.fn(async () => new Response(JSON.stringify({
      ...topicDetail,
      replyHasMore: 'false'
    })));
    const repliesFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      hasMore: 'false',
      nextPage: null
    })));

    await expect(getTopic({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'nodeseek',
      id: '723704',
      fetcher: topicFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');

    await expect(getReplies({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      id: '42',
      page: 2,
      fetcher: repliesFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
  });

  it('rejects malformed optional topic and reply fields before the UI renders them', async () => {
    const invalidTopicBodies = [
      {
        ...topicDetail,
        replies: [{
          author: 'bob',
          contentHtml: '<p>reply</p>',
          createdAt: '2026-05-20T00:00:00.000Z',
          floor: 1,
          quotedFloors: {}
        }]
      },
      {
        ...topicDetail,
        voteOptions: 'bad'
      }
    ];

    for (const body of invalidTopicBodies) {
      const fetcher = vi.fn(async () => new Response(JSON.stringify(body)));
      await expect(getTopic({
        serverUrl: 'http://127.0.0.1:3000',
        source: 'nodeseek',
        id: '723704',
        fetcher
      })).rejects.toThrow('服务器返回数据格式不正确');
    }

    const repliesFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [{
        author: 'bob',
        contentHtml: '<p>reply</p>',
        createdAt: '2026-05-20T00:00:00.000Z',
        floor: 1,
        quotedFloors: 'bad'
      }],
      hasMore: false,
      nextPage: null
    })));

    await expect(getReplies({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'linuxdo',
      id: '42',
      page: 2,
      fetcher: repliesFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
  });

  it('rejects malformed category and search responses before the UI renders them', async () => {
    const categoriesFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [{ source: 'nodeseek', id: 'daily' }],
      errors: {}
    })));
    const searchFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [{ source: 'nodeseek', id: '1', title: 'bad' }],
      errors: {}
    })));

    await expect(getCategories({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      fetcher: categoriesFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');

    await expect(searchTopics({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      query: 'node',
      fetcher: searchFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
  });

  it('rejects malformed category and search error maps before the UI renders them', async () => {
    const categoriesFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      errors: []
    })));
    const searchFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      errors: { nodeseek: 42 }
    })));

    await expect(getCategories({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      fetcher: categoriesFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');

    await expect(searchTopics({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      query: 'node',
      fetcher: searchFetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
  });
});
