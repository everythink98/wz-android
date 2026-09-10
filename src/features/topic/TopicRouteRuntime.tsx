import { createContext, useContext, type ReactNode } from 'react';
import type { Fetcher } from '@/platform/network/request';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import type { ReaderView, ReaderCommand } from '@/domain/reader/readerRecordState';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { LinuxDoReadRecovery, RequestAccountRecheck } from '@/domain/session/sessionContracts';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { ReaderStyleContextValue } from '@/ui/theme/ReaderStyleProvider';

export type TopicRouteRuntimeValue = {
  account: {
    sessionEpochs: ForumSessionEpochs;
    sessionViewModels: SiteSessionViewModels;
    ensureNodeImageApiKey: () => Promise<string | null>;
    ensureWritableSession: (source: SessionSource) => Promise<WritableSessionTicket>;
    isWritableSessionTicketCurrent: (ticket: WritableSessionTicket) => boolean;
    getLinuxDoUserAgent: () => string;
    linuxDoVerificationVisible: boolean;
    getNodeSeekUserAgent: () => string;
    nodeSeekUserId: number | null;
    onSessionExpired: (source: SessionSource, requestSessionEpoch: number) => void;
    requestAccountRecheck: RequestAccountRecheck;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery: LinuxDoReadRecovery) => void;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  appActive: boolean;
  contentWidth: number;
  ensureNetworkProxyReady: () => Promise<void>;
  fetcher: Fetcher;
  networkProxyWebViewBlockMessage: string;
  nodeSeekMediaUserAgent: string;
  notify: (message: string) => void;
  reader: {
    commit: (command: ReaderCommand) => void;
    data: ReaderView;
    dataRef: { current: ReaderView };
  };
  readerStyle: ReaderStyleContextValue;
};

const TopicRouteRuntimeContext = createContext<TopicRouteRuntimeValue | null>(null);

export function TopicRouteRuntimeProvider({ children, value }: { children: ReactNode; value: TopicRouteRuntimeValue }) {
  return <TopicRouteRuntimeContext.Provider value={value}>{children}</TopicRouteRuntimeContext.Provider>;
}

export function useTopicRouteRuntime() {
  const runtime = useContext(TopicRouteRuntimeContext);
  if (!runtime) throw new Error('TopicRouteRuntimeProvider is required');
  return runtime;
}
