import { describe, expect, it, jest } from '@jest/globals';
import { useState } from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { PaperProvider } from 'react-native-paper';
import { getAnimatedStyle } from 'react-native-reanimated';
import { act, fireEvent, render, waitFor } from '../render';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { AppButton, FloatingIconButton, IconButton } from '@/ui/controls/ButtonControls';
import { AppSwitch, AppTextInput } from '@/ui/controls/InputControls';
import { ExpandablePanel, MenuButton } from '@/ui/controls/ExpandableControls';
import { PopupMenu, PopupMenuItem } from '@/ui/controls/PopupMenu';
import { ScreenTopBar } from '@/ui/controls/ScreenTopBar';
import { PillRail } from '@/ui/controls/SelectionControls';

describe('Shared action and form controls', () => {
  it('tracks the current system top inset as the window changes', async () => {
    const tree = (top: number) => (
      <SafeAreaInsetsContext.Provider value={{ top, left: 0, right: 0, bottom: 0 }}>
        <ScreenTopBar>
          <Text>主题</Text>
        </ScreenTopBar>
      </SafeAreaInsetsContext.Provider>
    );
    const view = await render(tree(48));
    expect(StyleSheet.flatten(view.getByText('主题').parent?.props.style).paddingTop).toBe(56);
    await view.rerender(tree(0));
    expect(StyleSheet.flatten(view.getByText('主题').parent?.props.style).paddingTop).toBe(8);
  });

  it('allows long menu contents to scroll between an anchor and the bottom safe area', async () => {
    const view = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 20 }}>
        <PopupMenu
          scrollable
          visible
          accessibilityLabel="关闭筛选"
          testID="filter-menu"
          placementStyle={{ position: 'absolute', top: 140 }}
          onRequestClose={jest.fn()}
        >
          <PopupMenuItem label="最后一个选项" onPress={jest.fn()} />
        </PopupMenu>
      </SafeAreaInsetsContext.Provider>
    );
    const menu = view.getByTestId('filter-menu');
    await fireEvent(menu.parent!, 'layout', { nativeEvent: { layout: { width: 520, height: 300, x: 0, y: 0 } } });
    expect(StyleSheet.flatten(menu.props.style).maxHeight).toBeLessThanOrEqual(140);
    expect(view.getByTestId('filter-menu-scroll')).toBeTruthy();
  });

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
        paddingVertical: 10,
        paddingRight: 0,
        justifyContent: 'center',
        minHeight: 60
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

  it('centers an idle text action without an empty loading slot', async () => {
    const view = await render(<AppButton label="确定" loading={false} onPress={jest.fn()} />);
    const label = view.getByText('确定');
    expect(label.parent?.children.length).toBe(1);
    await view.rerender(<AppButton label="确定" loading onPress={jest.fn()} />);
    expect(view.getByRole('button', { name: '确定' }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true
    });
  });

  it('exposes selection and blocks a busy icon action without losing its name', async () => {
    const onPress = jest.fn();
    const view = await render(<IconButton icon={Search} label="查询" active loading onPress={onPress} />);
    const action = view.getByRole('button', { name: '查询' });
    expect(action.props.accessibilityState).toMatchObject({ busy: true, selected: true, disabled: true });
    await fireEvent.press(action);
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each(['icon-only', 'floating', 'icon-label', 'label'] as const)(
    'forwards native child flattening through the %s Paper action across disabled states',
    async (kind) => {
      const onPress = jest.fn();
      const action = (disabled: boolean) => {
        const props = { label: '返回', disabled, onPress };
        if (kind === 'floating') return <FloatingIconButton {...props} icon={Search} />;
        if (kind === 'label') return <AppButton {...props} />;
        return <IconButton {...props} icon={Search} iconOnly={kind === 'icon-only'} />;
      };
      const view = await render(action(true));
      const button = () => view.getByRole('button', { name: '返回' });
      expect(button().props.collapsableChildren).toBe(false);
      expect(button().props.accessibilityState).toMatchObject({ disabled: true });
      await fireEvent.press(button());
      expect(onPress).not.toHaveBeenCalled();

      await view.rerender(action(false));
      expect(button().props.collapsableChildren).toBe(false);
      expect(button().props.accessibilityState).toMatchObject({ disabled: false });
      await fireEvent.press(button());
      expect(onPress).toHaveBeenCalledTimes(1);
    }
  );

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

  it.each([
    { variant: 'outlined', direction: 'ltr', fontScale: 1, initialValue: '' },
    { variant: 'outlined', direction: 'rtl', fontScale: 1.4, initialValue: '2000' },
    { variant: 'filled', direction: 'ltr', fontScale: 1.4, initialValue: '2000' }
  ] as const)(
    'keeps a stable label layout in $variant $direction fields at $fontScale scale',
    async ({ variant, direction, fontScale, initialValue }) => {
      const settings = { ...createEmptyReaderData().settings, uiFontScale: fontScale, uiFontFamily: 'system' as const };
      const theme = createTheme(settings);
      const form = (value: string) => (
        <ReaderStyleProvider value={{ settings, theme }}>
          <PaperProvider direction={direction}>
            <AppTextInput
              variant={variant}
              accessibilityLabel="悬赏妖晶"
              value={value}
              onChangeText={() => undefined}
            />
          </PaperProvider>
        </ReaderStyleProvider>
      );
      const view = await render(form(initialValue));
      const inputSize = Math.round(14 * fontScale);
      const label = () => view.getByText('悬赏妖晶', { includeHiddenElements: true });
      const labelHeight = 23;
      const fieldHeight = 70;
      const filledPadding = Math.ceil(8 * Dimensions.get('window').fontScale);
      const field = label().parent?.parent;
      if (!field) throw new Error('The floating label needs its input field');
      await fireEvent(label(), 'layout', { nativeEvent: { layout: { height: labelHeight } } });
      await fireEvent(field, 'layout', { nativeEvent: { layout: { height: fieldHeight } } });

      const assertTypography = async (floating: boolean) => {
        const scale = floating ? 0.75 : 1;
        const translateX = floating && variant === 'outlined' ? (direction === 'rtl' ? 4 : -4) : 0;
        const translateY = floating
          ? variant === 'outlined'
            ? -(labelHeight * scale) / 2
            : filledPadding
          : (fieldHeight - labelHeight) / 2;
        await waitFor(() => {
          const labelView = label();
          expect(labelView).toHaveStyle({ fontFamily: 'sans-serif', fontSize: 16 * fontScale });
          expect(labelView).toHaveProp('numberOfLines', 1);
          expect(view.getByLabelText('悬赏妖晶')).toHaveStyle({ fontFamily: 'sans-serif', fontSize: inputSize });
          if (!labelView.parent) throw new Error('The floating label must have a positioning container');
          expect(labelView.parent).toHaveStyle({
            top: 0,
            transformOrigin: direction === 'rtl' ? 'right top' : 'left top'
          });
          expect(getAnimatedStyle(labelView.parent).transform).toEqual([{ translateX }, { translateY }, { scale }]);
        });
      };

      await assertTypography(Boolean(initialValue));
      await view.rerender(form(''));
      await assertTypography(false);
      await fireEvent(view.getByLabelText('悬赏妖晶'), 'focus');
      await assertTypography(true);
      await view.rerender(form('2000'));
      await fireEvent(view.getByLabelText('悬赏妖晶'), 'blur');
      await assertTypography(true);
      await view.rerender(form(''));
      await assertTypography(false);
    }
  );

  it('updates input metrics when Android changes font scale in the same runtime', async () => {
    const original = Dimensions.get('window');
    try {
      await act(async () => Dimensions.set({ window: { ...original, fontScale: 0.9 } }));
      const view = await render(<AppTextInput label="缩放测试" />);
      const field = () => view.getByText('缩放测试', { includeHiddenElements: true }).parent?.parent;
      expect(field()).toHaveStyle({ minHeight: 51 });
      await act(async () => Dimensions.set({ window: { ...original, fontScale: 2 } }));
      expect(field()).toHaveStyle({ minHeight: 112 });
    } finally {
      await act(async () => Dimensions.set({ window: original }));
    }
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
