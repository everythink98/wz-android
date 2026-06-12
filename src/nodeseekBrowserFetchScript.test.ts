import { afterEach, describe, expect, it, vi } from 'vitest';
import { NODESEEK_BROWSER_FETCH_SCRIPT } from './app/useHiddenBrowserFetchController';

function runNodeSeekBrowserFetchScript(url: string, html: string) {
  window.history.pushState(null, '', url);
  document.title = '';
  document.body.innerHTML = html;
  const postMessage = vi.fn();
  Object.defineProperty(window, 'ReactNativeWebView', {
    configurable: true,
    value: { postMessage }
  });
  const stop = vi.spyOn(window, 'stop').mockImplementation(() => undefined);

  const script = NODESEEK_BROWSER_FETCH_SCRIPT.replace('__NODESEEK_BROWSER_FETCH_ID__', '7');
  window.eval(script);

  return { postMessage, stop };
}

describe('NodeSeek hidden browser fetch script', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns rendered NodeSeek search pages even when they have no post list items', () => {
    const { postMessage, stop } = runNodeSeekBrowserFetchScript('/search?q=plasma%E6%95%99%E7%A8%8B', `
      <main>
        <form action="/search"><input name="q" value="plasma教程" /></form>
        <section class="empty-state">没有找到相关帖子</section>
      </main>
    `);

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

  it('waits for NodeSeek search results instead of returning the bare search form', () => {
    vi.useFakeTimers();
    try {
      const { postMessage } = runNodeSeekBrowserFetchScript('/search?q=ai', `
        <main>
          <form action="/search"><input name="q" value="ai" /></form>
        </main>
      `);

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not treat Cloudflare challenge search pages as readable results', () => {
    const { postMessage } = runNodeSeekBrowserFetchScript('/search?q=plasma%E6%95%99%E7%A8%8B', `
      <main>
        <h1>Just a moment...</h1>
        <div class="cf-turnstile"></div>
      </main>
    `);

    expect(postMessage).not.toHaveBeenCalled();
  });
});
