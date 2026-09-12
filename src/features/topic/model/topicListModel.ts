import type { Source } from '@/domain/forum/models';
import type { CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import type { TopicContentItem } from './topicOpeningPresentation';
import type { TopicReplyListItem } from './replyListModel';
import type { TopicSelectionItem } from '../selection/TopicSelectionSurface';
import { stableTextHash } from './contentIdentity';
import { stripHtml } from '@/domain/forum/text';

type TopicQuoteSummaryItem = Extract<TopicContentItem, { type: 'quoteSummary' }>;

export type TopicListItem =
  | TopicReplyListItem
  | { type: 'topicContent'; key: string; content: TopicContentItem }
  | { type: 'topicQuoteSummary'; key: string; content: TopicQuoteSummaryItem; previewVisible: boolean }
  | { type: 'topicQuoteContent'; key: string; content: TopicContentItem; instanceKey: string; source: Source }
  | { type: 'topicAcceptedAnswer'; key: string }
  | { type: 'topicAcceptedAnswerContent'; key: string; content: TopicContentItem; preview: boolean }
  | { type: 'topicPostlude'; key: string };

export function topicListItemKey(item: TopicListItem) {
  return item.key;
}

export function topicListReadingFloor(item: TopicListItem, acceptedFloor?: number): number | undefined {
  if (item.type === 'topicContent' && item.content.type === 'content') return 1;
  if (item.type === 'topicQuoteContent' && item.content.type === 'content') return 1;
  if (item.type === 'topicAcceptedAnswerContent' && !item.preview) return acceptedFloor;
  if (item.type === 'reply' || item.type === 'replyContent' || item.type === 'replyQuoteContent') {
    if (item.reply.hidden || item.reply.systemAction) return;
    return item.reply.floor;
  }
}

const readingRevisions = new WeakMap<CompiledForumContentRow, string>();
const mediaOnlyRows = new WeakMap<CompiledForumContentRow, boolean>();
export function topicListReadingNeedsDisplayedMedia(item: TopicListItem) {
  const row = topicListCompiledRow(item) || (item.type === 'reply' ? item.bodyContent : undefined);
  if (!row) return false;
  let mediaOnly = mediaOnlyRows.get(row);
  if (mediaOnly === undefined) {
    mediaOnly = row.type === 'video' || (row.type === 'richText' && !stripHtml(row.html).trim());
    mediaOnlyRows.set(row, mediaOnly);
  }
  return mediaOnly;
}

export function topicListReadingRevision(item: TopicListItem) {
  const row = topicListCompiledRow(item) || (item.type === 'reply' ? item.bodyContent : undefined);
  if (!row) return;
  let revision = readingRevisions.get(row);
  if (!revision) {
    revision = stableTextHash(row.selectionToken);
    readingRevisions.set(row, revision);
  }
  return revision;
}

export function topicListCompiledRow(item: TopicListItem): CompiledForumContentRow | null {
  if (item.type === 'topicContent' || item.type === 'topicQuoteContent' || item.type === 'topicAcceptedAnswerContent') {
    return item.content.type === 'accessNotice' ? null : item.content.row;
  }
  if (item.type === 'topicQuoteSummary') return item.content.row;
  if (item.type === 'replyContent' || item.type === 'replyQuoteContent') return item.content;
  if (item.type === 'replySignatureContent') return item.content;
  return null;
}

export function topicListItemType(item: TopicListItem) {
  if (item.type === 'reply') {
    const contentTypes = [item.bodyContent?.type, item.signatureContent?.type].filter(Boolean);
    return contentTypes.length ? `${item.type}:${contentTypes.join('+')}` : item.type;
  }
  if (item.type === 'replyQuoteContent') return `${item.type}:${item.content.type}`;
  if (item.type === 'replyContent') return `${item.type}:${item.content.type}`;
  if (item.type === 'replySignatureContent') return `${item.type}:${item.content.type}`;
  if (item.type === 'topicContent' || item.type === 'topicQuoteContent' || item.type === 'topicAcceptedAnswerContent') {
    return item.content.type === 'content'
      ? `${item.type}:${item.content.row.type}`
      : `${item.type}:${item.content.type}`;
  }
  return item.type;
}

export function projectTopicListItems(items: readonly TopicListItem[], isVisible: (item: TopicListItem) => boolean) {
  const visibleItems: TopicListItem[] = [];
  const selectionItems: TopicSelectionItem[] = [];
  const selectionRowKeys = new Set<string>();
  let networkMediaCount = 0;
  let plannedRowCount = 0;
  for (const item of items) {
    if (!isVisible(item)) continue;
    visibleItems.push(item);
    const selectionRow =
      item.type === 'topicQuoteSummary'
        ? item.previewVisible && item.content.quote.preview
          ? item.content.row
          : undefined
        : (item.type === 'topicContent' || item.type === 'topicQuoteContent') && item.content.type === 'content'
          ? item.content.row
          : undefined;
    if (selectionRow) {
      selectionItems.push({ documentId: 'opening', rowKey: item.key, selectionToken: selectionRow.selectionToken });
      selectionRowKeys.add(item.key);
    }
    if (item.type === 'reply') {
      networkMediaCount += item.networkMediaCount || 0;
      plannedRowCount += item.plannedRowCount || 0;
      continue;
    }
    if (item.type === 'replySignatureContent') {
      networkMediaCount += item.content.networkMediaCount;
      plannedRowCount += 1;
      continue;
    }
    if (item.type === 'replyContent' || item.type === 'replyQuoteContent') {
      networkMediaCount += item.content.networkMediaCount;
      plannedRowCount += 1;
      continue;
    }
    if (
      item.type === 'topicContent' ||
      item.type === 'topicQuoteContent' ||
      item.type === 'topicAcceptedAnswerContent'
    ) {
      if (item.content.type === 'content') {
        networkMediaCount += item.content.row.networkMediaCount;
        plannedRowCount += 1;
      }
    }
  }
  return {
    items: visibleItems,
    selectionItems,
    selectionRowKeys,
    mediaPlanStats: { networkMediaCount, plannedRowCount }
  };
}
