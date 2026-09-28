import { describe, expect, it, vi } from 'vitest';

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
import { RequestCanceledError } from '@/platform/network/request';

describe('source gateway reads', () => {
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
