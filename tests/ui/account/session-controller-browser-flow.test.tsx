import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import React, { createRef } from 'react';
import { NativeModules } from 'react-native';
import type { WebView } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { useSessionController } from '@/features/account/useSessionController';
import { HiddenBrowserHost } from '@/features/account/HiddenBrowserHost';
import { useHiddenBrowserFetchController } from '@/features/account/useHiddenBrowserFetchController';
import { createAccountHostStyles } from '@/features/account/accountHostStyles';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createTheme } from '@/ui/theme/tokens';
import type { ScopedSiteSessionEvent } from '@/domain/session/siteSessionState';
import {
  getReadNetworkRuntimeSnapshot,
  publishReadNetworkRuntimeRotation
} from '@/platform/network/readNetworkRuntime';
import { proveForumReadResponse, runForumSourceReadAttempt } from '@/sources/forumSourceReadAttempt';
import { withLinuxDoConnectSessionRecoveryIntent } from '@/sources/linuxdo/browserFallback';
import { withBrowserFetchIntent, type BrowserFetchPriority } from '@/platform/network/browserFetchIntent';
import { prepareRequestToSend, withRequestBeforeSend } from '@/platform/network/request';

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const Native = require('react-native') as typeof import('react-native');
  return {
    WebView: ReactModule.forwardRef(function MockWebView(props: Record<string, unknown>, ref) {
      ReactModule.useImperativeHandle(ref, () => ({
        injectJavaScript: jest.fn(),
        stopLoading: jest.fn()
      }));
      return ReactModule.createElement(Native.View, { ...props, testID: 'hidden-browser' });
    })
  };
});

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
  LEGACY_COOKIE_SNAPSHOT_KEYS: [
    'nodeseek-access',
    'nodeseek-cookie-header',
    'linuxdo-clearance',
    'yaohuo-cookie-header'
  ],
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
      commitLinuxDoWebViewUserAgent: jest.fn(),
      commitNodeSeekWebViewUserAgent: jest.fn(),
      defaultFetcher,
      forumSessionEpochsRef: { current: initialForumSessionEpochs },
      linuxDoBrowserWebViewRef: { current: null },
      nodeSeekBrowserWebViewRef: { current: null },
      nodeSeekRecoveryThreshold: 1,
      notify: jest.fn(),
      onSiteSessionEvent
    })
  );
}

