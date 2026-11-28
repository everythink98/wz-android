import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';
import { setDefaultAvatarFetcher } from '@/platform/media/avatarImages';
import { withNativeForumReadIntent } from './browserFetchIntent';
import { registerAppNetworkProxy } from './networkProxyAuthority';
import { prepareRequestToSend, RequestTimeoutError, withAbortableTimeout, type Fetcher } from './request';
import { errorMessage } from './errors';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withNativeDiagnosticRequest
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import {
  activeNetworkProxyProfile,
  enabledNetworkProxyProfile,
  applyNetworkProxy,
  createEmptyNetworkProxyState,
  createNetworkProxyProfile,
  InvalidSavedNetworkProxyStateError,
  loadNetworkProxyState,
  MAX_NETWORK_PROXY_PROFILES,
  networkProxySummary,
  networkMode,
  networkProxyWebViewBlockMessage,
  removeNetworkProxyProfile,
  saveNetworkProxyState,
  validateNetworkProxyProfile,
  type NetworkProxyApplyStatus,
  type NetworkProxyProfile,
  type NetworkProxyState,
  type NetworkMode
} from './networkProxy';

type SettledApplyStatus = Extract<NetworkProxyApplyStatus, 'disabled' | 'applied'>;
type ProxyApplyOperation = { owner: AbortController; promise: Promise<void> };
type ProxyApplyPhase =
  | { kind: 'loading' }
  | { kind: SettledApplyStatus }
  | { kind: 'applying'; operation: ProxyApplyOperation }
  | { kind: 'failed'; cause: 'storage' | 'apply'; error: string };
type ProxyApplyState = ProxyApplyPhase & { confirmed?: NetworkProxyState };
const RESOLVED_VOID_PROMISE: Promise<void> = Promise.resolve();
const NETWORK_PROXY_LOAD_TIMEOUT_MS = 3_000;
const NETWORK_PROXY_RUNTIME_ENDED_MESSAGE = '代理运行时已结束';
let proxyPersistenceQueue: Promise<void> = RESOLVED_VOID_PROMISE;

function requireNetworkProxyOwner(owner: AbortController | null) {
  if (!owner || owner.signal.aborted) throw new Error(NETWORK_PROXY_RUNTIME_ENDED_MESSAGE);
  return owner;
}

function readPersistedProxyState() {
  return proxyPersistenceQueue.then(() =>
    withAbortableTimeout(loadNetworkProxyState, { timeoutMs: NETWORK_PROXY_LOAD_TIMEOUT_MS })
  );
}

function persistNetworkProxyState(state: NetworkProxyState, owner: AbortController) {
  const task = proxyPersistenceQueue.then(() => {
    requireNetworkProxyOwner(owner);
    return saveNetworkProxyState(state);
  });
  proxyPersistenceQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

function diagnosticProxyState(state: NetworkProxyState) {
  const profile = activeNetworkProxyProfile(state);
  return {
    hasProxy: Boolean(profile),
    isEnabled: state.enabled,
    ...(profile ? { protocol: profile.protocol } : {})
  };
}

function sameNetworkProxyProfile(left: NetworkProxyProfile, right: NetworkProxyProfile) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.protocol === right.protocol &&
    left.host === right.host &&
    left.port === right.port &&
    left.username === right.username &&
    left.password === right.password
  );
}

function networkProxyApplyKey(state: NetworkProxyState) {
  const profile = enabledNetworkProxyProfile(state);
  return profile
    ? JSON.stringify([profile.protocol, profile.host, profile.port, profile.username, profile.password])
    : '';
}

