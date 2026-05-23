import { topicKey, type ReaderData, type ReaderSettings } from './readerData';
import type { Topic } from './types';

export interface TopicListItemState {
  favorite: boolean;
  listDensity: ReaderSettings['listDensity'];
  read: boolean;
  tracked: boolean;
}

export interface NormalizedTopicListStateInput {
  trackedKeywords: string[];
}

export function normalizeTrackedKeywords(keywords: string[]) {
  return keywords.map((keyword) => keyword.toLowerCase());
}

export function getTopicListItemState(data: ReaderData, topic: Topic, input?: NormalizedTopicListStateInput): TopicListItemState {
  const key = topicKey(topic);
  const text = `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''}`.toLowerCase();
  const trackedKeywords = input?.trackedKeywords || normalizeTrackedKeywords(data.settings.trackedKeywords);
  return {
    favorite: Boolean(data.favorites[key]),
    listDensity: data.settings.listDensity,
    read: Boolean(data.history[key]),
    tracked: trackedKeywords.some((keyword) => text.includes(keyword))
  };
}

export function topicListItemStatesEqual(left: TopicListItemState, right: TopicListItemState) {
  return left.favorite === right.favorite
    && left.listDensity === right.listDensity
    && left.read === right.read
    && left.tracked === right.tracked;
}
