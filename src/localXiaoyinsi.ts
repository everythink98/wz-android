import { fetchWithTimeout, type Fetcher } from './request';
import type {
  CategoriesResponse,
  DiscourseFeedFilter,
  FeedResponse,
  DiscourseTagOption,
  DiscourseUserOption,
  Reply,
  RepliesResponse,
  SearchResponse,
  Topic,
  TopicDetail,
  TopicPoll,
  UserProfile,
  UserReplyActivity
} from './types';
import {
  decodeHtml,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  textExcerpt,
  toIsoString
} from './localHtml';
import { annotateSourceDiagnosticSummary } from './sourceAdapterDiagnostics';
import { buildDiscourseLevelProfileFromSummary, type DiscourseLevelProfile } from './discourseLevel';
import { discourseCategories, discourseOriginalPoster, discoursePolls, discoursePostFields, discourseTopicFields, discourseUsersById } from './discourseModel';
import { discourseAvatarUrl, discoursePollPlaceholder, discourseQuoteMetadata } from './discourseContent';
import { discourseEmojiUrlMapFromData, type DiscourseEmojiUrlMap } from './discourseReactions';

export const XIAOYINSI_BASE_URL = 'https://forum.xiaoyinsi.com';
const LIST_PAGE_SIZE = 30;
let emojiUrlCache: DiscourseEmojiUrlMap | null = null;

export type XiaoyinsiApiCredentials = {
  apiKey: string;
  clientId: string;
};

export type XiaoyinsiLevelProfile = DiscourseLevelProfile;

export interface XiaoyinsiOptions {
  credentials?: XiaoyinsiApiCredentials;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function cleanCredentials(credentials?: XiaoyinsiApiCredentials) {
  const apiKey = credentials?.apiKey.trim() || '';
  const clientId = credentials?.clientId.trim() || '';
  return apiKey && clientId ? { apiKey, clientId } : undefined;
}

function requestHeaders(credentials?: XiaoyinsiApiCredentials) {
  const clean = cleanCredentials(credentials);
  return {
    Accept: 'application/json',
    ...(clean ? {
      'User-Api-Key': clean.apiKey,
      'User-Api-Client-Id': clean.clientId
    } : {})
  };
}

function errorText(data: unknown, fallback: string) {
  if (!isRecord(data)) {
    return fallback;
  }
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }
  if (Array.isArray(data.errors)) {
    const message = data.errors.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    return message || fallback;
  }
  return fallback;
}

