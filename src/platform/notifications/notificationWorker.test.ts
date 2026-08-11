import { describe, expect, it, vi } from 'vitest';

import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { buildSourceNotificationDigest, runNotificationBackgroundWorker } from './notificationWorker';
import {
  advanceNotificationDelivery,
  defaultNotificationState,
  type NotificationDeliveryCommit,
  type NotificationState
} from './notificationStore';

const permissionGranted = async () => true;
const dismissDigest = async () => undefined;
const reconcileDigests = async () => undefined;
const sourceAllowed = async () => true;
const clearForContentDisable = async () => undefined;

function testRecord(state: NotificationState) {
  return async (
    source: NotificationSource,
    identityKey: string,
    scannedIds: string[],
    _fields: { lastSuccessAt: string; unreadCount: number },
    delivery?: NotificationDeliveryCommit
  ) => {
    const sourceState = state.sources[source];
    const advanced = advanceNotificationDelivery(sourceState, identityKey, scannedIds);
    const plannedIdsMatch =
      delivery?.expectedNewIds.length === advanced.newIds.length &&
      delivery.expectedNewIds.every((id, index) => id === advanced.newIds[index]);
    const committed =
      state.globalEnabled &&
      sourceState.intentEnabled &&
      sourceState.identityKey === identityKey &&
      (delivery
        ? plannedIdsMatch && sourceState.notificationIdentifier === delivery.previousIdentifier
        : advanced.newIds.length === 0);
    const previous = {
      baselineReady: sourceState.baselineReady,
      deliveredIds: sourceState.deliveredIds,
      notificationIdentifier: sourceState.notificationIdentifier
    };
    if (committed) {
      state.sources[source] = {
        ...advanced.state,
        ...(delivery ? { notificationIdentifier: delivery.notificationIdentifier } : {})
      };
    }
    return {
      committed,
      newIds: advanced.newIds,
      rollback: async () => {
        if (
          !committed ||
          !delivery ||
          state.sources[source].notificationIdentifier !== delivery.notificationIdentifier
        ) {
          return;
        }
        state.sources[source] = { ...state.sources[source], ...previous };
      }
    };
  };
}

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
    const presentDigest = vi.fn();

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest }
    });

    expect(result).toMatchObject({ status: 'failed', reason: 'proxy' });
    expect(probeAccess).not.toHaveBeenCalled();
    expect(listPage).not.toHaveBeenCalled();
    expect(presentDigest).not.toHaveBeenCalled();
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
    const presentDigest = vi.fn();

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess,
        listPage
      },
      store: {
        load: async () => state,
        record: vi.fn(),
        clearForContentDisable
      },
      system: {
        permissionGranted: async () => false,
        reconcileDigests,
        presentDigest,
        dismissDigest
      }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(probeAccess).not.toHaveBeenCalled();
    expect(listPage).not.toHaveBeenCalled();
    expect(presentDigest).not.toHaveBeenCalled();
  });

  it('does not fall back to stored notification intents when the explicit source allowlist is empty', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    const probeAccess = vi.fn();

    await runNotificationBackgroundWorker({
      sources: [],
      sourceAllowed: async () => true,
      network: {
        restoreProxy: async () => undefined,
        probeAccess,
        listPage: vi.fn()
      },
      store: {
        load: async () => state,
        record: vi.fn(),
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
    });

    expect(probeAccess).not.toHaveBeenCalled();
  });

  it('does not probe a source removed from the current content-source allowlist', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    const probeAccess = vi.fn();

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => false,
      network: {
        restoreProxy: async () => undefined,
        probeAccess,
        listPage: vi.fn()
      },
      store: {
        load: async () => state,
        record: vi.fn(),
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(probeAccess).not.toHaveBeenCalled();
  });

  it('does not list notifications when a content source is disabled during its account probe', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    let allowed = true;
    const listPage = vi.fn();

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => {
          allowed = false;
          return { identityKey: 'nodeseek:7', userId: '7' };
        },
        listPage
      },
      store: {
        load: async () => state,
        record: vi.fn(),
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
    });

    expect(listPage).not.toHaveBeenCalled();
  });

  it('does not record notifications when a content source is disabled during its list request', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    let allowed = true;
    const record = vi.fn();

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => {
          allowed = false;
          return { items: [], cursor: null, hasMore: false };
        }
      },
      store: {
        load: async () => state,
        record,
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
    });

    expect(record).not.toHaveBeenCalled();
  });

  it('stops a multi-request adapter before its next transport when the source is disabled', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    let allowed = true;
    const transport = vi.fn(async (input: string) => {
      if (input === '/first') allowed = false;
      return new Response('{}', { status: 200 });
    });

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ fetcher: transport, identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async (_source, access) => {
          await access.fetcher!('/first');
          await access.fetcher!('/second');
          return { items: [], cursor: null, hasMore: false };
        }
      },
      store: {
        load: async () => state,
        record: vi.fn(),
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(transport.mock.calls.map(([input]) => input)).toEqual(['/first']);
  });

  it('rechecks the current content-source allowlist immediately before recording', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7'
    };
    let checks = 0;
    const record = vi.fn();

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => ++checks < 5,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items: [], cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record,
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
    });

    expect(record).not.toHaveBeenCalled();
  });

  it('rolls back the compound commit when a content source is disabled during the store write', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    let allowed = true;
    const rollback = vi.fn(async () => undefined);
    const atomicRecord = testRecord(state);
    const presentDigest = vi.fn(async (_source, _digest, identifier) => identifier);
    const dismiss = vi.fn(async () => undefined);

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
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
        record: async (...args: Parameters<typeof atomicRecord>) => {
          const recorded = await atomicRecord(...args);
          allowed = false;
          return { ...recorded, rollback };
        },
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest: dismiss }
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(presentDigest).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith('nodeseek', 'wz-message-nodeseek-nodeseek%3A7-a');
  });

  it('retracts a digest when a content source is disabled after the compound commit', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    let allowed = true;
    let recorded = false;
    const rollback = vi.fn(async () => undefined);
    const atomicRecord = testRecord(state);
    const presentDigest = vi.fn(async (_source, _digest, identifier) => identifier);
    const dismiss = vi.fn(async () => undefined);

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
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
        load: async () => {
          if (recorded) allowed = false;
          return state;
        },
        record: async (...args) => {
          const result = await atomicRecord(...args);
          recorded = true;
          return { ...result, rollback };
        },
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest: dismiss }
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(presentDigest).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith('nodeseek', 'wz-message-nodeseek-nodeseek%3A7-a');
  });

  it('dismisses and rolls back a digest when its content source is disabled while Android presents it', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    let allowed = true;
    const record = vi.fn(testRecord(state));
    const dismiss = vi.fn(async () => undefined);

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
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
        record,
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async () => {
          allowed = false;
          return 'android-id';
        },
        dismissDigest: dismiss
      }
    });

    expect(dismiss).toHaveBeenCalledWith('nodeseek', 'android-id');
    expect(record).not.toHaveBeenCalled();
  });

  it('clears a digest written back after the content source was disabled during identifier persistence', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    let allowed = true;
    const identifierStarted = Promise.withResolvers<void>();
    const identifierFinished = Promise.withResolvers<void>();
    const rollback = vi.fn(async () => undefined);
    const dismiss = vi.fn(async () => undefined);
    const atomicRecord = testRecord(state);
    const clearForContentDisable = vi.fn(async () => {
      state.sources.nodeseek = {
        intentEnabled: true,
        identityKey: 'nodeseek:7',
        baselineReady: false,
        deliveredIds: []
      };
    });

    const operation = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed: async () => allowed,
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
        record: async (...args) => {
          identifierStarted.resolve();
          await identifierFinished.promise;
          const recorded = await atomicRecord(...args);
          return { ...recorded, rollback };
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async () => 'android-id',
        dismissDigest: dismiss
      }
    });

    await identifierStarted.promise;
    allowed = false;
    identifierFinished.resolve();

    await expect(operation).resolves.toMatchObject({ delivered: 0, failedSources: 0 });
    expect(dismiss).toHaveBeenCalledWith('nodeseek', 'android-id');
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(clearForContentDisable).toHaveBeenCalledWith('nodeseek');
    expect(state.sources.nodeseek.notificationIdentifier).toBeUndefined();
  });

  it('returns at the wall-clock deadline even when proxy restoration never settles', async () => {
    const result = await Promise.race([
      runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        sourceAllowed,
        deadlineMs: 5,
        network: {
          restoreProxy: () => new Promise<void>(() => undefined),
          probeAccess: vi.fn(),
          listPage: vi.fn()
        },
        store: {
          load: vi.fn(),
          record: vi.fn(),
          clearForContentDisable
        },
        system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
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
        sources: ['nodeseek'],
        sourceAllowed,
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
            return { committed: true, newIds: advanced.newIds, rollback: () => new Promise<never>(() => undefined) };
          },
          clearForContentDisable
        },
        system: {
          permissionGranted,
          reconcileDigests,
          presentDigest: () => new Promise<never>(() => undefined),
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
    const presentDigest = vi.fn();

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:8', userId: '8' }),
        listPage
      },
      store: {
        load: async () => state,
        record,
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(listPage).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(presentDigest).not.toHaveBeenCalled();
  });

  it.each([
    [
      '全局通知意图关闭',
      (state: ReturnType<typeof defaultNotificationState>) => {
        state.globalEnabled = false;
      }
    ],
    [
      '来源通知意图关闭',
      (state: ReturnType<typeof defaultNotificationState>) => {
        state.sources.nodeseek = { ...state.sources.nodeseek, intentEnabled: false };
      }
    ],
    [
      '账号身份切换',
      (state: ReturnType<typeof defaultNotificationState>) => {
        state.sources.nodeseek = { ...state.sources.nodeseek, identityKey: 'nodeseek:8' };
      }
    ]
  ])('[REG-ACCOUNT-041] stops before private list when %s during the health probe', async (_name, mutate) => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    };
    const probeStarted = Promise.withResolvers<void>();
    const probeResult = Promise.withResolvers<{ identityKey: string; userId: string }>();
    const listPage = vi.fn();
    const record = vi.fn();
    const clearForContentDisable = vi.fn();
    const presentDigest = vi.fn();
    const dismissDigest = vi.fn();

    const operation = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => {
          probeStarted.resolve();
          return probeResult.promise;
        },
        listPage
      },
      store: {
        load: async () => state,
        record,
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest }
    });

    await probeStarted.promise;
    mutate(state);
    probeResult.resolve({ identityKey: 'nodeseek:7', userId: '7' });
    await expect(operation).resolves.toMatchObject({ delivered: 0, failedSources: 0 });

    expect(listPage).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(presentDigest).not.toHaveBeenCalled();
    expect(dismissDigest).not.toHaveBeenCalled();
    expect(clearForContentDisable).not.toHaveBeenCalled();
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
    expect(state.sources.nodeseek.notificationIdentifier).toBe('existing-digest');
  });

  it('[REG-ACCOUNT-041] stops pagination before page two when notification intent changes after page one', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const record = vi.fn();
    const clearForContentDisable = vi.fn();
    const listPage = vi.fn(async () => {
      state.sources.nodeseek = { ...state.sources.nodeseek, intentEnabled: false };
      return { items: [], cursor: 'page-2', hasMore: true };
    });

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage
      },
      store: {
        load: async () => state,
        record,
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest: vi.fn() }
    });

    expect(listPage).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
    expect(clearForContentDisable).not.toHaveBeenCalled();
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
  });

  it.each(['identity becomes unknown', 'an auth surface opens'])(
    '[REG-ACCOUNT-041] stops foreground private transport when %s after access probing',
    async () => {
      const state = defaultNotificationState();
      state.globalEnabled = true;
      state.sources.nodeseek = {
        ...state.sources.nodeseek,
        intentEnabled: true,
        identityKey: 'nodeseek:7',
        baselineReady: true,
        deliveredIds: ['old']
      };
      let accessCurrent = true;
      const listPage = vi.fn();
      const record = vi.fn();
      const clearForContentDisable = vi.fn();

      await runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        sourceAllowed,
        privateAccessAllowed: async () => accessCurrent,
        network: {
          restoreProxy: async () => undefined,
          probeAccess: async () => {
            accessCurrent = false;
            return { identityKey: 'nodeseek:7', userId: '7' };
          },
          listPage
        },
        store: {
          load: async () => state,
          record,
          clearForContentDisable
        },
        system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest: vi.fn() }
      });

      expect(listPage).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
      expect(clearForContentDisable).not.toHaveBeenCalled();
      expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
    }
  );

  it('[REG-ACCOUNT-041] preserves the previous Android digest when private access changes while presenting a replacement', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    };
    let accessCurrent = true;
    const record = vi.fn(testRecord(state));
    const clearForContentDisable = vi.fn();
    const dismiss = vi.fn();
    const visibleNotifications = new Set(['existing-digest']);

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      privateAccessAllowed: async () => accessCurrent,
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
        record,
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async () => {
          visibleNotifications.add('new-digest');
          accessCurrent = false;
          return 'new-digest';
        },
        dismissDigest: async (source, identifier) => {
          dismiss(source, identifier);
          visibleNotifications.delete(identifier);
        }
      }
    });

    expect(result).toMatchObject({ delivered: 0, failedSources: 0 });
    expect(record).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith('nodeseek', 'new-digest');
    expect(dismiss).not.toHaveBeenCalledWith('nodeseek', 'existing-digest');
    expect(clearForContentDisable).not.toHaveBeenCalled();
    expect(visibleNotifications).toEqual(new Set(['existing-digest']));
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
    expect(state.sources.nodeseek.notificationIdentifier).toBe('existing-digest');
  });

  it('[REG-NOTIFY-024] restores the previous store identifier when private access changes after identifier persistence', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    };
    let accessCurrent = true;
    const rollbackCompound = vi.fn(async () => {
      state.sources.nodeseek.deliveredIds = ['old'];
      if (state.sources.nodeseek.notificationIdentifier === 'new-digest') {
        state.sources.nodeseek.notificationIdentifier = 'existing-digest';
      }
    });
    const atomicRecord = testRecord(state);
    const visibleNotifications = new Set(['existing-digest']);

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      privateAccessAllowed: async () => accessCurrent,
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
        record: async (...args) => {
          const recorded = await atomicRecord(...args);
          accessCurrent = false;
          return { ...recorded, rollback: rollbackCompound };
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async () => {
          visibleNotifications.add('new-digest');
          return 'new-digest';
        },
        dismissDigest: async (_source: 'nodeseek', identifier: string) => {
          visibleNotifications.delete(identifier);
        }
      }
    });

    expect(result).toMatchObject({ delivered: 0, failedSources: 0 });
    expect(rollbackCompound).toHaveBeenCalledTimes(1);
    expect(state.sources.nodeseek.notificationIdentifier).toBe('existing-digest');
    expect(visibleNotifications).toEqual(new Set(['existing-digest']));
  });

  it('[REG-NOTIFY-024] rolls back store and delivered ids when exact previous dismissal fails', async () => {
    const state = defaultNotificationState();
    const previousIdentifier = 'wz-message-nodeseek';
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: previousIdentifier
    };
    const rollbackCompound = vi.fn(async () => {
      state.sources.nodeseek.deliveredIds = ['old'];
      state.sources.nodeseek.notificationIdentifier = previousIdentifier;
    });
    const atomicRecord = testRecord(state);
    const visibleNotifications = new Set([previousIdentifier]);

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        record: async (...args) => {
          const recorded = await atomicRecord(...args);
          return { ...recorded, rollback: rollbackCompound };
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (_source, _digest, identifier) => {
          visibleNotifications.add(identifier);
          return identifier;
        },
        dismissDigest: async (_source, identifier) => {
          if (identifier === previousIdentifier) throw new Error('cancel failed');
          visibleNotifications.delete(identifier);
        }
      }
    });

    expect(result).toMatchObject({ delivered: 0, failedSources: 1 });
    expect(rollbackCompound).toHaveBeenCalledTimes(1);
    expect(state.sources.nodeseek.notificationIdentifier).toBe(previousIdentifier);
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
    expect(visibleNotifications).toEqual(new Set([previousIdentifier]));
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
    const presentDigest = vi.fn(
      async (_source: string, _digest: ReturnType<typeof buildSourceNotificationDigest>) => 'android-id'
    );
    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek', 'linuxdo'],
      sourceAllowed,
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
            committed: true,
            newIds: advanced.newIds,
            rollback: async () => {
              const released = new Set(advanced.newIds);
              state.sources[source].deliveredIds = state.sources[source].deliveredIds.filter((id) => !released.has(id));
            }
          };
        },
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest }
    });

    expect(result).toMatchObject({ status: 'success', delivered: 1, failedSources: 1, timedOut: false });
    expect(presentDigest).toHaveBeenCalledTimes(1);
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
        sourceAllowed,
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
          clearForContentDisable
        },
        system: { permissionGranted, reconcileDigests, presentDigest: vi.fn(), dismissDigest }
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
    const presentDigest = vi.fn(
      async (_source: string, _digest: ReturnType<typeof buildSourceNotificationDigest>) => 'android-id'
    );

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
            committed: true,
            newIds: advanced.newIds,
            rollback: async () => {
              const released = new Set(advanced.newIds);
              state.sources.nodeseek.deliveredIds = state.sources.nodeseek.deliveredIds.filter(
                (id) => !released.has(id)
              );
            }
          };
        },
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest }
    });

    expect(result).toEqual({ status: 'success', delivered: 60, failedSources: 0, timedOut: false });
    expect(recordedIds).toEqual(items.slice(0, 60).map((item) => item.id));
    expect(recordedIds).not.toContain('new-60');
    expect(presentDigest).toHaveBeenCalledTimes(1);
    expect(presentDigest.mock.calls[0]?.[1]).toMatchObject({
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
      sources: ['yaohuo'],
      sourceAllowed,
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
          return { committed: true, newIds: advanced.newIds, rollback: async () => undefined };
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async () => 'android-id',
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
    const presentDigest = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('system unavailable'))
      .mockResolvedValue('android-id');
    const atomicRecord = testRecord(state);
    const record = vi.fn(atomicRecord).mockRejectedValueOnce(new Error('storage unavailable'));
    const dependencies = {
      sources: ['nodeseek'] as const,
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items, cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record,
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest }
    };

    const notificationFailed = await runNotificationBackgroundWorker(dependencies);
    const identifierFailed = await runNotificationBackgroundWorker(dependencies);
    const retried = await runNotificationBackgroundWorker(dependencies);

    expect(notificationFailed).toMatchObject({ status: 'success', delivered: 0, failedSources: 1 });
    expect(identifierFailed).toMatchObject({ status: 'success', delivered: 0, failedSources: 1 });
    expect(retried).toMatchObject({ status: 'success', delivered: 1, failedSources: 0 });
    expect(presentDigest).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledTimes(2);
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
  ])('[REG-NOTIFY-009] retracts the native ack when %s before the compound commit', async (_scenario, changeState) => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const presentDigest = vi.fn(async (_source, _digest, identifier) => identifier);
    const dismiss = vi.fn(async () => undefined);
    const atomicRecord = testRecord(state);

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        record: async (...args) => {
          changeState(state);
          return atomicRecord(...args);
        },
        clearForContentDisable
      },
      system: { permissionGranted, reconcileDigests, presentDigest, dismissDigest: dismiss }
    });

    expect(result).toEqual({ status: 'success', delivered: 0, failedSources: 0, timedOut: false });
    expect(presentDigest).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith('nodeseek', 'wz-message-nodeseek-nodeseek%3A7-a');
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
    expect(state.sources.nodeseek.notificationIdentifier).toBeUndefined();
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
    const record = vi.fn(testRecord(state));

    const result = await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        record,
        clearForContentDisable
      },
      system: {
        permissionGranted: async () => true,
        reconcileDigests,
        presentDigest: async () => {
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
    expect(record).not.toHaveBeenCalled();
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
  });

  it('[REG-NOTIFY-024] retracts a native presentation that finishes after the worker deadline', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.yaohuo = {
      ...state.sources.yaohuo,
      intentEnabled: true,
      identityKey: 'yaohuo:99',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const presentStarted = Promise.withResolvers<void>();
    const releaseNativePresent = Promise.withResolvers<void>();
    const nativePresentFinished = Promise.withResolvers<void>();
    const visibleNotifications = new Set<string>();
    const dismissDigest = vi.fn(async (_source: 'yaohuo', identifier: string) => {
      await nativePresentFinished.promise;
      visibleNotifications.delete(identifier);
    });
    const record = vi.fn(testRecord(state));

    const operation = runNotificationBackgroundWorker({
      sources: ['yaohuo'],
      sourceAllowed,
      deadlineMs: 5,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'yaohuo:99', userId: '99' }),
        listPage: async () => ({
          items: [
            {
              source: 'yaohuo',
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
        record,
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (_source, _digest, identifier) => {
          presentStarted.resolve();
          await releaseNativePresent.promise;
          visibleNotifications.add(identifier);
          nativePresentFinished.resolve();
          return identifier;
        },
        dismissDigest
      }
    });

    await presentStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 15));
    releaseNativePresent.resolve();
    const result = await operation;

    expect(result).toMatchObject({ status: 'failed', reason: 'deadline' });
    expect(dismissDigest).toHaveBeenCalledWith('yaohuo', 'wz-message-yaohuo-yaohuo%3A99-a');
    await vi.waitFor(() => expect(visibleNotifications).toEqual(new Set()));
    expect(record).not.toHaveBeenCalled();
    expect(state.sources.yaohuo.deliveredIds).toEqual(['old']);
  });

  it('[REG-NOTIFY-024] does not commit delivered ids before native presentation acknowledgement', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const presentStarted = Promise.withResolvers<void>();
    const nativeAcknowledgement = Promise.withResolvers<void>();
    const record = vi.fn(
      async (
        _source: 'nodeseek',
        identityKey: string,
        scannedIds: string[],
        _fields: { lastSuccessAt: string; unreadCount: number },
        delivery?: { notificationIdentifier: string }
      ) => {
        const advanced = advanceNotificationDelivery(state.sources.nodeseek, identityKey, scannedIds);
        state.sources.nodeseek = {
          ...advanced.state,
          ...(delivery ? { notificationIdentifier: delivery.notificationIdentifier } : {})
        };
        return { committed: true, newIds: advanced.newIds, rollback: async () => undefined };
      }
    );

    const operation = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        record,
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (_source, _digest, identifier) => {
          presentStarted.resolve();
          await nativeAcknowledgement.promise;
          return identifier;
        },
        dismissDigest
      }
    });

    await presentStarted.promise;
    expect(state.sources.nodeseek.deliveredIds).toEqual(['old']);
    expect(state.sources.nodeseek.notificationIdentifier).toBeUndefined();
    const commitsBeforeNativeAck = record.mock.calls.length;
    nativeAcknowledgement.resolve();
    await operation;

    expect(commitsBeforeNativeAck).toBe(0);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[4]).toEqual({
      expectedNewIds: ['new'],
      previousIdentifier: undefined,
      notificationIdentifier: 'wz-message-nodeseek-nodeseek%3A7-a'
    });
    expect(state.sources.nodeseek).toMatchObject({
      deliveredIds: ['new', 'old'],
      notificationIdentifier: 'wz-message-nodeseek-nodeseek%3A7-a'
    });
  });

  it('[REG-NOTIFY-024] preserves the staged digest when a compound commit succeeds after the deadline', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    };
    const commitStarted = Promise.withResolvers<void>();
    const releaseCommit = Promise.withResolvers<void>();
    const events: string[] = [];
    const atomicRecord = testRecord(state);

    const operation = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        record: async (...args) => {
          commitStarted.resolve();
          await releaseCommit.promise;
          const recorded = await atomicRecord(...args);
          return recorded;
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (_source, _digest, identifier) => identifier,
        dismissDigest: async (_source, identifier) => {
          events.push(`dismiss:${identifier}`);
        }
      }
    });

    await commitStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const result = await operation;

    expect(result).toMatchObject({ status: 'failed', reason: 'deadline' });
    expect(events).toEqual([]);
    expect(state.sources.nodeseek).toMatchObject({
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    });

    releaseCommit.resolve();
    await vi.waitFor(() =>
      expect(state.sources.nodeseek).toMatchObject({
        deliveredIds: ['new', 'old'],
        notificationIdentifier: 'wz-message-nodeseek-nodeseek%3A7-a'
      })
    );
    expect(events).toEqual([]);
  });

  it.each(['not-committed', 'rejected'] as const)(
    '[REG-NOTIFY-024] dismisses the staged digest only after a late compound commit is %s',
    async (outcome) => {
      const state = defaultNotificationState();
      state.globalEnabled = true;
      state.sources.nodeseek = {
        ...state.sources.nodeseek,
        intentEnabled: true,
        identityKey: 'nodeseek:7',
        baselineReady: true,
        deliveredIds: ['old'],
        notificationIdentifier: 'existing-digest'
      };
      const commitStarted = Promise.withResolvers<void>();
      const releaseCommit = Promise.withResolvers<void>();
      const dismissStarted = Promise.withResolvers<void>();
      const releaseDismiss = Promise.withResolvers<void>();
      const secondReconciled = Promise.withResolvers<string | undefined>();
      const rollback = vi.fn(async () => undefined);
      const dismiss = vi.fn(async () => {
        dismissStarted.resolve();
        await releaseDismiss.promise;
      });

      const operation = runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        sourceAllowed,
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
          record: async () => {
            commitStarted.resolve();
            await releaseCommit.promise;
            if (outcome === 'rejected') throw new Error('storage unavailable');
            return { committed: false, newIds: ['new'], rollback };
          },
          clearForContentDisable
        },
        system: {
          permissionGranted,
          reconcileDigests,
          presentDigest: async (_source, _digest, identifier) => identifier,
          dismissDigest: dismiss
        }
      });

      await commitStarted.promise;
      await new Promise((resolve) => setTimeout(resolve, 15));
      const result = await operation;

      expect(result).toMatchObject({ status: 'failed', reason: 'deadline' });
      expect(dismiss).not.toHaveBeenCalled();
      expect(rollback).not.toHaveBeenCalled();

      const second = runNotificationBackgroundWorker({
        sources: ['nodeseek'],
        sourceAllowed,
        deadlineMs: 500,
        network: {
          restoreProxy: async () => undefined,
          probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
          listPage: async () => ({ items: [], cursor: null, hasMore: false })
        },
        store: {
          load: async () => state,
          record: testRecord(state),
          clearForContentDisable
        },
        system: {
          permissionGranted,
          reconcileDigests: async (_source, _identityKey, currentIdentifier) => {
            secondReconciled.resolve(currentIdentifier);
          },
          presentDigest: vi.fn(),
          dismissDigest
        }
      });
      releaseCommit.resolve();
      await dismissStarted.promise;
      const secondEnteredLaneBeforeDismiss = await Promise.race([
        secondReconciled.promise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 25))
      ]);
      releaseDismiss.resolve();
      await second;

      expect(secondEnteredLaneBeforeDismiss).toBe(false);
      expect(dismiss).toHaveBeenCalledWith('nodeseek', 'wz-message-nodeseek-nodeseek%3A7-a');
      expect(await secondReconciled.promise).toBe('existing-digest');
      expect(rollback).not.toHaveBeenCalled();
      expect(state.sources.nodeseek).toMatchObject({
        deliveredIds: ['old'],
        notificationIdentifier: 'existing-digest'
      });
    }
  );

  it('[REG-NOTIFY-024] preserves a committed staged digest when the deadline wins the post-commit check', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    };
    const postCommitCheckStarted = Promise.withResolvers<void>();
    const neverFinishPostCommitCheck = new Promise<void>(() => undefined);
    const rollback = vi.fn(async () => undefined);
    const dismiss = vi.fn(async () => undefined);
    const atomicRecord = testRecord(state);
    let committed = false;

    const operation = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
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
        load: async () => {
          if (committed) {
            postCommitCheckStarted.resolve();
            await neverFinishPostCommitCheck;
          }
          return state;
        },
        record: async (...args) => {
          const recorded = await atomicRecord(...args);
          committed = true;
          return { ...recorded, rollback };
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (_source, _digest, identifier) => identifier,
        dismissDigest: dismiss
      }
    });

    await postCommitCheckStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const result = await operation;

    expect(result).toMatchObject({ status: 'failed', reason: 'deadline' });
    expect(rollback).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    expect(state.sources.nodeseek).toMatchObject({
      deliveredIds: ['new', 'old'],
      notificationIdentifier: 'wz-message-nodeseek-nodeseek%3A7-a'
    });
  });

  it('[REG-NOTIFY-024] keeps the identity lane owned by a pending commit after the worker deadline returns', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      deliveredIds: ['old'],
      notificationIdentifier: 'existing-digest'
    };
    const commitStarted = Promise.withResolvers<void>();
    const releaseCommit = Promise.withResolvers<void>();
    const secondReconciled = Promise.withResolvers<string | undefined>();
    const allowSecondProbe = Promise.withResolvers<void>();
    const atomicRecord = testRecord(state);
    const item = {
      source: 'nodeseek' as const,
      id: 'new',
      kind: 'reply' as const,
      actor: { name: '甲' },
      title: '不进入摘要',
      createdAt: null,
      unread: true,
      target: { type: 'information' as const }
    };

    const first = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      deadlineMs: 5,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items: [item], cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: async (...args) => {
          commitStarted.resolve();
          await releaseCommit.promise;
          return atomicRecord(...args);
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (_source, _digest, identifier) => identifier,
        dismissDigest
      }
    });

    await commitStarted.promise;
    expect(await first).toMatchObject({ status: 'failed', reason: 'deadline' });

    const second = runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      deadlineMs: 500,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => {
          await allowSecondProbe.promise;
          return { identityKey: 'nodeseek:7', userId: '7' };
        },
        listPage: async () => ({ items: [item], cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: atomicRecord,
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests: async (_source, _identityKey, currentIdentifier) => {
          secondReconciled.resolve(currentIdentifier);
        },
        presentDigest: vi.fn(),
        dismissDigest
      }
    });

    const secondEnteredLaneBeforeCommit = await Promise.race([
      secondReconciled.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25))
    ]);
    releaseCommit.resolve();
    allowSecondProbe.resolve();
    await second;

    expect(secondEnteredLaneBeforeCommit).toBe(false);
    expect(await secondReconciled.promise).toBe('wz-message-nodeseek-nodeseek%3A7-a');
    expect(state.sources.nodeseek).toMatchObject({
      deliveredIds: ['new', 'old'],
      notificationIdentifier: 'wz-message-nodeseek-nodeseek%3A7-a'
    });
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
    const commitOrder: string[] = [];
    const presentDigest = vi.fn(
      async (
        _source: string,
        _digest: { title: string; body: string; data: { source: string } },
        identifier: string
      ) => {
        commitOrder.push(`present:${identifier}`);
        return identifier;
      }
    );
    const atomicRecord = testRecord(state);
    const dependencies = {
      sources: ['nodeseek'] as const,
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        listPage: async () => ({ items, cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: async (...args: Parameters<typeof atomicRecord>) => {
          const recorded = await atomicRecord(...args);
          const delivery = args[4];
          if (recorded.committed && delivery) commitOrder.push(`store:${delivery.notificationIdentifier}`);
          return recorded;
        },
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest,
        dismissDigest: async (_source: 'nodeseek', identifier: string) => {
          commitOrder.push(`dismiss:${identifier}`);
        }
      }
    };

    await runNotificationBackgroundWorker(dependencies);
    expect(presentDigest).not.toHaveBeenCalled();
    state.sources.nodeseek.notificationIdentifier = 'old-digest';

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

    expect(presentDigest).toHaveBeenCalledTimes(1);
    expect(commitOrder).toEqual([
      'present:wz-message-nodeseek-nodeseek%3A7-a',
      'store:wz-message-nodeseek-nodeseek%3A7-a',
      'dismiss:old-digest'
    ]);
    expect(presentDigest.mock.calls[0]?.[1]).toMatchObject({ body: '乙回复了你的主题' });
    expect(JSON.stringify(presentDigest.mock.calls[0]?.[1])).not.toContain('标题');
  });

  it('[REG-NOTIFY-024] serializes concurrent delivery for the same source identity', async () => {
    const state = defaultNotificationState();
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:77',
      baselineReady: true,
      deliveredIds: ['old']
    };
    const firstPresentationStarted = Promise.withResolvers<void>();
    const releaseFirstPresentation = Promise.withResolvers<void>();
    const secondPresentationStarted = Promise.withResolvers<void>();
    const secondInitialStateLoaded = Promise.withResolvers<void>();
    const events: string[] = [];
    let secondLoadCalls = 0;

    const dependencies = (actor: 'first' | 'second') => ({
      sources: ['nodeseek'] as const,
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => ({ identityKey: 'nodeseek:77', userId: '77' }),
        listPage: async () => ({
          items: [
            {
              source: 'nodeseek' as const,
              id: actor,
              kind: 'reply' as const,
              actor: { name: actor },
              title: '不进入摘要',
              createdAt: null,
              unread: true,
              target: { type: 'information' as const }
            }
          ],
          cursor: null,
          hasMore: false
        })
      },
      store: {
        load: async () => {
          if (actor === 'second' && ++secondLoadCalls === 1) secondInitialStateLoaded.resolve();
          return state;
        },
        record: testRecord(state),
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests,
        presentDigest: async (
          _source: 'nodeseek',
          digest: ReturnType<typeof buildSourceNotificationDigest>,
          identifier: string
        ) => {
          const label = digest.body.startsWith('first') ? 'first' : 'second';
          events.push(`${label}:start`);
          if (label === 'first') {
            firstPresentationStarted.resolve();
            await releaseFirstPresentation.promise;
          } else secondPresentationStarted.resolve();
          events.push(`${label}:end`);
          return identifier;
        },
        dismissDigest
      }
    });

    const first = runNotificationBackgroundWorker(dependencies('first'));
    await firstPresentationStarted.promise;
    const second = runNotificationBackgroundWorker(dependencies('second'));
    await secondInitialStateLoaded.promise;
    const overlapped = await Promise.race([
      secondPresentationStarted.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25))
    ]);
    releaseFirstPresentation.resolve();
    await Promise.all([first, second]);

    expect(overlapped).toBe(false);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('[REG-NOTIFY-024] reconciles crash-orphan slots before the next eligible source read', async () => {
    const state = defaultNotificationState();
    const currentIdentifier = 'wz-message-nodeseek-nodeseek%3A7-a';
    state.globalEnabled = true;
    state.sources.nodeseek = {
      ...state.sources.nodeseek,
      intentEnabled: true,
      identityKey: 'nodeseek:7',
      baselineReady: true,
      notificationIdentifier: currentIdentifier
    };
    const visibleNotifications = new Set([
      currentIdentifier,
      'wz-message-nodeseek-nodeseek%3A7-b',
      'wz-message-nodeseek'
    ]);
    const order: string[] = [];

    await runNotificationBackgroundWorker({
      sources: ['nodeseek'],
      sourceAllowed,
      network: {
        restoreProxy: async () => undefined,
        probeAccess: async () => {
          order.push('probe');
          return { identityKey: 'nodeseek:7', userId: '7' };
        },
        listPage: async () => ({ items: [], cursor: null, hasMore: false })
      },
      store: {
        load: async () => state,
        record: testRecord(state),
        clearForContentDisable
      },
      system: {
        permissionGranted,
        reconcileDigests: async (_source, _identityKey, current) => {
          order.push('reconcile');
          for (const identifier of [...visibleNotifications]) {
            if (identifier !== current) visibleNotifications.delete(identifier);
          }
        },
        presentDigest: vi.fn(),
        dismissDigest
      }
    });

    expect(order).toEqual(['reconcile', 'probe']);
    expect(visibleNotifications).toEqual(new Set([currentIdentifier]));
  });
});
