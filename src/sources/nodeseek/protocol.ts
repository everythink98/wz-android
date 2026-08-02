import { Buffer } from 'buffer';
import type { HTMLElement } from 'node-html-parser';
import {
  canContainCloudflareChallengePage,
  isCloudflareChallengeResponse
} from '@/platform/network/cloudflareChallenge';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import { absoluteUrl, elementText, isRecord, parseHtml, parsePositiveInteger, toIsoString } from '@/domain/forum/html';
import { accessRequirementFromText } from '@/domain/forum/accessRequirements';

export const NODESEEK_BASE_URL = 'https://www.nodeseek.com';

export function nodeSeekTopicUrl(id: string) {
  return `${NODESEEK_BASE_URL}/post-${id}-1`;
}

export function nodeSeekSpaceUrl(id: string) {
  return `${NODESEEK_BASE_URL}/space/${encodeURIComponent(id)}`;
}

export function nodeSeekTopicPagePath(id: string, page: number) {
  return `/post-${encodeURIComponent(id)}-${page}`;
}

function nodeSeekPostPageFromHref(href: string | undefined, id: string) {
  if (!href) {
    return null;
  }
  try {
    const pathname = new URL(href, NODESEEK_BASE_URL).pathname;
    const prefix = `/post-${encodeURIComponent(id)}-`;
    if (!pathname.startsWith(prefix)) {
      return null;
    }
    return parsePositiveInteger(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

export function nextNodeSeekPostPage(html: string, id: string, currentPage = 1) {
  let nextPage: number | null = null;
  for (const link of parseHtml(html).querySelectorAll('a')) {
    const page = nodeSeekPostPageFromHref(link.getAttribute('href'), id);
    if (page && page > currentPage && (!nextPage || page < nextPage)) {
      nextPage = page;
    }
  }
  return nextPage;
}

export function nextNodeSeekListPage(html: string, currentPage = 1) {
  let nextPage: number | null = null;
  for (const link of parseHtml(html).querySelectorAll('a[href]')) {
    try {
      const pathname = new URL(link.getAttribute('href') || '', NODESEEK_BASE_URL).pathname;
      const page = parsePositiveInteger(pathname.match(/(?:^|\/)page-(\d+)$/)?.[1]);
      if (page && page > currentPage && (!nextPage || page < nextPage)) {
        nextPage = page;
      }
    } catch {
      // Ignore unrelated links.
    }
  }
  return nextPage;
}

export function withNodeSeekReplyPagination(topic: TopicDetail, html: string, id: string, currentPage = 1) {
  const nextPage = nextNodeSeekPostPage(html, id, currentPage);
  if (!topic.replyHasMore && nextPage) {
    return {
      ...topic,
      replyHasMore: true,
      replyNextPage: nextPage,
      replyNextOffset: topic.replies.length
    };
  }
  return topic;
}

export function isNodeSeekHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
}

export function safeNodeSeekTopicUrl(id: string, rawUrl?: unknown) {
  const fallback = nodeSeekTopicUrl(id);
  const next = absoluteUrl(rawUrl, NODESEEK_BASE_URL) || fallback;
  try {
    return isNodeSeekHost(new URL(next).hostname) ? next : fallback;
  } catch {
    return fallback;
  }
}

export function nodeSeekAccessRequirementFromListRow(
  row: HTMLElement,
  title: string
): Topic['accessRequirement'] | undefined {
  const direct = row
    .querySelectorAll('*')
    .map((node) => elementText(node).replace(title, ' ').trim())
    .filter((text) => text && text !== '内版')
    .map((text) => accessRequirementFromText(text))
    .find(Boolean);
  return direct || accessRequirementFromText(elementText(row).replace(title, ' '));
}

function embeddedCandidates(html: string) {
  const scriptContents = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const dataAttributes = [...html.matchAll(/\sdata-[\w:-]+=["']([^"']*eyJ[A-Za-z0-9+/=]{40,}[^"']*)["']/g)].map(
    (match) => match[1]
  );
  return [...scriptContents, ...dataAttributes].flatMap((content) => content.match(/eyJ[A-Za-z0-9+/=]{40,}/g) || []);
}

export function extractNodeSeekEmbeddedData(html: string) {
  for (const candidate of embeddedCandidates(html)) {
    try {
      const parsed = JSON.parse(Buffer.from(candidate, 'base64').toString('utf8'));
      if (
        isRecord(parsed) &&
        (parsed.user ||
          parsed.currentUser ||
          parsed.current_user ||
          parsed.account ||
          parsed.postData ||
          parsed.rotateTopics ||
          parsed.topicList ||
          parsed.allCategory ||
          parsed.posts)
      ) {
        return parsed;
      }
    } catch {
      // Continue scanning unrelated base64 strings.
    }
  }
  return null;
}

function hasReadableNodeSeekListItem(root: ReturnType<typeof parseHtml>) {
  return root.querySelectorAll('li.post-list-item').some((row) => {
    const link = row.querySelector('.post-title a[href*="post-"]') || row.querySelector('a[href*="post-"]');
    const href = link?.getAttribute('href') || '';
    return Boolean(href.match(/post-(\d+)/) && elementText(link));
  });
}

function hasReadableNodeSeekTopic(root: ReturnType<typeof parseHtml>) {
  const contentElement = root.querySelector(
    '.content-item .post-content, .content-item .content, article .post-content, .post-detail .post-content, .post-content'
  );
  if (!contentElement || !(elementText(contentElement) || contentElement.querySelector('img, video, pre, code'))) {
    return false;
  }
  const title =
    elementText(
      root.querySelector('.post-title a, a.post-title, article .post-title, .post-detail .post-title, .post-title, h1')
    ) ||
    String(root.querySelector('meta[property="og:title"]')?.getAttribute('content') || '').trim() ||
    String(root.querySelector('meta[name="twitter:title"]')?.getAttribute('content') || '').trim() ||
    elementText(root.querySelector('title'));
  return Boolean(title && title !== 'NodeSeek');
}

function hasNodeSeekAccessNotice(root: ReturnType<typeof parseHtml>) {
  return root
    .querySelectorAll('.restricted-post, .post-restricted, .empty-state, .notice, .alert')
    .some((node) => Boolean(accessRequirementFromText(elementText(node))));
}

function hasNodeSeekSearchResultSurface(root: ReturnType<typeof parseHtml>, url?: string) {
  try {
    if (!url || new URL(url, NODESEEK_BASE_URL).pathname !== '/search') {
      return false;
    }
  } catch {
    return false;
  }
  return Boolean(
    root.querySelector('form[action*="/search"], input[name="q"]') &&
    root.querySelector('li.post-list-item, .post-list, .empty-state, .notice, .alert')
  );
}

export function hasReadableNodeSeekHtml(html: string, url?: string) {
  const embedded = extractNodeSeekEmbeddedData(html);
  if (
    embedded &&
    (isRecord(embedded.postData) ||
      [embedded.rotateTopics, embedded.topicList, embedded.posts].some(
        (value) => Array.isArray(value) && value.length > 0
      ))
  ) {
    return true;
  }
  const root = parseHtml(html);
  return (
    hasReadableNodeSeekListItem(root) ||
    hasReadableNodeSeekTopic(root) ||
    hasNodeSeekAccessNotice(root) ||
    hasNodeSeekSearchResultSurface(root, url)
  );
}

export function isNodeSeekChallengeResponse(
  response: Pick<Response, 'status' | 'headers'>,
  html: string,
  url?: string
) {
  if (/challenge/i.test(response.headers.get('cf-mitigated') || '')) {
    return true;
  }
  if (!canContainCloudflareChallengePage(response.headers)) {
    return false;
  }
  if (hasReadableNodeSeekHtml(html, url)) {
    return false;
  }
  return isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: html });
}

export function parseViewCount(value: unknown) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/(\d+(?:\.\d+)?)\s*(万|千|w|k|m)?/i);
  if (!match) {
    return undefined;
  }
  const number = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier =
    suffix === '万' || suffix === 'w' ? 10000 : suffix === '千' || suffix === 'k' ? 1000 : suffix === 'm' ? 1000000 : 1;
  const count = Math.round(number * multiplier);
  return count || undefined;
}

