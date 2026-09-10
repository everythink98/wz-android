import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as SplashScreen from 'expo-splash-screen';
import { act, renderHook } from '@testing-library/react-native';
import { useAppStartupRuntime } from '@/app/useAppStartupRuntime';
import { setStartupTimingRecorder, type StartupPhase } from '@/platform/diagnostics/startupTiming';
import { Text } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppComposition } from '@/app/AppComposition';
import { createAppStyles } from '@/app/styles';
import { useAppRuntime } from '@/app/useAppRuntime';
import { createTheme } from '@/ui/theme/tokens';
import { render } from '../render';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { StartupPageLayoutProvider, useStartupPageLayout } from '@/ui/navigation/startupPageLayout';
import type { ComponentProps, ReactNode } from 'react';

jest.mock('@/app/AppRoutes', () => ({ AppRoutes: () => null }));
jest.mock('@/app/useAppRuntime', () => ({ useAppRuntime: jest.fn() }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  setOptions: jest.fn(),
  hide: jest.fn()
}));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView'
}));

describe('App composition bootstrap', () => {
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
    jest.mocked(useAppRuntime).mockReturnValue({
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
