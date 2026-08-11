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
  ReplyOrder,
  ReplyWindowPosition,
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
  assertNodeSeekTopicIdentity,
  extractNodeSeekEmbeddedData,
  isNodeSeekChallengeResponse,
  lastNodeSeekPostPage,
  nextNodeSeekListPage,
  nextNodeSeekPostPage,
  nodeSeekEmbeddedPostPageCount,
  nodeSeekTopicPagePath,
  nodeSeekTopicUrl,
  optionalInteger,
  resolvedNodeSeekPostPage,
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
import {
  annotateSourceDiagnosticSummary,
  copySourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries
} from '@/sources/diagnostics';
import {
  acceptForumReadResponse,
  proveForumReadResponse,
  rejectForumReadResponse
} from '@/sources/forumSourceReadAttempt';
import { orientReplyWindow } from '@/sources/replyWindows';

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

async function fetchNodeSeekTextResult(
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
    return { response, responseUrl: response.url, text };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return { response, responseUrl: response.url, text };
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
  const { response, text } = await fetchNodeSeekTextResult(path, options, requestHeaders);
  return proveForumReadResponse(response, () => {
    try {
      return JSON.parse(extractNodeSeekJsonText(text)) as unknown;
    } catch {
      throw new Error('NodeSeek 数据解析失败');
    }
  });
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
  const { response, text: html } = await fetchNodeSeekTextResult(
    listPath(page, options.category, feedFilter),
    requestOptions
  );
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
  const parsed = annotateSourceDiagnosticSummary(result, {
    parserVariant: renderedItems.length ? 'rendered-list' : 'embedded-list',
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isExpectedEmpty: candidateCount === 0 && (page > 1 || Boolean(options.category)),
    isParseEmpty: page === 1 && !options.category && candidateCount === 0,
    hasRepeatedCursor: Boolean(nextPage && nextPage === page)
  });
  if (page === 1 && !options.category && candidateCount === 0) {
    rejectForumReadResponse(response);
  } else {
    acceptForumReadResponse(response);
  }
  return parsed;
}

export async function getNodeSeekCategories(options: NodeSeekOptions = {}) {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'feed', 'foreground');
  const { response, text: html } = await fetchNodeSeekTextResult('/', requestOptions);
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
  const parsed = annotateSourceDiagnosticSummary(result, {
    parserVariant: embeddedCategories.length ? 'embedded-categories' : 'rendered-categories',
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isParseEmpty: candidateCount === 0
  });
  if (candidateCount === 0) {
    rejectForumReadResponse(response);
  } else {
    acceptForumReadResponse(response);
  }
  return parsed;
}

async function fetchTopicHtml(id: string, page: number, options: NodeSeekOptions) {
  const result = await fetchNodeSeekTextResult(
    nodeSeekTopicPagePath(id, page),
    nodeSeekOptionsWithBrowserIntent(options, 'topic', 'foreground')
  );
  assertNodeSeekTopicIdentity(result.text, id, result.responseUrl);
  return result;
}

async function fetchTopicPageData(id: string, page: number, options: NodeSeekOptions) {
  const {
    response,
    responseUrl,
    text: html
  } = await fetchNodeSeekTextResult(
    nodeSeekTopicPagePath(id, page),
    nodeSeekOptionsWithBrowserIntent(options, 'topic', 'foreground')
  );
  assertNodeSeekTopicIdentity(html, id, responseUrl);
  const embedded = extractNodeSeekEmbeddedData(html);
  const postData = embedded && isRecord(embedded.postData) ? embedded.postData : null;
  const rendered = parseRenderedNodeSeekTopicHtml(html, id, Number.MAX_SAFE_INTEGER, page);
  if (!postData && !rendered) {
    rejectForumReadResponse(response);
    throw new Error('NodeSeek 主题解析失败');
  }
  acceptForumReadResponse(response);
  return { html, postData, rendered, resolvedPage: resolvedNodeSeekPostPage(html, id, responseUrl) };
}

