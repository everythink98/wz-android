import type { InfiniteData } from '@tanstack/react-query';
import { mergeReplies } from '@/domain/forum/feed';
import type {
  RepliesResponse,
  Reply,
  ReplyLocationTarget,
  ReplyOrder,
  ReplyWindowPosition,
  TopicDetail
} from '@/domain/forum/models';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';

export const REPLY_PAGE_SIZE = 30;

export type ReplyPageParam = ReplyWindowPosition;
export type ReplyCursorPosition = Extract<ReplyWindowPosition, { kind: 'cursor' }>;
export type ReplyWindowEdge = 'start' | 'end';
export type ReplyPage = RepliesResponse & { requestedOffset: number | null; requestedPage: number };

function topicHasCompleteReplies(detail: TopicDetail) {
  return detail.replyHasMore === false && detail.replies.length === detail.replyCount;
}

function topicReplyPage(detail: TopicDetail, order: ReplyOrder): ReplyPage {
  const completeNewest = order === 'newest' && topicHasCompleteReplies(detail);
  const nextOffset = completeNewest ? null : (detail.replyNextOffset ?? null);
  return {
    items: completeNewest ? [...detail.replies].reverse() : detail.replies,
    currentPage: 1,
    currentOffset: 0,
    previousPage: null,
    previousOffset: null,
    hasMore: completeNewest ? false : Boolean(detail.replyHasMore),
    nextPage:
      nextOffset === null
        ? null
        : isDiscourseSource(detail.source)
          ? Math.floor(nextOffset / REPLY_PAGE_SIZE) + 1
          : (detail.replyNextPage ?? null),
    nextOffset,
    totalCount: detail.replyCount,
    requestedPage: 1,
    requestedOffset: 0
  };
}

export function firstReplyData(
  detail: TopicDetail,
  order: ReplyOrder
): InfiniteData<ReplyPage, ReplyPageParam> | undefined {
  if (order === 'newest' && !topicHasCompleteReplies(detail)) return undefined;
  return { pages: [topicReplyPage(detail, order)], pageParams: [{ kind: 'start' }] };
}

export function mergedReplyPages(data: InfiniteData<ReplyPage, ReplyPageParam> | undefined) {
  return data?.pages.reduce<Reply[]>((items, page) => mergeReplies(items, page.items), []) ?? [];
}

function isLoadedReplyPage(pages: ReplyPage[], candidate: ReplyCursorPosition) {
  return pages.some((page) => page.requestedPage === candidate.page && page.requestedOffset === candidate.offset);
}

export function nextReplyPage(lastPage: ReplyPage, loadedPages: ReplyPage[] = []): ReplyCursorPosition | undefined {
  const candidate: ReplyCursorPosition | undefined = hasNextReplyPage(lastPage)
    ? { kind: 'cursor', page: lastPage.nextPage!, offset: lastPage.nextOffset ?? null }
    : undefined;
  return candidate && !isLoadedReplyPage(loadedPages, candidate) ? candidate : undefined;
}

export function previousReplyPage(
  firstPage: ReplyPage,
  loadedPages: ReplyPage[] = []
): ReplyCursorPosition | undefined {
  const candidate: ReplyCursorPosition | undefined = hasPreviousReplyPage(firstPage)
    ? { kind: 'cursor', page: firstPage.previousPage!, offset: firstPage.previousOffset ?? null }
    : undefined;
  return candidate && !isLoadedReplyPage(loadedPages, candidate) ? candidate : undefined;
}

export function replyEdgePosition(
  data: { pages: ReplyPage[] } | undefined,
  edge: ReplyWindowEdge
): ReplyWindowPosition {
  const pages = data?.pages || [];
  if (!pages.length) return { kind: 'start' };
  const cursor = edge === 'start' ? previousReplyPage(pages[0], pages) : nextReplyPage(pages.at(-1)!, pages);
  return cursor || { kind: 'start' };
}

export function matchesReplyLocation(reply: Reply, target: ReplyLocationTarget) {
  if (target.commentId !== undefined) return reply.commentId === target.commentId;
  return target.floor !== undefined && reply.floor === target.floor;
}

export function hasNextReplyPage(page: Partial<ReplyPage>) {
  return Boolean(
    page.hasMore &&
    page.nextPage &&
    !(page.nextPage === page.requestedPage && (page.nextOffset ?? null) === (page.requestedOffset ?? null))
  );
}

export function hasPreviousReplyPage(page: Partial<ReplyPage>) {
  return Boolean(
    page.previousPage &&
    page.previousPage > 0 &&
    !(page.previousPage === page.requestedPage && (page.previousOffset ?? null) === (page.requestedOffset ?? null))
  );
}
