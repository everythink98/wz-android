import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINUXDO_BROWSER_FETCH_SCRIPT, NODESEEK_BROWSER_FETCH_SCRIPT } from '@/app/useHiddenBrowserFetchController';

function runNodeSeekBrowserFetchScript(url: string, html: string, owner?: 'account') {
  window.history.pushState(null, '', url);
  document.title = '';
  document.body.innerHTML = html;
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    value: document.body.textContent ?? ''
  });
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });
  const stop = vi.spyOn(window, 'stop').mockImplementation(() => undefined);

  const script = NODESEEK_BROWSER_FETCH_SCRIPT.replace('__NODESEEK_BROWSER_FETCH_ID__', '7').replace(
    '__NODESEEK_BROWSER_FETCH_OWNER__',
    JSON.stringify(owner ?? null)
  );
  window.eval(script);

  return {
    evaluateAgain: () => window.eval(script),
    postMessage,
    stop
  };
}

function runLinuxDoBrowserFetchScript(url: string, html: string, innerText?: string) {
  window.history.pushState(null, '', url);
  document.title = '';
  document.body.innerHTML = html;
  Object.defineProperty(document.body, 'innerText', {
    configurable: true,
    value: innerText ?? document.body.textContent ?? ''
  });
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });

  const script = LINUXDO_BROWSER_FETCH_SCRIPT.replace('__LINUXDO_BROWSER_FETCH_ID__', '9');
  window.eval(script);

  return { postMessage };
}

function runLinuxDoBrowserFetchJson(url: string, body: string) {
  return runLinuxDoBrowserFetchScript(url, '<pre></pre>', body);
}

