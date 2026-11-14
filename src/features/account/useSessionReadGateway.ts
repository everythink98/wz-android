import { useMemo } from 'react';
import type { Fetcher } from '@/platform/network/request';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { createReadGateway } from '@/sources/readGateway';
import type { DiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';

export function useSessionReadGateway({
  reading,
  anonymousFetcher,
  beforeRequest,
  fetcher,
  getEnabledSources,
  getLinuxDoUserAgent,
  getNodeSeekUserAgent,
  onSessionExpired,
  requestAccountRecheck,
  readSessionRuntimeSnapshot
}: {
  reading?: DiscourseReadingRuntime;
  anonymousFetcher: Fetcher;
  beforeRequest?: () => Promise<void>;
  fetcher: Fetcher;
  getEnabledSources: () => readonly Source[];
  getLinuxDoUserAgent: () => string;
  getNodeSeekUserAgent: () => string;
  onSessionExpired: (source: SessionSite, requestSessionEpoch: number) => void;
  requestAccountRecheck: RequestAccountRecheck;
  readSessionRuntimeSnapshot: (source: SessionSite) => SessionRuntimeSnapshot;
}) {
  return useMemo(
    () =>
      createReadGateway({
        reading,
        anonymousFetcher,
        beforeRequest,
        fetcher,
        getEnabledSources,
        linuxDoUserAgent: getLinuxDoUserAgent,
        nodeSeekUserAgent: getNodeSeekUserAgent,
        onSessionExpired,
        requestAccountRecheck,
        readSessionRuntimeSnapshot
      }),
    [
      reading,
      anonymousFetcher,
      beforeRequest,
      fetcher,
      getEnabledSources,
      getLinuxDoUserAgent,
      getNodeSeekUserAgent,
      onSessionExpired,
      requestAccountRecheck,
      readSessionRuntimeSnapshot
    ]
  );
}