export async function getNodeSeekTopic(id: string, options: NodeSeekOptions & { replyLimit?: number } = {}) {
  const requestOptions = nodeSeekOptionsWithBrowserIntent(options, 'topic', 'foreground');
  const { response, text: html } = await fetchTopicHtml(id, 1, requestOptions);
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
    const paged = withNodeSeekReplyPagination(
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
    const replyCandidates = Math.max(rendered.replies.length, Math.max(0, comments.length - 1));
    const result = {
      ...paged,
      replyCompleteness: paged.replies.length === replyCandidates ? ('complete' as const) : ('partial' as const)
    };
    const parsed = annotateSourceDiagnosticSummary(result, {
      parserVariant: 'rendered-topic',
      candidateCount: 1 + replyCandidates,
      validCount: 1 + result.replies.length,
      droppedCount: Math.max(0, replyCandidates - result.replies.length),
      partialErrorCount: voteLinkPolls.partialErrorCount,
      missingFloorCount: rendered.replies.filter((reply) => !reply.floor).length
    });
    acceptForumReadResponse(response);
    return parsed;
  }
  if (postData) {
    const comments = arrayField(postData.comments);
    const first = isRecord(comments[0]) ? comments[0] : {};
    const topic = normalizePostData(postData, id, nodeSeekTopicUrl(id), options.replyLimit || 30);
    const voteLinkPolls = await readNodeSeekPollsFromVoteLinks([first.markdown, html], requestOptions);
    const polls = mergeNodeSeekPolls(voteLinkPolls.polls);
    const paged = withNodeSeekReplyPagination(
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
    const result = {
      ...paged,
      replyCompleteness: paged.replies.length === replyCandidates ? ('complete' as const) : ('partial' as const)
    };
    const missingFloorCount = comments
      .slice(1)
      .filter(
        (comment) => isRecord(comment) && optionalInteger(comment.floorIndex ?? comment.floor) === undefined
      ).length;
    const parsed = annotateSourceDiagnosticSummary(result, {
      parserVariant: 'embedded-topic',
      candidateCount: 1 + replyCandidates,
      validCount: 1 + result.replies.length,
      droppedCount: Math.max(0, replyCandidates - result.replies.length),
      partialErrorCount: voteLinkPolls.partialErrorCount,
      missingFloorCount
    });
    acceptForumReadResponse(response);
    return parsed;
  }
  rejectForumReadResponse(response);
  throw new Error('NodeSeek 主题解析失败');
}

type NodeSeekChronologicalRepliesOptions = NodeSeekOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
  fillPages?: boolean;
  orderedWindow?: boolean;
  replyCount?: number;
  targetReply?: ReplyLocationTarget;
};

type NodeSeekChronologicalReplies = RepliesResponse & {
  confirmedFloors?: number[];
  nodeSeekLastPage?: number;
  responsePageResolved?: boolean;
  resolvedPageConfirmed?: boolean;
};

function projectNodeSeekOrderedPageItems(
  items: RepliesResponse['items'],
  page: number,
  confirmedFloors: readonly number[] = []
) {
  const firstFloor = (page - 1) * NODESEEK_FLOORS_PER_PAGE + 1;
  const lastFloor = page * NODESEEK_FLOORS_PER_PAGE;
  const confirmedFloorSet = new Set(confirmedFloors);
  // Sparse pages and inferred floors are usable data, not proof that the origin returned the wrong page.
  const confirmedWindowFloors = new Set(confirmedFloors.filter((floor) => floor >= firstFloor && floor <= lastFloor));
  if (
    confirmedWindowFloors.size === NODESEEK_FLOORS_PER_PAGE &&
    items.some((reply) => {
      const floor = positiveReplyLocation(reply.floor);
      return (
        floor &&
        confirmedFloorSet.has(floor) &&
        (floor < firstFloor || floor > lastFloor) &&
        !reply.hot &&
        !reply.pinned
      );
    })
  ) {
    throw new Error('NodeSeek 原站未确认请求的回复页');
  }
  const projected = items.filter((reply) => {
    const floor = positiveReplyLocation(reply.floor);
    return (
      !floor ||
      !confirmedFloorSet.has(floor) ||
      (floor >= firstFloor && floor <= lastFloor) ||
      (!reply.hot && !reply.pinned)
    );
  });
  const byLocation = new Map<string, (typeof projected)[number]>();
  const unlocated: (typeof projected)[number][] = [];
  for (const reply of projected) {
    const commentId = positiveReplyLocation(reply.commentId);
    const floor = positiveReplyLocation(reply.floor);
    const key = commentId ? `comment:${commentId}` : floor ? `floor:${floor}` : null;
    if (!key) {
      unlocated.push(reply);
      continue;
    }
    const existing = byLocation.get(key);
    if (!existing || ((existing.hot || existing.pinned) && !reply.hot && !reply.pinned)) {
      byLocation.set(key, reply);
    }
  }
  return [...byLocation.values(), ...unlocated].sort((left, right) => {
    const leftFloor = positiveReplyLocation(left.floor);
    const rightFloor = positiveReplyLocation(right.floor);
    if (leftFloor && rightFloor) return leftFloor - rightFloor;
    if (leftFloor) return -1;
    if (rightFloor) return 1;
    return 0;
  });
}

