import { describe, expect, it, vi } from 'vitest';
import {
  getCategories,
  getFeed,
  getNodeSeekCategories,
  getNodeSeekFeed,
  getNodeSeekReplies,
  getNodeSeekSearch,
  getNodeSeekTopic,
  getReply,
  getReplies,
  getTopic,
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
    contentHtml: '<p>body</p>',
    replies: []
  };

  function endpointResponse(input: string) {
    if (input.includes('/api/topic/') && !input.includes('/replies')) {
      return topicDetail;
    }
    return { items: [], errors: {} };
  }

  it('calls the server NodeSeek feed endpoint with pagination and category', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    await getNodeSeekFeed({
      serverUrl: ' http://192.168.1.23:3000/ ',
      page: 2,
      limit: 20,
      category: '日常',
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('http://192.168.1.23:3000/api/feed?source=nodeseek&limit=20&page=2&category=%E6%97%A5%E5%B8%B8');
  });

  it('calls categories, topic, replies, and search endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => new Response(JSON.stringify(endpointResponse(input))));

    await getNodeSeekCategories({ serverUrl: 'http://127.0.0.1:3000', fetcher });
    await getNodeSeekTopic({ serverUrl: 'http://127.0.0.1:3000', id: '723704', fetcher });
    await getNodeSeekReplies({
      serverUrl: 'http://127.0.0.1:3000',
      id: '723704',
      page: 2,
      limit: 20,
      offset: 10,
      fetcher
    });
    await getNodeSeekSearch({
      serverUrl: 'http://127.0.0.1:3000',
      query: 'VPS',
      limit: 10,
      fetcher
    });

    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3000/api/categories?source=nodeseek');
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3000/api/topic/nodeseek/723704');
    expect(fetcher).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:3000/api/topic/nodeseek/723704/replies?page=2&limit=20&offset=10');
    expect(fetcher).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:3000/api/search?q=VPS&source=nodeseek&limit=10');
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

    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3000/api/feed?source=all&limit=30&page=3&cursor=v2ex%3Aabc');
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3000/api/feed?source=linuxdo&limit=20&page=2&category=dev&nocache=1');
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

    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3000/api/categories?source=all');
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3000/api/topic/v2ex/1212603?nocache=1');
    expect(fetcher).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:3000/api/topic/linuxdo/42/replies?page=4&limit=30&offset=60&nocache=1');
    expect(fetcher).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:3000/api/search?q=VPS&source=all&limit=30');
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

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/topic/linuxdo/2162836/replies/5?nocache=1');
  });

  it('rejects malformed feed responses before the UI renders them', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: {} })));

    await expect(getFeed({
      serverUrl: 'http://127.0.0.1:3000',
      source: 'all',
      fetcher
    })).rejects.toThrow('服务器返回数据格式不正确');
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
});
