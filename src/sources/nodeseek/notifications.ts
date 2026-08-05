import { absoluteUrl, isRecord, toIsoString } from '@/domain/forum/html';
import type {
  ForumNotification,
  NotificationCategory,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage,
  NotificationReplyResult
} from '@/domain/notifications/models';
import type {
  NotificationAdapter,
  NotificationAdapterAccess,
  NotificationListOptions
} from '@/sources/notificationAdapter';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from '@/platform/android/nodeSeekUserAgent';
import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import { isNodeSeekChallengeResponse, NODESEEK_BASE_URL, NODESEEK_FLOORS_PER_PAGE, nodeSeekTopicUrl } from './protocol';
import { runNodeSeekAction } from './actionClient';
import { getNodeSeekReplies, getNodeSeekTopic } from './reader';
import { nodeSeekMarkdownToHtml } from './markdown';

type NodeSeekGroup = 'at-me' | 'reply-to-me' | 'message';

const nodeSeekNotificationCategories = [
  { id: 'all', label: '全部' },
  { id: 'mentions', label: '@我' },
  { id: 'replies', label: '回复主题' },
  { id: 'messages', label: '私信' }
] as const satisfies readonly NotificationCategory[];

const nodeSeekGroupByCategory: Record<string, NodeSeekGroup> = {
  mentions: 'at-me',
  replies: 'reply-to-me',
  messages: 'message'
};

const groupConfig = {
  'at-me': { kind: 'mention', listKey: ['atList', 'notifications', 'list', 'data'] },
  'reply-to-me': { kind: 'reply', listKey: ['replyList', 'notifications', 'list', 'data'] },
  message: {
    kind: 'private-message',
    listKey: ['msgArray', 'messageList', 'conversations', 'notifications', 'list', 'data']
  }
} as const;

const explicitKinds: Record<string, ForumNotification['kind']> = {
  mention: 'mention',
  'at-me': 'mention',
  atme: 'mention',
  reply: 'reply',
  'reply-to-me': 'reply',
  replytome: 'reply',
  message: 'private-message',
  'private-message': 'private-message',
  privatemessage: 'private-message',
  pm: 'private-message'
};

function text(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
  }
  return '';
}

function bool(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string' && /^(?:true|false|0|1)$/i.test(value.trim())) {
      return /^(?:true|1)$/i.test(value.trim());
    }
  }
  return undefined;
}

function findRows(value: unknown, keys: readonly string[]): Record<string, unknown>[] | undefined {
  if (Array.isArray(value)) return value.every(isRecord) ? value : undefined;
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    if (!(key in value)) continue;
    const rows = findRows(value[key], keys);
    if (rows) return rows;
  }
  return undefined;
}

function hasMore(value: unknown, page: number, rowCount: number) {
  if (!isRecord(value)) return false;
  const explicit = bool(value, 'hasMore', 'has_more', 'more');
  if (explicit !== undefined) return explicit;
  const pages = Number(text(value, 'totalPages', 'total_pages', 'pages'));
  if (Number.isFinite(pages) && pages > 0) return page < pages;
  return rowCount >= 30;
}

function count(value: unknown, ...keys: string[]): number {
  if (!isRecord(value)) return 0;
  for (const key of keys) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }
  for (const child of Object.values(value)) {
    const nested = count(child, ...keys);
    if (nested) return nested;
  }
  return 0;
}

async function fetchJson(path: string, options: NotificationAdapterAccess) {
  const response = await fetchWithTimeout(
    `${NODESEEK_BASE_URL}${path}`,
    withBrowserFetchIntent(
      {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: `${NODESEEK_BASE_URL}/notification`,
          'User-Agent': options.userAgent || DEFAULT_NODESEEK_ANDROID_USER_AGENT,
          'X-Requested-With': 'XMLHttpRequest'
        }
      },
      { owner: 'account', priority: 'background' }
    ),
    options
  );
  const body = await response.text();
  if (isNodeSeekChallengeResponse(response, body, response.url || `${NODESEEK_BASE_URL}${path}`)) {
    throw Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
      source: 'nodeseek',
      reason: 'cloudflare'
    });
  }
  let data: unknown;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error('NodeSeek 消息返回内容格式不正确');
  }
  if (!response.ok) {
    const message = isRecord(data) ? text(data, 'message', 'error') : '';
    const error = new Error(message || `NodeSeek 消息请求失败：HTTP ${response.status}`);
    if (response.status === 401 || response.status === 403) {
      Object.assign(error, { source: 'nodeseek', loginRequired: true });
    }
    throw error;
  }
  return data;
}

