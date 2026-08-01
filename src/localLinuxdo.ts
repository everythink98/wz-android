import {
  withBrowserFetchIntent,
  type BrowserFetchIntent,
  type BrowserFetchOwner,
  type BrowserFetchPriority
} from './browserFetchIntent';
import { fetchWithTimeout, REQUEST_CANCELED_MESSAGE, type Fetcher } from './request';
import type {
  CategoriesResponse,
  DiscourseFeedFilter,
  DiscourseTagOption,
  DiscourseUserOption,
  FeedResponse,
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
  accessRequirementFromObject,
  accessRequirementFromText,
  decodeHtml,
  elementText,
  FORUM_LINK_CARD_TAG,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  textContentFromHtml,
  textExcerpt,
  toIsoString
} from './localHtml';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from './cloudflareChallenge';
import { googleResultTargetUrl, googleSiteSearchUrl, hasGoogleSiteSearchNextPage } from './googleSearchFallback';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from './linuxdoSession';
import {
  LINUXDO_BASE_URL as BASE_URL,
  LINUXDO_UNCATEGORIZED_CATEGORY_NAME as UNCATEGORIZED_CATEGORY_NAME,
  linuxDoAvatarUrl as avatarUrl,
  linuxDoFeedParams,
  linuxDoFeedPath,
  linuxDoUserUrl as userUrl,
  normalizeLinuxDoTopicId as normalizeTopicId,
  preferredLinuxDoAccessRequirement
} from './localLinuxdoHelpers';
import { discourseEmojiUrlMapFromData, type DiscourseEmojiUrlMap } from './discourseReactions';
import { annotateSourceDiagnosticSummary, sourceDiagnosticSummary } from './sourceAdapterDiagnostics';
import {
  discourseCategories,
  discourseOriginalPoster,
  discoursePolls,
  discoursePostFields,
  discourseTopicFields,
  discourseUsersById
} from './discourseModel';
import {
  discourseContentNeedsCalloutNormalization,
  discoursePollPlaceholder,
  discourseQuoteMetadata,
  normalizeDiscourseCallouts,
  stripDiscourseCalloutMarkersFromExcerpt
} from './discourseContent';

const LIST_PAGE_SIZE = 30;
const SEARCH_PAGE_SIZE = 50;
let csrfTokenCache: string | null = null;
let emojiUrlCache: DiscourseEmojiUrlMap | null = null;

interface LinuxDoOptions {
  browserFetchIntent?: BrowserFetchIntent;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  fetcher?: Fetcher;
  linuxDoAccess?: { authenticated?: boolean; userAgent?: string };
  signal?: AbortSignal;
  timeoutMs?: number;
}