export function useNetworkProxyRuntime({
  notify,
  baseFetcher = fetch
}: {
  notify: (message: string) => void;
  baseFetcher?: Fetcher;
}) {
  const [proxyState, setProxyState] = useState<NetworkProxyState>(() => createEmptyNetworkProxyState());
  const [applyState, setApplyStateValue] = useState<ProxyApplyState>({ kind: 'loading' });
  const proxyStateRef = useRef(proxyState);
  const applyStateRef = useRef(applyState);
  const notifyRef = useRef(notify);
  const loadPromiseRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);
  const proxyApplyQueueRef = useRef<Promise<void>>(RESOLVED_VOID_PROMISE);
  const networkModeQueueRef = useRef(createKeyedSerialRunner<null>('after-reaction'));
  const proxySaveQueueRef = useRef(createKeyedSerialRunner<null>());
  const ownerRef = useRef<AbortController | null>(null);
  const bootstrapReadRef = useRef<Promise<NetworkProxyState> | null>(null);
  if (!ownerRef.current) ownerRef.current = new AbortController();

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  const setApplyState = useCallback((phase: ProxyApplyPhase, confirmed = applyStateRef.current.confirmed) => {
    const state: ProxyApplyState = { ...phase, confirmed };
    applyStateRef.current = state;
    setApplyStateValue(state);
  }, []);

  const applyStatus = applyState.kind;
  const applyError = applyState.kind === 'failed' ? applyState.error : '';
  const confirmedState = applyState.confirmed;
  const effectiveMode = confirmedState ? networkMode(confirmedState) : undefined;
  const loaded = applyStatus !== 'loading';
  const activeProfile = useMemo(() => activeNetworkProxyProfile(proxyState), [proxyState]);
  const summary = networkProxySummary(confirmedState ?? proxyState, applyError);

  const applyPersistedProxyState = useCallback(
    (state: NetworkProxyState, parentTrace?: DiagnosticTrace, notifyOnFailure = false) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
      const profile = enabledNetworkProxyProfile(state);
      const trace = parentTrace || beginDiagnosticTrace('proxy', 'apply', diagnosticProxyState(state));
      const ownsTrace = !parentTrace;
      markDiagnosticStage(trace, 'apply', { channel: 'native', state: 'start' });
      const task = proxyApplyQueueRef.current
        .then(() => {
          requireNetworkProxyOwner(operation.owner);
          return applyNetworkProxy(profile);
        })
        .then(() => {
          const status: SettledApplyStatus = profile ? 'applied' : 'disabled';
          const current = applyStateRef.current;
          if (!operation.owner.signal.aborted && current.kind === 'applying' && current.operation === operation) {
            setApplyState({ kind: status }, state);
          }
          markDiagnosticStage(trace, 'apply', { channel: 'native', state: status });
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'success', { state: status });
          }
          return status;
        })
        .catch((error) => {
          const message = errorMessage(error);
          const current = applyStateRef.current;
          if (!operation.owner.signal.aborted && current.kind === 'applying' && current.operation === operation) {
            setApplyState({ kind: 'failed', cause: 'apply', error: message });
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
      const operation: ProxyApplyOperation = {
        owner,
        promise: task.then(
          () => undefined,
          () => undefined
        )
      };
      proxyApplyQueueRef.current = operation.promise;
      setApplyState({ kind: 'applying', operation });
      return task;
    },
    [setApplyState]
  );

  useLayoutEffect(() => {
    const previousOwner = ownerRef.current;
    const owner = previousOwner && !previousOwner.signal.aborted ? previousOwner : new AbortController();
    ownerRef.current = owner;
    setApplyState({ kind: 'loading' });
    if (!bootstrapReadRef.current) {
      const read = readPersistedProxyState().finally(() => {
        if (bootstrapReadRef.current === read) bootstrapReadRef.current = null;
      });
      bootstrapReadRef.current = read;
    }
    const read = bootstrapReadRef.current;
    const trace = beginDiagnosticTrace('proxy', 'load');
    const loadAndApply = async () => {
      let savedState: NetworkProxyState;
      try {
        savedState = await read;
      } catch (error) {
        if (owner.signal.aborted) {
          finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
          return;
        }
        const emptyState = createEmptyNetworkProxyState();
        const loadTimedOut = error instanceof RequestTimeoutError;
        const message = loadTimedOut
          ? '代理配置读取超时，已阻止网络请求，请前往“更多”确认代理设置。'
          : '代理配置读取失败，已阻止网络请求，请重启 App 后重试。';
        proxyStateRef.current = emptyState;
        setProxyState(emptyState);
        setApplyState({ kind: 'failed', cause: 'storage', error: message });
        notifyRef.current(message);
        markDiagnosticStage(trace, 'persist', { store: 'secure-store', state: 'failure' });
        finishDiagnosticTrace(trace, 'failure', { reason: loadTimedOut ? 'timeout' : 'storage_error' });
        return;
      }
      if (owner.signal.aborted) {
        finishDiagnosticTrace(trace, 'canceled', { reason: 'canceled' });
        return;
      }
      proxyStateRef.current = savedState;
      setProxyState(savedState);
      const fields = diagnosticProxyState(savedState);
      markDiagnosticStage(trace, 'persist', { store: 'secure-store', ...fields });
      finishDiagnosticTrace(trace, 'success', fields);
      await applyPersistedProxyState(savedState, undefined, true).catch(() => undefined);
    };
    const loading = loadAndApply();
    const task = withAbortableTimeout(() => loading, {
      signal: owner.signal,
      canceledError: () => new Error(NETWORK_PROXY_RUNTIME_ENDED_MESSAGE)
    }).catch((error) => {
      if (!owner.signal.aborted) throw error;
    });
    loadPromiseRef.current = task;
    return () => owner.abort();
  }, [applyPersistedProxyState, setApplyState]);

  const replaceProxyState = useCallback(
    (
      update: (current: NetworkProxyState) => NetworkProxyState,
      parentTrace?: DiagnosticTrace,
      options?: { resetInvalid?: boolean; retryActiveId?: string }
    ) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
      const task = proxySaveQueueRef.current.run(null, async () => {
        requireNetworkProxyOwner(owner);
        await loadPromiseRef.current;
        requireNetworkProxyOwner(owner);
        const previous = proxyStateRef.current;
        const apply = applyStateRef.current;
        const unreadable = apply.kind === 'failed' && apply.cause === 'storage';
        const base = unreadable
          ? await readPersistedProxyState().catch((error) => {
              if (options?.resetInvalid && error instanceof InvalidSavedNetworkProxyStateError) return previous;
              throw error;
            })
          : previous;
        requireNetworkProxyOwner(owner);
        const next = update(base);
        const retryActive =
          apply.kind === 'failed' && options?.retryActiveId != null && base.activeId === options.retryActiveId;
        if (next === base && !unreadable && !retryActive) {
          return { previous: base, requiresApply: false, state: previous };
        }
        const trace = parentTrace || beginDiagnosticTrace('proxy', 'save', diagnosticProxyState(next));
        const ownsTrace = !parentTrace;
        try {
          const saved = next === base ? base : await persistNetworkProxyState(next, owner);
          markDiagnosticStage(trace, 'persist', { store: 'secure-store', ...diagnosticProxyState(saved) });
          if (owner.signal.aborted) {
            if (ownsTrace) finishDiagnosticTrace(trace, 'success', diagnosticProxyState(saved));
            return { previous: base, requiresApply: false, state: saved };
          }
          const requiresApply =
            applyStateRef.current.kind === 'failed' || networkProxyApplyKey(previous) !== networkProxyApplyKey(saved);
          if (requiresApply) {
            // Keep admission closed while the save's caller resumes before enqueueing Native work.
            setApplyState({ kind: 'applying', operation: { owner, promise: proxyApplyQueueRef.current } });
          }
          proxyStateRef.current = saved;
          setProxyState(saved);
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'success', diagnosticProxyState(saved));
          }
          return { previous: base, requiresApply, state: saved };
        } catch (error) {
          if (!owner.signal.aborted) {
            proxyStateRef.current = previous;
            setProxyState(previous);
            markDiagnosticStage(trace, 'rollback', { state: 'restored' });
          }
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'failure', { reason: 'storage_error' });
          }
          throw error;
        }
      });
      return task;
    },
    [setApplyState]
  );

  const setNetworkMode = useCallback(
    (mode: NetworkMode) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
      return networkModeQueueRef.current.run(null, async () => {
        requireNetworkProxyOwner(owner);
        const trace = beginDiagnosticTrace('proxy', 'set-mode', { isEnabled: mode !== 'system' });
        try {
          const result = await replaceProxyState(
            (state) => {
              if (mode === 'proxy' && !activeNetworkProxyProfile(state)) throw new Error('请先选择一个代理。');
              if (networkMode(state) === mode && applyStateRef.current.kind !== 'failed') return state;
              return { ...state, enabled: mode === 'proxy' };
            },
            trace,
            { resetInvalid: mode === 'system' }
          );
          if (!result.requiresApply) {
            finishDiagnosticTrace(trace, 'noop');
            return;
          }
          try {
            const status = await applyPersistedProxyState(result.state, trace);
            finishDiagnosticTrace(trace, 'success', { state: status });
          } catch (error) {
            if (!owner.signal.aborted) {
              const rollback = await replaceProxyState((current) => {
                if (networkMode(current) !== mode) return current;
                return {
                  ...current,
                  enabled: result.previous.enabled && Boolean(activeNetworkProxyProfile(current))
                };
              }).catch(() => undefined);
              if (rollback?.requiresApply) await applyPersistedProxyState(rollback.state).catch(() => undefined);
            }
            throw error;
          }
        } catch (error) {
          finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          throw error;
        }
      });
    },
    [applyPersistedProxyState, replaceProxyState]
  );

  const upsertProxyProfile = useCallback(
    async (input: Partial<NetworkProxyProfile>) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
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
          ? latest.profiles.map((item) => (item.id === profile.id ? profile : item))
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
      requireNetworkProxyOwner(owner);
      if (result.requiresApply) {
        await applyPersistedProxyState(result.state);
      }
    },
    [applyPersistedProxyState, replaceProxyState]
  );

  const deleteProxyProfile = useCallback(
    async (id: string) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
      const result = await replaceProxyState((current) => {
        if (!current.profiles.some((profile) => profile.id === id)) {
          return current;
        }
        return removeNetworkProxyProfile(current, id);
      });
      requireNetworkProxyOwner(owner);
      if (result.requiresApply) {
        await applyPersistedProxyState(result.state);
      }
    },
    [applyPersistedProxyState, replaceProxyState]
  );

  const selectProxyProfile = useCallback(
    async (id: string) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
      const result = await replaceProxyState(
        (latest) => {
          if (!latest.profiles.some((profile) => profile.id === id) || latest.activeId === id) {
            return latest;
          }
          return {
            ...latest,
            activeId: id
          };
        },
        undefined,
        { retryActiveId: id }
      );
      requireNetworkProxyOwner(owner);
      if (result.requiresApply) {
        await applyPersistedProxyState(result.state);
      }
    },
    [applyPersistedProxyState, replaceProxyState]
  );

  const ensureNetworkProxyReady = useCallback(async () => {
    const owner = requireNetworkProxyOwner(ownerRef.current);
    await withAbortableTimeout(
      async () => {
        requireNetworkProxyOwner(owner);
        while (true) {
          const waiting = applyStateRef.current;
          if (waiting.kind !== 'loading' && waiting.kind !== 'applying') break;
          await (waiting.kind === 'loading' ? loadPromiseRef.current : waiting.operation.promise);
          requireNetworkProxyOwner(owner);
        }
        const current = proxyStateRef.current;
        const apply = applyStateRef.current;
        if (apply.kind === 'failed') {
          const trace = beginDiagnosticTrace('proxy', 'guard', {
            isEnabled: current.enabled,
            hasProxy: Boolean(activeNetworkProxyProfile(current)),
            state: 'failed'
          });
          finishDiagnosticTrace(trace, 'blocked', { reason: 'network_error' });
          throw new Error(apply.error || '代理状态不确定，请重新应用代理设置。');
        }
        if (networkMode(current) === 'system') {
          return;
        }
        if (!enabledNetworkProxyProfile(current)) {
          const trace = beginDiagnosticTrace('proxy', 'guard', { isEnabled: true, hasProxy: false });
          finishDiagnosticTrace(trace, 'blocked', { reason: 'missing_credential' });
          throw new Error('代理未选择。');
        }
        if (apply.kind !== 'applied') {
          const trace = beginDiagnosticTrace('proxy', 'guard', {
            isEnabled: true,
            hasProxy: true,
            state: apply.kind
          });
          finishDiagnosticTrace(trace, 'blocked', {
            reason: 'not_ready'
          });
          throw new Error('代理未生效。');
        }
      },
      { signal: owner.signal, canceledError: () => new Error(NETWORK_PROXY_RUNTIME_ENDED_MESSAGE) }
    );
  }, []);

  const networkProxyFetcher: Fetcher = useCallback(
    async (input, init) => {
      const owner = requireNetworkProxyOwner(ownerRef.current);
      await ensureNetworkProxyReady();
      requireNetworkProxyOwner(owner);
      const requestInit = Platform.OS === 'android' ? withNativeDiagnosticRequest(init) : init;
      return baseFetcher(input, prepareRequestToSend(withNativeForumReadIntent(input, requestInit)));
    },
    [baseFetcher, ensureNetworkProxyReady]
  );

  useEffect(() => registerAppNetworkProxy(ensureNetworkProxyReady), [ensureNetworkProxyReady]);
  useEffect(() => setDefaultAvatarFetcher(networkProxyFetcher), [networkProxyFetcher]);

  const webViewBlockMessage = networkProxyWebViewBlockMessage({
    applyError,
    applyStatus,
    enabled: networkMode(proxyState) !== 'system',
    loaded
  });

  return {
    activeProfile,
    applyError,
    applyStatus,
    confirmedState,
    effectiveMode,
    ensureNetworkProxyReady,
    loaded,
    networkProxyFetcher,
    proxyState,
    summary,
    webViewBlockMessage,
    deleteProxyProfile,
    selectProxyProfile,
    setNetworkMode,
    upsertProxyProfile
  };
}
