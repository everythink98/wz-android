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
import { readingResumeAnchor, selectDiscourseVisited } from '@/domain/forum/discourseReading';
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
  it.each(['abort', 'source-disabled', 'identity-changed'] as const)(
    'rejects late feed progress after %s',
    async (change) => {
      const pending = Promise.withResolvers<Response>();
      const controller = new AbortController();
      let enabled: Source[] = ['linuxdo', 'v2ex'];
      let epoch = 0;
      const fetcher: Fetcher = async (url, init) =>
        url.includes('linux.do')
          ? withAbortableTimeout(() => pending.promise, { signal: init?.signal })
          : new Response(page);
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => enabled,
        linuxDoUserAgent: () => 'saved',
        nodeSeekUserAgent: () => 'saved',
        readSessionRuntimeSnapshot: (source) => ({
          ...anonymousSession(source),
          authenticated: true,
          identityKey: `${source}:user-${epoch}`,
          sessionEpoch: epoch
        })
      });
      const onProgress = vi.fn();
      const result = gateway
        .getFeed({ source: 'all', signal: controller.signal }, { onProgress })
        .catch((error) => error);
      try {
        await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1));
        if (change === 'abort') controller.abort();
        else if (change === 'source-disabled') enabled = ['v2ex'];
        else epoch++;
        pending.resolve(
          Response.json({
            topic_list: {
              topics: [{ id: 72, title: 'Late response', created_at: '2026-05-20T00:00:00Z', posts_count: 1 }]
            }
          })
        );
        expect(await result).toMatchObject({ message: '请求已取消' });
        expect(onProgress).toHaveBeenCalledTimes(1);
      } finally {
        controller.abort();
        pending.resolve(new Response('{}'));
        await result;
      }
    }
  );

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
      const cursor = encodeURIComponent(
        JSON.stringify({
          bind: JSON.stringify([[['v2ex', '["public:omit",null,null]']], '', '']),
          buffers: { v2ex: [buffered] },
          nextPages: { v2ex: 2 }
        })
      );
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
        return Response.json({
          id: 2,
          topic_id: 1,
          post_number: 1,
          user_id: 7,
          username: 'alice',
          raw: '原文',
          can_edit: true
        });
      return Response.json(
        pathname === '/site.json'
          ? { categories: [{ id: 4, name: '技术', permission: 1 }] }
          : { current_user: { id: 7, username: 'alice', trust_level: 2 } }
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
        identityKey: 'linuxdo:alice',
        identityTrust: 'confirmed',
        sessionEpoch: 4,
        sourceEnabled: true
      })
    });
    const failure = await (
      scenario.edit
        ? gateway.getTopicEditContext({
            source: 'linuxdo',
            topicId: '1',
            identityKey: 'linuxdo:alice',
            userAgent: 'test'
          })
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
      expect(response.items.map(({ floor, serverRead }) => [floor, serverRead])).toEqual([
        [2, true],
        [3, false]
      ]);
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        `https://linux.do/t/1${kind === 'target' ? '/3' : ''}.json?include_raw=true`
      ]);
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

  function sharedReadingFixture() {
    let account = { id: 'alice', epoch: 1 };
    const queryClient = new QueryClient();
    const reading = createDiscourseReadingRuntime({
      queryClient,
      scope: () => `${account.id}:${account.epoch}`,
      send: async () => undefined
    });
    const requests: {
      response: PromiseWithResolvers<Response>;
      signal: AbortSignal | null | undefined;
      abort: ReturnType<typeof vi.fn>;
    }[] = [];
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      const response = Promise.withResolvers<Response>();
      const signal = init?.signal;
      const abort = vi.fn();
      signal?.addEventListener('abort', abort, { once: true });
      requests.push({ response, signal, abort });
      return response.promise.finally(() => signal?.removeEventListener('abort', abort));
    });
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      nodeSeekUserAgent: () => 'test',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        identityTrust: 'confirmed',
        identityKey: account.id,
        sessionEpoch: account.epoch,
        authSurfaceOpen: false,
        sourceEnabled: true
      })
    });
    return {
      queryClient,
      reading,
      gateway,
      requests,
      fetcher,
      changeAccount: () => {
        account = { id: 'bob', epoch: account.epoch + 1 };
        reading.sessionChanged();
      }
    };
  }

  it('publishes one complete reading update and returns public topics in the requested order', async () => {
    const { reading, gateway, requests, queryClient } = sharedReadingFixture();
    const publishedSizes: number[] = [];
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated') publishedSizes.push(Object.keys(reading.state()).length);
    });
    const ids = Array.from({ length: 50 }, (_, index) => String(index + 1));
    try {
      const result = gateway.getReadingBatch(ids);
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      const publicIds = ids.slice(0, -2);
      const topics = publicIds.map((id) => ({ id, last_read_post_number: 3 })).reverse();
      requests[0].response.resolve(
        Response.json({
          topic_list: {
            topics: [
              ...topics,
              { id: '49', archetype: 'private_message', last_read_post_number: 4 },
              { id: '2', highest_post_number: 80 }
            ]
          }
        })
      );
      const snapshots = await result;
      expect(snapshots.map(({ topicId }) => topicId)).toEqual(publicIds);
      expect(snapshots[1]?.lastReadPostNumber).toBe(3);
      expect(reading.state()['2'].server).toMatchObject({ lastReadPostNumber: 3, highestPostNumber: 80 });
      expect(reading.state()['49']).toBeUndefined();
      expect(reading.state()['50']).toBeUndefined();
      expect(publishedSizes).toEqual([publicIds.length]);
    } finally {
      unsubscribe();
      reading.dispose();
    }
  });

  it('cancels a later reading waiter without changing another reader or the shared request', async () => {
    const { reading, gateway, requests, fetcher } = sharedReadingFixture();
    const canceled = new AbortController();
    const added = vi.spyOn(canceled.signal, 'addEventListener');
    const removed = vi.spyOn(canceled.signal, 'removeEventListener');
    const first = gateway.getReadingBatch(['2']);
    const second = gateway.getReadingBatch(['2'], canceled.signal).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      canceled.abort();
      expect(await second).toBeInstanceOf(RequestCanceledError);
      expect(requests[0].abort).not.toHaveBeenCalled();
      requests[0].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 5 }] } }));

      await expect(first).resolves.toMatchObject([{ topicId: '2', lastReadPostNumber: 5 }]);
      expect(reading.state()['2'].visited).toBe(true);
      for (const [type, listener] of added.mock.calls) {
        if (type === 'abort') expect(removed).toHaveBeenCalledWith('abort', listener);
      }
    } finally {
      reading.dispose();
    }
  });

  it('keeps a reading batch alive for Library after its original page cancels', async () => {
    const { reading, gateway, requests, fetcher } = sharedReadingFixture();
    const canceled = new AbortController();
    const first = gateway.getReadingBatch(['2'], canceled.signal).catch((error: unknown) => error);
    const library = gateway.getReadingBatch(['2']).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      canceled.abort();
      requests[0].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 5 }] } }));

      expect(await first).toBeInstanceOf(RequestCanceledError);
      expect(await library).toMatchObject([{ topicId: '2', lastReadPostNumber: 5 }]);
      expect(requests[0].abort).not.toHaveBeenCalled();
      expect(reading.state()['2'].visited).toBe(true);
    } finally {
      reading.dispose();
    }
  });

  it('aborts only after the last reading waiter leaves and keeps a replacement job registered', async () => {
    const { reading, gateway, requests, fetcher } = sharedReadingFixture();
    const events: unknown[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = gateway.getReadingBatch(['2'], firstController.signal).catch((error: unknown) => error);
    const second = gateway.getReadingBatch(['2'], secondController.signal).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      firstController.abort();
      expect(await first).toBeInstanceOf(RequestCanceledError);
      expect(requests[0].abort).not.toHaveBeenCalled();
      secondController.abort();
      const replacement = gateway.getReadingBatch(['2']);
      expect(await second).toBeInstanceOf(RequestCanceledError);
      await vi.waitFor(() =>
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ operation: 'reading-state', phase: 'finish', outcome: 'canceled' })
          ])
        )
      );
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      const joined = gateway.getReadingBatch(['2']);
      requests[0].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 9 }] } }));
      requests[1].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 5 }] } }));

      await expect(replacement).resolves.toMatchObject([{ topicId: '2', lastReadPostNumber: 5 }]);
      await expect(joined).resolves.toMatchObject([{ topicId: '2', lastReadPostNumber: 5 }]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(requests[0].abort).toHaveBeenCalledOnce();
      expect(requests[1].abort).not.toHaveBeenCalled();
      expect(reading.state()['2'].server.lastReadPostNumber).toBe(5);
    } finally {
      reading.dispose();
    }
  });

  it('rejects an already canceled reading waiter without joining or starting a batch', async () => {
    const { reading, gateway, requests, fetcher } = sharedReadingFixture();
    const canceled = new AbortController();
    canceled.abort();
    try {
      await expect(gateway.getReadingBatch(['2'], canceled.signal)).rejects.toBeInstanceOf(RequestCanceledError);
      expect(fetcher).not.toHaveBeenCalled();
      const live = gateway.getReadingBatch(['2']);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      await expect(gateway.getReadingBatch(['2'], canceled.signal)).rejects.toBeInstanceOf(RequestCanceledError);
      expect(fetcher).toHaveBeenCalledOnce();
      requests[0].response.resolve(Response.json({ topic_list: { topics: [] } }));
      await expect(live).resolves.toEqual([]);
      expect(requests[0].abort).not.toHaveBeenCalled();
    } finally {
      reading.dispose();
    }
  });

  it('keeps reading jobs in the captured account scope and ignores the old account result', async () => {
    const { reading, gateway, requests, fetcher, changeAccount } = sharedReadingFixture();
    const previous = gateway.getReadingBatch(['2']).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      changeAccount();
      const current = gateway.getReadingBatch(['2']);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      requests[0].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 9 }] } }));
      expect(await previous).toHaveProperty('message', '请求已取消');
      expect(reading.state()['2']).toBeUndefined();
      const joined = gateway.getReadingBatch(['2']);
      requests[1].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 3 }] } }));

      await expect(current).resolves.toMatchObject([{ topicId: '2', lastReadPostNumber: 3 }]);
      await expect(joined).resolves.toMatchObject([{ topicId: '2', lastReadPostNumber: 3 }]);
      expect(reading.state()['2'].server.lastReadPostNumber).toBe(3);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      reading.dispose();
    }
  });

  it('releases a failed reading job so the same IDs can be fetched again', async () => {
    const { reading, gateway, requests, fetcher } = sharedReadingFixture();
    const first = gateway.getReadingBatch(['2']).catch((error: unknown) => error);
    const second = gateway.getReadingBatch(['2']).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
      requests[0].response.reject(new Error('batch failed'));
      expect(await first).toHaveProperty('message', 'batch failed');
      expect(await second).toHaveProperty('message', 'batch failed');
      expect(reading.state()['2']).toBeUndefined();
      const retry = gateway.getReadingBatch(['2']);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      requests[1].response.resolve(Response.json({ topic_list: { topics: [{ id: 2, last_read_post_number: 5 }] } }));
      await expect(retry).resolves.toMatchObject([{ topicId: '2', lastReadPostNumber: 5 }]);
    } finally {
      reading.dispose();
    }
  });

  it('retries a LinuxDo read once after Account confirms the same session', async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(Response.json({ categories: [{ id: 5, name: 'Recovered category' }] }));
    const requestAccountRecheck = vi.fn(async () => true);
    const onSessionExpired = vi.fn();
    const gateway = createReadGateway({
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo'],
      linuxDoUserAgent: () => 'saved',
      nodeSeekUserAgent: () => 'saved',
      requestAccountRecheck,
      onSessionExpired,
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        authSurfaceOpen: false,
        identityTrust: 'confirmed',
        sourceEnabled: true,
        identityKey: `${source}:7`,
        sessionEpoch: 4
      })
    });
    await expect(gateway.getCategories({ source: 'linuxdo' })).resolves.toMatchObject({ items: [{ id: '5' }] });
    expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('requests one account recheck for a parsed search login failure', async () => {
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
    const read = gateway.searchTopics({ source: 'linuxdo', query: 'AI' });
    const expected = {
      kind: 'login-required',
      reason: 'account-recheck-required',
      message: '您需要登录才能执行此操作。'
    };
    await expect(read).rejects.toMatchObject(expected);
    expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
    expect(requestAccountRecheck).toHaveBeenCalledWith('linuxdo', 4, expect.stringMatching(/^trace-/));
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

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

let nextAccountFailureEpoch = 1000;

function accountFailureFixture(fetcher: Fetcher, enabledSources: readonly Source[] = ['linuxdo']) {
  const sessionEpoch = nextAccountFailureEpoch++;
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
      sessionEpoch,
      sourceEnabled: true
    })
  });
  return { gateway, requestAccountRecheck, onSessionExpired };
}

