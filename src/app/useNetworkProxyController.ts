import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Fetcher } from '../request';
import { errorMessage } from '../appUtils';
import {
  activeNetworkProxyProfile,
  applyNetworkProxy,
  createEmptyNetworkProxyState,
  createNetworkProxyProfile,
  loadNetworkProxyState,
  MAX_NETWORK_PROXY_PROFILES,
  networkProxySummary,
  recoverNodeSeekNetwork as recoverNativeNodeSeekNetwork,
  removeNetworkProxyProfile,
  saveNetworkProxyState,
  testNetworkProxy,
  validateNetworkProxyProfile,
  type NetworkProxyProfile,
  type NetworkProxyState
} from '../networkProxy';

type ApplyStatus = 'loading' | 'disabled' | 'applying' | 'applied' | 'failed';

export function useNetworkProxyController({ notify }: { notify: (message: string) => void }) {
  const [proxyState, setProxyState] = useState<NetworkProxyState>(() => createEmptyNetworkProxyState());
  const [loaded, setLoaded] = useState(false);
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('loading');
  const [applyError, setApplyError] = useState('');
  const readyPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const proxyStateRef = useRef(proxyState);
  const loadedRef = useRef(loaded);
  const applyStatusRef = useRef(applyStatus);
  const applyErrorRef = useRef(applyError);

  proxyStateRef.current = proxyState;
  loadedRef.current = loaded;
  applyStatusRef.current = applyStatus;
  applyErrorRef.current = applyError;

  const setApplyState = useCallback((status: ApplyStatus, error = '') => {
    applyStatusRef.current = status;
    applyErrorRef.current = error;
    setApplyStatus(status);
    setApplyError(error);
  }, []);

  const activeProfile = useMemo(() => activeNetworkProxyProfile(proxyState), [proxyState]);
  const applyKey = useMemo(() => (
    proxyState.enabled && activeProfile ? JSON.stringify(activeProfile) : ''
  ), [activeProfile, proxyState.enabled]);
  const summary = useMemo(() => networkProxySummary(proxyState, applyError), [applyError, proxyState]);

  useEffect(() => {
    let canceled = false;
    const task = loadNetworkProxyState()
      .then((state) => {
        if (canceled) {
          return;
        }
        proxyStateRef.current = state;
        loadedRef.current = true;
        setProxyState(state);
        setLoaded(true);
      })
      .catch(() => {
        if (canceled) {
          return;
        }
        const emptyState = createEmptyNetworkProxyState();
        proxyStateRef.current = emptyState;
        loadedRef.current = true;
        setProxyState(emptyState);
        setLoaded(true);
      });
    readyPromiseRef.current = task.then(() => undefined);
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }
    let canceled = false;
    const profile = proxyState.enabled ? activeProfile : null;
    setApplyState('applying');
    const task = applyNetworkProxy(profile)
      .then(() => {
        if (canceled) {
          return;
        }
        setApplyState(profile ? 'applied' : 'disabled');
      })
      .catch((error) => {
        if (canceled) {
          return;
        }
        const message = errorMessage(error);
        setApplyState('failed', message);
        if (profile) {
          notify(message);
        }
      });
    readyPromiseRef.current = task.then(() => undefined, () => undefined);
    return () => {
      canceled = true;
    };
  }, [activeProfile, applyKey, loaded, notify, proxyState.enabled, setApplyState]);

  const replaceProxyState = useCallback(async (next: NetworkProxyState) => {
    const previous = proxyStateRef.current;
    proxyStateRef.current = next;
    setProxyState(next);
    try {
      const saved = await saveNetworkProxyState(next);
      proxyStateRef.current = saved;
      setProxyState(saved);
      return saved;
    } catch (error) {
      proxyStateRef.current = previous;
      setProxyState(previous);
      throw error;
    }
  }, []);

  const beginProxyApplyTransition = useCallback(() => {
    setApplyState('applying');
  }, [setApplyState]);

  const setProxyEnabled = useCallback(async (enabled: boolean) => {
    if (enabled && !activeNetworkProxyProfile(proxyStateRef.current)) {
      notify('请先添加并选择一个代理。');
      return;
    }
    const previousStatus = applyStatusRef.current;
    const previousError = applyErrorRef.current;
    beginProxyApplyTransition();
    try {
      await replaceProxyState({
        ...proxyStateRef.current,
        enabled
      });
    } catch (error) {
      setApplyState(previousStatus, previousError);
      throw error;
    }
  }, [beginProxyApplyTransition, notify, replaceProxyState, setApplyState]);

  const upsertProxyProfile = useCallback(async (input: Partial<NetworkProxyProfile>) => {
    const profile = createNetworkProxyProfile(input);
    const errors = validateNetworkProxyProfile(profile);
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors)[0] || '代理配置不正确');
    }
    const current = proxyStateRef.current;
    const exists = current.profiles.some((item) => item.id === profile.id);
    const profiles = exists
      ? current.profiles.map((item) => item.id === profile.id ? profile : item)
      : [...current.profiles, profile];
    if (!exists && profiles.length > MAX_NETWORK_PROXY_PROFILES) {
      throw new Error('最多保存 10 个代理。');
    }
    const updatesCurrentProxy = current.enabled && current.activeId === profile.id;
    const previousStatus = applyStatusRef.current;
    const previousError = applyErrorRef.current;
    if (updatesCurrentProxy) {
      beginProxyApplyTransition();
    }
    try {
      await replaceProxyState({
        ...current,
        activeId: current.activeId || profile.id,
        profiles
      });
    } catch (error) {
      if (updatesCurrentProxy) {
        setApplyState(previousStatus, previousError);
      }
      throw error;
    }
  }, [beginProxyApplyTransition, replaceProxyState, setApplyState]);

  const deleteProxyProfile = useCallback(async (id: string) => {
    await replaceProxyState(removeNetworkProxyProfile(proxyStateRef.current, id));
  }, [replaceProxyState]);

  const selectProxyProfile = useCallback(async (id: string) => {
    const current = proxyStateRef.current;
    if (!current.profiles.some((profile) => profile.id === id)) {
      return;
    }
    const switchesCurrentProxy = current.enabled && current.activeId !== id;
    const previousStatus = applyStatusRef.current;
    const previousError = applyErrorRef.current;
    if (switchesCurrentProxy) {
      beginProxyApplyTransition();
    }
    try {
      await replaceProxyState({
        ...current,
        activeId: id
      });
    } catch (error) {
      if (switchesCurrentProxy) {
        setApplyState(previousStatus, previousError);
      }
      throw error;
    }
  }, [beginProxyApplyTransition, replaceProxyState, setApplyState]);

  const testProxyProfile = useCallback(async (profile: NetworkProxyProfile) => {
    const result = await testNetworkProxy(profile);
    notify(`代理测试通过 · ${result.latencyMs} ms`);
    return result;
  }, [notify]);

  const ensureNetworkProxyReady = useCallback(async () => {
    if (!loadedRef.current || applyStatusRef.current === 'applying') {
      await readyPromiseRef.current;
    }
    const current = proxyStateRef.current;
    if (!current.enabled) {
      return;
    }
    if (!activeNetworkProxyProfile(current)) {
      throw new Error('代理未选择。');
    }
    if (applyStatusRef.current !== 'applied') {
      throw new Error(applyErrorRef.current || '代理未生效。');
    }
  }, []);

  const networkProxyFetcher: Fetcher = useCallback(async (input, init) => {
    await ensureNetworkProxyReady();
    return fetch(input, init);
  }, [ensureNetworkProxyReady]);

  const recoverNodeSeekNetwork = useCallback(() => recoverNativeNodeSeekNetwork(), []);

  return {
    activeProfile,
    applyError,
    applyStatus,
    ensureNetworkProxyReady,
    loaded,
    networkProxyFetcher,
    proxyState,
    recoverNodeSeekNetwork,
    summary,
    deleteProxyProfile,
    selectProxyProfile,
    setProxyEnabled,
    testProxyProfile,
    upsertProxyProfile
  };
}
