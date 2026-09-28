import { searchNodeSeek } from '@/sources/nodeseek/reader';
import { searchV2ex } from '@/sources/v2ex/search';
import { searchYaohuoDirect } from '@/sources/yaohuo/reader';
import { searchLinuxDo } from '@/sources/linuxdo/search';
import type { LinuxDoReadAuth } from '@/sources/linuxdo/reader';
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
import {
  copySourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries
} from '@/platform/diagnostics/sourceDiagnosticSummary';
import { runForumSourceReadAggregateAttempt, runForumSourceReadAttempt } from './forumSourceReadAttempt';
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

function filterSearchItems(response: SearchResponse, query: string, filter?: SourceSearchFilter): SearchResponse {
  const expression = parseSearchExpression(query);
  const scopedItems = filterSearchResponseItems(response.items, filter, query);
  return copySourceDiagnosticSummary(
    {
      ...response,
      // The cursor has consumed the whole adapter page; keep every surviving item.
      items: filterExcludedSearchItems(scopedItems, expression)
    },
    response
  );
}

function requireSearchTopicTitles(response: SearchResponse) {
  if (response.items.some((topic) => !topic.title.trim())) {
    throw Object.assign(new Error('搜索结果缺少标题'), { reason: 'parse_empty' });
  }
  return response;
}

function includedAggregateSearchSources(includedSources?: readonly Source[]) {
  const included = new Set(includedSources || aggregateSearchSources);
  return aggregateSearchSources.filter((source) => included.has(source));
}

export async function searchTopics({
  source,
  query,
  limit = source === 'yaohuo' ? 30 : 20,
  page = 1,
  categories = [],
  fetcher,
  fetcherForSource,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  includedSources,
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
  fetcherForSource?: (source: Source) => Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  includedSources?: readonly Source[];
  unavailableSources?: readonly Source[];
  sort?: SearchSort;
  filter?: SourceSearchFilter;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  if (source === 'yaohuo') {
    return searchYaohuoDirect({
      query,
      page,
      limit,
      category: filter?.source === 'yaohuo' ? filter.category : undefined,
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs
    });
  }
  const adapterQuery = positiveSearchQuery(query);
  const options = {
    authenticated: nodeSeekAuthenticated,
    limit,
    page,
    fetcher,
    nodeSeekUserAgent,
    signal,
    timeoutMs
  };
  if (source === 'all') {
    return runForumSourceReadAggregateAttempt(
      fetcher || fetch,
      async (aggregateFetcher, scopeFetcher) => {
        const sources = includedAggregateSearchSources(includedSources);
        const results = await Promise.allSettled(
          sources.map(async (item) => {
            if (unavailableSources?.includes(item)) {
              return requireSearchTopicTitles(await unavailableSourceRead(item));
            }
            const readSource = async (sourceFetcher: Fetcher) =>
              requireSearchTopicTitles(
                await searchTopics({
                  ...options,
                  source: item,
                  query: adapterQuery,
                  nodeSeekAuthenticated,
                  discourseAuth,
                  fetcher: sourceFetcher
                })
              );
            const sourceFetcher = fetcherForSource ? scopeFetcher(fetcherForSource(item)) : aggregateFetcher;
            return item === 'linuxdo' || item === 'nodeseek'
              ? runForumSourceReadAttempt(item, sourceFetcher, readSource, () => signal?.aborted !== true)
              : readSource(sourceFetcher);
          })
        );
        const expression = parseSearchExpression(query);
        const response = {
          items: sortTopicsByCreatedAt(
            filterExcludedSearchItems(
              results.flatMap((result) => (result.status === 'fulfilled' ? result.value.items : [])),
              expression
            )
          ),
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
      },
      () => signal?.aborted !== true
    );
  }
  const activeFilter = filter?.source === source ? filter : undefined;
  const response = isDiscourseSource(source)
    ? await searchLinuxDo(
        activeFilter && isDiscourseSearchFilter(activeFilter)
          ? buildDiscourseSearchQuery(adapterQuery, activeFilter, categories)
          : adapterQuery,
        {
          linuxDoAccess: discourseAuth,
          fetcher,
          limit,
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
  return filterSearchItems(requireSearchTopicTitles(response), query, activeFilter);
}