function projectNodeSeekOrderedPage(result: NodeSeekChronologicalReplies, page: number): NodeSeekChronologicalReplies {
  const items = projectNodeSeekOrderedPageItems(result.items, page, result.confirmedFloors);
  const retainedFloors = new Set(
    items.map((reply) => positiveReplyLocation(reply.floor)).filter((floor): floor is number => Boolean(floor))
  );
  const confirmedFloors = (result.confirmedFloors || []).filter((floor) => retainedFloors.has(floor));
  const orderedConfirmedFloors = [...new Set(confirmedFloors)].sort((left, right) => left - right);
  const confirmedFloorSet = new Set(orderedConfirmedFloors);
  const hasConfirmedFloorGap = orderedConfirmedFloors.some(
    (floor, index) => index > 0 && floor !== orderedConfirmedFloors[index - 1] + 1
  );
  const hasUnconfirmedItem = items.some((reply) => {
    const floor = positiveReplyLocation(reply.floor);
    return !floor || !confirmedFloorSet.has(floor);
  });
  return copySourceDiagnosticSummary(
    {
      ...result,
      completeness:
        result.completeness === 'partial' ||
        items.length !== result.items.length ||
        hasConfirmedFloorGap ||
        hasUnconfirmedItem
          ? 'partial'
          : 'complete',
      confirmedFloors,
      items
    },
    result
  );
}

function assertNodeSeekResolvedPage(result: NodeSeekChronologicalReplies, page: number) {
  if (result.currentPage !== page || result.resolvedPageConfirmed !== true) {
    throw new Error('NodeSeek 原站未确认请求的回复页');
  }
}

function assertNodeSeekAdjacentPageEvidence(
  result: NodeSeekChronologicalReplies,
  page: number,
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
) {
  assertNodeSeekResolvedPage(result, page);
  const firstFloor = (page - 1) * NODESEEK_FLOORS_PER_PAGE + 1;
  const confirmedFloors = [...new Set(result.confirmedFloors || [])].sort((left, right) => left - right);
  if (confirmedFloors.some((floor) => floor < firstFloor || floor > page * NODESEEK_FLOORS_PER_PAGE)) {
    throw new Error('NodeSeek 原站未确认请求的回复页');
  }
  if (!allowEmpty && !result.items.length) {
    throw new Error('NodeSeek 原站回复窗口为空');
  }
}

function assertNodeSeekTerminalWindow(result: NodeSeekChronologicalReplies, page: number) {
  if (result.currentPage !== page || result.resolvedPageConfirmed !== true || result.hasMore || result.nextPage) {
    throw new Error('NodeSeek 原站无法确认最新窗口');
  }
  if (!result.items.length) {
    if (page === 1) return;
    throw new Error('NodeSeek 原站无法确认最新窗口');
  }
}

