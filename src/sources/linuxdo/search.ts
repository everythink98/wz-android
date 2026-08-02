import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import type { DiscourseTagOption, DiscourseUserOption, SearchResponse, Topic } from '@/domain/forum/models';
import { elementText, isRecord, parseHtml, textExcerpt } from '@/domain/forum/html';
import { googleResultTargetUrl, googleSiteSearchUrl, hasGoogleSiteSearchNextPage } from '@/sources/searchFallback';
import { annotateSourceDiagnosticSummary, sourceDiagnosticSummary } from '@/sources/diagnostics';
import { discourseOriginalPoster, discourseUsersById } from '@/sources/discourse/model';
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

let csrfTokenCache: string | null = null;

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
  const results = Array.isArray(data.results) ? data.results : [];
  const seen = new Set<string>();
  return results.filter(isRecord).flatMap((item) => {
    const name = String(item.name || item.id || '').trim();
    if (!name || seen.has(name)) {
      return [];
    }
    seen.add(name);
    const count = Number(item.count ?? item.topic_count);
    return [{ name, ...(Number.isInteger(count) && count >= 0 ? { topicCount: count } : {}) }];
  });
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
  const users = Array.isArray(data.users) ? data.users : [];
  return users.filter(isRecord).flatMap((user) => {
    const username = String(user.username || '').trim();
    if (!username) {
      return [];
    }
    return [
      {
        id: String(user.id || username),
        username,
        ...(String(user.name || '').trim() ? { displayName: String(user.name).trim() } : {}),
        ...(avatarUrl(user.avatar_template) ? { avatar: avatarUrl(user.avatar_template) } : {})
      }
    ];
  });
}

async function linuxDoCsrfToken(options: LinuxDoOptions) {
  if (csrfTokenCache) {
    return csrfTokenCache;
  }
  try {
    const data = await fetchLinuxDoJson<Record<string, unknown>>('/session/csrf.json', undefined, options);
    const token = typeof data.csrf === 'string' ? data.csrf.trim() : '';
    csrfTokenCache = token || null;
    return csrfTokenCache || undefined;
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

function linuxDoTopicIdFromUrl(value: string) {
  try {
    const url = new URL(value, BASE_URL);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'linux.do' && !host.endsWith('.linux.do'))) {
      return null;
    }
    return url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/i)?.[1] || null;
  } catch {
    return null;
  }
}

function parseLinuxDoGoogleSearchTopics(html: string) {
  const root = parseHtml(html);
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const items: Topic[] = [];
  for (const link of root.querySelectorAll('a[href]')) {
    const target = googleResultTargetUrl(link.getAttribute('href') || '');
    const id = linuxDoTopicIdFromUrl(target);
    const title = elementText(link.querySelector('h3')) || elementText(link);
    if (!id || !title || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const row = link.parentNode as { text?: string } | null;
    const text = String(row?.text || link.text || '');
    items.push({
      source: 'linuxdo',
      id,
      title,
      author: '',
      url: `${BASE_URL}/t/${id}`,
      createdAt: now,
      lastReplyAt: now,
      replyCount: 0,
      excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(text.replace(title, ' ')))
    });
  }
  return items;
}

async function fetchLinuxDoGoogleSearchText(query: string, page: number, options: LinuxDoOptions = {}) {
  const response = await fetchWithTimeout(
    googleSiteSearchUrl('linux.do', query, page),
    withBrowserFetchIntent(
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
          'User-Agent': DEFAULT_LINUXDO_ANDROID_USER_AGENT
        }
      },
      options.browserFetchIntent || { owner: 'search', priority: 'foreground' }
    ),
    options
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

async function searchLinuxDoGoogle(
  query: string,
  options: LinuxDoOptions & { limit?: number; page?: number } = {}
): Promise<SearchResponse> {
  const cleanQuery = query.trim();
  const page = options.page || 1;
  if (!cleanQuery) {
    return annotateSourceDiagnosticSummary(
      { items: [], errors: {}, hasMore: false, nextPage: null },
      {
        parserVariant: 'google-search',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        isExpectedEmpty: true
      }
    );
  }
  const html = await fetchLinuxDoGoogleSearchText(cleanQuery, page, options);
  const nextPage = hasGoogleSiteSearchNextPage(html, 'linux.do', page + 1) ? page + 1 : null;
  const parsedItems = parseLinuxDoGoogleSearchTopics(html);
  const items = parsedItems.slice(0, options.limit || 30);
  const candidateCount = parsedItems.length;
  const result = {
    items,
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'google-search',
    candidateCount,
    validCount: items.length,
    droppedCount: Math.max(0, candidateCount - items.length),
    isExpectedEmpty: candidateCount === 0,
    hasRepeatedCursor: nextPage === page
  });
}

export async function searchLinuxDo(query: string, options: LinuxDoSearchOptions = {}): Promise<SearchResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'search', 'foreground');
  const limit = options.limit || 30;
  const page = options.page || 1;
  const cleanQuery = query.trim();
  const access = options.linuxDoAccess;
  if (!options.authenticated || access?.authenticated !== true) {
    return searchLinuxDoGoogle(cleanQuery, options);
  }
  const searchReferer = `${BASE_URL}/search?expanded=true&q=${encodeURIComponent(cleanQuery)}`;
  const csrfToken = await linuxDoCsrfToken(options);
  const start = Math.max(0, (page - 1) * limit);
  const firstSearchPage = Math.floor(start / SEARCH_PAGE_SIZE) + 1;
  const firstOffset = start % SEARCH_PAGE_SIZE;
  const needed = firstOffset + limit + 1;
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
      searchHasMore = false;
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
