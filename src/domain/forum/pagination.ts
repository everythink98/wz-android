export function hasNextPageCursor<Cursor extends number | string | null | undefined>(
  hasMore: boolean | undefined,
  nextCursor: Cursor | null | undefined,
  requestedCursor: Cursor
) {
  return Boolean(hasMore && nextCursor && nextCursor !== requestedCursor);
}
