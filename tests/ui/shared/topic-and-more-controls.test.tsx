import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import React from 'react';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppearancePanel } from '@/features/more/components/AppearancePanel';
import { TopicMenu } from '@/features/topic/components/TopicMenu';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';

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
    );

    await fireEvent.press(view.getByText('分享'));
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