describe('session controller browser flow', () => {
  let originalNetworkProxy: PropertyDescriptor | undefined;
  beforeEach(() => {
    originalNetworkProxy = Object.getOwnPropertyDescriptor(NativeModules, 'NetworkProxyModule');
    jest.mocked(SecureStore.deleteItemAsync).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    mockRecoverReadNetworkRuntime.mockReset();
    if (originalNetworkProxy) Object.defineProperty(NativeModules, 'NetworkProxyModule', originalNetworkProxy);
    else delete NativeModules.NetworkProxyModule;
  });

  it.each<['nodeseek' | 'linuxdo', 'private-access-stale' | 'source-disabled']>([
    ['nodeseek', 'private-access-stale'],
    ['nodeseek', 'source-disabled'],
    ['linuxdo', 'private-access-stale'],
    ['linuxdo', 'source-disabled']
  ])(
    'rejects a private %s read revoked by %s before handing a native challenge to its browser',
    async (site, reason) => {
      const direct = Promise.withResolvers<Response>();
      const defaultFetcher = jest.fn<typeof fetch>(async (_url, init) => {
        prepareRequestToSend(init);
        return direct.promise;
      });
      const hook = await renderSessionController(defaultFetcher);
      const controller = new AbortController();
      const stale = Object.assign(new Error(reason === 'source-disabled' ? '内容源已停用' : '账号状态已变化'), {
        reason,
        source: site
      });
      let current = true;
      let settled: Response | Error | undefined;
      const browser = site === 'linuxdo' ? 'linuxDo' : 'nodeSeek';
      const siteFetcher =
        site === 'linuxdo'
          ? hook.result.current.forumFetchWithWebViewFallback
          : hook.result.current.nodeSeekFetchWithWebViewFallback;
      const fetcher = withRequestBeforeSend(siteFetcher, () => {
        if (!current) throw stale;
      });
      let request!: Promise<Response | Error>;
      try {
        await act(async () => {
          request = fetcher(
            site === 'linuxdo'
              ? 'https://linux.do/notifications.json'
              : 'https://www.nodeseek.com/api/notification/unread-count',
            withBrowserFetchIntent({ signal: controller.signal }, { owner: 'account', priority: 'background' })
          ).then(
            (response) => (settled = response),
            (error: Error) => (settled = error)
          );
        });
        expect(defaultFetcher).toHaveBeenCalledTimes(1);
        await act(async () => {
          current = false;
          direct.resolve(new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } }));
        });
        await waitFor(() => expect(settled || hook.result.current.hiddenBrowserFetchRequests[browser]).toBeTruthy());

        expect(hook.result.current.hiddenBrowserFetchRequests[browser]).toBeNull();
        await expect(request).resolves.toBe(stale);
      } finally {
        await act(async () => controller.abort());
        await request;
        await hook.unmount();
      }
    }
  );

  it.each<['nodeseek' | 'linuxdo', 'identity' | 'abort' | 'disabled']>([
    ['nodeseek', 'identity'],
    ['nodeseek', 'abort'],
    ['nodeseek', 'disabled'],
    ['linuxdo', 'identity'],
    ['linuxdo', 'abort'],
    ['linuxdo', 'disabled']
  ])('skips a queued %s private read after %s and continues with the next allowed read', async (site, change) => {
    const defaultFetcher = jest.fn<typeof fetch>(async (_url, init) => {
      prepareRequestToSend(init);
      return new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    });
    const hook = await renderSessionController(defaultFetcher);
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const urls = ['held', 'private', 'allowed'].map((part) =>
      site === 'linuxdo'
        ? `https://linux.do/notifications.json?fixture=${part}`
        : `https://www.nodeseek.com/api/notification/${part}`
    );
    const browser = site === 'linuxdo' ? 'linuxDo' : 'nodeSeek';
    const siteFetcher =
      site === 'linuxdo'
        ? hook.result.current.forumFetchWithWebViewFallback
        : hook.result.current.nodeSeekFetchWithWebViewFallback;
    const complete = async (body: string) => {
      const active = hook.result.current.hiddenBrowserFetchRequests[browser]!;
      if (site === 'linuxdo') await hook.result.current.completeLinuxDoBrowserFetch({ ...active, body });
      else await hook.result.current.completeNodeSeekBrowserFetch({ ...active, html: body });
    };
    const stale = Object.assign(new Error(change === 'disabled' ? '内容源已停用' : '账号状态已变化'), {
      reason: change === 'disabled' ? 'source-disabled' : 'private-access-stale',
      source: site
    });
    let current = true;
    const protectedFetcher = withRequestBeforeSend(siteFetcher, () => {
      if (!current) throw stale;
    });
    const requests: Promise<Response | Error>[] = [];
    const start = (index: number) =>
      (index === 1 ? protectedFetcher : siteFetcher)(
        urls[index]!,
        withBrowserFetchIntent({ signal: controllers[index]!.signal }, { owner: 'account', priority: 'background' })
      ).catch((error: Error) => error);
    try {
      await act(async () => {
        requests.push(start(0));
      });
      await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests[browser]?.url).toBe(urls[0]));
      await act(async () => {
        requests.push(start(1), start(2));
      });
      expect(defaultFetcher).toHaveBeenCalledTimes(3);
      expect(hook.result.current.hiddenBrowserFetchRequests[browser]?.url).toBe(urls[0]);
      await act(async () => {
        if (change === 'abort') controllers[1]!.abort();
        else current = false;
        await complete('{"held":true}');
      });

      expect(hook.result.current.hiddenBrowserFetchRequests[browser]?.url).toBe(urls[2]);
      await expect(requests[1]).resolves.toEqual(change === 'abort' ? new Error('请求已取消') : stale);
      if (change !== 'abort') await expect(requests[1]).resolves.toBe(stale);
      await act(async () => {
        await complete('{"allowed":true}');
      });
      await expect(
        requests[0]!.then((response) => (response instanceof Response ? response.json() : response))
      ).resolves.toEqual({ held: true });
      await expect(
        requests[2]!.then((response) => (response instanceof Response ? response.json() : response))
      ).resolves.toEqual({ allowed: true });
      expect(hook.result.current.hiddenBrowserFetchRequests[browser]).toBeNull();
    } finally {
      await act(async () => controllers.forEach((controller) => controller.abort()));
      await Promise.all(requests);
      await hook.unmount();
    }
  });

  it.each([403, 404])(
    'uses the current NodeSeek document status after an earlier %i and ignores late events from an old request',
    async (initialStatus) => {
      const hook = await renderSessionController(
        jest.fn(async () => new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } }))
      );
      const bridge = await renderHook(() =>
        useHiddenBrowserFetchController({
          completeLinuxDoBrowserFetch: hook.result.current.completeLinuxDoBrowserFetch,
          completeNodeSeekBrowserFetch: hook.result.current.completeNodeSeekBrowserFetch
        })
      );
      const host = () => (
        <HiddenBrowserHost
          blockedMessage=""
          failLinuxDoBrowserFetchById={hook.result.current.failLinuxDoBrowserFetchById}
          failNodeSeekBrowserFetchById={hook.result.current.failNodeSeekBrowserFetchById}
          handleLinuxDoBrowserFetchMessage={bridge.result.current.handleLinuxDoBrowserFetchMessage}
          handleNodeSeekBrowserFetchMessage={bridge.result.current.handleNodeSeekBrowserFetchMessage}
          linuxDoBrowserWebViewRef={createRef<WebView>()}
          nodeSeekBrowserWebViewRef={createRef<WebView>()}
          onLinuxDoHttpErrorStatus={hook.result.current.markLinuxDoBrowserFetchHttpError}
          onNodeSeekHttpErrorStatus={hook.result.current.markNodeSeekBrowserFetchHttpError}
          state={{
            linuxDo: { request: null, userAgent: '' },
            nodeSeek: { request: hook.result.current.hiddenBrowserFetchRequests.nodeSeek, userAgent: '' }
          }}
          styles={createAccountHostStyles(createTheme({ theme: 'light' }), createEmptyReaderData().settings)}
        />
      );
      const urls = ['https://www.nodeseek.com/post-11-1', 'https://www.nodeseek.com/post-12-1'];
      const controllers = urls.map(() => new AbortController());
      let responses!: Promise<Response>[];
      await act(async () => {
        responses = urls.map((url, index) => {
          const response = hook.result.current.forumFetchWithWebViewFallback(url, {
            signal: controllers[index]!.signal
          });
          void response.catch(() => undefined);
          return response;
        });
      });
      await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(urls[0]));
      const view = await render(host());
      const firstDocument = view.getByTestId('hidden-browser');
      const oldLoadStart = firstDocument.props.onLoadStart;
      const oldHttpError = firstDocument.props.onHttpError;
      const postDocument = async (html: string) => {
        const request = hook.result.current.hiddenBrowserFetchRequests.nodeSeek!;
        await fireEvent(view.getByTestId('hidden-browser'), 'message', {
          nativeEvent: {
            url: request.url,
            data: JSON.stringify({ type: 'nodeseek-browser-fetch', id: request.id, url: request.url, html })
          }
        });
      };
      try {
        await fireEvent(firstDocument, 'httpError', { nativeEvent: { url: urls[0], statusCode: initialStatus } });
        // A new main document succeeds after the site's security page redirects.
        await fireEvent(firstDocument, 'loadStart', { nativeEvent: { url: urls[0] } });
        await postDocument('<article class="post-content">recovered document</article>');
        const recovered = await responses[0]!;
        expect(recovered.status).toBe(200);
        await expect(recovered.text()).resolves.toContain('recovered document');

        await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(urls[1]));
        await view.rerender(host());
        const currentDocument = view.getByTestId('hidden-browser');
        await fireEvent(currentDocument, 'loadStart', { nativeEvent: { url: urls[1] } });
        await fireEvent(currentDocument, 'httpError', {
          nativeEvent: { url: urls[1], statusCode: initialStatus }
        });
        await act(async () => {
          oldLoadStart?.({ nativeEvent: { url: urls[0] } });
          oldHttpError({ nativeEvent: { url: urls[0], statusCode: initialStatus === 403 ? 404 : 403 } });
        });
        await postDocument('<main>still unavailable</main>');
        const unavailable = await responses[1]!;
        expect(unavailable.status).toBe(initialStatus);
        await expect(unavailable.text()).resolves.toContain('still unavailable');
      } finally {
        await act(async () => {
          controllers.forEach((controller) => controller.abort());
          await Promise.allSettled(responses);
        });
        await view.unmount();
        await bridge.unmount();
        await hook.unmount();
      }
    }
  );

  it('drains repeated two-site browser bursts by priority without timing out queued or canceled work', async () => {
    jest.useFakeTimers();
    const defaultFetcher = jest.fn<typeof fetch>(
      async () => new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } })
    );
    const hook = await renderSessionController(defaultFetcher);
    const sources = ['nodeseek', 'linuxdo'] as const;
    const controllers: AbortController[] = [];
    let requests: Promise<string | Error>[] = [];
    const active = (source: (typeof sources)[number]) =>
      hook.result.current.hiddenBrowserFetchRequests[source === 'nodeseek' ? 'nodeSeek' : 'linuxDo'];
    const complete = async (source: (typeof sources)[number], request: { id: number; url: string }) => {
      if (source === 'nodeseek') {
        await hook.result.current.completeNodeSeekBrowserFetch({ ...request, html: `done:${request.url}` });
      } else {
        await hook.result.current.completeLinuxDoBrowserFetch({ ...request, body: `done:${request.url}` });
      }
    };
    await act(async () => jest.advanceTimersByTimeAsync(0));
    const initialTimers = jest.getTimerCount();
    try {
      for (let round = 0; round < 3; round++) {
        const work = sources.flatMap((source) =>
          [
            { label: 'held', priority: 'background' as BrowserFetchPriority, canceled: false },
            ...(['background', 'foreground', 'write'] as const).flatMap((priority) =>
              Array.from({ length: 8 }, (_, index) => ({
                label: `${priority}-${index}`,
                priority,
                canceled: index === 3
              }))
            )
          ].map((entry) => {
            const controller = new AbortController();
            controllers.push(controller);
            return {
              ...entry,
              source,
              controller,
              url: `${source === 'nodeseek' ? 'https://www.nodeseek.com' : 'https://linux.do'}/?pressure=${round}-${entry.label}`
            };
          })
        );
        await act(async () => {
          requests = work.map(({ url, controller, priority }) =>
            hook.result.current
              .forumFetchWithWebViewFallback(
                url,
                withBrowserFetchIntent(
                  { signal: controller.signal },
                  { owner: priority === 'write' ? 'write' : 'topic', priority }
                )
              )
              .then((response) => response.text())
              .catch((error: Error) => error)
          );
        });
        await waitFor(() => {
          sources.forEach((source) =>
            expect(active(source)?.url).toBe(work.find((entry) => entry.source === source)!.url)
          );
        });
        await act(async () => jest.advanceTimersByTimeAsync(0));
        const first = sources.map((source) => ({ ...active(source)! }));
        expect(jest.getTimerCount()).toBe(initialTimers + 2);
        await act(async () => {
          jest.advanceTimersByTime(14_000);
          work.filter(({ canceled }) => canceled).forEach(({ controller }) => controller.abort());
        });
        sources.forEach((source, index) => expect(active(source)?.id).toBe(first[index].id));
        await act(async () => {
          for (const [index, source] of sources.entries()) await complete(source, first[index]);
          jest.advanceTimersByTime(1_001);
        });
        // The first queued request gets its own 15-second deadline, not the first request's age.
        await act(async () => jest.advanceTimersByTimeAsync(0));
        expect(jest.getTimerCount()).toBe(initialTimers + 2);
        for (const priority of ['write', 'foreground', 'background'] as const) {
          for (let index = 0; index < 8; index++) {
            if (index === 3) continue;
            for (const source of sources) {
              const expected = work.find((entry) => entry.source === source && entry.label === `${priority}-${index}`)!;
              expect(active(source)?.url).toBe(expected.url);
            }
            await act(async () => {
              for (const [siteIndex, source] of sources.entries()) {
                await complete(source, first[siteIndex]);
                await complete(source, active(source)!);
              }
            });
          }
        }
        expect(hook.result.current.hiddenBrowserFetchRequests).toEqual({ linuxDo: null, nodeSeek: null });
        expect(await Promise.all(requests)).toEqual(
          work.map(({ canceled, url }) => (canceled ? expect.any(Error) : `done:${url}`))
        );
        expect(defaultFetcher).toHaveBeenCalledTimes((round + 1) * 50);
        await act(async () => jest.advanceTimersByTimeAsync(0));
        expect(jest.getTimerCount()).toBe(initialTimers);
      }
    } finally {
      await act(async () => controllers.forEach((controller) => controller.abort()));
      await Promise.all(requests);
      await hook.unmount();
      jest.useRealTimers();
    }
  });

  it('cancels active and queued Connect work at handoff without changing account identity', async () => {
    const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
    const hook = await renderSessionController(
      jest.fn(async () => new Response('{}')),
      onSiteSessionEvent
    );
    const epoch = hook.result.current.forumSessionEpochs.linuxdo;
    let requests!: Promise<Response | Error>[];
    await act(async () => {
      requests = [0, 1].map(() =>
        hook.result.current
          .forumFetchWithWebViewFallback('https://connect.linux.do/', withLinuxDoConnectSessionRecoveryIntent({}))
          .catch((error: Error) => error)
      );
    });
    await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.linuxDo).not.toBeNull());
    const oldId = hook.result.current.hiddenBrowserFetchRequests.linuxDo!.id;
    await act(async () => {
      hook.result.current.cancelLinuxDoBrowserHandoff();
      const results = await Promise.all(requests);
      expect(results.every((result) => result instanceof Error)).toBe(true);
      await hook.result.current.completeLinuxDoBrowserFetch({
        id: oldId,
        url: 'https://connect.linux.do/',
        body: '<html>old identity</html>'
      });
    });
    expect(hook.result.current.hiddenBrowserFetchRequests.linuxDo).toBeNull();
    expect(hook.result.current.forumSessionEpochs.linuxdo).toBe(epoch);
    expect(onSiteSessionEvent).not.toHaveBeenCalled();
  });

  it('wires a parsed fallback to the generation captured before HiddenBrowserHost starts', async () => {
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
    'publishes an authoritative %s clear without owning the account transition',
    async (source) => {
      const clearManagedLoginCookies = jest.fn(async () => true);
      NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies };
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

      expect(clearManagedLoginCookies).toHaveBeenCalledWith(source, {
        appSessionId: expect.stringMatching(/^session-/),
        traceId: expect.stringMatching(/^trace-/)
      });
      expect(onSiteSessionEvent).toHaveBeenCalledWith({ site: source, type: 'cleared' });
      expect(hook.result.current.forumSessionEpochs[source]).toBe(initialForumSessionEpochs[source]);
    }
  );

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)('keeps a failed %s clear non-terminal', async (source) => {
    NativeModules.NetworkProxyModule = {
      ...NativeModules.NetworkProxyModule,
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
      await expect(
        hook.result.current[
          source === 'nodeseek'
            ? 'clearNodeSeekLoginState'
            : source === 'linuxdo'
              ? 'clearLinuxDoLoginState'
              : 'clearYaohuoLoginState'
        ]()
      ).rejects.toThrow('native clear failed');
    });

    expect(onSiteSessionEvent).toHaveBeenCalledWith(expect.objectContaining({ site: source, type: 'check-failed' }));
    expect(onSiteSessionEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ site: source, type: expect.stringMatching(/^(?:cleared|login-expired)$/) })
    );
  });

  it('publishes no terminal event for a stale clear', async () => {
    const firstNativeClear = Promise.withResolvers<boolean>();
    const clearManagedLoginCookies = jest
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(async () => firstNativeClear.promise)
      .mockResolvedValueOnce(true);
    NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies };
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

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'does not publish a %s clear after identity changes during legacy cleanup',
    async (source) => {
      NativeModules.NetworkProxyModule = {
        ...NativeModules.NetworkProxyModule,
        clearManagedLoginCookies: jest.fn(async () => true)
      };
      const cleanup = Promise.withResolvers<void>();
      jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(() => cleanup.promise);
      const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
      const hook = await renderSessionController(
        jest.fn(async () => new Response('{}')),
        onSiteSessionEvent
      );
      const clear =
        source === 'nodeseek'
          ? hook.result.current.clearNodeSeekLoginState
          : source === 'linuxdo'
            ? hook.result.current.clearLinuxDoLoginState
            : hook.result.current.clearYaohuoLoginState;
      let clearing: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        clearing = clear();
      });
      await waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalled());
      await act(async () => {
        hook.result.current.commitAccountStatusChange(source);
        cleanup.resolve();
        await expect(clearing).resolves.toBe(false);
      });
      expect(onSiteSessionEvent).not.toHaveBeenCalled();
    }
  );

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'ignores a late %s native clear failure after identity changes',
    async (source) => {
      const native = Promise.withResolvers<boolean>();
      const nativeClear = jest.fn(() => native.promise);
      NativeModules.NetworkProxyModule = { ...NativeModules.NetworkProxyModule, clearManagedLoginCookies: nativeClear };
      const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
      const hook = await renderSessionController(
        jest.fn(async () => new Response('{}')),
        onSiteSessionEvent
      );
      const clear =
        source === 'nodeseek'
          ? hook.result.current.clearNodeSeekLoginState
          : source === 'linuxdo'
            ? hook.result.current.clearLinuxDoLoginState
            : hook.result.current.clearYaohuoLoginState;
      let clearing: Promise<boolean | Error> = Promise.resolve(false);
      await act(async () => {
        clearing = clear().catch((error: Error) => error);
      });
      await waitFor(() => expect(nativeClear).toHaveBeenCalledTimes(1));
      await act(async () => {
        hook.result.current.commitAccountStatusChange(source);
        native.reject(new Error('late native failure'));
        await expect(clearing).resolves.toBe(false);
      });
      expect(onSiteSessionEvent).not.toHaveBeenCalled();
    }
  );

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'lets only the latest %s clear publish while the earlier legacy cleanup finishes',
    async (source) => {
      NativeModules.NetworkProxyModule = {
        ...NativeModules.NetworkProxyModule,
        clearManagedLoginCookies: jest.fn(async () => true)
      };
      const cleanup = Promise.withResolvers<void>();
      jest.mocked(SecureStore.deleteItemAsync).mockImplementationOnce(() => cleanup.promise);
      const onSiteSessionEvent = jest.fn<(event: ScopedSiteSessionEvent) => void>();
      const hook = await renderSessionController(
        jest.fn(async () => new Response('{}')),
        onSiteSessionEvent
      );
      const clear =
        source === 'nodeseek'
          ? hook.result.current.clearNodeSeekLoginState
          : source === 'linuxdo'
            ? hook.result.current.clearLinuxDoLoginState
            : hook.result.current.clearYaohuoLoginState;
      let clearing: Promise<boolean> = Promise.resolve(false);
      await act(async () => {
        clearing = clear();
      });
      await waitFor(() => expect(SecureStore.deleteItemAsync).toHaveBeenCalled());
      await act(async () => {
        await expect(clear()).resolves.toBe(true);
        cleanup.resolve();
        await expect(clearing).resolves.toBe(false);
      });
      expect(onSiteSessionEvent.mock.calls).toEqual([[{ site: source, type: 'cleared' }]]);
    }
  );
});
