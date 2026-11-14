import { shouldAllowFeedAutoLoadRequest } from './floatingActions';

type Request = Readonly<{ page: number }>;
type Work = { kind: 'idle' } | { kind: 'pending'; request: Request };
type Admission = { kind: 'ready'; lastOffset: number | null } | { kind: 'failure-paused' };

export function createFeedPageRequests() {
  let work: Work = { kind: 'idle' };
  let admission: Admission = { kind: 'ready', lastOffset: null };
  return {
    begin(page: number, trigger: 'button' | 'scroll', offsetY: number, minStep: number) {
      if (
        trigger === 'scroll' &&
        !shouldAllowFeedAutoLoadRequest({
          pausedAfterFailure: admission.kind === 'failure-paused',
          lastOffset: admission.kind === 'ready' ? admission.lastOffset : null,
          offsetY,
          minStep
        })
      )
        return null;
      if (work.kind === 'pending' && work.request.page === page) return null;
      const request = { page };
      work = { kind: 'pending', request };
      if (trigger === 'button' && admission.kind === 'failure-paused') admission = { kind: 'ready', lastOffset: null };
      if (trigger === 'scroll') admission = { kind: 'ready', lastOffset: offsetY };
      return request;
    },
    settle(request: Request, failed: boolean) {
      if (work.kind !== 'pending' || work.request !== request) return;
      work = { kind: 'idle' };
      if (failed) admission = { kind: 'failure-paused' };
    },
    observedIdle() {
      work = { kind: 'idle' };
    },
    failureObserved() {
      admission = { kind: 'failure-paused' };
    },
    dragged() {
      admission = { kind: 'ready', lastOffset: null };
    },
    reset() {
      work = { kind: 'idle' };
      admission = { kind: 'ready', lastOffset: null };
    }
  };
}
