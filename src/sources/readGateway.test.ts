import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));
vi.mock('@/platform/network/networkProxy', () => ({
  recoverReadNetworkRuntime: vi.fn()
}));

import { createReadGateway, getTopic } from './readGateway';
import type { Topic } from '@/domain/forum/models';
import { QueryClient } from '@tanstack/react-query';
import { createDiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { createLinuxDoWebViewFallbackFetcher } from '@/sources/linuxdo/browserFallback';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { prepareRequestToSend, RequestCanceledError, withAbortableTimeout } from '@/platform/network/request';
import type { Fetcher } from '@/platform/network/request';
import type { SessionSource, Source } from '@/domain/forum/sourceCatalog';
import { getDefaultAndroidWebViewUserAgent } from '@/platform/android/androidWebViewUserAgent';
import { recoverReadNetworkRuntime } from '@/platform/network/networkProxy';

afterEach(() => setDiagnosticWriter(null));

describe('bounded source preparation', () => {
  beforeEach(() => {
    vi.mocked(recoverReadNetworkRuntime).mockClear();
    vi.mocked(getDefaultAndroidWebViewUserAgent).mockClear();
  });

  const page =
    '<div class="cell item"><a class="topic-link" href="/t/901#reply0">Fresh topic</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>';
  const anonymousSession = (source: SessionSource) => ({
    source,
    authenticated: false,
    authSurfaceOpen: false,
    identityKey: '',
    identityTrust: 'confirmed' as const,
    sessionEpoch: 0,
    sourceEnabled: true
  });

  it('automatically reads fresh posts after slow network preparation without consuming the source budget', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const ready = new Promise<void>((resolve) => setTimeout(resolve, 7_400));
    const send = vi.fn(async (_input: string, init?: RequestInit) => {
      await withAbortableTimeout(() => new Promise<void>((resolve) => setTimeout(resolve, 4_000)), {
        signal: init?.signal
      });
      return new Response(page);
    });
    // Match the production fetcher: initialization is shared, then the final send guard runs.
    const fetcher: Fetcher = async (input, init) => {
      await ready;
      return send(input, prepareRequestToSend(init));
    };
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      beforeRequest: () => ready,
      getEnabledSources: () => ['v2ex'],
      nodeSeekUserAgent: () => 'saved',
      readSessionRuntimeSnapshot: anonymousSession
    });
    const request = gateway.getFeed({ source: 'all', signal: abort.signal });
    try {
      await vi.advanceTimersByTimeAsync(7_399);
      expect(send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_001);
      expect(await request).toMatchObject({ items: [{ source: 'v2ex', id: '901' }], errors: {} });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      abort.abort();
      await Promise.allSettled([request]);
      vi.useRealTimers();
    }
  });

  it.each(['feed', 'categories'] as const)(
    'ends %s preparation without runtime recovery and ignores late readiness',
    async (operation) => {
      vi.useFakeTimers();
      let complete!: () => void;
      const ready = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const send = vi.fn(async () => new Response(page));
      const fetcher: Fetcher = async (_input, init) => {
        await ready;
        prepareRequestToSend(init);
        return send();
      };
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        beforeRequest: () => ready,
        getEnabledSources: () => ['nodeseek'],
        nodeSeekUserAgent: () => 'saved',
        readSessionRuntimeSnapshot: anonymousSession
      });
      let settled = false;
      const request = (
        operation === 'feed' ? gateway.getFeed({ source: 'all' }) : gateway.getCategories({ source: 'nodeseek' })
      ).then(
        (result) => {
          settled = true;
          return result;
        },
        (error: unknown) => {
          settled = true;
          return error;
        }
      );
      try {
        await vi.advanceTimersByTimeAsync(9_999);
        expect.soft(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await request).toMatchObject(
          operation === 'feed'
            ? { items: [], errors: { nodeseek: { reason: 'preparation_timeout', retryable: true } } }
            : { reason: 'preparation_timeout', retryable: true }
        );
      } finally {
        complete();
        await vi.advanceTimersByTimeAsync(0);
        await request;
        expect(send).not.toHaveBeenCalled();
        expect(recoverReadNetworkRuntime).not.toHaveBeenCalled();
        vi.useRealTimers();
      }
    }
  );

  it.each(
    (['feed', 'categories'] as const).flatMap((operation) =>
      (['network', 'user-agent'] as const).flatMap((stage) =>
        (['cancel', 'epoch', 'disabled', 'surface'] as const).map((change) => ({ operation, stage, change }))
      )
    )
  )('does not fetch $operation after $change during $stage preparation', async ({ operation, stage, change }) => {
    vi.useFakeTimers();
    const ready = Promise.withResolvers<void>();
    const userAgent = Promise.withResolvers<string>();
    vi.mocked(getDefaultAndroidWebViewUserAgent).mockReturnValue(userAgent.promise);
    let epoch = 1;
    let enabled = true;
    let surface = false;
    const beforeRequest = vi.fn(() => (stage === 'network' ? ready.promise : Promise.resolve()));
    const fetcher = vi.fn(async () => new Response('unexpected transport'));
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      beforeRequest,
      getEnabledSources: () => (enabled ? ['nodeseek'] : []),
      nodeSeekUserAgent: () => '',
      readSessionRuntimeSnapshot: (source) => ({
        ...anonymousSession(source),
        authenticated: true,
        authSurfaceOpen: surface,
        identityKey: 'nodeseek:7',
        sessionEpoch: epoch,
        sourceEnabled: enabled
      })
    });
    const controller = new AbortController();
    let settled = false;
    const request = (
      operation === 'feed'
        ? gateway.getFeed({ source: 'all', signal: controller.signal })
        : gateway.getCategories({ source: 'nodeseek', signal: controller.signal })
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(beforeRequest).toHaveBeenCalledTimes(1);
      expect(getDefaultAndroidWebViewUserAgent).toHaveBeenCalledTimes(stage === 'user-agent' ? 1 : 0);
      expect(settled).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
      if (change === 'cancel') {
        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(true);
      } else if (change === 'epoch') epoch++;
      else if (change === 'disabled') enabled = false;
      else surface = true;
      ready.resolve();
      userAgent.resolve('native-provider-user-agent');
      await expect(request).resolves.toMatchObject({ message: '请求已取消' });
      if (stage === 'network') expect(getDefaultAndroidWebViewUserAgent).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      expect(recoverReadNetworkRuntime).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      ready.resolve();
      userAgent.resolve('native-provider-user-agent');
      await request;
      vi.mocked(getDefaultAndroidWebViewUserAgent).mockResolvedValue('native-provider-user-agent');
      vi.useRealTimers();
    }
  });

  it.each(['local-categories', 'blocked-feed', 'buffered-feed'] as const)(
    'does not prepare the network for %s',
    async (operation) => {
      const beforeRequest = vi.fn(async () => {
        throw new Error('unexpected preparation');
      });
      const fetcher = vi.fn(async () => new Response('unexpected transport'));
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        beforeRequest,
        getEnabledSources: () => (operation === 'buffered-feed' ? ['v2ex'] : ['yaohuo']),
        nodeSeekUserAgent: () => 'saved',
        readSessionRuntimeSnapshot: anonymousSession
      });
      const buffered: Topic = {
        source: 'v2ex',
        id: '901',
        title: 'Buffered topic',
        author: 'neo',
        url: 'https://www.v2ex.com/t/901',
        createdAt: '2026-05-20T00:00:00Z'
      };
      const cursor = encodeURIComponent(JSON.stringify({ buffers: { v2ex: [buffered] }, nextPages: { v2ex: 2 } }));
      const result =
        operation === 'local-categories'
          ? await gateway.getCategories({ source: 'yaohuo' })
          : await gateway.getFeed({
              source: 'all',
              ...(operation === 'buffered-feed' ? { page: 2, limit: 1, cursor } : {})
            });
      if (operation === 'local-categories') expect(result.items.length).toBeGreaterThan(0);
      else expect(result.items).toEqual(operation === 'buffered-feed' ? [buffered] : []);
      expect(beforeRequest).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('keeps single-source feeds on their existing path without the preparation hook', async () => {
    const beforeRequest = vi.fn(async () => {
      throw new Error('unexpected preparation');
    });
    const fetcher = vi.fn(async () => new Response(page));
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      beforeRequest,
      getEnabledSources: () => ['v2ex'],
      nodeSeekUserAgent: () => 'saved',
      readSessionRuntimeSnapshot: anonymousSession
    });
    await expect(gateway.getFeed({ source: 'v2ex', limit: 1 })).resolves.toMatchObject({
      items: [{ id: '901' }],
      errors: {}
    });
    expect(beforeRequest).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('limits a remote single-source catalog at the source layer after readiness', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const ready = new Promise<void>((resolve) => setTimeout(resolve, 7_400));
    const send = vi.fn((_input: string, init?: RequestInit) =>
      withAbortableTimeout(() => new Promise<Response>(() => undefined), { signal: init?.signal })
    );
    const fetcher: Fetcher = async (input, init) => {
      await ready;
      return send(input, prepareRequestToSend(init));
    };
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      beforeRequest: () => ready,
      nodeSeekUserAgent: () => 'saved',
      readSessionRuntimeSnapshot: anonymousSession
    });
    let failure: unknown;
    const request = gateway.getCategories({ source: 'v2ex', signal: abort.signal }).catch((error: unknown) => {
      failure = error;
    });
    try {
      await vi.advanceTimersByTimeAsync(12_399);
      expect(failure).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(failure).toMatchObject({ reason: 'aggregate_timeout' });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      abort.abort();
      await request;
      vi.useRealTimers();
    }
  });
});

