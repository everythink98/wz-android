import { useEffect } from 'react';
import { createRoot } from 'test-renderer';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor, type RenderHookResult } from '@testing-library/react-native';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { NetworkProxyProfile, NetworkProxyState } from '@/platform/network/networkProxy';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout, RequestCanceledError, withRequestBeforeSend } from '@/platform/network/request';
import { createAppQueryClient } from '@/platform/query/serverState';
import * as SecureStore from 'expo-secure-store';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { getLinuxDoCurrentUserIdentity } from '@/sources/linuxdo/account';
import { createLinuxDoReadingSender } from '@/sources/linuxdo/reading';
import { withLinuxDoPresence } from '@/sources/linuxdo/presence';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { AppState, NativeModules } from 'react-native';
import { linuxDoNotificationAdapter } from '@/sources/discourseNotifications';
import { createNotificationGateway } from '@/sources/notificationGateway';
import {
  beginAuthSurface,
  createAuthSurfaceRegistry,
  hasAuthSurfaceBarrierForSource
} from '@/domain/session/authSurfaceCoordinator';

const mockLoadNetworkProxyState = jest.fn<() => Promise<NetworkProxyState>>();
const mockSaveNetworkProxyState = jest.fn<(state: NetworkProxyState) => Promise<NetworkProxyState>>();
const mockApplyNetworkProxy = jest.fn<(profile: NetworkProxyProfile | null) => Promise<unknown>>();

jest.mock('expo-task-manager', () => ({ isTaskDefined: () => false, defineTask: jest.fn() }));
jest.mock('expo-background-task', () => ({ BackgroundTaskResult: { Failed: 'failed', Success: 'success' } }));
jest.mock('@/platform/storage/readerDataStore', () => ({ withReaderSettings: jest.fn() }));
jest.mock('@/platform/network/networkProxy', () => ({
  ...jest.requireActual<typeof import('@/platform/network/networkProxy')>('@/platform/network/networkProxy'),
  applyNetworkProxy: (profile: NetworkProxyProfile | null) => mockApplyNetworkProxy(profile),
  loadNetworkProxyState: () => mockLoadNetworkProxyState(),
  saveNetworkProxyState: (state: NetworkProxyState) => mockSaveNetworkProxyState(state)
}));

