import { useCallback, useState } from 'react';

export function useInitialForegroundRuntime() {
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [feedContentReady, setFeedContentReady] = useState(false);

  return {
    initialForegroundReady: feedContentReady && catalogSettled,
    onCatalogSettled: useCallback((settled: boolean) => {
      if (settled) setCatalogSettled(true);
    }, []),
    onFeedInitialContentReady: useCallback(() => setFeedContentReady(true), [])
  };
}
