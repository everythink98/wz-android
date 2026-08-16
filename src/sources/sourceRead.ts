import {
  getNodeSeekCurrentUserProfile,
  getNodeSeekReplies,
  getNodeSeekTopic,
  getNodeSeekUserProfile
} from '@/sources/nodeseek/reader';
import { parseYaohuoListDocument } from '@/sources/yaohuo/feedParser';
import { parseYaohuoUserProfileDocument, parseYaohuoUserRepliesDocument } from '@/sources/yaohuo/userParser';
import {
  YAOHUO_BASE_URL,
  YAOHUO_BBS_REFERER,
  requireYaohuoRequestUrl,
  yaohuoReplyListNextPageUrlFromRoot,
  yaohuoTopicListNextPageUrlFromRoot,
  yaohuoUserProfileReplyListUrlFromRoot,
  yaohuoUserProfileTopicListUrlFromRoot
} from '@/sources/yaohuo/protocol';
import { ensureYaohuoHtmlLoggedIn } from '@/sources/yaohuo/sessionParser';
import { getV2exReplies, getV2exTopic } from '@/sources/v2ex/reader';
import { getV2exUserProfile } from '@/sources/v2ex/account';
import { checkYaohuoLoginDirect } from '@/sources/yaohuo/reader';
import {
  getDiscourseSourceCurrentUserProfile,
  getDiscourseSourceReplies,
  getDiscourseSourceReply,
  getDiscourseSourceTopic,
  getDiscourseSourceUserProfile,
  type DiscourseReadAuth
} from './discourseRead';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { sortTopicsByCreatedAt } from '@/domain/forum/feed';
import type {
  Reply,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  Source,
  Topic,
  TopicDetail,
  UserProfile
} from '@/domain/forum/models';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { copySourceDiagnosticSummary, mergeSourceDiagnosticSummaries, sourceDiagnosticSummary } from './diagnostics';
import { dispatchSourceRead } from './readAggregation';
import { parseHtml } from '@/domain/forum/html';
function pageNumberFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page') || '1');
    return Number.isFinite(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

export function getTopic({
  source,
  id,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  diagnosticTrace,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  diagnosticTrace?: DiagnosticTrace;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<TopicDetail> {
  const options = { authenticated: nodeSeekAuthenticated, fetcher, nodeSeekUserAgent, signal, timeoutMs };
  if (isDiscourseSource(source)) {
    return getDiscourseSourceTopic(source, id, {
      auth: discourseAuth,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekTopic(id, options, diagnosticTrace),
    v2ex: () => getV2exTopic(id, options)
  });
}

export function getReplies({
  source,
  id,
  order,
  position,
  limit = 20,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  fillPages,
  replyCount,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  order: ReplyOrder;
  position: ReplyWindowPosition;
  limit?: number;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  fillPages?: boolean;
  replyCount?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RepliesResponse> {
  const options = {
    authenticated: nodeSeekAuthenticated,
    order,
    position,
    limit,
    fetcher,
    nodeSeekUserAgent,
    fillPages,
    replyCount,
    signal,
    timeoutMs
  };
  if (isDiscourseSource(source)) {
    return getDiscourseSourceReplies(source, id, {
      auth: discourseAuth,
      fetcher,
      limit,
      order,
      position,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead<RepliesResponse>(source, {
    nodeseek: () => getNodeSeekReplies(id, options),
    v2ex: () => getV2exReplies(id, options)
  });
}

export function getReply({
  source,
  id,
  floor,
  fetcher,
  discourseAuth,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  floor: number;
  fetcher?: Fetcher;
  discourseAuth?: DiscourseReadAuth;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<Reply> {
  if (!isDiscourseSource(source)) {
    throw new Error('该来源不支持按楼层读取引用');
  }
  return getDiscourseSourceReply(source, id, floor, {
    auth: discourseAuth,
    fetcher,
    signal,
    timeoutMs
  });
}

export function getUserProfile({
  source,
  id,
  username,
  fetcher,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  discourseAuth,
  cursor,
  cursorType,
  signal,
  timeoutMs
}: {
  source: Source;
  id: string;
  username?: string;
  fetcher?: Fetcher;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  discourseAuth?: DiscourseReadAuth;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  const options = {
    authenticated: nodeSeekAuthenticated,
    fetcher,
    nodeSeekUserAgent,
    cursor,
    cursorType,
    signal,
    timeoutMs
  };
  if (isDiscourseSource(source)) {
    return getDiscourseSourceUserProfile(source, id, username || id, {
      auth: discourseAuth,
      cursor,
      cursorType,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead(source, {
    nodeseek: () => getNodeSeekUserProfile(id, options),
    v2ex: () => getV2exUserProfile(id, username || id, { fetcher, cursor, cursorType, signal, timeoutMs }),
    yaohuo: async () => {
      const targetId = id || username || '';
      const url = `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(targetId)}&siteid=1000`;
      const diagnosticSources: unknown[] = [];
      let partialErrorCount = 0;
      let hasRepeatedCursor = false;
      const annotateUserProfile = (profile: UserProfile) => {
        const childSummaries = diagnosticSources.map(sourceDiagnosticSummary).filter(Boolean);
        const droppedCount = childSummaries.reduce((total, summary) => total + (summary?.droppedCount || 0), 0);
        const missingFloorCount = childSummaries.reduce(
          (total, summary) => total + (summary?.missingFloorCount || 0),
          0
        );
        const childPartialErrorCount = childSummaries.reduce(
          (total, summary) => total + (summary?.partialErrorCount || 0),
          0
        );
        const identityValid = childSummaries.some(
          (summary) => summary?.parserVariant === 'html-user' && summary.isParseEmpty
        )
          ? 0
          : 1;
        const validCount = identityValid + profile.topics.length + (profile.replies?.length || 0);
        return mergeSourceDiagnosticSummaries(profile, 'html-user', diagnosticSources, {
          candidateCount: 1 + profile.topics.length + (profile.replies?.length || 0) + droppedCount,
          validCount,
          droppedCount,
          partialErrorCount: partialErrorCount + childPartialErrorCount,
          missingFloorCount,
          hasRepeatedCursor:
            hasRepeatedCursor || profile.nextTopicsCursor === cursor || profile.nextRepliesCursor === cursor
        });
      };
      const headers = {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: YAOHUO_BBS_REFERER
      };
      const readHtml = async (pageUrl: string) => {
        const safeUrl = requireYaohuoRequestUrl(pageUrl);
        const response = await fetchWithTimeout(safeUrl, { headers }, { fetcher, signal, timeoutMs });
        const html = await response.text();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const resolvedUrl = requireYaohuoRequestUrl(response.url || safeUrl, safeUrl);
        ensureYaohuoHtmlLoggedIn(html, resolvedUrl);
        return {
          html,
          root: parseHtml(html),
          url: resolvedUrl
        };
      };
      const readProfilePage = async (pageUrl: string) => {
        const page = await readHtml(pageUrl);
        const profile = parseYaohuoUserProfileDocument(page.root, {
          id: targetId,
          username
        });
        diagnosticSources.push(profile);
        return {
          ...page,
          profile
        };
      };
      const readTopicPage = async (pageUrl: string) => {
        const page = await readHtml(pageUrl);
        const pageNumber = pageNumberFromUrl(page.url);
        const result = parseYaohuoListDocument(page.root, page.html, {
          classId: '0',
          limit: 30,
          page: pageNumber,
          url: page.url
        });
        diagnosticSources.push(result);
        return {
          ...page,
          result,
          nextUrl: yaohuoTopicListNextPageUrlFromRoot(page.root, page.url, pageNumber, result.items.length, 30)
        };
      };
      const readReplyPage = async (pageUrl: string, authorFallback?: string) => {
        const page = await readHtml(pageUrl);
        const replies = parseYaohuoUserRepliesDocument(page.root, {
          id: targetId,
          username: authorFallback || username || targetId
        });
        diagnosticSources.push(replies);
        return {
          ...page,
          replies,
          nextUrl: yaohuoReplyListNextPageUrlFromRoot(page.root, page.url, replies.length)
        };
      };
      const seen = new Set<string>();
      const topics: Topic[] = [];
      const addTopics = (items: Topic[], authorFallback?: string) => {
        for (const topic of items) {
          if (!seen.has(topic.id)) {
            seen.add(topic.id);
            topics.push(topic.author || !authorFallback ? topic : { ...topic, author: authorFallback });
          }
        }
      };

      if (cursor) {
        if (cursorType === 'replies') {
          const replyPage = await readReplyPage(cursor, username || targetId);
          return annotateUserProfile({
            source: 'yaohuo',
            id: targetId,
            username: username || targetId,
            displayName: username || targetId,
            url,
            topics: [],
            hasMoreTopics: false,
            nextTopicsCursor: null,
            replies: replyPage.replies,
            hasMoreReplies: Boolean(replyPage.nextUrl),
            nextRepliesCursor: replyPage.nextUrl || null
          });
        }
        const topicPage = await readTopicPage(cursor);
        addTopics(topicPage.result.items, username || targetId);
        return annotateUserProfile({
          source: 'yaohuo',
          id: targetId,
          username: username || targetId,
          displayName: username || targetId,
          url,
          topics: sortTopicsByCreatedAt(topics).slice(0, 30),
          hasMoreTopics: Boolean(topicPage.nextUrl),
          nextTopicsCursor: topicPage.nextUrl || null,
          replies: [],
          hasMoreReplies: false,
          nextRepliesCursor: null
        });
      }

      const firstPage = await readProfilePage(url);
      const authorFallback = firstPage.profile.displayName || firstPage.profile.username || targetId;
      const firstReplyUrl = yaohuoUserProfileReplyListUrlFromRoot(firstPage.root, targetId, firstPage.url);
      let firstReplyPage: { replies: NonNullable<UserProfile['replies']>; nextUrl: string } = {
        replies: [],
        nextUrl: ''
      };
      if (firstReplyUrl) {
        try {
          firstReplyPage = await readReplyPage(firstReplyUrl, authorFallback);
        } catch {
          partialErrorCount += 1;
        }
      }
      let nextUrl = yaohuoUserProfileTopicListUrlFromRoot(firstPage.root, targetId, firstPage.url);
      if (!nextUrl) {
        return annotateUserProfile({
          ...firstPage.profile,
          hasMoreTopics: false,
          nextTopicsCursor: null,
          replies: firstReplyPage.replies,
          hasMoreReplies: Boolean(firstReplyPage.nextUrl),
          nextRepliesCursor: firstReplyPage.nextUrl || null
        });
      }

      const visited = new Set<string>();
      for (let page = 1; nextUrl && topics.length < 30 && page <= 10; page += 1) {
        if (visited.has(nextUrl)) {
          hasRepeatedCursor = true;
          break;
        }
        visited.add(nextUrl);
        const pageResult = await readTopicPage(nextUrl);
        addTopics(pageResult.result.items, authorFallback);
        nextUrl = pageResult.nextUrl;
      }
      const visibleTopics = sortTopicsByCreatedAt(topics).slice(0, 30);
      const topicAuthor = visibleTopics.map((topic) => topic.author).find((author) => author && author !== targetId);
      const profile =
        topicAuthor && firstPage.profile.displayName === targetId
          ? { ...firstPage.profile, username: topicAuthor, displayName: topicAuthor }
          : firstPage.profile;
      const replyAuthor = profile.displayName || profile.username || targetId;
      const replies = firstReplyPage.replies.map((reply) =>
        reply.author === targetId && replyAuthor !== targetId ? { ...reply, author: replyAuthor } : reply
      );
      return annotateUserProfile({
        ...profile,
        topics: visibleTopics,
        hasMoreTopics: Boolean(nextUrl),
        nextTopicsCursor: nextUrl || null,
        replies,
        hasMoreReplies: Boolean(firstReplyPage.nextUrl),
        nextRepliesCursor: firstReplyPage.nextUrl || null
      });
    }
  });
}

export function getCurrentUserProfile({
  source,
  fetcher,
  discourseAuth,
  nodeSeekAuthenticated,
  nodeSeekUserAgent,
  signal,
  timeoutMs
}: {
  source: Source;
  fetcher?: Fetcher;
  discourseAuth?: DiscourseReadAuth;
  nodeSeekAuthenticated?: boolean;
  nodeSeekUserAgent?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<UserProfile> {
  if (isDiscourseSource(source)) {
    return getDiscourseSourceCurrentUserProfile(source, {
      auth: discourseAuth,
      fetcher,
      signal,
      timeoutMs
    });
  }
  return dispatchSourceRead(source, {
    nodeseek: () =>
      getNodeSeekCurrentUserProfile({
        authenticated: nodeSeekAuthenticated,
        fetcher,
        nodeSeekUserAgent,
        signal,
        timeoutMs
      }),
    v2ex: () => {
      throw new Error('V2EX 不支持当前登录身份读取');
    },
    yaohuo: async () => {
      const check = await checkYaohuoLoginDirect({
        yaohuoFetcher: fetcher,
        signal,
        timeoutMs
      });
      if (check.currentUser) {
        try {
          const profile = await getUserProfile({
            source: 'yaohuo',
            id: check.currentUser.id,
            username: check.currentUser.username,
            fetcher,
            signal,
            timeoutMs
          });
          return copySourceDiagnosticSummary({ ...profile, topics: [] }, profile);
        } catch (error) {
          if (signal?.aborted) {
            throw error;
          }
          return check.currentUser;
        }
      }
      if (check.loginRequired) {
        throw Object.assign(new Error(check.message || '妖火登录已失效，请重新登录。'), {
          source: 'yaohuo',
          loginRequired: true,
          reason: check.reason,
          loginUrl: check.loginUrl
        });
      }
      throw new Error('无法读取当前妖火用户身份，请重新检测妖火登录状态。');
    }
  });
}
