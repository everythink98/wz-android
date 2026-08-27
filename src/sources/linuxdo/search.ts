import type { DiscourseTagOption, DiscourseUserOption, SearchResponse, Topic } from '@/domain/forum/models';
import { isRecord, textExcerpt } from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary, sourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  discourseOriginalPoster,
  discourseTagOptions,
  discourseUserOptions,
  discourseUsersById
} from '@/sources/discourse/model';
import { stripDiscourseCalloutMarkersFromExcerpt } from '@/sources/discourse/content';
import { LINUXDO_BASE_URL as BASE_URL, linuxDoAvatarUrl as avatarUrl } from './protocol';
import {
  categoryMapForTopics,
  categoryMapFromData,
  fetchLinuxDoJson,
  linuxDoOptionsWithBrowserIntent,
  normalizeTopic,
  type LinuxDoOptions
} from './reader';

const SEARCH_PAGE_SIZE = 50;

type LinuxDoSearchOptions = LinuxDoOptions & {
  authenticated?: boolean;
  limit?: number;
  page?: number;
};

export async function searchLinuxDoTags(
  options: LinuxDoOptions & {
    query?: string;
    categoryId?: string;
    selectedTags?: string[];
    limit?: number;
  } = {}
): Promise<DiscourseTagOption[]> {
  options = linuxDoOptionsWithBrowserIntent(options, 'search', 'foreground');
  const limit = Math.min(8, Math.max(1, Math.floor(options.limit || 8)));
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    '/tags/filter/search',
    {
      q: options.query?.trim() || '',
      limit,
      ...(options.categoryId?.trim() ? { categoryId: options.categoryId.trim() } : {}),
      ...(options.selectedTags?.length ? { 'selected_tags[]': options.selectedTags } : {})
    },
    options
  );
  return discourseTagOptions(data.results);
}

export async function searchLinuxDoUsers(
  options: LinuxDoOptions & {
    term: string;
    categoryId?: string;
    limit?: number;
  }
): Promise<DiscourseUserOption[]> {
  options = linuxDoOptionsWithBrowserIntent(options, 'search', 'foreground');
  const term = options.term.trim();
  if (!term) {
    return [];
  }
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    '/u/search/users',
    {
      term,
      include_groups: 'false',
      limit: options.limit || 20,
      ...(options.categoryId?.trim() ? { category_id: options.categoryId.trim() } : {})
    },
    options
  );
  return discourseUserOptions(data.users, avatarUrl);
}

async function linuxDoCsrfToken(options: LinuxDoOptions) {
  try {
    const data = await fetchLinuxDoJson<Record<string, unknown>>('/session/csrf.json', undefined, options);
    const token = typeof data.csrf === 'string' ? data.csrf.trim() : '';
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function topicsFromLinuxDoSearchData(
  data: Record<string, unknown>,
  options: LinuxDoOptions
): Promise<{ items: Topic[]; hasMore: boolean }> {
  const users = discourseUsersById(data.users);
  const postsByTopicId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(data.posts)) {
    data.posts.filter(isRecord).forEach((post) => postsByTopicId.set(String(post.topic_id), post));
  }
  const topics = Array.isArray(data.topics) ? data.topics : [];
  const categoryMap = await categoryMapForTopics(data, topics, categoryMapFromData(data), options);
  const items = topics
    .map((topic) => {
      const post = isRecord(topic) ? postsByTopicId.get(String(topic.id)) : undefined;
      const authorData =
        (isRecord(topic) ? discourseOriginalPoster(topic, users) : undefined) ||
        (Number(post?.post_number) === 1 ? post : undefined);
      const author = String(authorData?.username || '').trim();
      const normalized = normalizeTopic(topic, categoryMap, author || null, authorData);
      return normalized
        ? {
            ...normalized,
            excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(post?.blurb || normalized.excerpt || ''))
          }
        : null;
    })
    .filter(Boolean) as Topic[];
  const grouped = isRecord(data.grouped_search_result) ? data.grouped_search_result : {};
  const result = {
    items,
    hasMore: Boolean(grouped.more_full_page_results)
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-search-page',
    candidateCount: topics.length,
    validCount: items.length,
    droppedCount: Math.max(0, topics.length - items.length),
    isExpectedEmpty: topics.length === 0
  });
}

