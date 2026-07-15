import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { createEmptyReaderData } from '../../src/readerData';
import { BackupRestorePanel, AppearancePanel } from '../../src/screens/more/MorePanels';
import { TopicMenu } from '../../src/screens/topic/TopicMenu';
import { createStyles, createTheme } from '../../src/theme';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { CheckCircle: Icon, ExternalLink: Icon, Image: Icon, RefreshCw: Icon, Settings: Icon, Share2: Icon };
});
jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return { WebView: ReactModule.forwardRef(() => ReactModule.createElement(NativeView)) };
});
jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Gesture: { Pan: () => ({ minDistance() { return this; }, runOnJS() { return this; }, onBegin() { return this; }, onUpdate() { return this; }, onEnd() { return this; }, onFinalize() { return this; } }) },
    GestureDetector: ({ children }: { children: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children)
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
        theme={theme}
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

  it('disables both backup actions while a backup operation is active', async () => {
    const onExportBackupFile = jest.fn();
    const onImportBackupFile = jest.fn();
    const view = await render(
      <BackupRestorePanel
        backupBusy
        styles={styles}
        onExportBackupFile={onExportBackupFile}
        onImportBackupFile={onImportBackupFile}
      />
    );

    expect(view.getByLabelText('处理中').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('选择备份文件恢复').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('处理中'));
    await fireEvent.press(view.getByLabelText('选择备份文件恢复'));
    expect(onExportBackupFile).not.toHaveBeenCalled();
    expect(onImportBackupFile).not.toHaveBeenCalled();
  });

  it('reports visible appearance choices as setting patches', async () => {
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
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

  it('updates the visible font scale through buttons and accessibility actions', async () => {
    jest.useFakeTimers();
    const onUpdateSettings = jest.fn();
    const view = await render(
      <AppearancePanel
        settings={readerData.settings}
        showSettingsPanel
        styles={styles}
        onUpdateSettings={onUpdateSettings}
      />
    );

    await fireEvent.press(view.getByLabelText('增大字号'));
    expect(view.getByText('字号 105%')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(300));

    await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' }
    });
    expect(view.getByText('字号 100%')).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(300));

    expect(onUpdateSettings.mock.calls).toEqual([
      [{ fontScale: 1.05 }],
      [{ fontScale: 1 }]
    ]);
    view.unmount();
    jest.useRealTimers();
  });
});
