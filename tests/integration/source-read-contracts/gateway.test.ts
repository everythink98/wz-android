import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFeed } from '@/sources/feedRead';
import { searchTopics } from '@/sources/searchRead';
import { getTopic } from '@/sources/sourceRead';
import { readAccountStatus } from '@/sources/accountRead';
import { isLinuxDoCloudflareError } from '@/sources/errors';
import { browserFetchIntentFromInit, withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import {
  createLinuxDoWebViewFallbackFetcher,
  LinuxDoHiddenBrowserFailureError,
  withLinuxDoConnectSessionRecoveryIntent
} from '@/sources/linuxdo/browserFallback';
import { getLinuxDoCurrentUserProfile } from '@/sources/linuxdo/account';
import { createNodeSeekWebViewFallbackFetcher } from '@/sources/nodeseek/browserFallback';
import { getNodeSeekCurrentUserProfile, getNodeSeekReplies } from '@/sources/nodeseek/reader';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { recoverReadNetworkRuntime } from '@/platform/network/networkProxy';
import { getReadNetworkRuntimeSnapshot } from '@/platform/network/readNetworkRuntime';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({ NativeModules: {} }));

import { createReadGateway, html, json } from './fixtures';

const nodeSeekPayload = Buffer.from(
  JSON.stringify({
    rotateTopics: [
      {
        postId: 101,
        titleText: 'NodeSeek topic',
        titleLink: '/post-101-1',
        op: { name: 'alice', avatar: '/avatar.png' },
        category: { key: 'tech', name: '技术' },
        time: { createdDate: '2026-05-20T00:00:00.000Z' },
        updatedDate: '2026-05-20T01:00:00.000Z',
        comments: 2,
        views: '1.2k',
        content: 'NodeSeek body'
      }
    ],
    allCategory: [
      { key: 'tech', cn_text: '技术' },
      { key: 'admin', cn_text: '管理', adminOnly: true }
    ]
  })
).toString('base64');

function readLinuxDoAccountWith(fetcher: Parameters<typeof readAccountStatus>[1]['fetcher']) {
  return readAccountStatus('linuxdo', {
    fetcher,
    linuxDoUserAgent: 'LinuxDo UA',
    nodeSeekUserAgent: 'NodeSeek UA',
    readManagedCookieHeader: async () => ({ status: 'ok', header: '_t=session' }),
    signal: new AbortController().signal
  });
}

function readNodeSeekAccountWith(fetcher: Parameters<typeof readAccountStatus>[1]['fetcher']) {
  return readAccountStatus('nodeseek', {
    fetcher,
    linuxDoUserAgent: 'LinuxDo UA',
    nodeSeekUserAgent: 'NodeSeek UA',
    readManagedCookieHeader: async () => ({ status: 'ok', header: 'session=present' }),
    signal: new AbortController().signal
  });
}

