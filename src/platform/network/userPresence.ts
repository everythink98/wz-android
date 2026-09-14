import { AppState } from 'react-native';

let lastInteractionAt = -Infinity;

export function recordUserInteraction() {
  if (AppState.currentState === 'active') lastInteractionAt = performance.now();
}

export function userPresent() {
  const elapsed = performance.now() - lastInteractionAt;
  return AppState.currentState === 'active' && elapsed >= 0 && elapsed < 60_000;
}