const loginNotice = { errors: ['您需要登录才能执行此操作。'] };

describe('read authentication failures through the production gateway', () => {
  it('preserves aggregate content before reporting account failures even when the first event changes its read plan', async () => {
    const epochs = { linuxdo: 110, nodeseek: 110 };
    const preserve = vi.fn();
    const onSessionExpired = vi.fn((source: SessionSource) => {
      expect(preserve).toHaveBeenCalledOnce();
      if (source === 'linuxdo' || source === 'nodeseek') epochs[source]++;
    });
    const requestAccountRecheck = vi.fn(() => {
      expect(preserve).toHaveBeenCalledOnce();
      epochs.linuxdo++;
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
      requestAccountRecheck,
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
    expect(onSessionExpired).toHaveBeenCalledExactlyOnceWith('nodeseek', 110);
    expect(requestAccountRecheck).toHaveBeenCalledExactlyOnceWith('linuxdo', 110, expect.any(String));
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
      await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/site.json'))).toBe(true));
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
    const { gateway, onSessionExpired, requestAccountRecheck } = accountFailureFixture(fetcher);
    const canceled = new AbortController();
    const first = gateway.getFeed({ source: 'linuxdo', signal: canceled.signal }).catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/site.json'))).toBe(true));
    const second = gateway.getFeed({ source: 'linuxdo' });
    await vi.waitFor(() => {
      expect(fetcher.mock.calls.filter(([url]) => new URL(url).pathname === '/latest.json')).toHaveLength(2);
    });
    canceled.abort();
    complete(new Response('expired', { status: 401 }));
    await expect(first).resolves.toMatchObject({ items: [{ title: 'readable' }] });
    await expect(second).resolves.toMatchObject({ items: [{ title: 'readable' }] });
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(requestAccountRecheck).toHaveBeenCalledOnce();
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
      expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
        '/filter.json',
        '/latest.json',
        '/site.json'
      ]);
      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
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
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
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

  it.each([401, 403])('does not recheck Cloudflare challenge HTTP %s', async (status) => {
    const { gateway, requestAccountRecheck, onSessionExpired } = accountFailureFixture(
      async () => new Response('<title>Just a moment...</title>', { status, headers: { 'Content-Type': 'text/html' } })
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
    'does not request edit-only raw during reading even when that endpoint would return HTTP %s',
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
      expect
        .soft(result)
        .toMatchObject({ id: '900', title: 'normal topic', replies: [{ commentId: 1002, canEdit: true }] });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(requestAccountRecheck).not.toHaveBeenCalled();
    }
  );
});

describe('linux.do explicit unseen reading backfill optimization', () => {
  const createdAt = (minutesAgo: number) =>
    new Date(Date.UTC(2026, 9, 10, 12, 0, 0) - minutesAgo * 60_000).toISOString();

  const makeTopic = (id: number, minutesAgo: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    slug: `topic-${id}`,
    title: `Topic ${id}`,
    created_at: createdAt(minutesAgo),
    posts_count: 5,
    highest_post_number: 5,
    ...extra
  });

  const seedLocalProgress = (reading: ReturnType<typeof createDiscourseReadingRuntime>, topicId: string) => {
    reading.observe(
      [{ topicId, lastReadPostNumber: 3, highestPostNumber: 5, readPostNumbers: [1, 3] }],
      reading.startRequest()
    );
    const session = reading.begin(topicId);
    session.active(true);
    session.visible([3], { floor: 3, rowKey: `row-${topicId}`, offset: 12 });
    session.end();
  };

  const readingSummary = (reading: ReturnType<typeof createDiscourseReadingRuntime>) =>
    Object.fromEntries(
      Object.entries(reading.state()).map(([id, entry]) => [
        id,
        {
          visited: entry.visited,
          highestKnown: entry.highestKnown,
          anchor: entry.anchor,
          resumeAnchor: readingResumeAnchor(entry),
          readPosts: entry.readPosts,
          lastReadPostNumber: entry.server.lastReadPostNumber,
          highestPostNumber: entry.server.highestPostNumber
        }
      ])
    );

  const flushMicrotasks = async () => {
    for (let index = 0; index < 8; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  it('skips reading backfill for explicitly unseen single-site feed topics while keeping identical pages, pins, floors, and cursors', async () => {
    const run = async (markUnseen: boolean) => {
      const reading = createDiscourseReadingRuntime({
        queryClient: new QueryClient(),
        scope: () => 'alice',
        send: async () => undefined
      });
      seedLocalProgress(reading, '101');
      const pin71 = makeTopic(71, 1, {
        pinned_globally: true,
        pinned: false,
        unpinned: true,
        last_read_post_number: 2,
        highest_post_number: 2,
        unseen: false
      });
      const page1Topics = [
        makeTopic(101, 2, { unseen: markUnseen, highest_post_number: 7 }),
        makeTopic(102, 3, { unseen: markUnseen, highest_post_number: 4 }),
        makeTopic(103, 4, { unseen: false, last_read_post_number: 6, highest_post_number: 8, unread_posts: 2 })
      ];
      const page2Topics = [
        makeTopic(104, 5, { unseen: markUnseen, highest_post_number: 2 }),
        makeTopic(105, 6, { unseen: false, last_read_post_number: 1, highest_post_number: 2 })
      ];
      const byId = new Map<string, Record<string, unknown>>(
        [pin71, ...page1Topics, ...page2Topics].map((entry) => [String(entry.id), entry])
      );
      const requests: string[] = [];
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = new URL(input);
        requests.push(`${url.pathname}${url.search}`);
        if (url.pathname === '/filter.json') {
          return Response.json({ topic_list: { topics: [pin71] } });
        }
        const batchIds = url.searchParams.getAll('topic_ids[]');
        if (batchIds.length) {
          return Response.json({
            topic_list: { topics: batchIds.map((id) => byId.get(id)).filter(Boolean) }
          });
        }
        const page = Number(url.searchParams.get('page') || 0);
        return Response.json({
          topic_list: {
            topics: page === 0 ? page1Topics : page2Topics,
            more_topics_url: page === 0 ? '/latest?order=created&page=1' : null
          }
        });
      });
      const gateway = createReadGateway({
        reading,
        fetcher,
        anonymousFetcher: fetcher,
        linuxDoUserAgent: () => 'test-ua',
        nodeSeekUserAgent: () => 'test-ua',
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
      try {
        const page1 = await gateway.getFeed({ source: 'linuxdo', limit: 3 });
        await flushMicrotasks();
        const page1Requests = [...requests];
        const page2 = await gateway.getFeed({
          source: 'linuxdo',
          limit: 3,
          page: page1.nextPage!,
          cursor: page1.nextCursor ?? undefined
        });
        await flushMicrotasks();
        return {
          page1,
          page2,
          page1Requests,
          allRequests: requests,
          backfillCalls: requests.filter((entry) => entry.includes('topic_ids')),
          summary: readingSummary(reading),
          visited: selectDiscourseVisited(reading.state())
        };
      } finally {
        reading.dispose();
      }
    };

    const baseline = await run(false);
    const optimized = await run(true);

    expect(baseline.allRequests).toHaveLength(5);
    expect(baseline.backfillCalls).toHaveLength(2);
    expect(optimized.allRequests).toHaveLength(3);
    expect(optimized.backfillCalls).toHaveLength(0);
    expect(optimized.page1Requests).toEqual([
      '/latest.json?order=created&ascending=false',
      '/filter.json?q=in%3Apinned'
    ]);
    expect(optimized.page1.items).toEqual(baseline.page1.items);
    expect(optimized.page2.items).toEqual(baseline.page2.items);
    expect(optimized.page1.items.map((item) => [item.id, Boolean(item.pinned)])).toEqual([
      ['71', true],
      ['101', false],
      ['102', false],
      ['103', false]
    ]);
    expect(optimized.page1.nextCursor).toBe(baseline.page1.nextCursor);
    expect(optimized.page2.nextCursor).toBe(baseline.page2.nextCursor);
    expect(optimized.page1.hasMore).toBe(baseline.page1.hasMore);
    expect(optimized.page2.hasMore).toBe(baseline.page2.hasMore);
    expect(optimized.summary).toEqual(baseline.summary);
    expect(optimized.visited).toEqual(baseline.visited);
    expect(optimized.summary['101']).toMatchObject({
      visited: true,
      highestKnown: 3,
      lastReadPostNumber: 3,
      highestPostNumber: 7,
      readPosts: { 1: true, 3: true }
    });
    expect(optimized.visited['101']).toEqual({ visited: true, hasNewReplies: true });
  });

  it('skips reading backfill across aggregate pages including buffered topics while preserving cross-page pin exclusion and exact cursors', async () => {
    const run = async (markUnseen: boolean) => {
      const reading = createDiscourseReadingRuntime({
        queryClient: new QueryClient(),
        scope: () => 'alice',
        send: async () => undefined
      });
      seedLocalProgress(reading, '101');
      const pin71 = makeTopic(71, 1, {
        pinned_globally: true,
        pinned: false,
        unpinned: true,
        last_read_post_number: 2,
        highest_post_number: 2,
        unseen: false
      });
      const pin71Unbadged = makeTopic(71, 20, { unseen: markUnseen, highest_post_number: 2 });
      const page1Topics = [
        makeTopic(101, 2, { unseen: markUnseen, highest_post_number: 7 }),
        makeTopic(102, 4, { unseen: markUnseen, highest_post_number: 4 }),
        makeTopic(103, 6, { unseen: markUnseen, highest_post_number: 3 }),
        makeTopic(104, 8, { unseen: false, last_read_post_number: 4, highest_post_number: 6 })
      ];
      const page2Topics = [pin71Unbadged, makeTopic(105, 10, { unseen: markUnseen, highest_post_number: 2 })];
      const byId = new Map<string, Record<string, unknown>>(
        [pin71, ...page1Topics, ...page2Topics].map((entry) => [String(entry.id), entry])
      );
      const requests: string[] = [];
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = new URL(input);
        requests.push(`${url.hostname}${url.pathname}${url.search}`);
        if (url.hostname === 'www.v2ex.com') {
          if (url.pathname === '/recent') {
            return new Response(
              '<div class="cell"><a class="topic-link" href="/t/203#reply0">V2EX 203</a><span title="2026-10-10 19:53:00 +08:00"></span></div>'
            );
          }
          return new Response(
            '<div class="cell item"><a class="topic-link" href="/t/201#reply0">V2EX 201</a><span title="2026-10-10 19:57:00 +08:00"></span></div>' +
              '<div class="cell item"><a class="topic-link" href="/t/202#reply0">V2EX 202</a><span title="2026-10-10 19:55:00 +08:00"></span></div>' +
              '<a href="/recent">更多新主题</a>'
          );
        }
        if (url.pathname === '/filter.json') {
          return Response.json({ topic_list: { topics: [pin71] } });
        }
        const batchIds = url.searchParams.getAll('topic_ids[]');
        if (batchIds.length) {
          return Response.json({
            topic_list: { topics: batchIds.map((id) => byId.get(id)).filter(Boolean) }
          });
        }
        const page = Number(url.searchParams.get('page') || 0);
        return Response.json({
          topic_list: {
            topics: page === 0 ? page1Topics : page2Topics,
            more_topics_url: page === 0 ? '/latest?order=created&page=1' : null
          }
        });
      });
      const gateway = createReadGateway({
        reading,
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => ['linuxdo', 'v2ex'],
        linuxDoUserAgent: () => 'test-ua',
        nodeSeekUserAgent: () => 'test-ua',
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
      try {
        const page1 = await gateway.getFeed({ source: 'all', limit: 2 });
        await flushMicrotasks();
        const page2 = await gateway.getFeed({
          source: 'all',
          limit: 2,
          page: page1.nextPage!,
          cursor: page1.nextCursor ?? undefined
        });
        await flushMicrotasks();
        const page3 = await gateway.getFeed({
          source: 'all',
          limit: 2,
          page: page2.nextPage!,
          cursor: page2.nextCursor ?? undefined
        });
        await flushMicrotasks();
        const page4 = await gateway.getFeed({
          source: 'all',
          limit: 2,
          page: page3.nextPage!,
          cursor: page3.nextCursor ?? undefined
        });
        await flushMicrotasks();
        return {
          pages: [page1, page2, page3, page4],
          allRequests: requests,
          backfillCalls: requests.filter((entry) => entry.includes('topic_ids')),
          summary: readingSummary(reading)
        };
      } finally {
        reading.dispose();
      }
    };

    const baseline = await run(false);
    const optimized = await run(true);

    expect(baseline.allRequests).toHaveLength(9);
    expect(baseline.backfillCalls).toHaveLength(4);
    expect(optimized.allRequests).toHaveLength(8);
    expect(optimized.backfillCalls).toHaveLength(3);
    expect(optimized.backfillCalls).toEqual([
      expect.stringContaining('topic_ids%5B%5D=102'),
      expect.stringContaining('topic_ids%5B%5D=103'),
      expect.stringContaining('topic_ids%5B%5D=104')
    ]);
    for (let index = 0; index < baseline.pages.length; index++) {
      expect(optimized.pages[index]!.items).toEqual(baseline.pages[index]!.items);
      expect(optimized.pages[index]!.nextCursor).toBe(baseline.pages[index]!.nextCursor);
      expect(optimized.pages[index]!.hasMore).toBe(baseline.pages[index]!.hasMore);
      expect(optimized.pages[index]!.nextPage).toBe(baseline.pages[index]!.nextPage);
    }
    expect(optimized.pages.flatMap((page) => page.items).some((item) => item.id === '71')).toBe(false);
    expect(optimized.summary).toEqual(baseline.summary);
    expect(optimized.summary['101']).toMatchObject({
      visited: true,
      highestKnown: 3,
      lastReadPostNumber: 3,
      highestPostNumber: 7
    });
  });

  it('still backfills unknown reading progress when unseen is not explicitly true and isolates aggregate unseen state across account scopes', async () => {
    let identityKey = 'alice';
    let sessionEpoch = 1;
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => `${identityKey}:${sessionEpoch}`,
      send: async () => undefined
    });
    const batchRequests: string[][] = [];
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const url = new URL(input);
      if (url.hostname === 'www.v2ex.com') {
        return new Response(
          '<div class="cell item"><a class="topic-link" href="/t/501#reply0">V2EX 501</a><span title="2026-10-10 19:59:00 +08:00"></span></div>'
        );
      }
      if (url.pathname === '/filter.json') {
        return Response.json({ topic_list: { topics: [] } });
      }
      const batchIds = url.searchParams.getAll('topic_ids[]');
      if (batchIds.length) {
        batchRequests.push(batchIds);
        return Response.json({
          topic_list: {
            topics: batchIds.map((id) => ({ id: Number(id), last_read_post_number: 2, highest_post_number: 5 }))
          }
        });
      }
      return Response.json({
        topic_list: {
          topics: [
            makeTopic(201, 1, { unseen: true, highest_post_number: 5 }),
            makeTopic(205, 2, { unseen: true, highest_post_number: 5 }),
            makeTopic(202, 3, { unseen: false, highest_post_number: 5 }),
            makeTopic(203, 4, { highest_post_number: 6 }),
            makeTopic(204, 5, { unseen: false, last_read_post_number: 4, highest_post_number: 6 })
          ]
        }
      });
    });
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo', 'v2ex'],
      linuxDoUserAgent: () => 'test-ua',
      nodeSeekUserAgent: () => 'test-ua',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        identityTrust: 'confirmed',
        identityKey,
        sessionEpoch,
        authSurfaceOpen: false,
        sourceEnabled: true
      })
    });
    try {
      await gateway.getFeed({ source: 'linuxdo', limit: 5 });
      await flushMicrotasks();
      expect(batchRequests).toEqual([['202', '203']]);

      batchRequests.length = 0;
      const aliceAggregate = await gateway.getFeed({ source: 'all', limit: 2 });
      await flushMicrotasks();
      expect(batchRequests).toEqual([]);

      identityKey = 'bob';
      sessionEpoch = 2;
      reading.sessionChanged();
      const bobAggregate = await gateway.getFeed({
        source: 'all',
        limit: 2,
        page: aliceAggregate.nextPage!,
        cursor: aliceAggregate.nextCursor ?? undefined
      });
      await flushMicrotasks();
      expect(bobAggregate.items.map((item) => item.id)).toEqual(['201', '501']);
      expect(batchRequests).toEqual([]);
      await gateway.getFeed({
        source: 'all',
        limit: 2,
        page: bobAggregate.nextPage!,
        cursor: bobAggregate.nextCursor ?? undefined
      });
      await flushMicrotasks();
      expect(batchRequests.flat()).toContain('205');
      expect(batchRequests.flat()).toContain('202');
    } finally {
      reading.dispose();
    }
  });

  it.each(['linuxdo', 'all'] as const)(
    'keeps reading backfill in %s feed when unseen is true but reading floor is malformed or highest floor is missing',
    async (feedSource) => {
      const reading = createDiscourseReadingRuntime({
        queryClient: new QueryClient(),
        scope: () => 'alice',
        send: async () => undefined
      });
      const batchRequests: string[][] = [];
      const backfillById = new Map<string, Record<string, unknown>>([
        ['301', { id: 301, last_read_post_number: 7, highest_post_number: 12 }],
        ['302', { id: 302, last_read_post_number: null, highest_post_number: 17 }],
        ['303', { id: 303, last_read_post_number: null, highest_post_number: 17 }],
        ['304', { id: 304, last_read_post_number: null, highest_post_number: 9 }]
      ]);
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = new URL(input);
        if (url.pathname === '/filter.json') {
          return Response.json({ topic_list: { topics: [] } });
        }
        const batchIds = url.searchParams.getAll('topic_ids[]');
        if (batchIds.length) {
          batchRequests.push(batchIds);
          return Response.json({
            topic_list: { topics: batchIds.map((id) => backfillById.get(id)).filter(Boolean) }
          });
        }
        return Response.json({
          topic_list: {
            topics: [
              makeTopic(301, 1, { unseen: true, last_read_post_number: '7', highest_post_number: 12 }),
              {
                id: 302,
                slug: 'topic-302',
                title: 'Topic 302',
                created_at: createdAt(2),
                posts_count: 5,
                unseen: true
              },
              makeTopic(303, 3, { unseen: true, highest_post_number: 0 }),
              makeTopic(304, 4, { unseen: true, highest_post_number: 9 })
            ]
          }
        });
      });
      const gateway = createReadGateway({
        reading,
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => ['linuxdo'],
        linuxDoUserAgent: () => 'test-ua',
        nodeSeekUserAgent: () => 'test-ua',
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
      try {
        await gateway.getFeed({ source: feedSource, limit: 10 });
        await flushMicrotasks();
        expect(batchRequests).toEqual([['301', '302', '303']]);
        expect(reading.state()['301']).toMatchObject({
          visited: true,
          highestKnown: 7,
          server: { lastReadPostNumber: 7, highestPostNumber: 12 }
        });
        expect(reading.state()['302']).toMatchObject({
          visited: false,
          server: { lastReadPostNumber: null, highestPostNumber: 17 }
        });
        expect(reading.state()['303']).toMatchObject({
          visited: false,
          server: { lastReadPostNumber: null, highestPostNumber: 17 }
        });
        expect(reading.state()['304']).toMatchObject({
          visited: false,
          server: { highestPostNumber: 9 }
        });
      } finally {
        reading.dispose();
      }
    }
  );

  it('combines current aggregate reading facts and backfills only the unresolved visible buffer row', async () => {
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => 'alice',
      send: async () => undefined
    });
    const batchRequests: string[][] = [];
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const url = new URL(input);
      if (url.hostname === 'www.v2ex.com') {
        return new Response(
          '<div class="cell item"><a class="topic-link" href="/t/701#reply0">V2EX 701</a><span title="2026-10-10 19:59:00 +08:00"></span></div>' +
            '<div class="cell item"><a class="topic-link" href="/t/702#reply0">V2EX 702</a><span title="2026-10-10 19:58:00 +08:00"></span></div>' +
            '<div class="cell item"><a class="topic-link" href="/t/703#reply0">V2EX 703</a><span title="2026-10-10 19:40:00 +08:00"></span></div>'
        );
      }
      if (url.pathname === '/filter.json') {
        return Response.json({ topic_list: { topics: [] } });
      }
      const batchIds = url.searchParams.getAll('topic_ids[]');
      if (batchIds.length) {
        batchRequests.push(batchIds);
        return Response.json({
          topic_list: {
            topics: batchIds.map((id) => ({
              id: Number(id),
              last_read_post_number: id === '30' ? 7 : 4,
              highest_post_number: id === '30' ? 12 : 8
            }))
          }
        });
      }
      const page = Number(url.searchParams.get('page') || 0);
      if (page === 0) {
        return Response.json({
          topic_list: {
            topics: [
              makeTopic(28, 1, { unseen: true, highest_post_number: 6 }),
              makeTopic(29, 2, { unseen: true, highest_post_number: 6 }),
              makeTopic(30, 3, { unseen: true, highest_post_number: 10 }),
              makeTopic(31, 4, { unseen: true, highest_post_number: 8 })
            ],
            more_topics_url: '/latest?order=created&page=1'
          }
        });
      }
      return Response.json({
        topic_list: {
          topics: [
            makeTopic(30, 3, { unseen: false, last_read_post_number: 7, highest_post_number: 12 }),
            makeTopic(31, 4, { unseen: false, highest_post_number: 8 }),
            makeTopic(32, 5, { unseen: true, highest_post_number: 5 })
          ],
          more_topics_url: null
        }
      });
    });
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo', 'v2ex'],
      linuxDoUserAgent: () => 'test-ua',
      nodeSeekUserAgent: () => 'test-ua',
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
    try {
      const page1 = await gateway.getFeed({ source: 'all', limit: 4 });
      await flushMicrotasks();
      expect(batchRequests).toEqual([]);
      expect(page1.items.filter((item) => item.source === 'linuxdo').map((item) => item.id)).toEqual(['28', '29']);

      const page2 = await gateway.getFeed({
        source: 'all',
        limit: 4,
        page: page1.nextPage!,
        cursor: page1.nextCursor ?? undefined
      });
      await flushMicrotasks();

      const topic30 = page2.items.find((item) => item.source === 'linuxdo' && item.id === '30');
      expect(topic30).toBeTruthy();
      expect(topic30?.reading).toMatchObject({ lastReadPostNumber: 7, highestPostNumber: 12 });
      expect(reading.state()['30']).toMatchObject({
        visited: true,
        highestKnown: 7,
        server: { lastReadPostNumber: 7, highestPostNumber: 12 }
      });
      expect(batchRequests).toEqual([['31']]);
      expect(reading.state()['31']).toMatchObject({
        visited: true,
        highestKnown: 4,
        server: { lastReadPostNumber: 4, highestPostNumber: 8 }
      });
      expect(reading.state()['32']).toMatchObject({
        visited: false,
        server: { highestPostNumber: 5 }
      });
    } finally {
      reading.dispose();
    }
  });

  it('observes merged reading progress and restores backfill for duplicate IDs within one upstream response', async () => {
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => 'alice',
      send: async () => undefined
    });
    const batchRequests: string[][] = [];
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json') {
        return Response.json({ topic_list: { topics: [] } });
      }
      const batchIds = url.searchParams.getAll('topic_ids[]');
      if (batchIds.length) {
        batchRequests.push(batchIds);
        return Response.json({
          topic_list: {
            topics: batchIds.map((id) => ({ id: Number(id), last_read_post_number: 3, highest_post_number: 5 }))
          }
        });
      }
      return Response.json({
        topic_list: {
          topics: [
            makeTopic(40, 1, { unseen: true, highest_post_number: 5 }),
            makeTopic(41, 2, { unseen: true, highest_post_number: 5 }),
            makeTopic(42, 3, { highest_post_number: 5 }),
            makeTopic(40, 1, {
              pinned: true,
              pinned_globally: true,
              required_trust_level: 3,
              last_read_post_number: 7,
              highest_post_number: 12
            }),
            makeTopic(41, 2, { unseen: false, highest_post_number: 5 }),
            makeTopic(42, 3, { last_read_post_number: 7, highest_post_number: 11 })
          ]
        }
      });
    });
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo'],
      linuxDoUserAgent: () => 'test-ua',
      nodeSeekUserAgent: () => 'test-ua',
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
    try {
      const page1 = await gateway.getFeed({ source: 'linuxdo', limit: 10 });
      await flushMicrotasks();

      expect(page1.items.map((item) => item.id)).toEqual(['40', '41', '42']);
      expect(page1.items[0]).toMatchObject({
        id: '40',
        pinned: true,
        accessRequirement: { type: 'level', label: '需等级', detail: 'Lv3' },
        reading: { topicId: '40', highestPostNumber: 12, readPostNumbers: [] }
      });
      expect(page1.items[0]?.reading?.lastReadPostNumber).toBeUndefined();
      expect(batchRequests).toEqual([['40', '41']]);
      expect(reading.state()['40']).toMatchObject({
        visited: true,
        highestKnown: 3,
        server: { lastReadPostNumber: 3, highestPostNumber: 5 }
      });
      expect(reading.state()['41']).toMatchObject({
        visited: true,
        highestKnown: 3,
        server: { lastReadPostNumber: 3, highestPostNumber: 5 }
      });
      expect(reading.state()['42']).toMatchObject({
        visited: true,
        highestKnown: 7,
        server: { lastReadPostNumber: 7, highestPostNumber: 11 }
      });
    } finally {
      reading.dispose();
    }
  });

  it.each(['linuxdo', 'all'] as const)(
    'applies 7->2, 7->0, and 7->null reading regressions on already-displayed %s topics via topicUpdates while preserving missing-field, pending-write, and late-callback guards',
    async (feedSource) => {
      let nowMs = 1_000_000;
      const reading = createDiscourseReadingRuntime({
        queryClient: new QueryClient(),
        scope: () => 'alice',
        now: () => nowMs,
        send: async () => new Promise<void>(() => undefined)
      });
      const batchRequests: string[][] = [];
      const feedPages: (string | null)[] = [];
      let allowDelayedPage1Update: ((response: Response) => void) | undefined;
      let page1ReadCount = 0;
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = new URL(input);
        if (url.pathname === '/filter.json') {
          return Response.json({ topic_list: { topics: [] } });
        }
        const batchIds = url.searchParams.getAll('topic_ids[]');
        if (batchIds.length) {
          batchRequests.push(batchIds);
          return Response.json({ topic_list: { topics: [] } });
        }
        feedPages.push(url.searchParams.get('page'));
        const page = Number(url.searchParams.get('page') || 0);
        if (page === 0) {
          page1ReadCount += 1;
          if (page1ReadCount === 2) {
            return new Promise<Response>((resolve) => {
              allowDelayedPage1Update = resolve;
            });
          }
          return Response.json({
            topic_list: {
              topics: [
                makeTopic(501, 1, { last_read_post_number: 7, highest_post_number: 12 }),
                makeTopic(502, 2, { last_read_post_number: 7, highest_post_number: 12 }),
                makeTopic(503, 3, { last_read_post_number: 7, highest_post_number: 12 }),
                makeTopic(504, 4, { last_read_post_number: 7, highest_post_number: 12 }),
                makeTopic(505, 5, { last_read_post_number: 7, highest_post_number: 12 })
              ],
              more_topics_url: '/latest?order=created&page=1'
            }
          });
        }
        return Response.json({
          topic_list: {
            topics: [
              makeTopic(501, 1, { last_read_post_number: 2, highest_post_number: 12 }),
              makeTopic(502, 2, { last_read_post_number: 0, highest_post_number: 12 }),
              makeTopic(503, 3, { last_read_post_number: null, highest_post_number: 12 }),
              makeTopic(504, 4, { highest_post_number: 15 }),
              makeTopic(505, 5, { last_read_post_number: 1, highest_post_number: 12 }),
              makeTopic(506, 6, { unseen: true, highest_post_number: 6 })
            ],
            more_topics_url: null
          }
        });
      });
      const gateway = createReadGateway({
        reading,
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => ['linuxdo'],
        linuxDoUserAgent: () => 'test-ua',
        nodeSeekUserAgent: () => 'test-ua',
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
      try {
        const page1 = await gateway.getFeed({ source: feedSource, limit: 5 });
        await flushMicrotasks();
        expect(batchRequests).toEqual([]);
        expect(readingResumeAnchor(reading.state()['501'])).toEqual({ floor: 8 });
        expect(readingResumeAnchor(reading.state()['502'])).toEqual({ floor: 8 });
        expect(readingResumeAnchor(reading.state()['503'])).toEqual({ floor: 8 });
        expect(readingResumeAnchor(reading.state()['504'])).toEqual({ floor: 8 });

        // Start a local pending-write session on topic 505 so its local progress must survive regression.
        const pendingSession = reading.begin('505');
        pendingSession.visible([9], { floor: 9 });
        pendingSession.active(true);
        nowMs += 2000;
        pendingSession.active(false);

        // Start an older request that will finish AFTER page 2 to verify late-callback protection.
        const stalePage1Promise = gateway.getFeed({ source: feedSource, limit: 5 });
        await vi.waitFor(() => expect(allowDelayedPage1Update).toBeDefined());

        feedPages.length = 0;
        const page2 = await gateway.getFeed({
          source: feedSource,
          limit: 5,
          page: page1.nextPage!,
          cursor: page1.nextCursor ?? undefined
        });
        await flushMicrotasks();

        expect(feedPages).toEqual(['1']);
        expect(page2.items.map((item) => item.id)).toEqual(['506']);
        expect(batchRequests).toEqual([]);
        expect(reading.state()['501']?.server.lastReadPostNumber).toBe(2);
        expect(readingResumeAnchor(reading.state()['501'])).toEqual({ floor: 3 });
        expect(reading.state()['502']?.server.lastReadPostNumber).toBe(0);
        expect(readingResumeAnchor(reading.state()['502'])).toBeUndefined();
        expect(reading.state()['503']?.server.lastReadPostNumber).toBeNull();
        expect(readingResumeAnchor(reading.state()['503'])).toBeUndefined();
        // Missing field preserves prior floor 7 while accepting newer highest floor 15.
        expect(reading.state()['504']?.server).toMatchObject({ lastReadPostNumber: 7, highestPostNumber: 15 });
        expect(readingResumeAnchor(reading.state()['504'])).toEqual({ floor: 8 });
        // Pending local write (floor 9) protects local progress & prior server floor 7 against server regression (7 -> 1).
        expect(reading.state()['505']?.server.lastReadPostNumber).toBe(7);
        expect(reading.state()['505']?.highestKnown).toBe(9);
        expect(readingResumeAnchor(reading.state()['505'])).toEqual({ floor: 9 });

        // Late-finishing older page-1 response (with stale floor 7) must NOT overwrite page 2's 2/0/null.
        allowDelayedPage1Update!(
          Response.json({
            topic_list: {
              topics: [
                makeTopic(501, 1, { last_read_post_number: 7, highest_post_number: 12 }),
                makeTopic(502, 2, { last_read_post_number: 7, highest_post_number: 12 }),
                makeTopic(503, 3, { last_read_post_number: 7, highest_post_number: 12 })
              ]
            }
          })
        );
        await stalePage1Promise;
        await flushMicrotasks();
        expect(reading.state()['501']?.server.lastReadPostNumber).toBe(2);
        expect(reading.state()['502']?.server.lastReadPostNumber).toBe(0);
        expect(reading.state()['503']?.server.lastReadPostNumber).toBeNull();
        pendingSession.end();
      } finally {
        reading.dispose();
      }
    }
  );

  it('selectively backfills only finally selected stale-buffer IDs without a cross-page unseen cache, recovers server floor 7, and keeps guest backfill at 0', async () => {
    const runScenario = async (authenticated: boolean, staleFloor?: number, carryPriorReading = false) => {
      const reading = createDiscourseReadingRuntime({
        queryClient: new QueryClient(),
        scope: () => (authenticated ? 'alice' : null),
        send: async () => undefined
      });
      const requests: string[] = [];
      const batchRequests: string[][] = [];
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const url = new URL(input);
        requests.push(`${url.hostname}${url.pathname}${url.search}`);
        if (url.hostname === 'www.v2ex.com') {
          return new Response(
            '<div class="cell item"><a class="topic-link" href="/t/801#reply0">V2EX 801</a><span title="2026-10-10 19:59:00 +08:00"></span></div>' +
              '<div class="cell item"><a class="topic-link" href="/t/802#reply0">V2EX 802</a><span title="2026-10-10 19:58:00 +08:00"></span></div>'
          );
        }
        if (url.pathname === '/filter.json') {
          return Response.json({ topic_list: { topics: [] } });
        }
        const batchIds = url.searchParams.getAll('topic_ids[]');
        if (batchIds.length) {
          batchRequests.push(batchIds);
          return Response.json({
            topic_list: {
              topics: batchIds.map((id) => ({
                id: Number(id),
                last_read_post_number: staleFloor === undefined ? 7 : 2,
                highest_post_number: 12
              }))
            }
          });
        }
        return Response.json({
          topic_list: {
            topics: [
              makeTopic(601, 1, { unseen: true, highest_post_number: 10 }),
              makeTopic(602, 2, {
                unseen: staleFloor === undefined,
                highest_post_number: 10,
                last_read_post_number: staleFloor
              }),
              makeTopic(603, 3, { unseen: true, highest_post_number: 10 })
            ],
            more_topics_url: null
          }
        });
      });
      const gateway = createReadGateway({
        reading,
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => ['linuxdo', 'v2ex'],
        linuxDoUserAgent: () => 'test-ua',
        nodeSeekUserAgent: () => 'test-ua',
        readSessionRuntimeSnapshot: (source) => ({
          source,
          authenticated,
          identityTrust: authenticated ? 'confirmed' : 'none',
          identityKey: authenticated ? 'alice' : `${source}:anonymous`,
          sessionEpoch: 1,
          authSurfaceOpen: false,
          sourceEnabled: true
        })
      });
      try {
        const page1 = await gateway.getFeed({ source: 'all', limit: 2 });
        await flushMicrotasks();
        const page1Requests = [...requests];
        const page1Batches = [...batchRequests];
        if (staleFloor !== undefined) {
          await gateway.getReadingBatch(['602']);
          expect(reading.state()['602']?.server.lastReadPostNumber).toBe(2);
        }

        let cursor = page1.nextCursor ?? undefined;
        if (carryPriorReading && cursor) {
          const wire = JSON.parse(decodeURIComponent(cursor));
          wire.buffers.linuxdo[0].reading = { topicId: '602', lastReadPostNumber: staleFloor, highestPostNumber: 10 };
          cursor = encodeURIComponent(JSON.stringify(wire));
        }
        const page2 = await gateway.getFeed({
          source: 'all',
          limit: 2,
          page: page1.nextPage!,
          cursor
        });
        await flushMicrotasks();
        return {
          page1,
          page2,
          page1Requests,
          allRequests: requests,
          page1Batches,
          allBatches: batchRequests,
          state: reading.state(),
          visited: selectDiscourseVisited(reading.state())
        };
      } finally {
        reading.dispose();
      }
    };

    const authed = await runScenario(true);
    // Homepage preserves 0 backfill calls (2 linux.do requests + 1 v2ex request = 3 total).
    expect(authed.page1Batches).toEqual([]);
    expect(authed.page1Requests.filter((url) => url.startsWith('linux.do'))).toHaveLength(2);
    expect(authed.page1.items.map((item) => `${item.source}:${item.id}`)).toEqual(['linuxdo:601', 'v2ex:801']);
    // Pure-buffer page 2 selects ONLY linuxdo:602 (leaving 603 buffered) and selectively backfills ONLY ['602'].
    expect(authed.page2.items.map((item) => `${item.source}:${item.id}`)).toEqual(['linuxdo:602', 'v2ex:802']);
    expect(authed.allBatches).toEqual([['602']]);
    expect(authed.allRequests.filter((url) => url.startsWith('linux.do'))).toHaveLength(3);
    expect(authed.state['602']).toMatchObject({
      visited: true,
      highestKnown: 7,
      server: { lastReadPostNumber: 7, highestPostNumber: 12 }
    });
    expect(readingResumeAnchor(authed.state['602'])).toEqual({ floor: 8 });
    expect(authed.visited['602']).toEqual({ visited: true, hasNewReplies: true });
    expect(authed.state['603']).toBeUndefined();

    const confirmed = await runScenario(true, 7);
    expect(confirmed.page2.items.map((item) => item.id)).toEqual(['602', '802']);
    expect(confirmed.state['602']?.server.lastReadPostNumber).toBe(2);
    expect(confirmed.allBatches).toEqual([['602'], ['602']]);
    expect(JSON.parse(decodeURIComponent(confirmed.page1.nextCursor!)).buffers.linuxdo[0].reading).toBeUndefined();

    const prior = await runScenario(true, 7, true);
    expect(prior.state['602']?.server.lastReadPostNumber).toBe(2);
    expect(prior.allBatches).toEqual([['602'], ['602']]);

    const guest = await runScenario(false);
    expect(guest.allBatches).toEqual([]);
  });

  it('restarts a bound aggregate cursor after account switch without displaying or backfilling its old buffer', async () => {
    let identityKey = 'alice';
    let sessionEpoch = 1;
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => `${identityKey}:${sessionEpoch}`,
      send: async () => undefined
    });
    const batchRequests: string[][] = [];
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const url = new URL(input);
      if (url.hostname === 'www.v2ex.com') {
        return new Response(
          '<div class="cell item"><a class="topic-link" href="/t/901#reply0">V2EX 901</a><span title="2026-10-10 19:59:00 +08:00"></span></div>'
        );
      }
      if (url.pathname === '/filter.json') {
        return Response.json({ topic_list: { topics: [] } });
      }
      const batchIds = url.searchParams.getAll('topic_ids[]');
      if (batchIds.length) {
        batchRequests.push(batchIds);
        return Response.json({
          topic_list: {
            topics: batchIds.map((id) => ({ id: Number(id), last_read_post_number: 7, highest_post_number: 12 }))
          }
        });
      }
      if (identityKey === 'bob') {
        expect(url.searchParams.get('page')).toBeNull();
        return Response.json({
          topic_list: { topics: [makeTopic(801, 1, { last_read_post_number: 2, highest_post_number: 10 })] }
        });
      }
      return Response.json({
        topic_list: {
          topics: [
            makeTopic(701, 1, { unseen: true, highest_post_number: 10 }),
            makeTopic(702, 2, { last_read_post_number: 4, highest_post_number: 10 }),
            makeTopic(703, 3, { unseen: true, highest_post_number: 10 }),
            makeTopic(704, 4, { last_read_post_number: 9, highest_post_number: 10 })
          ]
        }
      });
    });
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo', 'v2ex'],
      linuxDoUserAgent: () => 'test-ua',
      nodeSeekUserAgent: () => 'test-ua',
      readSessionRuntimeSnapshot: (source) => ({
        source,
        authenticated: true,
        identityTrust: 'confirmed',
        identityKey,
        sessionEpoch,
        authSurfaceOpen: false,
        sourceEnabled: true
      })
    });
    try {
      const alicePage1 = await gateway.getFeed({ source: 'all', limit: 2 });
      await flushMicrotasks();
      expect(batchRequests).toEqual([]);

      identityKey = 'bob';
      sessionEpoch = 2;
      reading.sessionChanged();
      const bobPage2 = await gateway.getFeed({
        source: 'all',
        limit: 2,
        page: alicePage1.nextPage!,
        cursor: alicePage1.nextCursor ?? undefined
      });
      await flushMicrotasks();

      expect(bobPage2.items.map((item) => item.id)).toEqual(['801', '901']);
      expect(batchRequests).toEqual([]);
      expect(reading.state()['801']?.server.lastReadPostNumber).toBe(2);
      expect(reading.state()['702']).toBeUndefined();
      expect(reading.state()['703']).toBeUndefined();
      expect(reading.state()['704']).toBeUndefined();
    } finally {
      reading.dispose();
    }
  });

  it('sends conflicting same-response duplicate reading evidence (7 vs 2, 7 vs 0, 7 vs null, unseen vs 7) to batch confirmation while keeping valid-over-missing without backfill', async () => {
    const reading = createDiscourseReadingRuntime({
      queryClient: new QueryClient(),
      scope: () => 'alice',
      send: async () => undefined
    });
    const batchRequests: string[][] = [];
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json') {
        return Response.json({ topic_list: { topics: [] } });
      }
      const batchIds = url.searchParams.getAll('topic_ids[]');
      if (batchIds.length) {
        batchRequests.push(batchIds);
        return Response.json({
          topic_list: {
            topics: batchIds.map((id) => ({ id: Number(id), last_read_post_number: 5, highest_post_number: 12 }))
          }
        });
      }
      return Response.json({
        topic_list: {
          topics: [
            makeTopic(801, 1, { highest_post_number: 5 }),
            makeTopic(801, 1, { last_read_post_number: 7, highest_post_number: 12 }),
            makeTopic(802, 2, { last_read_post_number: 7, highest_post_number: 12 }),
            makeTopic(802, 2, { last_read_post_number: 2, highest_post_number: 12 }),
            makeTopic(803, 3, { last_read_post_number: 7, highest_post_number: 12 }),
            makeTopic(803, 3, { last_read_post_number: 0, highest_post_number: 12 }),
            makeTopic(804, 4, { last_read_post_number: 7, highest_post_number: 12 }),
            makeTopic(804, 4, { last_read_post_number: null, highest_post_number: 12 }),
            makeTopic(805, 5, { unseen: true, highest_post_number: 5 }),
            makeTopic(805, 5, { last_read_post_number: 7, highest_post_number: 12 })
          ]
        }
      });
    });
    const gateway = createReadGateway({
      reading,
      fetcher,
      anonymousFetcher: fetcher,
      getEnabledSources: () => ['linuxdo'],
      linuxDoUserAgent: () => 'test-ua',
      nodeSeekUserAgent: () => 'test-ua',
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
    try {
      await gateway.getFeed({ source: 'linuxdo', limit: 10 });
      await flushMicrotasks();

      expect(batchRequests).toEqual([['802', '803', '804', '805']]);
      expect(reading.state()['801']?.server.lastReadPostNumber).toBe(7);
      expect(reading.state()['802']?.server.lastReadPostNumber).toBe(5);
      expect(reading.state()['803']?.server.lastReadPostNumber).toBe(5);
      expect(reading.state()['804']?.server.lastReadPostNumber).toBe(5);
      expect(reading.state()['805']?.server.lastReadPostNumber).toBe(5);
    } finally {
      reading.dispose();
    }
  });
});
