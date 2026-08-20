import { useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { Screen } from '@/ui/navigation/types';
import {
  CURRENT_ANDROID_VERSION_CODE,
  CURRENT_APP_VERSION,
  CURRENT_EXPO_VERSION,
  CURRENT_REACT_NATIVE_VERSION
} from '@/platform/update/appUpdate';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';

export function useAppDiagnosticsRuntime({
  accountSessionViewModels,
  appUpdateBusy,
  appUpdateDownloading,
  dimensions,
  fontScale,
  proxyEnabled,
  screen,
  statusBusy,
  themeDark
}: {
  accountSessionViewModels: SiteSessionViewModels;
  appUpdateBusy: boolean;
  appUpdateDownloading: boolean;
  dimensions: { height: number; width: number };
  fontScale: number;
  proxyEnabled: boolean;
  screen: Screen;
  statusBusy: boolean;
  themeDark: boolean;
}) {
  const metadata = useMemo(
    () => ({
      androidApiLevel: typeof Platform.Version === 'number' ? Platform.Version : undefined,
      appVersion: CURRENT_APP_VERSION,
      currentScreen: screen,
      deviceModel: Platform.OS === 'android' ? Platform.constants.Model : undefined,
      expoVersion: CURRENT_EXPO_VERSION,
      fontScale,
      linuxDoSession: accountSessionViewModels.linuxdo.status,
      nodeSeekSession: accountSessionViewModels.nodeseek.status,
      proxyEnabled,
      reactNativeVersion: CURRENT_REACT_NATIVE_VERSION,
      screenHeight: dimensions.height,
      screenWidth: dimensions.width,
      theme: themeDark ? ('dark' as const) : ('light' as const),
      versionCode: CURRENT_ANDROID_VERSION_CODE,
      yaohuoSession: accountSessionViewModels.yaohuo.status
    }),
    [accountSessionViewModels, dimensions.height, dimensions.width, fontScale, proxyEnabled, screen, themeDark]
  );
  const pageStateRef = useRef('');

  useEffect(() => {
    const isBusy = screen === 'more' && (appUpdateBusy || appUpdateDownloading || statusBusy);
    const emptyReason = screen === 'more' ? 'none' : 'route-owned';
    const stateKey = `${screen}:${isBusy}:false:1:${emptyReason}`;
    if (pageStateRef.current === stateKey) return;
    pageStateRef.current = stateKey;
    const trace = beginDiagnosticTrace('app', 'page-state', {
      screen,
      isBusy,
      hasError: false,
      itemCount: 1,
      emptyReason
    });
    markDiagnosticStage(trace, 'apply', { state: 'summary' });
    finishDiagnosticTrace(trace, 'success');
  }, [appUpdateBusy, appUpdateDownloading, screen, statusBusy]);

  return { metadata };
}
