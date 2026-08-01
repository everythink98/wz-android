import { useCallback, type MutableRefObject } from 'react';
import {
  clearRecords,
  removeFollowedUsers,
  removeRecords,
  toggleFavorite,
  toggleFollowedUser,
  type ReaderData,
  type ReaderDataMutationReason
} from '@/domain/reader/readerData';
import type { LibraryTab } from '@/domain/forum/feed';
import type { Topic, UserProfile } from '@/domain/forum/models';

type CommitReaderData = (
  mutationReason: ReaderDataMutationReason,
  updater: (current: ReaderData) => ReaderData
) => void;

export function useReaderDataActionsController({
  commitReaderData,
  libraryTab,
  readerDataRef
}: {
  commitReaderData: CommitReaderData;
  libraryTab: LibraryTab;
  readerDataRef: MutableRefObject<ReaderData>;
}) {
  const toggleTopicFavorite = useCallback(
    (topic: Topic) => {
      commitReaderData('favorite-toggled', (current) => toggleFavorite(current, topic));
    },
    [commitReaderData]
  );

  const toggleUserFollow = useCallback(
    (user: UserProfile) => {
      commitReaderData('follow-toggled', (current) => toggleFollowedUser(current, user));
    },
    [commitReaderData]
  );

  const removeFollowedUser = useCallback(
    (user: UserProfile) => {
      commitReaderData('follow-removed', (current) => removeFollowedUsers(current, [user]));
    },
    [commitReaderData]
  );

  const removeLibraryTopic = useCallback(
    (topic: Topic) => {
      const section = libraryTab === 'history' ? 'history' : 'favorites';
      commitReaderData('library-topic-removed', (current) => removeRecords(current, section, [topic]));
    },
    [commitReaderData, libraryTab]
  );

  const clearHistory = useCallback(() => {
    const records = readerDataRef.current.history;
    if (!Object.keys(records).length) {
      return;
    }
    commitReaderData('history-cleared', (current) => clearRecords(current, 'history'));
  }, [commitReaderData, readerDataRef]);

  return {
    clearHistory,
    removeFollowedUser,
    removeLibraryTopic,
    toggleTopicFavorite,
    toggleUserFollow
  };
}
