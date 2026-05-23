import { fetchWithTimeout, type Fetcher } from './request';
import type { CategoriesResponse, FeedResponse, Reply, RepliesResponse, SearchResponse, Topic, TopicDetail } from './types';
import {
  accessRequirementFromObject,
  absoluteUrl,
  isRecord,
  sanitizeContentHtml,
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

function originalPosterUsername(topic: Record<string, unknown>, users: Map<string, Record<string, unknown>>) {
  const posters = Array.isArray(topic.posters) ? topic.posters : [];
  const poster = posters.find((item) => isRecord(item) && /original poster/i.test(String(item.description || '')))
    || posters.find(isRecord);
  return isRecord(poster) ? String(users.get(String(poster.user_id))?.username || '') : '';
}

function normalizeTopic(raw: unknown, categoryMap = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>(), author?: string): Topic | null {
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
  return {
    source: 'linuxdo',
    id,
    title: String(raw.title || ''),
    author: author || (isRecord(raw.details) && isRecord(raw.details.created_by) ? String(raw.details.created_by.username || '') : '') || String(raw.last_poster_username || ''),
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: category?.name || (raw.category_id ? `#${raw.category_id}` : undefined),
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

function normalizePost(raw: unknown, index: number, topicId?: string, fallbackFloor = index + 1): Reply | null {
  if (!isRecord(raw)) {
    return null;
  }
  const contentHtml = sanitizeContentHtml(raw.cooked || '', BASE_URL);
  const quotedFloors = quotedFloorsFromHtml(contentHtml, topicId);
  return {
    author: String(raw.username || ''),
    authorAvatar: avatarUrl(raw.avatar_template),
    contentHtml,
    createdAt: toIsoString(raw.created_at),
    floor: typeof raw.post_number === 'number' ? raw.post_number : fallbackFloor,
    ...(quotedFloors.length ? { quotedFloors } : {})
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
    ...(page > 1 ? { page: page - 1 } : {}),
    ...(category ? { category: /^\d+$/.test(category) ? Number(category) : category } : {})
  };
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
    categoryMap = new Map([...categoryMap, ...categoryMapFromData(data)]);
    const topics = isRecord(data.topic_list) && Array.isArray(data.topic_list.topics) ? data.topic_list.topics : [];
    const users = usersById(data.users);
    const items = topics.map((topic) => normalizeTopic(topic, categoryMap, isRecord(topic) ? originalPosterUsername(topic, users) : '')).filter(Boolean) as Topic[];
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
    items: categories.filter(isRecord).map((category) => ({
      source: 'linuxdo' as const,
      id: String(category.id),
      name: String(category.name || ''),
      slug: typeof category.slug === 'string' ? category.slug : undefined,
      description: typeof category.description_text === 'string' ? category.description_text : typeof category.description === 'string' ? category.description : undefined,
      parentCategoryId: category.parent_category_id ? String(category.parent_category_id) : undefined,
      topicCount: Number(category.topic_count || category.topics_all_time || 0) || undefined
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
  const categoryMap = categoryMapFromData(data);
  const topic = normalizeTopic(data, categoryMap, isRecord(firstPost) ? String(firstPost.username || '') : '');
  if (!topic) {
    throw new Error('linux.do 主题不存在');
  }
  const replyLimit = options.replyLimit || 30;
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const replies = replyPosts.slice(0, replyLimit).map((post, index) => normalizePost(post, index, topic.id, index + 2)).filter(Boolean) as Reply[];
  const totalPosts = stream.length || Number(data.posts_count || posts.length);
  const replyHasMore = totalPosts > replies.length + 1;
  return {
    ...topic,
    contentHtml: sanitizeContentHtml(isRecord(firstPost) ? firstPost.cooked || '' : '', BASE_URL),
    replies,
    replyHasMore,
    replyNextPage: replyHasMore ? 2 : null,
    replyNextOffset: replyHasMore ? replies.length : null
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
  const data = await topicData(id, options);
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const embeddedPosts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const page = options.page || 1;
  const limit = options.limit || 30;
  const firstPageReplyCount = embeddedPosts.length ? Math.min(limit, Math.max(embeddedPosts.length - 1, 0)) : limit;
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

export async function searchLinuxDo(query: string, options: LinuxDoOptions & { limit?: number } = {}): Promise<SearchResponse> {
  const limit = options.limit || 30;
  try {
    const data = await fetchLinuxDoJson<Record<string, unknown>>('/search.json', { q: query }, options);
    const users = usersById(data.users);
    const postsByTopicId = new Map<string, Record<string, unknown>>();
    if (Array.isArray(data.posts)) {
      data.posts.filter(isRecord).forEach((post) => postsByTopicId.set(String(post.topic_id), post));
    }
    const categoryMap = categoryMapFromData(data);
    const topics = Array.isArray(data.topics) ? data.topics : [];
    return {
      items: topics.slice(0, limit).map((topic) => {
        const normalized = normalizeTopic(topic, categoryMap, isRecord(topic) ? originalPosterUsername(topic, users) : '');
        const post = isRecord(topic) ? postsByTopicId.get(String(topic.id)) : undefined;
        return normalized ? { ...normalized, excerpt: textExcerpt(post?.blurb || normalized.excerpt || '') } : null;
      }).filter(Boolean) as Topic[],
      errors: {}
    };
  } catch (error) {
    if (error instanceof LinuxDoCloudflareError) {
      throw error;
    }
    const latest = await getLinuxDoFeed({ ...options, limit: 100, page: 1 });
    return {
      items: latest.items.filter((topic) => topicMatchesSearch(topic, query)).slice(0, limit),
      errors: {}
    };
  }
}
