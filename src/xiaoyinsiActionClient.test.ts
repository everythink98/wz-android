import { describe, expect, it, vi } from 'vitest';

import { runXiaoyinsiAction } from '@/xiaoyinsiActionClient';
import { buildDiscourseActionRequest } from '@/sources/discourse/actionRequest';

describe('小隐寺 User API action client', () => {
  it('只携带独立 User API headers，不使用 Cookie 或 CSRF', async () => {
    const fetcher = vi.fn(
      async (_input: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' }
        })
    );

    await runXiaoyinsiAction({
      credentials: { apiKey: 'secret-api-key', clientId: 'installation-client-id' },
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [, init] = fetcher.mock.calls[0];
    expect(fetcher.mock.calls[0][0]).toBe('https://forum.xiaoyinsi.com/post_actions');
    expect(init).toMatchObject({
      method: 'POST',
      body: 'id=101&post_action_type_id=2',
      headers: expect.objectContaining({
        'User-Api-Key': 'secret-api-key',
        'User-Api-Client-Id': 'installation-client-id'
      })
    });
    expect(init?.headers).not.toHaveProperty('Cookie');
    expect(init?.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('缺少任一授权材料时阻止写入', async () => {
    await expect(
      runXiaoyinsiAction({
        credentials: { apiKey: '', clientId: 'client' },
        request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
        fetcher: vi.fn()
      })
    ).rejects.toMatchObject({
      source: 'xiaoyinsi',
      loginRequired: true
    });
  });

  it('普通 403 只标记操作权限不足，并要求上层复核会话', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: ['没有权限执行该操作'] }), {
          status: 403
        })
    );

    await expect(
      runXiaoyinsiAction({
        credentials: { apiKey: 'key', clientId: 'client' },
        request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
        fetcher
      })
    ).rejects.toMatchObject({
      source: 'xiaoyinsi',
      status: 403,
      reason: 'permission',
      authorizationCheckRequired: true
    });
  });

  it('401 要求复核授权，但错误信息不回显 Token', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: ['无效的 API key'] }), {
          status: 401
        })
    );

    const promise = runXiaoyinsiAction({
      credentials: { apiKey: 'do-not-log-this-token', clientId: 'client' },
      request: buildDiscourseActionRequest({ type: 'set-like', postId: 101, active: true }),
      fetcher
    });
    await expect(promise).rejects.toMatchObject({
      source: 'xiaoyinsi',
      status: 401,
      authorizationCheckRequired: true
    });
    await expect(promise).rejects.not.toThrow('do-not-log-this-token');
  });
});
