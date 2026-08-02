import type { TopicContentItem } from './topicOpeningPresentation';
import type { TopicReplyListItem } from './replyListModel';

export type TopicListItem =
  | TopicReplyListItem
  | { type: 'topicContent'; key: string; content: TopicContentItem }
  | { type: 'topicPostlude'; key: string };

export function topicListItemKey(item: TopicListItem) {
  return item.key;
}

export function topicListItemType(item: TopicListItem) {
  if (item.type === 'replyQuoteContent') return `${item.type}:${item.content.type}`;
  return item.type === 'topicContent' ? `topicContent:${item.content.type}` : item.type;
}
