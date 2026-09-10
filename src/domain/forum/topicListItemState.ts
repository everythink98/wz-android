import type { ReaderMembership } from '@/domain/reader/readerRecordState';
import { topicKey, type ReaderSettings } from '@/domain/reader/readerData';
import type { Topic } from './models';

export interface TopicListItemState {
  favorite: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
}
export interface TopicListItemStateIndex {
  favorites: ReaderMembership['favorites'];
  history: ReaderMembership['history'];
  listDensity: ReaderSettings['listDensity'];
}

type TopicListItemStateData = Pick<ReaderMembership, 'favorites' | 'history'> & {
  settings: Pick<ReaderSettings, 'listDensity'>;
};

export function createTopicListItemStateIndex(data: TopicListItemStateData): TopicListItemStateIndex {
  return {
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
    read: Object.hasOwn(index.history, key)
  };
}
