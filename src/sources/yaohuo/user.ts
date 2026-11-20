import type { Topic, UserDetails, UserTopicsPage, UserRepliesPage } from '@/domain/forum/models';
import { parseHtml, sortTopicsByCreatedAt } from '@/domain/forum/html';
import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import {
  copySourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries
} from '@/platform/diagnostics/sourceDiagnosticSummary';
import { parseYaohuoUserProfileDocument, parseYaohuoUserRepliesDocument } from './userParser';
import { parseYaohuoListDocument } from './feedParser';
import { ensureYaohuoHtmlLoggedIn } from './sessionParser';
import {
  YAOHUO_BASE_URL,
  YAOHUO_BBS_REFERER,
  isYaohuoUserReplyListUrl,
  isYaohuoUserTopicListUrl,
  requireYaohuoRequestUrl,
  yaohuoUserActivityPage,
  yaohuoUserProfileReplyListUrlFromRoot,
  yaohuoUserProfileTopicListUrlFromRoot,
  yaohuoUserReplyNextPageUrlFromRoot,
  yaohuoUserTopicNextPageUrlFromRoot
} from './protocol';

type UserReadOptions = { fetcher?: Fetcher; signal?: AbortSignal; timeoutMs?: number; cursor?: string | null };
type YaohuoActivity = {
  topicsUrl: string;
  repliesUrl: string;
  inlineTopics?: UserTopicsPage;
  emptyReplies: boolean;
};
type YaohuoUserDetails = UserDetails & { yaohuoActivity?: YaohuoActivity };
type YaohuoUserTopicScan =
  | { kind: 'discovering' }
  | { kind: 'reading'; url: string; read: number }
  | { kind: 'ready' | 'cycle'; nextUrl: string };

async function readHtml(url: string, options: UserReadOptions, matchesActivity?: (url: URL) => boolean) {
  const requireActivity = (value: string) => {
    if (matchesActivity && !matchesActivity(new URL(value))) throw new Error('妖火活动页与当前用户不匹配');
  };
  const safeUrl = requireYaohuoRequestUrl(url);
  requireActivity(safeUrl);
  const response = await fetchWithTimeout(
    safeUrl,
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: YAOHUO_BBS_REFERER
      }
    },
    options
  );
  const html = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const resolvedUrl = requireYaohuoRequestUrl(response.url || safeUrl, safeUrl);
  ensureYaohuoHtmlLoggedIn(html, resolvedUrl);
  requireActivity(resolvedUrl);
  return { html, root: parseHtml(html), url: resolvedUrl };
}

function profileUrl(id: string) {
  return `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(id)}&siteid=1000`;
}

export async function getYaohuoUserDetails(id: string, username: string | undefined, options: UserReadOptions) {
  const page = await readHtml(profileUrl(id), options);
  const parsed = parseYaohuoUserProfileDocument(page.root, { id, username });
  const { topics, ...details } = parsed;
  const topicsUrl = yaohuoUserProfileTopicListUrlFromRoot(page.root, id, page.url);
  const yaohuoActivity: YaohuoActivity = {
    topicsUrl,
    repliesUrl: yaohuoUserProfileReplyListUrlFromRoot(page.root, id, page.url),
    emptyReplies: parsed.replyCount === 0
  };
  if (!topicsUrl && (topics.length || parsed.topicCount === 0))
    yaohuoActivity.inlineTopics = copySourceDiagnosticSummary(
      { topics, hasMoreTopics: false, nextTopicsCursor: null },
      parsed
    );
  return copySourceDiagnosticSummary({ ...details, yaohuoActivity }, parsed);
}

async function activityFromProfile(profile: YaohuoUserDetails, options: UserReadOptions) {
  return profile.yaohuoActivity ?? (await getYaohuoUserDetails(profile.id, profile.username, options)).yaohuoActivity;
}

export async function getYaohuoUserTopics(
  profile: YaohuoUserDetails,
  options: UserReadOptions
): Promise<UserTopicsPage> {
  const matchesActivity = (url: URL) => isYaohuoUserTopicListUrl(url, profile.id);
  const topics: Topic[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const evidence: unknown[] = [];
  let scan: YaohuoUserTopicScan = options.cursor
    ? { kind: 'reading', url: options.cursor, read: 0 }
    : { kind: 'discovering' };
  if (scan.kind === 'discovering') {
    const activity = await activityFromProfile(profile, options);
    if (activity.inlineTopics) return activity.inlineTopics;
    if (!activity.topicsUrl) throw new Error('妖火资料页未提供可确认的主题入口');
    scan = { kind: 'reading', url: activity.topicsUrl, read: 0 };
  }
  while (scan.kind === 'reading') {
    if (visited.has(scan.url)) {
      scan = { kind: 'cycle', nextUrl: scan.url };
      break;
    }
    visited.add(scan.url);
    const page = await readHtml(scan.url, options, matchesActivity);
    const pageNumber = yaohuoUserActivityPage(new URL(page.url))?.page ?? 1;
    const result = parseYaohuoListDocument(page.root, page.html, {
      classId: '0',
      limit: 30,
      page: pageNumber,
      url: page.url
    });
    evidence.push(result);
    for (const topic of result.items) {
      if (seen.has(topic.id)) continue;
      seen.add(topic.id);
      topics.push(topic.author ? topic : { ...topic, author: profile.displayName || profile.username });
    }
    const nextUrl = yaohuoUserTopicNextPageUrlFromRoot(page.root, page.url, profile.id, result.items.length, 30);
    const read: number = scan.read + 1;
    scan =
      nextUrl && topics.length < 30 && read < (options.cursor ? 1 : 10)
        ? { kind: 'reading', url: nextUrl, read }
        : { kind: 'ready', nextUrl };
  }
  return mergeSourceDiagnosticSummaries(
    {
      topics: sortTopicsByCreatedAt(topics),
      hasMoreTopics: Boolean(scan.nextUrl),
      nextTopicsCursor: scan.nextUrl || null
    },
    'html-user',
    evidence,
    { hasRepeatedCursor: scan.kind === 'cycle' }
  );
}

export async function getYaohuoUserReplies(
  profile: YaohuoUserDetails,
  options: UserReadOptions
): Promise<UserRepliesPage> {
  const matchesActivity = (url: URL) => isYaohuoUserReplyListUrl(url, profile.id);
  let url = options.cursor || '';
  if (!url) {
    const activity = await activityFromProfile(profile, options);
    url = activity.repliesUrl;
    if (!url) {
      if (!activity.emptyReplies) throw new Error('妖火资料页未提供可确认的回复入口');
      return { replies: [], hasMoreReplies: false, nextRepliesCursor: null };
    }
  }
  const page = await readHtml(url, options, matchesActivity);
  const replies = parseYaohuoUserRepliesDocument(page.root, {
    id: profile.id,
    username: profile.displayName || profile.username
  });
  const nextUrl = yaohuoUserReplyNextPageUrlFromRoot(page.root, page.url, profile.id, replies.length);
  return copySourceDiagnosticSummary(
    { replies, hasMoreReplies: Boolean(nextUrl), nextRepliesCursor: nextUrl || null },
    replies
  );
}
