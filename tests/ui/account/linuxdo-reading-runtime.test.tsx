import { describe, expect, it, jest } from '@jest/globals';
import { useLayoutEffect } from 'react';
import { act } from '@testing-library/react-native';
import { createRoot } from 'test-renderer';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useLinuxDoReadingRuntime } from '@/features/account/useLinuxDoReadingRuntime';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import type { Fetcher } from '@/platform/network/request';

const csrfResponse = () =>
  new Response(JSON.stringify({ csrf: 'local-fixture-token' }), { headers: { 'content-type': 'application/json' } });

function readingHarness(fetcher: Fetcher, strict = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const clients = new Set([queryClient]);
  const root = createRoot({ isStrictMode: strict });
  const snapshot: SessionRuntimeSnapshot = {
    source: 'linuxdo',
    authenticated: true,
    authSurfaceOpen: false,
    identityKey: 'local-reader',
    identityTrust: 'confirmed',
    sessionEpoch: 7,
    sourceEnabled: true
  };
  type Options = Parameters<typeof useLinuxDoReadingRuntime>[0];
  const onSessionExpired = jest.fn<Options['onSessionExpired']>();
  const requestAccountRecheck = jest.fn<Options['requestAccountRecheck']>();
  const requestVerification = jest.fn<Options['requestVerification']>();
  let current: ReturnType<typeof useLinuxDoReadingRuntime> | undefined;
  const committed: { client: QueryClient; runtime: ReturnType<typeof useLinuxDoReadingRuntime> }[] = [];
  let setups = 0;
  function Harness({ appActive, verificationVisible }: { appActive: boolean; verificationVisible: boolean }) {
    const client = useQueryClient();
    const runtime = useLinuxDoReadingRuntime({
      appActive,
      verificationVisible,
      fetcher,
      snapshot: () => snapshot,
      userAgent: () => 'local-fixture-agent',
      onSessionExpired,
      requestAccountRecheck,
      requestVerification
    });
    useLayoutEffect(() => {
      setups += 1;
    }, []);
    useLayoutEffect(() => {
      current = runtime;
      committed.push({ client, runtime });
    });
    return null;
  }
  return {
    root,
    snapshot,
    onSessionExpired,
    requestAccountRecheck,
    requestVerification,
    setups: () => setups,
    committedFor: (client: QueryClient) =>
      committed.filter((value) => value.client === client).map((value) => value.runtime),
    runtime() {
      if (!current) throw new Error('Expected committed reading runtime');
      return current;
    },
    async render({ appActive = true, verificationVisible = false, client = queryClient } = {}) {
      clients.add(client);
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Harness appActive={appActive} verificationVisible={verificationVisible} />
          </QueryClientProvider>
        )
      );
    },
    async unmount() {
      await act(async () => root.unmount());
      for (const client of clients) client.clear();
    }
  };
}

const advance = async (milliseconds: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};

describe('LinuxDo reading runtime owned lifetime', () => {
  it.each([false, true])('records the current displayed floor after effect setup strict=%s', async (strict) => {
    const fetcher = jest.fn<Fetcher>(async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/session/csrf') return csrfResponse();
      if (pathname === '/topics/timings') return new Response('');
      throw new Error('Unexpected fixture request: ' + pathname);
    });
    const view = readingHarness(fetcher, strict);
    try {
      await view.render();
      expect(view.setups()).toBe(strict ? 2 : 1);
      const runtime = view.runtime();
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      const session = runtime.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      expect({
        floorRead: runtime.state()['12']?.readPosts[1],
        requests: fetcher.mock.calls.map(([url]) => new URL(url).pathname)
      }).toEqual({ floorRead: true, requests: ['/session/csrf', '/topics/timings'] });
      session.end();
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  });

  it('retains the current runtime through gate changes and retires it when the Query owner changes', async () => {
    const fetcher = jest.fn<Fetcher>(async (url) =>
      new URL(url).pathname === '/session/csrf' ? csrfResponse() : new Response('')
    );
    const view = readingHarness(fetcher);
    try {
      await view.render();
      const runtime = view.runtime();
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      const session = runtime.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      session.visible([2]);
      await view.render({ verificationVisible: true });
      expect(view.runtime()).toBe(runtime);
      await advance(2000);
      expect(runtime.state()['12'].readPosts[2]).toBeUndefined();
      await view.render({ appActive: false });
      expect(view.runtime()).toBe(runtime);
      await advance(2000);
      await view.render();
      expect(view.runtime()).toBe(runtime);
      await advance(1000);
      expect(runtime.state()['12'].readPosts[2]).toBe(true);
      const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
      await view.render({ client });
      const replacement = view.runtime();
      expect(replacement).not.toBe(runtime);
      expect(new Set(view.committedFor(client))).toEqual(new Set([replacement]));
      session.visible([3]);
      const next = replacement.begin('12');
      next.visible([4]);
      next.active(true);
      await advance(1000);
      expect(replacement.state()['12'].readPosts[3]).toBeUndefined();
      expect(replacement.state()['12'].readPosts[4]).toBe(true);
      next.end();
    } finally {
      await view.unmount();
      jest.useRealTimers();
    }
  });

  it.each<[number, boolean]>([
    [401, false],
    [401, true],
    [403, true]
  ])(
    'ignores a retired response body with status %s and challenge=%s while the current owner still reports it',
    async (status, challenge) => {
      const makeResponse = () =>
        new Response(challenge ? '<title>Just a moment...</title>' : '', {
          status,
          headers: { 'content-type': challenge ? 'text/html' : 'application/json' }
        });
      const held = Promise.withResolvers<string>();
      const response = makeResponse();
      const text = jest.spyOn(response, 'text').mockImplementation(() => held.promise);
      const fetcher = jest.fn<Fetcher>(async () => response);
      const retired = readingHarness(fetcher);
      let unmounted = false;
      try {
        await retired.render();
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
        const session = retired.runtime().begin('12');
        session.visible([1]);
        session.active(true);
        await advance(1000);
        expect(text).toHaveBeenCalledTimes(1);
        await retired.unmount();
        unmounted = true;
        expect(jest.getTimerCount()).toBe(0);
        held.resolve(challenge ? '<title>Just a moment...</title>' : '{}');
        await advance(1000);
        expect(retired.onSessionExpired).not.toHaveBeenCalled();
        expect(retired.requestAccountRecheck).not.toHaveBeenCalled();
        expect(retired.requestVerification).not.toHaveBeenCalled();
      } finally {
        if (!unmounted) await retired.unmount();
        jest.useRealTimers();
      }
      const current = readingHarness(async () => makeResponse());
      try {
        await current.render();
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
        const session = current.runtime().begin('12');
        session.visible([1]);
        session.active(true);
        await advance(1000);
        expect(current.onSessionExpired).toHaveBeenCalledTimes(challenge ? 0 : 1);
        expect(current.requestAccountRecheck).not.toHaveBeenCalled();
        expect(current.requestVerification).toHaveBeenCalledTimes(challenge ? 1 : 0);
      } finally {
        await current.unmount();
        jest.useRealTimers();
      }
    }
  );
});
