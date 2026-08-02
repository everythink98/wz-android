import { searchNodeSeek } from '@/sources/nodeseek/reader';
import { searchV2ex } from '@/sources/v2ex/reader';
import { searchYaohuoDirect } from '@/sources/yaohuo/reader';
import { searchDiscourseSourceTopics, type DiscourseReadAuth } from './discourseRead';
import { aggregateSearchSources, isDiscourseSource } from '@/domain/forum/sourceCatalog';
import {
  parseSearchExpression,
  positiveSearchQuery,
  searchExpressionText,
  sortTopicsByCreatedAt,
  type SearchExpression,
  type SearchSort
} from '@/domain/forum/feed';
import {
  buildDiscourseSearchQuery,
  filterSearchResponseItems,
  isDiscourseSearchFilter,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import type { Category, FeedSource, SearchResponse, Source, Topic } from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';
import { copySourceDiagnosticSummary, mergeSourceDiagnosticSummaries } from './diagnostics';
import {
  dispatchSourceRead,
  mergeSettledSourceErrors,
  settledDiagnosticFacts,
  unavailableSourceRead
} from './readAggregation';
function filterExcludedSearchItems(items: Topic[], expression: SearchExpression) {
  if (!expression.exclude.length) {
    return items;
  }
  return items.filter((topic) => {
    const text = searchExpressionText(topic).toLowerCase();
    return expression.exclude.every((term) => !text.includes(term.toLowerCase()));
  });
}

function filterSearchItems(
  response: SearchResponse,
  query: string,
  limit: number,
  filter?: SourceSearchFilter
): SearchResponse {
  const expression = parseSearchExpression(query);
  const scopedItems = filterSearchResponseItems(response.items, filter, query);
  return copySourceDiagnosticSummary(
    {
      ...response,
      items: filterExcludedSearchItems(scopedItems, expression).slice(0, limit)
    },
    response
  );
}
export async function searchTopics({
  source,
  query,
  limit = 20,
  page = 1,
  categories = [],
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  linuxDoAuthenticated,
  unavailableSources,
  sort = 'relevance',
  filter,
  signal,
  timeoutMs
}: {
  source: FeedSource;
  query: string;
  limit?: number;
  page?: number;
  categories?: Category[];
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  linuxDoAuthenticated?: boolean;
  unavailableSources?: readonly Source[];
  sort?: SearchSort;
  filter?: SourceSearchFilter;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const adapterQuery = positiveSearchQuery(query);
  const adapterLimit = parseSearchExpression(query).exclude.length ? Math.min(100, limit * 3) : limit;
  const options = {
    authenticated: nodeSeekAuthenticated,
    limit: adapterLimit,
    page,
    fetcher,
    nodeSeekUserAgent,
    signal,
    timeoutMs
  };
  if (source === 'all') {
    const sources = aggregateSearchSources;
    const results = await Promise.allSettled(
      sources.map((item) => {
        if (unavailableSources?.includes(item)) {
          return unavailableSourceRead(item);
        }
        if (isDiscourseSource(item)) {
          return searchDiscourseSourceTopics(item, adapterQuery, {
            authenticated: item === 'linuxdo' && linuxDoAuthenticated === true,
            auth: discourseAuth,
            fetcher,
            limit: adapterLimit,
            page,
            signal,
            timeoutMs
          });
        }
        if (item === 'nodeseek') {
          return searchNodeSeek(adapterQuery, options);
        }
        if (item === 'v2ex') {
          return searchV2ex(adapterQuery, options);
        }
        if (item === 'yaohuo') {
          return searchYaohuoDirect({
            query: adapterQuery,
            page,
            limit: adapterLimit,
            yaohuoFetcher: fetcher,
            signal,
            timeoutMs
          });
        }
        throw new Error(`${item} 未注册聚合搜索 adapter`);
      })
    );
    const expression = parseSearchExpression(query);
    const response = {
      items: sortTopicsByCreatedAt(
        filterExcludedSearchItems(
          results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : [])),
          expression
        )
      ).slice(0, limit),
      errors: mergeSettledSourceErrors(results, sources),
      hasMore: results.some((result) => result.status === 'fulfilled' && result.value.hasMore),
      nextPage: results.some((result) => result.status === 'fulfilled' && result.value.hasMore) ? page + 1 : null
    };
    const facts = settledDiagnosticFacts(results);
    return mergeSourceDiagnosticSummaries(
      response,
      'aggregate-search',
      results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      {
        candidateCount: response.items.length + facts.droppedCount,
        validCount: response.items.length,
        droppedCount: facts.droppedCount,
        partialErrorCount: facts.partialErrorCount,
        missingFloorCount: facts.missingFloorCount,
        hasRepeatedCursor: facts.hasRepeatedCursor || response.nextPage === page,
        isExpectedEmpty: response.items.length === 0 && facts.droppedCount === 0 && facts.partialErrorCount === 0
      }
    );
  }
  const activeFilter = filter?.source === source ? filter : undefined;
  const response = isDiscourseSource(source)
    ? await searchDiscourseSourceTopics(
        source,
        activeFilter && isDiscourseSearchFilter(activeFilter)
          ? buildDiscourseSearchQuery(adapterQuery, activeFilter, categories)
          : adapterQuery,
        {
          authenticated: source === 'linuxdo' && linuxDoAuthenticated === true,
          auth: discourseAuth,
          fetcher,
          limit: adapterLimit,
          page,
          signal,
          timeoutMs
        }
      )
    : await dispatchSourceRead(source, {
        nodeseek: () =>
          searchNodeSeek(adapterQuery, {
            ...options,
            filter: activeFilter?.source === 'nodeseek' ? activeFilter : undefined
          }),
        v2ex: () =>
          searchV2ex(adapterQuery, {
            ...options,
            sort: activeFilter?.source === 'v2ex' ? activeFilter.sort : sort,
            filter: activeFilter?.source === 'v2ex' ? activeFilter : undefined
          })
      });
  return filterSearchItems(response, query, limit, activeFilter);
}
