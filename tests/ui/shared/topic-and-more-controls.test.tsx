import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppearancePanel } from '@/features/more/components/AppearancePanel';
import { ReadingSettingsScreen } from '@/features/more/ReadingSettingsScreen';
import { TopicMenu } from '@/features/topic/components/TopicMenu';
import {
  NavigationBackdropProvider,
  NavigationBackdropTarget,
  NavigationGlass,
  NavigationGlassGroup
} from '@/ui/navigation/NavigationGlass';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { CheckCircle: Icon, ExternalLink: Icon, Image: Icon, RefreshCw: Icon, Settings: Icon, Share2: Icon };
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
      const view = await render(<ReadingSettingsScreen settings={readerData.settings} onUpdateSettings={jest.fn()} />);
      let content = view.getByText('显示').parent;
      while (content && !content.props.contentContainerStyle) content = content.parent;
      const contentStyle = StyleSheet.flatten(content?.props.contentContainerStyle);
      expect(contentStyle.paddingTop).toBeLessThanOrEqual(16);
      expect(view.getByText('显示')).toBeVisible();
      expect(view.getByLabelText('增大字号')).toBeVisible();
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

  it('reports visible appearance choices as setting patches', async () => {
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        theme={theme}
        onUpdateSettings={onUpdateSettings}
      />
    );

    await fireEvent.press(view.getByText('深色'));
    await fireEvent.press(view.getAllByText('宽松')[0]);
    await fireEvent.press(view.getByText('宽'));
    await fireEvent.press(view.getByText('衬线'));
    await fireEvent.press(view.getAllByText('紧凑')[1]);

    expect(onUpdateSettings.mock.calls).toEqual([
      [{ theme: 'dark' }],
      [{ lineHeight: 'loose' }],
      [{ contentWidth: 'wide' }],
      [{ fontFamily: 'serif' }],
      [{ listDensity: 'compact' }]
    ]);
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
      />
    );

    const slider = view.getByTestId('appearance-font-scale-slider');
    await act(async () => slider.props.onValueChange(1.15));
    expect(view.getByText('字号 115%')).toBeTruthy();
    expect(onUpdateSettings).not.toHaveBeenCalled();

    await act(async () => slider.props.onSlidingComplete(1.15));
    expect(onUpdateSettings).toHaveBeenCalledTimes(1);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ fontScale: 1.15 });

    await fireEvent.press(view.getByLabelText('减小字号'));
    expect(view.getByText('字号 110%')).toBeTruthy();
    expect(onUpdateSettings).toHaveBeenCalledTimes(2);
    expect(onUpdateSettings).toHaveBeenLastCalledWith({ fontScale: 1.1 });
  });
});
