import { isRecord, recordText as text, textContentFromHtml, toIsoString } from '@/domain/forum/html';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type {
  ForumNotification,
  NotificationCategory,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage,
  NotificationReplyResult
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
import { xiaoyinsiCredentialsHaveScope } from '@/sources/xiaoyinsi/credentials';
import { sanitizeXiaoyinsiContentHtml } from '@/sources/xiaoyinsi/parser';
import { getDiscourseSourceReplies, getDiscourseSourceReply, getDiscourseSourceTopic } from './discourseRead';
import { buildDiscourseActionRequest, type DiscourseActionRequest } from '@/sources/discourse/actionRequest';

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

const discourseCoreCategories = [
  { id: 'all', label: '所有通知' },
  { id: 'replies', label: '回复' },
  { id: 'likes', label: '赞' },
  { id: 'messages', label: '个人信息' }
] as const satisfies readonly NotificationCategory[];

const discourseChatCategory = { id: 'chat', label: '聊天通知' } as const satisfies NotificationCategory;
const discourseOtherCategory = { id: 'other', label: '其他通知' } as const satisfies NotificationCategory;
const discourseChatTypeNames = new Set([
  'chat_invitation',
  'chat_mention',
  'chat_message',
  'chat_quoted',
  'chat_watched_thread'
]);
const discourseCategoryTypeNames = {
  replies: ['mentioned', 'group_mentioned', 'posted', 'quoted', 'replied'],
  likes: ['liked', 'liked_consolidated', 'reaction'],
  chat: [...discourseChatTypeNames]
} as const;
const discourseExcludedFromOtherTypeNames = new Set([
  ...discourseCategoryTypeNames.replies,
  ...discourseCategoryTypeNames.likes,
  ...discourseCategoryTypeNames.chat,
  'private_message',
  'group_message_summary',
  'bookmark_reminder'
]);

function integer(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function boolean(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function notificationKind(value: unknown) {
  const type = Number(value);
  return typeKinds.get(type) || (knownSystemTypes.has(type) ? 'system' : 'other');
}

async function fetchSite(source: DiscourseSource, options: NotificationAdapterAccess) {
  if (source === 'linuxdo') {
    return fetchLinuxDoJson<Record<string, unknown>>('/site.json', undefined, {
      fetcher: options.fetcher,
      linuxDoAccess: { authenticated: true, userAgent: options.userAgent },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      browserFetchIntent: { owner: 'account', priority: 'background' }
    });
  }
  return fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, {
    credentials: options.xiaoyinsiCredentials,
    fetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

function notificationTypeNames(site: Record<string, unknown>) {
  const types = site.notification_types;
  if (isRecord(types)) return Object.keys(types);
  return Array.isArray(types) ? types.filter((value): value is string => typeof value === 'string') : [];
}

function notificationTypeIds(site: Record<string, unknown>, names: readonly string[]) {
  const types = site.notification_types;
  if (!isRecord(types)) return new Set<number>();
  return new Set(
    names.flatMap((name) => {
      const id = Number(types[name]);
      return Number.isInteger(id) && id > 0 ? [id] : [];
    })
  );
}

async function categoryTypeIds(source: DiscourseSource, categoryId: string, options: NotificationListOptions) {
  if (categoryId === 'all') return undefined;
  const site = await fetchSite(source, options);
  const names =
    categoryId === 'other'
      ? notificationTypeNames(site).filter((name) => !discourseExcludedFromOtherTypeNames.has(name))
      : discourseCategoryTypeNames[categoryId as keyof typeof discourseCategoryTypeNames] || [];
  return notificationTypeIds(site, names);
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
  const kind = notificationKind(value.notification_type);
  const topicUrl = topicId
    ? `${baseUrl}/t/${encodeURIComponent(slug || topicId)}/${encodeURIComponent(topicId)}${postNumber ? `/${postNumber}` : ''}`
    : '';
  const target = topicId
    ? kind === 'private-message'
      ? ({ type: 'private-conversation', conversationId: topicId } as const)
      : postId
        ? ({
            type: 'topic-post',
            topicId,
            ...(postNumber ? { postNumber } : {}),
            postId,
            url: topicUrl
          } as const)
        : postNumber
          ? ({ type: 'topic-post', topicId, postNumber, url: topicUrl } as const)
          : ({ type: 'topic', topicId, url: topicUrl } as const)
    : ({ type: 'information' } as const);
  return {
    source,
    id,
    kind,
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
  const categoryId = options.categoryId || 'all';
  if (!['all', 'replies', 'likes', 'messages', 'chat', 'other'].includes(categoryId)) {
    throw new Error(`${source === 'linuxdo' ? 'linux.do' : '小隐寺'} 消息分类不正确`);
  }
  const params: Record<string, string | number | (string | number)[]> = {
    offset,
    limit,
    filter: options.unreadOnly ? 'unread' : 'all'
  };
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

async function fetchPrivateMessageTopics(source: DiscourseSource, options: NotificationListOptions) {
  const username = options.username?.trim();
  if (!username) throw new Error(`${source === 'linuxdo' ? 'linux.do' : '小隐寺'} 当前账号缺少用户名`);
  const path = `/u/${encodeURIComponent(username)}/user-menu-private-messages`;
  if (source === 'linuxdo') {
    return fetchLinuxDoJson<Record<string, unknown>>(path, undefined, {
      fetcher: options.fetcher,
      linuxDoAccess: { authenticated: true, userAgent: options.userAgent },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      browserFetchIntent: { owner: 'account', priority: 'background' }
    });
  }
  return fetchXiaoyinsiJson<Record<string, unknown>>(path, undefined, {
    credentials: options.xiaoyinsiCredentials,
    fetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

function privateMessageItems(
  source: DiscourseSource,
  data: Record<string, unknown>,
  ownUsername: string,
  unreadOnly: boolean
) {
  if (
    !Array.isArray(data.topics) ||
    !Array.isArray(data.users) ||
    !Array.isArray(data.unread_notifications) ||
    !Array.isArray(data.read_notifications)
  ) {
    throw new Error(`${source === 'linuxdo' ? 'linux.do' : '小隐寺'} 私信列表格式不正确`);
  }
  const users = data.users.filter(isRecord);
  const userById = new Map(users.map((user) => [text(user, 'id'), user]));
  const userByUsername = new Map(users.map((user) => [text(user, 'username'), user]));
  const notifications = [...data.unread_notifications, ...data.read_notifications].flatMap((value) => {
    const item = parseNotification(source, value);
    if (!item || (unreadOnly && !item.unread)) return [];
    if (item.target.type !== 'private-conversation') return [item];
    return [
      {
        ...item,
        id: `private-notification:${item.id}`,
        remoteGroup: 'private-message-notification'
      } satisfies ForumNotification
    ];
  });
  const topics = data.topics.flatMap((value) => {
    if (!isRecord(value)) return [];
    const id = text(value, 'id');
    if (!id) return [];
    const participants = Array.isArray(value.participants) ? value.participants.filter(isRecord) : [];
    const lastPosterUsername = text(value, 'last_poster_username');
    const participant = participants
      .map((entry) => userById.get(text(entry, 'user_id')))
      .find((user) => user && text(user, 'username') !== ownUsername);
    const actor = userByUsername.get(lastPosterUsername) || participant;
    const actorUsername = actor ? text(actor, 'username') : lastPosterUsername;
    const actorName = (actor ? text(actor, 'name') : '') || actorUsername || '站内用户';
    const actorId = actor ? text(actor, 'id') : '';
    const avatarTemplate = actor ? text(actor, 'avatar_template') : '';
    const unread = boolean(value.unread) || Number(value.unread_posts) > 0;
    if (unreadOnly && !unread) return [];
    const createdValue = text(value, 'bumped_at', 'last_posted_at', 'created_at');
    return [
      {
        source,
        id: `private-topic:${id}`,
        kind: 'private-message',
        actor: {
          ...(actorId ? { id: actorId } : {}),
          name: actorName,
          ...(avatarTemplate ? { avatarUrl: discourseAvatarUrl(avatarTemplate, bases[source]) } : {})
        },
        title: text(value, 'fancy_title', 'title') || '个人信息',
        createdAt: toIsoString(createdValue) || null,
        ...(!toIsoString(createdValue) && createdValue ? { displayTime: createdValue } : {}),
        unread,
        target: { type: 'private-conversation', conversationId: id },
        remoteGroup: 'private-message-topic'
      } satisfies ForumNotification
    ];
  });
  return [...notifications, ...topics];
}

function notificationRows(source: DiscourseSource, data: Record<string, unknown>) {
  if (!Array.isArray(data.notifications)) {
    throw new Error(`${source === 'linuxdo' ? 'linux.do' : '小隐寺'} 消息返回内容格式不正确`);
  }
  return data.notifications;
}

function createDiscourseNotificationAdapter(source: DiscourseSource) {
  const readOptions = (options: NotificationAdapterAccess) => ({
    fetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    auth:
      source === 'linuxdo'
        ? { linuxdo: { authenticated: true, userAgent: options.userAgent } }
        : { xiaoyinsi: options.xiaoyinsiCredentials || { apiKey: '', clientId: '' } }
  });

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
    async getCategories(options: NotificationAdapterAccess) {
      let hasChat = source === 'linuxdo';
      try {
        const names = notificationTypeNames(await fetchSite(source, options));
        if (names.length) hasChat = names.some((name) => discourseChatTypeNames.has(name));
      } catch {
        // Category discovery must not block the notification list; linux.do Chat was verified live.
      }
      return [
        ...discourseCoreCategories,
        ...(hasChat ? [discourseChatCategory] : []),
        discourseOtherCategory
      ] satisfies readonly NotificationCategory[];
    },

    async listPage(options: NotificationListOptions): Promise<NotificationPage> {
      const offset = Math.max(0, Number(options.cursor) || 0);
      const limit = Math.max(1, Math.min(60, options.limit || 30));
      if (options.categoryId === 'messages') {
        const data = await fetchPrivateMessageTopics(source, options);
        const items = privateMessageItems(source, data, options.username?.trim() || '', Boolean(options.unreadOnly));
        return { items, cursor: null, hasMore: false };
      }
      const selectedTypeIds = await categoryTypeIds(source, options.categoryId || 'all', options);
      if (selectedTypeIds?.size === 0) return { items: [], cursor: null, hasMore: false };
      const data = await fetchNotifications(source, options, offset, limit);
      const rawRows = notificationRows(source, data);
      const rows = rawRows.filter(
        (row) =>
          (!options.unreadOnly || (isRecord(row) && row.read !== true)) &&
          (!selectedTypeIds || (isRecord(row) && selectedTypeIds.has(Number(row.notification_type))))
      );
      const items = rows.map((row) => parseNotification(source, row)).filter(Boolean) as ForumNotification[];
      const nextOffset = offset + rawRows.length;
      const total = Number(data.total_rows_notifications ?? data.total_rows ?? 0);
      const hasMore =
        rawRows.length > 0 && (data.load_more_notifications === true || (Number.isFinite(total) && total > nextOffset));
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
      if (item.target.type === 'private-conversation') {
        const topic = await getDiscourseSourceTopic(source, item.target.conversationId, {
          ...readOptions(options),
          replyLimit: 30,
          trackVisit: true
        });
        const replies = [...topic.replies];
        let nextPage = topic.replyNextPage;
        let nextOffset = topic.replyNextOffset;
        const cursors = new Set<string>();
        let historyNotice = '';
        while (topic.replyHasMore && nextPage) {
          const cursor = `${nextPage}:${nextOffset ?? ''}`;
          if (cursors.has(cursor)) {
            historyNotice = '原站返回了重复的会话游标，较早消息未继续加载。';
            break;
          }
          cursors.add(cursor);
          const page = await getDiscourseSourceReplies(source, item.target.conversationId, {
            ...readOptions(options),
            limit: 30,
            order: 'oldest',
            position: { kind: 'cursor', page: nextPage, offset: nextOffset ?? null }
          });
          replies.push(...page.items);
          if (!page.hasMore || !page.nextPage) break;
          nextPage = page.nextPage;
          nextOffset = page.nextOffset;
        }
        const ownUsername = options.username?.trim().toLowerCase() || '';
        return {
          notification: item,
          title: topic.title,
          messages: [
            {
              id: String(topic.commentId || `${topic.id}:1`),
              author: topic.author,
              contentHtml: topic.contentHtml,
              createdAt: topic.createdAt,
              mine: Boolean(ownUsername && topic.author.toLowerCase() === ownUsername)
            },
            ...replies.map((reply, index) => ({
              id: String(reply.commentId || `${topic.id}:${reply.floor || index + 2}`),
              author: reply.author,
              contentHtml: reply.contentHtml,
              createdAt: reply.createdAt,
              mine: Boolean(ownUsername && reply.author.toLowerCase() === ownUsername)
            }))
          ],
          reply: {
            format: 'markdown',
            ...(source === 'xiaoyinsi' && !xiaoyinsiCredentialsHaveScope(options.xiaoyinsiCredentials, 'write')
              ? { disabledReason: '小隐寺需要升级写入授权' }
              : {})
          },
          ...(historyNotice ? { historyNotice } : {}),
          topic
        };
      }
      if (item.target.type === 'topic') {
        return {
          notification: item,
          title: item.title,
          contentText: item.preview || item.title,
          topic: {
            source,
            id: item.target.topicId,
            title: item.title,
            author: item.actor.name,
            url: item.target.url,
            createdAt: item.createdAt || ''
          }
        };
      }
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
          auth: readOptions(options).auth
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

    async replyToConversation(
      item: ForumNotification,
      content: string,
      options: NotificationAdapterAccess
    ): Promise<NotificationReplyResult> {
      if (item.target.type !== 'private-conversation' || !/^\d+$/.test(item.target.conversationId)) {
        throw new Error('私信会话标识不正确');
      }
      if (source === 'xiaoyinsi' && !xiaoyinsiCredentialsHaveScope(options.xiaoyinsiCredentials, 'write')) {
        throw new Error('小隐寺需要升级写入授权');
      }
      const request = buildDiscourseActionRequest({
        type: 'reply',
        topicId: item.target.conversationId,
        content
      });
      const result =
        source === 'linuxdo'
          ? await runLinuxDoAction({
              request,
              fetcher: options.fetcher,
              signal: options.signal,
              timeoutMs: options.timeoutMs,
              userAgent: options.userAgent
            })
          : await runXiaoyinsiAction({
              credentials: options.xiaoyinsiCredentials || { apiKey: '', clientId: '' },
              request,
              fetcher: options.fetcher,
              signal: options.signal,
              timeoutMs: options.timeoutMs
            });
      return integer(result.id)
        ? { confirmed: true }
        : { confirmed: false, message: '原站未确认发送成功，请刷新会话后确认。' };
    },

    async markRead(
      item: ForumNotification,
      _detail: NotificationDetail,
      options: NotificationAdapterAccess
    ): Promise<NotificationMarkResult> {
      if (item.target.type === 'private-conversation') return { confirmed: true };
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
