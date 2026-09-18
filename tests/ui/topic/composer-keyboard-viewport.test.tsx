import React from 'react';
import { Text } from 'react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';

let mockLayout = { rawContainerHeight: 800, containerHeight: 800 };
let mockIndex = -1;
let mockNextIndex: number | undefined;
const mockKeyboard = { height: { value: 0 }, state: { value: 0 } };
const mockFrames = new Set<() => void>();
const mockLayoutState = {
  get: () => mockLayout,
  modify: (update: (state: typeof mockLayout) => typeof mockLayout) => {
    mockLayout = update({ ...mockLayout });
  }
};
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  useAnimatedKeyboard: () => mockKeyboard,
  useAnimatedReaction: (prepare: () => unknown, react: (value: unknown) => void) => {
    const { useEffect } = require('react') as typeof React;
    useEffect(() => {
      const frame = () => react(prepare());
      mockFrames.add(frame);
      frame();
      return () => {
        mockFrames.delete(frame);
      };
    }, [prepare, react]);
  }
}));
jest.mock('@gorhom/bottom-sheet', () => ({
  __esModule: true,
  default: (props: { children: React.ReactNode }) =>
    require('react').createElement(
      require('react-native').View,
      { ...props, ref: undefined, testID: 'sheet' },
      props.children
    ),
  BottomSheetView: require('react-native').View,
  useBottomSheetInternal: () => ({
    animatedLayoutState: mockLayoutState,
    animatedKeyboardState: { set: jest.fn() },
    animatedIndex: { get: () => mockIndex },
    animatedAnimationState: { get: () => ({ nextIndex: mockNextIndex }) }
  })
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

describe('Composer native keyboard viewport', () => {
  beforeEach(() => {
    mockLayout = { rawContainerHeight: 800, containerHeight: 800 };
    mockKeyboard.height.value = 0;
    mockIndex = -1;
    mockNextIndex = undefined;
  });
  it('focuses once after an interrupted close settles at the same open index without another onChange', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={() => {}}>
        {(focusSignal) => <Text>{`focus=${focusSignal}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    mockIndex = 0;
    await fireEvent(view.getByTestId('sheet'), 'change', 0);
    expect(view.getByText('focus=1')).toBeTruthy();
    mockNextIndex = -1;
    await view.rerender(host(false));
    await view.rerender(host(true));
    expect(view.getByText('focus=1')).toBeTruthy();
    mockNextIndex = undefined;
    await act(() => mockFrames.forEach((frame) => frame()));
    expect(view.getByText('focus=2')).toBeTruthy();
    await act(() => mockFrames.forEach((frame) => frame()));
    expect(view.getByText('focus=2')).toBeTruthy();
  });
  it('focuses a new opening once when an animation delivers an older change callback', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={() => {}}>
        {(focusSignal) => <Text>{`focus=${focusSignal}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(false));
    const oldChange = view.getByTestId('sheet').props.onChange;
    await view.rerender(host(true));
    await act(() => oldChange(0));
    expect(view.getByText('focus=1')).toBeTruthy();
    await act(() => oldChange(0));
    expect(view.getByText('focus=1')).toBeTruthy();
  });
  it('ignores a queued close callback after a new opening has started', async () => {
    const onOpenChange = jest.fn();
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={onOpenChange}>
        {() => null}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    const previousOpenCallback = view.getByTestId('sheet').props.onClose;
    await view.rerender(host(false));
    const closingCallback = view.getByTestId('sheet').props.onClose;
    await view.rerender(host(true));
    await act(() => closingCallback());
    await act(() => previousOpenCallback());
    expect(mockFrames.size).toBe(2);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it('uses each IME frame once without waiting for a JS layout, and keeps ownership until the sheet closes', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={() => {}}>
        {() => null}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    const frame = async (height: number) =>
      act(() => {
        mockKeyboard.height.value = height;
        mockFrames.forEach((update) => update());
      });
    await frame(300);
    expect(mockLayout.containerHeight).toBe(500);
    await frame(180);
    expect(mockLayout.containerHeight).toBe(620);
    await frame(0);
    expect(mockLayout.containerHeight).toBe(800);
    await frame(300);
    mockLayout.rawContainerHeight = 760;
    await frame(300);
    expect(mockLayout.containerHeight).toBe(460);
    await view.rerender(host(false));
    expect(mockLayout.containerHeight).toBe(460);
    await fireEvent(view.getByTestId('sheet'), 'close');
    expect(mockLayout.containerHeight).toBe(760);
    expect(mockFrames.size).toBe(0);
  });
});
