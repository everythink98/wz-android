import { fetchWithTimeout, type Fetcher } from '@/platform/network/request';
import type {
  CategoriesResponse,
  FeedResponse,
  Reply,
  RepliesResponse,
  ReplyLocationTarget,
  ReplyOrder,
  ReplyWindowPosition,
  Topic,
  TopicDetail,
  V2exFeedFilter
} from '@/domain/forum/models';
import {
  absoluteUrl,
  elementText,
  escapeHtmlFully,
  hasRenderableHtmlContent,
  isRecord,
  parsePositiveInteger,
  parseHtml,
  sortTopicsByTime,
  textExcerpt,
  textContentFromHtml,
  toIsoString
} from '@/domain/forum/html';
import { prepareSanitizedForumContent } from '@/domain/forum/topicContentSplit';
import {
  accessRequirementFromObject,
  accessRequirementFromNoticeText,
  accessRequirementFromText
} from '@/domain/forum/accessRequirements';
import {
  V2EX_BASE_URL as BASE_URL,
  safeV2exNodePath as safeNodePath,
  safeV2exTopicUrl as safeTopicUrl,
  v2exMemberUrl as memberUrl,
  v2exNodeIdFromHref as nodeIdFromHref
} from './protocol';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import { orientReplyWindow } from '@/sources/replyWindows';
import { findReplyLocation, matchesReplyLocation } from '@/domain/forum/replyLocation';

const HTML_LIST_PAGE_SIZE = 20;
const V2EX_FEED_CURSOR_LIMIT = 200;
const V2EX_LINKED_REPLY_PAGE_LIMIT = 100;
const V2EX_REPLY_PAGE_SIZE = 100;
const V2EX_HTML_TIMEZONE = '+08:00';

export interface V2exOptions {
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type V2exHtmlReplyMeta = {
  authorLevelLabel?: Reply['authorLevelLabel'];
  commentId?: number;
  createdAt?: string;
  floor?: number;
  replyTarget?: Reply['replyTarget'];
  thanksCount?: number;
};

type V2exHtmlDetail = {
  accessRequirement?: TopicDetail['accessRequirement'];
  linkedPages: number[];
  replyCount?: number;
  replyCountConflict: boolean;
  replyNodeCount: number;
  supplementHtml: string;
  tags: string[];
  upvoteCount?: number;
  viewCount?: number;
  replies: Reply[];
  repliesByCommentId: Map<number, V2exHtmlReplyMeta>;
  repliesByFloor: Map<number, V2exHtmlReplyMeta>;
};

const V2EX_REPLY_COLLECTION_ERROR = 'V2EX 回复总数已变化，无法确认完整集合';

function v2exLastReplyAt(raw: Record<string, unknown>, createdAt: string) {
  const touchedAt = toIsoString(raw.last_touched);
  const createdMs = Date.parse(createdAt || '');
  const touchedMs = Date.parse(touchedAt || '');
  if (!Number.isFinite(touchedMs)) {
    return createdAt;
  }
  if (!Number.isFinite(createdMs)) {
    return touchedAt;
  }
  return Number(raw.replies || 0) > 0 && touchedMs >= createdMs ? touchedAt : createdAt;
}
function toV2exHtmlIsoString(value: unknown) {
  return toIsoString(value, V2EX_HTML_TIMEZONE);
}

export function topicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

export function v2exMemberLevelLabel(member: Record<string, unknown>) {
  return member.pro === true || Number(member.pro) > 0 ? 'Pro' : undefined;
}

function normalizeApiTopic(raw: unknown): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = topicId(raw.id);
  if (!id) {
    return null;
  }
  const node = isRecord(raw.node) ? raw.node : {};
  const member = isRecord(raw.member) ? raw.member : {};
  const createdAt = toIsoString(raw.created) || new Date().toISOString();
  const lastReplyAt = v2exLastReplyAt(raw, createdAt);
  const accessRequirement = accessRequirementFromObject(raw);
  const authorLevelLabel = v2exMemberLevelLabel(member);
  return {
    source: 'v2ex',
    id,
    title: String(raw.title || ''),
    author: String(member.username || ''),
    authorAvatar: absoluteUrl(member.avatar_large || member.avatar_normal || member.avatar_mini, BASE_URL),
    authorId: typeof member.username === 'string' ? member.username : undefined,
    authorUrl: typeof member.username === 'string' ? memberUrl(member.username) : undefined,
    categoryId: typeof node.name === 'string' ? node.name : undefined,
    category: typeof node.title === 'string' ? node.title : typeof node.name === 'string' ? node.name : undefined,
    url: safeTopicUrl(id, raw.url),
    createdAt,
    lastReplyAt,
    replyCount: Number(raw.replies || 0),
    excerpt: textExcerpt(raw.content || raw.content_rendered || ''),
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

export function normalizeHtmlTopic(
  element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  fallbackCategory?: string
): Topic | null {
  const link = element.querySelector('.topic-link');
  const href = link?.getAttribute('href') || '';
  const id = href.match(/\/t\/(\d+)/)?.[1];
  const title = elementText(link);
  if (!id || !title) {
    return null;
  }
  const nodeLink = element.querySelector('a.node');
  const categoryId = nodeIdFromHref(nodeLink?.getAttribute('href')) || fallbackCategory;
  const memberLink =
    element.querySelector('.topic_info strong a[href^="/member/"]') ||
    element.querySelector('strong a[href^="/member/"]') ||
    element.querySelector('a[href^="/member/"]');
  const memberHref = memberLink?.getAttribute('href') || '';
  const memberName = elementText(memberLink);
  const avatar = element.querySelector('img.avatar')?.getAttribute('src');
  const timestamp = element.querySelector('span[title]')?.getAttribute('title');
  const replyBadge =
    element.querySelector(
      `td[align="right"] a[href*="/t/${id}#reply"].count_livid,td[align="right"] a[href*="/t/${id}#reply"].count_orange`
    ) ||
    element.querySelector('td[align="right"] .count_livid,td[align="right"] .count_orange') ||
    element.querySelector('.count_livid');
  const countText = replyBadge?.text || href.match(/#reply(\d+)/)?.[1] || '';
  const createdAt = toV2exHtmlIsoString(timestamp) || new Date().toISOString();
  const accessRequirement = accessRequirementFromText(elementText(element).replace(title, ' '));
  return {
    source: 'v2ex',
    id,
    title,
    author: memberName,
    authorAvatar: absoluteUrl(avatar, BASE_URL),
    authorId: memberName || undefined,
    authorUrl: memberHref ? absoluteUrl(memberHref, BASE_URL) : memberName ? memberUrl(memberName) : undefined,
    categoryId,
    category: elementText(nodeLink) || categoryId,
    url: `${BASE_URL}/t/${id}`,
    createdAt,
    lastReplyAt: createdAt,
    replyCount: Number.parseInt(String(countText || '0'), 10) || 0,
    excerpt: '',
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function v2exReplyTargetAuthor(value: unknown) {
  const text = String(value || '')
    .replace(/^<p>/i, '')
    .replace(/<\/p>$/i, '')
    .trim();
  const linked = text.match(/^@<a\b[^>]*href=["']\/member\/([^"']+)["'][^>]*>/i);
  if (linked) {
    try {
      return decodeURIComponent(linked[1]);
    } catch {
      return undefined;
    }
  }
  const plain = text.match(/^@([A-Za-z0-9_-]{1,32})\b/);
  return plain ? plain[1] : undefined;
}

function parseV2exThanksCount(value: unknown) {
  const raw = String(value || '');
  const text = textContentFromHtml(raw);
  const hasThanksText = /(thanks?|感谢|谢)/i.test(text);
  const hasHeartIcon = /(?:^|[/_-])heart/i.test(raw);
  if (!hasThanksText && !hasHeartIcon) {
    return undefined;
  }
  const count = parsePositiveInteger(text);
  return count > 0 ? count : undefined;
}

function interactionTypeName(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    return String(value['@id'] || value.name || value.url || '');
  }
  return '';
}

function v2exStructuredCount(value: unknown) {
  const count =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value.trim())
        ? Number(value.replace(/,/g, ''))
        : NaN;
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function statCountByInteraction(data: unknown, pattern: RegExp) {
  if (!isRecord(data)) {
    return undefined;
  }
  const rawStats = data.interactionStatistic;
  const stats = Array.isArray(rawStats) ? rawStats : rawStats ? [rawStats] : [];
  for (const stat of stats) {
    if (!isRecord(stat) || !pattern.test(interactionTypeName(stat.interactionType))) {
      continue;
    }
    const count = v2exStructuredCount(stat.userInteractionCount);
    if (typeof count === 'number') {
      return count;
    }
  }
  return undefined;
}

function commentCountFromStructuredData(data: unknown): number | undefined {
  if (Array.isArray(data)) {
    for (const item of data) {
      const count = commentCountFromStructuredData(item);
      if (typeof count === 'number') return count;
    }
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  const count = v2exStructuredCount(data.commentCount);
  if (typeof count === 'number') return count;
  return commentCountFromStructuredData(data['@graph']);
}

function parseV2exCommentCount(root: ReturnType<typeof parseHtml>) {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const count = commentCountFromStructuredData(JSON.parse(script.text));
      if (typeof count === 'number') return count;
    } catch {
      // Ignore unrelated structured data.
    }
  }
  return undefined;
}

function parseV2exInteractionCount(root: ReturnType<typeof parseHtml>, pattern: RegExp) {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.text);
      const count = statCountByInteraction(parsed, pattern);
      if (typeof count === 'number') {
        return count;
      }
    } catch {
      // Ignore unrelated structured data.
    }
  }
  return undefined;
}

