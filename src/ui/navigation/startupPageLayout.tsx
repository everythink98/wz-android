import { createContext, useCallback, useContext } from 'react';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';

const StartupPageLayoutContext = createContext<((routeKey: string) => void) | undefined>(undefined);

export const StartupPageLayoutProvider = StartupPageLayoutContext.Provider;

// The screen's own root reports layout; navigator shells and hidden routes cannot release the splash.
export function useStartupPageLayout() {
  const report = useContext(StartupPageLayoutContext);
  const route = useContext(NavigationRouteContext);
  const navigation = useContext(NavigationContext);
  return useCallback(() => {
    if (route?.key && navigation?.isFocused()) report?.(route.key);
  }, [navigation, report, route?.key]);
}