function linuxDoOptionsWithBrowserIntent<T extends LinuxDoOptions>(
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

type LinuxDoSearchOptions = LinuxDoOptions & {
  authenticated?: boolean;
  limit?: number;
  page?: number;
};

interface LinuxDoCurrentUserOptions extends LinuxDoOptions {
  linuxDoUserAgent?: string;
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

function topicsNeedCategoryMap(
  topics: unknown[],
  categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>
) {
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

function linuxDoLevelLabel(raw?: Record<string, unknown>) {
  const value = raw?.trust_level ?? raw?.trustLevel;
  const level =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

function normalizeTopic(
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

function normalizeUserActionReply(
  raw: unknown,
  categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>,
  author: string,
  authorData?: Record<string, unknown>
): UserReplyActivity | null {
  if (!isRecord(raw)) {
    return null;
  }
  const topicId = normalizeTopicId(raw.topic_id || raw.topicId);
  const topicTitle = decodeHtml(raw.title || raw.topic_title || raw.unicode_title || '');
  if (!topicId || !topicTitle) {
    return null;
  }
  const floor = Number(raw.post_number || raw.postNumber || 0) || undefined;
  const postId = String(raw.post_id || raw.id || '').trim();
  const slug = String(raw.slug || topicId);
  const category = raw.category_id ? categoryMap.get(String(raw.category_id)) : undefined;
  const url = `${BASE_URL}/t/${slug}/${topicId}${floor ? `/${floor}` : ''}`;
  return {
    source: 'linuxdo',
    id: postId || `${topicId}:${floor || 0}`,
    topicId,
    topicTitle,
    topicUrl: `${BASE_URL}/t/${slug}/${topicId}`,
    url,
    author,
    authorId: author || undefined,
    authorAvatar: avatarUrl(authorData?.avatar_template),
    authorUrl: author ? userUrl(author) : undefined,
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: category?.name,
    createdAt: toIsoString(raw.created_at || raw.createdAt) || undefined,
    ...(floor ? { floor } : {}),
    excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(raw.excerpt || raw.content || raw.markdown || ''))
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

function nonNegativeNumber(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
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

function escapeLinuxDoContentAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function redditSourceUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''), BASE_URL);
    if (url.hostname.toLowerCase() !== 'embed.reddit.com') {
      return '';
    }
    url.protocol = 'https:';
    url.hostname = 'www.reddit.com';
    url.port = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function sanitizeLinuxDoContentHtml(html: unknown, polls: TopicPoll[] | undefined) {
  const pollNames = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  const normalizeCallouts = discourseContentNeedsCalloutNormalization(html);
  return sanitizeContentHtml(html, BASE_URL, (root) => {
    root.querySelectorAll('.poll').forEach((node) => {
      const name = String(node.getAttribute('data-poll-name') || '').trim();
      if (name && pollNames.has(name)) {
        node.replaceWith(discoursePollPlaceholder(name));
      }
    });
    root.querySelectorAll('iframe').forEach((node) => {
      const href = redditSourceUrl(node.getAttribute('src'));
      if (!href) {
        return;
      }
      node.replaceWith(
        `<${FORUM_LINK_CARD_TAG} href="${escapeLinuxDoContentAttribute(href)}" site="Reddit" title="Reddit 帖子" description="在 Reddit 中查看原帖"></${FORUM_LINK_CARD_TAG}>`
      );
    });
    if (normalizeCallouts) {
      normalizeDiscourseCallouts(root);
    }
  });
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

async function fetchLinuxDoJson<T>(
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

async function topicData(id: string, options: LinuxDoOptions) {
  return fetchLinuxDoJson<Record<string, unknown>>(`/t/${encodeURIComponent(id)}.json`, undefined, options);
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
  const totalPosts = stream.length || topic.replyCount + 1;
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
    page?: number;
    limit?: number;
    offset?: number | null;
  } = {}
): Promise<RepliesResponse> {
  options = linuxDoOptionsWithBrowserIntent(options, 'topic', 'foreground');
  const page = options.page || 1;
  const limit = options.limit || 30;
  const streamState = topicStreamState(await topicData(id, options));
  const stream = streamState.stream;
  const firstPageReplyCount = streamState.embeddedPostCount
    ? Math.min(limit, Math.max(streamState.embeddedPostCount - 1, 0))
    : limit;
  const previousReplyCount =
    page > 1 ? (typeof options.offset === 'number' ? options.offset : firstPageReplyCount + (page - 2) * limit) : 0;
  const start = 1 + previousReplyCount;
  const postIds = stream.slice(start, start + limit);
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary(
      { items: [], hasMore: false, nextPage: null },
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
  const hasMore = stream.length > start + limit;
  const items = await hydrateEditableReplyContent(
    posts.map((post) => normalizePost(post, id)).filter(Boolean) as Reply[],
    options
  );
  const result = {
    items,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    nextOffset: hasMore ? previousReplyCount + postIds.length : null
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-replies',
    candidateCount: postIds.length,
    validCount: items.length,
    droppedCount: Math.max(0, postIds.length - items.length),
    missingFloorCount: posts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length,
    hasRepeatedCursor: result.nextPage === page && result.nextOffset === options.offset
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

export async function getLinuxDoUserProfile(
  id: string,
  username: string,
  options: LinuxDoOptions = {}
): Promise<UserProfile> {
  options = linuxDoOptionsWithBrowserIntent(options, 'user', 'foreground');
  const name = (username || id).trim();
  if (!name) {
    throw new Error('linux.do 用户信息不完整');
  }
  const cursorType = options.cursorType;
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const replyOffset = parsePositiveInteger(options.cursor);
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/u/${encodeURIComponent(name)}/summary.json`,
    undefined,
    options
  );
  const summary = isRecord(data.user_summary) ? data.user_summary : {};
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  const dataUser = isRecord(data.user) ? data.user : {};
  const listedUsers = Array.isArray(data.users) ? data.users.filter(isRecord) : [];
  const listedUser =
    listedUsers.find((item) => String(item.username || item.name || '').toLowerCase() === name.toLowerCase()) ||
    listedUsers.find((item) => String(item.id || '') === String(summaryUser.id || dataUser.id || id)) ||
    listedUsers[0] ||
    {};
  const user = { ...listedUser, ...dataUser, ...summaryUser };
  const resolvedUsername = String(user.username || name);
  const displayName = typeof user.name === 'string' ? user.name : resolvedUsername;
  const avatar = avatarUrl(user.avatar_template);
  const levelLabel = linuxDoLevelLabel(user);
  const rawTopics = wantsTopics && Array.isArray(data.topics) ? data.topics : [];
  let rawUserActions: unknown[] = [];
  let partialErrorCount = 0;
  if (wantsReplies) {
    const readUserActions = async () => {
      const actionData = await fetchLinuxDoJson<Record<string, unknown>>(
        '/user_actions.json',
        {
          offset: replyOffset,
          username: resolvedUsername,
          filter: 5
        },
        options
      );
      return Array.isArray(actionData.user_actions) ? actionData.user_actions : [];
    };
    if (cursorType === 'replies') {
      rawUserActions = await readUserActions();
    } else {
      try {
        rawUserActions = await readUserActions();
      } catch {
        partialErrorCount += 1;
      }
    }
  }
  const categoryMap = await categoryMapForTopics(
    data,
    [...rawTopics, ...rawUserActions],
    categoryMapFromData(data),
    options
  );
  const topics = rawTopics
    .map((topic) => normalizeTopic(topic, categoryMap, resolvedUsername, user))
    .filter(Boolean) as Topic[];
  const visibleTopics = sortTopicsByCreatedAt(topics);
  const replies = rawUserActions
    .map((action) => normalizeUserActionReply(action, categoryMap, resolvedUsername, user))
    .filter(Boolean) as UserReplyActivity[];
  const result: UserProfile = {
    source: 'linuxdo',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName,
    avatar,
    url: userUrl(resolvedUsername),
    bio:
      typeof user.bio_raw === 'string'
        ? user.bio_raw
        : typeof user.bio_excerpt === 'string'
          ? user.bio_excerpt
          : undefined,
    topicCount: nonNegativeNumber(summary.topic_count) ?? (visibleTopics.length || undefined),
    replyCount: nonNegativeNumber(summary.reply_count),
    postCount: nonNegativeNumber(summary.post_count),
    ...(levelLabel ? { levelLabel } : {}),
    topics: visibleTopics,
    hasMoreTopics: false,
    nextTopicsCursor: null,
    replies,
    hasMoreReplies: wantsReplies && replies.length > 0,
    nextRepliesCursor: wantsReplies && replies.length > 0 ? String(replyOffset + LIST_PAGE_SIZE) : null
  };
  const candidateCount = 1 + rawTopics.length + rawUserActions.length;
  const hasUserIdentity = Boolean(user.username || user.name || user.id);
  const validCount = (hasUserIdentity ? 1 : 0) + visibleTopics.length + replies.length;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-user',
    candidateCount,
    validCount,
    droppedCount: Math.max(0, candidateCount - validCount),
    partialErrorCount,
    missingFloorCount: rawUserActions.filter((action) => isRecord(action) && !parsePositiveInteger(action.post_number))
      .length,
    hasRepeatedCursor: result.nextTopicsCursor === options.cursor || result.nextRepliesCursor === options.cursor,
    isParseEmpty: !hasUserIdentity && visibleTopics.length === 0 && replies.length === 0
  });
}

export async function getLinuxDoCurrentUserProfile(options: LinuxDoCurrentUserOptions = {}): Promise<UserProfile> {
  options = linuxDoOptionsWithBrowserIntent(options, 'account', 'background');
  const response = await fetchWithTimeout(
    `${BASE_URL}/session/current.json`,
    withBrowserFetchIntent(
      {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: BASE_URL,
          'User-Agent': options.linuxDoUserAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
          'X-Requested-With': 'XMLHttpRequest'
        }
      },
      options.browserFetchIntent || { owner: 'account', priority: 'background' }
    ),
    options
  );
  const text = await response.text();
  if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
    throw new LinuxDoCloudflareError();
  }
  if (response.status === 404) {
    throw Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
      source: 'linuxdo' as const,
      kind: 'login-expired' as const,
      loginRequired: true,
      reason: 'expired' as const
    });
  }
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('linux.do 当前用户返回内容格式不正确');
  }
  if (!response.ok) {
    throw new Error(linuxDoErrorText(data, `HTTP ${response.status}`));
  }
  if (isRecord(data) && (data.current_user === null || data.user === null)) {
    throw Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
      source: 'linuxdo' as const,
      kind: 'login-expired' as const,
      loginRequired: true,
      reason: 'expired' as const
    });
  }
  const currentUser = isRecord(data) && isRecord(data.current_user) ? data.current_user : {};
  const user = isRecord(data) && isRecord(data.user) ? data.user : {};
  const merged = { ...user, ...currentUser };
  const username = String(merged.username || '').trim();
  if (!username) {
    throw new Error('无法读取当前 linux.do 用户名，请重新检测 linux.do 登录状态。');
  }
  const displayName = typeof merged.name === 'string' ? merged.name : username;
  const levelLabel = linuxDoLevelLabel(merged);
  return {
    source: 'linuxdo',
    id: username,
    username,
    displayName,
    avatar: avatarUrl(merged.avatar_template),
    url: userUrl(username),
    ...(levelLabel ? { levelLabel } : {}),
    topics: []
  };
}
