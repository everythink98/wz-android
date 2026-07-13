import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withOperationDeadline, type Fetcher } from '../request';
import type { DirectTransportRecoveryEvent } from '../directWebViewFallback';
import { errorMessage } from '../appUtils';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  type DiagnosticTrace
} from '../diagnostics';
import {
  activeNetworkProxyProfile,
  applyNetworkProxy,
  createEmptyNetworkProxyState,
  createNetworkProxyProfile,
  getNetworkProxyStatus,
  loadNetworkProxyState,
  MAX_NETWORK_PROXY_PROFILES,
  networkProxySummary,
  recoverNetworkConnectionPool as recoverNativeNetworkConnectionPool,
  removeNetworkProxyProfile,
  saveNetworkProxyState,
  testNetworkProxy,
  validateNetworkProxyProfile,
  type NetworkProxyProfile,
  type NetworkProxyState
} from '../networkProxy';

type ApplyStatus = 'loading' | 'disabled' | 'applying' | 'applied' | 'failed';
const NETWORK_RECOVERY_TIMEOUT_MS = 5_000;

function diagnosticProxyState(state: NetworkProxyState) {
  const profile = activeNetworkProxyProfile(state);
  return {
    hasProxy: Boolean(profile),
    isEnabled: state.enabled,
    ...(profile ? { protocol: profile.protocol } : {})
  };
}

