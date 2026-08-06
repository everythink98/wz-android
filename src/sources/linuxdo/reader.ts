import {
  withBrowserFetchIntent,
  type BrowserFetchIntent,
  type BrowserFetchOwner,
  type BrowserFetchPriority
} from '@/platform/network/browserFetchIntent';
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
import { isRecord, parsePositiveInteger, textContentFromHtml } from '@/domain/forum/html';
import { accessRequirementFromObject, accessRequirementFromText } from '@/domain/forum/accessRequirements';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import {
  LINUXDO_BASE_URL as BASE_URL,
  LINUXDO_UNCATEGORIZED_CATEGORY_NAME as UNCATEGORIZED_CATEGORY_NAME,
  linuxDoAvatarUrl as avatarUrl,
  linuxDoFeedParams,
  linuxDoFeedPath,
  linuxDoUserUrl as userUrl,
  preferredLinuxDoAccessRequirement
} from './protocol';
import { discourseEmojiUrlMapFromData, type DiscourseEmojiUrlMap } from '@/sources/discourse/reactions';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import {
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
import { discourseQuoteMetadata } from '@/sources/discourse/content';
import { sanitizeLinuxDoContentHtml } from './parser';
import { orientReplyWindow } from '@/sources/replyWindows';

export const LIST_PAGE_SIZE = 30;

let emojiUrlCache: DiscourseEmojiUrlMap | null = null;

export interface LinuxDoOptions {
  browserFetchIntent?: BrowserFetchIntent;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  fetcher?: Fetcher;
  linuxDoAccess?: { authenticated?: boolean; userAgent?: string };
  signal?: AbortSignal;
  timeoutMs?: number;
  trackVisit?: boolean;
}

export function linuxDoOptionsWithBrowserIntent<T extends LinuxDoOptions>(
  options: T,
  owner: BrowserFetchOwner,
  priority: BrowserFetchPriority
): T {
  if (options.browserFetchIntent) {
    return options;
  }
  return {
    ...options,
    browserFetchIntent: { owner, priority }
  };
}

export function categoryMapFromData(data: unknown) {
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

function topicsNeedCategoryMap(
  topics: unknown[],
  categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>
) {
  return topics.some((topic) => isRecord(topic) && topic.category_id && !categoryMap.has(String(topic.category_id)));
}

export async function categoryMapForTopics(
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

export function linuxDoLevelLabel(raw?: Record<string, unknown>) {
  const value = raw?.trust_level ?? raw?.trustLevel;
  const level =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

export function normalizeTopic(
  raw: unknown,
  categoryMap = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>(),
  author?: string | null,
  authorData?: Record<string, unknown>
): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const fields = discourseTopicFields(raw);
  if (!fields) {
    return null;
  }
  const createdAt = fields.createdAt;
  const lastReplyAt = fields.lastReplyAt;
  const category = fields.categoryId ? categoryMap.get(fields.categoryId) : undefined;
  const accessRequirement = preferredLinuxDoAccessRequirement(
    accessRequirementFromObject(raw),
    category?.accessRequirement
  );
  const createdBy = isRecord(raw.details) && isRecord(raw.details.created_by) ? raw.details.created_by : {};
  const authorName = author || String(createdBy.username || (author === null ? '' : raw.last_poster_username) || '');
  const authorAvatar = avatarUrl(authorData?.avatar_template || createdBy.avatar_template);
  const authorLevelLabel = linuxDoLevelLabel(authorData) || linuxDoLevelLabel(createdBy);
  return {
    ...fields,
    source: 'linuxdo',
    author: authorName,
    authorId: authorName || undefined,
    authorAvatar,
    authorUrl: authorName ? userUrl(authorName) : undefined,
    category: category?.name || UNCATEGORIZED_CATEGORY_NAME,
    url: `${BASE_URL}/t/${raw.slug || fields.id}/${fields.id}`,
    createdAt,
    lastReplyAt,
    viewCount: fields.viewCount ?? 0,
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

export function linuxDoErrorText(data: unknown, fallback = '') {
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
    return data.errors
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return fallback;
}

function linuxDoAccessRequirementFromError(error: unknown): Topic['accessRequirement'] | undefined {
  return error && typeof error === 'object'
    ? (error as { accessRequirement?: Topic['accessRequirement'] }).accessRequirement
    : undefined;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export async function getLinuxDoEmojiUrls(options: LinuxDoOptions = {}) {
  options = linuxDoOptionsWithBrowserIntent(options, 'topic', 'foreground');
  if (emojiUrlCache) {
    return emojiUrlCache;
  }
  const data = await fetchLinuxDoJson<Record<string, unknown>>('/emojis.json', undefined, options);
  emojiUrlCache = discourseEmojiUrlMapFromData(data, BASE_URL);
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

function normalizePost(raw: unknown, topicId?: string): Reply | null {
  const fields = discoursePostFields(raw);
  if (!isRecord(raw) || !fields) {
    return null;
  }
  const { cookedHtml, ...replyFields } = fields;
  const polls = discoursePolls(raw);
  const contentHtml = sanitizeLinuxDoContentHtml(cookedHtml, polls);
  const quotedReferences = discourseQuoteMetadata(contentHtml, 'linuxdo', topicId);
  const rawBoostCount = boostCountFromPost(raw);
  const needsApproval = raw.needs_category_expert_approval === true;
  const authorLevelLabel = linuxDoLevelLabel(raw);
  return {
    ...replyFields,
    authorId: fields.author,
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: userUrl(fields.author),
    contentHtml: quotedReferences.html,
    ...(quotedReferences.quotedPosts.length ? { quotedPosts: quotedReferences.quotedPosts } : {}),
    ...(rawBoostCount || needsApproval
      ? {
          siteExtension: {
            source: 'linuxdo' as const,
            ...(rawBoostCount ? { boostCount: rawBoostCount } : {}),
            ...(needsApproval ? { needsApproval: true } : {})
          }
        }
      : {}),
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(polls ? { polls } : {})
  };
}

function removeReplyEdit(reply: Reply) {
  if (!reply.canEdit && !reply.contentMarkdown) {
    return reply;
  }
  const next = { ...reply };
  delete next.canEdit;
  delete next.contentMarkdown;
  return next;
}

async function hydrateEditableReplyContent(replies: Reply[], options: LinuxDoOptions) {
  if (!replies.some((reply) => reply.canEdit && reply.commentId && !reply.contentMarkdown)) {
    return replies;
  }
  return Promise.all(
    replies.map(async (reply) => {
      if (!reply.canEdit || reply.contentMarkdown || !reply.commentId) {
        return reply;
      }
      try {
        const data = await fetchLinuxDoJson<Record<string, unknown>>(
          `/posts/${reply.commentId}.json`,
          undefined,
          options
        );
        if (data.can_edit === false) {
          return removeReplyEdit(reply);
        }
        const contentMarkdown = typeof data.raw === 'string' ? data.raw : '';
        return contentMarkdown.trim() ? { ...reply, contentMarkdown } : removeReplyEdit(reply);
      } catch {
        return removeReplyEdit(reply);
      }
    })
  );
}

function linuxDoHeaders(access: LinuxDoOptions['linuxDoAccess'], referer = `${BASE_URL}/latest`, csrfToken?: string) {
  const loggedIn = access?.authenticated === true;
  return {
    Accept: 'application/json, text/javascript, */*; q=0.01',
    Referer: referer,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Discourse-Present': 'true',
    'User-Agent': access?.userAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    'X-Requested-With': 'XMLHttpRequest',
    ...(loggedIn ? { 'Discourse-Logged-In': 'true' } : {})
  };
}

export async function fetchLinuxDoJson<T>(
  path: string,
  params: Record<string, string | number | (string | number)[]> | undefined,
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
  const response = await fetchWithTimeout(
    url.toString(),
    withBrowserFetchIntent(
      {
        headers: linuxDoHeaders(options.linuxDoAccess, requestOptions.referer, requestOptions.csrfToken)
      },
      options.browserFetchIntent || { owner: 'feed', priority: 'foreground' }
    ),
    options
  );
  const text = await response.text();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
    throw new LinuxDoCloudflareError();
  }
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const bodyMessage = textContentFromHtml(text);
      const accessRequirement = accessRequirementFromText(bodyMessage);
      if (!response.ok || accessRequirement) {
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
    const accessRequirement = preferredLinuxDoAccessRequirement(
      accessRequirementFromObject(data),
      accessRequirementFromText(message)
    );
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

export async function getLinuxDoFeed(
  options: LinuxDoOptions & {
    page?: number;
    limit?: number;
    category?: string;
    linuxDoFilter?: DiscourseFeedFilter;
  } = {}
): Promise<FeedResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'feed', 'foreground');
  const page = options.page || 1;
  const limit = options.limit || 30;
  const linuxDoFilter = options.linuxDoFilter || 'latest';
  const start = (page - 1) * limit;
  const firstListPage = Math.floor(start / LIST_PAGE_SIZE) + 1;
  const firstOffset = start % LIST_PAGE_SIZE;
  const collected: Topic[] = [];
  let listPage = firstListPage;
  let hasMore = false;
  let droppedCount = 0;
  let categoryMap = new Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>();
  while (collected.length < limit + 1) {
    const data = await fetchLinuxDoJson<Record<string, unknown>>(
      linuxDoFeedPath(linuxDoFilter),
      linuxDoFeedParams(listPage, options.category, linuxDoFilter),
      options
    );
    const topics = isRecord(data.topic_list) && Array.isArray(data.topic_list.topics) ? data.topic_list.topics : [];
    categoryMap = await categoryMapForTopics(data, topics, categoryMap, options);
    const users = discourseUsersById(data.users);
    const items = topics
      .map((topic) => {
        const authorData = isRecord(topic) ? discourseOriginalPoster(topic, users) : undefined;
        return normalizeTopic(topic, categoryMap, String(authorData?.username || ''), authorData);
      })
      .filter(Boolean) as Topic[];
    droppedCount += Math.max(0, topics.length - items.length);
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
  const result = {
    items: collected.slice(0, limit),
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-feed',
    candidateCount: result.items.length + droppedCount,
    validCount: result.items.length,
    droppedCount,
    isExpectedEmpty: result.items.length === 0 && droppedCount === 0 && (page > 1 || Boolean(options.category)),
    isParseEmpty: page === 1 && !options.category && result.items.length === 0 && droppedCount === 0,
    hasRepeatedCursor: result.nextPage === page
  });
}

export async function getLinuxDoCategories(options: LinuxDoOptions = {}): Promise<CategoriesResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'feed', 'foreground');
  const data = await fetchLinuxDoJson<Record<string, unknown>>('/site.json', undefined, options);
  const categories = Array.isArray(data.categories)
    ? data.categories
    : isRecord(data.category_list) && Array.isArray(data.category_list.categories)
      ? data.category_list.categories
      : [];
  const result = {
    items: discourseCategories(data, 'linuxdo', { includeParentSlug: true }),
    errors: {}
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-categories',
    candidateCount: categories.length,
    validCount: result.items.length,
    droppedCount: Math.max(0, categories.length - result.items.length),
    isParseEmpty: categories.length === 0
  });
}

async function topicData(id: string, options: LinuxDoOptions, targetFloor?: number) {
  return fetchLinuxDoJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}${targetFloor ? `/${targetFloor}` : ''}.json`,
    options.trackVisit ? { track_visit: 'true', forceLoad: 'true' } : undefined,
    options
  );
}

export async function getLinuxDoTopic(
  id: string,
  options: LinuxDoOptions & { replyLimit?: number } = {}
): Promise<TopicDetail> {
  options = linuxDoOptionsWithBrowserIntent(options, 'topic', 'foreground');
  let data: Record<string, unknown>;
  try {
    data = await topicData(id, options);
  } catch (error) {
    const accessRequirement = linuxDoAccessRequirementFromError(error);
    if (!accessRequirement) {
      throw error;
    }
    const contentHtml = accessRequirement.detail || (error instanceof Error ? error.message : accessRequirement.label);
    return annotateSourceDiagnosticSummary(
      {
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
      },
      {
        parserVariant: 'access-restricted-topic',
        candidateCount: 1,
        validCount: 1,
        droppedCount: 0
      }
    );
  }
  const posts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const [firstPost, ...replyPosts] = posts;
  const firstPostFields = discoursePostFields(firstPost);
  if (!firstPostFields) {
    throw new Error('linux.do 主题正文解析失败');
  }
  const categoryMap = await categoryMapForTopics(data, [data], categoryMapFromData(data), options);
  const topic = normalizeTopic(data, categoryMap, firstPostFields.author, isRecord(firstPost) ? firstPost : undefined);
  if (!topic) {
    throw new Error('linux.do 主题不存在');
  }
  const replyLimit = options.replyLimit || 30;
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const replies = await hydrateEditableReplyContent(
    replyPosts
      .slice(0, replyLimit)
      .map((post) => normalizePost(post, topic.id))
      .filter(Boolean) as Reply[],
    options
  );
  const totalPosts = stream.length || (topic.replyCount || 0) + 1;
  const replyHasMore = totalPosts > replies.length + 1;
  const polls = discoursePolls(firstPost);
  const firstPostBoostCount = isRecord(firstPost) ? boostCountFromPost(firstPost) : undefined;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (options.signal?.aborted) {
    throw new Error(REQUEST_CANCELED_MESSAGE);
  }
  const sanitizedContentHtml = sanitizeLinuxDoContentHtml(firstPostFields.cookedHtml, polls);
  const result = {
    ...topic,
    contentHtml: sanitizedContentHtml,
    replies,
    replyHasMore,
    replyNextPage: replyHasMore ? 2 : null,
    replyNextOffset: replyHasMore ? replies.length : null,
    ...(firstPostFields?.commentId ? { commentId: firstPostFields.commentId } : {}),
    ...(firstPostFields?.likeCount === undefined ? {} : { likeCount: firstPostFields.likeCount }),
    ...(firstPostFields?.liked === undefined ? {} : { liked: firstPostFields.liked }),
    ...(firstPostFields?.canLike === undefined ? {} : { canLike: firstPostFields.canLike }),
    ...(polls ? { polls } : {}),
    ...(firstPostFields?.reactionSummary ? { reactionSummary: firstPostFields.reactionSummary } : {}),
    ...(firstPostBoostCount ? { siteExtension: { source: 'linuxdo' as const, boostCount: firstPostBoostCount } } : {}),
    ...(positiveNumber(data.bookmark_id)
      ? { bookmarkId: positiveNumber(data.bookmark_id), bookmarked: true }
      : typeof data.bookmarked === 'boolean'
        ? { bookmarked: data.bookmarked }
        : {})
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-topic',
    candidateCount: 1 + Math.max(0, posts.length - 1),
    validCount: 1 + replies.length,
    droppedCount: Math.max(0, posts.length - 1 - replies.length),
    missingFloorCount: replyPosts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
  });
}

async function fetchPosts(id: string, postIds: unknown[], options: LinuxDoOptions) {
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}/posts.json`,
    { 'post_ids[]': postIds.map(String) },
    options
  );
  return isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
}

export async function getLinuxDoReplies(
  id: string,
  options: LinuxDoOptions & {
    order: ReplyOrder;
    position: ReplyWindowPosition;
    limit?: number;
  }
): Promise<RepliesResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'topic', 'foreground');
  const limit = options.limit || 30;
  if (options.position.kind === 'target') {
    const targetFloor = options.position.target.floor;
    if (!Number.isSafeInteger(targetFloor) || targetFloor! <= 0) {
      throw new Error('linux.do 目标楼层不正确');
    }
    const window = discourseReplyWindow(await topicData(id, options, targetFloor), limit);
    const items = await hydrateEditableReplyContent(
      window.posts.map((post) => normalizePost(post, id)).filter(Boolean) as Reply[],
      options
    );
    if (!items.some((reply) => reply.floor === targetFloor)) {
      throw new Error('linux.do 目标楼层未找到');
    }
    const { posts, ...windowState } = window;
    const chronological = annotateSourceDiagnosticSummary(
      { items, ...windowState },
      {
        parserVariant: 'discourse-near-replies',
        candidateCount: posts.length,
        validCount: items.length,
        droppedCount: Math.max(0, posts.length - items.length),
        missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
      }
    );
    return orientReplyWindow(chronological, options.order);
  }
  const streamState = topicStreamState(await topicData(id, options));
  const stream = streamState.stream;
  const { postIds, ...windowState } = discourseStreamReplyWindow(stream, {
    limit,
    order: options.order,
    position: options.position
  });
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary(
      { items: [], ...windowState },
      {
        parserVariant: 'discourse-replies',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        isExpectedEmpty: true
      }
    );
  }
  const posts = await fetchPosts(id, postIds, options);
  const visiblePostIds = discourseVisiblePostIds(posts, postIds);
  const normalizedItems = await hydrateEditableReplyContent(
    posts.map((post) => normalizePost(post, id)).filter(Boolean) as Reply[],
    options
  );
  const items = discourseRepliesInStreamOrder(normalizedItems, visiblePostIds, options.order);
  const result = {
    items,
    ...windowState
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-replies',
    candidateCount: postIds.length,
    validCount: items.length,
    droppedCount: Math.max(0, postIds.length - items.length),
    missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length,
    hasRepeatedCursor:
      options.position.kind === 'cursor' &&
      result.nextPage === options.position.page &&
      result.nextOffset === options.position.offset
  });
}

