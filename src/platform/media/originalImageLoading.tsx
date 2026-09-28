import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ImageURISource } from 'react-native';
import { compatibleImageRequestIdentity } from './compatibleImageSources';

const OriginalImageUpgradeContext = createContext(true);
const MAX_DISPLAY_REVISIONS = 512;
const displayRevisions = new Map<string, number>();
const displayListeners = new Map<string, Set<() => void>>();

function pruneDisplayRevisions() {
  while (displayRevisions.size > MAX_DISPLAY_REVISIONS) {
    let removableIdentity = '';
    for (const identity of displayRevisions.keys()) {
      if (!displayListeners.has(identity)) {
        removableIdentity = identity;
        break;
      }
    }
    if (!removableIdentity) {
      return;
    }
    displayRevisions.delete(removableIdentity);
  }
}

function promoteDisplayRevision(identity: string) {
  const revision = displayRevisions.get(identity) || 0;
  if (revision) {
    displayRevisions.delete(identity);
    displayRevisions.set(identity, revision);
  }
  return revision;
}

export function OriginalImageUpgradeBoundary({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const parentEnabled = useContext(OriginalImageUpgradeContext);
  return (
    <OriginalImageUpgradeContext.Provider value={parentEnabled && enabled}>
      {children}
    </OriginalImageUpgradeContext.Provider>
  );
}

export function useOriginalImageUpgradeEnabled() {
  return useContext(OriginalImageUpgradeContext);
}

export function originalImageDisplayIdentity(source: ImageURISource | null) {
  return source?.uri ? compatibleImageRequestIdentity(source) : '';
}

export function markOriginalImageDisplayed(source: ImageURISource | null) {
  const identity = originalImageDisplayIdentity(source);
  if (!identity) {
    return;
  }
  const alreadyOverCapacity = displayRevisions.size > MAX_DISPLAY_REVISIONS;
  const revision = (displayRevisions.get(identity) || 0) + 1;
  displayRevisions.delete(identity);
  displayRevisions.set(identity, revision);
  // An over-capacity map contains only subscribed identities; only this update can introduce an unprotected one.
  if (alreadyOverCapacity) {
    if (!displayListeners.has(identity)) displayRevisions.delete(identity);
  } else {
    pruneDisplayRevisions();
  }
  displayListeners.get(identity)?.forEach((listener) => listener());
}

export function originalImageDisplayRevision(source: ImageURISource | null) {
  const identity = originalImageDisplayIdentity(source);
  return identity ? displayRevisions.get(identity) || 0 : 0;
}

export function subscribeOriginalImageDisplay(source: ImageURISource | null, listener: () => void) {
  return subscribeOriginalImageIdentity(originalImageDisplayIdentity(source), listener);
}

function subscribeOriginalImageIdentity(identity: string, listener: () => void) {
  if (!identity) {
    return () => {};
  }
  promoteDisplayRevision(identity);
  const listeners = displayListeners.get(identity) || new Set<() => void>();
  listeners.add(listener);
  displayListeners.set(identity, listeners);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (!listeners.size) {
      displayListeners.delete(identity);
      if (displayRevisions.size > MAX_DISPLAY_REVISIONS) displayRevisions.delete(identity);
    }
  };
}

export function useOriginalImageDisplayRevision(source: ImageURISource | null) {
  const identity = originalImageDisplayIdentity(source);
  const subscribe = useCallback(
    (listener: () => void) => subscribeOriginalImageIdentity(identity, listener),
    [identity]
  );
  const snapshot = useCallback(() => (identity ? displayRevisions.get(identity) || 0 : 0), [identity]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
