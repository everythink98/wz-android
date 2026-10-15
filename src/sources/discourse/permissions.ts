import type { CurrentUserReaction } from '@/domain/forum/models';

export function canToggleDiscourseLike(
  item: { canLike?: boolean; liked?: boolean; currentUserReaction?: CurrentUserReaction | null } | null | undefined
) {
  if (item?.currentUserReaction) return item.currentUserReaction.canUndo;
  return item?.canLike === true || item?.liked === true;
}
