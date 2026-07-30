import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ImageURISource } from 'react-native';
import { compatibleImageRequestIdentity } from './compatibleImageSources';

const OriginalImageUpgradeContext = createContext(true);
const displayRevisions = new Map<string, number>();
const displayListeners = new Set<() => void>();

export function OriginalImageUpgradeBoundary({
  children,
  enabled
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return (
    <OriginalImageUpgradeContext.Provider value={enabled}>
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
  displayRevisions.set(identity, (displayRevisions.get(identity) || 0) + 1);
  displayListeners.forEach((listener) => listener());
}

export function originalImageDisplayRevision(source: ImageURISource | null) {
  const identity = originalImageDisplayIdentity(source);
  return identity ? displayRevisions.get(identity) || 0 : 0;
}

export function useOriginalImageDisplayRevision(source: ImageURISource | null) {
  const identity = originalImageDisplayIdentity(source);
  return useSyncExternalStore(
    (listener) => {
      displayListeners.add(listener);
      return () => displayListeners.delete(listener);
    },
    () => identity ? displayRevisions.get(identity) || 0 : 0,
    () => 0
  );
}

export function isOriginalImageUpgradeNearViewport(
  layout: { height: number; y: number },
  viewport: { height: number; offsetY: number },
  preloadDistance: number
) {
  return layout.y + layout.height >= viewport.offsetY - preloadDistance
    && layout.y <= viewport.offsetY + viewport.height + preloadDistance;
}
