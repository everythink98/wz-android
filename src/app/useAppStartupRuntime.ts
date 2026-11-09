import { useCallback, useEffect, useRef } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { beginDiagnosticTrace, finishDiagnosticTrace, recordDiagnosticError } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { recordStartupPhase } from '@/platform/diagnostics/startupTiming';
import { pruneDiagnosticExports } from '@/platform/diagnostics/diagnosticExportFiles';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
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

type PendingPage = {
  phase: 'awaiting-navigation' | 'delivering-navigation' | 'awaiting-layout' | 'check-queued';
  layouts: Set<string>;
};
type StartupPage = PendingPage | { phase: 'ready' };
type StartupMount = { idleTask?: number };

function hideNativeSplash() {
  try {
    SplashScreen.hide();
    recordStartupPhase('splash-hidden');
  } catch (error) {
    recordDiagnosticError('app', 'startup', error);
  }
}

function maintainExports() {
  const trace = beginDiagnosticTrace('diagnostic', 'export-cleanup');
  try {
    pruneDiagnosticExports();
    finishDiagnosticTrace(trace, 'success');
  } catch (error) {
    finishDiagnosticTrace(trace, 'failure', { reason: normalizeDiagnosticReason(error) });
  }
}

export function useAppStartupRuntime(onNavigationReady?: () => void, getCurrentRouteKey = currentRouteKey) {
  const callbacks = useCommittedRef({ onNavigationReady, getCurrentRouteKey });
  const page = useRef<StartupPage>({ phase: 'awaiting-navigation', layouts: new Set() });
  const mount = useRef<StartupMount | null>({});
  const pendingSplashHide = useRef<(() => void) | null>(hideNativeSplash);

  const hideSplashOnce = useCallback(() => {
    if (!mount.current) return;
    const hide = pendingSplashHide.current;
    pendingSplashHide.current = null;
    hide?.();
  }, []);

  const checkVisibleLayout = useCallback(() => {
    const owner = mount.current;
    const pending = page.current;
    if (!owner || pending.phase !== 'awaiting-layout') return;
    const check: PendingPage = { phase: 'check-queued', layouts: pending.layouts };
    page.current = check;

    // The navigation callback may dispatch a pending deep link before this runs.
    queueMicrotask(() => {
      if (page.current !== check || mount.current !== owner) return;
      if (!check.layouts.has(callbacks.current.getCurrentRouteKey())) {
        page.current = { phase: 'awaiting-layout', layouts: check.layouts };
        return;
      }
      page.current = { phase: 'ready' };
      recordStartupPhase('page-layout');
      recordStartupPhase('page-ready');
      hideSplashOnce();
      try {
        owner.idleTask = requestIdleCallback(() => {
          if (mount.current !== owner) return;
          delete owner.idleTask;
          maintainExports();
        });
      } catch (error) {
        recordDiagnosticError('app', 'startup', error);
      }
    });
  }, [callbacks, hideSplashOnce]);

  useEffect(() => {
    const owner = (mount.current ??= {});
    recordStartupPhase('react-mounted');
    checkVisibleLayout();
    return () => {
      mount.current = null;
      const pending = page.current;
      if (pending.phase === 'check-queued') page.current = { phase: 'awaiting-layout', layouts: pending.layouts };
      if (owner.idleTask !== undefined) cancelIdleCallback(owner.idleTask);
    };
  }, [checkVisibleLayout]);

  const onReady = useCallback(() => {
    const waiting = page.current;
    if (!mount.current || waiting.phase !== 'awaiting-navigation') return;
    page.current = { phase: 'delivering-navigation', layouts: waiting.layouts };
    try {
      callbacks.current.onNavigationReady?.();
    } catch (error) {
      page.current = waiting;
      throw error;
    }
    page.current = { phase: 'awaiting-layout', layouts: waiting.layouts };
    if (!mount.current) return;
    recordStartupPhase('navigation-ready');
    checkVisibleLayout();
  }, [callbacks, checkVisibleLayout]);

  const onLayout = useCallback(
    (routeKey: string) => {
      const pending = page.current;
      if (!mount.current || pending.phase === 'ready' || !routeKey) return;
      pending.layouts.add(routeKey);
      checkVisibleLayout();
    },
    [checkVisibleLayout]
  );

  return { iconSource, onLayout, onReady, onRecoveryLayout: hideSplashOnce, onRouteChange: checkVisibleLayout };
}
