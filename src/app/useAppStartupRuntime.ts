import { useCallback, useEffect, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { beginDiagnosticTrace, finishDiagnosticTrace, recordDiagnosticError } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { pruneDiagnosticExports } from '@/platform/diagnostics/diagnosticExportFiles';
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
  const maintenance = useRef<number | null>(null);
  const splashHidden = useRef(false);

  const hideSplashOnce = useCallback(() => {
    if (!active.current || splashHidden.current) return;
    splashHidden.current = true;
    try {
      SplashScreen.hide();
      recordStartupPhase('splash-hidden');
    } catch (error) {
      recordDiagnosticError('app', 'startup', error);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    recordStartupPhase('react-mounted');
    return () => {
      active.current = false;
      if (maintenance.current !== null) cancelIdleCallback(maintenance.current);
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
      hideSplashOnce();
      try {
        maintenance.current = requestIdleCallback(() => {
          maintenance.current = null;
          if (!active.current) return;
          const trace = beginDiagnosticTrace('diagnostic', 'export-cleanup');
          try {
            pruneDiagnosticExports();
            finishDiagnosticTrace(trace, 'success');
          } catch (error) {
            finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
          }
        });
      } catch (error) {
        recordDiagnosticError('app', 'startup', error);
      }
    });
  }, [getCurrentRouteKey, hideSplashOnce]);

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

  return { iconSource, onLayout, onReady, onRecoveryLayout: hideSplashOnce, onRouteChange: finish };
}