function integer(value: string) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function stableFallbackId(...parts: string[]) {
  if (!parts.some(Boolean)) return '';
  const value = parts.join('\u001f');
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return `fallback:${(hash >>> 0).toString(36)}`;
}

function counterpart(row: Record<string, unknown>, ownUserId: string) {
  const senderId = text(row, 'sender_id', 'from', 'member_id', 'uid');
  const receiverId = text(row, 'receiver_id', 'to', 'target_id');
  return senderId === ownUserId ? receiverId : senderId || receiverId;
}

function notificationKind(group: NodeSeekGroup, row: Record<string, unknown>) {
  const explicit = text(row, 'notification_type', 'notificationType', 'notification_kind');
  if (!explicit) return groupConfig[group].kind;
  return explicitKinds[explicit.toLowerCase().replace(/_/g, '-')] || 'other';
}

function rowNotification(group: NodeSeekGroup, row: Record<string, unknown>, ownUserId: string) {
  const rawId = text(row, 'id');
  const postId = text(row, 'post_id', 'postId', 'discussion_id');
  const senderId = text(row, 'sender_id', 'from', 'member_id', 'uid');
  const actorId =
    group === 'message'
      ? counterpart(row, ownUserId)
      : text(row, 'member_id', 'commenter_id', 'sender_id', 'uid', 'user_id');
  const createdValue = text(row, 'created_at', 'createdAt', 'time', 'sent_at', 'last_time');
  const preview = text(row, 'content', 'comment_content', 'excerpt', 'message', 'last_content');
  const floorValue = text(row, 'floor_id', 'floor', 'floorId');
  const remoteId =
    group === 'message'
      ? rawId || (createdValue ? stableFallbackId(createdValue) : '')
      : text(row, 'comment_id', 'message_id') ||
        rawId ||
        (floorValue || createdValue ? stableFallbackId(postId, floorValue, createdValue) : '');
  if (!remoteId) return null;
  const createdAt = toIsoString(createdValue) || null;
  const actorName =
    group === 'message'
      ? senderId === ownUserId
        ? text(row, 'receiver_name', 'target_name', 'member_name', 'username', 'name') || 'NodeSeek 用户'
        : text(row, 'sender_name', 'member_name', 'username', 'name') || 'NodeSeek 用户'
      : text(row, 'commenter_name', 'username', 'sender_name', 'name') || 'NodeSeek 用户';
  const actorAvatar = absoluteUrl(
    text(row, 'avatar', 'avatar_url') || (actorId ? `/avatar/${encodeURIComponent(actorId)}.png` : ''),
    NODESEEK_BASE_URL
  );
  const title =
    group === 'message'
      ? actorName
      : text(row, 'post_title', 'discussion_title', 'title') || (group === 'at-me' ? '提到了你' : '回复了你');
  const floor = integer(floorValue);
  const target =
    group === 'message'
      ? ({ type: 'private-conversation', conversationId: actorId } as const)
      : ({
          type: 'topic-post',
          topicId: postId,
          ...(floor ? { postNumber: floor } : {}),
          ...(text(row, 'comment_id') ? { postId: text(row, 'comment_id') } : {}),
          url: nodeSeekTopicUrl(postId)
        } as const);
  if ((target.type === 'private-conversation' && !target.conversationId) || (target.type === 'topic-post' && !postId)) {
    return null;
  }
  return {
    source: 'nodeseek',
    id: `${group}:${remoteId}`,
    kind: notificationKind(group, row),
    actor: {
      ...(actorId ? { id: actorId } : {}),
      ...(actorAvatar ? { avatarUrl: actorAvatar } : {}),
      name: actorName
    },
    title,
    ...(preview ? { preview } : {}),
    createdAt,
    ...(!createdAt && createdValue ? { displayTime: createdValue } : {}),
    unread:
      group === 'message'
        ? Boolean(senderId && senderId !== ownUserId && !(bool(row, 'viewed', 'is_read', 'read') ?? false))
        : !(bool(row, 'viewed', 'is_read', 'read') ?? false),
    target,
    remoteGroup: group,
    ...(rawId ? { remoteReadId: rawId } : {})
  } satisfies ForumNotification;
}

