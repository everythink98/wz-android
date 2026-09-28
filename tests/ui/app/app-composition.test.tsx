import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as SplashScreen from 'expo-splash-screen';
import { act, fireEvent, renderHook } from '@testing-library/react-native';
import { useAppStartupRuntime } from '@/app/useAppStartupRuntime';
import { setStartupTimingRecorder, type StartupPhase } from '@/platform/diagnostics/startupTiming';
import { Text } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppComposition } from '@/app/AppComposition';
import { AppRoutes } from '@/app/AppRoutes';
import { createAppStyles } from '@/app/styles';
import { useAppRuntime } from '@/app/useAppRuntime';
import { createTheme } from '@/ui/theme/tokens';
import { render } from '../render';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { StartupPageLayoutProvider, useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import type { ComponentProps, ReactNode } from 'react';

jest.mock('@/app/AppRoutes', () => ({ AppRoutes: jest.fn(() => null) }));
jest.mock('@/app/useAppRuntime', () => ({ useAppRuntime: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  setOptions: jest.fn(),
  hide: jest.fn()
}));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView'
}));

describe('App composition bootstrap', () => {
  it('keeps navigation delivery stable across root updates and uses a replaced handler', async () => {
    const settings = createEmptyReaderData().settings;
    const theme = createTheme(settings);
    const onScreenChange = jest.fn<ComponentProps<typeof AppRoutes>['onScreenChange']>();
    // AppRoutes is replaced at this boundary; only its navigation callbacks are consumed here.
    const routes = { onScreenChange, onReady: jest.fn<() => void>() } as unknown as NonNullable<
      ReturnType<typeof useAppRuntime>['routes']
    >;
    const runtime: ReturnType<typeof useAppRuntime> = {
      onUserInteraction: jest.fn(),
      accountHost: (<Text>账号</Text>) as ReturnType<typeof useAppRuntime>['accountHost'],
      appStyles: createAppStyles(theme),
      mediaTransportIdentity: 'disabled',
      readerStyleContext: { settings, theme },
      routes,
      sessionEpochs: { linuxdo: 0, nodeseek: 0, yaohuo: 0 },
      theme
    };
    jest.mocked(useAppRuntime).mockReturnValue(runtime);
    const view = await render(<AppComposition />);
    const initial = jest.mocked(AppRoutes).mock.calls.at(-1)![0].onScreenChange;
    for (let index = 0; index < 10; index++) {
      jest.mocked(useAppRuntime).mockReturnValue({ ...runtime, routes: { ...routes } });
      await view.rerender(<AppComposition />);
      expect(jest.mocked(AppRoutes).mock.calls.at(-1)![0].onScreenChange).toBe(initial);
    }
    await act(async () => initial('search', 'search-route'));
    expect(onScreenChange).toHaveBeenCalledWith('search', 'search-route');
    const next = jest.fn<ComponentProps<typeof AppRoutes>['onScreenChange']>();
    jest.mocked(useAppRuntime).mockReturnValue({ ...runtime, routes: { ...routes, onScreenChange: next } });
    await view.rerender(<AppComposition />);
    await act(async () => jest.mocked(AppRoutes).mock.calls.at(-1)![0].onScreenChange('feed', 'feed-route'));
    expect(next).toHaveBeenCalledWith('feed', 'feed-route');
    expect(onScreenChange).toHaveBeenCalledTimes(1);
  });

  it('accepts layout only from a currently focused page with its own route key', async () => {
    const report = jest.fn();
    let focused = false;
    const navigation = { isFocused: () => focused } as ComponentProps<typeof NavigationContext.Provider>['value'];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NavigationContext.Provider value={navigation}>
        <NavigationRouteContext.Provider value={{ key: 'topic-visible', name: 'Topic' }}>
          <StartupPageLayoutProvider value={report}>{children}</StartupPageLayoutProvider>
        </NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    );
    const hook = await renderHook(useStartupPageLayout, { wrapper });
    await act(async () => hook.result.current());
    expect(report).not.toHaveBeenCalled();
    focused = true;
    await act(async () => hook.result.current());
    expect(report).toHaveBeenCalledWith('topic-visible');
  });

  afterEach(() => {
    setStartupTimingRecorder(undefined);
    jest.mocked(SplashScreen.hide).mockClear();
    jest.restoreAllMocks();
  });

  it('exposes a static accessible status while the startup gate is pending', async () => {
    const settings = createEmptyReaderData().settings;
    const theme = createTheme(settings);
    const onInteraction = jest.fn();
    jest.mocked(useAppRuntime).mockReturnValue({
      onUserInteraction: onInteraction,
      accountHost: (<Text>账号 WebView 已阻止</Text>) as ReturnType<typeof useAppRuntime>['accountHost'],
      appStyles: createAppStyles(theme),
      mediaTransportIdentity: 'loading',
      readerStyleContext: { settings, theme },
      routes: null,
      sessionEpochs: { linuxdo: 0, nodeseek: 0, yaohuo: 0 },
      theme
    });

    const view = await render(<AppComposition />);

    expect(view.queryByText('阅坛')).toBeNull();
    expect(view.queryByText('正在启动')).toBeNull();
    expect(view.getByRole('status').props).toMatchObject({
      accessibilityLabel: '阅坛正在启动',
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true }
    });
    expect(view.getByText('账号 WebView 已阻止')).toBeTruthy();
    const [icon] = view.root?.queryAll((instance) => instance.type === 'Image') || [];
    expect(icon.props.source).toEqual({ uri: 'reader_app_icon' });
    expect(view.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
    expect(SplashScreen.hide).not.toHaveBeenCalled();
    expect(onInteraction).not.toHaveBeenCalled();
    await fireEvent(view.getByText('账号 WebView 已阻止'), 'touchStart');
    await fireEvent(view.getByText('账号 WebView 已阻止'), 'touchMove');
    expect(onInteraction).toHaveBeenCalledTimes(2);
  });

  it.each(['navigation-first', 'layout-first'])(
    'hides once after both navigation and the page layout: %s',
    async (order) => {
      const phases: StartupPhase[] = [];
      setStartupTimingRecorder((phase) => phases.push(phase));
      const navigationReady = jest.fn(() => expect(SplashScreen.hide).not.toHaveBeenCalled());
      const hook = await renderHook(() => useAppStartupRuntime(navigationReady, () => 'feed'));
      await act(async () => {
        if (order === 'navigation-first') hook.result.current.onReady();
        else hook.result.current.onLayout('feed');
      });
      expect(SplashScreen.hide).not.toHaveBeenCalled();
      await act(async () => {
        if (order === 'navigation-first') hook.result.current.onLayout('feed');
        else hook.result.current.onReady();
      });
      expect(navigationReady).toHaveBeenCalledTimes(1);
      expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
      await act(async () => hook.result.current.onLayout('feed'));
      await act(async () => hook.result.current.onReady());
      expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
      expect(phases.filter((phase) => phase === 'page-ready')).toHaveLength(1);
      expect(phases.filter((phase) => phase === 'splash-hidden')).toHaveLength(1);
    }
  );

  it('keeps page readiness usable when the native splash API fails', async () => {
    jest.mocked(SplashScreen.hide).mockImplementationOnce(() => {
      throw new Error('No activity');
    });
    const hook = await renderHook(() => useAppStartupRuntime(undefined, () => 'feed'));
    await act(async () => {
      hook.result.current.onLayout('feed');
      expect(() => hook.result.current.onReady()).not.toThrow();
    });
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  it('does not hide for the layout of a background or superseded route', async () => {
    const hook = await renderHook(() => useAppStartupRuntime(undefined, () => 'topic-current'));
    await act(async () => {
      hook.result.current.onReady();
      hook.result.current.onLayout('feed-background');
    });
    expect(SplashScreen.hide).not.toHaveBeenCalled();
    await act(async () => hook.result.current.onLayout('topic-current'));
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });
});
