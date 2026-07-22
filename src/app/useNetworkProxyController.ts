import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Fetcher } from '../request';
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
  loadNetworkProxyState,
  MAX_NETWORK_PROXY_PROFILES,
  networkProxySummary,
  recoverNodeSeekNetwork as recoverNativeNodeSeekNetwork,
  removeNetworkProxyProfile,
  saveNetworkProxyState,
  testNetworkProxy,
  validateNetworkProxyProfile,
  type NetworkProxyApplyStatus,
  type NetworkProxyProfile,
  type NetworkProxyState
} from '../networkProxy';

type SettledApplyStatus = Extract<NetworkProxyApplyStatus, 'disabled' | 'applied'>;
const RESOLVED_VOID_PROMISE: Promise<void> = Promise.resolve();

function diagnosticProxyState(state: NetworkProxyState) {
  const profile = activeNetworkProxyProfile(state);
  return {
    hasProxy: Boolean(profile),
    isEnabled: state.enabled,
    ...(profile ? { protocol: profile.protocol } : {})
  };
}

function sameNetworkProxyProfile(left: NetworkProxyProfile, right: NetworkProxyProfile) {
  return left.id === right.id
    && left.name === right.name
    && left.protocol === right.protocol
    && left.host === right.host
    && left.port === right.port
    && left.username === right.username
    && left.password === right.password;
}

function networkProxyApplyKey(state: NetworkProxyState) {
  const profile = state.enabled ? activeNetworkProxyProfile(state) : null;
  return profile ? JSON.stringify(profile) : '';
}

function enqueueProxyEnabledTransition(
  queueRef: { current: Promise<void> },
  runTransition: (enabled: boolean) => Promise<void>,
  enabled: boolean
) {
  const previousTask = queueRef.current;
  const task = previousTask
    .catch(() => undefined)
    .then(() => runTransition(enabled));
  queueRef.current = task.then(() => undefined, () => undefined);
  return task;
}

