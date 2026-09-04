import { describe, expect, it, vi } from 'vitest';
import type { ForumNotification } from '@/domain/notifications/models';
import { notificationAccessibilityLabel, notificationTimeText, sortNotifications } from './notificationPresentation';

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

  it('parses each known timestamp once even when sorting many notifications', () => {
    const items = Array.from({ length: 100 }, (_, index) =>
      item(String(index), index % 2 ? '2026-08-01T00:00:00Z' : '2026-08-02T00:00:00Z')
    );
    const parse = vi.spyOn(Date, 'parse');
    try {
      const result = sortNotifications([item('unknown', null), ...items]);
      expect(parse).toHaveBeenCalledTimes(items.length);
      expect(result.slice(0, 3).map(({ id }) => id)).toEqual(['0', '2', '4']);
      expect(result.at(-1)?.id).toBe('unknown');
    } finally {
      parse.mockRestore();
    }
  });

  it('announces source, read state, actor, action and title', () => {
    expect(notificationAccessibilityLabel(item('1', null))).toBe('NodeSeek，未读，张三，回复了你，回复了你的主题');
  });

  it('uses one explicit 24-hour timestamp for parsed and site fallback values', () => {
    const createdAt = new Date(2026, 7, 3, 9, 5).toISOString();

    expect(notificationTimeText(item('parsed', createdAt))).toBe('2026-08-03 09:05');
    expect(notificationTimeText({ ...item('fallback', null), displayTime: '2026/7/3 13:46' })).toBe('2026-07-03 13:46');
  });
});
