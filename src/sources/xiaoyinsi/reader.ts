import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import type {
  CategoriesResponse,
  DiscourseFeedFilter,
  FeedResponse,
  Reply,
  RepliesResponse,
  Topic,
  TopicDetail
} from '@/domain/forum/models';
import { isRecord, parsePositiveInteger } from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  discourseCategories,
  discourseReplyWindow,
  discourseOriginalPoster,
  discoursePolls,
  discoursePostFields,
  discourseTopicFields,
  discourseUsersById
} from '@/sources/discourse/model';
import { discourseAvatarUrl, discourseQuoteMetadata } from '@/sources/discourse/content';
import { discourseEmojiUrlMapFromData, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { sanitizeXiaoyinsiContentHtml } from './parser';
import { XIAOYINSI_BASE_URL } from './protocol';
import { cleanCredentials, requestHeaders, type XiaoyinsiApiCredentials } from './credentials';

export const LIST_PAGE_SIZE = 30;
let emojiUrlCache: DiscourseEmojiUrlMap | null = null;

export interface XiaoyinsiOptions {
  credentials?: XiaoyinsiApiCredentials;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  trackVisit?: boolean;
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
    const message = data.errors
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
    return message || fallback;
  }
  return fallback;
}

export async function fetchXiaoyinsiJson<T>(
  path: string,
  params: Record<string, string | number | (string | number)[] | undefined> | undefined,
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
  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: requestHeaders(options.credentials)
    },
    options
  );
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
      responseErrorType: isRecord(data) && typeof data.error_type === 'string' ? data.error_type : undefined
    });
    throw error;
  }
  return data as T;
}

export function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function nonNegativeNumber(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function topicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

export function avatarUrl(value: unknown) {
  return discourseAvatarUrl(value, XIAOYINSI_BASE_URL);
}

export function userUrl(username: string) {
  return `${XIAOYINSI_BASE_URL}/u/${encodeURIComponent(username)}`;
}

export function levelLabel(raw?: Record<string, unknown>) {
  const value = raw?.trust_level ?? raw?.trustLevel;
  const level = value === '' || value === null || value === undefined ? NaN : Number(value);
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

export type CategoryMap = Map<string, string>;

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

export async function categoryMapForTopics(data: unknown, topics: unknown[], options: XiaoyinsiOptions) {
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

export function normalizeTopic(
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
    ...(trustLevel ? { authorLevelLabel: trustLevel } : {})
  };
}

function normalizePost(raw: unknown, currentTopicId?: string): Reply | null {
  const fields = discoursePostFields(raw);
  if (!isRecord(raw) || !fields) {
    return null;
  }
  const { cookedHtml, ...replyFields } = fields;
  const polls = discoursePolls(raw, { includeType: true });
  const sanitized = sanitizeXiaoyinsiContentHtml(cookedHtml, polls);
  const quote = discourseQuoteMetadata(sanitized, 'xiaoyinsi', currentTopicId);
  const username = String(raw.username || '').trim();
  const authorTrustLevel = levelLabel(raw);
  return {
    ...replyFields,
    authorId: username,
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: username ? userUrl(username) : undefined,
    contentHtml: quote.html,
    ...(quote.quotedPosts.length ? { quotedPosts: quote.quotedPosts } : {}),
    ...(authorTrustLevel ? { authorLevelLabel: authorTrustLevel } : {}),
    ...(polls ? { polls } : {})
  };
}

export async function getXiaoyinsiFeed(
  options: XiaoyinsiOptions & {
    page?: number;
    limit?: number;
    category?: string;
    feedFilter?: DiscourseFeedFilter;
  } = {}
): Promise<FeedResponse> {
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
  const items = rawTopics
    .map((raw) => (isRecord(raw) ? normalizeTopic(raw, categories, discourseOriginalPoster(raw, users)) : null))
    .filter((item): item is Topic => Boolean(item))
    .slice(0, limit);
  const hasMore = Boolean(isRecord(data.topic_list) && data.topic_list.more_topics_url);
  return annotateSourceDiagnosticSummary(
    { items, errors: {}, hasMore, nextPage: hasMore ? page + 1 : null },
    {
      parserVariant: 'xiaoyinsi-discourse-feed',
      candidateCount: rawTopics.length,
      validCount: items.length,
      droppedCount: Math.max(0, rawTopics.length - items.length),
      isExpectedEmpty: rawTopics.length === 0 && (page > 1 || Boolean(options.category))
    }
  );
}

export async function getXiaoyinsiCategories(options: XiaoyinsiOptions = {}): Promise<CategoriesResponse> {
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, options);
  const categories = Array.isArray(data.categories)
    ? data.categories
    : isRecord(data.category_list) && Array.isArray(data.category_list.categories)
      ? data.category_list.categories
      : [];
  const items = discourseCategories(data, 'xiaoyinsi');
  return annotateSourceDiagnosticSummary(
    { items, errors: {} },
    {
      parserVariant: 'xiaoyinsi-discourse-categories',
      candidateCount: categories.length,
      validCount: items.length,
      droppedCount: Math.max(0, categories.length - items.length)
    }
  );
}

export async function getXiaoyinsiEmojiUrls(options: XiaoyinsiOptions = {}) {
  if (emojiUrlCache) {
    return emojiUrlCache;
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/emojis.json', undefined, options);
  emojiUrlCache = discourseEmojiUrlMapFromData(data, XIAOYINSI_BASE_URL);
  return emojiUrlCache;
}

async function topicData(id: string, options: XiaoyinsiOptions, targetFloor?: number) {
  return fetchXiaoyinsiJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}${targetFloor ? `/${targetFloor}` : ''}.json`,
    {
      ...(cleanCredentials(options.credentials) ? { include_raw: 1 } : {}),
      ...(options.trackVisit ? { track_visit: 'true', forceLoad: 'true' } : {})
    },
    options
  );
}

export async function getXiaoyinsiTopic(
  id: string,
  options: XiaoyinsiOptions & { replyLimit?: number } = {}
): Promise<TopicDetail> {
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
    ...(bookmarkId
      ? { bookmarkId, bookmarked: true }
      : typeof data.bookmarked === 'boolean'
        ? { bookmarked: data.bookmarked }
        : {}),
    ...(polls ? { polls } : {}),
    ...(firstFields.reactionSummary ? { reactionSummary: firstFields.reactionSummary } : {})
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'xiaoyinsi-discourse-topic',
    candidateCount: posts.length,
    validCount: 1 + replies.length,
    droppedCount: Math.max(0, initialReplyPosts.length - replies.length),
    missingFloorCount: initialReplyPosts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number))
      .length
  });
}

async function fetchPosts(id: string, postIds: unknown[], options: XiaoyinsiOptions) {
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}/posts.json`,
    {
      'post_ids[]': postIds.map(String),
      ...(cleanCredentials(options.credentials) ? { include_raw: 1 } : {})
    },
    options
  );
  return isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
}

