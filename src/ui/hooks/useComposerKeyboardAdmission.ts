import { useCallback, useEffect, useRef } from 'react';
import { AppState, Keyboard, Platform } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { ComposerImeInsetsEvent } from '@/ui/composer/ComposerKeyboardHost';

export function useComposerKeyboardAdmission() {
  const foreground = useSharedValue(true);
  const retainedWhileBackground = useSharedValue(false);
  const ignoreOldKeyboard = useSharedValue(false);
  const resumedKeyboardHeight = useSharedValue(0);
  const latestWindowEpoch = useRef(-1);
  const hasWindowInsets = Platform.OS === 'android' && Number(Platform.Version) >= 30;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        retainedWhileBackground.set(Keyboard.isVisible());
        ignoreOldKeyboard.set(true);
        resumedKeyboardHeight.set(0);
      }
      if (!hasWindowInsets) ignoreOldKeyboard.set(!Keyboard.isVisible());
      foreground.set(state === 'active');
    });
    // Android 10 and iOS do not emit the Android WindowInsets animation events.
    const show = hasWindowInsets ? null : Keyboard.addListener('keyboardDidShow', () => ignoreOldKeyboard.set(false));
    return () => {
      subscription.remove();
      show?.remove();
    };
  }, [foreground, hasWindowInsets, ignoreOldKeyboard, resumedKeyboardHeight, retainedWhileBackground]);

  const onImeInsets = useCallback(
    ({ nativeEvent }: ComposerImeInsetsEvent) => {
      const { focusEpoch, focused, keyboardBottom } = nativeEvent;
      // Only the Android window advances this epoch. A split-screen Activity may resume in the same window.
      if (focusEpoch < latestWindowEpoch.current) return;
      latestWindowEpoch.current = focusEpoch;
      if (!focused) ignoreOldKeyboard.set(true);
      resumedKeyboardHeight.set(focused ? keyboardBottom : 0);
    },
    [ignoreOldKeyboard, resumedKeyboardHeight]
  );
  return { foreground, retainedWhileBackground, ignoreOldKeyboard, resumedKeyboardHeight, onImeInsets };
}
