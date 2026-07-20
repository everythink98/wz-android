export function canToggleDiscourseLike(
  item: { canLike?: boolean; liked?: boolean } | null | undefined
) {
  return item?.canLike === true || item?.liked === true;
}
