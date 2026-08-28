import { describe, expect, it, vi } from 'vitest';

import { nodeSeekNotificationAdapter } from './notifications';

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function html(value: string) {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

describe('NodeSeek notifications', () => {
  it('exposes the categories shown by the current NodeSeek site', async () => {
    await expect(
      nodeSeekNotificationAdapter.getCategories({ identityKey: 'nodeseek:7', userId: '7' })
    ).resolves.toEqual([
      { id: 'all', label: '全部' },
      { id: 'mentions', label: '@我' },
      { id: 'replies', label: '回复主题' },
      { id: 'messages', label: '私信' }
    ]);
  });

  it('reads only the selected NodeSeek notification category', async () => {
    const fetcher = vi.fn(async (input: string) => {
      expect(new URL(input).pathname).toBe('/api/notification/message/list');
      return json({
        msgArray: [
          {
            id: 21,
            sender_id: 9,
            receiver_id: 7,
            sender_name: '对方',
            content: '私信',
            viewed: false
          }
        ]
      });
    });

    const page = await nodeSeekNotificationAdapter.listPage({
      categoryId: 'messages',
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(page.items).toEqual([expect.objectContaining({ id: 'message:21', kind: 'private-message' })]);
  });

  it('reports a Cloudflare challenge instead of parsing it as notification data', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title></html>', {
          status: 403,
          headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
        })
    );

    await expect(
      nodeSeekNotificationAdapter.listPage({ fetcher, identityKey: 'nodeseek:7', userId: '7' })
    ).rejects.toMatchObject({ source: 'nodeseek', reason: 'cloudflare' });
  });

  it('rejects malformed notification JSON instead of returning an empty page', async () => {
    const fetcher = vi.fn(
      async () => new Response('{not-json', { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await expect(
      nodeSeekNotificationAdapter.listPage({ fetcher, identityKey: 'nodeseek:7', userId: '7' })
    ).rejects.toThrow('NodeSeek 消息返回内容格式不正确');
  });

  it('rejects a structurally invalid notification payload instead of treating it as empty', async () => {
    const fetcher = vi.fn(async () => json({ success: true }));

    await expect(
      nodeSeekNotificationAdapter.listPage({ fetcher, identityKey: 'nodeseek:7', userId: '7' })
    ).rejects.toThrow('NodeSeek 消息返回内容格式不正确');
  });

  it('preserves an explicit unknown NodeSeek notification type as other', async () => {
    const fetcher = vi.fn(async (input: string) =>
      new URL(input).pathname.endsWith('/at-me/list')
        ? json({
            atList: [
              {
                id: 15,
                notification_type: 'future-interaction',
                post_id: 101,
                commenter_name: '甲'
              }
            ]
          })
        : json({ notifications: [] })
    );

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toEqual([expect.objectContaining({ id: 'at-me:15', kind: 'other' })]);
  });

  it('treats a missing viewed marker as unread', async () => {
    const fetcher = vi.fn(async (input: string) =>
      new URL(input).pathname.endsWith('/at-me/list')
        ? json({ atList: [{ id: 14, post_id: 101, commenter_name: '甲' }] })
        : json({ notifications: [] })
    );

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toEqual([expect.objectContaining({ id: 'at-me:14', unread: true })]);
  });

  it('does not report an outgoing private message as unread', async () => {
    const fetcher = vi.fn(async (input: string) =>
      new URL(input).pathname.endsWith('/message/list')
        ? json({
            msgArray: [
              {
                id: 21,
                sender_id: 7,
                receiver_id: 9,
                receiver_name: '对方',
                content: '我发出的消息',
                viewed: false
              }
            ]
          })
        : json({ notifications: [] })
    );

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toEqual([expect.objectContaining({ id: 'message:21', kind: 'private-message', unread: false })]);
  });

  it('uses comment_id for delivery identity and the row id for mark-read', async () => {
    const load = async (commentId: number) => {
      const fetcher = vi.fn(async (input: string) =>
        new URL(input).pathname.endsWith('/reply-to-me/list')
          ? json({ replyList: [{ id: 12, comment_id: commentId, post_id: 102, viewed: false }] })
          : json({ notifications: [] })
      );
      return nodeSeekNotificationAdapter.listPage({ fetcher, identityKey: 'nodeseek:7', userId: '7' });
    };

    const first = await load(98);
    const second = await load(99);

    expect(first.items).toEqual([expect.objectContaining({ id: 'reply-to-me:98', remoteReadId: '12' })]);
    expect(second.items).toEqual([expect.objectContaining({ id: 'reply-to-me:99', remoteReadId: '12' })]);
  });

  it('carries the compatible message_id into the exact topic target', async () => {
    const fetcher = vi.fn(async (input: string) =>
      new URL(input).pathname.endsWith('/reply-to-me/list')
        ? json({ replyList: [{ id: 12, message_id: 98, post_id: 102, viewed: false }] })
        : json({ notifications: [] })
    );

    const page = await nodeSeekNotificationAdapter.listPage({
      categoryId: 'replies',
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'reply-to-me:98',
        remoteReadId: '12',
        target: expect.objectContaining({ type: 'topic-post', topicId: '102', postId: '98' })
      })
    ]);
  });

  it('does not persist the counterpart id in a missing-id message fallback', async () => {
    const counterpartId = '918273645';
    const fetcher = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname;
      if (pathname.endsWith('/message/list')) {
        return json({
          msgArray: [
            {
              sender_id: counterpartId,
              receiver_id: 7,
              sender_name: '对方',
              content: '脱敏消息内容',
              created_at: '2026-08-02T12:00:00Z',
              viewed: false
            }
          ]
        });
      }
      return json({ notifications: [] });
    });

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).not.toContain(counterpartId);
    expect(page.items[0]?.target).toEqual({ type: 'private-conversation', conversationId: counterpartId });
  });

  it('drops ambiguous same-time conversations instead of persisting a participant-derived id', async () => {
    const fetcher = vi.fn(async (input: string) =>
      new URL(input).pathname.endsWith('/message/list')
        ? json({
            msgArray: [
              { sender_id: '101', receiver_id: 7, created_at: '2026-08-02T12:00:00Z', viewed: false },
              { sender_id: '202', receiver_id: 7, created_at: '2026-08-02T12:00:00Z', viewed: false }
            ]
          })
        : json({ notifications: [] })
    );

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toEqual([]);
  });

  it('keeps missing-id notification fallbacks stable when list order changes', async () => {
    const rows = [
      {
        post_id: 101,
        commenter_id: 'private-actor-1',
        commenter_name: '甲',
        post_title: '主题甲',
        content: '内容甲',
        created_at: '2026-08-02T12:00:00Z'
      },
      {
        post_id: 102,
        commenter_id: 'private-actor-2',
        commenter_name: '乙',
        post_title: '主题乙',
        content: '内容乙',
        created_at: '2026-08-02T13:00:00Z'
      }
    ];
    const load = async (atList: typeof rows) => {
      const fetcher = vi.fn(async (input: string) =>
        new URL(input).pathname.endsWith('/at-me/list') ? json({ atList }) : json({ notifications: [] })
      );
      return nodeSeekNotificationAdapter.listPage({
        fetcher,
        identityKey: 'nodeseek:7',
        userId: '7'
      });
    };

    const first = await load(rows);
    const reordered = await load([...rows].reverse());
    const idsByTitle = (items: typeof first.items) => Object.fromEntries(items.map((item) => [item.title, item.id]));

    expect(idsByTitle(reordered.items)).toEqual(idsByTitle(first.items));
    expect(first.items.map((item) => item.id).join(' ')).not.toMatch(/private-actor-[12]/);
  });

  it('does not derive a persisted fallback id from mutable title or preview content', async () => {
    const load = async (postTitle: string, content: string) => {
      const fetcher = vi.fn(async (input: string) =>
        new URL(input).pathname.endsWith('/at-me/list')
          ? json({
              atList: [
                {
                  post_id: 101,
                  floor_id: 8,
                  commenter_id: 'private-actor',
                  commenter_name: '甲',
                  post_title: postTitle,
                  content,
                  created_at: '2026-08-02T12:00:00Z'
                }
              ]
            })
          : json({ notifications: [] })
      );
      return nodeSeekNotificationAdapter.listPage({ fetcher, identityKey: 'nodeseek:7', userId: '7' });
    };

    const beforeEdit = await load('原主题', '原回复');
    const afterEdit = await load('修改后的主题', '修改后的回复');

    expect(afterEdit.items[0]?.id).toBe(beforeEdit.items[0]?.id);
  });

  it('merges mention, reply, and conversation rows without inventing an unknown timestamp', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/at-me/list')) {
        return json({ atList: [{ id: 11, post_id: 101, commenter_name: '甲', post_title: '主题甲', viewed: false }] });
      }
      if (url.pathname.endsWith('/reply-to-me/list')) {
        return json({
          replyList: [
            {
              id: 12,
              comment_id: 98,
              post_id: 102,
              floor: 3,
              commenter_name: '乙',
              content: '回复内容',
              created_at: '2026-08-01T12:00:00Z',
              viewed: true
            }
          ]
        });
      }
      return json({
        msgArray: [
          {
            id: 13,
            sender_id: 9,
            receiver_id: 7,
            sender_name: '丙',
            content: '私信内容',
            created_at: '2026-08-02T12:00:00Z',
            viewed: false
          }
        ]
      });
    });

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7'
    });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'message:13',
        kind: 'private-message',
        createdAt: '2026-08-02T12:00:00.000Z',
        actor: expect.objectContaining({ avatarUrl: 'https://www.nodeseek.com/avatar/9.png' })
      }),
      expect.objectContaining({ id: 'reply-to-me:98', kind: 'reply', unread: false, remoteReadId: '12' }),
      expect.objectContaining({ id: 'at-me:11', kind: 'mention', createdAt: null, unread: true })
    ]);
    expect(page.items[0]?.target).toEqual({ type: 'private-conversation', conversationId: '9' });
    expect(page.items[1]?.target).toMatchObject({ type: 'topic-post', topicId: '102', postNumber: 3 });
    expect(page.items[2]?.target).toEqual({
      type: 'topic',
      topicId: '101',
      url: 'https://www.nodeseek.com/post-101-1'
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not discard rows when one remote page is larger than the unified page hint', async () => {
    const rows = Array.from({ length: 15 }, (_, index) => index + 1);
    const fetcher = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname;
      if (pathname.endsWith('/at-me/list')) {
        return json({ hasMore: false, atList: rows.map((id) => ({ id, post_id: id, viewed: false })) });
      }
      if (pathname.endsWith('/reply-to-me/list')) {
        return json({
          hasMore: false,
          replyList: rows.map((id) => ({ id: id + 100, post_id: id + 100, viewed: false }))
        });
      }
      return json({
        hasMore: false,
        msgArray: rows.map((id) => ({ id: id + 200, sender_id: id + 200, receiver_id: 7, viewed: false }))
      });
    });

    const page = await nodeSeekNotificationAdapter.listPage({
      fetcher,
      identityKey: 'nodeseek:7',
      userId: '7',
      limit: 30
    });

    expect(page.items).toHaveLength(45);
    expect(page.hasMore).toBe(false);
  });

  it('loads the exact NodeSeek comment from its origin page', async () => {
    const payload = (comments: unknown[], page: number) =>
      Buffer.from(
        JSON.stringify({
          postData: {
            postId: 703863,
            postPage: page,
            postPageCount: 2,
            title: '目标主题',
            op: { name: '楼主' },
            comments
          }
        })
      ).toString('base64');
    const pageOne = payload(
      [
        { commentId: 1, poster: { name: '楼主' }, markdown: '正文' },
        ...Array.from({ length: 10 }, (_, index) => ({
          commentId: index + 2,
          floorIndex: index + 1,
          poster: { name: `用户 ${index + 1}` },
          markdown: `回复 ${index + 1}`
        }))
      ],
      1
    );
    const pageTwo = payload(
      [
        { commentId: 12, floorIndex: 11, poster: { name: '用户 11' }, markdown: '回复 11' },
        { commentId: 13, floorIndex: 99, poster: { name: '目标用户' }, markdown: '目标回复' }
      ],
      2
    );
    const fetcher = vi.fn(async (input: string) =>
      html(
        new URL(input).pathname.endsWith('/post-703863-2')
          ? `<script>${pageTwo}</script>`
          : `<script>${pageOne}</script><a href="/post-703863-2">2</a>`
      )
    );

    const detail = await nodeSeekNotificationAdapter.loadDetail(
      {
        source: 'nodeseek',
        id: 'at-me:42',
        kind: 'mention',
        actor: { name: '目标用户' },
        title: '目标主题',
        createdAt: null,
        unread: false,
        target: {
          type: 'topic-post',
          topicId: '703863',
          postNumber: 12,
          postId: '13',
          url: 'https://www.nodeseek.com/post-703863-1'
        },
        remoteGroup: 'at-me',
        remoteReadId: '42'
      },
      { fetcher, identityKey: 'nodeseek:7', userId: '7' }
    );

    expect(detail.contentHtml).toContain('目标回复');
    expect(fetcher.mock.calls.map(([input]) => new URL(input).pathname)).toContain('/post-703863-2');
  });

  it.each([undefined, 1, 22])('uses comment id when the notification floor is %s', async (postNumber) => {
    const payload = (comments: unknown[], page: number) =>
      Buffer.from(
        JSON.stringify({
          postData: {
            postId: 703863,
            postPage: page,
            postPageCount: 2,
            title: '目标主题',
            replyCount: 12,
            op: { name: '楼主' },
            comments
          }
        })
      ).toString('base64');
    const firstPage = payload([{ commentId: 1, poster: { name: '楼主' }, markdown: '主楼正文' }], 1);
    const secondPage = payload(
      [{ commentId: 13, floorIndex: 12, poster: { name: '目标用户' }, markdown: '精确回复' }],
      2
    );
    const fetcher = vi.fn(async (input: string) =>
      html(
        new URL(input).pathname.endsWith('/post-703863-2')
          ? `<script>${secondPage}</script>`
          : `<script>${firstPage}</script><a href="/post-703863-2">2</a>`
      )
    );

    const detail = await nodeSeekNotificationAdapter.loadDetail(
      {
        source: 'nodeseek',
        id: 'at-me:42',
        kind: 'mention',
        actor: { name: '目标用户' },
        title: '目标主题',
        createdAt: null,
        unread: false,
        target: {
          type: 'topic-post',
          topicId: '703863',
          ...(postNumber ? { postNumber } : {}),
          postId: '13',
          url: 'https://www.nodeseek.com/post-703863-1'
        }
      },
      { fetcher, identityKey: 'nodeseek:7', userId: '7' }
    );

    expect(detail.contentHtml).toContain('精确回复');
    expect(detail.contentHtml).not.toContain('主楼正文');
  });

  it('uses the notification floor as a page hint without depending on replyCount', async () => {
    const payload = (comments: unknown[], page: number) =>
      Buffer.from(
        JSON.stringify({
          postData: {
            postId: 703863,
            postPage: page,
            postPageCount: 3,
            title: '目标主题',
            op: { name: '楼主' },
            comments
          }
        })
      ).toString('base64');
    const firstPage = payload([{ commentId: 1, poster: { name: '楼主' }, markdown: '主楼正文' }], 1);
    const thirdPage = payload(
      [{ commentId: 31, floorIndex: 21, poster: { name: '目标用户' }, markdown: '第三页精确回复' }],
      3
    );
    const fetcher = vi.fn(async (input: string) =>
      html(
        new URL(input).pathname.endsWith('/post-703863-3')
          ? `<script>${thirdPage}</script>`
          : `<script>${firstPage}</script>`
      )
    );

    const detail = await nodeSeekNotificationAdapter.loadDetail(
      {
        source: 'nodeseek',
        id: 'at-me:31',
        kind: 'mention',
        actor: { name: '目标用户' },
        title: '目标主题',
        createdAt: null,
        unread: false,
        target: {
          type: 'topic-post',
          topicId: '703863',
          postNumber: 21,
          postId: '31',
          url: 'https://www.nodeseek.com/post-703863-1'
        }
      },
      { fetcher, identityKey: 'nodeseek:7', userId: '7' }
    );

    expect(detail.contentHtml).toContain('第三页精确回复');
    expect(fetcher.mock.calls.map(([input]) => new URL(input).pathname)).toContain('/post-703863-3');
  });

  it('marks mention and reply rows with the exact endpoint field names', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return json({ success: true });
    });
    const access = { fetcher, identityKey: 'nodeseek:7', userId: '7' };
    const detail = { notification: null as never, title: '' };

    await nodeSeekNotificationAdapter.markRead(
      {
        source: 'nodeseek',
        id: 'at-me:11',
        kind: 'mention',
        actor: { name: '甲' },
        title: '主题',
        createdAt: null,
        unread: true,
        target: { type: 'topic', topicId: '1', url: 'https://www.nodeseek.com/post-1-1' },
        remoteGroup: 'at-me',
        remoteReadId: '11'
      },
      detail,
      access
    );
    await nodeSeekNotificationAdapter.markRead(
      {
        source: 'nodeseek',
        id: 'reply-to-me:12',
        kind: 'reply',
        actor: { name: '乙' },
        title: '主题',
        createdAt: null,
        unread: true,
        target: { type: 'topic', topicId: '2', url: 'https://www.nodeseek.com/post-2-1' },
        remoteGroup: 'reply-to-me',
        remoteReadId: '12'
      },
      detail,
      access
    );

    expect(calls.map(({ url, init }) => [new URL(url).pathname, init?.method, init?.body])).toEqual([
      ['/api/notification/at-me/markViewed', 'POST', JSON.stringify({ atMe: [11] })],
      ['/api/notification/reply-to-me/markViewed', 'POST', JSON.stringify({ replys: [12] })]
    ]);
  });

  it('loads rich private messages and marks only the exact unread incoming message ids', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (new URL(url).pathname.endsWith('/message/with/9')) {
        return json({
          talkTo: { member_name: '丙' },
          msgArray: [
            {
              id: 20,
              sender_id: 9,
              receiver_id: 7,
              content: '**新消息** :ac04:',
              is_markdown: true,
              created_at: '2026-08-02T12:00:00Z',
              viewed: false
            },
            {
              id: 19,
              sender_id: 7,
              receiver_id: 9,
              content: '*我的回复*',
              is_markdown: false,
              created_at: '2026-08-01T12:00:00Z',
              viewed: false
            },
            {
              id: 18,
              sender_id: 9,
              receiver_id: 7,
              content: '旧消息',
              is_markdown: false,
              created_at: '2026-07-31T12:00:00Z',
              viewed: true
            }
          ]
        });
      }
      return json({ success: true });
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'message:9',
      kind: 'private-message' as const,
      actor: { id: '9', name: '丙' },
      title: '丙',
      createdAt: null,
      unread: true,
      target: { type: 'private-conversation' as const, conversationId: '9' },
      remoteGroup: 'message'
    };
    const access = { fetcher, identityKey: 'nodeseek:7', userId: '7' };

    const detail = await nodeSeekNotificationAdapter.loadDetail(item, access);
    await nodeSeekNotificationAdapter.markRead(item, detail, access);

    expect(detail.messages?.map((message) => [message.id, message.mine])).toEqual([
      ['18', false],
      ['19', true],
      ['20', false]
    ]);
    expect(detail.reply).toEqual({ format: 'markdown' });
    expect(detail.messages?.[2]?.contentHtml).toContain('<strong>新消息</strong>');
    expect(detail.messages?.[2]?.contentHtml).toContain(
      '<img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/04.png" alt="ac04">'
    );
    expect(detail.messages?.[1]).toMatchObject({ contentText: '*我的回复*' });
    expect(detail.unreadMessageIds).toEqual(['20']);
    expect(calls.at(-1)).toMatchObject({
      init: { method: 'POST', body: JSON.stringify({ messages: [20] }) }
    });
    expect(new URL(calls.at(-1)?.url || '').pathname).toBe('/api/notification/message/markViewed');
  });

  it('serializes the exact NodeSeek receiver UID as a number', async () => {
    let wireBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      wireBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json(typeof wireBody.receiverUid === 'number' ? { success: true } : { success: false });
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'message:51153',
      kind: 'private-message' as const,
      actor: { id: '51153', name: 'KongB' },
      title: 'KongB',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '51153' }
    };

    await expect(
      nodeSeekNotificationAdapter.replyToConversation(item, '  **你好**  ', {
        fetcher,
        identityKey: 'nodeseek:7',
        userId: '7'
      })
    ).resolves.toEqual({ confirmed: true });
    expect(wireBody).toEqual({ receiverUid: 51153, content: '**你好**', markdown: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).pathname).toBe('/api/notification/message/send');
  });

  it.each(['', 'not-a-uid', '0', '9007199254740992'])(
    'rejects invalid receiver UID %s before network access',
    async (conversationId) => {
      const fetcher = vi.fn(async () => json({ success: true }));
      const item = {
        source: 'nodeseek' as const,
        id: `message:${conversationId}`,
        kind: 'private-message' as const,
        actor: { id: conversationId, name: '对方' },
        title: '对方',
        createdAt: null,
        unread: false,
        target: { type: 'private-conversation' as const, conversationId }
      };

      await expect(
        nodeSeekNotificationAdapter.replyToConversation(item, '内容', {
          fetcher,
          identityKey: 'nodeseek:7',
          userId: '7'
        })
      ).rejects.toThrow('NodeSeek 私信会话标识不正确');
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it('does not confirm an ambiguous NodeSeek send response', async () => {
    const fetcher = vi.fn(async () => json({}));
    const item = {
      source: 'nodeseek' as const,
      id: 'message:51153',
      kind: 'private-message' as const,
      actor: { id: '51153', name: 'KongB' },
      title: 'KongB',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '51153' }
    };

    await expect(
      nodeSeekNotificationAdapter.replyToConversation(item, '内容', {
        fetcher,
        identityKey: 'nodeseek:7',
        userId: '7'
      })
    ).resolves.toEqual({ confirmed: false, message: 'NodeSeek 未确认私信已发送' });
  });

  it('reads the three unread counters and marks all three groups through their real endpoints', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new URL(url).pathname.endsWith('/unread-count')
        ? json({ reply: 2, atMe: 1, message: 3 })
        : json({ success: true });
    });
    const access = { fetcher, identityKey: 'nodeseek:7', userId: '7' };

    await expect(nodeSeekNotificationAdapter.readUnreadSnapshot(access)).resolves.toMatchObject({
      total: 6
    });
    await expect(nodeSeekNotificationAdapter.markAllRead(access)).resolves.toEqual({ confirmed: true });

    expect(
      calls
        .filter(({ init }) => init?.method === 'POST')
        .map(({ url }) => `${new URL(url).pathname}${new URL(url).search}`)
    ).toEqual([
      '/api/notification/at-me/markViewed?all=true',
      '/api/notification/reply-to-me/markViewed?all=true',
      '/api/notification/message/markViewed?all=true'
    ]);
  });
});
