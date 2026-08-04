import { describe, expect, it, vi } from 'vitest';

import { discourseNotificationAdapters } from './discourseNotifications';

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Discourse notifications', () => {
  it('preserves an authentication failure from the Discourse notifications endpoint', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: ['You need to log in'] }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
    );

    await expect(
      discourseNotificationAdapters.linuxdo.listPage({
        fetcher,
        identityKey: 'linuxdo:alice',
        userId: 'alice'
      })
    ).rejects.toMatchObject({ message: 'You need to log in', status: 401 });
  });

  it('rejects malformed Discourse notification JSON instead of returning an empty page', async () => {
    const fetcher = vi.fn(
      async () => new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await expect(
      discourseNotificationAdapters.linuxdo.listPage({
        fetcher,
        identityKey: 'linuxdo:alice',
        userId: 'alice'
      })
    ).rejects.toThrow('linux.do 返回内容格式不正确');
  });

  it('rejects a structurally invalid Discourse notification payload instead of treating it as empty', async () => {
    const fetcher = vi.fn(async () => json({ total_rows_notifications: 0 }));

    await expect(
      discourseNotificationAdapters.linuxdo.listPage({
        fetcher,
        identityKey: 'linuxdo:alice',
        userId: 'alice'
      })
    ).rejects.toThrow('linux.do 消息返回内容格式不正确');
  });

  it('[REG-NOTIFY-011] reads the official top-level notification serializer fields', async () => {
    const fetcher = vi.fn(async () =>
      json({
        notifications: [
          {
            id: 30,
            notification_type: 2,
            read: false,
            topic_id: 201,
            fancy_title: '官方标题',
            acting_user_name: 'Alice',
            acting_user_avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png',
            data: {}
          }
        ]
      })
    );

    const page = await discourseNotificationAdapters.linuxdo.listPage({
      fetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice'
    });

    expect(page.items[0]).toMatchObject({
      title: '官方标题',
      actor: {
        name: 'Alice',
        avatarUrl: 'https://linux.do/user_avatar/linux.do/alice/96/1_2.png'
      }
    });
  });

  it('maps known kinds, preserves unknown kinds, and uses an opaque offset cursor', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
      json({
        total_rows_notifications: 8,
        notifications: [
          {
            id: 31,
            notification_type: 1,
            read: false,
            created_at: '2026-08-02T10:00:00Z',
            topic_id: 201,
            post_number: 4,
            slug: 'hello',
            data: { display_username: 'alice', topic_title: '主题一' }
          },
          {
            id: 32,
            notification_type: 6,
            read: true,
            created_at: 'invalid',
            topic_id: 202,
            post_number: 2,
            data: { display_username: 'bob', topic_title: '私信主题' }
          },
          {
            id: 33,
            notification_type: 999,
            read: false,
            data: { display_username: 'system', message: '新类型' }
          }
        ]
      })
    );

    const page = await discourseNotificationAdapters.linuxdo.listPage({
      fetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice',
      limit: 3
    });

    expect(page).toMatchObject({ hasMore: true, cursor: '3' });
    expect(page.items).toEqual([
      expect.objectContaining({ id: '31', kind: 'mention', unread: true, createdAt: '2026-08-02T10:00:00.000Z' }),
      expect.objectContaining({ id: '32', kind: 'private-message', unread: false, createdAt: null }),
      expect.objectContaining({ id: '33', kind: 'other', unread: true })
    ]);
    expect(page.items[0]?.target).toMatchObject({ type: 'topic-post', topicId: '201', postNumber: 4 });
    expect(new URL(fetcher.mock.calls[0]?.[0] || '').searchParams.get('offset')).toBe('0');
    expect(new URL(fetcher.mock.calls[0]?.[0] || '').searchParams.get('limit')).toBe('3');
  });

  it('marks one or all rows with Discourse PUT semantics for cookie and User API auth', async () => {
    const item = {
      source: 'linuxdo' as const,
      id: '31',
      kind: 'mention' as const,
      actor: { name: 'alice' },
      title: '主题',
      createdAt: null,
      unread: true,
      target: { type: 'information' as const },
      remoteReadId: '31'
    };
    const detail = { notification: item, title: item.title };
    const linuxFetcher = vi.fn(async (url: string, _init?: RequestInit) =>
      new URL(url).pathname === '/session/csrf' ? json({ csrf: 'token' }) : json({ success: true })
    );

    await discourseNotificationAdapters.linuxdo.markRead(item, detail, {
      fetcher: linuxFetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice'
    });
    await discourseNotificationAdapters.linuxdo.markAllRead({
      fetcher: linuxFetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice'
    });

    const linuxWrites = linuxFetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(linuxWrites.map(([url, init]) => [new URL(url).pathname, init?.body])).toEqual([
      ['/notifications/mark-read', 'id=31'],
      ['/notifications/mark-read', undefined]
    ]);

    const xiaoFetcher = vi.fn(async (_url: string, _init?: RequestInit) => json({ success: true }));
    await discourseNotificationAdapters.xiaoyinsi.markRead({ ...item, source: 'xiaoyinsi' }, detail, {
      fetcher: xiaoFetcher,
      identityKey: 'xiaoyinsi:alice',
      userId: 'alice',
      xiaoyinsiCredentials: { apiKey: 'secret', clientId: 'client' }
    });
    const headers = new Headers(xiaoFetcher.mock.calls[0]?.[1]?.headers);
    expect(xiaoFetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', body: 'id=31' });
    expect(headers.get('User-Api-Key')).toBe('secret');
    expect(headers.get('User-Api-Client-Id')).toBe('client');
  });

  it('uses the unread filter and the authoritative unread total', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
      json({
        total_rows_notifications: 4,
        notifications: []
      })
    );

    await expect(
      discourseNotificationAdapters.linuxdo.readUnreadSnapshot({
        fetcher,
        identityKey: 'linuxdo:alice',
        userId: 'alice'
      })
    ).resolves.toMatchObject({ total: 4 });
    const url = new URL(fetcher.mock.calls[0]?.[0] || '');
    expect(url.searchParams.get('filter')).toBe('unread');
    expect(url.searchParams.get('limit')).toBe('60');
  });

  it('matches the current Discourse notification type contract', async () => {
    const fetcher = vi.fn(async () =>
      json({
        notifications: [
          { id: 1, notification_type: 9, read: false, data: {} },
          { id: 2, notification_type: 19, read: false, data: {} },
          { id: 3, notification_type: 27, read: false, data: {} },
          { id: 4, notification_type: 29, read: false, data: {} },
          { id: 5, notification_type: 999, read: false, data: {} }
        ]
      })
    );

    const page = await discourseNotificationAdapters.linuxdo.listPage({
      fetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice'
    });

    expect(page.items.map((item) => item.kind)).toEqual(['system', 'reaction', 'system', 'mention', 'other']);
  });

  it('loads the exact Discourse post for read-only detail', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
      json({
        id: 777,
        topic_id: 201,
        post_number: 4,
        username: 'alice',
        cooked: '<p>准确正文</p>',
        created_at: '2026-08-02T10:00:00Z'
      })
    );
    const item = {
      source: 'linuxdo' as const,
      id: '31',
      kind: 'reply' as const,
      actor: { name: 'alice' },
      title: '主题一',
      createdAt: '2026-08-02T10:00:00.000Z',
      unread: true,
      target: {
        type: 'topic-post' as const,
        topicId: '201',
        postId: '777',
        postNumber: 4,
        url: 'https://linux.do/t/hello/201/4'
      }
    };

    const detail = await discourseNotificationAdapters.linuxdo.loadDetail(item, {
      fetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice'
    });

    expect(detail).toMatchObject({ title: '主题一', contentHtml: '<p>准确正文</p>' });
    expect(detail.topic).toMatchObject({ source: 'linuxdo', id: '201', url: 'https://linux.do/t/hello/201/4' });
    expect(new URL(fetcher.mock.calls[0]?.[0] || '').pathname).toBe('/posts/777.json');
  });
});
