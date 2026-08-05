import {
  withBrowserFetchIntent,
  type BrowserFetchIntent,
  type BrowserFetchOwner,
  type BrowserFetchPriority
} from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { googleSiteSearchUrl, hasGoogleSiteSearchNextPage, isGoogleSiteSearchResponse } from '@/sources/searchFallback';
import type { NodeSeekSearchFilter } from '@/domain/forum/searchFilters';
import type {
  Category,
  FeedResponse,
  NodeSeekFeedFilter,
  RepliesResponse,
  ReplyLocationTarget,
  SearchResponse,
  Topic,
  TopicPoll,
  UserProfile,
  UserReference
} from '@/domain/forum/models';
import { elementText, isRecord, parseHtml, parsePositiveInteger } from '@/domain/forum/html';
import { accessRequirementFromText } from '@/domain/forum/accessRequirements';
import {
  NODESEEK_BASE_URL,
  NODESEEK_FLOORS_PER_PAGE,
  arrayField,
  extractNodeSeekEmbeddedData,
  isNodeSeekChallengeResponse,
  nextNodeSeekListPage,
  nextNodeSeekPostPage,
  nodeSeekTopicPagePath,
  nodeSeekTopicUrl,
  optionalInteger,
  withNodeSeekReplyPagination
} from './protocol';
import {
  embeddedTopics,
  isIncompleteNodeSeekSearchPage,
  listPath,
  mergeNodeSeekCategories,
  nextSearchPath,
  normalizeCategories,
  parseHtmlCategories,
  parseHtmlTopics,
  parseNodeSeekSearchTopics,
  searchPath
} from './feedParser';
import {
  extractNodeSeekVoteIds,
  matchingEmbeddedNodeSeekReply,
  mergeNodeSeekPolls,
  mergeRenderedNodeSeekReply,
  mergeRenderedNodeSeekTopic,
  normalizePostData,
  normalizeReplies,
  parseRenderedNodeSeekTopicHtml
} from './topicParser';
import {
  isNodeSeekLoggedOutHtml,
  nodeSeekCurrentUserFromConfig,
  parseNodeSeekCurrentUserHtml,
  parseNodeSeekUserIdentity,
  parseNodeSeekUserProfile,
  parseNodeSeekUserReference
} from './userParser';
import { NODESEEK_VOTE_API_HEADERS, normalizeNodeSeekVoteInfo, stripLoadedNodeSeekVoteMarkers } from './polls';
import { annotateSourceDiagnosticSummary, mergeSourceDiagnosticSummaries } from '@/sources/diagnostics';

const BASE_URL = NODESEEK_BASE_URL;
const NODESEEK_CLOUDFLARE_MESSAGE = 'NodeSeek 需要完成 Cloudflare 验证';
const NODESEEK_READ_TIMEOUT_MS = 30000;

interface NodeSeekOptions {
  authenticated?: boolean;
  fetcher?: Fetcher;
  nodeSeekUserAgent?: string;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  signal?: AbortSignal;
  timeoutMs?: number;
  browserFetchIntent?: BrowserFetchIntent;
}

