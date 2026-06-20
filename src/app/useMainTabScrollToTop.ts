import { useCallback, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import type { MainTabParamList } from './AppNavigator';

type SignalTab = Exclude<keyof MainTabParamList, 'more'>;

export function useMainTabScrollToTop() {
  const moreScrollRef = useRef<ScrollView>(null);
  const [tabScrollToTopSignals, setTabScrollToTopSignals] = useState<Record<SignalTab, number>>({
    feed: 0,
    search: 0,
    library: 0
  });

  const requestTabScrollToTop = useCallback((target: keyof MainTabParamList) => {
    if (target === 'more') {
      moreScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setTabScrollToTopSignals((current) => ({
      ...current,
      [target]: current[target] + 1
    }));
  }, []);

  return {
    moreScrollRef,
    requestTabScrollToTop,
    tabScrollToTopSignals
  };
}
