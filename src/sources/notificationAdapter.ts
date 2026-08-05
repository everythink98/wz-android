import type {
  ForumNotification,
  NotificationCategory,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage,
  NotificationReplyResult,
  NotificationUnreadSnapshot
} from '@/domain/notifications/models';
import type { Fetcher } from '@/platform/network/request';
import type { XiaoyinsiApiCredentials } from '@/sources/xiaoyinsi/credentials';

export interface NotificationAdapterAccess {
  fetcher?: Fetcher;
  identityKey: string;
  userId: string;
  username?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  xiaoyinsiCredentials?: XiaoyinsiApiCredentials;
}

export type NotificationListOptions = NotificationAdapterAccess & {
  categoryId?: string;
  cursor?: string | null;
  limit?: number;
  unreadOnly?: boolean;
};

export interface NotificationAdapter {
  getCategories(options: NotificationAdapterAccess): Promise<readonly NotificationCategory[]>;
  listPage(options: NotificationListOptions): Promise<NotificationPage>;
  readUnreadSnapshot(options: NotificationAdapterAccess): Promise<NotificationUnreadSnapshot>;
  loadDetail(item: ForumNotification, options: NotificationAdapterAccess): Promise<NotificationDetail>;
  replyToConversation(
    item: ForumNotification,
    content: string,
    options: NotificationAdapterAccess
  ): Promise<NotificationReplyResult>;
  markRead(
    item: ForumNotification,
    detail: NotificationDetail,
    options: NotificationAdapterAccess
  ): Promise<NotificationMarkResult>;
  markAllRead?(options: NotificationAdapterAccess): Promise<NotificationMarkResult>;
}
