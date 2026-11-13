type SerialJob = () => void;
type SerialQueueState = { phase: 'idle' } | { phase: 'running'; active: SerialJob; waiting: SerialJob[] };
type SerialQueueOwner = { state: SerialQueueState };

export function createKeyedSerialRunner<K>(dispatch: 'direct' | 'after-reaction' = 'direct') {
  const owners = new Map<K, SerialQueueOwner>();
  const dispatchJob = (job: SerialJob) => {
    if (dispatch === 'after-reaction') void Promise.resolve().then(job);
    else job();
  };

  return {
    run<T>(key: K, operation: () => Promise<T>): Promise<T> {
      const owner: SerialQueueOwner = owners.get(key) ?? { state: { phase: 'idle' } };
      // The Promise constructor binds its resolver synchronously.
      let start!: SerialJob;
      const ready = new Promise<void>((resolve) => {
        start = resolve;
      });
      const result = ready.then(operation);
      const finish = () => {
        const state = owner.state;
        if (state.phase !== 'running' || state.active !== start) return;
        const next = state.waiting.shift();
        owner.state = next ? { phase: 'running', active: next, waiting: state.waiting } : { phase: 'idle' };
        if (next) dispatchJob(next);
        else owners.delete(key);
      };
      // Direct mode releases the next gate in the settlement reaction, before observer follow-up microtasks.
      void result.then(finish, finish);
      if (owner.state.phase === 'idle') {
        owner.state = { phase: 'running', active: start, waiting: [] };
        owners.set(key, owner);
        dispatchJob(start);
      } else {
        owner.state.waiting.push(start);
      }
      return result;
    }
  };
}
