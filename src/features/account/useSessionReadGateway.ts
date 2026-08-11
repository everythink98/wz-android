import { useMemo } from 'react';
import { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import type { Fetcher } from '@/platform/network/request';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { createReadGateway } from '@/sources/readGateway';
import { currentXiaoyinsiCredentialGeneration, loadXiaoyinsiCredentials } from '@/sources/xiaoyinsi/auth';

export function useSessionReadGateway({
  anonymousFetcher,
  fetcher,
  getEnabledSources,
  linuxDoUserAgentRef,
  nodeSeekUserAgentRef,
  readSessionRuntimeSnapshot,
  refreshXiaoyinsiAuthorization
}: {
  anonymousFetcher: Fetcher;
  fetcher: Fetcher;
  getEnabledSources: () => readonly Source[];
  linuxDoUserAgentRef: { current: string };
  nodeSeekUserAgentRef: { current: string };
  readSessionRuntimeSnapshot: (source: SessionSite) => SessionRuntimeSnapshot;
  refreshXiaoyinsiAuthorization: (
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<boolean | null>;
}) {
  return useMemo(
    () =>
      createReadGateway({
        anonymousFetcher,
        currentXiaoyinsiCredentialGeneration,
        fetcher,
        getEnabledSources,
        linuxDoUserAgent: () => linuxDoUserAgentRef.current,
        loadXiaoyinsiCredentialsForSource: async (_source, options) => {
          const generation = currentXiaoyinsiCredentialGeneration();
          options?.captureGeneration?.(generation);
          const credentials = await loadXiaoyinsiCredentials();
          return generation === currentXiaoyinsiCredentialGeneration() ? credentials : undefined;
        },
        nodeSeekUserAgent: () => nodeSeekUserAgentRef.current,
        readSessionRuntimeSnapshot,
        refreshXiaoyinsiAuthorization
      }),
    [
      anonymousFetcher,
      fetcher,
      getEnabledSources,
      linuxDoUserAgentRef,
      nodeSeekUserAgentRef,
      readSessionRuntimeSnapshot,
      refreshXiaoyinsiAuthorization
    ]
  );
}
