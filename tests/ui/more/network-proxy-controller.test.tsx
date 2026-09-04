import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { NetworkProxyProfile, NetworkProxyState } from '@/platform/network/networkProxy';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import * as SecureStore from 'expo-secure-store';

const mockLoadNetworkProxyState = jest.fn<() => Promise<NetworkProxyState>>();
const mockSaveNetworkProxyState = jest.fn<(state: NetworkProxyState) => Promise<NetworkProxyState>>();
const mockApplyNetworkProxy = jest.fn<(profile: NetworkProxyProfile | null) => Promise<unknown>>();

jest.mock('@/platform/network/networkProxy', () => ({
  ...jest.requireActual<typeof import('@/platform/network/networkProxy')>('@/platform/network/networkProxy'),
  applyNetworkProxy: (profile: NetworkProxyProfile | null) => mockApplyNetworkProxy(profile),
  loadNetworkProxyState: () => mockLoadNetworkProxyState(),
  saveNetworkProxyState: (state: NetworkProxyState) => mockSaveNetworkProxyState(state)
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadNetworkProxyState.mockResolvedValue({ enabled: false, activeId: null, profiles: [] });
    mockSaveNetworkProxyState.mockImplementation(async (state) => state);
    mockApplyNetworkProxy.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('can reset an unreadable saved proxy to a confirmed direct connection', async () => {
    mockLoadNetworkProxyState.mockRejectedValueOnce(new Error('corrupted proxy state'));
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));
    await expect(hook.result.current.ensureNetworkProxyReady()).rejects.toThrow('代理配置读取失败');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('代理配置读取失败'));

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

  it('waits for an older native apply before applying the newly selected profile', async () => {
    const firstApply = deferred<unknown>();
    const secondApply = deferred<unknown>();
    mockLoadNetworkProxyState.mockResolvedValue({
      enabled: true,
      activeId: profileA.id,
      profiles: [profileA, profileB]
    });
    mockApplyNetworkProxy
      .mockImplementationOnce(() => firstApply.promise)
      .mockImplementationOnce(() => secondApply.promise);
    const notify = jest.fn();
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify }));
    await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1));

    let selection!: Promise<void>;
    await act(async () => {
      selection = hook.result.current.selectProxyProfile(profileB.id);
      await Promise.resolve();
    });

    expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstApply.resolve({ ok: true });
      await firstApply.promise;
    });
    await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(2));
    expect(mockApplyNetworkProxy.mock.calls[1]?.[0]?.id).toBe(profileB.id);

    await act(async () => {
      secondApply.resolve({ ok: true });
      await Promise.all([secondApply.promise, selection]);
    });
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('applied'));
  });

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
    setDiagnosticWriter((line) => {
      lines.push(line);
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
    await act(async () => {
      enable = hook.result.current.setProxyEnabled(true);
      disable = hook.result.current.setProxyEnabled(false);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(3));
    await Promise.all([enable, disable]);

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

  it('remains fail-closed when native proxy disable fails', async () => {
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
  });
});
