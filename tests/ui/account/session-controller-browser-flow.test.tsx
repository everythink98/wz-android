import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useSessionController } from '@/features/account/useSessionController';
import type { ScopedSiteSessionEvent } from '@/domain/session/siteSessionState';
import {
  getReadNetworkRuntimeSnapshot,
  publishReadNetworkRuntimeRotation
} from '@/platform/network/readNetworkRuntime';
import { proveForumReadResponse, runForumSourceReadAttempt } from '@/sources/forumSourceReadAttempt';

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined)
}));

const mockRecoverReadNetworkRuntime =
  jest.fn<(source: unknown, expectedGeneration: unknown, options: unknown) => Promise<unknown>>();

jest.mock('@/platform/network/networkProxy', () => ({
  recoverReadNetworkRuntime: (source: unknown, expectedGeneration: unknown, options: unknown) =>
    mockRecoverReadNetworkRuntime(source, expectedGeneration, options)
}));

jest.mock('@/platform/storage/legacyCookieSnapshotMigration', () => ({
  LEGACY_COOKIE_SNAPSHOT_KEYS: [],
  migrateLegacyCookieSnapshots: jest.fn(async () => ({
    linuxdo: 'retained',
    nodeseek: 'retained',
    yaohuo: 'retained'
  }))
}));

function renderSessionController(
  defaultFetcher: typeof fetch,
  onSiteSessionEvent: (event: ScopedSiteSessionEvent) => void = jest.fn()
) {
  return renderHook(() =>
    useSessionController({
      defaultFetcher,
      forumSessionEpochsRef: { current: initialForumSessionEpochs },
      linuxDoBrowserWebViewRef: { current: null },
      linuxDoWebViewUserAgentRef: { current: '' },
      nodeSeekBrowserWebViewRef: { current: null },
      nodeSeekRecoveryThreshold: 1,
      nodeSeekWebViewUserAgentRef: { current: '' },
      notify: jest.fn(),
      setLinuxDoWebViewUserAgent: jest.fn(),
      setNodeSeekWebViewUserAgent: jest.fn(),
      setWebLoginUserId: jest.fn(),
      webLoginDetectedRef: { current: false },
      onSiteSessionEvent
    })
  );
}

