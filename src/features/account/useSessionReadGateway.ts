import { useMemo } from 'react';
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
  onSessionExpired,
  readSessionRuntimeSnapshot
}: {
  anonymousFetcher: Fetcher;
  fetcher: Fetcher;
  getEnabledSources: () => readonly Source[];
  linuxDoUserAgentRef: { current: string };
  nodeSeekUserAgentRef: { current: string };
  onSessionExpired: (source: SessionSite, requestSessionEpoch: number) => void;
  readSessionRuntimeSnapshot: (source: SessionSite) => SessionRuntimeSnapshot;
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
        onSessionExpired,
        readSessionRuntimeSnapshot
      }),
    [
      anonymousFetcher,
      fetcher,
      getEnabledSources,
      linuxDoUserAgentRef,
      nodeSeekUserAgentRef,
      onSessionExpired,
      readSessionRuntimeSnapshot
    ]
  );
}