async function fetchXiaoyinsiJson<T>(
  path: string,
  params: Record<string, string | number | Array<string | number> | undefined> | undefined,
  options: XiaoyinsiOptions = {}
) {
  const url = new URL(path, XIAOYINSI_BASE_URL);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithTimeout(url.toString(), {
    headers: requestHeaders(options.credentials)
  }, options);
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(response.ok ? '小隐寺返回内容格式不正确' : `HTTP ${response.status}`);
    Object.assign(error, { source: 'xiaoyinsi', status: response.status });
    throw error;
  }
  if (!response.ok) {
    const error = new Error(errorText(data, `HTTP ${response.status}`));
    Object.assign(error, {
      source: 'xiaoyinsi',
      status: response.status,
      responseFormat: 'json',
      responseErrorType: isRecord(data) && typeof data.error_type === 'string'
        ? data.error_type
        : undefined
    });
    throw error;
  }
  return data as T;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegativeNumber(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function topicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function avatarUrl(value: unknown) {
  return discourseAvatarUrl(value, XIAOYINSI_BASE_URL);
}

function userUrl(username: string) {
  return `${XIAOYINSI_BASE_URL}/u/${encodeURIComponent(username)}`;
}

function levelLabel(raw?: Record<string, unknown>) {
  const value = raw?.trust_level ?? raw?.trustLevel;
  const level = value === '' || value === null || value === undefined ? NaN : Number(value);
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

type CategoryMap = Map<string, string>;

function categoryMapFromData(data: unknown) {
  const result: CategoryMap = new Map();
  if (!isRecord(data)) {
    return result;
  }
  const lists = [
    data.categories,
    isRecord(data.category_list) ? data.category_list.categories : undefined,
    isRecord(data.topic_list) ? data.topic_list.categories : undefined
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    list.filter(isRecord).forEach((category) => {
      if (category.id !== undefined && category.name) {
        result.set(String(category.id), String(category.name));
      }
    });
  }
  return result;
}

async function categoryMapForTopics(data: unknown, topics: unknown[], options: XiaoyinsiOptions) {
  const categories = categoryMapFromData(data);
  const needsSiteCategories = topics.some((topic) => {
    if (!isRecord(topic) || topic.category_id === undefined || topic.category_id === null) {
      return false;
    }
    return !categories.has(String(topic.category_id));
  });
  if (!needsSiteCategories) {
    return categories;
  }
  try {
    const siteData = await fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, options);
    return new Map([...categories, ...categoryMapFromData(siteData)]);
  } catch {
    return categories;
  }
}

function normalizeTopic(
  raw: unknown,
  categories: CategoryMap,
  authorData?: Record<string, unknown>,
  allowUnknownAuthor = false
): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const fields = discourseTopicFields(raw);
  if (!fields) {
    return null;
  }
  const createdBy = isRecord(raw.details) && isRecord(raw.details.created_by) ? raw.details.created_by : {};
  const author = String(authorData?.username || createdBy.username || '').trim();
  if (!author && !allowUnknownAuthor) {
    return null;
  }
  const trustLevel = levelLabel(authorData) || levelLabel(createdBy);
  return {
    ...fields,
    source: 'xiaoyinsi',
    author,
    authorId: author || undefined,
    authorAvatar: avatarUrl(authorData?.avatar_template || createdBy.avatar_template),
    authorUrl: author ? userUrl(author) : undefined,
    category: fields.categoryId ? categories.get(fields.categoryId) || '未分类' : '未分类',
    url: `${XIAOYINSI_BASE_URL}/t/${raw.slug || fields.id}/${fields.id}`,
    createdAt: fields.createdAt,
    ...(trustLevel ? { authorLevelLabel: trustLevel } : {}),
  };
}

export function sanitizeXiaoyinsiContentHtml(html: unknown, polls?: TopicPoll[]) {
  const root = parseHtml(html);
  const names = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  root.querySelectorAll('.poll').forEach((node) => {
    const name = String(node.getAttribute('data-poll-name') || '').trim();
    if (name && names.has(name)) {
      node.replaceWith(discoursePollPlaceholder(name));
    }
  });
  return sanitizeContentHtml(root.toString(), XIAOYINSI_BASE_URL);
}

function normalizePost(raw: unknown, currentTopicId?: string): Reply | null {
  const fields = discoursePostFields(raw);
  if (!isRecord(raw) || !fields) {
    return null;
  }
  const { cookedHtml, ...replyFields } = fields;
  const polls = discoursePolls(raw, { includeType: true });
  const sanitized = sanitizeXiaoyinsiContentHtml(cookedHtml, polls);
  const quote = discourseQuoteMetadata(sanitized, currentTopicId);
  const username = String(raw.username || '').trim();
  const authorTrustLevel = levelLabel(raw);
  return {
    ...replyFields,
    authorId: username,
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: username ? userUrl(username) : undefined,
    contentHtml: quote.html,
    ...(quote.floors.length ? { quotedFloors: quote.floors } : {}),
    ...(Object.keys(quote.authors).length ? { quotedAuthors: quote.authors } : {}),
    ...(Object.keys(quote.previews).length ? { quotedPreviews: quote.previews } : {}),
    ...(authorTrustLevel ? { authorLevelLabel: authorTrustLevel } : {}),
    ...(polls ? { polls } : {})
  };
}

