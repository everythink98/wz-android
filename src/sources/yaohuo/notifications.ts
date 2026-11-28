import { elementText, hasRenderableHtmlContent, isRecord, parseHtml, toIsoString } from '@/domain/forum/html';
import { parseForumUserLink } from '@/domain/forum/links';
import { notificationPageError, notificationPageQuality } from '@/domain/notifications/notificationQuality';
import {
  annotateSourceDiagnosticSummary,
  mergeSourceDiagnosticSummaries
} from '@/platform/diagnostics/sourceDiagnosticSummary';
import type {
  ForumNotification,
  NotificationCategory,
  NotificationDetail,
  NotificationMarkResult,
  NotificationMessage,
  NotificationPage,
  NotificationReplyResult
} from '@/domain/notifications/models';
import type {
  NotificationAdapter,
  NotificationAdapterAccess,
  NotificationListOptions
} from '@/sources/notificationAdapter';
import { sanitizeContentHtmlWithRoot } from '@/domain/forum/contentSanitizer';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { fetchWithTimeout } from '@/platform/network/request';
import { fetchYaohuoHtml } from './reader';
import { requireYaohuoRequestUrl, YAOHUO_BASE_URL, YAOHUO_LOGIN_URL } from './protocol';
import { ensureYaohuoHtmlLoggedIn, yaohuoLoginRequiredError } from './sessionParser';
import { buildYaohuoMessageReplyRequest } from './actionRequest';
import { runYaohuoAction } from './actionClient';

const yaohuoNotificationCategories = [
  { id: 'all', label: '收件箱' },
  { id: 'system', label: '系统' },
  { id: 'chat', label: '聊天' }
] as const satisfies readonly NotificationCategory[];

const absoluteChatTimePattern = /\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/;

type ParsedNotificationMessage = NotificationMessage & { contentKey: string };
type ChatNode = ReturnType<typeof parseHtml>;
type YaohuoChatScope = { kind: 'system' } | { kind: 'member'; partnerId?: string; name: string; selfId: string };
type YaohuoUnreadScan =
  | { kind: 'reading'; cursor: number; seen: Set<number>; items: ForumNotification[]; pages: NotificationPage[] }
  | { kind: 'complete'; items: ForumNotification[]; pages: NotificationPage[] };