export async function getLinuxDoReply(id: string, floor: number, options: LinuxDoOptions = {}): Promise<Reply> {
  options = linuxDoOptionsWithBrowserIntent(options, 'topic', 'foreground');
  const data = await topicData(id, options);
  const embeddedPosts =
    isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const embedded = embeddedPosts.find((post) => isRecord(post) && post.post_number === floor);
  if (embedded) {
    const reply = normalizePost(embedded, id);
    if (reply) {
      return annotateSourceDiagnosticSummary(reply, {
        parserVariant: 'embedded-reply',
        candidateCount: 1,
        validCount: 1,
        droppedCount: 0,
        missingFloorCount: isRecord(embedded) && !parsePositiveInteger(embedded.post_number) ? 1 : 0
      });
    }
  }
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const guessed = stream[floor - 1];
  if (!guessed) {
    throw new Error('引用楼层未找到');
  }
  const posts = await fetchPosts(id, [guessed], options);
  const post = posts.find((item) => isRecord(item) && item.post_number === floor);
  const reply = normalizePost(post, id);
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return annotateSourceDiagnosticSummary(reply, {
    parserVariant: 'fetched-reply',
    candidateCount: posts.length,
    validCount: 1,
    droppedCount: Math.max(0, posts.length - 1),
    missingFloorCount: posts.filter((item) => isRecord(item) && !parsePositiveInteger(item.post_number)).length
  });
}
