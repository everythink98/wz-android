import { describe, expect, it, vi } from 'vitest';

vi.mock('./androidWebViewUserAgent', () => ({
  DEFAULT_ANDROID_WEBVIEW_USER_AGENT: 'native-provider-user-agent'
}));

import { runYaohuoAction } from './yaohuoActionClient';
import { buildYaohuoDeleteFavoriteRequest, buildYaohuoDeleteReplyRequest, buildYaohuoFavoriteRequest, buildYaohuoReplyRequest } from './yaohuoActions';

function htmlResponse(body: string, status = 200, url = 'https://www.yaohuo.me/bbs/book_re.aspx') {
  const response = new Response(body, {
    status,
    headers: { 'content-type': 'text/html' }
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

describe('runYaohuoAction', () => {
  it('[REG-ACCOUNT-029] sends yaohuo writes through the native read-only cookie jar', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<div class="tip">评论成功</div>'));

    const result = await runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享',
        sid: 'secret'
      }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('https://www.yaohuo.me/bbs/book_re.aspx', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://www.yaohuo.me',
        referer: 'https://www.yaohuo.me/bbs/',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'native-provider-user-agent'
      }),
      body: expect.any(String),
      signal: expect.any(AbortSignal)
    }));
    expect((fetcher.mock.calls as unknown as Array<[string, RequestInit?]>)[0]?.[1]?.headers).not.toHaveProperty('cookie');
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.not.objectContaining({
        'sec-ch-ua': expect.anything(),
        'sec-ch-ua-mobile': expect.anything(),
        'sec-ch-ua-platform': expect.anything()
      })
    }));
    expect(result).toMatchObject({ status: 'confirmed', message: '评论成功' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('REG-WRITE-002 runs the live favorite action once and accepts its favorites-page redirect', async () => {
    const fetcher = vi.fn(async () => htmlResponse(`
      <html>
        <head><title>收藏夹</title></head>
        <body>
          <div class="modern-list-item">
            <a href="/bbs-123.html" class="modern-list-item-title">测试主题</a>
            <button data-fav-id="987" title="删除收藏"></button>
          </div>
          <div>我的收藏列表以及完整站点导航、分类和页脚内容。这个页面足够长，不能只靠短文本猜测操作结果。</div>
          <div>收藏主题、站内公告、论坛入口和其他页面内容。</div>
          <div>更多导航文字用于还原妖火当前线上收藏成功后的完整收藏夹页面。</div>
        </body>
      </html>
    `, 200, 'https://www.yaohuo.me/bbs/favlist.aspx'));

    const result = await runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://www.yaohuo.me/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=123', expect.objectContaining({
      method: 'GET',
      body: undefined,
      signal: expect.any(AbortSignal)
    }));
    expect(result).toMatchObject({
      status: 'confirmed',
      message: '收藏成功',
      favoriteId: 987
    });
  });

  it('REG-WRITE-003 confirms original favorite cancellation from the JSON response', async () => {
    const fetcher = vi.fn(async () => htmlResponse(
      JSON.stringify({ success: true, message: '删除成功' }),
      200,
      'https://www.yaohuo.me/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987'
    ));

    const result = await runYaohuoAction({
      request: buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987',
      expect.objectContaining({ method: 'POST', body: undefined })
    );
    expect(result).toMatchObject({ status: 'confirmed', message: '已取消原站收藏' });
  });

  it('does not clear the favorite style when original cancellation is rejected', async () => {
    const fetcher = vi.fn(async () => htmlResponse(
      JSON.stringify({ success: false, message: '删除失败' }),
      200,
      'https://www.yaohuo.me/bbs/favlist.aspx?action=delete&siteid=1000&favtypeid=0&id=987'
    ));

    await expect(runYaohuoAction({
      request: buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' }),
      fetcher
    })).rejects.toThrow('删除失败');
  });

  it('follows yaohuo reply delete confirmation links before reporting success', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('action=go&')) {
        return htmlResponse(`
          <html>
            <body>
              论坛回复 删除操作 删除自己回帖扣2倍币和经验
              <a href="/bbs/book_re_del.aspx?action=godel&amp;reid=32656658&amp;id=1560268&amp;siteid=1000&amp;classid=177&amp;lpage=&amp;page=1&amp;ot=&amp;token=fixed-token">确定删除！</a>
            </body>
          </html>
        `, 200, url);
      }
      return htmlResponse('<div class="tip">删除成功</div>', 200, url);
    });

    const result = await runYaohuoAction({
      request: buildYaohuoDeleteReplyRequest({
        deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&page=1&reid=32656658&id=1560268'
      }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://www.yaohuo.me/bbs/book_re_del.aspx?action=godel&reid=32656658&id=1560268&siteid=1000&classid=177&lpage=&page=1&ot=&token=fixed-token', expect.objectContaining({
      method: 'GET',
      body: undefined
    }));
    expect(result).toMatchObject({ status: 'confirmed', message: '删除成功' });
  });

  it('[REG-WRITE-012][REG-WRITE-025] marks a reply deletion unknown when its confirmation link is missing', async () => {
    const fetcher = vi.fn(async (url: string) => htmlResponse(`
      <html><body>
        <div>论坛回复 删除操作</div>
        <button type="submit">确认删除</button>
      </body></html>
    `, 200, url));

    const result = await runYaohuoAction({
      request: buildYaohuoDeleteReplyRequest({
        deletePath: '/bbs/Book_re_del.aspx?action=go&siteid=1000&classid=177&page=1&reid=32656658&id=1560268'
      }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'unknown',
      message: '操作结果无法确认，请刷新原帖核对'
    });
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
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(result).toMatchObject({
      status: 'unknown',
      message: '操作结果无法确认，请刷新原帖核对'
    });
  });

  it('does not treat a cross-origin favorites path as a successful favorite', async () => {
    const fetcher = vi.fn(async () => htmlResponse(`
      <html><body>
        <div>这是其他来源返回的完整收藏夹页面，路径相同也不能作为妖火收藏成功的证据。</div>
        <div>页面包含足够多的导航、列表和页脚文字，必须继续保持结果不确定。</div>
        <div>不能因为最终路径名字相同就把外站页面当作妖火的成功跳转。</div>
      </body></html>
    `, 200, 'https://example.com/bbs/favlist.aspx'));

    const result = await runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(result).toMatchObject({
      status: 'unknown',
      message: '操作结果无法确认，请刷新原帖核对'
    });
  });

  it('keeps short yaohuo action text when no tip wrapper exists', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<html>评论成功</html>'));

    const result = await runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享'
      }),
      fetcher
    });

    expect(result).toMatchObject({ status: 'confirmed', message: '评论成功' });
  });

  it.each([
    ['empty', '<html></html>'],
    ['unrecognized short', '<html>请求处理中</html>'],
    ['ambiguous success wording', '<html>评论成功了吗</html>']
  ])('[REG-WRITE-025] marks %s action text unknown without a success oracle', async (_kind, html) => {
    const fetcher = vi.fn(async () => htmlResponse(html));

    const result = await runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享'
      }),
      fetcher
    });

    expect(result).toEqual({
      status: 'unknown',
      message: '操作结果无法确认，请刷新原帖核对'
    });
  });

  it('rejects short yaohuo failure tips', async () => {
    const failedReplyFetcher = vi.fn(async () => htmlResponse('<div class="tip">评论失败</div>'));
    await expect(runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享',
        sid: 'secret'
      }),
      fetcher: failedReplyFetcher
    })).rejects.toThrow('评论失败');

    const deniedFavoriteFetcher = vi.fn(async () => htmlResponse('<html>权限不足</html>'));
    await expect(runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: deniedFavoriteFetcher
    })).rejects.toThrow('权限不足');
  });

  it('rejects long yaohuo failure tips before shortening the message', async () => {
    const fetcher = vi.fn(async () => htmlResponse(`
      <div class="tip">
        评论失败，当前内容未能提交。请检查当前账号状态、帖子权限、重复提交限制和内容格式后再试，
        这段失败提示超过八十个字，不能因为过长就被当成操作已提交，也不能隐藏原始失败原因。
      </div>
    `));

    await expect(runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享',
        sid: 'secret'
      }),
      fetcher
    })).rejects.toThrow('评论失败');
  });

  it('rejects yaohuo failure text inside nested tip markup', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<div class="tip"><span>提示</span>权限不足</div>'));

    await expect(runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    })).rejects.toThrow('权限不足');
  });

  it('times out stuck yaohuo write requests', async () => {
    const stuckFetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));

    await expect(runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: stuckFetcher,
      timeoutMs: 1
    })).rejects.toThrow('请求超时，请稍后重试');
  });

  it('surfaces login and captcha pages as a relogin flow', async () => {
    const loginFetcher = vi.fn(async () => htmlResponse(`
      <script src="/NetCSS/CSS/Login/Gocaptcha/gocaptcha.global.js"></script>
      <form name="login" method="post">
        <input id="logname" name="logname" />
        <input id="password" name="logpass" type="password" />
      </form>
    `, 200, 'https://www.yaohuo.me/waplogin.aspx?siteid=1000'));
    await expect(runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: loginFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });

    const captchaFetcher = vi.fn(async () => htmlResponse('<script>window.CAPTCHA_CONFIG={}</script><div>访问验证</div>'));
    await expect(runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher: captchaFetcher
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });
});
