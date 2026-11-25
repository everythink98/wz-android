import type { Source, SessionSource } from '@/domain/forum/sourceCatalog';
import { createContext, useContext, type ReactNode } from 'react';
import type { Category } from '@/domain/forum/models';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';

export type SearchRouteRuntimeValue = {
  enabledSources: Source[];
  account: {
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<AccountReconcileResult>;
    requestNodeSeekVerification: (message: string, recovery?: ReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    sessionViewModels: SiteSessionViewModels;
    showLinuxDoVerification: (message?: string, recovery?: ReadRecovery) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  catalogCategories: Category[];
  notify: (message: string) => void;
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
