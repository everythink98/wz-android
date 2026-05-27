import { topicKey, type ReaderData, type ReaderSettings } from './readerData';
import type { Topic } from './types';

export interface TopicListItemState {
  favorite: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
}

export type NormalizedTopicListStateInput = Record<string, never>;

export function getTopicListItemState(data: ReaderData, topic: Topic, input?: NormalizedTopicListStateInput): TopicListItemState {
  const key = topicKey(topic);
  void input;
  return {
    favorite: Boolean(data.favorites[key]),
    listDensity: data.settings.listDensity,
    read: Boolean(data.history[key])
  };
}

export function topicListItemStatesEqual(left: TopicListItemState, right: TopicListItemState) {
  return left.favorite === right.favorite
    && left.listDensity === right.listDensity
    && left.read === right.read;
}
