import type { InfiniteData } from '@tanstack/react-query';
import type { SourceErrorInfo } from '@/domain/forum/models';
import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification, NotificationPage } from '@/domain/notifications/models';

export type NotificationPageParam = {
  sourceCursor?: string | null;
  allCursors?: Partial<Record<NotificationSource, string | null>>;
};

type NotificationRetryCursor = { cursor?: string; seq: number };

export type NotificationListPage = {
  items: ForumNotification[];
  errors: Partial<Record<NotificationSource, SourceErrorInfo>>;
  hasMore: boolean;
  nextPage: NotificationPageParam;
  historyNotices?: Partial<Record<NotificationSource, string>>;
  retryTargets?: Partial<Record<NotificationSource, NotificationRetryCursor>>;
};

type NotificationListData = InfiniteData<NotificationListPage, NotificationPageParam>;
type NotificationListSource = 'all' | NotificationSource;
type NotificationRetryTarget = {
  listSource: NotificationListSource;
  source: NotificationSource;
  pageIndex: number;
  cursor: string | null | undefined;
  retainedFailure?: NotificationRetryCursor;
};

export function notificationPageCursor(
  page: NotificationPageParam | undefined,
  listSource: NotificationListSource,
  source: NotificationSource
) {
  return listSource === 'all' ? page?.allCursors?.[source] : page?.sourceCursor;
}

function notificationItemKey(item: ForumNotification) {
  return `${item.source}:${item.id}`;
}

function retainUnmatchedNotifications(
  previous: readonly ForumNotification[],
  replacedKeys: ReadonlySet<string>,
  retainsSource?: (source: NotificationSource) => boolean
) {
  return previous.filter(
    (item) => (!retainsSource || retainsSource(item.source)) && !replacedKeys.has(notificationItemKey(item))
  );
}

export function retainNotificationSourceChains(
  previous: NotificationListData,
  refreshed: NotificationListData,
  retained: ReadonlyMap<NotificationSource, number>,
  failures: ReadonlyMap<NotificationSource, { pageIndex: number; error: SourceErrorInfo; cursor?: string; seq: number }>
): NotificationListData {
  const retainedSources = [...retained];
  let pageCount = refreshed.pages.length;
  previous.pages.forEach((page, index) => {
    if (
      page.items.some((item) => (retained.get(item.source) ?? Infinity) <= index) ||
      retainedSources.some(
        ([source, first]) =>
          first <= index &&
          (previous.pageParams[index]?.allCursors?.[source] != null ||
            page.nextPage.allCursors?.[source] != null ||
            page.errors[source] ||
            page.historyNotices?.[source])
      )
    ) {
      pageCount = Math.max(pageCount, index + 1);
    }
  });
  const receivedPages = refreshed.pages.map((page, index) =>
    page.items.filter(
      (item) => index < (retained.get(item.source) ?? Infinity) || failures.get(item.source)?.pageIndex === index
    )
  );
  // A failed refresh retains older cached rows. Without a refresh failure, a retained suffix may contain a newer retry.
  const replacedKeys = new Set(
    receivedPages.flatMap((items) => items.filter((item) => failures.has(item.source)).map(notificationItemKey))
  );
  const pages: NotificationListPage[] = [];
  const pageParams: NotificationPageParam[] = [];
  const nextCursors: Partial<Record<NotificationSource, string | null>> = {};
  for (let index = 0; index < pageCount; index += 1) {
    const oldPage = previous.pages[index];
    const newPage = refreshed.pages[index];
    const keepsPrevious = (source: NotificationSource) => (retained.get(source) ?? Infinity) <= index;
    const requestedCursors: Partial<Record<NotificationSource, string | null>> = {};
    const errors: NotificationListPage['errors'] = {};
    const historyNotices: NonNullable<NotificationListPage['historyNotices']> = {};
    const retryTargets: NonNullable<NotificationListPage['retryTargets']> = {};
    for (const source of notificationSources) {
      const usePrevious = keepsPrevious(source);
      const input = usePrevious ? previous : refreshed;
      const page = usePrevious ? oldPage : newPage;
      const requested = input.pageParams[index]?.allCursors?.[source];
      if (requested !== undefined) requestedCursors[source] = requested;
      const next = page?.nextPage.allCursors?.[source];
      if (next !== undefined) nextCursors[source] = next;
      const failure = failures.get(source);
      const error = failure ? (failure.pageIndex === index ? failure.error : undefined) : page?.errors[source];
      if (error) errors[source] = error;
      if (failure?.pageIndex === index) retryTargets[source] = { cursor: failure.cursor, seq: failure.seq };
      else if (!failure && page?.retryTargets?.[source]) retryTargets[source] = page.retryTargets[source];
      const notice = page?.historyNotices?.[source];
      if (notice) historyNotices[source] = notice;
    }
    const received = receivedPages[index] ?? [];
    const kept = retainUnmatchedNotifications(oldPage?.items ?? [], replacedKeys, keepsPrevious);
    pages.push({
      items: [...received, ...kept],
      errors,
      hasMore: Object.values(nextCursors).some((cursor) => cursor != null),
      nextPage: { allCursors: { ...nextCursors } },
      ...(Object.keys(historyNotices).length ? { historyNotices } : {}),
      ...(Object.keys(retryTargets).length ? { retryTargets } : {})
    });
    pageParams.push(index === 0 ? {} : { allCursors: requestedCursors });
  }
  return { pages, pageParams };
}

