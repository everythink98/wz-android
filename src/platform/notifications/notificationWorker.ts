import type { ForumNotification, NotificationPage } from '@/domain/notifications/models';
import { sourceCatalog, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { beginDiagnosticTrace, finishDiagnosticTrace, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { withFetchGuard, type Fetcher } from '@/platform/network/request';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';
import {
  advanceNotificationDelivery,
  type NotificationDeliveryCommit,
  type NotificationState
} from './notificationStore';

const actionText = {
  mention: '提到了你',
  reply: '回复了你的主题',
  'private-message': '发来了私信'
} as const;

export function buildSourceNotificationDigest(source: NotificationSource, items: ForumNotification[]) {
  const latest = [...items].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NEGATIVE_INFINITY;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NEGATIVE_INFINITY;
    return rightTime - leftTime;
  })[0];
  if (!latest || !(latest.kind in actionText)) throw new Error('没有可投递的新消息');
  const action = actionText[latest.kind as keyof typeof actionText];
  const extra = items.length > 1 ? `，另有 ${items.length - 1} 条新互动` : '';
  return {
    title: sourceCatalog[source].label,
    body: `${latest.actor.name}${action}${extra}`,
    data: { source }
  };
}

type NotificationDigest = ReturnType<typeof buildSourceNotificationDigest>;

interface NotificationWorkerAccess {
  fetcher?: Fetcher;
  identityKey: string;
  userId: string;
  signal?: AbortSignal;
}

export interface NotificationWorkerDependencies<Access extends NotificationWorkerAccess = NotificationWorkerAccess> {
  sources: readonly NotificationSource[];
  sourceAllowed(source: NotificationSource): boolean | Promise<boolean>;
  privateAccessAllowed?(source: NotificationSource, identityKey: string): boolean | Promise<boolean>;
  network: {
    restoreProxy(): Promise<void>;
    probeAccess(
      source: NotificationSource,
      signal: AbortSignal,
      assertCurrent: () => Promise<void>
    ): Promise<Access | null>;
    listPage(
      source: NotificationSource,
      access: Access,
      signal: AbortSignal,
      cursor?: string | null
    ): Promise<NotificationPage>;
  };
  store: {
    load(): Promise<NotificationState>;
    record(
      source: NotificationSource,
      identityKey: string,
      scannedIds: string[],
      fields: { lastSuccessAt: string; unreadCount: number },
      delivery?: NotificationDeliveryCommit
    ): Promise<{ committed: boolean; newIds: string[]; rollback(): Promise<unknown> }>;
    clearForContentDisable(source: NotificationSource): Promise<unknown>;
  };
  system: {
    permissionGranted(): Promise<boolean>;
    reconcileDigests(
      source: NotificationSource,
      identityKey: string,
      currentIdentifier: string | undefined
    ): Promise<void>;
    presentDigest(source: NotificationSource, digest: NotificationDigest, identifier: string): Promise<string>;
    dismissDigest(source: NotificationSource, identifier: string): Promise<void>;
  };
  deadlineMs?: number;
  now?: () => Date;
}

const deliverableKinds = new Set(['mention', 'reply', 'private-message']);
const deliveries = createKeyedSerialRunner<string>();

export function notificationIdentifierForIdentity(source: NotificationSource, identityKey: string) {
  return `wz-message-${source}-${encodeURIComponent(identityKey)}`;
}

export function notificationIdentifiersForIdentity(source: NotificationSource, identityKey: string) {
  const base = notificationIdentifierForIdentity(source, identityKey);
  return [base, `${base}-a`, `${base}-b`];
}

function stagingNotificationIdentifier(
  source: NotificationSource,
  identityKey: string,
  previousIdentifier: string | undefined
) {
  const [, first, second] = notificationIdentifiersForIdentity(source, identityKey);
  return previousIdentifier === first ? second! : first!;
}

function deliveryAllowed(state: NotificationState, source: NotificationSource, identityKey: string) {
  const sourceState = state.sources[source];
  return state.globalEnabled && sourceState.intentEnabled && sourceState.identityKey === identityKey;
}

