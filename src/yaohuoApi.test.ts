import { describe, expect, it, vi } from 'vitest';
import {
  checkYaohuoLoginDirect,
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from './yaohuoApi';
import { parseYaohuoListHtml, parseYaohuoRepliesHtml, parseYaohuoSearchHtml, parseYaohuoTopicHtml } from './localYaohuo';
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

  it('uses the all-category yaohuo feed when category is blank', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'));

    await getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      category: '',
      page: 1,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list.aspx?gettotal=2025&action=new',
      expect.any(Object)
    );
  });

  it('keeps all-category yaohuo pagination on the all feed URL', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'));

    await getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      page: 2,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list.aspx?gettotal=2025&action=new&page=2',
      expect.any(Object)
    );
  });

  it('keeps yaohuo search pagination metadata', () => {
    const result = parseYaohuoSearchHtml(`
      <div class="listdata"><a href="/bbs-123.html">搜索结果</a>/alice/阅1/05-20 10:00</div>
      <a href="/bbs/book_list.aspx?action=search&page=2">下一页</a>
    `, {
      page: 1,
      limit: 1
    });

    expect(result.items.map((item) => item.id)).toEqual(['123']);
    expect(result.hasMore).toBe(true);
    expect(result.nextPage).toBe(2);
  });

  it('keeps yaohuo search results returned by the official page without local keyword filtering', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response(`
      <div class="listdata"><a href="/bbs-321.html">安卓手机免流设置</a>/alice/阅1/05-20 10:00</div>
      <div class="listdata"><a href="/bbs-322.html">怎么把别的设备消息转过来？</a>/bob/阅1/05-19 10:00</div>
    `));

    const result = await searchYaohuoDirect({
      query: '安卓手机免',
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(result.items.map((item) => item.id)).toEqual(['321', '322']);
  });

  it('keeps the selected yaohuo board on search results when the result link omits classid', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response(`
      <div class="listdata"><a href="/bbs-321.html">妖火茶馆搜索结果</a>/alice/阅1/05-20 10:00</div>
    `));

    const result = await searchYaohuoDirect({
      query: '茶馆',
      category: '177',
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(result.items[0]).toMatchObject({
      id: '321',
      categoryId: '177',
      category: '妖火茶馆'
    });
  });

  it('keeps yaohuo search results in the official page order while parsing times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T01:00:00+08:00'));
    try {
      const result = parseYaohuoSearchHtml(`
        <div class="listdata line1"><a href="/bbs-1539321.html">旧搜索结果</a>/alice/阅1 <span class="right">昨天 00:05</span></div>
        <div class="listdata line2"><a href="/bbs-1539322.html">新搜索结果</a>/bob/阅1 <span class="right">今天 23:50</span></div>
        <div class="listdata line1"><a href="/bbs-1539323.html">下午搜索结果</a>/carol/阅1 <span class="right">下午 3:20</span></div>
      `, {
        page: 1,
        limit: 30
      });

      expect(result.items.map((item) => item.id)).toEqual(['1539321', '1539322', '1539323']);
      expect(result.items[0].createdAt).toBe('2026-05-23T16:05:00.000Z');
      expect(result.items[1].createdAt).toBe('2026-05-25T15:50:00.000Z');
      expect(result.items[2].createdAt).toBe('2026-05-25T07:20:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches later yaohuo search pages through the search pagination endpoint', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-456.html">第二页结果</a>/alice/阅1/05-20 10:00</div>'));

    const result = await searchYaohuoDirect({
      query: '免流',
      page: 2,
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://yaohuo.me/bbs/book_list_search.aspx?action=search&type=title&key=%E5%85%8D%E6%B5%81&classid=0&page=2&siteid=1000&getTotal=2021',
      expect.any(Object)
    );
    expect(result.items[0]).toMatchObject({ id: '456', title: '第二页结果' });
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

  it('ignores off-site links that look like yaohuo topic links', () => {
    const result = parseYaohuoListHtml(`
      <div class="listdata"><a href="https://evil.example/bbs-1539321.html">伪主题</a>/alice/阅1/05-20 10:00</div>
      <div class="listdata"><a href="/bbs-1539322.html">站内主题</a>/bob/阅1/05-20 10:01</div>
    `, {
      classId: '177',
      page: 1,
      limit: 30
    });

    expect(result.items.map((item) => item.id)).toEqual(['1539322']);
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

  it('parses yaohuo relative list times as real Beijing times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T01:00:00+08:00'));
    try {
      const result = parseYaohuoListHtml(`
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">午夜主题</a>/alice/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">深夜主题</a>/bob/阅1 <span class="right">今天 23:50</span></div>
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539323.html">昨天主题</a>/carol/阅1 <span class="right">昨天 00:05</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539324.html">下午主题</a>/dave/阅1 <span class="right">下午 3:20</span></div>
      `, {
        page: 1,
        limit: 30
      });

      expect(result.items.find((item) => item.id === '1539321')?.createdAt).toBe('2026-05-24T16:00:00.000Z');
      expect(result.items.find((item) => item.id === '1539322')?.createdAt).toBe('2026-05-25T15:50:00.000Z');
      expect(result.items.find((item) => item.id === '1539323')?.createdAt).toBe('2026-05-23T16:05:00.000Z');
      expect(result.items.find((item) => item.id === '1539324')?.createdAt).toBe('2026-05-25T07:20:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses one Beijing clock snapshot for all rows in a single yaohuo list parse', () => {
    const firstNow = new Date('2026-05-25T01:00:00+08:00').getTime();
    const secondNow = new Date('2026-05-26T01:00:00+08:00').getTime();
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(firstNow)
      .mockReturnValueOnce(secondNow)
      .mockReturnValue(secondNow);
    try {
      const result = parseYaohuoListHtml(`
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">第一条</a>/alice/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">第二条</a>/bob/阅1 <span class="right">今天 午夜</span></div>
      `, {
        page: 1,
        limit: 30
      });

      expect(result.items.find((item) => item.id === '1539321')?.createdAt).toBe('2026-05-24T16:00:00.000Z');
      expect(result.items.find((item) => item.id === '1539322')?.createdAt).toBe('2026-05-24T16:00:00.000Z');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('sorts yaohuo list rows by newest real time and keeps equal-time rows in source order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T01:00:00+08:00'));
    try {
      const result = parseYaohuoListHtml(`
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">第一条同时间</a>/alice/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">第二条同时间</a>/bob/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539323.html">更新主题</a>/carol/阅1 <span class="right">今天 23:50</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539324.html">旧主题</a>/dave/阅1 <span class="right">昨天 00:05</span></div>
      `, {
        page: 1,
        limit: 30
      });

      expect(result.items.map((item) => item.id)).toEqual(['1539323', '1539321', '1539322', '1539324']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses yaohuo class ids from list row links before falling back to the selected class', () => {
    const result = parseYaohuoListHtml(`
      <div class="listdata line1">
        <a class="topic-link" href="/bbs-1539321.html">悬赏主题</a>/alice/
        <a href="/bbs/book_re.aspx?classid=213&amp;id=1539321">0</a>回/1阅 <span class="right">05-20 10:00</span>
      </div>
    `, {
      page: 1,
      limit: 30
    });

    expect(result.items[0]).toMatchObject({
      id: '1539321',
      categoryId: '213',
      category: '悬赏问答'
    });
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

  it('uses Beijing time to infer partial yaohuo dates when the device month is still last year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-12-31T16:30:00.000Z'));
    const yearSpy = vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2025);
    const monthSpy = vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(11);
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
      yearSpy.mockRestore();
      monthSpy.mockRestore();
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

  it('uses mobile browser-like headers for yaohuo read requests', async () => {
    const yaohuoFetcher = vi.fn(async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'));

    await getYaohuoFeedDirect({
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      credentials: 'include',
      redirect: 'follow',
      headers: expect.objectContaining({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Cookie: 'sidyaohuo=secret',
        Referer: 'https://yaohuo.me/bbs/',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': expect.stringContaining('Android')
      })
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

  it('does not send yaohuo cookies to an off-site topic url', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://evil.example/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1,
      categoryId: '177'
    };
    const yaohuoFetcher = vi.fn(async () => new Response(''));

    await expect(getYaohuoTopicDirect({
      topic,
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    })).rejects.toThrow('妖火链接不属于 yaohuo.me');

    expect(yaohuoFetcher).not.toHaveBeenCalled();
  });

  it('keeps the list category when yaohuo topic detail omits class links', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '456',
      title: '妖火资源帖',
      author: 'alice',
      url: 'https://yaohuo.me/bbs-456.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 0,
      categoryId: '201',
      category: '资源分享'
    };
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input.includes('book_re.aspx')) {
        return new Response('');
      }
      return new Response('<div class="content">[标题] 妖火资源帖 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>');
    });

    const detail = await getYaohuoTopicDirect({
      topic,
      yaohuoCookie: 'sidyaohuo=secret',
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenNthCalledWith(2, 'https://yaohuo.me/bbs/book_re.aspx?id=456&classid=201&page=1', expect.any(Object));
    expect(detail).toMatchObject({
      categoryId: '201',
      category: '资源分享'
    });
  });

  it('maps yaohuo vote options to unified polls with state', () => {
    const detail = parseYaohuoTopicHtml(`
      <div class="content">[标题] 妖火投票 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>
      <div class="toupiao">
        <a href="/bbs/book_view_toVote.aspx?vid=55">[投票] 选项 A (2)</a><br>
        <a href="/bbs/book_view_toVote.aspx?vid=56">[已投] 选项 B (5)</a>
      </div>
      <span>已投票</span>
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `, {
      id: '123',
      url: 'https://yaohuo.me/bbs-123.html'
    });

    expect(detail.polls).toEqual([{
      id: 'yaohuo-123',
      title: '投票',
      voted: true,
      closed: false,
      multiple: false,
      options: [
        { id: '55', label: '选项 A', count: 2, selected: false },
        { id: '56', label: '选项 B', count: 5, selected: true }
      ]
    }]);
  });

  it('maps yaohuo vote options wrapped in block elements with vote suffix counts', () => {
    const detail = parseYaohuoTopicHtml(`
      <div class="content">[标题] 妖火投票 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>
      <div class="toupiao">
        <p><a href="/bbs/book_view_toVote.aspx?vid=55">[投票] 选项 A（2）</a></p>
        <ul><li><a href="/bbs/book_view_toVote.aspx?vid=56">[投票] 选项 B(3票)</a></li></ul>
      </div>
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `, {
      id: '123',
      url: 'https://yaohuo.me/bbs-123.html'
    });

    expect(detail.polls?.[0].options).toEqual([
      { id: '55', label: '选项 A', count: 2, selected: false },
      { id: '56', label: '选项 B', count: 3, selected: false }
    ]);
  });

  it('maps yaohuo multi-choice polls to selectable polls with choice limits', () => {
    const detail = parseYaohuoTopicHtml(`
      <div class="content">[标题] 妖火多选投票 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS--><p>多选，可选2项</p><!--listE--></div>
      <div class="toupiao">
        <a href="/bbs/book_view_toVote.aspx?vid=55">[投票] 选项 A (2)</a><br>
        <a href="/bbs/book_view_toVote.aspx?vid=56">[投票] 选项 B (5)</a>
      </div>
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `, {
      id: '123',
      url: 'https://yaohuo.me/bbs-123.html'
    });

    expect(detail.polls?.[0]).toMatchObject({
      id: 'yaohuo-123',
      multiple: true,
      max: 2
    });
    expect(detail.polls?.[0]).not.toHaveProperty('readonly');
  });

  it('keeps yaohuo resource download content rendered outside the main post block', () => {
    const detail = parseYaohuoTopicHtml(`
      <div class="content">[标题] 软件资源 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent">
        <!--listS--><p>软件说明</p><!--listE-->
      </div>
      <div class="intro">版本介绍：免登录使用修图特权。</div>
      <div class="download">下载地址：<a href="https://pan.quark.cn/s/abc">夸克网盘</a><br>提取码：1234</div>
      更多回帖(1)
      <a href="/bbs/book_list.aspx?classid=201">资源分享</a>
    `, {
      id: '456',
      url: 'https://yaohuo.me/bbs-456.html'
    });

    expect(detail.contentHtml).toContain('软件说明');
    expect(detail.contentHtml).toContain('版本介绍：免登录使用修图特权。');
    expect(detail.contentHtml).toContain('下载地址');
    expect(detail.contentHtml).toContain('夸克网盘');
    expect(detail.contentHtml).toContain('提取码：1234');
    expect(detail.contentHtml).toContain('https://pan.quark.cn/s/abc');
    expect(detail.contentHtml).not.toContain('更多回帖');
  });

  it('keeps yaohuo activity reward status in topic content', () => {
    const detail = parseYaohuoTopicHtml(`
      <div class="rectangle-container">
        <div class="notification-text"><i><svg></svg></i><span><span>派币</span><span>550000</span>已结束</span></div>
      </div>
      <div id="book-view-content" class="content">
        <div class="paibi"><span class="lijin">礼金</span><span class="lijinshuzi">550000</span><span class="meiren">每人</span><span class="meirenshuzi">200</span><span class="shengyu">(<span>余</span><span>0</span>)</span></div>
        <div class="Postinfo"><span>[标题]</span>49元开京东Plus会员<span>(阅45708)</span><br><span>[时间]<span>2025-10-28 01:20</span></span><span id="stamp-badge">获赏<span>1586</span></span></div>
        <div class="bbscontent"><!--listS-->618期间开通双倍积分哦！<!--listE--></div>
      </div>
    `, {
      id: '1478784',
      url: 'https://yaohuo.me/bbs-1478784.html'
    });

    expect(detail).toMatchObject({
      title: '49元开京东Plus会员',
      viewCount: 45708
    });
    expect(detail.contentHtml).toContain('派币 550000 已结束');
    expect(detail.contentHtml).toContain('礼金 550000 每人 200');
    expect(detail.contentHtml).toContain('获赏 1586');
    expect(detail.contentHtml).toContain('618期间开通双倍积分哦！');
    expect(detail.contentHtml).toContain('<blockquote>');
    expect(detail.contentHtml).not.toContain('<svg');
  });

  it('keeps yaohuo markdown resource body when the bbscontent wrapper is malformed', () => {
    const detail = parseYaohuoTopicHtml(`
      <div id="book-view-content" class="content">
        <div class="Postinfo"><span>[标题]</span>Hypic醒图国际版 v8.7.0 免登录使用所有特权<span>(阅276)</span><br/><span>[时间]<span>2026-05-28 16:54</span></span></div>
        <div class="dashed"></div>
        <div class="bbscontent"><!--listS-->
          <div class="markdown-container">
            <h1 id="hypic">Hypic 醒图国际版</h1>
            <h2 id="section">应用简介</h2>
            <p>Hypic（醒图国际版）是一款功能强大的专业照片编辑应用。</p>
            <h2 id="section-1">版本特色</h2>
            <ul>
              <li><strong>解锁会员</strong>：所有VIP功能全部免费。</li>
              <li><strong>免登录使用</strong>：无需注册登录。</li>
            </ul>
            <h2 id="section-2">核心亮点功能</h2>
            <ul>
              <li><strong>AI头像生成</strong>：一键创建个性化数字肖像。</li>
            </ul>
            <hr />
            <p><strong>温馨提示</strong>：此为国际版，请酌情使用。</p>
          </div><br/><br/><!--listE-->
          <div id="KL_show_next_list" style="display:none"></div>
          <div class='attachment'><span class='attachmenSum'>共有1个附件(扣50个妖晶)</span><div class='attachmentinfo'><span class="downloadname"><span class="attachmentnumber">1.</span><span class='attachmentname'><span class='attachmentitle'>Hypic醒图国际版 v8.7.0 免登录使用所有特权</span></span><span class="downloadlink"><span class="downloadurl"><a class="urlbtn" href="/bbs/download.aspx?siteid=1000&amp;classid=201&amp;book_id=1540797&amp;id=927771">夸克网盘下载</a></span><span class="downloadcount">(1次)</span></span><span class="attachmentNote"></span></div>
        </div></div></div></div>
        <div class="louzhuxinxi subtitle"><span>[楼主]</span><a href="/bbs/userinfo.aspx?touserid=36925">李慕婉o</a></div>
        更多回帖(1)
    `, {
      id: '1540797',
      url: 'https://yaohuo.me/bbs-1540797.html'
    });

    expect(detail.contentHtml).toContain('应用简介');
    expect(detail.contentHtml).toContain('Hypic（醒图国际版）');
    expect(detail.contentHtml).toContain('版本特色');
    expect(detail.contentHtml).toContain('核心亮点功能');
    expect(detail.contentHtml).toContain('温馨提示');
    expect(detail.contentHtml).toContain('夸克网盘下载');
    expect(detail.contentHtml).not.toContain('李慕婉o');
    expect(detail.contentHtml).not.toContain('更多回帖');
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

  it('parses yaohuo activity replies from list-reply rows with real floors and rewards', () => {
    const result = parseYaohuoRepliesHtml(`
      <div class="recontent">
        <div class="list-reply line1" id="floor-1732" data-floor="1732">
          <span class="dinglouwenzi">[<span class="floornumber0" title="原1732楼">顶楼</span>]</span>
          <span class="remoney">[<b>得金<span class="rewardnumber">666</span></b>]</span>
          [<a class="replyicon" href="/bbs/book_re.aspx?siteid=1000&amp;classid=204&amp;page=1&amp;reply=1732&amp;id=1478784&amp;touserid=30878">回</a>]
          <span class="retext"><img src="face/淡定.gif" class="ubbimg" />红包可能不一样</span><br>
          <span class="renick"><a href="/bbs/userinfo.aspx?touserid=30878">妖友998</a></span>
          <span class="retime">11-06 08:14</span>
        </div>
      </div>
    `, { page: 1, limit: 30 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      floor: 1732,
      author: '妖友998',
      authorId: '30878'
    });
    expect(result.items[0].contentHtml).toContain('得金');
    expect(result.items[0].contentHtml).toContain('666');
    expect(result.items[0].contentHtml).toContain('红包可能不一样');
    expect(result.items[0].contentHtml).toContain('https://yaohuo.me/bbs/face/');
    expect(result.items[0].contentHtml).toContain('.gif');
    expect(result.items[0].contentHtml).not.toContain('顶楼');
    expect(result.items[0].contentHtml).not.toContain('replyicon');
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