export async function getXiaoyinsiFeed(options: XiaoyinsiOptions & {
  page?: number;
  limit?: number;
  category?: string;
  feedFilter?: DiscourseFeedFilter;
} = {}): Promise<FeedResponse> {
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  const feedFilter = options.feedFilter || 'latest';
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    feedFilter === 'hot' ? '/hot.json' : feedFilter.startsWith('new-') ? '/new.json' : '/latest.json',
    {
      ...(page > 1 ? { page: page - 1 } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(feedFilter === 'new-topics' ? { subset: 'topics' } : {}),
      ...(feedFilter === 'new-replies' ? { subset: 'replies' } : {})
    },
    options
  );
  const rawTopics = isRecord(data.topic_list) && Array.isArray(data.topic_list.topics) ? data.topic_list.topics : [];
  const users = discourseUsersById(data.users);
  const categories = await categoryMapForTopics(data, rawTopics, options);
  const items = rawTopics.map((raw) => isRecord(raw) ? normalizeTopic(raw, categories, discourseOriginalPoster(raw, users)) : null)
    .filter((item): item is Topic => Boolean(item))
    .slice(0, limit);
  const hasMore = Boolean(isRecord(data.topic_list) && data.topic_list.more_topics_url);
  return annotateSourceDiagnosticSummary({ items, errors: {}, hasMore, nextPage: hasMore ? page + 1 : null }, {
    parserVariant: 'xiaoyinsi-discourse-feed',
    candidateCount: rawTopics.length,
    validCount: items.length,
    droppedCount: Math.max(0, rawTopics.length - items.length),
    isExpectedEmpty: rawTopics.length === 0 && (page > 1 || Boolean(options.category))
  });
}

export async function getXiaoyinsiCategories(options: XiaoyinsiOptions = {}): Promise<CategoriesResponse> {
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, options);
  const categories = Array.isArray(data.categories)
    ? data.categories
    : isRecord(data.category_list) && Array.isArray(data.category_list.categories) ? data.category_list.categories : [];
  const items = discourseCategories(data, 'xiaoyinsi');
  return annotateSourceDiagnosticSummary({ items, errors: {} }, {
    parserVariant: 'xiaoyinsi-discourse-categories',
    candidateCount: categories.length,
    validCount: items.length,
    droppedCount: Math.max(0, categories.length - items.length)
  });
}

