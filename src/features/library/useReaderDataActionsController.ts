import { useCallback, type RefObject } from 'react';
import { topicKey, userKey } from '@/domain/reader/readerData';
import type { ReaderCommand, ReaderState } from '@/domain/reader/readerRecordState';
import type { Topic, UserProfile } from '@/domain/forum/models';

export function useReaderDataActionsController({
  commitReaderData,
  readerDataRef
}: {
  commitReaderData: (command: ReaderCommand) => void;
  readerDataRef: RefObject<ReaderState>;
}) {
  const toggleTopicFavorite = useCallback(
    (topic: Topic) => {
      commitReaderData({
        type: 'favorite',
        topic,
        enabled: !readerDataRef.current.favorites[topicKey(topic)],
        at: new Date().toISOString()
      });
    },
    [commitReaderData, readerDataRef]
  );
  const toggleUserFollow = useCallback(
    (user: UserProfile) => {
      commitReaderData({
        type: 'follow',
        user,
        enabled: !readerDataRef.current.followedUsers[userKey(user)],
        at: new Date().toISOString()
      });
    },
    [commitReaderData, readerDataRef]
  );
  const removeFollowedUser = useCallback(
    (user: UserProfile) => {
      commitReaderData({
        type: 'delete',
        collection: 'followedUsers',
        keys: [userKey(user)],
        at: new Date().toISOString()
      });
    },
    [commitReaderData]
  );
  const removeLibraryTopic = useCallback(
    (topic: Topic, collection: 'favorites' | 'history') => {
      commitReaderData({ type: 'delete', collection, keys: [topicKey(topic)], at: new Date().toISOString() });
    },
    [commitReaderData]
  );
  const clearHistory = useCallback(() => {
    if (readerDataRef.current.counts.history) commitReaderData({ type: 'clear-history', at: new Date().toISOString() });
  }, [commitReaderData, readerDataRef]);
  return { clearHistory, removeFollowedUser, removeLibraryTopic, toggleTopicFavorite, toggleUserFollow };
}
