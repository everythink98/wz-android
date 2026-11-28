import { useMemo } from 'react';
import type { Fetcher } from '@/platform/network/request';
import type { SessionSite } from '@/domain/session/siteSessionState';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { ForumReadSession } from '@/domain/forum/readPlan';
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
  pendingLinuxDoReadRecheck,
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
  pendingLinuxDoReadRecheck: (epoch: number, identityKey: string | undefined) => Promise<void> | undefined;
  readSessionRuntimeSnapshot: (source: SessionSite) => ForumReadSession;
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
        pendingLinuxDoReadRecheck,
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
      pendingLinuxDoReadRecheck,
      readSessionRuntimeSnapshot
    ]
  );
}
