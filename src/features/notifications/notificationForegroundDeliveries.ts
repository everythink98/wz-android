import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { NotificationDeliveryScope } from '@/platform/notifications/notificationStore';
import type { createNotificationSourceLifecycleRegistry } from './notificationSourceLifecycle';

export type ForegroundDelivery = NotificationDeliveryScope & {
  source: NotificationSource;
  epoch: number;
  generation: number;
  lifecycle: ReturnType<typeof createNotificationSourceLifecycleRegistry>[NotificationSource];
};
type Work = { kind: 'idle' } | { kind: 'running'; identity: object };

export function createNotificationForegroundDeliveries() {
  let generation = 0;
  let work: Work = { kind: 'idle' };
  const pending = new Map<NotificationSource, ForegroundDelivery>();
  const drain = (
    consume: (batch: ReadonlyMap<NotificationSource, ForegroundDelivery>) => Promise<void>,
    failed: (error: unknown) => void
  ): void => {
    if (work.kind === 'running') return;
    const identity = {};
    work = { kind: 'running', identity };
    void (async () => {
      while (pending.size) {
        const batch = new Map(pending);
        pending.clear();
        await consume(batch);
      }
    })()
      .catch(failed)
      .finally(() => {
        if (work.kind !== 'running' || work.identity !== identity) return;
        work = { kind: 'idle' };
        if (pending.size) drain(consume, failed);
      });
  };
  return {
    get generation() {
      return generation;
    },
    enqueue(job: ForegroundDelivery) {
      pending.set(job.source, job);
    },
    invalidate() {
      generation += 1;
      pending.clear();
    },
    drain
  };
}