async function resolveNodeSeekTailChronological(
  id: string,
  options: NodeSeekChronologicalRepliesOptions,
  initialPage: number,
  initialResult: NodeSeekChronologicalReplies
) {
  let page = initialPage;
  let result = projectNodeSeekOrderedPage(initialResult, initialPage);
  const visitedPages = new Set<number>();
  while (true) {
    if (visitedPages.has(page)) {
      throw new Error('NodeSeek 原站返回了重复的末页游标');
    }
    visitedPages.add(page);
    assertNodeSeekAdjacentPageEvidence(result, page, {
      allowEmpty: page === 1 && options.replyCount === 0 && !result.hasMore && !result.nextPage
    });
    const candidate = Math.max(page, result.nodeSeekLastPage || page, result.nextPage || page);
    if (candidate > page) {
      page = candidate;
      result = projectNodeSeekOrderedPage(
        await getNodeSeekRepliesChronological(id, {
          ...options,
          page,
          offset: (page - 1) * NODESEEK_FLOORS_PER_PAGE,
          limit: NODESEEK_FLOORS_PER_PAGE,
          fillPages: false,
          orderedWindow: true,
          targetReply: undefined
        }),
        page
      );
      continue;
    }
    assertNodeSeekTerminalWindow(result, page);
    return { page, result };
  }
}

