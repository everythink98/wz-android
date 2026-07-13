export type NodeImageCredentialMutation = Readonly<{
  promise: Promise<void>;
  revision: number;
}>;

export function createNodeImageCredentialCoordinator({
  clear,
  read,
  save
}: {
  clear: () => Promise<void>;
  read: () => Promise<string | null>;
  save: (value: string) => Promise<void>;
}) {
  let revision = 0;
  let tail = Promise.resolve();

  const replace = (value: string | null): NodeImageCredentialMutation => {
    revision += 1;
    const mutationRevision = revision;
    const promise = tail
      .catch(() => undefined)
      .then(() => value ? save(value) : clear());
    tail = promise.then(() => undefined, () => undefined);
    return Object.freeze({ promise, revision: mutationRevision });
  };

  return {
    currentRevision: () => revision,
    read: () => tail.catch(() => undefined).then(read),
    replace,
    replaceIfCurrent(expectedRevision: number, value: string | null) {
      return revision === expectedRevision ? replace(value) : null;
    }
  };
}

export type NodeImageCredentialCoordinator = ReturnType<typeof createNodeImageCredentialCoordinator>;