function restoreProxyFromNotificationTask() {
  const { runNotificationBackgroundTask } = jest.requireActual<typeof import('@/app/notificationBackgroundTask')>(
    '@/app/notificationBackgroundTask'
  );
  return runNotificationBackgroundTask(
    (task) => task(async () => createEmptyReaderData().settings),
    async ({ network }) => {
      await network.restoreProxy();
      return { status: 'success', delivered: 0, failedSources: 0, timedOut: false };
    }
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const profileA: NetworkProxyProfile = {
  id: 'proxy-a',
  name: 'A',
  protocol: 'http',
  host: 'a.proxy.example',
  port: 8080
};

const profileB: NetworkProxyProfile = {
  id: 'proxy-b',
  name: 'B',
  protocol: 'socks5',
  host: 'b.proxy.example',
  port: 1080
};

describe('network proxy controller', () => {
  it.each(['account', 'source'] as const)(
    'stops a private reply when %s access closes during proxy preparation',
    async (blockedBy) => {
      const loaded = deferred<NetworkProxyState>();
      const enteredProxy = deferred<void>();
      mockLoadNetworkProxyState.mockReturnValue(loaded.promise);
      const authSurfaces = createAuthSurfaceRegistry();
      const controller = new AbortController();
      const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () =>
        Response.json({ success: true })
      );
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
      let sourceEnabled = true;
      const gateway = createNotificationGateway({
        sourceAllowed: () => sourceEnabled,
        privateAccessAllowed: (source) => !hasAuthSurfaceBarrierForSource(authSurfaces, source),
        readAccess: async (source) => ({
          identityKey: `${source}:7`,
          userId: '7',
          fetcher: (input, init) => {
            enteredProxy.resolve();
            return hook.result.current.networkProxyFetcher(input, init);
          }
        })
      });
      const item = {
        source: 'nodeseek' as const,
        id: 'message:9',
        kind: 'private-message' as const,
        actor: { name: 'Bob' },
        title: 'Private message',
        createdAt: null,
        unread: false,
        target: { type: 'private-conversation' as const, conversationId: '9' }
      };
      try {
        const request = gateway.replyToConversation(item, 'fixture', 'nodeseek:7', controller.signal);
        const rejected = expect(request).rejects.toThrow(blockedBy === 'account' ? '账号状态已变化' : '内容源已停用');
        await enteredProxy.promise;
        if (blockedBy === 'account')
          beginAuthSurface(authSurfaces, {
            source: 'nodeseek',
            surface: 'nodeseek-login',
            identityKey: 'nodeseek:7',
            sessionEpoch: 1
          });
        else sourceEnabled = false;
        await act(async () => loaded.resolve({ enabled: false, activeId: null, profiles: [] }));
        await rejected;
        expect(controller.signal.aborted).toBe(false);
        expect(baseFetcher).not.toHaveBeenCalled();
      } finally {
        await act(async () => loaded.resolve({ enabled: false, activeId: null, profiles: [] }));
        await hook.unmount();
      }
    }
  );

  it('rechecks a write after proxy preparation and keeps its guard off the transport', async () => {
    const loaded = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockReturnValue(loaded.promise);
    let current = true;
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
    const send = withRequestBeforeSend(hook.result.current.networkProxyFetcher, () => {
      if (!current) throw new Error('stale ticket');
    });
    const request = send('https://linux.do/posts/1.json', { method: 'PUT', body: 'raw=fixture' });
    const failed = expect(request).rejects.toThrow('stale ticket');
    current = false;
    await act(async () => {
      loaded.resolve({ enabled: false, activeId: null, profiles: [] });
    });
    await failed;
    expect(baseFetcher).not.toHaveBeenCalled();
    current = true;
    await send('https://linux.do/posts/1.json', { method: 'PUT', body: 'raw=fixture' });
    expect(baseFetcher).toHaveBeenCalledTimes(1);
    const init = baseFetcher.mock.calls[0]?.[1];
    expect(Object.getOwnPropertySymbols(init ?? {}).map(String)).not.toContain('Symbol(wz.requestBeforeSend)');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadNetworkProxyState.mockResolvedValue({ enabled: false, activeId: null, profiles: [] });
    mockSaveNetworkProxyState.mockImplementation(async (state) => state);
    mockApplyNetworkProxy.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('marks foreground account checks and reading reports at the actual transport', async () => {
    const previousState = AppState.currentState;
    AppState.currentState = 'active';
    recordUserInteraction();
    const calls: { url: string; init?: RequestInit }[] = [];
    const actualFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/session/current.json'))
        return new Response(JSON.stringify({ current_user: { username: 'alice' } }));
      if (url.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'fixture' }));
      return new Response('');
    });
    try {
      const baseFetcher = withLinuxDoPresence((input, init) => fetch(input, init));
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
      const fetcher = hook.result.current.networkProxyFetcher;
      await getLinuxDoCurrentUserIdentity({ fetcher });
      const send = createLinuxDoReadingSender({ fetcher, scope: () => 'alice', userAgent: () => 'fixture' });
      await send({ topicId: '12', topicTime: 1000, timings: { 1: 1000 } }, 'alice', new AbortController().signal);
      expect(calls.map(({ url }) => new URL(url).pathname)).toEqual([
        '/session/current.json',
        '/session/csrf',
        '/topics/timings'
      ]);
      expect(calls.map(({ init }) => new Headers(init?.headers).get('Discourse-Present'))).toEqual([
        'true',
        'true',
        'true'
      ]);
      expect(calls[2].init?.body).toBe('topic_id=12&topic_time=1000&timings%5B1%5D=1000');
    } finally {
      actualFetch.mockRestore();
      AppState.currentState = previousState;
    }
  });

  it('uses the same presence rule for foreground notifications and omits it after backgrounding', async () => {
    const previousState = AppState.currentState;
    AppState.currentState = 'active';
    recordUserInteraction();
    const dispatch = jest.fn<import('@/platform/network/request').Fetcher>(
      async () => new Response(JSON.stringify({ notifications: [] }))
    );
    const baseFetcher = withLinuxDoPresence(dispatch);
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
    try {
      const access = { identityKey: 'linuxdo:42', userId: '42', fetcher: hook.result.current.networkProxyFetcher };
      await linuxDoNotificationAdapter.listPage(access);
      AppState.currentState = 'background';
      await linuxDoNotificationAdapter.listPage(access);
      expect(dispatch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/notifications', '/notifications']);
      expect(dispatch.mock.calls.map(([, init]) => new Headers(init?.headers).get('Discourse-Present'))).toEqual([
        'true',
        null
      ]);
    } finally {
      AppState.currentState = previousState;
    }
  });

  it('decides presence after an already pending proxy setup completes', async () => {
    const previousState = AppState.currentState;
    AppState.currentState = 'active';
    recordUserInteraction();
    const load = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockImplementationOnce(() => load.promise);
    const dispatch = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    const baseFetcher = withLinuxDoPresence(dispatch);
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
    try {
      const pending = hook.result.current.networkProxyFetcher('https://linux.do/latest.json', {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Discourse-Present': 'true' }
      });
      expect(dispatch).not.toHaveBeenCalled();
      AppState.currentState = 'background';
      await act(async () => {
        load.resolve({ enabled: false, activeId: null, profiles: [] });
        await pending;
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(new Headers(dispatch.mock.calls[0][1]?.headers).has('Discourse-Present')).toBe(false);
    } finally {
      AppState.currentState = previousState;
    }
  });

  it.each(['reset', 'add'] as const)(
    'preserves saved profiles when storage is readable again and the user chooses %s',
    async (action) => {
      let persisted: NetworkProxyState = { enabled: true, activeId: profileA.id, profiles: [profileA] };
      mockLoadNetworkProxyState
        .mockRejectedValueOnce(new Error('temporarily unavailable'))
        .mockImplementation(async () => persisted);
      mockSaveNetworkProxyState.mockImplementation(async (state) => {
        persisted = state;
        return state;
      });
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
      await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));
      await expect(hook.result.current.ensureNetworkProxyReady()).rejects.toThrow('代理配置读取失败');

      await act(async () => {
        if (action === 'reset') await hook.result.current.setProxyEnabled(false);
        else await hook.result.current.upsertProxyProfile(profileB);
      });

      expect(persisted).toEqual({
        enabled: action === 'add',
        activeId: profileA.id,
        profiles: action === 'add' ? [profileA, profileB] : [profileA]
      });
      expect(mockLoadNetworkProxyState).toHaveBeenCalledTimes(2);
      expect(mockApplyNetworkProxy.mock.calls).toEqual([[action === 'add' ? profileA : null]]);
      await expect(hook.result.current.ensureNetworkProxyReady()).resolves.toBeUndefined();
    }
  );

  it('uses the active App proxy when the background notification task runs in the same bridge', async () => {
    mockLoadNetworkProxyState.mockResolvedValueOnce({ enabled: true, activeId: profileA.id, profiles: [profileA] });
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));

    await expect(restoreProxyFromNotificationTask()).resolves.toBe('success');

    expect(mockLoadNetworkProxyState).toHaveBeenCalledTimes(1);
    expect(mockApplyNetworkProxy.mock.calls).toEqual([[profileA]]);
  });

  it('restores the saved proxy for a cold notification task without an App owner', async () => {
    mockLoadNetworkProxyState.mockResolvedValueOnce({ enabled: true, activeId: profileA.id, profiles: [profileA] });

    await expect(restoreProxyFromNotificationTask()).resolves.toBe('success');

    expect(mockLoadNetworkProxyState).toHaveBeenCalledTimes(1);
    expect(mockApplyNetworkProxy.mock.calls).toEqual([[profileA]]);
  });

  it.each(['mounted', 'retired'] as const)(
    'does not apply a stale headless snapshot when a %s App has already applied a new profile',
    async (owner) => {
      const previous = { enabled: false, activeId: profileA.id, profiles: [profileA] };
      const started = Promise.withResolvers<void>();
      const saved = Promise.withResolvers<NetworkProxyState>();
      mockLoadNetworkProxyState
        .mockImplementationOnce(() => {
          started.resolve();
          return saved.promise;
        })
        .mockResolvedValue(previous);
      const run = restoreProxyFromNotificationTask();
      await started.promise;
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
      try {
        await waitFor(() => expect(hook.result.current.applyStatus).toBe('disabled'));
        await act(() => hook.result.current.setProxyEnabled(true));
        expect(mockSaveNetworkProxyState).toHaveBeenCalledWith({ ...previous, enabled: true });
        expect(hook.result.current.applyStatus).toBe('applied');
        if (owner === 'retired') await hook.unmount();

        const settled =
          owner === 'retired' ? expect(run).rejects.toThrow('代理运行时已变化') : expect(run).resolves.toBe('success');
        saved.resolve(previous);
        await settled;
        expect(mockApplyNetworkProxy.mock.calls).toEqual([[null], [profileA]]);
      } finally {
        saved.resolve(previous);
        await run.catch(() => undefined);
      }
    }
  );

  it.each(['headless', 'mounted'] as const)(
    'keeps a %s notification task blocked after a proxy storage failure',
    async (owner) => {
      mockLoadNetworkProxyState.mockRejectedValueOnce(new Error('temporarily unavailable'));
      if (owner === 'mounted') {
        const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
        await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));
      }

      await expect(restoreProxyFromNotificationTask()).rejects.toThrow(
        owner === 'headless' ? 'temporarily unavailable' : '代理配置读取失败'
      );
      expect(mockLoadNetworkProxyState).toHaveBeenCalledTimes(1);
      expect(mockApplyNetworkProxy).not.toHaveBeenCalled();
    }
  );

  it('keeps storage untouched and networking blocked while a saved configuration is still unavailable', async () => {
    mockLoadNetworkProxyState.mockRejectedValue(new Error('temporarily unavailable'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));

    await act(async () => {
      await expect(hook.result.current.upsertProxyProfile(profileA)).rejects.toThrow('temporarily unavailable');
      await expect(hook.result.current.setProxyEnabled(false)).rejects.toThrow('temporarily unavailable');
    });

    expect(mockSaveNetworkProxyState).not.toHaveBeenCalled();
    expect(mockApplyNetworkProxy).not.toHaveBeenCalled();
    await expect(hook.result.current.ensureNetworkProxyReady()).rejects.toThrow('代理配置读取失败');
  });

  it('requires an explicit reset before replacing a confirmed damaged proxy configuration', async () => {
    const actual = jest.requireActual<typeof import('@/platform/network/networkProxy')>(
      '@/platform/network/networkProxy'
    );
    const read = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue('{broken');
    mockLoadNetworkProxyState.mockImplementation(actual.loadNetworkProxyState);
    const notify = jest.fn();
    try {
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
      await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));
      await expect(hook.result.current.ensureNetworkProxyReady()).rejects.toThrow('代理配置读取失败');
      expect(notify).toHaveBeenCalledWith(expect.stringContaining('代理配置读取失败'));

      await act(async () => {
        await expect(hook.result.current.upsertProxyProfile(profileA)).rejects.toThrow('代理配置已损坏');
      });
      expect(mockSaveNetworkProxyState).not.toHaveBeenCalled();
      expect(mockApplyNetworkProxy).not.toHaveBeenCalled();

      await act(async () => {
        await hook.result.current.setProxyEnabled(false);
      });

      expect(mockSaveNetworkProxyState).toHaveBeenCalledWith({
        enabled: false,
        activeId: null,
        profiles: []
      });
      expect(mockApplyNetworkProxy).toHaveBeenCalledWith(null);
      expect(hook.result.current.applyStatus).toBe('disabled');
      await expect(hook.result.current.ensureNetworkProxyReady()).resolves.toBeUndefined();
    } finally {
      read.mockRestore();
    }
  });

  it('blocks transport and native direct apply when the persisted active proxy is missing', async () => {
    const actual = jest.requireActual<typeof import('@/platform/network/networkProxy')>(
      '@/platform/network/networkProxy'
    );
    const stored = jest
      .spyOn(SecureStore, 'getItemAsync')
      .mockResolvedValueOnce(JSON.stringify({ enabled: true, activeId: 'lost', profiles: [] }));
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    mockLoadNetworkProxyState.mockImplementationOnce(actual.loadNetworkProxyState);
    try {
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
      await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));
      await expect(hook.result.current.networkProxyFetcher('https://example.invalid/private')).rejects.toThrow(
        '代理配置读取失败'
      );
      expect(mockApplyNetworkProxy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      stored.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it('releases an already-waiting request fail-closed when the saved proxy read times out', async () => {
    jest.useFakeTimers();
    const load = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockImplementationOnce(() => load.promise);
    const notify = jest.fn();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));

    try {
      const request = expect(hook.result.current.networkProxyFetcher('https://example.com/private')).rejects.toThrow(
        '超时'
      );
      expect(hook.result.current.loaded).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(3_000);
      });

      await request;
      expect(hook.result.current.loaded).toBe(true);
      expect(hook.result.current.applyStatus).toBe('failed');
      expect(fetchSpy).not.toHaveBeenCalled();

      await act(async () => {
        await hook.result.current.setProxyEnabled(false);
      });
      expect(hook.result.current.applyStatus).toBe('disabled');

      load.resolve({ enabled: true, activeId: profileA.id, profiles: [profileA] });
      await act(async () => {
        await Promise.resolve();
      });
      expect(hook.result.current.proxyState).toEqual({ enabled: false, activeId: null, profiles: [] });
      expect(hook.result.current.applyStatus).toBe('disabled');
    } finally {
      load.resolve({ enabled: false, activeId: null, profiles: [] });
      fetchSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('releases a waiting request when its proxy runtime unmounts before storage settles', async () => {
    jest.useFakeTimers();
    const load = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockImplementationOnce(() => load.promise);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    let settled = false;

    try {
      void hook.result.current.networkProxyFetcher('https://example.com/private').then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await hook.unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3_000);
      });

      expect(settled).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      load.resolve({ enabled: false, activeId: null, profiles: [] });
      fetchSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('rejects a waiting request when storage resolves after its proxy runtime unmounts', async () => {
    const load = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockImplementationOnce(() => load.promise);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    const request = hook.result.current.networkProxyFetcher('https://example.com/private');
    const rejection = expect(request).rejects.toThrow('代理运行时已结束');

    try {
      await hook.unmount();
      load.resolve({ enabled: false, activeId: null, profiles: [] });

      await rejection;
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      load.resolve({ enabled: false, activeId: null, profiles: [] });
      fetchSpy.mockRestore();
    }
  });

  it('keeps a slow native startup apply authoritative and serializes a newer reset behind it', async () => {
    jest.useFakeTimers();
    const startupApply = deferred<unknown>();
    mockLoadNetworkProxyState.mockResolvedValueOnce({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA]
    });
    mockApplyNetworkProxy.mockImplementationOnce(() => startupApply.promise);
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));

    try {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(hook.result.current.applyStatus).toBe('applying');

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      expect(hook.result.current.applyStatus).toBe('applying');

      let reset!: Promise<void>;
      await act(async () => {
        reset = hook.result.current.setProxyEnabled(false);
        await Promise.resolve();
      });
      expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);

      await act(async () => {
        startupApply.resolve({ ok: true });
        await reset;
      });
      expect(mockApplyNetworkProxy.mock.calls.map(([profile]) => profile?.id || null)).toEqual([profileA.id, null]);
      expect(hook.result.current.proxyState.enabled).toBe(false);
      expect(hook.result.current.applyStatus).toBe('disabled');
    } finally {
      startupApply.resolve({ ok: true });
      jest.useRealTimers();
    }
  });

  it('ignores a late startup apply failure after the runtime unmounts', async () => {
    const startupApply = deferred<unknown>();
    mockLoadNetworkProxyState.mockResolvedValueOnce({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA]
    });
    mockApplyNetworkProxy.mockImplementationOnce(() => startupApply.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledWith(profileA));

    await hook.unmount();
    const rejection = expect(startupApply.promise).rejects.toThrow('late native failure');
    startupApply.reject(new Error('late native failure'));
    await rejection;
    await Promise.resolve();
    await Promise.resolve();

    expect(notify).not.toHaveBeenCalled();
  });

  it('serializes profile persistence and builds a later edit from the committed state', async () => {
    const firstSave = deferred<NetworkProxyState>();
    const secondSave = deferred<NetworkProxyState>();
    mockSaveNetworkProxyState
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    let firstTask!: Promise<void>;
    let secondTask!: Promise<void>;
    await act(async () => {
      firstTask = hook.result.current.upsertProxyProfile(profileA);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1));
    await act(async () => {
      secondTask = hook.result.current.upsertProxyProfile(profileB);
      await Promise.resolve();
    });

    expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1);
    const firstState = mockSaveNetworkProxyState.mock.calls[0]?.[0];
    expect(firstState?.profiles.map((profile) => profile.id)).toEqual(['proxy-a']);

    await act(async () => {
      firstSave.resolve(firstState!);
      await firstTask;
    });
    await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(2));
    const secondState = mockSaveNetworkProxyState.mock.calls[1]?.[0];
    expect(secondState?.profiles.map((profile) => profile.id)).toEqual(['proxy-a', 'proxy-b']);

    await act(async () => {
      secondSave.resolve(secondState!);
      await secondTask;
    });
    await waitFor(() => {
      expect(hook.result.current.proxyState.profiles.map((profile) => profile.id)).toEqual(['proxy-a', 'proxy-b']);
    });
  });

  it('rolls back a failed save before dispatching a queued edit from the retained state', async () => {
    const saving = deferred<NetworkProxyState>();
    const failure = new Error('controlled profile save failure');
    const events: string[] = [];
    mockLoadNetworkProxyState.mockResolvedValue({ enabled: true, activeId: profileA.id, profiles: [profileA] });
    mockSaveNetworkProxyState
      .mockImplementationOnce(() => {
        events.push('first:save');
        return saving.promise;
      })
      .mockImplementationOnce(async (state) => {
        events.push('second:save');
        return state;
      });
    setDiagnosticWriter((line) => {
      const event = JSON.parse(line);
      if (
        event.area === 'proxy' &&
        event.operation === 'save' &&
        event.phase === 'finish' &&
        event.outcome === 'failure'
      )
        events.push('rollback:finished');
    });
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
    let first!: Promise<void>;
    let observed!: Promise<unknown>;
    let second!: Promise<void>;
    await act(async () => {
      first = hook.result.current.upsertProxyProfile({ ...profileA, host: 'uncommitted.proxy.example' });
      observed = first.catch((error: unknown) => {
        events.push('first:rejected');
        queueMicrotask(() => events.push('observer:microtask'));
        return error;
      });
      second = hook.result.current.upsertProxyProfile(profileB);
    });
    await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1));
    await act(async () => {
      saving.reject(failure);
      await expect(observed).resolves.toBe(failure);
      await second;
    });

    expect(events).toEqual(['first:save', 'rollback:finished', 'first:rejected', 'observer:microtask', 'second:save']);
    const committed = mockSaveNetworkProxyState.mock.calls[1]?.[0];
    expect(committed?.profiles).toEqual([profileA, profileB]);
    expect(hook.result.current.proxyState).toEqual(committed);
    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.applyStatus).toBe('applied');
  });

  it.each(['success', 'failure'])(
    'waits for an older native apply before applying the newly selected profile (older result: %s)',
    async (olderResult) => {
      const firstApply = deferred<unknown>();
      const secondApply = deferred<unknown>();
      mockLoadNetworkProxyState.mockResolvedValue({
        enabled: true,
        activeId: profileA.id,
        profiles: [profileA, profileB]
      });
      mockApplyNetworkProxy
        .mockResolvedValueOnce({ ok: true })
        .mockImplementationOnce(() => firstApply.promise)
        .mockImplementationOnce(() => secondApply.promise);
      const notify = jest.fn();
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
      let editing: Promise<unknown> | undefined;
      let selection: Promise<void> | undefined;
      try {
        await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
        await act(async () => {
          editing = hook.result.current
            .upsertProxyProfile({ ...profileA, host: 'older.proxy.example' })
            .catch((error: unknown) => error);
        });
        await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(2));
        await act(async () => {
          selection = hook.result.current.selectProxyProfile(profileB.id);
        });
        await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(2));
        expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(2);
        await act(async () => {
          if (olderResult === 'success') firstApply.resolve({ ok: true });
          else firstApply.reject(new Error('superseded native apply failure'));
          await editing;
        });
        await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(3));
        expect(mockApplyNetworkProxy.mock.calls[2]?.[0]?.id).toBe(profileB.id);
        const pendingApply = {
          status: hook.result.current.applyStatus,
          error: hook.result.current.applyError,
          loaded: hook.result.current.loaded
        };

        await act(async () => {
          secondApply.resolve({ ok: true });
          await selection;
        });
        expect(pendingApply).toEqual({ status: 'applying', error: '', loaded: true });
        await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
        expect(notify).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          firstApply.resolve({ ok: true });
          secondApply.resolve({ ok: true });
          await Promise.allSettled([editing, selection]);
        });
        await hook.unmount();
      }
    }
  );

  it('preserves the proxy readiness gate while using the read-only native cookie jar', async () => {
    const apply = deferred<unknown>();
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA]
    });
    mockApplyNetworkProxy.mockImplementationOnce(() => apply.promise);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledWith(profileA));

    const request = fetchWithTimeout(
      'https://example.com/private',
      {
        method: 'POST',
        credentials: 'include',
        headers: { Cookie: 'session=explicit' },
        body: 'payload'
      },
      {
        fetcher: hook.result.current.networkProxyFetcher,
        timeoutMs: 0
      }
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      apply.resolve({ ok: true });
      await request;
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/private',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { Cookie: 'session=explicit' },
        body: 'payload',
        signal: expect.any(AbortSignal)
      })
    );
    fetchSpy.mockRestore();
  });

  it('classifies native content reads without exposing health probes to rotation cancellation', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    try {
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
      await waitFor(() => expect(hook.result.current.loaded).toBe(true));

      await hook.result.current.networkProxyFetcher(
        'https://www.nodeseek.com/post-1-1',
        withBrowserFetchIntent({}, { owner: 'topic', priority: 'foreground' })
      );
      await hook.result.current.networkProxyFetcher(
        'https://www.nodeseek.com/api/account/status',
        withBrowserFetchIntent({}, { owner: 'account', priority: 'background' })
      );

      const contentHeaders = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
      const healthHeaders = new Headers(fetchSpy.mock.calls[1]?.[1]?.headers);
      expect(contentHeaders.get('X-WZ-Forum-Read-Source')).toBe('nodeseek');
      expect(contentHeaders.get('X-WZ-Forum-Read-Cancel-Class')).toBe('content');
      expect(healthHeaders.get('X-WZ-Forum-Read-Source')).toBe('nodeseek');
      expect(healthHeaders.get('X-WZ-Forum-Read-Cancel-Class')).toBe('health');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does not apply a selected profile before its persistence succeeds', async () => {
    const save = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA, profileB]
    });
    mockSaveNetworkProxyState.mockImplementationOnce(() => save.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);

    let selection!: Promise<void>;
    await act(async () => {
      selection = hook.result.current.selectProxyProfile(profileB.id);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1));

    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);
    await act(async () => {
      save.reject(new Error('SecureStore write failed'));
      await expect(selection).rejects.toThrow('SecureStore write failed');
    });
    expect(hook.result.current.proxyState.activeId).toBe(profileA.id);
    expect(hook.result.current.applyStatus).toBe('applied');
    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);
  });

  it('keeps an enabled proxy usable when an unchanged profile is saved', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA]
    });
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));

    await act(async () => {
      await hook.result.current.upsertProxyProfile(profileA);
    });

    expect(hook.result.current.applyStatus).toBe('applied');
    await expect(hook.result.current.ensureNetworkProxyReady()).resolves.toBeUndefined();
    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);

    const loadEvents = lines.map((line) => JSON.parse(line)).filter((event) => event.operation === 'load');
    expect(loadEvents).toEqual([
      expect.objectContaining({ area: 'proxy', phase: 'intent' }),
      expect.objectContaining({ phase: 'persist', store: 'secure-store', hasProxy: true, isEnabled: true }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', hasProxy: true, isEnabled: true })
    ]);
    expect(lines.join('')).not.toMatch(/proxy-a|a\.proxy\.example|"A"|8080/);
  });

  it('does not restart an enabled proxy when only its saved name changes', async () => {
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA]
    });
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));

    await act(async () => {
      await hook.result.current.upsertProxyProfile({ ...profileA, name: 'Renamed' });
    });

    expect(mockSaveNetworkProxyState).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [expect.objectContaining({ id: profileA.id, name: 'Renamed' })]
      })
    );
    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);
    expect(hook.result.current.applyStatus).toBe('applied');
  });

  it('settles rapid enable then disable commands in order', async () => {
    const lines: string[] = [];
    const commandOrder: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
      const event = JSON.parse(line);
      if (event.operation === 'set-enabled' && event.phase === 'intent')
        commandOrder.push(event.isEnabled ? 'enable:start' : 'disable:start');
    });
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: false,
      activeId: null,
      profiles: []
    });
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('disabled'));
    await act(async () => {
      await hook.result.current.upsertProxyProfile(profileA);
    });

    let enable!: Promise<void>;
    let disable!: Promise<void>;
    let observed!: Promise<void>;
    await act(async () => {
      enable = hook.result.current.setProxyEnabled(true);
      observed = enable.then(() => {
        commandOrder.push('enable:done');
        queueMicrotask(() => commandOrder.push('observer:microtask'));
      });
      disable = hook.result.current.setProxyEnabled(false);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(3));
    await Promise.all([enable, disable, observed]);
    expect(commandOrder).toEqual(['enable:start', 'enable:done', 'observer:microtask', 'disable:start']);

    expect(hook.result.current.proxyState.enabled).toBe(false);
    expect(hook.result.current.applyStatus).toBe('disabled');
    expect(mockApplyNetworkProxy.mock.calls.map(([profile]) => profile?.id || null)).toEqual([null, profileA.id, null]);

    const events = lines.map((line) => JSON.parse(line));
    const enableTraceId = events.find(
      (event) => event.operation === 'set-enabled' && event.phase === 'intent' && event.isEnabled === true
    )?.traceId;
    const enableEvents = events.filter((event) => event.traceId === enableTraceId);
    const persistIndex = enableEvents.findIndex((event) => event.phase === 'persist');
    const nativeApplyIndex = enableEvents.findIndex(
      (event) => event.phase === 'apply' && event.channel === 'native' && event.state === 'start'
    );
    const finishIndex = enableEvents.findIndex((event) => event.phase === 'finish');
    expect(enableTraceId).toEqual(expect.any(String));
    expect(persistIndex).toBeLessThan(nativeApplyIndex);
    expect(nativeApplyIndex).toBeLessThan(finishIndex);
    expect(enableEvents[finishIndex]).toEqual(expect.objectContaining({ outcome: 'success', state: 'applied' }));
  });

  it('keeps failed native disable closed and permits a later enable retry', async () => {
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA]
    });
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
    mockApplyNetworkProxy.mockRejectedValueOnce(new Error('native disable failed'));

    await act(async () => {
      await expect(hook.result.current.setProxyEnabled(false)).rejects.toThrow('native disable failed');
    });

    expect(hook.result.current.proxyState.enabled).toBe(false);
    expect(hook.result.current.applyStatus).toBe('failed');
    await expect(hook.result.current.ensureNetworkProxyReady()).rejects.toThrow('native disable failed');
    await act(async () => {
      await hook.result.current.setProxyEnabled(true);
    });
    expect(hook.result.current.proxyState.enabled).toBe(true);
    expect(hook.result.current.applyStatus).toBe('applied');
    expect(mockApplyNetworkProxy).toHaveBeenLastCalledWith(profileA);
  });

  it.each(['success', 'failure'] as const)(
    'waits for a newer proxy disable after the previous apply completes with eventual %s',
    async (outcome) => {
      mockLoadNetworkProxyState.mockResolvedValue({
        enabled: true,
        activeId: profileA.id,
        profiles: [profileA, profileB]
      });
      const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
      const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
      await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
      const previousApply = deferred<unknown>();
      const latestApply = deferred<unknown>();
      mockApplyNetworkProxy.mockReturnValueOnce(previousApply.promise).mockReturnValueOnce(latestApply.promise);
      let selection: Promise<void> | undefined;
      let disable: Promise<void> | undefined;
      let request: Promise<Response> | undefined;
      let settled = false;
      try {
        await act(async () => {
          selection = hook.result.current.selectProxyProfile(profileB.id);
        });
        await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(2));
        request = hook.result.current.networkProxyFetcher('https://example.invalid/feed');
        void request.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          }
        );
        await act(async () => {
          disable = hook.result.current.setProxyEnabled(false);
          void disable.catch(() => undefined);
        });
        await waitFor(() => expect(hook.result.current.proxyState.enabled).toBe(false));
        await act(async () => previousApply.resolve({ ok: true }));
        await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(3));
        expect(settled).toBe(false);
        expect(baseFetcher).not.toHaveBeenCalled();
        if (outcome === 'failure') {
          await act(async () => latestApply.reject(new Error('latest apply failed')));
          await expect(request).rejects.toThrow('latest apply failed');
          await expect(disable).rejects.toThrow('latest apply failed');
          expect(baseFetcher).not.toHaveBeenCalled();
        } else {
          await act(async () => latestApply.resolve({ ok: true }));
          await expect(request).resolves.toBeInstanceOf(Response);
          await disable;
          expect(baseFetcher).toHaveBeenCalledTimes(1);
        }
      } finally {
        await act(async () => {
          previousApply.resolve({ ok: true });
          latestApply.resolve({ ok: true });
          await Promise.allSettled([selection, disable, request]);
        });
        await hook.unmount();
      }
    }
  );
});

