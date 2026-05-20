export const feedFloatingActionsOffset = 420;

export function shouldShowFeedFloatingActions(scrollY: number) {
  return scrollY > feedFloatingActionsOffset;
}
