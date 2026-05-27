import { fetchWithTimeout, type Fetcher } from './request';
import type { CategoriesResponse, FeedResponse, Reply, RepliesResponse, SearchResponse, Topic, TopicDetail, UserProfile } from './types';
import {
  accessRequirementFromObject,
  absoluteUrl,
  isRecord,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  textExcerpt,
  toIsoString
} from './localHtml';
import {
  DEFAULT_LINUXDO_ANDROID_USER_AGENT,
  isCloudflareChallengeResponse,
  loadLinuxDoAccess
} from './linuxdoCookieBridge';
import { matchesSearchExpression, parseSearchExpression, searchExpressionText } from './feedLogic';

const BASE_URL = 'https://linux.do';
const LIST_PAGE_SIZE = 30;
const TOPIC_STREAM_CACHE_LIMIT = 100;
const topicStreamCache = new Map<string, { stream: unknown[]; embeddedPostCount: number }>();
const UNCATEGORIZED_CATEGORY_NAME = '未分类';
const NEWEST_TOPIC_PARAMS = {
  order: 'created',
  ascending: 'false'
};

interface LinuxDoOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
  nocache?: boolean;
}

export class LinuxDoCloudflareError extends Error {
  source = 'linuxdo' as const;
  reason = 'cloudflare' as const;

  constructor() {
    super('linux.do 需要完成 Cloudflare 验证');
  }
}

function normalizeTopicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function usersById(users: unknown) {
  const map = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(users)) {
    return map;
  }
  for (const user of users) {
    if (isRecord(user) && user.id) {
      map.set(String(user.id), user);
    }
  }
  return map;
}

function categoryMapFromData(data: unknown) {
  const map = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>();
  if (!isRecord(data)) {
    return map;
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
    for (const category of list) {
      if (!isRecord(category) || !category.id || !category.name) {
        continue;
      }
      map.set(String(category.id), {
        name: String(category.name),
        accessRequirement: accessRequirementFromObject(category)
      });
    }
  }
  return map;
}

function userUrl(username: string) {
  return `${BASE_URL}/u/${encodeURIComponent(username)}`;
}

function isUncategorizedCategory(category: unknown) {
  if (!isRecord(category)) {
    return false;
  }
  const name = String(category.name || '').trim();
  const slug = String(category.slug || '').trim().toLowerCase();
  return name === UNCATEGORIZED_CATEGORY_NAME || slug === 'uncategorized';
}

function topicsNeedCategoryMap(topics: unknown[], categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>) {
  return topics.some((topic) => isRecord(topic) && topic.category_id && !categoryMap.has(String(topic.category_id)));
}

async function categoryMapForTopics(
  data: unknown,
  topics: unknown[],
  categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>,
  options: LinuxDoOptions
) {
  let nextCategoryMap = new Map([...categoryMap, ...categoryMapFromData(data)]);
  if (!topicsNeedCategoryMap(topics, nextCategoryMap)) {
    return nextCategoryMap;
  }
  try {
    const siteData = await fetchLinuxDoJson<Record<string, unknown>>('/site.json', undefined, options);
    nextCategoryMap = new Map([...nextCategoryMap, ...categoryMapFromData(siteData)]);
  } catch (error) {
    if (error instanceof LinuxDoCloudflareError) {
      throw error;
    }
  }
  return nextCategoryMap;
}

function originalPoster(topic: Record<string, unknown>, users: Map<string, Record<string, unknown>>) {
  const posters = Array.isArray(topic.posters) ? topic.posters : [];
  const poster = posters.find((item) => isRecord(item) && /original poster/i.test(String(item.description || '')))
    || posters.find(isRecord);
  return isRecord(poster) ? users.get(String(poster.user_id)) : undefined;
}

