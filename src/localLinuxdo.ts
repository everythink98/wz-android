import { fetchWithTimeout, type Fetcher } from './request';
import type { CategoriesResponse, FeedResponse, ReactionSummary, Reply, RepliesResponse, SearchResponse, Topic, TopicDetail, TopicPoll, TopicPollOption, UserProfile } from './types';
import {
  accessRequirementFromObject,
  accessRequirementFromText,
  decodeHtml,
  isRecord,
  parseHtml,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  textContentFromHtml,
  textExcerpt,
  toIsoString
} from './localHtml';
import { isCloudflareChallengeResponse } from './cloudflareChallenge';
import {
  DEFAULT_LINUXDO_ANDROID_USER_AGENT,
  linuxDoAccessSummary,
  loadLinuxDoAccess
} from './linuxdoCookieBridge';
import {
  LINUXDO_BASE_URL as BASE_URL,
  LINUXDO_UNCATEGORIZED_CATEGORY_NAME as UNCATEGORIZED_CATEGORY_NAME,
  isLinuxDoUncategorizedCategory as isUncategorizedCategory,
  linuxDoAvatarUrl as avatarUrl,
  linuxDoLatestParams as latestParams,
  linuxDoUserUrl as userUrl,
  normalizeLinuxDoTopicId as normalizeTopicId,
  preferredLinuxDoAccessRequirement
} from './localLinuxdoHelpers';
import { linuxDoEmojiUrlMapFromData, type LinuxDoEmojiUrlMap } from './linuxdoReactions';

const LIST_PAGE_SIZE = 30;
const SEARCH_PAGE_SIZE = 50;
const TOPIC_STREAM_CACHE_LIMIT = 100;
const topicStreamCache = new Map<string, { stream: unknown[]; embeddedPostCount: number }>();
let csrfTokenCache: string | null = null;
let emojiUrlCache: LinuxDoEmojiUrlMap | null = null;

