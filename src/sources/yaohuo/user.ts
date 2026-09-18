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
  requireYaohuoRequestUrl,
  yaohuoReplyListNextPageUrlFromRoot,
  yaohuoTopicListNextPageUrlFromRoot,
  yaohuoUserProfileReplyListUrlFromRoot,
  yaohuoUserProfileTopicListUrlFromRoot
} from './protocol';

type UserReadOptions = { fetcher?: Fetcher; signal?: AbortSignal; timeoutMs?: number; cursor?: string | null };

async function readHtml(url: string, options: UserReadOptions) {
  const safeUrl = requireYaohuoRequestUrl(url);
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
  return { html, root: parseHtml(html), url: resolvedUrl };
}

function profileUrl(id: string) {
  return `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(id)}&siteid=1000`;
}

export async function getYaohuoUserDetails(
  id: string,
  username: string | undefined,
  options: UserReadOptions
): Promise<UserDetails> {
  const page = await readHtml(profileUrl(id), options);
  const parsed = parseYaohuoUserProfileDocument(page.root, { id, username });
  const { topics: _topics, ...details } = parsed;
  return copySourceDiagnosticSummary(details, parsed);
}

export async function getYaohuoUserTopics(profile: UserDetails, options: UserReadOptions): Promise<UserTopicsPage> {
  const topics: Topic[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const evidence: unknown[] = [];
  let nextUrl = options.cursor || '';
  if (!nextUrl) {
    // The first activity URL is parsed from the profile; do not synthesize a remote link.
    const page = await readHtml(profileUrl(profile.id), options);
    nextUrl = yaohuoUserProfileTopicListUrlFromRoot(page.root, profile.id, page.url);
    if (!nextUrl) {
      const parsed = parseYaohuoUserProfileDocument(page.root, profile);
      if (!parsed.topics.length && parsed.topicCount !== 0) throw new Error('妖火资料页未提供可确认的主题入口');
      return copySourceDiagnosticSummary(
        { topics: parsed.topics, hasMoreTopics: false, nextTopicsCursor: null },
        parsed
      );
    }
  }
  let hasRepeatedCursor = false;
  for (let read = 0; nextUrl && topics.length < 30 && read < (options.cursor ? 1 : 10); read += 1) {
    if (visited.has(nextUrl)) {
      hasRepeatedCursor = true;
      break;
    }
    visited.add(nextUrl);
    const page = await readHtml(nextUrl, options);
    const requestedPage = Number(new URL(page.url).searchParams.get('page') || '1');
    const pageNumber = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
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
    nextUrl = yaohuoTopicListNextPageUrlFromRoot(page.root, page.url, pageNumber, result.items.length, 30);
  }
  return mergeSourceDiagnosticSummaries(
    {
      topics: sortTopicsByCreatedAt(topics),
      hasMoreTopics: Boolean(nextUrl),
      nextTopicsCursor: nextUrl || null
    },
    'html-user',
    evidence,
    { hasRepeatedCursor }
  );
}

export async function getYaohuoUserReplies(profile: UserDetails, options: UserReadOptions): Promise<UserRepliesPage> {
  let url = options.cursor || '';
  if (!url) {
    const page = await readHtml(profileUrl(profile.id), options);
    url = yaohuoUserProfileReplyListUrlFromRoot(page.root, profile.id, page.url);
    if (!url) {
      const parsed = parseYaohuoUserProfileDocument(page.root, profile);
      if (parsed.replyCount !== 0) throw new Error('妖火资料页未提供可确认的回复入口');
      return { replies: [], hasMoreReplies: false, nextRepliesCursor: null };
    }
  }
  const page = await readHtml(url, options);
  const replies = parseYaohuoUserRepliesDocument(page.root, {
    id: profile.id,
    username: profile.displayName || profile.username
  });
  const nextUrl = yaohuoReplyListNextPageUrlFromRoot(page.root, page.url, replies.length);
  return copySourceDiagnosticSummary(
    { replies, hasMoreReplies: Boolean(nextUrl), nextRepliesCursor: nextUrl || null },
    replies
  );
}
