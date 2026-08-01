import { topicKey, type ReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import type { Topic } from './models';

export interface TopicListItemState {
  favorite: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
}
export interface TopicListItemStateIndex {
  favorites: ReadonlySet<string>;
  history: ReadonlySet<string>;
  listDensity: ReaderSettings['listDensity'];
}

export function createTopicListItemStateIndex(data: ReaderData): TopicListItemStateIndex {
  return {
    favorites: new Set(Object.keys(data.favorites)),
    history: new Set(Object.keys(data.history)),
    listDensity: data.settings.listDensity
  };
}

export function getTopicListItemStateFromIndex(index: TopicListItemStateIndex, topic: Topic): TopicListItemState {
  const key = topicKey(topic);
  return {
    favorite: index.favorites.has(key),
    listDensity: index.listDensity,
    read: index.history.has(key)
  };
}
