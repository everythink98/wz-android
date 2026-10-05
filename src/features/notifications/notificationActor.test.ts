import { describe, expect, it } from 'vitest';
import type { ForumNotification } from '@/domain/notifications/models';
import { notificationActorUser } from './notificationActor';

function notification(source: ForumNotification['source'], actor: ForumNotification['actor']): ForumNotification {
  return {
    source,
    id: '1',
    kind: 'private-message',
    actor,
    title: '消息',
    createdAt: null,
    unread: false,
    target: { type: 'information' }
  };
}

describe('notification actor navigation', () => {
  it('opens a NodeSeek sender by UID while preserving its display name and avatar', () => {
    expect(
      notificationActorUser(
        notification('nodeseek', { id: '42', name: '张三', avatarUrl: 'https://example.com/a.png' })
      )
    ).toEqual({
      source: 'nodeseek',
      id: '42',
      displayName: '张三',
      avatar: 'https://example.com/a.png',
      url: 'https://www.nodeseek.com/space/42'
    });
  });

  it('normalizes a Yaohuo sender ID into the existing user-profile navigation contract', () => {
    expect(notificationActorUser(notification('yaohuo', { id: '9', name: '张三' }))).toEqual({
      source: 'yaohuo',
      id: '9',
      username: '9',
      displayName: '张三',
      avatar: undefined,
      url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=9'
    });
  });

  it('uses the explicit linux.do username independently of its display name', () => {
    expect(notificationActorUser(notification('linuxdo', { id: 'actual_user', name: '显示名' }))).toEqual({
      source: 'linuxdo',
      id: 'actual_user',
      username: 'actual_user',
      displayName: '显示名',
      avatar: undefined,
      url: 'https://linux.do/u/actual_user'
    });
  });

  it.each(['nodeseek', 'yaohuo', 'linuxdo'] as const)('never guesses a %s identity from a display name', (source) => {
    for (const name of ['张三', '12345', '系统通知', '站内消息']) {
      expect(notificationActorUser(notification(source, { name }))).toBeNull();
    }
  });

  it.each(['nodeseek', 'yaohuo'] as const)('rejects invalid and system UIDs for %s', (source) => {
    for (const id of ['', '0', '-1', '张三', '9/other', '9007199254740992']) {
      expect(notificationActorUser(notification(source, { id, name: '用户' }))).toBeNull();
    }
  });
});
