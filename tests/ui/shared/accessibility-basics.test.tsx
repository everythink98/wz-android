import { describe, expect, it } from '@jest/globals';
import { render } from '../render';
import React from 'react';
import { StyleSheet } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppButton } from '@/ui/controls/ButtonControls';
import { LoadingState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';

describe('REG-A11Y-001 shared accessibility basics', () => {
  it('announces loading once as a polite busy status', async () => {
    const view = await render(<LoadingState text="正在读取主题" />);
    const status = view.getByRole('status');

    expect(status.props).toMatchObject({
      accessible: true,
      accessibilityLabel: '正在读取主题',
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true }
    });
    const [indicator] = view.root?.queryAll((instance) => instance.type === 'ActivityIndicator') || [];
    expect(indicator.props.accessible).toBe(false);
    expect(view.getByText('正在读取主题').props.accessible).toBe(false);
  });

  it('[REG-NOTIFY-014] keeps short source tabs at least 48dp in both axes', async () => {
    const view = await render(
      <PillRail
        variant="tabs"
        testIDPrefix="source"
        items={[{ value: 'all', label: '全部' }]}
        value="all"
        onChange={() => undefined}
      />
    );
    const style = StyleSheet.flatten(view.getByTestId('source-all').props.style);

    expect(style.minWidth).toBeGreaterThanOrEqual(48);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('[REG-NOTIFY-035] centers source labels within their tab indicators', async () => {
    const view = await render(
      <PillRail
        variant="tabs"
        testIDPrefix="source"
        items={[{ value: 'all', label: '全部' }]}
        value="all"
        onChange={() => undefined}
      />
    );

    expect(StyleSheet.flatten(view.getByText('全部').props.style).textAlign).toBe('center');
  });

  it('[REG-NOTIFY-050] scales shared notification tabs and action buttons with Reader settings', async () => {
    const settings = { ...createEmptyReaderData().settings, fontScale: 1.3 };
    const view = await render(
      <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>
        <>
          <PillRail
            variant="tabs"
            items={[{ value: 'all', label: '全部消息' }]}
            value="all"
            onChange={() => undefined}
          />
          <AppButton label="消息操作" onPress={() => undefined} />
        </>
      </ReaderStyleProvider>
    );

    expect(StyleSheet.flatten(view.getByText('全部消息').props.style).fontSize).toBe(Math.round(13 * 1.3));
    expect(StyleSheet.flatten(view.getByText('消息操作').props.style).fontSize).toBe(Math.round(13 * 1.3));
  });
});
