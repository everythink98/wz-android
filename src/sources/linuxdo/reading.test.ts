import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createDiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { createLinuxDoReadingSender, getLinuxDoReadingBatch } from './reading';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';
import { fetchLinuxDoJson } from './reader';
import { createLinuxDoWebViewFallbackFetcher } from './browserFallback';
import {
  beginDiagnosticTrace,
  diagnosticRequestFields,
  diagnosticTraceForRequest,
  setDiagnosticWriter,
  withDiagnosticFetcher,
  withNativeDiagnosticRequest
} from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';

const batch = { topicId: '12', topicTime: 1000, timings: { 1: 1000, 40: 1000 } };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });

afterEach(() => {
  setDiagnosticWriter(null);
  vi.useRealTimers();
});

function setupReadingRuntime(fetcher: Fetcher) {
  vi.useFakeTimers();
  let clock = 0;
  const scope = () => 'alice';
  const sender = createLinuxDoReadingSender({ fetcher, scope, userAgent: () => 'fixture-agent' });
  const runtime = createDiscourseReadingRuntime({
    queryClient: new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
    scope,
    send: (batch, identity, signal, context) =>
      sender(batch, identity, signal, undefined, context.recovery, context.beforePost),
    now: () => clock
  });
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      clock += Math.min(1000, ms - elapsed);
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - elapsed));
    }
  };
  return { runtime, advance };
}

