import type { FeedResponse } from './models';

export type PagePosition = { page: number; cursor?: string };

export function pagePosition(page: number | null | undefined, cursor?: string | null): PagePosition | undefined {
  if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) return undefined;
  return { page, ...(cursor ? { cursor } : {}) };
}

export function nextPagePosition(
  response: Pick<FeedResponse, 'hasMore' | 'nextPage' | 'nextCursor'>,
  requested: PagePosition
): PagePosition | undefined {
  if (!response.hasMore) return undefined;
  const next = pagePosition(response.nextPage, response.nextCursor);
  if (!next || next.page < requested.page) return undefined;
  if (next.page === requested.page && (!next.cursor || next.cursor === requested.cursor)) return undefined;
  return next;
}

export function nextPageCursor(
  hasMore: boolean | undefined,
  nextCursor: string | null | undefined,
  requestedCursor: string | null | undefined
) {
  return hasMore && nextCursor && nextCursor !== requestedCursor ? nextCursor : undefined;
}
