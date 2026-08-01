import { REQUEST_CANCELED_MESSAGE } from './request';
import { sourceCatalog } from './sourceCatalog';
import type { AccessRequirement, FeedSource, Source, Topic, UserReference } from './types';

export function sourceLabel(source: Source | FeedSource) {
  if (source === 'all') {
    return '全部';
  }
  return sourceCatalog[source].label;
}

export function forumAccessRequirementText(requirement?: AccessRequirement) {
  if (!requirement) {
    return '';
  }
  if (requirement.type === 'level') {
    const text = requirement.detail || '';
    const level =
      text.match(/(?:lv|level)\s*(?:of\s+|[:：#-]\s*)?(\d+)/i)?.[1] ||
      text.match(/trust level\s*(\d+)/i)?.[1] ||
      text.match(/等级(?:达到|达|至少|要求|需|需要|不低于|高于|大于)?\s*(\d+)/i)?.[1] ||
      text.match(/需要[^。；\n]{0,24}(\d+)\s*级[^。；\n]{0,16}(?:查看|阅读|才能|才可|以上)/i)?.[1];
    if (level) {
      return `需 Lv${level}`;
    }
  }
  return requirement.label;
}

export function accessRequirementLevelValue(requirement?: AccessRequirement) {
  const match = forumAccessRequirementText(requirement).match(/^需 Lv(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

export function accessRequirementSpecificity(requirement?: AccessRequirement) {
  if (!requirement) {
    return 0;
  }
  if (requirement.type === 'level') {
    return 3;
  }
  if (requirement.type === 'permission') {
    return 2;
  }
  return 1;
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
const YAOHUO_BASE_URL = 'https://www.yaohuo.me';
const YAOHUO_HOST = 'www.yaohuo.me';
const YAOHUO_BARE_HOST = 'yaohuo.me';

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

function isYaohuoContentHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === YAOHUO_HOST || host === YAOHUO_BARE_HOST;
}

function discourseProfileUsername(pathname: string) {
  return pathname.match(/^\/u\/([^/]+)(?:\/(?:summary|activity))?\/?$/i)?.[1] || '';
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

type ForumUserLinkCandidate = {
  author?: string;
  authorId?: string;
  authorAvatar?: string;
  authorUrl?: string;
};

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
    const id = parts[0]?.toLowerCase() === 't' ? (/^\d+$/.test(parts[1] || '') ? parts[1] : parts[2]) : '';
    return id && /^\d+$/.test(id) ? internalTopic('linuxdo', id, 'linux.do 主题', `https://linux.do/t/${id}`) : null;
  }
  if (isForumHost(host, 'forum.xiaoyinsi.com')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = parts[0]?.toLowerCase() === 't' ? (/^\d+$/.test(parts[1] || '') ? parts[1] : parts[2]) : '';
    return id && /^\d+$/.test(id)
      ? internalTopic('xiaoyinsi', id, '小隐寺主题', `https://forum.xiaoyinsi.com/t/${id}`)
      : null;
  }
  if (isForumHost(host, 'v2ex.com')) {
    const id = pathname.match(/^\/t\/(\d+)(?:\/)?$/i)?.[1];
    return id ? internalTopic('v2ex', id, 'V2EX 主题', `https://www.v2ex.com/t/${id}`) : null;
  }
  if (isYaohuoContentHost(host)) {
    const id =
      pathname.match(/^\/bbs-(\d+)\.html$/i)?.[1] ||
      (/\/(?:view|book_re|book_view)\.aspx$/i.test(pathname) ? url.searchParams.get('id') || '' : '');
    if (!id || !/^\d+$/.test(id)) {
      return null;
    }
    const categoryId = url.searchParams.get('classid') || undefined;
    return internalTopic('yaohuo', id, '妖火主题', `${YAOHUO_BASE_URL}/bbs-${id}.html`, {
      categoryId,
      category: categoryId ? YAOHUO_CATEGORY_NAMES[categoryId] : undefined
    });
  }
  return null;
}

export function parseInternalTopicOpenLink(value: string) {
  const url = forumLinkUrl(value);
  return url?.protocol === 'exp+wz-android:' && url.hostname === 'open-topic'
    ? parseForumTopicLink(url.searchParams.get('url') || '')
    : null;
}

export function parseForumUserLink(
  href: string,
  baseUrl?: string,
  candidates: ForumUserLinkCandidate[] = []
): UserReference | null {
  const url = forumLinkUrl(href, baseUrl);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return null;
  }
  if (isForumHost(url.hostname, 'linux.do')) {
    const rawUsername = discourseProfileUsername(url.pathname);
    if (!rawUsername) {
      return null;
    }
    try {
      const username = decodeURIComponent(rawUsername);
      return username
        ? {
            source: 'linuxdo',
            id: username,
            username,
            displayName: username,
            url: `https://linux.do/u/${encodeURIComponent(username)}`
          }
        : null;
    } catch {
      return null;
    }
  }
  if (isForumHost(url.hostname, 'nodeseek.com')) {
    const id = url.pathname.match(/^\/space\/(\d+)\/?$/i)?.[1];
    if (id) {
      return {
        source: 'nodeseek',
        id,
        url: `https://www.nodeseek.com/space/${id}`
      };
    }
    if (!/^\/member\/?$/i.test(url.pathname)) {
      return null;
    }
    const username = url.searchParams.get('t')?.trim();
    if (!username) {
      return null;
    }
    const candidate = candidates.slice(0, 32).find((item) => item.author === username);
    const candidateId =
      candidate?.authorId?.match(/^\d+$/)?.[0] || candidate?.authorUrl?.match(/(?:^|\/)space\/(\d+)(?:[/?#]|$)/)?.[1];
    return candidateId
      ? {
          source: 'nodeseek',
          id: candidateId,
          username,
          displayName: username,
          avatar: candidate?.authorAvatar,
          url: `https://www.nodeseek.com/space/${candidateId}`
        }
      : {
          source: 'nodeseek',
          username,
          displayName: username,
          url: `https://www.nodeseek.com/member?t=${encodeURIComponent(username)}`
        };
  }
  if (isYaohuoContentHost(url.hostname)) {
    if (!/^\/(?:bbs\/)?userinfo\.aspx$/i.test(url.pathname)) {
      return null;
    }
    const id = [...url.searchParams.entries()].find(([key]) => /^(touserid|userid)$/i.test(key))?.[1].trim() || '';
    return /^\d+$/.test(id)
      ? {
          source: 'yaohuo',
          id,
          username: id,
          url: `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(id)}`
        }
      : null;
  }
  if (isForumHost(url.hostname, 'forum.xiaoyinsi.com')) {
    const rawUsername = discourseProfileUsername(url.pathname);
    if (!rawUsername) {
      return null;
    }
    try {
      const username = decodeURIComponent(rawUsername);
      return username
        ? {
            source: 'xiaoyinsi',
            id: username,
            username,
            displayName: username,
            url: `https://forum.xiaoyinsi.com/u/${encodeURIComponent(username)}`
          }
        : null;
    } catch {
      return null;
    }
  }
  if (!isForumHost(url.hostname, 'v2ex.com')) {
    return null;
  }
  const rawUsername = url.pathname.match(/^\/member\/([^/]+)\/?$/i)?.[1];
  if (!rawUsername) {
    return null;
  }
  try {
    const username = decodeURIComponent(rawUsername);
    return username
      ? {
          source: 'v2ex',
          id: username,
          username,
          displayName: username,
          url: `https://www.v2ex.com/member/${encodeURIComponent(username)}`
        }
      : null;
  } catch {
    return null;
  }
}

export function isYaohuoLoginRequiredError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'loginRequired' in error &&
    (error as { loginRequired?: unknown }).loginRequired
  );
}

export function isYaohuoLoginExpiredError(error: unknown) {
  return Boolean(isYaohuoLoginRequiredError(error) && (error as { reason?: unknown }).reason === 'expired');
}

export function isLinuxDoCloudflareError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { source?: unknown }).source === 'linuxdo' &&
    (error as { reason?: unknown }).reason === 'cloudflare'
  );
}

export function isNodeSeekCloudflareError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { source?: unknown }).source === 'nodeseek' &&
    (error as { reason?: unknown }).reason === 'cloudflare'
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

export function topicListDisplayTimeText(topic: {
  source: Source;
  createdAt: string;
  lastReplyAt?: string;
  displayTimeText?: string;
}) {
  return topic.displayTimeText?.trim() || formatRelativeTime(topicListDisplayTime(topic));
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
