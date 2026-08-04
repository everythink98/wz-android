import type { NotificationAdapter } from './notificationAdapter';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { discourseNotificationAdapters } from './discourseNotifications';
import { nodeSeekNotificationAdapter } from '@/sources/nodeseek/notifications';
import { yaohuoNotificationAdapter } from '@/sources/yaohuo/notifications';

export const notificationAdapters = {
  nodeseek: nodeSeekNotificationAdapter,
  linuxdo: discourseNotificationAdapters.linuxdo,
  yaohuo: yaohuoNotificationAdapter,
  xiaoyinsi: discourseNotificationAdapters.xiaoyinsi
} satisfies Record<NotificationSource, NotificationAdapter>;
