import { type Dispatch, type SetStateAction, useLayoutEffect } from 'react';
import { useAnimatedKeyboard } from 'react-native-reanimated';

export type KeyboardSource = ReturnType<typeof useAnimatedKeyboard>;
export type PublishKeyboardSource = Dispatch<SetStateAction<KeyboardSource | null>>;

export function useComposerKeyboardSource(publish: PublishKeyboardSource) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true
  });
  useLayoutEffect(() => {
    publish(keyboard);
    return () => publish((current) => (current === keyboard ? null : current));
  }, [keyboard, publish]);
  return keyboard;
}
