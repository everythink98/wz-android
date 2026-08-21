import type { ReplyLocationTarget, Source, Topic, UserReference } from './models';
import { isNodeSeekHost } from './sourceCatalog';

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
  if (isNodeSeekHost(host)) {
    const id = pathname.match(/^\/post-(\d+)-\d+(?:\/)?$/i)?.[1];
    return id ? internalTopic('nodeseek', id, 'NodeSeek 主题', `https://www.nodeseek.com/post-${id}-1`) : null;
  }
  if (isForumHost(host, 'linux.do')) {
    const parts = pathname.split('/').filter(Boolean);
    const id = parts[0]?.toLowerCase() === 't' ? (/^\d+$/.test(parts[1] || '') ? parts[1] : parts[2]) : '';
    return id && /^\d+$/.test(id) ? internalTopic('linuxdo', id, 'linux.do 主题', `https://linux.do/t/${id}`) : null;
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

function positiveLocationPart(value: string | null | undefined) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export function parseForumTopicDestination(
  href: string,
  baseUrl?: string
): { topic: Topic; targetReply?: ReplyLocationTarget } | null {
  const topic = parseForumTopicLink(href, baseUrl);
  const url = forumLinkUrl(href, baseUrl);
  if (!topic || !url) return null;
  let targetReply: ReplyLocationTarget | undefined;
  if (topic.source === 'nodeseek') {
    const pageHint = positiveLocationPart(url.pathname.match(/^\/post-\d+-(\d+)\/?$/i)?.[1]);
    const floor = positiveLocationPart(url.hash.match(/^#(\d+)$/)?.[1]);
    if (floor) targetReply = { floor, ...(pageHint ? { pageHint } : {}) };
  } else if (topic.source === 'linuxdo') {
    const parts = url.pathname.split('/').filter(Boolean);
    const topicIdIndex = /^\d+$/.test(parts[1] || '') ? 1 : 2;
    const floor = positiveLocationPart(parts[topicIdIndex + 1]);
    if (floor) targetReply = { floor };
  } else if (topic.source === 'yaohuo' && /\/bbs\/book_re\.aspx$/i.test(url.pathname)) {
    const floor = positiveLocationPart(url.searchParams.get('tofloor'));
    if (floor) targetReply = { floor };
  } else if (topic.source === 'v2ex') {
    const floor = positiveLocationPart(url.hash.match(/^#reply(\d+)$/i)?.[1]);
    if (floor) targetReply = { floor };
  }
  return { topic, ...(targetReply ? { targetReply } : {}) };
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
  if (isNodeSeekHost(url.hostname)) {
    const id = url.pathname.match(/^\/space\/(\d+)\/?$/i)?.[1];
    if (id) {
      return { source: 'nodeseek', id, url: `https://www.nodeseek.com/space/${id}` };
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