function messageId(href: string) {
  try {
    const url = new URL(href.replace(/&amp;/gi, '&'), YAOHUO_BASE_URL);
    if (url.origin !== new URL(YAOHUO_BASE_URL).origin || !/^\/bbs\/messagelist_view\.aspx$/i.test(url.pathname))
      return '';
    const id = url.searchParams.get('id') || '';
    return /^\d+$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function senderProfileId(href: string) {
  const user = parseForumUserLink(href, YAOHUO_BASE_URL);
  const id = user?.source === 'yaohuo' ? user.id : undefined;
  return id && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? id : undefined;
}

function parsePage(html: string, unreadOnly = false, categoryId = 'all'): NotificationPage {
  const root = parseHtml(html);
  const rows = root.querySelectorAll('.msglist-rows .msglist-row');
  const explicitEmpty = Boolean(root.querySelector('.msglist-page .msglist-empty'));
  if (!rows.length && !explicitEmpty) throw new Error('妖火消息列表格式不正确');
  if (rows.length && !rows.some((row) => messageId(row.getAttribute('href') || ''))) {
    throw new Error('妖火消息列表格式不正确');
  }
  let filteredCount = 0;
  const items = rows.flatMap((row) => {
    const id = messageId(row.getAttribute('href') || '');
    if (!id) return [];
    const time = row.querySelector('.msglist-time');
    const displayTime = time?.getAttribute('title') || elementText(time);
    const actor = elementText(row.querySelector('.msglist-from')) || '妖火用户';
    const senderId = elementText(row.querySelector('.msglist-uid')).match(/^\(\s*(\d+)\s*\)$/)?.[1];
    const actorId = senderId && Number.isSafeInteger(Number(senderId)) && Number(senderId) > 0 ? senderId : undefined;
    const unread = /(?:^|\s)is-unread(?:\s|$)/.test(row.getAttribute('class') || '');
    if (unreadOnly && !unread) {
      filteredCount += 1;
      return [];
    }
    const title = elementText(row.querySelector('.msglist-text')) || '站内消息';
    const createdAt = toIsoString(displayTime, '+08:00') || null;
    return [
      {
        source: 'yaohuo',
        id,
        kind: actor === '系统' && !actorId ? 'system' : 'private-message',
        actor: { name: actor, ...(actorId ? { id: actorId } : {}) },
        title,
        createdAt,
        ...(!createdAt && displayTime ? { displayTime } : {}),
        unread,
        target: {
          type: 'message-detail',
          messageId: id,
          url: `${YAOHUO_BASE_URL}/bbs/messagelist_view.aspx?id=${encodeURIComponent(id)}`
        },
        remoteGroup: categoryId,
        remoteCursor: String(currentPage(root)),
        remoteReadId: id
      } satisfies ForumNotification
    ];
  });
  const pageText = elementText(root.querySelector('.showpage'));
  const match = pageText.match(/(\d+)\s*\/\s*(\d+)\s*页/);
  const current = Number(match?.[1]) || 1;
  const total = Number(match?.[2]) || current;
  const hasMore = current < total;
  return annotateSourceDiagnosticSummary(
    {
      items,
      cursor: hasMore ? String(current + 1) : null,
      hasMore,
      quality: notificationPageQuality(rows.length, items.length + filteredCount)
    },
    {
      parserVariant: 'yaohuo-notifications',
      candidateCount: rows.length,
      validCount: items.length + filteredCount,
      filteredCount,
      isExpectedEmpty: explicitEmpty || rows.length === 0,
      hasDegradation: rows.length > items.length + filteredCount
    }
  );
}

function currentPage(root: ReturnType<typeof parseHtml>) {
  const match = elementText(root.querySelector('.showpage')).match(/(\d+)\s*\/\s*\d+\s*页/);
  return Number(match?.[1]) || 1;
}

function detailContent(root: ReturnType<typeof parseHtml>, detailUrl: string) {
  const label = root.querySelectorAll('b').find((candidate) => /^内容\s*[：:]$/.test(elementText(candidate)));
  if (!label) return null;
  const siblings = label.parentNode?.childNodes || [];
  const fragments: string[] = [];
  for (const node of siblings.slice(siblings.indexOf(label) + 1)) {
    const element = node as unknown as { getAttribute?: (name: string) => string | undefined };
    const href = element.getAttribute?.('href') || '';
    if (/\/bbs\/messagelist_(?:add|del)\.aspx/i.test(href)) break;
    fragments.push(node.toString());
  }
  const content = sanitizeContentHtmlWithRoot(fragments.join(''), detailUrl);
  return hasRenderableHtmlContent(content.contentHtml, content.root) ? content : null;
}

function detailActorId(root: ReturnType<typeof parseHtml>) {
  const contentLabel = root.querySelectorAll('b').find((candidate) => /^内容\s*[：:]$/.test(elementText(candidate)));
  if (!contentLabel) return undefined;
  const siblings = contentLabel.parentNode?.children || [];
  const senderLabel = siblings
    .slice(0, siblings.indexOf(contentLabel))
    .find((candidate) => candidate.tagName === 'B' && /^发件人\s*[：:]$/.test(elementText(candidate)));
  const link = senderLabel?.nextElementSibling;
  return link?.tagName === 'A' ? senderProfileId(link.getAttribute('href') || '') : undefined;
}

function chatContent(value: string, detailUrl: string) {
  const content = value
    .replace(
      /^(?:\s|&nbsp;)*回复时间\s*[：:]\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*)?/i,
      ''
    )
    .replace(/^(?:\s|&nbsp;)*回复内容\s*[：:]?(?:(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*)?/i, '')
    .replace(/(?:(?:\s|&nbsp;)|<br\s*\/?>|\|)+$/gi, '');
  return sanitizeContentHtmlWithRoot(content, detailUrl);
}

function currentChatContent(row: ReturnType<typeof parseHtml>, detailUrl: string) {
  const html = row.querySelector('.chat-bubble')?.innerHTML || '';
  return row.classList.contains('chat-msg--notice')
    ? chatContent(html, detailUrl)
    : sanitizeContentHtmlWithRoot(html, detailUrl);
}

function currentChatMessages(
  rows: ChatNode[],
  detailUrl: string,
  scope: YaohuoChatScope,
  anchor?: ChatNode
): NotificationMessage[] {
  const anchorId = anchor?.getAttribute('data-message-id');
  const messages = new Map<string, NotificationMessage>();
  let groupDate: string | undefined;
  for (const row of rows) {
    if (row.classList.contains('chat-date')) {
      groupDate = row.getAttribute('data-date');
      continue;
    }
    if (!row.classList.contains('chat-msg') || row.classList.contains('is-pending')) continue;
    const id = row.getAttribute('data-message-id') || '';
    if (!positiveId(id) || (id === anchorId && row !== anchor) || messages.has(id)) continue;
    const notice = row.classList.contains('chat-msg--notice');
    const mine = scope.kind === 'member' && row.classList.contains('chat-msg--out');
    if (row !== anchor && !notice && (scope.kind === 'system' || (!mine && !row.classList.contains('chat-msg--in'))))
      continue;
    const sender = row.getAttribute('data-sender');
    if (!notice && sender && scope.kind === 'member') {
      const expectedSender = mine ? scope.selfId : scope.partnerId;
      if (expectedSender && sender !== expectedSender) continue;
    }
    const content = currentChatContent(row, detailUrl);
    if (!hasRenderableHtmlContent(content.contentHtml, content.root)) continue;
    const date = row.getAttribute('data-date') || groupDate;
    const time = elementText(row.querySelector('.chat-time'));
    const timestamp =
      time && date && !absoluteChatTimePattern.test(time) ? `${date} ${time}` : time || row.getAttribute('data-date');
    messages.set(id, {
      id: `chat:${id}`,
      author: mine ? '我' : scope.kind === 'system' || notice ? '系统' : scope.name,
      contentHtml: content.contentHtml,
      createdAt: toIsoString(timestamp, '+08:00') || null,
      mine
    });
  }
  return [...messages.values()];
}

function sortChatMessages(messages: NotificationMessage[]) {
  return [...messages].sort((left, right) => {
    if (left.createdAt && right.createdAt && left.createdAt !== right.createdAt)
      return left.createdAt < right.createdAt ? -1 : 1;
    if (Boolean(left.createdAt) !== Boolean(right.createdAt)) return left.createdAt ? -1 : 1;
    return Number(left.id.slice('chat:'.length)) - Number(right.id.slice('chat:'.length));
  });
}

function positiveId(value: string | undefined): value is string {
  return Boolean(value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)));
}

