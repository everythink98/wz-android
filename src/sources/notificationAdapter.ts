import type {
  ForumNotification,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage,
  NotificationUnreadSnapshot
} from '@/domain/notifications/models';
import type { Fetcher } from '@/platform/network/request';

export interface NotificationAdapterAccess {
  fetcher?: Fetcher;
  identityKey: string;
  userId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
  xiaoyinsiCredentials?: { apiKey: string; clientId: string };
}

export type NotificationListOptions = NotificationAdapterAccess & {
  cursor?: string | null;
  limit?: number;
  unreadOnly?: boolean;
};

export interface NotificationAdapter {
  listPage(options: NotificationListOptions): Promise<NotificationPage>;
  readUnreadSnapshot(options: NotificationAdapterAccess): Promise<NotificationUnreadSnapshot>;
  loadDetail(item: ForumNotification, options: NotificationAdapterAccess): Promise<NotificationDetail>;
  markRead(
    item: ForumNotification,
    detail: NotificationDetail,
    options: NotificationAdapterAccess
  ): Promise<NotificationMarkResult>;
  markAllRead?(options: NotificationAdapterAccess): Promise<NotificationMarkResult>;
}
