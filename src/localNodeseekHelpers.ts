import { Buffer } from 'buffer';
import type { HTMLElement } from 'node-html-parser';
import {
  canContainCloudflareChallengePage,
  isCloudflareChallengeResponse
} from '@/platform/network/cloudflareChallenge';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import {
  absoluteUrl,
  accessRequirementFromText,
  elementText,
  isRecord,
  parseHtml,
  parsePositiveInteger
} from '@/domain/forum/html';

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