describe('Android local sources', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('[REG-ACCOUNT-037] uses rendered NodeSeek guest controls for account probes', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743010-1">Public topic</a></div>
        </li>
      </ul>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <header>
        <a class="btn" href="/signIn.html">登录</a>
        <a class="btn" href="/register.html">注册</a>
      </header>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await expect(getNodeSeekCurrentUserProfile({ fetcher })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-037] accepts only the bridged explicit-null NodeSeek account state as anonymous', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743010-1">Public topic</a></div>
        </li>
      </ul>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <meta name="nodeseekAccountState" content="anonymous">
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await expect(getNodeSeekCurrentUserProfile({ fetcher })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-037] keeps explicit direct NodeSeek account evidence on the fast path', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <header>
        <a class="btn" href="/signIn.html">登录</a>
        <a class="btn" href="/register.html">注册</a>
      </header>
    `)
    );
    const webViewFetcher = vi.fn(async () => {
      throw new Error('WebView should not run for explicit direct identity evidence');
    });
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await expect(getNodeSeekCurrentUserProfile({ fetcher })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for NodeSeek when the HTML is already readable', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743010-1">NodeSeek normal detail</a>
      <div class="content-item">
        <article class="post-content"><p>正常正文</p></article>
      </div>
    `)
    );
    const webViewFetcher = vi.fn(async () => html('<html>webview fallback should not be used</html>'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743010', fetcher });

    expect(topic.title).toBe('NodeSeek normal detail');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-TEST-003] keeps WebView fallback disabled when the runtime disallows it', async () => {
    const direct = new Response('<html><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    });
    const webViewFetcher = vi.fn(async () => new Response('private'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      allowWebViewFallback: () => false,
      defaultFetcher: vi.fn(async () => direct),
      webViewFetcher
    });

    await expect(fetcher('https://www.nodeseek.com/api/topics')).resolves.toBe(direct);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable NodeSeek lists that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743013-1">NodeSeek direct list row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743014-1">NodeSeek WebView list row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await getFeed({ source: 'nodeseek', fetcher });

    expect(result.items.map((item) => item.title)).toEqual(['NodeSeek direct list row']);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable NodeSeek details that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <div class="cf-turnstile"></div>
      <a class="post-title" href="/post-743015-1">NodeSeek direct detail</a>
      <div class="content-item">
        <article class="post-content"><p>直接正文讨论“正在进行安全验证”提示</p></article>
      </div>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743015-1">NodeSeek WebView detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743015', fetcher });

    expect(topic.title).toBe('NodeSeek direct detail');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable embedded NodeSeek details that include challenge scripts', async () => {
    const directPayload = Buffer.from(
      JSON.stringify({
        postData: {
          title: 'NodeSeek direct embedded detail',
          op: { name: 'alice' },
          comments: [
            {
              commentId: 1,
              poster: { name: 'alice' },
              markdown: '直接嵌入正文',
              time: { createdDate: '2026-05-21T00:00:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const normalFetcher = vi.fn(async () =>
      html(`
      <script>${directPayload}</script>
      <div class="cf-turnstile"></div>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743016-1">NodeSeek WebView embedded detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743016', fetcher });

    expect(topic.title).toBe('NodeSeek direct embedded detail');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] does not send NodeSeek JSON business responses to the verification WebView', async () => {
    const normalFetcher = vi.fn(async () =>
      json({
        ok: true,
        message: 'ordinary API data mentioning cf-turnstile and challenge-platform'
      })
    );
    const webViewFetcher = vi.fn(async () => json({ ok: false, message: 'unexpected fallback' }));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://www.nodeseek.com/api/account/status');

    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'plain Cloudflare discussion text',
      path: '/help/cloudflare',
      text: 'Ordinary documentation mentioning cf-turnstile and challenge-platform.',
      expected: 'Ordinary documentation'
    },
    {
      label: 'Chinese verification discussion text',
      path: '/help/security-copy',
      text: '普通文档讨论“正在进行安全验证”和“安全服务防护恶意自动程序”的提示文案。',
      expected: '普通文档'
    }
  ])('[REG-VERIFICATION-002] does not treat $label as a NodeSeek challenge page', async ({ expected, path, text }) => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <html><body><article>
        ${text}
      </article></body></html>
    `)
    );
    const webViewFetcher = vi.fn(async () => html('<html>unexpected fallback</html>'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher(`https://www.nodeseek.com${path}`);

    await expect(response.text()).resolves.toContain(expected);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('retries NodeSeek through the WebView fallback only after Cloudflare', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743011-1">NodeSeek fallback detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743011', fetcher });

    expect(topic.title).toBe('NodeSeek fallback detail');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/post-743011-1');
    const events = lines.map((line) => JSON.parse(line)).filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'nodeseek', reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', status: 403, reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', status: 200 }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', channel: 'webview' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/743011|post-|https?:|cf-turnstile/);
  });

  it('[REG-SOURCE-006] starts the caller timeout handoff when NodeSeek enters the WebView fallback', async () => {
    vi.useFakeTimers();
    let resolveFallback: ((response: Response) => void) | undefined;
    try {
      const normalFetcher = vi.fn(
        async () =>
          new Response('<html><div class="cf-turnstile"></div></html>', {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' }
          })
      );
      const webViewFetcher = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFallback = resolve;
          })
      );
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher
      });

      const topicPromise = getTopic({
        source: 'nodeseek',
        id: '743023',
        fetcher,
        timeoutMs: 100
      });
      let outcome: { topic?: Awaited<typeof topicPromise>; error?: unknown } | undefined;
      void topicPromise.then(
        (topic) => {
          outcome = { topic };
        },
        (error) => {
          outcome = { error };
        }
      );

      await vi.advanceTimersByTimeAsync(200);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      expect(outcome).toBeUndefined();

      resolveFallback?.(
        html(`
        <a class="post-title" href="/post-743023-1">NodeSeek queued fallback detail</a>
        <div class="content-item">
          <article class="post-content"><p>fallback timeout starts after dispatch</p></article>
        </div>
      `)
      );
      await expect(topicPromise).resolves.toMatchObject({
        title: 'NodeSeek queued fallback detail'
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps NodeSeek direct and WebView fallback stages on the caller trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('topic', 'open');
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: async () =>
        new Response('<html><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        }),
      webViewFetcher: async () =>
        html(`
        <a class="post-title" href="/post-743019-1">NodeSeek shared trace detail</a>
        <div class="content-item"><article class="post-content"><p>正文</p></article></div>
      `)
    });

    const topic = await getTopic({
      source: 'nodeseek',
      id: '743019',
      fetcher: withDiagnosticFetcher(trace, fallbackFetcher)
    });
    finishDiagnosticTrace(trace, 'success');

    expect(topic.title).toBe('NodeSeek shared trace detail');
    const events = lines.map((line) => JSON.parse(line));
    expect(new Set(events.map((event) => event.traceId))).toEqual(new Set([trace.traceId]));
    expect(events.filter((event) => event.phase === 'intent')).toHaveLength(1);
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'transport', channel: 'direct', state: 'fallback' }),
        expect.objectContaining({ phase: 'transport', channel: 'webview', state: 'finish' })
      ])
    );
  });

  it('keeps NodeSeek edit metadata when replies use the WebView fallback', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 806638,
          comments: [
            {
              commentId: 100,
              floorIndex: 0,
              poster: { name: 'gijia', uid: 18478 },
              markdown: '论坛邮箱！',
              time: { createdDate: '2026-07-04T06:06:00.000Z' }
            },
            {
              commentId: 812345,
              floorIndex: 12,
              poster: { name: '凡想世界', uid: 54874, isMe: true },
              markdown: 'Bd',
              time: { createdDate: '2026-07-04T06:34:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`<script id="temp-script" type="application/json">${payload}</script>`)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const replies = await getNodeSeekReplies('806638', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30
    });

    expect(replies.items[0]).toMatchObject({
      author: '凡想世界',
      authorId: '54874',
      commentId: 812345,
      floor: 12,
      contentMarkdown: 'Bd',
      canEdit: true,
      canLike: false
    });
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('retries NodeSeek topic details through the WebView fallback when normal fetch stalls', async () => {
    vi.useFakeTimers();
    try {
      const normalFetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              },
              { once: true }
            );
          })
      );
      const webViewFetcher = vi.fn(async () =>
        html(`
        <a class="post-title" href="/post-743012-1">NodeSeek slow fallback detail</a>
        <div class="content-item">
          <article class="post-content"><p>慢请求兜底正文</p></article>
        </div>
      `)
      );
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher
      });

      const topicPromise = getTopic({ source: 'nodeseek', id: '743012', fetcher });
      await vi.advanceTimersByTimeAsync(8000);
      const topic = await topicPromise;

      expect(topic.title).toBe('NodeSeek slow fallback detail');
      expect(normalFetcher).toHaveBeenCalledTimes(1);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
      expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/post-743012-1');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('retries NodeSeek feed through the WebView fallback when normal fetch stalls', async () => {
    vi.useFakeTimers();
    try {
      const normalFetcher = vi.fn(() => new Promise<Response>(() => undefined));
      const webViewFetcher = vi.fn(async () =>
        html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-743018-1">NodeSeek slow fallback list row</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `)
      );
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher
      });

      const feedPromise = getFeed({ source: 'nodeseek', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      const feed = await feedPromise;

      expect(feed.items.map((item) => item.title)).toEqual(['NodeSeek slow fallback list row']);
      expect(normalFetcher).toHaveBeenCalledTimes(1);
      const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
      expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/?sortBy=postTime');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-NODESEEK-004] recovers after the configured qualified fallback threshold and resets on direct success', async () => {
    vi.useFakeTimers();
    try {
      let directMode: 'hang' | 'success' = 'hang';
      const feedHtml = `
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-743018-1">qualified fallback row</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `;
      const defaultFetcher = vi.fn(() =>
        directMode === 'success' ? Promise.resolve(html(feedHtml)) : new Promise<Response>(() => undefined)
      );
      const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher,
        webViewFetcher: vi.fn(async () => html(feedHtml)),
        recoveryThreshold: 2,
        recoverReadChannel
      });
      const gateway = createReadGateway({ anonymousFetcher: fetcher, fetcher, nodeSeekUserAgent: () => 'NodeSeek UA' });

      const firstFallback = gateway.getFeed({ source: 'nodeseek' });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(firstFallback).resolves.toMatchObject({ items: [expect.objectContaining({ source: 'nodeseek' })] });
      expect(recoverReadChannel).not.toHaveBeenCalled();

      const secondFallback = gateway.getFeed({ source: 'nodeseek' });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(secondFallback).resolves.toMatchObject({ items: [expect.objectContaining({ source: 'nodeseek' })] });
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);

      directMode = 'success';
      await expect(gateway.getFeed({ source: 'nodeseek' })).resolves.toMatchObject({
        items: [expect.objectContaining({ source: 'nodeseek' })]
      });
      directMode = 'hang';
      const afterReset = gateway.getFeed({ source: 'nodeseek' });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(afterReset).resolves.toMatchObject({ items: [expect.objectContaining({ source: 'nodeseek' })] });
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-NODESEEK-004] preserves a successful WebView result when native recovery fails', async () => {
    const recoverReadChannel = vi.fn(async () => {
      throw new Error('native recovery unavailable');
    });
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () =>
        html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-743018-1">usable fallback</a></div>
              <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `)
      ),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const gateway = createReadGateway({ anonymousFetcher: fetcher, fetcher, nodeSeekUserAgent: () => 'NodeSeek UA' });

    const response = await gateway.getFeed({ source: 'nodeseek' });

    expect(response.items.map((item) => item.title)).toEqual(['usable fallback']);
    expect(recoverReadChannel).toHaveBeenCalledTimes(1);
  });

  it('[REG-SOURCE-009] does not rotate when a NodeSeek WebView response fails the source parser', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => html('<html><body><div class="content">temporary shell</div></body></html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const gateway = createReadGateway({
      anonymousFetcher: fallbackFetcher,
      fetcher: fallbackFetcher,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    await expect(gateway.getTopic({ source: 'nodeseek', id: '743017' })).rejects.toThrow('NodeSeek 主题解析失败');
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] fails closed when a transport fallback has no source-read attempt scope', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`)),
      recoveryThreshold: 1,
      recoverReadChannel
    });

    await expect(fallbackFetcher('https://www.nodeseek.com/?sortBy=postTime')).resolves.toBeInstanceOf(Response);

    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] does not revive an older NodeSeek fallback after a newer direct success', async () => {
    const topicBody = Promise.withResolvers<string>();
    const webViewStarted = Promise.withResolvers<void>();
    const fallbackResponse = html('');
    vi.spyOn(fallbackResponse, 'text').mockImplementation(() => topicBody.promise);
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/post-743024-1')) {
          throw new TypeError('Network request failed');
        }
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-743025-1">newer direct success</a></div>
              <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `);
      }),
      webViewFetcher: vi.fn(async () => {
        webViewStarted.resolve();
        return fallbackResponse;
      }),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const gateway = createReadGateway({
      anonymousFetcher: fallbackFetcher,
      fetcher: fallbackFetcher,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });
    const topicPromise = gateway.getTopic({ source: 'nodeseek', id: '743024' });

    await webViewStarted.promise;
    const recoverCountBeforeParse = recoverReadChannel.mock.calls.length;
    await gateway.getFeed({ source: 'nodeseek' });
    topicBody.resolve(`
      <a class="post-title" href="/post-743024-1">late parse topic</a>
      <div class="content-item"><article class="post-content"><p>body</p></article></div>
    `);

    await expect(topicPromise).resolves.toMatchObject({ title: 'late parse topic' });
    expect(recoverCountBeforeParse).toBe(0);
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] does not confirm a swallowed auxiliary NodeSeek poll parse failure', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 743026,
          title: 'topic with optional poll',
          op: { name: 'alice' },
          comments: [
            {
              commentId: 1,
              poster: { name: 'alice' },
              markdown: '提交投票 nsapp://vote?id=2443',
              time: { createdDate: '2026-08-09T00:00:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/api/vote/info/2443')) {
          throw new TypeError('Network request failed');
        }
        return html(`<script>${payload}</script>`);
      }),
      webViewFetcher: vi.fn(async () => html('<html><body>temporary shell</body></html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const gateway = createReadGateway({
      anonymousFetcher: fallbackFetcher,
      fetcher: fallbackFetcher,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    const topic = await gateway.getTopic({ source: 'nodeseek', id: '743026' });

    expect(topic.title).toBe('topic with optional poll');
    expect(sourceDiagnosticSummary(topic)?.partialErrorCount).toBe(1);
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] keeps a proven primary NodeSeek fallback when its auxiliary poll succeeds direct', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 743027,
          title: 'fallback topic with direct poll',
          op: { name: 'alice' },
          comments: [
            {
              commentId: 1,
              poster: { name: 'alice' },
              markdown: '提交投票 nsapp://vote?id=2443',
              time: { createdDate: '2026-08-09T00:00:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/api/vote/info/2443')) {
          return json({
            vote: {
              id: 2443,
              title: 'direct poll',
              items: [{ vote_item_id: 1, text: 'A', count: 0 }]
            }
          });
        }
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => html(`<script>${payload}</script>`)),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const gateway = createReadGateway({
      anonymousFetcher: fallbackFetcher,
      fetcher: fallbackFetcher,
      nodeSeekUserAgent: () => 'NodeSeek UA'
    });

    const topic = await gateway.getTopic({ source: 'nodeseek', id: '743027' });

    expect(topic.title).toBe('fallback topic with direct poll');
    expect(topic.polls).toEqual([expect.objectContaining({ id: '2443', title: 'direct poll' })]);
    expect(recoverReadChannel).toHaveBeenCalledTimes(1);
  });

  it('[REG-SOURCE-009] rejects an unproven NodeSeek Account fallback before accepting a direct setting page', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async (input: string | URL | Request) => {
        if (new URL(String(input)).pathname === '/') {
          throw new TypeError('Network request failed');
        }
        return html('<div>UID: 42</div><a href="/space/42">alice</a>');
      }),
      webViewFetcher: vi.fn(async () => html('<html><body>temporary shell</body></html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });

    const account = await readNodeSeekAccountWith(fallbackFetcher);

    expect(account.session.currentUser).toMatchObject({ source: 'nodeseek', id: '42', username: 'alice' });
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-NODESEEK-004] excludes writes, Cloudflare and unsuccessful WebView results from recovery counting', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const cloudflare = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(
        async () =>
          new Response('<div class="cf-turnstile"></div>', {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' }
          })
      ),
      webViewFetcher: vi.fn(async () => html('<html>verified</html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const failedFallback = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => new Response('unavailable', { status: 503 })),
      recoveryThreshold: 1,
      recoverReadChannel
    });

    await cloudflare('https://www.nodeseek.com/challenge');
    await failedFallback('https://www.nodeseek.com/read');
    await expect(failedFallback('https://www.nodeseek.com/write', { method: 'POST', body: 'value' })).rejects.toThrow(
      'Network request failed'
    );

    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-006] keeps repeated NodeSeek direct failures isolated from shared proxy state', async () => {
    vi.useFakeTimers();
    try {
      const linuxDoPending = Promise.withResolvers<Response>();
      const sharedDefaultFetcher = vi.fn((input: string | URL | Request) =>
        String(input).startsWith('https://linux.do/') ? linuxDoPending.promise : new Promise<Response>(() => undefined)
      );
      const linuxDoRequest = sharedDefaultFetcher('https://linux.do/latest.json').then((response) => response.text());
      const legacyGlobalRecovery = vi.fn(() => {
        linuxDoPending.reject(new Error('shared OkHttp dispatcher was cancelled'));
      });
      const webViewFetcher = vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/') {
          return html(`
            <ul class="post-list">
              <li class="post-list-item">
                <div class="post-title"><a href="/post-743019-1">NodeSeek first slow fallback</a></div>
                <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
              </li>
            </ul>
          `);
        }
        return html(`
          <a class="post-title" href="/post-743020-1">NodeSeek second slow fallback</a>
          <div class="content-item">
            <article class="post-content"><p>second fallback body</p></article>
          </div>
        `);
      });
      const options = {
        defaultFetcher: sharedDefaultFetcher,
        webViewFetcher,
        recoverNodeSeekNetwork: legacyGlobalRecovery
      } as Parameters<typeof createNodeSeekWebViewFallbackFetcher>[0] & {
        recoverNodeSeekNetwork: () => void;
      };
      const fetcher = createNodeSeekWebViewFallbackFetcher(options);

      const feedPromise = getFeed({ source: 'nodeseek', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(feedPromise).resolves.toMatchObject({
        items: [expect.objectContaining({ title: 'NodeSeek first slow fallback' })]
      });
      const topicPromise = getTopic({ source: 'nodeseek', id: '743020', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(topicPromise).resolves.toMatchObject({
        title: 'NodeSeek second slow fallback'
      });
      expect(webViewFetcher).toHaveBeenCalledTimes(2);
      expect(legacyGlobalRecovery).not.toHaveBeenCalled();

      linuxDoPending.resolve(json({ topic_list: { topics: [] } }));
      await expect(linuxDoRequest).resolves.toBe('{"topic_list":{"topics":[]}}');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('falls back independently for repeated NodeSeek Cloudflare challenge responses', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743021-1">NodeSeek Cloudflare fallback detail</a>
      <div class="content-item">
        <article class="post-content"><p>cloudflare fallback body</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await getTopic({ source: 'nodeseek', id: '743021', fetcher });
    await getTopic({ source: 'nodeseek', id: '743021', fetcher });

    expect(webViewFetcher).toHaveBeenCalledTimes(2);
  });

  it('uses direct fetch for readable NodeSeek search pages', async () => {
    const webViewFetcher = vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get('q') || '';
      const id = query.toLowerCase() === 'ai' ? '809' : '810';
      return html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-${id}-1">${query} WebView search result</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `);
    });
    const normalFetcher = vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get('q') || '';
      const id = query.toLowerCase() === 'ai' ? '809' : '810';
      return html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-${id}-1">${query} direct search result</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `);
    });
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const aiSearch = await searchTopics({ source: 'nodeseek', query: 'ai', fetcher, nodeSeekAuthenticated: true });
    const codexSearch = await searchTopics({
      source: 'nodeseek',
      query: 'codex',
      fetcher,
      nodeSeekAuthenticated: true
    });

    expect(aiSearch.items.map((item) => item.id)).toEqual(['809']);
    expect(codexSearch.items.map((item) => item.id)).toEqual(['810']);
    expect(normalFetcher).toHaveBeenCalledTimes(2);
    expect(webViewFetcher).not.toHaveBeenCalled();
    const normalCalls = normalFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(normalCalls[0]?.[0]).toBe('https://www.nodeseek.com/search?q=ai');
    expect(normalCalls[1]?.[0]).toBe('https://www.nodeseek.com/search?q=codex');
  });

  it('uses direct fetch for empty NodeSeek search pages that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <form action="/search"><input name="q" value="missing"></form>
      <div class="post-list"></div>
      <div class="empty-state">没有找到相关内容</div>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743017-1">NodeSeek WebView search row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'missing', fetcher, nodeSeekAuthenticated: true });

    expect(result.items).toEqual([]);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses the NodeSeek WebView fallback when soft challenge markers have no readable content', async () => {
    const normalFetcher = vi.fn(async () =>
      html('<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>')
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743018-1">soft challenge WebView search result</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'soft', fetcher, nodeSeekAuthenticated: true });

    expect(result.items.map((item) => item.id)).toEqual(['743018']);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the NodeSeek WebView fallback for search only after Cloudflare', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-811-1">cf WebView search result</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'cf', fetcher, nodeSeekAuthenticated: true });

    expect(result.items.map((item) => item.id)).toEqual(['811']);
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/search?q=cf');
  });

  it('retries a linux.do JSON read once through the WebView fallback after Cloudflare', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      json({
        id: 42,
        title: 'linux.do WebView fallback topic',
        created_at: '2026-05-21T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-21T00:00:00.000Z' }
          ]
        }
      })
    );
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.title).toBe('linux.do WebView fallback topic');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(webViewCalls[0]?.[0]).toBe('https://linux.do/t/42.json');
    const events = lines.map((line) => JSON.parse(line)).filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'linuxdo', reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', status: 403, reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', status: 200 }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', channel: 'webview' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/\/t\/42|https?:|cf-turnstile/);
  });

  it('[REG-LINUXDO-009] routes an exact Connect recovery GET through the existing WebView only', async () => {
    const defaultFetcher = vi.fn(async () => new Response('unexpected direct response'));
    const webViewFetcher = vi.fn(async () => new Response('<div class="card">official</div>'));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher,
      webViewFetcher
    });

    const response = await fetcher(
      'https://connect.linux.do/',
      withLinuxDoConnectSessionRecoveryIntent({
        headers: { Accept: 'text/html' }
      })
    );

    expect(await response.text()).toContain('official');
    expect(defaultFetcher).not.toHaveBeenCalled();
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(browserFetchIntentFromInit(webViewCalls[0]?.[1])).toEqual({
      owner: 'account',
      priority: 'foreground'
    });
    expect([...new Headers(webViewCalls[0]?.[1]?.headers).entries()]).toEqual([['accept', 'text/html']]);
  });

  it.each([
    ['Connect query URL', 'https://connect.linux.do/?next=1', 'GET'],
    ['Connect write', 'https://connect.linux.do/', 'POST'],
    ['other linux.do read', 'https://linux.do/latest.json', 'GET'],
    ['external read', 'https://example.com/', 'GET']
  ])('[REG-LINUXDO-009] does not force WebView recovery for %s', async (_case, url, method) => {
    const directResponse = new Response('direct');
    const defaultFetcher = vi.fn(async () => directResponse);
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher,
      webViewFetcher: webViewFetcher as never
    });

    await expect(fetcher(url, withLinuxDoConnectSessionRecoveryIntent({ method }))).resolves.toBe(directResponse);

    expect(defaultFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-009] does not issue a second direct Connect request when WebView recovery is unavailable', async () => {
    const defaultFetcher = vi.fn(async () => new Response('unexpected direct response'));
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      allowWebViewFallback: () => false,
      defaultFetcher,
      webViewFetcher: webViewFetcher as never
    });

    await expect(
      fetcher('https://connect.linux.do/', withLinuxDoConnectSessionRecoveryIntent({}))
    ).rejects.toMatchObject({ reason: 'renderer' });

    expect(defaultFetcher).not.toHaveBeenCalled();
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-008] rotates only after the eight-second timeout is recovered by WebView', async () => {
    vi.useFakeTimers();
    try {
      const defaultFetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      );
      let resolveWebView!: (response: Response) => void;
      const webViewFetcher = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveWebView = resolve;
          })
      );
      const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 4 }));
      const fetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher,
        recoverReadChannel,
        webViewFetcher
      });
      const gateway = createReadGateway({
        anonymousFetcher: fetcher,
        fetcher,
        linuxDoUserAgent: () => 'LinuxDo UA',
        nodeSeekUserAgent: () => 'NodeSeek UA'
      });
      const request = gateway.getFeed({ source: 'linuxdo' });

      await vi.advanceTimersByTimeAsync(8_000);
      expect(defaultFetcher).toHaveBeenCalledTimes(1);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      expect(recoverReadChannel).not.toHaveBeenCalled();

      const fallbackResponse = json({ topic_list: { topics: [] } });
      resolveWebView(fallbackResponse);

      await expect(request).resolves.toMatchObject({ items: [] });
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-LINUXDO-008] returns successful WebView content even when runtime rotation fails', async () => {
    vi.useFakeTimers();
    try {
      const defaultFetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      );
      const fallbackResponse = json({ topic_list: { topics: [] } });
      const webViewFetcher = vi.fn(async () => fallbackResponse);
      const recoverReadChannel = vi.fn(async () => {
        throw new Error('rotation failed');
      });
      const fetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher,
        recoverReadChannel,
        webViewFetcher
      });
      const gateway = createReadGateway({
        anonymousFetcher: fetcher,
        fetcher,
        linuxDoUserAgent: () => 'LinuxDo UA',
        nodeSeekUserAgent: () => 'NodeSeek UA'
      });
      const request = gateway.getFeed({ source: 'linuxdo' });

      await vi.advanceTimersByTimeAsync(8_000);

      await expect(request).resolves.toMatchObject({ items: [] });
      expect(defaultFetcher).toHaveBeenCalledTimes(1);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-SOURCE-009] does not rotate when a timed-out linux.do WebView response fails JSON parsing', async () => {
    vi.useFakeTimers();
    try {
      const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 5 }));
      const fallbackFetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher: vi.fn(
          (_input: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
                once: true
              });
            })
        ),
        webViewFetcher: vi.fn(async () => html('<html><body>temporary shell</body></html>')),
        recoverReadChannel
      });
      const gateway = createReadGateway({
        anonymousFetcher: fallbackFetcher,
        fetcher: fallbackFetcher,
        linuxDoUserAgent: () => 'LinuxDo UA',
        nodeSeekUserAgent: () => 'NodeSeek UA'
      });
      const feedPromise = gateway.getFeed({ source: 'linuxdo' });
      const feedOutcome = feedPromise.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error })
      );

      await vi.advanceTimersByTimeAsync(8_000);

      expect((await feedOutcome).error).toMatchObject({ message: 'linux.do 返回内容格式不正确' });
      expect(recoverReadChannel).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-SOURCE-009] commits a source-readable linux.do anonymous Account result', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 5 }));
    const fallbackFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => json({ current_user: null })),
      recoverReadChannel
    });

    const account = await readLinuxDoAccountWith(fallbackFetcher);

    expect(account.session).toMatchObject({ site: 'linuxdo', status: 'anonymous' });
    expect(recoverReadChannel).toHaveBeenCalledTimes(1);
  });

  it('[REG-SOURCE-009] rejects malformed linux.do Account JSON before recovery commit', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 5 }));
    const fallbackFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => html('<html><body>temporary shell</body></html>')),
      recoverReadChannel
    });

    await expect(readLinuxDoAccountWith(fallbackFetcher)).rejects.toThrow('linux.do 当前用户返回内容格式不正确');
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-009] isolates an invalid NodeSeek aggregate child from another source success', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 6 }));
    const defaultFetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('nodeseek.com')) {
        throw new TypeError('Network request failed');
      }
      if (url.includes('linux.do')) {
        return json({
          topic_list: {
            topics: [
              {
                id: 301,
                title: 'healthy linux.do topic',
                slug: 'healthy-topic',
                created_at: '2026-08-09T00:00:00.000Z',
                bumped_at: '2026-08-09T00:00:00.000Z',
                posts_count: 1
              }
            ]
          },
          users: []
        });
      }
      return html('');
    });
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher,
      webViewFetcher: vi.fn(async () => html('<html><body>not a NodeSeek feed</body></html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });

    const result = await getFeed({ source: 'all', limit: 5, fetcher: fallbackFetcher });

    expect(result.items).toEqual([expect.objectContaining({ source: 'linuxdo', title: 'healthy linux.do topic' })]);
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-008] excludes cancellation, writes, HTTP failures and Cloudflare from channel recovery', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 6 }));
    const controller = new AbortController();
    const canceledFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      ),
      recoverReadChannel,
      webViewFetcher: vi.fn() as never
    });
    const responseFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async (input: string) =>
        input.endsWith('/challenge')
          ? new Response('<div class="cf-turnstile"></div>', {
              status: 403,
              headers: { 'cf-mitigated': 'challenge' }
            })
          : new Response('ordinary failure', { status: 429 })
      ),
      recoverReadChannel,
      webViewFetcher: vi.fn(async () => html('<html>verified</html>'))
    });
    const canceled = canceledFetcher('https://linux.do/latest.json', { signal: controller.signal });
    controller.abort();

    await expect(canceled).rejects.toBeTruthy();
    await responseFetcher('https://linux.do/challenge');
    await responseFetcher('https://linux.do/rate-limited');
    await responseFetcher('https://linux.do/posts', { method: 'POST', body: 'value' });

    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-007] settles the canonical Account probe through one hidden read after a direct network error', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const normalFetcher = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const webViewFetcher = vi.fn(async () =>
      json({
        current_user: {
          id: 42,
          username: 'alice',
          name: 'Alice'
        }
      })
    );
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 7 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      recoverReadChannel,
      webViewFetcher
    });

    const account = await readLinuxDoAccountWith(fetcher);

    expect(account.session.currentUser).toMatchObject({ source: 'linuxdo', username: 'alice' });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    expect(recoverReadChannel).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(browserFetchIntentFromInit(webViewCalls[0]?.[1])).toEqual({
      owner: 'account',
      priority: 'background'
    });
    const events = lines.map((line) => JSON.parse(line)).filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', channel: 'direct', owner: 'account', reason: 'network_error' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', owner: 'account', reason: 'network_error' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', owner: 'account', state: 'start' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', owner: 'account', status: 200 }),
      expect.objectContaining({ phase: 'finish', channel: 'webview', owner: 'account', outcome: 'success' })
    ]);
    expect(
      JSON.stringify(events, (key, value) =>
        ['time', 'appSessionId', 'traceId', 'durationMs'].includes(key) ? undefined : value
      )
    ).not.toMatch(/session\/current|https?:|cookie|alice|42/iu);
  });

  it('[REG-LINUXDO-007] preserves the recovered Account result when runtime rotation fails', async () => {
    const fallbackResponse = json({
      current_user: {
        id: 42,
        username: 'alice'
      }
    });
    const recoverReadChannel = vi.fn(async () => {
      throw new Error('rotation failed');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      recoverReadChannel,
      webViewFetcher: vi.fn(async () => fallbackResponse)
    });

    await expect(readLinuxDoAccountWith(fetcher)).resolves.toMatchObject({
      session: { currentUser: { source: 'linuxdo', username: 'alice' } }
    });
    expect(recoverReadChannel).toHaveBeenCalledTimes(1);
  });

  it('[REG-LINUXDO-007] preserves trusted CF evidence returned by the hidden Account probe', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 8 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      recoverReadChannel,
      webViewFetcher: vi.fn(
        async () =>
          new Response('<div class="cf-turnstile"></div>', {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' }
          })
      )
    });

    const error = await getLinuxDoCurrentUserProfile({ fetcher }).catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-007] keeps an ordinary hidden Account failure ordinary', async () => {
    const hiddenError = new Error('hidden renderer unavailable');
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 9 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      recoverReadChannel,
      webViewFetcher: vi.fn(async () => {
        throw hiddenError;
      })
    });

    await expect(getLinuxDoCurrentUserProfile({ fetcher })).rejects.toBe(hiddenError);
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-010] keeps concurrent cross-source fallback evidence on its request-start generation', async () => {
    const requestStartGeneration = getReadNetworkRuntimeSnapshot().generation;
    let nativeGeneration = requestStartGeneration;
    const nativeRotations: boolean[] = [];
    const recoverForumReadChannel = vi.fn(async (_source: string, expectedGeneration: number) => {
      const rotated = expectedGeneration === nativeGeneration;
      nativeRotations.push(rotated);
      if (rotated) {
        nativeGeneration += 1;
      }
      return {
        ok: true,
        rotated,
        previousGeneration: expectedGeneration,
        generation: nativeGeneration,
        canceledQueued: 0,
        canceledRunning: 0
      };
    });
    const module = {
      acknowledgeReadNetworkRuntimeApply: vi.fn(async () => true),
      recoverForumReadChannel
    };
    const nodeSeekFallback = Promise.withResolvers<Response>();
    const linuxDoFallback = Promise.withResolvers<Response>();
    const readNetworkRuntimeGeneration = () => getReadNetworkRuntimeSnapshot().generation;
    const nodeSeekWebViewFetcher = vi.fn(() => nodeSeekFallback.promise);
    const linuxDoWebViewFetcher = vi.fn(() => linuxDoFallback.promise);
    const nodeSeekFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      readNetworkRuntimeGeneration,
      recoverReadChannel: (expectedGeneration, trace) =>
        recoverReadNetworkRuntime('nodeseek', expectedGeneration, { module, trace }),
      webViewFetcher: nodeSeekWebViewFetcher
    });
    const linuxDoFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      readNetworkRuntimeGeneration,
      recoverReadChannel: (expectedGeneration, trace) =>
        recoverReadNetworkRuntime('linuxdo', expectedGeneration, { module, trace }),
      webViewFetcher: linuxDoWebViewFetcher
    });

    const nodeSeekRead = createReadGateway({
      anonymousFetcher: nodeSeekFetcher,
      fetcher: nodeSeekFetcher,
      linuxDoUserAgent: () => 'LinuxDo UA',
      nodeSeekUserAgent: () => 'NodeSeek UA'
    }).getFeed({ source: 'nodeseek' });
    const linuxDoRead = readLinuxDoAccountWith(linuxDoFetcher);
    await vi.waitFor(() => {
      expect(nodeSeekWebViewFetcher).toHaveBeenCalledTimes(1);
      expect(linuxDoWebViewFetcher).toHaveBeenCalledTimes(1);
    });
    nodeSeekFallback.resolve(
      html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-743018-1">captured generation</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `)
    );

    await expect(nodeSeekRead).resolves.toMatchObject({
      items: [expect.objectContaining({ title: 'captured generation' })]
    });
    expect(getReadNetworkRuntimeSnapshot().generation).toBe(requestStartGeneration + 1);

    linuxDoFallback.resolve(json({ current_user: null }));
    await expect(linuxDoRead).resolves.toMatchObject({ session: { status: 'anonymous' } });

    expect(recoverForumReadChannel).toHaveBeenCalledTimes(2);
    expect(recoverForumReadChannel.mock.calls.map(([, expectedGeneration]) => expectedGeneration)).toEqual([
      requestStartGeneration,
      requestStartGeneration
    ]);
    expect(nativeRotations).toEqual([true, false]);
    expect(module.acknowledgeReadNetworkRuntimeApply).toHaveBeenCalledTimes(1);
    expect(nativeGeneration).toBe(requestStartGeneration + 1);
    expect(getReadNetworkRuntimeSnapshot().generation).toBe(requestStartGeneration + 1);
  });

  it.each([
    [
      'timeout',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'background' } as const,
      new Error('请求超时'),
      'GET'
    ],
    [
      'cancel',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'background' } as const,
      new Error('请求已取消'),
      'GET'
    ],
    [
      'foreground Account',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'foreground' } as const,
      new TypeError('Network request failed'),
      'GET'
    ],
    [
      'topic owner',
      'https://linux.do/session/current.json',
      { owner: 'topic', priority: 'foreground' } as const,
      new TypeError('Network request failed'),
      'GET'
    ],
    [
      'other URL',
      'https://linux.do/latest.json',
      { owner: 'account', priority: 'background' } as const,
      new TypeError('Network request failed'),
      'GET'
    ],
    [
      'write',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'background' } as const,
      new TypeError('Network request failed'),
      'POST'
    ]
  ])('[REG-LINUXDO-007] does not use Account fallback for %s', async (_case, url, intent, directError, method) => {
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw directError;
      }),
      webViewFetcher: webViewFetcher as never
    });

    await expect(fetcher(url, withBrowserFetchIntent({ method }, intent))).rejects.toBe(directError);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-TEST-003] keeps linux.do WebView fallback disabled when the runtime disallows it', async () => {
    const direct = new Response('challenge', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    });
    const webViewFetcher = vi.fn(async () => new Response('private'));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      allowWebViewFallback: () => false,
      defaultFetcher: vi.fn(async () => direct),
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/latest.json')).resolves.toBe(direct);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('REG-LINUXDO-001 preserves an ordinary linux.do 429 without opening the WebView fallback', async () => {
    const normalFetcher = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher: webViewFetcher as never
    });

    const response = await fetcher('https://linux.do/latest.json');

    expect(response.status).toBe(429);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('REG-LINUXDO-001 keeps a confirmed direct challenge typed when the hidden renderer cannot inspect it', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () => {
      throw new Error('linux.do 页面读取进程已停止');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const error = await fetcher('https://linux.do/latest.json').catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
  });

  it('REG-LINUXDO-001 keeps a confirmed direct challenge typed after an explicit renderer failure', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () => {
      throw new LinuxDoHiddenBrowserFailureError('renderer', 'renderer stopped');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const error = await fetcher('https://linux.do/latest.json').catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
  });

  it('REG-LINUXDO-001 preserves an explicit hidden-browser size failure', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () => {
      throw new LinuxDoHiddenBrowserFailureError('content-too-large', 'response exceeds bridge limit');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const error = await fetcher('https://linux.do/latest.json').catch((caught) => caught);

    expect(error).toBeInstanceOf(LinuxDoHiddenBrowserFailureError);
    expect(error).toMatchObject({ reason: 'content-too-large' });
    expect(isLinuxDoCloudflareError(error)).toBe(false);
  });

  it('REG-LINUXDO-001 preserves a final ordinary 429 returned by the hidden WebView', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://linux.do/latest.json');

    expect(response.status).toBe(429);
    expect(await response.text()).toBe('rate limited');
  });

  it('REG-LINUXDO-002 never replays a linux.do write through the hidden WebView', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () => new Response('unexpected replay', { status: 200 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://linux.do/posts', {
      method: 'POST',
      body: JSON.stringify({ raw: 'reply' })
    });

    expect(response.status).toBe(429);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('does not read ordinary linux.do JSON twice before handing it to callers', async () => {
    const response = json({
      id: 42,
      title: 'ordinary linux.do topic',
      created_at: '2026-05-21T00:00:00.000Z',
      posts_count: 1,
      post_stream: {
        stream: [1],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-21T00:00:00.000Z' }
        ]
      }
    });
    response.clone = vi.fn(() => {
      throw new Error('ordinary response should not be cloned');
    });
    const normalFetcher = vi.fn(async () => response);
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher: webViewFetcher as unknown as typeof normalFetcher
    });

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.title).toBe('ordinary linux.do topic');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });
});
