import type { Source } from '@/domain/forum/models';
import type { TopicContentItem } from './topicOpeningPresentation';
import type { TopicReplyListItem } from './replyListModel';

type TopicQuoteSummaryItem = Extract<TopicContentItem, { type: 'quoteSummary' }>;

export type TopicListItem =
  | TopicReplyListItem
  | { type: 'topicContent'; key: string; content: TopicContentItem }
  | { type: 'topicQuoteSummary'; key: string; content: TopicQuoteSummaryItem }
  | { type: 'topicQuoteContent'; key: string; content: TopicContentItem; instanceKey: string; source: Source }
  | { type: 'topicAcceptedAnswer'; key: string }
  | { type: 'topicAcceptedAnswerContent'; key: string; content: TopicContentItem; preview: boolean }
  | { type: 'topicPostlude'; key: string };

export function topicListItemKey(item: TopicListItem) {
  return item.key;
}

export function topicListItemType(item: TopicListItem) {
  if (item.type === 'replyQuoteContent') return `${item.type}:${item.content.type}`;
  if (item.type === 'topicContent' || item.type === 'topicQuoteContent' || item.type === 'topicAcceptedAnswerContent') {
    return `${item.type}:${item.content.type}`;
  }
  return item.type;
}

export function topicListMediaPlanStats(items: readonly TopicListItem[]) {
  let networkMediaCount = 0;
  let plannedRowCount = 0;
  for (const item of items) {
    if (item.type === 'reply') {
      networkMediaCount += item.networkMediaCount || 0;
      plannedRowCount += item.plannedRowCount || 0;
      continue;
    }
    if (item.type === 'replySignatureContent') {
      networkMediaCount += item.networkMediaCount;
      plannedRowCount += 1;
      continue;
    }
    if (item.type === 'replyContent' || item.type === 'replyQuoteContent') {
      if (item.content.type === 'html') {
        networkMediaCount += item.content.networkMediaCount;
        plannedRowCount += 1;
      }
      continue;
    }
    if (
      item.type === 'topicContent' ||
      item.type === 'topicQuoteContent' ||
      item.type === 'topicAcceptedAnswerContent'
    ) {
      if (item.content.type === 'content' || item.content.type === 'contentVideo') {
        networkMediaCount += item.content.networkMediaCount;
        plannedRowCount += 1;
      }
    }
  }
  return { networkMediaCount, plannedRowCount };
}
