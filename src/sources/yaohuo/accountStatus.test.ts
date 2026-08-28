import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));
vi.mock('react-native', () => ({ NativeModules: {} }));

import { readYaohuoAccountStatus } from './accountStatus';

const readManagedCookieHeader = vi.fn(async () => ({
  status: 'ok' as const,
  header: 'sidyaohuo=safe'
}));

describe('Yaohuo account status', () => {
  it('stops after the signed-in homepage when it already names the current user', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(
          '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await readYaohuoAccountStatus({
      fetcher,
      readManagedCookieHeader,
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      failed: false,
      session: {
        status: 'logged-in',
        currentUser: { source: 'yaohuo', id: '7', username: '火友' }
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops after one profile read when it supplies the missing nickname', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(
          '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">空间</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response(
          '<div class="content">昵称:火友 <a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub">贴子(1)</a><a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复(1)</a></div>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await readYaohuoAccountStatus({
      fetcher,
      readManagedCookieHeader,
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      failed: false,
      session: { currentUser: { id: '7', username: '火友', displayName: '火友' } }
    });
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://www.yaohuo.me/wapindex.aspx?sid=-2',
      'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000'
    ]);
  });

  it('uses only the first topic page as the final nickname fallback', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(
          '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=45245">空间</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=45245&siteid=1000') {
        return new Response(
          '<div class="content">用户:45245 <a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub">贴子(31)</a><a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=45245">回复(1)</a></div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub') {
        return new Response(
          '<div class="listdata"><a href="/bbs-1.html?classid=177">主题</a>/流金岁月/阅1/2026-05-20 10:00</div><a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub&page=2">下一页</a>'
        );
      }
      if (input.includes('book_re_my.aspx') || input.includes('page=2')) {
        return new Response('<div>不应读取</div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await readYaohuoAccountStatus({
      fetcher,
      readManagedCookieHeader,
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      failed: false,
      session: { currentUser: { id: '45245', username: '流金岁月', displayName: '流金岁月' } }
    });
    const requests = fetcher.mock.calls.map(([input]) => input);
    expect(requests).toHaveLength(3);
    expect(requests.join('\n')).not.toContain('book_re_my.aspx');
    expect(requests.join('\n')).not.toContain('page=2');
  });

  it('preserves the proven identity as partial when nickname enrichment fails', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response(
          '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">空间</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        );
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response('temporarily unavailable', { status: 503 });
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await readYaohuoAccountStatus({
      fetcher,
      readManagedCookieHeader,
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      failed: true,
      session: {
        status: 'logged-in',
        currentUser: { id: '7', username: '7' }
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('projects only a canonical login form as an expired session', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response('<div class="listdata"><a href="/bbs-123.html">公开主题</a></div>');
      }
      if (input === 'https://www.yaohuo.me/waplogin.aspx?siteid=1000') {
        return new Response(
          '<form name="login" method="post"><input id="logname" name="logname"><input id="password" name="logpass"></form>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await readYaohuoAccountStatus({
      fetcher,
      readManagedCookieHeader,
      signal: new AbortController().signal
    });

    expect(result.failed).toBeUndefined();
    expect(result.session.currentUser).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['unknown document', '<main>maintenance</main>'],
    ['verification document', '<title>访问验证</title><script>CAPTCHA_CONFIG={}</script>']
  ])('keeps a %s unknown instead of clearing identity', async (_label, loginHtml) => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response('<div class="listdata"><a href="/bbs-123.html">公开主题</a></div>');
      }
      if (input === 'https://www.yaohuo.me/waplogin.aspx?siteid=1000') return new Response(loginHtml);
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      readYaohuoAccountStatus({
        fetcher,
        readManagedCookieHeader,
        signal: new AbortController().signal
      })
    ).rejects.toThrow(/暂时无法确认|访问验证/);
  });

  it('propagates caller cancellation', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const request = readYaohuoAccountStatus({ fetcher, readManagedCookieHeader, signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toThrow('请求已取消');
  });

  it('leaves the existing 15 second watchdog on each HTTP request', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));

    try {
      const request = readYaohuoAccountStatus({
        fetcher,
        readManagedCookieHeader,
        signal: new AbortController().signal
      });
      const assertion = expect(request).rejects.toThrow('请求超时，请稍后重试');

      await vi.advanceTimersByTimeAsync(15_000);

      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
