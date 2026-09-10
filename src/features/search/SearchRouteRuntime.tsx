import { createContext, useContext, type ReactNode } from 'react';
import type { Category } from '@/domain/forum/models';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderView } from '@/domain/reader/readerRecordState';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';

export type SearchRouteRuntimeValue = {
  account: {
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<AccountReconcileResult>;
    requestNodeSeekVerification: (message: string, recovery?: LinuxDoReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    sessionViewModels: SiteSessionViewModels;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  catalogCategories: Category[];
  notify: (message: string) => void;
  readerData: ReaderView;
  topicStateIndex: TopicListItemStateIndex;
};

const SearchRouteRuntimeContext = createContext<SearchRouteRuntimeValue | null>(null);

export function SearchRouteRuntimeProvider({
  children,
  value
}: {
  children: ReactNode;
  value: SearchRouteRuntimeValue;
}) {
  return <SearchRouteRuntimeContext.Provider value={value}>{children}</SearchRouteRuntimeContext.Provider>;
}

export function useSearchRouteRuntime() {
  const runtime = useContext(SearchRouteRuntimeContext);
  if (!runtime) throw new Error('SearchRouteRuntimeProvider is required');
  return runtime;
}
