import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import { formatDateTime } from '@/domain/forum/presentation';
import type { ForumNotification } from '@/domain/notifications/models';

export function sortNotifications(items: ForumNotification[]) {
  const known: { item: ForumNotification; time: number }[] = [];
  const unknown: ForumNotification[] = [];
  for (const item of items) {
    if (item.createdAt === null) unknown.push(item);
    else known.push({ item, time: Date.parse(item.createdAt) });
  }
  return [...known.sort((left, right) => right.time - left.time).map(({ item }) => item), ...unknown];
}

export function notificationAccessibilityLabel(item: ForumNotification) {
  return [
    sourceCatalog[item.source].label,
    item.unread ? '未读' : '已读',
    item.actor.name,
    notificationActionText(item.kind),
    item.title
  ].join('，');
}

export function notificationActionText(kind: ForumNotification['kind']) {
  if (kind === 'mention') return '提到了你';
  if (kind === 'reply') return '回复了你';
  if (kind === 'private-message') return '发来了私信';
  if (kind === 'reaction') return '与你的内容有了互动';
  if (kind === 'system') return '发来系统消息';
  return '发来其他消息';
}

export function formatNotificationTime(value?: string | null) {
  if (!value) return '';
  const siteTime = value.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (siteTime) {
    return `${siteTime[1]}-${siteTime[2]!.padStart(2, '0')}-${siteTime[3]!.padStart(2, '0')} ${siteTime[4]!.padStart(2, '0')}:${siteTime[5]}`;
  }
  return formatDateTime(value);
}

export function notificationTimeText(item: ForumNotification) {
  return formatNotificationTime(item.createdAt || item.displayTime) || '时间未知';
}
