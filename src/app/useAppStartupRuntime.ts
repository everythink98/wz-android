import { useCallback, useEffect, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { recordDiagnosticError } from '@/platform/diagnostics/diagnostics';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { navigationRef } from './appNavigation';

const iconSource = { uri: 'reader_app_icon' };

try {
  void SplashScreen.preventAutoHideAsync().catch((error) => recordDiagnosticError('app', 'startup', error));
  SplashScreen.setOptions({ duration: 0, fade: false });
} catch (error) {
  recordDiagnosticError('app', 'startup', error);
}

function currentRouteKey() {
  return navigationRef.getCurrentRoute()?.key || '';
}

export function useAppStartupRuntime(onNavigationReady?: () => void, getCurrentRouteKey = currentRouteKey) {
  const navigationReady = useRef(false);
  const laidOutRoutes = useRef(new Set<string>());
  const completed = useRef(false);
  const scheduled = useRef(false);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    recordStartupPhase('react-mounted');
    return () => {
      active.current = false;
    };
  }, []);

  const finish = useCallback(() => {
    if (!navigationReady.current || completed.current || scheduled.current) return;
    scheduled.current = true;
    // Let navigation callbacks dispatch their pending deep link before choosing the visible route.
    queueMicrotask(() => {
      scheduled.current = false;
      if (!active.current || completed.current || !laidOutRoutes.current.has(getCurrentRouteKey())) return;
      completed.current = true;
      laidOutRoutes.current.clear();
      recordStartupPhase('page-layout');
      recordStartupPhase('page-ready');
      try {
        SplashScreen.hide();
        recordStartupPhase('splash-hidden');
      } catch (error) {
        recordDiagnosticError('app', 'startup', error);
      }
    });
  }, [getCurrentRouteKey]);

  const onReady = useCallback(() => {
    if (navigationReady.current) return;
    onNavigationReady?.();
    navigationReady.current = true;
    recordStartupPhase('navigation-ready');
    finish();
  }, [finish, onNavigationReady]);

  const onLayout = useCallback(
    (routeKey: string) => {
      if (completed.current || !routeKey) return;
      laidOutRoutes.current.add(routeKey);
      finish();
    },
    [finish]
  );

  return { iconSource, onLayout, onReady, onRouteChange: finish };
}
