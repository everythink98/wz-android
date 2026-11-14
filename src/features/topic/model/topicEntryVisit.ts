export function createTopicEntryVisit(key: string, initiallyCached: boolean) {
  let started = false;
  let settled = false;
  let cached = initiallyCached;
  return {
    get key() {
      return key;
    },
    get started() {
      return started;
    },
    get settled() {
      return settled;
    },
    get cached() {
      return cached;
    },
    claimVisit() {
      if (started) return false;
      started = true;
      return true;
    },
    claimCachedRegistration() {
      if (started) return false;
      cached = true;
      started = true;
      return true;
    },
    settleRequest() {
      settled = true;
    }
  };
}

export type TopicEntryVisit = ReturnType<typeof createTopicEntryVisit>;
