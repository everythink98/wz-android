import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginDiagnosticTrace, setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';

afterEach(() => setDiagnosticWriter(null));

vi.mock('@/platform/android/androidWebViewUserAgent', () => ({
  DEFAULT_ANDROID_WEBVIEW_USER_AGENT: 'native-provider-user-agent'
}));

import { runYaohuoAction } from './actionClient';
import {
  buildYaohuoDeleteFavoriteRequest,
  buildYaohuoDeleteReplyRequest,
  buildYaohuoFavoriteRequest,
  buildYaohuoMessageReplyRequest,
  buildYaohuoReplyRequest,
  buildYaohuoVoteRequest
} from './actionRequest';

function htmlResponse(body: string, status = 200, url = 'https://www.yaohuo.me/bbs/book_re.aspx') {
  const response = new Response(body, {
    status,
    headers: { 'content-type': 'text/html' }
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function replyForm(token = 'fresh-form-token') {
  return `<form action="/bbs/book_re.aspx" method="post">
    <input name="id" value="123" type="hidden" />
    <input name="__CSRFToken" value="${token}" type="hidden" />
    <textarea name="content"></textarea>
  </form>`;
}

function replyFetcher(html: string) {
  return vi.fn(async (url: string, init?: RequestInit) =>
    htmlResponse(init?.method === 'GET' ? replyForm() : html, 200, url)
  );
}

function voteContainer(token = 'fresh-vote-token') {
  return `<div class="vote-container" data-vote-url="/bbs/book_view_toVote.aspx" data-vote-csrf="${token}">
    <button class="vote-button" data-siteid="1000" data-id="123" data-vid="7" data-vpage="1" data-lpage="1">选项一</button>
    <button class="vote-button" data-siteid="1000" data-id="123" data-vid="8" data-vpage="1" data-lpage="1">选项二</button>
  </div>`;
}

function voteFetcher(html: string) {
  return vi.fn(async (url: string) => htmlResponse(url.endsWith('/bbs-123.html') ? voteContainer() : html, 200, url));
}

describe('runYaohuoAction', () => {
  it('reads a fresh reply form before each submit and preserves the intended reply fields', async () => {
    let reads = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET') return htmlResponse(replyForm(`token-${++reads}`), 200, url);
      const body = new URLSearchParams(String(init?.body));
      return htmlResponse(
        `<div class="tip">${body.get('__CSRFToken') === `token-${reads}` && reads > 0 ? '评论成功' : '页面已过期，请刷新后重试'}</div>`
      );
    });
    const request = buildYaohuoReplyRequest({
      topicId: '123',
      classId: '177',
      content: '生日快乐',
      face: '微笑',
      replyFloor: 11,
      toUserId: 22,
      sid: 'secret'
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await expect(runYaohuoAction({ request, fetcher })).resolves.toEqual({
        status: 'confirmed',
        message: '评论成功'
      });
      const [url, init] = fetcher.mock.calls.at(-1)!;
      expect(url).toBe('https://www.yaohuo.me/bbs/book_re.aspx');
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
        ...Object.fromEntries(new URLSearchParams(request.body)),
        __CSRFToken: `token-${attempt}`
      });
      expect(init?.headers).toMatchObject({ referer: 'https://www.yaohuo.me/bbs-123.html' });
    }
    expect(reads).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    '页面已过期，请刷新后重试',
    '操作太频繁，请稍后再试',
    '请先输入验证码',
    '评论成功了吗',
    '回复成功！页面已过期，请刷新后重试'
  ])('does not confirm the original reply rejection: %s', async (message) => {
    const fetcher = replyFetcher(`<div class="tip">${message}</div>`);
    await expect(
      runYaohuoAction({
        request: buildYaohuoReplyRequest({ topicId: '123', classId: '177', content: '生日快乐' }),
        fetcher
      })
    ).resolves.toEqual({ status: 'unknown', message });
  });

  it.each([
    ['missing token', replyForm('')],
    ['another form', replyForm().replace('book_re.aspx', 'sendmoney_freeMain.aspx')],
    ['another topic', replyForm().replace('value="123"', 'value="456"')],
    ['foreign action', replyForm().replace('/bbs/book_re.aspx', 'https://example.com/bbs/book_re.aspx')]
  ])('does not POST when the current reply form has %s', async (_kind, html) => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const trace = beginDiagnosticTrace('reply', 'submit');
    const fetcher = vi.fn(async (url: string) => htmlResponse(html, 200, url));
    await expect(
      runYaohuoAction({
        request: buildYaohuoReplyRequest({ topicId: '123', classId: '177', content: '生日快乐' }),
        fetcher,
        trace
      })
    ).rejects.toThrow('无法读取妖火回复验证信息，请刷新后重试');
    expect(events).toContainEqual(
      expect.objectContaining({
        traceId: trace.traceId,
        phase: 'credential',
        source: 'yaohuo',
        hasReplyForm: _kind === 'missing token',
        hasCsrfToken: false,
        isSameOrigin: true
      })
    );
    expect(JSON.stringify(events)).not.toMatch(/fresh-form-token|生日快乐/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs-123.html',
      expect.objectContaining({ method: 'GET', body: undefined })
    );
  });

  it.each(['OK', ' \r\nOK\t '])('confirms the original AJAX private-message acknowledgment: %j', async (html) => {
    const request = buildYaohuoMessageReplyRequest({
      content: '收到',
      fields: { action: 'add', toid: '9', ajax: '1' }
    });
    const fetcher = vi.fn(async () => htmlResponse(html));

    await expect(runYaohuoAction({ request, fetcher })).resolves.toEqual({
      status: 'confirmed',
      message: '发送信息成功！'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['OK!', 'NOT OK', '<div>OK</div>', '{"success":true}', '未知状态码'])(
    'leaves an unrecognized AJAX private-message response unconfirmed: %s',
    async (html) => {
      const request = buildYaohuoMessageReplyRequest({
        content: '收到',
        fields: { action: 'add', toid: '9', ajax: '1' }
      });
      const fetcher = vi.fn(async () => htmlResponse(html));

      await expect(runYaohuoAction({ request, fetcher })).resolves.toEqual({
        status: 'unknown',
        message: '操作结果无法确认，请刷新原帖核对'
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['REPEAT', '刚刚已经给对方发过相同的内容了'],
    ['NULL', '请填写对方ID和内容'],
    ['WAITING', '操作太快了，请稍后再试'],
    ['MAX1', '一次最多发给100人，请分批发送'],
    ['MAX', '今天的发信数量已达上限，明天再来吧'],
    ['LOCK', '你已被加入黑名单，暂时不能发信'],
    ['ALLERR', '只有站长才能群发给全站会员'],
    ['BLOCKED', '对方设置了不接收你的私信'],
    ['NOTEXSIT', '对方ID不存在，请检查后再发']
  ])('marks the original AJAX private-message rejection as not sent: %s', async (code, message) => {
    const request = buildYaohuoMessageReplyRequest({
      content: '收到',
      fields: { action: 'add', toid: '9', ajax: '1' }
    });
    const fetcher = vi.fn(async () => htmlResponse(` \n${code}\t `));

    await expect(runYaohuoAction({ request, fetcher })).rejects.toMatchObject({ message, serverRejected: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '0'])(
    'does not confirm an OK response without the AJAX private-message request: %s',
    async (ajax) => {
      const request = buildYaohuoMessageReplyRequest({ content: '收到', fields: { action: 'add', toid: '9' } });
      const body = new URLSearchParams(request.body);
      if (ajax) body.set('ajax', ajax);
      else body.delete('ajax');

      await expect(
        runYaohuoAction({
          request: { ...request, body: body.toString() },
          fetcher: vi.fn(async () => htmlResponse('OK'))
        })
      ).resolves.toEqual({ status: 'unknown', message: '操作结果无法确认，请刷新原帖核对' });
    }
  );

  it('continues to confirm the exact legacy private-message success text', async () => {
    const request = buildYaohuoMessageReplyRequest({ content: '收到', fields: { action: 'add', toid: '9' } });

    await expect(
      runYaohuoAction({ request, fetcher: vi.fn(async () => htmlResponse('<div class="tip">发送成功</div>')) })
    ).resolves.toEqual({ status: 'unknown', message: '操作结果无法确认，请刷新原帖核对' });
    await expect(
      runYaohuoAction({ request, fetcher: vi.fn(async () => htmlResponse('<div class="tip">发送信息成功！</div>')) })
    ).resolves.toEqual({ status: 'confirmed', message: '发送信息成功！' });
  });

  it('identifies a private reply rejection only from the action notice', async () => {
    const request = buildYaohuoMessageReplyRequest({ content: '收到', fields: { action: 'add', toid: '9' } });
    await expect(
      runYaohuoAction({ request, fetcher: vi.fn(async () => htmlResponse('<div class="tip">内容不能为空</div>')) })
    ).rejects.toMatchObject({ serverRejected: true });
    await expect(
      runYaohuoAction({ request, fetcher: vi.fn(async () => htmlResponse('<main>之前的消息：失败</main>')) })
    ).rejects.not.toMatchObject({ serverRejected: true });
  });

  it('sends yaohuo writes through the native read-only cookie jar', async () => {
    const fetcher = replyFetcher('<div class="tip">评论成功</div>');

    const result = await runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享',
        sid: 'secret'
      }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://www.yaohuo.me',
          referer: 'https://www.yaohuo.me/bbs-123.html',
          'sec-fetch-site': 'same-origin',
          'user-agent': 'native-provider-user-agent'
        }),
        body: expect.any(String),
        signal: expect.any(AbortSignal)
      })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit?][])[0]?.[1]?.headers).not.toHaveProperty('cookie');
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'sec-ch-ua': expect.anything(),
          'sec-ch-ua-mobile': expect.anything(),
          'sec-ch-ua-platform': expect.anything()
        })
      })
    );
    expect(result).toMatchObject({ status: 'confirmed', message: '评论成功' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('runs the live favorite action once and accepts its favorites-page redirect', async () => {
    const fetcher = vi.fn(async () =>
      htmlResponse(
        `
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
    `,
        200,
        'https://www.yaohuo.me/bbs/favlist.aspx'
      )
    );

    const result = await runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/Share.aspx?action=fav&siteid=1000&classid=177&id=123',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
        signal: expect.any(AbortSignal)
      })
    );
    expect(result).toMatchObject({
      status: 'confirmed',
      message: '收藏成功',
      favoriteId: 987
    });
  });

  it('reads a fresh cancellation token and posts the intended favorite record once', async () => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    let tokenReads = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return htmlResponse(JSON.stringify({ success: true, token: `fresh-favorite-token-${++tokenReads}` }), 200, url);
      }
      const body = new URLSearchParams(String(init?.body));
      return htmlResponse(
        JSON.stringify({
          success: tokenReads > 0 && body.get('__CSRFToken') === `fresh-favorite-token-${tokenReads}`,
          message: '删除成功'
        }),
        200,
        url
      );
    });
    const request = buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await expect(
        runYaohuoAction({ request, fetcher, trace: beginDiagnosticTrace('topic', 'favorite') })
      ).resolves.toEqual({
        status: 'confirmed',
        message: '已取消收藏'
      });
      expect(fetcher.mock.calls.at(-2)).toEqual([
        'https://www.yaohuo.me/bbs/favlist.aspx?action=csrftoken&siteid=1000',
        expect.objectContaining({ method: 'GET', body: undefined, cache: 'no-store' })
      ]);
      const [url, init] = fetcher.mock.calls.at(-1)!;
      expect(url).toBe('https://www.yaohuo.me/bbs/favlist.aspx');
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      });
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
        action: 'delete',
        siteid: '1000',
        favtypeid: '0',
        id: '987',
        ajax: '1',
        __CSRFToken: `fresh-favorite-token-${attempt}`
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(events)).not.toContain('fresh-favorite-token-');
  });

  it.each([
    ['missing token', JSON.stringify({ success: true })],
    ['empty token', JSON.stringify({ success: true, token: '  ' })],
    ['non-string token', JSON.stringify({ success: true, token: 123 })],
    ['rejected token', JSON.stringify({ success: false, token: 'untrusted-token' })],
    ['non-boolean success', JSON.stringify({ success: 'true', token: 'untrusted-token' })],
    ['invalid JSON', '<html>普通收藏列表</html>']
  ])('does not POST a favorite cancellation with %s', async (_kind, response) => {
    const fetcher = vi.fn(async (url: string) => htmlResponse(response, 200, url));
    await expect(
      runYaohuoAction({ request: buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' }), fetcher })
    ).rejects.toThrow('无法读取妖火收藏验证信息，请刷新后重试');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://www.yaohuo.me/bbs/favlist.aspx?action=csrftoken&siteid=1000');
  });

  it('does not trust a cancellation token redirected outside yaohuo', async () => {
    const fetcher = vi.fn(async () =>
      htmlResponse(
        JSON.stringify({ success: true, token: 'foreign-token' }),
        200,
        'https://example.com/bbs/favlist.aspx'
      )
    );
    await expect(
      runYaohuoAction({ request: buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' }), fetcher })
    ).rejects.toThrow('无法读取妖火收藏验证信息，请刷新后重试');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not clear the favorite style when original cancellation is rejected', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
      htmlResponse(
        JSON.stringify(
          init?.method === 'GET'
            ? { success: true, token: 'fresh-favorite-token' }
            : { success: false, code: 'csrf_invalid', message: '删除失败' }
        ),
        200,
        url
      )
    );

    await expect(
      runYaohuoAction({
        request: buildYaohuoDeleteFavoriteRequest({ favoriteId: '987' }),
        fetcher
      })
    ).rejects.toThrow('删除失败');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
  });

  it('follows yaohuo reply delete confirmation links before reporting success', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('action=go&')) {
        return htmlResponse(
          `
          <html>
            <body>
              论坛回复 删除操作 删除自己回帖扣2倍币和经验
              <a href="/bbs/book_re_del.aspx?action=godel&amp;reid=32656658&amp;id=1560268&amp;siteid=1000&amp;classid=177&amp;lpage=&amp;page=1&amp;ot=&amp;token=fixed-token">确定删除！</a>
            </body>
          </html>
        `,
          200,
          url
        );
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
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://www.yaohuo.me/bbs/book_re_del.aspx?action=godel&reid=32656658&id=1560268&siteid=1000&classid=177&lpage=&page=1&ot=&token=fixed-token',
      expect.objectContaining({
        method: 'GET',
        body: undefined
      })
    );
    expect(result).toMatchObject({ status: 'confirmed', message: '删除成功' });
  });

  it('marks a reply deletion unknown when its confirmation link is missing', async () => {
    const fetcher = vi.fn(async (url: string) =>
      htmlResponse(
        `
      <html><body>
        <div>论坛回复 删除操作</div>
        <button type="submit">确认删除</button>
      </body></html>
    `,
        200,
        url
      )
    );

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

  it.each([
    ['another topic', 'id=456&reid=9'],
    ['another reply', 'id=123&reid=10'],
    ['duplicate topic', 'id=123&id=456&reid=9'],
    ['case-varied topic', 'id=123&ID=456&reid=9'],
    ['duplicate reply', 'id=123&reid=9&reid=10'],
    ['case-varied reply', 'id=123&reid=9&REID=10'],
    ['duplicate action', 'id=123&reid=9&action=go'],
    ['case-varied action', 'id=123&reid=9&ACTION=go']
  ])('does not follow a deletion confirmation for %s', async (_target, fields) => {
    const fetcher = vi.fn(async (url: string) =>
      htmlResponse(
        `<a href="/bbs/book_re_del.aspx?action=godel&${fields}&siteid=1000&classid=177&token=fresh-token">确定删除！</a>`,
        200,
        url
      )
    );
    await expect(
      runYaohuoAction({
        request: buildYaohuoDeleteReplyRequest({
          deletePath: '/bbs/book_re_del.aspx?action=go&siteid=1000&classid=177&reid=9&id=123'
        }),
        fetcher
      })
    ).resolves.toEqual({ status: 'unknown', message: '操作结果无法确认，请刷新原帖核对' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re_del.aspx?action=go&siteid=1000&classid=177&reid=9&id=123',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it.each([
    [
      'reply deletion',
      buildYaohuoDeleteReplyRequest({
        deletePath: '/bbs/book_re_del.aspx?action=godel&siteid=1000&classid=177&reid=9&id=123'
      })
    ],
    ['vote', buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteId: '7' })]
  ])('does not confirm %s from an inconclusive action notice', async (_action, request) => {
    for (const message of [
      '页面已过期，请刷新后重试',
      '操作太频繁，请稍后再试',
      '请先输入验证码',
      '请求处理中',
      '操作没有成功',
      '成功后才能返回',
      '删除成功了吗',
      '投票成功后才能查看结果'
    ]) {
      const fetcher = voteFetcher(`<div class="tip">${message}</div>`);
      await expect(runYaohuoAction({ request, fetcher })).resolves.toEqual({ status: 'unknown', message });
      expect(fetcher).toHaveBeenCalledTimes(request.method === 'POST' ? 2 : 1);
    }
  });

  it.each([
    [
      'reply deletion',
      buildYaohuoDeleteReplyRequest({
        deletePath: '/bbs/book_re_del.aspx?action=godel&siteid=1000&classid=177&reid=9&id=123'
      }),
      '删除成功！ 跳转中...返回',
      '投票成功'
    ],
    ['vote', buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteId: '7' }), '投票成功', '删除成功']
  ])('confirms %s only from its own completion notice', async (_action, request, success, otherAction) => {
    const fetcher = voteFetcher(`<div class="tip">${success}</div>`);
    await expect(runYaohuoAction({ request, fetcher })).resolves.toEqual({ status: 'confirmed', message: success });
    await expect(
      runYaohuoAction({
        request,
        fetcher: voteFetcher(`<div class="tip">${otherAction}</div>`)
      })
    ).resolves.toEqual({ status: 'unknown', message: otherAction });
  });

  it('reads fresh vote metadata before posting all chosen options exactly once', async () => {
    let reads = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'GET' && url.endsWith('/bbs-123.html')) {
        return htmlResponse(voteContainer(`fresh-vote-token-${++reads}`), 200, url);
      }
      const body = new URLSearchParams(String(init?.body));
      return htmlResponse(
        `<div class="tip">${reads > 0 && body.get('__CSRFToken') === `fresh-vote-token-${reads}` ? '投票成功' : '投票失败'}</div>`,
        200,
        url
      );
    });
    const request = buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteIds: ['7', '8'] });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await expect(runYaohuoAction({ request, fetcher })).resolves.toEqual({
        status: 'confirmed',
        message: '投票成功'
      });
      expect(fetcher.mock.calls.at(-2)).toEqual([
        'https://www.yaohuo.me/bbs-123.html',
        expect.objectContaining({ method: 'GET', body: undefined })
      ]);
      const [url, init] = fetcher.mock.calls.at(-1)!;
      expect(url).toBe('https://www.yaohuo.me/bbs/book_view_toVote.aspx');
      expect(init).toMatchObject({
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      });
      const body = new URLSearchParams(String(init?.body));
      expect(body.getAll('vid')).toEqual(['7', '8']);
      expect(Object.fromEntries(body)).toMatchObject({
        __CSRFToken: `fresh-vote-token-${attempt}`,
        siteid: '1000',
        classid: '',
        id: '123',
        vpage: '1',
        lpage: '1'
      });
    }
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['already voted', `<body data-has-voted="true">${voteContainer()}</body>`],
    ['disabled choice', voteContainer().replace('data-vid="7"', 'data-vid="7" disabled')],
    ['missing token', voteContainer('')],
    [
      'foreign action',
      voteContainer().replace('/bbs/book_view_toVote.aspx', 'https://example.com/bbs/book_view_toVote.aspx')
    ],
    ['another action', voteContainer().replace('book_view_toVote.aspx', 'book_re.aspx')],
    ['another topic', voteContainer().replaceAll('data-id="123"', 'data-id="456"')],
    ['another site', voteContainer().replaceAll('data-siteid="1000"', 'data-siteid="2000"')],
    ['another choice', voteContainer().replace('data-vid="7"', 'data-vid="9"')],
    ['another category', voteContainer().replaceAll('data-siteid="1000"', 'data-siteid="1000" data-classid="213"')],
    ['ambiguous container', voteContainer() + voteContainer()]
  ])('does not POST a vote with %s', async (_kind, html) => {
    const fetcher = vi.fn(async (url: string) => htmlResponse(html, 200, url));
    await expect(
      runYaohuoAction({ request: buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteId: '7' }), fetcher })
    ).rejects.toThrow('无法读取妖火投票验证信息，请刷新后重试');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://www.yaohuo.me/bbs-123.html');
  });

  it('does not POST a vote after the topic read redirects outside yaohuo', async () => {
    const fetcher = vi.fn(async () => htmlResponse(voteContainer(), 200, 'https://example.com/bbs-123.html'));
    await expect(
      runYaohuoAction({ request: buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteId: '7' }), fetcher })
    ).rejects.toThrow('无法读取妖火投票验证信息，请刷新后重试');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('still posts an enabled choice when another option is disabled', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
      htmlResponse(
        init?.method === 'GET'
          ? voteContainer().replace('data-vid="8"', 'data-vid="8" disabled')
          : '<div class="tip">投票成功</div>',
        200,
        url
      )
    );
    await expect(
      runYaohuoAction({ request: buildYaohuoVoteRequest({ topicId: '123', classId: '177', voteId: '7' }), fetcher })
    ).resolves.toEqual({ status: 'confirmed', message: '投票成功' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not report long full pages without a tip as submitted', async () => {
    const fetcher = vi.fn(async () =>
      htmlResponse(`
      <html>
        <head><title>妖火论坛</title></head>
        <body>
          <div class="content">这里是完整论坛页面，不是操作结果提示。页面内容很长，可能是操作失败后返回的普通页面。</div>
          <div>请回到帖子页面检查实际状态，避免把失败误认为成功。</div>
          <div>这些导航、页脚、公告和列表内容都不应该被当成操作成功提示。</div>
        </body>
      </html>
    `)
    );

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
    const fetcher = vi.fn(async () =>
      htmlResponse(
        `
      <html><body>
        <div>这是其他来源返回的完整收藏夹页面，路径相同也不能作为妖火收藏成功的证据。</div>
        <div>页面包含足够多的导航、列表和页脚文字，必须继续保持结果不确定。</div>
        <div>不能因为最终路径名字相同就把外站页面当作妖火的成功跳转。</div>
      </body></html>
    `,
        200,
        'https://example.com/bbs/favlist.aspx'
      )
    );

    const result = await runYaohuoAction({
      request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
      fetcher
    });

    expect(result).toMatchObject({
      status: 'unknown',
      message: '操作结果无法确认，请刷新原帖核对'
    });
  });

  it.each([
    ['评论成功', '<html>评论成功</html>'],
    [
      '回复成功！ 获得妖晶:30，获得经验:0 跳转中...返回',
      '<div class="tip"><strong>回复成功！</strong> 获得妖晶:30，获得经验:0 <span>跳转中...</span><a>返回</a></div>'
    ]
  ])('confirms the original reply success response: %s', async (message, html) => {
    const fetcher = replyFetcher(html);

    const result = await runYaohuoAction({
      request: buildYaohuoReplyRequest({
        topicId: '123',
        classId: '177',
        content: '谢谢分享'
      }),
      fetcher
    });

    expect(result).toMatchObject({ status: 'confirmed', message });
  });

  it.each([
    ['empty', '<html></html>'],
    ['unrecognized short', '<html>请求处理中</html>'],
    ['ambiguous success wording', '<html>评论成功了吗</html>']
  ])('marks %s action text unknown without a success oracle', async (_kind, html) => {
    const fetcher = replyFetcher(html);

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
    const failedReplyFetcher = replyFetcher('<div class="tip">评论失败</div>');
    await expect(
      runYaohuoAction({
        request: buildYaohuoReplyRequest({
          topicId: '123',
          classId: '177',
          content: '谢谢分享',
          sid: 'secret'
        }),
        fetcher: failedReplyFetcher
      })
    ).rejects.toThrow('评论失败');

    const deniedFavoriteFetcher = vi.fn(async () => htmlResponse('<html>权限不足</html>'));
    await expect(
      runYaohuoAction({
        request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
        fetcher: deniedFavoriteFetcher
      })
    ).rejects.toThrow('权限不足');
  });

  it('rejects long yaohuo failure tips before shortening the message', async () => {
    const fetcher = replyFetcher(`
      <div class="tip">
        评论失败，当前内容未能提交。请检查当前账号状态、帖子权限、重复提交限制和内容格式后再试，
        这段失败提示超过八十个字，不能因为过长就被当成操作已提交，也不能隐藏原始失败原因。
      </div>
    `);

    await expect(
      runYaohuoAction({
        request: buildYaohuoReplyRequest({
          topicId: '123',
          classId: '177',
          content: '谢谢分享',
          sid: 'secret'
        }),
        fetcher
      })
    ).rejects.toThrow('评论失败');
  });

  it('rejects yaohuo failure text inside nested tip markup', async () => {
    const fetcher = vi.fn(async () => htmlResponse('<div class="tip"><span>提示</span>权限不足</div>'));

    await expect(
      runYaohuoAction({
        request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
        fetcher
      })
    ).rejects.toThrow('权限不足');
  });

  it('times out stuck yaohuo write requests', async () => {
    const stuckFetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        })
    );

    await expect(
      runYaohuoAction({
        request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
        fetcher: stuckFetcher,
        timeoutMs: 1
      })
    ).rejects.toThrow('请求超时，请稍后重试');
  });

  it('surfaces login and captcha pages as a relogin flow', async () => {
    const loginFetcher = vi.fn(async () =>
      htmlResponse(
        `
      <script src="/NetCSS/CSS/Login/Gocaptcha/gocaptcha.global.js"></script>
      <form name="login" method="post">
        <input id="logname" name="logname" />
        <input id="password" name="logpass" type="password" />
      </form>
    `,
        200,
        'https://www.yaohuo.me/waplogin.aspx?siteid=1000'
      )
    );
    await expect(
      runYaohuoAction({
        request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
        fetcher: loginFetcher
      })
    ).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });

    const captchaFetcher = vi.fn(async () =>
      htmlResponse('<script>window.CAPTCHA_CONFIG={}</script><div>访问验证</div>')
    );
    await expect(
      runYaohuoAction({
        request: buildYaohuoFavoriteRequest({ topicId: '123', classId: '177' }),
        fetcher: captchaFetcher
      })
    ).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });
});
