import { createRef } from 'react';
import * as ReactNative from 'react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ComposerKeyboardHost, type ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';
import { ModalSheetFrame } from '@/ui/controls/ModalSheetFrame';
import { act, fireEvent, render } from '../render';
const native = require('react-native') as typeof import('react-native');
const platformVersion = Object.getOwnPropertyDescriptor(ReactNative.Platform, 'Version')!;
const mockInsetStyles = new Set<() => Record<string, unknown>>();

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  __esModule: true,
  default: {
    ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated').default,
    View: require('react-native').View,
    createAnimatedComponent: (component: unknown) => component
  },
  useEvent: (handler: (event: object) => void) => (event: { nativeEvent: object }) => handler(event.nativeEvent),
  useSharedValue: (value: number) =>
    (require('react') as typeof import('react')).useRef({
      value,
      set(next: number) {
        this.value = next;
      }
    }).current,
  useAnimatedStyle: (factory: () => Record<string, unknown>) => {
    const React = require('react') as typeof import('react');
    const latest = React.useRef(factory);
    latest.current = factory;
    React.useEffect(() => {
      const read = () => latest.current();
      mockInsetStyles.add(read);
      return () => {
        mockInsetStyles.delete(read);
      };
    }, []);
    return factory();
  }
}));

jest.mock('react-native/Libraries/ReactNative/requireNativeComponent', () => ({
  __esModule: true,
  default: (name: string) => name
}));

