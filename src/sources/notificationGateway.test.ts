import { describe, expect, it, vi } from 'vitest';

import type { NotificationAdapter, NotificationAdapterAccess } from './notificationAdapter';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { createNotificationGateway } from './notificationGateway';

function adapter(result: 'ok' | 'fail'): NotificationAdapter {
  return {
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
    markRead: vi.fn(async () => ({ confirmed: true }))
  };
}

describe('notification gateway', () => {
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
