import { describe, expect, it, vi } from 'vitest';

import type { NotificationAdapter, NotificationAdapterAccess } from './notificationAdapter';
import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { createNotificationGateway as createProductionNotificationGateway } from './notificationGateway';

type GatewayOptions = Parameters<typeof createProductionNotificationGateway>[0];

function createNotificationGateway(
  options: Omit<GatewayOptions, 'privateAccessAllowed' | 'sourceAllowed'> &
    Partial<Pick<GatewayOptions, 'privateAccessAllowed' | 'sourceAllowed'>>
) {
  return createProductionNotificationGateway({
    ...options,
    privateAccessAllowed: options.privateAccessAllowed || (() => true),
    sourceAllowed: options.sourceAllowed || (() => true)
  });
}

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
  it('[REG-PERF-019] expires the captured notification epoch only for raw HTTP 401', async () => {
    const sourceAdapter = adapter('ok');
    sourceAdapter.listPage = vi.fn(async (options) => {
      await options.fetcher?.('https://www.nodeseek.com/notification');
      return { items: [], cursor: null, hasMore: false };
    });
    const transport = vi
      .fn<NonNullable<NotificationAdapterAccess['fetcher']>>()
      .mockResolvedValueOnce(new Response('<html>login</html>', { status: 401 }))
      .mockResolvedValueOnce(new Response('<html>forbidden</html>', { status: 403 }));
    const onSessionExpired = vi.fn();
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
      },
      onSessionExpired,
      readAccess: async () => ({ fetcher: transport, identityKey: 'nodeseek:42', userId: '42' }),
      requestSessionEpoch: () => 9
    });

    await expect(gateway.listPage('nodeseek')).rejects.toMatchObject({ reason: 'http-401', status: 401 });
    expect(onSessionExpired).toHaveBeenCalledWith('nodeseek', 9);

    await expect(gateway.listPage('nodeseek')).resolves.toMatchObject({ items: [] });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('rejects every direct source operation before access or adapter work when the source is disabled', async () => {
    const sourceAdapter = adapter('ok');
    sourceAdapter.markAllRead = vi.fn(async () => ({ confirmed: true }));
    const transport = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: 'https://img.example/node.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    const readAccess = vi.fn(async () => ({
      fetcher: transport,
      identityKey: 'nodeseek:user',
      userId: 'user'
    }));
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
      },
      readAccess,
      sourceAllowed: () => false
    });
    const item = {
      source: 'nodeseek' as const,
      id: 'message:user',
      kind: 'private-message' as const,
      actor: { name: 'alice' },
      title: 'notification',
      createdAt: null,
      unread: true,
      target: { type: 'private-conversation' as const, conversationId: '9' }
    };
    const detail = { notification: item, title: item.title };
    const operations = [
      gateway.getCategories('nodeseek', 'nodeseek:user'),
      gateway.listPage('nodeseek', { expectedIdentityKey: 'nodeseek:user' }),
      gateway.readUnreadSnapshot('nodeseek'),
      gateway.loadDetail(item, 'nodeseek:user'),
      gateway.markRead(item, detail, 'nodeseek:user'),
      gateway.replyToConversation(item, 'reply', 'nodeseek:user'),
      gateway.uploadReplyImage('nodeseek', {
        expectedIdentityKey: 'nodeseek:user',
        file: { uri: 'file:///image.png', name: 'image.png', mimeType: 'image/png' },
        nodeImageApiKey: 'key'
      }),
      gateway.markAllRead('nodeseek', 'nodeseek:user')
    ];

    await Promise.all(
      operations.map((operation) =>
        expect(operation).rejects.toMatchObject({ reason: 'source-disabled', source: 'nodeseek' })
      )
    );
    expect(readAccess).not.toHaveBeenCalled();
    expect(sourceAdapter.getCategories).not.toHaveBeenCalled();
    expect(sourceAdapter.listPage).not.toHaveBeenCalled();
    expect(sourceAdapter.readUnreadSnapshot).not.toHaveBeenCalled();
    expect(sourceAdapter.loadDetail).not.toHaveBeenCalled();
    expect(sourceAdapter.markRead).not.toHaveBeenCalled();
    expect(sourceAdapter.replyToConversation).not.toHaveBeenCalled();
    expect(sourceAdapter.markAllRead).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rechecks source membership after access and adapter awaits so a mid-flight disable cannot continue or return data', async () => {
    let allowed = true;
    let resolveAccess!: (access: NotificationAdapterAccess) => void;
    const access = new Promise<NotificationAdapterAccess>((resolve) => {
      resolveAccess = resolve;
    });
    const sourceAdapter = adapter('ok');
    const readAccess = vi.fn(async () => access);
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
      },
      readAccess,
      sourceAllowed: () => allowed
    });

    const stoppedBeforeAdapter = gateway.listPage('nodeseek');
    await vi.waitFor(() => expect(readAccess).toHaveBeenCalledTimes(1));
    allowed = false;
    resolveAccess({ identityKey: 'nodeseek:user', userId: 'user' });
    await expect(stoppedBeforeAdapter).rejects.toMatchObject({ reason: 'source-disabled' });
    expect(sourceAdapter.listPage).not.toHaveBeenCalled();

    allowed = true;
    let resolvePage!: (page: { items: []; cursor: null; hasMore: false }) => void;
    sourceAdapter.listPage = vi.fn(
      () =>
        new Promise<{ items: []; cursor: null; hasMore: false }>((resolve) => {
          resolvePage = resolve;
        })
    );
    const stoppedAfterAdapter = gateway.listPage('nodeseek');
    await vi.waitFor(() => expect(sourceAdapter.listPage).toHaveBeenCalledTimes(1));
    allowed = false;
    resolvePage({ items: [], cursor: null, hasMore: false });
    await expect(stoppedAfterAdapter).rejects.toMatchObject({ reason: 'source-disabled' });
  });

  it('[gateway] stops a multi-request adapter before its next transport when the source is disabled', async () => {
    let allowed = true;
    const transport = vi.fn(async (input: string) => {
      if (input === '/first') allowed = false;
      return new Response('{}', { status: 200 });
    });
    const sourceAdapter = adapter('ok');
    sourceAdapter.markAllRead = vi.fn(async (options) => {
      await options.fetcher!('/first');
      await options.fetcher!('/second');
      return { confirmed: true };
    });
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
      },
      readAccess: async () => ({ fetcher: transport, identityKey: 'nodeseek:user', userId: 'user' }),
      sourceAllowed: () => allowed
    });

    await expect(gateway.markAllRead('nodeseek', 'nodeseek:user')).rejects.toMatchObject({
      reason: 'source-disabled',
      source: 'nodeseek'
    });
    expect(transport.mock.calls.map(([input]) => input)).toEqual(['/first']);
  });

  it.each(['list', 'snapshot', 'detail', 'mutate'] as const)(
    '[REG-ACCOUNT-041] stops %s before its next private transport when canonical account access closes mid-flight',
    async (operationName) => {
      let privateAccessCurrent = true;
      const firstResponse = Promise.withResolvers<Response>();
      const privateAccessAllowed = vi.fn(() => privateAccessCurrent);
      const transport = vi.fn((input: string) =>
        input === '/first' ? firstResponse.promise : Promise.resolve(new Response('{}', { status: 200 }))
      );
      const committed = vi.fn();
      const runPrivateTransport = async (access: NotificationAdapterAccess) => {
        await access.fetcher!('/first');
        await access.fetcher!('/second');
        committed();
      };
      const sourceAdapter = adapter('ok');
      sourceAdapter.listPage = vi.fn(async (access) => {
        await runPrivateTransport(access);
        return { items: [], cursor: null, hasMore: false };
      });
      sourceAdapter.readUnreadSnapshot = vi.fn(async (access) => {
        await runPrivateTransport(access);
        return { total: 0, checkedAt: '2026-08-10T00:00:00Z' };
      });
      sourceAdapter.loadDetail = vi.fn(async (item, access) => {
        await runPrivateTransport(access);
        return { notification: item, title: item.title };
      });
      sourceAdapter.markRead = vi.fn(async (_item, _detail, access) => {
        await runPrivateTransport(access);
        return { confirmed: true };
      });
      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: sourceAdapter,
          linuxdo: adapter('ok'),
          yaohuo: adapter('ok')
        },
        privateAccessAllowed,
        readAccess: async () => ({ fetcher: transport, identityKey: 'nodeseek:user', userId: 'user' })
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
      const operations = {
        list: () => gateway.listPage('nodeseek', { expectedIdentityKey: 'nodeseek:user' }),
        snapshot: () => gateway.readUnreadSnapshot('nodeseek'),
        detail: () => gateway.loadDetail(item, 'nodeseek:user'),
        mutate: () => gateway.markRead(item, { notification: item, title: item.title }, 'nodeseek:user')
      };

      const operation = operations[operationName]();
      await vi.waitFor(() => expect(transport).toHaveBeenCalledWith('/first', undefined));
      privateAccessCurrent = false;
      firstResponse.resolve(new Response('{}', { status: 200 }));

      await expect(operation).rejects.toMatchObject({ reason: 'private-access-stale', source: 'nodeseek' });
      expect(privateAccessAllowed).toHaveBeenCalledWith('nodeseek', 'nodeseek:user');
      expect(transport).toHaveBeenCalledTimes(1);
      expect(committed).not.toHaveBeenCalled();
    }
  );

  it('does no access or adapter work for an explicit empty aggregate allowlist', async () => {
    const sourceAdapter = adapter('ok');
    const readAccess = vi.fn(async () => ({ identityKey: 'nodeseek:user', userId: 'user' }));
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
      },
      readAccess,
      sourceAllowed: () => true
    });

    await expect(gateway.listAllPage({ sources: [] })).resolves.toMatchObject({ items: [], hasMore: false });
    expect(readAccess).not.toHaveBeenCalled();
    expect(sourceAdapter.listPage).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-031] forwards adapter-owned categories into category-scoped list reads', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
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
      yaohuo: adapter('ok')
    };
    const readAccess = vi.fn(async (source: NotificationSource): Promise<NotificationAdapterAccess> => ({
      identityKey: `${source}:user`,
      userId: 'user'
    }));
    const gateway = createNotificationGateway({ adapters, readAccess });

    const result = await gateway.listAllPage({ sources: notificationSources });

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'yaohuo']);
    expect(result.errors.linuxdo).toMatchObject({ message: 'source unavailable', kind: 'ordinary' });
  });

  it('rejects anonymous or mismatched access before any source request', async () => {
    const sourceAdapter = adapter('ok');
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
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
        yaohuo: adapter('ok')
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
        yaohuo: adapter('ok')
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
        yaohuo: adapter('ok')
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
        yaohuo: adapter('ok')
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
        yaohuo: adapter('ok')
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

  it('[REG-NOTIFY-031] returns an unconfirmed reply without persisting its private body in diagnostics', async () => {
    const sourceAdapter = adapter('ok');
    sourceAdapter.replyToConversation = vi.fn(async () => ({ confirmed: false, message: '未确认' }));
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: adapter('ok'),
        yaohuo: adapter('ok')
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

  it('[REG-NOTIFY-032] keeps LinuxDo composer requests on the captured identity and guards CSRF before POST', async () => {
    let identityCurrent = true;
    const privateAccessAllowed = vi.fn((_source: NotificationSource, identityKey: string) => {
      expect(identityKey).toBe('linuxdo:alice');
      return identityCurrent;
    });
    const transport = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/session/csrf')) {
        identityCurrent = false;
        return new Response(JSON.stringify({ csrf: 'token' }), { status: 200 });
      }
      return new Response(JSON.stringify({ usage_count: 1 }), { status: 200 });
    });
    const gateway = createNotificationGateway({
      privateAccessAllowed,
      readAccess: async () => ({
        fetcher: transport,
        identityKey: 'linuxdo:alice',
        userAgent: 'test-agent',
        userId: 'alice'
      })
    }) as ReturnType<typeof createProductionNotificationGateway> & {
      recordLinuxDoTemplateUse(id: string, expectedIdentityKey: string, signal?: AbortSignal): Promise<void>;
    };

    await expect(gateway.recordLinuxDoTemplateUse('7', 'linuxdo:alice')).rejects.toMatchObject({
      reason: 'private-access-stale'
    });
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual(['https://linux.do/session/csrf']);
    expect(privateAccessAllowed).toHaveBeenCalled();
  });

  it('[REG-NOTIFY-032] stops an aborted LinuxDo composer request before reading access', async () => {
    const readAccess = vi.fn(async () => ({ identityKey: 'linuxdo:alice', userId: 'alice' }));
    const gateway = createNotificationGateway({ readAccess }) as ReturnType<
      typeof createProductionNotificationGateway
    > & {
      loadLinuxDoTemplates(expectedIdentityKey: string, signal?: AbortSignal): Promise<unknown[]>;
    };
    const controller = new AbortController();
    controller.abort();

    await expect(gateway.loadLinuxDoTemplates('linuxdo:alice', controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
    expect(readAccess).not.toHaveBeenCalled();
  });

  it('continues only sources that still have another page', async () => {
    const adapters = Object.fromEntries(
      (['nodeseek', 'linuxdo', 'yaohuo'] as NotificationSource[]).map((source) => [
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

    const first = await gateway.listAllPage({ sources: notificationSources });
    const second = await gateway.listAllPage({ cursors: first.nextCursors, sources: notificationSources });

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
        yaohuo: adapter('ok')
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
