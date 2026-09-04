import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '../render';
import { StyleSheet } from 'react-native';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { AppButton } from '@/ui/controls/ButtonControls';
import { LoadingState, RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { PillRail } from '@/ui/controls/SelectionControls';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';

describe('shared accessibility basics', () => {
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

  it('keeps recoverable empty copy and its single action together', async () => {
    const onAction = jest.fn();
    const view = await render(<RecoverableEmptyState message="暂时没有内容" actionLabel="重试" onAction={onAction} />);

    const state = view.getByTestId('recoverable-empty-state');
    expect(StyleSheet.flatten(state.props.style)).toMatchObject({
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16
    });
    await fireEvent.press(view.getByRole('button', { name: '重试' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('keeps short source tabs at least 48dp in both axes', async () => {
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

  it('centers source labels within their tab indicators', async () => {
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

  it('scales shared notification tabs and action buttons with Reader settings', async () => {
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
