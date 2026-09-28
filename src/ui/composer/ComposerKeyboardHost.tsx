import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type ComponentRef } from 'react';
import {
  findNodeHandle,
  Keyboard,
  Platform,
  requireNativeComponent,
  UIManager,
  View,
  type NativeSyntheticEvent,
  type ViewProps
} from 'react-native';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import Animated from 'react-native-reanimated';

export type ComposerKeyboardHostHandle = {
  hideKeyboard: (signal?: AbortSignal) => Promise<void>;
};

type HiddenEvent = NativeSyntheticEvent<{ requestId: number; success: boolean }>;
export type ComposerImeInsetsEvent = NativeSyntheticEvent<{ bottom: number }>;
type HostProps = ViewProps & {
  enabled: boolean;
  trackImeInsets?: boolean;
  onImeInsets?: (event: ComposerImeInsetsEvent) => void;
};
const NativeHost = requireNativeComponent<HostProps & { onKeyboardHidden: (event: HiddenEvent) => void }>(
  'WzComposerKeyboardHost'
);
const AnimatedNativeHost = Animated.createAnimatedComponent(NativeHost);

export const ComposerKeyboardHost = forwardRef<ComposerKeyboardHostHandle, HostProps>(function ComposerKeyboardHost(
  { enabled, ...props },
  ref
) {
  const nativeRef = useRef<ComponentRef<typeof NativeHost>>(null);
  const currentEnabled = useCommittedRef(enabled);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const pending = useRef<{
    id: number;
    tag: number;
    resolve: () => void;
    reject: (error: Error) => void;
    detachAbort: () => void;
  } | null>(null);
  const finish = useCallback((error?: string, cancel = false) => {
    const waiting = pending.current;
    if (!waiting) return;
    pending.current = null;
    waiting.detachAbort();
    if (cancel) {
      try {
        UIManager.dispatchViewManagerCommand(waiting.tag, 'cancelHide', [waiting.id]);
      } catch {
        // The native view can already be detached; the JS wait still ends.
      }
    }
    if (error) waiting.reject(new Error(error));
    else waiting.resolve();
  }, []);
  useLayoutEffect(() => {
    if (!enabled) finish('编辑器已关闭，请重新选择', true);
  }, [enabled, finish]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      finish('编辑器已关闭，请重新选择', true);
    };
  }, [finish]);
  useImperativeHandle(
    ref,
    () => ({
      hideKeyboard(signal) {
        if (!mounted.current || !currentEnabled.current || signal?.aborted)
          return Promise.reject(new Error('编辑器已关闭，请重新选择'));
        if (pending.current) return Promise.reject(new Error('正在收起键盘，请稍候'));
        if (Platform.OS !== 'android') {
          Keyboard.dismiss();
          return Promise.resolve();
        }
        const tag = findNodeHandle(nativeRef.current);
        if (tag === null) return Promise.reject(new Error('键盘容器尚未准备好，请重试'));
        const id = ++sequence.current;
        return new Promise<void>((resolve, reject) => {
          const abort = () => finish('键盘交接已取消，请重新选择', true);
          pending.current = {
            id,
            tag,
            resolve,
            reject,
            detachAbort: () => signal?.removeEventListener('abort', abort)
          };
          signal?.addEventListener('abort', abort, { once: true });
          try {
            UIManager.dispatchViewManagerCommand(tag, 'hideKeyboard', [id]);
          } catch {
            finish('键盘容器尚未准备好，请重试', true);
          }
        });
      }
    }),
    [currentEnabled, finish]
  );
  if (Platform.OS !== 'android') return <View {...props} />;
  return (
    <AnimatedNativeHost
      {...props}
      ref={nativeRef}
      enabled={enabled}
      onKeyboardHidden={({ nativeEvent }) => {
        if (pending.current?.id !== nativeEvent.requestId) return;
        finish(nativeEvent.success ? undefined : '键盘尚未收起，请重试');
      }}
    />
  );
});
