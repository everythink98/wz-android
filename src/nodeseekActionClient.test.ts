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

    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/api/attendance?random=false', {
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
      body: undefined
    });
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
});