function nodeSeekOptionsWithBrowserIntent<T extends NodeSeekOptions>(
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

async function readNodeSeekPollsFromVoteLinks(
  values: unknown[],
  options: NodeSeekOptions,
  knownPolls: TopicPoll[] = []
) {
  const knownIds = new Set(knownPolls.map((poll) => poll.id).filter(Boolean));
  const ids = extractNodeSeekVoteIds(...values).filter((id) => !knownIds.has(id));
  if (!ids.length) {
    return { partialErrorCount: 0, polls: undefined };
  }
  let partialErrorCount = 0;
  const polls = (
    await Promise.all(
      ids.map(async (id) => {
        try {
          const poll = normalizeNodeSeekVoteInfo(
            await fetchNodeSeekJson(`/api/vote/info/${encodeURIComponent(id)}`, options, NODESEEK_VOTE_API_HEADERS),
            id
          );
          if (!poll) {
            partialErrorCount += 1;
          }
          return poll;
        } catch {
          partialErrorCount += 1;
          return null;
        }
      })
    )
  ).filter((poll): poll is TopicPoll => Boolean(poll));
  return {
    partialErrorCount,
    polls: polls.length ? polls : undefined
  };
}

function nodeSeekCloudflareError() {
  return Object.assign(new Error(NODESEEK_CLOUDFLARE_MESSAGE), {
    source: 'nodeseek',
    reason: 'cloudflare'
  });
}

function isNodeSeekCloudflareError(error: unknown) {
  return isRecord(error) && error.reason === 'cloudflare';
}

async function fetchNodeSeekText(
  path: string,
  options: NodeSeekOptions = {},
  requestHeaders: Record<string, string> = {}
) {
  const requestOptions = { ...options, timeoutMs: options.timeoutMs ?? NODESEEK_READ_TIMEOUT_MS };
  const headers: HeadersInit = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
    Referer: BASE_URL,
    'User-Agent': options.nodeSeekUserAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT,
    ...requestHeaders
  };
  const response = await fetchWithTimeout(
    `${BASE_URL}${path}`,
    withBrowserFetchIntent(
      {
        headers
      },
      requestOptions.browserFetchIntent || { owner: 'feed', priority: 'foreground' }
    ),
    requestOptions
  );
  const text = await response.text();
  if (isNodeSeekChallengeResponse(response, text, `${BASE_URL}${path}`)) {
    throw nodeSeekCloudflareError();
  }
  if (!response.ok && requestOptions.browserFetchIntent?.owner === 'account') {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!response.ok && (response.status === 403 || response.status === 404) && accessRequirementFromText(text)) {
    return text;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

function hasLoggedInNodeSeekCookie(options: NodeSeekOptions) {
  return options.authenticated === true;
}

async function fetchNodeSeekGoogleSearchText(query: string, page: number, options: NodeSeekOptions = {}) {
  const requestOptions = { ...options, timeoutMs: options.timeoutMs ?? NODESEEK_READ_TIMEOUT_MS };
  const response = await fetchWithTimeout(
    googleSiteSearchUrl('nodeseek.com', query, page),
    withBrowserFetchIntent(
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7',
          'User-Agent': options.nodeSeekUserAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT
        }
      },
      requestOptions.browserFetchIntent || { owner: 'search', priority: 'foreground' }
    ),
    requestOptions
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

async function fetchNodeSeekJson(
  path: string,
  options: NodeSeekOptions = {},
  requestHeaders: Record<string, string> = {}
) {
  const text = await fetchNodeSeekText(path, options, requestHeaders);
  try {
    return JSON.parse(extractNodeSeekJsonText(text)) as unknown;
  } catch {
    throw new Error('NodeSeek 数据解析失败');
  }
}

function extractNodeSeekJsonText(text: string) {
  const trimmed = text.trim();
  if (!/^</.test(trimmed)) {
    return trimmed;
  }
  const root = parseHtml(trimmed);
  const preText = elementText(root.querySelector('pre')).trim();
  if (preText) {
    return preText;
  }
  return elementText(root.querySelector('body')).trim() || trimmed;
}

export async function getNodeSeekFeed(
  options: NodeSeekOptions & {
    page?: number;
    limit?: number;
    category?: string;
    feedFilter?: NodeSeekFeedFilter;
  } = {}
): Promise<FeedResponse> {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'feed', 'foreground');
  const page = options.page || 1;
  const limit = options.limit || 30;
  const feedFilter = options.category ? 'postTime' : options.feedFilter || 'postTime';
  const html = await fetchNodeSeekText(listPath(page, options.category, feedFilter), requestOptions);
  const embedded = extractNodeSeekEmbeddedData(html);
  const renderedItems = parseHtmlTopics(html);
  const items = renderedItems.length ? renderedItems : embedded ? embeddedTopics(embedded) : [];
  const filtered = options.category
    ? items.filter(
        (item) => !item.categoryId || item.categoryId === options.category || item.category === options.category
      )
    : items;
  const nextPage = nextNodeSeekListPage(html, page);
  const hasMore = Boolean(nextPage);
  const result = {
    items: filtered.slice(0, limit),
    errors: {},
    hasMore,
    nextPage: nextPage || null
  };
  const embeddedCandidateCount = embedded
    ? arrayField(embedded.rotateTopics).length +
      arrayField(embedded.topicList).length +
      arrayField(embedded.posts).length
    : 0;
  const renderedCandidateCount = Math.max(
    (html.match(/<li\b[^>]*\bpost-list-item\b/gi) || []).length,
    (html.match(/<a\b[^>]*href=["'][^"']*post-/gi) || []).length
  );
  const candidateCount = renderedItems.length ? renderedCandidateCount : embeddedCandidateCount;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: renderedItems.length ? 'rendered-list' : 'embedded-list',
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isExpectedEmpty: candidateCount === 0 && (page > 1 || Boolean(options.category)),
    isParseEmpty: page === 1 && !options.category && candidateCount === 0,
    hasRepeatedCursor: Boolean(nextPage && nextPage === page)
  });
}

export async function getNodeSeekCategories(options: NodeSeekOptions = {}) {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'feed', 'foreground');
  const html = await fetchNodeSeekText('/', requestOptions);
  const embedded = extractNodeSeekEmbeddedData(html);
  const embeddedCategories = embedded ? normalizeCategories(embedded) : ([] as Category[]);
  const htmlCategories = parseHtmlCategories(html);
  const result = {
    items: mergeNodeSeekCategories([...embeddedCategories, ...htmlCategories]),
    errors: {}
  };
  const candidateCount = embeddedCategories.length
    ? arrayField(embedded?.allCategory).length
    : (html.match(/<a\b[^>]*href=["'][^"']*\/categories\//gi) || []).length;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: embeddedCategories.length ? 'embedded-categories' : 'rendered-categories',
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isParseEmpty: candidateCount === 0
  });
}

async function fetchTopicHtml(id: string, page: number, options: NodeSeekOptions) {
  return fetchNodeSeekText(
    nodeSeekTopicPagePath(id, page),
    nodeSeekOptionsWithBrowserIntent(options, 'topic', 'foreground')
  );
}

async function fetchTopicPageData(id: string, page: number, options: NodeSeekOptions) {
  const html = await fetchTopicHtml(id, page, options);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  const rendered = parseRenderedNodeSeekTopicHtml(html, id, Number.MAX_SAFE_INTEGER, page);
  if (!postData && !rendered) {
    throw new Error('NodeSeek 主题解析失败');
  }
  return { html, postData, rendered };
}

export async function getNodeSeekTopic(id: string, options: NodeSeekOptions & { replyLimit?: number } = {}) {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'topic', 'foreground');
  const html = await fetchTopicHtml(id, 1, requestOptions);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  const rendered = parseRenderedNodeSeekTopicHtml(html, id, options.replyLimit || 30);
  if (rendered) {
    const embeddedTopic = postData
      ? normalizePostData(postData, id, nodeSeekTopicUrl(id), options.replyLimit || 30)
      : undefined;
    const topic = mergeRenderedNodeSeekTopic(rendered, embeddedTopic);
    const voteLinkPolls = await readNodeSeekPollsFromVoteLinks([topic.contentHtml, html], requestOptions, topic.polls);
    const polls = mergeNodeSeekPolls(topic.polls, voteLinkPolls.polls);
    const result = withNodeSeekReplyPagination(
      {
        ...topic,
        contentHtml: stripLoadedNodeSeekVoteMarkers(
          topic.contentHtml,
          (polls || []).map((poll) => poll.id)
        ),
        ...(polls ? { polls } : {})
      },
      html,
      id,
      1
    );
    const comments = postData ? arrayField(postData.comments) : [];
    return annotateSourceDiagnosticSummary(result, {
      parserVariant: 'rendered-topic',
      candidateCount: 1 + Math.max(rendered.replies.length, Math.max(0, comments.length - 1)),
      validCount: 1 + result.replies.length,
      droppedCount: Math.max(
        0,
        Math.max(rendered.replies.length, Math.max(0, comments.length - 1)) - result.replies.length
      ),
      partialErrorCount: voteLinkPolls.partialErrorCount,
      missingFloorCount: rendered.replies.filter((reply) => !reply.floor).length
    });
  }
  if (postData) {
    const comments = arrayField(postData.comments);
    const first = isRecord(comments[0]) ? comments[0] : {};
    const topic = normalizePostData(postData, id, nodeSeekTopicUrl(id), options.replyLimit || 30);
    const voteLinkPolls = await readNodeSeekPollsFromVoteLinks([first.markdown, html], requestOptions);
    const polls = mergeNodeSeekPolls(voteLinkPolls.polls);
    const result = withNodeSeekReplyPagination(
      {
        ...topic,
        contentHtml: stripLoadedNodeSeekVoteMarkers(
          topic.contentHtml,
          (polls || []).map((poll) => poll.id)
        ),
        ...(polls ? { polls } : {})
      },
      html,
      id,
      1
    );
    const replyCandidates = Math.max(0, comments.length - 1);
    const missingFloorCount = comments
      .slice(1)
      .filter(
        (comment) => isRecord(comment) && optionalInteger(comment.floorIndex ?? comment.floor) === undefined
      ).length;
    return annotateSourceDiagnosticSummary(result, {
      parserVariant: 'embedded-topic',
      candidateCount: 1 + replyCandidates,
      validCount: 1 + result.replies.length,
      droppedCount: Math.max(0, replyCandidates - result.replies.length),
      partialErrorCount: voteLinkPolls.partialErrorCount,
      missingFloorCount
    });
  }
  throw new Error('NodeSeek 主题解析失败');
}

type NodeSeekRepliesOptions = NodeSeekOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
  fillPages?: boolean;
  replyCount?: number;
  targetReply?: ReplyLocationTarget;
};