export async function searchLinuxDo(query: string, options: LinuxDoSearchOptions = {}): Promise<SearchResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'search', 'foreground');
  const limit = options.limit || 30;
  const page = options.page || 1;
  const cleanQuery = query.trim();
  const access = options.linuxDoAccess;
  if (!options.authenticated || access?.authenticated !== true) {
    throw Object.assign(new Error('linux.do 匿名搜索由外部浏览器提供'), {
      kind: 'login-required' as const,
      loginRequired: true,
      reason: 'login-required',
      source: 'linuxdo' as const
    });
  }
  const searchReferer = `${BASE_URL}/search?expanded=true&q=${encodeURIComponent(cleanQuery)}`;
  const csrfToken = await linuxDoCsrfToken(options);
  const start = Math.max(0, (page - 1) * limit);
  const firstSearchPage = Math.floor(start / SEARCH_PAGE_SIZE) + 1;
  const firstOffset = start % SEARCH_PAGE_SIZE;
  const needed = firstOffset + limit;
  const collected: Topic[] = [];
  let searchPage = firstSearchPage;
  let searchHasMore = false;
  let candidateCount = 0;
  let droppedCount = 0;
  while (collected.length < needed) {
    const data = await fetchLinuxDoJson<Record<string, unknown>>(
      '/search',
      {
        q: cleanQuery,
        page: searchPage
      },
      options,
      { referer: searchReferer, csrfToken }
    );
    const result = await topicsFromLinuxDoSearchData(data, options);
    const pageSummary = sourceDiagnosticSummary(result);
    candidateCount += pageSummary?.candidateCount || result.items.length;
    droppedCount += pageSummary?.droppedCount || 0;
    if (!result.items.length) {
      searchHasMore = result.hasMore;
      if (result.hasMore && (pageSummary?.candidateCount || 0) > 0) {
        searchPage += 1;
        continue;
      }
      break;
    }
    collected.push(...result.items);
    searchHasMore = result.hasMore;
    if (!result.hasMore) {
      break;
    }
    searchPage += 1;
  }
  const items = collected.slice(firstOffset, firstOffset + limit);
  const hasMore = collected.length > firstOffset + limit || searchHasMore;
  const result = {
    items,
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-search',
    candidateCount,
    validCount: items.length,
    droppedCount,
    isExpectedEmpty: candidateCount === 0,
    hasRepeatedCursor: result.nextPage === page
  });
}

export async function searchLinuxDoSemantic(query: string, options: LinuxDoOptions = {}): Promise<SearchResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'search', 'foreground');
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return annotateSourceDiagnosticSummary(
      { items: [], errors: {}, hasMore: false, nextPage: null },
      {
        parserVariant: 'discourse-ai-search',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        isExpectedEmpty: true
      }
    );
  }
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    '/discourse-ai/embeddings/semantic-search',
    {
      q: cleanQuery
    },
    options,
    { referer: `${BASE_URL}/search?expanded=true&q=${encodeURIComponent(cleanQuery)}` }
  );
  const parsed = await topicsFromLinuxDoSearchData(data, options);
  const items = parsed.items.map((topic) => ({ ...topic, isAiGenerated: true }));
  const summary = sourceDiagnosticSummary(parsed);
  return annotateSourceDiagnosticSummary(
    { items, errors: {}, hasMore: false, nextPage: null },
    {
      parserVariant: 'discourse-ai-search',
      candidateCount: summary?.candidateCount || items.length,
      validCount: items.length,
      droppedCount: summary?.droppedCount || 0,
      isExpectedEmpty: items.length === 0
    }
  );
}