function parseV2exTopicUpvoteCount(root: ReturnType<typeof parseHtml>) {
  const voteBox = root
    .querySelectorAll('[id^="topic_"]')
    .find((element) => /^topic_\d+_votes$/.test(String(element.getAttribute('id') || '')));
  const upvoteLink = voteBox
    ?.querySelectorAll('a')
    .find((element) => /upVoteTopic/i.test(String(element.getAttribute('onclick') || '')));
  return upvoteLink ? parsePositiveInteger(elementText(upvoteLink)) : undefined;
}

function parseV2exTags(root: ReturnType<typeof parseHtml>) {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const element of root.querySelectorAll('a.tag')) {
    const tag = elementText(element);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function parseV2exSupplements(root: ReturnType<typeof parseHtml>) {
  const mainSupplements = root.querySelectorAll('#Main .subtle');
  const supplements = mainSupplements.length ? mainSupplements : root.querySelectorAll('.subtle');
  return supplements
    .map((element, index) => {
      const content = element.querySelector('.topic_content')?.innerHTML || '';
      if (!content.trim()) {
        return '';
      }
      const titleTime = element.querySelector('.fade span[title]')?.getAttribute('title') || '';
      const displayTime = titleTime ? toV2exHtmlIsoString(titleTime) || titleTime : '';
      const label = `补充 ${index + 1}${displayTime ? ` · ${displayTime}` : ''}`;
      return `<blockquote><p><strong>${escapeHtmlFully(label)}</strong></p>${content}</blockquote>`;
    })
    .filter(Boolean)
    .join('\n');
}

function shouldKeepV2exReply(commentId: number | undefined, author: string, contentHtml: string) {
  return Boolean(commentId || author || hasRenderableHtmlContent(contentHtml));
}

function parseV2exReplyMeta(root: ReturnType<typeof parseHtml>, id: string) {
  const repliesByCommentId = new Map<number, V2exHtmlReplyMeta>();
  const repliesByFloor = new Map<number, V2exHtmlReplyMeta>();
  const replies: Reply[] = [];
  const replyNodes = root.querySelectorAll('[id^="r_"]');
  for (const element of replyNodes) {
    const commentId = parsePositiveInteger(String(element.getAttribute('id') || '').replace(/^r_/, ''));
    const floor = parsePositiveInteger(element.querySelector('.no')?.text);
    const createdAt = toV2exHtmlIsoString(element.querySelector('.ago')?.getAttribute('title'));
    const replyContent = element.querySelector('.reply_content')?.innerHTML || '';
    const thanksCount = element
      .querySelectorAll('.small')
      .map((item) => parseV2exThanksCount(item.innerHTML || item.text))
      .find((count): count is number => typeof count === 'number');
    const replyTargetAuthor = v2exReplyTargetAuthor(replyContent);
    const replyTarget = replyTargetAuthor
      ? { author: { name: replyTargetAuthor, username: replyTargetAuthor } }
      : undefined;
    const authorLevelLabel = element.querySelector('.badge.pro') ? 'Pro' : undefined;
    const meta: V2exHtmlReplyMeta = {
      ...(authorLevelLabel ? { authorLevelLabel } : {}),
      ...(commentId ? { commentId } : {}),
      ...(floor ? { floor } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(thanksCount ? { thanksCount } : {}),
      ...(replyTarget ? { replyTarget } : {})
    };
    if (commentId) {
      repliesByCommentId.set(commentId, meta);
    }
    if (floor) {
      repliesByFloor.set(floor, meta);
    }
    const authorLink =
      element.querySelector('strong a[href^="/member/"]') ||
      element.querySelector('a.dark[href^="/member/"]') ||
      element.querySelector('a[href^="/member/"]');
    const author = elementText(authorLink);
    const authorHref = authorLink?.getAttribute('href') || '';
    const preparedContent = prepareSanitizedForumContent(replyContent, {
      baseUrl: BASE_URL,
      role: 'reply',
      source: 'v2ex',
      topicId: id
    });
    const contentHtml = preparedContent.contentHtml;
    const reply: Reply | null = shouldKeepV2exReply(commentId, author, contentHtml)
      ? {
          author,
          authorId: author || undefined,
          authorAvatar: absoluteUrl(element.querySelector('img.avatar')?.getAttribute('src'), BASE_URL),
          authorUrl: authorHref ? absoluteUrl(authorHref, BASE_URL) : author ? memberUrl(author) : undefined,
          contentHtml,
          preparedContent,
          createdAt,
          ...(authorLevelLabel ? { authorLevelLabel } : {}),
          ...(floor ? { floor } : {}),
          ...(commentId ? { commentId } : {}),
          ...(replyTarget ? { replyTarget } : {}),
          ...(typeof thanksCount === 'number' ? { thanksCount } : {})
        }
      : null;
    if (reply) {
      replies.push(reply);
    }
  }
  return { replyNodeCount: replyNodes.length, replies, repliesByCommentId, repliesByFloor };
}

function parseV2exLinkedTopicPages(root: ReturnType<typeof parseHtml>, id: string) {
  const linkedPages = new Set<number>();
  const expectedOrigin = new URL(BASE_URL).origin;
  const expectedPath = `/t/${encodeURIComponent(id)}`;
  const topicPageUrl = `${BASE_URL}${expectedPath}`;
  for (const link of root.querySelectorAll('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href') || '', topicPageUrl);
      const pageValues = url.searchParams.getAll('p');
      if (url.origin !== expectedOrigin || url.pathname !== expectedPath || pageValues.length !== 1) {
        continue;
      }
      const pageText = pageValues[0].trim();
      const page = /^\d+$/.test(pageText) ? Number(pageText) : NaN;
      if (Number.isSafeInteger(page) && page > 0) {
        linkedPages.add(page);
      }
    } catch {
      // Ignore malformed and non-HTTP links.
    }
  }
  return [...linkedPages].sort((left, right) => left - right);
}

