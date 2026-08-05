import { describe, expect, it, vi } from 'vitest';

import type { NotificationAdapter, NotificationAdapterAccess } from './notificationAdapter';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { createNotificationGateway } from './notificationGateway';

function adapter(result: 'ok' | 'fail'): NotificationAdapter {
  return {
    getCategories: vi.fn(async () => [{ id: 'all', label: '全部' }]),
    listPage: vi.fn(async (options) => {
      if (result === 'fail') throw new Error('source unavailable');
      const source = options.identityKey.split(':')[0] as NotificationSource;
      return {
        items: [
          {
            source,
            id: `${source}-1`,
            kind: 'system' as const,
            actor: { name: source },
            title: source,
            createdAt: null,
            unread: true,
            target: { type: 'information' as const }
          }
        ],
        cursor: null,
        hasMore: false
      };
    }),
    readUnreadSnapshot: vi.fn(async () => ({ total: 1, checkedAt: '2026-08-03T00:00:00Z' })),
    loadDetail: vi.fn(async (item) => ({ notification: item, title: item.title })),
    replyToConversation: vi.fn(async () => ({ confirmed: true })),
    markRead: vi.fn(async () => ({ confirmed: true }))
  };
}

describe('notification gateway', () => {
  it('[REG-NOTIFY-031] forwards adapter-owned categories into category-scoped list reads', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:user', userId: 'user' })
    });

    await expect(gateway.getCategories('nodeseek', 'nodeseek:user')).resolves.toEqual([{ id: 'all', label: '全部' }]);
    await gateway.listPage('nodeseek', { categoryId: 'messages', expectedIdentityKey: 'nodeseek:user' });

    expect(sourceAdapter.listPage).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'messages' }));
  });

  it('isolates a failed source while returning the other sources', async () => {
    const adapters: Record<NotificationSource, NotificationAdapter> = {
      nodeseek: adapter('ok'),
      linuxdo: adapter('fail'),
      yaohuo: adapter('ok'),
      xiaoyinsi: adapter('ok')
    };
    const readAccess = vi.fn(async (source: NotificationSource): Promise<NotificationAdapterAccess> => ({
      identityKey: `${source}:user`,
      userId: 'user'
    }));
    const gateway = createNotificationGateway({ adapters, readAccess });

    const result = await gateway.listAllPage();

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'yaohuo', 'xiaoyinsi']);
    expect(result.errors.linuxdo).toMatchObject({ message: 'source unavailable', kind: 'ordinary' });
  });

  it('rejects anonymous or mismatched access before any source request', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:old-user', userId: 'new-user' })
    });

    await expect(gateway.listPage('nodeseek')).rejects.toThrow('账号身份尚未确认');
    expect(sourceAdapter.listPage).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-021] rejects a list retry after the confirmed account changes', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:new-user', userId: 'new-user' })
    });

    await expect(gateway.listPage('nodeseek', { expectedIdentityKey: 'nodeseek:old-user' })).rejects.toThrow(
      '账号状态已变化'
    );
    expect(sourceAdapter.listPage).not.toHaveBeenCalled();
  });

  it('rejects a read write when the confirmed account no longer matches the opened notification', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:new-user', userId: 'new-user' })
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'reply:old-user',
      kind: 'reply' as const,
      actor: { name: 'alice' },
      title: 'old account notification',
      createdAt: null,
      unread: true,
      target: { type: 'information' as const }
    };

    await expect(
      gateway.markRead(item, { notification: item, title: item.title }, 'nodeseek:old-user')
    ).rejects.toThrow('账号状态已变化');
    expect(sourceAdapter.markRead).not.toHaveBeenCalled();
  });

  it('rejects detail loading when the confirmed account no longer matches the route', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:new-user', userId: 'new-user' })
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'reply:old-user',
      kind: 'reply' as const,
      actor: { name: 'alice' },
      title: 'old account notification',
      createdAt: null,
      unread: true,
      target: { type: 'information' as const }
    };

    await expect(gateway.loadDetail(item, 'nodeseek:old-user')).rejects.toThrow('账号状态已变化');
    expect(sourceAdapter.loadDetail).not.toHaveBeenCalled();
  });

  it('rejects mark-all when the confirmed account no longer matches the selected source', async () => {
    const sourceAdapter = adapter('ok');
    sourceAdapter.markAllRead = vi.fn(async () => ({ confirmed: true }));
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:new-user', userId: 'new-user' })
    });

    await expect(gateway.markAllRead('nodeseek', 'nodeseek:old-user')).rejects.toThrow('账号状态已变化');
    expect(sourceAdapter.markAllRead).not.toHaveBeenCalled();
  });

  it('does not start an adapter write after the caller cancels an in-flight access check', async () => {
    const sourceAdapter = adapter('ok');
    let resolveAccess!: (access: NotificationAdapterAccess) => void;
    const access = new Promise<NotificationAdapterAccess>((resolve) => {
      resolveAccess = resolve;
    });
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => access
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'reply:user',
      kind: 'reply' as const,
      actor: { name: 'alice' },
      title: 'notification',
      createdAt: null,
      unread: true,
      target: { type: 'information' as const }
    };
    const controller = new AbortController();

    const write = gateway.markRead(item, { notification: item, title: item.title }, 'nodeseek:user', controller.signal);
    controller.abort();
    resolveAccess({ identityKey: 'nodeseek:user', userId: 'user' });

    await expect(write).rejects.toMatchObject({ name: 'AbortError' });
    expect(sourceAdapter.markRead).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-031] validates identity, abort, content, and Xiaoyinsi write scope before replying', async () => {
    const sourceAdapter = adapter('ok');
    let canWrite = false;
    const adapters = {
      nodeseek: sourceAdapter,
      linuxdo: adapter('ok'),
      yaohuo: adapter('ok'),
      xiaoyinsi: sourceAdapter
    };
    const item = {
      source: 'xiaoyinsi' as const,
      id: 'private-topic:201',
      kind: 'private-message' as const,
      actor: { name: 'Bob' },
      title: '私信',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '201' }
    };
    const gateway = createNotificationGateway({
      adapters,
      readAccess: async () => ({
        identityKey: 'xiaoyinsi:user',
        userId: 'user',
        xiaoyinsiCredentials: {
          apiKey: 'secret',
          clientId: 'client',
          scopes: canWrite ? ['read', 'write', 'notifications'] : ['read', 'notifications']
        }
      })
    });

    await expect(gateway.replyToConversation(item, '收到', 'xiaoyinsi:old-user')).rejects.toThrow('账号状态已变化');
    await expect(gateway.replyToConversation(item, '收到', 'xiaoyinsi:user')).rejects.toThrow('小隐寺需要升级写入授权');
    canWrite = true;
    await expect(gateway.replyToConversation(item, '   ', 'xiaoyinsi:user')).rejects.toThrow('请输入回复内容');
    const controller = new AbortController();
    controller.abort();
    await expect(gateway.replyToConversation(item, '收到', 'xiaoyinsi:user', controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(sourceAdapter.replyToConversation).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-031] returns an unconfirmed reply without persisting its private body in diagnostics', async () => {
    const sourceAdapter = adapter('ok');
    sourceAdapter.replyToConversation = vi.fn(async () => ({ confirmed: false, message: '未确认' }));
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:user', userId: 'user' })
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'message:9',
      kind: 'private-message' as const,
      actor: { name: 'Bob' },
      title: '私信',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation' as const, conversationId: '9' }
    };
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    try {
      await expect(gateway.replyToConversation(item, 'PRIVATE_REPLY_BODY', 'nodeseek:user')).resolves.toEqual({
        confirmed: false,
        message: '未确认'
      });
    } finally {
      setDiagnosticWriter(null);
    }

    expect(lines.join('')).not.toContain('PRIVATE_REPLY_BODY');
    expect(sourceAdapter.replyToConversation).toHaveBeenCalledWith(
      item,
      'PRIVATE_REPLY_BODY',
      expect.objectContaining({ identityKey: 'nodeseek:user' })
    );
  });

  it('[REG-NOTIFY-032] uploads private-message images through the existing NodeImage and Discourse clients', async () => {
    const file = {
      uri: 'file:///PRIVATE_IMAGE_NAME.png',
      name: 'PRIVATE_IMAGE_NAME.png',
      mimeType: 'image/png'
    };
    const nodeFetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: 'https://img.example/node.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    const nodeGateway = createNotificationGateway({
      readAccess: async () => ({
        fetcher: nodeFetcher,
        identityKey: 'nodeseek:user',
        userId: 'user'
      })
    });
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    try {
      await expect(
        nodeGateway.uploadReplyImage('nodeseek', {
          expectedIdentityKey: 'nodeseek:user',
          file,
          nodeImageApiKey: 'PRIVATE_NODEIMAGE_KEY'
        })
      ).resolves.toEqual({ markup: '![PRIVATE_IMAGE_NAME.png](https://img.example/node.png)' });
    } finally {
      setDiagnosticWriter(null);
    }
    expect(nodeFetcher).toHaveBeenCalledWith(
      'https://api.nodeimage.com/api/upload',
      expect.objectContaining({ method: 'POST' })
    );
    expect(diagnosticLines.join('')).not.toMatch(/PRIVATE_IMAGE_NAME|PRIVATE_NODEIMAGE_KEY/);

    const discourseFetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.endsWith('/session/csrf')
        ? new Response(JSON.stringify({ csrf: 'csrf-token' }), { status: 200 })
        : new Response(JSON.stringify({ short_url: '/uploads/linux.png' }), { status: 200 });
    });
    const discourseGateway = createNotificationGateway({
      readAccess: async () => ({
        fetcher: discourseFetcher,
        identityKey: 'linuxdo:user',
        userAgent: 'test-agent',
        userId: 'user'
      })
    });
    await expect(
      discourseGateway.uploadReplyImage('linuxdo', {
        expectedIdentityKey: 'linuxdo:user',
        file
      })
    ).resolves.toEqual({ markup: '![PRIVATE_IMAGE_NAME.png](https://linux.do/uploads/linux.png)' });
    expect(discourseFetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://linux.do/session/csrf',
      'https://linux.do/uploads.json'
    ]);
  });

  it('[REG-NOTIFY-032] rejects Xiaoyinsi private-message image upload before transport without write scope', async () => {
    const fetcher = vi.fn();
    const gateway = createNotificationGateway({
      readAccess: async () => ({
        fetcher,
        identityKey: 'xiaoyinsi:user',
        userId: 'user',
        xiaoyinsiCredentials: {
          apiKey: 'secret',
          clientId: 'client',
          scopes: ['read', 'notifications']
        }
      })
    });

    await expect(
      gateway.uploadReplyImage('xiaoyinsi', {
        expectedIdentityKey: 'xiaoyinsi:user',
        file: { uri: 'file:///image.png', name: 'image.png', mimeType: 'image/png' }
      })
    ).rejects.toThrow('小隐寺需要升级写入授权');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('continues only sources that still have another page', async () => {
    const adapters = Object.fromEntries(
      (['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as NotificationSource[]).map((source) => [
        source,
        {
          ...adapter('ok'),
          listPage: vi.fn(async ({ cursor }) => ({
            items: [],
            cursor: source === 'nodeseek' && cursor !== 'next' ? 'next' : null,
            hasMore: source === 'nodeseek' && cursor !== 'next'
          }))
        }
      ])
    ) as unknown as Record<NotificationSource, NotificationAdapter>;
    const gateway = createNotificationGateway({
      adapters,
      readAccess: async (source) => ({ identityKey: `${source}:user`, userId: 'user' })
    });

    const first = await gateway.listAllPage();
    const second = await gateway.listAllPage({ cursors: first.nextCursors });

    expect(adapters.nodeseek.listPage).toHaveBeenCalledTimes(2);
    expect(adapters.linuxdo.listPage).toHaveBeenCalledTimes(1);
    expect(second.hasMore).toBe(false);
  });

  it('records source diagnostics without persisting notification content', async () => {
    const sourceAdapter = adapter('ok');
    sourceAdapter.listPage = vi.fn(async () => ({
      items: [
        {
          source: 'nodeseek' as const,
          id: 'private-id',
          kind: 'reply' as const,
          actor: { name: 'PRIVATE_ACTOR' },
          title: 'PRIVATE_TITLE',
          preview: 'PRIVATE_PREVIEW',
          createdAt: null,
          unread: true,
          target: { type: 'information' as const }
        }
      ],
      cursor: null,
      hasMore: false
    }));
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok'),
        xiaoyinsi: adapter('ok')
      },
      readAccess: async () => ({ identityKey: 'nodeseek:user', userId: 'user' })
    });
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });

    try {
      await gateway.listPage('nodeseek');
    } finally {
      setDiagnosticWriter(null);
    }

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({
        area: 'source',
        operation: 'load',
        phase: 'finish',
        outcome: 'success',
        source: 'nodeseek',
        itemCount: 1
      })
    );
    expect(lines.join('')).not.toMatch(/private-id|PRIVATE_ACTOR|PRIVATE_TITLE|PRIVATE_PREVIEW/);
  });
});