export function compatibleNotificationRefreshPrefix(
  previous: NotificationListData,
  refreshed: NotificationListData,
  source: NotificationSource,
  aggregate: boolean,
  retry: { pageIndex: number; cursor: string | undefined }
) {
  const cursor = (page?: NotificationPageParam) => notificationPageCursor(page, aggregate ? 'all' : source, source);
  if (!retry.cursor || cursor(previous.pageParams[retry.pageIndex]) !== retry.cursor) return 0;
  for (let index = 0; index < retry.pageIndex; index += 1) {
    const nextOld = cursor(previous.pageParams[index + 1]);
    if (!nextOld || cursor(refreshed.pages[index]?.nextPage) !== nextOld) return 0;
  }
  return retry.pageIndex;
}

export function findNotificationSourceRetryTarget(
  cached: NotificationListData | undefined,
  listSource: NotificationListSource,
  source: NotificationSource
): NotificationRetryTarget {
  const retainedFailureIndex = cached?.pages.findIndex((page) => page.retryTargets?.[source]) ?? -1;
  const failedPageIndex =
    retainedFailureIndex >= 0
      ? retainedFailureIndex
      : (cached?.pages.findIndex(
          (page, index) =>
            page.errors[source] ||
            resolveNotificationNextPage({
              source: listSource,
              ...page,
              consumedPages: cached.pageParams.slice(0, index + 1)
            }).repeatedSources.includes(source)
        ) ?? -1);
  const pageIndex = Math.max(0, failedPageIndex);
  const retainedFailure = cached?.pages[pageIndex]?.retryTargets?.[source];
  const cursor = retainedFailure
    ? retainedFailure.cursor
    : notificationPageCursor(cached?.pageParams[pageIndex], listSource, source);
  return { listSource, source, pageIndex, cursor, retainedFailure };
}