interface LinuxDoOptions {
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class LinuxDoCloudflareError extends Error {
  source = 'linuxdo' as const;
  reason = 'cloudflare' as const;

  constructor() {
    super('linux.do 需要完成 Cloudflare 验证');
  }
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
  const accessRequirement = preferredLinuxDoAccessRequirement(accessRequirementFromObject(raw), category?.accessRequirement);
  const createdBy = isRecord(raw.details) && isRecord(raw.details.created_by) ? raw.details.created_by : {};
  const authorName = author || String(createdBy.username || raw.last_poster_username || '');
  const authorAvatar = avatarUrl(authorData?.avatar_template || createdBy.avatar_template);
  const tags = tagNames(raw.tags);
  const acceptedAnswerFloor = acceptedAnswerPostNumber(raw);
  const slowModeSeconds = positiveNumber(raw.slow_mode_seconds);
  return {
    source: 'linuxdo',
    id,
    title: decodeHtml(raw.unicode_title || raw.title || ''),
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
    ...(tags.length ? { tags } : {}),
    ...(raw.closed === true ? { closed: true } : {}),
    ...(raw.archived === true ? { archived: true } : {}),
    ...(raw.pinned === true || raw.pinned_globally === true ? { pinned: true } : {}),
    ...(raw.has_accepted_answer === true || acceptedAnswerFloor ? { solved: true } : {}),
    ...(acceptedAnswerFloor ? { acceptedAnswerFloor } : {}),
    ...(slowModeSeconds ? { slowModeSeconds } : {}),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function linuxDoErrorText(data: unknown, fallback = '') {
  if (!isRecord(data)) {
    return fallback;
  }
  if (typeof data.error === 'string') {
    return data.error;
  }
  if (typeof data.message === 'string') {
    return data.message;
  }
  if (Array.isArray(data.errors)) {
    return data.errors.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
  }
  return fallback;
}

function linuxDoAccessRequirementFromError(error: unknown): Topic['accessRequirement'] | undefined {
  return error && typeof error === 'object'
    ? (error as { accessRequirement?: Topic['accessRequirement'] }).accessRequirement
    : undefined;
}

function quotedAuthorFromTitle(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.match(/^([^:：]{1,64})\s*[:：]/)?.[1]?.trim()
    || text.match(/([^:：\s]{1,64})\s*[:：]\s*$/)?.[1]?.trim()
    || '';
}

function quotedAuthorFromAvatarUrl(value: string) {
  const clean = value.trim();
  const match = clean.match(/(?:^|\/)user_avatar\/(?:[^/?#]+\/)?([^/?#]+)\/\d+(?:\/|$)/i)
    || clean.match(/(?:^|\/)letter_avatar\/([^/?#]+)\/\d+(?:\/|$)/i);
  if (!match) {
    return '';
  }
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

function localQuotedFloorFromAside(node: ReturnType<typeof parseHtml>, topicId?: string) {
  const className = String(node.getAttribute('class') || '');
  if (!/\bquote\b/i.test(className)) {
    return undefined;
  }
  const dataTopic = String(node.getAttribute('data-topic') || '');
  const dataPost = String(node.getAttribute('data-post') || '');
  if (topicId && dataTopic && dataTopic !== topicId) {
    return undefined;
  }
  const floor = Number(dataPost);
  return Number.isFinite(floor) && floor > 0 ? floor : undefined;
}

function quotedReferencesFromHtml(html: string, topicId?: string) {
  const floors = new Set<number>();
  const authors: Record<number, string> = {};
  const root = parseHtml(html);
  root.querySelectorAll('aside').forEach((node) => {
    const floor = localQuotedFloorFromAside(node, topicId);
    if (!floor) {
      return;
    }
    floors.add(floor);

    const author = decodeHtml(node.getAttribute('data-username') || node.getAttribute('data-display-name') || '').trim()
      || quotedAuthorFromAvatarUrl(String(node.querySelector('.title img')?.getAttribute('src') || ''))
      || quotedAuthorFromTitle(textContentFromHtml(node.querySelector('.title')?.toString() || ''));
    if (author) {
      authors[floor] = author;
    }
  });
  return { floors: [...floors], authors };
}

function contentHtmlWithoutLocalQuoteAsides(html: string, topicId?: string) {
  if (!topicId) {
    return html;
  }
  const root = parseHtml(html);
  let changed = false;
  root.querySelectorAll('aside').forEach((node) => {
    if (localQuotedFloorFromAside(node, topicId)) {
      node.remove();
      changed = true;
    }
  });
  return changed ? root.toString() : html;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegativeNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function likedFromActionsSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const likeAction = value.find((item) => isRecord(item) && Number(item.id) === 2);
  return isRecord(likeAction) ? Boolean(likeAction.acted) : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function tagNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (typeof item === 'string') {
      return item.trim();
    }
    if (!isRecord(item)) {
      return '';
    }
    return String(item.name || item.slug || '').trim();
  }).filter(Boolean);
}

function acceptedAnswerPostNumber(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.accepted_answers)) {
    return undefined;
  }
  const answer = value.accepted_answers.find(isRecord);
  return positiveNumber(answer?.post_number);
}

function reactionSummary(value: unknown): ReactionSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter(isRecord).map((item): ReactionSummary | null => {
    const id = String(item.id || '').trim();
    const count = positiveNumber(item.count);
    return id && count ? { id, count } : null;
  }).filter((item): item is ReactionSummary => Boolean(item));
  return items.length ? items : undefined;
}

export async function getLinuxDoEmojiUrls(options: LinuxDoOptions = {}) {
  if (emojiUrlCache) {
    return emojiUrlCache;
  }
  const data = await fetchLinuxDoJson<Record<string, unknown>>('/emojis.json', undefined, options);
  emojiUrlCache = linuxDoEmojiUrlMapFromData(data);
  return emojiUrlCache;
}

function boostCount(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.length : undefined;
  }
  return positiveNumber(value);
}

function boostCountFromPost(value: Record<string, unknown>) {
  return boostCount(value.boosts) ?? boostCount(value.boost_count);
}

function replyTargetAuthor(value: unknown) {
  return isRecord(value) ? String(value.username || value.name || '').trim() : '';
}

function normalizeDiscoursePolls(post: unknown): TopicPoll[] | undefined {
  if (!isRecord(post) || !Array.isArray(post.polls)) {
    return undefined;
  }
  const votesByPoll = isRecord(post.polls_votes) ? post.polls_votes : {};
  const postId = positiveNumber(post.id);
  const polls = post.polls.filter(isRecord).map((poll): TopicPoll | null => {
    const name = String(poll.name || '').trim();
    const selectedIds = new Set(stringArray(name ? votesByPoll[name] : undefined));
    const rawOptions = Array.isArray(poll.options) ? poll.options : [];
    const options = rawOptions.filter(isRecord).map((option): TopicPollOption | null => {
      const id = String(option.id || '').trim();
      const label = textContentFromHtml(String(option.html || option.label || ''));
      if (!id || !label) {
        return null;
      }
      const count = nonNegativeNumber(option.votes);
      return {
        id,
        label,
        ...(count !== undefined ? { count } : {}),
        selected: selectedIds.has(id)
      };
    }).filter((option): option is TopicPollOption => Boolean(option));
    if (!options.length) {
      return null;
    }
    const type = String(poll.type || '').trim();
    const closedByStatus = String(poll.status || '').trim().toLowerCase() === 'closed';
    const closedByDate = Boolean(poll.close && Date.parse(String(poll.close)) <= Date.now());
    const participantCount = nonNegativeNumber(poll.voters);
    const min = positiveNumber(poll.min);
    const max = positiveNumber(poll.max);
    return {
      id: String(poll.id || name || '').trim() || undefined,
      name: name || undefined,
      postId: postId ? String(postId) : undefined,
      title: textContentFromHtml(String(poll.title || '')).trim() || undefined,
      public: typeof poll.public === 'boolean' ? poll.public : undefined,
      closed: closedByStatus || closedByDate,
      multiple: type === 'multiple',
      ...(type === 'ranked_choice' || type === 'number' ? { type, readonly: true } : {}),
      ...(participantCount !== undefined ? { participantCount } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      voted: selectedIds.size > 0,
      options
    };
  }).filter((poll): poll is TopicPoll => Boolean(poll));
  return polls.length ? polls : undefined;
}

function normalizePost(raw: unknown, index: number, topicId?: string, fallbackFloor = index + 1): Reply | null {
  if (!isRecord(raw)) {
    return null;
  }
  const contentHtml = sanitizeContentHtml(raw.cooked || '', BASE_URL);
  const quotedReferences = quotedReferencesFromHtml(contentHtml, topicId);
  const visibleContentHtml = contentHtmlWithoutLocalQuoteAsides(contentHtml, topicId);
  const liked = likedFromActionsSummary(raw.actions_summary);
  const reactions = reactionSummary(raw.reactions);
  const rawBoostCount = boostCountFromPost(raw);
  const targetAuthor = replyTargetAuthor(raw.reply_to_user);
  const postType = Number(raw.post_type);
  const isSystemAction = Number.isFinite(postType) && postType !== 1;
  const polls = normalizeDiscoursePolls(raw);
  return {
    author: String(raw.username || ''),
    authorId: String(raw.username || '') || undefined,
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: raw.username ? userUrl(String(raw.username)) : undefined,
    contentHtml: visibleContentHtml,
    createdAt: toIsoString(raw.created_at),
    floor: typeof raw.post_number === 'number' ? raw.post_number : fallbackFloor,
    ...(quotedReferences.floors.length ? { quotedFloors: quotedReferences.floors } : {}),
    ...(Object.keys(quotedReferences.authors).length ? { quotedAuthors: quotedReferences.authors } : {}),
    ...(positiveNumber(raw.id) ? { commentId: positiveNumber(raw.id) } : {}),
    ...(positiveNumber(raw.like_count) !== undefined ? { likeCount: positiveNumber(raw.like_count) } : {}),
    ...(liked !== undefined ? { liked } : {}),
    ...(targetAuthor ? { replyTargetAuthor: targetAuthor } : {}),
    ...(raw.accepted_answer === true ? { acceptedAnswer: true } : {}),
    ...(raw.wiki === true ? { wiki: true } : {}),
    ...(raw.hidden === true || raw.deleted_at || raw.user_deleted === true ? { hidden: true } : {}),
    ...(raw.post_folding_status ? { folded: true } : {}),
    ...(raw.needs_category_expert_approval === true ? { needsApproval: true } : {}),
    ...(isSystemAction ? { systemAction: true } : {}),
    ...(raw.action_code ? { actionCode: String(raw.action_code) } : {}),
    ...(reactions ? { reactionSummary: reactions } : {}),
    ...(rawBoostCount ? { boostCount: rawBoostCount } : {}),
    ...(polls ? { polls } : {}),
    ...(positiveNumber(raw.bookmark_id) ? { bookmarkId: positiveNumber(raw.bookmark_id), bookmarked: true } : typeof raw.bookmarked === 'boolean' ? { bookmarked: raw.bookmarked } : {})
  };
}

async function linuxDoHeaders(referer = `${BASE_URL}/latest`, csrfToken?: string) {
  const access = await loadLinuxDoAccess();
  const accessSummary = linuxDoAccessSummary(access);
  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    Referer: referer,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Discourse-Present': 'true',
    'User-Agent': access?.userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    'X-Requested-With': 'XMLHttpRequest',
    ...(accessSummary.loggedIn ? { 'Discourse-Logged-In': 'true' } : {}),
    ...(access?.cookieHeader ? { Cookie: access.cookieHeader } : {})
  };
}

async function fetchLinuxDoJson<T>(
  path: string,
  params: Record<string, string | number | Array<string | number>> | undefined,
  options: LinuxDoOptions = {},
  requestOptions: { referer?: string; csrfToken?: string } = {}
) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params || {})) {
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithTimeout(url.toString(), {
    headers: await linuxDoHeaders(requestOptions.referer, requestOptions.csrfToken)
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
        const bodyMessage = textContentFromHtml(text);
        const accessRequirement = accessRequirementFromText(bodyMessage);
        const message = accessRequirement ? bodyMessage : `HTTP ${response.status}`;
        const error = new Error(message);
        Object.assign(error, {
          status: response.status,
          ...(accessRequirement ? { source: 'linuxdo', accessRequirement } : {})
        });
        throw error;
      }
      throw new Error('linux.do 返回内容格式不正确');
    }
  }
  if (!response.ok) {
    const message = linuxDoErrorText(data, `HTTP ${response.status}`);
    const accessRequirement = preferredLinuxDoAccessRequirement(accessRequirementFromObject(data), accessRequirementFromText(message));
    const error = new Error(message);
    Object.assign(error, {
      status: response.status,
      ...(accessRequirement ? { source: 'linuxdo', accessRequirement } : {})
    });
    throw error;
  }
  return data as T;
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
  let data: Record<string, unknown>;
  try {
    data = await topicData(id, options);
  } catch (error) {
    const accessRequirement = linuxDoAccessRequirementFromError(error);
    if (!accessRequirement) {
      throw error;
    }
    const contentHtml = accessRequirement.detail || (error instanceof Error ? error.message : accessRequirement.label);
    return {
      source: 'linuxdo',
      id,
      title: '受限帖子',
      author: '',
      url: `${BASE_URL}/t/${id}`,
      createdAt: new Date().toISOString(),
      lastReplyAt: new Date().toISOString(),
      replyCount: 0,
      contentHtml,
      replies: [],
      replyHasMore: false,
      replyNextPage: null,
      accessRequirement
    };
  }
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
  const polls = normalizeDiscoursePolls(firstPost);
  const firstPostReactions = reactionSummary(isRecord(firstPost) ? firstPost.reactions : undefined);
  const firstPostBoostCount = isRecord(firstPost) ? boostCountFromPost(firstPost) : undefined;
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
    ...(polls ? { polls } : {}),
    ...(firstPostReactions ? { reactionSummary: firstPostReactions } : {}),
    ...(firstPostBoostCount ? { boostCount: firstPostBoostCount } : {}),
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
  const post = posts.find((item) => isRecord(item) && item.post_number === floor);
  const reply = normalizePost(post, floor - 1, id, floor);
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return reply;
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

async function topicsFromLinuxDoSearchData(data: Record<string, unknown>, options: LinuxDoOptions): Promise<{ items: Topic[]; hasMore: boolean }> {
  const users = usersById(data.users);
  const postsByTopicId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(data.posts)) {
    data.posts.filter(isRecord).forEach((post) => postsByTopicId.set(String(post.topic_id), post));
  }
  const topics = Array.isArray(data.topics) ? data.topics : [];
  const categoryMap = await categoryMapForTopics(data, topics, categoryMapFromData(data), options);
  const items = topics.map((topic) => {
    const authorData = isRecord(topic) ? originalPoster(topic, users) : undefined;
    const normalized = normalizeTopic(topic, categoryMap, String(authorData?.username || ''), authorData);
    const post = isRecord(topic) ? postsByTopicId.get(String(topic.id)) : undefined;
    return normalized ? { ...normalized, excerpt: textExcerpt(post?.blurb || normalized.excerpt || '') } : null;
  }).filter(Boolean) as Topic[];
  const grouped = isRecord(data.grouped_search_result) ? data.grouped_search_result : {};
  return {
    items,
    hasMore: Boolean(grouped.more_full_page_results)
  };
}

export async function searchLinuxDo(query: string, options: LinuxDoOptions & { limit?: number; page?: number } = {}): Promise<SearchResponse> {
  const limit = options.limit || 30;
  const page = options.page || 1;
  const cleanQuery = query.trim();
  const searchReferer = `${BASE_URL}/search?expanded=true&q=${encodeURIComponent(cleanQuery)}`;
  const csrfToken = await linuxDoCsrfToken(options);
  const start = Math.max(0, (page - 1) * limit);
  const firstSearchPage = Math.floor(start / SEARCH_PAGE_SIZE) + 1;
  const firstOffset = start % SEARCH_PAGE_SIZE;
  const needed = firstOffset + limit + 1;
  const collected: Topic[] = [];
  let searchPage = firstSearchPage;
  let searchHasMore = false;
  while (collected.length < needed) {
    const data = await fetchLinuxDoJson<Record<string, unknown>>('/search', {
      q: cleanQuery,
      page: searchPage
    }, options, { referer: searchReferer, csrfToken });
    const result = await topicsFromLinuxDoSearchData(data, options);
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
  return {
    items,
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
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