function parseV2exHtmlDetail(html: string, id: string): V2exHtmlDetail {
  const root = parseHtml(html);
  const replyMeta = parseV2exReplyMeta(root, id);
  const replyActionCount = parseV2exInteractionCount(root, /ReplyAction/i);
  const commentCount = parseV2exCommentCount(root);
  return {
    accessRequirement: v2exHtmlAccessRequirement(root),
    linkedPages: parseV2exLinkedTopicPages(root, id),
    replyCount: replyActionCount ?? commentCount,
    replyCountConflict:
      typeof replyActionCount === 'number' && typeof commentCount === 'number' && replyActionCount !== commentCount,
    replyNodeCount: replyMeta.replyNodeCount,
    supplementHtml: parseV2exSupplements(root),
    tags: parseV2exTags(root),
    upvoteCount: parseV2exTopicUpvoteCount(root),
    viewCount: parseV2exInteractionCount(root, /ViewAction/i),
    replies: replyMeta.replies,
    repliesByCommentId: replyMeta.repliesByCommentId,
    repliesByFloor: replyMeta.repliesByFloor
  };
}

function uniqueV2exReplies(replies: readonly Reply[], target?: ReplyLocationTarget) {
  const seenCommentIds = new Map<number, number>();
  const seenFallbackFloors = new Map<number, number>();
  const identity = target && { ...target, expectedAuthorUsername: undefined };
  const ambiguousFloors = new Set<number>();
  const unique: Reply[] = [];
  for (const reply of replies) {
    const previousIndex = reply.commentId
      ? seenCommentIds.get(reply.commentId)
      : seenFallbackFloors.get(reply.floor || 0);
    if (previousIndex !== undefined) {
      const previous = unique[previousIndex];
      if (
        previous.replyLocationConflict === 'identity' ||
        reply.replyLocationConflict === 'identity' ||
        previous.floor !== reply.floor ||
        (previous.authorId || previous.author).toLowerCase() !== (reply.authorId || reply.author).toLowerCase()
      ) {
        if (identity && (matchesReplyLocation(previous, identity) || matchesReplyLocation(reply, identity))) {
          throw new Error('V2EX 目标楼层身份冲突');
        }
        if (previous.floor !== undefined) ambiguousFloors.add(previous.floor);
        if (reply.floor !== undefined) ambiguousFloors.add(reply.floor);
        if (previous.replyLocationConflict !== 'identity')
          unique[previousIndex] = { ...previous, replyLocationConflict: 'identity' };
      } else if (reply.replyLocationConflict === 'floor' && !previous.replyLocationConflict) {
        unique[previousIndex] = { ...previous, replyLocationConflict: 'floor' };
      }
      continue;
    }
    if (reply.commentId) {
      seenCommentIds.set(reply.commentId, unique.length);
    } else if (reply.floor) {
      seenFallbackFloors.set(reply.floor, unique.length);
    }
    unique.push(reply);
  }
  if (!ambiguousFloors.size) return unique;
  return unique.map((reply) =>
    reply.floor !== undefined && ambiguousFloors.has(reply.floor) && !reply.replyLocationConflict
      ? { ...reply, replyLocationConflict: 'floor' as const }
      : reply
  );
}

