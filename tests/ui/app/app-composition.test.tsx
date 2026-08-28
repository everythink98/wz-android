import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Text } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppComposition } from '@/app/AppComposition';
import { createAppStyles } from '@/app/styles';
import { useAppRuntime } from '@/app/useAppRuntime';
import { createTheme } from '@/ui/theme/tokens';
import { render } from '../render';

jest.mock('@/app/AppRoutes', () => ({ AppRoutes: () => null }));
jest.mock('@/app/useAppRuntime', () => ({ useAppRuntime: jest.fn() }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView'
}));

describe('App composition bootstrap', () => {
  afterEach(() => {
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

    expect(view.getByRole('header').props.children).toBe('阅坛');
    expect(view.getByRole('status').props).toMatchObject({
      accessibilityLabel: '阅坛正在启动',
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true }
    });
    expect(view.getByText('账号 WebView 已阻止')).toBeTruthy();
    expect(view.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
  });
});
