import type { SearchGroup } from './searchListItems';
import type { SearchSort } from './feedLogic';
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState } from './searchFilters';
import type { FeedSource, Source, Topic } from './types';

export type SearchHistoryWriteQueue = {
  current: Promise<void>;
};

export type RemoteSearchAction =
  | { type: 'yaohuo-login'; message: string }
  | { type: 'nodeseek-verification'; message: string }
  | { type: 'linuxdo-verification'; message: string };

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

export function hasNextSearchPage(
  hasMore: boolean | undefined,
  nextPage: number | null | undefined,
  requestedPage: number
) {
  return Boolean(hasMore && nextPage && nextPage !== requestedPage);
}

export function snapshotSearchFilters(filters: SearchFilterState): SearchFilterState {
  return {
    v2ex: { ...filters.v2ex },
    linuxdo: { ...filters.linuxdo, tags: [...filters.linuxdo.tags], visited: [...filters.linuxdo.visited] },
    nodeseek: { ...filters.nodeseek },
    yaohuo: { ...filters.yaohuo },
    xiaoyinsi: {
      ...DEFAULT_SEARCH_FILTERS.xiaoyinsi,
      ...filters.xiaoyinsi,
      tags: [...(filters.xiaoyinsi.tags || [])],
      visited: [...(filters.xiaoyinsi.visited || [])]
    }
  };
}

export function mergeLinuxDoAiTopics(standardTopics: Topic[], aiTopics: Topic[], enabled: boolean) {
  if (!enabled || !aiTopics.length) {
    return standardTopics;
  }
  const seen = new Set(standardTopics.map((topic) => `${topic.source}:${topic.id}`));
  return [
    ...standardTopics,
    ...aiTopics.filter((topic) => {
      const key = `${topic.source}:${topic.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
  ];
}

export function linuxDoAiFailureState(error: unknown): LinuxDoAiSearchState {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
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

export function groupFromRemoteSearchResult(result: RemoteSearchSourceResult) {
  return result.group;
}

export function createSearchHistoryWriteQueue(): SearchHistoryWriteQueue {
  return { current: Promise.resolve() };
}

export function enqueueSearchHistoryWrite(queue: SearchHistoryWriteQueue, task: () => Promise<void>) {
  const run = queue.current.catch(() => undefined).then(task);
  queue.current = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