describe('source gateway reads', () => {
  it('reads interaction settings through the managed topic lane and discards unrelated bootstrap data', async () => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const signal = new AbortController().signal;
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          `<script id="data-preloaded" type="application/json">${JSON.stringify({
            currentUser: { username: 'private-user' },
            siteSettings: {
              discourse_reactions_enabled: true,
              discourse_reactions_enabled_reactions: 'heart|bili_057',
              discourse_boosts_enabled: true,
              discourse_boosts_max_per_post: 50
            }
          })}</script>`
        )
    );
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        authSurfaceOpen: false,
        identityKey: 'linuxdo:7',
        identityTrust: 'confirmed',
        sessionEpoch: 4,
        sourceEnabled: true
      })
    });
    const config = await gateway.getLinuxDoInteractionConfig({ signal });
    expect(config).toMatchObject({ enabledReactions: ['heart', 'bili_057'], boostsEnabled: true });
    expect(config).not.toHaveProperty('currentUser');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://linux.do/latest');
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0][1])).toMatchObject({
      owner: 'topic',
      priority: 'foreground'
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        operation: 'getLinuxDoInteractionConfig',
        phase: 'parse',
        state: 'confirmed',
        isReactionsEnabled: true,
        isBoostsEnabled: true,
        itemCount: 2,
        count: 50
      })
    );
    expect(JSON.stringify(events)).not.toMatch(/private-user|bili_057|linuxdo:7/);
  });
  it.each([
    { path: '/site.json', status: 400, recheck: true },
    { path: '/session/current.json', status: 400, recheck: true },
    { path: '/latest', status: 400, recheck: true },
    { path: '/session/current.json', status: 200, recheck: true },
    { path: '/latest', status: 400, challenge: true, recheck: false },
    { path: '/site.json', status: 403, recheck: false },
    { path: '/latest', status: 503, recheck: false },
    { path: '/site.json', status: 400, edit: true, recheck: true }
  ])('rechecks the account only for suspect composer rules: %j', async (scenario) => {
    const requestAccountRecheck = vi.fn();
    const onSessionExpired = vi.fn();
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      const pathname = new URL(url).pathname;
      if (pathname === scenario.path)
        return scenario.challenge
          ? new Response('<title>Just a moment...</title>', {
              status: scenario.status,
              headers: { 'Content-Type': 'text/html' }
            })
          : Response.json(scenario.status === 200 ? { current_user: null } : { errors: ['分类读取失败'] }, {
              status: scenario.status
            });
      if (pathname === '/latest')
        return new Response(
          `<script id="data-preloaded" type="application/json">${JSON.stringify({ siteSettings: { authorized_extensions: 'png' } })}</script>`
        );
      if (pathname === '/t/1.json')
        return Response.json({
          id: 1,
          title: '原帖',
          details: { can_edit: true },
          post_stream: { posts: [{ id: 2, post_number: 1 }] }
        });
      if (pathname === '/posts/2.json')
        return Response.json({ id: 2, topic_id: 1, post_number: 1, user_id: 7, raw: '原文', can_edit: true });
      return Response.json(
        pathname === '/site.json'
          ? { categories: [{ id: 4, name: '技术', permission: 1 }] }
          : { current_user: { id: 7, trust_level: 2 } }
      );
    });
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      requestAccountRecheck,
      onSessionExpired,
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        authSurfaceOpen: false,
        identityKey: 'linuxdo:7',
        identityTrust: 'confirmed',
        sessionEpoch: 4,
        sourceEnabled: true
      })
    });
    const failure = await (
      scenario.edit
        ? gateway.getTopicEditContext({ source: 'linuxdo', topicId: '1', identityKey: 'linuxdo:7', userAgent: 'test' })
        : gateway.getLinuxDoTopicCreationContext({ source: 'linuxdo' })
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject(
      scenario.status === 200
        ? { loginRequired: true }
        : { status: scenario.status, ...(scenario.challenge ? { kind: 'verification-required' } : {}) }
    );
    if (scenario.status === 400 && !scenario.challenge) expect(failure).toHaveProperty('kind', 'ordinary');
    expect(requestAccountRecheck).toHaveBeenCalledTimes(Number(scenario.recheck));
    if (scenario.recheck)
      expect(requestAccountRecheck).toHaveBeenCalledWith('linuxdo', 4, expect.stringMatching(/^trace-/));
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(scenario.edit ? 5 : 3);
    for (const [, init] of fetcher.mock.calls) expect(init?.method || 'GET').toBe('GET');
  });

  it('discards a composer HTTP 400 received after the request is canceled during body reading', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
        }
      }),
      { status: 400 }
    );
    const readBody = vi.spyOn(response, 'text');
    const requestAccountRecheck = vi.fn();
    const onSessionExpired = vi.fn();
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/site.json')
        ? response
        : url.endsWith('/latest')
          ? new Response('<html></html>')
          : Response.json({ current_user: { id: 7, trust_level: 2 } })
    );
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      requestAccountRecheck,
      onSessionExpired,
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        authSurfaceOpen: false,
        identityKey: 'linuxdo:7',
        identityTrust: 'confirmed',
        sessionEpoch: 4,
        sourceEnabled: true
      })
    });
    const abort = new AbortController();
    const result = gateway
      .getLinuxDoTopicCreationContext({ source: 'linuxdo', signal: abort.signal })
      .catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(readBody).toHaveBeenCalledOnce());
      abort.abort();
    } finally {
      body.enqueue(new TextEncoder().encode(JSON.stringify({ errors: ['分类读取失败'] })));
      body.close();
    }
    const failure = await result;
    expect.soft(requestAccountRecheck).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(RequestCanceledError);
  });

  it('recovers authenticated creation rules through the existing browser fallback without sending writes', async () => {
    const native = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/latest')
        ? new Response('<html><title>Just a moment...</title></html>', {
            status: 403,
            headers: { 'Content-Type': 'text/html' }
          })
        : Response.json(
            url.endsWith('/site.json')
              ? { categories: [{ id: 4, name: '技术', permission: 1 }] }
              : { current_user: { id: 1, trust_level: 2 } }
          )
    );
    const preload = JSON.stringify({ siteSettings: JSON.stringify({ authorized_extensions: 'png|pdf' }) });
    const browser = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(`<script id="data-preloaded" type="application/json">${preload}</script>`)
    );
    let authenticated = true;
    const gateway = createReadGateway({
      anonymousFetcher: native,
      fetcher: createLinuxDoWebViewFallbackFetcher({ defaultFetcher: native, webViewFetcher: browser }),
      linuxDoUserAgent: () => 'current-account-agent',
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated,
        authSurfaceOpen: false,
        identityKey: 'alice',
        identityTrust: authenticated ? 'confirmed' : 'none',
        sessionEpoch: 1,
        sourceEnabled: true
      })
    });
    await expect(gateway.getLinuxDoTopicCreationContext({ source: 'linuxdo' })).resolves.toMatchObject({
      source: 'linuxdo',
      categories: [{ id: '4', canCreate: true }],
      allowedExtensions: ['png', 'pdf']
    });
    expect(native).toHaveBeenCalledTimes(3);
    expect(browser).toHaveBeenCalledTimes(1);
    expect(browser.mock.calls[0]?.[0]).toBe('https://linux.do/latest');
    for (const [, init] of [...native.mock.calls, ...browser.mock.calls]) {
      expect(init?.method || 'GET').toBe('GET');
      expect(init?.credentials).toBe('include');
      expect(new Headers(init?.headers).get('User-Agent')).toBe('current-account-agent');
      expect(browserFetchIntentFromInit(init)).toEqual({ owner: 'topic', priority: 'foreground' });
    }
    native.mockClear();
    browser.mockClear();
    authenticated = false;
    await expect(gateway.getLinuxDoTopicCreationContext({ source: 'linuxdo' })).rejects.toMatchObject({
      loginRequired: true
    });
    expect(native).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });

  it('ends aggregate pagination after readable sources finish while yaohuo is anonymous', async () => {
    const fetcher = vi.fn(async () => Response.json({ topic_list: { topics: [] }, categories: [] }));
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo', 'yaohuo'],
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: false,
        authSurfaceOpen: false,
        identityKey: `${source}:anonymous`,
        identityTrust: 'none',
        sessionEpoch: 1,
        sourceEnabled: true
      })
    });

    const result = await gateway.getFeed({ source: 'all', limit: 30 });

    expect(result).toMatchObject({ items: [], errors: {}, hasMore: false, nextPage: null });
  });

  it.each(['target', 'start'] as const)(
    'merges topic progress and individual read floors from the existing %s reply request',
    async (kind) => {
      const reading = createDiscourseReadingRuntime({
        queryClient: new QueryClient(),
        scope: () => 'alice',
        send: async () => undefined
      });
      let privateMessage = false;
      const posts = [1, 2, 3].map((floor) => ({
        id: floor + 10,
        topic_id: 1,
        post_number: floor,
        username: 'alice',
        cooked: '<p>reply</p>',
        created_at: '2026-09-01T00:00:00Z',
        read: floor === 2
      }));
      const fetcher = vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(
              new URL(input).pathname.endsWith('/posts.json')
                ? { post_stream: { posts: [posts[2]] } }
                : {
                    id: 1,
                    archetype: privateMessage ? 'private_message' : 'regular',
                    last_read_post_number: privateMessage ? 10 : 9,
                    highest_post_number: 10,
                    unread_posts: 1,
                    post_stream: { stream: posts.map((post) => post.id), posts }
                  }
            )
          )
      );
      const gateway = createReadGateway({
        reading,
        fetcher,
        anonymousFetcher: fetcher,
        nodeSeekUserAgent: () => 'test',
        readSessionRuntimeSnapshot: (source) => ({
          source,
          authenticated: true,
          identityTrust: 'confirmed',
          identityKey: 'alice',
          sessionEpoch: 1,
          authSurfaceOpen: false,
          sourceEnabled: true
        })
      });
      const request = {
        source: 'linuxdo' as const,
        id: '1',
        order: 'oldest' as const,
        position: kind === 'target' ? { kind, target: { floor: 3 } } : { kind }
      };
      const response = await gateway.getReplies(request);
      expect(response.reading).toMatchObject({
        lastReadPostNumber: 9,
        highestPostNumber: 10,
        unreadPosts: 1,
        readPostNumbers: [2]
      });
      expect(reading.state()['1']).toMatchObject({
        server: { lastReadPostNumber: 9, highestPostNumber: 10 },
        visited: true,
        readPosts: { 2: true }
      });
      expect(fetcher).toHaveBeenCalledTimes(kind === 'target' ? 1 : 2);
      privateMessage = true;
      const privateResponse = await gateway.getReplies(request);
      expect(privateResponse.reading).toBeUndefined();
      expect(reading.state()['1'].server.lastReadPostNumber).toBe(9);
      reading.dispose();
    }
  );

  it('merges account reading only at the authenticated gateway boundary and ignores anonymous read flags', async () => {
    let authenticated = true;
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => (authenticated ? 'alice' : null),
      send: async () => undefined
    });
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 1,
            last_read_post_number: 9,
            highest_post_number: 10,
            post_stream: { posts: [{ post_number: 9, read: true }] }
          })
        )
    );
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated,
        identityTrust: 'confirmed',
        identityKey: authenticated ? 'alice' : '',
        sessionEpoch: 1,
        authSurfaceOpen: false,
        sourceEnabled: true
      })
    });
    await gateway.getTopicReading('1');
    expect(reading.state()['1'].visited).toBe(true);
    authenticated = false;
    reading.sessionChanged();
    await gateway.getTopicReading('1');
    expect(reading.state()).toEqual({});
    await gateway.getReadingBatch(['1']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    reading.dispose();
  });

  it('deduplicates overlapping reading batches without treating missing IDs as unread', async () => {
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => 'alice',
      send: async () => undefined
    });
    const replies = [Promise.withResolvers<Response>(), Promise.withResolvers<Response>()];
    const fetcher = vi.fn(async () => replies[fetcher.mock.calls.length - 1].promise);
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        identityTrust: 'confirmed',
        identityKey: 'alice',
        sessionEpoch: 1,
        authSurfaceOpen: false,
        sourceEnabled: true
      })
    });
    const first = gateway.getReadingBatch(['1', '2']);
    const second = gateway.getReadingBatch(['2', '3']);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    replies[0].resolve(new Response(JSON.stringify({ topic_list: { topics: [{ id: 2, last_read_post_number: 5 }] } })));
    replies[1].resolve(new Response(JSON.stringify({ topic_list: { topics: [] } })));
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
    expect(reading.state()['1']).toBeUndefined();
    expect(reading.state()['2'].visited).toBe(true);
    reading.dispose();
  });

  it.each(['linuxdo', 'all'] as const)(
    'requests one account recheck for a parsed %s search login failure',
    async (source) => {
      const requestAccountRecheck = vi.fn();
      const onSessionExpired = vi.fn();
      const fetcher = vi.fn(async (input: string) =>
        input.includes('/session/csrf')
          ? new Response(JSON.stringify({ csrf: 'token' }))
          : new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
      );
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => ['linuxdo'],
        nodeSeekUserAgent: () => 'test-agent',
        requestAccountRecheck,
        onSessionExpired,
        readSessionRuntimeSnapshot: (site) => ({
          source: site,
          authenticated: true,
          identityTrust: 'confirmed',
          identityKey: `${site}:7`,
          sessionEpoch: 4,
          authSurfaceOpen: false,
          sourceEnabled: true
        })
      });
      const read = gateway.searchTopics({ source, query: 'AI' });
      const expected = {
        kind: 'login-required',
        reason: 'account-recheck-required',
        message: '您需要登录才能执行此操作。'
      };
      if (source === 'all') await expect(read).resolves.toMatchObject({ errors: { linuxdo: expected } });
      else await expect(read).rejects.toMatchObject(expected);
      expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
      expect(requestAccountRecheck).toHaveBeenCalledWith('linuxdo', 4, expect.stringMatching(/^trace-/));
      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it('reads a partial yaohuo topic seed without duplicating the replies request', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1,
      categoryId: '177'
    };
    const fetcher = vi.fn(async (input: string) =>
      input.includes('book_re.aspx')
        ? new Response(
            '<input name="page" value="1" /><div class="line1">[沙发] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>'
          )
        : new Response(
            '<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(1)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
          )
    );

    const detail = await getTopic({
      source: 'yaohuo',
      id: topic.id,
      topic,
      fetcher
    });

    expect(detail).toMatchObject({ source: 'yaohuo', id: '123', contentHtml: '<p>body</p>' });
    expect(detail).toMatchObject({ replies: [], replyCompleteness: 'partial', replyHasMore: true });
    expect(detail.preparedContent).toMatchObject({
      contentHtml: '<p>body</p>',
      contentPlan: { rows: [expect.objectContaining({ type: 'richText' })] }
    });
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('book_re.aspx'), expect.anything());
  });
});

