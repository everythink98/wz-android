import { describe, expect, it, vi } from 'vitest';

import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { buildSourceNotificationDigest, runNotificationBackgroundWorker } from './notificationWorker';
import { advanceNotificationDelivery, defaultNotificationState } from './notificationStore';

const permissionGranted = async () => true;
const dismissDigest = async () => undefined;

describe('background notification digest', () => {
  it('uses only the source, actor, action, and count without leaking message content', () => {
    const sensitiveItem = {
      source: 'nodeseek' as const,
      id: '1',
      kind: 'reply' as const,
      actor: { name: '张三' },
      title: 'TITLE_SENTINEL',
      preview: 'PREVIEW_SENTINEL',
      body: 'BODY_SENTINEL',
      token: 'TOKEN_SENTINEL',
      cookie: 'COOKIE_SENTINEL',
      createdAt: '2026-08-03T02:00:00Z',
      unread: true,
      target: { type: 'information' as const }
    };
    const digest = buildSourceNotificationDigest('nodeseek', [
      sensitiveItem,
      {
        source: 'nodeseek',
        id: '2',
        kind: 'mention',
        actor: { name: '李四' },
        title: '另一个标题',
        preview: '另一个正文',
        createdAt: '2026-08-03T01:00:00Z',
        unread: true,
        target: { type: 'information' }
      }
    ]);

    expect(digest).toEqual({
      title: 'NodeSeek',
      body: '张三回复了你的主题，另有 1 条新互动',
      data: { source: 'nodeseek' }
    });
    const serialized = JSON.stringify(digest);
    for (const sentinel of [
      'TITLE_SENTINEL',
      'PREVIEW_SENTINEL',
      'BODY_SENTINEL',
      'TOKEN_SENTINEL',
      'COOKIE_SENTINEL'
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });

  it('fails closed before account probes when proxy restoration fails', async () => {
    const probeAccess = vi.fn();
    const listPage = vi.fn();
    const replaceDigest = vi.fn();

    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => {
          throw new Error('proxy unavailable');
        },
        probeAccess,
        listPage
      },
      store: {
        load: async () => defaultNotificationState(),
        record: vi.fn(),
        setIdentifier: vi.fn()
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'proxy' });
    expect(probeAccess).not.toHaveBeenCalled();
    expect(listPage).not.toHaveBeenCalled();
    expect(replaceDigest).not.toHaveBeenCalled();
  });

  it('stops before account probes when the OS notification permission has been revoked', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true
    };
    const probeAccess = vi.fn();
    const listPage = vi.fn();
    const replaceDigest = vi.fn();

    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => undefined,
        probeAccess,
        listPage
      },
      store: {
        load: async () => state,
        record: vi.fn(),
        setIdentifier: vi.fn()
      },
      system: {
        permissionGranted: async () => false,
        replaceDigest,
        dismissDigest
      }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(probeAccess).not.toHaveBeenCalled();
    expect(listPage).not.toHaveBeenCalled();
    expect(replaceDigest).not.toHaveBeenCalled();
  });

  it('returns at the wall-clock deadline even when proxy restoration never settles', async () => {
    const result = await Promise.race([
      runNotificationBackgroundWorker({
        deadlineMs: 5,
        network: {
          restoreProxy: () => new Promise<void>(() => undefined),
          probeAccess: vi.fn(),
          listPage: vi.fn()
        },
        store: {
          load: vi.fn(),
          record: vi.fn(),
          setIdentifier: vi.fn()
        },
        system: { permissionGranted, replaceDigest: vi.fn(), dismissDigest }
      }),
      new Promise<{ status: 'test-timeout' }>((resolve) => setTimeout(() => resolve({ status: 'test-timeout' }), 100))
    ]);

    expect(result).toMatchObject({ status: 'failed', reason: 'deadline' });
  });

  it('keeps the wall-clock deadline when notification failure cleanup also stalls', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };

    const result = await Promise.race([
      runNotificationBackgroundWorker({
        deadlineMs: 5,
        network: {
          restoreProxy: async () => undefined,
          probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
          listPage: async () => ({
            items: [
              {
                source: 'nodeseek',
                id: 'new',
                kind: 'reply',
                actor: { name: '甲' },
                title: '不进入摘要',
                createdAt: null,
                unread: true,
                target: { type: 'information' }
              }
            ],
            cursor: null,
            hasMore: false
          })
        },
        store: {
          load: async () => state,
          record: async (_source, identityKey, scannedIds) => {
            const advanced = advanceNotificationDelivery(state.sources.nodeseek, identityKey, scannedIds);
            state.sources.nodeseek = advanced.state;
            return { newIds: advanced.newIds, rollback: () => new Promise<never>(() => undefined) };
          },
          setIdentifier: vi.fn()
        },
        system: {
          permissionGranted,
          replaceDigest: () => new Promise<never>(() => undefined),
          dismissDigest
        }
      }),
      new Promise<{ status: 'test-timeout' }>((resolve) => setTimeout(() => resolve({ status: 'test-timeout' }), 100))
    ]);

    expect(result).toMatchObject({ status: 'failed', reason: 'deadline' });
  });

  it('does not read or notify when the direct account probe does not match the saved identity', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true
    };
    const listPage = vi.fn();
    const record = vi.fn();
    const setIdentifier = vi.fn();
    const replaceDigest = vi.fn();

    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:8', userId: '8' }),
        listPage
      },
      store: {
        load: async () => state,
        record,
        setIdentifier
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(listPage).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(replaceDigest).not.toHaveBeenCalled();
    expect(setIdentifier).not.toHaveBeenCalled();
  });

  it('isolates a failed source while delivering another source', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    for (const source of ['nodeseek', 'linuxdo'] as const) {
      state.sources[source] = {
        ...state.sources[source],
        intentEnabled: true,
        identityKey: `${source}:7`,
        baselineReady: true,
        deliveredIds: ['old']
      };
    }
    const replaceDigest = vi.fn(
      async (_source: string, _digest: ReturnType<typeof buildSourceNotificationDigest>) => 'android-id'
    );
    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async (source) => ({ identityKey: `${source}:7`, userId: '7' }),
        listPage: async (source) => {
          if (source === 'linuxdo') throw new Error('temporary failure');
          return {
            items: [
              {
                source,
                id: 'new',
                kind: 'mention',
                actor: { name: '甲' },
                title: '不进入摘要',
                createdAt: null,
                unread: true,
                target: { type: 'information' }
              }
            ],
            cursor: null,
            hasMore: false
          };
        }
      },
      store: {
        load: async () => state,
        record: async (source, identityKey, scannedIds) => {
          const advanced = advanceNotificationDelivery(state.sources[source], identityKey, scannedIds);
          state.sources[source] = advanced.state;
          return {
            newIds: advanced.newIds,
            rollback: async () => {
              const released = new Set(advanced.newIds);
              state.sources[source].deliveredIds = state.sources[source].deliveredIds.filter((id) => !released.has(id));
            }
          };
        },
        setIdentifier: vi.fn()
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    });

    expect(result).toMatchObject({ status: 'success', delivered: 1, failedSources: 1, timedOut: false });
    expect(replaceDigest).toHaveBeenCalledTimes(1);
  });

  it('records a failed background source without persisting the raw failure message', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true
    };
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });

    try {
      await runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        network: {
          restoreProxy: async () => undefined,
          probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
          listPage: async () => {
            throw new Error('PRIVATE_BACKGROUND_FAILURE');
          }
        },
        store: {
          load: async () => state,
          record: vi.fn(),
          setIdentifier: vi.fn()
        },
        system: { permissionGranted, replaceDigest: vi.fn(), dismissDigest }
      });
    } finally {
      setDiagnosticWriter(null);
    }

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual(
      expect.objectContaining({
        area: 'source',
        operation: 'refresh',
        phase: 'finish',
        outcome: 'failure',
        source: 'nodeseek'
      })
    );
    expect(lines.join('')).not.toContain('PRIVATE_BACKGROUND_FAILURE');
  });

  it('delivers at most the latest 60 eligible items from one source in a single run', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const items = Array.from({ length: 61 }, (_, index) => ({
      source: 'nodeseek' as const,
      id: `new-${index}`,
      kind: 'reply' as const,
      actor: { name: `用户${index}` },
      title: `title-${index}`,
      preview: `preview-${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 3, 2, 0, 60 - index)).toISOString(),
      unread: true,
      target: { type: 'information' as const }
    }));
    let recordedIds: string[] = [];
    const replaceDigest = vi.fn(
      async (_source: string, _digest: ReturnType<typeof buildSourceNotificationDigest>) => 'android-id'
    );

    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items, cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: async (_source, identityKey, scannedIds) => {
          recordedIds = scannedIds;
          const advanced = advanceNotificationDelivery(state.sources.nodeseek, identityKey, scannedIds);
          state.sources.nodeseek = advanced.state;
          return {
            newIds: advanced.newIds,
            rollback: async () => {
              const released = new Set(advanced.newIds);
              state.sources.nodeseek.deliveredIds = state.sources.nodeseek.deliveredIds.filter(
                (id) => !released.has(id)
              );
            }
          };
        },
        setIdentifier: vi.fn()
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 60, failedSources: 0, timedOut: false });
    expect(recordedIds).toEqual(items.slice(0, 60).map((item) => item.id));
    expect(recordedIds).not.toContain('new-60');
    expect(replaceDigest).toHaveBeenCalledTimes(1);
    expect(replaceDigest.mock.calls[0]?.[1]).toMatchObject({
      body: '用户0回复了你的主题，另有 59 条新互动'
    });
  });

  it('continues source pages until it has scanned at most 60 latest items', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.yaohuo = {
      ...state.sources.yaohuo,
      intentEnabled: true,
      identityKey: 'yaohuo:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const items = Array.from({ length: 70 }, (_, index) => ({
      source: 'yaohuo' as const,
      id: `new-${index}`,
      kind: 'private-message' as const,
      actor: { name: `用户${index}` },
      title: `title-${index}`,
      createdAt: new Date(Date.UTC(2026, 7, 3, 2, 0, 70 - index)).toISOString(),
      unread: true,
      target: { type: 'information' as const }
    }));
    const requestedCursors: (string | null | undefined)[] = [];
    let recordedIds: string[] = [];

    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'yaohuo:7', userId: '7' }),
        listPage: async (_source, _access, _signal, cursor?: string | null) => {
          requestedCursors.push(cursor);
          return cursor === '2'
            ? { items: items.slice(35), cursor: null, hasMore: false }
            : { items: items.slice(0, 35), cursor: '2', hasMore: true };
        }
      },
      store: {
        load: async () => state,
        record: async (_source, identityKey, scannedIds) => {
          recordedIds = scannedIds;
          const advanced = advanceNotificationDelivery(state.sources.yaohuo, identityKey, scannedIds);
          state.sources.yaohuo = advanced.state;
          return { newIds: advanced.newIds, rollback: async () => undefined };
        },
        setIdentifier: vi.fn()
      },
      system: {
        permissionGranted,
        replaceDigest: async () => 'android-id',
        dismissDigest
      }
    });

    expect(result).toEqual({ status: 'success', delivered: 60, failedSources: 0, timedOut: false });
    expect(requestedCursors).toEqual([undefined, '2']);
    expect(recordedIds).toEqual(items.slice(0, 60).map((item) => item.id));
  });

  it('[REG-NOTIFY-008] retries the same remote id after notification or identifier persistence fails', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const items = [
      {
        source: 'nodeseek' as const,
        id: 'retry-me',
        kind: 'reply' as const,
        actor: { name: '甲' },
        title: '不进入摘要',
        createdAt: null,
        unread: true,
        target: { type: 'information' as const }
      }
    ];
    const replaceDigest = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('system unavailable'))
      .mockResolvedValue('android-id');
    const setIdentifier = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);
    const dependencies = {
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items, cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: async (_source: 'nodeseek', identityKey: string, scannedIds: string[]) => {
          const advanced = advanceNotificationDelivery(state.sources.nodeseek, identityKey, scannedIds);
          state.sources.nodeseek = advanced.state;
          return {
            newIds: advanced.newIds,
            rollback: async () => {
              const released = new Set(advanced.newIds);
              state.sources.nodeseek.deliveredIds = state.sources.nodeseek.deliveredIds.filter(
                (id) => !released.has(id)
              );
            }
          };
        },
        setIdentifier
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    };

    const notificationFailed = await runNotificationBackgroundWorker(dependencies);
    const identifierFailed = await runNotificationBackgroundWorker(dependencies);
    const retried = await runNotificationBackgroundWorker(dependencies);

    expect(notificationFailed).toMatchObject({ status: 'success', delivered: 0, failedSources: 1 });
    expect(identifierFailed).toMatchObject({ status: 'success', delivered: 0, failedSources: 1 });
    expect(retried).toMatchObject({ status: 'success', delivered: 1, failedSources: 0 });
    expect(replaceDigest).toHaveBeenCalledTimes(3);
    expect(setIdentifier).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      '全局开关已关闭',
      (state: ReturnType<typeof defaultNotificationState>) => {
        state.globalEnabled = false;
      }
    ],
    [
      '来源开关已关闭',
      (state: ReturnType<typeof defaultNotificationState>) => {
        state.sources.nodeseek.intentEnabled = false;
      }
    ],
    [
      '账号身份已变化',
      (state: ReturnType<typeof defaultNotificationState>) => {
        state.sources.nodeseek.identityKey = 'nodeseek:8';
      }
    ]
  ])('[REG-NOTIFY-009] does not notify after record when %s', async (_scenario, changeState) => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const replaceDigest = vi.fn(async () => 'android-id');
    const setIdentifier = vi.fn(async () => undefined);

    const result = await runNotificationBackgroundWorker({
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({
          items: [
            {
              source: 'nodeseek',
              id: 'new',
              kind: 'reply',
              actor: { name: '甲' },
              title: '不进入摘要',
              createdAt: null,
              unread: true,
              target: { type: 'information' }
            }
          ],
          cursor: null,
          hasMore: false
        })
      },
      store: {
        load: async () => state,
        record: async (_source, identityKey, scannedIds) => {
          const advanced = advanceNotificationDelivery(state.sources.nodeseek, identityKey, scannedIds);
          state.sources.nodeseek = advanced.state;
          changeState(state);
          return { newIds: advanced.newIds, rollback: async () => undefined };
        },
        setIdentifier
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(replaceDigest).not.toHaveBeenCalled();
    expect(setIdentifier).not.toHaveBeenCalled();
  });

  it('[REG-NOTIFY-024] retracts a digest when notification intent changes while Android is presenting it', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const visibleNotifications = new Set<string>();
    const setIdentifier = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => {
      state.sources.nodeseek.deliveredIds = ['old'];
    });

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({
          items: [
            {
              source: 'nodeseek',
              id: 'new',
              kind: 'reply',
              actor: { name: '甲' },
              title: '不进入摘要',
              createdAt: null,
              unread: true,
              target: { type: 'information' }
            }
          ],
          cursor: null,
          hasMore: false
        })
      },
      store: {
        load: async () => state,
        record: async () => {
          state.sources.nodeseek.deliveredIds = ['new', 'old'];
          return { newIds: ['new'], rollback };
        },
        setIdentifier
      },
      system: {
        permissionGranted: async () => true,
        replaceDigest: async () => {
          visibleNotifications.add('wz-message-nodeseek:7');
          state.globalEnabled = false;
          return 'wz-message-nodeseek:7';
        },
        dismissDigest: async (_source, identifier) => {
          visibleNotifications.delete(identifier);
        }
      }
    });

    expect(result).toMatchObject({ status: 'success', delivered: 0, failedSources: 0 });
    expect(visibleNotifications).toEqual(new Set());
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(setIdentifier).not.toHaveBeenCalled();
  });

  it('keeps the first scan silent and never delivers the same remote id twice', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    let items = [
      {
        source: 'nodeseek' as const,
        id: 'old',
        kind: 'reply' as const,
        actor: { name: '甲' },
        title: '不应投递的旧标题',
        createdAt: null,
        unread: true,
        target: { type: 'information' as const }
      }
    ];
    const replaceDigest = vi.fn(
      async (
        _source: string,
        _digest: { title: string; body: string; data: { source: string } },
        _previousIdentifier?: string
      ) => 'android-id'
    );
    const dependencies = {
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items, cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: async (_source: 'nodeseek', identityKey: string, scannedIds: string[]) => {
          const advanced = advanceNotificationDelivery(state.sources.nodeseek, identityKey, scannedIds);
          state.sources.nodeseek = advanced.state;
          return {
            newIds: advanced.newIds,
            rollback: async () => {
              const released = new Set(advanced.newIds);
              state.sources.nodeseek.deliveredIds = state.sources.nodeseek.deliveredIds.filter(
                (id) => !released.has(id)
              );
            }
          };
        },
        setIdentifier: async (_source: 'nodeseek', _identityKey: string, identifier: string) => {
          state.sources.nodeseek.notificationIdentifier = identifier;
        }
      },
      system: { permissionGranted, replaceDigest, dismissDigest }
    };

    await runNotificationBackgroundWorker(dependencies);
    expect(replaceDigest).not.toHaveBeenCalled();

    items = [
      {
        ...items[0]!,
        id: 'new',
        actor: { name: '乙' },
        title: '不能出现在系统通知里的标题'
      },
      ...items
    ];
    await runNotificationBackgroundWorker(dependencies);
    await runNotificationBackgroundWorker(dependencies);

    expect(replaceDigest).toHaveBeenCalledTimes(1);
    expect(replaceDigest.mock.calls[0]?.[1]).toMatchObject({ body: '乙回复了你的主题' });
    expect(JSON.stringify(replaceDigest.mock.calls[0]?.[1])).not.toContain('标题');
  });
});
