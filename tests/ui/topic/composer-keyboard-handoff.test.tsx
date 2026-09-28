import { useRef } from 'react';
import { AppState, Text } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useKeyboardHandoff } from '@/ui/hooks/useKeyboardHandoff';
import { act, render } from '../render';

jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  runOnUI: (callback: (...args: unknown[]) => unknown) => callback,
  runOnJS: (callback: (...args: unknown[]) => unknown) => callback
}));

describe('Composer keyboard handoff', () => {
  let frames: FrameRequestCallback[];
  let frame: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    frames = [];
    frame = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  });
  afterEach(() => {
    frame.mockRestore();
    jest.useRealTimers();
  });
  const advance = () => act(() => frames.splice(0).forEach((callback) => callback(0)));

  it('waits for native control completion before checking two ready UI frames', async () => {
    const native = Promise.withResolvers<void>();
    const hideKeyboard = jest.fn((_signal?: AbortSignal) => native.promise);
    let wait!: () => Promise<void>;
    function Harness() {
      const ready = useRef({ value: true } as SharedValue<boolean>).current;
      const host = useRef({ hideKeyboard });
      wait = useKeyboardHandoff(ready, true, host);
      return <Text>正文</Text>;
    }
    const view = await render(<Harness />);
    const opened = jest.fn();
    const waiting = wait().then(opened);
    try {
      await advance();
      await advance();
      expect(opened).not.toHaveBeenCalled();
      expect(hideKeyboard).toHaveBeenCalledTimes(1);
      await act(() => native.resolve());
      expect(opened).not.toHaveBeenCalled();
      await advance();
      await waiting;
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
      await waiting.catch(() => undefined);
    }
  });

  it.each(['close', 'unmount', 'background', 'timeout'] as const)(
    'cancels native control and rejects a pending %s handoff',
    async (end) => {
      jest.useFakeTimers();
      const native = Promise.withResolvers<void>();
      let signal!: AbortSignal;
      const hideKeyboard = jest.fn((next?: AbortSignal) => {
        signal = next!;
        return native.promise;
      });
      let wait!: () => Promise<void>;
      function Harness({ active = true }: { active?: boolean }) {
        const ready = useRef({ value: false } as SharedValue<boolean>).current;
        const host = useRef({ hideKeyboard });
        wait = useKeyboardHandoff(ready, active, host);
        return <Text>正文</Text>;
      }
      const subscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
      const view = await render(<Harness />);
      const waiting = wait();
      const rejected = expect(waiting).rejects.toThrow();
      if (end === 'close') await view.rerender(<Harness active={false} />);
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
      expect(signal?.aborted).toBe(true);
      await act(() => native.resolve());
      expect(frames).toHaveLength(0);
    }
  );
});
