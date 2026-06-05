import { topicKey, type ReaderData, type ReaderSettings } from './readerData';
import type { Topic } from './types';

export interface TopicListItemState {
  favorite: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
}

export type NormalizedTopicListStateInput = Record<string, never>;

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

export function getTopicListItemState(data: ReaderData, topic: Topic, input?: NormalizedTopicListStateInput): TopicListItemState {
  const key = topicKey(topic);
  void input;
  return {
    favorite: Boolean(data.favorites[key]),
    listDensity: data.settings.listDensity,
    read: Boolean(data.history[key])
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

export function topicListItemStatesEqual(left: TopicListItemState, right: TopicListItemState) {
  return left.favorite === right.favorite
    && left.listDensity === right.listDensity
    && left.read === right.read;
}