export function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const match = String(value).replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export function optionalNonNegativeInteger(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
  }
  const text = typeof value === 'string' ? value.replace(/,/g, '').trim() : '';
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

export function optionalBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function nodeSeekEmbeddedUserId(user: Record<string, unknown>) {
  return String(user.uid || user.id || user.userId || user.user_id || user.member_id || '').trim();
}

export function nodeSeekRoleLabel(user: Record<string, unknown>) {
  const labels = (Array.isArray(user.roles) ? user.roles : [])
    .map((role) => (isRecord(role) ? String(role.display_text || role.displayText || role.name || '').trim() : ''))
    .filter((label) => label && label !== '楼主');
  return labels.join(' · ') || undefined;
}

export function arrayField(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function nodeSeekCreatedAt(raw: Record<string, unknown>) {
  const time = isRecord(raw.time) ? raw.time : {};
  return toIsoString(
    raw.created_at ||
      raw.createdAt ||
      raw.createdDate ||
      time.created_at ||
      time.createdAt ||
      time.createdDate ||
      raw.time
  );
}

function nodeSeekReplyCountValue(value: unknown) {
  if (value === undefined || value === null || value === '' || Array.isArray(value)) {
    return undefined;
  }
  return parsePositiveInteger(value);
}

export function nodeSeekEmbeddedReplyCount(raw: Record<string, unknown>, fallback = 0) {
  const explicitReplyCount =
    nodeSeekReplyCountValue(raw.replyCount) ??
    nodeSeekReplyCountValue(raw.replies) ??
    nodeSeekReplyCountValue(raw.reply_count);
  if (explicitReplyCount !== undefined) {
    return explicitReplyCount;
  }
  const totalComments =
    nodeSeekReplyCountValue(raw.comments) ??
    nodeSeekReplyCountValue(raw.commentCount) ??
    nodeSeekReplyCountValue(raw.comment_count);
  return totalComments !== undefined ? Math.max(totalComments - 1, 0) : fallback;
}
