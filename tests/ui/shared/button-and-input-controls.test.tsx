import { describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { fireEvent, render, waitFor } from '../render';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { AppButton, FloatingIconButton, IconButton } from '@/ui/controls/ButtonControls';
import { AppSwitch, AppTextInput } from '@/ui/controls/InputControls';
import { ExpandablePanel, MenuButton } from '@/ui/controls/ExpandableControls';
import { PopupMenuItem } from '@/ui/controls/PopupMenu';
import { PillRail } from '@/ui/controls/SelectionControls';

describe('Shared action and form controls', () => {
  it('keeps secondary labels compact inside a full-sized touch target', async () => {
    const view = await render(
      <PillRail
        variant="subtabs"
        testIDPrefix="secondary"
        items={[{ value: 'all', label: '全部' }]}
        value="all"
        onChange={() => undefined}
      />
    );
    expect(StyleSheet.flatten(view.getByTestId('secondary-all-container').props.style)).toMatchObject({
      minHeight: 34
    });
    expect(StyleSheet.flatten(view.getByTestId('secondary-all').props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48
    });
    expect(StyleSheet.flatten(view.getByText('全部').props.style)).toMatchObject({
      fontSize: 12,
      lineHeight: 16,
      includeFontPadding: false
    });
  });

  it('centers setting copy and icons without inherited list padding', async () => {
    const view = await render(
      <>
        <ExpandablePanel title="内容源" meta="4/4 已启用" expanded={false} onExpandedChange={() => undefined}>
          <></>
        </ExpandablePanel>
        <MenuButton icon={Search} label="服务器代理" value="未启用" onPress={() => undefined} />
      </>
    );
    for (const label of ['展开内容源', /服务器代理/]) {
      const row = view.getByRole('button', { name: label });
      expect(StyleSheet.flatten(row.props.style)).toMatchObject({
        paddingVertical: 0,
        paddingRight: 0,
        justifyContent: 'center',
        minHeight: 48
      });
    }
  });

  it('keeps menu content centered with balanced horizontal insets', async () => {
    const view = await render(<PopupMenuItem label="刷新" onPress={() => undefined} />);
    expect(StyleSheet.flatten(view.getByRole('menuitem', { name: '刷新' }).props.style)).toMatchObject({
      paddingLeft: 12,
      paddingRight: 12,
      justifyContent: 'center'
    });
  });

  it('keeps a named action reachable and prevents disabled activation', async () => {
    const onPress = jest.fn();
    const view = await render(<AppButton label="重试" accessibilityLabel="重新加载内容" onPress={onPress} />);
    await fireEvent.press(view.getByRole('button', { name: '重新加载内容' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await view.rerender(<AppButton label="重试" accessibilityLabel="重新加载内容" disabled onPress={onPress} />);
    await fireEvent.press(view.getByRole('button', { name: '重新加载内容' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes selection and blocks a busy icon action without losing its name', async () => {
    const onPress = jest.fn();
    const view = await render(<IconButton icon={Search} label="查询" active loading onPress={onPress} />);
    const action = view.getByRole('button', { name: '查询' });
    expect(action.props.accessibilityState).toMatchObject({ busy: true, selected: true, disabled: true });
    await fireEvent.press(action);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('prevents repeated floating actions while loading', async () => {
    const onPress = jest.fn();
    const view = await render(<FloatingIconButton icon={Search} label="打开查询" loading onPress={onPress} />);
    const action = view.getByRole('button', { name: '打开查询' });
    expect(action.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(action);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('preserves controlled form values and disabled editing', async () => {
    const changed = jest.fn();
    function Form() {
      const [value, setValue] = useState('');
      return (
        <AppTextInput
          accessibilityLabel="筛选作者"
          value={value}
          onChangeText={(next) => {
            setValue(next);
            changed(next);
          }}
        />
      );
    }
    const view = await render(<Form />);
    await fireEvent.changeText(view.getByLabelText('筛选作者'), 'reader');
    expect(view.getByDisplayValue('reader')).toBeTruthy();
    expect(changed).toHaveBeenLastCalledWith('reader');
    await view.rerender(<AppTextInput accessibilityLabel="筛选作者" value="reader" editable={false} />);
    expect(view.getByLabelText('筛选作者').props.editable).toBe(false);
  });

  it.each([1, 1.4])('keeps form labels and values in the selected font at %s scale', async (fontScale) => {
    const settings = { ...createEmptyReaderData().settings, fontScale, fontFamily: 'serif' as const };
    const theme = createTheme(settings);
    const form = (value: string) => (
      <ReaderStyleProvider value={{ settings, theme }}>
        <AppTextInput accessibilityLabel="悬赏妖晶" value={value} onChangeText={() => undefined} />
      </ReaderStyleProvider>
    );
    const view = await render(form(''));
    const inputSize = Math.round(14 * fontScale);
    const systemScale = PixelRatio.getFontScale();
    const label = () => view.getByText('悬赏妖晶', { includeHiddenElements: true });
    const assertTypography = async (floating: boolean) => {
      const labelSize = (floating ? 12 : 16) * fontScale;
      await waitFor(() => {
        const labelView = label();
        expect(getAnimatedStyle(labelView)).toMatchObject({ fontFamily: 'serif', fontSize: labelSize });
        expect(view.getByLabelText('悬赏妖晶')).toHaveStyle({ fontFamily: 'serif', fontSize: inputSize });
        if (!labelView.parent) throw new Error('The floating label must have a positioning container');
        const labelTop = getAnimatedStyle(labelView.parent).top;
        expect(labelTop).toBeCloseTo((floating ? 0 : 26 * systemScale) - (labelSize * systemScale) / 2);
      });
    };

    await assertTypography(false);
    await fireEvent(view.getByLabelText('悬赏妖晶'), 'focus');
    await assertTypography(true);
    await view.rerender(form('2000'));
    await fireEvent(view.getByLabelText('悬赏妖晶'), 'blur');
    await assertTypography(true);
    await view.rerender(form(''));
    await assertTypography(false);
  });

  it('retains native switch state and its pending accessibility state', async () => {
    const onValueChange = jest.fn<(value: boolean) => void>();
    const view = await render(<AppSwitch accessibilityLabel="站点通知" value onValueChange={onValueChange} />);
    await fireEvent(view.getByLabelText('站点通知'), 'valueChange', false);
    expect(onValueChange).toHaveBeenCalledWith(false);
    await view.rerender(
      <AppSwitch
        accessibilityLabel="站点通知"
        value
        disabled
        accessibilityState={{ busy: true, disabled: true }}
        onValueChange={onValueChange}
      />
    );
    expect(view.getByLabelText('站点通知').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(view.getByLabelText('站点通知')).toBeDisabled();
  });
});