describe('network proxy lifetime ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadNetworkProxyState.mockResolvedValue({ enabled: false, activeId: null, profiles: [] });
    mockSaveNetworkProxyState.mockImplementation(async (state) => state);
    mockApplyNetworkProxy.mockResolvedValue({ ok: true });
  });

  it('keeps one bootstrap read deadline when the current StrictMode observer adopts it', async () => {
    jest.useFakeTimers();
    const loading = deferred<NetworkProxyState>();
    mockLoadNetworkProxyState.mockReturnValue(loading.promise);
    const notify = jest.fn();
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    const requests: Promise<unknown>[] = [];
    const failures: unknown[] = [];
    function Harness() {
      const runtime = useNetworkProxyRuntime({ notify, baseFetcher });
      useEffect(() => {
        requests.push(
          runtime.networkProxyFetcher('https://example.invalid/owned').catch((error) => {
            failures.push(error);
          })
        );
      }, [runtime.networkProxyFetcher]);
      return null;
    }
    const root = createRoot({ isStrictMode: true });
    try {
      await act(() => root.render(<Harness />));
      expect(requests).toHaveLength(2);
      expect(mockLoadNetworkProxyState).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3_000);
        await Promise.allSettled(requests);
      });
      expect(failures).toHaveLength(2);
      expect(failures[0]).toMatchObject({ message: '代理运行时已结束' });
      expect(failures[1]).toMatchObject({ message: expect.stringContaining('代理配置读取超时') });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(mockApplyNetworkProxy).not.toHaveBeenCalled();
      expect(baseFetcher).not.toHaveBeenCalled();
    } finally {
      try {
        await act(async () => {
          loading.resolve({ enabled: false, activeId: null, profiles: [] });
          await Promise.allSettled(requests);
        });
        await act(() => root.unmount());
      } finally {
        jest.useRealTimers();
      }
    }
  });

  it.each([false, true])(
    'publishes a completed native probe only to its current observer (retired: %s)',
    async (retired) => {
      const probing = deferred<{ ok: boolean; latencyMs: number }>();
      const previousModule = NativeModules.NetworkProxyModule;
      const firstNotify = jest.fn();
      const currentNotify = jest.fn();
      const hook = await renderHook(
        ({ notify }: { notify: (message: string) => void }) => useNetworkProxyRuntime({ notify }),
        {
          initialProps: { notify: firstNotify }
        }
      );
      let task: Promise<unknown> | undefined;
      try {
        NativeModules.NetworkProxyModule = { ...previousModule, testProxy: () => probing.promise };
        await waitFor(() => expect(hook.result.current.applyStatus).toBe('disabled'));
        await act(async () => {
          task = hook.result.current.testProxyProfile(profileA);
        });
        await hook.rerender({ notify: currentNotify });
        if (retired) await hook.unmount();
        await act(async () => {
          probing.resolve({ ok: true, latencyMs: 42 });
          await Promise.allSettled([task]);
        });
        expect(firstNotify).not.toHaveBeenCalled();
        expect(currentNotify).toHaveBeenCalledTimes(retired ? 0 : 1);
        if (retired) await expect(task).rejects.toThrow('代理运行时已结束');
        else await expect(task).resolves.toMatchObject({ ok: true, latencyMs: 42 });
      } finally {
        try {
          await act(async () => {
            probing.resolve({ ok: true, latencyMs: 42 });
            await Promise.allSettled([task]);
          });
          await hook.unmount();
        } finally {
          NativeModules.NetworkProxyModule = previousModule;
        }
      }
    }
  );

  it('retires an owned waiter while the physical native startup apply is still pending', async () => {
    const applying = deferred<unknown>();
    mockLoadNetworkProxyState.mockResolvedValue({ enabled: true, activeId: profileA.id, profiles: [profileA] });
    mockApplyNetworkProxy.mockReturnValueOnce(applying.promise);
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
    let outcome = 'pending';
    let request: Promise<unknown> | undefined;
    try {
      await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1));
      request = hook.result.current.networkProxyFetcher('https://example.invalid/owned').then(
        () => {
          outcome = 'resolved';
        },
        () => {
          outcome = 'rejected';
        }
      );
      await hook.unmount();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(outcome).toBe('rejected');
      expect(baseFetcher).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        applying.resolve({ ok: true });
        await Promise.allSettled([request]);
      });
      await hook.unmount();
    }
  });

  it('binds the replayed effect waiter to its new storage and apply lifetime', async () => {
    const loading = deferred<NetworkProxyState>();
    const applying = deferred<unknown>();
    mockLoadNetworkProxyState.mockReturnValue(loading.promise);
    mockApplyNetworkProxy.mockReturnValue(applying.promise);
    const notify = jest.fn();
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    const outcomes: string[] = [];
    const requests: Promise<unknown>[] = [];
    function Harness() {
      const runtime = useNetworkProxyRuntime({ notify, baseFetcher });
      useEffect(() => {
        const index = outcomes.length;
        outcomes.push('pending');
        requests.push(
          runtime.networkProxyFetcher('https://example.invalid/owned').then(
            () => {
              outcomes[index] = 'resolved';
            },
            () => {
              outcomes[index] = 'rejected';
            }
          )
        );
      }, [runtime.networkProxyFetcher]);
      return null;
    }
    const root = createRoot({ isStrictMode: true });
    try {
      await act(() => root.render(<Harness />));
      expect(outcomes).toHaveLength(2);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(outcomes).toEqual(['rejected', 'pending']);
      expect(baseFetcher).not.toHaveBeenCalled();
      await act(async () => {
        loading.resolve({ enabled: false, activeId: null, profiles: [] });
      });
      await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1));
      expect(outcomes).toEqual(['rejected', 'pending']);
      expect(baseFetcher).not.toHaveBeenCalled();
      await act(async () => {
        applying.resolve({ ok: true });
        await requests[1];
      });
      expect(outcomes).toEqual(['rejected', 'resolved']);
      expect(baseFetcher).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        loading.resolve({ enabled: false, activeId: null, profiles: [] });
        applying.resolve({ ok: true });
        await Promise.allSettled(requests);
      });
      await act(() => root.unmount());
    }
  });

  it('does not enqueue native work from a durable save after its runtime is retired', async () => {
    const saving = deferred<NetworkProxyState>();
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    let task: Promise<void> | undefined;
    let savedState: NetworkProxyState | undefined;
    try {
      await waitFor(() => expect(hook.result.current.applyStatus).toBe('disabled'));
      mockSaveNetworkProxyState.mockReturnValueOnce(saving.promise);
      await act(async () => {
        task = hook.result.current.upsertProxyProfile(profileA);
      });
      await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1));
      const persisted = mockSaveNetworkProxyState.mock.calls[0][0];
      savedState = persisted;
      const appliedBeforeRetirement = mockApplyNetworkProxy.mock.calls.length;
      await hook.unmount();
      await act(async () => {
        saving.resolve(persisted);
        await Promise.allSettled([task]);
      });
      expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(appliedBeforeRetirement);
      expect(notify).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        saving.resolve(savedState ?? { enabled: false, activeId: null, profiles: [] });
        await Promise.allSettled([task]);
      });
      await hook.unmount();
    }
  });

  it.each(['success', 'failure'] as const)(
    'waits for an older runtime durable %s before authorizing its replacement',
    async (commitOutcome) => {
      let disk: NetworkProxyState = { enabled: true, activeId: profileA.id, profiles: [profileA, profileB] };
      const saving = deferred<NetworkProxyState>();
      mockLoadNetworkProxyState.mockImplementation(async () => disk);
      mockSaveNetworkProxyState.mockImplementationOnce(() =>
        saving.promise.then((state) => {
          disk = state;
          return state;
        })
      );
      const first = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
      const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
      let replacement: RenderHookResult<ReturnType<typeof useNetworkProxyRuntime>, void> | undefined;
      let task: Promise<void> | undefined;
      let request: Promise<unknown> | undefined;
      let persisted: NetworkProxyState | undefined;
      let outcome = 'pending';
      try {
        await waitFor(() => expect(first.result.current.applyStatus).toBe('applied'));
        await act(async () => {
          task = first.result.current.selectProxyProfile(profileB.id);
        });
        await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1));
        persisted = mockSaveNetworkProxyState.mock.calls[0][0];
        await first.unmount();
        replacement = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
        request = replacement.result.current.networkProxyFetcher('https://example.invalid/current').then(
          () => {
            outcome = 'resolved';
          },
          () => {
            outcome = 'rejected';
          }
        );
        await act(async () => {
          await Promise.resolve();
        });
        expect(outcome).toBe('pending');
        expect(baseFetcher).not.toHaveBeenCalled();
        const committed = persisted;
        await act(async () => {
          if (commitOutcome === 'success') saving.resolve(committed);
          else saving.reject(new Error('controlled durable write failure'));
          await Promise.allSettled([task, request]);
        });
        expect(replacement.result.current.proxyState.activeId).toBe(
          commitOutcome === 'success' ? profileB.id : profileA.id
        );
        expect(outcome).toBe('resolved');
        expect(baseFetcher).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => {
          saving.resolve(persisted ?? disk);
          await Promise.allSettled([task, request]);
        });
        await first.unmount();
        await replacement?.unmount();
      }
    }
  );

  it('does not dispatch a queued edit after its runtime retires during the preceding durable save', async () => {
    const saving = deferred<NetworkProxyState>();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    const tasks: Promise<void>[] = [];
    let persisted: NetworkProxyState | undefined;
    try {
      await waitFor(() => expect(hook.result.current.applyStatus).toBe('disabled'));
      mockSaveNetworkProxyState.mockReturnValueOnce(saving.promise);
      await act(async () => {
        tasks.push(hook.result.current.upsertProxyProfile(profileA));
      });
      await waitFor(() => expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1));
      persisted = mockSaveNetworkProxyState.mock.calls[0][0];
      await act(async () => {
        tasks.push(hook.result.current.upsertProxyProfile(profileB));
      });
      await hook.unmount();
      const committed = persisted;
      await act(async () => {
        saving.resolve(committed);
        await Promise.allSettled(tasks);
      });
      expect(mockSaveNetworkProxyState).toHaveBeenCalledTimes(1);
      expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        saving.resolve(persisted ?? { enabled: false, activeId: null, profiles: [] });
        await Promise.allSettled(tasks);
      });
      await hook.unmount();
    }
  });

  it('keeps a replacement gated behind an already dispatched native apply authority', async () => {
    const oldApply = deferred<unknown>();
    let nativeQueue: Promise<void> = Promise.resolve();
    const started: (string | null)[] = [];
    mockApplyNetworkProxy.mockImplementation((profile) => {
      const task = nativeQueue.then(async () => {
        started.push(profile?.id ?? null);
        if (started.length === 1) await oldApply.promise;
        return { ok: true };
      });
      nativeQueue = task.then(() => undefined);
      return task;
    });
    mockLoadNetworkProxyState
      .mockResolvedValueOnce({ enabled: true, activeId: profileA.id, profiles: [profileA] })
      .mockResolvedValueOnce({ enabled: true, activeId: profileB.id, profiles: [profileB] });
    const first = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    let replacement: RenderHookResult<ReturnType<typeof useNetworkProxyRuntime>, void> | undefined;
    let request: Promise<unknown> | undefined;
    let settled = false;
    try {
      await waitFor(() => expect(started).toEqual([profileA.id]));
      await first.unmount();
      replacement = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn(), baseFetcher }));
      request = replacement.result.current.networkProxyFetcher('https://example.invalid/current').then(() => {
        settled = true;
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(settled).toBe(false);
      expect(started).toEqual([profileA.id]);
      expect(baseFetcher).not.toHaveBeenCalled();
      await act(async () => {
        oldApply.resolve({ ok: true });
        await request;
      });
      expect(started).toEqual([profileA.id, profileB.id]);
      expect(settled).toBe(true);
    } finally {
      await act(async () => {
        oldApply.resolve({ ok: true });
        await Promise.allSettled([request, nativeQueue]);
      });
      await first.unmount();
      await replacement?.unmount();
    }
  });
});

