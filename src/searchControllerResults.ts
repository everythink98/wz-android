import type { SearchGroup } from './searchListItems';
import type { SearchSort } from './feedLogic';
import type { SearchFilterState, SourceSearchFilter } from './searchFilters';
import type { FeedSource, Source, Topic } from './types';

export type SearchHistoryWriteQueue = {
  current: Promise<void>;
};

export type RemoteSearchAction =
  | { type: 'yaohuo-login'; message: string }
  | { type: 'nodeseek-verification'; message: string };

export type RemoteSearchSourceResult =
  | { kind: 'success'; group: SearchGroup }
  | { kind: 'failed'; group: SearchGroup }
  | { kind: 'action-required'; group: SearchGroup; action: RemoteSearchAction };

export type SearchRunOptions = {
  filters: SearchFilterState;
  query: string;
  source: FeedSource;
  sourceOverride?: Source;
};

export type LinuxDoAiSearchStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error';

export type LinuxDoAiSearchState = {
  status: LinuxDoAiSearchStatus;
  enabled: boolean;
  count: number;
  message?: string;
};

export function snapshotSearchFilters(filters: SearchFilterState): SearchFilterState {
  return {
    v2ex: { ...filters.v2ex },
    linuxdo: { ...filters.linuxdo, tags: [...filters.linuxdo.tags], visited: [...filters.linuxdo.visited] },
    nodeseek: { ...filters.nodeseek },
    yaohuo: { ...filters.yaohuo }
  };
}

export function mergeLinuxDoAiTopics(standardTopics: Topic[], aiTopics: Topic[], enabled: boolean) {
  if (!enabled || !aiTopics.length) {
    return standardTopics;
  }
  const seen = new Set(standardTopics.map((topic) => `${topic.source}:${topic.id}`));
  return [...standardTopics, ...aiTopics.filter((topic) => {
    const key = `${topic.source}:${topic.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  })];
}

export function linuxDoAiFailureState(error: unknown): LinuxDoAiSearchState {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.statusCode) || 0;
  if (status === 403 || status === 404) {
    return { status: 'unavailable', enabled: false, count: 0, message: '当前不可用' };
  }
  return { status: 'error', enabled: false, count: 0, message: 'AI 搜索失败，可重试' };
}

export function remoteSearchSort(searchSource: FeedSource, searchFilters: SearchFilterState): SearchSort {
  return searchSource === 'all'
    ? 'time'
    : searchSource === 'v2ex' && searchFilters.v2ex.sort === 'time'
      ? searchFilters.v2ex.sort
      : 'relevance';
}

function searchPageVisitKey(source: Source, query: string, filter: SourceSearchFilter | undefined) {
  return `${source}:${query}:${JSON.stringify(filter || {})}`;
}

export function createSearchMoreRequestSnapshot({
  filters,
  page,
  searchSource,
  source,
  submittedQuery
}: {
  filters: SearchFilterState;
  page: number;
  searchSource: FeedSource;
  source: Source;
  submittedQuery: string;
}) {
  const query = submittedQuery.trim();
  if (!query) {
    return null;
  }
  const activeFilter = searchSource === 'all' ? undefined : filters[source];
  const filterKey = JSON.stringify(activeFilter || {});
  return {
    activeFilter,
    ownerKey: `search-more:${source}:${query}:${page}:${filterKey}`,
    query,
    sort: remoteSearchSort(searchSource, filters),
    visitedKey: searchPageVisitKey(source, query, activeFilter)
  };
}

export function createNodeSeekRetrySearchOptions({
  filters,
  query,
  searchSource
}: {
  filters: SearchFilterState;
  query: string;
  searchSource: FeedSource;
}): SearchRunOptions {
  return {
    filters: snapshotSearchFilters(filters),
    query,
    source: searchSource,
    sourceOverride: 'nodeseek'
  };
}

export function groupFromRemoteSearchResult(result: RemoteSearchSourceResult) {
  return result.group;
}

export function firstRemoteSearchAction(results: RemoteSearchSourceResult[]) {
  return results.find((result) => result.kind === 'action-required')?.action;
}

export function remoteSearchActionForSource(source: FeedSource, results: RemoteSearchSourceResult[]) {
  return source === 'all' ? undefined : firstRemoteSearchAction(results);
}

export function createSearchHistoryWriteQueue(): SearchHistoryWriteQueue {
  return { current: Promise.resolve() };
}

export function enqueueSearchHistoryWrite(queue: SearchHistoryWriteQueue, task: () => Promise<void>) {
  const run = queue.current.catch(() => undefined).then(task);
  queue.current = run.then(() => undefined, () => undefined);
  return run;
}
