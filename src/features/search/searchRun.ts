import type { SearchSort } from '@/domain/forum/feed';
import type { SearchFilterState } from '@/domain/forum/searchFilters';
import type { FeedSource, Source } from '@/domain/forum/models';

export type SearchRunOptions = {
  filters: SearchFilterState;
  query: string;
  source: FeedSource;
  sourceOverride?: Source;
};

export function snapshotSearchFilters(filters: SearchFilterState): SearchFilterState {
  return {
    v2ex: { ...filters.v2ex },
    linuxdo: { ...filters.linuxdo, tags: [...filters.linuxdo.tags], visited: [...filters.linuxdo.visited] },
    nodeseek: { ...filters.nodeseek },
    yaohuo: { ...filters.yaohuo }
  };
}

export function remoteSearchSort(searchSource: FeedSource, searchFilters: SearchFilterState): SearchSort {
  return searchSource === 'all'
    ? 'time'
    : searchSource === 'v2ex' && searchFilters.v2ex.sort === 'time'
      ? searchFilters.v2ex.sort
      : 'relevance';
}
