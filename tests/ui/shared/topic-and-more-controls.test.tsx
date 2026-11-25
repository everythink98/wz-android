import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '../render';
import React from 'react';
import { Dimensions, StatusBar, StyleSheet, View } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppearancePanel } from '@/features/more/components/AppearancePanel';
import { ReadingSettingsScreen } from '@/features/more/ReadingSettingsScreen';
import { TopicMenu } from '@/features/topic/components/TopicMenu';
import { AppButton } from '@/ui/controls/ButtonControls';
import {
  NavigationBackdropProvider,
  NavigationBackdropTarget,
  NavigationGlass,
  NavigationGlassGroup
} from '@/ui/navigation/NavigationGlass';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import { createQueryTestWrapper, QueryTestWrapper } from '../QueryTestWrapper';
import {
  downloadableReaderFonts,
  downloadReaderFont,
  listLocalReaderFonts,
  pickLocalReaderFont,
  prepareLocalReaderFont,
  type ReaderFontDownloadProgress
} from '@/platform/storage/readerFonts';

jest.mock('@/platform/storage/readerFonts', () => ({
  ...jest.requireActual<typeof import('@/platform/storage/readerFonts')>('@/platform/storage/readerFonts'),
  downloadReaderFont: jest.fn(),
  listLocalReaderFonts: jest.fn(),
  pickLocalReaderFont: jest.fn(),
  prepareLocalReaderFont: jest.fn()
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Check: Icon,
    CheckCircle: Icon,
    ChevronDown: Icon,
    Download: Icon,
    ExternalLink: Icon,
    FilePlus2: Icon,
    Image: Icon,
    Minus: Icon,
    Plus: Icon,
    RefreshCw: Icon,
    Settings: Icon,
    Share2: Icon
  };
});
jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return { WebView: ReactModule.forwardRef(() => ReactModule.createElement(NativeView)) };
});
jest.mock('@react-native-community/slider', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => ReactModule.createElement(View, props)
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

describe('Topic and More controls', () => {
  beforeEach(() => {
    jest.mocked(listLocalReaderFonts).mockReset().mockResolvedValue([]);
  });

  it('keeps a compact primary action readable and at least 48 dp tall to touch', async () => {
    const view = await render(<AppButton compact variant="solid" label="确认" testID="confirm" onPress={jest.fn()} />);
    const { hitSlop } = view.getByRole('button', { name: '确认' }).props;
    const minHeight = StyleSheet.flatten(view.getByText('确认').parent?.props.style).minHeight;
    expect(minHeight + hitSlop.top + hitSlop.bottom).toBeGreaterThanOrEqual(48);
    expect(StyleSheet.flatten(view.getByTestId('confirm').props.style).backgroundColor).toBe(theme.primaryStrong);
  });

  it('keeps the mounted blur target while its screen is suspended and releases it on removal', async () => {
    const contentReady = Promise.withResolvers<{ default: typeof View }>();
    const DeferredBody = React.lazy(() => contentReady.promise);
    const screen = (state: 'visible' | 'suspended' | 'removed') => (
      <NavigationBackdropProvider>
        <React.Suspense fallback={<View testID="covered-screen" />}>
          {state !== 'removed' && (
            <NavigationBackdropTarget active={state === 'visible'}>
              {state === 'suspended' ? <DeferredBody /> : <View />}
            </NavigationBackdropTarget>
          )}
        </React.Suspense>
        <NavigationGlass />
      </NavigationBackdropProvider>
    );
    const view = await render(screen('visible'));
    const currentTarget = () => view.getByTestId('navigation-glass').props.blurTarget?.current;
    const target: unknown = currentTarget();
    expect(target).toBeTruthy();
    await view.rerender(screen('suspended'));
    expect(view.getByTestId('covered-screen')).toBeTruthy();
    expect(currentTarget() === target).toBe(true);
    await view.rerender(screen('visible'));
    expect(currentTarget() === target).toBe(true);
    await view.rerender(screen('suspended'));
    await view.rerender(screen('removed'));
    await act(() => contentReady.resolve({ default: View }));
    expect(currentTarget()).toBeUndefined();
  });

  it('retains a mounted backdrop until replacement and clears only the current unmounted target', async () => {
    const content = (firstMounted: boolean, firstActive: boolean, secondMounted: boolean) => (
      <NavigationBackdropProvider>
        {firstMounted ? (
          <NavigationBackdropTarget key="first" active={firstActive}>
            <View />
          </NavigationBackdropTarget>
        ) : null}
        {secondMounted ? (
          <NavigationBackdropTarget key="second" active>
            <View />
          </NavigationBackdropTarget>
        ) : null}
        <NavigationGlassGroup>
          <View />
        </NavigationGlassGroup>
      </NavigationBackdropProvider>
    );
    const view = await render(content(true, true, false));
    const firstTarget: unknown = view.getByTestId('navigation-glass-control').props.blurTarget?.current;
    expect(firstTarget).toBeTruthy();

    await view.rerender(content(true, false, false));
    expect(view.getByTestId('navigation-glass-control').props.blurTarget?.current === firstTarget).toBe(true);

    await view.rerender(content(true, false, true));
    const secondTarget: unknown = view.getByTestId('navigation-glass-control').props.blurTarget?.current;
    expect(secondTarget).toBeTruthy();
    expect(secondTarget === firstTarget).toBe(false);

    await view.rerender(content(false, false, true));
    expect(view.getByTestId('navigation-glass-control').props.blurTarget?.current === secondTarget).toBe(true);

    await view.rerender(content(false, false, false));
    const fallback = view.getByTestId('navigation-glass-control');
    expect(fallback.props.blurTarget).toBeUndefined();
    expect(StyleSheet.flatten(fallback.props.style).backgroundColor).toBe(theme.surface);
  });

  it('keeps nested backdrop cleanup isolated from the parent page', async () => {
    const content = (innerMounted: boolean) => (
      <NavigationBackdropProvider>
        <NavigationBackdropTarget active>
          <View />
        </NavigationBackdropTarget>
        <NavigationGlass />
        <NavigationBackdropProvider>
          {innerMounted ? (
            <NavigationBackdropTarget active>
              <View />
            </NavigationBackdropTarget>
          ) : null}
          <NavigationGlassGroup>
            <View />
          </NavigationGlassGroup>
        </NavigationBackdropProvider>
      </NavigationBackdropProvider>
    );
    const view = await render(content(true));
    const parentTarget: unknown = view.getByTestId('navigation-glass').props.blurTarget?.current;
    const innerTarget: unknown = view.getByTestId('navigation-glass-control').props.blurTarget?.current;
    expect(parentTarget).toBeTruthy();
    expect(innerTarget).toBeTruthy();
    expect(innerTarget === parentTarget).toBe(false);

    await view.rerender(content(false));
    expect(view.getByTestId('navigation-glass-control').props.blurTarget).toBeUndefined();
    expect(view.getByTestId('navigation-glass').props.blurTarget?.current === parentTarget).toBe(true);
  });

  it('uses a readable fallback for navigation controls without a page backdrop', async () => {
    const view = await render(
      <NavigationGlassGroup round>
        <View />
      </NavigationGlassGroup>
    );
    expect(StyleSheet.flatten(view.getByTestId('navigation-glass-control').props.style).backgroundColor).toBe(
      theme.surface
    );
  });

  it('keeps reading controls close to the native header even with a tall status bar', async () => {
    const statusBarHeight = jest.replaceProperty(StatusBar, 'currentHeight', 64);
    try {
      const view = await render(<ReadingSettingsScreen settings={readerData.settings} onUpdateSettings={jest.fn()} />, {
        wrapper: QueryTestWrapper
      });
      let content = view.getByText('阅读字体').parent;
      while (content && !content.props.contentContainerStyle) content = content.parent;
      const contentStyle = StyleSheet.flatten(content?.props.contentContainerStyle);
      expect(contentStyle.paddingTop).toBeLessThanOrEqual(16);
      expect(view.getByText('阅读字体')).toBeVisible();
      expect(view.queryByText('界面字体')).toBeNull();
      expect(view.queryByLabelText('界面字号')).toBeNull();
      expect(view.getByLabelText('增大阅读字号')).toBeVisible();
    } finally {
      statusBarHeight.restore();
    }
  });

  it('routes every topic menu action through the shared close/action seam', async () => {
    const onOpenOriginal = jest.fn();
    const onOpenReadingSettings = jest.fn();
    const onRefreshTopic = jest.fn();
    const onRefreshWholeTopic = jest.fn();
    const onRequestClose = jest.fn();
    const onShareTopic = jest.fn();
    const runTopicMenuAction = jest.fn((action: () => void) => action());
    const topicUrl = 'https://www.v2ex.com/t/1';
    const view = await render(
      <NavigationBackdropProvider>
        <NavigationBackdropTarget active>
          <View />
        </NavigationBackdropTarget>
        <TopicMenu
          visible
          styles={styles}
          topicUrl={topicUrl}
          onOpenOriginal={onOpenOriginal}
          onOpenReadingSettings={onOpenReadingSettings}
          onRefreshTopic={onRefreshTopic}
          onRefreshWholeTopic={onRefreshWholeTopic}
          onRequestClose={onRequestClose}
          onShareTopic={onShareTopic}
          runTopicMenuAction={runTopicMenuAction}
        />
      </NavigationBackdropProvider>
    );

    expect(view.getByTestId('navigation-glass-surface').props.blurTarget.current).toBeTruthy();
    const modals = view.root?.queryAll((node) => /Modal/i.test(String(node.type))) ?? [];
    expect(
      modals.map((node) => ({
        statusBarTranslucent: node.props.statusBarTranslucent,
        navigationBarTranslucent: node.props.navigationBarTranslucent
      }))
    ).toEqual([{ statusBarTranslucent: true, navigationBarTranslucent: true }]);

    await fireEvent.press(view.getByText('分享'));
    expect(view.queryByText('分享正文图片')).toBeNull();
    await fireEvent.press(view.getByText('刷新评论'));
    await fireEvent.press(view.getByText('刷新全文'));
    await fireEvent.press(view.getByLabelText('阅读设置'));
    await fireEvent.press(view.getByText('原站打开'));
    await fireEvent.press(view.getByLabelText('关闭更多操作'));

    expect(runTopicMenuAction).toHaveBeenCalledTimes(5);
    expect(onShareTopic).toHaveBeenCalledTimes(1);
    expect(onRefreshTopic).toHaveBeenCalledTimes(1);
    expect(onRefreshWholeTopic).toHaveBeenCalledTimes(1);
    expect(onOpenReadingSettings).toHaveBeenCalledTimes(1);
    expect(onOpenOriginal).toHaveBeenCalledWith(topicUrl);
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it('offers direct theme and layout choices and reserves the dropdown for fonts', async () => {
    const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
      callback(20, 160, 225, 210);
    });
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: QueryTestWrapper }
    );

    try {
      expect(view.getByRole('radio', { name: '主题，浅色', checked: true })).toBeVisible();
      await fireEvent.press(view.getByRole('radio', { name: '主题，深色' }));
      await fireEvent.press(view.getByRole('radio', { name: '行距，宽松' }));
      await fireEvent.press(view.getByRole('radio', { name: '正文宽度，宽' }));
      await fireEvent.press(view.getByRole('radio', { name: '列表密度，紧凑' }));
      const unreadDot = view.getByRole('switch', { name: '显示未读圆点' });
      expect(unreadDot.props.value).toBe(true);
      await fireEvent(unreadDot, 'valueChange', false);
      expect(view.queryByRole('menuitem', { name: '跟随系统' })).toBeNull();
      await fireEvent.press(view.getByTestId('appearance-reading-font-dropdown'));
      const systemFont = await view.findByRole('menuitem', { name: '跟随系统' });
      expect(view.queryByRole('menuitem', { name: '衬线' })).toBeNull();
      expect(view.queryByRole('menuitem', { name: '无衬线' })).toBeNull();
      await fireEvent.press(systemFont);
      expect(onUpdateSettings.mock.calls).toEqual([
        [{ theme: 'dark' }],
        [{ lineHeight: 'loose' }],
        [{ contentWidth: 'wide' }],
        [{ listDensity: 'compact' }],
        [{ showUnreadDot: false }],
        [{ fontFamily: 'system' }]
      ]);
    } finally {
      measurement.mockRestore();
    }
  });

  it('shares imported fonts while offline and handles a canceled picker', async () => {
    const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
      callback(20, 160, 225, 225);
    });
    const family = `WzLocalFont_${'a'.repeat(64)}` as const;
    const localFont = { family, name: '本地阅读字体' };
    const chooseFont = jest.mocked(pickLocalReaderFont);
    chooseFont.mockResolvedValueOnce(null).mockImplementationOnce(async () => {
      jest.mocked(listLocalReaderFonts).mockResolvedValue([localFont]);
      return localFont;
    });
    const onUpdateSettings = jest.fn();
    const wasOnline = onlineManager.isOnline();
    onlineManager.setOnline(false);
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: QueryTestWrapper }
    );
    try {
      await fireEvent.press(view.getByTestId('appearance-reading-font-dropdown'));
      await fireEvent.press(await view.findByRole('menuitem', { name: '新增字体' }));
      expect(onUpdateSettings).not.toHaveBeenCalled();
      await fireEvent.press(view.getByTestId('appearance-reading-font-dropdown'));
      await fireEvent.press(await view.findByRole('menuitem', { name: '新增字体' }));
      await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ fontFamily: family }));
      await fireEvent.press(view.getByTestId('appearance-interface-font-dropdown'));
      await fireEvent.press(await view.findByRole('menuitem', { name: localFont.name }));
      await waitFor(() => expect(onUpdateSettings).toHaveBeenLastCalledWith({ uiFontFamily: family }));
    } finally {
      onlineManager.setOnline(wasOnline);
      measurement.mockRestore();
      chooseFont.mockReset();
    }
  });

  it('keeps the font menu open across download, installation and selection', async () => {
    const dimensions = jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 360,
      height: 720,
      scale: 3,
      fontScale: 1
    });
    const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
      callback(180, 160, 164, 48);
    });
    const font = downloadableReaderFonts.find((entry) => entry.name === 'Inter')!;
    const installed = { family: font.family, name: font.name };
    const result = Promise.withResolvers<typeof installed>();
    const subscription = Promise.withResolvers<(event: ReaderFontDownloadProgress) => void>();
    const download = jest.mocked(downloadReaderFont).mockImplementationOnce((_font, onProgress) => {
      subscription.resolve(onProgress);
      return result.promise;
    });
    const onUpdateSettings = jest.fn();
    const wasOnline = onlineManager.isOnline();
    const appearance = (fontFamily = readerData.settings.fontFamily) => (
      <AppearancePanel
        settings={{ ...readerData.settings, fontFamily }}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />
    );
    const view = await render(appearance(), { wrapper: QueryTestWrapper });
    try {
      expect(view.getByLabelText('界面字体，思源黑体')).toBeTruthy();
      await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
      expect(await view.findByText('Noto Sans SC')).toBeOnTheScreen();
      expect(view.getByRole('menuitem', { name: '思源宋体，安装' })).toBeOnTheScreen();
      await fireEvent.press(view.getByRole('menuitem', { name: 'Inter，安装' }));
      const reportProgress = await subscription.promise;
      const installing = view.getByRole('menuitem', { name: 'Inter，正在连接…', busy: true });
      expect(installing).not.toHaveStyle({ opacity: 0.5 });
      for (const name of ['跟随系统', '新增字体']) {
        const option = view.getByRole('menuitem', { name });
        expect(option).toBeDisabled();
        expect(option).toHaveStyle({ opacity: 0.5 });
      }
      const otherFont = view.getByTestId('appearance-interface-font-dropdown', { includeHiddenElements: true });
      expect(otherFont).toBeDisabled();
      expect(otherFont).toHaveStyle({ opacity: 0.5 });
      const menuID = 'appearance-reading-font-dropdown-menu-view';
      const openMenu = view.getByTestId(menuID);
      const listID = 'appearance-reading-font-dropdown-options';
      const openList = view.getByTestId(listID);
      expect(StyleSheet.flatten(openMenu.props.style)).toMatchObject({
        left: 72,
        top: 214,
        width: 272,
        maxHeight: 336
      });

      await act(async () => reportProgress({ phase: 'downloading', percent: 35 }));
      expect(await view.findByRole('menuitem', { name: 'Inter，下载中 35%', busy: true })).toBeOnTheScreen();
      expect(view.getByTestId('appearance-font-download-progress')).toBeOnTheScreen();
      await act(async () => reportProgress({ phase: 'downloading', percent: 36 }));
      expect(await view.findByRole('menuitem', { name: 'Inter，下载中 36%', busy: true })).toBeOnTheScreen();

      await act(async () => reportProgress({ phase: 'installing' }));
      expect(await view.findByRole('menuitem', { name: 'Inter，正在安装…', busy: true })).toBeOnTheScreen();
      expect(view.getByTestId('appearance-font-installing')).toBeOnTheScreen();
      expect(view.getByTestId(menuID)).toBe(openMenu);
      expect(view.getByTestId(listID)).toBe(openList);
      expect(onUpdateSettings).not.toHaveBeenCalled();
      expect(download).toHaveBeenCalledWith(font, expect.any(Function));
      jest.mocked(listLocalReaderFonts).mockResolvedValue([installed]);
      await act(async () => result.resolve(installed));
      await waitFor(() => expect(onUpdateSettings.mock.calls).toEqual([[{ fontFamily: font.family }]]));
      await view.rerender(appearance(font.family));
      expect(view.getByRole('menuitem', { name: 'Inter', selected: true })).toBeOnTheScreen();
      expect(view.getByTestId(menuID)).toBe(openMenu);
      expect(view.getByTestId(listID)).toBe(openList);

      onlineManager.setOnline(false);
      await fireEvent.press(view.getByRole('button', { name: '关闭阅读字体选择' }));
      await fireEvent.press(view.getByLabelText('界面字体，思源黑体'));
      await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter' }));
      await waitFor(() => expect(onUpdateSettings).toHaveBeenLastCalledWith({ uiFontFamily: font.family }));
      expect(download).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(wasOnline);
      dimensions.mockRestore();
      measurement.mockRestore();
      download.mockReset();
    }
  });

  it.each(['success', 'failure'] as const)(
    'observes the same font download after reading settings is removed and reopened (%s)',
    async (outcome) => {
      const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
        callback(180, 160, 164, 48);
      });
      const font = downloadableReaderFonts.find((entry) => entry.name === 'Inter')!;
      const result = Promise.withResolvers<{ family: typeof font.family; name: string }>();
      const subscription = Promise.withResolvers<(event: ReaderFontDownloadProgress) => void>();
      const download = jest.mocked(downloadReaderFont).mockImplementationOnce((_font, progress) => {
        subscription.resolve(progress);
        return result.promise;
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const onUpdateSettings = jest.fn();
      const page = <ReadingSettingsScreen settings={readerData.settings} onUpdateSettings={onUpdateSettings} />;
      const view = await render(page, { wrapper: createQueryTestWrapper(client) });
      try {
        await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
        await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter，安装' }));
        const progress = await subscription.promise;
        await act(async () => progress({ phase: 'downloading', percent: 35 }));
        expect(await view.findByRole('menuitem', { name: 'Inter，下载中 35%', busy: true })).toBeOnTheScreen();

        await view.rerender(<View />);
        await view.rerender(page);
        await fireEvent.press(view.getByLabelText('阅读字体，下载中 35%'));
        expect(await view.findByRole('menuitem', { name: 'Inter，下载中 35%', busy: true })).toBeOnTheScreen();

        const installed = { family: font.family, name: font.name };
        if (outcome === 'failure') {
          await act(async () => result.reject(new Error('字体下载失败，请重试。')));
          const retry = await view.findByRole('menuitem', { name: 'Inter，重试' });
          expect(retry).toBeEnabled();
          expect(onUpdateSettings).not.toHaveBeenCalled();
          download.mockResolvedValueOnce(installed);
          await fireEvent.press(retry);
          await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ fontFamily: font.family }));
          expect(download).toHaveBeenCalledTimes(2);
        } else {
          await act(async () => result.resolve(installed));
          await waitFor(() => expect(view.getByRole('menuitem', { name: 'Inter' })).toBeEnabled());
          expect(onUpdateSettings).not.toHaveBeenCalled();
          expect(download).toHaveBeenCalledTimes(1);
        }
      } finally {
        result.resolve({ family: font.family, name: font.name });
        await view.unmount();
        client.clear();
        measurement.mockRestore();
        download.mockReset();
      }
    }
  );

  it('keeps the chosen font after a failed download and allows another tap to retry', async () => {
    const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
      callback(20, 160, 225, 225);
    });
    const font = downloadableReaderFonts.find((entry) => entry.name === 'Inter')!;
    const download = jest
      .mocked(downloadReaderFont)
      .mockRejectedValueOnce(new Error('字体下载失败，请重试。'))
      .mockResolvedValueOnce({ family: font.family, name: font.name });
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: QueryTestWrapper }
    );
    try {
      await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
      await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter，安装' }));
      expect(await view.findByText('字体下载失败，请重试。')).toBeOnTheScreen();
      expect(onUpdateSettings).not.toHaveBeenCalled();
      await fireEvent.press(view.getByRole('menuitem', { name: 'Inter，重试' }));
      await waitFor(() => expect(onUpdateSettings.mock.calls).toEqual([[{ fontFamily: font.family }]]));
      expect(view.queryByText('字体下载失败，请重试。')).toBeNull();
      expect(download).toHaveBeenCalledTimes(2);
    } finally {
      measurement.mockRestore();
      download.mockReset();
    }
  });

  it('offers an installed font without the download error after importing it from the other group', async () => {
    const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
      callback(180, 160, 164, 48);
    });
    const font = downloadableReaderFonts.find((entry) => entry.name === 'Inter')!;
    const download = jest.mocked(downloadReaderFont).mockRejectedValueOnce(new Error('字体下载失败，请重试。'));
    const picker = jest.mocked(pickLocalReaderFont).mockResolvedValueOnce({ family: font.family, name: font.name });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: createQueryTestWrapper(client) }
    );
    try {
      await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
      await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter，安装' }));
      expect(await view.findByRole('menuitem', { name: 'Inter，重试' })).toBeEnabled();
      await fireEvent.press(view.getByRole('button', { name: '关闭阅读字体选择' }));
      await fireEvent.press(view.getByLabelText('界面字体，思源黑体'));
      await fireEvent.press(await view.findByRole('menuitem', { name: '新增字体' }));
      await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ uiFontFamily: font.family }));

      await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
      expect(view.queryByRole('menuitem', { name: 'Inter，重试' })).toBeNull();
      await fireEvent.press(view.getByRole('menuitem', { name: 'Inter' }));
      await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ fontFamily: font.family }));
      expect(download).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
      client.clear();
      measurement.mockRestore();
      download.mockReset();
      picker.mockReset();
    }
  });

  it('offers to reinstall a catalog font that cannot be opened', async () => {
    const measurement = jest.spyOn(View.prototype, 'measureInWindow').mockImplementation((callback) => {
      callback(20, 160, 225, 44);
    });
    const font = downloadableReaderFonts.find((entry) => entry.name === 'Inter')!;
    const stored = { family: font.family, name: font.name };
    jest.mocked(listLocalReaderFonts).mockResolvedValue([stored]);
    const prepare = jest.mocked(prepareLocalReaderFont).mockResolvedValueOnce(false);
    const download = jest.mocked(downloadReaderFont).mockResolvedValueOnce(stored);
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: createQueryTestWrapper(client) }
    );
    try {
      await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
      await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter' }));
      await waitFor(() => expect(prepare).toHaveBeenCalledWith(font.family));
      expect(onUpdateSettings).not.toHaveBeenCalled();
      await fireEvent.press(view.getByLabelText('阅读字体，思源黑体'));
      await fireEvent.press(await view.findByRole('menuitem', { name: 'Inter，安装' }));
      expect(download).toHaveBeenCalledWith(font, expect.any(Function));
      await waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ fontFamily: font.family }));
    } finally {
      measurement.mockRestore();
      prepare.mockReset();
      download.mockReset();
    }
  });

  it('previews font-scale dragging and commits the setting once on completion', async () => {
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: QueryTestWrapper }
    );

    const slider = view.getByTestId('appearance-reading-font-scale-slider');
    await act(async () => slider.props.onValueChange(1.15));
    expect(view.getByText('115%')).toBeTruthy();
    expect(onUpdateSettings).not.toHaveBeenCalled();

    await act(async () => slider.props.onSlidingComplete(1.15));
    expect(onUpdateSettings).toHaveBeenCalledTimes(1);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ fontScale: 1.15 });

    await fireEvent.press(view.getByLabelText('减小阅读字号'));
    expect(view.getByText('110%')).toBeTruthy();
    expect(onUpdateSettings).toHaveBeenCalledTimes(2);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ fontScale: 1.1 });
    await act(async () => view.getByTestId('appearance-interface-font-scale-slider').props.onSlidingComplete(0.85));
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ uiFontScale: 0.85 });
    expect(view.getByLabelText('阅读字号').props.accessibilityValue.now).toBe(110);
  });

  it.each<['interface' | 'reading', string, 'uiFontScale' | 'fontScale']>([
    ['interface', '界面字号', 'uiFontScale'],
    ['reading', '阅读字号', 'fontScale']
  ])('restores the applied %s font scale when Android cancels dragging', async (kind, label, setting) => {
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={{ ...readerData.settings, [setting]: 1.05 }}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />,
      { wrapper: QueryTestWrapper }
    );

    const slider = () => view.getByTestId(`appearance-${kind}-font-scale-slider`);
    await act(async () => slider().props.onValueChange(1.15));
    expect(slider().props.accessibilityValue.now).toBe(115);

    await fireEvent(slider(), 'touchCancel');
    expect(onUpdateSettings).not.toHaveBeenCalled();
    expect(slider().props.accessibilityValue.now).toBe(105);

    await fireEvent.press(view.getByLabelText(`减小${label}`));
    expect(onUpdateSettings).toHaveBeenCalledTimes(1);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ [setting]: 1 });
  });
});