describe('Composer keyboard native host', () => {
  beforeEach(() => {
    jest.replaceProperty(ReactNative.Platform, 'OS', 'android');
    Object.defineProperty(ReactNative.Platform, 'Version', { configurable: true, value: 35 });
    jest.spyOn(native, 'findNodeHandle').mockReturnValue(73);
    jest
      .spyOn(ReactNative.UIManager, 'dispatchViewManagerCommand')
      .mockImplementation(() => undefined)
      .mockClear();
  });
  afterEach(() => {
    Object.defineProperty(ReactNative.Platform, 'Version', platformVersion);
    jest.restoreAllMocks();
  });

  it('settles only the matching native completion and preserves View props', async () => {
    const ref = createRef<ComposerKeyboardHostHandle>();
    const view = await render(<ComposerKeyboardHost ref={ref} enabled testID="host" pointerEvents="box-none" />);
    expect(view.getByTestId('host')).toHaveProp('pointerEvents', 'box-none');
    const done = jest.fn();
    const waiting = ref.current!.hideKeyboard().then(done);
    expect(ReactNative.UIManager.dispatchViewManagerCommand).toHaveBeenCalledWith(73, 'hideKeyboard', [1]);
    await fireEvent(view.getByTestId('host'), 'keyboardHidden', { nativeEvent: { requestId: 90, success: true } });
    expect(done).not.toHaveBeenCalled();
    await fireEvent(view.getByTestId('host'), 'keyboardHidden', { nativeEvent: { requestId: 1, success: true } });
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('keeps the Android layout target out of the non-Android view and uses the platform keyboard dismissal', async () => {
    jest.replaceProperty(ReactNative.Platform, 'OS', 'ios');
    const dismiss = jest.spyOn(native.Keyboard, 'dismiss').mockImplementation(() => undefined);
    const ref = createRef<ComposerKeyboardHostHandle>();
    const view = await render(
      <ComposerKeyboardHost
        ref={ref}
        enabled
        hiddenLayoutHeight={600}
        testID="host"
        pointerEvents="box-none"
        style={{ height: 600, transform: [{ translateY: -120 }] }}
      />
    );
    const host = view.getByTestId('host');
    expect(host).not.toHaveProp('hiddenLayoutHeight');
    expect(host).toHaveProp('pointerEvents', 'box-none');
    expect(host).toHaveStyle({ height: 600, transform: [{ translateY: -120 }] });
    await ref.current!.hideKeyboard();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(native.UIManager.dispatchViewManagerCommand).not.toHaveBeenCalled();
  });

  it.each(['abort', 'disable', 'unmount'] as const)(
    'cancels a native request on %s and ignores its late event',
    async (end) => {
      const ref = createRef<ComposerKeyboardHostHandle>();
      const control = new AbortController();
      const view = await render(<ComposerKeyboardHost ref={ref} enabled testID="host" />);
      const event = view.getByTestId('host').props.onKeyboardHidden;
      const waiting = ref.current!.hideKeyboard(control.signal);
      const rejected = expect(waiting).rejects.toThrow();
      if (end === 'abort') await act(() => control.abort());
      else if (end === 'disable') await view.rerender(<ComposerKeyboardHost ref={ref} enabled={false} testID="host" />);
      else await view.unmount();
      await rejected;
      expect(ReactNative.UIManager.dispatchViewManagerCommand).toHaveBeenCalledWith(73, 'cancelHide', [1]);
      await act(() => event({ nativeEvent: { requestId: 1, success: true } }));
    }
  );

  it('rejects a failed native hide and permits a fresh request with a new id', async () => {
    const ref = createRef<ComposerKeyboardHostHandle>();
    const view = await render(<ComposerKeyboardHost ref={ref} enabled testID="host" />);
    const first = ref.current!.hideKeyboard();
    const rejected = expect(first).rejects.toThrow('键盘尚未收起');
    await fireEvent(view.getByTestId('host'), 'keyboardHidden', { nativeEvent: { requestId: 1, success: false } });
    await rejected;
    const second = ref.current!.hideKeyboard();
    expect(ReactNative.UIManager.dispatchViewManagerCommand).toHaveBeenLastCalledWith(73, 'hideKeyboard', [2]);
    await fireEvent(view.getByTestId('host'), 'keyboardHidden', { nativeEvent: { requestId: 2, success: true } });
    await second;
  });
  it('retains the controlled Modal input and pending host request when keyboardDidHide arrives early', async () => {
    const ref = createRef<ComposerKeyboardHostHandle>();
    const view = await render(
      <ModalSheetFrame keyboardHostRef={ref} visible backdropLabel="关闭面板" onRequestClose={() => undefined}>
        <ReactNative.TextInput testID="attachment-description" defaultValue="附件说明" />
      </ModalSheetFrame>
    );
    const originalHandle = ref.current;
    const host = view.getByTestId('composer-modal-keyboard-host');
    const input = view.getByTestId('attachment-description');
    const done = jest.fn();
    const waiting = ref.current!.hideKeyboard().then(done);
    await act(() => ReactNative.DeviceEventEmitter.emit('keyboardDidHide', {}));
    expect(ref.current).toBe(originalHandle);
    expect(view.getByTestId('composer-modal-keyboard-host')).toBe(host);
    expect(view.getByTestId('attachment-description')).toBe(input);
    expect(done).not.toHaveBeenCalled();
    expect(ReactNative.UIManager.dispatchViewManagerCommand).not.toHaveBeenCalledWith(73, 'cancelHide', [1]);
    await fireEvent(host, 'keyboardHidden', { nativeEvent: { requestId: 1, success: true } });
    await waiting;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('keeps Modal avoidance on native animation frames despite an early keyboardDidHide', async () => {
    const ref = createRef<ComposerKeyboardHostHandle>();
    const view = await render(
      <ModalSheetFrame keyboardHostRef={ref} visible backdropLabel="关闭面板" onRequestClose={() => undefined}>
        <ReactNative.TextInput testID="description" defaultValue="保留说明" />
      </ModalSheetFrame>
    );
    const host = view.getByTestId('composer-modal-keyboard-host');
    const input = view.getByTestId('description');
    expect(host.props.trackImeInsets).toBe(true);
    expect(host.props.children.props.behavior).toBeUndefined();
    const padding = () =>
      [...mockInsetStyles].map((read) => read()).findLast((style) => typeof style.paddingBottom === 'number')
        ?.paddingBottom;
    await fireEvent(host, 'imeInsets', { nativeEvent: { bottom: 336 } });
    expect(padding()).toBe(336);
    await act(() => ReactNative.DeviceEventEmitter.emit('keyboardDidHide', {}));
    expect(padding()).toBe(336);
    expect(view.getByTestId('description')).toBe(input);
    await fireEvent(host, 'imeInsets', { nativeEvent: { bottom: 171 } });
    expect(padding()).toBe(171);
    await fireEvent(host, 'imeInsets', { nativeEvent: { bottom: 0 } });
    expect(padding()).toBe(0);
  });

  it('retains legacy KAV avoidance and leaves ordinary Hosts out of local Insets tracking', async () => {
    Object.defineProperty(ReactNative.Platform, 'Version', { configurable: true, value: 28 });
    const ref = createRef<ComposerKeyboardHostHandle>();
    const view = await render(
      <ModalSheetFrame keyboardHostRef={ref} visible backdropLabel="关闭面板" onRequestClose={() => undefined}>
        <ReactNative.TextInput />
      </ModalSheetFrame>
    );
    expect(view.getByTestId('composer-modal-keyboard-host').props.children.props.behavior).toBe('padding');
    expect(view.getByTestId('composer-modal-keyboard-host').props.trackImeInsets).not.toBe(true);
    await view.rerender(<ComposerKeyboardHost ref={ref} enabled testID="ordinary-host" />);
    expect(view.getByTestId('ordinary-host').props.trackImeInsets).not.toBe(true);
  });
});
