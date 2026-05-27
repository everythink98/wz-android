import { type MutableRefObject } from 'react';
import { REQUEST_CANCELED_MESSAGE } from './request';
import type { FeedSource, Source, Topic } from './types';

export function sourceLabel(source: Source | FeedSource) {
  if (source === 'all') {
    return '全部';
  }
  if (source === 'linuxdo') {
    return 'linux.do';
  }
  if (source === 'nodeseek') {
    return 'NodeSeek';
  }
  if (source === 'yaohuo') {
    return '妖火';
  }
  return 'V2EX';
}

export function linuxDoExternalSearchItems(query: string) {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const encoded = encodeURIComponent(`site:linux.do ${trimmed}`);
  return [
    { label: 'Google', url: `https://www.google.com/search?q=${encoded}` },
    { label: 'Bing', url: `https://www.bing.com/search?q=${encoded}` },
    { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${encoded}` }
  ];
}

const YAOHUO_CATEGORY_NAMES: Record<string, string> = {
  '177': '妖火茶馆',
  '213': '悬赏问答',
  '201': '资源分享',
  '197': '综合技术',
  '204': '有奖活动',
  '203': '免流分享',
  '240': '贴图晒照',
  '198': '投诉建议',
  '199': '站务处理',
  '288': '网站公告'
};

function forumLinkUrl(value: string, baseUrl?: string) {
  try {
    return new URL(value, baseUrl);
  } catch {
    return null;
  }
}

function isForumHost(hostname: string, rootHost: string) {
  const host = hostname.toLowerCase();
  return host === rootHost || host.endsWith(`.${rootHost}`);
}

function internalTopic(source: Source, id: string, title: string, url: string, extra: Partial<Topic> = {}): Topic {
  return {
    source,
    id,
    title,
    author: '',
    url,
    createdAt: new Date().toISOString(),
    replyCount: 0,
    ...extra
  };
}

export function parseForumTopicLink(href: string, baseUrl?: string): Topic | null {
  const url = forumLinkUrl(href, baseUrl);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  if (isForumHost(host, 'nodeseek.com')) {
    const id = pathname.match(/^\/post-(\d+)-\d+(?:\/)?$/i)?.[1];
    return id ? internalTopic('nodeseek', id, 'NodeSeek 主题', `https://www.nodeseek.com/post-${id}-1`) : null;
  }
  if (isForumHost(host, 'linux.do')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = parts[0]?.toLowerCase() === 't'
      ? (/^\d+$/.test(parts[1] || '') ? parts[1] : parts[2])
      : '';
    return id && /^\d+$/.test(id) ? internalTopic('linuxdo', id, 'linux.do 主题', `https://linux.do/t/${id}`) : null;
  }
  if (isForumHost(host, 'v2ex.com')) {
    const id = pathname.match(/^\/t\/(\d+)(?:\/)?$/i)?.[1];
    return id ? internalTopic('v2ex', id, 'V2EX 主题', `https://www.v2ex.com/t/${id}`) : null;
  }
  if (isForumHost(host, 'yaohuo.me')) {
    const id = pathname.match(/^\/bbs-(\d+)\.html$/i)?.[1]
      || (/\/(?:view|book_re|book_view)\.aspx$/i.test(pathname) ? url.searchParams.get('id') || '' : '');
    if (!id || !/^\d+$/.test(id)) {
      return null;
    }
    const categoryId = url.searchParams.get('classid') || undefined;
    return internalTopic('yaohuo', id, '妖火主题', `https://yaohuo.me/bbs-${id}.html`, {
      categoryId,
      category: categoryId ? YAOHUO_CATEGORY_NAMES[categoryId] : undefined
    });
  }
  return null;
}

export function isYaohuoLoginRequiredError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && 'loginRequired' in error
    && (error as { loginRequired?: unknown }).loginRequired
  );
}

export function isYaohuoLoginExpiredError(error: unknown) {
  return Boolean(
    isYaohuoLoginRequiredError(error)
    && (error as { reason?: unknown }).reason === 'expired'
  );
}

export function isLinuxDoCloudflareError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { source?: unknown }).source === 'linuxdo'
    && (error as { reason?: unknown }).reason === 'cloudflare'
  );
}

export function isNodeSeekCloudflareError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { source?: unknown }).source === 'nodeseek'
    && (error as { reason?: unknown }).reason === 'cloudflare'
  );
}

export function formatDateTime(value?: string) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatRelativeTime(value?: string) {
  const time = dateTime(value);
  if (!time) {
    return '';
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 60 * 60_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return `${Math.floor(diff / (24 * 60 * 60_000))} 天前`;
}

export function topicListDisplayTime(topic: { source: Source; createdAt: string; lastReplyAt?: string }) {
  return topic.lastReplyAt || topic.createdAt;
}

export function dateTime(value?: string) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败';
}

export function isCanceledRequest(error: unknown) {
  return error instanceof Error && error.message === REQUEST_CANCELED_MESSAGE;
}

export function startAbortableRequest(ref: MutableRefObject<AbortController | null>) {
  ref.current?.abort();
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}

export function finishAbortableRequest(ref: MutableRefObject<AbortController | null>, controller: AbortController) {
  if (ref.current !== controller) {
    return false;
  }
  ref.current = null;
  return true;
}
