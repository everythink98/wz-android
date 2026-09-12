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

export function isTopicVisited(history: ReaderMembership['history'], topic: Topic, reading?: DiscourseVisitedState) {
  return (
    Object.hasOwn(history, topicKey(topic)) ||
    (topic.source === 'linuxdo' && !topic.isPrivateMessage && Boolean(reading?.[topic.id]?.visited))
  );
}
