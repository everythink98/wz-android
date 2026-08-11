import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/android/androidWebViewUserAgent', () => ({
  DEFAULT_ANDROID_WEBVIEW_USER_AGENT: 'native-provider-user-agent'
}));

import {
  checkYaohuoLoginDirect,
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from './reader';
import { parseYaohuoListHtml, parseYaohuoSearchHtml } from './feedParser';
import { parseYaohuoCurrentUserHtml } from './sessionParser';
import { parseYaohuoFavoriteRecordId, parseYaohuoRepliesHtml, parseYaohuoTopicHtml } from './topicParser';
import { yaohuoReplyListNextPageUrl, yaohuoTopicListNextPageUrl } from './protocol';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import type { ReplyOrder, ReplyWindowPosition, Topic } from '@/domain/forum/models';

describe('Android direct yaohuo API', () => {
  it('[REG-ACCOUNT-029] fetches yaohuo through the native read-only cookie jar', async () => {
    const yaohuoFetcher = vi.fn(
      async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>')
    );

    const result = await getYaohuoFeedDirect({
      category: '177',
      page: 2,
      limit: 30,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&siteid=1000',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'native-provider-user-agent'
        })
      })
    );
    expect((yaohuoFetcher.mock.calls as unknown as [string, RequestInit?][])[0]?.[1]?.headers).not.toHaveProperty(
      'Cookie'
    );
    expect(yaohuoFetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'Sec-CH-UA': expect.anything(),
          'Sec-CH-UA-Mobile': expect.anything(),
          'Sec-CH-UA-Platform': expect.anything()
        })
      })
    );
    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
  });

  it('uses the all-category yaohuo feed when category is blank', async () => {
    const yaohuoFetcher = vi.fn(
      async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>')
    );

    await getYaohuoFeedDirect({
      category: '',
      page: 1,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx?gettotal=2025&action=new',
      expect.any(Object)
    );
  });

  it('keeps all-category yaohuo pagination on the all feed URL', async () => {
    const yaohuoFetcher = vi.fn(
      async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>')
    );

    await getYaohuoFeedDirect({
      page: 2,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx?gettotal=2025&action=new&page=2',
      expect.any(Object)
    );
  });

  it('keeps yaohuo search pagination metadata', () => {
    const result = parseYaohuoSearchHtml(
      `
      <div class="listdata"><a href="/bbs-123.html">搜索结果</a>/alice/阅1/05-20 10:00</div>
      <a href="/bbs/book_list.aspx?action=search&page=2">下一页</a>
    `,
      {
        page: 1,
        limit: 1
      }
    );

    expect(result.items.map((item) => item.id)).toEqual(['123']);
    expect(result.hasMore).toBe(true);
    expect(result.nextPage).toBe(2);
  });

  it('keeps yaohuo search results returned by the official page without local keyword filtering', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response(`
      <div class="listdata"><a href="/bbs-321.html">安卓手机免流设置</a>/alice/阅1/05-20 10:00</div>
      <div class="listdata"><a href="/bbs-322.html">怎么把别的设备消息转过来？</a>/bob/阅1/05-19 10:00</div>
    `)
    );

    const result = await searchYaohuoDirect({
      query: '安卓手机免',
      yaohuoFetcher
    });

    expect(result.items.map((item) => item.id)).toEqual(['321', '322']);
  });

  it('keeps the selected yaohuo board on search results when the result link omits classid', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response(`
      <div class="listdata"><a href="/bbs-321.html">妖火茶馆搜索结果</a>/alice/阅1/05-20 10:00</div>
    `)
    );

    const result = await searchYaohuoDirect({
      query: '茶馆',
      category: '177',
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
      const result = parseYaohuoSearchHtml(
        `
        <div class="listdata line1"><a href="/bbs-1539321.html">旧搜索结果</a>/alice/阅1 <span class="right">昨天 00:05</span></div>
        <div class="listdata line2"><a href="/bbs-1539322.html">新搜索结果</a>/bob/阅1 <span class="right">今天 23:50</span></div>
        <div class="listdata line1"><a href="/bbs-1539323.html">下午搜索结果</a>/carol/阅1 <span class="right">下午 3:20</span></div>
      `,
        {
          page: 1,
          limit: 30
        }
      );

      expect(result.items.map((item) => item.id)).toEqual(['1539321', '1539322', '1539323']);
      expect(result.items[0].createdAt).toBe('2026-05-23T16:05:00.000Z');
      expect(result.items[1].createdAt).toBe('2026-05-25T15:50:00.000Z');
      expect(result.items[2].createdAt).toBe('2026-05-25T07:20:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('fetches later yaohuo search pages through the search pagination endpoint', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response('<div class="listdata"><a href="/bbs-456.html">第二页结果</a>/alice/阅1/05-20 10:00</div>')
    );

    const result = await searchYaohuoDirect({
      query: '免流',
      page: 2,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&type=title&key=%E5%85%8D%E6%B5%81&classid=0&page=2&siteid=1000&getTotal=2021',
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
    const result = parseYaohuoListHtml(
      `
      <div class="title">【妖火论坛】</div>
      <div class="list">
        1.<a href="/bbs-1422771.html">忙了三四天，成亲了</a><br>
        2.<a href="/bbs-1423356.html">giffgaff卡免流教程</a><br>
      </div>
    `,
      {
        classId: '177',
        page: 1,
        limit: 30
      }
    );

    expect(result.items.map((item) => item.title)).toEqual(['忙了三四天，成亲了', 'giffgaff卡免流教程']);
  });

  it('ignores off-site links that look like yaohuo topic links', () => {
    const result = parseYaohuoListHtml(
      `
      <div class="listdata"><a href="https://evil.example/bbs-1539321.html">伪主题</a>/alice/阅1/05-20 10:00</div>
      <div class="listdata"><a href="/bbs-1539322.html">站内主题</a>/bob/阅1/05-20 10:01</div>
    `,
      {
        classId: '177',
        page: 1,
        limit: 30
      }
    );

    expect(result.items.map((item) => item.id)).toEqual(['1539322']);
  });

  it('parses current yaohuo listdata rows with multiple classes', () => {
    const result = parseYaohuoListHtml(
      `
      <!--listS-->
      <div class="listdata line1">1.<img src="/NetImages/file.gif" alt="附"/><a class="topic-link" href="/bbs-1539321.html">局停后应急方案</a><br/><span class="louzhunicheng">畫家李問</span>/<a class="topic-link" href="/bbs/book_re.aspx?actoin=class&amp;siteid=1000&amp;classid=177&amp;id=1539321&amp;getTotal=0&amp;lpage=1">0</a>回/39阅 <span class="right">今天 午夜<span></div>
      <div class="listdata line2">2.<a class="topic-link" href="/bbs-1539320.html">dnshe域名互助</a><br/><span class="louzhunicheng">冷眸阳少</span>/<a class="topic-link" href="/bbs/book_re.aspx?actoin=class&amp;siteid=1000&amp;classid=177&amp;id=1539320&amp;getTotal=0&amp;lpage=1">0</a>回/37阅 <span class="right">今天 午夜<span></div>
      <!--listE-->
    `,
      {
        classId: '177',
        page: 1,
        limit: 30
      }
    );

    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'yaohuo',
          id: '1539321',
          title: '局停后应急方案',
          author: '畫家李問',
          categoryId: '177',
          category: '妖火茶馆',
          replyCount: 0,
          viewCount: 39
        })
      ])
    );
  });

  it('parses yaohuo relative list times as real Beijing times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T01:00:00+08:00'));
    try {
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">午夜主题</a>/alice/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">深夜主题</a>/bob/阅1 <span class="right">今天 23:50</span></div>
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539323.html">昨天主题</a>/carol/阅1 <span class="right">昨天 00:05</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539324.html">下午主题</a>/dave/阅1 <span class="right">下午 3:20</span></div>
      `,
        {
          page: 1,
          limit: 30
        }
      );

      expect(result.items.find((item) => item.id === '1539321')?.createdAt).toBe('2026-05-24T16:00:00.000Z');
      expect(result.items.find((item) => item.id === '1539321')?.displayTimeText).toBe('今天 午夜');
      expect(result.items.find((item) => item.id === '1539322')?.createdAt).toBe('2026-05-25T15:50:00.000Z');
      expect(result.items.find((item) => item.id === '1539323')?.createdAt).toBe('2026-05-23T16:05:00.000Z');
      expect(result.items.find((item) => item.id === '1539324')?.createdAt).toBe('2026-05-25T07:20:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses yaohuo period-only list times as official display text and Beijing time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T07:30:00+08:00'));
    try {
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">午夜主题</a>/alice/阅1 <span class="right">今天 午夜</span></div>
      `,
        {
          page: 1,
          limit: 30
        }
      );

      expect(result.items[0].createdAt).toBe('2026-05-24T16:00:00.000Z');
      expect(result.items[0].lastReplyAt).toBe('2026-05-24T16:00:00.000Z');
      expect(result.items[0].displayTimeText).toBe('今天 午夜');
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses yaohuo numeric relative list times from the current clock snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T09:30:00+08:00'));
    try {
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">分钟主题</a>/alice/阅1 <span class="right">20分钟前</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">小时主题</a>/bob/阅1 <span class="right">7小时前</span></div>
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539323.html">天主题</a>/carol/阅1 <span class="right">2天前</span></div>
      `,
        {
          page: 1,
          limit: 30,
          preserveOrder: true
        }
      );

      expect(result.items.map((item) => item.createdAt)).toEqual([
        '2026-05-25T01:10:00.000Z',
        '2026-05-24T18:30:00.000Z',
        '2026-05-23T01:30:00.000Z'
      ]);
      expect(result.items.map((item) => item.displayTimeText)).toEqual(['20分钟前', '7小时前', '2天前']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses one Beijing clock snapshot for all rows in a single yaohuo list parse', () => {
    const firstNow = new Date('2026-05-25T01:00:00+08:00').getTime();
    const secondNow = new Date('2026-05-26T01:00:00+08:00').getTime();
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(firstNow)
      .mockReturnValueOnce(secondNow)
      .mockReturnValue(secondNow);
    try {
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">第一条</a>/alice/阅1 <span class="right">1小时前</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">第二条</a>/bob/阅1 <span class="right">1小时前</span></div>
      `,
        {
          page: 1,
          limit: 30
        }
      );

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
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">第一条同时间</a>/alice/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">第二条同时间</a>/bob/阅1 <span class="right">今天 午夜</span></div>
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539323.html">更新主题</a>/carol/阅1 <span class="right">今天 23:50</span></div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539324.html">旧主题</a>/dave/阅1 <span class="right">昨天 00:05</span></div>
      `,
        {
          page: 1,
          limit: 30
        }
      );

      expect(result.items.map((item) => item.id)).toEqual(['1539323', '1539321', '1539322', '1539324']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses yaohuo class ids from list row links before falling back to the selected class', () => {
    const result = parseYaohuoListHtml(
      `
      <div class="listdata line1">
        <a class="topic-link" href="/bbs-1539321.html">悬赏主题</a>/alice/
        <a href="/bbs/book_re.aspx?classid=213&amp;id=1539321">0</a>回/1阅 <span class="right">05-20 10:00</span>
      </div>
    `,
      {
        page: 1,
        limit: 30
      }
    );

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
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">跨年主题</a>/alice/阅1/12-31 23:50</div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">新年主题</a>/bob/阅1/01-01 00:10</div>
      `,
        {
          classId: '177',
          page: 1,
          limit: 30
        }
      );

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
      const result = parseYaohuoListHtml(
        `
        <div class="listdata line1"><a class="topic-link" href="/bbs-1539321.html">跨年主题</a>/alice/阅1/12-31 23:50</div>
        <div class="listdata line2"><a class="topic-link" href="/bbs-1539322.html">新年主题</a>/bob/阅1/01-01 00:10</div>
      `,
        {
          classId: '177',
          page: 1,
          limit: 30
        }
      );

      expect(result.items.find((item) => item.id === '1539321')?.createdAt).toBe('2025-12-31T15:50:00.000Z');
      expect(result.items.find((item) => item.id === '1539322')?.createdAt).toBe('2025-12-31T16:10:00.000Z');
    } finally {
      yearSpy.mockRestore();
      monthSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('skips yaohuo non-topic links that only contain unrelated numeric parameters', () => {
    const result = parseYaohuoListHtml(
      `
      <div class="listdata line1">
        <a class="topic-link" href="/bbs/view.aspx?classid=177&amp;siteid=1000">收藏入口</a>/alice/阅9/05-20 10:00
      </div>
    `,
      {
        classId: '177',
        page: 1,
        limit: 30
      }
    );

    expect(result.items).toEqual([]);
  });

  it('does not parse slash-separated yaohuo numeric fields as views without the view marker', () => {
    const result = parseYaohuoListHtml(
      `
      <div class="listdata line1">
        <a class="topic-link" href="/bbs-1539321.html">妖火主题</a>/alice/10/100 <span class="right">05-20 10:00</span>
      </div>
    `,
      {
        classId: '177',
        page: 1,
        limit: 30
      }
    );

    expect(result.items[0]).toMatchObject({
      id: '1539321',
      viewCount: undefined
    });
  });

  it('checks login from the exact top2 self-account navigation without sending Cookie to a server', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response(`
      <div class="top2">
        <a href="/myfile.aspx">我的地盘</a>
        <a href="/bbs/userinfo.aspx?touserid=7">火友</a>
        <a href="/bbs/book_list_search.aspx">帖子</a>
        <a href="/bbs/messagelist.aspx">信箱</a>
      </div>
    `)
    );

    const result = await checkYaohuoLoginDirect({
      yaohuoFetcher
    });

    expect(result.loginRequired).toBe(false);
    expect(result.currentUser).toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7'
    });
    expect(yaohuoFetcher).toHaveBeenCalledWith('https://www.yaohuo.me/wapindex.aspx?sid=-2', expect.any(Object));
  });

  it('[REG-ACCOUNT-019] keeps an ordinary Yaohuo content page unknown without current-user proof', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response(`
      <div class="listdata"><a href="/bbs-123.html">公开主题</a>/访客/阅1/05-20 10:00</div>
    `)
    );

    const result = await checkYaohuoLoginDirect({
      yaohuoFetcher
    });

    expect(result).toMatchObject({
      ok: false,
      loginRequired: false,
      reason: 'unknown',
      message: '妖火登录状态暂时无法确认。'
    });
    expect(result.currentUser).toBeUndefined();
  });

  it('[REG-ACCOUNT-037] confirms a Yaohuo guest from the exact login form after an ambiguous public page', async () => {
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response('<div class="listdata"><a href="/bbs-123.html">公开主题</a></div>');
      }
      if (input === 'https://www.yaohuo.me/waplogin.aspx?siteid=1000') {
        return new Response(`
          <script src="/NetCSS/CSS/Login/Gocaptcha/gocaptcha.global.js"></script>
          <form name="login" method="post">
            <input id="logname" name="logname" />
            <input id="password" name="logpass" type="password" />
          </form>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(checkYaohuoLoginDirect({ yaohuoFetcher })).resolves.toMatchObject({
      ok: false,
      loginRequired: true,
      reason: 'expired'
    });
    expect(yaohuoFetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://www.yaohuo.me/wapindex.aspx?sid=-2',
      'https://www.yaohuo.me/waplogin.aspx?siteid=1000'
    ]);
  });

  it('[REG-ACCOUNT-037] keeps an incomplete Yaohuo login page unknown', async () => {
    const yaohuoFetcher = vi.fn(async (input: string) =>
      input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2'
        ? new Response('<div class="listdata"><a href="/bbs-123.html">公开主题</a></div>')
        : new Response(`
          <form name="login" method="post">
            <input id="logname" name="logname" />
          </form>
        `)
    );

    await expect(checkYaohuoLoginDirect({ yaohuoFetcher })).resolves.toMatchObject({
      ok: false,
      loginRequired: false,
      reason: 'unknown'
    });
    expect(yaohuoFetcher).toHaveBeenCalledTimes(2);
  });

  it('[REG-ACCOUNT-020] recognizes the complete Yaohuo self-account navigation returned to a logged-in WebView', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response(`
      <div class="top2">
        <a href="/myfile.aspx">我的地盘</a>
        <a href="/bbs/userinfo.aspx?touserid=42">空间</a>
        <a href="/bbs/book_list_search.aspx">帖子</a>
        <a href="/bbs/messagelist.aspx">信箱</a>
      </div>
    `)
    );

    const result = await checkYaohuoLoginDirect({
      yaohuoFetcher
    });

    expect(result).toMatchObject({
      ok: true,
      loginRequired: false,
      currentUser: {
        source: 'yaohuo',
        id: '42'
      }
    });
  });

  it('[REG-ACCOUNT-020] keeps a partial top2 user link unknown', () => {
    expect(
      parseYaohuoCurrentUserHtml(`
      <div class="top2">
        <a href="/bbs/userinfo.aspx?touserid=42">空间</a>
        <a href="/bbs-123.html">公开主题</a>
      </div>
    `)
    ).toBeNull();
  });

  it('[REG-ACCOUNT-019] returns an explicit Yaohuo guest page as expired instead of throwing', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response('请先登录网站 <a href="/waplogin.aspx">登录</a>', {
          status: 200
        })
    );

    await expect(
      checkYaohuoLoginDirect({
        yaohuoFetcher
      })
    ).resolves.toMatchObject({
      ok: false,
      loginRequired: true,
      reason: 'expired'
    });
  });

  it.each([401, 403, 404])(
    '[REG-ACCOUNT-025] keeps Yaohuo HTTP %i unknown instead of clearing login state',
    async (status) => {
      const yaohuoFetcher = vi.fn(async () => new Response('', { status }));
      let failure: unknown;

      try {
        await checkYaohuoLoginDirect({
          yaohuoFetcher
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({ message: `HTTP ${status}` });
      expect(failure).not.toMatchObject({ loginRequired: true });
    }
  );

  it('[REG-ACCOUNT-019] does not infer the current Yaohuo user from a public profile card', () => {
    const currentUser = parseYaohuoCurrentUserHtml(`
      <div class="line1">个人资料：<a href="/bbs/userinfo.aspx?touserid=7">火友</a></div>
      <div class="listdata"><a href="/bbs-123.html">公开主题</a></div>
    `);

    expect(currentUser).toBeNull();
  });

  it('[REG-ACCOUNT-019] does not infer the current Yaohuo user from a public row whose title contains 我的', () => {
    const currentUser = parseYaohuoCurrentUserHtml(`
      <div class="listdata">
        <a href="/bbs/userinfo.aspx?touserid=7">发帖人</a>
        <a href="/bbs-123.html">我的一天</a>
      </div>
    `);

    expect(currentUser).toBeNull();
  });

  it('[REG-ACCOUNT-019] does not infer the current Yaohuo user from welcome text in a public row', () => {
    const currentUser = parseYaohuoCurrentUserHtml(`
      <div class="listdata">
        <a href="/bbs/userinfo.aspx?touserid=7">alice</a>
        <a href="/bbs-123.html">欢迎 alice 加入</a>
      </div>
    `);

    expect(currentUser).toBeNull();
  });

  it('[REG-ACCOUNT-031] does not accept legacy top welcome or logout text as identity proof', () => {
    const currentUser = parseYaohuoCurrentUserHtml(
      '<div class="top">火友的<a href="/bbs/userinfo.aspx?touserid=7">空间</a> <a href="/bbs/logout.aspx">退出</a></div>'
    );
    const fallbackUser = parseYaohuoCurrentUserHtml(
      '<div class="top"><a href="/bbs/userinfo.aspx?touserid=8">我的地盘</a> <a href="/bbs/logout.aspx">退出</a></div>'
    );

    expect(currentUser).toBeNull();
    expect(fallbackUser).toBeNull();
  });

  it('passes cancellation signals through direct yaohuo fetches', async () => {
    const controller = new AbortController();
    const yaohuoFetcher = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response('<div class="listdata"></div>')
    );

    await getYaohuoFeedDirect({
      yaohuoFetcher,
      signal: controller.signal
    });

    expect(yaohuoFetcher.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('[REG-VERIFICATION-003] uses the Android WebView provider identity for yaohuo read requests', async () => {
    const yaohuoFetcher = vi.fn(
      async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>')
    );

    await getYaohuoFeedDirect({
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        credentials: 'include',
        redirect: 'follow',
        headers: expect.objectContaining({
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: 'https://www.yaohuo.me/bbs/',
          'Sec-Fetch-Site': 'same-origin',
          'User-Agent': 'native-provider-user-agent'
        })
      })
    );
    expect((yaohuoFetcher.mock.calls as unknown as [string, RequestInit?][])[0]?.[1]?.headers).not.toHaveProperty(
      'Cookie'
    );
  });

  it('keeps the yaohuo topic read independent from the ordinary reply window', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1,
      categoryId: '177'
    };
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input.includes('book_re.aspx')) {
        throw new Error('topic read must not fetch replies');
      }
      if (input.includes('/bbs/favlist.aspx')) {
        return new Response('');
      }
      return new Response(
        '<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(1)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
      );
    });

    const detail = await getYaohuoTopicDirect({
      topic,
      replyLimit: 30,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenNthCalledWith(1, 'https://www.yaohuo.me/bbs-123.html', expect.any(Object));
    expect(detail.replyCount).toBe(1);
    expect(detail).toMatchObject({ replies: [], replyCompleteness: 'partial', replyHasMore: true });
  });

  it('REG-WRITE-003 loads the original favorite record with the topic detail', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 0,
      categoryId: '177'
    };
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input.includes('/bbs/favlist.aspx')) {
        return new Response(`
          <div class="modern-list-item">
            <a href="/bbs-123.html" class="modern-list-item-title">妖火帖子</a>
            <button data-fav-id="987" title="删除收藏"></button>
          </div>
        `);
      }
      if (input.includes('/bbs/book_re.aspx')) {
        return new Response('');
      }
      return new Response(
        '<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div><a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
      );
    });

    const detail = await getYaohuoTopicDirect({
      topic,
      yaohuoFetcher
    });

    const favoriteUrl = vi
      .mocked(yaohuoFetcher)
      .mock.calls.map(([input]) => String(input))
      .find((input) => input.includes('/bbs/favlist.aspx'));
    expect(favoriteUrl).toBeTruthy();
    expect(new URL(favoriteUrl || '').searchParams.get('key')).toBe('妖火帖子');
    expect(detail).toMatchObject({ bookmarked: true, bookmarkId: 987 });
  });

  it('REG-WRITE-003 keeps the topic readable when the favorite state is unavailable', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 0,
      categoryId: '177'
    };
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input.includes('/bbs/favlist.aspx')) {
        throw new Error('favorite list unavailable');
      }
      if (input.includes('/bbs/book_re.aspx')) {
        return new Response('');
      }
      return new Response(
        '<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div><a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
      );
    });

    const detail = await getYaohuoTopicDirect({
      topic,
      yaohuoFetcher
    });

    expect(detail.contentHtml).toContain('body');
    expect(detail.replies).toEqual([]);
    expect(detail.bookmarked).toBeUndefined();
    expect(detail.bookmarkId).toBeUndefined();
    expect(sourceDiagnosticSummary(detail)).toMatchObject({
      validCount: 1,
      partialErrorCount: 1,
      hasDegradation: true
    });
  });

  it('matches favorite records by topic id instead of title alone', () => {
    const html = `
      <div class="modern-list-item">
        <a href="/bbs-456.html" class="modern-list-item-title">同名主题</a>
        <button data-fav-id="987" title="删除收藏"></button>
      </div>
    `;

    expect(parseYaohuoFavoriteRecordId(html, '456')).toBe(987);
    expect(parseYaohuoFavoriteRecordId(html, '123')).toBeUndefined();
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

    await expect(
      getYaohuoTopicDirect({
        topic,
        yaohuoFetcher
      })
    ).rejects.toThrow('妖火链接不属于 www.yaohuo.me');

    expect(yaohuoFetcher).not.toHaveBeenCalled();
  });

  it('keeps the list category when yaohuo topic detail omits class links', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '456',
      title: '妖火资源帖',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-456.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 0,
      categoryId: '201',
      category: '资源分享'
    };
    const yaohuoFetcher = vi.fn(async (input: string) => {
      if (input.includes('book_re.aspx')) {
        return new Response('');
      }
      return new Response(
        '<div class="content">[标题] 妖火资源帖 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>'
      );
    });

    const detail = await getYaohuoTopicDirect({
      topic,
      yaohuoFetcher
    });

    expect(yaohuoFetcher.mock.calls.some(([input]) => String(input).includes('book_re.aspx'))).toBe(false);
    expect(detail).toMatchObject({
      categoryId: '201',
      category: '资源分享'
    });
  });

  it('reads yaohuo topic author level from the original poster row only', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火等级主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>
      <div class="louzhuxinxi subtitle">[楼主]<a href="/bbs/userinfo.aspx?touserid=36925">一葉知秋</a>(4级水面的小草)[荣誉]</div>
    `,
      {
        id: '1559685',
        url: 'https://www.yaohuo.me/bbs-1559685.html'
      }
    );

    expect(detail.author).toBe('一葉知秋');
    expect(detail.authorLevelLabel).toBe('4级水面的小草');
  });

  it('[REG-VERIFICATION-002] does not treat an ordinary Yaohuo discussion about access verification as a challenge page', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 访问验证实现讨论 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS-->
        <p>这里讨论访问验证，“请先登录网站”只是错误提示示例，变量是 <code>window.CAPTCHA_CONFIG = {}</code>。</p>
      <!--listE--></div>
    `,
      {
        id: '1559686',
        url: 'https://www.yaohuo.me/bbs-1559686.html'
      }
    );

    expect(detail.title).toBe('访问验证实现讨论');
    expect(detail.contentHtml).toContain('CAPTCHA_CONFIG');
  });

  it('does not treat yaohuo reply user ids as author levels', () => {
    const result = parseYaohuoRepliesHtml(
      `
      <div class="line1">[261楼][回]口乞..<a href="/bbs/userinfo.aspx?touserid=45264">孟婆烤串</a>(45264) 06-28 23:22</div>
    `,
      { page: 1, limit: 30 }
    );

    expect(result.items[0]).toMatchObject({ author: '孟婆烤串', authorId: '45264' });
    expect(result.items[0].authorLevelLabel).toBeUndefined();
  });

  it('maps yaohuo vote options to unified polls with state', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火投票 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>
      <div class="toupiao">
        <a href="/bbs/book_view_toVote.aspx?vid=55">[投票] 选项 A (2)</a><br>
        <a href="/bbs/book_view_toVote.aspx?vid=56">[已投] 选项 B (5)</a>
      </div>
      <span>已投票</span>
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `,
      {
        id: '123',
        url: 'https://www.yaohuo.me/bbs-123.html'
      }
    );

    expect(detail.polls).toEqual([
      {
        id: 'yaohuo-123',
        title: '投票',
        voted: true,
        closed: false,
        multiple: false,
        options: [
          { id: '55', label: '选项 A', count: 2, selected: false },
          { id: '56', label: '选项 B', count: 5, selected: true }
        ]
      }
    ]);
  });

  it('maps yaohuo vote options wrapped in block elements with vote suffix counts', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火投票 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>
      <div class="toupiao">
        <p><a href="/bbs/book_view_toVote.aspx?vid=55">[投票] 选项 A（2）</a></p>
        <ul><li><a href="/bbs/book_view_toVote.aspx?vid=56">[投票] 选项 B(3票)</a></li></ul>
      </div>
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `,
      {
        id: '123',
        url: 'https://www.yaohuo.me/bbs-123.html'
      }
    );

    expect(detail.polls?.[0].options).toEqual([
      { id: '55', label: '选项 A', count: 2, selected: false },
      { id: '56', label: '选项 B', count: 3, selected: false }
    ]);
  });

  it('maps yaohuo multi-choice polls to selectable polls with choice limits', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火多选投票 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent"><!--listS--><p>多选，可选2项</p><!--listE--></div>
      <div class="toupiao">
        <a href="/bbs/book_view_toVote.aspx?vid=55">[投票] 选项 A (2)</a><br>
        <a href="/bbs/book_view_toVote.aspx?vid=56">[投票] 选项 B (5)</a>
      </div>
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `,
      {
        id: '123',
        url: 'https://www.yaohuo.me/bbs-123.html'
      }
    );

    expect(detail.polls?.[0]).toMatchObject({
      id: 'yaohuo-123',
      multiple: true,
      max: 2
    });
    expect(detail.polls?.[0]).not.toHaveProperty('readonly');
  });

  it('keeps yaohuo resource download content rendered outside the main post block', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 软件资源 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent">
        <!--listS--><p>软件说明</p><!--listE-->
      </div>
      <div class="intro">版本介绍：免登录使用修图特权。</div>
      <div class="download">下载地址：<a href="https://pan.quark.cn/s/abc">夸克网盘</a><br>提取码：1234</div>
      更多回帖(1)
      <a href="/bbs/book_list.aspx?classid=201">资源分享</a>
    `,
      {
        id: '456',
        url: 'https://www.yaohuo.me/bbs-456.html'
      }
    );

    expect(detail.contentHtml).toContain('软件说明');
    expect(detail.contentHtml).toContain('版本介绍：免登录使用修图特权。');
    expect(detail.contentHtml).toContain('下载地址');
    expect(detail.contentHtml).toContain('夸克网盘');
    expect(detail.contentHtml).toContain('提取码：1234');
    expect(detail.contentHtml).toContain('https://pan.quark.cn/s/abc');
    expect(detail.contentHtml).not.toContain('更多回帖');
  });

  it('keeps yaohuo video-only topic content', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 视频主题 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent">
        <!--listS--><video controls><source src="/uploads/demo.mp4" type="video/mp4"></video><!--listE-->
      </div>
      更多回帖(1)
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `,
      {
        id: '1560017',
        url: 'https://www.yaohuo.me/bbs-1560017.html'
      }
    );

    expect(detail.contentHtml).toContain('<forum-video');
    expect(detail.contentHtml).toContain('src="https://www.yaohuo.me/uploads/demo.mp4"');
    expect(detail.excerpt).toBe('');
  });

  it('keeps yaohuo video blocks after the marked post body', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 视频主题 (阅2) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx?touserid=1">alice</a></div>
      <div class="bbscontent">
        <!--listS--><p>正文</p><!--listE-->
      </div>
      <video controls><source src="/uploads/after-body.mp4" type="video/mp4"></video>
      更多回帖(1)
      <a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>
    `,
      {
        id: '1560017',
        url: 'https://www.yaohuo.me/bbs-1560017.html'
      }
    );

    expect(detail.contentHtml).toContain('正文');
    expect(detail.contentHtml).toContain('src="https://www.yaohuo.me/uploads/after-body.mp4"');
    expect(detail.contentHtml).not.toContain('更多回帖');
  });

  it('keeps yaohuo activity reward status in topic content', () => {
    const detail = parseYaohuoTopicHtml(
      `
      <div class="rectangle-container">
        <div class="notification-text"><i><svg></svg></i><span><span>派币</span><span>550000</span>已结束</span></div>
      </div>
      <div id="book-view-content" class="content">
        <div class="paibi"><span class="lijin">礼金</span><span class="lijinshuzi">550000</span><span class="meiren">每人</span><span class="meirenshuzi">200</span><span class="shengyu">(<span>余</span><span>0</span>)</span></div>
        <div class="Postinfo"><span>[标题]</span>49元开京东Plus会员<span>(阅45708)</span><br><span>[时间]<span>2025-10-28 01:20</span></span><span id="stamp-badge">获赏<span>1586</span></span></div>
        <div class="bbscontent"><!--listS-->618期间开通双倍积分哦！<!--listE--></div>
      </div>
    `,
      {
        id: '1478784',
        url: 'https://www.yaohuo.me/bbs-1478784.html'
      }
    );

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
    const detail = parseYaohuoTopicHtml(
      `
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
    `,
      {
        id: '1540797',
        url: 'https://www.yaohuo.me/bbs-1540797.html'
      }
    );

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
      order: 'oldest',
      position: { kind: 'cursor', page: 3, offset: null },
      limit: 30,
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=3',
      expect.any(Object)
    );
  });

  it('[REG-NOTIFY-046] ignores a Yaohuo user named 下一页 when deriving the real reply cursor', () => {
    const result = parseYaohuoRepliesHtml(
      `
      <div class="list-reply line1" id="floor-288" data-floor="288">
        <span class="retext">reply</span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=39170">下一页</a></span>
      </div>
      <a href="/bbs/book_re.aspx?classid=177&amp;id=1560939&amp;page=11">下一页</a>
    `,
      { page: 10, limit: 30 }
    );

    expect(result.nextPage).toBe(11);
    expect(result.hasMore).toBe(true);
  });

  it('[REG-NOTIFY-046] ignores a user named 下一页 in profile topic and reply cursors', () => {
    const misleadingUser = '<a href="/bbs/userinfo.aspx?touserid=39170">下一页</a>';

    expect(
      yaohuoTopicListNextPageUrl(
        `${misleadingUser}<a href="/bbs/book_list_search.aspx?action=search&type=pub&key=7&page=11">下一页</a>`,
        'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&type=pub&key=7&page=10',
        10,
        1
      )
    ).toBe('https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&type=pub&key=7&page=11');
    expect(
      yaohuoReplyListNextPageUrl(
        `${misleadingUser}<a href="/bbs/book_re_my.aspx?touserid=7&page=11">下一页</a>`,
        'https://www.yaohuo.me/bbs/book_re_my.aspx?touserid=7&page=10',
        1
      )
    ).toBe('https://www.yaohuo.me/bbs/book_re_my.aspx?touserid=7&page=11');
  });

  it('[REG-NOTIFY-046] resolves a target floor through one server-routed reply-page request', async () => {
    const response = new Response(`
      <form><input name="page" value="16" /></form>
      <div class="list-reply line1" id="floor-90" data-floor="90">
        <span class="retext">target reply</span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=1">alice</a></span>
      </div>
      <a href="/bbs/book_re.aspx?classid=177&amp;id=1560939&amp;page=17">下一页</a>
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?classid=177&id=1560939&tofloor=90'
    });
    const yaohuoFetcher = vi.fn(async () => response);

    const result = await getYaohuoRepliesDirect({
      id: '1560939',
      categoryId: '177',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 90 } },
      yaohuoFetcher
    });

    expect(yaohuoFetcher).toHaveBeenCalledTimes(1);
    expect(yaohuoFetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx?id=1560939&classid=177&tofloor=90',
      expect.any(Object)
    );
    expect(result).toMatchObject({
      currentPage: 16,
      currentOffset: null,
      previousPage: 17,
      previousOffset: null,
      nextPage: 15
    });
    expect(result.items).toEqual([expect.objectContaining({ floor: 90, author: 'alice' })]);
  });

  it('[REG-TOPIC-062] rejects a target window when 妖火 does not confirm its resolved page', async () => {
    const response = new Response(`
      <div class="list-reply line1" id="floor-90" data-floor="90">
        <span class="retext">target reply</span>
        <span class="renick"><a href="/bbs/userinfo.aspx?touserid=1">alice</a></span>
      </div>
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?classid=177&id=1560939&tofloor=90'
    });

    await expect(
      getYaohuoRepliesDirect({
        id: '1560939',
        categoryId: '177',
        order: 'oldest',
        position: { kind: 'target', target: { floor: 90 } },
        yaohuoFetcher: vi.fn(async () => response)
      })
    ).rejects.toThrow('妖火未确认目标楼层所在页');
  });

  it('[REG-TOPIC-072] renders a server-routed 妖火 edge window when the hinted first floor was deleted', async () => {
    const response = new Response(`
      <input name="replyPage" value="1" />
      <input name="loadedThroughPage" value="1" />
      ${Array.from({ length: 7 }, (_, index) => {
        const floor = index + 2;
        return `<div class="list-reply line1" data-floor="${floor}"><span class="retext">reply ${floor}</span><span class="renick">user-${floor}</span></div>`;
      }).join('')}
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&tofloor=1'
    });

    const result = await getYaohuoRepliesDirect({
      id: '1570569',
      categoryId: '177',
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: 8,
      yaohuoFetcher: vi.fn(async () => response)
    });

    expect(result.items.map((reply) => reply.floor)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result).toMatchObject({
      currentPage: 1,
      previousPage: null,
      nextPage: null,
      hasMore: false,
      completeness: 'partial'
    });
  });

  it('[REG-TOPIC-077] preserves empty rows selected by the 妖火 reply collection', async () => {
    const response = new Response(`
      <input name="replyPage" value="1" />
      <div class="list-reply line1" data-floor="1">
        <span class="retext">first</span><span class="renick">alice</span>
      </div>
      <div class="line2"></div>
      <div class="list-reply line1" data-floor="3"><span class="retext"></span></div>
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&tofloor=1'
    });

    const result = await getYaohuoRepliesDirect({
      id: '1570569',
      categoryId: '177',
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: 3,
      yaohuoFetcher: vi.fn(async () => response)
    });

    expect(result.items.map(({ floor, contentHtml }) => ({ floor, contentHtml }))).toEqual([
      { floor: 1, contentHtml: 'first' },
      { floor: 2, contentHtml: '' },
      { floor: 3, contentHtml: '' }
    ]);
    expect(result).toMatchObject({ completeness: 'partial' });
  });

  it('[REG-TOPIC-077] rejects a 妖火 exact target that only matches a synthesized floor', async () => {
    const response = new Response(`
      <input name="replyPage" value="1" />
      <div class="list-reply line1"><span class="retext">reply without a floor marker</span></div>
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&tofloor=1'
    });

    await expect(
      getYaohuoRepliesDirect({
        id: '1570569',
        categoryId: '177',
        order: 'oldest',
        position: { kind: 'target', target: { floor: 1 } },
        yaohuoFetcher: vi.fn(async () => response)
      })
    ).rejects.toThrow('目标楼层未找到');
  });

  it('[REG-TOPIC-077] accepts a confirmed empty 妖火 oldest start when the authoritative count is zero', async () => {
    const response = new Response('<input name="replyPage" value="1" />');
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&tofloor=1'
    });

    await expect(
      getYaohuoRepliesDirect({
        id: '1570569',
        categoryId: '177',
        order: 'oldest',
        position: { kind: 'start' },
        replyCount: 0,
        yaohuoFetcher: vi.fn(async () => response)
      })
    ).resolves.toMatchObject({ items: [], completeness: 'complete', hasMore: false, nextPage: null });
  });

  it('[REG-TOPIC-077] rejects an explicit wrong 妖火 topic identity before projecting replies', async () => {
    const response = new Response(`
      <input name="replyPage" value="1" />
      <div class="list-reply line1" data-floor="1"><span class="retext">wrong topic reply</span></div>
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=9999999&classid=177&page=1'
    });

    await expect(
      getYaohuoRepliesDirect({
        id: '1570569',
        categoryId: '177',
        order: 'newest',
        position: { kind: 'start' },
        replyCount: 1,
        yaohuoFetcher: vi.fn(async () => response)
      })
    ).rejects.toThrow('主题身份不一致');
  });

  it('[REG-TOPIC-072] renders the confirmed newest 妖火 page when the reply hint becomes stale', async () => {
    const response = new Response(`
      <input name="replyPage" value="1" />
      ${Array.from({ length: 7 }, (_, index) => {
        const floor = index + 2;
        return `<div class="list-reply line1" data-floor="${floor}"><span class="retext">reply ${floor}</span><span class="renick">user-${floor}</span></div>`;
      }).join('')}
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&tofloor=7'
    });

    const result = await getYaohuoRepliesDirect({
      id: '1570569',
      categoryId: '177',
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 7,
      yaohuoFetcher: vi.fn(async () => response)
    });

    expect(result.items.map((reply) => reply.floor)).toEqual([8, 7, 6, 5, 4, 3, 2]);
    expect(result).toMatchObject({
      currentPage: 1,
      previousPage: null,
      nextPage: null,
      hasMore: false,
      completeness: 'partial'
    });
  });

  it('[REG-TOPIC-072] reads a confirmed ordinary 妖火 window when the caller reply count is stale zero', async () => {
    const response = new Response(`
      <input name="replyPage" value="1" />
      <div class="list-reply line1" data-floor="8">
        <span class="retext">still readable</span><span class="renick">alice</span>
      </div>
    `);
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&page=1'
    });

    const result = await getYaohuoRepliesDirect({
      id: '1570569',
      categoryId: '177',
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 0,
      yaohuoFetcher: vi.fn(async () => response)
    });

    expect(result.items).toEqual([expect.objectContaining({ contentHtml: 'still readable', floor: 8 })]);
    expect(result).toMatchObject({ currentPage: 1, completeness: 'partial' });
  });

  it('[REG-TOPIC-072] fails closed on an empty 妖火 ordinary window without requesting a count refresh', async () => {
    const response = new Response('<input name="replyPage" value="1" />');
    Object.defineProperty(response, 'url', {
      value: 'https://www.yaohuo.me/bbs/book_re.aspx?id=1570569&classid=177&tofloor=1'
    });

    const error = await getYaohuoRepliesDirect({
      id: '1570569',
      categoryId: '177',
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: 8,
      yaohuoFetcher: vi.fn(async () => response)
    }).then(
      () => null,
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('边缘回复窗口为空');
    expect((error as { reason?: unknown }).reason).toBeUndefined();
  });

  it('[REG-TOPIC-067][REG-TOPIC-068] follows 妖火 real floors across its newest-first server pages', async () => {
    const detail = parseYaohuoTopicHtml(
      '<div class="content">[标题] topic</div>更多回帖(30)<a href="/bbs/book_re.aspx?id=1560940&amp;classid=177&amp;page=1&amp;tofloor=555">555楼</a><a href="/bbs/book_re.aspx?id=1560940&amp;classid=177&amp;reply=558">回复</a>',
      { id: '1560940' }
    );
    const requests: string[] = [];
    const yaohuoFetcher = vi.fn(async (input: string) => {
      requests.push(input);
      const url = new URL(input);
      const targetFloor = Number(url.searchParams.get('tofloor'));
      const page = targetFloor === 558 ? 1 : targetFloor === 1 ? 19 : Number(url.searchParams.get('page'));
      const firstFloor = page === 1 ? 529 : page === 2 ? 499 : page === 18 ? 18 : 1;
      const count = page === 19 ? 17 : 30;
      const rows = Array.from({ length: count }, (_, index) => {
        const floor = firstFloor + index;
        return `<div class="list-reply line1" data-floor="${floor}"><span class="retext">reply ${floor}</span><span class="renick">user-${floor}</span></div>`;
      }).join('');
      const response = new Response(
        `<input name="page" value="${page}" />${rows}<a href="/bbs/book_re.aspx?id=1560940&classid=177&page=${page + 1}">下一页</a>`
      );
      Object.defineProperty(response, 'url', { value: input });
      return response;
    });

    const load = (order: ReplyOrder, position: ReplyWindowPosition, replyCount = detail.replyCount) =>
      getYaohuoRepliesDirect({
        id: '1560940',
        categoryId: '177',
        order,
        position,
        replyCount,
        limit: 30,
        yaohuoFetcher
      });
    const newest = await load('newest', { kind: 'start' });
    const older = await load('newest', { kind: 'cursor', page: newest.nextPage!, offset: null }, 1);
    const oldest = await load('oldest', { kind: 'start' });
    const newer = await load('oldest', { kind: 'cursor', page: oldest.nextPage!, offset: null }, 9_999);
    const newestAgain = await load(
      'newest',
      { kind: 'cursor', page: older.previousPage!, offset: older.previousOffset ?? null },
      1
    );
    const oldestAgain = await load(
      'oldest',
      { kind: 'cursor', page: newer.previousPage!, offset: newer.previousOffset ?? null },
      9_999
    );

    expect(
      requests.map(
        (request) => new URL(request).searchParams.get('tofloor') || new URL(request).searchParams.get('page')
      )
    ).toEqual(['1', '2', '1', '18', '1', '19']);
    expect(newest.items.map((reply) => reply.floor)).toEqual(Array.from({ length: 30 }, (_, index) => 558 - index));
    expect(newest).toMatchObject({ currentPage: 1, previousPage: null, nextPage: 2 });
    expect(older.items.map((reply) => reply.floor)).toEqual(Array.from({ length: 30 }, (_, index) => 528 - index));
    expect(newestAgain.items.map((reply) => reply.floor)).toEqual(newest.items.map((reply) => reply.floor));
    expect(oldest.items.map((reply) => reply.floor)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(oldest).toMatchObject({ currentPage: 19, previousPage: null, nextPage: 18 });
    expect(newer.items.map((reply) => reply.floor)).toEqual(Array.from({ length: 30 }, (_, index) => index + 18));
    expect(newer).toMatchObject({ currentPage: 18, previousPage: 19, nextPage: 17 });
    expect(oldestAgain.items.map((reply) => reply.floor)).toEqual(oldest.items.map((reply) => reply.floor));
  });

  it('[REG-TOPIC-067][REG-TOPIC-068][REG-TOPIC-072] rejects a wrong 妖火 tail page but renders a confirmed changing edge', async () => {
    const row =
      '<div class="list-reply line1" data-floor="558"><span class="retext">reply 558</span><span class="renick">user-558</span></div>';
    const wrongPageFetcher = vi.fn(async (input: string) => {
      const response = new Response(`<input name="page" value="2" />${row}`);
      Object.defineProperty(response, 'url', { value: input.replace('page=1', 'page=2') });
      return response;
    });
    const advancingFetcher = vi.fn(async (input: string) => {
      const response = new Response(
        `<input name="page" value="1" />${row}<div class="list-reply line1" data-floor="559"><span class="retext">reply 559</span><span class="renick">user-559</span></div>`
      );
      Object.defineProperty(response, 'url', { value: input });
      return response;
    });
    const staleCountFetcher = vi.fn(async (input: string) => {
      const response = new Response(
        '<input name="page" value="1" /><div class="list-reply line1" data-floor="557"><span class="retext">reply 557</span><span class="renick">user-557</span></div>'
      );
      Object.defineProperty(response, 'url', { value: input });
      return response;
    });
    const emptyFetcher = vi.fn(async (input: string) => {
      const response = new Response('<input name="page" value="1" />');
      Object.defineProperty(response, 'url', { value: input });
      return response;
    });
    const options = {
      id: '1560941',
      categoryId: '177',
      order: 'newest' as const,
      position: { kind: 'start' as const },
      replyCount: 558,
      limit: 30
    };

    await expect(getYaohuoRepliesDirect({ ...options, yaohuoFetcher: wrongPageFetcher })).rejects.toThrow(
      '未确认最新回复窗口'
    );
    await expect(getYaohuoRepliesDirect({ ...options, yaohuoFetcher: advancingFetcher })).resolves.toMatchObject({
      currentPage: 1,
      items: [expect.objectContaining({ floor: 559 }), expect.objectContaining({ floor: 558 })]
    });
    await expect(getYaohuoRepliesDirect({ ...options, yaohuoFetcher: staleCountFetcher })).resolves.toMatchObject({
      currentPage: 1,
      items: [expect.objectContaining({ floor: 557 })]
    });
    const emptyError = await getYaohuoRepliesDirect({ ...options, yaohuoFetcher: emptyFetcher }).then(
      () => null,
      (error: unknown) => error
    );
    expect(emptyError).toBeInstanceOf(Error);
    expect((emptyError as Error).message).toContain('普通回复窗口为空');
    expect((emptyError as { reason?: unknown }).reason).toBeUndefined();
    expect(wrongPageFetcher.mock.calls[0]?.[0]).toContain('page=1');
    expect(advancingFetcher.mock.calls[0]?.[0]).toContain('page=1');
    expect(staleCountFetcher.mock.calls[0]?.[0]).toContain('page=1');
    expect(emptyFetcher.mock.calls[0]?.[0]).toContain('page=1');
  });

  it('parses yaohuo activity replies from list-reply rows with real floors and rewards', () => {
    const result = parseYaohuoRepliesHtml(
      `
      <div class="recontent">
        <div class="list-reply line1" id="floor-1732" data-floor="1732">
          <span class="dinglouwenzi">[<span class="floornumber0" title="原1732楼">顶楼</span>]</span>
          <span class="remoney">[<b>得金<span class="rewardnumber">666</span></b>]</span>
          [<a class="replyicon" href="/bbs/book_re.aspx?siteid=1000&amp;classid=204&amp;page=1&amp;reply=1732&amp;id=1478784&amp;touserid=30878">回</a>]
          [<a href="/bbs/book_re_del.aspx?action=godel&amp;reid=32656658&amp;id=1478784&amp;siteid=1000&amp;classid=204">删</a>]
          <span class="retext"><img src="face/淡定.gif" class="ubbimg" />红包可能不一样</span><br>
          <span class="renick"><a href="/bbs/userinfo.aspx?touserid=30878">妖友998</a></span>
          <span class="retime">11-06 08:14</span>
        </div>
      </div>
    `,
      { page: 1, limit: 30 }
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      floor: 1732,
      author: '妖友998',
      authorId: '30878',
      canDelete: true
    });
    expect(result.items[0]).not.toHaveProperty('canEdit');
    expect(result.items[0].contentHtml).toContain('得金');
    expect(result.items[0].contentHtml).toContain('666');
    expect(result.items[0].contentHtml).toContain('红包可能不一样');
    expect(result.items[0].contentHtml).toContain('https://www.yaohuo.me/bbs/face/');
    expect(result.items[0].contentHtml).toContain('.gif');
    expect(result.items[0].contentHtml).not.toContain('顶楼');
    expect(result.items[0].contentHtml).not.toContain('replyicon');
  });

  it('keeps period-only yaohuo reply times parsed outside list cards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T07:30:00+08:00'));
    try {
      const result = parseYaohuoRepliesHtml(`
        <div class="line1">
          回复内容 <span class="retime">今天 午夜</span>
          <a href="/bbs/userinfo.aspx?touserid=1">bob</a>
        </div>
      `);

      expect(result.items[0].createdAt).toBe('2026-05-24T16:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the page offset as the fallback floor for yaohuo replies without floor labels', () => {
    const result = parseYaohuoRepliesHtml(
      '<div class="line1">回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>',
      {
        page: 3,
        limit: 30
      }
    );

    expect(result.items[0]).toMatchObject({ author: 'bob', floor: 61 });
  });

  it('surfaces yaohuo verification responses without clearing cookies', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response('<script>window.CAPTCHA_CONFIG={}</script>', {
          status: 200
        })
    );

    await expect(
      searchYaohuoDirect({
        query: '测试',
        yaohuoFetcher
      })
    ).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });

  it('surfaces non-200 yaohuo verification pages as HTTP errors', async () => {
    const yaohuoFetcher = vi.fn(
      async () =>
        new Response('<script>window.CAPTCHA_CONFIG={}</script>', {
          status: 403
        })
    );

    await expect(
      getYaohuoFeedDirect({
        yaohuoFetcher
      })
    ).rejects.toMatchObject({
      message: 'HTTP 403',
      status: 403
    });
  });
});
