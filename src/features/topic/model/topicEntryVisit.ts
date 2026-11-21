export function createTopicEntryVisit(key: string, initiallyCached: boolean) {
  let request: AbortSignal | undefined;
  let settled = false;
  let cached = initiallyCached;
  function claimVisit(signal: AbortSignal) {
    if (settled || (request && !request.aborted)) return false;
    request = signal;
    return true;
  }
  return {
    get key() {
      return key;
    },
    get started() {
      return Boolean(request);
    },
    get settled() {
      return settled;
    },
    get cached() {
      return cached;
    },
    claimVisit,
    claimCachedRegistration(signal: AbortSignal) {
      if (!claimVisit(signal)) return false;
      cached = true;
      return true;
    },
    settleRequest(signal: AbortSignal) {
      if (signal === request && !signal.aborted) settled = true;
    }
  };
}

export type TopicEntryVisit = ReturnType<typeof createTopicEntryVisit>;
