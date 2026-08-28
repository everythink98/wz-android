import type { NotificationAdapter } from './notificationAdapter';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { linuxDoNotificationAdapter } from './discourseNotifications';
import { nodeSeekNotificationAdapter } from '@/sources/nodeseek/notifications';
import { yaohuoNotificationAdapter } from '@/sources/yaohuo/notifications';

export const notificationAdapters = {
  nodeseek: nodeSeekNotificationAdapter,
  linuxdo: linuxDoNotificationAdapter,
  yaohuo: yaohuoNotificationAdapter
} satisfies Record<NotificationSource, NotificationAdapter>;
