type Refresh = { kind: 'idle' } | { kind: 'pending'; request: object };
type Retry = { kind: 'idle' } | { kind: 'pending'; controller: AbortController };

export function createNotificationListReads() {
  let refresh: Refresh = { kind: 'idle' };
  let retry: Retry = { kind: 'idle' };
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
    beginRetry() {
      if (retry.kind === 'pending') retry.controller.abort();
      const controller = new AbortController();
      retry = { kind: 'pending', controller };
      return controller;
    },
    ownsRetry(controller: AbortController) {
      return retry.kind === 'pending' && retry.controller === controller && !controller.signal.aborted;
    },
    finishRetry(controller: AbortController) {
      if (retry.kind === 'pending' && retry.controller === controller) retry = { kind: 'idle' };
    },
    cancelRetry() {
      if (retry.kind === 'pending') retry.controller.abort();
      retry = { kind: 'idle' };
    }
  };
}