function exactChatWindow(page: ChatNode, item: ForumNotification, id: string, selfId: string) {
  const rows = page.querySelector('.chat-list')?.children || [];
  const messageRows = rows.filter((row) => row.classList.contains('chat-msg') && !row.classList.contains('is-pending'));
  const marked = messageRows.filter((row) => row.classList.contains('is-anchor'));
  const candidates = marked.length ? marked : messageRows.filter((row) => row.getAttribute('data-message-id') === id);
  const anchor = candidates[0];
  if (
    page.getAttribute('data-message-id') !== id ||
    candidates.length !== 1 ||
    anchor?.getAttribute('data-message-id') !== id
  )
    throw new Error('妖火消息对应的正文未找到');

  const declaredPartner = page.getAttribute('data-partner-id');
  const partnerId = positiveId(declaredPartner) ? declaredPartner : undefined;
  const privateMessage = item.kind === 'private-message';
  if (privateMessage && partnerId && item.actor.id && partnerId !== item.actor.id)
    throw new Error('妖火消息会话与收件箱不一致');
  const scope: YaohuoChatScope =
    privateMessage || partnerId
      ? {
          kind: 'member',
          partnerId,
          name: page.getAttribute('data-partner-name')?.trim() || (privateMessage ? item.actor.name : '妖火用户'),
          selfId
        }
      : { kind: 'system' };
  return { rows, anchor, scope };
}

