import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { AppState } from 'react-native';
import { runOnJS, runOnUI, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useCommittedRef } from './useCommittedRef';
import type { ComposerKeyboardHostHandle } from '@/ui/composer/ComposerKeyboardHost';

// The viewport owner supplies native IME and layout readiness. This hook must
// not create another keyboard subscription: those subscriptions own the window.
export function useKeyboardHandoff(
  ready: SharedValue<boolean>,
  active: boolean,
  host: RefObject<ComposerKeyboardHostHandle | null>
) {
  const currentActive = useCommittedRef(active);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const request = useSharedValue(0);
  const pending = useRef<{
    id: number;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    control: AbortController;
  } | null>(null);
  const finish = useCallback(
    (id: number, error?: string) => {
      const waiting = pending.current;
      if (!waiting || waiting.id !== id) return;
      pending.current = null;
      request.set(0);
      clearTimeout(waiting.timer);
      if (error) waiting.control.abort();
      if (error) waiting.reject(new Error(error));
      else waiting.resolve();
    },
    [request]
  );
  useLayoutEffect(() => {
    if (!active && pending.current) finish(pending.current.id, '编辑器已关闭，请重新选择');
  }, [active, finish]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && pending.current) finish(pending.current.id, '页面已离开前台，请重新选择');
    });
    return () => {
      mounted.current = false;
      subscription.remove();
      if (pending.current) finish(pending.current.id, '编辑器已关闭，请重新选择');
    };
  }, [finish]);
  return useCallback(() => {
    if (
      !mounted.current ||
      !currentActive.current ||
      AppState.currentState === 'background' ||
      AppState.currentState === 'inactive'
    )
      return Promise.reject(new Error('编辑器不在前台，请重新选择'));
    if (pending.current) return Promise.reject(new Error('正在准备选择，请稍候'));
    const id = ++sequence.current;
    const control = new AbortController();
    const result = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(id, '键盘尚未收起，请重试'), 2500);
      pending.current = { id, resolve, reject, timer, control };
    });
    request.set(id);
    void (async () => {
      try {
        if (!host.current) throw new Error('键盘容器尚未准备好，请重试');
        await host.current.hideKeyboard(control.signal);
        if (pending.current?.id !== id) return;
        runOnUI((nextId: number) => {
          'worklet';
          let settled = false;
          const check = () => {
            if (request.value !== nextId) return;
            // Check again on a subsequent UI frame so layout has an opportunity to
            // apply the final IME frame before an external Activity takes the window.
            if (settled && ready.value) {
              request.set(0);
              runOnJS(finish)(nextId);
              return;
            }
            settled = ready.value;
            requestAnimationFrame(check);
          };
          check();
        })(id);
      } catch (cause) {
        finish(id, cause instanceof Error ? cause.message : '键盘尚未收起，请重试');
      }
    })();
    return result;
  }, [currentActive, finish, host, ready, request]);
}