async function fillNodeSeekRepliesLimit(
  id: string,
  options: NodeSeekRepliesOptions,
  result: RepliesResponse,
  limit: number
): Promise<RepliesResponse> {
  if (result.items.length >= limit || !result.hasMore || !result.nextPage) {
    return result;
  }
  const page = options.page || 1;
  const offset = typeof options.offset === 'number' ? options.offset : null;
  if (result.nextPage === page && result.nextOffset === offset) {
    return result;
  }
  const extra = await getNodeSeekReplies(id, {
    ...options,
    page: result.nextPage,
    offset: result.nextOffset,
    limit: limit - result.items.length
  });
  const combined = {
    ...extra,
    items: [...result.items, ...extra.items]
  };
  return mergeSourceDiagnosticSummaries(combined, 'multi-page-replies', [result, extra], {
    validCount: combined.items.length,
    hasRepeatedCursor: false
  });
}

function annotateNodeSeekReplies(
  result: RepliesResponse,
  {
    candidateCount,
    missingFloorCount,
    offset,
    page,
    parserVariant
  }: {
    candidateCount: number;
    missingFloorCount: number;
    offset: number;
    page: number;
    parserVariant: string;
  }
) {
  return annotateSourceDiagnosticSummary(result, {
    parserVariant,
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    missingFloorCount,
    isExpectedEmpty: candidateCount === 0,
    hasRepeatedCursor: result.nextPage === page && result.nextOffset === offset
  });
}

