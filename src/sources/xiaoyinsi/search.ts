import type { DiscourseTagOption, DiscourseUserOption, SearchResponse, Topic } from '@/domain/forum/models';
import { isRecord, textExcerpt } from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import { discourseOriginalPoster, discourseUsersById } from '@/sources/discourse/model';
import { stripDiscourseCalloutMarkersFromExcerpt } from '@/sources/discourse/content';
import {
  LIST_PAGE_SIZE,
  avatarUrl,
  categoryMapForTopics,
  fetchXiaoyinsiJson,
  normalizeTopic,
  type XiaoyinsiOptions
} from './reader';

async function topicsFromSearch(data: Record<string, unknown>, options: XiaoyinsiOptions) {
  const rawTopics = Array.isArray(data.topics) ? data.topics : [];
  const users = discourseUsersById(data.users);
  const postsByTopic = new Map<string, Record<string, unknown>>();
  (Array.isArray(data.posts) ? data.posts : [])
    .filter(isRecord)
    .forEach((post) => postsByTopic.set(String(post.topic_id), post));
  const categories = await categoryMapForTopics(data, rawTopics, options);
  const items: Topic[] = rawTopics.flatMap((raw): Topic[] => {
    if (!isRecord(raw)) {
      return [];
    }
    const post = postsByTopic.get(String(raw.id));
    const authorData = discourseOriginalPoster(raw, users) || (Number(post?.post_number) === 1 ? post : undefined);
    const topic = normalizeTopic(raw, categories, authorData, true);
    return topic
      ? [
          {
            ...topic,
            excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(post?.blurb || topic.excerpt || ''))
          }
        ]
      : [];
  });
  const grouped = isRecord(data.grouped_search_result) ? data.grouped_search_result : {};
  return { items, candidateCount: rawTopics.length, hasMore: Boolean(grouped.more_full_page_results) };
}

export async function searchXiaoyinsi(
  query: string,
  options: XiaoyinsiOptions & { page?: number; limit?: number } = {}
): Promise<SearchResponse> {
  const cleanQuery = query.trim();
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  if (!cleanQuery) {
    return { items: [], errors: {}, hasMore: false, nextPage: null };
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/search.json', { q: cleanQuery, page }, options);
  const parsed = await topicsFromSearch(data, options);
  const items = parsed.items.slice(0, limit);
  return annotateSourceDiagnosticSummary(
    { items, errors: {}, hasMore: parsed.hasMore, nextPage: parsed.hasMore ? page + 1 : null },
    {
      parserVariant: 'xiaoyinsi-discourse-search',
      candidateCount: parsed.candidateCount,
      validCount: items.length,
      droppedCount: Math.max(0, parsed.candidateCount - items.length),
      isExpectedEmpty: parsed.candidateCount === 0
    }
  );
}

export async function searchXiaoyinsiTags(
  options: XiaoyinsiOptions & {
    query?: string;
    categoryId?: string;
    selectedTags?: string[];
    limit?: number;
  } = {}
): Promise<DiscourseTagOption[]> {
  const limit = Math.min(8, Math.max(1, Math.floor(options.limit || 8)));
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    '/tags/filter/search',
    {
      q: options.query?.trim() || '',
      ...(options.categoryId?.trim() ? { categoryId: options.categoryId.trim() } : {}),
      ...(options.selectedTags?.length ? { 'selected_tags[]': options.selectedTags } : {})
    },
    options
  );
  const results = Array.isArray(data.results) ? data.results : [];
  const seen = new Set<string>();
  return results
    .filter(isRecord)
    .flatMap((item) => {
      const name = String(item.name || item.id || '').trim();
      if (!name || seen.has(name)) {
        return [];
      }
      seen.add(name);
      const count = Number(item.count ?? item.topic_count);
      return [{ name, ...(Number.isInteger(count) && count >= 0 ? { topicCount: count } : {}) }];
    })
    .slice(0, limit);
}

export async function searchXiaoyinsiUsers(
  options: XiaoyinsiOptions & {
    term: string;
    categoryId?: string;
    limit?: number;
  }
): Promise<DiscourseUserOption[]> {
  const term = options.term.trim();
  if (!term) {
    return [];
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
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
