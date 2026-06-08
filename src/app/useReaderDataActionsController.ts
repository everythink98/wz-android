import { useCallback, type MutableRefObject } from 'react';
import {
  clearRecords,
  removeFollowedUsers,
  removeRecords,
  toggleFavorite,
  toggleFollowedUser,
  type ReaderData,
  type ReaderSettings
} from '../readerData';
import type { LibraryTab } from '../feedLogic';
import type { Topic, UserProfile } from '../types';

export function useReaderDataActionsController({
  commitReaderData,
  libraryTab,
  readerDataRef
}: {
  commitReaderData: (updater: (current: ReaderData) => ReaderData) => void;
  libraryTab: LibraryTab;
  readerDataRef: MutableRefObject<ReaderData>;
}) {
  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    commitReaderData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...patch
      }
    }));
  }, [commitReaderData]);

  const toggleTopicFavorite = useCallback((topic: Topic) => {
    commitReaderData((current) => toggleFavorite(current, topic));
  }, [commitReaderData]);

  const toggleUserFollow = useCallback((user: UserProfile) => {
    commitReaderData((current) => toggleFollowedUser(current, user));
  }, [commitReaderData]);

  const removeFollowedUser = useCallback((user: UserProfile) => {
    commitReaderData((current) => removeFollowedUsers(current, [user]));
  }, [commitReaderData]);

  const removeLibraryTopic = useCallback((topic: Topic) => {
    const section = libraryTab === 'history' ? 'history' : 'favorites';
    commitReaderData((current) => removeRecords(current, section, [topic]));
  }, [commitReaderData, libraryTab]);

  const clearHistory = useCallback(() => {
    const records = readerDataRef.current.history;
    if (!Object.keys(records).length) {
      return;
    }
    commitReaderData((current) => clearRecords(current, 'history'));
  }, [commitReaderData, readerDataRef]);

  return {
    clearHistory,
    removeFollowedUser,
    removeLibraryTopic,
    toggleTopicFavorite,
    toggleUserFollow,
    updateSettings
  };
}
