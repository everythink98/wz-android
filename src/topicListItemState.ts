import { topicKey, type ReaderData, type ReaderSettings } from './readerData';
import type { Topic } from './types';

export interface TopicListItemState {
  favorite: boolean;
  later: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
  tracked: boolean;
}

export function getTopicListItemState(data: ReaderData, topic: Topic): TopicListItemState {
  const key = topicKey(topic);
  const text = `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''}`.toLowerCase();
  return {
    favorite: Boolean(data.favorites[key]),
    later: Boolean(data.later[key]),
    listDensity: data.settings.listDensity,
    read: Boolean(data.history[key]),
    tracked: data.settings.trackedKeywords.some((keyword) => text.includes(keyword.toLowerCase()))
  };
}

export function topicListItemStatesEqual(left: TopicListItemState, right: TopicListItemState) {
  return left.favorite === right.favorite
    && left.later === right.later
    && left.listDensity === right.listDensity
    && left.read === right.read
    && left.tracked === right.tracked;
}
