type Attempt = Readonly<{ controller: AbortController }>;
type Mark =
  { phase: 'idle' | 'confirmed' | 'retryable' } | { phase: 'pending'; attempt: Attempt; messageIds: string[] };

export function createNotificationReadReceipt() {
  let state: Mark = { phase: 'idle' };
  let visit: 'unattempted' | 'attempted' = 'unattempted';
  const attemptedIds = new Set<string>();
  const confirmedIds = new Set<string>();
  const owns = (attempt: Attempt) =>
    state.phase === 'pending' && state.attempt === attempt && !attempt.controller.signal.aborted;
  const unconfirmed = (ids: readonly string[] | undefined) => Boolean(ids?.some((id) => !confirmedIds.has(id)));
  return {
    owns,
    get phase() {
      return state.phase;
    },
    get attemptedThisVisit() {
      return visit === 'attempted';
    },
    beginVisit() {
      visit = 'unattempted';
    },
    hasNewMessages(ids: readonly string[] | undefined) {
      return Boolean(ids?.some((id) => !attemptedIds.has(id) && !confirmedIds.has(id)));
    },
    begin() {
      if (state.phase === 'pending') return null;
      const attempt = { controller: new AbortController() };
      visit = 'attempted';
      state = { phase: 'pending', attempt, messageIds: [] };
      return attempt;
    },
    select(attempt: Attempt, ids: readonly string[] | undefined, explicitRetry: boolean) {
      if (state.phase !== 'pending' || !owns(attempt)) return [];
      const selected = (ids || []).filter((id) => !confirmedIds.has(id) && (explicitRetry || !attemptedIds.has(id)));
      state = { ...state, messageIds: selected };
      return selected;
    },
    noMessages(attempt: Attempt, ids: readonly string[] | undefined) {
      if (owns(attempt)) state = { phase: unconfirmed(ids) ? 'retryable' : 'confirmed' };
      return state.phase;
    },
    willSend(attempt: Attempt) {
      if (state.phase === 'pending' && owns(attempt)) state.messageIds.forEach((id) => attemptedIds.add(id));
    },
    completed(attempt: Attempt, confirmed: boolean, remainingIds: readonly string[] | undefined) {
      if (state.phase !== 'pending' || !owns(attempt)) return false;
      if (confirmed) state.messageIds.forEach((id) => confirmedIds.add(id));
      const remaining = unconfirmed(remainingIds);
      state = { phase: confirmed && !remaining ? 'confirmed' : 'retryable' };
      return remaining;
    },
    failed(attempt: Attempt) {
      if (owns(attempt)) state = { phase: 'retryable' };
    },
    cancel() {
      if (state.phase === 'pending') {
        state.attempt.controller.abort();
        state.messageIds.forEach((id) => {
          if (!confirmedIds.has(id)) attemptedIds.delete(id);
        });
        state = { phase: 'retryable' };
      }
      visit = 'unattempted';
    }
  };
}
