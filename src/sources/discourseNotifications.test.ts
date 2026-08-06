import { describe, expect, it, vi } from 'vitest';

import { discourseNotificationAdapters } from './discourseNotifications';

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Discourse notifications', () => {
  it('[REG-NOTIFY-031] exposes the current Discourse menu categories and advertised Chat support', async () => {
    const fetcher = vi.fn(async (input: string) => {
      expect(new URL(input).pathname).toBe('/site.json');
      return json({
        notification_types: {
          mentioned: 1,
          replied: 2,
          liked: 5,
          private_message: 6,
          chat_message: 30
        }
      });
    });

    await expect(
      discourseNotificationAdapters.linuxdo.getCategories({
        fetcher,
        identityKey: 'linuxdo:7',
        userId: '7',
        username: 'alice'
      })
    ).resolves.toEqual([
      { id: 'all', label: '所有通知' },
      { id: 'replies', label: '回复' },
      { id: 'likes', label: '赞' },
      { id: 'messages', label: '个人信息' },
      { id: 'chat', label: '聊天通知' },
      { id: 'other', label: '其他通知' }
    ]);
  });

  it('[REG-NOTIFY-031] paginates the original Discourse type grouping beyond the recent menu window', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/site.json') {
        return json({ notification_types: { mentioned: 1, replied: 2, liked: 5 } });
      }
      if (url.searchParams.get('offset') === '2') {
        return json({
          notifications: [{ id: 3, notification_type: 2, read: false, data: {} }],
          total_rows_notifications: 3
        });
      }
      return json({
        notifications: [
          { id: 1, notification_type: 5, read: false, data: {} },
          { id: 2, notification_type: 5, read: false, data: {} }
        ],
        total_rows_notifications: 3
      });
    });

    const firstPage = await discourseNotificationAdapters.linuxdo.listPage({
      categoryId: 'replies',
      fetcher,
      identityKey: 'linuxdo:7',
      limit: 2,
      userId: '7',
      username: 'alice'
    });
    const secondPage = await discourseNotificationAdapters.linuxdo.listPage({
      categoryId: 'replies',
      cursor: firstPage.cursor,
      fetcher,
      identityKey: 'linuxdo:7',
      limit: 2,
      userId: '7',
      username: 'alice'
    });

    const notificationUrls = fetcher.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/notifications');
    expect(notificationUrls[0]?.searchParams.get('offset')).toBe('0');
    expect(notificationUrls[0]?.searchParams.get('filter')).toBe('all');
    expect(notificationUrls[0]?.searchParams.has('recent')).toBe(false);
    expect(firstPage).toMatchObject({ items: [], cursor: '2', hasMore: true });
    expect(secondPage.items.map((item) => item.id)).toEqual(['3']);
  });

  it('[REG-NOTIFY-031] derives Other from the notification types advertised by the server', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === '/site.json') {
        return json({
          notification_types: {
            mentioned: 1,
            liked: 5,
            private_message: 6,
            bookmark_reminder: 8,
            chat_message: 30,
            badge_granted: 12,
            future_notice: 99
          }
        });
      }
      return json({ notifications: [] });
    });

    await discourseNotificationAdapters.linuxdo.listPage({
      categoryId: 'other',
      fetcher,
      identityKey: 'linuxdo:7',
      userId: '7',
      username: 'alice'
    });

    const notificationUrl = new URL(String(fetcher.mock.calls.at(-1)?.[0]));
    expect(notificationUrl.pathname).toBe('/notifications');
    expect(notificationUrl.searchParams.get('offset')).toBe('0');
  });

  it('[REG-NOTIFY-031] maps the Discourse private-message menu to conversation rows', async () => {
    const fetcher = vi.fn(async (_input: string) =>
      json({
        read_notifications: [],
        unread_notifications: [
          {
            id: 8315,
            notification_type: 6,
            read: false,
            created_at: '2026-08-03T10:01:00Z',
            topic_id: 202,
            fancy_title: '未读私信',
            acting_user_name: 'Carol',
            data: {}
          }
        ],
        topics: [
          {
            id: 201,
            slug: 'secret-topic',
            title: '私信主题',
            bumped_at: '2026-08-03T10:00:00Z',
            last_poster_username: 'bob',
            unread: 1,
            unread_posts: 2,
            participants: [{ user_id: 9 }]
          }
        ],
        users: [{ id: 9, username: 'bob', name: 'Bob', avatar_template: '/user_avatar/linux.do/bob/{size}/1.png' }]
      })
    );

    const page = await discourseNotificationAdapters.linuxdo.listPage({
      categoryId: 'messages',
      fetcher,
      identityKey: 'linuxdo:7',
      limit: 30,
      userId: '7',
      username: 'alice'
    });

    const url = new URL(fetcher.mock.calls[0]?.[0] || '');
    expect(url.pathname).toBe('/u/alice/user-menu-private-messages');
    expect(url.search).toBe('');
    expect(page).toMatchObject({ hasMore: false, cursor: null });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'private-notification:8315',
        kind: 'private-message',
        actor: expect.objectContaining({ name: 'Carol' }),
        unread: true,
        target: { type: 'private-conversation', conversationId: '202' }
      }),
      expect.objectContaining({
        id: 'private-topic:201',
        kind: 'private-message',
        actor: expect.objectContaining({ id: '9', name: 'Bob' }),
        unread: true,
        target: { type: 'private-conversation', conversationId: '201' }
      })
    ]);
  });

  it('[REG-NOTIFY-043] opens a private-message notification as the same conversation from All and Personal Info', async () => {
    const notification = {
      id: 8315,
      notification_type: 6,
      read: true,
      created_at: '2026-08-03T10:01:00Z',
      topic_id: 202,
      post_number: 2,
      fancy_title: '与 discobot 的私信',
      acting_user_name: 'discobot',
      data: {}
    };
    const fetcher = vi.fn(async (input: string) => {
      const path = new URL(input).pathname;
      if (path === '/notifications') {
        return json({ notifications: [notification], total_rows_notifications: 1 });
      }
      if (path === '/u/alice/user-menu-private-messages') {
        return json({ read_notifications: [notification], unread_notifications: [], topics: [], users: [] });
      }
      if (path === '/t/202.json') {
        return json({
          id: 202,
          title: '与 discobot 的私信',
          slug: 'discobot-message',
          created_at: '2026-08-03T10:00:00Z',
          bumped_at: '2026-08-03T10:01:00Z',
          posts_count: 2,
          post_stream: {
            stream: [100, 101],
            posts: [
              {
                id: 100,
                post_number: 1,
                username: 'discobot',
                cooked: '<p>欢迎私信</p>',
                created_at: '2026-08-03T10:00:00Z'
              },
              {
                id: 101,
                post_number: 2,
                username: 'alice',
                cooked: '<p>谢谢</p>',
                created_at: '2026-08-03T10:01:00Z'
              }
            ]
          }
        });
      }
      throw new Error(`Unexpected Discourse path: ${path}`);
    });
    const access = { fetcher, identityKey: 'linuxdo:7', userId: '7', username: 'alice' };

    const allItem = (await discourseNotificationAdapters.linuxdo.listPage({ ...access, categoryId: 'all' })).items[0]!;
    const personalItem = (await discourseNotificationAdapters.linuxdo.listPage({ ...access, categoryId: 'messages' }))
      .items[0]!;

    expect(allItem.kind).toBe('private-message');
    expect(personalItem.kind).toBe('private-message');
    expect(allItem.target).toEqual(personalItem.target);
    await expect(discourseNotificationAdapters.linuxdo.loadDetail(allItem, access)).resolves.toMatchObject({
      reply: { format: 'markdown' },
      messages: [
        expect.objectContaining({ author: 'discobot', contentHtml: '<p>欢迎私信</p>' }),
        expect.objectContaining({ author: 'alice', contentHtml: '<p>谢谢</p>' })
      ]
    });
  });

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
    const fetcher = vi.fn(async (_input: string) =>
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
    const fetcher = vi.fn(async (_input: string) =>
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

  it('[REG-NOTIFY-053] keeps a topic-only notification out of exact post lookup', async () => {
    const fetcher = vi.fn(async (_input: string) =>
      json({
        notifications: [
          {
            id: 18,
            notification_type: 18,
            read: false,
            topic_id: 201,
            slug: 'topic-reminder',
            fancy_title: '主题提醒',
            data: { description: '这是主题级通知，不对应某一条回复。' }
          }
        ]
      })
    );
    const access = {
      fetcher,
      identityKey: 'linuxdo:alice',
      userId: 'alice'
    };

    const page = await discourseNotificationAdapters.linuxdo.listPage(access);
    const item = page.items[0]!;

    const requestCount = fetcher.mock.calls.length;
    await expect(discourseNotificationAdapters.linuxdo.loadDetail(item, access)).resolves.toMatchObject({
      title: '主题提醒',
      contentText: '这是主题级通知，不对应某一条回复。',
      topic: {
        source: 'linuxdo',
        id: '201',
        url: 'https://linux.do/t/topic-reminder/201'
      }
    });
    expect(item.target).toEqual({
      type: 'topic',
      topicId: '201',
      url: 'https://linux.do/t/topic-reminder/201'
    });
    expect(fetcher).toHaveBeenCalledTimes(requestCount);
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

  it('[REG-NOTIFY-031] loads a Discourse private topic as an ordered replyable conversation', async () => {
    const fetcher = vi.fn(async (_input: string) =>
      json({
        id: 201,
        title: '私信主题',
        slug: 'secret-topic',
        created_at: '2026-08-03T10:00:00Z',
        bumped_at: '2026-08-03T10:01:00Z',
        posts_count: 2,
        post_stream: {
          stream: [100, 101],
          posts: [
            {
              id: 100,
              post_number: 1,
              username: 'bob',
              cooked: '<p>第一条</p>',
              created_at: '2026-08-03T10:00:00Z'
            },
            {
              id: 101,
              post_number: 2,
              username: 'alice',
              cooked: '<p>第二条</p>',
              created_at: '2026-08-03T10:01:00Z'
            }
          ]
        }
      })
    );
    const item = {
      source: 'linuxdo' as const,
      id: 'private-topic:201',
      kind: 'private-message' as const,
      actor: { id: '9', name: 'Bob' },
      title: '私信主题',
      createdAt: '2026-08-03T10:01:00.000Z',
      unread: true,
      target: { type: 'private-conversation' as const, conversationId: '201' }
    };

    const detail = await discourseNotificationAdapters.linuxdo.loadDetail(item, {
      fetcher,
      identityKey: 'linuxdo:7',
      userId: '7',
      username: 'alice'
    });

    expect(detail.reply).toEqual({ format: 'markdown' });
    expect(detail.messages).toEqual([
      expect.objectContaining({ id: '100', author: 'bob', mine: false, contentHtml: '<p>第一条</p>' }),
      expect.objectContaining({ id: '101', author: 'alice', mine: true, contentHtml: '<p>第二条</p>' })
    ]);
    const detailUrl = new URL(fetcher.mock.calls[0]?.[0] || '');
    expect(detailUrl.pathname).toBe('/t/201.json');
    expect(detailUrl.searchParams.get('track_visit')).toBe('true');
    expect(detailUrl.searchParams.get('forceLoad')).toBe('true');
    await expect(
      discourseNotificationAdapters.linuxdo.markRead(item, detail, {
        fetcher,
        identityKey: 'linuxdo:7',
        userId: '7',
        username: 'alice'
      })
    ).resolves.toEqual({ confirmed: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-NOTIFY-031] replies to a linux.do private topic with the original Markdown post request', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) =>
      new URL(input).pathname === '/session/csrf' ? json({ csrf: 'token' }) : json({ id: 102, post_number: 3 })
    );
    const item = {
      source: 'linuxdo' as const,
      id: 'private-topic:201',
      kind: 'private-message' as const,
      actor: { name: 'Bob' },
      title: '私信主题',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '201' }
    };

    await expect(
      discourseNotificationAdapters.linuxdo.replyToConversation(item, '  **收到**  ', {
        fetcher,
        identityKey: 'linuxdo:7',
        userId: '7',
        username: 'alice'
      })
    ).resolves.toEqual({ confirmed: true });

    const [, init] = fetcher.mock.calls.find(([url]) => new URL(url).pathname === '/posts.json') || [];
    expect(init).toMatchObject({ method: 'POST', body: 'topic_id=201&raw=**%E6%94%B6%E5%88%B0**' });
  });

  it('[REG-NOTIFY-031] disables Xiaoyinsi private replies without write scope before network I/O', async () => {
    const fetcher = vi.fn();
    const item = {
      source: 'xiaoyinsi' as const,
      id: 'private-topic:201',
      kind: 'private-message' as const,
      actor: { name: 'Bob' },
      title: '私信主题',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '201' }
    };

    await expect(
      discourseNotificationAdapters.xiaoyinsi.replyToConversation(item, '收到', {
        fetcher,
        identityKey: 'xiaoyinsi:7',
        userId: '7',
        username: 'alice',
        xiaoyinsiCredentials: {
          apiKey: 'secret',
          clientId: 'client',
          scopes: ['read', 'notifications']
        }
      })
    ).rejects.toThrow('小隐寺需要升级写入授权');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-031] derives Xiaoyinsi categories and exposes the missing write scope in PM detail', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === '/site.json') {
        return json({ notification_types: { mentioned: 1, replied: 2, liked: 5, private_message: 6, badge: 12 } });
      }
      return json({
        id: 201,
        title: '私信主题',
        slug: 'secret-topic',
        created_at: '2026-08-03T10:00:00Z',
        posts_count: 1,
        post_stream: {
          stream: [100],
          posts: [
            {
              id: 100,
              post_number: 1,
              username: 'bob',
              cooked: '<p>第一条</p>',
              created_at: '2026-08-03T10:00:00Z'
            }
          ]
        }
      });
    });
    const access = {
      fetcher,
      identityKey: 'xiaoyinsi:7',
      userId: '7',
      username: 'alice',
      xiaoyinsiCredentials: {
        apiKey: 'secret',
        clientId: 'client',
        scopes: ['read', 'notifications'] as ('read' | 'notifications')[]
      }
    };
    const item = {
      source: 'xiaoyinsi' as const,
      id: 'private-topic:201',
      kind: 'private-message' as const,
      actor: { name: 'Bob' },
      title: '私信主题',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '201' }
    };

    await expect(discourseNotificationAdapters.xiaoyinsi.getCategories(access)).resolves.toEqual([
      { id: 'all', label: '所有通知' },
      { id: 'replies', label: '回复' },
      { id: 'likes', label: '赞' },
      { id: 'messages', label: '个人信息' },
      { id: 'other', label: '其他通知' }
    ]);
    await expect(discourseNotificationAdapters.xiaoyinsi.loadDetail(item, access)).resolves.toMatchObject({
      reply: { format: 'markdown', disabledReason: '小隐寺需要升级写入授权' }
    });
    const headers = new Headers(fetcher.mock.calls.at(-1)?.[1]?.headers);
    expect(headers.get('User-Api-Key')).toBe('secret');
    expect(headers.get('User-Api-Client-Id')).toBe('client');
  });

  it('[REG-NOTIFY-031] replies to a Xiaoyinsi PM topic with User API Markdown semantics', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => json({ id: 102, post_number: 2 }));
    const item = {
      source: 'xiaoyinsi' as const,
      id: 'private-topic:201',
      kind: 'private-message' as const,
      actor: { name: 'Bob' },
      title: '私信主题',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '201' }
    };

    await expect(
      discourseNotificationAdapters.xiaoyinsi.replyToConversation(item, '**收到**', {
        fetcher,
        identityKey: 'xiaoyinsi:7',
        userId: '7',
        username: 'alice',
        xiaoyinsiCredentials: {
          apiKey: 'secret',
          clientId: 'client',
          scopes: ['read', 'write', 'notifications']
        }
      })
    ).resolves.toEqual({ confirmed: true });

    const [url, init] = fetcher.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(new URL(url || '').pathname).toBe('/posts.json');
    expect(init).toMatchObject({ method: 'POST', body: 'topic_id=201&raw=**%E6%94%B6%E5%88%B0**' });
    expect(headers.get('User-Api-Key')).toBe('secret');
    expect(headers.get('User-Api-Client-Id')).toBe('client');
  });
});
