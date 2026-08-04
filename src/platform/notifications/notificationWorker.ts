import type { ForumNotification, NotificationPage } from '@/domain/notifications/models';
import { sourceCatalog, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { beginDiagnosticTrace, finishDiagnosticTrace, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import type { Fetcher } from '@/platform/network/request';
import type { NotificationState } from './notificationStore';

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
  sources?: readonly NotificationSource[];
  network: {
    restoreProxy(): Promise<void>;
    probeAccess(source: NotificationSource, signal: AbortSignal): Promise<Access | null>;
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
      fields: { lastSuccessAt: string; unreadCount: number }
    ): Promise<{ newIds: string[]; rollback(): Promise<unknown> }>;
    setIdentifier(source: NotificationSource, identityKey: string, identifier: string): Promise<unknown>;
  };
  system: {
    permissionGranted(): Promise<boolean>;
    replaceDigest(
      source: NotificationSource,
      digest: NotificationDigest,
      previousIdentifier: string | undefined,
      identifier: string
    ): Promise<string>;
    dismissDigest(source: NotificationSource, identifier: string): Promise<void>;
  };
  deadlineMs?: number;
  now?: () => Date;
}

const deliverableKinds = new Set(['mention', 'reply', 'private-message']);

export function notificationIdentifierForIdentity(source: NotificationSource, identityKey: string) {
  return `wz-message-${source}-${encodeURIComponent(identityKey)}`;
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
    const enabledSources = (dependencies.sources || (Object.keys(state.sources) as NotificationSource[])).filter(
      (source) => state.sources[source].intentEnabled && state.sources[source].identityKey
    );
    let delivered = 0;
    const settled = await Promise.allSettled(
      enabledSources.map(async (source) => {
        const trace = beginDiagnosticTrace('source', 'refresh', { source });
        try {
          const sourceState = state.sources[source];
          const access = await beforeDeadline(dependencies.network.probeAccess(source, controller.signal));
          if (
            !access ||
            !sourceState.identityKey ||
            access.identityKey !== sourceState.identityKey ||
            access.identityKey !== `${source}:${access.userId}`
          ) {
            finishDiagnosticTrace(trace, 'blocked', { source, reason: 'not_ready' });
            return;
          }
          const diagnosticAccess = {
            ...access,
            fetcher: withDiagnosticFetcher(trace, access.fetcher || fetch),
            signal: controller.signal
          };
          const items: ForumNotification[] = [];
          const seenCursors = new Set<string>();
          let cursor: string | null | undefined;
          while (items.length < 60) {
            const page = await beforeDeadline(
              dependencies.network.listPage(source, diagnosticAccess, controller.signal, cursor)
            );
            items.push(...page.items.slice(0, 60 - items.length));
            const nextCursor = page.hasMore ? page.cursor : null;
            if (!nextCursor || seenCursors.has(nextCursor)) break;
            seenCursors.add(nextCursor);
            cursor = nextCursor;
          }
          if (controller.signal.aborted) throw deadlineError;
          const scanned = items.filter((item) => item.unread && deliverableKinds.has(item.kind));
          const recorded = await beforeDeadline(
            dependencies.store.record(
              source,
              access.identityKey,
              scanned.map((item) => item.id),
              {
                lastSuccessAt: (dependencies.now?.() || new Date()).toISOString(),
                unreadCount: items.filter((item) => item.unread).length
              }
            )
          );
          const newIds = new Set(recorded.newIds);
          const newItems = scanned.filter((item) => newIds.has(item.id));
          if (!newItems.length) {
            finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length, count: 0 });
            return;
          }
          const latestState = await beforeDeadline(dependencies.store.load());
          const latestSourceState = latestState.sources[source];
          if (controller.signal.aborted || !deliveryAllowed(latestState, source, access.identityKey)) {
            await beforeDeadline(recorded.rollback());
            finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
            return;
          }
          let identifier: string | undefined;
          try {
            identifier = await beforeDeadline(
              dependencies.system.replaceDigest(
                source,
                buildSourceNotificationDigest(source, newItems),
                latestSourceState.notificationIdentifier,
                notificationIdentifierForIdentity(source, access.identityKey)
              )
            );
            const presentedState = await beforeDeadline(dependencies.store.load());
            if (controller.signal.aborted || !deliveryAllowed(presentedState, source, access.identityKey)) {
              await beforeDeadline(dependencies.system.dismissDigest(source, identifier));
              await beforeDeadline(recorded.rollback());
              finishDiagnosticTrace(trace, 'stale', { source, reason: 'stale' });
              return;
            }
            await beforeDeadline(dependencies.store.setIdentifier(source, access.identityKey, identifier));
            delivered += newItems.length;
            finishDiagnosticTrace(trace, 'success', { source, itemCount: items.length, count: newItems.length });
          } catch (error) {
            if (identifier) {
              await beforeDeadline(dependencies.system.dismissDigest(source, identifier)).catch(() => undefined);
            }
            await beforeDeadline(recorded.rollback()).catch(() => undefined);
            throw error;
          }
        } catch (error) {
          const reason = normalizeDiagnosticReason(error);
          const blocked = ['login_required', 'permission_denied', 'verification_required'].includes(reason);
          finishDiagnosticTrace(trace, reason === 'canceled' ? 'canceled' : blocked ? 'blocked' : 'failure', {
            source,
            reason
          });
          throw error;
        }
      })
    );
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