function visibleV2exHtmlReplies(detail: V2exHtmlDetail | null, target?: ReplyLocationTarget) {
  return uniqueV2exReplies(detail?.replies || [], target);
}

function visibleV2exHtmlReplyPage(detail: V2exHtmlDetail | null, page: number, target?: ReplyLocationTarget) {
  const firstFloor = (page - 1) * V2EX_REPLY_PAGE_SIZE + 1;
  const lastFloor = page * V2EX_REPLY_PAGE_SIZE;
  return visibleV2exHtmlReplies(detail, target).filter(
    (reply) => !reply.floor || (reply.floor >= firstFloor && reply.floor <= lastFloor)
  );
}

function credibleV2exReplyCount(count: number | undefined, replies: readonly Reply[], hasLaterPage = false) {
  const highestFloor = Math.max(0, ...replies.map((reply) => reply.floor || 0));
  return typeof count === 'number' &&
    count >= replies.length &&
    count >= highestFloor &&
    (!hasLaterPage || count > highestFloor)
    ? count
    : undefined;
}

function isCompleteV2exReplyCollection(replies: Reply[], candidateCount: number, totalCount: number) {
  return (
    candidateCount === replies.length &&
    replies.length === totalCount &&
    replies.every((reply, index) => reply.floor === index + 1)
  );
}

function v2exReplyPageIsComplete(
  detail: V2exHtmlDetail,
  replies: readonly Reply[],
  currentPage: number,
  knownReplyCount?: number
) {
  const declaredCount = detail.replyCount ?? knownReplyCount;
  const hasLaterPage = detail.linkedPages.some((page) => page > currentPage);
  const expectedFirstFloor = (currentPage - 1) * V2EX_REPLY_PAGE_SIZE + 1;
  const expectedLastFloor =
    typeof declaredCount === 'number'
      ? Math.min(currentPage * V2EX_REPLY_PAGE_SIZE, declaredCount)
      : hasLaterPage
        ? currentPage * V2EX_REPLY_PAGE_SIZE
        : undefined;
  const countAgrees =
    (typeof declaredCount === 'number' || hasLaterPage) &&
    !detail.replyCountConflict &&
    (typeof detail.replyCount !== 'number' ||
      typeof knownReplyCount !== 'number' ||
      detail.replyCount === knownReplyCount) &&
    (typeof declaredCount !== 'number' || !hasLaterPage || currentPage * V2EX_REPLY_PAGE_SIZE < declaredCount) &&
    (typeof declaredCount !== 'number' || declaredCount <= currentPage * V2EX_REPLY_PAGE_SIZE || hasLaterPage);
  return (
    countAgrees &&
    detail.replyNodeCount === replies.length &&
    (replies.length === 0
      ? (detail.replyCount ?? knownReplyCount) === 0
      : typeof expectedLastFloor === 'number' &&
        replies.length === expectedLastFloor - expectedFirstFloor + 1 &&
        replies.every((reply, index) => reply.floor === expectedFirstFloor + index))
  );
}

function v2exReplyPageNeighbors(detail: V2exHtmlDetail, currentPage: number) {
  const linkedPages = detail.linkedPages.filter((page) => page !== currentPage);
  return {
    previousPage: linkedPages.filter((page) => page < currentPage).at(-1) ?? null,
    nextPage: linkedPages.find((page) => page > currentPage) ?? null
  };
}

function v2exHtmlAccessRequirement(root: ReturnType<typeof parseHtml>) {
  const text = elementText(root.querySelector('#Main')) || elementText(root.querySelector('body'));
  return accessRequirementFromNoticeText(text, { requireStart: true });
}

function appendV2exSupplementHtml(contentHtml: string, supplementHtml: string) {
  return [contentHtml, supplementHtml].filter((part) => String(part || '').trim()).join('\n');
}

function decodeV2exFeedSeenIds(cursor?: string | null) {
  if (!cursor) {
    return new Set<string>();
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(cursor)) as { seenIds?: unknown };
    return new Set(
      Array.isArray(parsed.seenIds) ? parsed.seenIds.map((item) => String(item || '').trim()).filter(Boolean) : []
    );
  } catch {
    return new Set<string>();
  }
}

function encodeV2exFeedSeenIds(previous: Set<string>, items: Topic[]) {
  const seenIds = new Set(previous);
  for (const item of items) {
    seenIds.add(item.id);
  }
  return encodeURIComponent(JSON.stringify({ seenIds: Array.from(seenIds).slice(-V2EX_FEED_CURSOR_LIMIT) }));
}

function v2exHtmlWindowStart(options: { page: number; limit: number; category?: string }) {
  if (options.category || options.page <= 1) {
    return (options.page - 1) * options.limit;
  }
  return Math.min(options.limit, HTML_LIST_PAGE_SIZE) + (options.page - 2) * options.limit;
}

