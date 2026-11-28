import type { ReaderMembership } from '@/domain/reader/readerRecordState';
import { topicKey, type ReaderSettings } from '@/domain/reader/readerData';
import type { Topic } from './models';
import type { DiscourseVisitedState } from './discourseReading';

export interface TopicListItemState {
  favorite: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
  hasNewReplies?: boolean;
}
export interface TopicListItemStateIndex {
  reading?: DiscourseVisitedState;
  favorites: ReaderMembership['favorites'];
  history: ReaderMembership['history'];
  listDensity: ReaderSettings['listDensity'];
}

type TopicListItemStateData = Pick<ReaderMembership, 'favorites' | 'history'> & {
  reading?: DiscourseVisitedState;
  settings: Pick<ReaderSettings, 'listDensity'>;
};

export function createTopicListItemStateIndex(data: TopicListItemStateData): TopicListItemStateIndex {
  return {
    ...(data.reading ? { reading: data.reading } : {}),
    favorites: data.favorites,
    history: data.history,
    listDensity: data.settings.listDensity
  };
}

export function getTopicListItemStateFromIndex(index: TopicListItemStateIndex, topic: Topic): TopicListItemState {
  const key = topicKey(topic);
  return {
    favorite: Object.hasOwn(index.favorites, key),
    listDensity: index.listDensity,
    read: isTopicVisited(index.history, topic, index.reading),
    ...(topic.source === 'linuxdo' && !topic.isPrivateMessage && index.reading?.[topic.id]?.hasNewReplies
      ? { hasNewReplies: true }
      : {})
  };
}

type TopicListItemSelection = {
  getSnapshot(): TopicListItemState;
  subscribe(listener: () => void): () => void;
};

export function createTopicListItemStateStore(initial: TopicListItemStateIndex) {
  let index = initial;
  const listeners = new Set<() => void>();
  return {
    select(topic: Topic): TopicListItemSelection {
      let currentIndex = index;
      let snapshot = getTopicListItemStateFromIndex(index, topic);
      const getSnapshot = () => {
        if (currentIndex !== index) {
          currentIndex = index;
          const next = getTopicListItemStateFromIndex(index, topic);
          if (
            next.favorite !== snapshot.favorite ||
            next.read !== snapshot.read ||
            next.hasNewReplies !== snapshot.hasNewReplies ||
            next.listDensity !== snapshot.listDensity
          ) {
            snapshot = next;
          }
        }
        return snapshot;
      };
      return {
        getSnapshot,
        subscribe(listener) {
          const onIndexChange = () => {
            const previous = snapshot;
            if (getSnapshot() !== previous) listener();
          };
          listeners.add(onIndexChange);
          return () => {
            listeners.delete(onIndexChange);
          };
        }
      };
    },
    setIndex(next: TopicListItemStateIndex) {
      if (next === index) return;
      index = next;
      listeners.forEach((listener) => listener());
    }
  };
}

export type TopicListItemStateSource =
  TopicListItemStateIndex | Pick<ReturnType<typeof createTopicListItemStateStore>, 'select'>;

export function selectTopicListItemState(source: TopicListItemStateSource, topic: Topic): TopicListItemSelection {
  if ('select' in source) return source.select(topic);
  const snapshot = getTopicListItemStateFromIndex(source, topic);
  return { getSnapshot: () => snapshot, subscribe: () => () => undefined };
}

export function isTopicVisited(history: ReaderMembership['history'], topic: Topic, reading?: DiscourseVisitedState) {
  return (
    Object.hasOwn(history, topicKey(topic)) ||
    (topic.source === 'linuxdo' && !topic.isPrivateMessage && Boolean(reading?.[topic.id]?.visited))
  );
}
