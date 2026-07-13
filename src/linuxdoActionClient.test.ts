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
import { buildLinuxDoLikeRequest } from './linuxdoActions';

describe('linux.do action client', () => {
  it('gets a CSRF token and sends login cookies with Discourse actions', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://linux.do/session/csrf') {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://linux.do/post_actions') {
        return new Response(JSON.stringify({
          success: true,
          cooked: '<p>Example response: enable javascript and cookies</p>'
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    await runLinuxDoAction({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      userAgent: 'LinuxDo WebView UA',
      request: buildLinuxDoLikeRequest({ postId: 101, liked: false }),
      fetcher
    });

    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://linux.do/session/csrf', expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'User-Agent': 'LinuxDo WebView UA'
      })
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://linux.do/post_actions', expect.objectContaining({
      method: 'POST',
      body: 'id=101&post_action_type_id=2',
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'X-CSRF-Token': 'csrf-token'
      })
    }));
  });

  it('requires a linux.do login cookie for write actions', async () => {
    await expect(runLinuxDoAction({
      cookieHeader: 'cf_clearance=clearance',
      request: buildLinuxDoLikeRequest({ postId: 101, liked: false }),
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
      request: buildLinuxDoLikeRequest({ postId: 101, liked: false }),
      fetcher
    })).rejects.toMatchObject({
      source: 'linuxdo',
      reason: 'permission'
    });
  });

  it('checks linux.do login access with the saved login cookies', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      current_user: { id: 123, username: 'safe-user' }
    }), {
      headers: { 'content-type': 'application/json' }
    }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      userAgent: 'LinuxDo WebView UA',
      fetcher
    });

    expect(result).toEqual({ ok: true, message: '登录可用' });
    expect(fetcher).toHaveBeenCalledWith('https://linux.do/session/current.json', expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'User-Agent': 'LinuxDo WebView UA'
      })
    }));
  });

  it('marks linux.do login expired when the current-session endpoint is anonymous', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      loginRequired: true,
      message: 'linux.do 登录已失效，请重新登录'
    });
  });

  it('does not treat a generic current-session 403 as expired login', async () => {
    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher: vi.fn(async () => new Response(JSON.stringify({ errors: ['forbidden'] }), { status: 403 }))
    });

    expect(result).toEqual({
      ok: false,
      message: 'linux.do 请求失败：HTTP 403',
      reason: 'permission_denied'
    });
  });

  it('does not mistake an anonymous CSRF response for a valid linux.do login', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith('/session/current.json')) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify({ csrf: 'anonymous-csrf-token' }));
    });

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=expired; _forum_session=expired',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      loginRequired: true,
      message: 'linux.do 登录已失效，请重新登录'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalledWith('https://linux.do/session/csrf', expect.anything());
  });

  it('does not accept a malformed current-session payload as logged in', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ current_user: {} })));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      fetcher
    });

    expect(result).toEqual({
      ok: false,
      message: 'linux.do 登录状态响应不完整',
      reason: 'invalid_response'
    });
  });
});
