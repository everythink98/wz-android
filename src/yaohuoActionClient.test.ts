import { describe, expect, it, vi } from 'vitest';
import { runYaohuoAction } from './yaohuoActionClient';
import { buildYaohuoFavoriteRequest, buildYaohuoReplyRequest } from './yaohuoActions';

function htmlResponse(body: string, status = 200, url = 'https://yaohuo.me/bbs/book_re.aspx') {
  const response = new Response(body, {
    status,
    headers: { 'content-type': 'text/html' }
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('runYaohuoAction', () => {
  it('sends yaohuo write requests directly with Android browser-like headers', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<div class="tip">评论成功</div>'));

    const result = await runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享',
        sid: 'secret'
      }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('https://yaohuo.me/bbs/book_re.aspx', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        cookie: 'sidyaohuo=secret',
        origin: 'https://yaohuo.me',
        referer: 'https://yaohuo.me/bbs/',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-site': 'same-origin',
        'user-agent': expect.stringContaining('Android')
      }),
      body: expect.any(String),
      signal: expect.any(AbortSignal)
    }));
    expect(result.message).toBe('评论成功');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('runs GET actions without a request body', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<html>收藏成功</html>'));

    await runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('https://yaohuo.me/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=123', expect.objectContaining({
      method: 'GET',
      body: undefined,
      signal: expect.any(AbortSignal)
    }));
  });

  it('does not report long full pages without a tip as submitted', async () => {
    const fetcher = vi.fn(async () => htmlResponse(`
      <html>
        <head><title>妖火论坛</title></head>
        <body>
          <div class="content">这里是完整论坛页面，不是操作结果提示。页面内容很长，可能是操作失败后返回的普通页面。</div>
          <div>请回到帖子页面检查实际状态，避免把失败误认为成功。</div>
          <div>这些导航、页脚、公告和列表内容都不应该被当成操作成功提示。</div>
        </body>
      </html>
    `));

    const result = await runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(result.message).toBe('操作结果无法确认，请刷新原帖核对');
  });

  it('keeps short yaohuo action text when no tip wrapper exists', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<html>收藏成功</html>'));

    const result = await runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(result.message).toBe('收藏成功');
  });

  it('times out stuck yaohuo write requests', async () => {
    const stuckFetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    await expect(runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: stuckFetcher,
      timeoutMs: 1
    })).rejects.toThrow('请求超时，请稍后重试');
  });

  it('surfaces login and captcha pages as a relogin flow', async () => {
    const loginFetcher = vi.fn(async () => htmlResponse('<html>请先登录网站</html>', 200, 'https://yaohuo.me/waplogin.aspx?siteid=1000'));
    await expect(runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: loginFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });

    const captchaFetcher = vi.fn(async () => htmlResponse('<script>window.CAPTCHA_CONFIG={}</script><div>访问验证</div>'));
    await expect(runYaohuoAction({
      cookieHeader: 'sidyaohuo=secret',
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: captchaFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });
});