async function fillNodeSeekRepliesLimit(
  id: string,
  options: NodeSeekChronologicalRepliesOptions,
  result: RepliesResponse,
  limit: number
): Promise<RepliesResponse> {
  if (!result.items.length && result.hasMore && result.nextPage) {
    throw new Error('NodeSeek 原站回复窗口为空');
  }
  if (result.items.length >= limit || !result.hasMore || !result.nextPage) {
    return result;
  }
  const page = options.page || 1;
  const offset = typeof options.offset === 'number' ? options.offset : null;
  if (result.nextPage === page && result.nextOffset === offset) {
    return result;
  }
  const extra = await getNodeSeekRepliesChronological(id, {
    ...options,
    page: result.nextPage,
    offset: result.nextOffset,
    limit: limit - result.items.length
  });
  const combined = {
    ...extra,
    completeness:
      result.completeness === 'partial' || extra.completeness === 'partial'
        ? ('partial' as const)
        : ('complete' as const),
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

async function getNodeSeekRepliesChronological(
  id: string,
  options: NodeSeekChronologicalRepliesOptions
): Promise<NodeSeekChronologicalReplies> {
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
    const fetchPage = async (page: number) => {
      const result = await getNodeSeekRepliesChronological(id, {
        ...options,
        fillPages: false,
        limit: NODESEEK_FLOORS_PER_PAGE,
        offset: null,
        page,
        targetReply: undefined
      });
      return result;
    };
    const readPage = async (page: number) => {
      const result = await fetchPage(page);
      assertNodeSeekResolvedPage(result, page);
      return result;
    };
    const targetResult = (result: NodeSeekChronologicalReplies, page: number) =>
      result.nextPage && result.nextPage !== page
        ? { ...result, nextOffset: (result.nextPage - 1) * NODESEEK_FLOORS_PER_PAGE }
        : result;
    const hasTarget = (result: NodeSeekChronologicalReplies) => {
      if (!commentId && floor && !result.confirmedFloors?.includes(floor)) {
        return false;
      }
      return result.items.some((reply) => matchesNodeSeekReplyLocation(reply, target));
    };
    let seedPage = firstPage;
    let firstResult = await fetchPage(firstPage);
    if (firstResult.currentPage !== firstPage || firstResult.resolvedPageConfirmed !== true) {
      if (!commentId || firstResult.responsePageResolved !== true || !positiveReplyLocation(firstResult.currentPage)) {
        assertNodeSeekResolvedPage(firstResult, firstPage);
      }
      seedPage = firstResult.currentPage!;
      firstResult = await readPage(seedPage);
    }
    if (hasTarget(firstResult)) {
      return targetResult(firstResult, seedPage);
    }
    if (commentId) {
      let lastPage = Math.max(seedPage, firstResult.nodeSeekLastPage || seedPage, firstResult.nextPage || seedPage);
      for (let page = 1; page <= lastPage; page += 1) {
        if (page === seedPage) continue;
        const result = await readPage(page);
        lastPage = Math.max(lastPage, result.nodeSeekLastPage || page, result.nextPage || page);
        if (hasTarget(result)) {
          return targetResult(result, page);
        }
      }
    }
    throw new Error(commentId ? 'NodeSeek 目标评论未找到' : 'NodeSeek 目标楼层未找到');
  }
  const page = options.page || 1;
  const limit = options.limit || 30;
  const { html, postData, rendered, resolvedPage } = await fetchTopicPageData(id, page, requestOptions);
  const hasOffset = typeof options.offset === 'number' && options.offset >= 0;
  const offset = hasOffset ? (options.offset as number) : 0;
  const floorOffset = hasOffset ? offset : (page - 1) * limit;
  const originLastPage = Math.max(
    page,
    lastNodeSeekPostPage(html, id, page),
    postData ? nodeSeekEmbeddedPostPageCount(postData) || page : page
  );
  const originNextPage = nextNodeSeekPostPage(html, id, page) || (page < originLastPage ? page + 1 : null);
  const windowFields = {
    confirmedFloors: [] as number[],
    currentPage: resolvedPage || page,
    currentOffset: floorOffset,
    nodeSeekLastPage: originLastPage,
    previousPage: page > 1 ? page - 1 : null,
    previousOffset: page > 1 ? Math.max(0, floorOffset - NODESEEK_FLOORS_PER_PAGE) : null,
    responsePageResolved: Boolean(resolvedPage),
    resolvedPageConfirmed: resolvedPage === page
  };
  if (rendered && (rendered.replies.length || !postData)) {
    const explicitFloors = [
      ...rendered.replies.map((reply) => reply.floor),
      ...(postData
        ? arrayField(postData.comments).map((comment) =>
            isRecord(comment) ? (comment.floorIndex ?? comment.floor) : undefined
          )
        : [])
    ]
      .map(optionalInteger)
      .filter((floor): floor is number => Boolean(floor && floor > 0));
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
    const orderedSource = options.orderedWindow
      ? projectNodeSeekOrderedPageItems(source, page, explicitFloors)
      : source;
    const items = page <= 1 ? orderedSource.slice(offset, offset + limit) : orderedSource;
    const consumed = offset + items.length;
    const hasPageRemainder = page <= 1 && consumed < orderedSource.length;
    const nextPage = originNextPage;
    const hasMore = hasPageRemainder || Boolean(nextPage);
    const result = {
      ...windowFields,
      ...(orderedSource.length === source.length ? {} : { completeness: 'partial' as const }),
      confirmedFloors: [...new Set(explicitFloors)],
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? page : nextPage || page + 1) : null,
      nextOffset: hasMore
        ? page <= 1 && hasPageRemainder
          ? consumed
          : page > 1
            ? ((nextPage || page + 1) - 1) * NODESEEK_FLOORS_PER_PAGE
            : ((nextPage || page + 1) - 1) * NODESEEK_FLOORS_PER_PAGE
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
    const explicitFloors = comments
      .slice(1)
      .map((comment) => (isRecord(comment) ? optionalInteger(comment.floorIndex ?? comment.floor) : undefined))
      .filter((floor): floor is number => Boolean(floor && floor > 0));
    const allReplies = normalizeReplies(comments, { skipFirst: true });
    const orderedReplies = options.orderedWindow
      ? projectNodeSeekOrderedPageItems(allReplies, page, explicitFloors)
      : allReplies;
    const items = orderedReplies.slice(offset, offset + limit);
    const consumed = offset + items.length;
    const hasPageRemainder = consumed < orderedReplies.length;
    const nextPage = originNextPage;
    const hasMore = hasPageRemainder || Boolean(nextPage);
    const result = {
      ...windowFields,
      ...(allReplies.length === Math.max(0, comments.length - 1) && orderedReplies.length === allReplies.length
        ? {}
        : { completeness: 'partial' as const }),
      confirmedFloors: [...new Set(explicitFloors)],
      items,
      hasMore,
      nextPage: hasMore ? (hasPageRemainder ? 1 : nextPage || 2) : null,
      nextOffset: hasMore ? (hasPageRemainder ? consumed : ((nextPage || 2) - 1) * NODESEEK_FLOORS_PER_PAGE) : null
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
  const explicitFloors = comments
    .map((comment) => (isRecord(comment) ? optionalInteger(comment.floorIndex ?? comment.floor) : undefined))
    .filter((floor): floor is number => Boolean(floor && floor > 0));
  const normalizedItems = normalizeReplies(comments, { skipFirst: false, floorOffset });
  const items = options.orderedWindow
    ? projectNodeSeekOrderedPageItems(normalizedItems, page, explicitFloors)
    : normalizedItems;
  const nextPage = originNextPage;
  const hasMore = Boolean(nextPage);
  const result = {
    ...windowFields,
    ...(normalizedItems.length === comments.length && items.length === normalizedItems.length
      ? {}
      : { completeness: 'partial' as const }),
    confirmedFloors: [...new Set(explicitFloors)],
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

export async function getNodeSeekReplies(
  id: string,
  options: NodeSeekOptions & {
    order: ReplyOrder;
    position: ReplyWindowPosition;
    limit?: number;
    fillPages?: boolean;
    replyCount?: number;
  }
): Promise<RepliesResponse> {
  const { order, position } = options;
  let page = 1;
  let offset: number | null = 0;
  let targetReply: ReplyLocationTarget | undefined;
  if (position.kind === 'cursor') {
    page = position.page;
    offset = position.offset;
  } else if (position.kind === 'target') {
    targetReply = position.target;
    page = position.target.pageHint || 1;
    offset = null;
  }

  let chronological = await getNodeSeekRepliesChronological(id, {
    ...options,
    page,
    offset,
    targetReply,
    orderedWindow: position.kind !== 'target',
    fillPages: order === 'oldest' ? options.fillPages : false
  });
  if (position.kind !== 'target') {
    chronological = projectNodeSeekOrderedPage(chronological, page);
  }
  if (position.kind === 'start' && order === 'newest') {
    const confirmedTail = await resolveNodeSeekTailChronological(id, options, page, chronological);
    page = confirmedTail.page;
    chronological = confirmedTail.result;
  }
  if (position.kind === 'cursor' || (position.kind === 'start' && !chronological.items.length)) {
    assertNodeSeekAdjacentPageEvidence(chronological, page, {
      allowEmpty:
        position.kind === 'start' &&
        options.replyCount === 0 &&
        page === 1 &&
        !chronological.hasMore &&
        !chronological.nextPage
    });
  }
  const {
    nodeSeekLastPage: _nodeSeekLastPage,
    responsePageResolved: _responsePageResolved,
    ...replyWindow
  } = chronological;
  return orientReplyWindow(
    copySourceDiagnosticSummary(
      {
        ...replyWindow,
        completeness: replyWindow.completeness || 'partial'
      },
      chronological
    ),
    order
  );
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
    const { response, text: html } = await fetchNodeSeekTextResult(path, requestOptions);
    const embeddedUser = nodeSeekCurrentUserFromConfig(extractNodeSeekEmbeddedData(html));
    if (embeddedUser) {
      acceptForumReadResponse(response);
      return embeddedUser;
    }
    if (isNodeSeekLoggedOutHtml(html)) {
      acceptForumReadResponse(response);
      throw nodeSeekLoginExpiredError();
    }
    const user = parseNodeSeekCurrentUserHtml(html, { allowUidText: path === '/setting' });
    if (user) {
      acceptForumReadResponse(response);
      return user;
    }
    rejectForumReadResponse(response);
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
  let sourceResponse: Response | undefined;
  try {
    const useGoogleSearch = !hasLoggedInNodeSeekCookie(requestOptions);
    let html: string;
    if (useGoogleSearch) {
      html = await fetchNodeSeekGoogleSearchText(trimmedQuery, page, requestOptions);
    } else {
      const result = await fetchNodeSeekTextResult(
        searchPath(trimmedQuery, page, requestOptions.filter),
        requestOptions
      );
      html = result.text;
      sourceResponse = result.response;
    }
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
  const parsed = annotateSourceDiagnosticSummary(result, {
    parserVariant,
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isExpectedEmpty: candidateCount === 0,
    hasRepeatedCursor: nextPage === page
  });
  if (sourceResponse) {
    acceptForumReadResponse(sourceResponse);
  }
  return parsed;
}