export async function getXiaoyinsiEmojiUrls(options: XiaoyinsiOptions = {}) {
  if (emojiUrlCache) {
    return emojiUrlCache;
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/emojis.json', undefined, options);
  emojiUrlCache = discourseEmojiUrlMapFromData(data, XIAOYINSI_BASE_URL);
  return emojiUrlCache;
}

async function topicData(id: string, options: XiaoyinsiOptions) {
  return fetchXiaoyinsiJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}.json`,
    cleanCredentials(options.credentials) ? { include_raw: 1 } : undefined,
    options
  );
}

export async function getXiaoyinsiTopic(id: string, options: XiaoyinsiOptions & { replyLimit?: number } = {}): Promise<TopicDetail> {
  const data = await topicData(id, options);
  const posts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const [firstPost, ...replyPosts] = posts;
  const firstFields = discoursePostFields(firstPost);
  if (!firstFields) {
    throw new Error('小隐寺主题正文解析失败');
  }
  const categories = await categoryMapForTopics(data, [data], options);
  const normalized = normalizeTopic(data, categories, isRecord(firstPost) ? firstPost : undefined);
  if (!normalized) {
    throw new Error('小隐寺主题不存在');
  }
  const replyLimit = options.replyLimit || LIST_PAGE_SIZE;
  const initialReplyPosts = replyPosts.slice(0, replyLimit);
  const replies = initialReplyPosts
    .map((post) => normalizePost(post, normalized.id))
    .filter((reply): reply is Reply => Boolean(reply));
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const polls = discoursePolls(firstPost, { includeType: true });
  const details = isRecord(data.details) ? data.details : {};
  const bookmarkId = firstFields.bookmarkId || positiveNumber(data.bookmark_id);
  const totalPosts = stream.length || normalized.replyCount + 1;
  const result: TopicDetail = {
    ...normalized,
    contentHtml: sanitizeXiaoyinsiContentHtml(firstFields.cookedHtml, polls),
    replies,
    replyHasMore: totalPosts > initialReplyPosts.length + 1,
    replyNextPage: totalPosts > initialReplyPosts.length + 1 ? 2 : null,
    replyNextOffset: totalPosts > initialReplyPosts.length + 1 ? initialReplyPosts.length : null,
    ...(details.can_create_post === true ? { canCreatePost: true } : {}),
    ...(firstFields.commentId ? { commentId: firstFields.commentId } : {}),
    ...(firstFields.likeCount === undefined ? {} : { likeCount: firstFields.likeCount }),
    ...(firstFields.liked === undefined ? {} : { liked: firstFields.liked }),
    ...(firstFields.canLike === undefined ? {} : { canLike: firstFields.canLike }),
    ...(bookmarkId ? { bookmarkId, bookmarked: true } : typeof data.bookmarked === 'boolean' ? { bookmarked: data.bookmarked } : {}),
    ...(polls ? { polls } : {}),
    ...(firstFields.reactionSummary ? { reactionSummary: firstFields.reactionSummary } : {})
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'xiaoyinsi-discourse-topic',
    candidateCount: posts.length,
    validCount: 1 + replies.length,
    droppedCount: Math.max(0, initialReplyPosts.length - replies.length),
    missingFloorCount: initialReplyPosts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
  });
}

async function fetchPosts(id: string, postIds: unknown[], options: XiaoyinsiOptions) {
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(`/t/${encodeURIComponent(id)}/posts.json`, {
    'post_ids[]': postIds.map(String),
    ...(cleanCredentials(options.credentials) ? { include_raw: 1 } : {})
  }, options);
  return isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
}

export async function getXiaoyinsiReplies(id: string, options: XiaoyinsiOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
} = {}): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  const data = await topicData(id, options);
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const previousReplyCount = typeof options.offset === 'number' ? options.offset : Math.max(0, (page - 1) * limit);
  const start = 1 + previousReplyCount;
  const postIds = stream.slice(start, start + limit);
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary({ items: [], hasMore: false, nextPage: null, totalCount: Math.max(0, stream.length - 1) }, {
      parserVariant: 'xiaoyinsi-discourse-replies', candidateCount: 0, validCount: 0, droppedCount: 0, isExpectedEmpty: true
    });
  }
  const posts = await fetchPosts(id, postIds, options);
  const items = posts.map((post) => normalizePost(post, id))
    .filter((reply): reply is Reply => Boolean(reply));
  const hasMore = stream.length > start + postIds.length;
  return annotateSourceDiagnosticSummary({
    items,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    nextOffset: hasMore ? previousReplyCount + postIds.length : null,
    totalCount: Math.max(0, stream.length - 1)
  }, {
    parserVariant: 'xiaoyinsi-discourse-replies',
    candidateCount: posts.length,
    validCount: items.length,
    droppedCount: Math.max(0, posts.length - items.length)
  });
}

export async function getXiaoyinsiReply(id: string, floor: number, options: XiaoyinsiOptions = {}): Promise<Reply> {
  const data = await topicData(id, options);
  const embedded = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts)
    ? data.post_stream.posts.find((post) => isRecord(post) && Number(post.post_number) === floor)
    : undefined;
  if (embedded) {
    const reply = normalizePost(embedded, id);
    if (reply) {
      return reply;
    }
  }
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const postId = stream[floor - 1];
  if (!postId) {
    throw new Error('引用楼层未找到');
  }
  const posts = await fetchPosts(id, [postId], options);
  const reply = normalizePost(posts.find((post) => isRecord(post) && Number(post.post_number) === floor), id);
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return reply;
}

async function topicsFromSearch(data: Record<string, unknown>, options: XiaoyinsiOptions) {
  const rawTopics = Array.isArray(data.topics) ? data.topics : [];
  const users = discourseUsersById(data.users);
  const postsByTopic = new Map<string, Record<string, unknown>>();
  (Array.isArray(data.posts) ? data.posts : []).filter(isRecord).forEach((post) => postsByTopic.set(String(post.topic_id), post));
  const categories = await categoryMapForTopics(data, rawTopics, options);
  const items: Topic[] = rawTopics.flatMap((raw): Topic[] => {
    if (!isRecord(raw)) {
      return [];
    }
    const post = postsByTopic.get(String(raw.id));
    const authorData = discourseOriginalPoster(raw, users) || (Number(post?.post_number) === 1 ? post : undefined);
    const topic = normalizeTopic(raw, categories, authorData, true);
    return topic ? [{ ...topic, excerpt: textExcerpt(post?.blurb || topic.excerpt || '') }] : [];
  });
  const grouped = isRecord(data.grouped_search_result) ? data.grouped_search_result : {};
  return { items, candidateCount: rawTopics.length, hasMore: Boolean(grouped.more_full_page_results) };
}

export async function searchXiaoyinsi(query: string, options: XiaoyinsiOptions & { page?: number; limit?: number } = {}): Promise<SearchResponse> {
  const cleanQuery = query.trim();
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  if (!cleanQuery) {
    return { items: [], errors: {}, hasMore: false, nextPage: null };
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/search.json', { q: cleanQuery, page }, options);
  const parsed = await topicsFromSearch(data, options);
  const items = parsed.items.slice(0, limit);
  return annotateSourceDiagnosticSummary({ items, errors: {}, hasMore: parsed.hasMore, nextPage: parsed.hasMore ? page + 1 : null }, {
    parserVariant: 'xiaoyinsi-discourse-search',
    candidateCount: parsed.candidateCount,
    validCount: items.length,
    droppedCount: Math.max(0, parsed.candidateCount - items.length),
    isExpectedEmpty: parsed.candidateCount === 0
  });
}

export async function searchXiaoyinsiTags(options: XiaoyinsiOptions & {
  query?: string;
  categoryId?: string;
  selectedTags?: string[];
  limit?: number;
} = {}): Promise<DiscourseTagOption[]> {
  const limit = Math.min(8, Math.max(1, Math.floor(options.limit || 8)));
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/tags/filter/search', {
    q: options.query?.trim() || '',
    ...(options.categoryId?.trim() ? { categoryId: options.categoryId.trim() } : {}),
    ...(options.selectedTags?.length ? { 'selected_tags[]': options.selectedTags } : {})
  }, options);
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
  }).slice(0, limit);
}

export async function searchXiaoyinsiUsers(options: XiaoyinsiOptions & {
  term: string;
  categoryId?: string;
  limit?: number;
}): Promise<DiscourseUserOption[]> {
  const term = options.term.trim();
  if (!term) {
    return [];
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/u/search/users', {
    term,
    include_groups: 'false',
    limit: options.limit || 20,
    ...(options.categoryId?.trim() ? { category_id: options.categoryId.trim() } : {})
  }, options);
  const users = Array.isArray(data.users) ? data.users : [];
  return users.filter(isRecord).flatMap((user) => {
    const username = String(user.username || '').trim();
    if (!username) {
      return [];
    }
    return [{
      id: String(user.id || username),
      username,
      ...(String(user.name || '').trim() ? { displayName: String(user.name).trim() } : {}),
      ...(avatarUrl(user.avatar_template) ? { avatar: avatarUrl(user.avatar_template) } : {})
    }];
  });
}

function normalizeUserAction(raw: unknown, username: string, categories: CategoryMap): UserReplyActivity | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = topicId(raw.topic_id);
  const title = decodeHtml(raw.title || raw.topic_title || '');
  if (!id || !title) {
    return null;
  }
  const floor = positiveNumber(raw.post_number);
  const slug = String(raw.slug || id);
  const url = `${XIAOYINSI_BASE_URL}/t/${slug}/${id}${floor ? `/${floor}` : ''}`;
  return {
    source: 'xiaoyinsi',
    id: String(raw.post_id || raw.id || `${id}:${floor || 0}`),
    topicId: id,
    topicTitle: title,
    topicUrl: `${XIAOYINSI_BASE_URL}/t/${slug}/${id}`,
    url,
    author: username,
    authorId: username,
    authorUrl: userUrl(username),
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: raw.category_id ? categories.get(String(raw.category_id)) : undefined,
    createdAt: toIsoString(raw.created_at) || undefined,
    ...(floor ? { floor } : {}),
    excerpt: textExcerpt(raw.excerpt || raw.content || '')
  };
}

export async function getXiaoyinsiUserProfile(id: string, username: string, options: XiaoyinsiOptions = {}): Promise<UserProfile> {
  const name = (username || id).trim();
  if (!name) {
    throw new Error('小隐寺用户信息不完整');
  }
  const cursorType = options.cursorType;
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const topicPage = cursorType === 'topics' ? parsePositiveInteger(options.cursor) || 0 : 0;
  const replyOffset = parsePositiveInteger(options.cursor) || 0;
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(`/u/${encodeURIComponent(name)}/summary.json`, undefined, options);
  const summary = isRecord(data.user_summary) ? data.user_summary : {};
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  const dataUser = isRecord(data.user) ? data.user : {};
  const listedUser = (Array.isArray(data.users) ? data.users : []).find((candidate) => (
    isRecord(candidate)
    && (String(candidate.username || '').toLowerCase() === name.toLowerCase() || String(candidate.id || '') === id)
  ));
  const user = { ...(isRecord(listedUser) ? listedUser : {}), ...dataUser, ...summaryUser };
  const resolvedUsername = String(user.username || name).trim();
  let topicData: Record<string, unknown> = {};
  if (wantsTopics) {
    topicData = await fetchXiaoyinsiJson<Record<string, unknown>>(
      `/topics/created-by/${encodeURIComponent(resolvedUsername)}.json`,
      topicPage > 0 ? { page: topicPage } : undefined,
      options
    );
  }
  const topicList = isRecord(topicData.topic_list) ? topicData.topic_list : {};
  const rawTopics = Array.isArray(topicList.topics) ? topicList.topics : [];
  let rawActions: unknown[] = [];
  if (wantsReplies) {
    const actions = await fetchXiaoyinsiJson<Record<string, unknown>>('/user_actions.json', {
      offset: replyOffset,
      username: resolvedUsername,
      filter: 5
    }, options);
    rawActions = Array.isArray(actions.user_actions) ? actions.user_actions : [];
  }
  const categories = await categoryMapForTopics(topicData, [...rawTopics, ...rawActions], options);
  const topicUsers = discourseUsersById(topicData.users);
  const topics = rawTopics.map((raw) => isRecord(raw)
    ? normalizeTopic(raw, categories, discourseOriginalPoster(raw, topicUsers) || user)
    : null).filter((item): item is Topic => Boolean(item));
  const replies = rawActions.map((action) => normalizeUserAction(action, resolvedUsername, categories))
    .filter((item): item is UserReplyActivity => Boolean(item));
  const trustLevel = levelLabel(user);
  return annotateSourceDiagnosticSummary({
    source: 'xiaoyinsi',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName: typeof user.name === 'string' ? user.name : resolvedUsername,
    avatar: avatarUrl(user.avatar_template),
    url: userUrl(resolvedUsername),
    bio: typeof user.bio_raw === 'string' ? user.bio_raw : typeof user.bio_excerpt === 'string' ? user.bio_excerpt : undefined,
    topicCount: nonNegativeNumber(summary.topic_count) ?? (topics.length || undefined),
    replyCount: nonNegativeNumber(summary.reply_count),
    postCount: nonNegativeNumber(summary.post_count),
    ...(trustLevel ? { levelLabel: trustLevel } : {}),
    topics: sortTopicsByCreatedAt(topics),
    hasMoreTopics: Boolean(topicList.more_topics_url),
    nextTopicsCursor: topicList.more_topics_url ? String(topicPage + 1) : null,
    replies,
    hasMoreReplies: rawActions.length >= LIST_PAGE_SIZE,
    nextRepliesCursor: rawActions.length >= LIST_PAGE_SIZE ? String(replyOffset + LIST_PAGE_SIZE) : null
  }, {
    parserVariant: 'xiaoyinsi-discourse-user',
    candidateCount: 1 + rawTopics.length + rawActions.length,
    validCount: 1 + topics.length + replies.length,
    droppedCount: Math.max(0, rawTopics.length + rawActions.length - topics.length - replies.length)
  });
}

export async function getXiaoyinsiCurrentUserProfile(options: XiaoyinsiOptions = {}): Promise<UserProfile> {
  if (!cleanCredentials(options.credentials)) {
    throw new Error('请先授权小隐寺');
  }
  let data: Record<string, unknown>;
  try {
    data = await fetchXiaoyinsiJson<Record<string, unknown>>('/session/current.json', undefined, options);
  } catch (error) {
    const candidate = error && typeof error === 'object'
      ? error as { responseErrorType?: unknown; responseFormat?: unknown; status?: unknown }
      : {};
    if (candidate.status === 403
      && candidate.responseFormat === 'json'
      && candidate.responseErrorType === 'invalid_access') {
      throw Object.assign(new Error('小隐寺授权已失效，请重新授权。'), {
        source: 'xiaoyinsi' as const,
        kind: 'login-expired' as const,
        loginRequired: true,
        reason: 'expired' as const
      });
    }
    throw error;
  }
  if (data.current_user === null || data.user === null) {
    throw Object.assign(new Error('小隐寺授权已失效，请重新授权。'), {
      source: 'xiaoyinsi' as const,
      kind: 'login-expired' as const,
      loginRequired: true,
      reason: 'expired' as const
    });
  }
  const currentUser = isRecord(data.current_user) ? data.current_user : isRecord(data.user) ? data.user : {};
  const username = String(currentUser.username || '').trim();
  if (!username) {
    throw new Error('无法读取当前小隐寺用户，请重新授权。');
  }
  const trustLevel = levelLabel(currentUser);
  return {
    source: 'xiaoyinsi',
    id: username,
    username,
    displayName: typeof currentUser.name === 'string' ? currentUser.name : username,
    avatar: avatarUrl(currentUser.avatar_template),
    url: userUrl(username),
    ...(trustLevel ? { levelLabel: trustLevel } : {}),
    topics: []
  };
}

export async function getXiaoyinsiLevelProfile(options: XiaoyinsiOptions = {}): Promise<XiaoyinsiLevelProfile> {
  const currentUser = await getXiaoyinsiCurrentUserProfile(options);
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    `/u/${encodeURIComponent(currentUser.username)}/summary.json`,
    undefined,
    options
  );
  if (!isRecord(data.user_summary)) {
    throw new Error('小隐寺等级数据格式不正确');
  }
  const listedUser = (Array.isArray(data.users) ? data.users : []).find((candidate) => (
    isRecord(candidate) && String(candidate.username || '').toLowerCase() === currentUser.username.toLowerCase()
  ));
  return buildDiscourseLevelProfileFromSummary({
    ...data.user_summary,
    username: currentUser.username,
    user: isRecord(listedUser) ? listedUser : {}
  });
}
