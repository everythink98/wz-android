import { createContext, useContext, type ReactNode } from 'react';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderView, ReaderCommand } from '@/domain/reader/readerRecordState';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';

export type UserRouteRuntimeValue = {
  account: {
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery?: LinuxDoReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  appActive: boolean;
  nodeSeekMessaging: { identityKey: string | undefined; available: boolean };
  notify: (message: string) => void;
  topicStateIndex: TopicListItemStateIndex;
  reader: {
    commit: (command: ReaderCommand) => void;
    data: ReaderView;
    dataRef: { current: ReaderView };
  };
};

const UserRouteRuntimeContext = createContext<UserRouteRuntimeValue | null>(null);

export function UserRouteRuntimeProvider({ children, value }: { children: ReactNode; value: UserRouteRuntimeValue }) {
  return <UserRouteRuntimeContext.Provider value={value}>{children}</UserRouteRuntimeContext.Provider>;
}

export function useUserRouteRuntime() {
  const runtime = useContext(UserRouteRuntimeContext);
  if (!runtime) throw new Error('UserRouteRuntimeProvider is required');
  return runtime;
}
