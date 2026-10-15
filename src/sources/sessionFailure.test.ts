import { describe, expect, it, vi } from 'vitest';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import { forumResponseAccountFailure } from './sessionFailure';

describe('forum response account failure', () => {
  it.each(['nodeseek', 'linuxdo', 'yaohuo'] satisfies Source[])(
    'recognizes same-origin %s HTTP 401 without consuming the response',
    async (source) => {
      const response = new Response('login', { status: 401 });
      expect(await forumResponseAccountFailure(source, `${sourceCatalog[source].baseUrl}/request`, response)).toBe(
        'http-401'
      );
      expect(await response.text()).toBe('login');
      expect(
        await forumResponseAccountFailure(source, 'https://api.nodeimage.com/upload', new Response('', { status: 401 }))
      ).toBeUndefined();
      expect(
        await forumResponseAccountFailure(
          source,
          'https://third-party.invalid/upload',
          new Response('', { status: 401 })
        )
      ).toBeUndefined();
    }
  );
  it.each([403, 404])('recognizes only an explicit linux.do login HTTP %s response', async (status) => {
    const response = new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status });
    expect(await forumResponseAccountFailure('linuxdo', 'https://linux.do/posts', response)).toBe(
      'account-recheck-required'
    );
    expect(await response.json()).toEqual({ errors: ['您需要登录才能执行此操作。'] });
    for (const body of [
      '{"errors":["没有权限执行该操作"]}',
      '{"errors":["需要等级 Lv3 才能查看"]}',
      '{"errors":["CSRF token invalid，请先登录"]}',
      '{"errors":["页面不存在"]}'
    ])
      expect(
        await forumResponseAccountFailure('linuxdo', 'https://linux.do/posts', new Response(body, { status }))
      ).toBeUndefined();
    expect(
      await forumResponseAccountFailure(
        'linuxdo',
        'https://linux.do/posts',
        new Response('<title>Just a moment...</title>请先登录', { status, headers: { 'content-type': 'text/html' } })
      )
    ).toBeUndefined();
    expect(
      await forumResponseAccountFailure(
        'linuxdo',
        'https://linux.do/posts',
        new Response('{"errors":["请先登录"]}', { status, headers: { 'cf-mitigated': 'challenge' } })
      )
    ).toBeUndefined();
  });
  it('ignores cancellation while a cloned response body is pending and releases the late body', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        }
      }),
      { status: 404 }
    );
    const abort = new AbortController();
    const clone = vi.spyOn(response, 'clone');
    const classification = forumResponseAccountFailure('linuxdo', 'https://linux.do/posts', response, abort.signal);
    abort.abort();
    expect(await classification).toBeUndefined();
    expect(clone).toHaveBeenCalledTimes(1);
    controller?.enqueue(new TextEncoder().encode('{"errors":["请先登录"]}'));
    controller?.close();
    expect(await response.text()).toContain('请先登录');
  });
});
