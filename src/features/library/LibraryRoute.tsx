import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StackActions, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Category, Topic, UserReference } from '@/domain/forum/models';
import type { LibraryTab } from '@/domain/forum/feed';
import type { Source } from '@/domain/forum/sourceCatalog';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { normalizeUserReference } from '@/domain/forum/userNavigation';
import type { FollowedUserRecord, ReaderData, ReaderDataMutationReason } from '@/domain/reader/readerData';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { LibraryListItem } from './libraryScreenItems';
import { LibraryScreen } from './LibraryScreen';
import { EMPTY_LIBRARY_RECORDS, sortLibraryRecords } from './model/libraryFilters';
import { useReaderDataActionsController } from './useReaderDataActionsController';

export type LibraryRouteRuntimeValue = {
  categories: Category[];
  enabledSources: readonly Source[];
  notify: (message: string) => void;
  topicStateIndex: TopicListItemStateIndex;
  reader: {
    commit: (reason: ReaderDataMutationReason, updater: (current: ReaderData) => ReaderData) => void;
    data: ReaderData;
    dataRef: { current: ReaderData };
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

function useLibraryRouteRuntime() {
  const runtime = useContext(LibraryRouteRuntimeContext);
  if (!runtime) throw new Error('LibraryRouteRuntimeProvider is required');
  return runtime;
}

export function LibraryRoute() {
  const runtime = useLibraryRouteRuntime();
  const navigation = useNavigation();
  const listRef = useRef<FlashListRef<FollowedUserRecord | LibraryListItem> | null>(null);
  useScrollToTop(listRef);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('favorites');
  const actions = useReaderDataActionsController({
    commitReaderData: runtime.reader.commit,
    libraryTab,
    readerDataRef: runtime.reader.dataRef
  });
  const followedUsers = useMemo(
    () =>
      Object.values(runtime.reader.data.followedUsers).sort(
        (left, right) => Date.parse(right.followedAt) - Date.parse(left.followedAt)
      ),
    [runtime.reader.data.followedUsers]
  );
  const records = useMemo(
    () =>
      sortLibraryRecords(
        libraryTab === 'history'
          ? runtime.reader.data.history
          : libraryTab === 'favorites'
            ? runtime.reader.data.favorites
            : EMPTY_LIBRARY_RECORDS
      ),
    [libraryTab, runtime.reader.data.favorites, runtime.reader.data.history]
  );
  const openTopic = useCallback(
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );
  const openUser = useCallback(
    (user: UserReference) => {
      const normalized = normalizeUserReference(user);
      if (!normalized) {
        runtime.notify('用户信息不完整');
        return;
      }
      navigation.dispatch(StackActions.push('User', { user: normalized }));
    },
    [navigation, runtime]
  );
  const openContentSourceSettings = useCallback(() => navigation.dispatch(manageContentSourcesAction()), [navigation]);

  return (
    <LibraryScreen
      categories={runtime.categories}
      enabledSources={runtime.enabledSources}
      followedUsers={followedUsers}
      libraryTab={libraryTab}
      loaded={runtime.reader.loaded}
      records={records}
      scrollRef={listRef}
      topicStateIndex={runtime.topicStateIndex}
      onClearHistory={actions.clearHistory}
      onManageContentSources={openContentSourceSettings}
      onOpenTopic={openTopic}
      onOpenUser={openUser}
      onRemove={actions.removeLibraryTopic}
      onRemoveUser={actions.removeFollowedUser}
      onTabChange={setLibraryTab}
    />
  );
}
