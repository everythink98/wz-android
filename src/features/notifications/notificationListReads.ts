import type { NotificationSource } from '@/domain/forum/sourceCatalog';

type Refresh = { kind: 'idle' } | { kind: 'pending'; request: object };

export function createNotificationListReads() {
  let refresh: Refresh = { kind: 'idle' };
  const retries = new Map<NotificationSource, AbortController>();
  return {
    get refreshing() {
      return refresh.kind === 'pending';
    },
    beginRefresh() {
      if (refresh.kind === 'pending') return null;
      const request = {};
      refresh = { kind: 'pending', request };
      return request;
    },
    finishRefresh(request: object) {
      if (refresh.kind === 'pending' && refresh.request === request) refresh = { kind: 'idle' };
    },
    invalidateRefresh() {
      refresh = { kind: 'idle' };
    },
    beginRetry(source: NotificationSource) {
      retries.get(source)?.abort();
      const controller = new AbortController();
      retries.set(source, controller);
      return controller;
    },
    ownsRetry(source: NotificationSource, controller: AbortController) {
      return retries.get(source) === controller && !controller.signal.aborted;
    },
    finishRetry(source: NotificationSource, controller: AbortController) {
      if (retries.get(source) === controller) retries.delete(source);
    },
    cancelRetry() {
      for (const controller of retries.values()) controller.abort();
      retries.clear();
    }
  };
}
