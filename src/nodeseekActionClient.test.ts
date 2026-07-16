import { describe, expect, it, vi } from 'vitest';
import { fetchNodeSeekVoteInfo, runNodeSeekAction } from './nodeseekActionClient';
import { buildNodeSeekAttendanceRequest, buildNodeSeekReplyRequest } from './nodeseekActions';
import { browserFetchIntentFromInit } from './browserFetchIntent';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

describe('runNodeSeekAction', () => {
  it('[REG-WRITE-007] reads the authoritative NodeSeek poll snapshot with vote headers', async () => {
    const fetcher = vi.fn(async () => jsonResponse({
      vote: {
        id: 2443,
        voted: true,
        items: [
          { vote_item_id: 71, text: '选项 A', count: 2, voted: false },
          { vote_item_id: 72, text: '选项 B', count: 6, voted: true }
        ]
      }
    }));

    const poll = await fetchNodeSeekVoteInfo({
      cookieHeader: 'session=abc',
      pollId: '2443',
      fetcher,
      userAgent: 'current-webview-ua'
    });

    expect(poll).toMatchObject({
      id: '2443',
      voted: true,
      options: [
        { id: '71', count: 2, selected: false },
        { id: '72', count: 6, selected: true }
      ]
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/api/vote/info/2443',
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/json, text/plain, */*',
          cookie: 'session=abc',
          'user-agent': 'current-webview-ua',
          'x-dynamic-sign': 'a'.repeat(40)
        }),
        signal: expect.any(AbortSignal)
      })
    );
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(browserFetchIntentFromInit(calls[0]?.[1])).toEqual({
      owner: 'write',
      priority: 'write',
      cancelable: false
    });
  });

  it('sends NodeSeek write requests with browser-like action headers', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ success: true }));

    await runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/api/attendance?random=false', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'content-type': 'application/json',
        cookie: 'session=abc',
        origin: 'https://www.nodeseek.com',
        referer: 'https://www.nodeseek.com/',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': expect.stringContaining('Mozilla/5.0'),
        'x-csrf-challenge': 'simple-token',
        'x-requested-with': 'XMLHttpRequest'
      }),
      body: undefined,
      signal: expect.any(AbortSignal)
    }));
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(browserFetchIntentFromInit(calls[0]?.[1])).toEqual({
      owner: 'write',
      priority: 'write',
      cancelable: false
    });
  });

  it('uses the current NodeSeek WebView user agent for write requests when provided', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ success: true }));
    const userAgent = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36';

    await runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher,
      userAgent
    });

    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({
        'user-agent': userAgent
      })
    }));
  });

  it('sends content write requests with the request csrf-token header and no preflight', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ success: true }));

    await runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekReplyRequest({ postId: 801061, content: '测试回复', csrfToken: 'fixed-csrf-token' }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/api/content/new-comment', expect.objectContaining({
      headers: expect.objectContaining({
        'csrf-token': 'fixed-csrf-token',
        'x-csrf-challenge': 'simple-token'
      })
    }));
    const calls = fetcher.mock.calls as unknown as Array<[unknown, RequestInit?]>;
    const init = calls[0]?.[1];
    expect(init?.headers).not.toEqual(expect.objectContaining({
      'X-CSRF-Token': expect.any(String)
    }));
  });

  it('surfaces the high risk action message without retrying repeatedly', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ message: 'high risk action' }, 403));

    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher
    })).rejects.toThrow('high risk action');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('marks rejected login cookies and times out stuck write requests', async () => {
    const rejectedFetcher = vi.fn(async () => jsonResponse({}, 401));
    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher: rejectedFetcher
    })).rejects.toMatchObject({
      source: 'nodeseek',
      loginRequired: true
    });

    const stuckFetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }));
    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher: stuckFetcher,
      timeoutMs: 1
    })).rejects.toThrow('请求超时，请稍后重试');
  });

  it('does not mark generic 403 refusals as expired login cookies', async () => {
    const rejectedFetcher = vi.fn(async () => jsonResponse({}, 403));

    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher: rejectedFetcher
    })).rejects.not.toMatchObject({
      source: 'nodeseek',
      loginRequired: true
    });
  });


  it('treats HTTP 200 NodeSeek error payloads as failed write actions', async () => {
    const failedSuccessFetcher = vi.fn(async () => jsonResponse({
      success: false,
      message: '今日已签到'
    }));

    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher: failedSuccessFetcher
    })).rejects.toThrow('今日已签到');

    const errorFetcher = vi.fn(async () => jsonResponse({ error: 'csrf invalid' }));
    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher: errorFetcher
    })).rejects.toThrow('csrf invalid');

    const messageFetcher = vi.fn(async () => jsonResponse({ message: 'high risk action' }));
    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher: messageFetcher
    })).rejects.toThrow('high risk action');
  });

  it('rejects HTTP 200 non-JSON action responses', async () => {
    const fetcher = vi.fn(async () => new Response('<html>login</html>', {
      status: 200,
      headers: {
        'content-type': 'text/html'
      }
    }));

    await expect(runNodeSeekAction({
      cookieHeader: 'session=abc',
      request: buildNodeSeekAttendanceRequest({ random: false }),
      fetcher
    })).rejects.toThrow('NodeSeek 返回内容格式不正确');
  });
});