function positiveReplyLocation(value: number | undefined) {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function matchesNodeSeekReplyLocation(reply: RepliesResponse['items'][number], target: ReplyLocationTarget) {
  const commentId = positiveReplyLocation(target.commentId);
  return commentId ? reply.commentId === commentId : reply.floor === positiveReplyLocation(target.floor);
}

export async function getNodeSeekReplies(id: string, options: NodeSeekRepliesOptions): Promise<RepliesResponse> {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'topic', 'foreground');
  const target = options.targetReply;
  if (target) {
    const commentId = positiveReplyLocation(target.commentId);
    const floor = positiveReplyLocation(target.floor);
    if (target.commentId !== undefined && !commentId) throw new Error('NodeSeek 目标评论不正确');
    if (!commentId && !floor) throw new Error('NodeSeek 目标楼层不正确');
    const hintedPage = positiveReplyLocation(target.pageHint);
    const firstPage =
      hintedPage ||
      (floor ? Math.floor((floor - 1) / NODESEEK_FLOORS_PER_PAGE) + 1 : positiveReplyLocation(options.page) || 1);
    const lastPage = commentId
      ? Math.max(Math.ceil(Math.max(0, options.replyCount || 0) / NODESEEK_FLOORS_PER_PAGE), 1)
      : firstPage;
    const pages = commentId
      ? [firstPage, ...Array.from({ length: lastPage }, (_, index) => index + 1).filter((page) => page !== firstPage)]
      : [firstPage];
    for (const page of pages) {
      const result = await getNodeSeekReplies(id, {
        ...options,
        fillPages: false,
        limit: NODESEEK_FLOORS_PER_PAGE,
        offset: null,
        page,
        replyCount: undefined,
        targetReply: undefined
      });
      if (result.items.some((reply) => matchesNodeSeekReplyLocation(reply, target))) {
        return result.nextPage && result.nextPage !== page
          ? { ...result, nextOffset: (result.nextPage - 1) * NODESEEK_FLOORS_PER_PAGE }
          : result;
      }
    }
    throw new Error(commentId ? 'NodeSeek 目标评论未找到' : 'NodeSeek 目标楼层未找到');
  }
  const page = options.page || 1;
  const limit = options.limit || 30;
  const { html, postData, rendered } = await fetchTopicPageData(id, page, requestOptions);
  const hasOffset = typeof options.offset === 'number' && options.offset >= 0;
  const offset = hasOffset ? (options.offset as number) : 0;
  const floorOffset = hasOffset ? offset : (page - 1) * limit;
  const windowFields = {
    currentPage: page,
    currentOffset: floorOffset,
    previousPage: page > 1 ? page - 1 : null,
    previousOffset: page > 1 ? Math.max(0, floorOffset - NODESEEK_FLOORS_PER_PAGE) : null
  };
  if (rendered && (rendered.replies.length || !postData)) {
    const renderedSource = rendered.replies.map((reply, index) => ({
      ...reply,
      floor: reply.floor ?? (page <= 1 ? index + 1 : floorOffset + index + 1)
    }));
    const embeddedReplies = postData
      ? normalizeReplies(arrayField(postData.comments), {
          skipFirst: page <= 1,
          floorOffset: page <= 1 ? 0 : floorOffset
        })
      : [];
    const source = embeddedReplies.length
      ? renderedSource.map((reply) =>
          mergeRenderedNodeSeekReply(reply, matchingEmbeddedNodeSeekReply(reply, embeddedReplies))
        )
      : renderedSource;
    const items = page <= 1 ? source.slice(offset, offset + limit) : source;
    const consumed = offset + items.length;
    const hasPageRemainder = page <= 1 && consumed < source.length;
    const nextPage = nextNodeSeekPostPage(html, id, page);
    const hasMore = hasPageRemainder || Boolean(nextPage);
    const result = {
      ...windowFields,
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? page : nextPage || page + 1) : null,
      nextOffset: hasMore
        ? page <= 1 && hasPageRemainder
          ? consumed
          : page > 1
            ? ((nextPage || page + 1) - 1) * NODESEEK_FLOORS_PER_PAGE
            : floorOffset + items.length
        : null
    };
    const annotated = annotateNodeSeekReplies(result, {
      parserVariant: 'rendered-replies',
      candidateCount: renderedSource.length,
      missingFloorCount: rendered.replies.filter((reply) => !reply.floor).length,
      offset,
      page
    });
    return requestOptions.fillPages ? fillNodeSeekRepliesLimit(id, requestOptions, annotated, limit) : annotated;
  }
  if (!postData) {
    throw new Error('NodeSeek 主题解析失败');
  }
  const comments = arrayField(postData.comments);
  if (page <= 1) {
    const allReplies = normalizeReplies(comments, { skipFirst: true });
    const items = allReplies.slice(offset, offset + limit);
    const consumed = offset + items.length;
    const hasPageRemainder = consumed < allReplies.length;
    const nextPage = nextNodeSeekPostPage(html, id, 1);
    const hasMore = hasPageRemainder || Boolean(nextPage);
    const result = {
      ...windowFields,
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? 1 : nextPage || 2) : null,
      nextOffset: hasMore ? consumed : null
    };
    const missingFloorCount = comments
      .slice(1)
      .filter(
        (comment) => isRecord(comment) && optionalInteger(comment.floorIndex ?? comment.floor) === undefined
      ).length;
    const annotated = annotateNodeSeekReplies(result, {
      parserVariant: 'embedded-replies',
      candidateCount: Math.max(0, comments.length - 1),
      missingFloorCount,
      offset,
      page
    });
    return requestOptions.fillPages ? fillNodeSeekRepliesLimit(id, requestOptions, annotated, limit) : annotated;
  }
  const items = normalizeReplies(comments, { skipFirst: false, floorOffset });
  const nextPage = nextNodeSeekPostPage(html, id, page);
  const hasMore = Boolean(nextPage);
  const result = {
    ...windowFields,
    items,
    hasMore,
    nextPage: nextPage || null,
    nextOffset: hasMore ? (nextPage! - 1) * NODESEEK_FLOORS_PER_PAGE : null
  };
  const annotated = annotateNodeSeekReplies(result, {
    parserVariant: 'embedded-replies',
    candidateCount: comments.length,
    missingFloorCount: comments.filter(
      (comment) => isRecord(comment) && optionalInteger(comment.floorIndex ?? comment.floor) === undefined
    ).length,
    offset,
    page
  });
  return requestOptions.fillPages ? fillNodeSeekRepliesLimit(id, requestOptions, annotated, limit) : annotated;
}

