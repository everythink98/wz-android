import { isRecord, textContentFromHtml, toIsoString } from '@/domain/forum/html';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type {
  ForumNotification,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage
} from '@/domain/notifications/models';
import type { NotificationAdapter, NotificationAdapterAccess, NotificationListOptions } from './notificationAdapter';
import { discourseAvatarUrl } from '@/sources/discourse/content';
import { fetchLinuxDoJson } from '@/sources/linuxdo/reader';
import { LINUXDO_BASE_URL } from '@/sources/linuxdo/protocol';
import { runLinuxDoAction } from '@/sources/linuxdo/actionClient';
import { sanitizeLinuxDoContentHtml } from '@/sources/linuxdo/parser';
import { fetchXiaoyinsiJson } from '@/sources/xiaoyinsi/reader';
import { XIAOYINSI_BASE_URL } from '@/sources/xiaoyinsi/protocol';
import { runXiaoyinsiAction } from '@/sources/xiaoyinsi/actionClient';
import { sanitizeXiaoyinsiContentHtml } from '@/sources/xiaoyinsi/parser';
import { getDiscourseSourceReply } from './discourseRead';
import type { DiscourseActionRequest } from '@/sources/discourse/actionRequest';

const bases: Record<DiscourseSource, string> = {
  linuxdo: LINUXDO_BASE_URL,
  xiaoyinsi: XIAOYINSI_BASE_URL
};

const typeKinds = new Map<number, ForumNotification['kind']>([
  [1, 'mention'],
  [15, 'mention'],
  [29, 'mention'],
  [32, 'mention'],
  [2, 'reply'],
  [3, 'reply'],
  [33, 'reply'],
  [6, 'private-message'],
  [7, 'private-message'],
  [16, 'private-message'],
  [5, 'reaction'],
  [19, 'reaction'],
  [25, 'reaction']
]);

const knownSystemTypes = new Set([
  4, 8, 9, 10, 11, 12, 13, 14, 17, 18, 20, 21, 22, 23, 24, 26, 27, 28, 30, 31, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
  44, 45, 800, 801, 802, 900
]);

function text(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
  }
  return '';
}

