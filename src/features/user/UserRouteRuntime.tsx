import type { Source, SessionSource } from '@/domain/forum/sourceCatalog';
import { createContext, useContext, type ReactNode } from 'react';
import type { TopicListItemStateSource } from '@/domain/forum/topicListItemState';
import type { ReaderView, ReaderCommand } from '@/domain/reader/readerRecordState';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';

export type UserRouteRuntimeValue = {
  enabledSources: Source[];
  account: {
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery?: ReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    showLinuxDoVerification: (message?: string, recovery?: ReadRecovery) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  appActive: boolean;
  nodeSeekMessaging: { identityKey: string | undefined; available: boolean };
  notify: (message: string) => void;
  topicStateIndex: TopicListItemStateSource;
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