function parseV2exAllTabPage(html: string, limit: number) {
  const root = parseHtml(html);
  const items = root
    .querySelectorAll('.cell.item')
    .map((element) => normalizeHtmlTopic(element))
    .filter(Boolean) as Topic[];
  const hasRecentLink = root.querySelectorAll('a[href]').some((link) => {
    try {
      return new URL(link.getAttribute('href') || '', BASE_URL).pathname === '/recent';
    } catch {
      return false;
    }
  });
  return {
    items: items.slice(0, limit),
    hasMore: items.length > limit || hasRecentLink,
    nextPage: items.length > limit || hasRecentLink ? 2 : null
  };
}

function parseV2exListPage(html: string, page: number, path: string, fallbackCategory?: string) {
  const root = parseHtml(html);
  const items = root
    .querySelectorAll('.cell')
    .map((element) => normalizeHtmlTopic(element, fallbackCategory))
    .filter(Boolean) as Topic[];
  const hasMore = root.querySelectorAll('a[href]').some((link) => {
    try {
      const url = new URL(link.getAttribute('href') || '', BASE_URL);
      return url.pathname === path && Number(url.searchParams.get('p') || '1') > page;
    } catch {
      return false;
    }
  });
  return { items, hasMore };
}

export async function fetchJson<T>(url: string, options: V2exOptions = {}) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: { Accept: 'application/json,text/plain,*/*', Referer: BASE_URL }
    },
    options
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return data as T;
}

export async function fetchText(url: string, options: V2exOptions = {}) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*', Referer: BASE_URL }
    },
    options
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return text;
}

async function loadLatest(options: V2exOptions = {}) {
  const data = await fetchJson<unknown[]>(`${BASE_URL}/api/topics/latest.json`, options);
  return Array.isArray(data) ? data : [];
}

async function fetchHtmlWindow(
  options: V2exOptions & {
    page: number;
    limit: number;
    category?: string;
    seenIds?: Set<string>;
  }
) {
  const path = safeNodePath(options.category);
  if (!path) {
    return null;
  }
  if (!options.category && options.seenIds?.size) {
    const collected: Topic[] = [];
    let htmlPage = 1;
    let lastHasMore = false;
    while (collected.length < options.limit) {
      const html = await fetchText(`${BASE_URL}${path}?p=${htmlPage}`, options);
      const pageResult = parseV2exListPage(html, htmlPage, path, options.category);
      collected.push(...pageResult.items.filter((item) => !options.seenIds?.has(item.id)));
      lastHasMore = pageResult.hasMore;
      if (!pageResult.hasMore || pageResult.items.length === 0) {
        break;
      }
      htmlPage += 1;
    }
    const items = collected.slice(0, options.limit);
    const hasMore = items.length === options.limit && (collected.length > options.limit || lastHasMore);
    return { items, hasMore, nextPage: hasMore ? options.page + 1 : null };
  }
  const start = v2exHtmlWindowStart(options);
  const firstHtmlPage = Math.floor(start / HTML_LIST_PAGE_SIZE) + 1;
  const skip = start % HTML_LIST_PAGE_SIZE;
  const needed = skip + options.limit;
  const collected: Topic[] = [];
  let htmlPage = firstHtmlPage;
  let lastHasMore = false;
  while (collected.length < needed) {
    const html = await fetchText(`${BASE_URL}${path}?p=${htmlPage}`, options);
    const pageResult = parseV2exListPage(html, htmlPage, path, options.category);
    collected.push(...pageResult.items);
    lastHasMore = pageResult.hasMore;
    if (!pageResult.hasMore || pageResult.items.length === 0) {
      break;
    }
    htmlPage += 1;
  }
  const items = collected.slice(skip, skip + options.limit);
  const hasMore = items.length === options.limit && (collected.length > skip + options.limit || lastHasMore);
  return { items, hasMore, nextPage: hasMore ? options.page + 1 : null };
}