describe('network proxy child observer ownership', () => {
  it('rebinds a child Query observer without retrying a retired proxy request', async () => {
    jest.clearAllMocks();
    const loading = deferred<NetworkProxyState>();
    const applying = deferred<unknown>();
    mockLoadNetworkProxyState.mockReturnValue(loading.promise);
    mockApplyNetworkProxy.mockReturnValue(applying.promise);
    const client = createAppQueryClient();
    const notify = jest.fn();
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('ready'));
    let latest: { status: string; data: unknown; error: unknown } = { status: 'pending', data: undefined, error: null };
    function Consumer({ fetcher }: { fetcher: import('@/platform/network/request').Fetcher }) {
      const query = useQuery({
        queryKey: ['network-lifetime-read'],
        queryFn: async ({ signal }) => {
          const currentRead = withRequestBeforeSend(fetcher, () => {
            if (signal.aborted) throw new RequestCanceledError();
          });
          const response = await fetchWithTimeout(
            'https://example.invalid/query',
            {},
            { fetcher: currentRead, signal }
          );
          return response.text();
        }
      });
      latest = { status: query.status, data: query.data, error: query.error };
      return null;
    }
    function Parent() {
      const runtime = useNetworkProxyRuntime({ notify, baseFetcher });
      return (
        <QueryClientProvider client={client}>
          <Consumer fetcher={runtime.networkProxyFetcher} />
        </QueryClientProvider>
      );
    }
    const root = createRoot({ isStrictMode: true });
    try {
      await act(() => root.render(<Parent />));
      expect(latest).toMatchObject({ status: 'pending', error: null });
      expect(baseFetcher).not.toHaveBeenCalled();
      await act(async () => {
        loading.resolve({ enabled: false, activeId: null, profiles: [] });
      });
      await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1));
      expect(latest).toMatchObject({ status: 'pending', error: null });
      expect(baseFetcher).not.toHaveBeenCalled();
      await act(async () => {
        applying.resolve({ ok: true });
      });
      await waitFor(() => expect(latest).toMatchObject({ status: 'success', data: 'ready', error: null }));
      expect(baseFetcher).toHaveBeenCalledTimes(1);
    } finally {
      try {
        await act(async () => {
          loading.resolve({ enabled: false, activeId: null, profiles: [] });
          applying.resolve({ ok: true });
          root.unmount();
        });
      } finally {
        client.clear();
      }
    }
  });

  it('lets a replayed child await the parent runtime bootstrap', async () => {
    jest.clearAllMocks();
    const loading = deferred<NetworkProxyState>();
    const applying = deferred<unknown>();
    mockLoadNetworkProxyState.mockReturnValue(loading.promise);
    mockSaveNetworkProxyState.mockImplementation(async (state) => state);
    mockApplyNetworkProxy.mockReturnValue(applying.promise);
    const notify = jest.fn();
    const baseFetcher = jest.fn<import('@/platform/network/request').Fetcher>(async () => new Response('{}'));
    const outcomes: string[] = [];
    const requests: Promise<unknown>[] = [];
    function Consumer({ fetcher }: { fetcher: import('@/platform/network/request').Fetcher }) {
      useEffect(() => {
        const index = outcomes.length;
        outcomes.push('pending');
        requests.push(
          fetcher('https://example.invalid/owned').then(
            () => {
              outcomes[index] = 'resolved';
            },
            () => {
              outcomes[index] = 'rejected';
            }
          )
        );
      }, [fetcher]);
      return null;
    }
    function Parent() {
      const runtime = useNetworkProxyRuntime({ notify, baseFetcher });
      return <Consumer fetcher={runtime.networkProxyFetcher} />;
    }
    const root = createRoot({ isStrictMode: true });
    try {
      await act(() => root.render(<Parent />));
      expect(outcomes).toEqual(['rejected', 'pending']);
      await act(async () => {
        loading.resolve({ enabled: false, activeId: null, profiles: [] });
      });
      expect(baseFetcher).not.toHaveBeenCalled();
      await act(async () => {
        applying.resolve({ ok: true });
        await requests[1];
      });
      expect(outcomes).toEqual(['rejected', 'resolved']);
      expect(baseFetcher).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        loading.resolve({ enabled: false, activeId: null, profiles: [] });
        applying.resolve({ ok: true });
        await Promise.allSettled(requests);
      });
      await act(() => root.unmount());
    }
  });
});
