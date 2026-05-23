import { describe, expect, it, vi } from 'vitest';
import {
  checkYaohuoLoginDirect,
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from './yaohuoApi';
import { parseYaohuoListHtml, parseYaohuoRepliesHtml } from './localYaohuo';
import type { Topic } from './types';

describe('Android direct yaohuo API', () => {
  it('fetches yaohuo feed from the Android device and parses HTML locally', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'));

    const result = await getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      category: '177',
      page: 2,
      limit: 30,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&siteid=1000',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' })
      })
    );
    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
  });

  it('uses the default yaohuo class when category is blank', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'));

    await getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      category: '',
      page: 1,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=1&siteid=1000',
      expect.any(Object)
    );
  });

  it('does not keep paginating yaohuo HTML when no topics were parsed', () => {
    const result = parseYaohuoListHtml('<a href="/bbs/book_list.aspx?page=51">下一页</a>', {
      classId: '177',
      page: 50,
      limit: 30
    });

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
  });

  it('parses yaohuo compact numbered list rows', () => {
    const result = parseYaohuoListHtml(`
      <div class="title">【妖火论坛】</div>
      <div class="list">
        1.<a href="/bbs-1422771.html">忙了三四天，成亲了</a><br>
        2.<a href="/bbs-1423356.html">giffgaff卡免流教程</a><br>
      </div>
    `, {
      classId: '177',
      page: 1,
      limit: 30
    });

    expect(result.items.map((item) => item.title)).toEqual([
      '忙了三四天，成亲了',
      'giffgaff卡免流教程'
    ]);
  });

  it('parses current yaohuo listdata rows with multiple classes', () => {
    const result = parseYaohuoListHtml(`
      <!--listS-->
      <div class="listdata line1">1.<img src="/NetImages/file.gif" alt="附"/><a class="topic-link" href="/bbs-1539321.html">局停后应急方案</a><br/><span class="louzhunicheng">畫家李問</span>/<a class="topic-link" href="/bbs/book_re.aspx?actoin=class&amp;siteid=1000&amp;classid=177&amp;id=1539321&amp;getTotal=0&amp;lpage=1">0</a>回/39阅 <span class="right">今天 午夜<span></div>
      <div class="listdata line2">2.<a class="topic-link" href="/bbs-1539320.html">dnshe域名互助</a><br/><span class="louzhunicheng">冷眸阳少</span>/<a class="topic-link" href="/bbs/book_re.aspx?actoin=class&amp;siteid=1000&amp;classid=177&amp;id=1539320&amp;getTotal=0&amp;lpage=1">0</a>回/37阅 <span class="right">今天 午夜<span></div>
      <!--listE-->
    `, {
      classId: '177',
      page: 1,
      limit: 30
    });

    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({
      source: 'yaohuo',
      id: '1539321',
      title: '局停后应急方案',
      author: '畫家李問',
      categoryId: '177',
      category: '妖火茶馆',
      replyCount: 0,
      viewCount: 39
    })]));
  });

  it('rolls partial yaohuo dates back across a new-year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:30:00+08:00'));
    try {
      const result = parseYaohuoListHtml(`
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">跨年主题</a>/alice/阅1/12-31 23:50</div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">新年主题</a>/bob/阅1/01-01 00:10</div>
      `, {
        classId: '177',
        page: 1,
        limit: 30
      });

      expect(result.items.find((item) => item.id === '1539321')?.createdAt).toBe('2025-12-31T15:50:00.000Z');
      expect(result.items.find((item) => item.id === '1539322')?.createdAt).toBe('2025-12-31T16:10:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips yaohuo non-topic links that only contain unrelated numeric parameters', () => {
    const result = parseYaohuoListHtml(`
      <div class="listdata line1">
        <a class="topic-link" href="/bbs/view.aspx?classid=177&amp;siteid=1000">收藏入口</a>/alice/阅9/05-20 10:00
      </div>
    `, {
      classId: '177',
      page: 1,
      limit: 30
    });

    expect(result.items).toEqual([]);
  });

  it('does not parse slash-separated yaohuo numeric fields as views without the view marker', () => {
    const result = parseYaohuoListHtml(`
      <div class="listdata line1">
        <a class="topic-link" href="/bbs-1539321.html">妖火主题</a>/alice/10/100 <span class="right">05-20 10:00</span>
      </div>
    `, {
      classId: '177',
      page: 1,
      limit: 30
    });

    expect(result.items[0]).toMatchObject({
      id: '1539321',
      viewCount: undefined
    });
  });

  it('checks login with Android-fetched HTML and does not send the cookie to a server', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<html>ok</html>'));

    const result = await checkYaohuoLoginDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(result.loginRequired).toBe(false);
    expect(yaohuoFetcher).toHaveBeenCalledWith('https://yaohuo.me/wapindex.aspx?sid=-2', expect.any(Object));
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

  it('uses the page offset as the fallback floor for yaohuo replies without floor labels', () => {
    const result = parseYaohuoRepliesHtml('<div class="line1">回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>', {
      page: 3,
      limit: 30
    });

    expect(result.items[0]).toMatchObject({ author: 'bob', floor: 61 });
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

  it('surfaces non-200 yaohuo verification pages as verification errors', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<script>window.CAPTCHA_CONFIG={}</script>', {
      status: 403
    }));

    await expect(getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });
});
