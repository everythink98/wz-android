import { searchNodeSeek } from '@/sources/nodeseek/reader';
import { searchV2ex } from '@/sources/v2ex/search';
import { searchYaohuoDirect } from '@/sources/yaohuo/reader';
import { searchLinuxDo } from '@/sources/linuxdo/search';
import type { LinuxDoReadAuth } from '@/sources/linuxdo/reader';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import {
  parseSearchExpression,
  positiveSearchQuery,
  searchExpressionText,
  type SearchExpression,
  type SearchSort
} from '@/domain/forum/feed';
import {
  buildDiscourseSearchQuery,
  filterSearchResponseItems,
  isDiscourseSearchFilter,
  type SourceSearchFilter
} from '@/domain/forum/searchFilters';
import type { Category, SearchResponse, Source, Topic } from '@/domain/forum/models';
import type { Fetcher } from '@/platform/network/request';
import { copySourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { dispatchSourceRead } from './readAggregation';

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

export async function searchTopics({
  source,
  query,
  limit = source === 'yaohuo' ? 30 : 20,
  page = 1,
  categories = [],
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  sort = 'relevance',
  filter,
  signal,
  timeoutMs
}: {
  source: Source;
  query: string;
  limit?: number;
  page?: number;
  categories?: Category[];
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: LinuxDoReadAuth;
  sort?: SearchSort;
  filter?: SourceSearchFilter;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<SearchResponse> {
  const adapterQuery = positiveSearchQuery(query);
  if (source === 'yaohuo') {
    const response = await searchYaohuoDirect({
      query: adapterQuery,
      page,
      limit,
      category: filter?.source === 'yaohuo' ? filter.category : undefined,
      yaohuoFetcher: fetcher,
      signal,
      timeoutMs
    });
    return filterSearchItems(requireSearchTopicTitles(response), query);
  }
  const options = {
    authenticated: nodeSeekAuthenticated,
    limit,
    page,
    fetcher,
    nodeSeekUserAgent,
    signal,
    timeoutMs
  };
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
