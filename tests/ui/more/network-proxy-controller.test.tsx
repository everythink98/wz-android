import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useNetworkProxyRuntime } from '@/platform/network/useNetworkProxyRuntime';
import type { NetworkProxyProfile, NetworkProxyState } from '@/platform/network/networkProxy';
import { fetchWithTimeout } from '@/platform/network/request';

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

  it('[REG-PROXY-003] can reset an unreadable saved proxy to a confirmed direct connection', async () => {
    mockLoadNetworkProxyState.mockRejectedValueOnce(new Error('corrupted proxy state'));
    const hook = await renderHook(() => useNetworkProxyRuntime({ notify: jest.fn() }));
    await waitFor(() => expect(hook.result.current.applyStatus).toBe('failed'));

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

  it('[REG-PROXY-002] serializes profile persistence and builds a later edit from the committed state', async () => {
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

  it('[REG-PROXY-002] waits for an older native apply before applying the newly selected profile', async () => {
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

  it('[REG-ACCOUNT-029] preserves the proxy readiness gate while using the read-only native cookie jar', async () => {
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

  it('[REG-PROXY-002] does not apply a selected profile before its persistence succeeds', async () => {
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

  it('[REG-PROXY-002] keeps an enabled proxy usable when an unchanged profile is saved', async () => {
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
  });

  it('[REG-PROXY-007] does not restart an enabled proxy when only its saved name changes', async () => {
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

  it('[REG-PROXY-002] settles rapid enable then disable commands in order', async () => {
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
  });
});
