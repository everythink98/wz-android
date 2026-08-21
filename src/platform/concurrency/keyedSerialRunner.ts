export function createKeyedSerialRunner<K>() {
  const tails = new Map<K, Promise<void>>();

  return {
    run<T>(key: K, operation: () => Promise<T>): Promise<T> {
      const result = (tails.get(key) ?? Promise.resolve()).then(operation, operation);
      const tail = result.then(
        () => undefined,
        () => undefined
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    }
  };
}
