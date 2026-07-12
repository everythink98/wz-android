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
import type { Topic } from '../types';

afterEach(() => {
  setDiagnosticWriter(null);
});

describe('source gateway reads', () => {
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
