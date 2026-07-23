import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import { checkLinuxDoLoginAccess, runLinuxDoAction } from './linuxdoActionClient';
import { buildDiscourseActionRequest } from './discourseActions';
import { browserFetchIntentFromInit } from './browserFetchIntent';

describe('linux.do action client', () => {
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
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      userAgent: 'LinuxDo WebView UA',
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher
    });

    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://linux.do/session/csrf', expect.objectContaining({
      headers: expect.objectContaining({
        'User-Agent': 'LinuxDo WebView UA'
      })
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://linux.do/post_actions', expect.objectContaining({
      method: 'POST',
      body: 'id=101&post_action_type_id=2',
      headers: expect.objectContaining({
        'X-CSRF-Token': 'csrf-token'
      })
    }));
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
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

  it('requires a linux.do login cookie for write actions', async () => {
    await expect(runLinuxDoAction({
      cookieHeader: 'cf_clearance=clearance',
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher: vi.fn()
    })).rejects.toMatchObject({
      source: 'linuxdo',
      loginRequired: true
    });
  });

  it('does not treat ordinary permission failures as expired login', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://linux.do/session/csrf') {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }));
      }
      return new Response(JSON.stringify({ errors: ['没有权限执行该操作'] }), { status: 403 });
    });

    await expect(runLinuxDoAction({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher
    })).rejects.toMatchObject({
      source: 'linuxdo',
      reason: 'permission'
    });
  });

  it('[REG-ACCOUNT-029] checks linux.do login through the native read-only cookie jar', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      current_user: { username: 'alice' }
    }), {
      headers: { 'content-type': 'application/json' }
    }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      userAgent: 'LinuxDo WebView UA',
      fetcher
    });

    expect(result).toEqual({
      ok: true,
      loginRequired: false,
      message: '登录可用',
      currentUser: {
        source: 'linuxdo',
        id: 'alice',
        username: 'alice',
        displayName: 'alice',
        url: 'https://linux.do/u/alice',
        topics: []
      }
    });
    expect(fetcher).toHaveBeenCalledWith('https://linux.do/session/current.json', expect.objectContaining({
      headers: expect.objectContaining({
        'User-Agent': 'LinuxDo WebView UA'
      })
    }));
    expect((fetcher.mock.calls as unknown as Array<[string, RequestInit?]>)[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('REG-LINUXDO-004 rejects stale login cookies when the current session is anonymous', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      csrf: 'anonymous-csrf-token',
      current_user: null
    }), { status: 200 }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=expired; _forum_session=anonymous',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      loginRequired: true,
      message: 'linux.do 登录已失效，请重新登录'
    });
  });

  it('[REG-ACCOUNT-019] keeps a malformed successful current-session payload unknown', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ csrf: 'present-but-no-user-field' }), { status: 200 }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      message: 'linux.do 状态暂时无法确认'
    });
  });

  it('[REG-ACCOUNT-019] treats Discourse current-session 404 as explicit logout', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=expired; _forum_session=anonymous',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      loginRequired: true,
      message: 'linux.do 登录已失效，请重新登录'
    });
  });

  it.each([401, 403])('[REG-ACCOUNT-025] keeps non-contract current-session HTTP %i unknown', async (status) => {
    const fetcher = vi.fn(async () => new Response('<html>login required</html>', {
      status,
      headers: { 'content-type': 'text/html' }
    }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=expired; _forum_session=anonymous',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      message: `linux.do 请求失败：HTTP ${status}`
    });
  });

  it('keeps an inconclusive linux.do rate limit distinct from expired login', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: ['请求过于频繁'] }), { status: 429 }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      message: '请求过于频繁'
    });
  });

  it('keeps a Cloudflare challenge distinct from expired login', async () => {
    const fetcher = vi.fn(async () => new Response('<title>Just a moment...</title>', {
      status: 403,
      headers: { 'content-type': 'text/html' }
    }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      message: 'linux.do 需要完成 Cloudflare 验证'
    });
  });

  it('[REG-ACCOUNT-025] does not turn an uncontracted 401 body into destructive expiry authority', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: ['请先登录'] }), { status: 401 }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      message: '请先登录'
    });
  });
});
