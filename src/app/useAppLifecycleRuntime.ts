import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ToastAndroid, useWindowDimensions } from 'react-native';
import { focusManager } from '@tanstack/react-query';
import type { UserReference } from '@/domain/forum/models';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { normalizeUserReference } from '@/domain/forum/userNavigation';
import { errorMessage } from '@/platform/network/errors';
import { isHttpOrHttpsUrl } from '@/platform/media/imageRequestSource';
import { LOGIN_WEBVIEW_ALLOWED_HOSTS, shouldOpenLoginWebViewUrl } from '@/platform/network/loginWebViewNavigation';
import type { Screen } from '@/ui/navigation/types';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { useCommitRefValue } from '@/ui/hooks/useCommittedRef';
import { useAppDeepLinkNavigation } from './useAppDeepLinkNavigation';
import { navigateAppScreen, navigationRef, pushUserRoute, shouldUpdateAppRootScreen } from './appNavigation';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import { useInitialForegroundRuntime } from './useInitialForegroundRuntime';

export function useAppLifecycleRuntime() {
  const { height, width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>('feed');
  const [appActive, setAppActive] = useState(
    () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive'
  );
  const screenRef = useRef<Screen>('feed');
  const screenRouteKeyRef = useRef('');
  const onNavigationReady = useAppDeepLinkNavigation();
  const initialForeground = useInitialForegroundRuntime();
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
    const route = navigationRef.getCurrentRoute();
    const topicDestination = route?.name === 'Topic' ? (route.params as RootStackParamList['Topic']) : undefined;
    const userDestination = route?.name === 'User' ? (route.params as RootStackParamList['User']) : undefined;
    const topic = topicDestination?.topic;
    const user = userDestination?.user;
    const fields: DiagnosticFields = {
      previousState: previousScreen,
      nextState: nextScreen,
      routeKind: route?.name === nextScreen ? 'tab' : 'stack',
      ...(topic
        ? {
            source: topic.source,
            topicRef: diagnosticRef('topic', `${topic.source}:${topic.id}`),
            hasTargetReply: Boolean(topicDestination?.targetReply)
          }
        : user
          ? {
              source: user.source,
              userRef: diagnosticRef('user', `${user.source}:${user.id || user.username}`)
            }
          : {})
    };
    const trace = beginDiagnosticTrace('navigation', 'screen-change', fields);
    const sameRoute = previousScreen === nextScreen && screenRouteKeyRef.current === routeKey;
    screenRouteKeyRef.current = routeKey;
    if (sameRoute) {
      finishDiagnosticTrace(trace, 'noop', { ...fields, state: 'same-screen' });
      return;
    }
    screenRef.current = nextScreen;
    if (shouldUpdateAppRootScreen(previousScreen, nextScreen)) setScreen(nextScreen);
    finishDiagnosticTrace(trace, 'success', { ...fields, state: 'applied' });
  }, []);

  useEffect(() => {
    const initialActive = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    focusManager.setFocused(initialActive);
    const subscription = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      focusManager.setFocused(active);
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return {
    appActive,
    changeScreen,
    getCurrentScreen,
    height,
    initialForegroundReady: initialForeground.initialForegroundReady,
    loginNavigation: {
      linuxdo: (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.linuxdo),
      nodeimage: (request: LoginNavigationRequest) =>
        handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.nodeimage),
      nodeseek: (request: LoginNavigationRequest) =>
        handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.nodeseek),
      yaohuo: (request: LoginNavigationRequest) => handleLoginNavigation(request, LOGIN_WEBVIEW_ALLOWED_HOSTS.yaohuo)
    },
    notify,
    onCatalogSettled: initialForeground.onCatalogSettled,
    onFeedInitialContentReady: initialForeground.onFeedInitialContentReady,
    onReady: onNavigationReady,
    onScreenChange,
    openUserRoute,
    screen,
    width
  };
}
