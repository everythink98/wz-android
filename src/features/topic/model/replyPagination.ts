import type { Source } from '@/domain/forum/models';

export const REPLY_PAGE_SIZE = 30;

function replyPageForExpectedCount(count: number, pageSize = REPLY_PAGE_SIZE) {
  return Math.max(1, Math.ceil(Math.max(1, count) / pageSize));
}

function replyOffsetForExpectedCount(count: number, pageSize = REPLY_PAGE_SIZE) {
  return (replyPageForExpectedCount(count, pageSize) - 1) * pageSize;
}

function replyPageForIndex(index: number, pageSize = REPLY_PAGE_SIZE) {
  return Math.max(1, Math.floor(index / pageSize) + 1);
}

function nodeSeekReplyPageSize(replyNextPage?: number | null, replyNextOffset?: number | null) {
  if (!replyNextPage || replyNextPage <= 1 || !replyNextOffset || replyNextOffset <= 0) return REPLY_PAGE_SIZE;
  return Math.max(1, Math.floor(replyNextOffset / (replyNextPage - 1)));
}

function replyRefreshResult(page: number, offset: number, limit = REPLY_PAGE_SIZE) {
  return limit === REPLY_PAGE_SIZE ? { page, offset } : { page, offset, limit };
}

export function replyLoadMoreLimit({
  source,
  replyNextPage,
  replyNextOffset
}: {
  source: Source;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
}) {
  return source === 'nodeseek' ? nodeSeekReplyPageSize(replyNextPage, replyNextOffset) : REPLY_PAGE_SIZE;
}

export function replyCountAfterNewReplySubmit(currentReplyCount: number, loadedReplyCount: number) {
  return Math.max(currentReplyCount + 1, loadedReplyCount);
}

export function replyRefreshTarget({
  source,
  afterSubmit,
  expectedReplyCount,
  replyNextPage,
  replyNextOffset,
  loadedReplyCount,
  targetReplyIndex
}: {
  source: Source;
  afterSubmit: boolean;
  expectedReplyCount: number;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
  loadedReplyCount?: number;
  targetReplyIndex?: number;
}) {
  if (!afterSubmit) {
    const limit = source === 'nodeseek' ? loadedReplyCount || REPLY_PAGE_SIZE : REPLY_PAGE_SIZE;
    return replyRefreshResult(1, 0, limit);
  }
  const pageSize = source === 'nodeseek' ? nodeSeekReplyPageSize(replyNextPage, replyNextOffset) : REPLY_PAGE_SIZE;
  if (typeof targetReplyIndex === 'number' && targetReplyIndex >= 0) {
    const page = replyPageForIndex(targetReplyIndex, pageSize);
    const offset = source === 'yaohuo' ? 0 : (page - 1) * pageSize;
    if (source === 'nodeseek' && replyNextPage === 1) return { page: 1, offset };
    return replyRefreshResult(page, offset, source === 'nodeseek' ? pageSize : REPLY_PAGE_SIZE);
  }
  const offset = source === 'yaohuo' ? 0 : replyOffsetForExpectedCount(expectedReplyCount, pageSize);
  if (source === 'nodeseek' && replyNextPage === 1) return { page: 1, offset };
  return replyRefreshResult(
    replyPageForExpectedCount(expectedReplyCount, pageSize),
    offset,
    source === 'nodeseek' ? pageSize : REPLY_PAGE_SIZE
  );
}