export function useNetworkProxyController({ notify }: { notify: (message: string) => void }) {
  const [proxyState, setProxyState] = useState<NetworkProxyState>(() => createEmptyNetworkProxyState());
  const [loaded, setLoaded] = useState(false);
  const [applyStatus, setApplyStatus] = useState<NetworkProxyApplyStatus>('loading');
  const [applyError, setApplyError] = useState('');
  const readyPromiseRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);
  const proxyStateRef = useRef(proxyState);
  const loadedRef = useRef(loaded);
  const applyStatusRef = useRef(applyStatus);
  const applyErrorRef = useRef(applyError);
  const notifyRef = useRef(notify);
  const loadPromiseRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);
  const proxyApplyQueueRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);
  const latestProxyApplyIdRef = useRef(0);
  const proxyEnabledQueueRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);
  const proxySaveQueueRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const setApplyState = useCallback((status: NetworkProxyApplyStatus, error = '') => {
    applyStatusRef.current = status;
    applyErrorRef.current = error;
    setApplyStatus(status);
    setApplyError(error);
  }, []);

  const activeProfile = useMemo(() => activeNetworkProxyProfile(proxyState), [proxyState]);
  const summary = useMemo(() => networkProxySummary(proxyState, applyError), [applyError, proxyState]);

  const applyPersistedProxyState = useCallback((
    state: NetworkProxyState,
    parentTrace?: DiagnosticTrace,
    notifyOnFailure = false
  ) => {
    const profile = state.enabled ? activeNetworkProxyProfile(state) : null;
    const trace = parentTrace || beginDiagnosticTrace('proxy', 'apply', diagnosticProxyState(state));
    const ownsTrace = !parentTrace;
    const applyId = latestProxyApplyIdRef.current + 1;
    latestProxyApplyIdRef.current = applyId;
    setApplyState('applying');
    markDiagnosticStage(trace, 'apply', { channel: 'native', state: 'start' });
    const task = proxyApplyQueueRef.current
      .then(() => applyNetworkProxy(profile))
      .then(() => {
        const status: SettledApplyStatus = profile ? 'applied' : 'disabled';
        if (latestProxyApplyIdRef.current === applyId) {
          setApplyState(status);
        }
        markDiagnosticStage(trace, 'apply', { channel: 'native', state: status });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', { state: status });
        }
        return status;
      })
      .catch((error) => {
        const message = errorMessage(error);
        if (latestProxyApplyIdRef.current === applyId) {
          setApplyState('failed', message);
          if (notifyOnFailure) {
            notifyRef.current(message);
          }
        }
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
        throw error;
      });
    proxyApplyQueueRef.current = task.then(() => undefined, () => undefined);
    readyPromiseRef.current = proxyApplyQueueRef.current;
    return task;
  }, [setApplyState]);

  useEffect(() => {
    let canceled = false;
    const trace = beginDiagnosticTrace('proxy', 'load');
    const loadAndApply = async () => {
      let savedState: NetworkProxyState;
      try {
        savedState = await loadNetworkProxyState();
      } catch {
        if (canceled) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        const emptyState = createEmptyNetworkProxyState();
        const message = '代理配置读取失败，已阻止网络请求，请重启 App 后重试。';
        proxyStateRef.current = emptyState;
        loadedRef.current = true;
        setProxyState(emptyState);
        setLoaded(true);
        setApplyState('failed', message);
        notifyRef.current(message);
        markDiagnosticStage(trace, 'persist', { store: 'secure-store', state: 'failure' });
        finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
        return;
      }
      if (canceled) {
        finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        return;
      }
      proxyStateRef.current = savedState;
      loadedRef.current = true;
      setProxyState(savedState);
      setLoaded(true);
      const fields = diagnosticProxyState(savedState);
      markDiagnosticStage(trace, 'persist', { store: 'secure-store', ...fields });
      finishDiagnosticTrace(trace, 'success', fields);
      await applyPersistedProxyState(savedState, undefined, true).catch(() => undefined);
    };
    const task = loadAndApply();
    loadPromiseRef.current = task.then(() => undefined);
    readyPromiseRef.current = loadPromiseRef.current;
    return () => {
      canceled = true;
    };
  }, [applyPersistedProxyState, setApplyState]);

  const replaceProxyState = useCallback((
    update: NetworkProxyState | ((current: NetworkProxyState) => NetworkProxyState),
    parentTrace?: DiagnosticTrace
  ) => {
    const task = proxySaveQueueRef.current.then(async () => {
      await loadPromiseRef.current;
      const previous = proxyStateRef.current;
      const next = typeof update === 'function' ? update(previous) : update;
      if (next === previous) {
        return { changed: false, requiresApply: false, state: previous };
      }
      const trace = parentTrace || beginDiagnosticTrace('proxy', 'save', diagnosticProxyState(next));
      const ownsTrace = !parentTrace;
      try {
        const saved = await saveNetworkProxyState(next);
        const requiresApply = applyStatusRef.current === 'failed'
          || networkProxyApplyKey(previous) !== networkProxyApplyKey(saved);
        if (requiresApply) {
          setApplyState('applying');
        }
        proxyStateRef.current = saved;
        setProxyState(saved);
        markDiagnosticStage(trace, 'persist', { store: 'secure-store', ...diagnosticProxyState(saved) });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'success', diagnosticProxyState(saved));
        }
        return { changed: true, requiresApply, state: saved };
      } catch (error) {
        proxyStateRef.current = previous;
        setProxyState(previous);
        markDiagnosticStage(trace, 'rollback', { state: 'restored' });
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
        }
        throw error;
      }
    });
    proxySaveQueueRef.current = task.then(() => undefined, () => undefined);
    return task;
  }, [setApplyState]);

  const runSetProxyEnabled = useCallback(async (enabled: boolean) => {
    const trace = beginDiagnosticTrace('proxy', 'set-enabled', { isEnabled: enabled });
    try {
      const result = await replaceProxyState((current) => {
        if (enabled && !activeNetworkProxyProfile(current)) {
          return current;
        }
        if (current.enabled === enabled) {
          if (!enabled && applyStatusRef.current === 'failed') {
            return { ...current };
          }
          return current;
        }
        return {
          ...current,
          enabled
        };
      }, trace);
      if (!result.changed && enabled && !activeNetworkProxyProfile(result.state)) {
        finishDiagnosticTrace(trace, 'blocked', { reason: 'not_ready' });
        notify('请先添加并选择一个代理。');
        return;
      }
      if (!result.changed) {
        finishDiagnosticTrace(trace, 'noop', { isEnabled: enabled });
        return;
      }
      markDiagnosticStage(trace, 'apply', { state: 'pending', isEnabled: enabled });
      const status = await applyPersistedProxyState(result.state, trace);
      finishDiagnosticTrace(trace, 'success', { isEnabled: enabled, state: status });
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [applyPersistedProxyState, notify, replaceProxyState]);

  const setProxyEnabled = useCallback(
    (enabled: boolean) => enqueueProxyEnabledTransition(proxyEnabledQueueRef, runSetProxyEnabled, enabled),
    [runSetProxyEnabled]
  );

  const upsertProxyProfile = useCallback(async (input: Partial<NetworkProxyProfile>) => {
    const profile = createNetworkProxyProfile(input);
    const errors = validateNetworkProxyProfile(profile);
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors)[0] || '代理配置不正确');
    }
    const result = await replaceProxyState((latest) => {
      const exists = latest.profiles.some((item) => item.id === profile.id);
      const existing = latest.profiles.find((item) => item.id === profile.id);
      const activeId = latest.activeId || profile.id;
      if (existing && sameNetworkProxyProfile(existing, profile) && activeId === latest.activeId) {
        return latest;
      }
      const profiles = exists
        ? latest.profiles.map((item) => item.id === profile.id ? profile : item)
        : [...latest.profiles, profile];
      if (!exists && profiles.length > MAX_NETWORK_PROXY_PROFILES) {
        throw new Error('最多保存 10 个代理。');
      }
      return {
        ...latest,
        activeId,
        profiles
      };
    });
    if (result.requiresApply) {
      await applyPersistedProxyState(result.state);
    }
  }, [applyPersistedProxyState, replaceProxyState]);

  const deleteProxyProfile = useCallback(async (id: string) => {
    const result = await replaceProxyState((current) => {
      if (!current.profiles.some((profile) => profile.id === id)) {
        return current;
      }
      return removeNetworkProxyProfile(current, id);
    });
    if (result.requiresApply) {
      await applyPersistedProxyState(result.state);
    }
  }, [applyPersistedProxyState, replaceProxyState]);

  const selectProxyProfile = useCallback(async (id: string) => {
    const result = await replaceProxyState((latest) => {
      if (!latest.profiles.some((profile) => profile.id === id) || latest.activeId === id) {
        return latest;
      }
      return {
        ...latest,
        activeId: id
      };
    });
    if (result.requiresApply) {
      await applyPersistedProxyState(result.state);
    }
  }, [applyPersistedProxyState, replaceProxyState]);

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
      notify(`代理连通性测试通过 · ${result.latencyMs} ms`);
      return result;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, [notify]);

  const ensureNetworkProxyReady = useCallback(async () => {
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
  }, []);

  const networkProxyFetcher: Fetcher = useCallback(async (input, init) => {
    await ensureNetworkProxyReady();
    return fetch(input, init);
  }, [ensureNetworkProxyReady]);

  const recoverNodeSeekNetwork = useCallback(async () => {
    const trace = beginDiagnosticTrace('proxy', 'recover');
    markDiagnosticStage(trace, 'apply', { channel: 'native', state: 'start' });
    try {
      const result = await recoverNativeNodeSeekNetwork();
      finishDiagnosticTrace(trace, 'success');
      return result;
    } catch (error) {
      finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
      throw error;
    }
  }, []);

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
