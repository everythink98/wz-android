import { useCallback, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  LINUXDO_USER_AGENT_STORAGE_KEY,
  NODESEEK_USER_AGENT_STORAGE_KEY,
  sanitizeWebViewUserAgent
} from '@/platform/android/userAgent';
import { migrateLegacyCookieSnapshots } from '@/platform/storage/legacyCookieSnapshotMigration';
import {
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  replaceCredentialWrite
} from '@/platform/storage/credentialWriteGate';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type UserAgentSite = 'nodeseek' | 'linuxdo';
type ReadRun = { owner: AbortSignal };
type MigrationRun = {
  phase: 'running';
  request: object;
  owner: AbortSignal;
  sources: readonly SessionSite[];
};
type Migration = MigrationRun | { phase: 'requested' | 'ready' | 'failed'; request: object };
type Restoration =
  | { phase: 'requested-agents' | 'agents-failed'; attempt: number }
  | { phase: 'reading-agents'; attempt: number; run: ReadRun }
  | {
      phase: 'restoring-sources';
      attempt: number;
      restored: readonly SessionSite[];
      migration: Migration;
    };
type IdentityState = {
  userAgents: Readonly<Record<UserAgentSite, string>>;
  restoration: Restoration;
  feedback: 'none' | 'restore-failed';
};

const RESTORE_ERROR = '本地登录身份读取失败，请重试';
const storageKey = (site: UserAgentSite) =>
  site === 'nodeseek' ? NODESEEK_USER_AGENT_STORAGE_KEY : LINUXDO_USER_AGENT_STORAGE_KEY;

