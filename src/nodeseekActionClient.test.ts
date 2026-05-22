import { describe, expect, it, vi } from 'vitest';
import { runNodeSeekAction } from './nodeseekActionClient';
import { buildNodeSeekAttendanceRequest } from './nodeseekActions';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

describe('runNodeSeekAction', () => {
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
