import { elementText, hasRenderableHtmlContent, parseHtml, toIsoString } from '@/domain/forum/html';
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
import { fetchYaohuoHtml } from './reader';
import { YAOHUO_BASE_URL } from './protocol';
import { buildYaohuoMessageReplyRequest } from './actionRequest';
import { runYaohuoAction } from './actionClient';

const yaohuoNotificationCategories = [
  { id: 'all', label: '收件箱' },
  { id: 'system', label: '系统' },
  { id: 'chat', label: '聊天' }
] as const satisfies readonly NotificationCategory[];

const absoluteChatTimePattern = /\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/;

type ParsedNotificationMessage = NotificationMessage & { contentKey: string };

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
  page: ReturnType<typeof parseHtml>,
  detailUrl: string,
  otherAuthor: string,
  originalId: string
): NotificationMessage[] {
  return page
    .querySelectorAll('.chat-list .chat-msg')
    .flatMap((row) => {
      const id = row.getAttribute('data-message-id') || '';
      if (!/^\d+$/.test(id) || id === originalId) return [];
      const mine = row.classList.contains('chat-msg--out');
      const notice = row.classList.contains('chat-msg--notice');
      if (!mine && !notice && !row.classList.contains('chat-msg--in')) return [];
      const content = currentChatContent(row, detailUrl);
      if (!hasRenderableHtmlContent(content.contentHtml, content.root)) return [];
      const time = `${row.getAttribute('data-date') || ''} ${elementText(row.querySelector('.chat-time'))}`;
      return [
        {
          id: `chat:${id}`,
          author: mine ? '我' : notice ? '系统' : otherAuthor,
          contentHtml: content.contentHtml,
          createdAt: toIsoString(time, '+08:00') || null,
          mine
        }
      ];
    })
    .sort(
      (left, right) =>
        (left.createdAt ? Date.parse(left.createdAt) : Number.POSITIVE_INFINITY) -
        (right.createdAt ? Date.parse(right.createdAt) : Number.POSITIVE_INFINITY)
    );
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
    let cursor = 1;
    let hasMore = true;
    const items: ForumNotification[] = [];
    const pages: NotificationPage[] = [];
    const seenCursors = new Set<number>([cursor]);
    while (hasMore && items.length < 60) {
      const page = await readListPage(options, cursor, true);
      const qualityError = notificationPageError(page.quality);
      if (qualityError) throw qualityError;
      if (items.length + page.items.length > 60) throw new Error('妖火未读数量尚未完整读取');
      pages.push(page);
      items.push(...page.items);
      hasMore = page.hasMore;
      if (hasMore) {
        const next = Number(page.cursor);
        if (!Number.isSafeInteger(next) || next < 1 || seenCursors.has(next)) throw new Error('妖火消息分页格式不正确');
        seenCursors.add(next);
        cursor = next;
      }
    }
    if (hasMore) throw new Error('妖火未读数量尚未完整读取');
    return mergeSourceDiagnosticSummaries(
      {
        total: new Set(items.map((item) => item.id)).size,
        checkedAt: new Date().toISOString()
      },
      'yaohuo-notifications',
      pages
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
      const anchors = page.querySelectorAll('.chat-list .chat-msg.is-anchor');
      const anchor = anchors[0];
      const id = item.target.messageId;
      if (
        page.getAttribute('data-message-id') !== id ||
        anchors.length !== 1 ||
        anchor?.getAttribute('data-message-id') !== id
      )
        throw new Error('妖火消息对应的正文未找到');
      const content = currentChatContent(anchor, detailUrl);
      if (!hasRenderableHtmlContent(content.contentHtml, content.root)) throw new Error('妖火消息对应的正文未找到');
      const replyable = item.kind === 'private-message';
      const partnerId = page.getAttribute('data-partner-id') || '';
      const actorId =
        replyable && /^\d+$/.test(partnerId) && Number.isSafeInteger(Number(partnerId)) && Number(partnerId) > 0
          ? partnerId
          : undefined;
      return {
        notification: actorId ? { ...item, actor: { ...item.actor, id: actorId } } : item,
        title: item.title,
        contentHtml: content.contentHtml,
        ...(replyable
          ? {
              messages: currentChatMessages(page, detailUrl, item.actor.name, id),
              reply: { format: 'plain-text' as const },
              historyNotice: '仅展示原站当前返回的聊天记录。'
            }
          : {})
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