function accountFailureFixture(fetcher: Fetcher, enabledSources: readonly Source[] = ['linuxdo']) {
  const requestAccountRecheck = vi.fn();
  const onSessionExpired = vi.fn();
  const gateway = createReadGateway({
    fetcher,
    anonymousFetcher: fetcher,
    getEnabledSources: () => enabledSources,
    nodeSeekUserAgent: () => 'audit',
    requestAccountRecheck,
    onSessionExpired,
    readSessionRuntimeSnapshot: (source) => ({
      source,
      authenticated: true,
      authSurfaceOpen: false,
      identityKey: `${source}:7`,
      identityTrust: 'confirmed',
      sessionEpoch: 4,
      sourceEnabled: true
    })
  });
  return { gateway, requestAccountRecheck, onSessionExpired };
}

const loginNotice = { errors: ['您需要登录才能执行此操作。'] };

describe('read authentication failures through the production gateway', () => {
  it('preserves aggregate content before reporting both expired sources even when the first event changes its read plan', async () => {
    const epochs = { linuxdo: 110, nodeseek: 110 };
    const preserve = vi.fn();
    const onSessionExpired = vi.fn((source: SessionSource) => {
      expect(preserve).toHaveBeenCalledOnce();
      if (source === 'linuxdo' || source === 'nodeseek') epochs[source]++;
    });
    const fetcher = vi.fn(async (input: string) =>
      input.includes('nodeseek') || input.endsWith('/site.json')
        ? new Response('expired', { status: 401 })
        : Response.json({
            topic_list: {
              topics: [{ id: 1, title: 'readable', category_id: 5, created_at: '2026-10-12T00:00:00Z', posts_count: 1 }]
            }
          })
    );
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo', 'nodeseek'],
      nodeSeekUserAgent: () => 'test',
      onSessionExpired,
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        authSurfaceOpen: false,
        identityKey: `${source}:7`,
        identityTrust: 'confirmed',
        sessionEpoch: source === 'linuxdo' || source === 'nodeseek' ? epochs[source] : 0,
        sourceEnabled: true
      })
    });
    await expect(gateway.getFeed({ source: 'all' }, { onBeforeSessionChange: preserve })).rejects.toThrow('请求已取消');
    expect(preserve).toHaveBeenCalledOnce();
    expect(preserve.mock.calls[0][0]).toMatchObject({ items: [{ source: 'linuxdo', title: 'readable' }] });
    expect(onSessionExpired).toHaveBeenCalledTimes(2);
    expect(onSessionExpired.mock.calls).toEqual(
      expect.arrayContaining([
        ['linuxdo', 110],
        ['nodeseek', 110]
      ])
    );
  });

  it.each(['cancel', 'epoch', 'disabled', 'surface'] as const)(
    'discards a late optional authentication failure after %s',
    async (change) => {
      let complete!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        complete = resolve;
      });
      const fetcher = vi.fn(async (input: string) =>
        input.endsWith('/site.json')
          ? pending
          : Response.json({
              topic_list: {
                topics: [
                  { id: 1, title: 'readable', category_id: 5, created_at: '2026-10-12T00:00:00Z', posts_count: 1 }
                ]
              }
            })
      );
      let epoch = 120;
      let enabled = true;
      let surface = false;
      const onSessionExpired = vi.fn();
      const requestAccountRecheck = vi.fn();
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => (enabled ? ['linuxdo'] : []),
        nodeSeekUserAgent: () => 'test',
        onSessionExpired,
        requestAccountRecheck,
        readSessionRuntimeSnapshot: (source) => ({
          source,
          authenticated: true,
          authSurfaceOpen: surface,
          identityKey: 'linuxdo:7',
          identityTrust: 'confirmed',
          sessionEpoch: epoch,
          sourceEnabled: enabled
        })
      });
      const abort = new AbortController();
      const result = gateway.getFeed({ source: 'linuxdo', signal: abort.signal }).catch((error: unknown) => error);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      if (change === 'cancel') abort.abort();
      else if (change === 'epoch') epoch++;
      else if (change === 'disabled') enabled = false;
      else surface = true;
      complete(new Response('expired', { status: 401 }));
      if (change === 'cancel') expect(await result).toMatchObject({ items: [{ title: 'readable' }] });
      else expect(await result).toBeInstanceOf(Error);
      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(requestAccountRecheck).not.toHaveBeenCalled();
    }
  );

  it('reports a shared optional category failure for the live reader after the first reader is canceled', async () => {
    let complete!: (response: Response) => void;
    const categoryResponse = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetcher = vi.fn(async (input: string) =>
      input.endsWith('/site.json')
        ? categoryResponse
        : Response.json({
            topic_list: {
              topics: [{ id: 1, title: 'readable', category_id: 5, created_at: '2026-10-12T00:00:00Z', posts_count: 1 }]
            }
          })
    );
    const { gateway, onSessionExpired } = accountFailureFixture(fetcher);
    const canceled = new AbortController();
    const first = gateway.getFeed({ source: 'linuxdo', signal: canceled.signal }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const second = gateway.getFeed({ source: 'linuxdo' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    canceled.abort();
    complete(new Response('expired', { status: 401 }));
    await expect(first).resolves.toMatchObject({ items: [{ title: 'readable' }] });
    await expect(second).resolves.toMatchObject({ items: [{ title: 'readable' }] });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404])(
    'rechecks confirmed linux.do identity when topic HTTP %s explicitly requires login',
    async (status) => {
      const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(async () =>
        Response.json(loginNotice, { status })
      );
      const result = await gateway.getTopic({ source: 'linuxdo', id: '1' }).catch((error: unknown) => error);
      expect.soft(result).toMatchObject({ source: 'linuxdo', title: '受限帖子', accessRequirement: { type: 'login' } });
      expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
      expect(onSessionExpired).not.toHaveBeenCalled();
    }
  );

  it.each([401, 403])(
    'passes authentication failure from optional feed category HTTP %s to Account owner',
    async (status) => {
      const fetcher = vi.fn(async (input: string) =>
        new URL(input).pathname === '/site.json'
          ? Response.json(loginNotice, { status })
          : Response.json({
              topic_list: {
                topics: [
                  {
                    id: 1,
                    title: 'valid feed item',
                    category_id: 5,
                    created_at: '2026-10-12T00:00:00Z',
                    posts_count: 1
                  }
                ]
              }
            })
      );
      const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(fetcher);
      const result = await gateway.getFeed({ source: 'linuxdo', limit: 1 }).catch((error: unknown) => error);
      expect.soft(result).toMatchObject({ items: [{ id: '1', category: '未分类' }], errors: {} });
      expect(fetcher).toHaveBeenCalledTimes(2);
      if (status === 401) expect(onSessionExpired).toHaveBeenCalledTimes(1);
      else expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
    }
  );

  it.each([401, 403])('passes authentication failure from search CSRF HTTP %s to Account owner', async (status) => {
    const fetcher = vi.fn(async (input: string) =>
      new URL(input).pathname === '/session/csrf.json'
        ? Response.json(loginNotice, { status })
        : Response.json({ topics: [], posts: [], grouped_search_result: { more_full_page_results: false } })
    );
    const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(fetcher);
    const result = await gateway.searchTopics({ source: 'linuxdo', query: 'AI' }).catch((error: unknown) => error);
    expect.soft(result).toMatchObject({ items: [], errors: {} });
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (status === 401) expect(onSessionExpired).toHaveBeenCalledTimes(1);
    else expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
  });

  it('does not recheck ordinary missing topic HTTP 404', async () => {
    const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(async () =>
      Response.json({ errors: ['页面不存在或已被删除'] }, { status: 404 })
    );
    await expect(gateway.getTopic({ source: 'linuxdo', id: '1' })).rejects.toMatchObject({
      kind: 'ordinary',
      status: 404
    });
    expect(requestAccountRecheck).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not recheck ordinary permission requirement HTTP 403', async () => {
    const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(async () =>
      Response.json({ errors: ['您没有权限访问此主题。'] }, { status: 403 })
    );
    await expect(gateway.getTopic({ source: 'linuxdo', id: '1' })).resolves.toMatchObject({
      accessRequirement: { type: 'permission' }
    });
    expect(requestAccountRecheck).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('does not recheck Cloudflare challenge HTTP 403', async () => {
    const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(
      async () =>
        new Response('<title>Just a moment...</title>', { status: 403, headers: { 'Content-Type': 'text/html' } })
    );
    await expect(gateway.getTopic({ source: 'linuxdo', id: '1' })).rejects.toMatchObject({
      kind: 'verification-required'
    });
    expect(requestAccountRecheck).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('rechecks explicit search login failure HTTP 403', async () => {
    const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(async (input) =>
      new URL(input).pathname === '/session/csrf.json'
        ? Response.json({ csrf: 'synthetic' })
        : Response.json(loginNotice, { status: 403 })
    );
    await expect(gateway.searchTopics({ source: 'linuxdo', query: 'AI' })).rejects.toMatchObject({
      kind: 'login-required',
      reason: 'account-recheck-required'
    });
    expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('passes raw HTTP 401 from optional Yaohuo favorite lookup to Account owner', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.includes('favlist.aspx')
        ? new Response('expired', { status: 401 })
        : new Response(
            '<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(0)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
          )
    );
    const { gateway, onSessionExpired } = accountFailureFixture(fetcher, ['yaohuo']);
    const result = await gateway.getTopic({
      source: 'yaohuo',
      id: '123',
      topic: {
        source: 'yaohuo',
        id: '123',
        title: '妖火帖子',
        author: 'alice',
        url: 'https://www.yaohuo.me/bbs-123.html',
        createdAt: '2026-05-20T00:00:00Z',
        replyCount: 0
      }
    });
    expect.soft(result).toMatchObject({ source: 'yaohuo', id: '123', contentHtml: '<p>body</p>' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('passes raw HTTP 401 from optional NodeSeek vote lookup to Account owner', async () => {
    const page =
      '<html><head><title>Poll topic</title></head><body><a class="post-title" href="/post-128-1">Poll topic</a><div class="content-item" data-comment-id="1"><a href="/space/1">alice</a><article class="post-content"><p>主题 <a href="nsapp://vote?id=100">nsapp://vote?id=100</a></p></article></div></body></html>';
    const fetcher = vi.fn(
      async (input: string) =>
        new Response(input.includes('/api/vote/info/100') ? 'expired' : page, {
          status: input.includes('/api/vote/info/100') ? 401 : 200,
          headers: { 'Content-Type': 'text/html' }
        })
    );
    const { gateway, onSessionExpired } = accountFailureFixture(fetcher, ['nodeseek']);
    const result = await gateway.getTopic({ source: 'nodeseek', id: '128' });
    expect.soft(result).toMatchObject({ source: 'nodeseek', id: '128', title: 'Poll topic' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    'passes authentication failure from editable reply hydration HTTP %s to Account owner',
    async (status) => {
      const fetcher = vi.fn(async (input: string) =>
        new URL(input).pathname === '/posts/1002.json'
          ? Response.json(loginNotice, { status })
          : Response.json({
              id: 900,
              title: 'normal topic',
              slug: 'topic',
              created_at: '2026-10-12T00:00:00Z',
              posts_count: 2,
              post_stream: {
                stream: [1001, 1002],
                posts: [
                  {
                    id: 1001,
                    post_number: 1,
                    username: 'alice',
                    cooked: '<p>opening</p>',
                    created_at: '2026-10-12T00:00:00Z'
                  },
                  {
                    id: 1002,
                    post_number: 2,
                    username: 'bob',
                    cooked: '<p>reply</p>',
                    created_at: '2026-10-12T00:01:00Z',
                    can_edit: true
                  }
                ]
              }
            })
      );
      const { gateway, onSessionExpired, requestAccountRecheck } = accountFailureFixture(fetcher);
      const result = await gateway.getTopic({ source: 'linuxdo', id: '900' });
      expect.soft(result).toMatchObject({ id: '900', title: 'normal topic', replies: [{ commentId: 1002 }] });
      expect(fetcher).toHaveBeenCalledTimes(2);
      if (status === 401) expect(onSessionExpired).toHaveBeenCalledTimes(1);
      else expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
    }
  );
});
