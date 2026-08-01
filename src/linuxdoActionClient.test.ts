import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { runLinuxDoAction } from './linuxdoActionClient';
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
});
