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

describe('linux.do action client', () => {
  it('gets a CSRF token and sends login cookies with Discourse actions', async () => {
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

  it('checks linux.do login access with the saved login cookies', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ csrf: 'csrf-token' }), {
      headers: { 'content-type': 'application/json' }
    }));

    const result = await checkLinuxDoLoginAccess({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      userAgent: 'LinuxDo WebView UA',
      fetcher
    });

    expect(result).toEqual({ ok: true, message: '登录可用' });
    expect(fetcher).toHaveBeenCalledWith('https://linux.do/session/csrf', expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'User-Agent': 'LinuxDo WebView UA'
      })
    }));
  });

  it('marks linux.do login expired when CSRF access is unauthorized', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: ['请先登录'] }), { status: 401 }));

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
});
