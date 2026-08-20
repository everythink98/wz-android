import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Keyboard, Platform, Text } from 'react-native';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import { act, render } from '../render';

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
  it('REG-SEARCH-026 releases Android keyboard avoidance after every keyboard dismissal', async () => {
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