export function useNetworkProxyController({ notify }: { notify: (message: string) => void }) {
  const [proxyState, setProxyState] = useState<NetworkProxyState>(() => createEmptyNetworkProxyState());
  const [loaded, setLoaded] = useState(false);
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('loading');
  const [applyError, setApplyError] = useState('');
  const [applyRevision, setApplyRevision] = useState(0);
  const readyPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const proxyStateRef = useRef(proxyState);
  const loadedRef = useRef(loaded);
  const applyStatusRef = useRef(applyStatus);
  const applyErrorRef = useRef(applyError);
  const proxyApplyGenerationRef = useRef(0);
  const proxyLoadFailedRef = useRef(false);
  const pendingProxyApplyTraceRef = useRef<{ resolve: () => void; trace: DiagnosticTrace } | null>(null);
  const networkRecoveryInFlightRef = useRef<Promise<unknown> | null>(null);

  useLayoutEffect(() => {
    proxyStateRef.current = proxyState;
    loadedRef.current = loaded;
    applyStatusRef.current = applyStatus;
    applyErrorRef.current = applyError;
  }, [applyError, applyStatus, loaded, proxyState]);

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
    const trace = beginDiagnosticTrace('proxy', 'load');
    const task = loadNetworkProxyState()
      .then((state) => {
        if (canceled) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        proxyLoadFailedRef.current = false;
        proxyStateRef.current = state;
        loadedRef.current = true;
        setProxyState(state);
        setLoaded(true);
        const fields = diagnosticProxyState(state);
        markDiagnosticStage(trace, 'persist', { store: 'secure-store', ...fields });
        finishDiagnosticTrace(trace, 'success', fields);
      })
      .catch(() => {
        if (canceled) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        const emptyState = createEmptyNetworkProxyState();
        const message = '代理设置读取失败，网络已阻断。';
        proxyLoadFailedRef.current = true;
        proxyStateRef.current = emptyState;
        loadedRef.current = true;
        setProxyState(emptyState);
        setLoaded(true);
        setApplyState('failed', message);
        markDiagnosticStage(trace, 'persist', { store: 'secure-store', state: 'failure' });
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
      });
    readyPromiseRef.current = task.then(() => undefined);
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || proxyLoadFailedRef.current) {
      return;
    }
    let canceled = false;
    const profile = proxyState.enabled ? activeProfile : null;
    const pendingTrace = pendingProxyApplyTraceRef.current;
    if (pendingTrace) {
      pendingProxyApplyTraceRef.current = null;
    }
    const trace = pendingTrace?.trace || beginDiagnosticTrace('proxy', 'apply', diagnosticProxyState(proxyState));
    const ownsTrace = !pendingTrace;
    proxyApplyGenerationRef.current += 1;
    setApplyState('applying');
    const task = applyNetworkProxy(profile)
      .then(() => {
        if (canceled) {
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          }
          return;
        }
        const state = profile ? 'applied' : 'disabled';
        setApplyState(state);
        markDiagnosticStage(trace, 'apply', { channel: 'native', state });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', { state });
        }
      })
      .catch((error) => {
        if (canceled) {
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          }
          return;
        }
        const message = errorMessage(error);
        setApplyState('failed', message);
        markDiagnosticStage(trace, 'apply', {
          channel: 'native',
          state: 'failed',
          reason: normalizeDiagnosticReason(error)
        });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'failure', {
            state: 'failed',
            reason: normalizeDiagnosticReason(error)
          });
        }
        if (profile && !pendingTrace) {
          notify(message);
        }
      })
      .finally(() => {
        pendingTrace?.resolve();
      });
    readyPromiseRef.current = task.then(() => undefined, () => undefined);
    return () => {
      canceled = true;
      pendingTrace?.resolve();
    };
  }, [applyKey, applyRevision, loaded, notify, proxyState.enabled, setApplyState]);

  const replaceProxyState = useCallback(async (next: NetworkProxyState, parentTrace?: DiagnosticTrace) => {
    const trace = parentTrace || beginDiagnosticTrace('proxy', 'save', diagnosticProxyState(next));
    const ownsTrace = !parentTrace;
    const previous = proxyStateRef.current;
    proxyStateRef.current = next;
    setProxyState(next);
    try {
      const recoversFailedLoad = proxyLoadFailedRef.current;
      const saved = await saveNetworkProxyState(next);
      proxyLoadFailedRef.current = false;
      proxyStateRef.current = saved;
      setProxyState(saved);
      if (recoversFailedLoad) {
        setApplyRevision((revision) => revision + 1);
      }
      markDiagnosticStage(trace, 'persist', { store: 'secure-store', ...diagnosticProxyState(saved) });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'success', diagnosticProxyState(saved));
      }
      return saved;
    } catch (error) {
      proxyStateRef.current = previous;
      setProxyState(previous);
      markDiagnosticStage(trace, 'rollback', { state: 'restored' });
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
      }
      throw error;
    }
  }, []);

  const beginProxyApplyTransition = useCallback(() => {
    proxyApplyGenerationRef.current += 1;
    setApplyState('applying');
  }, [setApplyState]);

  const setProxyEnabled = useCallback(async (enabled: boolean) => {
    const trace = beginDiagnosticTrace('proxy', 'set-enabled', { isEnabled: enabled });
    if (enabled && !activeNetworkProxyProfile(proxyStateRef.current)) {
      finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
      notify('请先添加并选择一个代理。');
      return;
    }
    if (proxyStateRef.current.enabled === enabled) {
      finishDiagnosticTrace(trace, 'noop', { isEnabled: enabled });
      return;
    }
    const previousStatus = applyStatusRef.current;
    const previousError = applyErrorRef.current;
    let resolveApply: () => void = () => undefined;
    const applyCompleted = new Promise<void>((resolve) => {
      resolveApply = resolve;
    });
    const pendingTrace = { resolve: resolveApply, trace };
    pendingProxyApplyTraceRef.current = pendingTrace;
    let nativeApplyFailed = false;
    beginProxyApplyTransition();
    try {
      await replaceProxyState({
        ...proxyStateRef.current,
        enabled
      }, trace);
      markDiagnosticStage(trace, 'apply', { state: 'pending', isEnabled: enabled });
      await applyCompleted;
      const status = applyStatusRef.current;
      if (status === 'applied' || status === 'disabled') {
        finishDiagnosticTrace(trace, 'success', { isEnabled: enabled, state: status });
      } else if (status === 'failed') {
        finishDiagnosticTrace(trace, 'failure', { isEnabled: enabled, state: status, reason: 'network_error' });
        nativeApplyFailed = true;
        throw new Error(applyErrorRef.current || '代理未生效。');
      } else {
        finishDiagnosticTrace(trace, 'stale', { isEnabled: enabled, reason: 'superseded' });
      }
    } catch (error) {
      if (pendingProxyApplyTraceRef.current === pendingTrace) {
        pendingProxyApplyTraceRef.current = null;
        resolveApply();
      }
      if (!nativeApplyFailed) {
        setApplyState(previousStatus, previousError);
      }
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
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
    const trace = beginDiagnosticTrace('proxy', 'test', { protocol: profile.protocol });
    markDiagnosticStage(trace, 'transport', { channel: 'native', state: 'start' });
    try {
      const result = await testNetworkProxy(profile);
      markDiagnosticStage(trace, 'transport', {
        channel: 'native',
        state: 'finish',
        ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs })
      });
      finishDiagnosticTrace(trace, 'success');
      notify(`代理测试通过 · ${result.latencyMs} ms`);
      return result;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [notify]);

  const ensureNetworkProxyReady = useCallback(async () => {
    while (true) {
      if (!loadedRef.current || applyStatusRef.current === 'applying') {
        await readyPromiseRef.current;
      }
      const current = proxyStateRef.current;
      if (applyStatusRef.current === 'failed') {
        const trace = beginDiagnosticTrace('proxy', 'guard', {
          isEnabled: current.enabled,
          hasProxy: Boolean(activeNetworkProxyProfile(current)),
          state: 'failed'
        });
        finishDiagnosticTrace(trace, 'blocked', { reason: 'network_error' });
        throw new Error(applyErrorRef.current || '代理状态不确定，请重新应用代理设置。');
      }
      if (!current.enabled) {
        return;
      }
      if (!activeNetworkProxyProfile(current)) {
        const trace = beginDiagnosticTrace('proxy', 'guard', { isEnabled: true, hasProxy: false });
        finishDiagnosticTrace(trace, 'blocked', { reason: 'missing_credential' });
        throw new Error('代理未选择。');
      }
      if (applyStatusRef.current !== 'applied') {
        const trace = beginDiagnosticTrace('proxy', 'guard', {
          isEnabled: true,
          hasProxy: true,
          state: applyStatusRef.current
        });
        finishDiagnosticTrace(trace, 'blocked', {
          reason: 'not_ready'
        });
        throw new Error(applyErrorRef.current || '代理未生效。');
      }

      const generation = proxyApplyGenerationRef.current;
      let healthError: unknown;
      let healthMessage = '';
      try {
        const health = await getNetworkProxyStatus();
        if (!health.ok) {
          healthMessage = health.message || '代理异常，网络已阻断。';
        }
      } catch (error) {
        healthError = error;
        healthMessage = errorMessage(error) || '代理状态检查失败，网络已阻断。';
      }
      if (
        generation !== proxyApplyGenerationRef.current
        || !proxyStateRef.current.enabled
        || applyStatusRef.current !== 'applied'
      ) {
        continue;
      }
      if (!healthMessage) {
        return;
      }

      proxyApplyGenerationRef.current += 1;
      setApplyState('failed', healthMessage);
      const trace = beginDiagnosticTrace('proxy', 'guard', {
        isEnabled: true,
        hasProxy: true,
        state: 'failed'
      });
      markDiagnosticStage(trace, 'transport', {
        channel: 'native',
        state: 'failed',
        reason: healthError ? normalizeDiagnosticReason(healthError) : 'network_error'
      });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'network_error' });
      throw new Error(healthMessage);
    }
  }, [setApplyState]);

  const networkProxyFetcher: Fetcher = useCallback(async (input, init) => {
    await ensureNetworkProxyReady();
    return fetch(input, init);
  }, [ensureNetworkProxyReady]);

  const recoverNetworkConnectionPool = useCallback((event?: DirectTransportRecoveryEvent) => {
    if (networkRecoveryInFlightRef.current) {
      return networkRecoveryInFlightRef.current;
    }
    const source = event?.source || 'nodeseek';
    const trace = beginDiagnosticTrace('proxy', 'recover', {
      source,
      ...(event?.parentTraceId ? { parentTraceId: event.parentTraceId } : {}),
      ...(event ? { reason: event.reason === 'direct-timeout' ? 'timeout' : 'network_error' } : {})
    });
    markDiagnosticStage(trace, 'apply', { source, channel: 'native', state: 'start' });
    const recovery = withOperationDeadline(
      () => recoverNativeNetworkConnectionPool(),
      { timeoutMs: NETWORK_RECOVERY_TIMEOUT_MS }
    )
      .then((result) => {
        finishDiagnosticTrace(trace, 'success', { source });
        return result;
      }, (error) => {
        finishDiagnosticTrace(trace, 'failure', { source, reason: normalizeDiagnosticReason(error) });
        throw error;
    });
    networkRecoveryInFlightRef.current = recovery;
    const clearRecovery = () => {
      if (networkRecoveryInFlightRef.current === recovery) {
        networkRecoveryInFlightRef.current = null;
      }
    };
    void recovery.then(clearRecovery, clearRecovery);
    return recovery;
  }, []);

  return {
    activeProfile,
    applyError,
    applyStatus,
    ensureNetworkProxyReady,
    loaded,
    networkProxyFetcher,
    proxyState,
    recoverNetworkConnectionPool,
    summary,
    deleteProxyProfile,
    selectProxyProfile,
    setProxyEnabled,
    testProxyProfile,
    upsertProxyProfile
  };
}