export async function resolveNodeSeekUser(username: string, options: NodeSeekOptions = {}): Promise<UserReference> {
  const requestedUsername = username.trim();
  if (!requestedUsername) {
    throw new Error('NodeSeek 用户名不能为空');
  }
  if (options.authenticated === false) {
    throw Object.assign(new Error('请先登录 NodeSeek 后再打开用户主页'), {
      source: 'nodeseek' as const,
      loginRequired: true
    });
  }
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'user', 'foreground');
  const data = await fetchNodeSeekJson(`/api/account/find/${encodeURIComponent(requestedUsername)}`, requestOptions);
  return parseNodeSeekUserReference(requestedUsername, data);
}

export async function getNodeSeekUserProfile(id: string, options: NodeSeekOptions = {}): Promise<UserProfile> {
  const requestedId = id.trim();
  if (!/^\d+$/.test(requestedId)) {
    throw new Error('NodeSeek 用户主页需要数字用户 ID');
  }
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'user', 'foreground');
  const userData = await fetchNodeSeekJson(
    `/api/account/getInfo/${encodeURIComponent(requestedId)}?readme=1`,
    requestOptions
  );
  const user = parseNodeSeekUserIdentity(requestedId, userData);
  const cursorPage = parsePositiveInteger(options.cursor) || 1;
  const wantsTopics = options.cursorType !== 'replies';
  const wantsReplies = options.cursorType !== 'topics';
  let discussions: unknown[] = [];
  if (wantsTopics) {
    const discussionData = await fetchNodeSeekJson(
      `/api/content/list-discussions?uid=${encodeURIComponent(requestedId)}&page=${cursorPage}`,
      requestOptions
    );
    discussions =
      isRecord(discussionData) && Array.isArray(discussionData.discussions) ? discussionData.discussions : [];
  }
  let comments: unknown[] = [];
  let partialErrorCount = 0;
  if (wantsReplies) {
    try {
      const commentData = await fetchNodeSeekJson(
        `/api/content/list-comments?uid=${encodeURIComponent(requestedId)}&page=${cursorPage}`,
        requestOptions
      );
      comments = isRecord(commentData) && Array.isArray(commentData.comments) ? commentData.comments : [];
    } catch (error) {
      if (options.cursorType === 'replies') {
        throw error;
      }
      partialErrorCount += 1;
    }
  }
  return parseNodeSeekUserProfile({
    comments,
    cursor: options.cursor,
    cursorPage,
    cursorType: options.cursorType,
    discussions,
    partialErrorCount,
    requestedId,
    user
  });
}

