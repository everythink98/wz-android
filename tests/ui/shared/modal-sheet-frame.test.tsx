import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { AppState, Keyboard, Platform, StyleSheet, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { userPresent, recordUserInteraction } from '@/platform/network/userPresence';
import { AppButton } from '@/ui/controls/ButtonControls';
import { ModalSheetFrame, ModalSheetHeader } from '@/ui/controls/ModalSheetFrame';
import { NavigationBackdropProvider, NavigationBackdropTarget } from '@/ui/navigation/NavigationGlass';
import { act, fireEvent, render, within } from '../render';

jest.mock('react-native', () => {
  const ReactModule = require('react') as typeof React;
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  let nextKeyboardAvoidingInstance = 0;
  const KeyboardAvoidingView = ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    const [instance] = ReactModule.useState(() => (nextKeyboardAvoidingInstance += 1));
    return ReactModule.createElement(
      actual.View,
      { ...props, testID: 'keyboard-avoiding-view', accessibilityValue: { text: String(instance) } },
      children
    );
  };
  return new Proxy(actual, {
    get(target, property, receiver) {
      return property === 'KeyboardAvoidingView' ? KeyboardAvoidingView : Reflect.get(target, property, receiver);
    }
  });
});

describe('ModalSheetFrame', () => {
  it.each([0, 24, 48])(
    'keeps its last control above a %s dp system bottom inset without adding it twice',
    async (bottom) => {
      const view = await render(
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom, left: 0 }}>
          <ModalSheetFrame backdropLabel="关闭表单" visible onRequestClose={jest.fn()}>
            <AppButton label="确认" onPress={jest.fn()} />
          </ModalSheetFrame>
        </SafeAreaInsetsContext.Provider>
      );
      expect(StyleSheet.flatten(view.getByTestId('modal-sheet').props.style).paddingBottom).toBe(Math.max(18, bottom));
    }
  );

  it('samples the page behind its controls and keeps dismissal reachable', async () => {
    const close = jest.fn();
    const view = await render(
      <NavigationBackdropProvider>
        <NavigationBackdropTarget active testID="page-backdrop">
          <Text>页面内容</Text>
        </NavigationBackdropTarget>
        <ModalSheetFrame backdropLabel="关闭设置面板" visible onRequestClose={close}>
          <ModalSheetHeader title="设置面板" subtitle="当前站点" closeLabel="关闭设置" onClose={close} />
        </ModalSheetFrame>
      </NavigationBackdropProvider>
    );
    const glass = view.getByTestId('navigation-glass-surface');
    expect(glass.props.blurTarget.current).toBeTruthy();
    expect(glass.props.blurMethod).toBe('dimezisBlurViewSdk31Plus');
    expect(within(view.getByTestId('page-backdrop')).queryByText('设置面板')).toBeNull();
    const header = view.getByTestId('modal-sheet-header');
    expect(StyleSheet.flatten(header.props.style)).toMatchObject({ minHeight: 48, alignItems: 'center' });
    expect(view.getByText('设置面板')).toHaveStyle({ includeFontPadding: false, lineHeight: 22 });
    await fireEvent.press(view.getByRole('button', { name: '关闭设置' }));
    await fireEvent.press(view.getByLabelText('关闭设置面板'));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('renews activity from modal touch and accessible button activation without consuming gestures', async () => {
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    let now = 100_000;
    const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
    recordUserInteraction();
    const press = jest.fn();
    try {
      const view = await render(
        <ModalSheetFrame backdropLabel="关闭" visible onRequestClose={jest.fn()}>
          <Text>触摸目标</Text>
          <AppButton label="测试按钮" onPress={press} />
        </ModalSheetFrame>
      );
      now += 60_000;
      expect(userPresent()).toBe(false);
      await fireEvent(view.getByText('触摸目标'), 'touchMove', { nativeEvent: {} });
      expect(userPresent()).toBe(true);
      now += 60_000;
      await fireEvent.press(view.getByRole('button', { name: '测试按钮' }));
      expect(press).toHaveBeenCalledTimes(1);
      expect(userPresent()).toBe(true);
      expect(view.getByTestId('keyboard-avoiding-view').props.onStartShouldSetResponder).toBeUndefined();
    } finally {
      clock.mockRestore();
      AppState.currentState = previous;
    }
  });
  it('releases Android keyboard avoidance after every keyboard dismissal', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    let showKeyboard: (() => void) | undefined;
    let hideKeyboard: (() => void) | undefined;
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
      if (event === 'keyboardDidShow') showKeyboard = listener as typeof showKeyboard;
      if (event === 'keyboardDidHide') hideKeyboard = listener as typeof hideKeyboard;
      return { remove: jest.fn() } as never;
    });

    try {
      const view = await render(
        <ModalSheetFrame backdropLabel="关闭测试弹层" visible onRequestClose={jest.fn()}>
          <Text>测试弹层</Text>
        </ModalSheetFrame>
      );
      const keyboardAvoidingView = () => view.getByTestId('keyboard-avoiding-view');

      expect(keyboardAvoidingView().props.enabled).toBe(false);
      let instance = keyboardAvoidingView().props.accessibilityValue.text;
      for (let cycle = 0; cycle < 2; cycle += 1) {
        await act(async () => showKeyboard?.());
        expect(keyboardAvoidingView().props.enabled).toBe(true);
        expect(keyboardAvoidingView().props.accessibilityValue.text).toBe(instance);
        await act(async () => hideKeyboard?.());
        expect(keyboardAvoidingView().props.enabled).toBe(false);
        expect(keyboardAvoidingView().props.accessibilityValue.text).not.toBe(instance);
        instance = keyboardAvoidingView().props.accessibilityValue.text;
      }
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    }
  });
});
