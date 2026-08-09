import { useSyncExternalStore } from 'react';
import type { Source } from '@/domain/forum/sourceCatalog';

export type ReadNetworkRuntimeSnapshot = Readonly<{
  generation: number;
  triggerSource: Source | null;
}>;

let snapshot: ReadNetworkRuntimeSnapshot = {
  generation: 0,
  triggerSource: null
};

const listeners = new Set<() => void>();

export function getReadNetworkRuntimeSnapshot() {
  return snapshot;
}

export function currentReadNetworkRuntimeGeneration() {
  return snapshot.generation;
}

export function publishReadNetworkRuntimeRotation(generation: number, triggerSource: Source) {
  if (!Number.isSafeInteger(generation) || generation <= snapshot.generation) {
    return snapshot;
  }
  snapshot = { generation, triggerSource };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function subscribeReadNetworkRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadNetworkRuntimeSnapshot() {
  return useSyncExternalStore(
    subscribeReadNetworkRuntime,
    getReadNetworkRuntimeSnapshot,
    getReadNetworkRuntimeSnapshot
  );
}

export function useReadNetworkRuntimeGeneration(source: Source | null | undefined) {
  const current = useReadNetworkRuntimeSnapshot();
  return current.triggerSource === source ? current.generation : 0;
}
