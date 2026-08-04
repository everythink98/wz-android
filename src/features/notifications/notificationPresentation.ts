import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';

export function sortNotifications(items: ForumNotification[]) {
  const known = items
    .filter((item) => item.createdAt !== null)
    .sort((left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!));
  return [...known, ...items.filter((item) => item.createdAt === null)];
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

export function notificationTimeText(item: ForumNotification) {
  if (item.createdAt) {
    const date = new Date(item.createdAt);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    }
  }
  return item.displayTime || '时间未知';
}