export async function getV2exFeed(
  options: V2exOptions & {
    page?: number;
    limit?: number;
    category?: string;
    feedFilter?: V2exFeedFilter;
  } = {}
): Promise<FeedResponse> {
  const page = options.page || 1;
  const limit = options.limit || 30;
  const feedFilter = options.category ? 'all' : options.feedFilter || 'all';
  const seenIds = decodeV2exFeedSeenIds(options.cursor);
  if (!options.category && feedFilter === 'hot') {
    const html = await fetchText(`${BASE_URL}/?tab=hot`, options);
    const items = parseV2exAllTabPage(html, limit).items;
    const candidateCount = (html.match(/class=["'][^"']*\bitem\b/gi) || []).length;
    return annotateSourceDiagnosticSummary(
      { items, errors: {}, hasMore: false, nextPage: null },
      {
        parserVariant: 'html-hot-feed',
        candidateCount,
        validCount: items.length,
        droppedCount: Math.max(0, candidateCount - items.length),
        isParseEmpty: candidateCount === 0
      }
    );
  }
  if (!options.category && feedFilter === 'latest') {
    const html = await fetchText(`${BASE_URL}/recent?p=${page}`, options);
    const pageResult = parseV2exListPage(html, page, '/recent');
    const result = {
      items: pageResult.items.slice(0, limit),
      errors: {},
      hasMore: pageResult.hasMore,
      nextPage: pageResult.hasMore ? page + 1 : null
    };
    const candidateCount = (html.match(/class=["'][^"']*\bitem\b/gi) || []).length;
    return annotateSourceDiagnosticSummary(result, {
      parserVariant: 'html-latest-feed',
      candidateCount,
      validCount: result.items.length,
      droppedCount: Math.max(0, candidateCount - result.items.length),
      isExpectedEmpty: page > 1 && candidateCount === 0,
      isParseEmpty: page === 1 && candidateCount === 0,
      hasRepeatedCursor: result.nextPage === page
    });
  }
  if (!options.category && page === 1) {
    const html = await fetchText(`${BASE_URL}/?tab=all`, options);
    const result = parseV2exAllTabPage(html, limit);
    const response = {
      ...result,
      nextCursor: result.hasMore ? encodeV2exFeedSeenIds(seenIds, result.items) : null,
      errors: {}
    };
    const candidateCount = (html.match(/class=["'][^"']*\bitem\b/gi) || []).length;
    return annotateSourceDiagnosticSummary(response, {
      parserVariant: 'html-all-feed',
      candidateCount,
      validCount: response.items.length,
      droppedCount: Math.max(0, candidateCount - response.items.length),
      isParseEmpty: candidateCount === 0,
      hasRepeatedCursor: response.nextCursor === options.cursor
    });
  }
  if (options.category || page > 1) {
    const htmlResult = await fetchHtmlWindow({ ...options, page, limit, seenIds });
    if (htmlResult) {
      const result = {
        ...htmlResult,
        nextPage: htmlResult.hasMore ? htmlResult.nextPage : null,
        nextCursor: htmlResult.hasMore ? encodeV2exFeedSeenIds(seenIds, htmlResult.items) : null,
        errors: {}
      };
      return annotateSourceDiagnosticSummary(result, {
        parserVariant: 'html-window-feed',
        candidateCount: result.items.length,
        validCount: result.items.length,
        droppedCount: 0,
        isExpectedEmpty: result.items.length === 0 && (page > 1 || Boolean(options.category)),
        hasRepeatedCursor: result.nextCursor === options.cursor
      });
    }
  }
  const data = await loadLatest(options);
  const items = data.map(normalizeApiTopic).filter(Boolean) as Topic[];
  const filtered = options.category
    ? items.filter((topic) => topic.categoryId === options.category || topic.category === options.category)
    : items;
  const start = (page - 1) * limit;
  let pageItems = filtered.slice(start, start + limit);
  let hasMore = filtered.length >= start + limit;
  let partialErrorCount = 0;
  if (!options.category && page === 1 && pageItems.length < limit) {
    let htmlResult: Awaited<ReturnType<typeof fetchHtmlWindow>> = null;
    try {
      htmlResult = await fetchHtmlWindow({ ...options, page, limit });
    } catch {
      partialErrorCount += 1;
    }
    if (htmlResult) {
      const seen = new Set(pageItems.map((topic) => topic.id));
      const merged = [...pageItems];
      for (const topic of htmlResult.items) {
        if (!seen.has(topic.id)) {
          seen.add(topic.id);
          merged.push(topic);
        }
      }
      pageItems = sortTopicsByTime(merged).slice(0, limit);
      hasMore = hasMore || htmlResult.hasMore || merged.length > limit;
    }
  }
  const result = {
    items: pageItems,
    errors: {},
    hasMore,
    nextPage: hasMore ? page + 1 : null
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'api-latest-feed',
    candidateCount: pageItems.length,
    validCount: pageItems.length,
    droppedCount: 0,
    partialErrorCount,
    isExpectedEmpty: pageItems.length === 0 && (page > 1 || Boolean(options.category)),
    isParseEmpty: page === 1 && !options.category && pageItems.length === 0,
    hasRepeatedCursor: result.nextPage === page
  });
}

export async function getV2exCategories(options: V2exOptions = {}): Promise<CategoriesResponse> {
  const data = await loadLatest(options);
  const seen = new Set<string>();
  const items = data
    .map((topic) => {
      if (!isRecord(topic) || !isRecord(topic.node)) {
        return null;
      }
      const id = String(topic.node.name || topic.node.title || '').trim();
      const name = String(topic.node.title || topic.node.name || '').trim();
      return id && name ? { source: 'v2ex' as const, id, name } : null;
    })
    .filter((item): item is { source: 'v2ex'; id: string; name: string } => {
      if (!item || seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  return annotateSourceDiagnosticSummary(
    { items, errors: {} },
    {
      parserVariant: 'api-categories',
      candidateCount: data.length,
      validCount: items.length,
      droppedCount: Math.max(0, data.length - items.length),
      isParseEmpty: data.length === 0
    }
  );
}

function normalizeReply(raw: unknown, index: number, topicId: string): Reply | null {
  if (!isRecord(raw)) {
    return null;
  }
  const member = isRecord(raw.member) ? raw.member : {};
  const author = String(member.username || '').trim();
  const preparedContent = prepareSanitizedForumContent(raw.content_rendered || raw.content || '', {
    baseUrl: BASE_URL,
    role: 'reply',
    source: 'v2ex',
    topicId
  });
  const contentHtml = preparedContent.contentHtml;
  const commentId = typeof raw.id === 'number' ? raw.id : parsePositiveInteger(raw.id);
  if (!shouldKeepV2exReply(commentId, author, contentHtml)) return null;
  const replyTargetAuthor = v2exReplyTargetAuthor(raw.content_rendered || raw.content || contentHtml);
  const replyTarget = replyTargetAuthor
    ? { author: { name: replyTargetAuthor, username: replyTargetAuthor } }
    : undefined;
  const authorLevelLabel = v2exMemberLevelLabel(member);
  return {
    author,
    authorId: typeof member.username === 'string' ? member.username : undefined,
    authorAvatar: absoluteUrl(member.avatar_large || member.avatar_normal || member.avatar_mini, BASE_URL),
    authorUrl: typeof member.username === 'string' ? memberUrl(member.username) : undefined,
    contentHtml,
    preparedContent,
    createdAt: toIsoString(raw.created),
    floor: index + 1,
    ...(commentId ? { commentId } : {}),
    ...(authorLevelLabel ? { authorLevelLabel } : {}),
    ...(replyTarget ? { replyTarget } : {})
  };
}

function mergeV2exReplyMeta(replies: Reply[], detail: V2exHtmlDetail | null) {
  if (!detail) {
    return replies;
  }
  return replies.map((reply, index) => {
    const meta =
      (reply.commentId ? detail.repliesByCommentId.get(reply.commentId) : undefined) ||
      detail.repliesByFloor.get(reply.floor || index + 1);
    if (!meta) {
      return reply;
    }
    return {
      ...reply,
      ...(meta.authorLevelLabel && !reply.authorLevelLabel ? { authorLevelLabel: meta.authorLevelLabel } : {}),
      ...(meta.createdAt ? { createdAt: meta.createdAt } : {}),
      ...(meta.floor ? { floor: meta.floor } : {}),
      ...(meta.replyTarget && !reply.replyTarget ? { replyTarget: meta.replyTarget } : {}),
      ...(typeof meta.thanksCount === 'number' ? { thanksCount: meta.thanksCount } : {})
    };
  });
}

export async function getV2exTopic(
  id: string,
  options: V2exOptions & { replyLimit?: number } = {}
): Promise<TopicDetail> {
  let detailHtmlFailed = false;
  const [topicData, detailHtml] = await Promise.all([
    fetchJson<unknown[]>(`${BASE_URL}/api/topics/show.json?id=${encodeURIComponent(id)}`, options),
    fetchText(`${BASE_URL}/t/${encodeURIComponent(id)}`, options).catch(() => {
      detailHtmlFailed = true;
      return '';
    })
  ]);
  const topic = normalizeApiTopic(Array.isArray(topicData) ? topicData[0] : null);
  if (!topic) {
    throw new Error('V2EX 主题不存在');
  }
  const rawTopic = Array.isArray(topicData) && isRecord(topicData[0]) ? topicData[0] : {};
  const htmlDetail = detailHtml ? parseV2exHtmlDetail(detailHtml, id) : null;
  const preparedContent = prepareSanitizedForumContent(
    appendV2exSupplementHtml(
      String(rawTopic.content_rendered || rawTopic.content || ''),
      htmlDetail?.supplementHtml || ''
    ),
    { baseUrl: BASE_URL, role: 'opening', source: 'v2ex', topicId: id }
  );
  const htmlAccessRequirement = !textContentFromHtml(preparedContent.contentHtml)
    ? htmlDetail?.accessRequirement
    : undefined;
  const replies = visibleV2exHtmlReplyPage(htmlDetail, 1);
  const htmlReplyCount = htmlDetail?.replyCountConflict ? undefined : htmlDetail?.replyCount;
  const htmlReplyNodeCount = htmlDetail?.replyNodeCount || 0;
  const replyNextPage = htmlDetail?.linkedPages.find((page) => page > 1) ?? null;
  const replyCount = credibleV2exReplyCount(htmlReplyCount ?? topic.replyCount, replies, replyNextPage !== null);
  const replyWindowComplete = Boolean(
    htmlDetail &&
    v2exReplyPageIsComplete(htmlDetail, replies, 1, replyCount) &&
    (replies.length > 0 || replyCount === 0)
  );
  const parserVariant = replyWindowComplete
    ? typeof htmlReplyCount === 'number'
      ? 'html-topic'
      : 'html-topic-fallback'
    : 'html-topic-partial';
  const result = {
    ...topic,
    mediaReferrer: { documentUrl: topic.url },
    ...(typeof htmlDetail?.upvoteCount === 'number' ? { upvoteCount: htmlDetail.upvoteCount } : {}),
    ...(htmlDetail?.viewCount ? { viewCount: htmlDetail.viewCount } : {}),
    ...(htmlDetail?.tags.length ? { tags: htmlDetail.tags } : {}),
    replyCount,
    replyCompleteness: replyWindowComplete ? ('complete' as const) : ('partial' as const),
    contentHtml: preparedContent.contentHtml,
    preparedContent,
    replies,
    replyHasMore: replyNextPage !== null,
    replyNextPage,
    ...(!topic.accessRequirement && htmlAccessRequirement ? { accessRequirement: htmlAccessRequirement } : {})
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant,
    candidateCount: 1 + htmlReplyNodeCount,
    validCount: 1 + replies.length,
    droppedCount: Math.max(0, htmlReplyNodeCount - replies.length),
    partialErrorCount: Number(detailHtmlFailed)
  });
}

export async function getV2exReplies(
  id: string,
  options: V2exOptions & {
    order?: ReplyOrder;
    position?: ReplyWindowPosition;
    replyCount?: number;
  } = {}
): Promise<RepliesResponse> {
  const order = options.order || 'oldest';
  const position = options.position || ({ kind: 'start' } as const);
  const readHtmlPage = async (page: number) =>
    parseV2exHtmlDetail(
      await fetchText(
        page === 1 ? `${BASE_URL}/t/${encodeURIComponent(id)}` : `${BASE_URL}/t/${encodeURIComponent(id)}?p=${page}`,
        options
      ),
      id
    );
  const replyWindow = (
    detail: V2exHtmlDetail,
    currentPage: number,
    knownReplyCount = options.replyCount,
    knownPages: readonly number[] = []
  ) => {
    const replies = visibleV2exHtmlReplyPage(
      detail,
      currentPage,
      position.kind === 'target' ? position.target : undefined
    );
    const declaredTotalCount =
      detail.replyCountConflict ||
      (typeof detail.replyCount === 'number' &&
        typeof knownReplyCount === 'number' &&
        detail.replyCount !== knownReplyCount)
        ? knownReplyCount
        : (detail.replyCount ?? knownReplyCount);
    const complete = v2exReplyPageIsComplete(detail, replies, currentPage, knownReplyCount);
    const navigationDetail = {
      ...detail,
      linkedPages: [...new Set([...detail.linkedPages, ...knownPages])].sort((left, right) => left - right)
    };
    const { previousPage, nextPage } = v2exReplyPageNeighbors(navigationDetail, currentPage);
    const totalCount = credibleV2exReplyCount(declaredTotalCount, replies, nextPage !== null);
    return orientReplyWindow(
      annotateSourceDiagnosticSummary(
        {
          items: replies,
          completeness: complete ? ('complete' as const) : ('partial' as const),
          currentPage,
          currentOffset: currentPage === 1 ? 0 : null,
          previousPage,
          previousOffset: null,
          hasMore: nextPage !== null,
          nextPage,
          nextOffset: null,
          totalCount
        },
        {
          parserVariant: complete ? 'html-topic' : 'html-topic-partial',
          candidateCount: detail.replyNodeCount,
          validCount: replies.length,
          droppedCount: Math.max(0, detail.replyNodeCount - replies.length),
          isExpectedEmpty: complete && totalCount === 0
        }
      ),
      order
    );
  };

  if (position.kind === 'cursor') {
    if (!Number.isSafeInteger(position.page) || position.page <= 0) {
      throw new Error('V2EX 回复页码不正确');
    }
    const detail = await readHtmlPage(position.page);
    const result = replyWindow(detail, position.page);
    if (!result.items.length && result.totalCount !== 0) throw new Error(V2EX_REPLY_COLLECTION_ERROR);
    return result;
  }

  let detailHtmlFailed = false;
  let detail: V2exHtmlDetail | null = null;
  try {
    detail = await readHtmlPage(1);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    detailHtmlFailed = true;
  }
  const target = position.kind === 'target' ? position.target : undefined;
  const firstReplies = visibleV2exHtmlReplyPage(detail, 1, target);
  const firstReplyCount = detail?.replyCountConflict ? options.replyCount : (detail?.replyCount ?? options.replyCount);

  if (detail && (firstReplies.length > 0 || firstReplyCount === 0)) {
    let currentPage = 1;
    const knownPages = new Set([1, ...detail.linkedPages]);
    if (position.kind === 'target') {
      const visitedPages = new Set([1]);
      let candidates = firstReplies;
      const floorPage = position.target.floor ? Math.ceil(position.target.floor / V2EX_REPLY_PAGE_SIZE) : undefined;
      while (!findReplyLocation(candidates, position.target)) {
        if (
          candidates.some((reply) =>
            matchesReplyLocation(reply, { ...position.target, expectedAuthorUsername: undefined })
          )
        ) {
          throw new Error('V2EX 目标楼层未找到或引用不匹配');
        }
        const pendingPages = [...knownPages].filter((page) => !visitedPages.has(page));
        const nextPage =
          pendingPages.find((page) => page === position.target.pageHint) ??
          pendingPages.find((page) => page === floorPage) ??
          pendingPages.reduce((smallest, page) => Math.min(smallest, page), pendingPages[0]);
        if (!nextPage || visitedPages.size >= V2EX_LINKED_REPLY_PAGE_LIMIT) {
          throw new Error('V2EX 目标楼层未找到');
        }
        currentPage = nextPage;
        visitedPages.add(currentPage);
        detail = await readHtmlPage(currentPage);
        detail.linkedPages.forEach((page) => knownPages.add(page));
        candidates = visibleV2exHtmlReplyPage(detail, currentPage, position.target);
      }
    } else if (order === 'newest') {
      const visitedPages = new Set<number>();
      while (visitedPages.size < V2EX_LINKED_REPLY_PAGE_LIMIT) {
        visitedPages.add(currentPage);
        let nextPage = currentPage;
        for (const page of knownPages) nextPage = Math.max(nextPage, page);
        if (nextPage === currentPage) break;
        currentPage = nextPage;
        detail = await readHtmlPage(currentPage);
        detail.linkedPages.forEach((page) => knownPages.add(page));
      }
    }
    return replyWindow(detail, currentPage, firstReplyCount, [...knownPages]);
  }

  const topicData = await fetchJson<unknown[]>(
    `${BASE_URL}/api/topics/show.json?id=${encodeURIComponent(id)}`,
    options
  );
  const topic = normalizeApiTopic(Array.isArray(topicData) ? topicData[0] : null);
  if (!topic) throw new Error('V2EX 主题不存在');
  const replyData = await fetchJson<unknown[]>(
    `${BASE_URL}/api/replies/show.json?topic_id=${encodeURIComponent(id)}&page=1`,
    options
  );
  const apiRows = Array.isArray(replyData) ? replyData : [];
  const apiReplies = uniqueV2exReplies(
    mergeV2exReplyMeta(apiRows.map((raw, index) => normalizeReply(raw, index, id)).filter(Boolean) as Reply[], detail),
    target
  );
  const combinedReplies = uniqueV2exReplies([...apiReplies, ...firstReplies], target).sort(
    (left, right) => (left.floor ?? Number.MAX_SAFE_INTEGER) - (right.floor ?? Number.MAX_SAFE_INTEGER)
  );
  const replyCount = topic.replyCount || 0;
  const complete =
    combinedReplies.length === apiReplies.length &&
    isCompleteV2exReplyCollection(apiReplies, apiRows.length, replyCount);
  if (!complete && combinedReplies.length === 0) throw new Error(V2EX_REPLY_COLLECTION_ERROR);
  if (position.kind === 'target' && !findReplyLocation(combinedReplies, position.target)) {
    throw new Error('V2EX 目标楼层未找到');
  }
  const result = annotateSourceDiagnosticSummary(
    {
      items: combinedReplies,
      completeness: complete ? ('complete' as const) : ('partial' as const),
      currentPage: 1,
      currentOffset: 0,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount: credibleV2exReplyCount(replyCount, combinedReplies)
    },
    {
      parserVariant: complete ? 'api-topic-fallback' : 'api-topic-partial',
      candidateCount: Math.max(apiRows.length, detail?.replyNodeCount || 0),
      validCount: combinedReplies.length,
      droppedCount: Math.max(0, Math.max(apiRows.length, detail?.replyNodeCount || 0) - combinedReplies.length),
      partialErrorCount: Number(detailHtmlFailed),
      isExpectedEmpty: complete && replyCount === 0
    }
  );
  return orientReplyWindow(result, order);
}
