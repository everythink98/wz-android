import React from 'react';
import { AppState, BackHandler, DeviceEventEmitter, Dimensions, Keyboard, StyleSheet, Text } from 'react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '../render';
import { ComposerBottomSheet } from '@/ui/sheets/ComposerBottomSheet';

const mockKeyboard = { height: { value: 0 }, state: { value: 0 } };
const mockKeyboardState = { UNKNOWN: 0, OPENING: 1, OPEN: 2, CLOSING: 3, CLOSED: 4 } as const;
const mockFrames = new Set<() => void>();
let mockQueuedUI: (() => void)[] | null = null;
const mockAnimatedStyles = new Set<() => Record<string, unknown>>();
let mockHoldAnimations = false;
const mockAnimations: { finish: () => void; deliverQueuedCallback: () => void }[] = [];
let mockKeyboardSubscriptions = 0;
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  __esModule: true,
  default: {
    ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated').default,
    View: require('react-native').View
  },
  useSharedValue: (value: unknown) =>
    (require('react') as typeof React).useRef({
      value,
      get() {
        return this.value;
      },
      set(next: unknown) {
        if (next && typeof next === 'object' && 'animationTarget' in next) {
          const animation = next as { animationTarget: unknown; callback?: (finished: boolean) => void };
          const finish = () => {
            this.value = animation.animationTarget;
            animation.callback?.(true);
          };
          if (mockHoldAnimations)
            mockAnimations.push({ finish, deliverQueuedCallback: () => animation.callback?.(true) });
          else finish();
        } else this.value = next;
      }
    }).current,
  withTiming: (animationTarget: number, _config: unknown, callback?: (finished: boolean) => void) => ({
    animationTarget,
    callback
  }),
  cancelAnimation: () => undefined,
  useAnimatedKeyboard: () => {
    (require('react') as typeof React).useEffect(() => {
      mockKeyboardSubscriptions += 1;
      return () => {
        mockKeyboardSubscriptions -= 1;
      };
    }, []);
    return mockKeyboard;
  },
  runOnJS: (callback: (...args: unknown[]) => unknown) => callback,
  runOnUI:
    (callback: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      if (mockQueuedUI) mockQueuedUI.push(() => callback(...args));
      else callback(...args);
    },
  useAnimatedStyle: (factory: () => Record<string, unknown>) => {
    const { useRef, useEffect } = require('react') as typeof React;
    const current = useRef(factory);
    current.current = factory;
    useEffect(() => {
      const read = () => current.current();
      mockAnimatedStyles.add(read);
      return () => {
        mockAnimatedStyles.delete(read);
      };
    }, []);
    return factory();
  },
  useAnimatedReaction: (prepare: () => unknown, react: (value: unknown, previous: unknown) => void) => {
    const { useEffect } = require('react') as typeof React;
    useEffect(() => {
      let previous: unknown;
      const frame = () => {
        const value = prepare();
        react(value, previous);
        previous = value;
      };
      mockFrames.add(frame);
      frame();
      return () => {
        mockFrames.delete(frame);
      };
    }, [prepare, react]);
  }
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 })
}));

function fixedGeometry() {
  return [...mockAnimatedStyles].map((style) => style()).findLast((style) => Array.isArray(style.transform)) as {
    height: number;
    maxHeight?: number;
    transform: { translateY: number }[];
    paddingBottom: number;
    bottom?: number;
  };
}

function fixedBottom(nativeHeight = fixedGeometry().height) {
  const geometry = fixedGeometry();
  const layoutBottom = geometry.bottom === 0 ? Dimensions.get('window').height : nativeHeight;
  return geometry.transform[0]!.translateY + layoutBottom;
}

