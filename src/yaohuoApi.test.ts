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
  it('fetches yaohuo feed from the Android device and parses HTML locally', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'));
    const serverFetcher = vi.fn();

    const result = await getYaohuoFeedDirect({
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
    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
    expect(serverFetcher).not.toHaveBeenCalled();
  });

  it('checks login with Android-fetched HTML and does not send the cookie to a server', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<html>ok</html>'));
    const serverFetcher = vi.fn();

    const result = await checkYaohuoLoginDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher,
      serverFetcher
    });

    expect(result.loginRequired).toBe(false);
    expect(serverFetcher).not.toHaveBeenCalled();
  });

  it('passes cancellation signals through direct yaohuo fetches', async () => {
    const controller = new AbortController();
    const yaohuoFetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response('<div class="listdata"></div>'));

    await getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher,
      signal: controller.signal
    });

    expect(yaohuoFetcher.mock.calls[0][1]).toEqual(expect.objectContaining({
      signal: expect.any(AbortSignal)
    }));
  });

  it('fetches yaohuo topic and replies from Android before local parsing', async () => {
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
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input.includes('book_re.aspx')) {
        return new Response('<div class="line1">[沙发] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>');
      }
      return new Response('<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(1)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>');
    });

    const detail = await getYaohuoTopicDirect({
      topic,
      yaohuoCookie: 'sidyaohuo=secret',
      replyLimit: 30,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenNthCalledWith(1, 'https://yaohuo.me/bbs-123.html', expect.any(Object));
    expect(yaohuoFetcher).toHaveBeenNthCalledWith(2, 'https://yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=1', expect.any(Object));
    expect(detail.replyCount).toBe(1);
    expect(detail.replies[0]).toMatchObject({ author: 'bob', floor: 1 });
  });

  it('fetches later reply pages from Android using the topic category id', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="line1">[1楼] reply</div>'));

    await getYaohuoRepliesDirect({
      id: '123',
      categoryId: '177',
      page: 3,
      limit: 30,
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith('https://yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=3', expect.any(Object));
  });

  it('surfaces yaohuo verification responses without clearing cookies', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<script>window.CAPTCHA_CONFIG={}</script>', {
      status: 200
    }));

    await expect(searchYaohuoDirect({
      query: '测试',
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });
});