function integer(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function notificationKind(value: unknown) {
  const type = Number(value);
  return typeKinds.get(type) || (knownSystemTypes.has(type) ? 'system' : 'other');
}

function parseNotification(source: DiscourseSource, value: unknown): ForumNotification | null {
  if (!isRecord(value)) return null;
  const id = text(value, 'id');
  if (!id) return null;
  const data = isRecord(value.data) ? value.data : {};
  const actorName =
    text(value, 'acting_user_name') ||
    text(data, 'display_username', 'username', 'original_username', 'acting_user_name') ||
    '站内消息';
  const topicId = text(value, 'topic_id') || text(data, 'topic_id');
  const postNumber = integer(value.post_number ?? data.post_number);
  const postId = text(value, 'post_id') || text(data, 'original_post_id', 'post_id');
  const slug = text(value, 'slug') || text(data, 'topic_slug');
  const baseUrl = bases[source];
  const createdValue = text(value, 'created_at');
  const title =
    text(value, 'fancy_title') || text(data, 'topic_title', 'fancy_title', 'message', 'badge_name') || '站内消息';
  const preview = textContentFromHtml(text(data, 'excerpt', 'post_excerpt', 'description'));
  const avatarTemplate = text(value, 'acting_user_avatar_template') || text(data, 'avatar_template');
  const target = topicId
    ? ({
        type: 'topic-post',
        topicId,
        ...(postNumber ? { postNumber } : {}),
        ...(postId ? { postId } : {}),
        url: `${baseUrl}/t/${encodeURIComponent(slug || topicId)}/${encodeURIComponent(topicId)}${postNumber ? `/${postNumber}` : ''}`
      } as const)
    : ({ type: 'information' } as const);
  return {
    source,
    id,
    kind: notificationKind(value.notification_type),
    actor: {
      name: actorName,
      ...(actorName !== '站内消息' ? { id: actorName } : {}),
      ...(avatarTemplate ? { avatarUrl: discourseAvatarUrl(avatarTemplate, baseUrl) } : {})
    },
    title,
    ...(preview ? { preview } : {}),
    createdAt: toIsoString(createdValue) || null,
    ...(!toIsoString(createdValue) && createdValue ? { displayTime: createdValue } : {}),
    unread: value.read !== true,
    target,
    remoteGroup: String(value.notification_type ?? ''),
    remoteReadId: id
  };
}

async function fetchNotifications(
  source: DiscourseSource,
  options: NotificationListOptions,
  offset: number,
  limit: number
) {
  const params = { offset, limit, filter: options.unreadOnly ? 'unread' : 'all' };
  if (source === 'linuxdo') {
    return fetchLinuxDoJson<Record<string, unknown>>('/notifications', params, {
      fetcher: options.fetcher,
      linuxDoAccess: { authenticated: true, userAgent: options.userAgent },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      browserFetchIntent: { owner: 'account', priority: 'background' }
    });
  }
  return fetchXiaoyinsiJson<Record<string, unknown>>('/notifications', params, {
    credentials: options.xiaoyinsiCredentials,
    fetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

function notificationRows(source: DiscourseSource, data: Record<string, unknown>) {
  if (!Array.isArray(data.notifications)) {
    throw new Error(`${source === 'linuxdo' ? 'linux.do' : '小隐寺'} 消息返回内容格式不正确`);
  }
  return data.notifications;
}

function createDiscourseNotificationAdapter(source: DiscourseSource) {
  const runMarkRead = async (id: string | undefined, options: NotificationAdapterAccess) => {
    if (id && !/^\d+$/.test(id)) throw new Error('站内消息标识不正确');
    const request: DiscourseActionRequest = {
      path: '/notifications/mark-read',
      method: 'PUT' as const,
      headers: id ? { 'content-type': 'application/x-www-form-urlencoded' } : ({} as Record<string, string>),
      ...(id ? { body: new URLSearchParams({ id }).toString() } : {})
    };
    if (source === 'linuxdo') {
      await runLinuxDoAction({
        request,
        fetcher: options.fetcher,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        userAgent: options.userAgent
      });
      return;
    }
    if (!options.xiaoyinsiCredentials) throw new Error('请先升级小隐寺消息授权');
    await runXiaoyinsiAction({
      credentials: options.xiaoyinsiCredentials,
      request,
      fetcher: options.fetcher,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    });
  };

  return {
    async listPage(options: NotificationListOptions): Promise<NotificationPage> {
      const offset = Math.max(0, Number(options.cursor) || 0);
      const limit = Math.max(1, Math.min(60, options.limit || 30));
      const data = await fetchNotifications(source, options, offset, limit);
      const rows = notificationRows(source, data);
      const items = rows.map((row) => parseNotification(source, row)).filter(Boolean) as ForumNotification[];
      const nextOffset = offset + rows.length;
      const total = Number(data.total_rows_notifications ?? data.total_rows ?? 0);
      const hasMore = data.load_more_notifications === true || (Number.isFinite(total) && total > nextOffset);
      return { items, cursor: hasMore ? String(nextOffset) : null, hasMore };
    },

    async readUnreadSnapshot(options: NotificationAdapterAccess) {
      const data = await fetchNotifications(source, { ...options, unreadOnly: true, limit: 60 }, 0, 60);
      const rows = notificationRows(source, data);
      const rawTotal = Number(data.total_rows_notifications ?? data.total_rows ?? rows.length);
      const total = Number.isFinite(rawTotal) && rawTotal >= 0 ? rawTotal : rows.length;
      return { total, checkedAt: new Date().toISOString() };
    },

    async loadDetail(item: ForumNotification, options: NotificationAdapterAccess): Promise<NotificationDetail> {
      if (item.target.type !== 'topic-post') {
        return { notification: item, title: item.title, contentText: item.preview || item.title };
      }
      let contentHtml = '';
      let author = item.actor.name;
      let createdAt = item.createdAt || '';
      if (item.target.postId) {
        const path = `/posts/${encodeURIComponent(item.target.postId)}.json`;
        const data =
          source === 'linuxdo'
            ? await fetchLinuxDoJson<Record<string, unknown>>(path, undefined, {
                fetcher: options.fetcher,
                linuxDoAccess: { authenticated: true, userAgent: options.userAgent },
                signal: options.signal,
                timeoutMs: options.timeoutMs,
                browserFetchIntent: { owner: 'topic', priority: 'foreground' }
              })
            : await fetchXiaoyinsiJson<Record<string, unknown>>(path, undefined, {
                credentials: options.xiaoyinsiCredentials,
                fetcher: options.fetcher,
                signal: options.signal,
                timeoutMs: options.timeoutMs
              });
        const cooked = text(data, 'cooked');
        if (!cooked) throw new Error('站内消息对应的帖子内容未找到');
        contentHtml =
          source === 'linuxdo'
            ? sanitizeLinuxDoContentHtml(cooked, undefined)
            : sanitizeXiaoyinsiContentHtml(cooked, undefined);
        author = text(data, 'username') || author;
        createdAt = toIsoString(text(data, 'created_at')) || createdAt;
      } else if (item.target.postNumber) {
        const reply = await getDiscourseSourceReply(source, item.target.topicId, item.target.postNumber, {
          fetcher: options.fetcher,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          auth:
            source === 'linuxdo'
              ? { linuxdo: { authenticated: true, userAgent: options.userAgent } }
              : { xiaoyinsi: options.xiaoyinsiCredentials || { apiKey: '', clientId: '' } }
        });
        contentHtml = reply.contentHtml;
        author = reply.author || author;
        createdAt = reply.createdAt || createdAt;
      } else {
        throw new Error('站内消息没有可定位的帖子');
      }
      return {
        notification: item,
        title: item.title,
        contentHtml,
        topic: {
          source,
          id: item.target.topicId,
          title: item.title,
          author,
          url: item.target.url,
          createdAt,
          replyCount: 0
        }
      };
    },

    async markRead(
      item: ForumNotification,
      _detail: NotificationDetail,
      options: NotificationAdapterAccess
    ): Promise<NotificationMarkResult> {
      const id = item.remoteReadId || item.id;
      await runMarkRead(id, options);
      return { confirmed: true };
    },

    async markAllRead(options: NotificationAdapterAccess): Promise<NotificationMarkResult> {
      await runMarkRead(undefined, options);
      return { confirmed: true };
    }
  };
}

export const discourseNotificationAdapters = {
  linuxdo: createDiscourseNotificationAdapter('linuxdo'),
  xiaoyinsi: createDiscourseNotificationAdapter('xiaoyinsi')
} satisfies Record<DiscourseSource, NotificationAdapter>;