function sortKnownTimes(items: ForumNotification[]) {
  return items
    .map((item, index) => ({
      item,
      index,
      time: item.createdAt ? Date.parse(item.createdAt) : Number.NEGATIVE_INFINITY
    }))
    .sort((left, right) => right.time - left.time || left.index - right.index)
    .map(({ item }) => item);
}

export const nodeSeekNotificationAdapter = {
  async getCategories(_options: NotificationAdapterAccess) {
    return nodeSeekNotificationCategories;
  },

  async listPage(options: NotificationListOptions): Promise<NotificationPage> {
    const page = Math.max(1, Number(options.cursor) || 1);
    const selectedGroup = options.categoryId ? nodeSeekGroupByCategory[options.categoryId] : undefined;
    if (options.categoryId && options.categoryId !== 'all' && !selectedGroup) {
      throw new Error('NodeSeek 消息分类不正确');
    }
    const groups = selectedGroup ? [selectedGroup] : (Object.keys(groupConfig) as NodeSeekGroup[]);
    const results = await Promise.all(
      groups.map(async (group) => {
        const data = await fetchJson(`/api/notification/${group}/list?page=${page}`, options);
        const rows = findRows(data, groupConfig[group].listKey);
        if (!rows) throw new Error('NodeSeek 消息返回内容格式不正确');
        return {
          items: rows.map((row) => rowNotification(group, row, options.userId)).filter(Boolean),
          hasMore: hasMore(data, page, rows.length)
        };
      })
    );
    const parsedItems = results.flatMap((result) => result.items) as ForumNotification[];
    const idCounts = new Map<string, number>();
    parsedItems.forEach((item) => idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1));
    const items = sortKnownTimes(parsedItems).filter(
      (item) =>
        (!options.unreadOnly || item.unread) &&
        !(item.id.startsWith('message:fallback:') && (idCounts.get(item.id) || 0) > 1)
    );
    const more = results.some((result) => result.hasMore);
    return { items, cursor: more ? String(page + 1) : null, hasMore: more };
  },

  async readUnreadSnapshot(options: NotificationAdapterAccess) {
    const data = await fetchJson('/api/notification/unread-count', options);
    const total =
      count(data, 'atMe', 'at_me', 'mention') +
      count(data, 'reply', 'replyCount') +
      count(data, 'message', 'messages', 'msg');
    return { total, checkedAt: new Date().toISOString() };
  },

  async loadDetail(item: ForumNotification, options: NotificationAdapterAccess): Promise<NotificationDetail> {
    if (item.target.type === 'private-conversation') {
      const conversationId = item.target.conversationId;
      const data = await fetchJson(`/api/notification/message/with/${encodeURIComponent(conversationId)}`, options);
      const rows = findRows(data, ['msgArray', 'messageList', 'list', 'data']);
      if (!rows) throw new Error('NodeSeek 消息返回内容格式不正确');
      const messages = rows
        .flatMap((row, index) => {
          const id = text(row, 'id', 'message_id', 'msg_id') || `${conversationId}:${index}`;
          const content = text(row, 'content', 'message');
          if (!content) return [];
          const senderId = text(row, 'sender_id', 'from', 'member_id', 'uid');
          const createdValue = text(row, 'created_at', 'time', 'sent_at');
          const isMarkdown = bool(row, 'is_markdown', 'markdown') ?? true;
          return [
            {
              id,
              author: senderId === options.userId ? '我' : item.actor.name,
              ...(isMarkdown ? { contentHtml: nodeSeekMarkdownToHtml(content) } : { contentText: content }),
              createdAt: toIsoString(createdValue) || null,
              mine: senderId === options.userId,
              unread: !(bool(row, 'viewed', 'is_read', 'read') ?? true),
              senderId,
              index
            }
          ];
        })
        .sort((left, right) => {
          const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NEGATIVE_INFINITY;
          const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NEGATIVE_INFINITY;
          return leftTime - rightTime || left.index - right.index;
        });
      return {
        notification: item,
        title: item.actor.name,
        messages: messages.map(({ unread: _unread, senderId: _senderId, index: _index, ...message }) => message),
        reply: { format: 'markdown' },
        unreadMessageIds: messages
          .filter((message) => message.unread && message.senderId === conversationId && /^\d+$/.test(message.id))
          .map((message) => message.id)
      };
    }
    if (item.target.type !== 'topic-post') {
      return { notification: item, title: item.title, contentText: item.preview };
    }
    const readerOptions = {
      authenticated: true,
      fetcher: options.fetcher,
      nodeSeekUserAgent: options.userAgent,
      signal: options.signal,
      timeoutMs: options.timeoutMs
    };
    const topic = await getNodeSeekTopic(item.target.topicId, readerOptions);
    const floor = item.target.postNumber;
    const commentId = integer(item.target.postId || '');
    if (!commentId && (!floor || floor <= 1)) {
      return { notification: item, title: topic.title, contentHtml: topic.contentHtml, topic };
    }
    const matchesTarget = (candidate: (typeof topic.replies)[number]) =>
      commentId ? candidate.commentId === commentId : candidate.floor === floor;
    let reply = topic.replies.find(matchesTarget);
    if (!reply) {
      const hintedPage = floor && floor > 1 ? Math.floor((floor - 1) / NODESEEK_FLOORS_PER_PAGE) + 1 : 2;
      const lastPage = commentId
        ? Math.max(hintedPage, Math.ceil(topic.replyCount / NODESEEK_FLOORS_PER_PAGE))
        : hintedPage;
      const pages = commentId
        ? [
            hintedPage,
            ...Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2).filter(
              (page) => page !== hintedPage
            )
          ]
        : [hintedPage];
      for (const page of pages) {
        const pageResult = await getNodeSeekReplies(item.target.topicId, {
          ...readerOptions,
          page,
          limit: NODESEEK_FLOORS_PER_PAGE
        });
        reply = pageResult.items.find(matchesTarget);
        if (reply) break;
      }
    }
    if (!reply) throw new Error('NodeSeek 消息对应的帖子内容未找到');
    return { notification: item, title: topic.title, contentHtml: reply.contentHtml, topic };
  },

  async markRead(
    item: ForumNotification,
    detail: NotificationDetail,
    options: NotificationAdapterAccess
  ): Promise<NotificationMarkResult> {
    const ids =
      item.remoteGroup === 'message' ? detail.unreadMessageIds || [] : item.remoteReadId ? [item.remoteReadId] : [];
    if (!ids.length) return { confirmed: false, message: '原站没有返回可确认的未读标识' };
    if (!ids.every((id) => /^\d+$/.test(id))) {
      return { confirmed: false, message: '原站返回的未读标识不正确' };
    }
    const group = item.remoteGroup;
    const field =
      group === 'at-me' ? 'atMe' : group === 'reply-to-me' ? 'replys' : group === 'message' ? 'messages' : '';
    if (!field) return { confirmed: false, message: '该消息类型暂不支持标记已读' };
    await runNodeSeekAction({
      request: {
        path: `/api/notification/${group}/markViewed`,
        method: 'POST',
        headers: {},
        body: JSON.stringify({ [field]: ids.map(Number) })
      },
      fetcher: options.fetcher,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent
    });
    return { confirmed: true };
  },

  async replyToConversation(
    item: ForumNotification,
    content: string,
    options: NotificationAdapterAccess
  ): Promise<NotificationReplyResult> {
    if (item.target.type !== 'private-conversation' || !/^\d+$/.test(item.target.conversationId)) {
      throw new Error('NodeSeek 私信会话标识不正确');
    }
    const raw = content.trim();
    if (!raw) throw new Error('请输入回复内容');
    const data = await runNodeSeekAction({
      request: {
        path: '/api/notification/message/send',
        method: 'POST',
        headers: {},
        body: JSON.stringify({ receiverUid: item.target.conversationId, content: raw, markdown: true })
      },
      fetcher: options.fetcher,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent
    });
    if (!isRecord(data) || data.success !== true) {
      return { confirmed: false, message: 'NodeSeek 未确认私信已发送' };
    }
    const message = text(data, 'message');
    return { confirmed: true, ...(message ? { message } : {}) };
  },

  async markAllRead(options: NotificationAdapterAccess): Promise<NotificationMarkResult> {
    for (const group of ['at-me', 'reply-to-me', 'message'] as const) {
      await runNodeSeekAction({
        request: {
          path: `/api/notification/${group}/markViewed?all=true`,
          method: 'POST',
          headers: {},
          body: ''
        },
        fetcher: options.fetcher,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        userAgent: options.userAgent
      });
    }
    return { confirmed: true };
  }
} satisfies NotificationAdapter;
