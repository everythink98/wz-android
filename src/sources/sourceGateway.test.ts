import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { createSourceGateway, getFeed, getReplies, getTopic, getUserProfile, searchTopics } from './sourceGateway';
import { setDiagnosticWriter } from '../diagnostics';
import { createNodeSeekWebViewFallbackFetcher } from '../nodeseekFetchFallback';
import { REQUEST_SUPERSEDED_MESSAGE } from '../request';
import { browserFetchIntentFromInit } from '../browserFetchIntent';
import type { Topic } from '../types';

afterEach(() => {
  setDiagnosticWriter(null);
});

describe('source gateway reads', () => {
  it('returns no optional Yaohuo feed without starting its adapter when no credential exists', async () => {
    const fetcher = vi.fn();
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getFeedIfCredentialed({ source: 'yaohuo' })).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['v2ex', (gateway: ReturnType<typeof createSourceGateway>) => gateway.getFeed({ source: 'v2ex' }), '[]'],
    ['yaohuo', (gateway: ReturnType<typeof createSourceGateway>) => gateway.getFeedIfCredentialed({ source: 'yaohuo' }), '<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>']
  ] as const)('owns %s direct recovery inside the managed gateway', async (source, read, body) => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new TypeError('Network request failed');
      }
      return new Response(body, { headers: { 'Content-Type': source === 'v2ex' ? 'application/json' : 'text/html' } });
    });
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher,
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => source === 'yaohuo' ? 'sidyaohuo=secret' : undefined),
      nodeSeekUserAgent: () => '',
      recoverNetworkConnectionPool
    });

    await expect(read(gateway)).resolves.toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(recoverNetworkConnectionPool).toHaveBeenCalledWith(expect.objectContaining({ source }));
  });

  it.each([
    ['feed', (gateway: ReturnType<typeof createSourceGateway>) => gateway.getFeed({ source: 'all', limit: 10 })],
    ['categories', (gateway: ReturnType<typeof createSourceGateway>) => gateway.getCategories({ source: 'all' })],
    ['search', (gateway: ReturnType<typeof createSourceGateway>) => gateway.searchTopics({ source: 'all', query: 'codex', limit: 10 })]
  ] as const)('starts other aggregate %s sources while NodeSeek credentials are still loading', async (_name, read) => {
    let releaseNodeSeekCredential: ((value: string | undefined) => void) | undefined;
    const loadNodeSeekCookieForSource = vi.fn(() => new Promise<string | undefined>((resolve) => {
      releaseNodeSeekCredential = resolve;
    }));
    const fetcher = vi.fn(async (_input: string) => {
      throw new Error('offline');
    });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher,
      loadNodeSeekCookieForSource,
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    const resultPromise = read(gateway);

    await vi.waitFor(() => {
      const urls = fetcher.mock.calls.map(([input]) => String(input));
      expect(urls.some((url) => url.includes('linux.do'))).toBe(true);
      expect(urls.some((url) => url.includes('v2ex.com'))).toBe(true);
      expect(urls.some((url) => url.includes('nodeseek.com'))).toBe(false);
    });

    releaseNodeSeekCredential?.('session=node');
    await expect(resultPromise).resolves.toMatchObject({
      errors: expect.objectContaining({ nodeseek: expect.any(Object) })
    });
  });

  it('keeps aggregate cancellation terminal when deferred NodeSeek credentials are canceled', async () => {
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(async (_input: string) => {
        throw new Error('offline');
      }),
      loadNodeSeekCookieForSource: vi.fn(async () => {
        throw new Error('请求已取消');
      }),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getFeed({ source: 'all', limit: 10 })).rejects.toThrow('请求已取消');
  });

  it('keeps a superseded source read terminal and distinct from cancellation', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(async () => {
        throw new Error(REQUEST_SUPERSEDED_MESSAGE);
      }),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    await expect(gateway.getCategories({ source: 'v2ex' })).rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);

    expect(lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ area: 'source', outcome: 'stale', reason: 'superseded' })
    ]);
  });

  it('keeps the managed NodeSeek fallback alive after more than 30 seconds in the background', async () => {
    vi.useFakeTimers();
    try {
      type AppStateStatus = 'active' | 'background' | 'extension' | 'inactive' | 'unknown';
      const listeners = new Set<(state: AppStateStatus) => void>();
      const appState = {
        currentState: 'active' as AppStateStatus | null,
        addEventListener: vi.fn((_event: 'change', listener: (state: AppStateStatus) => void) => {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        })
      };
      const emit = (state: AppStateStatus) => {
        appState.currentState = state;
        for (const listener of [...listeners]) listener(state);
      };
      const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
        appState,
        defaultFetcher: vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        })),
        webViewFetcher: vi.fn(async () => new Response(`
          <a class="post-title" href="/post-743012-1">NodeSeek resumed fallback detail</a>
          <div class="content-item"><article class="post-content"><p>fallback body</p></article></div>
        `))
      });
      const gateway = createSourceGateway({
        appState,
        clearYaohuoLoginState: vi.fn(async () => undefined),
        fetcher: fallbackFetcher,
        loadNodeSeekCookieForSource: vi.fn(async () => undefined),
        loadYaohuoCookieForSource: vi.fn(async () => undefined),
        nodeSeekUserAgent: () => 'NodeSeek UA'
      });

      const outcome = gateway.getTopic({
        source: 'nodeseek',
        id: '743012',
        timeoutMs: 30_000
      }).then((value) => ({ value }), (error: unknown) => ({ error }));
      emit('background');
      await vi.advanceTimersByTimeAsync(35_000);
      emit('active');
      await vi.advanceTimersByTimeAsync(1);

      await expect(outcome).resolves.toEqual({
        value: expect.objectContaining({ title: 'NodeSeek resumed fallback detail' })
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the managed linux.do transport-recovery budget bounded at 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      const gateway = createSourceGateway({
        clearYaohuoLoginState: vi.fn(async () => undefined),
        fetcher: vi.fn(() => new Promise<Response>(() => undefined)),
        loadNodeSeekCookieForSource: vi.fn(async () => undefined),
        loadYaohuoCookieForSource: vi.fn(async () => undefined),
        nodeSeekUserAgent: () => ''
      });
      let settled = false;
      const outcome = gateway.getFeed({ source: 'linuxdo', limit: 10 })
        .then(() => undefined, (error: unknown) => error)
        .finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(15_000);
      await expect(outcome).resolves.toMatchObject({ message: '请求超时，请稍后重试' });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('uses one 30 second budget across sequential linux.do adapter requests', async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/t/42.json')) {
          return new Promise<Response>((resolve) => {
            setTimeout(() => resolve(new Response(JSON.stringify({
              id: 42,
              title: 'bounded topic',
              category_id: 999,
              created_at: '2026-07-13T00:00:00.000Z',
              last_posted_at: '2026-07-13T00:00:00.000Z',
              posts_count: 1,
              post_stream: {
                posts: [{
                  id: 1,
                  post_number: 1,
                  username: 'reader',
                  cooked: '<p>body</p>',
                  created_at: '2026-07-13T00:00:00.000Z'
                }],
                stream: [1]
              }
            }), { headers: { 'content-type': 'application/json' } })), 20_000);
          });
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        });
      });
      const gateway = createSourceGateway({
        clearYaohuoLoginState: vi.fn(async () => undefined),
        fetcher,
        loadNodeSeekCookieForSource: vi.fn(async () => undefined),
        loadYaohuoCookieForSource: vi.fn(async () => undefined),
        nodeSeekUserAgent: () => ''
      });
      let settled = false;
      const outcome = gateway.getTopic({ source: 'linuxdo', id: '42' })
        .then(() => undefined, (error: unknown) => error)
        .finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(20_000);
      expect(calls.some((url) => url.endsWith('/site.json'))).toBe(true);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toMatchObject({ message: '请求超时，请稍后重试' });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps the 30 second linux.do budget isolated inside aggregate reads', async () => {
    vi.useFakeTimers();
    try {
      const gateway = createSourceGateway({
        clearYaohuoLoginState: vi.fn(async () => undefined),
        fetcher: vi.fn((input: string) => String(input).includes('linux.do')
          ? new Promise<Response>(() => undefined)
          : Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } }))),
        loadNodeSeekCookieForSource: vi.fn(async () => undefined),
        loadYaohuoCookieForSource: vi.fn(async () => undefined),
        nodeSeekUserAgent: () => ''
      });
      let settled = false;
      const outcome = gateway.getFeed({ source: 'all', limit: 10 })
        .finally(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(15_000);
      await expect(outcome).resolves.toMatchObject({
        errors: { linuxdo: expect.any(Object) }
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each([
    [
      'background feed',
      (gateway: ReturnType<typeof createSourceGateway>) => gateway.getFeed({ source: 'linuxdo', limit: 10 }),
      { owner: 'feed', priority: 'background', cancelable: true }
    ],
    [
      'foreground topic',
      (gateway: ReturnType<typeof createSourceGateway>) => gateway.getTopic({ source: 'linuxdo', id: '42' }),
      { owner: 'topic', priority: 'foreground', cancelable: true }
    ]
  ] as const)('marks managed linux.do %s reads with WebView queue intent', async (_name, read, expectedIntent) => {
    const intents: unknown[] = [];
    const gateway = createSourceGateway({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      fetcher: vi.fn(async (input, init) => {
        if (String(input).includes('linux.do')) {
          intents.push(browserFetchIntentFromInit(init));
        }
        throw new Error(REQUEST_SUPERSEDED_MESSAGE);
      }),
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      loadYaohuoCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgent: () => ''
    });

    await expect(read(gateway)).rejects.toThrow(REQUEST_SUPERSEDED_MESSAGE);

    expect(intents).toEqual([expectedIntent]);
  });

  it('reads the yaohuo feed through the shared getFeed interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'
    ));

    const result = await getFeed({
      source: 'yaohuo',
      category: '177',
      page: 2,
      limit: 30,
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&siteid=1000',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('searches yaohuo through the shared searchTopics interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="listdata"><a href="/bbs-321.html">茶馆搜索结果</a>/alice/阅1/05-20 10:00</div>'
    ));

    const result = await searchTopics({
      source: 'yaohuo',
      query: '茶馆',
      page: 2,
      limit: 30,
      filter: { source: 'yaohuo', category: '177' },
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '321', categoryId: '177' });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('classid=177'),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('reads a yaohuo topic through the shared getTopic interface', async () => {
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
    const fetcher = vi.fn(async (input: string) => input.includes('book_re.aspx')
      ? new Response('<div class="line1">[沙发] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>')
      : new Response('<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(1)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'));

    const detail = await getTopic({
      source: 'yaohuo',
      id: topic.id,
      topic,
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(detail).toMatchObject({ source: 'yaohuo', id: '123', contentHtml: '<p>body</p>' });
    expect(detail.replies[0]).toMatchObject({ author: 'bob', floor: 1 });
  });

  it('reads yaohuo replies through the shared getReplies interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="line1">[61楼] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>'
    ));

    const result = await getReplies({
      source: 'yaohuo',
      id: '123',
      categoryId: '177',
      page: 3,
      limit: 30,
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(result.items[0]).toMatchObject({ author: 'bob', floor: 61 });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=3',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('reads a yaohuo user through the shared getUserProfile interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="content">昵称:火友<br/>1万妖晶2级等级7年注册时长<br/>发帖:3<br/>回帖:9</div>'
    ));

    const profile = await getUserProfile({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(profile).toMatchObject({ source: 'yaohuo', id: '7', username: '火友', levelLabel: '2级' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('classifies a missing yaohuo credential before reading a user profile', async () => {
    await expect(getUserProfile({
      source: 'yaohuo',
      id: '7'
    })).rejects.toMatchObject({
      source: 'yaohuo',
      loginRequired: true,
      reason: 'missing_cookie'
    });
  });
});