function messageWindowCursor(anchorId: string, partnerId: string, boundary: NotificationMessage | undefined) {
  const edgeId = boundary?.id.slice('chat:'.length);
  return positiveId(anchorId) && positiveId(edgeId) ? `${anchorId}:${partnerId}:${edgeId}` : null;
}

async function readMessageWindow(
  item: ForumNotification,
  cursor: string,
  direction: 'up' | 'down',
  options: NotificationAdapterAccess
) {
  const [anchorId, partnerId, boundaryId, ...rest] = cursor.split(':');
  if (
    rest.length ||
    item.target.type !== 'message-detail' ||
    anchorId !== item.target.messageId ||
    anchorId !== messageId(item.target.url) ||
    !positiveId(anchorId) ||
    !positiveId(boundaryId) ||
    (partnerId !== '0' && !positiveId(partnerId)) ||
    (item.kind !== 'system' && (item.kind !== 'private-message' || partnerId === '0' || partnerId !== item.actor.id))
  )
    throw new Error('妖火会话游标不正确');
  const detailUrl = item.target.url;
  let scope: YaohuoChatScope = { kind: 'member', partnerId, name: item.actor.name, selfId: options.userId };
  if (item.kind === 'system') {
    const original = await fetchYaohuoHtml(detailUrl, options.fetcher, options);
    const page = parseHtml(original.html).querySelector('.msgview-page');
    if (!page) throw new Error('妖火会话游标不正确');
    scope = exactChatWindow(page, item, anchorId, options.userId).scope;
    if ((scope.kind === 'member' ? scope.partnerId : '0') !== partnerId) throw new Error('妖火会话游标不正确');
  }
  const userAgent = await resolveWebViewUserAgent(options.userAgent, options.signal);
  const requestJson = async (path: string, body?: URLSearchParams): Promise<unknown> => {
    const url = new URL(path, YAOHUO_BASE_URL).toString();
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: 'application/json',
          Referer: detailUrl,
          'Cache-Control': 'no-store',
          'User-Agent': userAgent,
          ...(body
            ? { Origin: YAOHUO_BASE_URL, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
            : {})
        },
        redirect: 'manual',
        ...(body ? { method: 'POST', body: body.toString() } : {})
      },
      options
    );
    const responseUrl = requireYaohuoRequestUrl(response.url || url);
    const responseBody = await response.text();
    if (!response.ok) {
      const location = response.headers.get('location');
      if (
        response.status >= 300 &&
        response.status < 400 &&
        location &&
        requireYaohuoRequestUrl(location, url) === YAOHUO_LOGIN_URL
      )
        throw yaohuoLoginRequiredError();
      if (responseBody.trimStart().startsWith('<')) ensureYaohuoHtmlLoggedIn(responseBody, responseUrl);
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    }
    try {
      return JSON.parse(responseBody);
    } catch {
      ensureYaohuoHtmlLoggedIn(responseBody, responseUrl);
      throw new Error('妖火会话响应格式不正确');
    }
  };
  const token = await requestJson('/bbs/messagelist_del.aspx?action=csrftoken');
  if (!isRecord(token) || token.success !== true || typeof token.token !== 'string' || !token.token.trim()) {
    throw new Error('无法读取妖火会话凭据');
  }
  const result = await requestJson(
    '/bbs/messagelist_view.aspx',
    new URLSearchParams({
      action: 'loadMore',
      direction,
      lastMessageId: boundaryId,
      partnerId,
      format: 'html',
      ajax: '1',
      __CSRFToken: token.token
    })
  );
  if (
    !isRecord(result) ||
    result.success !== true ||
    typeof result.hasMore !== 'boolean' ||
    typeof result.count !== 'number' ||
    !Number.isSafeInteger(result.count) ||
    result.count < 0 ||
    (result.html != null && typeof result.html !== 'string')
  )
    throw new Error('妖火会话分页格式不正确');
  const rows = parseHtml(result.html ?? '').children;
  const messages = currentChatMessages(rows, detailUrl, scope);
  const hasMore = result.hasMore && result.count > 0;
  const next = hasMore
    ? messageWindowCursor(anchorId, partnerId, direction === 'up' ? messages[0] : messages.at(-1))
    : null;
  if ((result.count > 0 && !messages.length) || (hasMore && (!next || next === cursor))) {
    throw new Error('妖火会话分页缺少消息或没有向前推进');
  }
  return { messages: sortChatMessages(messages), cursor: next };
}