describe('session controller hidden Google flow', () => {
  afterEach(() => {
    mockRecoverReadNetworkRuntime.mockReset();
  });

  it('[REG-SEARCH-014] routes a scoped NodeSeek Google search through HiddenBrowserHost', async () => {
    const defaultFetcher = jest.fn<typeof fetch>(async () => new Response('unexpected direct fetch'));
    const searchUrl = 'https://www.google.com/search?q=site%3Anodeseek.com+codex';
    const hook = await renderSessionController(defaultFetcher);
    let responsePromise!: Promise<Response>;

    await act(async () => {
      responsePromise = hook.result.current.forumFetchWithWebViewFallback(searchUrl);
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(searchUrl));
    expect(defaultFetcher).not.toHaveBeenCalled();

    const requestId = hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.id;
    await act(async () => {
      await hook.result.current.completeNodeSeekBrowserFetch({
        id: requestId,
        url: searchUrl,
        html: '<html><title>Google Search</title></html>'
      });
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);
  });

  it('[REG-SEARCH-014] rejects a forum page as the result of a Google search task', async () => {
    const defaultFetcher = jest.fn<typeof fetch>(async () => new Response('unexpected direct fetch'));
    const searchUrl = 'https://www.google.com/search?q=site%3Anodeseek.com+codex';
    const hook = await renderSessionController(defaultFetcher);
    let responsePromise!: Promise<Response>;

    await act(async () => {
      responsePromise = hook.result.current.forumFetchWithWebViewFallback(searchUrl);
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(searchUrl));
    const outcome = responsePromise.then(
      () => 'resolved',
      (error: Error) => error.message
    );

    await act(async () => {
      await hook.result.current.completeNodeSeekBrowserFetch({
        id: hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.id,
        url: 'https://www.nodeseek.com/search?q=codex',
        html: '<html>wrong flow</html>'
      });
    });
    await expect(outcome).resolves.toContain('外部地址');
    expect(defaultFetcher).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-010] wires a parsed fallback to the generation captured before HiddenBrowserHost starts', async () => {
    const requestStartGeneration = getReadNetworkRuntimeSnapshot().generation;
    mockRecoverReadNetworkRuntime.mockResolvedValue({
      ok: true,
      rotated: false,
      previousGeneration: requestStartGeneration,
      generation: requestStartGeneration + 1,
      canceledQueued: 0,
      canceledRunning: 0
    });
    const defaultFetcher = jest.fn<typeof fetch>(async () => {
      throw new TypeError('Network request failed');
    });
    const hook = await renderSessionController(defaultFetcher);
    let responsePromise!: Promise<string>;

    await act(async () => {
      responsePromise = runForumSourceReadAttempt(
        'nodeseek',
        hook.result.current.forumFetchWithWebViewFallback,
        async (fetcher) => {
          const response = await fetcher('https://www.nodeseek.com/?sortBy=postTime');
          return proveForumReadResponse(response, async () => {
            const body = await response.text();
            if (!body.includes('captured before WebView')) {
              throw new Error('NodeSeek source parse failed');
            }
            return body;
          });
        },
        () => true
      );
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(
        'https://www.nodeseek.com/?sortBy=postTime'
      )
    );
    publishReadNetworkRuntimeRotation(requestStartGeneration + 1, 'linuxdo');

    await act(async () => {
      await hook.result.current.completeNodeSeekBrowserFetch({
        id: hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.id,
        url: 'https://www.nodeseek.com/?sortBy=postTime',
        html: `
            <ul class="post-list">
              <li class="post-list-item">
                <div class="post-title"><a href="/post-743018-1">captured before WebView</a></div>
                <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
              </li>
            </ul>
          `
      });
    });

    await expect(responsePromise).resolves.toContain('captured before WebView');
    expect(mockRecoverReadNetworkRuntime).toHaveBeenCalledWith(
      'nodeseek',
      requestStartGeneration,
      expect.objectContaining({ trace: expect.objectContaining({ traceId: expect.any(String) }) })
    );
  });

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    '[REG-ACCOUNT-035] publishes an authoritative %s clear without owning the account transition',
    async (source) => {
      const clearManagedLoginCookies = jest.fn(async () => true);
      NativeModules.NetworkProxyModule = { clearManagedLoginCookies };
      const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
      const hook = await renderSessionController(
        jest.fn(async () => new Response('{}')),
        onSiteSessionEvent
      );

      await act(async () => {
        await hook.result.current[
          source === 'nodeseek'
            ? 'clearNodeSeekLoginState'
            : source === 'linuxdo'
              ? 'clearLinuxDoLoginState'
              : 'clearYaohuoLoginState'
        ]();
      });

      expect(clearManagedLoginCookies).toHaveBeenCalledWith(source);
      expect(onSiteSessionEvent).toHaveBeenCalledWith({ site: source, type: 'cleared' });
      expect(hook.result.current.forumSessionEpochs[source]).toBe(initialForumSessionEpochs[source]);
    }
  );

  it('[REG-ACCOUNT-035] keeps a failed clear non-terminal', async () => {
    NativeModules.NetworkProxyModule = {
      clearManagedLoginCookies: jest.fn(async () => {
        throw new Error('native clear failed');
      })
    };
    const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
    const hook = await renderSessionController(
      jest.fn(async () => new Response('{}')),
      onSiteSessionEvent
    );

    await act(async () => {
      await expect(hook.result.current.clearNodeSeekLoginState()).rejects.toThrow('native clear failed');
    });

    expect(onSiteSessionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ site: 'nodeseek', type: 'check-failed' })
    );
    expect(onSiteSessionEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ site: 'nodeseek', type: expect.stringMatching(/^(?:cleared|login-expired)$/) })
    );
  });

  it('[REG-ACCOUNT-035] publishes no terminal event for a stale clear', async () => {
    const firstNativeClear = Promise.withResolvers<boolean>();
    const clearManagedLoginCookies = jest
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(async () => firstNativeClear.promise)
      .mockResolvedValueOnce(true);
    NativeModules.NetworkProxyModule = { clearManagedLoginCookies };
    const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
    const hook = await renderSessionController(
      jest.fn(async () => new Response('{}')),
      onSiteSessionEvent
    );
    let stale!: ReturnType<typeof hook.result.current.clearNodeSeekLoginState>;
    let current!: ReturnType<typeof hook.result.current.clearNodeSeekLoginState>;

    await act(async () => {
      stale = hook.result.current.clearNodeSeekLoginState();
      await Promise.resolve();
    });
    await waitFor(() => expect(clearManagedLoginCookies).toHaveBeenCalledTimes(1));
    await act(async () => {
      current = hook.result.current.clearNodeSeekLoginState();
      firstNativeClear.resolve(true);
      await expect(stale).resolves.toBe(false);
      await expect(current).resolves.toBe(true);
    });

    expect(onSiteSessionEvent.mock.calls.filter(([event]) => event.type === 'cleared')).toEqual([
      [{ site: 'nodeseek', type: 'cleared' }]
    ]);
  });
});
