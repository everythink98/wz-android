import { createContext, useContext, type ReactNode } from 'react';
import type { ReaderState, ReaderCommand } from '@/domain/reader/readerRecordState';
import type { Category } from '@/domain/forum/models';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';

export type LibraryRouteRuntimeValue = {
  categories: Category[];
  enabledSources: readonly Source[];
  notify: (message: string) => void;
  topicStateIndex: TopicListItemStateIndex;
  reader: {
    commit: (command: ReaderCommand) => void;
    data: ReaderState;
    dataRef: { current: ReaderState };
    loaded: boolean;
  };
};

const LibraryRouteRuntimeContext = createContext<LibraryRouteRuntimeValue | null>(null);

export function LibraryRouteRuntimeProvider({
  children,
  value
}: {
  children: ReactNode;
  value: LibraryRouteRuntimeValue;
}) {
  return <LibraryRouteRuntimeContext.Provider value={value}>{children}</LibraryRouteRuntimeContext.Provider>;
}

export function useLibraryRouteRuntime() {
  const runtime = useContext(LibraryRouteRuntimeContext);
  if (!runtime) throw new Error('LibraryRouteRuntimeProvider is required');
  return runtime;
}
