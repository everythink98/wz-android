import { createContext, useContext, type ReactNode } from 'react';
import type { ReaderState, ReaderCommand } from '@/domain/reader/readerRecordState';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { TopicListItemStateSource } from '@/domain/forum/topicListItemState';
import type { ReadGateway } from '@/sources/readGateway';

export type LibraryRouteRuntimeValue = {
  readingGateway?: Pick<ReadGateway, 'getReadingBatch' | 'reading'>;
  enabledSources: readonly Source[];
  notify: (message: string) => void;
  topicStateIndex: TopicListItemStateSource;
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