describe('hidden browser fetch scripts', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as typeof window & { __config__?: unknown }).__config__;
    delete (
      window as typeof window & {
        __wzNodeSeekBrowserFetchRequestId?: number;
      }
    ).__wzNodeSeekBrowserFetchRequestId;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns rendered NodeSeek search pages even when they have no post list items', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/search?q=plasma%E6%95%99%E7%A8%8B',
      `
      <main>
        <form action="/search"><input name="q" value="plasma教程" /></form>
        <section class="empty-state">没有找到相关帖子</section>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false
    });
    expect(payload.html).toContain('没有找到相关帖子');
    expect(stop).toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-037] waits for NodeSeek identity evidence during account probes', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runNodeSeekBrowserFetchScript(
        '/',
        `
        <ul class="post-list">
          <li class="post-list-item">Public topic</li>
        </ul>
      `,
        'account'
      );

      expect(postMessage).not.toHaveBeenCalled();

      document.body.innerHTML += `
        <header>
          <a class="btn" href="/signIn.html">登录</a>
          <a class="btn" href="/register.html">注册</a>
        </header>
      `;
      vi.advanceTimersByTime(500);

      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
      expect(payload.html).toContain('/signIn.html');
      expect(payload.html).toContain('/register.html');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-ACCOUNT-037] settles an explicit null NodeSeek runtime user without waiting for mobile guest controls', () => {
    Object.defineProperty(window, '__config__', {
      configurable: true,
      value: { user: null }
    });

    const { evaluateAgain, postMessage } = runNodeSeekBrowserFetchScript(
      '/',
      `
      <ul class="post-list">
        <li class="post-list-item">Public topic</li>
      </ul>
    `,
      'account'
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload.html).toContain('nodeseekAccountState');
    expect(payload.html).not.toContain('Public topic');
    expect(payload.html.length).toBeLessThan(1000);

    evaluateAgain();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it.each([false, undefined, {}])('[REG-ACCOUNT-037] keeps an unproven NodeSeek runtime user unknown: %p', (user) => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(window, '__config__', {
        configurable: true,
        value: { user }
      });

      const { postMessage } = runNodeSeekBrowserFetchScript(
        '/',
        `
          <ul class="post-list">
            <li class="post-list-item">Public topic</li>
          </ul>
        `,
        'account'
      );

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('waits for NodeSeek search results instead of returning the bare search form', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runNodeSeekBrowserFetchScript(
        '/search?q=ai',
        `
        <main>
          <form action="/search"><input name="q" value="ai" /></form>
        </main>
      `
      );

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not treat NodeSeek search page config as post detail data', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runNodeSeekBrowserFetchScript(
        '/search?q=ai',
        `
        <main>
          <script id="temp-script" type="application/json">eyJhbGxDYXRlZ29yeSI6W119</script>
          <form action="/search"><input name="q" value="ai" /></form>
        </main>
      `
      );

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('fails bare NodeSeek search pages at the read deadline instead of returning them as empty results', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runNodeSeekBrowserFetchScript(
        '/search?q=ai',
        `
        <main>
          <form action="/search"><input name="q" value="ai" /></form>
        </main>
      `
      );

      vi.advanceTimersByTime(15000);

      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
      expect(payload).toMatchObject({
        type: 'nodeseek-browser-fetch',
        id: 7,
        error: 'NodeSeek 搜索页结果没有加载完成，请重试'
      });
      expect(payload.html).toBeUndefined();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('returns interactive Cloudflare challenge pages immediately', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/search?q=plasma%E6%95%99%E7%A8%8B',
      `
      <main>
        <h1>Just a moment...</h1>
        <div class="cf-turnstile"></div>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: true
    });
    expect(payload.html).toBe('');
    expect(stop).toHaveBeenCalled();
  });

  it('returns Google search result pages when they contain NodeSeek topic links', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/search?q=site%3Anodeseek.com+codex',
      `
      <main>
        <a href="https://www.nodeseek.com/post-861593-1">claude code 好用 还是 codex 好用</a>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false
    });
    expect(payload.url).toContain('/search?q=site%3Anodeseek.com+codex');
    expect(payload.html).toContain('post-861593-1');
    expect(stop).toHaveBeenCalled();
  });

  it('returns Google search result pages when they contain linux.do topic links', () => {
    const { postMessage } = runLinuxDoBrowserFetchScript(
      '/search?q=site%3Alinux.do+codex',
      `
      <main>
        <a href="/url?url=https%3A%2F%2Flinux.do%2Ft%2Ftopic%2F1424130&amp;sa=U">Codex CLI 讨论</a>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'linuxdo-browser-fetch',
      id: 9,
      challenge: false
    });
    expect(payload.url).toContain('/search?q=site%3Alinux.do+codex');
    expect(payload.body).toContain('linux.do%2Ft%2Ftopic%2F1424130');
  });

  it('returns raw NodeSeek JSON bodies for browser-fetched API pages', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/session/csrf',
      `
      <pre>{"csrf":"dynamic-token"}</pre>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false,
      html: '{"csrf":"dynamic-token"}'
    });
    expect(stop).toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] keeps Cloudflare marker text inside NodeSeek browser-fetched JSON as data', () => {
    const body = JSON.stringify({ message: 'ordinary cf-turnstile challenge-platform data' });
    const { postMessage, stop } = runNodeSeekBrowserFetchScript('/api/account/status', `<pre>${body}</pre>`);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false,
      html: body
    });
    expect(stop).toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] prefers readable NodeSeek content over injected challenge-platform markup', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/post-777280-1',
      `
      <main>
        <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
        <article class="post-content"><p>正常正文讨论 cf-turnstile</p></article>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false
    });
    expect(payload.html).toContain('正常正文');
    expect(stop).toHaveBeenCalled();
  });

  it('returns the real NodeSeek private-post notice without waiting for timeout', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/post-777282-1',
      `
      <section id="nsk-frame">
        <div id="nsk-body" class="nsk-container">
          <div id="nsk-body-left">
            <div>本帖已经被用户设为私有，您没有阅读权限</div>
          </div>
        </div>
      </section>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false
    });
    expect(payload.html).toContain('本帖已经被用户设为私有');
    expect(stop).toHaveBeenCalled();
  });

  it('returns a clear error instead of sending oversized WebView bridge messages', () => {
    const { postMessage } = runNodeSeekBrowserFetchScript(
      '/post-777283-1',
      `
      <main>
        <article class="post-content">${'x'.repeat(950000)}</article>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      error: 'NodeSeek 页面内容过大，已停止读取'
    });
    expect(payload.html).toBeUndefined();
  });

  it('returns only NodeSeek embedded post data when the rendered page is huge', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/post-777284-1',
      `
      <main>
        <script id="temp-script" type="application/json">eyJwb3N0RGF0YSI6eyJwb3N0SWQiOjc3NzI4NH19</script>
        <article class="post-content">${'x'.repeat(950000)}</article>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'nodeseek-browser-fetch',
      id: 7,
      challenge: false
    });
    expect(payload.html).toContain('id="temp-script"');
    expect(payload.html.length).toBeLessThan(1000);
    expect(stop).toHaveBeenCalled();
  });

  it('returns NodeSeek window config post data when the rendered page has no temp script', () => {
    Object.defineProperty(window, '__config__', {
      configurable: true,
      value: {
        postData: {
          postId: 777286,
          comments: [
            {
              commentId: 10990421,
              floorIndex: 9,
              markdown: '原始 **Markdown**',
              poster: { uid: 54874, isMe: true }
            },
            {
              commentId: 10990422,
              floorIndex: 10,
              content: '@KWEOO #6 最新版没找到',
              poster: { uid: 1 }
            }
          ]
        }
      }
    });
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/post-777286-1',
      `
      <main>
        <div id="9" data-comment-id="10990421" class="content-item">
          <article class="post-content"><p>渲染后的 Markdown</p></article>
          <div class="signature"><a href="/space/54874">个人签名</a></div>
        </div>
        <div id="10" data-comment-id="10990422" class="content-item">
          <article class="post-content">
            <p><a href="/member?t=KWEOO">@KWEOO</a> <a href="/post-777286-1#6">#6</a> 最新版没找到</p>
          </article>
        </div>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload.html).toContain('id="temp-script"');
    const encoded = payload.html.match(/<script[^>]*id="temp-script"[^>]*>([\s\S]*?)<\/script>/)?.[1] || '';
    const data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(data.postData.comments[0]).toMatchObject({
      commentId: 10990421,
      floorIndex: 9,
      markdown: '原始 **Markdown**',
      content: '<p>渲染后的 Markdown</p>',
      signature: '<a href="/space/54874">个人签名</a>',
      poster: { uid: 54874, isMe: true }
    });
    expect(data.postData.comments[1]).toMatchObject({
      commentId: 10990422,
      content: '<p><a href="/member?t=KWEOO">@KWEOO</a> <a href="/post-777286-1#6">#6</a> 最新版没找到</p>'
    });
    expect(stop).toHaveBeenCalled();
  });

  it('does not wait for vote widgets when NodeSeek embedded post data is ready', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript(
      '/post-777285-1',
      `
      <main>
        <script id="temp-script" type="application/json">eyJwb3N0RGF0YSI6eyJwb3N0SWQiOjc3NzI4NX19</script>
        <div class="embed-vote">
          <div class="form-mask"></div>
          <input name="vote-item" id="vote-1" value="">
          <label for="vote-1"></label>
        </div>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload.html).toContain('id="temp-script"');
    expect(stop).toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] does not turn marker text on an incomplete NodeSeek page into a challenge', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runNodeSeekBrowserFetchScript(
        '/search?q=cf-turnstile',
        `
        <main>
          <form action="/search"><input name="q" value="cf-turnstile" /></form>
          <p>普通页面文字提到 cf-turnstile 和 challenge-platform。</p>
        </main>
      `
      );

      vi.advanceTimersByTime(15000);

      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
      expect(payload).toMatchObject({
        type: 'nodeseek-browser-fetch',
        id: 7,
        challenge: false,
        error: 'NodeSeek 搜索页结果没有加载完成，请重试'
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not send linux.do challenge page HTML through the bridge', () => {
    const { postMessage } = runLinuxDoBrowserFetchScript(
      '/latest.json',
      `
      <main>
        <h1>Just a moment...</h1>
        <div class="cf-turnstile"></div>
      </main>
    `
    );

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'linuxdo-browser-fetch',
      id: 9,
      challenge: true
    });
    expect(payload.body).toBe('');
  });

  it('returns linux.do JSON bodies larger than 12 KB without truncating them', () => {
    const body = JSON.stringify({ items: ['x'.repeat(13000)] });
    const { postMessage } = runLinuxDoBrowserFetchJson('/latest.json', body);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'linuxdo-browser-fetch',
      id: 9,
      challenge: false,
      body
    });
  });

  it('[REG-VERIFICATION-002] keeps Cloudflare marker text inside linux.do browser-fetched JSON as data', () => {
    const body = JSON.stringify({ items: ['ordinary cf-turnstile challenge-platform data'] });
    const { postMessage } = runLinuxDoBrowserFetchJson('/search.json', body);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'linuxdo-browser-fetch',
      id: 9,
      challenge: false,
      body
    });
  });

  it('[REG-VERIFICATION-002] does not turn marker text on an ordinary linux.do HTML page into a challenge', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runLinuxDoBrowserFetchScript(
        '/search?q=cf-turnstile',
        `
        <main><article>普通页面文字提到 cf-turnstile 和 challenge-platform。</article></main>
      `
      );

      vi.advanceTimersByTime(8000);

      expect(postMessage).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
      expect(payload).toMatchObject({
        type: 'linuxdo-browser-fetch',
        id: 9,
        challenge: false
      });
      expect(payload.body).toContain('普通页面文字');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('REG-LINUXDO-001 reports an oversized linux.do bridge payload without classifying it as Cloudflare', () => {
    const body = JSON.stringify({ items: ['x'.repeat(950000)] });
    const { postMessage } = runLinuxDoBrowserFetchJson('/latest.json', body);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postMessage.mock.calls[0]?.[0] || '{}');
    expect(payload).toMatchObject({
      type: 'linuxdo-browser-fetch',
      id: 9,
      challenge: false,
      failureReason: 'content-too-large',
      error: 'linux.do 页面内容过大，已停止读取'
    });
    expect(payload.body).toBeUndefined();
  });
});
