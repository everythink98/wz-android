import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';

export type CredentialWriteGate = {
  generation: number;
  queue: Promise<void>;
  writes: ReturnType<typeof createKeyedSerialRunner<null>>;
};

export function createCredentialWriteGate(): CredentialWriteGate {
  return {
    generation: 0,
    queue: Promise.resolve(),
    writes: createKeyedSerialRunner<null>('after-reaction')
  };
}

export function isCredentialWriteCurrent(gate: CredentialWriteGate, generation: number) {
  return gate.generation === generation;
}

export function advanceCredentialWriteGeneration(gate: CredentialWriteGate) {
  gate.generation += 1;
  return gate.generation;
}

export function replaceCredentialWrite<T>(
  gate: CredentialWriteGate,
  task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<T> | T
) {
  return enqueueCredentialWriteForGeneration(gate, advanceCredentialWriteGeneration(gate), task);
}

export function enqueueCredentialWriteForGeneration<T>(
  gate: CredentialWriteGate,
  generation: number,
  task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<T> | T
) {
  const isCurrent = () => isCredentialWriteCurrent(gate, generation);
  const run = gate.writes.run(null, async () => {
    if (!isCurrent()) {
      return undefined;
    }
    const result = await task({ isCurrent });
    return isCurrent() ? result : undefined;
  });
  gate.queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
