import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { runLinuxDoAction } from './actionClient';
import { buildDiscourseActionRequest } from '@/sources/discourse/actionRequest';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';

describe('linux.do action client', () => {
  it.each([
    ['没有权限执行该操作', 403],
    ['需要等级 Lv3 才能查看', 403],
    ['CSRF token invalid，请先登录', 403],
    ['login settings failed', 500]
  ])('does not request account rechecks for %s', async (message, status) => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: [message] }), { status: Number(status) }));
    const error = await runLinuxDoAction({
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher
    }).catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('reason', 'account-recheck-required');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves an explicit login requirement as an account recheck signal without retrying the write', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.endsWith('/session/csrf')
        ? new Response(JSON.stringify({ csrf: 'token' }))
        : new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
    );
    await expect(
      runLinuxDoAction({
        request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
        fetcher
      })
    ).rejects.toMatchObject({
      message: '您需要登录才能执行此操作。',
      source: 'linuxdo',
      status: 403,
      kind: 'login-required',
      reason: 'account-recheck-required'
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('gets a CSRF token through the read-only cookie jar and preserves write priority', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://linux.do/session/csrf') {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://linux.do/post_actions') {
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    await runLinuxDoAction({
      userAgent: 'LinuxDo WebView UA',
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher
    });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://linux.do/session/csrf',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'LinuxDo WebView UA'
        })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://linux.do/post_actions',
      expect.objectContaining({
        method: 'POST',
        body: 'id=101&post_action_type_id=2',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf-token'
        })
      })
    );
    const calls = fetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(calls[0]?.[1]?.headers).not.toHaveProperty('Cookie');
    expect(calls[1]?.[1]?.headers).not.toHaveProperty('Cookie');
    expect(browserFetchIntentFromInit(calls[0]?.[1])).toEqual({
      owner: 'write',
      priority: 'write'
    });
    expect(browserFetchIntentFromInit(calls[1]?.[1])).toEqual({
      owner: 'write',
      priority: 'write'
    });
  });

  it('lets the server classify an unavailable managed linux.do session', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 401 }));

    await expect(
      runLinuxDoAction({
        request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
        fetcher
      })
    ).rejects.toMatchObject({
      source: 'linuxdo',
      loginRequired: true
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not treat ordinary permission failures as expired login', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://linux.do/session/csrf') {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }));
      }
      return new Response(JSON.stringify({ errors: ['没有权限执行该操作'] }), { status: 403 });
    });

    await expect(
      runLinuxDoAction({
        request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
        fetcher
      })
    ).rejects.toMatchObject({
      source: 'linuxdo',
      reason: 'permission'
    });
  });

  it('preserves plaintext permission status without exposing the response body', async () => {
    const fetcher = vi.fn(async () => new Response('permission detail '.repeat(1000), { status: 403 }));
    const error = await runLinuxDoAction({
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      csrfToken: 'test',
      fetcher
    }).catch((error) => error);
    expect(error).toMatchObject({ status: 403, reason: 'permission', message: 'linux.do 请求失败：HTTP 403' });
    expect(error).not.toHaveProperty('loginRequired');
  });

  it('rejects malformed successful JSON and continues to identify Cloudflare before parsing', async () => {
    const request = buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true });
    await expect(
      runLinuxDoAction({ request, csrfToken: 'test', fetcher: async () => new Response('invalid json') })
    ).rejects.toThrow('linux.do 返回内容格式不正确');
    await expect(
      runLinuxDoAction({
        request,
        csrfToken: 'test',
        fetcher: async () =>
          new Response('challenge', {
            status: 429,
            headers: { 'cf-mitigated': 'challenge', 'Retry-After': '60' }
          })
      })
    ).rejects.toMatchObject({ reason: 'cloudflare' });
  });
});