function nodeSeekLoginExpiredError() {
  return Object.assign(new Error('NodeSeek 登录已失效'), {
    source: 'nodeseek' as const,
    kind: 'login-expired' as const,
    loginRequired: true,
    reason: 'expired' as const
  });
}

export async function getNodeSeekCurrentUserProfile(options: NodeSeekOptions = {}): Promise<UserProfile> {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'account', 'background');
  for (const path of ['/', '/setting']) {
    const html = await fetchNodeSeekText(path, requestOptions);
    const embeddedUser = nodeSeekCurrentUserFromConfig(extractNodeSeekEmbeddedData(html));
    if (embeddedUser) {
      return embeddedUser;
    }
    if (isNodeSeekLoggedOutHtml(html)) {
      throw nodeSeekLoginExpiredError();
    }
    const user = parseNodeSeekCurrentUserHtml(html, { allowUidText: path === '/setting' });
    if (user) {
      return user;
    }
  }
  throw new Error('无法读取当前 NodeSeek 用户身份，请重新检测 NodeSeek 登录。');
}

export async function searchNodeSeek(
  query: string,
  options: NodeSeekOptions & { limit?: number; page?: number; filter?: NodeSeekSearchFilter } = {}
): Promise<SearchResponse> {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'search', 'foreground');
  const trimmedQuery = query.trim();
  const limit = options.limit || 30;
  const page = options.page || 1;
  if (!trimmedQuery) {
    return annotateSourceDiagnosticSummary(
      { items: [], errors: {}, hasMore: false, nextPage: null },
      {
        parserVariant: 'search-empty-query',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        isExpectedEmpty: true
      }
    );
  }

  let items: Topic[] = [];
  let nextPage: number | null = null;
  let candidateCount = 0;
  let parserVariant = 'rendered-search';
  try {
    const useGoogleSearch = !hasLoggedInNodeSeekCookie(requestOptions);
    const html = useGoogleSearch
      ? await fetchNodeSeekGoogleSearchText(trimmedQuery, page, requestOptions)
      : await fetchNodeSeekText(searchPath(trimmedQuery, page, requestOptions.filter), requestOptions);
    parserVariant =
      useGoogleSearch || isGoogleSiteSearchResponse(html, 'nodeseek.com') ? 'google-search' : 'rendered-search';
    const parsedSearch = parseNodeSeekSearchTopics(html);
    candidateCount = parsedSearch.candidateCount;
    items = parsedSearch.items;
    if (isIncompleteNodeSeekSearchPage(html, items)) {
      throw new Error('NodeSeek 搜索页结果没有加载完成，请重试');
    }
    nextPage =
      useGoogleSearch || isGoogleSiteSearchResponse(html, 'nodeseek.com')
        ? hasGoogleSiteSearchNextPage(html, 'nodeseek.com', page + 1)
          ? page + 1
          : null
        : nextSearchPath(html, page + 1)
          ? page + 1
          : null;
  } catch (error) {
    if (isNodeSeekCloudflareError(error)) {
      throw error;
    }
    throw error;
  }

  const result = {
    items: items.slice(0, limit),
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant,
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isExpectedEmpty: candidateCount === 0,
    hasRepeatedCursor: nextPage === page
  });
}