export async function runNotificationBackgroundWorker<Access extends NotificationWorkerAccess>(
  dependencies: NotificationWorkerDependencies<Access>
) {
  const controller = new AbortController();
  const deadlineError = new Error('后台消息检查已超时');
  let timedOut = false;
  const deadlineReached = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(deadlineError), { once: true });
  });
  const beforeDeadline = <T>(operation: Promise<T>) => Promise.race([operation, deadlineReached]);
  const sourceAllowed = (source: NotificationSource) =>
    beforeDeadline(Promise.resolve(dependencies.sourceAllowed(source)));
  const assertSourceCurrent = async (source: NotificationSource) => {
    if (controller.signal.aborted) throw deadlineError;
    if (!(await sourceAllowed(source))) {
      throw Object.assign(new Error('内容源已停用'), { reason: 'source-disabled', source });
    }
    if (controller.signal.aborted) throw deadlineError;
  };
  const assertPrivateAccessCurrent = async (source: NotificationSource, identityKey: string) => {
    await assertSourceCurrent(source);
    const latestState = await beforeDeadline(dependencies.store.load());
    const callerAllows = dependencies.privateAccessAllowed
      ? await beforeDeadline(Promise.resolve(dependencies.privateAccessAllowed(source, identityKey)))
      : true;
    await assertSourceCurrent(source);
    if (!deliveryAllowed(latestState, source, identityKey) || !callerAllows) {
      throw Object.assign(new Error('消息私有访问状态已变化'), {
        reason: 'private-access-stale',
        source
      });
    }
    return latestState;
  };
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, dependencies.deadlineMs ?? 50_000);
  try {
    try {
      await beforeDeadline(dependencies.network.restoreProxy());
    } catch (error) {
      if (error === deadlineError) {
        return { status: 'failed' as const, reason: 'deadline' as const, delivered: 0, failedSources: 0 };
      }
      return { status: 'failed' as const, reason: 'proxy' as const, delivered: 0, failedSources: 0 };
    }
    if (controller.signal.aborted) {
      return { status: 'failed' as const, reason: 'deadline' as const, delivered: 0, failedSources: 0 };
    }
    try {
      if (!(await beforeDeadline(dependencies.system.permissionGranted()))) {
        return { status: 'success' as const, delivered: 0, failedSources: 0, timedOut: false };
      }
    } catch (error) {
      return error === deadlineError
        ? { status: 'failed' as const, reason: 'deadline' as const, delivered: 0, failedSources: 0 }
        : { status: 'failed' as const, reason: 'permission' as const, delivered: 0, failedSources: 0 };
    }
    const state = await beforeDeadline(dependencies.store.load());
    if (!state.globalEnabled) {
      return { status: 'success' as const, delivered: 0, failedSources: 0, timedOut: false };
    }
    const enabledSources = dependencies.sources.filter(
      (source) => state.sources[source].intentEnabled && state.sources[source].identityKey
    );
    let delivered = 0;
    const settlement = Promise.allSettled(
      enabledSources.map((source) =>
        deliveries.run(`${source}\u0000${state.sources[source].identityKey}`, async () => {
          const trace = beginDiagnosticTrace('source', 'refresh', { source });
          try {
            const sourceState = state.sources[source];
            const capturedIdentityKey = sourceState.identityKey!;
            const currentState = await assertPrivateAccessCurrent(source, capturedIdentityKey);
            await beforeDeadline(
              dependencies.system.reconcileDigests(
                source,
                capturedIdentityKey,
                currentState.sources[source].notificationIdentifier
              )
            );
            await assertPrivateAccessCurrent(source, capturedIdentityKey);
            const access = await beforeDeadline(
              dependencies.network.probeAccess(source, controller.signal, async () => {
                await assertPrivateAccessCurrent(source, capturedIdentityKey);
              })
            );
            if (
              !access ||
              access.identityKey !== capturedIdentityKey ||
              access.identityKey !== `${source}:${access.userId}`
            ) {
              finishDiagnosticTrace(trace, 'blocked', { source, reason: 'not_ready' });
              return;
            }
            await assertPrivateAccessCurrent(source, capturedIdentityKey);
            const diagnosticAccess = {
              ...access,
              fetcher: withFetchGuard(withDiagnosticFetcher(trace, access.fetcher || fetch), async () => {
                await assertPrivateAccessCurrent(source, capturedIdentityKey);
              }),
              signal: controller.signal
            };
            const items: ForumNotification[] = [];
            const seenCursors = new Set<string>();
            let cursor: string | null | undefined;
            while (items.length < 60) {
              await assertPrivateAccessCurrent(source, capturedIdentityKey);
              const page = await beforeDeadline(
                dependencies.network.listPage(source, diagnosticAccess, controller.signal, cursor)
              );
              await assertPrivateAccessCurrent(source, capturedIdentityKey);
              items.push(...page.items.slice(0, 60 - items.length));
              const nextCursor = page.hasMore ? page.cursor : null;
              if (!nextCursor || seenCursors.has(nextCursor)) break;
              seenCursors.add(nextCursor);
              cursor = nextCursor;
            }
            if (controller.signal.aborted) throw deadlineError;
            const scanned = items.filter((item) => item.unread && deliverableKinds.has(item.kind));
            const scannedIds = scanned.map((item) => item.id);
            const fields = {
              lastSuccessAt: (dependencies.now?.() || new Date()).toISOString(),
              unreadCount: items.filter((item) => item.unread).length
            };
            const latestState = await assertPrivateAccessCurrent(source, capturedIdentityKey);
            const latestSourceState = latestState.sources[source];
            const preview = advanceNotificationDelivery(latestSourceState, access.identityKey, scannedIds);
            const newIds = new Set(preview.newIds);
            const newItems = scanned.filter((item) => newIds.has(item.id));
            if (!newItems.length) {
              const recorded = await beforeDeadline(
                dependencies.store.record(source, access.identityKey, scannedIds, fields)
              );
              if (!recorded.committed) {
                throw Object.assign(new Error('消息投递状态已变化'), { reason: 'private-access-stale', source });
              }
              finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length, count: 0 });
              return;
            }
            const previousIdentifier = latestSourceState.notificationIdentifier;
            let identifier = stagingNotificationIdentifier(source, access.identityKey, previousIdentifier);
            let rollbackDelivery: (() => Promise<unknown>) | undefined;
            let deliveryCommitted = false;
            let commitStarted = false;
            try {
              identifier = await beforeDeadline(
                dependencies.system.presentDigest(source, buildSourceNotificationDigest(source, newItems), identifier)
              );
              await assertPrivateAccessCurrent(source, capturedIdentityKey);
              commitStarted = true;
              const commitOperation = dependencies.store.record(source, access.identityKey, scannedIds, fields, {
                expectedNewIds: preview.newIds,
                previousIdentifier,
                notificationIdentifier: identifier
              });
              const recorded = await commitOperation;
              if (!recorded.committed) {
                throw Object.assign(new Error('消息投递状态已变化'), { reason: 'private-access-stale', source });
              }
              rollbackDelivery = recorded.rollback;
              deliveryCommitted = true;
              await assertPrivateAccessCurrent(source, capturedIdentityKey);
              if (previousIdentifier && previousIdentifier !== identifier) {
                await beforeDeadline(dependencies.system.dismissDigest(source, previousIdentifier));
              }
              delivered += newItems.length;
              finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length, count: newItems.length });
            } catch (error) {
              if (error === deadlineError) {
                if (!commitStarted) {
                  void dependencies.system.dismissDigest(source, identifier).catch(() => undefined);
                }
                throw error;
              }
              if (rollbackDelivery) await rollbackDelivery();
              await dependencies.system.dismissDigest(source, identifier);
              if (
                deliveryCommitted &&
                error &&
                typeof error === 'object' &&
                (error as { reason?: unknown }).reason === 'source-disabled'
              ) {
                await beforeDeadline(dependencies.store.clearForContentDisable(source)).catch(() => undefined);
              }
              throw error;
            }
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              (error as { reason?: unknown }).reason === 'private-access-stale'
            ) {
              finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
              return;
            }
            const reason = normalizeDiagnosticReason(error);
            if (reason === 'source_disabled') {
              finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
              return;
            }
            const blocked = ['login_required', 'permission_denied', 'verification_required'].includes(reason);
            finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : blocked ? 'blocked' : 'failure', {
              source,
              reason
            });
            throw error;
          }
        })
      )
    );
    let settled: Awaited<typeof settlement>;
    try {
      settled = await beforeDeadline(settlement);
    } catch (error) {
      if (error === deadlineError) {
        return { status: 'failed' as const, reason: 'deadline' as const, delivered: 0, failedSources: 0 };
      }
      throw error;
    }
    if (timedOut) {
      return { status: 'failed' as const, reason: 'deadline' as const, delivered: 0, failedSources: 0 };
    }
    return {
      status: 'success' as const,
      delivered,
      failedSources: settled.filter((result) => result.status === 'rejected').length,
      timedOut
    };
  } finally {
    clearTimeout(deadline);
  }
}