function normalizeTopic(raw: unknown, categoryMap = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>(), author?: string, authorData?: Record<string, unknown>): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = normalizeTopicId(raw.id);
  if (!id) {
    return null;
  }
  const createdAt = toIsoString(raw.created_at) || new Date().toISOString();
  const lastReplyAt = toIsoString(raw.bumped_at || raw.last_posted_at || raw.created_at) || createdAt;
  const category = raw.category_id ? categoryMap.get(String(raw.category_id)) : undefined;
  const accessRequirement = accessRequirementFromObject(raw) || category?.accessRequirement;
  const createdBy = isRecord(raw.details) && isRecord(raw.details.created_by) ? raw.details.created_by : {};
  const authorName = author || String(createdBy.username || raw.last_poster_username || '');
  const authorAvatar = avatarUrl(authorData?.avatar_template || createdBy.avatar_template);
  return {
    source: 'linuxdo',
    id,
    title: String(raw.title || ''),
    author: authorName,
    authorId: authorName || undefined,
    authorAvatar,
    authorUrl: authorName ? userUrl(authorName) : undefined,
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: category?.name || UNCATEGORIZED_CATEGORY_NAME,
    url: `${BASE_URL}/t/${raw.slug || id}/${id}`,
    createdAt,
    lastReplyAt,
    replyCount: Number(raw.posts_count ? Math.max(Number(raw.posts_count) - 1, 0) : 0),
    viewCount: Number(raw.views || 0),
    excerpt: textExcerpt(raw.excerpt || ''),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function avatarUrl(value: unknown) {
  const text = String(value || '');
  return text ? absoluteUrl(text.replace('{size}', '96'), BASE_URL) : undefined;
}

function quotedFloorsFromHtml(html: string, topicId?: string) {
  const floors = new Set<number>();
  for (const match of html.matchAll(/<aside\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\bclass=["'][^"']*\bquote\b[^"']*["']/i.test(tag)) {
      continue;
    }
    const dataTopic = tag.match(/\bdata-topic=["'](\d+)["']/i)?.[1];
    const dataPost = tag.match(/\bdata-post=["'](\d+)["']/i)?.[1];
    if (topicId && dataTopic && dataTopic !== topicId) {
      continue;
    }
    if (dataPost) {
      floors.add(Number(dataPost));
    }
  }
  return [...floors];
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function likedFromActionsSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const likeAction = value.find((item) => isRecord(item) && Number(item.id) === 2);
  return isRecord(likeAction) ? Boolean(likeAction.acted) : undefined;
}

function normalizePost(raw: unknown, index: number, topicId?: string, fallbackFloor = index + 1): Reply | null {
  if (!isRecord(raw)) {
    return null;
  }
  const contentHtml = sanitizeContentHtml(raw.cooked || '', BASE_URL);
  const quotedFloors = quotedFloorsFromHtml(contentHtml, topicId);
  const liked = likedFromActionsSummary(raw.actions_summary);
  return {
    author: String(raw.username || ''),
    authorId: String(raw.username || '') || undefined,
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: raw.username ? userUrl(String(raw.username)) : undefined,
    contentHtml,
    createdAt: toIsoString(raw.created_at),
    floor: typeof raw.post_number === 'number' ? raw.post_number : fallbackFloor,
    ...(quotedFloors.length ? { quotedFloors } : {}),
    ...(positiveNumber(raw.id) ? { commentId: positiveNumber(raw.id) } : {}),
    ...(positiveNumber(raw.like_count) !== undefined ? { likeCount: positiveNumber(raw.like_count) } : {}),
    ...(liked !== undefined ? { liked } : {}),
    ...(positiveNumber(raw.bookmark_id) ? { bookmarkId: positiveNumber(raw.bookmark_id), bookmarked: true } : typeof raw.bookmarked === 'boolean' ? { bookmarked: raw.bookmarked } : {})
  };
}

async function linuxDoHeaders() {
  const access = await loadLinuxDoAccess();
  return {
    Accept: 'application/json,text/plain,*/*',
    Referer: `${BASE_URL}/latest`,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'User-Agent': access?.userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
    ...(access?.cookieHeader ? { Cookie: access.cookieHeader } : {})
  };
}

async function fetchLinuxDoJson<T>(path: string, params: Record<string, string | number | Array<string | number>> | undefined, options: LinuxDoOptions = {}) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithTimeout(url.toString(), {
    headers: await linuxDoHeaders()
  }, options);
  const text = await response.text();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
    throw new LinuxDoCloudflareError();
  }
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        Object.assign(error, { status: response.status });
        throw error;
      }
      throw new Error('linux.do 返回内容格式不正确');
    }
  }
  if (!response.ok) {
    const error = new Error(isRecord(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return data as T;
}

function latestParams(page: number, category?: string) {
  return {
    ...NEWEST_TOPIC_PARAMS,
    ...(page > 1 ? { page: page - 1 } : {}),
    ...(category ? { category: /^\d+$/.test(category) ? Number(category) : category } : {})
  };
}

function topicStreamState(data: unknown) {
  const postStream = isRecord(data) && isRecord(data.post_stream) ? data.post_stream : {};
  const stream = Array.isArray(postStream.stream) ? postStream.stream : [];
  const embeddedPosts = Array.isArray(postStream.posts) ? postStream.posts : [];
  return { stream, embeddedPostCount: embeddedPosts.length };
}

function cacheTopicStream(id: string, data: unknown) {
  const state = topicStreamState(data);
  if (state.stream.length) {
    topicStreamCache.delete(id);
    topicStreamCache.set(id, state);
    while (topicStreamCache.size > TOPIC_STREAM_CACHE_LIMIT) {
      const oldestKey = topicStreamCache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      topicStreamCache.delete(oldestKey);
    }
  }
}

function cachedTopicStream(id: string) {
  const cached = topicStreamCache.get(id);
  if (cached) {
    topicStreamCache.delete(id);
    topicStreamCache.set(id, cached);
  }
  return cached;
}

export async function getLinuxDoFeed(options: LinuxDoOptions & {
  page?: number;
  limit?: number;
  category?: string;
} = {}): Promise<FeedResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const start = (page - 1) * limit;
  const firstListPage = Math.floor(start / LIST_PAGE_SIZE) + 1;
  const firstOffset = start % LIST_PAGE_SIZE;
  const collected: Topic[] = [];
  let listPage = firstListPage;
  let hasMore = false;
  let categoryMap = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>();
  while (collected.length < limit + 1) {
    const data = await fetchLinuxDoJson<Record<string, unknown>>('/latest.json', latestParams(listPage, options.category), options);
    const topics = isRecord(data.topic_list) && Array.isArray(data.topic_list.topics) ? data.topic_list.topics : [];
    categoryMap = await categoryMapForTopics(data, topics, categoryMap, options);
    const users = usersById(data.users);
    const items = topics.map((topic) => {
      const authorData = isRecord(topic) ? originalPoster(topic, users) : undefined;
      return normalizeTopic(topic, categoryMap, String(authorData?.username || ''), authorData);
    }).filter(Boolean) as Topic[];
    if (!items.length) {
      break;
    }
    collected.push(...(listPage === firstListPage && firstOffset > 0 ? items.slice(firstOffset) : items));
    if (collected.length > limit) {
      hasMore = true;
      break;
    }
    if (isRecord(data.topic_list) && data.topic_list.more_topics_url) {
      listPage += 1;
      continue;
    }
    break;
  }
  return {
    items: collected.slice(0, limit),
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
}

export async function getLinuxDoCategories(options: LinuxDoOptions = {}): Promise<CategoriesResponse> {
  const data = await fetchLinuxDoJson<Record<string, unknown>>('/site.json', undefined, options);
  const categories = Array.isArray(data.categories) ? data.categories : isRecord(data.category_list) && Array.isArray(data.category_list.categories) ? data.category_list.categories : [];
  return {
    items: categories.filter(isRecord).filter((category) => !isUncategorizedCategory(category)).map((category) => ({
      source: 'linuxdo' as const,
      id: String(category.id),
      name: String(category.name || ''),
      slug: typeof category.slug === 'string' ? category.slug : undefined
    })).filter((category) => category.id && category.name),
    errors: {}
  };
}

async function topicData(id: string, options: LinuxDoOptions) {
  return fetchLinuxDoJson<Record<string, unknown>>(`/t/${encodeURIComponent(id)}.json`, undefined, options);
}

export async function getLinuxDoTopic(id: string, options: LinuxDoOptions & { replyLimit?: number } = {}): Promise<TopicDetail> {
  const data = await topicData(id, options);
  const posts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const [firstPost, ...replyPosts] = posts;
  const categoryMap = await categoryMapForTopics(data, [data], categoryMapFromData(data), options);
  const topic = normalizeTopic(data, categoryMap, isRecord(firstPost) ? String(firstPost.username || '') : '', isRecord(firstPost) ? firstPost : undefined);
  if (!topic) {
    throw new Error('linux.do 主题不存在');
  }
  const replyLimit = options.replyLimit || 30;
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const replies = replyPosts.slice(0, replyLimit).map((post, index) => normalizePost(post, index, topic.id, index + 2)).filter(Boolean) as Reply[];
  const totalPosts = stream.length || Number(data.posts_count || posts.length);
  const replyHasMore = totalPosts > replies.length + 1;
  cacheTopicStream(id, data);
  cacheTopicStream(topic.id, data);
  return {
    ...topic,
    contentHtml: sanitizeContentHtml(isRecord(firstPost) ? firstPost.cooked || '' : '', BASE_URL),
    replies,
    replyHasMore,
    replyNextPage: replyHasMore ? 2 : null,
    replyNextOffset: replyHasMore ? replies.length : null,
    ...(isRecord(firstPost) && positiveNumber(firstPost.id) ? { commentId: positiveNumber(firstPost.id) } : {}),
    ...(isRecord(firstPost) && positiveNumber(firstPost.like_count) !== undefined ? { likeCount: positiveNumber(firstPost.like_count) } : {}),
    ...(isRecord(firstPost) && likedFromActionsSummary(firstPost.actions_summary) !== undefined ? { liked: likedFromActionsSummary(firstPost.actions_summary) } : {}),
    ...(positiveNumber(data.bookmark_id) ? { bookmarkId: positiveNumber(data.bookmark_id), bookmarked: true } : typeof data.bookmarked === 'boolean' ? { bookmarked: data.bookmarked } : {})
  };
}

async function fetchPosts(id: string, postIds: unknown[], options: LinuxDoOptions) {
  const data = await fetchLinuxDoJson<Record<string, unknown>>(`/t/${encodeURIComponent(id)}/posts.json`, { 'post_ids[]': postIds.map(String) }, options);
  return isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
}

export async function getLinuxDoReplies(id: string, options: LinuxDoOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
} = {}): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  let cached = page === 1 ? undefined : cachedTopicStream(id);
  if (!cached) {
    const data = await topicData(id, options);
    cacheTopicStream(id, data);
    cached = cachedTopicStream(id) || topicStreamState(data);
  }
  const stream = cached.stream;
  const firstPageReplyCount = cached.embeddedPostCount ? Math.min(limit, Math.max(cached.embeddedPostCount - 1, 0)) : limit;
  const previousReplyCount = page > 1
    ? typeof options.offset === 'number' ? options.offset : firstPageReplyCount + ((page - 2) * limit)
    : 0;
  const start = 1 + previousReplyCount;
  const postIds = stream.slice(start, start + limit);
  if (!postIds.length) {
    return { items: [], hasMore: false, nextPage: null };
  }
  const posts = await fetchPosts(id, postIds, options);
  const hasMore = stream.length > start + limit;
  return {
    items: posts.map((post, index) => normalizePost(post, index, id, previousReplyCount + index + 2)).filter(Boolean) as Reply[],
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    nextOffset: hasMore ? previousReplyCount + postIds.length : null
  };
}

export async function getLinuxDoReply(id: string, floor: number, options: LinuxDoOptions = {}): Promise<Reply> {
  const data = await topicData(id, options);
  const embeddedPosts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const embedded = embeddedPosts.find((post) => isRecord(post) && post.post_number === floor);
  if (embedded) {
    const reply = normalizePost(embedded, floor - 1, id, floor);
    if (reply) {
      return reply;
    }
  }
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const guessed = stream[floor - 1];
  if (!guessed) {
    throw new Error('引用楼层未找到');
  }
  const posts = await fetchPosts(id, [guessed], options);
  const post = posts.find((item) => isRecord(item) && item.post_number === floor) || posts[0];
  const reply = normalizePost(post, floor - 1, id, floor);
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return reply;
}

function topicMatchesSearch(topic: Topic, query: string) {
  return matchesSearchExpression(searchExpressionText(topic), parseSearchExpression(query));
}

async function searchLatestLinuxDoTopics(query: string, options: LinuxDoOptions & { limit?: number; page?: number }): Promise<SearchResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const latest = await getLinuxDoFeed({ ...options, limit: 100, page });
  return {
    items: latest.items.filter((topic) => topicMatchesSearch(topic, query)).slice(0, limit),
    errors: {},
    hasMore: Boolean(latest.hasMore),
    nextPage: latest.hasMore ? latest.nextPage ?? page + 1 : null
  };
}

export async function searchLinuxDo(query: string, options: LinuxDoOptions & { limit?: number; page?: number } = {}): Promise<SearchResponse> {
  const limit = options.limit || 30;
  const page = options.page || 1;
  try {
    const data = await fetchLinuxDoJson<Record<string, unknown>>('/search.json', {
      q: query,
      type_filter: 'topic',
      ...(page > 1 ? { page } : {})
    }, options);
    const users = usersById(data.users);
    const postsByTopicId = new Map<string, Record<string, unknown>>();
    if (Array.isArray(data.posts)) {
      data.posts.filter(isRecord).forEach((post) => postsByTopicId.set(String(post.topic_id), post));
    }
    const categoryMap = categoryMapFromData(data);
    const topics = Array.isArray(data.topics) ? data.topics : [];
    const items = topics.slice(0, limit).map((topic) => {
      const authorData = isRecord(topic) ? originalPoster(topic, users) : undefined;
      const normalized = normalizeTopic(topic, categoryMap, String(authorData?.username || ''), authorData);
      const post = isRecord(topic) ? postsByTopicId.get(String(topic.id)) : undefined;
      return normalized ? { ...normalized, excerpt: textExcerpt(post?.blurb || normalized.excerpt || '') } : null;
    }).filter(Boolean) as Topic[];
    const grouped = isRecord(data.grouped_search_result) ? data.grouped_search_result : {};
    const hasMore = Boolean(grouped.more_full_page_results) || topics.length > limit;
    if (!items.length && query.trim()) {
      return searchLatestLinuxDoTopics(query, { ...options, limit, page });
    }
    return {
      items,
      errors: {},
      hasMore,
      nextPage: hasMore ? page + 1 : null
    };
  } catch (error) {
    if (error instanceof LinuxDoCloudflareError) {
      throw error;
    }
    return searchLatestLinuxDoTopics(query, { ...options, limit, page });
  }
}

export async function getLinuxDoUserProfile(id: string, username: string, options: LinuxDoOptions = {}): Promise<UserProfile> {
  const name = (username || id).trim();
  if (!name) {
    throw new Error('linux.do 用户信息不完整');
  }
  const data = await fetchLinuxDoJson<Record<string, unknown>>(`/u/${encodeURIComponent(name)}/summary.json`, undefined, options);
  const summary = isRecord(data.user_summary) ? data.user_summary : {};
  const user = isRecord(summary.user) ? summary.user : isRecord(data.user) ? data.user : {};
  const resolvedUsername = String(user.username || name);
  const displayName = typeof user.name === 'string' ? user.name : resolvedUsername;
  const avatar = avatarUrl(user.avatar_template);
  const rawTopics = Array.isArray(data.topics) ? data.topics : [];
  const categoryMap = await categoryMapForTopics(data, rawTopics, categoryMapFromData(data), options);
  const topics = rawTopics.map((topic) => normalizeTopic(topic, categoryMap, resolvedUsername, user)).filter(Boolean) as Topic[];
  const visibleTopics = sortTopicsByCreatedAt(topics);
  return {
    source: 'linuxdo',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName,
    avatar,
    url: userUrl(resolvedUsername),
    bio: typeof user.bio_raw === 'string' ? user.bio_raw : typeof user.bio_excerpt === 'string' ? user.bio_excerpt : undefined,
    topicCount: Number(summary.topic_count || 0) || visibleTopics.length || undefined,
    replyCount: Number(summary.reply_count || 0) || undefined,
    postCount: Number(summary.post_count || 0) || undefined,
    topics: visibleTopics
  };
}
