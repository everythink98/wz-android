import type { HTMLElement } from 'node-html-parser';
import type { Topic, TopicDetail } from './types';
import {
  absoluteUrl,
  accessRequirementFromText,
  elementText,
  parseHtml,
  parsePositiveInteger
} from './localHtml';

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

export function nodeSeekAccessRequirementFromListRow(row: HTMLElement, title: string): Topic['accessRequirement'] | undefined {
  const direct = row.querySelectorAll('*')
    .map((node) => elementText(node).replace(title, ' ').trim())
    .filter((text) => text && text !== '内版')
    .map((text) => accessRequirementFromText(text))
    .find(Boolean);
  return direct || accessRequirementFromText(elementText(row).replace(title, ' '));
}
