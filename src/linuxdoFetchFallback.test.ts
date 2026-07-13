import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginDiagnosticTrace, finishDiagnosticTrace, setDiagnosticWriter, withDiagnosticFetcher } from './diagnostics';
import { createLinuxDoWebViewFallbackFetcher } from './linuxdoFetchFallback';
import { REQUEST_CANCELED_MESSAGE, REQUEST_SUPERSEDED_MESSAGE } from './request';

type AppStateStatus = 'active' | 'background' | 'extension' | 'inactive' | 'unknown';

function createAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState = {
    currentState: 'active' as AppStateStatus | null,
    addEventListener: vi.fn((_event: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: vi.fn(() => listeners.delete(listener)) };
    })
  };
  return {
    appState,
    emit(state: AppStateStatus) {
      appState.currentState = state;
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
    listenerCount: () => listeners.size
  };
}

function json(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function stalledResponse(init?: RequestInit, onSignal?: (signal: AbortSignal | undefined) => void) {
  onSignal?.(init?.signal || undefined);
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
}

function stalledFetcher(onSignal?: (signal: AbortSignal | undefined) => void) {
  return vi.fn((_input: string, init?: RequestInit) => stalledResponse(init, onSignal));
}

describe('linux.do direct transport recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setDiagnosticWriter(null);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('recovers the native connection pool and retries directly when a linux.do request stalls', async () => {
    let directSignal: AbortSignal | undefined;
    let directCalls = 0;
    const directFetcher = vi.fn((_input: string, init?: RequestInit) => {
      directCalls += 1;
      return directCalls === 1
        ? stalledResponse(init, (signal) => { directSignal = signal; })
        : Promise.resolve(json({ id: 42, channel: 'direct-retry' }));
    });
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => json({ id: 42, channel: 'webview' }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    const request = fetcher('https://linux.do/t/42.json');
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(request).resolves.toBeInstanceOf(Response);
    expect(directSignal?.aborted).toBe(true);
    expect(directFetcher).toHaveBeenCalledTimes(2);
    expect(recoverNetworkConnectionPool).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('does not recover or start WebView after the caller aborts', async () => {
    const controller = new AbortController();
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => json({ id: 42 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: stalledFetcher(),
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    const request = fetcher('https://linux.do/t/42.json', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('does not start either transport when the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const directFetcher = vi.fn(async () => json({ id: 42 }));
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => json({ id: 42 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/t/42.json', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(directFetcher).not.toHaveBeenCalled();
    expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it.each([REQUEST_CANCELED_MESSAGE, REQUEST_SUPERSEDED_MESSAGE])(
    'does not revive an interrupted direct request: %s',
    async (message) => {
      const recoverNetworkConnectionPool = vi.fn(async () => undefined);
      const webViewFetcher = vi.fn(async () => json({ id: 42 }));
      const fetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher: vi.fn(async () => { throw new Error(message); }),
        recoverNetworkConnectionPool,
        webViewFetcher
      });

      await expect(fetcher('https://linux.do/t/42.json')).rejects.toThrow(message);
      expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
      expect(webViewFetcher).not.toHaveBeenCalled();
    }
  );

  it('recovers and retries directly once after an immediate network error', async () => {
    let directCalls = 0;
    const directFetcher = vi.fn(async () => {
      directCalls += 1;
      if (directCalls === 1) {
        throw new TypeError('Network request failed');
      }
      return json({ channel: 'direct-retry' });
    });
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => json({ channel: 'webview' }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/t/1.json')).resolves.toBeInstanceOf(Response);

    expect(directFetcher).toHaveBeenCalledTimes(2);
    expect(recoverNetworkConnectionPool).toHaveBeenCalledWith(expect.objectContaining({
      source: 'linuxdo',
      reason: 'direct-error'
    }));
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('still retries directly when native connection-pool recovery fails', async () => {
    let directCalls = 0;
    const directFetcher = vi.fn(async () => {
      directCalls += 1;
      if (directCalls === 1) {
        throw new TypeError('Network request failed');
      }
      return json({ channel: 'direct-retry' });
    });
    const recoverNetworkConnectionPool = vi.fn(async () => {
      throw new Error('native recovery failed');
    });
    const webViewFetcher = vi.fn(async () => json({ channel: 'webview' }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/t/1.json')).resolves.toBeInstanceOf(Response);

    expect(directFetcher).toHaveBeenCalledTimes(2);
    expect(recoverNetworkConnectionPool).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('surfaces a second direct failure without changing transport to WebView', async () => {
    let directCalls = 0;
    const directFetcher = vi.fn(async () => {
      directCalls += 1;
      throw new TypeError(directCalls === 1 ? 'first direct failure' : 'second direct failure');
    });
    const recoverNetworkConnectionPool = vi.fn(async () => {
      throw new Error('native recovery failed');
    });
    const webViewFetcher = vi.fn(async () => json({ channel: 'webview' }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/t/1.json')).rejects.toThrow('second direct failure');

    expect(directFetcher).toHaveBeenCalledTimes(2);
    expect(recoverNetworkConnectionPool).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('keeps the original Cloudflare challenge WebView fallback', async () => {
    const directFetcher = vi.fn(async () => new Response('<html>challenge</html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }
    }));
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => json({ id: 42 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/t/42.json')).resolves.toBeInstanceOf(Response);

    expect(directFetcher).toHaveBeenCalledTimes(1);
    expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps linux.do site-search URLs on the existing WebView-only path', async () => {
    const directFetcher = vi.fn(async () => json({ channel: 'direct' }));
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => new Response('<html>search</html>'));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });

    await expect(fetcher('https://www.google.com/search?q=site%3Alinux.do+codex')).resolves.toBeInstanceOf(Response);

    expect(directFetcher).not.toHaveBeenCalled();
    expect(recoverNetworkConnectionPool).not.toHaveBeenCalled();
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves the wall-clock deadline across backgrounding and records a sanitized direct recovery trace', async () => {
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const appState = createAppState();
    let directCalls = 0;
    const directFetcher = vi.fn((_input: string, init?: RequestInit) => {
      directCalls += 1;
      return directCalls === 1
        ? stalledResponse(init)
        : Promise.resolve(json({ channel: 'direct-retry' }));
    });
    const recoverNetworkConnectionPool = vi.fn(async () => undefined);
    const webViewFetcher = vi.fn(async () => json({ channel: 'webview' }));
    const recoveringFetcher = createLinuxDoWebViewFallbackFetcher({
      appState: appState.appState,
      defaultFetcher: directFetcher,
      recoverNetworkConnectionPool,
      webViewFetcher
    });
    const trace = beginDiagnosticTrace('topic', 'open');
    const fetcher = withDiagnosticFetcher(trace, recoveringFetcher);

    const request = fetcher('https://linux.do/t/private-topic.json?token=secret');
    vi.setSystemTime(new Date('2026-07-12T00:00:03.000Z'));
    appState.emit('background');
    vi.setSystemTime(new Date('2026-07-12T00:00:08.500Z'));
    appState.emit('active');
    await vi.advanceTimersByTimeAsync(0);
    await request;
    finishDiagnosticTrace(trace, 'success');

    const events = lines.map((line) => JSON.parse(line));
    expect(directFetcher).toHaveBeenCalledTimes(2);
    expect(recoverNetworkConnectionPool).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
    expect(appState.listenerCount()).toBe(0);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'linuxdo',
        phase: 'transport',
        channel: 'direct',
        state: 'timeout',
        trigger: 'app-resume',
        timeoutMs: 8000
      }),
      expect.objectContaining({
        source: 'linuxdo',
        phase: 'transport',
        channel: 'native',
        state: 'recovery-mode',
        reason: 'timeout'
      }),
      expect.objectContaining({
        source: 'linuxdo',
        phase: 'transport',
        channel: 'direct',
        state: 'retry',
        attempt: 2
      }),
      expect.objectContaining({
        source: 'linuxdo',
        phase: 'transport',
        channel: 'direct',
        state: 'finish',
        status: 200
      })
    ]));
    expect(JSON.stringify(events)).not.toMatch(/private-topic|token|secret|https?:/i);
  });
});