describe('LinuxDo reading transport', () => {
  it.each(['/session/csrf', '/topics/timings'])(
    'does not send %s after proxy preparation outlives its scope',
    async (path) => {
      let identity = 'alice';
      const pending = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      const sent: string[] = [];
      const sender = createLinuxDoReadingSender({
        scope: () => identity,
        userAgent: () => 'fixture-agent',
        fetcher: async (url, init) => {
          if (url.endsWith(path)) {
            started.resolve();
            await pending.promise;
          }
          prepareRequestToSend(init);
          sent.push(url);
          return url.endsWith('/session/csrf') ? json({ csrf: 'fixture' }) : new Response('');
        }
      });
      const result = sender(batch, 'alice', new AbortController().signal);
      const rejected = expect(result).rejects.toThrow('请求已取消');
      await started.promise;
      identity = 'bob';
      pending.resolve();
      await rejected;
      expect(sent.some((url) => url.endsWith(path))).toBe(false);
    }
  );

  it('preserves a confirmed timings response when the scope changes after sending', async () => {
    let identity = 'alice';
    const sender = createLinuxDoReadingSender({
      scope: () => identity,
      userAgent: () => 'fixture-agent',
      fetcher: async (url) => {
        if (url.endsWith('/session/csrf')) return json({ csrf: 'fixture' });
        identity = 'bob';
        return new Response('');
      }
    });
    await expect(sender(batch, 'alice', new AbortController().signal)).resolves.toBeUndefined();
  });
  it.each([true, false])(
    'preserves CSRF challenge cooldown after hidden fallback fails (header=%s)',
    async (header) => {
      const fetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher: async () =>
          new Response('<title>Just a moment...</title>', {
            status: 429,
            headers: {
              'content-type': 'text/html',
              ...(header ? { 'cf-mitigated': 'challenge' } : {}),
              'Retry-After': '60',
              'cf-ray': '0123456789abcdef-HKG'
            }
          }),
        webViewFetcher: async () => {
          throw new Error('hidden browser unavailable');
        }
      });
      const sender = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'fixture-agent' });
      await expect(sender(batch, 'alice', new AbortController().signal)).rejects.toMatchObject({
        reason: 'cloudflare',
        status: 429,
        retryAfterMs: 60000,
        cfRay: '0123456789abcdef-HKG',
        hasCfMitigatedChallenge: header,
        hasCfChallengeBody: true
      });
    }
  );

  it.each(['/session/csrf', '/topics/timings'])(
    'retains challenge evidence and refreshes CSRF for recovery from %s',
    async (path) => {
      let challenge = true;
      const fetcher = vi.fn<Fetcher>(async (url) => {
        if (challenge && url.endsWith(path))
          return new Response('<title>Just a moment...</title>', {
            status: 429,
            headers: {
              'content-type': 'text/html',
              'cf-mitigated': 'challenge',
              'Retry-After': '2',
              'cf-ray': '0123456789abcdef-HKG'
            }
          });
        return url.endsWith('/session/csrf') ? json({ csrf: 'fixture' }) : new Response('');
      });
      const sender = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'fixture-agent' });
      const signal = new AbortController().signal;
      await expect(sender(batch, 'alice', signal)).rejects.toMatchObject({
        reason: 'cloudflare',
        status: 429,
        retryAfterMs: 2000,
        hasCfMitigatedChallenge: true,
        hasCfChallengeBody: true,
        cfRay: '0123456789abcdef-HKG'
      });
      challenge = false;
      await sender(batch, 'alice', signal, undefined, true);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/csrf'))).toHaveLength(2);
      const posts = fetcher.mock.calls.filter(([url]) => url.endsWith('/topics/timings'));
      expect(posts.at(-1)?.[1]?.body).toBe(
        new URLSearchParams({
          topic_id: '12',
          topic_time: '1000',
          'timings[1]': '1000',
          'timings[40]': '1000'
        }).toString()
      );
    }
  );
  it.each(['/session/csrf', '/topics/timings'])(
    'retains each reading increment across an HTTP 429 from %s without sending during Retry-After',
    async (rejectedPath) => {
      let rejected = false;
      const accepted: URLSearchParams[] = [];
      const fetcher = vi.fn<Fetcher>(async (url, init) => {
        if (!rejected && url.endsWith(rejectedPath)) {
          rejected = true;
          return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '12' } });
        }
        if (url.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'fixture' }));
        accepted.push(new URLSearchParams(init?.body as string));
        return new Response('');
      });
      const { runtime, advance } = setupReadingRuntime(fetcher);
      try {
        const session = runtime.begin('12');
        session.visible([1]);
        session.active(true);
        await advance(1000);
        session.visible([2]);
        await advance(5000);
        session.end();
        const beforeRetry = fetcher.mock.calls.length;
        await advance(6000);
        expect(fetcher).toHaveBeenCalledTimes(beforeRetry);
        expect(accepted).toHaveLength(0);
        await advance(1000);
        expect(accepted.map((body) => Object.fromEntries(body))).toEqual([
          { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
          { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' }
        ]);
        await advance(30000);
        expect(accepted).toHaveLength(2);
        expect(runtime.state()['12'].server.lastReadPostNumber).toBe(2);
        expect(runtime.state()['12'].anchor).toEqual({ floor: 2 });
      } finally {
        runtime.dispose();
      }
    }
  );

  it('drops an ambiguous HTTP timeout while delivering independently collected reading exactly once', async () => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const posts: { body: URLSearchParams; signal?: AbortSignal | null }[] = [];
    const fetcher = vi.fn<Fetcher>(async (url, init) => {
      if (url.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'fixture' }));
      posts.push({ body: new URLSearchParams(init?.body as string), signal: init?.signal });
      return posts.length === 1 ? pending : new Response('');
    });
    const { runtime, advance } = setupReadingRuntime(fetcher);
    try {
      const session = runtime.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      session.visible([2]);
      await advance(5000);
      session.end();
      expect(posts).toHaveLength(1);
      await advance(10000);
      expect(posts[0].signal?.aborted).toBe(true);
      expect(posts.map(({ body }) => Object.fromEntries(body))).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' }
      ]);
      complete(new Response(''));
      await advance(30000);
      expect(posts).toHaveLength(2);
      expect(runtime.state()['12'].readPosts).toEqual({ 1: true, 2: true });
      expect(runtime.state()['12'].anchor).toEqual({ floor: 2 });
      const next = runtime.begin('13');
      next.visible([1]);
      next.active(true);
      await advance(1000);
      next.end();
      expect(posts.map(({ body }) => body.get('topic_id'))).toEqual(['12', '12', '13']);
    } finally {
      complete(new Response(''));
      runtime.dispose();
    }
  });

  it('correlates serialized reading and visit fields with consumed responses without exposing private data or adding requests', async () => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const topicId = '31415926';
    const responses: Response[] = [];
    const postRequests: string[] = [];
    const responseText = JSON.stringify({ fixture: 'PRIVATE_BODY_正文' });
    const fetcher = vi.fn<Fetcher>(async (url, init) => {
      expect(diagnosticTraceForRequest(init)).toBeDefined();
      const nativeHeaders = new Headers(withNativeDiagnosticRequest(init)?.headers);
      expect(nativeHeaders.get('X-WZ-Diagnostic-Request')).toBe(diagnosticRequestFields(init).requestId);
      if (url.endsWith('/session/csrf')) return json({ csrf: 'PRIVATE_CSRF' });
      if (url.includes('/topics/timings')) {
        postRequests.push(diagnosticRequestFields(init).requestId!);
        const response = new Response(postRequests.length === 1 ? '' : responseText);
        vi.spyOn(response, 'text');
        vi.spyOn(response, 'clone');
        responses.push(response);
        return response;
      }
      return json({ id: topicId });
    });
    const send = createLinuxDoReadingSender({
      fetcher,
      scope: () => 'PRIVATE_ACCOUNT:1',
      userAgent: () => 'PRIVATE_AGENT'
    });
    const trace = beginDiagnosticTrace('source', 'reading-timings', { source: 'linuxdo' });
    await send(
      { topicId, topicTime: 3750, timings: { 1: 2500, 40: 1250 } },
      'PRIVATE_ACCOUNT:1',
      new AbortController().signal,
      trace
    );
    await send(
      { topicId, topicTime: 2100, timings: { 40: 2100 } },
      'PRIVATE_ACCOUNT:1',
      new AbortController().signal,
      trace
    );
    const visitTrace = beginDiagnosticTrace('source', 'getTopic', { source: 'linuxdo' });
    const topicFetcher = withDiagnosticFetcher(visitTrace, fetcher);
    await fetchLinuxDoJson(`/t/${topicId}.json`, { track_visit: 'true' }, { fetcher: topicFetcher, trackView: true });
    await fetchLinuxDoJson(`/t/${topicId}.json`, undefined, { fetcher: topicFetcher });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/csrf'))).toHaveLength(1);
    const submitted = events.filter((event) => event.topicTimeMs !== undefined);
    expect(submitted).toMatchObject([
      { requestId: postRequests[0], topicTimeMs: 3750, itemCount: 2, isTopicIdMatch: true, isFormEncoded: true },
      { requestId: postRequests[1], topicTimeMs: 2100, itemCount: 1, isTopicIdMatch: true, isFormEncoded: true }
    ]);
    expect(events.filter((event) => event.postTimeMs !== undefined)).toMatchObject([
      { requestId: postRequests[0], floor: 1, postTimeMs: 2500 },
      { requestId: postRequests[0], floor: 40, postTimeMs: 1250 },
      { requestId: postRequests[1], floor: 40, postTimeMs: 2100 }
    ]);
    expect(events.filter((event) => event.isBodyEmpty !== undefined)).toMatchObject([
      { requestId: postRequests[0], status: 200, isBodyEmpty: true, byteCount: 0 },
      {
        requestId: postRequests[1],
        status: 200,
        isBodyEmpty: false,
        byteCount: new TextEncoder().encode(responseText).byteLength
      }
    ]);
    for (const response of responses) {
      expect(response.headers.has('Content-Length')).toBe(false);
      expect(response.text).toHaveBeenCalledTimes(1);
      expect(response.clone).not.toHaveBeenCalled();
    }
    const visits = events.filter((event) => event.isTrackVisit !== undefined && event.state === 'start');
    expect(visits).toMatchObject([
      { isTrackVisit: true, hasTrackView: true, isTrackViewTopicIdMatch: true },
      { isTrackVisit: false, hasTrackView: false, isTrackViewTopicIdMatch: false }
    ]);
    expect(submitted[0].topicRef).toMatch(/^topic-\d+$/);
    expect(visits[0].topicRef).toBe(submitted[0].topicRef);
    expect(JSON.stringify(events)).not.toMatch(/PRIVATE_|31415926|https?:|Cookie|CSRF|User-Agent|正文/);
  });

  it('caches CSRF within the transport identity and accepts empty timings responses at background priority', async () => {
    const fetcher = vi.fn<Fetcher>(async (url) =>
      url.endsWith('/session/csrf') ? json({ csrf: 'test' }) : new Response('')
    );
    let identity = 'alice:1';
    const send = createLinuxDoReadingSender({ fetcher, scope: () => identity, userAgent: () => 'test-agent' });
    await send(batch, identity, new AbortController().signal);
    await send(batch, identity, new AbortController().signal);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/session/csrf',
      '/topics/timings',
      '/topics/timings'
    ]);
    expect(new URLSearchParams(fetcher.mock.calls[1][1]?.body as string).get('timings[40]')).toBe('1000');
    expect(fetcher.mock.calls.every(([, init]) => browserFetchIntentFromInit(init)?.priority === 'background')).toBe(
      true
    );
    identity = 'bob:2';
    await send(batch, identity, new AbortController().signal);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/csrf'))).toHaveLength(2);
  });

  it('stops between CSRF and POST when the account changes', async () => {
    let identity = 'alice';
    const fetcher = vi.fn<Fetcher>(async () => {
      identity = 'bob';
      return json({ csrf: 'test' });
    });
    const send = createLinuxDoReadingSender({ fetcher, scope: () => identity, userAgent: () => 'test-agent' });
    await expect(send(batch, 'alice', new AbortController().signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['CSRF token invalid', '没有权限'])('refreshes only an explicit CSRF rejection: %s', async (message) => {
    let posts = 0;
    const fetcher = vi.fn<Fetcher>(async (url) =>
      url.endsWith('/session/csrf')
        ? json({ csrf: 'test' })
        : ++posts === 1
          ? json({ errors: [message] }, 403)
          : new Response('')
    );
    const send = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'test-agent' });
    const result = send(batch, 'alice', new AbortController().signal);
    if (message.includes('CSRF')) {
      await result;
      expect(fetcher).toHaveBeenCalledTimes(4);
    } else {
      await expect(result).rejects.toMatchObject({ status: 403 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it.each(['BAD CSRF', '没有权限'])('classifies the original plain JSON error array: %s', async (message) => {
    let posts = 0;
    const fetcher = vi.fn<Fetcher>(async (url) =>
      url.endsWith('/session/csrf')
        ? json({ csrf: 'test' })
        : ++posts === 1
          ? new Response(JSON.stringify([message]), { status: 403, headers: { 'Content-Type': 'text/plain' } })
          : new Response('')
    );
    const send = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'test-agent' });
    const result = send(batch, 'alice', new AbortController().signal);
    if (message === 'BAD CSRF') {
      await result;
      expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
        '/session/csrf',
        '/topics/timings',
        '/session/csrf',
        '/topics/timings'
      ]);
    } else {
      const error = await result.catch((error) => error);
      expect(error).toMatchObject({ status: 403, reason: 'permission' });
      expect(error).not.toHaveProperty('loginRequired');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });

  it.each([429, 500])('retries only a confirmed unprocessed rejection (HTTP %s)', async (status) => {
    const fetcher = vi.fn<Fetcher>(async (url) =>
      url.endsWith('/session/csrf')
        ? json({ csrf: 'test' })
        : json({ errors: ['try later'] }, status, { 'Retry-After': '12' })
    );
    const send = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'test-agent' });
    const failure = await send(batch, 'alice', new AbortController().signal).catch((error) => error);
    expect(failure.safeToRetry).toBe(status === 429 ? true : undefined);
    if (status === 429) expect(failure.retryAfterMs).toBe(12000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves Retry-After when obtaining CSRF is rate limited before any timings POST', async () => {
    const fetcher = vi.fn<Fetcher>(async () => json({ errors: ['try later'] }, 429, { 'Retry-After': '60' }));
    const send = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'test-agent' });
    await expect(send(batch, 'alice', new AbortController().signal)).rejects.toMatchObject({
      status: 429,
      safeToRetry: true,
      retryAfterMs: 60000
    });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/session/csrf']);
  });

  it.each(['/session/csrf', '/topics/timings'])('preserves a plaintext rate limit from %s', async (path) => {
    const fetcher = vi.fn<Fetcher>(async (url) =>
      url.endsWith(path)
        ? new Response('Too many requests', {
            status: 429,
            headers: { 'Content-Type': 'text/plain', 'Retry-After': '60' }
          })
        : json({ csrf: 'test' })
    );
    const send = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'test-agent' });
    await expect(send(batch, 'alice', new AbortController().signal)).rejects.toMatchObject({
      status: 429,
      safeToRetry: true,
      retryAfterMs: 60000
    });
    expect(fetcher).toHaveBeenCalledTimes(path === '/session/csrf' ? 1 : 2);
  });

  it('queries at most 50 unique topic IDs per batch and refuses an endpoint that ignores the filter', async () => {
    const fetcher = vi.fn<Fetcher>(async (url) => {
      const ids = new URL(url).searchParams.getAll('topic_ids[]');
      expect(new URL(url).searchParams.get('per_page')).toBe(String(ids.length));
      return json({
        topic_list: { topics: ids.map((id) => ({ id, last_read_post_number: 2, highest_post_number: 3 })) }
      });
    });
    const ids = Array.from({ length: 51 }, (_, index) => String(index + 1));
    expect(await getLinuxDoReadingBatch([...ids, '1'], { fetcher })).toHaveLength(51);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(json({ topic_list: { topics: [{ id: 999 }] } }));
    await expect(getLinuxDoReadingBatch(['1'], { fetcher })).rejects.toThrow('未按话题 ID');
  });
});

