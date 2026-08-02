import * as Haptics from 'expo-haptics';

export const TOUCH_HIT_SLOP = { top: 6, right: 6, bottom: 6, left: 6 };

export function pressWithFeedback(onPress: () => void) {
  void Haptics.selectionAsync().catch(() => undefined);
  onPress();
}

export function triggerPressFeedback() {
  void Haptics.selectionAsync().catch(() => undefined);
}
