import { fetchWithTimeout, REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import type {
  CategoriesResponse,
  DiscourseFeedFilter,
  FeedResponse,
  Reply,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  Topic,
  TopicDetail
} from '@/domain/forum/models';
import { isRecord, parsePositiveInteger } from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  assertDiscourseTopicIdentity,
  discourseCategories,
  discourseOriginalPoster,
  discoursePolls,
  discoursePostFields,
  discourseRepliesInStreamOrder,
  discourseReplyWindow,
  discourseStreamReplyWindow,
  discourseTopicFields,
  discourseUsersById,
  discourseVisiblePostIds
} from '@/sources/discourse/model';
import { discourseAvatarUrl, discourseQuoteMetadata } from '@/sources/discourse/content';
import { discourseEmojiUrlMapFromData, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { sanitizeXiaoyinsiContentHtml } from './parser';
import { XIAOYINSI_BASE_URL } from './protocol';
import { cleanCredentials, requestHeaders, type XiaoyinsiApiCredentials } from './credentials';
import { orientReplyWindow } from '@/sources/replyWindows';

export const LIST_PAGE_SIZE = 30;
let emojiUrlCache: DiscourseEmojiUrlMap | null = null;
const ANONYMOUS_CATEGORY_SCOPE = Symbol('anonymous-xiaoyinsi-categories');
type CategoryScope = typeof ANONYMOUS_CATEGORY_SCOPE | number | XiaoyinsiApiCredentials;
let publicCategoryScope: CategoryScope = ANONYMOUS_CATEGORY_SCOPE;
let publicCategoryCache: CategoryMap = new Map();
let publicCategoryRequest: Promise<Record<string, unknown>> | null = null;

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

function activateCategoryScope(options: XiaoyinsiOptions) {
  const credentials = cleanCredentials(options.credentials);
  const generation = options.credentials?.generation;
  const scope: CategoryScope = credentials
    ? Number.isSafeInteger(generation) && generation! >= 0
      ? generation!
      : options.credentials!
    : ANONYMOUS_CATEGORY_SCOPE;
  if (scope !== publicCategoryScope) {
    publicCategoryScope = scope;
    publicCategoryCache = new Map();
    publicCategoryRequest = null;
  }
  return scope;
}

function fetchPublicCategoryData(options: XiaoyinsiOptions) {
  const scope = activateCategoryScope(options);
  if (!publicCategoryRequest) {
    const request = fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, {
      ...options,
      signal: undefined
    })
      .then((data) => {
        if (publicCategoryScope === scope && publicCategoryRequest === request) {
          publicCategoryCache = new Map([...publicCategoryCache, ...categoryMapFromData(data)]);
        }
        return data;
      })
      .finally(() => {
        if (publicCategoryScope === scope && publicCategoryRequest === request) {
          publicCategoryRequest = null;
        }
      });
    publicCategoryRequest = request;
  }
  return publicCategoryRequest;
}

function waitForPublicCategoryData(options: XiaoyinsiOptions) {
  const request = fetchPublicCategoryData(options);
  const signal = options.signal;
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new Error(REQUEST_CANCELED_MESSAGE));
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new Error(REQUEST_CANCELED_MESSAGE));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.then(
      (data) => {
        signal.removeEventListener('abort', onAbort);
        resolve(data);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export function resetXiaoyinsiCategoryCacheForTests() {
  publicCategoryScope = ANONYMOUS_CATEGORY_SCOPE;
  publicCategoryCache = new Map();
  publicCategoryRequest = null;
}

function needsPublicCategories(categories: CategoryMap, topics: unknown[]) {
  return topics.some((topic) => {
    if (!isRecord(topic) || topic.category_id === undefined || topic.category_id === null) {
      return false;
    }
    return !categories.has(String(topic.category_id));
  });
}

function publicCategoryMapForTopics(data: unknown, topics: unknown[], options: XiaoyinsiOptions) {
  activateCategoryScope(options);
  const categories = new Map([...publicCategoryCache, ...categoryMapFromData(data)]);
  if (!needsPublicCategories(categories, topics)) {
    return categories;
  }
  void fetchPublicCategoryData(options).catch(() => undefined);
  return categories;
}

export async function categoryMapForTopics(data: unknown, topics: unknown[], options: XiaoyinsiOptions) {
  activateCategoryScope(options);
  const categories = new Map([...publicCategoryCache, ...categoryMapFromData(data)]);
  if (!needsPublicCategories(categories, topics)) return categories;
  try {
    const siteData = await waitForPublicCategoryData(options);
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
  const categories = publicCategoryMapForTopics(data, rawTopics, options);
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
  const data = await waitForPublicCategoryData(options);
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
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}${targetFloor ? `/${targetFloor}` : ''}.json`,
    {
      ...(cleanCredentials(options.credentials) ? { include_raw: 1 } : {}),
      ...(options.trackVisit ? { track_visit: 'true', forceLoad: 'true' } : {})
    },
    options
  );
  assertDiscourseTopicIdentity(data, id);
  return data;
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
  const categories = publicCategoryMapForTopics(data, [data], options);
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
  const totalPosts = stream.length || (normalized.replyCount || 0) + 1;
  const result: TopicDetail = {
    ...normalized,
    mediaReferrer: { documentUrl: normalized.url },
    contentHtml: sanitizeXiaoyinsiContentHtml(firstFields.cookedHtml, polls),
    replies,
    replyCompleteness: replies.length === initialReplyPosts.length ? ('complete' as const) : ('partial' as const),
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
    order: ReplyOrder;
    position: ReplyWindowPosition;
    limit?: number;
  }
): Promise<RepliesResponse> {
  const limit = options.limit || LIST_PAGE_SIZE;
  if (options.position.kind === 'target') {
    const targetFloor = options.position.target.floor;
    if (!Number.isSafeInteger(targetFloor) || targetFloor! <= 0) {
      throw new Error('小隐寺目标楼层不正确');
    }
    const window = discourseReplyWindow(await topicData(id, options, targetFloor), limit);
    const items = window.posts.map((post) => normalizePost(post, id)).filter((reply): reply is Reply => Boolean(reply));
    const targetCommentId = options.position.target.commentId;
    const hasTarget = items.some((reply) =>
      targetCommentId === undefined ? reply.floor === targetFloor : reply.commentId === targetCommentId
    );
    if (!hasTarget) {
      throw new Error('小隐寺目标楼层未找到');
    }
    const { posts, ...windowState } = window;
    const chronological = annotateSourceDiagnosticSummary(
      {
        items,
        ...windowState,
        completeness: items.length === posts.length ? ('complete' as const) : ('partial' as const)
      },
      {
        parserVariant: 'xiaoyinsi-discourse-near-replies',
        candidateCount: posts.length,
        validCount: items.length,
        droppedCount: Math.max(0, posts.length - items.length),
        missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
      }
    );
    return orientReplyWindow(chronological, options.order);
  }
  const data = await topicData(id, options);
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const { postIds, ...windowState } = discourseStreamReplyWindow(stream, {
    limit,
    order: options.order,
    position: options.position
  });
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary(
      { items: [], ...windowState },
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
  const visiblePostIds = discourseVisiblePostIds(posts, postIds);
  const items = discourseRepliesInStreamOrder(
    posts.map((post) => normalizePost(post, id)).filter((reply): reply is Reply => Boolean(reply)),
    visiblePostIds,
    options.order
  );
  return annotateSourceDiagnosticSummary(
    {
      items,
      ...windowState,
      completeness:
        posts.length === postIds.length && items.length === postIds.length
          ? ('complete' as const)
          : ('partial' as const)
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