export function useLocalIdentityRestore({
  ready,
  enabledSources,
  notify
}: {
  ready: boolean;
  enabledSources: readonly SessionSite[];
  notify: (message: string) => void;
}) {
  const [state, setState] = useState<IdentityState>({
    userAgents: { nodeseek: '', linuxdo: '' },
    restoration: { phase: 'requested-agents', attempt: 0 },
    feedback: 'none'
  });
  const stateRef = useRef(state);
  const enabledSourcesRef = useCommittedRef(enabledSources);
  const readyRef = useCommittedRef(ready);
  const notifyRef = useCommittedRef(notify);
  const gates = useRef({ nodeseek: createCredentialWriteGate(), linuxdo: createCredentialWriteGate() });
  const writes = useRef<Partial<Record<UserAgentSite, Promise<unknown>>>>({});
  const publish = useCallback((update: (current: IdentityState) => IdentityState) => {
    const next = update(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);
  const setUserAgent = useCallback(
    (site: UserAgentSite, value: string) =>
      publish((current) =>
        current.userAgents[site] === value
          ? current
          : { ...current, userAgents: { ...current.userAgents, [site]: value } }
      ),
    [publish]
  );
  const getUserAgent = useCallback((site: UserAgentSite) => stateRef.current.userAgents[site], []);
  const commitUserAgent = useCallback(
    (site: UserAgentSite, value: string) => {
      setUserAgent(site, value);
      const write = replaceCredentialWrite(gates.current[site], () =>
        SecureStore.setItemAsync(storageKey(site), value)
      );
      writes.current[site] = write;
      void write.catch(() => undefined);
    },
    [setUserAgent]
  );
  const restoration = state.restoration;
  const { attempt } = restoration;
  const agentsReady = restoration.phase === 'restoring-sources';
  const restoredSources = agentsReady ? restoration.restored : undefined;
  const migrationRequest = agentsReady ? restoration.migration.request : undefined;
  const isSourceIdentityReady = useCallback(
    (source: SessionSite) => ready && agentsReady && restoredSources?.includes(source) === true,
    [agentsReady, ready, restoredSources]
  );
  const retry = useCallback(() => {
    publish((current) => {
      const previous = current.restoration;
      if (previous.phase === 'agents-failed')
        return { ...current, restoration: { phase: 'requested-agents', attempt: previous.attempt + 1 } };
      if (previous.phase === 'restoring-sources' && previous.migration.phase === 'failed')
        return {
          ...current,
          restoration: { ...previous, migration: { phase: 'requested', request: {} } }
        };
      return current;
    });
  }, [publish]);

  useEffect(() => {
    const controller = new AbortController();
    const run: ReadRun = { owner: controller.signal };
    publish((current) => ({
      ...current,
      restoration: { phase: 'reading-agents', attempt, run },
      feedback: 'none'
    }));
    const isCurrent = () => {
      const current = stateRef.current.restoration;
      return !run.owner.aborted && current.phase === 'reading-agents' && current.run === run;
    };
    const generations = { nodeseek: gates.current.nodeseek.generation, linuxdo: gates.current.linuxdo.generation };
    void Promise.all([
      SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY),
      SecureStore.getItemAsync(LINUXDO_USER_AGENT_STORAGE_KEY)
    ])
      .then(([nodeSeekUserAgent, linuxDoUserAgent]) => {
        if (!isCurrent()) return;
        if (generations.nodeseek === 0 && gates.current.nodeseek.generation === 0)
          setUserAgent('nodeseek', sanitizeWebViewUserAgent(nodeSeekUserAgent ?? ''));
        if (generations.linuxdo === 0 && gates.current.linuxdo.generation === 0)
          setUserAgent('linuxdo', sanitizeWebViewUserAgent(linuxDoUserAgent ?? ''));
        publish((current) => ({
          ...current,
          restoration: {
            phase: 'restoring-sources',
            attempt,
            restored: [],
            migration: { phase: 'requested', request: {} }
          }
        }));
      })
      .catch(() => {
        if (!isCurrent()) return;
        publish((current) => ({
          ...current,
          restoration: { phase: 'agents-failed', attempt },
          feedback: 'restore-failed'
        }));
        notifyRef.current(RESTORE_ERROR);
      });
    return () => controller.abort();
  }, [attempt, notifyRef, publish, setUserAgent]);

  useEffect(() => {
    if (!ready || !agentsReady || !migrationRequest) return;
    const current = stateRef.current.restoration;
    if (current.phase !== 'restoring-sources' || current.migration.request !== migrationRequest) return;
    const pendingSources = enabledSources.filter((source) => !restoredSources?.includes(source));
    if (!pendingSources.length) {
      publish((value) => {
        const previous = value.restoration;
        return previous.phase === 'restoring-sources' &&
          (previous.migration.phase !== 'ready' || value.feedback !== 'none')
          ? {
              ...value,
              restoration: { ...previous, migration: { phase: 'ready', request: migrationRequest } },
              feedback: 'none'
            }
          : value;
      });
      return;
    }
    const controller = new AbortController();
    const run: MigrationRun = {
      phase: 'running',
      request: migrationRequest,
      owner: controller.signal,
      sources: pendingSources
    };
    publish((value) => {
      const previous = value.restoration;
      return previous.phase === 'restoring-sources'
        ? { ...value, restoration: { ...previous, migration: run } }
        : value;
    });
    const isCurrent = () => {
      const previous = stateRef.current.restoration;
      return (
        !run.owner.aborted &&
        readyRef.current &&
        previous.phase === 'restoring-sources' &&
        previous.migration === run &&
        enabledSourcesRef.current.length === enabledSources.length &&
        enabledSources.every((source) => enabledSourcesRef.current.includes(source))
      );
    };
    void migrateLegacyCookieSnapshots({
      enabledSources: run.sources,
      isCurrent,
      restoreUserAgent: async (site, legacyUserAgent) => {
        const gate = gates.current[site];
        const currentAgent = getUserAgent(site);
        if (isCurrent() && (!currentAgent || gate.generation > 0)) {
          const userAgent = currentAgent || sanitizeWebViewUserAgent(legacyUserAgent);
          const write = enqueueCredentialWriteForGeneration(
            gate,
            gate.generation,
            async ({ isCurrent: writeIsCurrent }) => {
              if (!isCurrent()) return;
              await SecureStore.setItemAsync(storageKey(site), userAgent);
              if (isCurrent() && writeIsCurrent()) setUserAgent(site, userAgent);
            }
          );
          writes.current[site] = write;
          await write;
        }
        // A Native identity may replace a pending legacy write before its old key can be deleted.
        let write = writes.current[site];
        while (write) {
          await write;
          if (!isCurrent() || write === writes.current[site]) break;
          write = writes.current[site];
        }
      }
    })
      .then((migration) => {
        if (!isCurrent()) return;
        if (Object.values(migration).some((result) => result === 'retained'))
          throw new Error('Local identity restore is incomplete');
        publish((value) => {
          const previous = value.restoration;
          return previous.phase === 'restoring-sources'
            ? {
                ...value,
                restoration: {
                  ...previous,
                  restored: [...new Set([...previous.restored, ...run.sources])],
                  migration: { phase: 'ready', request: run.request }
                },
                feedback: 'none'
              }
            : value;
        });
      })
      .catch(() => {
        if (!isCurrent()) return;
        publish((value) => {
          const previous = value.restoration;
          return previous.phase === 'restoring-sources'
            ? {
                ...value,
                restoration: { ...previous, migration: { phase: 'failed', request: run.request } },
                feedback: 'restore-failed'
              }
            : value;
        });
        notifyRef.current(RESTORE_ERROR);
      });
    return () => controller.abort();
  }, [
    agentsReady,
    enabledSources,
    enabledSourcesRef,
    getUserAgent,
    migrationRequest,
    notifyRef,
    publish,
    ready,
    readyRef,
    restoredSources,
    setUserAgent
  ]);

  return {
    userAgents: state.userAgents,
    getUserAgent,
    commitUserAgent,
    isSourceIdentityReady,
    ready: ready && agentsReady && enabledSources.every(isSourceIdentityReady),
    error: state.feedback === 'restore-failed' ? RESTORE_ERROR : '',
    retry
  };
}
