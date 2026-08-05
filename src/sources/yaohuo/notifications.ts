import { elementText, hasRenderableHtmlContent, parseHtml, toIsoString } from '@/domain/forum/html';
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
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
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

function messageId(href: string) {
  try {
    const url = new URL(href.replace(/&amp;/gi, '&'), YAOHUO_BASE_URL);
    if (!/^\/bbs\/messagelist_(?:view|del)\.aspx$/i.test(url.pathname)) return '';
    const id = url.searchParams.get('id') || '';
    return /^\d+$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

function parsePage(html: string, unreadOnly = false): NotificationPage {
  const root = parseHtml(html);
  const rows = root.querySelectorAll('.listmms');
  const explicitEmpty =
    /(?:暂无|没有|无)(?:任何|新的?)?(?:站内|短|私)?(?:消息|短信|私信)(?:记录)?|(?:消息|短信|私信)(?:列表)?为空/.test(
      elementText(root)
    );
  if (!rows.length && !explicitEmpty) throw new Error('妖火消息列表格式不正确');
  if (
    rows.length &&
    !rows.some((row) => row.querySelectorAll('a[href]').some((link) => messageId(link.getAttribute('href') || '')))
  ) {
    throw new Error('妖火消息列表格式不正确');
  }
  const items = rows.flatMap((row) => {
    const link = row.querySelectorAll('a[href]').find((candidate) => messageId(candidate.getAttribute('href') || ''));
    const id = messageId(link?.getAttribute('href') || '');
    if (!id) return [];
    const rowText = elementText(row);
    const actionLabels = new Set(
      row
        .querySelectorAll('a[href]')
        .filter((candidate) => /messagelist_del\.aspx/i.test(candidate.getAttribute('href') || ''))
        .map((candidate) =>
          elementText(candidate)
            .replace(/^\[|\]$/g, '')
            .trim()
        )
    );
    const inlineTime = rowText.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?/)?.[0];
    const displayTime =
      inlineTime ||
      [...rowText.matchAll(/\[([^\[\]]+)\]/g)]
        .map((match) => match[1]?.trim() || '')
        .reverse()
        .find((candidate) => candidate && !actionLabels.has(candidate));
    const actor =
      rowText.match(/来自\s*(.+?)(?=\s*\[|\s+\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?|$)/)?.[1]?.trim() ||
      '妖火用户';
    const unread = row
      .querySelectorAll('img[src]')
      .some((image) => /(?:^|\/)new\.gif(?:$|[?#])/i.test(image.getAttribute('src') || ''));
    if (unreadOnly && !unread) return [];
    const title = elementText(link) || '站内消息';
    const createdAt = toIsoString(displayTime, '+08:00') || null;
    return [
      {
        source: 'yaohuo',
        id,
        kind: /系统(?:通知|消息)?|管理员/.test(actor) ? 'system' : 'private-message',
        actor: { name: actor },
        title,
        createdAt,
        ...(!createdAt && displayTime ? { displayTime } : {}),
        unread,
        target: {
          type: 'message-detail',
          messageId: id,
          url: `${YAOHUO_BASE_URL}/bbs/messagelist_view.aspx?id=${encodeURIComponent(id)}`
        },
        remoteGroup: String(currentPage(root)),
        remoteReadId: id
      } satisfies ForumNotification
    ];
  });
  const pageText = elementText(root.querySelector('.showpage'));
  const match = pageText.match(/(\d+)\s*\/\s*(\d+)\s*页/);
  const current = Number(match?.[1]) || 1;
  const total = Number(match?.[2]) || current;
  const hasMore = current < total;
  return { items, cursor: hasMore ? String(current + 1) : null, hasMore };
}

function currentPage(root: ReturnType<typeof parseHtml>) {
  const match = elementText(root.querySelector('.showpage')).match(/(\d+)\s*\/\s*\d+\s*页/);
  return Number(match?.[1]) || 1;
}

function detailContentHtml(html: string, detailUrl: string) {
  const root = parseHtml(html);
  const label = root.querySelectorAll('b').find((candidate) => /^内容\s*[：:]$/.test(elementText(candidate)));
  if (!label) return '';
  const siblings = label.parentNode?.childNodes || [];
  const fragments: string[] = [];
  for (const node of siblings.slice(siblings.indexOf(label) + 1)) {
    const element = node as unknown as { getAttribute?: (name: string) => string | undefined };
    const href = element.getAttribute?.('href') || '';
    if (/\/bbs\/messagelist_(?:add|del)\.aspx/i.test(href)) break;
    fragments.push(node.toString());
  }
  const content = sanitizeContentHtml(fragments.join(''), detailUrl);
  return hasRenderableHtmlContent(content) ? content : '';
}

function chatContentHtml(value: string, detailUrl: string) {
  const wrapper = parseHtml(`<div id="yaohuo-chat-content">${value}</div>`).querySelector('#yaohuo-chat-content');
  const content = (wrapper?.innerHTML || '')
    .replace(
      /^(?:\s|&nbsp;)*回复时间\s*[：:]\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?(?:(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*)?/i,
      ''
    )
    .replace(/^(?:\s|&nbsp;)*回复内容\s*[：:]?(?:(?:\s|&nbsp;)*<br\s*\/?>(?:\s|&nbsp;)*)?/i, '')
    .replace(/(?:(?:\s|&nbsp;)|<br\s*\/?>|\|)+$/gi, '');
  return sanitizeContentHtml(content, detailUrl);
}

function messageContentKey(value: string) {
  const root = parseHtml(value);
  const text = elementText(root).replace(/\s+/g, ' ').trim();
  const images = root
    .querySelectorAll('img[src]')
    .map((image) => image.getAttribute('src') || '')
    .filter(Boolean)
    .join('|');
  return `${text}\u0000${images}`;
}

function removeOriginalMessage(messages: NotificationMessage[], contentHtml: string) {
  const originalKey = messageContentKey(contentHtml);
  const duplicateIndex = messages.findIndex((message) => messageContentKey(message.contentHtml || '') === originalKey);
  return duplicateIndex < 0 ? messages : messages.filter((_, index) => index !== duplicateIndex);
}

function chatMessages(html: string, detailUrl: string, otherAuthor: string) {
  const messages = parseHtml(html)
    .querySelectorAll('.listmms')
    .flatMap((row, index) => {
      const className = row.getAttribute('class') || '';
      const mine = /(?:^|\s)the_me(?:\s|$)/.test(className);
      if (!mine && !/(?:^|\s)the_user(?:\s|$)/.test(className)) return [];
      const content = row.querySelector('.bubble .con') || row.querySelector('.con');
      const rawContent = content?.innerHTML || '';
      const contentHtml = chatContentHtml(rawContent, detailUrl);
      if (!hasRenderableHtmlContent(contentHtml)) return [];
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
          contentHtml,
          createdAt: toIsoString(displayTime, '+08:00') || null,
          mine
        }
      ];
    });
  return messages.sort((left, right) => {
    if (!left.createdAt) return right.createdAt ? 1 : 0;
    if (!right.createdAt) return -1;
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
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
  return parsePage(result.html, unreadOnly);
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
    while (hasMore && items.length < 60) {
      const page = await readListPage(options, cursor, true);
      items.push(...page.items.slice(0, 60 - items.length));
      hasMore = page.hasMore;
      cursor = Number(page.cursor) || cursor + 1;
    }
    return {
      total: items.length,
      checkedAt: new Date().toISOString()
    };
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
    const contentHtml = detailContentHtml(result.html, detailUrl);
    if (!contentHtml) throw new Error('妖火消息对应的正文未找到');
    const replyable = item.kind === 'private-message';
    return {
      notification: item,
      title: item.title,
      contentHtml,
      ...(replyable
        ? {
            messages: removeOriginalMessage(chatMessages(result.html, detailUrl, item.actor.name), contentHtml),
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
    const page = await readListPage(options, Math.max(1, Number(item.remoteGroup) || 1));
    const refreshed = page.items.find((candidate) => candidate.id === item.id);
    return refreshed && !refreshed.unread
      ? { confirmed: true }
      : { confirmed: false, message: '原站仍显示为未读，请稍后重试' };
  }
} satisfies NotificationAdapter;
