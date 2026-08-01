export type CredentialWriteGate = {
  generation: number;
  queue: Promise<void>;
};

export function createCredentialWriteGate(): CredentialWriteGate {
  return {
    generation: 0,
    queue: Promise.resolve()
  };
}

export function isCredentialWriteCurrent(gate: CredentialWriteGate, generation: number) {
  return gate.generation === generation;
}

export function advanceCredentialWriteGeneration(gate: CredentialWriteGate) {
  gate.generation += 1;
  return gate.generation;
}

export function enqueueCredentialWrite<T>(
  gate: CredentialWriteGate,
  task: ({ isCurrent }: { isCurrent: () => boolean }) => Promise<T> | T,
  { advanceGeneration = false }: { advanceGeneration?: boolean } = {}
) {
  const generation = advanceGeneration ? advanceCredentialWriteGeneration(gate) : gate.generation;
  return enqueueCredentialWriteForGeneration(gate, generation, task);
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
  const run = gate.queue
    .catch(() => undefined)
    .then(async () => {
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
