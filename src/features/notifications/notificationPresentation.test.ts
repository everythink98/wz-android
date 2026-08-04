import { describe, expect, it } from 'vitest';
import type { ForumNotification } from '@/domain/notifications/models';
import { notificationAccessibilityLabel, sortNotifications } from './notificationPresentation';

function item(id: string, createdAt: string | null, unread = true): ForumNotification {
  return {
    source: 'nodeseek',
    id,
    kind: 'reply',
    actor: { name: '张三' },
    title: '回复了你的主题',
    createdAt,
    unread,
    target: { type: 'information' }
  };
}

describe('notification presentation', () => {
  it('sorts known times while preserving unknown-time arrival order', () => {
    const result = sortNotifications([
      item('unknown-a', null),
      item('old', '2026-08-01T00:00:00Z'),
      item('unknown-b', null),
      item('new', '2026-08-03T00:00:00Z')
    ]);

    expect(result.map(({ id }) => id)).toEqual(['new', 'old', 'unknown-a', 'unknown-b']);
  });

  it('[REG-NOTIFY-013] announces source, read state, actor, action and title', () => {
    expect(notificationAccessibilityLabel(item('1', null))).toBe('NodeSeek，未读，张三，回复了你，回复了你的主题');
  });
});