function messageContentKey(root: ReturnType<typeof parseHtml>) {
  const text = elementText(root).replace(/\s+/g, ' ').trim();
  const images = root
    .querySelectorAll('img[src]')
    .map((image) => image.getAttribute('src') || '')
    .filter(Boolean)
    .join('|');
  return `${text}\u0000${images}`;
}

function removeOriginalMessage(messages: ParsedNotificationMessage[], originalKey: string) {
  const duplicateIndex = messages.findIndex((message) => message.contentKey === originalKey);
  return messages
    .filter((_, index) => index !== duplicateIndex)
    .map(({ contentKey: _contentKey, ...message }) => message);
}

function chatMessages(root: ReturnType<typeof parseHtml>, detailUrl: string, otherAuthor: string) {
  const messages = root.querySelectorAll('.listmms').flatMap((row, index) => {
    const className = row.getAttribute('class') || '';
    const mine = /(?:^|\s)the_me(?:\s|$)/.test(className);
    if (!mine && !/(?:^|\s)the_user(?:\s|$)/.test(className)) return [];
    const content = row.querySelector('.bubble .con') || row.querySelector('.con');
    const sanitized = chatContent(content?.innerHTML || '', detailUrl);
    if (!hasRenderableHtmlContent(sanitized.contentHtml, sanitized.root)) return [];
    const info = row.querySelector('.info');
    const infoText = elementText(info);
    const replyTime = elementText(row).match(
      new RegExp(`回复时间\\s*[：:]\\s*(${absoluteChatTimePattern.source})`, 'i')
    )?.[1];
    const displayTime = infoText.match(absoluteChatTimePattern)?.[0] || replyTime || '';
    const authorCandidate = elementText(info?.querySelector('.u_name label'));
    const author =
      authorCandidate && !absoluteChatTimePattern.test(authorCandidate) ? authorCandidate : mine ? '我' : otherAuthor;
    return [
      {
        id: `chat:${index}`,
        author: author || '妖火用户',
        contentHtml: sanitized.contentHtml,
        createdAt: toIsoString(displayTime, '+08:00') || null,
        mine,
        contentKey: messageContentKey(sanitized.root)
      } satisfies ParsedNotificationMessage
    ];
  });
  return messages
    .map((message) => ({ message, time: message.createdAt ? Date.parse(message.createdAt) : Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.time - right.time)
    .map(({ message }) => message);
}

function messageReplyForm(html: string, baseUrl: string) {
  const root = parseHtml(html);
  const form = root.querySelectorAll('form[action]').find((candidate) => {
    try {
      return /^\/bbs\/messagelist_add\.aspx$/i.test(new URL(candidate.getAttribute('action') || '', baseUrl).pathname);
    } catch {
      return false;
    }
  });
  if (!form || !form.querySelector('[name="content"]')) return null;
  const url = new URL(form.getAttribute('action') || '', baseUrl);
  if (url.origin !== new URL(YAOHUO_BASE_URL).origin) throw new Error('妖火私信回复地址不正确');
  const fields = Object.fromEntries(
    form
      .querySelectorAll('input[name]')
      .filter((input) => (input.getAttribute('type') || '').toLowerCase() === 'hidden')
      .map((input) => [input.getAttribute('name') || '', input.getAttribute('value') || ''])
      .filter(([name]) => Boolean(name))
  );
  return { fields, path: `${url.pathname}${url.search}` };
}

function messageReplyLink(html: string, baseUrl: string) {
  const link = parseHtml(html)
    .querySelectorAll('a[href]')
    .find((candidate) => /messagelist_add\.aspx/i.test(candidate.getAttribute('href') || ''));
  if (!link) return '';
  const url = new URL(link.getAttribute('href') || '', baseUrl);
  return url.origin === new URL(YAOHUO_BASE_URL).origin && /^\/bbs\/messagelist_add\.aspx$/i.test(url.pathname)
    ? url.toString()
    : '';
}

async function readListPage(options: NotificationAdapterAccess, page: number, unreadOnly = false, categoryId = 'all') {
  if (!yaohuoNotificationCategories.some((category) => category.id === categoryId)) {
    throw new Error('妖火消息分类不正确');
  }
  const url = new URL('/bbs/messagelist.aspx', YAOHUO_BASE_URL);
  url.searchParams.set('types', '0');
  if (categoryId !== 'all') url.searchParams.set('issystem', categoryId === 'system' ? '1' : '0');
  url.searchParams.set('page', String(page));
  const result = await fetchYaohuoHtml(url.toString(), options.fetcher, {
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
  return parsePage(result.html, unreadOnly, categoryId);
}

export const yaohuoNotificationAdapter = {
  async getCategories(_options: NotificationAdapterAccess) {
    return yaohuoNotificationCategories;
  },

  async listPage(options: NotificationListOptions): Promise<NotificationPage> {
    const page = Math.max(1, Number(options.cursor) || 1);
    return readListPage(options, page, options.unreadOnly, options.categoryId);
  },

  async readUnreadSnapshot(options: NotificationAdapterAccess) {
    let scan: YaohuoUnreadScan = { kind: 'reading', cursor: 1, seen: new Set([1]), items: [], pages: [] };
    while (scan.kind === 'reading') {
      const page = await readListPage(options, scan.cursor, true);
      const qualityError = notificationPageError(page.quality);
      if (qualityError) throw qualityError;
      if (scan.items.length + page.items.length > 60) throw new Error('妖火未读数量尚未完整读取');
      scan.pages.push(page);
      scan.items.push(...page.items);
      if (page.hasMore) {
        const next = Number(page.cursor);
        if (!Number.isSafeInteger(next) || next < 1 || scan.seen.has(next)) throw new Error('妖火消息分页格式不正确');
        scan.seen.add(next);
        if (scan.items.length >= 60) throw new Error('妖火未读数量尚未完整读取');
        scan = { ...scan, cursor: next };
      } else {
        scan = { kind: 'complete', items: scan.items, pages: scan.pages };
      }
    }
    return mergeSourceDiagnosticSummaries(
      {
        total: new Set(scan.items.map((item) => item.id)).size,
        checkedAt: new Date().toISOString()
      },
      'yaohuo-notifications',
      scan.pages
    );
  },

  async loadDetail(item: ForumNotification, options: NotificationAdapterAccess): Promise<NotificationDetail> {
    if (item.target.type !== 'message-detail') {
      return { notification: item, title: item.title, contentText: item.preview || item.title };
    }
    const detailUrl = item.target.url;
    const result = await fetchYaohuoHtml(detailUrl, options.fetcher, {
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });
    const root = parseHtml(result.html);
    const page = root.querySelector('.msgview-page');
    if (page) {
      const id = item.target.messageId;
      const { rows, anchor, scope } = exactChatWindow(page, item, id, options.userId);
      const replyable = item.kind === 'private-message';
      const actorId = replyable && scope.kind === 'member' ? scope.partnerId : undefined;
      const notification = actorId ? { ...item, actor: { ...item.actor, id: actorId } } : item;
      const messages = currentChatMessages(rows, detailUrl, scope, anchor);
      const messageAnchorId = `chat:${id}`;
      if (!messages.some((message) => message.id === messageAnchorId)) throw new Error('妖火消息对应的正文未找到');
      const historyPartner = scope.kind === 'member' ? scope.partnerId : '0';
      const older = page.querySelector('#msgviewOlder');
      const newer = page.querySelector('#msgviewNewer');
      const messageHistory =
        historyPartner && (older || newer)
          ? {
              olderCursor:
                older && !older.hasAttribute('hidden') ? messageWindowCursor(id, historyPartner, messages[0]) : null,
              newerCursor:
                newer && !newer.hasAttribute('hidden') ? messageWindowCursor(id, historyPartner, messages.at(-1)) : null
            }
          : undefined;
      return {
        notification,
        title: item.title,
        messages: sortChatMessages(messages),
        messageAnchorId,
        ...(messageHistory ? { messageHistory } : {}),
        ...(replyable ? { reply: { format: 'plain-text' } } : {}),
        ...(replyable && !messageHistory ? { historyNotice: '仅展示原站当前返回的聊天记录。' } : {})
      };
    }
    const content = detailContent(root, detailUrl);
    if (!content) throw new Error('妖火消息对应的正文未找到');
    const actorId = detailActorId(root);
    const replyable = item.kind === 'private-message';
    return {
      notification: actorId ? { ...item, actor: { ...item.actor, id: actorId } } : item,
      title: item.title,
      contentHtml: content.contentHtml,
      ...(replyable
        ? {
            messages: removeOriginalMessage(
              chatMessages(root, detailUrl, item.actor.name),
              messageContentKey(content.root)
            ),
            reply: { format: 'plain-text' as const },
            historyNotice: '原站仅提供最近 20 条聊天记录。'
          }
        : {})
    };
  },

  async loadEarlierMessages(item: ForumNotification, cursor: string, options: NotificationAdapterAccess) {
    const page = await readMessageWindow(item, cursor, 'up', options);
    return { messages: page.messages, olderCursor: page.cursor };
  },

  async loadLaterMessages(item: ForumNotification, cursor: string, options: NotificationAdapterAccess) {
    const page = await readMessageWindow(item, cursor, 'down', options);
    return { messages: page.messages, newerCursor: page.cursor };
  },

  async replyToConversation(
    item: ForumNotification,
    content: string,
    options: NotificationAdapterAccess
  ): Promise<NotificationReplyResult> {
    if (item.kind !== 'private-message' || item.target.type !== 'message-detail') {
      throw new Error('妖火私信会话标识不正确');
    }
    let page = await fetchYaohuoHtml(item.target.url, options.fetcher, {
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });
    let form = messageReplyForm(page.html, item.target.url);
    if (!form) {
      const replyUrl = messageReplyLink(page.html, item.target.url);
      if (!replyUrl) throw new Error('妖火私信回复表单未找到');
      page = await fetchYaohuoHtml(replyUrl, options.fetcher, {
        signal: options.signal,
        timeoutMs: options.timeoutMs
      });
      form = messageReplyForm(page.html, replyUrl);
    }
    if (!form) throw new Error('妖火私信回复表单未找到');
    const result = await runYaohuoAction({
      request: buildYaohuoMessageReplyRequest({ ...form, content }),
      fetcher: options.fetcher,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });
    return result.status === 'confirmed'
      ? { confirmed: true, message: result.message }
      : { confirmed: false, message: result.message };
  },

  async markRead(
    item: ForumNotification,
    _detail: NotificationDetail,
    options: NotificationAdapterAccess
  ): Promise<NotificationMarkResult> {
    const page = await readListPage(
      options,
      Math.max(1, Number(item.remoteCursor) || 1),
      false,
      item.remoteGroup || 'all'
    );
    const refreshed = page.items.find((candidate) => candidate.id === item.id);
    return refreshed && !refreshed.unread
      ? { confirmed: true }
      : { confirmed: false, message: '原站仍显示为未读，请稍后重试' };
  }
} satisfies NotificationAdapter;
