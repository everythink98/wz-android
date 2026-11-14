import type { DiscoursePostPolicy } from './discoursePolicy';

export type PolicySubmission = {
  readonly scope: string;
  readonly postId: string;
  readonly version: string;
  readonly accepted: boolean;
};
export type PolicyRun = {
  readonly scope: string;
  readonly postId: string;
  readonly version: string;
  readonly accepted: boolean;
  readonly controller: AbortController;
  readonly busyDuringConfirmation: boolean;
};
type PolicyRequest = { readonly phase: 'confirming' | 'sending'; readonly run: PolicyRun };
export type PolicyOperationSnapshot = {
  readonly request: PolicyRequest | null;
  readonly submissions: Readonly<Record<string, PolicySubmission>>;
};
export const policyRequestBusy = (request: PolicyRequest | null) =>
  Boolean(request && (request.phase === 'sending' || request.run.busyDuringConfirmation));

export function createDiscoursePolicyOperation({
  isCurrentScope,
  publish
}: {
  isCurrentScope(scope: string): boolean;
  publish(snapshot: PolicyOperationSnapshot): void;
}) {
  let state: PolicyOperationSnapshot = { request: null, submissions: {} };
  const commit = (next: PolicyOperationSnapshot) => {
    state = next;
    publish(next);
  };
  const owns = (run: PolicyRun) =>
    state.request?.run === run && !run.controller.signal.aborted && isCurrentScope(run.scope);
  const cancelRun = (run: PolicyRun) => {
    if (state.request?.run !== run) return;
    run.controller.abort();
    commit({ ...state, request: null });
  };
  const cancel = () => {
    if (state.request) cancelRun(state.request.run);
  };
  return {
    owns,
    cancel,
    cancelRun,
    hasRequest: () => state.request !== null,
    submitted: (scope: string, policy: Pick<DiscoursePostPolicy, 'postId' | 'version'>) => {
      const marker = state.submissions[policy.postId];
      return marker?.scope === scope && marker.version === policy.version ? marker : undefined;
    },
    claim({
      scope,
      policy,
      accepted,
      busyDuringConfirmation
    }: {
      scope: string;
      policy: Pick<DiscoursePostPolicy, 'postId' | 'version'>;
      accepted: boolean;
      busyDuringConfirmation: boolean;
    }) {
      if (state.request || !isCurrentScope(scope)) return null;
      const run: PolicyRun = {
        scope,
        postId: policy.postId,
        version: policy.version,
        accepted,
        busyDuringConfirmation,
        controller: new AbortController()
      };
      commit({ ...state, request: { phase: 'confirming', run } });
      return run;
    },
    beginSend(run: PolicyRun) {
      if (!owns(run) || state.request?.phase !== 'confirming') return false;
      commit({ ...state, request: { phase: 'sending', run } });
      return true;
    },
    confirmed(run: PolicyRun) {
      if (!owns(run)) return;
      const marker = { scope: run.scope, postId: run.postId, version: run.version, accepted: run.accepted };
      commit({ ...state, submissions: { ...state.submissions, [run.postId]: marker } });
    },
    observe(scope: string, policies: readonly (DiscoursePostPolicy | undefined)[]) {
      const previous = Object.values(state.submissions);
      const remaining = previous.filter((marker) => {
        const current = policies.find((policy) => policy?.postId === marker.postId);
        return (
          marker.scope === scope &&
          (!current || (current.version === marker.version && current.accepted !== marker.accepted))
        );
      });
      if (previous.length !== remaining.length)
        commit({ ...state, submissions: Object.fromEntries(remaining.map((marker) => [marker.postId, marker])) });
    },
    finish(run: PolicyRun) {
      if (state.request?.run === run) commit({ ...state, request: null });
    },
    reset() {
      if (state.request) state.request.run.controller.abort();
      commit({ request: null, submissions: {} });
    }
  };
}
