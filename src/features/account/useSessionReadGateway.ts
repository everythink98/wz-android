import { useMemo } from 'react';
import type { Fetcher } from '@/platform/network/request';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { createReadGateway } from '@/sources/readGateway';

export function useSessionReadGateway({
  anonymousFetcher,
  fetcher,
  getEnabledSources,
  linuxDoUserAgentRef,
  nodeSeekUserAgentRef,
  onSessionExpired,
  requestAccountRecheck,
  readSessionRuntimeSnapshot
}: {
  anonymousFetcher: Fetcher;
  fetcher: Fetcher;
  getEnabledSources: () => readonly Source[];
  linuxDoUserAgentRef: { current: string };
  nodeSeekUserAgentRef: { current: string };
  onSessionExpired: (source: SessionSite, requestSessionEpoch: number) => void;
  requestAccountRecheck: RequestAccountRecheck;
  readSessionRuntimeSnapshot: (source: SessionSite) => SessionRuntimeSnapshot;
}) {
  return useMemo(
    () =>
      createReadGateway({
        anonymousFetcher,
        fetcher,
        getEnabledSources,
        linuxDoUserAgent: () => linuxDoUserAgentRef.current,
        nodeSeekUserAgent: () => nodeSeekUserAgentRef.current,
        onSessionExpired,
        requestAccountRecheck,
        readSessionRuntimeSnapshot
      }),
    [
      anonymousFetcher,
      fetcher,
      getEnabledSources,
      linuxDoUserAgentRef,
      nodeSeekUserAgentRef,
      onSessionExpired,
      requestAccountRecheck,
      readSessionRuntimeSnapshot
    ]
  );
}
