export type MoreBadgeState = 'none' | 'update' | 'messages' | 'both';

export function moreBadgeState(hasUpdate: boolean, hasMessages: boolean): MoreBadgeState {
  if (hasUpdate && hasMessages) return 'both';
  if (hasMessages) return 'messages';
  if (hasUpdate) return 'update';
  return 'none';
}

export function moreBadgeAccessibilityLabel(state: MoreBadgeState) {
  if (state === 'update' || state === 'both') return '更多，有可用更新';
  return '更多';
}