describe('Composer native keyboard viewport', () => {
  beforeEach(() => {
    mockKeyboard.height.value = 0;
    mockKeyboard.state.value = mockKeyboardState.CLOSED;
    mockQueuedUI = null;
    mockHoldAnimations = false;
    mockAnimations.length = 0;
    mockAnimatedStyles.clear();
  });
  it('positions the fixed editor from the current IME frame before any reaction or layout callback runs', async () => {
    await render(
      <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
        {() => <Text>正文</Text>}
      </ComposerBottomSheet>
    );
    const closed = fixedGeometry();
    expect(closed).toBeDefined();
    const bottom = fixedBottom();
    // Deliberately do not flush reactions: drawing can precede those mappers.
    mockKeyboard.height.value = 300;
    mockKeyboard.state.value = mockKeyboardState.CLOSING;
    const closing = fixedGeometry();
    expect(fixedBottom() - closing.paddingBottom).toBe(bottom - 300);
    expect(closing.paddingBottom).toBe(24);
    mockKeyboard.height.value = 0;
    mockKeyboard.state.value = mockKeyboardState.CLOSED;
    const restored = fixedGeometry();
    expect(fixedBottom()).toBe(bottom);
    expect(restored.paddingBottom).toBe(24);
  });
  it.each(['sheet', 'fullscreen'] as const)(
    'retains the %s navigation background through the last IME frames without moving the footer',
    async (presentation) => {
      await render(
        <ComposerBottomSheet dark={false} fixedContent visible presentation={presentation} onOpenChange={() => {}}>
          {() => <Text>正文与工具栏</Text>}
        </ComposerBottomSheet>
      );
      const windowBottom = Dimensions.get('window').height;
      const closedFooter = fixedBottom() - fixedGeometry().paddingBottom;
      for (const height of [24, 20, 12, 4, 0]) {
        mockKeyboard.height.value = height;
        mockKeyboard.state.value = height ? mockKeyboardState.CLOSING : mockKeyboardState.CLOSED;
        expect(fixedBottom() - fixedGeometry().paddingBottom).toBe(closedFooter);
        // The IME can stop painting its navigation region before its inset reaches zero.
        expect(fixedBottom()).toBe(windowBottom);
      }
    }
  );
  it.each(['sheet', 'fullscreen'] as const)(
    'keeps the %s bottom attached to the IME when the new native height arrives a frame late',
    async (presentation) => {
      mockKeyboard.height.value = 300;
      mockKeyboard.state.value = mockKeyboardState.CLOSING;
      await render(
        <ComposerBottomSheet dark={false} fixedContent visible presentation={presentation} onOpenChange={() => {}}>
          {() => <Text>正文与工具栏</Text>}
        </ComposerBottomSheet>
      );
      let nativeHeight = fixedGeometry().height;
      const windowBottom = Dimensions.get('window').height;
      for (const height of [160, 80, 24, 20, 12, 4, 0]) {
        mockKeyboard.height.value = height;
        // Transform can update before Fabric applies the newly requested layout height.
        expect(fixedBottom(nativeHeight) - fixedGeometry().paddingBottom).toBe(windowBottom - Math.max(height, 24));
        nativeHeight = fixedGeometry().height;
        expect(fixedBottom(nativeHeight) - fixedGeometry().paddingBottom).toBe(windowBottom - Math.max(height, 24));
      }
    }
  );
  it('keeps the editor content height stable while the navigation inset returns below the sheet', async () => {
    await render(
      <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
        {() => <Text>正文与工具栏</Text>}
      </ComposerBottomSheet>
    );
    const closed = fixedGeometry();
    const contentHeight = closed.height - closed.paddingBottom;
    const bottom = fixedBottom();
    // The WebView cannot resize its HTML toolbar in the same native IME frame.
    // Restore the safe-area outside that content instead of squeezing it.
    for (const height of [80, 24, 20, 12, 4, 0]) {
      mockKeyboard.height.value = height;
      mockKeyboard.state.value = height ? mockKeyboardState.CLOSING : mockKeyboardState.CLOSED;
      const frame = fixedGeometry();
      expect(frame.height - frame.paddingBottom).toBe(contentHeight);
      expect(fixedBottom() - frame.paddingBottom).toBe(bottom - Math.max(height, 24));
    }
  });
  it('retains the editor while subscribing only from opening through completed closing', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} fixedContent visible={visible} onOpenChange={() => {}}>
        {(focus) => <Text testID="retained-editor">{`focus=${focus}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(false));
    const editor = view.getByTestId('retained-editor', { includeHiddenElements: true });
    expect(mockKeyboardSubscriptions).toBe(0);
    mockHoldAnimations = true;
    await view.rerender(host(true));
    expect(mockKeyboardSubscriptions).toBe(1);
    expect(view.getByText('focus=0')).toBeTruthy();
    await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
    expect(view.getByText('focus=1')).toBeTruthy();
    expect(view.getByTestId('retained-editor')).toBe(editor);
    await act(() => {
      mockKeyboard.height.value = 200;
      mockKeyboard.state.value = mockKeyboardState.OPEN;
      mockFrames.forEach((frame) => frame());
    });
    expect(view.getByText('focus=1')).toBeTruthy();
    await view.rerender(host(false));
    expect(mockKeyboardSubscriptions).toBe(1);
    await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
    expect(mockKeyboardSubscriptions).toBe(0);
    expect(view.getByTestId('retained-editor', { includeHiddenElements: true })).toBe(editor);
    await view.rerender(host(true));
    await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
    expect(view.getByTestId('retained-editor')).toBe(editor);
    expect(view.getByText('focus=2')).toBeTruthy();
    expect(mockKeyboardSubscriptions).toBe(1);
  });
  it('ignores a fixed-panel close completion queued before a rapid reopening', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} fixedContent visible={visible} onOpenChange={() => {}}>
        {(focus) => <Text>{`focus=${focus}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    expect(view.getByText('focus=1')).toBeTruthy();
    mockHoldAnimations = true;
    await view.rerender(host(false));
    const closing = mockAnimations.splice(0);
    await view.rerender(host(true));
    await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
    await act(() => closing.forEach((animation) => animation.deliverQueuedCallback()));
    expect(view.getByText('focus=2')).toBeTruthy();
    expect(mockKeyboardSubscriptions).toBe(1);
    expect(view.getByTestId('composer-bottom-sheet')).toHaveProp('pointerEvents', 'auto');
  });
  it('keeps fullscreen and return geometry on the same editor without repeating initial focus', async () => {
    const host = (presentation: 'sheet' | 'fullscreen', active = true) => (
      <ComposerBottomSheet
        dark={false}
        fixedContent
        visible
        active={active}
        presentation={presentation}
        onOpenChange={() => {}}
      >
        {(focus) => <Text testID="retained-editor">{`focus=${focus}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host('sheet'));
    const editor = view.getByTestId('retained-editor');
    const sheetHeight = fixedGeometry().height;
    const bottom = fixedBottom();
    await view.rerender(host('fullscreen'));
    expect(fixedGeometry().height).toBeGreaterThan(sheetHeight);
    expect(fixedBottom() - fixedGeometry().height).toBe(0);
    expect(fixedBottom()).toBe(bottom);
    mockKeyboard.height.value = 300;
    expect(fixedBottom() - fixedGeometry().height).toBe(0);
    expect(fixedBottom()).toBe(bottom - 276);
    await view.rerender(host('sheet'));
    expect(view.getByText('focus=1')).toBeTruthy();
    expect(view.getByTestId('retained-editor')).toBe(editor);
    await view.rerender(host('sheet', false));
    await view.rerender(host('sheet'));
    expect(view.getByText('focus=1')).toBeTruthy();
    expect(view.getByTestId('retained-editor')).toBe(editor);
  });
  it('handles Back as keyboard, fullscreen, then controlled close without backdrop dismissal', async () => {
    let back!: () => boolean | null | undefined;
    const subscription = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
      back = () => callback({ type: 'hardwareBackPress', timeStamp: 0 });
      return { remove: jest.fn() };
    });
    const keyboardVisible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const onPresentationChange = jest.fn();
    const onOpenChange = jest.fn();
    const host = (presentation: 'sheet' | 'fullscreen') => (
      <ComposerBottomSheet
        dark={false}
        fixedContent
        visible
        presentation={presentation}
        onOpenChange={onOpenChange}
        onPresentationChange={onPresentationChange}
      >
        {() => <Text>正文</Text>}
      </ComposerBottomSheet>
    );
    try {
      const view = await render(host('fullscreen'));
      onPresentationChange.mockClear();
      dismiss.mockClear();
      expect(back()).toBe(true);
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(onPresentationChange).not.toHaveBeenCalled();
      keyboardVisible.mockReturnValue(false);
      expect(back()).toBe(true);
      expect(onPresentationChange).toHaveBeenCalledWith('sheet');
      expect(onOpenChange).not.toHaveBeenCalled();
      await view.rerender(host('sheet'));
      expect(back()).toBe(true);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      const backdrop = view.getByTestId('composer-bottom-sheet-backdrop', { includeHiddenElements: true });
      expect(backdrop.props.onPress).toBeUndefined();
      expect(backdrop.props.onTouchEnd).toBeUndefined();
    } finally {
      subscription.mockRestore();
      keyboardVisible.mockRestore();
      dismiss.mockRestore();
    }
  });
  it.each(['fixed', 'dynamic'] as const)(
    'opens a picker only after the %s sheet and native IME closure survive another UI frame',
    async (kind) => {
      const frames: FrameRequestCallback[] = [];
      const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      let awaitKeyboardSettled!: () => Promise<void>;
      const opened = jest.fn();
      try {
        mockKeyboard.height.value = 336;
        mockKeyboard.state.value = mockKeyboardState.CLOSING;
        const view = await render(
          <ComposerBottomSheet dark={false} fixedContent={kind === 'fixed'} visible onOpenChange={() => {}}>
            {(_focus, settled) => {
              awaitKeyboardSettled = settled;
              return <Text>正文</Text>;
            }}
          </ComposerBottomSheet>
        );
        if (kind === 'dynamic') {
          await fireEvent(view.getByTestId('composer-bottom-sheet-content'), 'layout', {
            nativeEvent: { layout: { width: 400, height: 208, x: 0, y: 0 } }
          });
        }
        const advance = async () =>
          act(() => {
            mockFrames.forEach((callback) => callback());
            frames.splice(0).forEach((callback) => callback(0));
          });
        const waiting = awaitKeyboardSettled().then(opened);
        await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
        await advance();
        expect(opened).not.toHaveBeenCalled();
        mockKeyboard.height.value = 12;
        await advance();
        expect(opened).not.toHaveBeenCalled();
        mockKeyboard.height.value = 0;
        await advance();
        expect(opened).not.toHaveBeenCalled();
        mockKeyboard.state.value = mockKeyboardState.CLOSED;
        await advance();
        expect(opened).not.toHaveBeenCalled();
        await advance();
        await waiting;
        expect(opened).toHaveBeenCalledTimes(1);
      } finally {
        frame.mockRestore();
      }
    }
  );

  it('waits for the fixed panel opening animation before accepting a zero-height keyboard', async () => {
    mockHoldAnimations = true;
    const frames: FrameRequestCallback[] = [];
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let settled!: () => Promise<void>;
    try {
      await render(
        <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
          {(_focus, wait) => {
            settled = wait;
            return <Text>正文</Text>;
          }}
        </ComposerBottomSheet>
      );
      const opened = jest.fn();
      const waiting = settled().then(opened);
      const advance = () =>
        act(() => {
          mockFrames.forEach((update) => update());
          frames.splice(0).forEach((callback) => callback(0));
        });
      await advance();
      await advance();
      expect(opened).not.toHaveBeenCalled();
      await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
      await advance();
      expect(opened).not.toHaveBeenCalled();
      await advance();
      await waiting;
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      frame.mockRestore();
    }
  });

  it('allows a never-opened keyboard only after checking its zero-height viewport on the UI thread', async () => {
    const frames: FrameRequestCallback[] = [];
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let awaitKeyboardSettled!: () => Promise<void>;
    try {
      mockKeyboard.state.value = mockKeyboardState.UNKNOWN;
      await render(
        <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
          {(_focus, settled) => {
            awaitKeyboardSettled = settled;
            return <Text>正文</Text>;
          }}
        </ComposerBottomSheet>
      );
      const opened = jest.fn();
      const waiting = awaitKeyboardSettled().then(opened);
      expect(opened).not.toHaveBeenCalled();
      await act(async () => undefined);
      await act(() => frames.splice(0).forEach((callback) => callback(0)));
      await waiting;
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      frame.mockRestore();
    }
  });
  it('does not revive an unmounted picker wait when its queued UI work starts late', async () => {
    const frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    mockQueuedUI = [];
    let awaitKeyboardSettled!: () => Promise<void>;
    try {
      const view = await render(
        <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
          {(_focus, settled) => {
            awaitKeyboardSettled = settled;
            return <Text>正文</Text>;
          }}
        </ComposerBottomSheet>
      );
      const waiting = awaitKeyboardSettled();
      const rejected = expect(waiting).rejects.toThrow('编辑器已关闭');
      await view.unmount();
      await rejected;
      frame.mockClear();
      await act(() => mockQueuedUI!.splice(0).forEach((callback) => callback()));
      expect(frame).not.toHaveBeenCalled();
    } finally {
      frame.mockRestore();
      mockQueuedUI = null;
    }
  });

  it.each(['close', 'unmount', 'background', 'timeout'] as const)(
    'rejects a pending picker on %s instead of opening it',
    async (end) => {
      jest.useFakeTimers();
      const subscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
      let awaitKeyboardSettled!: () => Promise<void>;
      const content = (_focus: number, settled: () => Promise<void>) => {
        awaitKeyboardSettled = settled;
        return <Text>正文</Text>;
      };
      try {
        mockKeyboard.state.value = mockKeyboardState.CLOSING;
        mockKeyboard.height.value = 336;
        const view = await render(
          <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
            {content}
          </ComposerBottomSheet>
        );
        const waiting = awaitKeyboardSettled();
        const rejected = expect(waiting).rejects.toThrow(
          end === 'timeout' ? '键盘尚未收起' : end === 'background' ? '页面已离开前台' : '编辑器已关闭'
        );
        if (end === 'close')
          await view.rerender(
            <ComposerBottomSheet dark={false} fixedContent visible={false} onOpenChange={() => {}}>
              {content}
            </ComposerBottomSheet>
          );
        else if (end === 'unmount') await view.unmount();
        else if (end === 'background')
          await act(() => {
            jest
              .mocked(AppState.addEventListener)
              .mock.calls.slice(subscriptions)
              .forEach(([event, callback]) => {
                if (event === 'change') callback('background');
              });
          });
        else await act(() => jest.advanceTimersByTime(2500));
        await rejected;
      } finally {
        jest.useRealTimers();
      }
    }
  );
  it('keeps the navigation padding under the IME while placing the footer above it', async () => {
    const view = await render(
      <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
        {() => <Text>正文</Text>}
      </ComposerBottomSheet>
    );
    const content = view.getByTestId('composer-bottom-sheet');
    expect(StyleSheet.flatten(content.props.style).paddingBottom).toBe(24);
    await act(() => {
      mockKeyboard.height.value = 300;
      mockFrames.forEach((frame) => frame());
    });
    expect(fixedGeometry().paddingBottom).toBe(24);
    expect(fixedBottom() - fixedGeometry().paddingBottom).toBe(Dimensions.get('window').height - 300);
    await act(() => {
      mockKeyboard.height.value = 0;
      mockFrames.forEach((frame) => frame());
    });
    expect([...mockAnimatedStyles].some((style) => style().paddingBottom === 24)).toBe(true);
  });
  it('focuses the measured dynamic editor once after an interrupted close', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={() => {}}>
        {(focusSignal) => <Text>{`focus=${focusSignal}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    expect(view.getByText('focus=0')).toBeTruthy();
    await fireEvent(view.getByTestId('composer-bottom-sheet-content'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 208, x: 0, y: 0 } }
    });
    expect(view.getByText('focus=1')).toBeTruthy();
    mockHoldAnimations = true;
    await view.rerender(host(false));
    const oldClose = mockAnimations.splice(0);
    await view.rerender(host(true));
    await act(() => oldClose.forEach((animation) => animation.deliverQueuedCallback()));
    expect(view.getByText('focus=1')).toBeTruthy();
    await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
    expect(view.getByText('focus=2')).toBeTruthy();
    await act(() => mockFrames.forEach((frame) => frame()));
    expect(view.getByText('focus=2')).toBeTruthy();
  });
  it('resumes a retained reply or message sheet without a new focus intent or presentation reset', async () => {
    const onPresentationChange = jest.fn();
    const host = (active: boolean, visible = true) => (
      <ComposerBottomSheet
        active={active}
        dark={false}
        visible={visible}
        presentation="fullscreen"
        onOpenChange={() => {}}
        onPresentationChange={onPresentationChange}
      >
        {(signal) => <Text>{`focus=${signal}`}</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    await fireEvent(view.getByTestId('composer-bottom-sheet-content'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 208, x: 0, y: 0 } }
    });
    expect(view.getByText('focus=1')).toBeTruthy();
    onPresentationChange.mockClear();
    await view.rerender(host(false));
    expect(view.getByTestId('composer-bottom-sheet', { includeHiddenElements: true }).props.pointerEvents).toBe('none');
    await view.rerender(host(true));
    expect(view.getByText('focus=1')).toBeTruthy();
    expect(onPresentationChange).not.toHaveBeenCalled();
    await view.rerender(host(true, false));
    await view.rerender(host(true));
    expect(view.getByText('focus=2')).toBeTruthy();
  });
  it('lets native layout resize dynamic content before its measurement callback without repeating focus', async () => {
    const view = await render(
      <ComposerBottomSheet dark={false} visible onOpenChange={() => {}}>
        {(signal) => <Text>{`focus=${signal}`}</Text>}
      </ComposerBottomSheet>
    );
    const content = view.getByTestId('composer-bottom-sheet-content');
    expect(StyleSheet.flatten(content.props.style).flex).toBeUndefined();
    const editor = view.getByText('focus=0');
    for (const height of [208, 380, 260]) {
      // A measured height would hold the parent at the previous size for one
      // commit, clipping an opening toolbar or leaving space after it closes.
      expect(fixedGeometry().height).toBeUndefined();
      expect(fixedGeometry().maxHeight).toBe(
        Math.round(Math.max(320, Dimensions.get('window').height - 24) * 0.75) + 24
      );
      await fireEvent(content, 'layout', { nativeEvent: { layout: { width: 400, height, x: 0, y: 0 } } });
      expect(fixedGeometry().height).toBeUndefined();
      expect(view.getByText('focus=1')).toBe(editor);
    }
  });
  it('releases a dynamic keyboard subscription when closed before its first content measurement', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={() => {}}>
        {() => <Text>尚未测量的正文</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    expect(mockKeyboardSubscriptions).toBe(1);
    await view.rerender(host(false));
    expect(mockKeyboardSubscriptions).toBe(0);
  });
  it('keeps the dynamic keyboard subscription until the closing animation finishes', async () => {
    const host = (visible: boolean) => (
      <ComposerBottomSheet dark={false} visible={visible} onOpenChange={() => {}}>
        {() => <Text>原生回复</Text>}
      </ComposerBottomSheet>
    );
    const view = await render(host(true));
    await fireEvent(view.getByTestId('composer-bottom-sheet-content'), 'layout', {
      nativeEvent: { layout: { width: 400, height: 208, x: 0, y: 0 } }
    });
    mockHoldAnimations = true;
    await view.rerender(host(false));
    expect(mockKeyboardSubscriptions).toBe(1);
    await act(() => mockAnimations.splice(0).forEach((animation) => animation.finish()));
    expect(mockKeyboardSubscriptions).toBe(0);
  });
  it.each([200, 2000])(
    'keeps dynamic content of height %i above the IME without deducting the navigation area twice',
    async (bodyHeight) => {
      const view = await render(
        <ComposerBottomSheet dark={false} visible onOpenChange={() => {}}>
          {() => <Text style={{ height: bodyHeight }}>动态回复正文</Text>}
        </ComposerBottomSheet>
      );
      const windowHeight = Dimensions.get('window').height;
      const padding = StyleSheet.flatten(view.getByTestId('composer-bottom-sheet-content').props.style).paddingBottom;
      await fireEvent(view.getByTestId('composer-bottom-sheet-content'), 'layout', {
        nativeEvent: { layout: { width: 400, height: bodyHeight + padding, x: 0, y: 0 } }
      });
      const originalContentLimit = Math.round(Math.max(320, windowHeight - 24) * 0.75);
      expect(fixedGeometry().height).toBeUndefined();
      expect(fixedGeometry().maxHeight).toBe(originalContentLimit + 24);
      for (const keyboardHeight of [700, 300, 24, 12, 0]) {
        await act(() => {
          mockKeyboard.height.value = keyboardHeight;
          mockKeyboard.state.value = keyboardHeight ? mockKeyboardState.CLOSING : mockKeyboardState.CLOSED;
          mockFrames.forEach((update) => update());
        });
        const footerBottom = fixedBottom() - fixedGeometry().paddingBottom - padding;
        expect(footerBottom).toBe(windowHeight - Math.max(keyboardHeight, 24) - 8);
        if (keyboardHeight <= 24) expect(fixedBottom()).toBe(windowHeight);
      }
    }
  );
  it('moves the dynamic footer from the current IME frame before any viewport reaction or layout callback', async () => {
    const view = await render(
      <ComposerBottomSheet dark={false} visible onOpenChange={() => {}}>
        {() => <Text style={{ height: 200 }}>动态回复正文</Text>}
      </ComposerBottomSheet>
    );
    const windowHeight = Dimensions.get('window').height;
    const content = view.getByTestId('composer-bottom-sheet-content');
    await fireEvent(content, 'layout', { nativeEvent: { layout: { width: 400, height: 208, x: 0, y: 0 } } });
    const footerBottom = () =>
      fixedBottom() - fixedGeometry().paddingBottom - StyleSheet.flatten(content.props.style).paddingBottom;
    for (const height of [300, 180, 24, 12, 0]) {
      mockKeyboard.height.value = height;
      mockKeyboard.state.value = height ? mockKeyboardState.CLOSING : mockKeyboardState.CLOSED;
      // Do not run the reaction that copies IME height into a separate viewport.
      expect(footerBottom()).toBe(windowHeight - Math.max(height, 24) - 8);
    }
  });
  it('keeps the sheet at the bottom when a hidden keyboard reports stale IME height after an external Activity', async () => {
    const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
    const subscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
    try {
      const view = await render(
        <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
          {() => <Text>正文</Text>}
        </ComposerBottomSheet>
      );
      const onAppState = jest
        .mocked(AppState.addEventListener)
        .mock.calls.slice(subscriptions)
        .findLast(([event]) => event === 'change')?.[1];
      expect(onAppState).toBeDefined();
      const bottom = fixedBottom();
      await act(() => {
        mockKeyboard.state.value = mockKeyboardState.OPEN;
        mockKeyboard.height.value = 300;
        mockFrames.forEach((frame) => frame());
      });
      expect(fixedBottom()).toBe(bottom - 276);
      await act(() => {
        onAppState?.('background');
        mockFrames.forEach((frame) => frame());
      });
      expect(view.getByTestId('composer-bottom-sheet').props.pointerEvents).toBe('auto');
      expect(fixedBottom()).toBe(bottom);
      await act(() => onAppState?.('active'));
      await act(() => mockFrames.forEach((frame) => frame()));
      expect(fixedBottom()).toBe(bottom);
      await act(() => {
        mockKeyboard.state.value = mockKeyboardState.CLOSED;
        mockKeyboard.height.value = 0;
        mockFrames.forEach((frame) => frame());
      });
      await act(() => {
        mockKeyboard.state.value = mockKeyboardState.OPENING;
        mockKeyboard.height.value = 100;
        mockFrames.forEach((frame) => frame());
      });
      expect(fixedBottom()).toBe(bottom - 76);
    } finally {
      visible.mockRestore();
    }
  });
  it('keeps a visible keyboard inset and clears it if the keyboard hides before app resume', async () => {
    const visible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const subscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
    try {
      await render(
        <ComposerBottomSheet dark={false} fixedContent visible onOpenChange={() => {}}>
          {() => <Text>正文</Text>}
        </ComposerBottomSheet>
      );
      const onAppState = jest
        .mocked(AppState.addEventListener)
        .mock.calls.slice(subscriptions)
        .findLast(([event]) => event === 'change')?.[1];
      const bottom = fixedBottom();
      await act(() => {
        mockKeyboard.state.value = mockKeyboardState.OPEN;
        mockKeyboard.height.value = 300;
        mockFrames.forEach((frame) => frame());
      });
      await act(() => {
        onAppState?.('background');
        mockFrames.forEach((frame) => frame());
      });
      expect(fixedBottom()).toBe(bottom - 276);
      visible.mockReturnValue(false);
      await act(() => {
        onAppState?.('active');
        mockFrames.forEach((frame) => frame());
      });
      expect(fixedBottom()).toBe(bottom);
    } finally {
      visible.mockRestore();
    }
  });
});
