export type PolicyRun = {
  readonly scope: string;
  readonly controller: AbortController;
  readonly busyDuringConfirmation: boolean;
};
type PolicyRequest = { readonly phase: 'confirming' | 'sending'; readonly run: PolicyRun };
export type PolicyOperationSnapshot = PolicyRequest | null;
export const policyRequestBusy = (request: PolicyRequest | null) =>
  Boolean(request && (request.phase === 'sending' || request.run.busyDuringConfirmation));

export function createDiscoursePolicyOperation({
  isCurrentScope,
  publish
}: {
  isCurrentScope(scope: string): boolean;
  publish(snapshot: PolicyOperationSnapshot): void;
}) {
  let state: PolicyOperationSnapshot = null;
  const commit = (next: PolicyOperationSnapshot) => {
    state = next;
    publish(next);
  };
  const owns = (run: PolicyRun) => state?.run === run && !run.controller.signal.aborted && isCurrentScope(run.scope);
  const cancelRun = (run: PolicyRun) => {
    if (state?.run !== run) return;
    run.controller.abort();
    commit(null);
  };
  const cancel = () => {
    if (state) cancelRun(state.run);
  };
  return {
    owns,
    cancel,
    cancelRun,
    hasRequest: () => state !== null,
    claim({ scope, busyDuringConfirmation }: Pick<PolicyRun, 'scope' | 'busyDuringConfirmation'>) {
      if (state || !isCurrentScope(scope)) return null;
      const run: PolicyRun = {
        scope,
        busyDuringConfirmation,
        controller: new AbortController()
      };
      commit({ phase: 'confirming', run });
      return run;
    },
    beginSend(run: PolicyRun) {
      if (!owns(run) || state?.phase !== 'confirming') return false;
      commit({ phase: 'sending', run });
      return true;
    },
    finish(run: PolicyRun) {
      if (state?.run === run) commit(null);
    }
  };
}