export function commitNotificationSourceRetry(
  data: NotificationListData | undefined,
  { listSource, source, pageIndex, cursor, retainedFailure }: NotificationRetryTarget,
  result: { page: NotificationPage; error?: SourceErrorInfo } | { page?: undefined; error: SourceErrorInfo }
): NotificationListData | undefined {
  const currentPage = data?.pages[pageIndex];
  if (!data || !currentPage) return data;
  const currentFailure = currentPage.retryTargets?.[source];
  if (currentFailure || retainedFailure) {
    if (currentFailure?.seq !== retainedFailure?.seq || currentFailure?.cursor !== retainedFailure?.cursor) return data;
  } else if (pageIndex !== 0 && notificationPageCursor(data.pageParams[pageIndex], listSource, source) !== cursor) {
    return data;
  }

  const { page, error } = result;
  const replacedKeys = new Set(page?.items.map(notificationItemKey));
  const dropReplacedRows = (previous: NotificationListPage) => {
    if (!replacedKeys.size) return previous;
    const items = retainUnmatchedNotifications(previous.items, replacedKeys);
    return items.length === previous.items.length ? previous : { ...previous, items };
  };
  if (!page || (error && retainedFailure)) {
    const updated = {
      ...currentPage,
      errors: { ...currentPage.errors, [source]: error },
      ...(page && { items: [...dropReplacedRows(currentPage).items, ...page.items] })
    };
    return {
      ...data,
      pages: data.pages.map((oldPage, index) => (index === pageIndex ? updated : dropReplacedRows(oldPage)))
    };
  }

  const aggregate = listSource === 'all';
  const pageHasMore = page.hasMore && !error;
  const nextCursor = pageHasMore ? page.cursor : null;
  const withCursor = (oldPage: NotificationListPage, value = nextCursor): NotificationListPage => {
    if (!aggregate) return { ...oldPage, hasMore: pageHasMore, nextPage: { sourceCursor: value } };
    const allCursors = { ...oldPage.nextPage.allCursors, [source]: value };
    return {
      ...oldPage,
      hasMore: Object.values(allCursors).some((cursor) => cursor != null),
      nextPage: { allCursors }
    };
  };
  const firstFollowingCursor = data.pageParams.slice(pageIndex + 1).find((param) => param.allCursors?.[source] != null)
    ?.allCursors?.[source];
  const discardSourceSuffix = aggregate && retainedFailure && firstFollowingCursor !== nextCursor;
  const pages = data.pages.map((oldPage, index) => {
    const discardSource = index > pageIndex && discardSourceSuffix;
    if (index !== pageIndex && !discardSource) return dropReplacedRows(oldPage);
    const errors = { ...oldPage.errors };
    const retryTargets = { ...oldPage.retryTargets };
    const historyNotices = { ...oldPage.historyNotices };
    const otherSourceItems = oldPage.items.filter((item) => item.source !== source);
    if (discardSource) {
      delete errors[source];
      delete retryTargets[source];
      delete historyNotices[source];
      return withCursor({ ...oldPage, errors, retryTargets, historyNotices, items: otherSourceItems }, null);
    }
    if (page.historyNotice) historyNotices[source] = page.historyNotice;
    else delete historyNotices[source];
    if (error) errors[source] = error;
    else {
      delete errors[source];
      delete retryTargets[source];
    }
    return withCursor({
      ...oldPage,
      errors,
      retryTargets,
      historyNotices,
      items: [...(error ? dropReplacedRows(oldPage).items : otherSourceItems), ...page.items]
    });
  });
  const sourceAdvancedAfterPage =
    !retainedFailure &&
    aggregate &&
    (data.pages.some(
      (laterPage, index) =>
        index > pageIndex &&
        (data.pageParams[index]?.allCursors?.[source] != null ||
          laterPage.nextPage.allCursors?.[source] != null ||
          Boolean(laterPage.errors[source]) ||
          laterPage.items.some((item) => item.source === source))
    ) ||
      (nextCursor != null &&
        data.pageParams.some((param, index) => index > pageIndex && param.allCursors?.[source] === nextCursor)));
  if (aggregate && pageIndex !== pages.length - 1 && !sourceAdvancedAfterPage) {
    let tailCursor = nextCursor;
    if (retainedFailure && !discardSourceSuffix) {
      // Other sources can append pages while this source is paused.
      for (let index = pages.length - 1; index > pageIndex; index -= 1) {
        if (data.pageParams[index]?.allCursors?.[source] == null) continue;
        tailCursor = pages[index]?.nextPage.allCursors?.[source] ?? null;
        break;
      }
    }
    pages[pages.length - 1] = withCursor(pages[pages.length - 1]!, tailCursor);
  }
  const pageParams = retainedFailure
    ? data.pageParams.map((param, index) => {
        if (index === pageIndex && index !== 0)
          return { ...param, allCursors: { ...param.allCursors, [source]: cursor } };
        if (index > pageIndex && discardSourceSuffix)
          return { ...param, allCursors: { ...param.allCursors, [source]: null } };
        return param;
      })
    : data.pageParams;
  return { ...data, pages, pageParams };
}

export function resolveNotificationNextPage({
  source,
  hasMore,
  nextPage,
  consumedPages,
  retainedFailures = []
}: {
  source: NotificationListSource;
  hasMore: boolean;
  nextPage: NotificationPageParam;
  consumedPages: readonly NotificationPageParam[];
  retainedFailures?: readonly NotificationListPage[];
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
    if (retainedFailures.some((page) => page.retryTargets?.[candidate])) {
      allCursors[candidate] = null;
      continue;
    }
    if (consumedPages.some((page) => page.allCursors?.[candidate] === cursor)) {
      allCursors[candidate] = null;
      repeatedSources.push(candidate);
    } else {
      hasNextPage = true;
    }
  }
  return { nextPage: hasNextPage ? { allCursors } : undefined, repeatedSources };
}
