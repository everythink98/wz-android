import { elementText, hasRenderableHtmlContent, parseHtml, toIsoString } from '@/domain/forum/html';
import type {
  ForumNotification,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage
} from '@/domain/notifications/models';
import type {
  NotificationAdapter,
  NotificationAdapterAccess,
  NotificationListOptions
} from '@/sources/notificationAdapter';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { fetchYaohuoHtml } from './reader';
import { YAOHUO_BASE_URL } from './protocol';

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

async function readListPage(options: NotificationAdapterAccess, page: number, unreadOnly = false) {
  const result = await fetchYaohuoHtml(`${YAOHUO_BASE_URL}/bbs/messagelist.aspx?page=${page}`, options.fetcher, {
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
  return parsePage(result.html, unreadOnly);
}

export const yaohuoNotificationAdapter = {
  async listPage(options: NotificationListOptions): Promise<NotificationPage> {
    const page = Math.max(1, Number(options.cursor) || 1);
    return readListPage(options, page, options.unreadOnly);
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
    const messages = [
      {
        id: item.id,
        author: item.actor.name,
        contentHtml,
        createdAt: item.createdAt,
        mine: false
      }
    ];
    return { notification: item, title: item.title, messages };
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
