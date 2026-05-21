import { describe, expect, it, vi } from 'vitest';
import {
  checkYaohuoLoginDirect,
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from './yaohuoApi';
import type { Topic } from './types';

describe('Android direct yaohuo API', () => {
  it('fetches yaohuo feed from the Android device and sends only html to the server parser', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<html>feed</html>'));
    const serverFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null
    })));

    await getYaohuoFeedDirect({
      serverUrl: 'http://127.0.0.1:3000',
      yaohuoCookie: 'sidyaohuo=secret',
      category: '177',
      page: 2,
      limit: 30,
      yaohuoFetcher,
      serverFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&siteid=1000&getTotal=2021',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' })
      })
    );
    expect(serverFetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/yaohuo/parse/feed', expect.objectContaining({
      method: 'POST'
    }));
    expect(JSON.stringify(serverFetcher.mock.calls[0])).not.toContain('secret');
  });

  it('checks login with Android-fetched html and does not send the cookie to the server', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<html>ok</html>'));
    const serverFetcher = vi.fn(async () => new Response(JSON.stringify({
      source: 'yaohuo',
      ok: true,
      loginRequired: false,
      loginUrl: 'https://yaohuo.me/waplogin.aspx?siteid=1000'
    })));

    await checkYaohuoLoginDirect({
      serverUrl: 'http://127.0.0.1:3000',
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher,
      serverFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/wapindex.aspx?sid=-2',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' })
      })
    );
    expect(serverFetcher).toHaveBeenCalledWith('http://127.0.0.1:3000/api/yaohuo/parse/check-login', expect.objectContaining({
      method: 'POST'
    }));
    expect(JSON.stringify(serverFetcher.mock.calls[0])).not.toContain('secret');
  });

  it('fetches yaohuo topic and replies from Android before server parsing', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://yaohuo.me/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1,
      categoryId: '177'
    };
    const yaohuoFetcher = vi.fn(async () => new Response('<html>yaohuo</html>'));
    const serverFetcher = vi.fn(async (input: string) => {
      if (input.endsWith('/parse/topic')) {
        return new Response(JSON.stringify({
          ...topic,
          replyCount: 0,
          contentHtml: '<p>body</p>',
          replies: []
        }));
      }
      return new Response(JSON.stringify({
        items: [{ author: 'bob', contentHtml: '<p>reply</p>', createdAt: '2026-05-20T00:01:00.000Z' }],
        hasMore: false,
        nextPage: null
      }));
    });

    const detail = await getYaohuoTopicDirect({
      serverUrl: 'http://127.0.0.1:3000',
      topic,
      yaohuoCookie: 'sidyaohuo=secret',
      replyLimit: 30,
      yaohuoFetcher,
      serverFetcher
    });

    expect(yaohuoFetcher).toHaveBeenNthCalledWith(1, 'https://yaohuo.me/bbs-123.html', expect.any(Object));
    expect(yaohuoFetcher).toHaveBeenNthCalledWith(2, 'https://yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=1', expect.any(Object));
    expect(detail.replyCount).toBe(1);
    expect(detail.replies).toHaveLength(1);
    expect(detail.replyHasMore).toBe(false);
    expect(JSON.stringify(serverFetcher.mock.calls)).not.toContain('secret');
  });

  it('fetches later reply pages from Android using the topic category id', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<html>reply page</html>'));
    const serverFetcher = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      hasMore: false,
      nextPage: null
    })));

    await getYaohuoRepliesDirect({
      serverUrl: 'http://127.0.0.1:3000',
      id: '123',
      categoryId: '177',
      page: 3,
      limit: 30,
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher,
      serverFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith('https://yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=3', expect.any(Object));
    expect(JSON.stringify(serverFetcher.mock.calls)).not.toContain('secret');
  });

  it('surfaces yaohuo search login or verification responses from the parser without sending cookies to the server', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<script>window.CAPTCHA_CONFIG={}</script>', {
      status: 200
    }));
    const serverFetcher = vi.fn(async () => new Response(JSON.stringify({
      source: 'yaohuo',
      ok: false,
      loginRequired: true,
      reason: 'verification',
      loginUrl: 'https://yaohuo.me/waplogin.aspx?siteid=1000',
      message: '妖火需要完成访问验证，请在登录页完成验证后重试'
    }), { status: 401 }));

    await expect(searchYaohuoDirect({
      serverUrl: 'http://127.0.0.1:3000',
      query: '测试',
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher,
      serverFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list.aspx?action=search&type=title&key=%E6%B5%8B%E8%AF%95&classid=0&page=1&siteid=1000&getTotal=2021',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' })
      })
    );
    expect(JSON.stringify(serverFetcher.mock.calls)).not.toContain('secret');
  });
});
