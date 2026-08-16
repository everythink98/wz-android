import type { HTMLElement } from 'node-html-parser';

import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import type { DiscourseTagOption, DiscourseUserOption, SearchResponse, Topic } from '@/domain/forum/models';
import { decodeHtml, elementText, isRecord, parseHtml, textExcerpt } from '@/domain/forum/html';
import { googleResultTargetUrl, googleSiteSearchUrl, hasGoogleSiteSearchNextPage } from '@/sources/searchFallback';
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

function linuxDoGoogleResultTitle(value: string, target: string) {
  const title = decodeHtml(value).replace(/\s+/g, ' ').trim();
  if (!title || /^(?:https?:\/\/|www\.)/i.test(title) || /^linux\.do(?:\s*(?:›|>|»|\/)\s*\S+)*$/i.test(title)) {
    return '';
  }
  try {
    const targetUrl = new URL(target);
    const pathSegments = targetUrl.pathname.split('/').filter(Boolean);
    const topicIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === 't');
    const slug = topicIndex >= 0 ? decodeURIComponent(pathSegments[topicIndex + 1] || '') : '';
    if (slug && title.toLowerCase() === slug.toLowerCase()) {
      return '';
    }
  } catch {
    return '';
  }
  return title;
}

function linuxDoGoogleTitleFromLink(link: HTMLElement, target: string) {
  const heading = elementText(link.querySelector('h3, [role="heading"]'));
  return (
    linuxDoGoogleResultTitle(heading, target) ||
    linuxDoGoogleResultTitle(String(link.getAttribute('aria-label') || ''), target)
  );
}

function isExplicitEmptyGoogleSearchPage(root: ReturnType<typeof parseHtml>) {
  return /(?:did not match any documents|no results found|找不到和(?:您的)?查询相符的内容|没有找到相关结果)/i.test(
    elementText(root)
  );
}

function parseLinuxDoGoogleSearchTopics(root: ReturnType<typeof parseHtml>) {
  const candidates = new Map<string, { id: string; target: string; title: string; rowText: string }>();
  const now = new Date().toISOString();
  for (const link of root.querySelectorAll('a[href]')) {
    const target = googleResultTargetUrl(link.getAttribute('href') || '');
    const id = linuxDoTopicIdFromUrl(target);
    if (!id) {
      continue;
    }
    const title = linuxDoGoogleTitleFromLink(link, target);
    const row = link.parentNode as { text?: string } | null;
    const existing = candidates.get(id);
    if (!existing) {
      candidates.set(id, { id, target, title, rowText: String(row?.text || link.text || '') });
    } else if (!existing.title && title) {
      candidates.set(id, { ...existing, target, title, rowText: String(row?.text || link.text || '') });
    }
  }
  const items: Topic[] = [...candidates.values()].flatMap(({ id, title, rowText }) =>
    title
      ? [
          {
            source: 'linuxdo',
            id,
            title,
            author: '',
            url: `${BASE_URL}/t/${id}`,
            createdAt: now,
            lastReplyAt: now,
            replyCount: 0,
            excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(rowText.replace(title, ' ')))
          } satisfies Topic
        ]
      : []
  );
  return {
    items,
    candidateCount: candidates.size,
    missingTitleCount: Math.max(0, candidates.size - items.length),
    isExpectedEmpty: candidates.size === 0 && isExplicitEmptyGoogleSearchPage(root)
  };
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
  const root = parseHtml(html);
  const nextPage = hasGoogleSiteSearchNextPage(root, 'linux.do', page + 1) ? page + 1 : null;
  const parsed = parseLinuxDoGoogleSearchTopics(root);
  const items = parsed.items.slice(0, options.limit || 30);
  const parseError =
    parsed.candidateCount > 0 && parsed.items.length === 0
      ? 'Google 搜索结果缺少可确认的标题'
      : parsed.candidateCount === 0 && !parsed.isExpectedEmpty
        ? 'Google 搜索结果结构已变化'
        : '';
  const result = {
    items,
    errors: parseError
      ? {
          linuxdo: {
            kind: 'ordinary' as const,
            message: parseError,
            reason: 'parse_empty',
            retryable: true
          }
        }
      : {},
    hasMore: Boolean(nextPage),
    nextPage
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'google-search',
    candidateCount: parsed.candidateCount,
    validCount: parsed.items.length,
    droppedCount: parsed.missingTitleCount,
    missingTitleCount: parsed.missingTitleCount,
    hasDegradation: parsed.missingTitleCount > 0,
    isExpectedEmpty: parsed.isExpectedEmpty,
    isParseEmpty: Boolean(parseError),
    hasRepeatedCursor: nextPage === page
  });
}

function linuxDoSearchSessionExpired(error: unknown) {
  if (!isRecord(error)) return false;
  return (
    Number(error.status) === 401 || (isRecord(error.accessRequirement) && error.accessRequirement.type === 'login')
  );
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
  const needed = firstOffset + limit;
  const collected: Topic[] = [];
  let searchPage = firstSearchPage;
  let searchHasMore = false;
  let candidateCount = 0;
  let droppedCount = 0;
  try {
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
  } catch (error) {
    if (linuxDoSearchSessionExpired(error)) {
      return searchLinuxDoGoogle(cleanQuery, options);
    }
    throw error;
  }
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
