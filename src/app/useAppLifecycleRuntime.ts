import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ToastAndroid, useWindowDimensions } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import type { UserReference } from '@/domain/forum/models';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { normalizeUserReference } from '@/domain/forum/userNavigation';
import { errorMessage } from '@/platform/network/errors';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { LOGIN_WEBVIEW_ALLOWED_HOSTS, shouldOpenLoginWebViewUrl } from '@/platform/network/loginWebViewNavigation';
import { setRequestTimeoutsActive } from '@/platform/network/request';
import type { Screen } from '@/ui/navigation/types';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { useAppDeepLinkNavigation } from './useAppDeepLinkNavigation';
import { navigateAppScreen, pushUserRoute, shouldUpdateAppRootScreen } from './appNavigation';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';

export function useAppLifecycleRuntime() {
  const { height, width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  );
  const screenRef = useRef<Screen>('feed');
  useCommitRefValue(screenRef, screen);

  const notify = useCallback((message: string) => {
    if (message) ToastAndroid.show(message, ToastAndroid.SHORT);
  }, []);
  const getCurrentScreen = useCallback(() => screenRef.current, []);
  const changeScreen = useCallback((nextScreen: Screen) => {
    navigateAppScreen(nextScreen);
  }, []);
  const openUserRoute = useCallback(
    async (user: UserReference) => {
      const normalized = normalizeUserReference(user);
      if (!normalized) {
        notify('用户信息不完整');
        return 'completed' as const;
      }
      pushUserRoute(normalized);
      return 'completed' as const;
    },
    [notify]
  );
  const openExternalUrl = useCallback(
    (url: string) => {
      if (!isHttpOrHttpsUrl(url)) {
        notify('仅支持打开 http/https 链接。');
        return;
      }
      void Linking.openURL(url).catch((error) => notify(errorMessage(error)));
    },
    [notify]
  );
  const handleLoginNavigation = useCallback(
    (request: LoginNavigationRequest, allowedHosts: readonly string[]) => {
      if (shouldOpenLoginWebViewUrl(request.url, allowedHosts)) return true;
      if (isHttpOrHttpsUrl(request.url)) openExternalUrl(request.url);
      return false;
    },
    [openExternalUrl]
  );
  const onScreenChange = useCallback((nextScreen: Screen, routeKey: string) => {
    const previousScreen = screenRef.current;
    const trace = beginDiagnosticTrace('navigation', 'screen-change', {
      previousState: previousScreen,
      nextState: nextScreen,
      routeKind: routeKey ? 'stack' : 'tab'
    });
    if (previousScreen === nextScreen) {
      finishDiagnosticTrace(trace, 'noop', { state: 'same-screen' });
      return;
    }
    screenRef.current = nextScreen;
    if (shouldUpdateAppRootScreen(previousScreen, nextScreen)) setScreen(nextScreen);
    finishDiagnosticTrace(trace, 'success', { state: 'applied' });
  }, []);

  useEffect(() => {
    const initialActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    setRequestTimeoutsActive(initialActive);
    focusManager.setFocused(initialActive);
    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      setRequestTimeoutsActive(active);
      focusManager.setFocused(active);
    });
    return () => {
      subscription.remove();
      setRequestTimeoutsActive(true);
      focusManager.setFocused(undefined);
    };
  }, []);

  return {
    appActive,
    changeScreen,
    getCurrentScreen,
    height,
    loginNavigation: {
      linuxdo: (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.linuxdo),
      nodeimage: (request: LoginNavigationRequest) =>
        handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.nodeimage),
      nodeseek: (request: LoginNavigationRequest) =>
        handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.nodeseek),
      yaohuo: (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.yaohuo)
    },
    notify,
    onReady: useAppDeepLinkNavigation(),
    onScreenChange,
    openUserRoute,
    screen,
    width
  };
}
