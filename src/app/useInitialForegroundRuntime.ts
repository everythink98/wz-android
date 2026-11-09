import { useCallback, useReducer } from 'react';

type ForegroundPhase = 'awaiting-both' | 'awaiting-feed' | 'awaiting-catalog' | 'ready';
type ForegroundEvent = 'feed-ready' | 'catalog-settled';

function advanceForeground(phase: ForegroundPhase, event: ForegroundEvent): ForegroundPhase {
  switch (phase) {
    case 'awaiting-both':
      return event === 'feed-ready' ? 'awaiting-catalog' : 'awaiting-feed';
    case 'awaiting-feed':
      return event === 'feed-ready' ? 'ready' : phase;
    case 'awaiting-catalog':
      return event === 'catalog-settled' ? 'ready' : phase;
    case 'ready':
      return phase;
  }
}

export function useInitialForegroundRuntime() {
  const [phase, dispatch] = useReducer(advanceForeground, 'awaiting-both');
  return {
    feedContentReady: phase === 'awaiting-catalog' || phase === 'ready',
    initialForegroundReady: phase === 'ready',
    onCatalogSettled: useCallback((settled: boolean) => {
      if (settled) dispatch('catalog-settled');
    }, []),
    onFeedInitialContentReady: useCallback(() => dispatch('feed-ready'), [])
  };
}