export async function getXiaoyinsiReplies(
  id: string,
  options: XiaoyinsiOptions & {
    page?: number;
    limit?: number;
    offset?: number | null;
    targetFloor?: number;
  } = {}
): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  if (options.targetFloor !== undefined && (!Number.isSafeInteger(options.targetFloor) || options.targetFloor <= 0)) {
    throw new Error('小隐寺目标楼层不正确');
  }
  if (options.targetFloor) {
    const window = discourseReplyWindow(await topicData(id, options, options.targetFloor), limit);
    const items = window.posts.map((post) => normalizePost(post, id)).filter((reply): reply is Reply => Boolean(reply));
    if (!items.some((reply) => reply.floor === options.targetFloor)) {
      throw new Error('小隐寺目标楼层未找到');
    }
    const { posts, ...windowState } = window;
    return annotateSourceDiagnosticSummary(
      { items, ...windowState },
      {
        parserVariant: 'xiaoyinsi-discourse-near-replies',
        candidateCount: posts.length,
        validCount: items.length,
        droppedCount: Math.max(0, posts.length - items.length),
        missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
      }
    );
  }
  const data = await topicData(id, options);
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const previousReplyCount = typeof options.offset === 'number' ? options.offset : Math.max(0, (page - 1) * limit);
  const previousOffset = previousReplyCount > 0 ? Math.max(0, previousReplyCount - limit) : null;
  const start = 1 + previousReplyCount;
  const postIds = stream.slice(start, start + limit);
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary(
      { items: [], hasMore: false, nextPage: null, totalCount: Math.max(0, stream.length - 1) },
      {
        parserVariant: 'xiaoyinsi-discourse-replies',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        isExpectedEmpty: true
      }
    );
  }
  const posts = await fetchPosts(id, postIds, options);
  const items = posts.map((post) => normalizePost(post, id)).filter((reply): reply is Reply => Boolean(reply));
  const hasMore = stream.length > start + postIds.length;
  return annotateSourceDiagnosticSummary(
    {
      items,
      currentPage: page,
      currentOffset: previousReplyCount,
      previousPage: previousOffset === null ? null : Math.floor(previousOffset / limit) + 1,
      previousOffset,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
      nextOffset: hasMore ? previousReplyCount + postIds.length : null,
      totalCount: Math.max(0, stream.length - 1)
    },
    {
      parserVariant: 'xiaoyinsi-discourse-replies',
      candidateCount: posts.length,
      validCount: items.length,
      droppedCount: Math.max(0, posts.length - items.length)
    }
  );
}

export async function getXiaoyinsiReply(id: string, floor: number, options: XiaoyinsiOptions = {}): Promise<Reply> {
  const data = await topicData(id, options);
  const embedded =
    isRecord(data.post_stream) && Array.isArray(data.post_stream.posts)
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
  const reply = normalizePost(
    posts.find((post) => isRecord(post) && Number(post.post_number) === floor),
    id
  );
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return reply;
}