it.each(['background', 'expired'] as const)('holds recovery POST when CSRF completes after %s', async (reason) => {
  vi.useFakeTimers();
  let clock = 0;
  const posts: string[] = [];
  let csrfCalls = 0;
  const csrfReady = Promise.withResolvers<Response>();
  const scope = () => 'alice';
  const sender = createLinuxDoReadingSender({
    scope,
    userAgent: () => 'fixture-agent',
    fetcher: async (url, init) => {
      if (url.endsWith('/session/csrf')) return ++csrfCalls === 2 ? csrfReady.promise : json({ csrf: 'fixture' });
      posts.push(String(init?.body));
      return posts.length === 1
        ? new Response('<title>Just a moment...</title>', { status: 403, headers: { 'content-type': 'text/html' } })
        : new Response('');
    }
  });
  let recovery!: import('@/domain/session/sessionContracts').LinuxDoReadingRecovery;
  const runtime = createDiscourseReadingRuntime({
    queryClient: new QueryClient(),
    scope,
    now: () => clock,
    onVerificationRequired: (value) => {
      recovery = value;
    },
    send: (batch, identity, signal, context) =>
      sender(batch, identity, signal, undefined, context.recovery, context.beforePost)
  });
  try {
    const session = runtime.begin('12');
    session.visible([1]);
    session.active(true);
    clock = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(posts).toHaveLength(1);
    const pending = recovery.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(csrfCalls).toBe(2);
    if (reason === 'background') {
      runtime.setAppActive(false);
      runtime.foreground(false);
    } else {
      clock = 100001;
    }
    csrfReady.resolve(json({ csrf: 'refreshed' }));
    expect(await pending).toBe('stale');
    expect(posts).toHaveLength(1);
    if (reason === 'background') {
      expect(recovery.isCurrent()).toBe(true);
      runtime.setAppActive(true);
      expect(await recovery.resume()).toBe('completed');
      expect(posts).toEqual([posts[0], posts[0]]);
    } else {
      expect(recovery.isCurrent()).toBe(false);
      expect(await recovery.resume()).toBe('stale');
      expect(posts).toHaveLength(1);
    }
  } finally {
    runtime.dispose();
  }
});
