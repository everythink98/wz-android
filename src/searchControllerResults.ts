import type { SearchGroup } from './searchListItems';
import type { SearchFilterState } from './searchFilters';
import type { FeedSource, Source } from './types';

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

function snapshotSearchFilters(filters: SearchFilterState): SearchFilterState {
  return {
    v2ex: { ...filters.v2ex },
    linuxdo: { ...filters.linuxdo },
    nodeseek: { ...filters.nodeseek },
    yaohuo: { ...filters.yaohuo }
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
