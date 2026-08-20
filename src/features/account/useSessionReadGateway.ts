import { useMemo } from 'react';
import type { Fetcher } from '@/platform/network/request';
import type { SessionSite } from '@/domain/session/siteSessionState';
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
        fetcher,
        getEnabledSources,
        linuxDoUserAgent: () => linuxDoUserAgentRef.current,
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
