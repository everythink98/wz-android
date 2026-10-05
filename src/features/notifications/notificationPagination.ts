import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';

export type NotificationPageParam = {
  sourceCursor?: string | null;
  allCursors?: Partial<Record<NotificationSource, string | null>>;
};

export function resolveNotificationNextPage({
  source,
  hasMore,
  nextPage,
  consumedPages
}: {
  source: 'all' | NotificationSource;
  hasMore: boolean;
  nextPage: NotificationPageParam;
  consumedPages: readonly NotificationPageParam[];
}): { nextPage: NotificationPageParam | undefined; repeatedSources: NotificationSource[] } {
  if (!hasMore) return { nextPage: undefined, repeatedSources: [] };
  if (source !== 'all') {
    const cursor = nextPage.sourceCursor;
    if (!cursor) return { nextPage: undefined, repeatedSources: [] };
    if (consumedPages.some((page) => page.sourceCursor === cursor)) {
      return { nextPage: undefined, repeatedSources: [source] };
    }
    return { nextPage, repeatedSources: [] };
  }

  const allCursors = { ...nextPage.allCursors };
  const repeatedSources: NotificationSource[] = [];
  let hasNextPage = false;
  for (const candidate of notificationSources) {
    const cursor = allCursors[candidate];
    if (!cursor) continue;
    if (consumedPages.some((page) => page.allCursors?.[candidate] === cursor)) {
      allCursors[candidate] = null;
      repeatedSources.push(candidate);
    } else {
      hasNextPage = true;
    }
  }
  return { nextPage: hasNextPage ? { allCursors } : undefined, repeatedSources };
}
